/**
 * Billing SaaS — planos e assinaturas por loja (issue #61).
 * Gateway real (Stripe/Asaas/MP) pluga em gateway.js sem mudar o modelo.
 */
import { query, withTransaction } from '../../infrastructure/db.js';

export class BillingError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.code = code;
    if (details) this.details = details;
  }
}

function mapPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    currency: row.currency,
    interval: row.interval,
    maxTables: row.max_tables,
    maxOrdersMonth: row.max_orders_month,
    features: row.features || {},
    active: row.active,
    sortOrder: row.sort_order,
  };
}

function mapSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    planId: row.plan_id,
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    provider: row.provider,
    providerSubscriptionId: row.provider_subscription_id,
    metadata: row.metadata || {},
    plan: row.plan_code
      ? {
          code: row.plan_code,
          name: row.plan_name,
          features: row.plan_features || {},
          maxTables: row.plan_max_tables,
          maxOrdersMonth: row.plan_max_orders_month,
          priceCents: row.plan_price_cents,
        }
      : undefined,
  };
}

export async function listPlans({ activeOnly = true } = {}) {
  const { rows } = await query(
    `SELECT * FROM plans
     WHERE ($1::boolean IS FALSE OR active = true)
     ORDER BY sort_order ASC, price_cents ASC`,
    [activeOnly]
  );
  return rows.map(mapPlan);
}

export async function findPlanByCode(code) {
  const { rows } = await query(`SELECT * FROM plans WHERE code = $1`, [code]);
  return mapPlan(rows[0]);
}

export async function findPlanById(id) {
  const { rows } = await query(`SELECT * FROM plans WHERE id = $1`, [id]);
  return mapPlan(rows[0]);
}

export async function getSubscription(storeId) {
  const { rows } = await query(
    `SELECT s.*,
            p.code AS plan_code, p.name AS plan_name, p.features AS plan_features,
            p.max_tables AS plan_max_tables, p.max_orders_month AS plan_max_orders_month,
            p.price_cents AS plan_price_cents
     FROM subscriptions s
     INNER JOIN plans p ON p.id = s.plan_id
     WHERE s.store_id = $1`,
    [storeId]
  );
  return mapSubscription(rows[0]);
}

/**
 * Cria ou atualiza assinatura da loja (1:1).
 * trialDays > 0 → status trial.
 */
export async function upsertSubscription(storeId, {
  planCode = 'start',
  status = null,
  trialDays = 14,
  provider = 'manual',
  providerSubscriptionId = null,
  metadata = {},
} = {}) {
  const plan = await findPlanByCode(planCode);
  if (!plan || !plan.active) {
    throw new BillingError('PLAN_NOT_FOUND', `Plano '${planCode}' não encontrado.`);
  }

  const now = new Date();
  const trialEnds = trialDays > 0 ? new Date(now.getTime() + trialDays * 86400000) : null;
  const periodEnd = new Date(now.getTime() + 30 * 86400000);
  const resolvedStatus =
    status || (trialDays > 0 ? 'trial' : 'active');

  const { rows } = await query(
    `INSERT INTO subscriptions
       (store_id, plan_id, status, trial_ends_at, current_period_start, current_period_end,
        provider, provider_subscription_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (store_id) DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       status = EXCLUDED.status,
       trial_ends_at = EXCLUDED.trial_ends_at,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       provider = EXCLUDED.provider,
       provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, subscriptions.provider_subscription_id),
       metadata = subscriptions.metadata || EXCLUDED.metadata,
       updated_at = now()
     RETURNING *`,
    [
      storeId,
      plan.id,
      resolvedStatus,
      trialEnds,
      now,
      periodEnd,
      provider,
      providerSubscriptionId,
      JSON.stringify(metadata),
    ]
  );
  return getSubscription(storeId);
}

