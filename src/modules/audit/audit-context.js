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
import {
  SENSITIVE_KEY_RE,
  redactSecrets,
} from '../../shared/redact.js';

/**
 * Remove campos sensíveis e trunca strings antes de gravar.
 * A regra vive em `shared/redact.js` — é a MESMA usada pelos logs estruturados
 * (issue #106), então auditoria e log não divergem sobre o que é segredo.
 * Exportado para teste de regressão (nada de segredo em audit_logs).
 */
export function sanitizeAuditMetadata(value, depth = 0) {
  return redactSecrets(value, depth);
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
