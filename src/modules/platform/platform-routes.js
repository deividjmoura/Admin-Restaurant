import { z } from 'zod';
import { query, withTransaction } from '../../infrastructure/db.js';
import { hashPassword } from '../auth/password.js';
import { FALLBACK_MATRIX } from '../permissions/catalog.js';
import { getBaseDomain, RESERVED_SLUGS } from '../tenancy/tenant-host.js';
import { AppError } from '../../shared/errors.js';
import { auditSafe } from '../audit/index.js';

const text = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[<>\x00-\x1f]/.test(v));
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
  .refine((v) => !RESERVED_SLUGS.includes(v));
const customDomain = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
  .refine((v) => v !== getBaseDomain() && !v.endsWith(`.${getBaseDomain()}`))
  .nullable();
const fields = {
  slug,
  name: text(120),
  customDomain: customDomain.optional(),
  status: z.enum(['active', 'suspended', 'pending']),
};
const createSchema = z
  .object({
    ...fields,
    status: fields.status.default('pending'),
    ownerEmail: z.string().trim().toLowerCase().email().max(254),
    ownerName: text(120),
    ownerPassword: z.string().min(12).max(200).optional(),
  })
  .strict();
const patchSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0);
const pageSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict();
export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError('VALIDATION_ERROR', 'Payload inválido.', 400);
  return result.data;
}
async function uniqueConflict(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === '23505')
      throw new AppError(
        'CONFLICT',
        'Slug, domínio ou e-mail já cadastrado.',
        409
      );
    throw err;
  }
}
async function audit(request, action, id, fields) {
  await auditSafe(
    {
      storeId: null,
      actorUserId: request.user.id,
      action,
      resource: 'store',
      resourceId: id,
      metadata: { fields },
      ip: request.ip,
      userAgent: request.headers['user-agent'] || null,
    },
    { log: request.log }
  );
}

export default async function platformRoutes(app) {
  // Encapsulated hook: no platform route can accidentally omit the guard.
  app.addHook('preHandler', app.requirePlatform);
  app.get('/api/platform/stores', async (request) => {
    const { limit, offset } = parse(pageSchema, request.query);
    const { rows } = await query(
      `SELECT id,slug,name,custom_domain,status,created_at,updated_at
      FROM stores ORDER BY created_at DESC,id LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return { stores: rows, limit, offset };
  });
  app.get('/api/platform/stores/:id', async (request) => {
    const id = parse(z.string().uuid(), request.params.id);
    const { rows } = await query('SELECT * FROM stores WHERE id=$1', [id]);
    if (!rows.length)
      throw new AppError('NOT_FOUND', 'Loja não encontrada.', 404);
    return { store: rows[0] };
  });
  app.post('/api/platform/stores', async (request, reply) => {
    const data = parse(createSchema, request.body);
    const passwordHash = data.ownerPassword
      ? await hashPassword(data.ownerPassword)
      : null;
    const store = await uniqueConflict(() =>
      withTransaction(async (client) => {
        // Never change credentials of an existing identity while adding membership.
        let { rows: users } = await client.query(
          'SELECT id,is_active FROM users WHERE lower(email)=lower($1)',
          [data.ownerEmail]
        );
        if (!users.length) {
          if (!passwordHash)
            throw new AppError(
              'OWNER_PASSWORD_REQUIRED',
              'Informe uma senha inicial de pelo menos 12 caracteres para o novo OWNER.',
              400
            );
          ({ rows: users } = await client.query(
            `INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) RETURNING id,is_active`,
            [data.ownerEmail, data.ownerName, passwordHash]
          ));
        }
        if (!users[0].is_active)
          throw new AppError(
            'OWNER_INACTIVE',
            'Conta OWNER indisponível.',
            409
          );
        const { rows } = await client.query(
          `INSERT INTO stores(slug,name,custom_domain,status)
        VALUES($1,$2,$3,$4) RETURNING *`,
          [data.slug, data.name, data.customDomain ?? null, data.status]
        );
        const store = rows[0];
        await client.query(
          "INSERT INTO store_users(store_id,user_id,role) VALUES($1,$2,'OWNER')",
          [store.id, users[0].id]
        );
        for (const [role, keys] of Object.entries(FALLBACK_MATRIX)) {
          await client.query(
            `INSERT INTO role_permissions(store_id,role,permission_id)
          SELECT $1,$2,id FROM permissions WHERE key=ANY($3::text[])`,
            [store.id, role, keys]
          );
        }
        return store;
      })
    );
    await audit(request, 'platform.store.created', store.id, [
      'slug',
      'name',
      'status',
      'owner',
    ]);
    return reply.code(201).send({ store });
  });
  app.patch('/api/platform/stores/:id', async (request) => {
    const id = parse(z.string().uuid(), request.params.id);
    const data = parse(patchSchema, request.body);
    const mapping = {
      name: 'name',
      slug: 'slug',
      status: 'status',
      customDomain: 'custom_domain',
    };
    const entries = Object.entries(data);
    const { rows } = await uniqueConflict(() =>
      query(
        `UPDATE stores SET ${entries.map(([k], i) => `${mapping[k]}=$${i + 2}`).join(',')},updated_at=now()
      WHERE id=$1 RETURNING *`,
        [id, ...entries.map(([, v]) => v)]
      )
    );
    if (!rows.length)
      throw new AppError('NOT_FOUND', 'Loja não encontrada.', 404);
    await audit(request, 'platform.store.updated', id, Object.keys(data));
    return { store: rows[0] };
  });
  // Logical removal is suspension; historical orders and audit are never deleted.
  app.delete('/api/platform/stores/:id', async (request) => {
    const id = parse(z.string().uuid(), request.params.id);
    const { rows } = await query(
      "UPDATE stores SET status='suspended',updated_at=now() WHERE id=$1 RETURNING *",
      [id]
    );
    if (!rows.length)
      throw new AppError('NOT_FOUND', 'Loja não encontrada.', 404);
    await audit(request, 'platform.store.suspended', id, ['status']);
    return { store: rows[0] };
  });
  app.get('/api/platform/metrics', async () => {
    const { rows } = await query(`SELECT count(*)::int AS stores,
      count(*) FILTER (WHERE status='active')::int AS active,
      count(*) FILTER (WHERE status='pending')::int AS pending,
      count(*) FILTER (WHERE status='suspended')::int AS suspended,
      (SELECT count(*)::int FROM leads) AS leads FROM stores`);
    return { metrics: rows[0] };
  });
  app.get('/api/platform/leads', async (request) => {
    const { limit, offset } = parse(pageSchema, request.query);
    const { rows } = await query(
      'SELECT * FROM leads ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return { leads: rows, limit, offset };
  });
}
