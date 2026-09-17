/**
 * Provider de e-mail transacional configurável via env.
 * Credenciais nunca no código.
 *
 * EMAIL_PROVIDER=console|resend|none  (default: console em non-prod, none em prod sem chave)
 * EMAIL_FROM=noreply@seudominio.com
 * RESEND_API_KEY=re_...
 * APP_PUBLIC_URL=https://app.example.com  (links de verificação)
 */

import { log } from './logger.js';

export function getEmailProviderName() {
  if (process.env.EMAIL_PROVIDER) return process.env.EMAIL_PROVIDER.toLowerCase();
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.NODE_ENV === 'production') return 'none';
  return 'console';
}

export function isEmailConfigured() {
  const p = getEmailProviderName();
  if (p === 'console') return true;
  if (p === 'resend') return Boolean(process.env.RESEND_API_KEY?.trim());
  return false;
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string }}
 * @returns {Promise<{ ok: boolean, provider: string, id?: string, error?: string }>}
 */
export async function sendEmail({ to, subject, text, html }) {
  const provider = getEmailProviderName();
  const from = process.env.EMAIL_FROM || 'noreply@admin-restaurant.local';

  if (provider === 'none') {
    log.warn('email.skipped_no_provider', { to, subject });
    return { ok: false, provider, error: 'EMAIL_NOT_CONFIGURED' };
  }

  if (provider === 'console') {
    log.info('email.console', { from, to, subject, text: text?.slice(0, 500) });
    return { ok: true, provider: 'console', id: `console-${Date.now()}` };
  }

  if (provider === 'resend') {
    const key = process.env.RESEND_API_KEY?.trim();
    if (!key) {
      return { ok: false, provider, error: 'RESEND_API_KEY missing' };
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          text,
          html: html || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        log.error('email.resend_failed', { status: res.status, data });
        return { ok: false, provider, error: data?.message || res.statusText };
      }
      log.info('email.sent', { provider, to, id: data.id });
      return { ok: true, provider, id: data.id };
    } catch (err) {
      log.error('email.resend_error', { error: err.message });
      return { ok: false, provider, error: err.message };
    }
  }

  log.warn('email.unknown_provider', { provider });
  return { ok: false, provider, error: 'UNKNOWN_PROVIDER' };
}

export function buildVerificationEmail({ email, rawToken, storeName }) {
  const base = (process.env.APP_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
  const link = `${base}/verify-email?token=${encodeURIComponent(rawToken)}`;
  const subject = `Confirme seu e-mail — ${storeName || 'Admin Restaurant'}`;
  const text = [
    `Olá!`,
    ``,
    `Confirme o cadastro da loja${storeName ? ` "${storeName}"` : ''} clicando no link:`,
    link,
    ``,
    `Se você não solicitou, ignore este e-mail.`,
  ].join('\n');
  const html = `<p>Olá!</p><p>Confirme o cadastro${storeName ? ` da loja <strong>${storeName}</strong>` : ''}:</p><p><a href="${link}">${link}</a></p>`;
  return { to: email, subject, text, html, link };
}
