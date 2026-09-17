import { query, withTransaction } from '../../infrastructure/db.js';

export class CouponError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function mapCoupon(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    code: row.code,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    minOrderAmount: Number(row.min_order_amount),
    maxUses: row.max_uses,
    usesCount: row.uses_count,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCoupons(storeId, { activeOnly = false } = {}) {
  const { rows } = await query(
    `SELECT * FROM coupons WHERE store_id = $1 ${activeOnly ? 'AND is_active = TRUE' : ''} ORDER BY created_at DESC`,
    [storeId]
  );
  return rows.map(mapCoupon);
}

export async function findCouponByCode(storeId, code) {
  const { rows } = await query(
    `SELECT * FROM coupons WHERE store_id = $1 AND lower(code) = lower($2) LIMIT 1`,
    [storeId, code]
  );
  return rows[0] ? mapCoupon(rows[0]) : null;
}

export async function findCouponById(storeId, id) {
  const { rows } = await query(
    `SELECT * FROM coupons WHERE id = $1 AND store_id = $2`,
    [id, storeId]
  );
  return rows[0] ? mapCoupon(rows[0]) : null;
}

export async function createCoupon(storeId, data) {
  const code = String(data.code).trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) {
    throw new CouponError('INVALID_CODE', 'Código deve ter 3-20 caracteres alfanuméricos maiúsculos, _ ou -.');
  }
  if (data.discountType === 'percentage' && (data.discountValue <= 0 || data.discountValue > 100)) {
    throw new CouponError('INVALID_DISCOUNT', 'Desconto percentual deve ser entre 0 e 100.');
  }
  if (data.validFrom && data.validUntil && new Date(data.validUntil) <= new Date(data.validFrom)) {
    throw new CouponError('INVALID_DATES', 'validUntil deve ser após validFrom.');
  }

  try {
    const { rows } = await query(
      `INSERT INTO coupons (store_id, code, discount_type, discount_value, min_order_amount, max_uses, valid_from, valid_until, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        storeId,
        code,
        data.discountType,
        data.discountValue,
        data.minOrderAmount || 0,
        data.maxUses || null,
        data.validFrom || null,
        data.validUntil || null,
        data.isActive ?? true,
      ]
    );
    return mapCoupon(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      throw new CouponError('CODE_TAKEN', 'Já existe um cupom com este código nesta loja.');
    }
    throw err;
  }
}

export async function updateCoupon(storeId, id, patch) {
  const existing = await findCouponById(storeId, id);
  if (!existing) return null;

  const code = patch.code ? String(patch.code).trim().toUpperCase() : existing.code;
  if (patch.code && !/^[A-Z0-9_-]{3,20}$/.test(code)) {
    throw new CouponError('INVALID_CODE', 'Código inválido.');
  }

  const discountType = patch.discountType || existing.discountType;
  const discountValue = patch.discountValue != null ? patch.discountValue : existing.discountValue;
  if (discountType === 'percentage' && (discountValue <= 0 || discountValue > 100)) {
    throw new CouponError('INVALID_DISCOUNT', 'Desconto percentual inválido.');
  }

  const validFrom = patch.validFrom !== undefined ? patch.validFrom : existing.validFrom;
  const validUntil = patch.validUntil !== undefined ? patch.validUntil : existing.validUntil;
  if (validFrom && validUntil && new Date(validUntil) <= new Date(validFrom)) {
    throw new CouponError('INVALID_DATES', 'validUntil deve ser após validFrom.');
  }

  const { rows } = await query(
    `UPDATE coupons SET code=$3, discount_type=$4, discount_value=$5, min_order_amount=$6, max_uses=$7, valid_from=$8, valid_until=$9, is_active=$10, updated_at=now()
     WHERE id=$1 AND store_id=$2 RETURNING *`,
    [
      id,
      storeId,
      code,
      discountType,
      discountValue,
      patch.minOrderAmount != null ? patch.minOrderAmount : existing.minOrderAmount,
      patch.maxUses !== undefined ? patch.maxUses : existing.maxUses,
      validFrom,
      validUntil,
      patch.isActive != null ? patch.isActive : existing.isActive,
    ]
  );
  return rows[0] ? mapCoupon(rows[0]) : null;
}

export async function validateCoupon(storeId, code, { orderAmount = 0 } = {}) {
  const coupon = await findCouponByCode(storeId, code);
  if (!coupon) throw new CouponError('COUPON_NOT_FOUND', 'Cupom não encontrado.');
  if (!coupon.isActive) throw new CouponError('COUPON_INACTIVE', 'Cupom inativo.');
  const now = new Date();
  if (coupon.validFrom && now < new Date(coupon.validFrom)) throw new CouponError('COUPON_NOT_STARTED', 'Cupom ainda não válido.');
  if (coupon.validUntil && now > new Date(coupon.validUntil)) throw new CouponError('COUPON_EXPIRED', 'Cupom expirado.');
  if (coupon.maxUses != null && coupon.usesCount >= coupon.maxUses) throw new CouponError('COUPON_MAX_USES', 'Cupom atingiu o limite de usos.');
  if (orderAmount && orderAmount < coupon.minOrderAmount) throw new CouponError('MIN_ORDER_NOT_MET', `Pedido mínimo para este cupom é R$ ${Number(coupon.minOrderAmount).toFixed(2)}.`);

  let discount = 0;
  if (coupon.discountType === 'percentage') {
    discount = (orderAmount * coupon.discountValue) / 100;
  } else {
    discount = coupon.discountValue;
  }
  discount = Math.min(discount, orderAmount);
  discount = Math.round(discount * 100) / 100;

  return { coupon, discount, total: Math.round((orderAmount - discount) * 100) / 100 };
}

export async function incrementCouponUse(storeId, couponId) {
  const { rows } = await query(
    `UPDATE coupons SET uses_count = uses_count + 1, updated_at = now() WHERE id = $1 AND store_id = $2 RETURNING *`,
    [couponId, storeId]
  );
  return rows[0] ? mapCoupon(rows[0]) : null;
}
