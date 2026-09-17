/**
 * Logger estruturado (JSON lines) sem dependência externa.
 * Nível via LOG_LEVEL=debug|info|warn|error (default info em prod, debug em dev).
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel() {
  const name = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')).toLowerCase();
  return LEVELS[name] ?? LEVELS.info;
}

function write(level, msg, fields = {}) {
  if ((LEVELS[level] ?? 99) < currentLevel()) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

export const log = {
  debug: (msg, fields) => write('debug', msg, fields),
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
  child(baseFields) {
    return {
      debug: (msg, f) => write('debug', msg, { ...baseFields, ...f }),
      info: (msg, f) => write('info', msg, { ...baseFields, ...f }),
      warn: (msg, f) => write('warn', msg, { ...baseFields, ...f }),
      error: (msg, f) => write('error', msg, { ...baseFields, ...f }),
    };
  },
};

export default log;
