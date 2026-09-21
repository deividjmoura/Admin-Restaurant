/**
 * Dinheiro — regra de ouro: `numeric`/centavos, NUNCA float solto.
 *
 * Estes helpers viviam em `modules/payments/payments.repository.js`; com o caixa
 * (issues #107–#110) vários módulos precisam da MESMA aritmética, então moram em
 * `shared/`. `payments.repository` continua reexportando (compatibilidade).
 */

/** Tolerância de comparação de valores (meio centavo). */
export const AMOUNT_TOLERANCE = 0.005;

/** Arredonda para centavos (evita 0.1+0.2 = 0.30000000000000004). */
export function toCents(value) {
  return Math.round(Number(value) * 100);
}

export function round2(value) {
  return toCents(value) / 100;
}

/** true quando o valor tem no máximo duas casas decimais. */
export function hasCentPrecision(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return Math.abs(toCents(n) - n * 100) < 1e-6;
}

/** true quando o valor é dinheiro válido (> 0 e com precisão de centavo). */
export function isValidMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && hasCentPrecision(n);
}

/** true quando o valor é >= 0 com precisão de centavo (fundo de troco, contagem). */
export function isValidNonNegativeMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && hasCentPrecision(n);
}

/** Soma em centavos e devolve em reais (nunca somar float direto). */
export function sumMoney(values = []) {
  const cents = values.reduce((acc, value) => acc + toCents(value), 0);
  return cents / 100;
}

/** Diferença em centavos (a - b) devolvida em reais. */
export function diffMoney(a, b) {
  return (toCents(a) - toCents(b)) / 100;
}

/** Compara dois valores dentro da tolerância de meio centavo. */
export function sameMoney(a, b, tolerance = AMOUNT_TOLERANCE) {
  return Math.abs(toCents(a) - toCents(b)) / 100 <= tolerance;
}

/** Formatação BRL para relatório (sem Intl: saída estável em qualquer locale). */
export function formatBRL(value) {
  const n = Number(value) || 0;
  return `R$ ${n.toFixed(2).replace('.', ',')}`;
}
