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
  return process.env.THUMBGATE_TRIAL_EMAIL_FROM || process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
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
  const headline = 'Your 7-day ThumbGate Pro trial is live.';
  const description =
    'ThumbGate turns thumbs up/down feedback into Pre-Action Gates that stop repeated AI coding mistakes before the next tool call. ' +
    'It keeps lessons local and turns repeated mistakes into Reliability Gateway blocks.';
  const exampleFeedback =
    'thumbs down: the answer skipped exact files and tests; next time include paths, commands, and verification evidence.';
  const proofUrl = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md';

  const text = [
    headline,
    '',
    description,
    '',
    'Next 3 minutes:',
    '1. Activate Pro locally:',
    activationCommand,
    '',
    `2. Open your dashboard: ${DASHBOARD_URL}`,
    '',
    '3. Give one concrete thumbs up or thumbs down:',
    exampleFeedback,
    '',
    'Your trial key:',
    licenseKey,
    '',
    `Verification evidence: ${proofUrl}`,
    '',
    customerId ? `Customer ID (for support): ${customerId}` : '',
    '',
    `Keep this key private. Questions? Reply to this email or write ${SUPPORT_EMAIL}.`,
  ].filter((line) => line !== undefined).join('\n');

  const safeKey = escapeHtml(licenseKey);
  const safeCmd = escapeHtml(activationCommand);
  const safeCustomer = customerId ? escapeHtml(customerId) : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f5f7fb;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#17212b;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Activate Pro in one command, open the dashboard, and start blocking repeated AI coding mistakes.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;max-width:640px;background:#ffffff;border:1px solid #d8e2ea;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:#071115;padding:22px 26px;color:#e7fbff;">
                <div style="font-size:13px;font-weight:700;letter-spacing:0;text-transform:uppercase;color:#73d4e9;">${PRODUCT_NAME}</div>
                <h1 style="margin:12px 0 10px;font-size:28px;line-height:1.15;color:#ffffff;">${escapeHtml(headline)}</h1>
                <p style="margin:0;font-size:15px;line-height:1.6;color:#c6d6de;">${escapeHtml(description)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px;">
                <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#344451;">Run one command, open the dashboard, then give one concrete thumb signal. ThumbGate keeps the lesson local and turns repeated mistakes into Reliability Gateway blocks.</p>
                <p style="margin:0 0 24px;">
                  <a href="${DASHBOARD_URL}" style="display:inline-block;background:#45bfd8;color:#061015;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:6px;">Open your dashboard</a>
                </p>

                <h2 style="margin:0 0 8px;font-size:17px;line-height:1.3;color:#17212b;">1. Activate Pro locally</h2>
                <pre style="margin:0 0 22px;background:#081016;color:#d8f7e4;border:1px solid #23343d;border-radius:6px;padding:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;"><code>${safeCmd}</code></pre>

                <h2 style="margin:0 0 8px;font-size:17px;line-height:1.3;color:#17212b;">2. Save your trial key</h2>
                <pre style="margin:0 0 22px;background:#eef6f7;color:#0b343c;border:1px solid #c7e2e7;border-radius:6px;padding:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;"><code>${safeKey}</code></pre>

                <h2 style="margin:0 0 8px;font-size:17px;line-height:1.3;color:#17212b;">3. Give one concrete thumbs up or thumbs down</h2>
                <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#344451;">Start with the failure you most want your agent to stop repeating.</p>
                <pre style="margin:0 0 24px;background:#f1fff2;color:#22602b;border:1px solid #bae7c0;border-radius:6px;padding:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;"><code>${escapeHtml(exampleFeedback)}</code></pre>

                ${safeCustomer ? `<p style="font-size:12px;color:#7a8790;margin:0 0 12px;">Customer ID: <code>${safeCustomer}</code></p>` : ''}

                <p style="margin:0;font-size:13px;line-height:1.6;color:#526273;">
                  Proof trail: <a href="${proofUrl}" style="color:#087a91;">verification evidence</a>.
                  Keep this key private. Questions? Reply here or write
                  <a href="mailto:${SUPPORT_EMAIL}" style="color:#087a91;">${SUPPORT_EMAIL}</a>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
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
  const subject = 'Your 7-day ThumbGate Pro trial is live';

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
