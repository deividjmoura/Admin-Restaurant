/**
 * Contrato mínimo de canal externo (pensado de fora pra dentro).
 * Implementações reais (iFood, Rappi) estendem esta classe.
 * O módulo orders NÃO importa este arquivo.
 */
export class DeliveryProvider {
  async receiveOrder(_externalPayload) {
    throw new Error('not implemented');
  }

  async updateStatus(_externalOrderId, _status) {
    throw new Error('not implemented');
  }

  async cancel(_externalOrderId, _reason) {
    throw new Error('not implemented');
  }

  async syncMenu(_storeId) {
    throw new Error('not implemented');
  }
}
