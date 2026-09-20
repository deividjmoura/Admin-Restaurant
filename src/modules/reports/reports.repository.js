/**
 * Relatórios e dashboard — sempre filtrados por store_id.
 * Epic #9
 */
import { query } from '../../infrastructure/db.js';

const TZ = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

/**
 * preset: today | yesterday | week | month | custom (from/to ISO)
 */
export function resolvePeriod({ preset = 'today', from = null, to = null } = {}) {
  if (preset === 'custom' && from && to) {
    return {
      preset: 'custom',
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    };
  }
  const allowed = new Set(['today', 'yesterday', 'week', 'month']);
  return {
    preset: allowed.has(preset) ? preset : 'today',
    from: null,
    to: null,
  };
}

/**
 * @param {string} column - ex: 'o.created_at' ou 'created_at'
 * @param {number} paramStart - próximo índice de parâmetro ($N)
 */
function periodFilter(column, preset, fromIso, toIso, paramStart) {
  if (preset === 'custom' && fromIso && toIso) {
    return {
      clause: `${column} >= $${paramStart}::timestamptz AND ${column} < $${paramStart + 1}::timestamptz`,
      params: [fromIso, toIso],
    };
  }

  const tz = TZ.replace(/'/g, "''");
  const bounds = {
    today: [
      `(date_trunc('day', now() AT TIME ZONE '${tz}') AT TIME ZONE '${tz}')`,
      `((date_trunc('day', now() AT TIME ZONE '${tz}') + interval '1 day') AT TIME ZONE '${tz}')`,
    ],
    yesterday: [
      `((date_trunc('day', now() AT TIME ZONE '${tz}') - interval '1 day') AT TIME ZONE '${tz}')`,
      `(date_trunc('day', now() AT TIME ZONE '${tz}') AT TIME ZONE '${tz}')`,
    ],
    week: [
      `((date_trunc('day', now() AT TIME ZONE '${tz}') - interval '6 day') AT TIME ZONE '${tz}')`,
      `((date_trunc('day', now() AT TIME ZONE '${tz}') + interval '1 day') AT TIME ZONE '${tz}')`,
    ],
    month: [
      `(date_trunc('month', now() AT TIME ZONE '${tz}') AT TIME ZONE '${tz}')`,
      `((date_trunc('day', now() AT TIME ZONE '${tz}') + interval '1 day') AT TIME ZONE '${tz}')`,
    ],
  };
  const [startExpr, endExpr] = bounds[preset] || bounds.today;
  return {
    clause: `${column} >= ${startExpr} AND ${column} < ${endExpr}`,
    params: [],
  };
}

export async function getDashboardSummary(storeId, periodOpts = {}) {
  const resolved = resolvePeriod(periodOpts);
  const pf = periodFilter(
    'created_at',
    resolved.preset,
    resolved.from,
    resolved.to,
    2
  );
  const params = [storeId, ...pf.params];

  const { rows: orderStats } = await query(
    `SELECT
       COUNT(*)::int AS orders_total,
       COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS orders_cancelled,
       COUNT(*) FILTER (WHERE status <> 'CANCELLED')::int AS orders_valid,
       COUNT(*) FILTER (WHERE channel = 'TABLE' AND status <> 'CANCELLED')::int AS orders_table,
       COUNT(*) FILTER (WHERE channel = 'DELIVERY' AND status <> 'CANCELLED')::int AS orders_delivery,
       COUNT(*) FILTER (WHERE status = 'DELIVERED')::int AS orders_delivered
     FROM orders
     WHERE store_id = $1 AND ${pf.clause}`,
    params
  );

  const pfOrder = periodFilter(
    'o.created_at',
    resolved.preset,
    resolved.from,
    resolved.to,
    2
  );
  const paramsOrder = [storeId, ...pfOrder.params];

  const { rows: revenueRows } = await query(
    `SELECT
       COALESCE(SUM((oi.unit_price + oi.addons_total) * oi.quantity) FILTER (WHERE oi.status <> 'CANCELLED'), 0) AS items_revenue,
       COALESCE(SUM(oi.quantity) FILTER (WHERE oi.status <> 'CANCELLED'), 0)::int AS items_qty
     FROM order_items oi
     INNER JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
     WHERE oi.store_id = $1
       AND o.status <> 'CANCELLED'
       AND ${pfOrder.clause}`,
    paramsOrder
  );

  const { rows: payRows } = await query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE status = 'PAID'), 0) AS paid_amount,
       COUNT(*) FILTER (WHERE status = 'PAID')::int AS paid_count,
       COALESCE(SUM(amount) FILTER (WHERE status = 'PAID' AND method = 'PIX'), 0) AS paid_pix,
       COALESCE(SUM(amount) FILTER (WHERE status = 'PAID' AND method = 'CASH'), 0) AS paid_cash,
       COALESCE(SUM(amount) FILTER (WHERE status = 'PAID' AND method = 'CARD'), 0) AS paid_card
     FROM payments
     WHERE store_id = $1 AND ${pf.clause}`,
    params
  );

  const { rows: deliveryFeeRows } = await query(
    `SELECT COALESCE(SUM(d.delivery_fee), 0) AS delivery_fees
     FROM delivery_orders d
     INNER JOIN orders o ON o.id = d.order_id AND o.store_id = d.store_id
     WHERE d.store_id = $1
       AND o.status <> 'CANCELLED'
       AND ${pfOrder.clause}`,
    paramsOrder
  );

  const o = orderStats[0] || {};
  const r = revenueRows[0] || {};
  const p = payRows[0] || {};
  const itemsRevenue = Number(r.items_revenue) || 0;
  const deliveryFees = Number(deliveryFeeRows[0]?.delivery_fees) || 0;
  const validOrders = o.orders_valid || 0;
  const avgTicket = validOrders > 0 ? itemsRevenue / validOrders : 0;

  return {
    period: {
      preset: resolved.preset,
      from: resolved.from,
      to: resolved.to,
      timezone: TZ,
    },
    orders: {
      total: o.orders_total || 0,
      valid: validOrders,
      cancelled: o.orders_cancelled || 0,
      delivered: o.orders_delivered || 0,
      table: o.orders_table || 0,
      delivery: o.orders_delivery || 0,
    },
    revenue: {
      items: Math.round(itemsRevenue * 100) / 100,
      deliveryFees: Math.round(deliveryFees * 100) / 100,
      total: Math.round((itemsRevenue + deliveryFees) * 100) / 100,
      itemsQuantity: r.items_qty || 0,
      averageTicket: Math.round(avgTicket * 100) / 100,
    },
    payments: {
      paidCount: p.paid_count || 0,
      paidAmount: Math.round(Number(p.paid_amount) * 100) / 100,
      byMethod: {
        pix: Math.round(Number(p.paid_pix) * 100) / 100,
        cash: Math.round(Number(p.paid_cash) * 100) / 100,
        card: Math.round(Number(p.paid_card) * 100) / 100,
      },
    },
  };
}

export async function getTopProducts(storeId, periodOpts = {}, { limit = 10 } = {}) {
  const resolved = resolvePeriod(periodOpts);
  const pf = periodFilter(
    'o.created_at',
    resolved.preset,
    resolved.from,
    resolved.to,
    2
  );
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const params = [storeId, ...pf.params, safeLimit];

  const { rows } = await query(
    `SELECT
       oi.product_id,
       oi.product_name,
       SUM(oi.quantity) FILTER (WHERE oi.status <> 'CANCELLED')::int AS quantity,
       COALESCE(SUM((oi.unit_price + oi.addons_total) * oi.quantity) FILTER (WHERE oi.status <> 'CANCELLED'), 0) AS revenue
     FROM order_items oi
     INNER JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
     WHERE oi.store_id = $1
       AND o.status <> 'CANCELLED'
       AND ${pf.clause}
     GROUP BY oi.product_id, oi.product_name
     HAVING SUM(oi.quantity) FILTER (WHERE oi.status <> 'CANCELLED') > 0
     ORDER BY quantity DESC, revenue DESC
     LIMIT $${params.length}`,
    params
  );

  return rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    quantity: r.quantity,
    revenue: Math.round(Number(r.revenue) * 100) / 100,
  }));
}

export async function getDailySeries(storeId, periodOpts = {}) {
  const resolved = resolvePeriod(periodOpts);
  const preset = resolved.preset === 'today' ? 'week' : resolved.preset;
  const tz = TZ.replace(/'/g, "''");
  return getDailySeriesFixed(storeId, preset, resolved, tz);
}

async function getDailySeriesFixed(storeId, preset, resolved, tz) {
  const pf = periodFilter(
    'o.created_at',
    preset,
    resolved.from,
    resolved.to,
    2
  );
  const params = [storeId, ...pf.params];

  const { rows } = await query(
    `SELECT
       day,
       COUNT(*)::int AS orders,
       COALESCE(SUM(order_revenue), 0) AS revenue
     FROM (
       SELECT
         (o.created_at AT TIME ZONE '${tz}')::date AS day,
         o.id,
         COALESCE((
           SELECT SUM((oi.unit_price + oi.addons_total) * oi.quantity)
           FROM order_items oi
           WHERE oi.order_id = o.id
             AND oi.store_id = o.store_id
             AND oi.status <> 'CANCELLED'
         ), 0) AS order_revenue
       FROM orders o
       WHERE o.store_id = $1
         AND o.status <> 'CANCELLED'
         AND ${pf.clause}
     ) t
     GROUP BY day
     ORDER BY day`,
    params
  );

  return rows.map((r) => ({
    day: r.day,
    orders: r.orders,
    revenue: Math.round(Number(r.revenue) * 100) / 100,
  }));
}

export async function getAveragePrepMinutes(storeId, periodOpts = {}) {
  const resolved = resolvePeriod(periodOpts);
  const pf = periodFilter(
    'created_at',
    resolved.preset,
    resolved.from,
    resolved.to,
    2
  );
  const params = [storeId, ...pf.params];

  const { rows } = await query(
    `SELECT
       AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 60.0)
         FILTER (WHERE status IN ('READY', 'DELIVERED')) AS avg_minutes,
       COUNT(*) FILTER (WHERE status IN ('READY', 'DELIVERED'))::int AS sample_size
     FROM orders
     WHERE store_id = $1 AND ${pf.clause}`,
    params
  );

  const avg = rows[0]?.avg_minutes;
  return {
    averagePrepMinutes: avg != null ? Math.round(Number(avg) * 10) / 10 : null,
    sampleSize: rows[0]?.sample_size || 0,
  };
}

export async function getLiveOps(storeId) {
  const { rows: sessions } = await query(
    `SELECT COUNT(*)::int AS open_sessions
     FROM table_sessions
     WHERE store_id = $1 AND status = 'open'`,
    [storeId]
  );

  const { rows: kitchen } = await query(
    `SELECT COUNT(*)::int AS active_orders
     FROM orders
     WHERE store_id = $1
       AND status IN ('PENDING', 'CONFIRMED', 'PREPARING', 'READY')`,
    [storeId]
  );

  const { rows: pendingPay } = await query(
    `SELECT COUNT(*)::int AS pending_payments,
            COALESCE(SUM(amount), 0) AS pending_amount
     FROM payments
     WHERE store_id = $1 AND status = 'PENDING'`,
    [storeId]
  );

  return {
    openSessions: sessions[0]?.open_sessions || 0,
    activeOrders: kitchen[0]?.active_orders || 0,
    pendingPayments: pendingPay[0]?.pending_payments || 0,
    pendingPaymentsAmount: Math.round(
      Number(pendingPay[0]?.pending_amount || 0) * 100
    ) / 100,
  };
}
