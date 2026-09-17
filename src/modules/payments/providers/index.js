/**
 * Seletor de provider PIX
 * Env: PIX_PROVIDER=static|mercadopago|mock (default: static)
 * - static: EMV estático via pix-static.js (sem rede)
 * - mercadopago: tenta dinâmico via Mercado Pago sandbox; fallback mock se sem token
 * - mock: sempre mock (útil para testes)
 */
import { buildStaticPixPayload, resolvePixConfig } from '../pix-static.js';
import { createDynamicPix as createMpPix } from './mercadopago.js';

export function getPixProviderName(env = process.env) {
  const raw = (env.PIX_PROVIDER || env.PAYMENTS_PROVIDER || 'static').toLowerCase();
  if (raw === 'mercadopago' || raw === 'mp' || raw === 'mercado_pago') return 'mercadopago';
  if (raw === 'mock' || raw === 'dynamic_mock') return 'mock';
  return 'static';
}

export async function createPixPayment({ store, amount, externalReference, description, payerEmail }) {
  const provider = getPixProviderName();
  const settings = typeof store.settings === 'object' && store.settings ? store.settings : {};

  if (provider === 'static') {
    const pix = resolvePixConfig(settings);
    if (!pix.configured) {
      const err = new Error('PIX_NOT_CONFIGURED');
      err.code = 'PIX_NOT_CONFIGURED';
      throw err;
    }
    const txid = String(externalReference).replace(/[^a-zA-Z0-9]/g, '').slice(0, 25) || 'PEDIDO';
    const pixCopyPaste = buildStaticPixPayload({
      key: pix.key,
      name: pix.name,
      city: pix.city,
      amount: Number(amount),
      txid,
    });
    return {
      provider: 'static_pix',
      providerPaymentId: null,
      pixCopyPaste,
      qrCodeBase64: null,
      ticketUrl: null,
    };
  }

  if (provider === 'mercadopago' || provider === 'mock') {
    // Para dinâmico, não exige pix key da loja — provider gera QR
    // Mas se quiser, pode combinar com config da loja
    const result = await createMpPix({
      storeId: store.id,
      amount: Number(amount),
      externalReference,
      description,
      payerEmail,
    });
    return result;
  }

  // fallback
  const pix = resolvePixConfig(settings);
  if (!pix.configured) {
    const err = new Error('PIX_NOT_CONFIGURED');
    err.code = 'PIX_NOT_CONFIGURED';
    throw err;
  }
  const txid = String(externalReference).replace(/[^a-zA-Z0-9]/g, '').slice(0, 25) || 'PEDIDO';
  return {
    provider: 'static_pix',
    providerPaymentId: null,
    pixCopyPaste: buildStaticPixPayload({
      key: pix.key,
      name: pix.name,
      city: pix.city,
      amount: Number(amount),
      txid,
    }),
  };
}

export function isDynamicProvider(provider) {
  return provider === 'mercadopago' || provider === 'mercadopago_mock' || provider === 'mock';
}
