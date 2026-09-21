/**
 * Adapter de provedor de pagamento (Epic #8).
 *
 * Regras:
 *  - Nunca recebe nem devolve PAN, CVV, track data ou token de cartão.
 *  - Cartão nasce PENDING com `provider` + `providerPaymentId`; confirmação
 *    vem de webhook autenticado ou de `POST /api/payments/:id/confirm` (staff).
 *  - Provider real (Mercado Pago, Stripe, etc.) pluga aqui sem mudar o modelo.
 *
 * Env:
 *  - CARD_PROVIDER — nome do provider gravado em payments.provider (default mock_card)
 *  - WEBHOOK_SECRET_<PROVIDER> — habilita webhook desse provider (fail-closed)
 */
import { randomUUID } from 'node:crypto';

/** Campos que nunca podem entrar no fluxo de criação de pagamento. */
export const FORBIDDEN_PAYMENT_KEYS = [
  'card',
  'cardNumber',
  'card_number',
  'number',
  'pan',
  'cvv',
  'cvc',
  'securityCode',
  'security_code',
  'expiry',
  'expMonth',
  'exp_month',
  'expYear',
  'exp_year',
  'track',
  'trackData',
  'token',
  'cardToken',
  'card_token',
  'paymentMethodId',
  'payment_method_id',
];

/**
 * Varre o body bruto (antes do zod) e falha se houver dado de cartão.
 * @returns {string|null} nome do campo proibido ou null
 */
export function findForbiddenCardField(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    const lower = key.toLowerCase();
    if (
      FORBIDDEN_PAYMENT_KEYS.some((f) => f.toLowerCase() === lower) ||
      /^(card|cvv|cvc|pan)/i.test(key)
    ) {
      return key;
    }
  }
  return null;
}

/**
 * Cria referência externa no provider (ou mock).
 * PIX estático continua em `resolveProviderContext` / pix-static.
 *
 * @param {{
 *   method: string,
 *   amount: number,
 *   storeId: string,
 *   idempotencyKey?: string|null,
 *   provider?: string|null,
 * }}
 * @returns {Promise<{
 *   provider: string,
 *   providerPaymentId: string,
 *   metadata: Record<string, unknown>,
 * } | null>}
 */
export async function createExternalPaymentIntent({
  method,
  amount,
  storeId,
  idempotencyKey = null,
  provider = null,
}) {
  if (method !== 'CARD') return null;

  const resolvedProvider =
    (provider && String(provider).trim()) ||
    process.env.CARD_PROVIDER ||
    'mock_card';

  // Mock / placeholder: não chama rede. Provider real substitui este bloco
  // (ou um switch por resolvedProvider) mantendo o mesmo contrato de saída.
  const providerPaymentId =
    idempotencyKey && String(idempotencyKey).trim()
      ? `card_${String(idempotencyKey).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`
      : `card_${randomUUID().replace(/-/g, '')}`;

  return {
    provider: resolvedProvider,
    providerPaymentId,
    metadata: {
      providerMode: 'external',
      amount: Number(amount),
      storeId,
      // checkoutUrl / clientSecret seriam preenchidos pelo provider real
      // e expostos só se forem seguros para o cliente (nunca PAN).
    },
  };
}
