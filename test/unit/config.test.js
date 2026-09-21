/**
 * SEC-01 — config fail-closed
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadConfig,
  resetConfigForTests,
  WEAK_SECRET,
} from '../../src/config.js';

const STRONG = 'a'.repeat(48);

describe('SEC-01 config fail-closed', () => {
  const original = { ...process.env };

  beforeEach(() => {
    resetConfigForTests();
    for (const k of [
      'NODE_ENV',
      'JWT_SECRET',
      'COOKIE_SECRET',
      'CORS_ORIGIN',
      'FRONTEND_ORIGIN',
      'DATABASE_URL',
      'BASE_DOMAIN',
    ]) {
      delete process.env[k];
    }
  });

  afterEach(() => {
    resetConfigForTests();
    for (const k of Object.keys(process.env)) {
      if (!(k in original)) delete process.env[k];
    }
    Object.assign(process.env, original);
  });

  it('rejects missing NODE_ENV', () => {
    assert.throws(
      () => loadConfig({ JWT_SECRET: STRONG, COOKIE_SECRET: STRONG }),
      /NODE_ENV/
    );
  });

  it('rejects short JWT_SECRET', () => {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'development',
          JWT_SECRET: 'short',
          COOKIE_SECRET: STRONG,
        }),
      /JWT_SECRET/
    );
  });

  it('rejects placeholder JWT_SECRET (troque-por)', () => {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'development',
          JWT_SECRET: 'troque-por-um-segredo-longo-e-aleatorio-xx',
          COOKIE_SECRET: STRONG,
        }),
      /placeholder|JWT_SECRET/
    );
  });

  it('rejects change-me cookie secret', () => {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'test',
          JWT_SECRET: STRONG,
          COOKIE_SECRET: 'dev-cookie-secret-change-me!!!!!!!!!!!!!',
        }),
      /COOKIE_SECRET|placeholder/
    );
  });

  it('rejects production without CORS_ORIGIN', () => {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'production',
          JWT_SECRET: STRONG,
          COOKIE_SECRET: STRONG,
          DATABASE_URL: 'postgres://u:p@localhost/db',
        }),
      /CORS_ORIGIN/
    );
  });

  it('accepts valid development config', () => {
    const cfg = loadConfig({
      NODE_ENV: 'development',
      JWT_SECRET: STRONG,
      COOKIE_SECRET: STRONG + 'x',
    });
    assert.equal(cfg.isDev, true);
    assert.equal(cfg.JWT_SECRET, STRONG);
  });

  it('accepts valid production config', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: STRONG,
      COOKIE_SECRET: STRONG + 'y',
      CORS_ORIGIN: 'https://app.example.com',
      DATABASE_URL: 'postgres://u:p@localhost/db',
    });
    assert.equal(cfg.isProd, true);
  });

  it('WEAK_SECRET matches known placeholders', () => {
    assert.ok(WEAK_SECRET.test('troque-por-um-segredo'));
    assert.ok(WEAK_SECRET.test('dev-only-jwt-secret-change-me-32chars!!'));
    assert.ok(!WEAK_SECRET.test(STRONG));
  });
});
