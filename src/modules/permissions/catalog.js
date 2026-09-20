/**
 * Catálogo central de permissões granulares.
 * Mantido em sync com migrations/0014_permissions.sql
 * Chave no formato resource.action ou resource.subresource.action
 */
export const PERMISSIONS = [
  { key: 'menu.categories.read', description: 'Listar categorias do cardápio' },
  { key: 'menu.categories.write', description: 'Criar/editar/remover categorias' },
  { key: 'menu.products.read', description: 'Listar produtos' },
  { key: 'menu.products.write', description: 'Criar/editar/remover produtos' },
  { key: 'menu.addons.read', description: 'Listar adicionais' },
  { key: 'menu.addons.write', description: 'Criar/editar/remover adicionais' },
  { key: 'tables.read', description: 'Listar mesas' },
  { key: 'tables.write', description: 'Criar/editar/remover/regenerar token de mesas' },
  { key: 'orders.read', description: 'Ver pedidos' },
  { key: 'orders.status.write', description: 'Alterar status do pedido' },
  { key: 'orders.items.status.write', description: 'Alterar status de item do pedido' },
  { key: 'kitchen.orders.read', description: 'Ver pedidos por estação (cozinha/bar)' },
  { key: 'waiter.ready.read', description: 'Ver itens prontos para entrega' },
  { key: 'waiter.items.deliver', description: 'Marcar item como entregue' },
  { key: 'cashier.sessions.read', description: 'Ver sessões/comandas do caixa' },
  { key: 'cashier.sessions.close', description: 'Fechar sessão/comanda' },
  { key: 'reports.read', description: 'Ver relatórios/dashboard' },
  { key: 'delivery.zones.read', description: 'Listar zonas de entrega' },
  { key: 'delivery.zones.write', description: 'Criar/editar zonas de entrega' },
  { key: 'payments.read', description: 'Listar/ver pagamentos' },
  { key: 'payments.create', description: 'Criar pagamento' },
  { key: 'payments.confirm', description: 'Confirmar pagamento' },
  { key: 'payments.refund', description: 'Estornar/cancelar pagamento' },
  { key: 'store.settings.read', description: 'Ver configurações da loja' },
  { key: 'store.settings.write', description: 'Editar configurações da loja' },
  { key: 'permissions.manage', description: 'Gerenciar permissões por papel' },
  { key: 'audit.read', description: 'Consultar logs de auditoria' },
  { key: 'customers.read', description: 'Listar/ver clientes da loja' },
  { key: 'customers.write', description: 'Criar/editar clientes e consentimentos' },
];

export const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));

/**
 * Fallback matrix usado quando role_permissions está vazio para a loja
 * (ex.: lojas criadas em testes de integração antes do seed).
 * OWNER/MANAGER têm acesso amplo; KITCHEN/STAFF restrito.
 * Após a migration 0014, lojas existentes já têm role_permissions semeado,
 * então o fallback só afeta lojas efêmeras de teste.
 */
const ALL_KEYS = PERMISSIONS.map((p) => p.key);

export const FALLBACK_MATRIX = {
  OWNER: [...ALL_KEYS],
  MANAGER: ALL_KEYS.filter((k) => k !== 'permissions.manage'),
  KITCHEN: [
    'kitchen.orders.read',
    'orders.items.status.write',
    'orders.read',
    'waiter.ready.read',
  ],
  STAFF: [
    'kitchen.orders.read',
    'orders.items.status.write',
    'orders.read',
    'waiter.ready.read',
    'waiter.items.deliver',
    'cashier.sessions.read',
    'cashier.sessions.close',
    'tables.read',
    'payments.read',
    'payments.create',
    'payments.confirm',
    'delivery.zones.read',
  ],
};

export function isValidPermissionKey(key) {
  return PERMISSION_KEYS.has(key);
}
