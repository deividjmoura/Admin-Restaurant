/**
 * Helper único de auditoria de operações sensíveis.
 *
 * Contrato:
 *  - best effort: NUNCA derruba a operação principal (falha → request.log.warn);
 *  - nunca grava segredo (senha, token, chave PIX completa, cartão, payload
 *    bruto de webhook, cookies, secrets);
 *  - sempre com contexto: tenant (storeId), ator, ip, user-agent.
 */
import { audit as writeAuditBestEffort } from './audit.repository.js';

/** Chaves nunca persistidas em metadata de auditoria. */
const SENSITIVE_KEY_RE =
  /(pass(word)?|senha|token|secret|segredo|authorization|auth|card|cartao|cartão|cvv|cvc|pan|iban|pix|chave|payload|cookie|signature|assinatura|hash)/i;

/** Profundidade máxima para não gravar estruturas gigantes. */
const MAX_DEPTH = 5;
const MAX_STRING = 500;

/**
 * Remove campos sensíveis e trunca strings antes de gravar.
 * Exportado para teste de regressão (nada de segredo em audit_logs).
 */
export function sanitizeAuditMetadata(value, depth = 0) {
  if (depth > MAX_DEPTH) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeAuditMetadata(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_RE.test(key)
        ? '[redacted]'
        : sanitizeAuditMetadata(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Auditoria com contexto da requisição.
 *
 * @param {import('fastify').FastifyRequest | null} request
 * @param {{
 *   storeId?: string|null,
 *   actorUserId?: string|null,
 *   action: string,
 *   resource?: string|null,
 *   resourceId?: string|number|null,
 *   metadata?: object,
 *   logger?: { warn: Function }|null,
 * }} event
 */
export function auditRequest(request, event) {
  if (!event?.action) return Promise.resolve(null);

  const log = event.logger || request?.log || null;

  return writeAuditBestEffort(
    {
      storeId: event.storeId ?? request?.storeId ?? null,
      actorUserId: event.actorUserId ?? request?.user?.id ?? null,
      action: event.action,
      resource: event.resource ?? null,
      resourceId: event.resourceId ?? null,
      metadata: sanitizeAuditMetadata(event.metadata ?? {}),
      ip: request?.ip ?? null,
      userAgent: request?.headers?.['user-agent'] ?? null,
    },
    { log }
  );
}

/**
 * Registra a falha de auditoria sem derrubar nada — o helper já faz isso, mas
 * aqui deixamos explícito para call sites que não têm request (jobs, scripts).
 */
export function auditSafe(event, { log = console } = {}) {
  return writeAuditBestEffort(
    {
      ...event,
      metadata: sanitizeAuditMetadata(event?.metadata ?? {}),
    },
    { log }
  );
}

export { SENSITIVE_KEY_RE };
