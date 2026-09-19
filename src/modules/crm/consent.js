import { query } from '../../infrastructure/db.js';

/**
 * Gate único de contato. Features futuras (#136 promoções, #137 loyalty)
 * DEVEM chamar isto — nunca assumir consentimento.
 */
export async function canContact(storeId, customerId, purpose) {
  const { rows } = await query(
    `SELECT cc.granted
     FROM customer_consents cc
     INNER JOIN customers c ON c.id = cc.customer_id
     WHERE cc.customer_id = $1
       AND c.store_id = $2
       AND cc.store_id = $2
       AND cc.purpose = $3
       AND cc.revoked_at IS NULL
     ORDER BY cc.granted_at DESC
     LIMIT 1`,
    [customerId, storeId, purpose]
  );
  return rows[0]?.granted === true;
}

export async function grantConsent(storeId, customerId, purpose, granted = true) {
  const { rows: own } = await query(
    `SELECT id FROM customers WHERE id = $1 AND store_id = $2`,
    [customerId, storeId]
  );
  if (!own[0]) return null;

  const { rows } = await query(
    `INSERT INTO customer_consents (customer_id, store_id, purpose, granted)
     VALUES ($1, $2, $3, $4)
     RETURNING id, customer_id, store_id, purpose, granted, granted_at, revoked_at`,
    [customerId, storeId, purpose, granted]
  );
  return rows[0];
}

export async function revokeConsent(storeId, customerId, purpose) {
  const { rows } = await query(
    `UPDATE customer_consents
     SET revoked_at = now()
     WHERE customer_id = $1
       AND store_id = $2
       AND purpose = $3
       AND revoked_at IS NULL
     RETURNING id`,
    [customerId, storeId, purpose]
  );
  return rows.length;
}
