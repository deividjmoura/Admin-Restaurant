/**
 * Contexto de requisição + access log estruturado — issue #106 [OPS].
 *
 * O que este plugin garante:
 *  1. toda resposta carrega `x-request-id` (recebido do proxy se válido, senão
 *     gerado) — é a chave que liga log, métrica, auditoria e o relato do
 *     suporte;
 *  2. o logger da requisição vira um *child* com `requestId` e, assim que o
 *     tenant/usuário são resolvidos, `storeId`/`userId`/`role` (ver
 *     `bindRequestLog`, chamado por tenant-plugin e auth-plugin);
 *  3. `onResponse` emite UMA linha de access log (JSON) e observa as métricas
 *     HTTP — a rota usa o *pattern* (`/api/orders/:id`), nunca a URL crua,
 *     para não explodir cardinalidade nem gravar token de QR em log.
 *
 * Segredo não passa por aqui: a redação acontece no formatter do logger.
 */
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import { observeHttpRequest } from './metrics.js';

/**
 * Id de correlação aceito do proxy: sem espaço/aspas/quebra de linha (log
 * injection) e com tamanho limitado. Qualquer outra coisa é descartada e um
 * UUID é gerado — cabeçalho de entrada nunca é confiável.
 */
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Normaliza o `x-request-id` recebido (ou devolve null).
 * Usado também pelo `genReqId` do Fastify: assim `request.id` JÁ nasce válido e
 * o log sai com um único campo `requestId`.
 *
 * @param {unknown} header
 * @returns {string|null}
 */
export function sanitizeRequestId(header) {
  // Header repetido chega como string com vírgula ("a, b") — o regex reprova.
  // Array é rejeitado de propósito: não existe caso legítimo e a ambiguidade
  // permitiria escolher qual dos valores entra no log.
  if (Array.isArray(header) || typeof header !== 'string') return null;
  const value = header.trim();
  return REQUEST_ID_RE.test(value) ? value : null;
}

/** Rotas de probe não geram access log (métricas continuam contando). */
const DEFAULT_QUIET = ['/health', '/ready', '/metrics'];

function quietRoutes() {
  const raw = process.env.LOG_ACCESS_EXCLUDE;
  if (!raw) return new Set(DEFAULT_QUIET);
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

/**
 * Anexa bindings ao logger da requisição (idempotente e à prova de logger noop).
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {Record<string, unknown>} bindings
 */
export function bindRequestLog(request, bindings) {
  if (!request || typeof request.log?.child !== 'function') return;
  const clean = {};
  for (const [key, value] of Object.entries(bindings || {})) {
    if (value === undefined || value === null || value === '') continue;
    clean[key] = value;
  }
  if (Object.keys(clean).length === 0) return;
  request.log = request.log.child(clean);
}

async function requestContext(app) {
  app.decorateRequest('requestId', null);
  app.decorateRequest('startedAt', 0);
  /** Rotas de stream (SSE) marcam aqui: latência longa não entra no histograma. */
  app.decorateRequest('isStream', false);

  app.addHook('onRequest', async (request, reply) => {
    request.startedAt = process.hrtime.bigint();

    // `request.id` vem do `genReqId` do app (x-request-id validado ou UUID); o
    // rótulo no log é `requestId` (ver resolveRequestLoggingOption em app.js).
    const requestId = request.id || randomUUID();
    request.requestId = requestId;
    reply.header('x-request-id', requestId);

    bindRequestLog(request, { path: request.url?.split('?')[0] });
  });

  app.addHook('onResponse', async (request, reply) => {
    const durationNs = request.startedAt
      ? Number(process.hrtime.bigint() - request.startedAt)
      : 0;
    const durationMs = durationNs / 1e6;
    const route =
      request.routeOptions?.url || request.url?.split('?')[0] || 'unmatched';
    const status = reply.statusCode || 0;

    observeHttpRequest({
      route,
      method: request.method,
      status,
      durationMs,
      storeId: request.storeId || null,
    });

    if (process.env.LOG_ACCESS === '0') return;
    const quiet = quietRoutes();
    if (quiet.has(route)) return;

    // Uma linha por requisição, com o contexto completo (nunca concatenado na
    // mensagem): requestId/storeId/userId já vêm do child logger.
    request.log?.info(
      {
        event: 'http.request',
        route,
        method: request.method,
        status,
        statusClass: `${Math.floor(status / 100)}xx`,
        durationMs: Number(durationMs.toFixed(3)),
        storeId: request.storeId || null,
        userId: request.user?.id || null,
        role: request.storeRole || null,
        stream: request.isStream === true,
        contentLength: reply.getHeader?.('content-length') ?? null,
        ip: request.ip,
      },
      'request completed'
    );
  });
}

export default fp(requestContext, {
  name: 'request-context',
  fastify: '5.x',
});

export { REQUEST_ID_RE };
