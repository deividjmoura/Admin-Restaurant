#!/usr/bin/env python3
"""Liga createExternalPaymentIntent no createPayment (CARD). Idempotente."""
from pathlib import Path

p = Path("src/modules/payments/payments.repository.js")
if not p.exists():
    raise SystemExit(f"arquivo nao encontrado: {p}")

text = p.read_text()

if "createExternalPaymentIntent" not in text:
    text = text.replace(
        "import { isPaidEvent, redactWebhookPayload } from './webhook-auth.js';",
        "import { isPaidEvent, redactWebhookPayload } from './webhook-auth.js';\n"
        "import { createExternalPaymentIntent } from './provider-adapter.js';",
        1,
    )

text = text.replace(
    "resolvedProvider = provider || 'provider_pending';",
    "resolvedProvider = provider || process.env.CARD_PROVIDER || 'mock_card';",
    1,
)

old = """      const { provider: resolvedProvider, pixCopyPaste } = resolveProviderContext(store, {
        method,
        amount,
        provider,
        idempotencyKey,
      });

      const row = await insertPaymentRow(client, {
        storeId,
        orderId,
        sessionId,
        method,
        amount,
        status: 'PENDING',
        provider: resolvedProvider,
        providerPaymentId,
        idempotencyKey,
        pixCopyPaste,
        metadata,
      });"""

new = """      const { provider: resolvedProvider, pixCopyPaste } = resolveProviderContext(store, {
        method,
        amount,
        provider,
        idempotencyKey,
      });

      let finalProvider = resolvedProvider;
      let finalProviderPaymentId = providerPaymentId ?? null;
      let finalMetadata = { ...(metadata || {}) };

      if (method === 'CARD' && !finalProviderPaymentId) {
        const intent = await createExternalPaymentIntent({
          method,
          amount,
          storeId,
          idempotencyKey,
          provider: provider || finalProvider,
        });
        if (intent) {
          finalProvider = intent.provider;
          finalProviderPaymentId = intent.providerPaymentId;
          finalMetadata = { ...finalMetadata, ...intent.metadata };
        }
      }

      const row = await insertPaymentRow(client, {
        storeId,
        orderId,
        sessionId,
        method,
        amount,
        status: 'PENDING',
        provider: finalProvider,
        providerPaymentId: finalProviderPaymentId,
        idempotencyKey,
        pixCopyPaste,
        metadata: finalMetadata,
      });"""

if "finalProviderPaymentId" in text:
    print("ja patchado — nada a fazer")
elif old not in text:
    raise SystemExit("bloco createPayment nao encontrado — confira o arquivo")
else:
    text = text.replace(old, new, 1)
    p.write_text(text)
    print(f"patched ok ({p.stat().st_size} bytes)")
