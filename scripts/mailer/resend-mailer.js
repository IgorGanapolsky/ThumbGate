'use strict';

/**
 * scripts/mailer/resend-mailer.js
 *
 * Resend-backed transactional email sender for ThumbGate.
 *
 * Design goals:
 *  - Zero-dep: uses global `fetch` (Node 18+) to hit https://api.resend.com/emails.
 *  - Gracefully optional: if RESEND_API_KEY is unset, sends are skipped with a
 *    logged warning and the caller receives `{ sent: false, reason: 'no_api_key' }`.
 *    This prevents the Stripe webhook from failing when email is not configured.
 *  - Testable: accepts an injectable `fetch` implementation via opts.fetchImpl.
 *  - CAN-SPAM compliant: every commercial email carries business name, physical
 *    address, and a functional unsubscribe method.
 */

const dns = require('node:dns').promises;

const PRODUCT_NAME = 'ThumbGate Pro';
const DASHBOARD_URL = 'https://thumbgate-production.up.railway.app/dashboard';
const DEFAULT_CONTACT_EMAIL = 'igor.ganapolsky@gmail.com';
const DEFAULT_FROM = 'onboarding@resend.dev';
const DEFAULT_REPLY_TO = DEFAULT_CONTACT_EMAIL;
const DEFAULT_UNSUBSCRIBE_EMAIL = DEFAULT_CONTACT_EMAIL;
const DEFAULT_BUSINESS_NAME = 'Max Smith KDP LLC';
// CAN-SPAM requires a physical mailing address. Override via THUMBGATE_BUSINESS_ADDRESS.
const DEFAULT_BUSINESS_ADDRESS = '2261 Market Street #4242, San Francisco, CA 94114';
// Hosted PNG that email clients (Gmail, Outlook) will proxy. SVG is stripped from most email HTML.
const BRAND_MARK_URL = 'https://thumbgate-production.up.railway.app/thumbgate-icon.png';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const TRIAL_LENGTH_DAYS = 7;
const SENDER_DNS_CACHE_MS = 10 * 60 * 1000;
// Bounded to RFC 5321 limits (local-part ≤ 64, domain ≤ 255) to prevent
// super-linear backtracking on malformed input (Sonar javascript:S5852).
const ANGLE_EMAIL_RE = /<([^<>@\s]{1,64}@[^<>@\s]{1,255})>/;
const BARE_EMAIL_RE = /([^\s<>@]{1,64}@[^\s<>@]{1,255})/;
const DKIM_PUBLIC_KEY_RE = /^p=/i;
// Resend fronts outbound mail with Amazon SES; the MX for send.<domain> points
// at feedback-smtp.<region>.amazonses.com. Earlier revisions of this regex
// mistakenly matched `amazonaws.com`, so the positive branch never fired in
// production. Matching `amazonses.com` (optionally with a trailing dot) is
// what Resend's DNS setup wizard actually publishes.
const AMAZON_SES_MX_RE = /feedback-smtp\..*amazonses\.com\.?$/i;
const AMAZON_SES_SPF_RE = /include:amazonses\.com/i;
const TRAILING_EMAIL_DOMAIN_PUNCTUATION = new Set(['>', ')', ',', '.', ';']);
const senderDnsCache = new Map();

function getApiKey() {
  // Accept both `RESEND_API_KEY` (Railway default, matches provider docs) and
  // the `THUMBGATE_`-prefixed variant that `scripts/billing.js` already honors.
  // Keeping the two readers in sync prevents a silent "skipped: no_api_key"
  // regression if an operator sets only the prefixed name.
  return process.env.RESEND_API_KEY || process.env.THUMBGATE_RESEND_API_KEY || '';
}

function getFromAddress() {
  return process.env.THUMBGATE_TRIAL_EMAIL_FROM || process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
}

function getReplyTo() {
  return process.env.THUMBGATE_TRIAL_EMAIL_REPLY_TO || DEFAULT_REPLY_TO;
}

function getSupportEmail() {
  return process.env.THUMBGATE_SUPPORT_EMAIL || getReplyTo();
}

function getUnsubscribeEmail() {
  return process.env.THUMBGATE_UNSUBSCRIBE_EMAIL || DEFAULT_UNSUBSCRIBE_EMAIL;
}

