import { query, withTransaction } from '../../infrastructure/db.js';

export class WalletError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function mapWallet(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    userId: row.user_id,
    balance: Number(row.balance),
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTx(row) {
  return {
    id: row.id,
    walletId: row.wallet_id,
    storeId: row.store_id,
    type: row.type,
    amount: Number(row.amount),
    description: row.description,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

export async function getOrCreateWallet(storeId, userId) {
  const { rows } = await query(
    `INSERT INTO wallets (store_id, user_id, balance)
     VALUES ($1,$2,0)
     ON CONFLICT (store_id, user_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [storeId, userId]
  );
  return mapWallet(rows[0]);
}

export async function getWallet(storeId, userId) {
  const { rows } = await query(
    `SELECT * FROM wallets WHERE store_id = $1 AND user_id = $2`,
    [storeId, userId]
  );
  return rows[0] ? mapWallet(rows[0]) : null;
}

export async function listWallets(storeId) {
  const { rows } = await query(
    `SELECT w.*, u.email FROM wallets w JOIN users u ON u.id = w.user_id WHERE w.store_id = $1 ORDER BY w.updated_at DESC`,
    [storeId]
  );
  return rows.map((r) => ({ ...mapWallet(r), email: r.email }));
}

export async function transact(storeId, { userId, type, amount, description, idempotencyKey }) {
  if (!['credit', 'debit'].includes(type)) throw new WalletError('INVALID_TYPE', 'Tipo deve ser credit ou debit');
  if (!amount || Number(amount) <= 0) throw new WalletError('INVALID_AMOUNT', 'Valor inválido');

  // Idempotência por store_id + idempotency_key
  if (idempotencyKey) {
    const { rows } = await query(
      `SELECT * FROM wallet_transactions WHERE store_id = $1 AND idempotency_key = $2`,
      [storeId, idempotencyKey]
    );
    if (rows[0]) {
      const wallet = await getWallet(storeId, userId);
      return { wallet, transaction: mapTx(rows[0]), replayed: true };
    }
  }

  return withTransaction(async (client) => {
    // lock wallet
    const { rows: wRows } = await client.query(
      `SELECT * FROM wallets WHERE store_id = $1 AND user_id = $2 FOR UPDATE`,
      [storeId, userId]
    );
    let wallet = wRows[0] ? mapWallet(wRows[0]) : null;
    if (!wallet) {
      const { rows: ins } = await client.query(
        `INSERT INTO wallets (store_id, user_id, balance) VALUES ($1,$2,0) RETURNING *`,
        [storeId, userId]
      );
      wallet = mapWallet(ins[0]);
    }

    const newBalance = type === 'credit' ? Number(wallet.balance) + Number(amount) : Number(wallet.balance) - Number(amount);
    if (newBalance < 0) throw new WalletError('INSUFFICIENT_FUNDS', 'Saldo insuficiente.');

    const { rows: upd } = await client.query(
      `UPDATE wallets SET balance = $3, updated_at = now() WHERE id = $1 AND store_id = $2 RETURNING *`,
      [wallet.id, storeId, newBalance]
    );
    wallet = mapWallet(upd[0]);

    try {
      const { rows: txRows } = await client.query(
        `INSERT INTO wallet_transactions (wallet_id, store_id, type, amount, description, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [wallet.id, storeId, type, Number(amount), description || null, idempotencyKey || null]
      );
      return { wallet, transaction: mapTx(txRows[0]), replayed: false };
    } catch (err) {
      if (err.code === '23505' && idempotencyKey) {
        const { rows } = await client.query(
          `SELECT * FROM wallet_transactions WHERE store_id = $1 AND idempotency_key = $2`,
          [storeId, idempotencyKey]
        );
        return { wallet, transaction: mapTx(rows[0]), replayed: true };
      }
      throw err;
    }
  });
}

export async function listTransactions(storeId, { walletId, limit = 50 } = {}) {
  const params = [storeId];
  let where = 'store_id = $1';
  if (walletId) {
    params.push(walletId);
    where += ` AND wallet_id = $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 50, 100));
  const { rows } = await query(
    `SELECT * FROM wallet_transactions WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows.map(mapTx);
}
