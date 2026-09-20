/**
 * Endpoints operacionais — issue #106 [OPS].
 *
 *  - `GET /health`   liveness rasa: processo de pé (não consulta dependência).
 *  - `GET /ready`    readiness profunda: banco, migrations aplicadas, pool e
 *                    qualquer check registrado (fila, impressão, fiscal).
 *  - `GET /metrics`  métricas em formato Prometheus — acesso **restrito**:
 *                    `METRICS_TOKEN` (Bearer) ou super admin autenticado.
 *
 * Por que `/metrics` não é por loja: métricas agregam rótulos `store_id` de
 * TODAS as lojas. Expor isso a um usuário comum seria vazamento cross-tenant —
 * então o endpoint é da plataforma (token de infra) e nunca entra no painel do
 * lojista. Sem token configurado e sem super admin → 404 (não confirma que a
 * rota existe).
 */
import fp from 'fastify-plugin';
import { timingSafeEqual } from 'node:crypto';
import { renderMetrics, metricsSnapshot } from '../../infrastructure/metrics.js';
import { runReadinessChecks, listReadinessChecks } from '../../infrastructure/readiness.js';
import { registerBuiltinReadinessChecks } from './readiness-checks.js';
import { SERVICE_NAME, SERVICE_VERSION } from '../../infrastructure/logger.js';
import { AppError, errorResponse } from '../../shared/errors.js';

function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearerToken(request) {
  const header = request.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

async function opsRoutes(app) {
  const unregisterChecks = registerBuiltinReadinessChecks();
  app.addHook('onClose', async () => {
    unregisterChecks();
  });

  /** Liveness: barato, sem dependência — probe pode chamar a cada segundo. */
  app.get('/health', async () => ({
    status: 'ok',
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    ts: new Date().toISOString(),
  }));

  /**
   * Readiness: 200 quando as dependências críticas respondem; 503 caso
   * contrário (orquestrador não manda tráfego / não faz deploy).
   */
  app.get('/ready', async (request, reply) => {
    const result = await runReadinessChecks({ requestId: request.requestId });
    const isProd = process.env.NODE_ENV === 'production';

    const payload = {
      status: result.ok ? 'ready' : 'not_ready',
      db: result.checks.find((c) => c.name === 'database')?.ok ?? false,
      degraded: result.degraded,
      durationMs: result.durationMs,
      ts: new Date().toISOString(),
      // Em produção o detalhe interno não sai: só nomes e ok/não-ok.
      checks: result.checks.map((check) => ({
        name: check.name,
        critical: check.critical,
        ok: check.ok,
        durationMs: check.durationMs,
        ...(isProd || !check.ok ? {} : { detail: check.detail ?? null }),
      })),
    };

    if (!result.ok) {
      if (!isProd) payload.reason = result.checks.filter((c) => !c.ok).map((c) => c.name);
      return reply.code(503).send(payload);
    }
    return payload;
  });

  /** Diagnóstico: quais checks estão registrados (útil ao plugar fila/impressão). */
  app.get('/ready/checks', async () => ({ checks: listReadinessChecks() }));

  /** Métricas (Prometheus text 0.0.4 ou `?format=json`). */
  app.get(
    '/metrics',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (process.env.METRICS_ENABLED === '0') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } });
      }

      const configured = process.env.METRICS_TOKEN;
      const provided = bearerToken(request) || request.query?.token || null;

      if (configured) {
        if (!tokenMatches(String(provided || ''), configured)) {
          const err = new AppError(
            'METRICS_UNAUTHORIZED',
            'Token de métricas inválido.',
            401
          );
          const { statusCode, body } = errorResponse(err);
          request.log?.warn({ event: 'metrics.unauthorized' }, 'metrics access denied');
          return reply.code(statusCode).send(body);
        }
      } else if (!request.user?.isSuperAdmin) {
        // Sem token de infra: só super admin. Para qualquer outro, 404 — não
        // confirmamos a existência do endpoint.
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } });
      }

      if (String(request.query?.format || '').toLowerCase() === 'json') {
        return { service: SERVICE_NAME, version: SERVICE_VERSION, metrics: await metricsSnapshot() };
      }

      const body = await renderMetrics();
      return reply
        .header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
        .header('cache-control', 'no-store')
        .send(body);
    }
  );
}

export default fp(opsRoutes, {
  name: 'ops-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin', 'request-context'],
});
