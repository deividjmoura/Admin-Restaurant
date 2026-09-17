import { query } from '../../infrastructure/db.js';

export async function listPlans() {
  const { rows } = await query(`SELECT * FROM billing_plans ORDER BY price_monthly`);
  return rows;
}

export async function getSubscription(storeId) {
  const { rows } = await query(`SELECT * FROM billing_subscriptions WHERE store_id = $1`, [storeId]);
  return rows[0] || null;
}

export async function upsertSubscription(storeId, { planId, status = 'active' }) {
  const { rows } = await query(
    `INSERT INTO billing_subscriptions (store_id, plan_id, status)
     VALUES ($1,$2,$3)
     ON CONFLICT (store_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = EXCLUDED.status, updated_at = now()
     RETURNING *`,
    [storeId, planId, status]
  );
  return rows[0];
}

export async function checkLimits(storeId) {
  const sub = await getSubscription(storeId);
  const planId = sub?.plan_id || 'basic';
  const { rows: planRows } = await query(`SELECT * FROM billing_plans WHERE id = $1`, [planId]);
  const plan = planRows[0];
  if (!plan) return { allowed: true, plan: null };

  const { rows: counts } = await query(
    `SELECT
       (SELECT count(*)::int FROM tables WHERE store_id = $1) as tables,
       (SELECT count(*)::int FROM products WHERE store_id = $1) as products,
       (SELECT count(*)::int FROM orders WHERE store_id = $1 AND created_at > now() - INTERVAL '30 days') as orders`,
    [storeId]
  );
  const c = counts[0];
  return {
    allowed: c.tables <= plan.max_tables && c.products <= plan.max_products && c.orders <= plan.max_orders_month,
    plan,
    usage: c,
    limits: { tables: plan.max_tables, products: plan.max_products, orders: plan.max_orders_month },
  };
}
