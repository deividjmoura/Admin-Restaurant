import { query } from '../../infrastructure/db.js';

/**
 * Append-only audit log. Metadata must never contain secrets.
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
  if (!action) throw new Error('audit action is required');

  const { rows } = await query(
    `INSERT INTO audit_logs
      (store_id, actor_user_id, action, resource, resource_id, metadata, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING id, store_id, actor_user_id, action, resource, resource_id, created_at`,
    [storeId, actorUserId, action, resource, resourceId != null ? String(resourceId) : null,
      JSON.stringify(metadata ?? {}), ip, userAgent]
  );
  return rows[0];
}

/**
 * Auditing is deliberately best effort: a failed audit write must not roll back
 * the business operation that was already completed.
 */
export function audit(event, { log = console } = {}) {
  return writeAuditLog(event).catch((err) => {
    log?.warn?.({ err, action: event?.action }, 'audit log failed');
    return null;
  });
}

export async function listAuditLogsForStore(storeId, {
  limit = 50, offset = 0, action, resource, from, to,
} = {}) {
  const values = [storeId];
  const where = ['store_id = $1'];
  const add = (sql, value) => { values.push(value); where.push(`${sql} $${values.length}`); };
  if (action) add('action =', action);
  if (resource) add('resource =', resource);
  if (from) add('created_at >=', from);
  if (to) add('created_at <', to);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  values.push(safeLimit, safeOffset);

  const { rows } = await query(
    `SELECT id, store_id, actor_user_id, action, resource, resource_id, metadata, ip, user_agent, created_at
       FROM audit_logs WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return rows;
}
