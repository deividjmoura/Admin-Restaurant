/**
 * Redação de dados sensíveis — fonte única para auditoria E logs.
 *
 * Antes existia só em `modules/audit/audit-context.js`; com logs estruturados
 * (issue #106) o mesmo critério precisa valer para qualquer objeto que sai do
 * processo (log, métrica, auditoria). Por isso mora em `shared/`.
 *
 * Regra: nunca confiar no call site para "lembrar" de esconder segredo — a
 * redação é aplicada no ponto de saída (formatter do logger / auditoria).
 */

/** Chaves nunca persistidas em metadata de auditoria nem escritas em log. */
export const SENSITIVE_KEY_RE =
  /(pass(word)?|senha|token|secret|segredo|authorization|auth|card|cartao|cartão|cvv|cvc|pan|iban|pix|chave|payload|cookie|signature|assinatura|hash)/i;

/** Profundidade máxima para não serializar estruturas gigantes. */
export const MAX_DEPTH = 5;
export const MAX_STRING = 500;

export const REDACTED = '[redacted]';

/**
 * Remove campos sensíveis e trunca strings.
 *
 * @param {*} value
 * @param {number} [depth]
 * @returns {*} cópia segura para log/persistência
 */
export function redactSecrets(value, depth = 0) {
  if (depth > MAX_DEPTH) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, depth + 1));
  }
  if (typeof value === 'object') {
    // Objetos que não são JSON simples (Error, Date, Buffer, instâncias) são
    // convertidos para string — nunca serializamos circularmente.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value instanceof Error
        ? { name: value.name, message: value.message, code: value.code }
        : String(value);
    }
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_RE.test(key)
        ? REDACTED
        : redactSecrets(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Redação rasa (1 nível) para uso em hot path de log: só as chaves do próprio
 * objeto, sem percorrer estruturas aninhadas.
 *
 * @param {object} obj
 * @returns {object}
 */
export function redactTopLevel(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : val;
  }
  return out;
}
