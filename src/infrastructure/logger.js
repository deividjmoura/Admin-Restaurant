/**
 * Logs estruturados (JSON) — issue #106 [OPS].
 *
 * Contrato:
 *  - toda linha de log é um JSON único com `time`, `level`, `service`, `env`;
 *  - contexto de requisição (`requestId`, `storeId`, `userId`, `role`, `route`)
 *    entra via child logger (ver `request-context.js`), nunca concatenado na
 *    mensagem;
 *  - segredo NUNCA sai: `redact` por caminho conhecido + `formatters.log`
 *    aplicando `redactSecrets()` (mesma regra da auditoria);
 *  - nada de stack trace para o cliente: o stack fica só no log do servidor.
 *
 * Uso fora de requisição (workers, scripts, db): `getAppLogger()`.
 */
import os from 'node:os';
import pino from 'pino';
import { redactSecrets } from '../shared/redact.js';

export const SERVICE_NAME = 'admin-restaurant';
export const SERVICE_VERSION = '0.1.0';

export const REDACTED = '[redacted]';

/**
 * Caminhos conhecidos de segredo. `redact` é barato (fast-redact) e cobre o
 * que o Fastify serializa automaticamente; `formatters.log` cobre o resto.
 */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-signature"]',
  'res.headers["set-cookie"]',
  'password',
  'body.password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'cookie',
  'authorization',
  'jwt',
  'pixCopyPaste',
  'email',
  '*.password',
  '*.token',
  '*.secret',
];

export function logLevel() {
  return (
    process.env.LOG_LEVEL ||
    (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
  );
}

/**
 * Opções de logger — usadas pelo Fastify (`buildApp`) e pelo logger avulso.
 *
 * @param {{ level?: string, stream?: unknown }} [opts]
 */
export function buildLoggerOptions(opts = {}) {
  return {
    level: opts.level || logLevel(),
    // `base` substitui o default do pino (pid/hostname), então entram aqui —
    // sem isso a linha de log perde a identificação de instância.
    base: {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      env: process.env.NODE_ENV || 'development',
      pid: process.pid,
      host: os.hostname(),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    formatters: {
      // `level: "info"` em vez de `level: 30` — legível em qualquer agregador.
      level: (label) => ({ level: label }),
      // Última barreira: chave sensível nunca é serializada.
      log: (object) => redactSecrets(object),
    },
    serializers: {
      err: pino.stdSerializers.err,
      // Nunca logar headers/cookies do request: só o que identifica a chamada.
      req: (req) => ({
        method: req.method,
        url: req.url,
        requestId: req.id,
        remoteAddress: req.ip,
      }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    ...(opts.stream ? {} : {}),
  };
}

let appLogger = null;

/**
 * Logger para contextos sem requisição (db, workers, scripts, filas).
 * Singleton: um único destino de log por processo.
 *
 * @param {{ level?: string, stream?: unknown }} [opts]
 */
export function getAppLogger(opts = {}) {
  if (!appLogger) {
    appLogger = opts.stream
      ? pino(buildLoggerOptions(opts), opts.stream)
      : pino(buildLoggerOptions(opts));
  }
  return appLogger;
}

/** Só para testes: descarta o singleton (permite capturar a saída). */
export function resetAppLogger() {
  appLogger = null;
}

/**
 * Cria um logger capturando a saída em memória — usado pelos testes para
 * afirmar que o JSON contém o contexto esperado (e que segredo não vaza).
 *
 * @returns {{ logger: object, lines: () => object[] }}
 */
export function createMemoryLogger(level = 'debug') {
  const buffer = [];
  const stream = {
    write(chunk) {
      buffer.push(String(chunk));
    },
  };
  const logger = pino(buildLoggerOptions({ level, stream }), stream);
  return {
    logger,
    raw: () => buffer.join(''),
    lines: () =>
      buffer
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { unparsed: line };
          }
        }),
    options: buildLoggerOptions({ level, stream }),
  };
}
