#!/usr/bin/env node
/** Trusted operator-only bootstrap; never exposed as an HTTP endpoint. */
import 'dotenv/config';
import { z } from 'zod';
import { pool, withTransaction } from '../src/infrastructure/db.js';
import { hashPassword } from '../src/modules/auth/password.js';

try {
  const result = z
    .object({
      email: z.string().trim().toLowerCase().email().max(254),
      name: z.string().trim().min(1).max(120),
      password: z.string().min(12).max(200),
    })
    .safeParse({
      email: process.env.PLATFORM_OWNER_EMAIL,
      name: process.env.PLATFORM_OWNER_NAME || 'Platform Owner',
      password: process.env.PLATFORM_OWNER_PASSWORD,
    });
  if (!result.success)
    throw new Error(
      'Configure PLATFORM_OWNER_EMAIL e PLATFORM_OWNER_PASSWORD (mínimo 12 caracteres) no ambiente seguro.'
    );
  const { email, name, password } = result.data;
  const passwordHash = await hashPassword(password);
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id,is_active FROM users WHERE lower(email)=lower($1) FOR UPDATE',
      [email]
    );
    if (rows.length) {
      if (!rows[0].is_active)
        throw new Error(
          'Conta inativa: revise a identidade antes de conceder acesso.'
        );
      await client.query(
        'UPDATE users SET is_platform_owner=true,updated_at=now() WHERE id=$1',
        [rows[0].id]
      );
    } else {
      await client.query(
        'INSERT INTO users(email,name,password_hash,is_platform_owner) VALUES($1,$2,$3,true)',
        [email, name, passwordHash]
      );
    }
  });
  console.log(
    'PLATFORM_OWNER provisionado. Contas existentes mantêm a senha. Nenhum vínculo de loja foi criado.'
  );
} catch (err) {
  console.error(
    err.code
      ? 'Falha no bootstrap. Verifique migrations e configuração do banco.'
      : err.message
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
