import { query } from '../../infrastructure/db.js';

/**
 * Append-only audit log.
 * Never store passwords, tokens, or full card data in metadata.
 */
export async function writeAuditLog({
  storeId = null,
  actorUserId = null,
  action,
  resource = null,
  resourceId = null,
  metadata = {},
  ip = null,
  userAgent = null,
}) {
  if (!action) {
    throw new Error('audit action is required');
  }

  const { rows } = await query(
    `INSERT INTO audit_logs
      (store_id, actor_user_id, action, resource, resource_id, metadata, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING id, store_id, actor_user_id, action, resource, resource_id, created_at`,
    [
      storeId,
      actorUserId,
      action,
      resource,
      resourceId != null ? String(resourceId) : null,
      JSON.stringify(metadata ?? {}),
      ip,
      userAgent,
    ]
  );

  return rows[0];
}

export async function listAuditLogsForStore(storeId, { limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const { rows } = await query(
    `SELECT id, store_id, actor_user_id, action, resource, resource_id, metadata, ip, created_at
     FROM audit_logs
     WHERE store_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [storeId, safeLimit, safeOffset]
  );

  return rows;
}
