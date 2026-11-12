'use strict';

// Resend-backed transactional email sender for ThumbGate (zero-dep, CAN-SPAM compliant).
const dns = require('node:dns').promises;
const fs = require('node:fs');
const path = require('node:path');
const PRODUCT_NAME = 'ThumbGate Pro';
const DASHBOARD_URL = 'https://thumbgate-production.up.railway.app/dashboard';
const DEFAULT_CONTACT_EMAIL = 'igor@igorganapolsky.com';
const DEFAULT_FROM = 'ThumbGate <igor@igorganapolsky.com>';
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
const AMAZON_SES_MX_RE = /feedback-smtp\..*amazonses\.com\.?$/i;
const AMAZON_SES_SPF_RE = /include:amazonses\.com/i;
const TRAILING_EMAIL_DOMAIN_PUNCTUATION = new Set(['>', ')', ',', '.', ';']);
const BLOCKED_WELCOME_EMAILS = new Set(['igor@igorganapolsky.com', 'iganapolsky@gmail.com', 'igor.ganapolsky@gmail.com', 'support@thumbgate.ai', 'hello@thumbgate.app']);
const BLOCKED_WELCOME_DOMAINS = new Set(['igorganapolsky.com', 'thumbgate.ai', 'thumbgate.app', 'macyolosafeguards.io', 'ecisolutions.com', 'ecinexus.com', 'eci.com', 'example.com', 'example.org', 'example.net', 'test.com', 'localhost', 'formtests.info', 'mailinator.com', 'privaterelay.appleid.com']);
const BLOCKED_WELCOME_TLD_RE = /\.(?:test|example|invalid|local|localhost)$/i;
const BLOCKED_WELCOME_LOCAL_PREFIXES = ['test', 'testing', 'smoke', 'probe', 'synthetic', 'e2e', 'playwright', 'cypress', 'noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster'];
const BLOCKED_WELCOME_SUBTAGS = ['test', 'testing', 'smoke', 'probe', 'e2e'];
const VALID_RECIPIENT_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@.]{2,63}$/;
const senderDnsCache = new Map();

