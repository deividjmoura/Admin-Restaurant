/**
 * Adapter de cobrança recorrente. Provider real (Stripe/Asaas/MP) substitui o mock.
 * Nunca recebe dados de cartão nesta camada — checkout hospedado no provider.
 */
import { randomUUID } from 'node:crypto';

/**
 * @returns {Promise<{ provider: string, providerSubscriptionId: string, checkoutUrl?: string|null }>}
 */
export async function createSubscriptionIntent({
  planCode,
  storeId,
  customerEmail = null,
} = {}) {
  const provider = process.env.BILLING_PROVIDER || 'mock_billing';

  if (provider === 'mock_billing') {
    return {
      provider,
      providerSubscriptionId: `sub_mock_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      checkoutUrl: null,
      metadata: { planCode, storeId, customerEmail, mode: 'mock' },
    };
  }

  // Placeholder: integrar SDK real aqui mantendo o mesmo retorno.
  return {
    provider,
    providerSubscriptionId: `sub_pending_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    checkoutUrl: process.env.BILLING_CHECKOUT_BASE_URL
      ? `${process.env.BILLING_CHECKOUT_BASE_URL}?plan=${encodeURIComponent(planCode)}&store=${encodeURIComponent(storeId)}`
      : null,
    metadata: { planCode, storeId },
  };
}

/**
 * Normaliza evento de webhook do provider (mock = body já normalizado).
 */
export function normalizeBillingWebhook(provider, body = {}) {
  return {
    externalEventId: body.id || body.event_id || body.externalEventId || null,
    type: body.type || body.event || 'unknown',
    storeId: body.store_id || body.storeId || null,
    providerSubscriptionId:
      body.subscription_id || body.providerSubscriptionId || body.data?.id || null,
    status: body.status || body.data?.status || null,
  };
}
