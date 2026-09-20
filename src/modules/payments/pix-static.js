/**
 * PIX estático (EMV / BR Code) — sem provedor externo.
 * Não armazena nem processa dados de cartão.
 *
 * Chave: CPF, CNPJ, e-mail, telefone (+55...) ou chave aleatória.
 */

function tlv(id, value) {
  const v = String(value);
  const len = String(v.length).padStart(2, '0');
  return `${id}${len}${v}`;
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Normaliza chave PIX (remove máscara de CPF/CNPJ).
 */
export function normalizePixKey(key) {
  if (!key || typeof key !== 'string') return '';
  const k = key.trim();
  if (k.includes('@')) return k.toLowerCase();
  if (k.startsWith('+')) return k.replace(/\s/g, '');
  // só dígitos se parecer documento
  const digits = k.replace(/\D/g, '');
  if (digits.length === 11 || digits.length === 14) return digits;
  return k;
}

/**
 * Normaliza texto do merchant (nome/cidade) conforme o BR Code:
 * remove acentos, corta em `max` e converte para MAIÚSCULAS.
 * O padrão EMV não aceita caracteres acentuados e tem limite de tamanho.
 */
export function normalizeMerchantText(value, { max, fallback = '' } = {}) {
  const clean = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .toUpperCase();
  const sliced = max ? clean.slice(0, max) : clean;
  return sliced || fallback;
}

/**
 * Monta payload EMV copia-e-cola.
 * @param {{ key: string, name: string, city: string, amount?: number, txid?: string }} opts
 */
export function buildStaticPixPayload({
  key,
  name = 'LANCHONETE',
  city = 'SAO PAULO',
  amount,
  txid = '***',
}) {
  const pixKey = normalizePixKey(key);
  if (!pixKey) {
    throw new Error('PIX_KEY_REQUIRED');
  }

  const merchantName = normalizeMerchantText(name, {
    max: 25,
    fallback: 'LANCHONETE',
  });
  const merchantCity = normalizeMerchantText(city, {
    max: 15,
    fallback: 'SAO PAULO',
  });

  const gui = tlv('00', 'br.gov.bcb.pix') + tlv('01', pixKey);
  const merchantAccount = tlv('26', gui);

  let payload =
    tlv('00', '01') + // Payload Format Indicator
    tlv('01', amount != null ? '12' : '11') + // 12 = dynamic amount field present
    merchantAccount +
    tlv('52', '0000') +
    tlv('53', '986') + // BRL
    (amount != null
      ? tlv('54', Number(amount).toFixed(2))
      : '') +
    tlv('58', 'BR') +
    tlv('59', merchantName) +
    tlv('60', merchantCity) +
    tlv('62', tlv('05', String(txid).slice(0, 25))) +
    '6304';

  payload += crc16(payload);
  return payload;
}

/**
 * Config PIX da loja.
 *
 * Em produção a chave da PLATAFORMA não é usada por padrão: uma loja sem PIX
 * próprio receberia dinheiro na conta da plataforma. Só libere com
 * PIX_ALLOW_PLATFORM_KEY=true (ex.: loja da própria plataforma / sandbox).
 */
export function resolvePixConfig(storeSettings = {}, env = process.env) {
  const fromStore = storeSettings?.pix || {};
  const isProd = env.NODE_ENV === 'production';
  const allowPlatformKey = !isProd || env.PIX_ALLOW_PLATFORM_KEY === 'true';

  const key = fromStore.key || (allowPlatformKey ? env.PIX_CHAVE : '') || '';
  const name = fromStore.name || (allowPlatformKey ? env.PIX_NOME : '') || 'LANCHONETE';
  const city = fromStore.city || (allowPlatformKey ? env.PIX_CIDADE : '') || 'SAO PAULO';
  const normalized = normalizePixKey(key);

  return {
    key: normalized,
    name: normalizeMerchantText(name, { max: 25, fallback: 'LANCHONETE' }),
    city: normalizeMerchantText(city, { max: 15, fallback: 'SAO PAULO' }),
    configured: Boolean(normalized),
    source: fromStore.key ? 'store' : normalized ? 'platform' : 'none',
  };
}
