import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * Hash password with scrypt.
 * Format stored: saltHex:hashHex
 */
export async function hashPassword(plain) {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(plain, salt, KEYLEN);
  return `${salt.toString('hex')}:${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(plain, stored) {
  if (!plain || !stored || typeof stored !== 'string') return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scryptAsync(plain, salt, expected.length);

  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}