export async function setSubscriptionStatus(storeId, status, { metadata = {} } = {}) {
  const allowed = ['trial', 'active', 'past_due', 'cancelled', 'suspended'];
  if (!allowed.includes(status)) {
    throw new BillingError('INVALID_STATUS', `Status inválido: ${status}`);
  }
  await query(
    `UPDATE subscriptions SET status = $2, metadata = metadata || $3::jsonb, updated_at = now()
     WHERE store_id = $1`,
    [storeId, status, JSON.stringify(metadata)]
  );
  return getSubscription(storeId);
}

/** Apply one authenticated event atomically. Never identify a tenant from the body. */
export async function processBillingWebhook({ provider, externalEventId, providerSubscriptionId, bodyStoreId, status, payloadHash }) {
  return withTransaction(async (client) => {
    // Lock all matches: an ambiguous provider reference is unsafe, even if old
    // data predates the reference index. Fail closed instead of choosing one.
    const { rows } = await client.query(
      `SELECT id, store_id FROM subscriptions
       WHERE provider = $1 AND provider_subscription_id = $2
       FOR UPDATE`,
      [provider, providerSubscriptionId]
    );
    if (rows.length !== 1) throw new BillingError('SUBSCRIPTION_NOT_FOUND', 'Assinatura não encontrada ou referência ambígua.');
    const subscription = rows[0];
    if (bodyStoreId && String(bodyStoreId).toLowerCase() !== String(subscription.store_id).toLowerCase()) {
      throw new BillingError('SUBSCRIPTION_MISMATCH', 'Loja não corresponde à assinatura.');
    }

    const inserted = await client.query(
      `INSERT INTO billing_webhook_events (provider, external_event_id, subscription_id, payload_sha256)
       VALUES ($1, $2, $3, $4) ON CONFLICT (provider, external_event_id) DO NOTHING RETURNING external_event_id`,
      [provider, externalEventId, subscription.id, payloadHash]
    );
    if (!inserted.rowCount) {
      const existing = await client.query(
        `SELECT subscription_id, payload_sha256 FROM billing_webhook_events WHERE provider = $1 AND external_event_id = $2`,
        [provider, externalEventId]
      );
      if (existing.rows[0]?.subscription_id !== subscription.id || existing.rows[0]?.payload_sha256 !== payloadHash) {
        throw new BillingError('EVENT_CONFLICT', 'ID de evento já usado com conteúdo diferente.');
      }
      return { duplicate: true, applied: false };
    }
    await client.query(
      `UPDATE subscriptions SET status = $2, metadata = metadata || $3::jsonb, updated_at = now() WHERE id = $1`,
      [subscription.id, status, JSON.stringify({ webhookType: status, provider })]
    );
    return { duplicate: false, applied: true, storeId: subscription.store_id, subscriptionId: subscription.id };
  }, { operation: 'tx:billing_webhook' });
}

/**
 * Feature-gating: módulos habilitados pelo plano + status da assinatura.
 * Sem assinatura → trata como trial implícito do plano Start (onboarding futuro).
 */
export async function resolveEntitlements(storeId) {
  let sub = await getSubscription(storeId);
  if (!sub) {
    // Lojas legadas: entitlements generosos até onboarding forçar plano
    return {
      status: 'legacy',
      planCode: 'legacy',
      modules: ['*'],
      maxTables: null,
      maxOrdersMonth: null,
      allowed: true,
    };
  }

  const blocked = ['cancelled', 'suspended'].includes(sub.status);
  const features = sub.plan?.features || {};
  const modules = Array.isArray(features.modules) ? features.modules : [];

  return {
    status: sub.status,
    planCode: sub.plan?.code || null,
    modules,
    maxTables: sub.plan?.maxTables ?? null,
    maxOrdersMonth: sub.plan?.maxOrdersMonth ?? null,
    allowed: !blocked,
    subscription: sub,
  };
}

export function hasModule(entitlements, moduleName) {
  if (!entitlements?.allowed) return false;
  const mods = entitlements.modules || [];
  if (mods.includes('*')) return true;
  return mods.includes(moduleName);
}
