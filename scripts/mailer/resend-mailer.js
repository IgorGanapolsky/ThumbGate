'use strict';

/**
 * scripts/mailer/resend-mailer.js
 *
 * Minimal Resend-backed email sender for ThumbGate transactional emails.
 *
 * Design goals:
 *  - Zero-dep: uses global `fetch` (Node 18+) to hit https://api.resend.com/emails.
 *  - Gracefully optional: if RESEND_API_KEY is unset, sends are skipped with a
 *    logged warning and the caller receives `{ sent: false, reason: 'no_api_key' }`.
 *    This prevents the Stripe webhook from failing when email is not configured.
 *  - Testable: accepts an injectable `fetch` implementation via opts.fetchImpl.
 */

const PRODUCT_NAME = 'ThumbGate Pro';
const DASHBOARD_URL = 'https://thumbgate-production.up.railway.app/dashboard';
const SUPPORT_EMAIL = 'hello@thumbgate.app';
const DEFAULT_FROM = 'onboarding@resend.dev';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function getApiKey() {
  return process.env.RESEND_API_KEY || '';
}

function getFromAddress() {
  return process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Low-level send. Posts to the Resend API or no-ops when RESEND_API_KEY is
 * missing. Never throws on network errors; returns a structured result instead.
 */
async function sendEmail({ to, subject, html, text, from, fetchImpl } = {}) {
  if (!isNonEmptyString(to)) throw new Error('sendEmail: `to` is required');
  if (!isNonEmptyString(subject)) throw new Error('sendEmail: `subject` is required');
  if (!isNonEmptyString(html) && !isNonEmptyString(text)) {
    throw new Error('sendEmail: at least one of `html` or `text` is required');
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn('[mailer] RESEND_API_KEY not set — skipping send to', to);
    return { sent: false, reason: 'no_api_key' };
  }

  const payload = {
    from: from || getFromAddress(),
    to: Array.isArray(to) ? to : [to],
    subject,
  };
  if (isNonEmptyString(html)) payload.html = html;
  if (isNonEmptyString(text)) payload.text = text;

  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== 'function') {
    // eslint-disable-next-line no-console
    console.warn('[mailer] global fetch not available — skipping send');
    return { sent: false, reason: 'no_fetch' };
  }

  try {
    const res = await fetcher(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const bodyText = typeof res.text === 'function' ? await res.text() : '';
    let bodyJson = null;
    if (bodyText) {
      try { bodyJson = JSON.parse(bodyText); } catch (_) { /* leave as text */ }
    }

    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[mailer] Resend returned ${res.status}:`, bodyText);
      return { sent: false, reason: 'api_error', status: res.status, body: bodyJson || bodyText };
    }

    return { sent: true, id: bodyJson && bodyJson.id ? bodyJson.id : null, status: res.status };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[mailer] send failed:', err && err.message ? err.message : err);
    return { sent: false, reason: 'exception', error: err && err.message ? err.message : String(err) };
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTrialWelcomeBodies({ licenseKey, customerId }) {
  const activationCommand = `npx thumbgate pro --activate --key=${licenseKey}`;
  const description =
    'ThumbGate Pro adds pre-action gates, prevention rules, and lesson memory to your AI coding agent. ' +
    'Every thumbs-down becomes a rule that blocks the same mistake from happening again.';

  const text = [
    `Welcome to ${PRODUCT_NAME}.`,
    '',
    description,
    '',
    'Your license key:',
    licenseKey,
    '',
    'Activate in any project:',
    activationCommand,
    '',
    `Dashboard: ${DASHBOARD_URL}`,
    '',
    customerId ? `Customer ID (for support): ${customerId}` : '',
    '',
    `Need help? Reply to this email or write to ${SUPPORT_EMAIL}.`,
  ].filter((line) => line !== undefined).join('\n');

  const safeKey = escapeHtml(licenseKey);
  const safeCmd = escapeHtml(activationCommand);
  const safeCustomer = customerId ? escapeHtml(customerId) : '';

  const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="font-size:20px;margin:0 0 12px;">Welcome to ${PRODUCT_NAME}</h1>
    <p style="margin:0 0 16px;">${escapeHtml(description)}</p>

    <h2 style="font-size:15px;margin:24px 0 8px;">Your license key</h2>
    <pre style="background:#f5f5f7;border:1px solid #e5e5ea;border-radius:6px;padding:12px;font-size:13px;overflow:auto;"><code>${safeKey}</code></pre>

    <h2 style="font-size:15px;margin:24px 0 8px;">Activate in any project</h2>
    <pre style="background:#0b0b0e;color:#e8e8ef;border-radius:6px;padding:12px;font-size:13px;overflow:auto;"><code>${safeCmd}</code></pre>

    <p style="margin:24px 0 16px;">
      <a href="${DASHBOARD_URL}" style="display:inline-block;background:#0a84ff;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;">Open your dashboard</a>
    </p>

    ${safeCustomer ? `<p style="font-size:12px;color:#666;margin:16px 0 0;">Customer ID (for support): <code>${safeCustomer}</code></p>` : ''}

    <hr style="border:none;border-top:1px solid #e5e5ea;margin:32px 0 16px;">
    <p style="font-size:12px;color:#666;margin:0;">
      Need help? Reply to this email or write to
      <a href="mailto:${SUPPORT_EMAIL}" style="color:#0a84ff;">${SUPPORT_EMAIL}</a>.
    </p>
  </body>
</html>`;

  return { html, text, activationCommand };
}

/**
 * High-level helper: send the trial / checkout welcome email with the license key.
 *
 * Returns the same shape as sendEmail. Never throws on send failures (beyond
 * input validation) — the Stripe webhook must keep working even if email breaks.
 */
async function sendTrialWelcomeEmail({ to, licenseKey, customerId, fetchImpl } = {}) {
  if (!isNonEmptyString(to)) throw new Error('sendTrialWelcomeEmail: `to` is required');
  if (!isNonEmptyString(licenseKey)) throw new Error('sendTrialWelcomeEmail: `licenseKey` is required');

  const { html, text } = renderTrialWelcomeBodies({ licenseKey, customerId });
  const subject = 'Welcome to ThumbGate Pro — your license key inside';

  return sendEmail({ to, subject, html, text, fetchImpl });
}

module.exports = {
  sendEmail,
  sendTrialWelcomeEmail,
  renderTrialWelcomeBodies,
  _constants: {
    PRODUCT_NAME,
    DASHBOARD_URL,
    SUPPORT_EMAIL,
    DEFAULT_FROM,
    RESEND_ENDPOINT,
  },
};