function getApiKey() {
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

const DEFAULT_VERIFIED_SENDER_DOMAINS = ['igorganapolsky.com'];

function getVerifiedSenderDomains() {
  const fromEnv = splitCsv(process.env.THUMBGATE_VERIFIED_SENDER_DOMAINS);
  return new Set([...DEFAULT_VERIFIED_SENDER_DOMAINS, ...fromEnv]);
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

async function postResendEmail({ fetcher, apiKey, payload, idempotencyKey }) {
  const res = await fetcher(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
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
async function sendEmail({ to, subject, html, text, from, replyTo, idempotencyKey, fetchImpl, dnsResolver } = {}) {
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
    const { res, bodyText, bodyJson } = await postResendEmail({
      fetcher,
      apiKey,
      payload,
      idempotencyKey: isNonEmptyString(idempotencyKey) ? idempotencyKey.slice(0, 256) : null,
    });
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

const PRIMARY_CTA_STYLE = 'display:inline-block;background:#45bfd8;color:#061015;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:6px;font-size:14px;';
const CODE_PRE_STYLE = 'margin:0 0 20px;border-radius:6px;padding:14px;font-size:13px;white-space:pre-wrap;word-break:break-word;';

function getFooterContext() {
  const unsubscribeEmail = getUnsubscribeEmail();
  return {
    supportEmail: getSupportEmail(),
    unsubscribeEmail,
    businessName: getBusinessName(),
    businessAddress: getBusinessAddress(),
    unsubscribeMailto: `mailto:${unsubscribeEmail}?subject=unsubscribe&body=Please%20remove%20me%20from%20ThumbGate%20emails.`,
  };
}

function renderEmailShell({ preheader = '', eyebrow = 'ThumbGate', headline, subhead = '', showLogo = false, bodyRowsHtml, footerReason, customerId = '', footer = getFooterContext() }) {
  const eyebrowHtml = `<div style="font-size:13px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;color:#73d4e9;">${escapeHtml(eyebrow)}</div>`;
  const headerBrand = showLogo
    ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px;"><img src="${BRAND_MARK_URL}" width="40" height="40" alt="ThumbGate" style="display:block;border-radius:8px;"></td><td>${eyebrowHtml}</td></tr></table>`
    : eyebrowHtml;
  const preheaderDiv = preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : '';
  const subheadHtml = subhead ? `<p style="margin:0;font-size:14px;color:#9cbac4;">${escapeHtml(subhead)}</p>` : '';
  const customerHtml = customerId ? `<p style="margin:8px 0 0;font-size:11px;color:#a0abb2;">Customer ID (for support): <code>${escapeHtml(customerId)}</code></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#17212b;">${preheaderDiv}<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border:1px solid #d8e2ea;border-radius:10px;overflow:hidden;"><tr><td style="background:#071115;padding:24px 28px;color:#e7fbff;">${headerBrand}<h1 style="margin:12px 0 6px;font-size:24px;color:#fff;">${escapeHtml(headline)}</h1>${subheadHtml}</td></tr>${bodyRowsHtml}<tr><td style="padding:16px 28px 22px;border-top:1px solid #e2e8ec;background:#fafbfc;"><p style="margin:0 0 6px;font-size:12px;color:#7a8790;">${escapeHtml(footerReason)} <a href="${escapeHtml(footer.unsubscribeMailto)}" style="color:#7a8790;">Unsubscribe</a> (${escapeHtml(footer.unsubscribeEmail)}).</p><p style="margin:0;font-size:12px;color:#7a8790;">${escapeHtml(footer.businessName)} &middot; ${escapeHtml(footer.businessAddress)}</p>${customerHtml}</td></tr></table></td></tr></table></body></html>`;
}

function renderTrialWelcomeBodies({ licenseKey, customerId, customerName, trialEndAt } = {}) {
  const activationCommand = `npx thumbgate pro --activate --key=${licenseKey}`;
  const name = firstName(customerName);
  const greeting = name ? `Hi ${name},` : 'Hi there,';
  const trialEndLabel = formatTrialEndDate(trialEndAt);
  const headline = 'Your ThumbGate Pro trial is live.';
  const subhead = `You have 7 days of Pro access. Trial ends ${trialEndLabel}.`;
  const description =
    'ThumbGate turns thumbs up/down feedback into Pre-Action Checks that stop repeated AI coding mistakes ' +
    'before the next tool call. Lessons stay on your machine. Repeated failures become Reliability Gateway blocks.';
  const exampleFeedback =
    'thumbs down: the answer skipped exact files and tests; next time include paths, commands, and verification evidence.';
  const proofUrl = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md';
  const footer = getFooterContext();
  const { supportEmail, unsubscribeEmail, businessName, businessAddress } = footer;
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
    'Your trial key (save this):',
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
    `You're getting this because you started a ${PRODUCT_NAME} trial. Don't want these emails? Unsubscribe: ${unsubscribeEmail}`,
    `${businessName} · ${businessAddress}`,
  ].join('\n');

  const safeKey = escapeHtml(licenseKey);
  const safeCmd = escapeHtml(activationCommand);
  const safeGreeting = escapeHtml(greeting);
  const safeSupportEmail = escapeHtml(supportEmail);
  const bodyRowsHtml = `<tr><td style="padding:26px 28px 6px;"><p style="margin:0 0 12px;font-size:15px;">${safeGreeting}</p><p style="margin:0 0 18px;font-size:15px;color:#344451;">${escapeHtml(description)}</p><p style="margin:0 0 24px;"><a href="${DASHBOARD_URL}" style="${PRIMARY_CTA_STYLE}">Open your dashboard</a></p></td></tr><tr><td style="padding:0 28px 10px;"><h2 style="margin:0 0 10px;font-size:17px;">Your first 10 minutes</h2><p style="margin:0 0 8px;font-size:14px;"><strong>1. Activate Pro locally</strong></p><pre style="${CODE_PRE_STYLE}background:#081016;color:#d8f7e4;border:1px solid #23343d;"><code>${safeCmd}</code></pre><p style="margin:0 0 8px;font-size:14px;"><strong>2. Save your trial key</strong></p><pre style="${CODE_PRE_STYLE}background:#eef6f7;color:#0b343c;border:1px solid #c7e2e7;"><code>${safeKey}</code></pre><p style="margin:0 0 8px;font-size:14px;"><strong>3. Give one concrete thumbs up or thumbs down</strong></p><p style="margin:0 0 8px;font-size:13px;color:#526273;">Start with the failure you most want your agent to stop repeating.</p><pre style="${CODE_PRE_STYLE}background:#f1fff2;color:#22602b;border:1px solid #bae7c0;"><code>${escapeHtml(exampleFeedback)}</code></pre></td></tr><tr><td style="padding:6px 28px 22px;"><p style="margin:0 0 14px;font-size:14px;font-style:italic;">${escapeHtml(postscript)}</p><p style="margin:0 0 4px;font-size:14px;">— Igor, founder of ThumbGate</p><p style="margin:0;font-size:13px;color:#526273;">Questions? Just reply to this email or write <a href="mailto:${safeSupportEmail}" style="color:#087a91;">${safeSupportEmail}</a>.</p></td></tr>`;
  const html = renderEmailShell({
    preheader: 'Activate Pro in one command, open the dashboard, and start blocking repeated AI coding mistakes.',
    eyebrow: PRODUCT_NAME,
    headline,
    subhead,
    showLogo: true,
    bodyRowsHtml,
    footerReason: `You're getting this one-time email because you started a ${PRODUCT_NAME} trial.`,
    customerId,
    footer,
  });

  return { html, text, activationCommand, trialEndLabel, greeting, unsubscribeEmail, businessName, businessAddress };
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
async function sendTrialWelcomeEmail({ to, licenseKey, customerId, customerName, trialEndAt, idempotencyKey, fetchImpl, dnsResolver } = {}) {
  if (!isNonEmptyString(to)) throw new Error('sendTrialWelcomeEmail: `to` is required');
  if (!isNonEmptyString(licenseKey)) throw new Error('sendTrialWelcomeEmail: `licenseKey` is required');

  const { html, text } = renderTrialWelcomeBodies({ licenseKey, customerId, customerName, trialEndAt });
  const name = firstName(customerName);
  const subject = name
    ? `${name}, your ThumbGate Pro key is inside`
    : 'Your ThumbGate Pro key is inside';

  return sendEmail({ to, subject, html, text, replyTo: getReplyTo(), idempotencyKey, fetchImpl, dnsResolver });
}

function renderNewsletterWelcomeBodies() {
  const footer = getFooterContext();
  const { supportEmail, unsubscribeEmail, businessName, businessAddress } = footer;
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

  const safeSupportEmail = escapeHtml(supportEmail);
  const html = renderEmailShell({
    headline,
    subhead,
    bodyRowsHtml: `<tr><td style="padding:24px 28px 10px;"><p style="margin:0 0 18px;font-size:15px;color:#344451;">${escapeHtml(firstLesson)}</p><p style="margin:0 0 22px;"><a href="${ctaLink}" style="${PRIMARY_CTA_STYLE}">See the full Pro loop</a></p></td></tr><tr><td style="padding:0 28px 22px;"><p style="margin:0 0 4px;font-size:14px;">— Igor, founder of ThumbGate</p><p style="margin:0;font-size:13px;color:#526273;">Questions? Reply or write <a href="mailto:${safeSupportEmail}" style="color:#087a91;">${safeSupportEmail}</a>.</p></td></tr>`,
    footerReason: 'You signed up on thumbgate.ai.',
    footer,
  });

  return { html, text };
}

async function sendNewsletterWelcomeEmail({ to, fetchImpl, dnsResolver } = {}) {
  if (!isNonEmptyString(to)) throw new Error('sendNewsletterWelcomeEmail: `to` is required');
  const addr = extractEmailAddress(to).toLowerCase();
  const at = addr.lastIndexOf('@');
  const baseLocal = at > 0 ? addr.slice(0, at).split('+')[0] : '';
  if (isOwnerEmailAlias(addr, baseLocal, getEmailDomain(addr)) || (getApiKey() && isBlockedSignupWelcomeRecipient(to))) {
    return { sent: false, reason: 'blocked_test_or_owner_recipient' };
  }
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

function isBlockedDomain(domain) {
  if (!domain || BLOCKED_WELCOME_DOMAINS.has(domain) || BLOCKED_WELCOME_TLD_RE.test(domain)) return true;
  for (const blocked of BLOCKED_WELCOME_DOMAINS) {
    if (domain.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

function isOwnerEmailAlias(addr, baseLocal, domain) {
  const blockedSet = new Set([...BLOCKED_WELCOME_EMAILS, ...splitCsv(process.env.THUMBGATE_OWNER_EMAILS)]);
  if (blockedSet.has(addr) || blockedSet.has(`${baseLocal}@${domain}`)) return true;
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return false;
  const canonicalLocal = baseLocal.replaceAll('.', '');
  for (const candidate of blockedSet) {
    const at = candidate.lastIndexOf('@');
    const candDomain = at > 0 ? candidate.slice(at + 1) : '';
    if ((candDomain === 'gmail.com' || candDomain === 'googlemail.com') && candidate.slice(0, at).split('+')[0].replaceAll('.', '') === canonicalLocal) {
      return true;
    }
  }
  return false;
}

function hasBlockedTokenPrefix(segment, prefixes) {
  for (const prefix of prefixes) {
    if (segment === prefix) return true;
    const sep = segment[prefix.length];
    if (segment.startsWith(prefix) && (sep === '.' || sep === '_' || sep === '-')) return true;
  }
  return false;
}

function isBlockedLocalPart(localPart) {
  const [base = '', ...subtags] = localPart.split('+');
  if (hasBlockedTokenPrefix(base, BLOCKED_WELCOME_LOCAL_PREFIXES)) return true;
  return subtags.some((tag) => hasBlockedTokenPrefix(tag, BLOCKED_WELCOME_SUBTAGS));
}

function isBlockedSignupWelcomeRecipient(value) {
  const addr = extractEmailAddress(value).toLowerCase();
  if (!addr || !VALID_RECIPIENT_RE.test(addr)) return true;
  const at = addr.lastIndexOf('@');
  const localPart = addr.slice(0, at);
  const baseLocal = localPart.split('+')[0];
  const domain = getEmailDomain(addr);
  if (isOwnerEmailAlias(addr, baseLocal, domain)) return true;
  return isBlockedLocalPart(localPart) || isBlockedDomain(domain);
}

function resolvePublicOrigin(appOrigin) {
  let trimmed = String(appOrigin || process.env.THUMBGATE_PUBLIC_APP_ORIGIN || 'https://thumbgate.ai').trim();
  while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);
  return trimmed || 'https://thumbgate.ai';
}

function renderSignupWelcomeBodies({ customerName, appOrigin } = {}) {
  const origin = resolvePublicOrigin(appOrigin);
  const installUrl = `${origin}/#install`;
  const diagnosticUrl = `${origin}/diagnostic`;
  const greeting = firstName(customerName) ? `Hi ${firstName(customerName)},` : 'Hi there,';
  const footer = getFooterContext();
  const { unsubscribeEmail, businessName, businessAddress } = footer;
  const intro = 'ThumbGate blocks leaked secrets and repeated AI coding mistakes at PreToolUse before a tool call runs.';
  const text = [
    greeting, '', 'Welcome to ThumbGate.', intro, '',
    `1. Install free in 30 seconds (npx thumbgate init): ${installUrl}`,
    `2. Want one workflow wired with you? Book the $499 diagnostic: ${diagnosticUrl}`, '',
    '— Igor, founder of ThumbGate', '', '---',
    `You signed up on thumbgate.ai. Don't want these emails? Unsubscribe: ${unsubscribeEmail}`,
    `${businessName} · ${businessAddress}`,
  ].join('\n');
  const html = renderEmailShell({
    headline: 'Welcome to ThumbGate.',
    bodyRowsHtml: `<tr><td style="padding:24px 28px 18px;"><p style="margin:0 0 12px;font-size:15px;">${escapeHtml(greeting)}</p><p style="margin:0 0 20px;font-size:15px;color:#344451;">${escapeHtml(intro)} Run <code>npx thumbgate init</code> locally, or have us wire one workflow end-to-end with you.</p><p style="margin:0 0 22px;"><a href="${escapeHtml(installUrl)}" style="${PRIMARY_CTA_STYLE}margin:0 10px 8px 0;">Install ThumbGate free</a><a href="${escapeHtml(diagnosticUrl)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:6px;font-size:14px;margin:0 0 8px 0;">Book the $499 diagnostic</a></p><p style="margin:0;font-size:14px;">— Igor, founder of ThumbGate</p></td></tr>`,
    footerReason: 'You signed up on thumbgate.ai.',
    footer,
  });
  return { html, text, installUrl, diagnosticUrl, unsubscribeEmail, businessName, businessAddress };
}

async function sendSignupWelcomeEmail({ to, customerName, appOrigin, idempotencyKey, fetchImpl, dnsResolver } = {}) {
  if (!isNonEmptyString(to)) throw new Error('sendSignupWelcomeEmail: `to` is required');
  if (isBlockedSignupWelcomeRecipient(to)) {
    return { sent: false, reason: 'blocked_test_or_owner_recipient' };
  }
  const cleanTo = extractEmailAddress(to).toLowerCase();
  const { html, text } = renderSignupWelcomeBodies({ customerName, appOrigin });
  const name = firstName(customerName);
  const subject = name ? `${name}, welcome to ThumbGate` : 'Welcome to ThumbGate';
  return sendEmail({
    to: cleanTo,
    subject,
    html,
    text,
    replyTo: getReplyTo(),
    idempotencyKey: idempotencyKey || `signup-welcome:${cleanTo}`,
    fetchImpl,
    dnsResolver,
  });
}

function hasPriorSentSignupWelcome(ledgerPath, normalizedEmail) {
  if (!ledgerPath || !fs.existsSync(ledgerPath)) return false;
  let lines;
  try { lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean); } catch { return false; }
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (String(row?.email || '').toLowerCase() === normalizedEmail && row?.status === 'sent') return true;
    } catch { /* skip malformed ledger line */ }
  }
  return false;
}

const inFlightWelcomeDispatches = new Set();

async function dispatchSignupWelcomeEmail({ to, customerName, source = 'sso_signup', feedbackDir, appOrigin, fetchImpl, dnsResolver } = {}) {
  if (isBlockedSignupWelcomeRecipient(to)) return { sent: false, reason: 'blocked_test_or_owner_recipient' };
  const cleanTo = extractEmailAddress(to).toLowerCase();
  const ledgerPath = feedbackDir ? path.join(feedbackDir, 'signup-welcome-emails.jsonl') : null;
  const flightKey = `${ledgerPath || ''}:${cleanTo}`;
  if (inFlightWelcomeDispatches.has(flightKey) || hasPriorSentSignupWelcome(ledgerPath, cleanTo)) {
    return { sent: false, reason: 'already_sent' };
  }
  inFlightWelcomeDispatches.add(flightKey);
  try {
    const result = await sendSignupWelcomeEmail({ to: cleanTo, customerName, appOrigin, fetchImpl, dnsResolver });
    if (ledgerPath) {
      try {
        fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
        fs.appendFileSync(ledgerPath, `${JSON.stringify({
          recordedAt: new Date().toISOString(),
          email: cleanTo,
          source,
          status: result.sent ? 'sent' : 'skipped',
          reason: result.reason || null,
          providerId: result.id || null,
        })}\n`, { mode: 0o600 });
      } catch { /* best-effort ledger write */ }
    }
    return result;
  } finally {
    inFlightWelcomeDispatches.delete(flightKey);
  }
}

module.exports = {
  sendEmail,
  sendTrialWelcomeEmail,
  sendNewsletterWelcomeEmail,
  sendSignupWelcomeEmail,
  dispatchSignupWelcomeEmail,
  isBlockedSignupWelcomeRecipient,
  renderTrialWelcomeBodies,
  renderNewsletterWelcomeBodies,
  renderSignupWelcomeBodies,
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
