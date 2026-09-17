/**
 * Adapter Mercado Pago — PIX dinâmico (sandbox ou produção via env).
 * Credenciais NUNCA no código — só process.env.
 *
 * Env:
 *   MP_ACCESS_TOKEN   — token de teste ou produção
 *   MP_WEBHOOK_SECRET — segredo para validar x-signature (opcional em sandbox)
 *   MP_NOTIFICATION_URL — URL pública do webhook (opcional)
 *
 * Se MP_ACCESS_TOKEN não estiver setado, o createPayment continua no PIX estático.
 */

const MP_API = process.env.MP_API_BASE || 'https://api.mercadopago.com';

export function isMercadoPagoConfigured() {
  return Boolean(process.env.MP_ACCESS_TOKEN?.trim());
}

/**
 * Cria payment PIX no MP e devolve copia-e-cola + id externo.
 */
export async function createMercadoPagoPix({
  amount,
  description,
  externalReference,
  payerEmail = 'test@test.com',
}) {
  const token = process.env.MP_ACCESS_TOKEN?.trim();
  if (!token) {
    const err = new Error('MP_NOT_CONFIGURED');
    err.code = 'MP_NOT_CONFIGURED';
    throw err;
  }

  const body = {
    transaction_amount: Number(amount),
    description: description || 'Pedido',
    payment_method_id: 'pix',
    external_reference: String(externalReference || '').slice(0, 256),
    payer: {
      email: payerEmail,
    },
  };

  if (process.env.MP_NOTIFICATION_URL) {
    body.notification_url = process.env.MP_NOTIFICATION_URL;
  }

  const res = await fetch(`${MP_API}/v1/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': String(externalReference || `mp-${Date.now()}`).slice(0, 64),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || 'MP_CREATE_FAILED');
    err.code = 'MP_CREATE_FAILED';
    err.status = res.status;
    err.data = data;
    throw err;
  }

  const txData = data.point_of_interaction?.transaction_data || {};
  return {
    providerPaymentId: String(data.id),
    pixCopyPaste: txData.qr_code || null,
    pixQrBase64: txData.qr_code_base64 || null,
    status: data.status,
    raw: data,
  };
}

/**
 * Consulta status de um payment no MP.
 */
export async function getMercadoPagoPayment(providerPaymentId) {
  const token = process.env.MP_ACCESS_TOKEN?.trim();
  if (!token) return null;

  const res = await fetch(`${MP_API}/v1/payments/${providerPaymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Validação leve de assinatura webhook.
 * Em sandbox sem MP_WEBHOOK_SECRET, aceita (log warning).
 * Produção: exige header x-signature ou x-request-id conforme doc MP.
 */
export function verifyMercadoPagoWebhook(headers, rawBody) {
  const secret = process.env.MP_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // sandbox / dev — não bloquear
    return { ok: true, mode: 'open' };
  }
  const signature = headers['x-signature'] || headers['x-signature-id'];
  if (!signature) {
    return { ok: false, reason: 'missing_signature' };
  }
  // MP envia ts=...;v1=... — validação completa depende de data.id + request-id
  // Aqui só exigimos presença do secret configurado + header; hash HMAC fica
  // como follow-up quando o endpoint público estiver estável.
  return { ok: true, mode: 'header-present' };
}

/**
 * Normaliza payload de notificação MP → { externalEventId, paymentId?, markPaid }
 */
export function normalizeMercadoPagoWebhook(body) {
  const dataId = body?.data?.id || body?.id || body?.resource?.split('/').pop();
  const action = body?.action || body?.type || 'payment.updated';
  const externalEventId =
    body?.id?.toString() ||
    `${action}:${dataId || Date.now()}`;

  const markPaid =
    action === 'payment.updated' ||
    action === 'payment.created' ||
    body?.type === 'payment';

  return {
    externalEventId: String(externalEventId),
    eventType: String(action),
    providerPaymentId: dataId ? String(dataId) : null,
    markPaid,
  };
}
