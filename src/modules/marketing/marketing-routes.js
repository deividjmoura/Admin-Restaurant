import { z } from 'zod';
import { query } from '../../infrastructure/db.js';
import { AppError } from '../../shared/errors.js';

// Plain text only: no HTML is stored or rendered as markup.
const cleanText = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[<>\x00-\x1f]/.test(v));
const leadSchema = z
  .object({
    name: cleanText(120),
    email: z.string().trim().toLowerCase().email().max(254),
    businessName: cleanText(120),
    message: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine((v) => !/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))
      .optional(),
  })
  .strict();

export default async function marketingRoutes(app) {
  app.get('/api/public/health', async () => ({ status: 'ok' }));
  app.post(
    '/api/leads',
    {
      bodyLimit: 8192,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      preHandler: [
        async (request) => {
          if (!request.isMarketing || request.storeId) {
            throw new AppError(
              'CONTEXT_FORBIDDEN',
              'Disponível apenas no site público.',
              403
            );
          }
        },
      ],
    },
    async (request, reply) => {
      const result = leadSchema.safeParse(request.body);
      if (!result.success)
        throw new AppError(
          'VALIDATION_ERROR',
          'Dados de contato inválidos.',
          400
        );
      const { name, email, businessName, message } = result.data;
      await query(
        'INSERT INTO leads(name,email,business_name,message) VALUES($1,$2,$3,$4)',
        [name, email, businessName, message || '']
      );
      return reply.code(201).send({ ok: true });
    }
  );
}
