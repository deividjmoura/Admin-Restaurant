/**
 * Handlers de job. Impressão real entra como adapter sem mudar o contrato.
 * Falha aqui → retry/dead-letter; nunca sobe para o path do pedido.
 */

/**
 * @param {{ type: string, payload: object, storeId: string }}
 */
export async function dispatchJob(job) {
  switch (job.type) {
    case 'print.order':
      return handlePrintOrder(job);
    case 'notify.generic':
      return handleNotify(job);
    default:
      // Tipos desconhecidos completam sem erro para não encher dead-letter em deploy parcial
      return { skipped: true, reason: `unknown_type:${job.type}` };
  }
}

async function handlePrintOrder(job) {
  const { orderId, station } = job.payload || {};
  // Adapter mock: em produção trocar por ESC/POS rede, etc.
  if (process.env.PRINT_FAIL === '1') {
    throw new Error('PRINT_PROVIDER_UNAVAILABLE');
  }
  return {
    printed: true,
    orderId: orderId || null,
    station: station || null,
    provider: process.env.PRINT_PROVIDER || 'mock_print',
    at: new Date().toISOString(),
  };
}

async function handleNotify(job) {
  return {
    notified: true,
    channel: job.payload?.channel || 'log',
    at: new Date().toISOString(),
  };
}
