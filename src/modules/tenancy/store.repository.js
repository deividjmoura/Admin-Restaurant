import { query } from '../../infrastructure/db.js';

/**
 * Repositório de stores (tenants).
 * Todas as funções aqui são a fonte de verdade para buscar lojas.
 */

export async function findById(id) {
  const { rows } = await query(
    `SELECT id, slug, name, custom_domain, status, settings, created_at, updated_at
     FROM stores
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findBySlug(slug) {
  if (!slug) return null;
  const { rows } = await query(
    `SELECT id, slug, name, custom_domain, status, settings, created_at, updated_at
     FROM stores
     WHERE lower(slug) = lower($1)`,
    [slug]
  );
  return rows[0] ?? null;
}

export async function findByCustomDomain(domain) {
  if (!domain) return null;
  const { rows } = await query(
    `SELECT id, slug, name, custom_domain, status, settings, created_at, updated_at
     FROM stores
     WHERE lower(custom_domain) = lower($1)`,
    [domain]
  );
  return rows[0] ?? null;
}

export async function listActive() {
  const { rows } = await query(
    `SELECT id, slug, name, custom_domain, status, settings, created_at, updated_at
     FROM stores
     WHERE status = 'active'
     ORDER BY name`
  );
  return rows;
}

export async function create({ slug, name, customDomain = null, settings = {} }) {
  const { rows } = await query(
    `INSERT INTO stores (slug, name, custom_domain, settings)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, slug, name, custom_domain, status, settings, created_at, updated_at`,
    [slug, name, customDomain, JSON.stringify(settings)]
  );
  return rows[0];
}

export async function updateStatus(id, status) {
  const { rows } = await query(
    `UPDATE stores
     SET status = $2, updated_at = now()
     WHERE id = $1
     RETURNING id, slug, name, custom_domain, status, settings, created_at, updated_at`,
    [id, status]
  );
  return rows[0] ?? null;
}
