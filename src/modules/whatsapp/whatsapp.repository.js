import { query } from '../../infrastructure/db.js';

export async function saveMessage(storeId, { externalId, fromNumber, body, parsedPayload, status = 'received' }) {
  const { rows } = await query(
    `INSERT INTO whatsapp_messages (store_id, external_id, from_number, body, parsed_payload, status)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)
     ON CONFLICT (store_id, external_id) DO UPDATE SET body = EXCLUDED.body RETURNING *`,
    [storeId, externalId, fromNumber, body, JSON.stringify(parsedPayload || {}), status]
  );
  return rows[0];
}

export async function listMessages(storeId, { limit = 20 } = {}) {
  const { rows } = await query(
    `SELECT * FROM whatsapp_messages WHERE store_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [storeId, Math.min(Number(limit) || 20, 100)]
  );
  return rows;
}

// Mock IA parser — quando sem OPENAI_API_KEY, usa keyword matching simples
export function parseOrderFromText(text, menuProducts = []) {
  const lower = String(text).toLowerCase();
  // Tenta encontrar produtos por nome no texto
  const found = [];
  for (const p of menuProducts) {
    if (lower.includes(p.name.toLowerCase().slice(0, 4))) {
      found.push({ productId: p.id, quantity: 1, notes: null });
    }
  }
  // Fallback: detecta "2x" ou "3 " etc.
  if (found.length === 0) {
    // Se mencionar "pizza", "hamburguer", etc., cria um item genérico mock
    if (lower.includes('pizza') || lower.includes('lanche') || lower.includes('hamburg')) {
      return { items: [{ productId: null, quantity: 1, notes: text.slice(0, 100) }], mock: true, raw: text };
    }
  }
  return { items: found, mock: found.length === 0, raw: text };
}
