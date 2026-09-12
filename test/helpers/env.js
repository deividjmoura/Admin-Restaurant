/**
 * Helpers para testes de isolamento multi-tenant.
 */
export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function skipWithoutDb(t) {
  if (!hasDatabase()) {
    t.skip('DATABASE_URL não definida — teste de integração pulado');
    return true;
  }
  return false;
}
