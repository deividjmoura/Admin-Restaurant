import { query, withTransaction } from '../../infrastructure/db.js';
import { PERMISSIONS, FALLBACK_MATRIX } from './catalog.js';

export async function listPermissions() {
  const { rows } = await query(`SELECT id, key, description, created_at FROM permissions ORDER BY key`);
  return rows;
}

export async function findPermissionByKey(key) {
  const { rows } = await query(`SELECT id, key, description FROM permissions WHERE key = $1`, [key]);
  return rows[0] ?? null;
}

export async function listRolePermissions(storeId, role) {
  const { rows } = await query(
    `SELECT p.key, p.description, p.id as permission_id
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.store_id = $1 AND rp.role = $2
     ORDER BY p.key`,
    [storeId, role]
  );
  return rows;
}

export async function hasPermission(storeId, role, permissionKey) {
  // permission must exist in catalog
  const perm = await findPermissionByKey(permissionKey);
  if (!perm) return false;

  // check explicit mapping
  const { rows } = await query(
    `SELECT 1 FROM role_permissions WHERE store_id = $1 AND role = $2 AND permission_id = $3 LIMIT 1`,
    [storeId, role, perm.id]
  );
  if (rows.length > 0) return true;

  // Fallback: se a loja ainda não tem NENHUM mapeamento, usar matriz hardcoded
  // Isso cobre lojas criadas em testes de integração via store.repository.create
  const { rows: countRows } = await query(`SELECT COUNT(*)::int as cnt FROM role_permissions WHERE store_id = $1`, [storeId]);
  const cnt = countRows[0]?.cnt ?? 0;
  if (cnt === 0) {
    const fallback = FALLBACK_MATRIX[role] || [];
    return fallback.includes(permissionKey);
  }

  // Loja já tem mapeamento, mas permissão não está no papel → negado (default deny)
  return false;
}

export async function setRolePermissions(storeId, role, permissionKeys) {
  // validate
  const unique = [...new Set(permissionKeys)];
  for (const k of unique) {
    const perm = await findPermissionByKey(k);
    if (!perm) {
      const err = new Error(`UNKNOWN_PERMISSION: ${k}`);
      err.code = 'UNKNOWN_PERMISSION';
      err.permissionKey = k;
      throw err;
    }
  }

  return withTransaction(async (client) => {
    await client.query(`DELETE FROM role_permissions WHERE store_id = $1 AND role = $2`, [storeId, role]);
    if (unique.length === 0) return [];
    // fetch ids
    const { rows: perms } = await client.query(`SELECT id, key FROM permissions WHERE key = ANY($1::text[])`, [unique]);
    const map = new Map(perms.map((p) => [p.key, p.id]));
    for (const key of unique) {
      const pid = map.get(key);
      if (!pid) continue;
      await client.query(`INSERT INTO role_permissions (store_id, role, permission_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [storeId, role, pid]);
    }
    const { rows } = await client.query(
      `SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.store_id=$1 AND rp.role=$2 ORDER BY p.key`,
      [storeId, role]
    );
    return rows.map((r) => r.key);
  });
}

/**
 * Semeia as permissões padrão de uma loja nova.
 *
 * A fonte de verdade é `FALLBACK_MATRIX` (catalog.js) — o mesmo conjunto que o
 * fallback usa quando a loja ainda não tem mapeamento. Antes cada papel tinha a
 * lista duplicada em SQL aqui e no catálogo, e permissão nova (ex.: caixa,
 * issue #107) só valia em um dos dois lados.
 */
export async function ensureDefaultRolePermissions(storeId) {
  const { rows } = await query(`SELECT COUNT(*)::int as cnt FROM role_permissions WHERE store_id=$1`, [storeId]);
  if (rows[0].cnt > 0) return false;

  for (const [role, keys] of Object.entries(FALLBACK_MATRIX)) {
    if (!keys?.length) continue;
    await query(
      `INSERT INTO role_permissions (store_id, role, permission_id)
       SELECT $1, $2, id FROM permissions WHERE key = ANY($3::text[])
       ON CONFLICT DO NOTHING`,
      [storeId, role, keys]
    );
  }
  return true;
}

export async function storeHasAnyRolePermissions(storeId) {
  const { rows } = await query(`SELECT COUNT(*)::int as cnt FROM role_permissions WHERE store_id=$1`, [storeId]);
  return rows[0].cnt > 0;
}
