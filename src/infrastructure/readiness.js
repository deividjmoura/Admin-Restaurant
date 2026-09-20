/**
 * Readiness checks — issue #106 [OPS].
 *
 * `/ready` responde 200 só quando TODAS as dependências críticas estão OK.
 * Checks são registráveis: a fila de jobs, a impressão e o provider fiscal
 * (issues #52/#138/#128) entram aqui sem tocar no endpoint.
 *
 * Regras:
 *  - check crítico falhou → `/ready` 503 (orquestrador tira a instância de rotação);
 *  - check não crítico (`critical: false`) só aparece no relatório (degradado);
 *  - nenhum check pode travar: timeout individual + erro vira `ok: false`;
 *  - detalhe de erro nunca vaza em produção (só `ok:false` + nome do check).
 */

const DEFAULT_TIMEOUT_MS = Number(process.env.READINESS_TIMEOUT_MS) || 3000;

/** @type {Map<string, { fn: Function, critical: boolean, timeoutMs: number }>} */
const checks = new Map();

/**
 * @param {string} name
 * @param {(ctx?: object) => Promise<{ ok: boolean, detail?: any } | boolean | void>} fn
 * @param {{ critical?: boolean, timeoutMs?: number }} [opts]
 * @returns {() => void} unregister
 */
export function registerReadinessCheck(name, fn, opts = {}) {
  if (!name || typeof fn !== 'function') return () => {};
  checks.set(name, {
    fn,
    critical: opts.critical !== false,
    timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
  });
  return () => {
    if (checks.get(name)?.fn === fn) checks.delete(name);
  };
}

export function unregisterReadinessCheck(name) {
  checks.delete(name);
}

export function listReadinessChecks() {
  return [...checks.entries()].map(([name, def]) => ({
    name,
    critical: def.critical,
  }));
}

function withTimeout(promise, ms, name) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, detail: 'timeout', timedOut: true, name });
    }, ms);
    Promise.resolve(promise)
      .then((result) => {
        clearTimeout(timer);
        if (result === undefined || result === null) resolve({ ok: true });
        else if (typeof result === 'boolean') resolve({ ok: result });
        else resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        resolve({ ok: false, detail: err?.message || 'error' });
      });
  });
}

/**
 * Executa todos os checks em paralelo.
 * @returns {Promise<{ ok: boolean, degraded: boolean, checks: Array<object>, durationMs: number }>}
 */
export async function runReadinessChecks(context = {}) {
  const startedAt = Date.now();
  const entries = [...checks.entries()];

  const results = await Promise.all(
    entries.map(async ([name, def]) => {
      const started = Date.now();
      const outcome = await withTimeout(def.fn(context), def.timeoutMs, name);
      return {
        name,
        critical: def.critical,
        ok: Boolean(outcome?.ok),
        durationMs: Date.now() - started,
        detail: outcome?.detail ?? null,
        timedOut: Boolean(outcome?.timedOut),
      };
    })
  );

  const criticalFailed = results.some((r) => r.critical && !r.ok);
  const degraded = results.some((r) => !r.critical && !r.ok);

  return {
    ok: !criticalFailed,
    degraded,
    durationMs: Date.now() - startedAt,
    checks: results,
  };
}
