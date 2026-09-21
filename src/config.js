/**
 * Configuração de ambiente fail-closed.
 * Qualquer secret fraco, placeholder ou ausência de NODE_ENV derruba o boot.
 */
import { z } from 'zod';

const WEAK_SECRET =
  /(troque|change-?me|dev-only|example|secret123|password|changeme|placeholder)/i;

function secretField(name) {
  return z
    .string({ required_error: `${name} é obrigatório` })
    .min(32, `${name} deve ter no mínimo 32 caracteres`)
    .refine((v) => !WEAK_SECRET.test(v), {
      message: `${name} parece um placeholder/fraco — gere um valor aleatório`,
    });
}

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production'], {
      required_error: 'NODE_ENV é obrigatório (development|test|production)',
      invalid_type_error: 'NODE_ENV inválido (development|test|production)',
    }),
    JWT_SECRET: secretField('JWT_SECRET'),
    COOKIE_SECRET: secretField('COOKIE_SECRET'),
    BASE_DOMAIN: z.string().min(1, 'BASE_DOMAIN é obrigatório').optional(),
    CORS_ORIGIN: z.string().optional(),
    FRONTEND_ORIGIN: z.string().optional(),
    DATABASE_URL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      const cors = (env.CORS_ORIGIN || env.FRONTEND_ORIGIN || '').trim();
      if (!cors) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CORS_ORIGIN (ou FRONTEND_ORIGIN) é obrigatório em production',
          path: ['CORS_ORIGIN'],
        });
      }
      if (!env.DATABASE_URL || !String(env.DATABASE_URL).trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DATABASE_URL é obrigatório em production',
          path: ['DATABASE_URL'],
        });
      }
    }
  });

/**
 * Parseia process.env. Lança com mensagem clara se inválido.
 * Em testes, defina NODE_ENV/JWT_SECRET/COOKIE_SECRET antes do import.
 */
export function loadConfig(env = process.env) {
  const result = EnvSchema.safeParse({
    NODE_ENV: env.NODE_ENV,
    JWT_SECRET: env.JWT_SECRET,
    COOKIE_SECRET: env.COOKIE_SECRET,
    BASE_DOMAIN: env.BASE_DOMAIN,
    CORS_ORIGIN: env.CORS_ORIGIN,
    FRONTEND_ORIGIN: env.FRONTEND_ORIGIN,
    DATABASE_URL: env.DATABASE_URL,
  });

  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`)
      .join('\n');
    const err = new Error(`Configuração inválida:\n${details}`);
    err.code = 'CONFIG_INVALID';
    err.issues = result.error.issues;
    throw err;
  }

  return {
    ...result.data,
    isProd: result.data.NODE_ENV === 'production',
    isTest: result.data.NODE_ENV === 'test',
    isDev: result.data.NODE_ENV === 'development',
  };
}

/** Singleton lazy — permite testes setarem env antes do primeiro acesso. */
let _config = null;

export function getConfig() {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/** Só para testes: força reparse no próximo getConfig(). */
export function resetConfigForTests() {
  _config = null;
}

export { WEAK_SECRET };
