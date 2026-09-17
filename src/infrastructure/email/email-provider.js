/**
 * Provider de e-mail transacional — T10 (infra-email)
 * Substitui verification.devToken (TODO #59)
 *
 * Env:
 * - EMAIL_PROVIDER=mock|resend|smtp|ses (default: mock)
 * - EMAIL_FROM (ex: "Lanchonete <noreply@seudominio.com>")
 * - RESEND_API_KEY (para resend)
 * - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE (para smtp)
 * - AWS_SES_* (para ses, futuro)
 * - APP_URL / BASE_DOMAIN para montar link de verificação
 *
 * Nunca commitar credenciais. Em CI/dev sem provider, usa mock (só loga).
 */

function getProviderName(env = process.env) {
  const raw = (env.EMAIL_PROVIDER || env.EMAIL_SERVICE || 'mock').toLowerCase();
  if (['resend', 'smtp', 'ses', 'mock', 'log'].includes(raw)) return raw;
  return 'mock';
}

export async function sendEmail({ to, subject, html, text, from }) {
  const provider = getProviderName();
  const fromAddr = from || process.env.EMAIL_FROM || 'Admin Restaurant <noreply@localhost>';

  if (provider === 'resend') {
    return sendViaResend({ to, subject, html, text, from: fromAddr });
  }
  if (provider === 'smtp') {
    return sendViaSmtp({ to, subject, html, text, from: fromAddr });
  }
  if (provider === 'ses') {
    // SES não implementado ainda — fallback mock com aviso
    console.warn('[email] SES provider not yet implemented, using mock');
    return sendViaMock({ to, subject, html, text, from: fromAddr });
  }
  return sendViaMock({ to, subject, html, text, from: fromAddr });
}

async function sendViaResend({ to, subject, html, text, from }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set, using mock');
    return sendViaMock({ to, subject, html, text, from });
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html: html || `<p>${text || ''}</p>`,
        text,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn('[email] resend failed, mock fallback', { status: res.status, data });
      return sendViaMock({ to, subject, html, text, from });
    }
    return { provider: 'resend', id: data.id || null, mocked: false };
  } catch (err) {
    console.warn('[email] resend fetch failed, mock fallback', err.message);
    return sendViaMock({ to, subject, html, text, from });
  }
}

async function sendViaSmtp({ to, subject, html, text, from }) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn('[email] SMTP env incomplete (SMTP_HOST/USER/PASS), using mock');
    return sendViaMock({ to, subject, html, text, from });
  }
  // Tenta usar nodemailer se instalado; senão mock
  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: { user, pass },
    });
    const info = await transporter.sendMail({
      from,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html: html || `<p>${text || ''}</p>`,
    });
    return { provider: 'smtp', id: info.messageId || null, mocked: false };
  } catch (err) {
    // nodemailer não instalado ou falha — mock
    if (err.code === 'ERR_MODULE_NOT_FOUND' || String(err.message).includes('Cannot find')) {
      console.warn('[email] nodemailer not installed, using mock (install nodemailer for SMTP)');
    } else {
      console.warn('[email] smtp failed, mock fallback', err.message);
    }
    return sendViaMock({ to, subject, html, text, from });
  }
}

async function sendViaMock({ to, subject, html, text, from }) {
  // Em testes/CI/dev, só loga. Retorna mocked:true para que o caller saiba que não é real.
  console.info('[email:mock] to=%s subject=%s from=%s', to, subject, from);
  if (text) console.info('[email:mock] text=%s', text.slice(0, 200));
  return { provider: 'mock', id: `mock_${Date.now()}`, mocked: true };
}

export async function sendVerificationEmail({ to, storeName, verificationToken, verificationUrl }) {
  const appUrl = process.env.APP_URL || (process.env.BASE_DOMAIN ? `https://${process.env.BASE_DOMAIN}` : 'http://localhost:5173');
  const url = verificationUrl || `${appUrl.replace(/\/$/, '')}/verify?token=${encodeURIComponent(verificationToken)}`;
  const subject = `Confirme seu e-mail — ${storeName || 'sua loja'}`;
  const text = `Olá!\n\nConfirme seu e-mail para ativar a loja "${storeName || ''}".\n\nToken: ${verificationToken}\nLink: ${url}\n\nExpira em 24h.\nSe você não criou esta loja, ignore.`;
  const html = `
    <div style="font-family: sans-serif; max-width: 560px; margin: auto;">
      <h2>Confirme seu e-mail</h2>
      <p>Para ativar a loja <strong>${storeName || ''}</strong>, confirme seu e-mail:</p>
      <p><a href="${url}" style="background:#f59e0b;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">Confirmar e-mail</a></p>
      <p>Ou copie o token: <code>${verificationToken}</code></p>
      <p>Link: <a href="${url}">${url}</a></p>
      <p style="font-size:12px;color:#888;">Expira em 24h. Se você não criou esta loja, ignore.</p>
    </div>
  `;
  return sendEmail({ to, subject, html, text });
}