function getBusinessName() {
  return process.env.THUMBGATE_BUSINESS_NAME || DEFAULT_BUSINESS_NAME;
}

function getBusinessAddress() {
  return process.env.THUMBGATE_BUSINESS_ADDRESS || DEFAULT_BUSINESS_ADDRESS;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTrueEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function extractEmailAddress(value) {
  const text = String(value || '').trim();
  const angleMatch = ANGLE_EMAIL_RE.exec(text);
  if (angleMatch) return angleMatch[1];
  const bareMatch = BARE_EMAIL_RE.exec(text);
  return bareMatch ? bareMatch[1] : '';
}

function getEmailDomain(value) {
  const email = extractEmailAddress(value);
  const at = email.lastIndexOf('@');
  if (at === -1) return '';
  let domain = email.slice(at + 1).trim();
  while (domain && TRAILING_EMAIL_DOMAIN_PUNCTUATION.has(domain.at(-1))) {
    domain = domain.slice(0, -1);
  }
  return domain.toLowerCase();
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function getVerifiedSenderDomains() {
  return new Set(splitCsv(process.env.THUMBGATE_VERIFIED_SENDER_DOMAINS));
}

function flattenTxt(records) {
  return (records || []).map((chunks) => Array.isArray(chunks) ? chunks.join('') : String(chunks));
}

function getCachedSenderDnsReadiness(cacheKey) {
  if (!cacheKey) return null;
  const cached = senderDnsCache.get(cacheKey);
  return cached && cached.expiresAt > Date.now() ? cached.ready : null;
}

function setCachedSenderDnsReadiness(cacheKey, ready) {
  if (cacheKey) senderDnsCache.set(cacheKey, { ready, expiresAt: Date.now() + SENDER_DNS_CACHE_MS });
  return ready;
}

async function readResendDnsRecords(domain, resolver) {
  try {
    const [dkimRecords, mxRecords, spfRecords] = await Promise.all([
      resolver.resolveTxt(`resend._domainkey.${domain}`),
      resolver.resolveMx(`send.${domain}`),
      resolver.resolveTxt(`send.${domain}`),
    ]);
    return { dkimRecords, mxRecords, spfRecords, errorCode: null };
  } catch (error) {
    return {
      dkimRecords: [],
      mxRecords: [],
      spfRecords: [],
      errorCode: error && error.code ? error.code : 'dns_lookup_failed',
    };
  }
}

function recordsHaveResendDns({ dkimRecords, mxRecords, spfRecords }) {
  const dkim = flattenTxt(dkimRecords);
  const spf = flattenTxt(spfRecords);
  return dkim.some((record) => DKIM_PUBLIC_KEY_RE.exec(record.trim()) !== null) &&
    (mxRecords || []).some((record) => AMAZON_SES_MX_RE.exec(record.exchange || '') !== null) &&
    spf.some((record) => AMAZON_SES_SPF_RE.exec(record) !== null);
}

async function hasResendSenderDns(domain, { dnsResolver } = {}) {
  if (!domain || domain === 'resend.dev') return true;
  if (isTrueEnv(process.env.THUMBGATE_ALLOW_UNVERIFIED_SENDER)) return true;
  if (getVerifiedSenderDomains().has(domain)) return true;

  const cacheKey = dnsResolver ? null : domain;
  const cached = getCachedSenderDnsReadiness(cacheKey);
  if (cached !== null) return cached;

  const records = await readResendDnsRecords(domain, dnsResolver || dns);
  return setCachedSenderDnsReadiness(cacheKey, !records.errorCode && recordsHaveResendDns(records));
}

async function resolveSenderAddress(requestedFrom, { dnsResolver } = {}) {
  const from = requestedFrom || getFromAddress();
  const domain = getEmailDomain(from);
  const ready = await hasResendSenderDns(domain, { dnsResolver });
  if (ready) return { from, senderFallback: null };

  return {
    from: DEFAULT_FROM,
    senderFallback: {
      requestedFrom: from,
      fallbackFrom: DEFAULT_FROM,
      domain,
      reason: 'resend_dns_not_ready',
    },
  };
}

function validateSendEmailInput({ to, subject, html, text }) {
  if (!isNonEmptyString(to)) throw new Error('sendEmail: `to` is required');
  if (!isNonEmptyString(subject)) throw new Error('sendEmail: `subject` is required');
  if (!isNonEmptyString(html) && !isNonEmptyString(text)) {
    throw new Error('sendEmail: at least one of `html` or `text` is required');
  }
}

function warnSenderFallback(senderFallback) {
  if (!senderFallback) return;
  // eslint-disable-next-line no-console
  console.warn(
    `[mailer] Sender domain ${senderFallback.domain || '(unknown)'} is missing Resend DNS; ` +
    `falling back to ${senderFallback.fallbackFrom}`,
  );
}

function buildEmailPayload({ to, subject, html, text, replyTo, sender }) {
  const payload = {
    from: sender.from,
    to: Array.isArray(to) ? to : [to],
    subject,
    reply_to: replyTo || getReplyTo(),
  };
  if (isNonEmptyString(html)) payload.html = html;
  if (isNonEmptyString(text)) payload.text = text;
  return payload;
}

function parseJsonOrNull(bodyText) {
  if (!bodyText) return null;
  try {
    return JSON.parse(bodyText);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
}

async function postResendEmail({ fetcher, apiKey, payload }) {
  const res = await fetcher(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  const bodyText = typeof res.text === 'function' ? await res.text() : '';
  return { res, bodyText, bodyJson: parseJsonOrNull(bodyText) };
}

function formatSendFailure(error) {
  return error && error.message ? error.message : String(error);
}

function buildSendSuccess({ bodyJson, status, senderFallback }) {
  return {
    sent: true,
    id: bodyJson?.id || null,
    status,
    ...(senderFallback ? { senderFallback } : {}),
  };
}

/**
 * Low-level send. Posts to the Resend API or no-ops when RESEND_API_KEY is
 * missing. Never throws on network errors; returns a structured result instead.
 */
async function sendEmail({ to, subject, html, text, from, replyTo, fetchImpl, dnsResolver } = {}) {
  validateSendEmailInput({ to, subject, html, text });

  const apiKey = getApiKey();
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn('[mailer] RESEND_API_KEY not set — skipping send to', to);
    return { sent: false, reason: 'no_api_key' };
  }

  const sender = await resolveSenderAddress(from || getFromAddress(), { dnsResolver });
  warnSenderFallback(sender.senderFallback);
  const payload = buildEmailPayload({ to, subject, html, text, replyTo, sender });

  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== 'function') {
    // eslint-disable-next-line no-console
    console.warn('[mailer] global fetch not available — skipping send');
    return { sent: false, reason: 'no_fetch' };
  }

  try {
    const { res, bodyText, bodyJson } = await postResendEmail({ fetcher, apiKey, payload });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[mailer] Resend returned ${res.status}:`, bodyText);
      return { sent: false, reason: 'api_error', status: res.status, body: bodyJson || bodyText };
    }
    return buildSendSuccess({ bodyJson, status: res.status, senderFallback: sender.senderFallback });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[mailer] send failed:', formatSendFailure(err));
    return { sent: false, reason: 'exception', error: formatSendFailure(err) };
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

function firstName(full) {
  if (!isNonEmptyString(full)) return '';
  const trimmed = full.trim();
  const first = trimmed.split(/\s+/)[0] || '';
  // Never use email-looking strings as a name.
  if (/@/.test(first)) return '';
  return first;
}

function formatTrialEndDate(trialEndAt) {
  let d;
  if (trialEndAt instanceof Date) d = trialEndAt;
  else if (typeof trialEndAt === 'number') d = new Date(trialEndAt);
  else if (typeof trialEndAt === 'string' && trialEndAt) d = new Date(trialEndAt);
  else {
    d = new Date();
    d.setUTCDate(d.getUTCDate() + TRIAL_LENGTH_DAYS);
  }
  if (Number.isNaN(d.getTime())) {
    d = new Date();
    d.setUTCDate(d.getUTCDate() + TRIAL_LENGTH_DAYS);
  }
  // Render as "Apr 24, 2026" (UTC) — avoids locale surprises on server.
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}

function renderTrialWelcomeBodies({ licenseKey, customerId, customerName } = {}) {
  const activationCommand = `npx thumbgate pro --activate --key=${licenseKey}`;
  const name = firstName(customerName);
  const greeting = name ? `Hi ${name},` : 'Hi there,';
  const headline = 'Your ThumbGate Pro subscription is live.';
  const subhead = 'Your paid Pro access is active. Activate the local dashboard whenever you are ready.';
  const description =
    'ThumbGate turns thumbs up/down feedback into Pre-Action Checks that stop repeated AI coding mistakes ' +
    'before the next tool call. Lessons stay on your machine. Repeated failures become Reliability Gateway blocks.';
  const exampleFeedback =
    'thumbs down: the answer skipped exact files and tests; next time include paths, commands, and verification evidence.';
  const proofUrl = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md';
  const supportEmail = getSupportEmail();
  const unsubscribeEmail = getUnsubscribeEmail();
  const businessName = getBusinessName();
  const businessAddress = getBusinessAddress();
  const unsubscribeMailto = `mailto:${unsubscribeEmail}?subject=unsubscribe&body=Please%20remove%20me%20from%20ThumbGate%20emails.`;
  const postscript =
    `P.S. The first 10 minutes are the best time to catch your agent's most-repeated failure. ` +
    `Open the dashboard, give one concrete thumbs down on a mistake you've seen twice, and watch ThumbGate build the gate.`;

  const text = [
    greeting,
    '',
    headline,
    subhead,
    '',
    description,
    '',
    'Your first 10 minutes',
    '1. Activate Pro locally:',
    `   ${activationCommand}`,
    '',
    `2. Open your dashboard: ${DASHBOARD_URL}`,
    '',
    '3. Give one concrete thumbs up or thumbs down:',
    `   ${exampleFeedback}`,
    '',
    'Your Pro key (save this):',
    `   ${licenseKey}`,
    '',
    `Verification evidence: ${proofUrl}`,
    '',
    postscript,
    '',
    `Questions? Just reply to this email or write ${supportEmail}.`,
    '',
    '— Igor, founder of ThumbGate',
    '',
    '---',
    `You're getting this because you started a paid ${PRODUCT_NAME} subscription. Don't want these emails? Unsubscribe: ${unsubscribeEmail}`,
    `${businessName} · ${businessAddress}`,
  ].join('\n');

  const safeKey = escapeHtml(licenseKey);
  const safeCmd = escapeHtml(activationCommand);
  const safeGreeting = escapeHtml(greeting);
  const safeSubhead = escapeHtml(subhead);
  const safeHeadline = escapeHtml(headline);
  const safeDescription = escapeHtml(description);
  const safeExample = escapeHtml(exampleFeedback);
  const safePostscript = escapeHtml(postscript);
  const safeSupportEmail = escapeHtml(supportEmail);
  const safeBusinessName = escapeHtml(businessName);
  const safeBusinessAddress = escapeHtml(businessAddress);
  const safeUnsubscribeEmail = escapeHtml(unsubscribeEmail);
  const safeUnsubscribeMailto = escapeHtml(unsubscribeMailto);
  const safeCustomer = customerId ? escapeHtml(customerId) : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f5f7fb;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#17212b;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Activate Pro in one command, open the dashboard, and start blocking repeated AI coding mistakes.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;max-width:640px;background:#ffffff;border:1px solid #d8e2ea;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="background:#071115;padding:24px 28px;color:#e7fbff;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="vertical-align:middle;padding-right:12px;">
                      <img src="${BRAND_MARK_URL}" width="40" height="40" alt="ThumbGate" style="display:block;border-radius:8px;">
                    </td>
                    <td style="vertical-align:middle;">
                      <div style="font-size:13px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;color:#73d4e9;">${escapeHtml(PRODUCT_NAME)}</div>
                    </td>
                  </tr>
                </table>
                <h1 style="margin:16px 0 8px;font-size:26px;line-height:1.2;color:#ffffff;">${safeHeadline}</h1>
                <p style="margin:0;font-size:14px;line-height:1.5;color:#9cbac4;">${safeSubhead}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 6px;">
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#17212b;">${safeGreeting}</p>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#344451;">${safeDescription}</p>
                <p style="margin:0 0 24px;">
                  <a href="${DASHBOARD_URL}" style="display:inline-block;background:#45bfd8;color:#061015;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:6px;font-size:15px;">Open your dashboard</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 10px;">
                <h2 style="margin:0 0 10px;font-size:17px;line-height:1.3;color:#17212b;">Your first 10 minutes</h2>
                <p style="margin:0 0 8px;font-size:14px;line-height:1.55;color:#344451;"><strong>1. Activate Pro locally</strong></p>
                <pre style="margin:0 0 20px;background:#081016;color:#d8f7e4;border:1px solid #23343d;border-radius:6px;padding:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;"><code>${safeCmd}</code></pre>

                <p style="margin:0 0 8px;font-size:14px;line-height:1.55;color:#344451;"><strong>2. Save your Pro key</strong></p>
                <pre style="margin:0 0 20px;background:#eef6f7;color:#0b343c;border:1px solid #c7e2e7;border-radius:6px;padding:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;"><code>${safeKey}</code></pre>

                <p style="margin:0 0 8px;font-size:14px;line-height:1.55;color:#344451;"><strong>3. Give one concrete thumbs up or thumbs down</strong></p>
                <p style="margin:0 0 8px;font-size:13px;line-height:1.55;color:#526273;">Start with the failure you most want your agent to stop repeating.</p>
                <pre style="margin:0 0 22px;background:#f1fff2;color:#22602b;border:1px solid #bae7c0;border-radius:6px;padding:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;"><code>${safeExample}</code></pre>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 28px 22px;">
                <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#344451;font-style:italic;">${safePostscript}</p>
                <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#17212b;">— Igor, founder of ThumbGate</p>
                <p style="margin:0;font-size:13px;line-height:1.55;color:#526273;">
                  Questions? Just reply to this email or write
                  <a href="mailto:${safeSupportEmail}" style="color:#087a91;">${safeSupportEmail}</a>.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 22px;border-top:1px solid #e2e8ec;background:#fafbfc;">
                <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#7a8790;">
                  You're getting this one-time email because you started a paid ${escapeHtml(PRODUCT_NAME)} subscription.
                  <a href="${safeUnsubscribeMailto}" style="color:#7a8790;text-decoration:underline;">Unsubscribe</a>
                  (${safeUnsubscribeEmail}).
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#7a8790;">
                  ${safeBusinessName} &middot; ${safeBusinessAddress}
                </p>
                ${safeCustomer ? `<p style="margin:8px 0 0;font-size:11px;color:#a0abb2;">Customer ID (for support): <code>${safeCustomer}</code></p>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { html, text, activationCommand, greeting, unsubscribeEmail, businessName, businessAddress };
}

/**
 * High-level helper: send the trial / checkout welcome email with the license key.
 *
 * Accepts optional `customerName` (used for greeting) and `trialEndAt`
 * (Date | number | ISO string — used to display the exact expiry date).
 *
 * Never throws on send failures (beyond input validation); the Stripe webhook
 * must keep working even if email breaks.
 */
async function sendTrialWelcomeEmail({ to, licenseKey, customerId, customerName, trialEndAt, fetchImpl, dnsResolver } = {}) {
  if (!isNonEmptyString(to)) throw new Error('sendTrialWelcomeEmail: `to` is required');
  if (!isNonEmptyString(licenseKey)) throw new Error('sendTrialWelcomeEmail: `licenseKey` is required');

  const { html, text } = renderTrialWelcomeBodies({ licenseKey, customerId, customerName, trialEndAt });
  const name = firstName(customerName);
  const subject = name
    ? `${name}, your ThumbGate Pro key is inside`
    : 'Your ThumbGate Pro key is inside';

  return sendEmail({ to, subject, html, text, replyTo: getReplyTo(), fetchImpl, dnsResolver });
}

function renderNewsletterWelcomeBodies() {
  const supportEmail = getSupportEmail();
  const unsubscribeEmail = getUnsubscribeEmail();
  const businessName = getBusinessName();
  const businessAddress = getBusinessAddress();
  const unsubscribeMailto = `mailto:${unsubscribeEmail}?subject=unsubscribe&body=Please%20remove%20me%20from%20ThumbGate%20emails.`;
  const headline = 'Welcome to ThumbGate.';
  const subhead =
    'One concrete AI coding failure prevented per email. No theory, no fluff.';
  const firstLesson =
    'First lesson: the most expensive AI mistake is the one it repeats. ' +
    'ThumbGate turns thumbs up/down signals into Pre-Action Checks that stop ' +
    'the next recurrence before the tool call runs.';
  const ctaLink = 'https://thumbgate.ai/pro';

  const text = [
    'Welcome to ThumbGate.',
    '',
    subhead,
    '',
    firstLesson,
    '',
    `Want the full stop-repeating-mistakes loop locally? ${ctaLink}`,
    '',
    `Questions? Reply to this email or write ${supportEmail}.`,
    '',
    '— Igor, founder of ThumbGate',
    '',
    '---',
    `You're getting this because you signed up on thumbgate.ai. Unsubscribe: ${unsubscribeEmail}`,
    `${businessName} · ${businessAddress}`,
  ].join('\n');

  const safeHeadline = escapeHtml(headline);
  const safeSubhead = escapeHtml(subhead);
  const safeFirstLesson = escapeHtml(firstLesson);
  const safeSupportEmail = escapeHtml(supportEmail);
  const safeBusinessName = escapeHtml(businessName);
  const safeBusinessAddress = escapeHtml(businessAddress);
  const safeUnsubscribeEmail = escapeHtml(unsubscribeEmail);
  const safeUnsubscribeMailto = escapeHtml(unsubscribeMailto);

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f5f7fb;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#17212b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;max-width:640px;background:#ffffff;border:1px solid #d8e2ea;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="background:#071115;padding:24px 28px;color:#e7fbff;">
                <div style="font-size:13px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;color:#73d4e9;">ThumbGate</div>
                <h1 style="margin:10px 0 6px;font-size:24px;line-height:1.25;color:#ffffff;">${safeHeadline}</h1>
                <p style="margin:0;font-size:14px;line-height:1.5;color:#9cbac4;">${safeSubhead}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 10px;">
                <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#344451;">${safeFirstLesson}</p>
                <p style="margin:0 0 22px;">
                  <a href="${ctaLink}" style="display:inline-block;background:#45bfd8;color:#061015;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:6px;font-size:15px;">See the full Pro loop</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 22px;">
                <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#17212b;">— Igor, founder of ThumbGate</p>
                <p style="margin:0;font-size:13px;line-height:1.55;color:#526273;">
                  Questions? Reply or write
                  <a href="mailto:${safeSupportEmail}" style="color:#087a91;">${safeSupportEmail}</a>.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 22px;border-top:1px solid #e2e8ec;background:#fafbfc;">
                <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#7a8790;">
                  You signed up on thumbgate.ai.
                  <a href="${safeUnsubscribeMailto}" style="color:#7a8790;text-decoration:underline;">Unsubscribe</a>
                  (${safeUnsubscribeEmail}).
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#7a8790;">
                  ${safeBusinessName} &middot; ${safeBusinessAddress}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { html, text };
}

async function sendNewsletterWelcomeEmail({ to, fetchImpl, dnsResolver } = {}) {
  if (!isNonEmptyString(to)) throw new Error('sendNewsletterWelcomeEmail: `to` is required');
  const { html, text } = renderNewsletterWelcomeBodies();
  return sendEmail({
    to,
    subject: 'Welcome to ThumbGate — one AI mistake prevented per email',
    html,
    text,
    replyTo: getReplyTo(),
    fetchImpl,
    dnsResolver,
  });
}

module.exports = {
  sendEmail,
  sendTrialWelcomeEmail,
  sendNewsletterWelcomeEmail,
  renderTrialWelcomeBodies,
  renderNewsletterWelcomeBodies,
  _resolveSenderAddress: resolveSenderAddress,
  _hasResendSenderDns: hasResendSenderDns,
  _recordsHaveResendDns: recordsHaveResendDns,
  _getCachedSenderDnsReadiness: getCachedSenderDnsReadiness,
  _setCachedSenderDnsReadiness: setCachedSenderDnsReadiness,
  _senderDnsCache: senderDnsCache,
  _SENDER_DNS_CACHE_MS: SENDER_DNS_CACHE_MS,
  _constants: {
    PRODUCT_NAME,
    DASHBOARD_URL,
    DEFAULT_CONTACT_EMAIL,
    DEFAULT_FROM,
    DEFAULT_REPLY_TO,
    DEFAULT_UNSUBSCRIBE_EMAIL,
    DEFAULT_BUSINESS_NAME,
    DEFAULT_BUSINESS_ADDRESS,
    BRAND_MARK_URL,
    RESEND_ENDPOINT,
    TRIAL_LENGTH_DAYS,
  },
};
