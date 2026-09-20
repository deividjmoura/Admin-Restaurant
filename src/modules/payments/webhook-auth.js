/**
 * Autenticação de webhooks de pagamento.
 *
 * Regras invioláveis:
 *  - o webhook é público, então NADA que vem no body é confiável
 *    (nem storeId, nem paymentId, nem markPaid);
 *  - a assinatura HMAC é verificada contra o CORPO BRUTO (bytes exatos),
 *    antes de qualquer escrita no banco;
 *  - providers sem segredo configurado ficam desabilitados (fail closed).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Nomes de header aceitos, em ordem de preferência. */
export const SIGNATURE_HEADERS = [
  'x-signature',
  'x-hub-signature-256',
  'x-webhook-signature',
];

/**
 * Chave de env do provider: `WEBHOOK_SECRET_<PROVIDER>`.
 * `mercado-pago` → WEBHOOK_SECRET_MERCADO_PAGO.
 */
export function providerEnvKey(provider) {
  return String(provider || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_');
}

/**
 * @returns {string|null} segredo do provider ou null quando não habilitado.
 */
export function webhookSecret(provider) {
  const key = providerEnvKey(provider);
  if (!key) return null;
  const secret = process.env[`WEBHOOK_SECRET_${key}`];
  return secret && String(secret).length > 0 ? String(secret) : null;
}

/** Extrai a assinatura do header, aceitando `sha256=<hex>` ou `<hex>`. */
export function readSignatureHeader(headers = {}) {
  for (const name of SIGNATURE_HEADERS) {
    const value = headers[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Compara a assinatura recebida com o HMAC-SHA256 do corpo bruto.
 * Comparação em tempo constante; qualquer entrada inválida → false.
 *
 * @param {Buffer|string|null} rawBody
 * @param {string|null} header
 * @param {string|null} secret
 */
export function verifyHmac(rawBody, header, secret) {
  if (!rawBody || !header || !secret) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');

  const expected = createHmac('sha256', secret).update(body).digest();

  const raw = String(header).trim().replace(/^sha256=/i, '');
  // hex inválido / tamanho ímpar → Buffer.from trunca silenciosamente, então
  // validamos o formato antes de comparar.
  if (!/^[0-9a-f]+$/i.test(raw) || raw.length !== expected.length * 2) return false;

  const given = Buffer.from(raw, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Assina um corpo (usado nos testes e em providers de saída). */
export function signHmac(rawBody, secret, { prefix = 'sha256=' } = {}) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  return `${prefix}${createHmac('sha256', secret).update(body).digest('hex')}`;
}

const PAID_EVENT_TYPES = new Set([
  'payment.paid',
  'payment.succeeded',
  'payment.approved',
  'payment.completed',
  'payment.updated',
]);

/**
 * Normaliza o evento de um provider para o vocabulário interno.
 * Nunca devolve `storeId`/`paymentId` como dados confiáveis: apenas
 * `storeIdFromBody` (diagnóstico) e a referência externa do pagamento.
 *
 * @returns {{
 *   externalEventId: string|null,
 *   eventType: string,
 *   providerPaymentId: string|null,
 *   amount: number|null,
 *   storeIdFromBody: string|null,
 * }}
 */
export function normalizeProviderEvent(provider, body = {}) {
  const data =
    body?.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? body.data
      : {};

  const externalEventId =
    body.externalEventId ?? body.eventId ?? body.event_id ?? body.id ?? data.id ?? null;

  const rawType = String(
    body.eventType ?? body.event_type ?? body.type ?? data.type ?? 'unknown'
  ).toLowerCase();

  // `markPaid` do body é aceito APENAS como dica de roteamento de um payload
  // já autenticado por HMAC; o efeito continua sendo "marcar como pago".
  const eventType =
    body.markPaid === true && rawType === 'unknown' ? 'payment.paid' : rawType;

  const providerPaymentId =
    body.providerPaymentId ??
    body.provider_payment_id ??
    body.paymentReference ??
    body.payment_reference ??
    data.providerPaymentId ??
    data.paymentId ??
    data.id ??
    null;

  const rawAmount =
    body.amount ?? body.transaction_amount ?? body.total ?? data.amount ?? null;

  const parsedAmount =
    rawAmount === null || rawAmount === '' ? null : Number(rawAmount);

  return {
    externalEventId: externalEventId != null ? String(externalEventId) : null,
    eventType,
    providerPaymentId: providerPaymentId != null ? String(providerPaymentId) : null,
    amount: Number.isFinite(parsedAmount) ? parsedAmount : null,
    storeIdFromBody: body.storeId != null ? String(body.storeId) : null,
  };
}

/** true quando o evento autenticado deve confirmar o pagamento. */
export function isPaidEvent(eventType) {
  return PAID_EVENT_TYPES.has(String(eventType || '').toLowerCase());
}

/**
 * Redige campos sensíveis antes de persistir o payload do evento.
 * Nunca gravamos dados de cartão, tokens ou segredos de webhook.
 */
const SENSITIVE_KEY_RE = /(card|cvv|cvc|pan|token|secret|authorization|password|signature|iban)/i;

export function redactWebhookPayload(value, depth = 0) {
  if (depth > 6) return '[deep]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactWebhookPayload(v, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_RE.test(key)
      ? '[redacted]'
      : redactWebhookPayload(val, depth + 1);
  }
  return out;
}

export { PAID_EVENT_TYPES };
