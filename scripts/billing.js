#!/usr/bin/env node
/**
 * billing.js — Stripe billing integration using official Stripe SDK.
 */

'use strict';

const STRIPE_TIMEOUT_MS = 5000;
function withTimeout(promise, ms = STRIPE_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Stripe API timeout after ${ms}ms`)), ms)),
  ]);
}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const {
  DEFAULT_PUBLIC_APP_ORIGIN,
  createTraceId,
  joinPublicUrl,
  normalizeOrigin,
} = require('./hosted-config');
const {
  getFeedbackPaths,
  getLegacyFeedbackDir,
  getFallbackFeedbackDir,
  resolveFallbackArtifactPath,
} = require('./feedback-paths');
const { getTelemetryAnalytics, getTelemetrySourceDiagnostics } = require('./telemetry-analytics');
const {
  PRO_MONTHLY_PRICE_ID,
  PRO_ANNUAL_PRICE_ID,
  TEAM_MONTHLY_PRICE_ID,
  PRO_MONTHLY_PRICE_DOLLARS,
  PRO_ANNUAL_PRICE_DOLLARS,
  TEAM_MONTHLY_PRICE_DOLLARS,
  TEAM_MIN_SEATS,
  normalizePlanId,
  normalizeBillingCycle,
  normalizeSeatCount,
} = require('./commercial-offer');
const {
  eventOccursInWindow,
  filterEntriesForWindow,
  resolveAnalyticsWindow,
  serializeAnalyticsWindow,
} = require('./analytics-window');
const { ensureParentDir } = require('./fs-utils');
const mailer = require('./mailer');

function loadWorkflowSprintIntakeModule() {
  const modulePath = path.resolve(__dirname, 'workflow-sprint-intake.js');
  if (!fs.existsSync(modulePath)) return null;
  return require(modulePath);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  GITHUB_MARKETPLACE_WEBHOOK_SECRET: process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET || '',
  GITHUB_MARKETPLACE_PLAN_PRICES_JSON: process.env.THUMBGATE_GITHUB_MARKETPLACE_PLAN_PRICES_JSON || '',
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID || PRO_MONTHLY_PRICE_ID,
  STRIPE_PRICE_ID_PRO_MONTHLY: process.env.STRIPE_PRICE_ID_PRO_MONTHLY || PRO_MONTHLY_PRICE_ID,
  STRIPE_PRICE_ID_PRO_ANNUAL: process.env.STRIPE_PRICE_ID_PRO_ANNUAL || PRO_ANNUAL_PRICE_ID,
  STRIPE_PRICE_ID_TEAM_MONTHLY: process.env.STRIPE_PRICE_ID_TEAM_MONTHLY || TEAM_MONTHLY_PRICE_ID,
  STRIPE_PRODUCT_ID: process.env.STRIPE_PRODUCT_ID || '',
  get API_KEYS_PATH() {
    return process.env._TEST_API_KEYS_PATH || path.join(getFeedbackPaths().FEEDBACK_DIR, 'api-keys.json');
  },
  get FUNNEL_LEDGER_PATH() {
    return process.env._TEST_FUNNEL_LEDGER_PATH || process.env.THUMBGATE_FUNNEL_LEDGER_PATH || path.join(getFeedbackPaths().FEEDBACK_DIR, 'funnel-events.jsonl');
  },
  get REVENUE_LEDGER_PATH() {
    return process.env._TEST_REVENUE_LEDGER_PATH || process.env.THUMBGATE_REVENUE_LEDGER_PATH || path.join(getFeedbackPaths().FEEDBACK_DIR, 'revenue-events.jsonl');
  },
  get LOCAL_CHECKOUT_SESSIONS_PATH() {
    return process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH || path.join(getFeedbackPaths().FEEDBACK_DIR, 'local-checkout-sessions.json');
  },
  get NEWSLETTER_SUBSCRIBERS_PATH() {
    return process.env._TEST_NEWSLETTER_SUBSCRIBERS_PATH || path.join(getFeedbackPaths().FEEDBACK_DIR, 'newsletter-subscribers.jsonl');
  },
  get TRIAL_EMAIL_LEDGER_PATH() {
    return process.env._TEST_TRIAL_EMAIL_LEDGER_PATH || process.env.THUMBGATE_TRIAL_EMAIL_LEDGER_PATH || path.join(getFeedbackPaths().FEEDBACK_DIR, 'trial-emails.jsonl');
  },
  RESEND_API_KEY: process.env.RESEND_API_KEY || process.env.THUMBGATE_RESEND_API_KEY || '',
  TRIAL_EMAIL_FROM: process.env.THUMBGATE_TRIAL_EMAIL_FROM || process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || 'onboarding@resend.dev',
  TRIAL_EMAIL_REPLY_TO: process.env.THUMBGATE_TRIAL_EMAIL_REPLY_TO || 'igor.ganapolsky@gmail.com',
  CREDIT_PACKS: {}
};

function resolveLegacyBillingPath(fileName) {
  return resolveFallbackArtifactPath(fileName, {
    feedbackDir: getFeedbackPaths().FEEDBACK_DIR,
  });
}

let _stripeClient = null;
let _stripeCtor = null;

function getStripeConstructor() {
  if (_stripeCtor) return _stripeCtor;
  try {
    _stripeCtor = require('stripe');
    return _stripeCtor;
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      throw new Error('stripe package is not installed. Live billing features are unavailable.');
    }
    throw error;
  }
}

function getStripeClient() {
  if (!_stripeClient) {
    if (!CONFIG.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is missing. Stripe client cannot be initialized.');
    }
    const Stripe = getStripeConstructor();
    _stripeClient = new Stripe(CONFIG.STRIPE_SECRET_KEY);
  }
  return _stripeClient;
}

const LOCAL_MODE = () => !CONFIG.STRIPE_SECRET_KEY;
const IS_TEST = !!(
  process.env._TEST_API_KEYS_PATH ||
  process.env._TEST_FUNNEL_LEDGER_PATH ||
  process.env._TEST_REVENUE_LEDGER_PATH ||
  process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH ||
  process.env.NODE_ENV === 'test'
);

function shouldMergeLegacyBillingData() {
  return process.env._TEST_INCLUDE_LEGACY_BILLING_DATA === '1'
    || process.env.THUMBGATE_INCLUDE_LEGACY_BILLING_DATA === '1';
}

function safeCompareHex(expectedHex, actualHex) {
  try {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = Buffer.from(actualHex, 'hex');
    if (expected.length === 0 || expected.length !== actual.length) {
      return false;
    }
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(metadata));
  } catch {
    return { ...metadata };
  }
}

function appendJsonlRecord(filePath, payload) {
  try {
    ensureParentDir(filePath);
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf-8');
    return { written: true, payload };
  } catch (err) {
    return { written: false, reason: 'write_failed', error: err.message };
  }
}

function loadJsonlRecords(filePath, legacyPath = null) {
  try {
    const paths = [];
    const primaryExists = Boolean(filePath && fs.existsSync(filePath));
    const legacyExists = Boolean(legacyPath && legacyPath !== filePath && fs.existsSync(legacyPath));

    if (primaryExists) {
      paths.push(filePath);
      if (legacyExists && shouldMergeLegacyBillingData()) {
        paths.push(legacyPath);
      }
    } else if (legacyExists) {
      paths.push(legacyPath);
    }

    const merged = [];
    const seen = new Set();

    for (const target of paths) {
      if (!fs.existsSync(target)) continue;
      const rows = fs.readFileSync(target, 'utf-8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      for (const row of rows) {
        const key = JSON.stringify(row);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }
    }

    return merged;
  } catch { return []; }
}

function loadJsonlFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeJsonlRecords(filePath, rows = []) {
  try {
    ensureParentDir(filePath);
    const serialized = rows
      .filter(Boolean)
      .map((row) => JSON.stringify(row))
      .join('\n');
    fs.writeFileSync(filePath, serialized ? `${serialized}\n` : '', 'utf-8');
    return { written: true, rowCount: rows.filter(Boolean).length };
  } catch (err) {
    return { written: false, reason: 'write_failed', error: err.message };
  }
}

function buildSourceWarning(code, message) {
  return { code, message };
}

function describeDataFile({ primaryPath, legacyPath = null, mode = 'fallback' } = {}) {
  const includeLegacy = Boolean(legacyPath);
  const samePath = Boolean(
    includeLegacy &&
    legacyPath &&
    path.resolve(primaryPath || '.') === path.resolve(legacyPath || '__missing__')
  );
  const normalizedLegacyPath = includeLegacy && !samePath ? legacyPath : null;
  const primaryExists = Boolean(primaryPath && fs.existsSync(primaryPath));
  const legacyExists = Boolean(normalizedLegacyPath && fs.existsSync(normalizedLegacyPath));
  const activePaths = [];
  let activeMode = 'missing';

  if (mode === 'merge' && shouldMergeLegacyBillingData()) {
    if (primaryExists) activePaths.push(primaryPath);
    if (legacyExists) activePaths.push(normalizedLegacyPath);
    if (primaryExists && legacyExists) activeMode = 'merged';
    else if (primaryExists) activeMode = 'primary';
    else if (legacyExists) activeMode = 'legacy_fallback';
  } else {
    const activePath = primaryExists ? primaryPath : (legacyExists ? normalizedLegacyPath : null);
    if (activePath) activePaths.push(activePath);
    if (primaryExists) activeMode = 'primary';
    else if (legacyExists) activeMode = 'legacy_fallback';
  }

  return {
    primaryPath,
    legacyPath: normalizedLegacyPath,
    primaryExists,
    legacyExists,
    activeMode,
    activePaths,
    mixedRoots: activeMode === 'merged',
  };
}

function buildBillingSourceDiagnostics(feedbackDir) {
  const keyStore = describeDataFile({
    primaryPath: CONFIG.API_KEYS_PATH,
    legacyPath: resolveLegacyBillingPath('api-keys.json'),
    mode: 'fallback',
  });
  const funnelLedger = describeDataFile({
    primaryPath: CONFIG.FUNNEL_LEDGER_PATH,
    legacyPath: resolveLegacyBillingPath('funnel-events.jsonl'),
    mode: 'fallback',
  });
  const revenueLedger = describeDataFile({
    primaryPath: CONFIG.REVENUE_LEDGER_PATH,
    legacyPath: resolveLegacyBillingPath('revenue-events.jsonl'),
    mode: 'fallback',
  });
  const checkoutSessions = describeDataFile({
    primaryPath: CONFIG.LOCAL_CHECKOUT_SESSIONS_PATH,
    legacyPath: resolveLegacyBillingPath('local-checkout-sessions.json'),
    mode: 'fallback',
  });
  const newsletterSubscribers = describeDataFile({
    primaryPath: CONFIG.NEWSLETTER_SUBSCRIBERS_PATH,
    legacyPath: resolveLegacyBillingPath('newsletter-subscribers.jsonl'),
    mode: 'fallback',
  });
  const telemetry = getTelemetrySourceDiagnostics(feedbackDir);
  const warnings = [
    ...telemetry.warnings,
  ];

  if (keyStore.activeMode === 'legacy_fallback') {
    warnings.push(buildSourceWarning(
      'key_store_legacy_fallback',
      'API keys are loading from a legacy feedback directory because the active feedback directory has no key store.'
    ));
  } else if (keyStore.activeMode === 'missing') {
    warnings.push(buildSourceWarning(
      'key_store_missing',
      'API key state is missing from both the active and legacy feedback directories.'
    ));
  }

  if (funnelLedger.activeMode === 'legacy_fallback') {
    warnings.push(buildSourceWarning(
      'funnel_ledger_legacy_fallback',
      'Funnel events are loading only from a legacy feedback directory.'
    ));
  } else if (funnelLedger.activeMode === 'missing') {
    warnings.push(buildSourceWarning(
      'funnel_ledger_missing',
      'Funnel events are missing from both the active and legacy feedback directories.'
    ));
  }

  if (revenueLedger.activeMode === 'legacy_fallback') {
    warnings.push(buildSourceWarning(
      'revenue_ledger_legacy_fallback',
      'Revenue events are loading only from a legacy feedback directory.'
    ));
  } else if (revenueLedger.activeMode === 'missing') {
    warnings.push(buildSourceWarning(
      'revenue_ledger_missing',
      'Revenue events are missing from both the active and legacy feedback directories.'
    ));
  }

  const mixedRoots = [keyStore, funnelLedger, revenueLedger, checkoutSessions, newsletterSubscribers, telemetry]
    .some((descriptor) => descriptor.mixedRoots || descriptor.activeMode === 'legacy_fallback');
  if (mixedRoots) {
    warnings.push(buildSourceWarning(
      'mixed_feedback_roots',
      'Analytics are mixing active and legacy feedback roots. Consolidate runtime state before claiming full observability.'
    ));
  }

  return {
    feedbackDir,
    fallbackFeedbackDir: getFallbackFeedbackDir(),
    legacyFeedbackDir: getLegacyFeedbackDir(),
    mixedRoots,
    files: {
      keyStore,
      funnelLedger,
      revenueLedger,
      checkoutSessions,
      newsletterSubscribers,
      telemetry,
    },
    warnings,
  };
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function resolvePublicAppOrigin(appOrigin) {
  return normalizeOrigin(appOrigin) || normalizeOrigin(process.env.THUMBGATE_PUBLIC_APP_ORIGIN) || DEFAULT_PUBLIC_APP_ORIGIN;
}

function resolveCheckoutBrandUrls(appOrigin) {
  const origin = resolvePublicAppOrigin(appOrigin);
  return {
    icon: joinPublicUrl(origin, '/assets/brand/thumbgate-icon-512.png'),
    logo: joinPublicUrl(origin, '/assets/brand/thumbgate-logo-1200x360.png'),
  };
}

function buildCheckoutBrandingSettings(appOrigin) {
  const brandUrls = resolveCheckoutBrandUrls(appOrigin);
  return {
    display_name: 'ThumbGate',
    logo: {
      type: 'url',
      url: brandUrls.logo,
    },
    background_color: '#ffffff',
    button_color: '#22d3ee',
    border_style: 'rounded',
    font_family: 'inter',
  };
}

function buildCheckoutProductData({ name, description, appOrigin }) {
  const brandUrls = resolveCheckoutBrandUrls(appOrigin);
  return {
    name,
    description,
    images: [brandUrls.icon],
  };
}

function buildSubscriptionPriceData(checkoutSelection, appOrigin) {
  const isTeam = checkoutSelection.planId === 'team';
  const annual = checkoutSelection.billingCycle === 'annual';
  const unitAmount = isTeam
    ? TEAM_MONTHLY_PRICE_DOLLARS * 100
    : (annual ? PRO_ANNUAL_PRICE_DOLLARS : PRO_MONTHLY_PRICE_DOLLARS) * 100;
  return {
    currency: 'usd',
    unit_amount: unitAmount,
    recurring: {
      interval: annual ? 'year' : 'month',
    },
    product_data: buildCheckoutProductData({
      name: isTeam ? 'ThumbGate Team' : 'ThumbGate Pro',
      description: isTeam
        ? 'Shared Pre-Action Gates, team governance, and workflow hardening for AI coding agents.'
        : 'Local dashboard, DPO export, and Pre-Action Gates for AI coding agents.',
      appOrigin,
    }),
  };
}

function normalizeEmail(value) {
  const text = normalizeText(value);
  if (!text || !text.includes('@')) return null;
  return text.toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function findTrialEmailRecord({ sessionId, customerEmail, statuses = null } = {}) {
  const normalizedEmail = normalizeEmail(customerEmail);
  const rows = loadJsonlRecords(CONFIG.TRIAL_EMAIL_LEDGER_PATH);
  return rows.find((row) => {
    if (!row || typeof row !== 'object') return false;
    if (statuses && !statuses.includes(row.status)) return false;
    if (sessionId && row.sessionId === sessionId) return true;
    return normalizedEmail && row.customerEmail === normalizedEmail;
  }) || null;
}

function appendTrialEmailRecord(payload) {
  return appendJsonlRecord(CONFIG.TRIAL_EMAIL_LEDGER_PATH, {
    timestamp: new Date().toISOString(),
    provider: payload.provider || 'resend',
    ...payload,
  });
}

/**
 * Resolve the trial expiry date for a Stripe checkout session.
 *
 * Prefers an explicit `subscription.trial_end` unix timestamp when the session
 * embeds one (subscriptions with trial_period_days populate it). Falls back to
 * the session's `expires_at`, and finally to now + 7 days. Always returns a
 * Date; never throws.
 */
function computeTrialEndAt(session) {
  const TRIAL_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  if (session && session.subscription && typeof session.subscription === 'object') {
    const trialEndUnix = session.subscription.trial_end;
    if (typeof trialEndUnix === 'number' && trialEndUnix > 0) {
      return new Date(trialEndUnix * 1000);
    }
  }
  if (session && typeof session.trial_end === 'number' && session.trial_end > 0) {
    return new Date(session.trial_end * 1000);
  }
  return new Date(Date.now() + TRIAL_DAYS_MS);
}

function buildTrialActivationEmail({ customerEmail, apiKey, sessionId, planId, appOrigin } = {}) {
  const email = normalizeEmail(customerEmail);
  const origin = resolvePublicAppOrigin(appOrigin);
  const dashboardUrl = joinPublicUrl(origin, '/dashboard');
  const docsUrl = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md';
  const supportEmail = process.env.THUMBGATE_SUPPORT_EMAIL || CONFIG.TRIAL_EMAIL_REPLY_TO || 'igor.ganapolsky@gmail.com';
  const command = `npx thumbgate pro --activate --key=${apiKey || ''}`;
  const subject = 'Your 7-day ThumbGate Pro trial is live';
  const preheader = 'Activate Pro in one command, open the dashboard, and start blocking repeated AI coding mistakes.';
  const headline = 'Your 7-day ThumbGate Pro trial is live.';
  const intro = 'ThumbGate turns thumbs up/down feedback into Pre-Action Gates that stop repeated AI coding mistakes before the next tool call. It keeps lessons local and turns repeated mistakes into Reliability Gateway blocks.';
  const exampleFeedback = 'thumbs down: the answer skipped exact files and tests; next time include paths, commands, and verification evidence.';
  const safeDashboardUrl = escapeHtml(dashboardUrl);
  const safeDocsUrl = escapeHtml(docsUrl);
  const safeSupportEmail = escapeHtml(supportEmail);
  const safeCommand = escapeHtml(command);
  const safeApiKey = escapeHtml(apiKey || '');
  return {
    from: CONFIG.TRIAL_EMAIL_FROM,
    to: [email],
    reply_to: CONFIG.TRIAL_EMAIL_REPLY_TO,
    subject,
    text: [
      headline,
      '',
      intro,
      '',
      'Next 3 minutes:',
      '1. Activate Pro locally:',
      command,
      '',
      `2. Open your dashboard: ${dashboardUrl}`,
      '',
      '3. Give one concrete thumbs up or thumbs down:',
      exampleFeedback,
      '',
      'Your trial key:',
      apiKey,
      '',
      `Verification evidence: ${docsUrl}`,
      `Keep this key private. Questions? Reply to this email or write ${supportEmail}.`,
      sessionId ? `Stripe session: ${sessionId}` : null,
      planId ? `Plan: ${planId}` : null,
    ].filter(Boolean).join('\n'),
    html: `<!doctype html>
<html>
  <body style="margin:0;background:#f5f7fb;padding:28px 12px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#17212b;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;max-width:640px;background:#ffffff;border:1px solid #d8e2ea;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:#071115;padding:22px 26px;color:#e7fbff;">
                <div style="font-size:13px;font-weight:700;letter-spacing:0;text-transform:uppercase;color:#73d4e9;">ThumbGate Pro</div>
                <h1 style="margin:12px 0 10px;font-size:28px;line-height:1.15;color:#ffffff;">${escapeHtml(headline)}</h1>
                <p style="margin:0;font-size:15px;line-height:1.6;color:#c6d6de;">${escapeHtml(intro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px;">
                <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#344451;">Run one command, open the dashboard, then give one concrete thumb signal. ThumbGate keeps the lesson local and turns repeated mistakes into Reliability Gateway blocks.</p>
                <p style="margin:0 0 24px;">
                  <a href="${safeDashboardUrl}" style="display:inline-block;background:#45bfd8;color:#061015;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:6px;">Open your dashboard</a>
                </p>

                <h2 style="margin:0 0 8px;font-size:17px;line-height:1.3;color:#17212b;">1. Activate Pro locally</h2>
                <pre style="margin:0 0 22px;background:#081016;color:#d8f7e4;border:1px solid #23343d;border-radius:6px;padding:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;"><code>${safeCommand}</code></pre>

                <h2 style="margin:0 0 8px;font-size:17px;line-height:1.3;color:#17212b;">2. Save your trial key</h2>
                <pre style="margin:0 0 22px;background:#eef6f7;color:#0b343c;border:1px solid #c7e2e7;border-radius:6px;padding:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;"><code>${safeApiKey}</code></pre>

                <h2 style="margin:0 0 8px;font-size:17px;line-height:1.3;color:#17212b;">3. Give one concrete thumbs up or thumbs down</h2>
                <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#344451;">Start with the failure you most want your agent to stop repeating.</p>
                <pre style="margin:0 0 24px;background:#f1fff2;color:#22602b;border:1px solid #bae7c0;border-radius:6px;padding:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;"><code>${escapeHtml(exampleFeedback)}</code></pre>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 22px;">
                  <tr>
                    <td style="border:1px solid #d8e2ea;border-radius:8px;padding:14px;background:#fbfdff;">
                      <strong style="display:block;margin:0 0 6px;font-size:14px;color:#17212b;">Why this matters now</strong>
                      <span style="font-size:13px;line-height:1.55;color:#526273;">One correction should become a permanent pre-action block, not a note the next agent forgets.</span>
                    </td>
                  </tr>
                </table>

                <p style="margin:0;font-size:13px;line-height:1.6;color:#526273;">
                  Proof trail: <a href="${safeDocsUrl}" style="color:#087a91;">verification evidence</a>.
                  Keep this key private. Questions? Reply here or write <a href="mailto:${safeSupportEmail}" style="color:#087a91;">${safeSupportEmail}</a>.
                </p>
                ${sessionId ? `<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#7a8790;">Stripe session: ${escapeHtml(sessionId)}</p>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

function sendResendEmail(message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(message);
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONFIG.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        let parsed = {};
        try {
          parsed = responseBody ? JSON.parse(responseBody) : {};
        } catch {
          parsed = { raw: responseBody };
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, statusCode: res.statusCode, body: parsed });
          return;
        }
        const err = new Error(parsed.message || parsed.error || `Resend API returned HTTP ${res.statusCode}`);
        err.statusCode = res.statusCode;
        err.body = parsed;
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Resend API timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

async function sendTrialActivationEmail(params = {}, options = {}) {
  const customerEmail = normalizeEmail(params.customerEmail);
  const sessionId = normalizeText(params.sessionId);
  const apiKey = normalizeText(params.apiKey);
  const injectedMailer = module.exports && module.exports._mailer;
  const mailerTransport = !options.transport && injectedMailer && typeof injectedMailer.sendTrialWelcomeEmail === 'function'
    ? injectedMailer
    : null;
  const transport = options.transport || sendResendEmail;
  const planId = normalizeText(params.planId);

  if (!customerEmail) {
    return { status: 'skipped', reason: 'missing_customer_email' };
  }
  if (!apiKey) {
    return { status: 'skipped', reason: 'missing_api_key', customerEmail };
  }

  const previousSent = findTrialEmailRecord({
    sessionId,
    customerEmail,
    statuses: ['sent'],
  });
  if (previousSent) {
    return {
      status: 'already_sent',
      customerEmail,
      sessionId: previousSent.sessionId || sessionId,
      providerId: previousSent.providerId || null,
    };
  }

  if (!CONFIG.RESEND_API_KEY && !options.transport && !mailerTransport) {
    const previousSkipped = findTrialEmailRecord({
      sessionId,
      customerEmail,
      statuses: ['skipped'],
    });
    if (!previousSkipped) {
      appendTrialEmailRecord({
        status: 'skipped',
        reason: 'missing_resend_api_key',
        sessionId,
        customerEmail,
        planId,
        source: params.source || 'checkout_session_status',
      });
    }
    return { status: 'skipped', reason: 'missing_resend_api_key', customerEmail, sessionId };
  }

  try {
    let providerId = null;
    if (mailerTransport) {
      const response = await mailerTransport.sendTrialWelcomeEmail({
        to: customerEmail,
        licenseKey: apiKey,
        customerId: params.customerId,
        customerName: params.customerName,
        trialEndAt: params.trialEndAt,
      });
      if (!response || response.sent !== true) {
        const rawReason = normalizeText(response && response.reason) || 'provider_error';
        // Normalize the mailer module's `no_api_key` to billing.js's legacy
        // `missing_resend_api_key` reason so downstream consumers (dashboards,
        // tests, support tooling) see a stable vocabulary regardless of which
        // transport produced the skip.
        const reason = rawReason === 'no_api_key' ? 'missing_resend_api_key' : rawReason;
        const isSkipped = reason === 'missing_resend_api_key';
        const previousSkipped = isSkipped
          ? findTrialEmailRecord({ sessionId, customerEmail, statuses: ['skipped'] })
          : null;
        if (!isSkipped || !previousSkipped) {
          appendTrialEmailRecord({
            status: isSkipped ? 'skipped' : 'failed',
            reason,
            sessionId,
            customerEmail,
            planId,
            source: params.source || 'checkout_session_status',
          });
        }
        return {
          status: isSkipped ? 'skipped' : 'failed',
          reason,
          customerEmail,
          sessionId,
        };
      }
      providerId = response.id || response.providerId || null;
    } else {
      const message = buildTrialActivationEmail({
        customerEmail,
        apiKey,
        sessionId,
        planId,
        appOrigin: params.appOrigin,
      });
      const response = await transport(message, params);
      providerId = response && response.body ? response.body.id : response && response.id ? response.id : null;
    }
    appendTrialEmailRecord({
      status: 'sent',
      sessionId,
      customerEmail,
      planId,
      providerId,
      source: params.source || 'checkout_session_status',
    });
    return { status: 'sent', customerEmail, sessionId, providerId };
  } catch (err) {
    const reason = mailerTransport ? 'exception' : 'provider_error';
    appendTrialEmailRecord({
      status: 'failed',
      reason,
      error: err && err.message ? err.message : 'Email provider failed',
      sessionId,
      customerEmail,
      planId,
      source: params.source || 'checkout_session_status',
    });
    return {
      status: 'failed',
      reason,
      error: err && err.message ? err.message : 'Email provider failed',
      customerEmail,
      sessionId,
    };
  }
}

function trialEmailToWebhookEmailResult(trialEmail = {}) {
  if (trialEmail.status === 'sent' || trialEmail.status === 'already_sent') {
    return {
      sent: true,
      id: trialEmail.providerId || null,
      providerId: trialEmail.providerId || null,
    };
  }
  return {
    sent: false,
    reason: trialEmail.reason === 'missing_customer_email'
      ? 'no_recipient'
      : trialEmail.reason || trialEmail.status || 'unknown',
    error: trialEmail.error || undefined,
  };
}

function normalizeCurrency(value) {
  const text = normalizeText(value);
  return text ? text.toUpperCase() : null;
}

function normalizeInteger(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function pickFirstText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return null;
}

function safeRate(num, den) {
  return den ? Number((num / den).toFixed(4)) : 0;
}

function incrementCounter(target, key, amount = 1) {
  const resolvedKey = normalizeText(key) || 'unknown';
  target[resolvedKey] = (target[resolvedKey] || 0) + amount;
}

function extractAttribution(metadata = {}) {
  const safe = sanitizeMetadata(metadata);
  return {
    source: normalizeText(safe.utmSource || safe.source),
    medium: normalizeText(safe.utmMedium || safe.medium),
    campaign: normalizeText(safe.utmCampaign || safe.campaign),
    content: normalizeText(safe.utmContent || safe.content),
    term: normalizeText(safe.utmTerm || safe.term),
    creator: normalizeText(safe.creator || safe.creatorHandle || safe.creator_handle),
    community: normalizeText(safe.community || safe.subreddit),
    postId: normalizeText(safe.postId || safe.post_id),
    commentId: normalizeText(safe.commentId || safe.comment_id),
    campaignVariant: normalizeText(safe.campaignVariant || safe.variant),
    offerCode: normalizeText(safe.offerCode || safe.offer || safe.coupon),
    referrer: normalizeText(safe.referrer),
    landingPath: normalizeText(safe.landingPath),
    ctaId: normalizeText(safe.ctaId),
  };
}

function extractJourneyFields(metadata = {}) {
  const safe = sanitizeMetadata(metadata);
  const attribution = extractAttribution(safe);
  return {
    acquisitionId: normalizeText(safe.acquisitionId),
    visitorId: normalizeText(safe.visitorId),
    sessionId: normalizeText(safe.sessionId),
    ctaId: attribution.ctaId,
    ctaPlacement: normalizeText(safe.ctaPlacement),
    planId: normalizeText(safe.planId),
    creator: attribution.creator,
    community: attribution.community,
    postId: attribution.postId,
    commentId: attribution.commentId,
    campaignVariant: attribution.campaignVariant,
    offerCode: attribution.offerCode,
    referrer: attribution.referrer,
    referrerHost: normalizeText(safe.referrerHost),
    landingPath: attribution.landingPath,
    utmSource: attribution.source,
    utmMedium: attribution.medium,
    utmCampaign: attribution.campaign,
    utmContent: attribution.content,
    utmTerm: attribution.term,
  };
}

function resolveAttributionSource(attribution, fallback = null) {
  return attribution.source || normalizeText(fallback) || 'unknown';
}

function resolveAttributionCampaign(attribution) {
  return attribution.campaign || 'unassigned';
}

function resolveAcquisitionLeadKey(entry = {}) {
  const metadata = sanitizeMetadata(entry.metadata);
  const attribution = sanitizeMetadata(entry.attribution);
  return pickFirstText(
    entry.acquisitionId,
    metadata.acquisitionId,
    attribution.acquisitionId,
    entry.traceId,
    metadata.traceId,
    attribution.traceId,
    entry.visitorId,
    metadata.visitorId,
    attribution.visitorId,
    entry.sessionId,
    metadata.sessionId,
    attribution.sessionId,
    entry.installId,
    metadata.installId,
    attribution.installId,
    entry.orderId,
    metadata.orderId,
    entry.evidence
  );
}

function buildProviderEventFallbackKey(entry = {}, metadata = {}, attribution = {}) {
  const provider = normalizeText(metadata.provider || entry.provider || attribution.source || entry.source) || 'unknown';
  const customerId = normalizeText(metadata.customerId || entry.customerId);
  const accountId = normalizeText(metadata.accountId || entry.accountId);
  const planId = normalizeText(entry.planId || metadata.planId);
  const timestamp = normalizeText(entry.timestamp);
  const evidence = normalizeText(entry.evidence);

  if (customerId && timestamp) {
    return [provider, customerId, planId || accountId || evidence || 'event', timestamp].join(':');
  }

  if (accountId && timestamp) {
    return [provider, accountId, planId || evidence || 'event', timestamp].join(':');
  }

  if (customerId && evidence) {
    return [provider, customerId, planId || evidence].join(':');
  }

  return null;
}

function resolveEvidenceOrderKey(entry = {}) {
  const evidence = normalizeText(entry.evidence);
  const eventName = normalizeText(entry.event);
  if (!evidence) return null;
  return evidence !== eventName ? evidence : null;
}

function resolvePaidProviderEventKey(entry = {}) {
  const metadata = sanitizeMetadata(entry.metadata);
  const attribution = extractAttribution({
    ...metadata,
    ...sanitizeMetadata(entry.attribution),
    ...sanitizeMetadata(entry),
  });
  return pickFirstText(
    entry.orderId,
    metadata.orderId,
    metadata.sessionId,
    metadata.marketplaceOrderId,
    resolveEvidenceOrderKey(entry),
    buildProviderEventFallbackKey(entry, metadata, attribution),
    resolveAcquisitionLeadKey(entry)
  );
}

function resolveRevenueEventKey(entry = {}) {
  const metadata = sanitizeMetadata(entry.metadata);
  const attribution = sanitizeMetadata(entry.attribution);
  return pickFirstText(
    entry.orderId,
    metadata.orderId,
    metadata.marketplaceOrderId,
    resolveEvidenceOrderKey(entry),
    buildProviderEventFallbackKey(entry, metadata, attribution),
    entry.evidence,
    entry.traceId,
    metadata.traceId,
    attribution.traceId,
    entry.installId,
    metadata.installId,
    attribution.installId,
    entry.customerId
  );
}

function isQualifiedWorkflowSprintLead(entry = {}) {
  return Boolean(
    normalizeText(entry.contact && entry.contact.email) &&
    normalizeText(entry.qualification && entry.qualification.workflow) &&
    normalizeText(entry.qualification && entry.qualification.owner) &&
    normalizeText(entry.qualification && entry.qualification.blocker) &&
    normalizeText(entry.qualification && entry.qualification.runtime)
  );
}

function isOperatorGeneratedAcquisitionEntry(entry = {}) {
  const metadata = sanitizeMetadata(entry.metadata);
  const attribution = extractAttribution({
    ...metadata,
    ...sanitizeMetadata(entry.attribution),
    ...sanitizeMetadata(entry),
  });
  const source = normalizeText(attribution.source || metadata.source || entry.source);
  const medium = normalizeText(attribution.medium || metadata.medium || entry.utmMedium);
  const eventName = normalizeText(entry.event);

  return source === 'cli' ||
    medium === 'operator_outreach' ||
    eventName === 'outreach_target_generated' ||
    eventName === 'outreach_sequence_started' ||
    eventName === 'lead_list_generated';
}

function hasRevenueEventMatch(entries, target) {
  const targetKey = resolveRevenueEventKey(target);
  if (!targetKey) return false;
  return entries.some((entry) => {
    return normalizeText(entry.status) === normalizeText(target.status) &&
      resolveRevenueEventKey(entry) === targetKey;
  });
}

function hasFunnelEventMatch(entries, target) {
  const targetKey = resolvePaidProviderEventKey(target);
  if (!targetKey) return false;
  return entries.some((entry) => {
    return normalizeText(entry.stage) === normalizeText(target.stage) &&
      normalizeText(entry.event) === normalizeText(target.event) &&
      resolvePaidProviderEventKey(entry) === targetKey;
  });
}

function appendFunnelEvent({ stage, event, installId = null, traceId = null, evidence, metadata = {} } = {}) {
  if (!stage || !event) return { written: false, reason: 'missing_stage_or_event' };
  const payload = {
    timestamp: new Date().toISOString(),
    stage,
    event,
    evidence: evidence || event,
    installId: installId || null,
    traceId: traceId || metadata.traceId || null,
    ...extractJourneyFields(metadata),
    metadata: sanitizeMetadata(metadata),
  };
  return appendJsonlRecord(CONFIG.FUNNEL_LEDGER_PATH, payload);
}

function loadFunnelLedger() {
  return loadJsonlRecords(
    CONFIG.FUNNEL_LEDGER_PATH,
    resolveLegacyBillingPath('funnel-events.jsonl')
  );
}

function loadRevenueLedger() {
  return loadJsonlRecords(
    CONFIG.REVENUE_LEDGER_PATH,
    resolveLegacyBillingPath('revenue-events.jsonl')
  );
}

function loadNewsletterSubscribers() {
  return loadJsonlRecords(
    CONFIG.NEWSLETTER_SUBSCRIBERS_PATH,
    resolveLegacyBillingPath('newsletter-subscribers.jsonl')
  );
}

function resolveRevenueLedgerFilePath() {
  const primary = CONFIG.REVENUE_LEDGER_PATH;
  const legacy = resolveLegacyBillingPath('revenue-events.jsonl');
  if (fs.existsSync(primary) || IS_TEST) {
    return primary;
  }
  if (legacy !== primary && fs.existsSync(legacy)) {
    return legacy;
  }
  return primary;
}

function deriveRevenueEventFromPaidProviderEvent(entry = {}) {
  const metadata = sanitizeMetadata(entry.metadata);
  const provider = normalizeText(metadata.provider || entry.provider || entry.utmSource || entry.source);
  const customerId = normalizeText(metadata.customerId || entry.customerId);
  const orderId = resolvePaidProviderEventKey(entry);
  if (!provider || !customerId || !orderId) return null;

  const attribution = extractAttribution({
    ...metadata,
    ...sanitizeMetadata(entry.attribution),
    ...sanitizeMetadata(entry),
  });

  return {
    timestamp: normalizeText(entry.timestamp) || new Date().toISOString(),
    provider,
    event: normalizeText(entry.event) || 'paid_provider_event',
    status: 'paid',
    orderId,
    evidence: normalizeText(entry.evidence) || orderId,
    customerId,
    installId: normalizeText(entry.installId),
    traceId: normalizeText(entry.traceId),
    amountCents: null,
    currency: null,
    amountKnown: false,
    recurringInterval: null,
    attribution,
    ...extractJourneyFields({
      ...metadata,
      ...sanitizeMetadata(entry),
      ...sanitizeMetadata(entry.attribution),
    }),
    metadata: {
      ...metadata,
      derivedFromPaidProviderEvent: true,
    },
  };
}

function loadResolvedRevenueEvents(options = {}) {
  const analyticsWindow = resolveAnalyticsWindow(options);
  const extraRevenueEvents = Array.isArray(options.extraRevenueEvents) ? options.extraRevenueEvents : [];
  const revenueEvents = filterEntriesForWindow(
    loadRevenueLedger(),
    analyticsWindow,
    (entry) => entry && entry.timestamp
  ).map((entry) => resolveGithubMarketplaceRevenueEntry(entry, { annotate: false }).entry);
  const paidProviderEvents = filterEntriesForWindow(
    loadFunnelLedger(),
    analyticsWindow,
    (entry) => entry && entry.timestamp
  ).filter((entry) => entry && entry.stage === 'paid');
  const resolved = [...revenueEvents];

  for (const entry of paidProviderEvents) {
    const derived = deriveRevenueEventFromPaidProviderEvent(entry);
    if (!derived) continue;
    if (hasRevenueEventMatch(resolved, derived)) continue;
    resolved.push(derived);
  }

  return mergeRevenueEvents(resolved, extraRevenueEvents);
}

function repairGithubMarketplaceRevenueLedger(options = {}) {
  const write = Boolean(options.write);
  const ledgerPath = resolveRevenueLedgerFilePath();
  const rows = loadJsonlFile(ledgerPath);
  const resolvedAt = new Date().toISOString();
  const repairs = [];
  const updatedRows = rows.map((entry) => {
    const result = resolveGithubMarketplaceRevenueEntry(entry, {
      annotate: true,
      resolvedAt,
    });
    if (!result.changed) {
      return entry;
    }
    const metadata = sanitizeMetadata(result.entry.metadata);
    repairs.push({
      orderId: normalizeText(result.entry.orderId),
      customerId: normalizeText(result.entry.customerId),
      planId: normalizeText(metadata.planId ?? result.entry.planId),
      amountCents: normalizeInteger(result.entry.amountCents),
      currency: normalizeCurrency(result.entry.currency),
      recurringInterval: normalizeText(result.entry.recurringInterval),
      pricingSource: normalizeText(metadata.githubMarketplaceAmountSource),
    });
    return result.entry;
  });

  const writeResult = write && repairs.length > 0
    ? writeJsonlRecords(ledgerPath, updatedRows)
    : { written: false, rowCount: rows.length };

  return {
    ledgerPath,
    write,
    wrote: Boolean(writeResult.written),
    scanned: rows.length,
    repaired: repairs.length,
    unchanged: rows.length - repairs.length,
    repairs,
    writeResult,
  };
}

function appendRevenueEvent({
  provider,
  event,
  status = 'paid',
  customerId,
  orderId = null,
  installId = null,
  traceId = null,
  evidence = null,
  amountCents = null,
  currency = null,
  amountKnown = false,
  recurringInterval = null,
  attribution = {},
  metadata = {},
} = {}) {
  if (!provider || !event || !customerId) {
    return { written: false, reason: 'missing_required_fields' };
  }

  const normalizedAmount = normalizeInteger(amountCents);
  const journeyFields = extractJourneyFields({
    ...sanitizeMetadata(metadata),
    ...sanitizeMetadata(attribution),
  });
  const payload = {
    timestamp: new Date().toISOString(),
    provider: normalizeText(provider),
    event,
    status: normalizeText(status) || 'paid',
    orderId: normalizeText(orderId) || normalizeText(evidence) || null,
    evidence: evidence || orderId || event,
    customerId,
    installId: installId || null,
    traceId: traceId || metadata.traceId || null,
    amountCents: normalizedAmount,
    currency: normalizeCurrency(currency),
    amountKnown: Boolean(amountKnown && normalizedAmount !== null),
    recurringInterval: normalizeText(recurringInterval),
    attribution: extractAttribution({ ...sanitizeMetadata(metadata), ...sanitizeMetadata(attribution) }),
    ...journeyFields,
    metadata: sanitizeMetadata(metadata),
  };

  return appendJsonlRecord(CONFIG.REVENUE_LEDGER_PATH, payload);
}

function loadLocalCheckoutSessions() {
  try {
    const primary = CONFIG.LOCAL_CHECKOUT_SESSIONS_PATH;
    const legacy = resolveLegacyBillingPath('local-checkout-sessions.json');
    const target = fs.existsSync(primary) ? primary : legacy;
    if (!fs.existsSync(target)) return { sessions: {} };
    const parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
    return (parsed && typeof parsed.sessions === 'object') ? parsed : { sessions: {} };
  } catch { return { sessions: {} }; }
}

function saveLocalCheckoutSessions(store) {
  const target = CONFIG.LOCAL_CHECKOUT_SESSIONS_PATH;
  ensureParentDir(target);
  fs.writeFileSync(target, JSON.stringify(store, null, 2), 'utf-8');
}

function serializeStripeMetadata(metadata) {
  const safe = sanitizeMetadata(metadata);
  const serialized = {};
  for (const [key, value] of Object.entries(safe)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') continue;
    serialized[key] = String(value);
  }
  return serialized;
}

function resolveSubscriptionCheckoutSelection(checkoutMetadata = {}) {
  const planId = normalizePlanId(checkoutMetadata.planId);
  const billingCycle = normalizeBillingCycle(checkoutMetadata.billingCycle);

  if (planId === 'team') {
    const seatCount = normalizeSeatCount(checkoutMetadata.seatCount, TEAM_MIN_SEATS);
    return {
      planId: 'team',
      billingCycle: 'monthly',
      seatCount,
      quantity: seatCount,
      priceId: CONFIG.STRIPE_PRICE_ID_TEAM_MONTHLY,
      unitPriceDollars: TEAM_MONTHLY_PRICE_DOLLARS,
      totalPriceDollars: TEAM_MONTHLY_PRICE_DOLLARS * seatCount,
    };
  }

  if (billingCycle === 'annual') {
    return {
      planId: 'pro',
      billingCycle: 'annual',
      seatCount: 1,
      quantity: 1,
      priceId: CONFIG.STRIPE_PRICE_ID_PRO_ANNUAL,
      unitPriceDollars: PRO_ANNUAL_PRICE_DOLLARS,
      totalPriceDollars: PRO_ANNUAL_PRICE_DOLLARS,
    };
  }

  return {
    planId: 'pro',
    billingCycle: 'monthly',
    seatCount: 1,
    quantity: 1,
    priceId: CONFIG.STRIPE_PRICE_ID_PRO_MONTHLY || CONFIG.STRIPE_PRICE_ID,
    unitPriceDollars: PRO_MONTHLY_PRICE_DOLLARS,
    totalPriceDollars: PRO_MONTHLY_PRICE_DOLLARS,
  };
}

function parseGithubPlanPricing() {
  if (!CONFIG.GITHUB_MARKETPLACE_PLAN_PRICES_JSON) return {};
  try {
    const parsed = JSON.parse(CONFIG.GITHUB_MARKETPLACE_PLAN_PRICES_JSON);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function resolveGithubWebhookPlanPricing(marketplacePurchase) {
  if (!marketplacePurchase || typeof marketplacePurchase !== 'object') {
    return { amountKnown: false, amountCents: null, currency: null, recurringInterval: null, pricingSource: 'unknown' };
  }

  const plan = marketplacePurchase.plan && typeof marketplacePurchase.plan === 'object'
    ? marketplacePurchase.plan
    : {};
  const billingCycle = normalizeText(marketplacePurchase.billing_cycle ?? marketplacePurchase.billingCycle);
  const monthlyPriceCents = normalizeInteger(plan.monthly_price_in_cents ?? plan.monthlyPriceInCents);
  const yearlyPriceCents = normalizeInteger(plan.yearly_price_in_cents ?? plan.yearlyPriceInCents);
  const priceModel = normalizeText(plan.price_model ?? plan.priceModel);
  const unitCount = normalizeInteger(marketplacePurchase.unit_count ?? marketplacePurchase.unitCount);

  let amountCents = null;
  let recurringInterval = null;
  const normalizedCycle = billingCycle ? billingCycle.toLowerCase() : null;

  if (normalizedCycle === 'monthly' || normalizedCycle === 'month') {
    amountCents = monthlyPriceCents;
    recurringInterval = 'month';
  } else if (normalizedCycle === 'yearly' || normalizedCycle === 'annual' || normalizedCycle === 'year') {
    amountCents = yearlyPriceCents;
    recurringInterval = 'year';
  } else if (monthlyPriceCents !== null && yearlyPriceCents === null) {
    amountCents = monthlyPriceCents;
    recurringInterval = 'month';
  } else if (yearlyPriceCents !== null && monthlyPriceCents === null) {
    amountCents = yearlyPriceCents;
    recurringInterval = 'year';
  }

  if (amountCents !== null && priceModel && priceModel.toUpperCase() === 'PER_UNIT') {
    if (unitCount === null) {
      return { amountKnown: false, amountCents: null, currency: null, recurringInterval, pricingSource: 'unknown' };
    }
    amountCents *= unitCount;
  }

  return {
    amountKnown: amountCents !== null,
    amountCents,
    currency: amountCents !== null ? 'USD' : null,
    recurringInterval,
    pricingSource: amountCents !== null ? 'webhook' : 'unknown',
  };
}

function resolveGithubPlanPricing(planId, marketplacePurchase = null) {
  const webhookPricing = resolveGithubWebhookPlanPricing(marketplacePurchase);
  if (webhookPricing.amountKnown) {
    return webhookPricing;
  }

  const pricing = parseGithubPlanPricing();
  const raw = pricing[String(planId)];
  if (raw === undefined) {
    return { amountKnown: false, amountCents: null, currency: null, recurringInterval: null, pricingSource: 'unknown' };
  }

  if (typeof raw === 'number') {
    return {
      amountKnown: Number.isFinite(raw),
      amountCents: normalizeInteger(raw),
      currency: 'USD',
      recurringInterval: null,
      pricingSource: 'configured_plan_price',
    };
  }

  if (!raw || typeof raw !== 'object') {
    return { amountKnown: false, amountCents: null, currency: null, recurringInterval: null, pricingSource: 'unknown' };
  }

  const amountCents = normalizeInteger(raw.amountCents ?? raw.amount ?? raw.priceCents);
  return {
    amountKnown: amountCents !== null,
    amountCents,
    currency: normalizeCurrency(raw.currency) || 'USD',
    recurringInterval: normalizeText(raw.recurringInterval || raw.interval),
    pricingSource: amountCents !== null ? 'configured_plan_price' : 'unknown',
  };
}

function buildGithubMarketplacePurchaseFromMetadata(entry = {}) {
  const metadata = sanitizeMetadata(entry.metadata);
  const billingCycle = normalizeText(
    metadata.billingCycle ??
    metadata.billing_cycle ??
    entry.billingCycle ??
    entry.billing_cycle
  );
  const unitCount = normalizeInteger(metadata.unitCount ?? metadata.unit_count ?? entry.unitCount ?? entry.unit_count);
  const monthlyPriceInCents = normalizeInteger(
    metadata.monthlyPriceInCents ??
    metadata.monthly_price_in_cents ??
    entry.monthlyPriceInCents ??
    entry.monthly_price_in_cents
  );
  const yearlyPriceInCents = normalizeInteger(
    metadata.yearlyPriceInCents ??
    metadata.yearly_price_in_cents ??
    entry.yearlyPriceInCents ??
    entry.yearly_price_in_cents
  );
  const priceModel = normalizeText(
    metadata.priceModel ??
    metadata.price_model ??
    entry.priceModel ??
    entry.price_model
  );
  const planId = normalizeText(metadata.planId ?? entry.planId);
  const planName = normalizeText(metadata.planName ?? entry.planName);

  if (!billingCycle && unitCount === null && monthlyPriceInCents === null && yearlyPriceInCents === null && !priceModel && !planId && !planName) {
    return null;
  }

  return {
    billing_cycle: billingCycle,
    unit_count: unitCount,
    plan: {
      id: planId,
      name: planName,
      monthly_price_in_cents: monthlyPriceInCents,
      yearly_price_in_cents: yearlyPriceInCents,
      price_model: priceModel,
    },
  };
}

function resolveGithubMarketplaceRevenueEntry(entry = {}, options = {}) {
  if (!entry || normalizeText(entry.provider) !== 'github_marketplace') {
    return { changed: false, entry };
  }

  if (normalizeText(entry.status) !== 'paid') {
    return { changed: false, entry };
  }

  if (Boolean(entry.amountKnown) && normalizeInteger(entry.amountCents) !== null) {
    return { changed: false, entry };
  }

  const metadata = sanitizeMetadata(entry.metadata);
  const marketplacePurchase = buildGithubMarketplacePurchaseFromMetadata(entry);
  const planPricing = resolveGithubPlanPricing(metadata.planId ?? entry.planId, marketplacePurchase);
  if (!planPricing.amountKnown) {
    return { changed: false, entry };
  }

  const resolvedAt = options.resolvedAt || new Date().toISOString();
  const updatedMetadata = {
    ...metadata,
    githubMarketplaceAmountSource: planPricing.pricingSource,
  };
  if (options.annotate !== false) {
    updatedMetadata.githubMarketplaceAmountResolvedAt = resolvedAt;
  }

  return {
    changed: true,
    entry: {
      ...entry,
      amountCents: planPricing.amountCents,
      currency: planPricing.currency || normalizeCurrency(entry.currency),
      amountKnown: true,
      recurringInterval: planPricing.recurringInterval || normalizeText(entry.recurringInterval),
      metadata: updatedMetadata,
    },
    pricingSource: planPricing.pricingSource,
  };
}

function parseTestStripeReconciledRevenueEvents() {
  const raw = process.env._TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === 'object') : [];
  } catch {
    return [];
  }
}

function mergeRevenueEvents(entries = [], extraEntries = []) {
  const merged = [...entries];

  for (const entry of extraEntries) {
    if (!entry || typeof entry !== 'object') continue;
    if (hasRevenueEventMatch(merged, entry)) continue;
    merged.push(entry);
  }

  return merged;
}

function buildStripePriceCatalog(currentPrice, relatedPrices = []) {
  const productId = normalizeText(CONFIG.STRIPE_PRODUCT_ID || (currentPrice && currentPrice.product));
  const prices = new Map();

  function addPrice(price) {
    if (!price || typeof price !== 'object') return;
    const priceId = normalizeText(price.id);
    if (!priceId) return;
    prices.set(priceId, {
      priceId,
      productId: normalizeText(price.product) || productId,
      unitAmount: normalizeInteger(price.unit_amount),
      recurringInterval: normalizeText(price.recurring && price.recurring.interval),
      active: Boolean(price.active),
    });
  }

  addPrice(currentPrice);
  for (const price of relatedPrices) {
    addPrice(price);
  }

  return {
    productId,
    prices,
  };
}

function matchStripeInvoiceLine(priceCatalog, line = {}) {
  const price = line.price || {};
  const priceId = normalizeText(price.id);
  const productId = normalizeText(price.product);

  if (priceId && priceCatalog.prices.has(priceId)) {
    return priceCatalog.prices.get(priceId);
  }

  if (productId && priceCatalog.productId && productId === priceCatalog.productId) {
    return {
      priceId: priceId || null,
      productId,
      unitAmount: normalizeInteger(price.unit_amount),
      recurringInterval: normalizeText(price.recurring && price.recurring.interval),
      active: Boolean(price.active),
    };
  }

  return null;
}

function matchStripeChargeFromSubscriptions(priceCatalog, charge, subscriptions = []) {
  if (!charge || !Array.isArray(subscriptions) || subscriptions.length === 0) {
    return null;
  }

  const matches = [];
  for (const subscription of subscriptions) {
    const items = subscription && subscription.items && Array.isArray(subscription.items.data)
      ? subscription.items.data
      : [];
    for (const item of items) {
      const price = item.price || {};
      const priceId = normalizeText(price.id);
      const productId = normalizeText(price.product);
      const unitAmount = normalizeInteger(price.unit_amount);
      const recurringInterval = normalizeText(price.recurring && price.recurring.interval);
      const matchesConfiguredPrice = priceId && priceCatalog.prices.has(priceId);
      const matchesConfiguredProduct = productId && priceCatalog.productId && productId === priceCatalog.productId;

      if (!matchesConfiguredPrice && !matchesConfiguredProduct) {
        continue;
      }

      matches.push({
        priceId: priceId || null,
        productId: productId || priceCatalog.productId,
        unitAmount,
        recurringInterval,
        subscriptionId: normalizeText(subscription.id),
      });
    }
  }

  if (matches.length === 0) {
    return null;
  }

  const exactAmountMatch = matches.find((candidate) => {
    return candidate.unitAmount !== null && candidate.unitAmount === normalizeInteger(charge.amount);
  });
  if (exactAmountMatch) {
    return exactAmountMatch;
  }

  const description = normalizeText(charge.description || '') || '';
  return description.toLowerCase().startsWith('subscription') ? matches[0] : null;
}

function buildStripeReconciledRevenueEvent(charge, match = {}) {
  const timestampMs = Number(charge.created) * 1000;
  const timestamp = Number.isFinite(timestampMs)
    ? new Date(timestampMs).toISOString()
    : new Date().toISOString();
  const amountCents = normalizeInteger(charge.amount);

  return {
    timestamp,
    provider: 'stripe',
    event: 'stripe_charge_reconciled',
    status: 'paid',
    orderId: normalizeText(charge.id),
    evidence: normalizeText(charge.id) || 'stripe_charge_reconciled',
    customerId: normalizeText(charge.customer) || `stripe_charge_${normalizeText(charge.id) || 'unknown'}`,
    installId: null,
    traceId: null,
    amountCents,
    currency: normalizeCurrency(charge.currency),
    amountKnown: amountCents !== null,
    recurringInterval: normalizeText(match.recurringInterval),
    attribution: {
      source: 'stripe_reconciled',
    },
    metadata: {
      stripeReconciled: true,
      chargeId: normalizeText(charge.id),
      paymentIntentId: normalizeText(charge.payment_intent),
      invoiceId: normalizeText(charge.invoice),
      priceId: normalizeText(match.priceId),
      productId: normalizeText(match.productId),
      subscriptionId: normalizeText(match.subscriptionId),
      historicalPrice: Boolean(match.priceId && match.priceId !== CONFIG.STRIPE_PRICE_ID),
    },
  };
}

async function listStripeReconciledRevenueEvents() {
  const testEvents = parseTestStripeReconciledRevenueEvents();
  if (testEvents.length > 0) {
    return testEvents;
  }

  if (!CONFIG.STRIPE_SECRET_KEY || !CONFIG.STRIPE_PRICE_ID) {
    return [];
  }

  let stripe;
  try {
    stripe = getStripeClient();
  } catch {
    return [];
  }

  const currentPrice = await withTimeout(stripe.prices.retrieve(CONFIG.STRIPE_PRICE_ID));
  const relatedPrices = await withTimeout(stripe.prices.list({
    product: CONFIG.STRIPE_PRODUCT_ID || currentPrice.product,
    limit: 100,
  }));
  const priceCatalog = buildStripePriceCatalog(
    currentPrice,
    relatedPrices && Array.isArray(relatedPrices.data) ? relatedPrices.data : []
  );
  if (!priceCatalog.productId) {
    return [];
  }

  const charges = await withTimeout(stripe.charges.list({ limit: 100 }));
  const reconciled = [];
  const invoiceCache = new Map();
  const subscriptionCache = new Map();

  for (const charge of charges.data || []) {
    if (!charge || !charge.paid || charge.status !== 'succeeded' || charge.refunded) {
      continue;
    }

    let match = null;

    if (charge.invoice) {
      const invoiceId = normalizeText(charge.invoice);
      if (invoiceId) {
        let invoice = invoiceCache.get(invoiceId);
        if (!invoice) {
          invoice = await withTimeout(stripe.invoices.retrieve(invoiceId, { expand: ['lines.data.price'] }));
          invoiceCache.set(invoiceId, invoice);
        }
        const lines = invoice && invoice.lines && Array.isArray(invoice.lines.data) ? invoice.lines.data : [];
        match = lines.map((line) => matchStripeInvoiceLine(priceCatalog, line)).find(Boolean) || null;
      }
    }

    if (!match && charge.customer) {
      const customerId = normalizeText(charge.customer);
      if (customerId) {
        let subscriptions = subscriptionCache.get(customerId);
        if (!subscriptions) {
          const listed = await withTimeout(stripe.subscriptions.list({
            customer: customerId,
            status: 'all',
            limit: 100,
          }));
          subscriptions = listed && Array.isArray(listed.data) ? listed.data : [];
          subscriptionCache.set(customerId, subscriptions);
        }
        match = matchStripeChargeFromSubscriptions(priceCatalog, charge, subscriptions);
      }
    }

    if (!match) {
      continue;
    }

    reconciled.push(buildStripeReconciledRevenueEvent(charge, match));
  }

  return reconciled;
}

function getFunnelAnalytics(options = {}) {
  const analyticsWindow = resolveAnalyticsWindow(options);
  const extraRevenueEvents = Array.isArray(options.extraRevenueEvents) ? options.extraRevenueEvents : [];
  const events = filterEntriesForWindow(
    loadFunnelLedger(),
    analyticsWindow,
    (entry) => entry && entry.timestamp
  );
  const paidOrders = loadResolvedRevenueEvents({ ...analyticsWindow, extraRevenueEvents }).filter((entry) => entry && entry.status === 'paid');
  const stageCounts = { acquisition: 0, activation: 0, paid: 0 };
  const eventCounts = {};
  for (const entry of events) {
    if (entry && stageCounts.hasOwnProperty(entry.stage)) {
      stageCounts[entry.stage]++;
      const key = `${entry.stage}:${entry.event || 'unknown'}`;
      eventCounts[key] = (eventCounts[key] || 0) + 1;
    }
  }
  return {
    window: serializeAnalyticsWindow(analyticsWindow),
    totalEvents: events.length,
    stageCounts,
    eventCounts,
    conversionRates: {
      acquisitionToActivation: safeRate(stageCounts.activation, stageCounts.acquisition),
      activationToPaid: safeRate(paidOrders.length, stageCounts.activation),
      acquisitionToPaid: safeRate(paidOrders.length, stageCounts.acquisition),
    },
    paidProviderEvents: stageCounts.paid,
  };
}

function getBusinessAnalytics(options = {}) {
  const analyticsWindow = resolveAnalyticsWindow(options);
  const extraRevenueEvents = Array.isArray(options.extraRevenueEvents) ? options.extraRevenueEvents : [];
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const telemetry = getTelemetryAnalytics(FEEDBACK_DIR, analyticsWindow);
  const sourceDiagnostics = buildBillingSourceDiagnostics(FEEDBACK_DIR);
  const events = filterEntriesForWindow(
    loadFunnelLedger(),
    analyticsWindow,
    (entry) => entry && entry.timestamp
  );
  const revenueEvents = loadResolvedRevenueEvents({ ...analyticsWindow, extraRevenueEvents });
  const workflowSprintIntake = loadWorkflowSprintIntakeModule();
  const workflowSprintLeads = filterEntriesForWindow(
    workflowSprintIntake ? workflowSprintIntake.loadWorkflowSprintLeads() : [],
    analyticsWindow,
    (entry) => entry && entry.submittedAt
  );
  const newsletterSubscribers = filterEntriesForWindow(
    loadNewsletterSubscribers(),
    analyticsWindow,
    (entry) => entry && entry.subscribedAt
  );
  const funnel = getFunnelAnalytics({ ...analyticsWindow, extraRevenueEvents });
  const acquisitionEvents = events.filter((entry) => entry && entry.stage === 'acquisition');
  const paidEvents = events.filter((entry) => entry && entry.stage === 'paid');
  const paidOrders = revenueEvents.filter((entry) => entry && entry.status === 'paid');
  const firstPaid = paidEvents[0] || null;
  const lastPaid = paidEvents[paidEvents.length - 1] || null;

  const signupsBySource = {};
  const signupsByCampaign = {};
  const signupsByCreator = {};
  const signupsByCommunity = {};
  const signupsByPostId = {};
  const signupsByCommentId = {};
  const signupsByCampaignVariant = {};
  const signupsByOfferCode = {};
  const acquisitionLeadKeys = new Set();
  const operatorGeneratedAcquisitionBySource = {};
  const operatorGeneratedAcquisitionLeadKeys = new Set();
  for (const entry of acquisitionEvents) {
    const attribution = extractAttribution({
      ...sanitizeMetadata(entry.metadata),
      ...sanitizeMetadata(entry),
    });
    const sourceKey = resolveAttributionSource(attribution);
    const campaignKey = resolveAttributionCampaign(attribution);
    incrementCounter(signupsBySource, sourceKey);
    incrementCounter(signupsByCampaign, campaignKey);
    incrementCounter(signupsByCreator, attribution.creator);
    incrementCounter(signupsByCommunity, attribution.community);
    incrementCounter(signupsByPostId, attribution.postId);
    incrementCounter(signupsByCommentId, attribution.commentId);
    incrementCounter(signupsByCampaignVariant, attribution.campaignVariant);
    incrementCounter(signupsByOfferCode, attribution.offerCode);
    acquisitionLeadKeys.add(resolveAcquisitionLeadKey(entry) || `${entry.timestamp}:${entry.event}`);
    if (isOperatorGeneratedAcquisitionEntry(entry)) {
      incrementCounter(operatorGeneratedAcquisitionBySource, sourceKey);
      operatorGeneratedAcquisitionLeadKeys.add(resolveAcquisitionLeadKey(entry) || `${entry.timestamp}:${entry.event}`);
    }
  }

  const paidBySource = {};
  const paidByCampaign = {};
  const paidByCreator = {};
  const paidByCommunity = {};
  const paidByPostId = {};
  const paidByCommentId = {};
  const paidByCampaignVariant = {};
  const paidByOfferCode = {};
  const bookedRevenueBySourceCents = {};
  const bookedRevenueByCampaignCents = {};
  const bookedRevenueByCreatorCents = {};
  const bookedRevenueByCommunityCents = {};
  const bookedRevenueByPostIdCents = {};
  const bookedRevenueByCommentIdCents = {};
  const bookedRevenueByCampaignVariantCents = {};
  const bookedRevenueByOfferCodeCents = {};
  const bookedRevenueByCtaId = {};
  const bookedRevenueByLandingPath = {};
  const bookedRevenueByReferrerHost = {};
  const bookedRevenueByCurrency = {};
  const paidCustomerIds = new Set();
  const revenueByProvider = {};
  let bookedRevenueCents = 0;
  let amountKnownOrders = 0;
  let amountUnknownOrders = 0;
  let derivedPaidOrders = 0;
  let paidOrdersToday = 0;
  let bookedRevenueTodayCents = 0;
  let processorReconciledOrders = 0;
  let processorReconciledRevenueCents = 0;
  let latestPaidAt = null;
  let latestPaidOrder = null;

  for (const entry of paidOrders) {
    const providerKey = normalizeText(entry.provider) || 'unknown';
    const attribution = extractAttribution({
      ...sanitizeMetadata(entry.attribution || {}),
      ...sanitizeMetadata(entry),
    });
    const sourceKey = resolveAttributionSource(attribution, providerKey);
    const campaignKey = resolveAttributionCampaign(attribution);
    incrementCounter(paidBySource, sourceKey);
    incrementCounter(paidByCampaign, campaignKey);
    incrementCounter(paidByCreator, attribution.creator);
    incrementCounter(paidByCommunity, attribution.community);
    incrementCounter(paidByPostId, attribution.postId);
    incrementCounter(paidByCommentId, attribution.commentId);
    incrementCounter(paidByCampaignVariant, attribution.campaignVariant);
    incrementCounter(paidByOfferCode, attribution.offerCode);
    paidCustomerIds.add(entry.customerId);

    if (!revenueByProvider[providerKey]) {
      revenueByProvider[providerKey] = {
        paidOrders: 0,
        bookedRevenueCents: 0,
        amountKnownOrders: 0,
        amountUnknownOrders: 0,
        bookedRevenueByCurrency: {},
      };
    }

    const providerSummary = revenueByProvider[providerKey];
    providerSummary.paidOrders += 1;

    if (entry.amountKnown && Number.isInteger(entry.amountCents)) {
      const currency = normalizeCurrency(entry.currency) || 'UNKNOWN';
      amountKnownOrders += 1;
      bookedRevenueCents += entry.amountCents;
      if (eventOccursInWindow(entry.timestamp, {
        window: 'today',
        timeZone: analyticsWindow.timeZone,
        now: analyticsWindow.now,
      })) {
        paidOrdersToday += 1;
        bookedRevenueTodayCents += entry.amountCents;
      }
      incrementCounter(bookedRevenueBySourceCents, sourceKey, entry.amountCents);
      incrementCounter(bookedRevenueByCampaignCents, campaignKey, entry.amountCents);
      incrementCounter(bookedRevenueByCreatorCents, attribution.creator, entry.amountCents);
      incrementCounter(bookedRevenueByCommunityCents, attribution.community, entry.amountCents);
      incrementCounter(bookedRevenueByPostIdCents, attribution.postId, entry.amountCents);
      incrementCounter(bookedRevenueByCommentIdCents, attribution.commentId, entry.amountCents);
      incrementCounter(bookedRevenueByCampaignVariantCents, attribution.campaignVariant, entry.amountCents);
      incrementCounter(bookedRevenueByOfferCodeCents, attribution.offerCode, entry.amountCents);
      incrementCounter(bookedRevenueByCtaId, entry.ctaId, entry.amountCents);
      incrementCounter(bookedRevenueByLandingPath, entry.landingPath, entry.amountCents);
      incrementCounter(bookedRevenueByReferrerHost, entry.referrerHost, entry.amountCents);
      incrementCounter(bookedRevenueByCurrency, currency, entry.amountCents);
      providerSummary.bookedRevenueCents += entry.amountCents;
      providerSummary.amountKnownOrders += 1;
      incrementCounter(providerSummary.bookedRevenueByCurrency, currency, entry.amountCents);
    } else {
      amountUnknownOrders += 1;
      providerSummary.amountUnknownOrders += 1;
    }

    if (entry.metadata && entry.metadata.derivedFromPaidProviderEvent) {
      derivedPaidOrders += 1;
    }
    if (entry.metadata && entry.metadata.stripeReconciled) {
      processorReconciledOrders += 1;
      if (entry.amountKnown && Number.isInteger(entry.amountCents)) {
        processorReconciledRevenueCents += entry.amountCents;
      }
    }

    if (!latestPaidAt || String(entry.timestamp || '') > latestPaidAt) {
      latestPaidAt = entry.timestamp || null;
      latestPaidOrder = {
        timestamp: entry.timestamp || null,
        provider: entry.provider || null,
        event: entry.event || null,
        orderId: entry.orderId || null,
        customerId: entry.customerId || null,
        amountCents: entry.amountCents ?? null,
        currency: entry.currency || null,
        amountKnown: Boolean(entry.amountKnown),
      };
    }
  }

  const conversionBySource = {};
  for (const sourceKey of new Set([...Object.keys(signupsBySource), ...Object.keys(paidBySource)])) {
    conversionBySource[sourceKey] = safeRate(paidBySource[sourceKey] || 0, signupsBySource[sourceKey] || 0);
  }

  const conversionByCampaign = {};
  for (const campaignKey of new Set([...Object.keys(signupsByCampaign), ...Object.keys(paidByCampaign)])) {
    conversionByCampaign[campaignKey] = safeRate(paidByCampaign[campaignKey] || 0, signupsByCampaign[campaignKey] || 0);
  }

  const conversionByCreator = {};
  for (const creatorKey of new Set([...Object.keys(signupsByCreator), ...Object.keys(paidByCreator)])) {
    conversionByCreator[creatorKey] = safeRate(paidByCreator[creatorKey] || 0, signupsByCreator[creatorKey] || 0);
  }

  const conversionByCommunity = {};
  for (const communityKey of new Set([...Object.keys(signupsByCommunity), ...Object.keys(paidByCommunity)])) {
    conversionByCommunity[communityKey] = safeRate(paidByCommunity[communityKey] || 0, signupsByCommunity[communityKey] || 0);
  }

  const conversionByPostId = {};
  for (const postId of new Set([...Object.keys(signupsByPostId), ...Object.keys(paidByPostId)])) {
    conversionByPostId[postId] = safeRate(paidByPostId[postId] || 0, signupsByPostId[postId] || 0);
  }

  const conversionByCommentId = {};
  for (const commentId of new Set([...Object.keys(signupsByCommentId), ...Object.keys(paidByCommentId)])) {
    conversionByCommentId[commentId] = safeRate(paidByCommentId[commentId] || 0, signupsByCommentId[commentId] || 0);
  }

  const conversionByCampaignVariant = {};
  for (const variant of new Set([...Object.keys(signupsByCampaignVariant), ...Object.keys(paidByCampaignVariant)])) {
    conversionByCampaignVariant[variant] = safeRate(paidByCampaignVariant[variant] || 0, signupsByCampaignVariant[variant] || 0);
  }

  const conversionByOfferCode = {};
  for (const offerCode of new Set([...Object.keys(signupsByOfferCode), ...Object.keys(paidByOfferCode)])) {
    conversionByOfferCode[offerCode] = safeRate(paidByOfferCode[offerCode] || 0, signupsByOfferCode[offerCode] || 0);
  }

  const workflowSprintLeadStatus = {};
  const workflowSprintLeadBySource = {};
  const workflowSprintLeadByCampaign = {};
  const workflowSprintLeadByCreator = {};
  const workflowSprintLeadByCommunity = {};
  const workflowSprintLeadByRuntime = {};
  const qualifiedWorkflowSprintLeadBySource = {};
  const qualifiedWorkflowSprintLeadByCreator = {};
  let workflowSprintLeadLatest = null;
  let workflowSprintLeadLatestAt = null;
  let workflowSprintLeadContactable = 0;
  let qualifiedWorkflowSprintLeadCount = 0;
  const newsletterBySource = {};
  const newsletterByCampaign = {};
  const newsletterByCreator = {};
  const newsletterByCommunity = {};
  const newsletterByPostId = {};
  const newsletterByCommentId = {};
  const newsletterByCampaignVariant = {};
  const newsletterByOfferCode = {};
  const newsletterSubscriberKeys = new Set();
  let newsletterLatest = null;
  let newsletterLatestAt = null;

  for (const entry of workflowSprintLeads) {
    if (!entry || typeof entry !== 'object') continue;
    incrementCounter(workflowSprintLeadStatus, entry.status);
    const attribution = extractAttribution(entry.attribution || {});
    incrementCounter(workflowSprintLeadBySource, resolveAttributionSource(attribution, 'workflow_sprint_intake'));
    incrementCounter(workflowSprintLeadByCampaign, resolveAttributionCampaign(attribution));
    incrementCounter(workflowSprintLeadByCreator, attribution.creator);
    incrementCounter(workflowSprintLeadByCommunity, attribution.community);
    incrementCounter(workflowSprintLeadByRuntime, entry.qualification?.runtime);

    if (entry.contact?.email) {
      workflowSprintLeadContactable += 1;
    }
    if (isQualifiedWorkflowSprintLead(entry)) {
      qualifiedWorkflowSprintLeadCount += 1;
      incrementCounter(
        qualifiedWorkflowSprintLeadBySource,
        resolveAttributionSource(attribution, 'workflow_sprint_intake')
      );
      incrementCounter(qualifiedWorkflowSprintLeadByCreator, attribution.creator);
    }

    if (!workflowSprintLeadLatestAt || String(entry.submittedAt || '') > workflowSprintLeadLatestAt) {
      workflowSprintLeadLatestAt = entry.submittedAt || null;
      workflowSprintLeadLatest = {
        leadId: entry.leadId || null,
        submittedAt: entry.submittedAt || null,
        status: entry.status || null,
        email: entry.contact?.email || null,
        company: entry.contact?.company || null,
        workflow: entry.qualification?.workflow || null,
        owner: entry.qualification?.owner || null,
        runtime: entry.qualification?.runtime || null,
        source: attribution.source || null,
        campaign: attribution.campaign || null,
      };
    }
  }

  for (const entry of newsletterSubscribers) {
    if (!entry || typeof entry !== 'object') continue;
    const attribution = extractAttribution({
      ...sanitizeMetadata(entry.attribution || {}),
      ...sanitizeMetadata(entry),
    });
    incrementCounter(newsletterBySource, resolveAttributionSource(attribution, entry.source || 'newsletter'));
    incrementCounter(newsletterByCampaign, resolveAttributionCampaign(attribution));
    incrementCounter(newsletterByCreator, attribution.creator);
    incrementCounter(newsletterByCommunity, attribution.community);
    incrementCounter(newsletterByPostId, attribution.postId);
    incrementCounter(newsletterByCommentId, attribution.commentId);
    incrementCounter(newsletterByCampaignVariant, attribution.campaignVariant);
    incrementCounter(newsletterByOfferCode, attribution.offerCode);

    newsletterSubscriberKeys.add(
      pickFirstText(
        entry.email,
        entry.acquisitionId,
        entry.visitorId,
        entry.sessionId,
        entry.subscribedAt
      )
    );

    if (!newsletterLatestAt || String(entry.subscribedAt || '') > newsletterLatestAt) {
      newsletterLatestAt = entry.subscribedAt || null;
      newsletterLatest = {
        email: entry.email || null,
        subscribedAt: entry.subscribedAt || null,
        source: resolveAttributionSource(attribution, entry.source || 'newsletter'),
        campaign: resolveAttributionCampaign(attribution),
        creator: attribution.creator || null,
        community: attribution.community || null,
        landingPath: pickFirstText(entry.landingPath, attribution.landingPath),
        referrerHost: entry.referrerHost || null,
      };
    }
  }

  const unreconciledPaidEvents = paidEvents.filter((entry) => {
    const eventKey = resolvePaidProviderEventKey(entry);
    if (!eventKey) return true;
    return !paidOrders.some((order) => resolveRevenueEventKey(order) === eventKey);
  }).length;

  const trafficMetrics = {
    visitors: telemetry.visitors ? telemetry.visitors.uniqueVisitors || 0 : 0,
    sessions: telemetry.visitors ? telemetry.visitors.uniqueSessions || 0 : 0,
    pageViews: telemetry.visitors ? telemetry.visitors.pageViews || 0 : 0,
    ctaClicks: telemetry.ctas ? telemetry.ctas.totalClicks || 0 : 0,
    checkoutStarts: telemetry.ctas ? telemetry.ctas.checkoutStarts || 0 : 0,
    checkoutSuccessPageViews: telemetry.ctas ? telemetry.ctas.successPageViews || 0 : 0,
    checkoutCancelPageViews: telemetry.ctas ? telemetry.ctas.cancelPageViews || 0 : 0,
    checkoutPaidConfirmations: telemetry.ctas ? telemetry.ctas.paidConfirmations || 0 : 0,
    checkoutPendingSessions: telemetry.ctas ? telemetry.ctas.sessionPending || 0 : 0,
    checkoutLookupFailures: telemetry.ctas ? telemetry.ctas.lookupFailures || 0 : 0,
    buyerLossFeedback: telemetry.buyerLoss ? telemetry.buyerLoss.totalSignals || 0 : 0,
    seoLandingViews: telemetry.seo ? telemetry.seo.landingViews || 0 : 0,
    newsletterSignups: newsletterSubscribers.length,
  };

  const operatorGeneratedAcquisition = {
    totalEvents: acquisitionEvents.filter(isOperatorGeneratedAcquisitionEntry).length,
    uniqueLeads: operatorGeneratedAcquisitionLeadKeys.size,
    bySource: operatorGeneratedAcquisitionBySource,
  };

  const dataQuality = {
    telemetryCoverage: Number(((
      (telemetry.visitors ? telemetry.visitors.visitorIdCoverageRate || 0 : 0) +
      (telemetry.visitors ? telemetry.visitors.sessionIdCoverageRate || 0 : 0) +
      (telemetry.visitors ? telemetry.visitors.acquisitionIdCoverageRate || 0 : 0)
    ) / 3).toFixed(4)),
    attributionCoverage: telemetry.visitors ? telemetry.visitors.attributionCoverageRate || 0 : 0,
    amountKnownCoverage: paidOrders.length ? safeRate(amountKnownOrders, paidOrders.length) : 0,
    unreconciledPaidEvents,
  };

  return {
    generatedAt: new Date().toISOString(),
    window: serializeAnalyticsWindow(analyticsWindow),
    coverage: {
      source: 'funnel_ledger+revenue_ledger+workflow_sprint_leads',
      tracksBookedRevenue: true,
      tracksPaidOrders: true,
      tracksInvoices: false,
      tracksAttribution: true,
      tracksWorkflowSprintLeads: true,
      tracksNewsletterSubscribers: true,
      providerCoverage: {
        stripe: processorReconciledOrders > 0 ? 'booked_revenue+processor_reconciled' : 'booked_revenue',
        githubMarketplace: 'webhook_or_configured_plan_prices',
      },
    },
    funnel: {
      ...funnel,
      uniqueAcquisitionLeads: acquisitionLeadKeys.size,
      uniquePaidCustomers: paidCustomerIds.size,
      firstPaidAt: firstPaid ? firstPaid.timestamp || null : null,
      lastPaidAt: lastPaid ? lastPaid.timestamp || null : null,
      lastPaidEvent: lastPaid ? {
        timestamp: lastPaid.timestamp || null,
        event: lastPaid.event || null,
        evidence: lastPaid.evidence || null,
        customerId: lastPaid.metadata?.customerId || null,
        traceId: lastPaid.traceId || null,
      } : null,
    },
    signups: {
      total: acquisitionEvents.length,
      uniqueLeads: acquisitionLeadKeys.size,
      bySource: signupsBySource,
      byCampaign: signupsByCampaign,
      byCreator: signupsByCreator,
      byCommunity: signupsByCommunity,
      byPostId: signupsByPostId,
      byCommentId: signupsByCommentId,
      byCampaignVariant: signupsByCampaignVariant,
      byOfferCode: signupsByOfferCode,
    },
    revenue: {
      paidProviderEvents: paidEvents.length,
      paidOrders: paidOrders.length,
      paidCustomers: paidCustomerIds.size,
      bookedRevenueCents,
      bookedRevenueTodayCents,
      bookedRevenueByCurrency,
      amountKnownOrders,
      amountUnknownOrders,
      derivedPaidOrders,
      paidOrdersToday,
      processorReconciledOrders,
      processorReconciledRevenueCents,
      amountKnownCoverageRate: safeRate(amountKnownOrders, paidOrders.length),
      unreconciledPaidEvents,
      latestPaidAt,
      latestPaidOrder,
      byProvider: revenueByProvider,
    },
    pipeline: {
      workflowSprintLeads: {
        total: workflowSprintLeads.length,
        contactable: workflowSprintLeadContactable,
        byStatus: workflowSprintLeadStatus,
        bySource: workflowSprintLeadBySource,
        byCampaign: workflowSprintLeadByCampaign,
        byCreator: workflowSprintLeadByCreator,
        byCommunity: workflowSprintLeadByCommunity,
        byRuntime: workflowSprintLeadByRuntime,
        latestLeadAt: workflowSprintLeadLatestAt,
        latestLead: workflowSprintLeadLatest,
      },
      qualifiedWorkflowSprintLeads: {
        total: qualifiedWorkflowSprintLeadCount,
        bySource: qualifiedWorkflowSprintLeadBySource,
        byCreator: qualifiedWorkflowSprintLeadByCreator,
      },
    },
    newsletter: {
      total: newsletterSubscribers.length,
      uniqueSubscribers: newsletterSubscriberKeys.size,
      bySource: newsletterBySource,
      byCampaign: newsletterByCampaign,
      byCreator: newsletterByCreator,
      byCommunity: newsletterByCommunity,
      byPostId: newsletterByPostId,
      byCommentId: newsletterByCommentId,
      byCampaignVariant: newsletterByCampaignVariant,
      byOfferCode: newsletterByOfferCode,
      latestSubscribedAt: newsletterLatestAt,
      latestSubscriber: newsletterLatest,
    },
    attribution: {
      acquisitionBySource: signupsBySource,
      acquisitionByCampaign: signupsByCampaign,
      acquisitionByCreator: signupsByCreator,
      acquisitionByCommunity: signupsByCommunity,
      acquisitionByPostId: signupsByPostId,
      acquisitionByCommentId: signupsByCommentId,
      acquisitionByCampaignVariant: signupsByCampaignVariant,
      acquisitionByOfferCode: signupsByOfferCode,
      paidBySource,
      paidByCampaign,
      paidByCreator,
      paidByCommunity,
      paidByPostId,
      paidByCommentId,
      paidByCampaignVariant,
      paidByOfferCode,
      bookedRevenueBySourceCents,
      bookedRevenueByCampaignCents,
      bookedRevenueByCreatorCents,
      bookedRevenueByCommunityCents,
      bookedRevenueByPostIdCents,
      bookedRevenueByCommentIdCents,
      bookedRevenueByCampaignVariantCents,
      bookedRevenueByOfferCodeCents,
      bookedRevenueByCtaId,
      bookedRevenueByLandingPath,
      bookedRevenueByReferrerHost,
      conversionBySource,
      conversionByCampaign,
      conversionByCreator,
      conversionByCommunity,
      conversionByPostId,
      conversionByCommentId,
      conversionByCampaignVariant,
      conversionByOfferCode,
    },
    trafficMetrics,
    operatorGeneratedAcquisition,
    dataQuality,
    sourceDiagnostics,
  };
}

function getBillingSummary(options = {}) {
  const business = getBusinessAnalytics(options);
  const store = loadKeyStore();
  const keyEntries = Object.values(store.keys || {});
  const customers = new Map();
  const bySource = {};
  const activeBySource = {};
  let activeKeys = 0;
  let disabledKeys = 0;
  let totalUsage = 0;
  const activeCustomerIds = new Set();

  for (const meta of keyEntries) {
    const source = meta.source || 'unknown';
    const customerId = meta.customerId || 'unknown';
    const usageCount = Number(meta.usageCount || 0);
    bySource[source] = (bySource[source] || 0) + 1;
    totalUsage += usageCount;

    if (meta.active) {
      activeKeys += 1;
      activeBySource[source] = (activeBySource[source] || 0) + 1;
      activeCustomerIds.add(customerId);
    } else {
      disabledKeys += 1;
    }

    if (!customers.has(customerId)) {
      customers.set(customerId, {
        customerId,
        activeKeys: 0,
        totalKeys: 0,
        usageCount: 0,
        source,
        installId: meta.installId || null,
        createdAt: meta.createdAt || null,
        disabledAt: meta.disabledAt || null,
      });
    }

    const summary = customers.get(customerId);
    summary.totalKeys += 1;
    summary.usageCount += usageCount;
    if (meta.active) {
      summary.activeKeys += 1;
    }
    if (meta.source && (!summary.source || summary.source === 'unknown')) {
      summary.source = meta.source;
    }
    if (meta.installId && !summary.installId) {
      summary.installId = meta.installId;
    }
    if (meta.createdAt && (!summary.createdAt || meta.createdAt < summary.createdAt)) {
      summary.createdAt = meta.createdAt;
    }
    if (meta.disabledAt && (!summary.disabledAt || meta.disabledAt > summary.disabledAt)) {
      summary.disabledAt = meta.disabledAt;
    }
  }

  const orderedCustomers = Array.from(customers.values()).sort((a, b) => {
    const aTime = a.createdAt || '';
    const bTime = b.createdAt || '';
    return aTime.localeCompare(bTime) || a.customerId.localeCompare(b.customerId);
  });

  return {
    generatedAt: business.generatedAt,
    window: business.window,
    coverage: {
      ...business.coverage,
      source: 'funnel_ledger+revenue_ledger+key_store+workflow_sprint_leads',
    },
    funnel: business.funnel,
    signups: business.signups,
    revenue: business.revenue,
    pipeline: business.pipeline,
    newsletter: business.newsletter,
    attribution: business.attribution,
    trafficMetrics: business.trafficMetrics,
    operatorGeneratedAcquisition: business.operatorGeneratedAcquisition,
    dataQuality: business.dataQuality,
    sourceDiagnostics: business.sourceDiagnostics,
    keys: {
      scope: 'current_state',
      windowed: false,
      total: keyEntries.length,
      active: activeKeys,
      disabled: disabledKeys,
      activeCustomers: activeCustomerIds.size,
      totalUsage,
      bySource,
      activeBySource,
    },
    customers: orderedCustomers,
  };
}

async function getBillingSummaryLive(options = {}) {
  try {
    const extraRevenueEvents = await listStripeReconciledRevenueEvents().catch(() => []);
    return getBillingSummary({
      ...options,
      extraRevenueEvents,
    });
  } catch (err) {
    const isTimeout = err && err.message && err.message.includes('Stripe API timeout');
    return {
      error: isTimeout ? 'stripe_timeout' : 'billing_summary_error',
      message: err && err.message ? err.message : 'Unknown error',
      revenue: { total: 0, mrr: 0, events: [] },
      usage: { totalUsage: 0, bySource: {}, activeBySource: {} },
      customers: [],
    };
  }
}

function loadKeyStore() {
  try {
    const primary = CONFIG.API_KEYS_PATH;
    const legacy = resolveLegacyBillingPath('api-keys.json');
    const target = (IS_TEST || fs.existsSync(primary)) ? primary : legacy;
    if (!fs.existsSync(target)) return { keys: {} };
    const parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
    return (parsed && typeof parsed.keys === 'object') ? parsed : { keys: {} };
  } catch { return { keys: {} }; }
}

function saveKeyStore(store) {
  const target = CONFIG.API_KEYS_PATH;
  ensureParentDir(target);
  fs.writeFileSync(target, JSON.stringify(store, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Core Exports
// ---------------------------------------------------------------------------

async function createCheckoutSession({ successUrl, cancelUrl, customerEmail, installId, traceId, packId = null, metadata = {}, appOrigin } = {}) {
  const resolvedTraceId = traceId || metadata.traceId || createTraceId('checkout');
  const baseCheckoutMetadata = sanitizeMetadata({
    ...metadata,
    installId: installId || metadata.installId || 'unknown',
    traceId: resolvedTraceId,
  });
  const checkoutSelection = packId ? null : resolveSubscriptionCheckoutSelection(baseCheckoutMetadata);
  const checkoutMetadata = packId
    ? baseCheckoutMetadata
    : sanitizeMetadata({
        ...baseCheckoutMetadata,
        planId: checkoutSelection.planId,
        billingCycle: checkoutSelection.billingCycle,
        seatCount: checkoutSelection.seatCount,
        priceId: checkoutSelection.priceId,
      });
  const resolvedInstallId = installId || checkoutMetadata.installId || 'unknown';

  if (LOCAL_MODE()) {
    const localSessionId = `test_session_${crypto.randomBytes(8).toString('hex')}`;
    const store = loadLocalCheckoutSessions();
    const pack = packId ? CONFIG.CREDIT_PACKS[packId] : null;
    const localCustomerEmail = normalizeEmail(customerEmail);
    store.sessions[localSessionId] = {
      id: localSessionId,
      customer: `local_cus_${crypto.randomBytes(4).toString('hex')}`,
      customer_email: localCustomerEmail,
      customer_details: localCustomerEmail ? { email: localCustomerEmail } : null,
      metadata: { ...checkoutMetadata, packId: pack ? pack.id : null, credits: pack ? pack.credits : null },
      payment_status: 'paid',
      status: 'complete'
    };
    saveLocalCheckoutSessions(store);

    appendFunnelEvent({
      stage: 'acquisition',
      event: 'checkout_session_created',
      installId: resolvedInstallId,
      traceId: resolvedTraceId,
      evidence: 'local_mode_manual',
      metadata: { ...checkoutMetadata, packId: pack ? pack.id : null },
    });
    return { sessionId: localSessionId, url: null, localMode: true, traceId: resolvedTraceId, metadata: checkoutMetadata };
  }

  const stripe = getStripeClient();
  const sessionPayload = buildCheckoutSessionPayload({
    successUrl,
    cancelUrl,
    customerEmail,
    checkoutMetadata,
    packId,
    appOrigin,
  });
  let session;
  try {
    session = await stripe.checkout.sessions.create(sessionPayload);
  } catch (err) {
    if (!sessionPayload.branding_settings || !String(err && err.message).includes('branding_settings')) {
      throw err;
    }
    const fallbackPayload = { ...sessionPayload };
    delete fallbackPayload.branding_settings;
    session = await stripe.checkout.sessions.create(fallbackPayload);
  }

  appendFunnelEvent({
    stage: 'acquisition',
    event: 'checkout_session_created',
    installId: resolvedInstallId,
    traceId: resolvedTraceId,
    evidence: session.id,
    metadata: { ...checkoutMetadata, packId },
  });
  return { sessionId: session.id, url: session.url, localMode: false, traceId: resolvedTraceId, metadata: checkoutMetadata };
}

function buildCheckoutSessionPayload({ successUrl, cancelUrl, customerEmail, checkoutMetadata, packId = null, appOrigin } = {}) {
  const pack = packId ? CONFIG.CREDIT_PACKS[packId] : null;
  const checkoutSelection = pack ? null : resolveSubscriptionCheckoutSelection(checkoutMetadata);
  if (!pack && !checkoutSelection.priceId) {
    throw new Error(`Stripe price ID is missing for ${checkoutSelection.planId} ${checkoutSelection.billingCycle} checkout.`);
  }
  const lineItems = pack
    ? [{
        price_data: {
          currency: pack.currency.toLowerCase(),
          product_data: buildCheckoutProductData({
            name: pack.name,
            description: 'ThumbGate usage credits for hosted agent governance.',
            appOrigin,
          }),
          unit_amount: pack.amountCents,
        },
        quantity: 1,
      }]
    : [{
        price_data: buildSubscriptionPriceData(checkoutSelection, appOrigin),
        quantity: checkoutSelection.quantity,
      }];

  const sessionPayload = {
    success_url: successUrl,
    cancel_url: cancelUrl,
    payment_method_types: ['card', 'link'],
    mode: pack ? 'payment' : 'subscription',
    line_items: lineItems,
    branding_settings: buildCheckoutBrandingSettings(appOrigin),
    metadata: serializeStripeMetadata({
      ...checkoutMetadata,
      planId: pack ? checkoutMetadata.planId : checkoutSelection.planId,
      billingCycle: pack ? checkoutMetadata.billingCycle : checkoutSelection.billingCycle,
      seatCount: pack ? checkoutMetadata.seatCount : checkoutSelection.seatCount,
      priceId: pack ? checkoutMetadata.priceId : checkoutSelection.priceId,
      packId: pack ? pack.id : null,
      credits: pack ? pack.credits : null,
    }),
    // 7-day free trial for subscriptions — don't require card upfront
    ...(pack ? {} : {
      subscription_data: { trial_period_days: 7 },
      payment_method_collection: 'if_required',
    }),
  };

  const normalizedCustomerEmail = normalizeText(customerEmail);
  if (normalizedCustomerEmail) {
    sessionPayload.customer_email = normalizedCustomerEmail;
  }
  return sessionPayload;
}

async function getCheckoutSessionStatus(sessionId) {
  if (LOCAL_MODE()) {
    const store = loadLocalCheckoutSessions();
    const session = store.sessions[sessionId];
    if (!session) return { found: false };
    const provisioned = provisionApiKey(session.customer, {
      installId: session.metadata?.installId,
      credits: session.metadata?.credits,
      source: 'local_checkout_lookup'
    });
    const customerEmail = session.customer_details?.email || session.customer_email || '';
    const customerName = session.customer_details?.name || null;
    const trialEndAt = computeTrialEndAt(session);
    const trialEmail = await sendTrialActivationEmail({
      sessionId,
      customerId: session.customer,
      customerEmail,
      customerName,
      trialEndAt,
      apiKey: provisioned.key,
      planId: session.metadata?.planId || session.metadata?.packId || null,
      appOrigin: process.env.THUMBGATE_PUBLIC_APP_ORIGIN,
      source: 'local_checkout_lookup',
    });
    return {
      found: true,
      localMode: true,
      sessionId,
      paid: true,
      paymentStatus: 'paid',
      status: 'complete',
      customerId: session.customer,
      customerEmail,
      installId: session.metadata?.installId,
      traceId: session.metadata?.traceId || null,
      acquisitionId: session.metadata?.acquisitionId || null,
      visitorId: session.metadata?.visitorId || null,
      visitorSessionId: session.metadata?.sessionId || null,
      ctaId: session.metadata?.ctaId || null,
      ctaPlacement: session.metadata?.ctaPlacement || null,
      planId: session.metadata?.planId || session.metadata?.packId || null,
      landingPath: session.metadata?.landingPath || null,
      referrerHost: session.metadata?.referrerHost || null,
      apiKey: provisioned.key,
      remainingCredits: provisioned.remainingCredits,
      trialEmail,
    };
  }

  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const isPaid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    const traceId = session.metadata?.traceId || null;

    if (!isPaid) return { found: true, localMode: false, sessionId, paid: false, paymentStatus: session.payment_status, status: session.status };

    const installId = session.metadata?.installId || null;
    const credits = session.metadata?.credits ? parseInt(session.metadata.credits, 10) : null;
    const provisioned = provisionApiKey(session.customer, { installId, credits, source: 'stripe_checkout_session_lookup' });
    const customerEmail = session.customer_details?.email || session.customer_email || '';
    const customerName = session.customer_details?.name || null;
    const trialEndAt = computeTrialEndAt(session);
    const trialEmail = await sendTrialActivationEmail({
      sessionId,
      customerId: session.customer,
      customerEmail,
      customerName,
      trialEndAt,
      apiKey: provisioned.key,
      planId: session.metadata?.planId || session.metadata?.packId || null,
      appOrigin: process.env.THUMBGATE_PUBLIC_APP_ORIGIN,
      source: 'stripe_checkout_session_lookup',
    });

    return {
      found: true,
      localMode: false,
      sessionId,
      paid: true,
      paymentStatus: session.payment_status,
      customerId: session.customer,
      customerEmail,
      installId,
      traceId,
      acquisitionId: session.metadata?.acquisitionId || null,
      visitorId: session.metadata?.visitorId || null,
      visitorSessionId: session.metadata?.sessionId || null,
      ctaId: session.metadata?.ctaId || null,
      ctaPlacement: session.metadata?.ctaPlacement || null,
      planId: session.metadata?.planId || session.metadata?.packId || null,
      landingPath: session.metadata?.landingPath || null,
      referrerHost: session.metadata?.referrerHost || null,
      apiKey: provisioned.key,
      remainingCredits: provisioned.remainingCredits,
      trialEmail,
    };
  } catch {
    return { found: false };
  }
}

function provisionApiKey(customerId, opts = {}) {
  if (!customerId || typeof customerId !== 'string') throw new Error('customerId is required');
  const store = loadKeyStore();
  const existing = Object.entries(store.keys).find(([, m]) => m.customerId === customerId && m.active);

  const creditsToAdd = normalizeInteger(opts.credits);

  if (existing) {
    const key = existing[0];
    const meta = existing[1];
    if (opts.installId && !meta.installId) { meta.installId = opts.installId; }
    if (creditsToAdd !== null) {
      meta.remainingCredits = (meta.remainingCredits || 0) + creditsToAdd;
    }
    saveKeyStore(store);
    return { key, customerId, createdAt: meta.createdAt, installId: meta.installId || null, reused: true, remainingCredits: meta.remainingCredits };
  }

  const key = `tg_${crypto.randomBytes(16).toString('hex')}`;
  const createdAt = new Date().toISOString();
  store.keys[key] = {
    customerId,
    active: true,
    usageCount: 0,
    createdAt,
    installId: opts.installId || null,
    source: opts.source || 'provision',
    remainingCredits: creditsToAdd // null means unlimited (standard subscription)
  };
  saveKeyStore(store);
  return { key, customerId, createdAt, installId: opts.installId || null, remainingCredits: creditsToAdd };
}

function rotateApiKey(oldKey) {
  if (!oldKey) return { rotated: false, reason: 'missing_old_key' };
  const store = loadKeyStore();
  const meta = store.keys[oldKey];
  if (!meta || !meta.active) return { rotated: false, reason: 'key_not_active' };

  meta.active = false;
  meta.disabledAt = new Date().toISOString();
  const newKey = `tg_${crypto.randomBytes(16).toString('hex')}`;
  store.keys[newKey] = {
    customerId: meta.customerId,
    active: true,
    usageCount: 0,
    createdAt: new Date().toISOString(),
    installId: meta.installId,
    source: 'rotation',
    replacedKey: oldKey,
    remainingCredits: meta.remainingCredits
  };
  saveKeyStore(store);
  return { rotated: true, key: newKey, oldKey };
}

function validateApiKey(key) {
  if (!key) return { valid: false };
  const store = loadKeyStore();
  const meta = store.keys[key];
  if (!meta || !meta.active) return { valid: false };

  // Check if credits are exhausted
  if (meta.remainingCredits !== undefined && meta.remainingCredits !== null && meta.remainingCredits <= 0) {
    return { valid: false, reason: 'credits_exhausted' };
  }

  return {
    valid: true,
    customerId: meta.customerId,
    usageCount: meta.usageCount || 0,
    installId: meta.installId || null,
    createdAt: meta.createdAt,
    metadata: meta,
  };
}

function recordUsage(key) {
  const store = loadKeyStore();
  const meta = store.keys[key];
  if (meta && meta.active) {
    const oldVal = meta.usageCount || 0;
    meta.usageCount = oldVal + 1;

    // Decrement credits if applicable
    if (meta.remainingCredits !== undefined && meta.remainingCredits !== null) {
      meta.remainingCredits = Math.max(0, meta.remainingCredits - 1);
    }

    if (oldVal === 0) appendFunnelEvent({ stage: 'activation', event: 'api_key_first_usage', installId: meta.installId, evidence: key, metadata: { customerId: meta.customerId } });
    saveKeyStore(store);
    return { recorded: true, usageCount: meta.usageCount, remainingCredits: meta.remainingCredits };
  }
  return { recorded: false };
}

function disableCustomerKeys(customerId) {
  const store = loadKeyStore();
  let disabledCount = 0;
  for (const [key, meta] of Object.entries(store.keys)) {
    if (meta.customerId === customerId && meta.active) { meta.active = false; meta.disabledAt = new Date().toISOString(); disabledCount++; }
  }
  if (disabledCount > 0) saveKeyStore(store);
  return { disabledCount };
}

function verifyWebhookSignature(rawBody, signature) {
  if (!CONFIG.STRIPE_WEBHOOK_SECRET) return true;
  if (!signature || !rawBody) return false;

  // Stripe signature format: t=<timestamp>,v1=<hmac>,...
  const parts = { v1: [] };
  for (const part of signature.split(',')) {
    const [k, v] = part.split('=');
    if (!k || !v) continue;
    if (k === 'v1') {
      parts.v1.push(v);
      continue;
    }
    parts[k] = v;
  }

  if (!parts.t || !Array.isArray(parts.v1) || parts.v1.length === 0) return false;

  // Timestamp tolerance: +/- 5 minutes
  const timestamp = parseInt(parts.t, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(timestamp) || Math.abs(now - timestamp) > 300) return false;

  const payload = `${parts.t}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8')}`;
  const expected = crypto.createHmac('sha256', CONFIG.STRIPE_WEBHOOK_SECRET).update(payload).digest('hex');

  return parts.v1.some((candidate) => safeCompareHex(expected, candidate));
}

async function handleWebhook(rawBody, signature) {
  if (LOCAL_MODE()) return { handled: false, reason: 'local_mode' };
  let event;
  try {
    if (CONFIG.STRIPE_WEBHOOK_SECRET) {
      const stripe = getStripeClient();
      event = stripe.webhooks.constructEvent(rawBody, signature, CONFIG.STRIPE_WEBHOOK_SECRET);
    } else {
      // No webhook secret configured — signature was already checked by verifyWebhookSignature
      // (which is also lenient when no secret). Parse the raw body directly.
      event = JSON.parse(rawBody.toString('utf-8'));
    }
  } catch (err) {
    return { handled: false, reason: 'invalid_signature', error: err.message };
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = session.customer;
      const installId = session.metadata?.installId;
      const traceId = session.metadata?.traceId || null;
      const credits = session.metadata?.credits ? parseInt(session.metadata.credits, 10) : null;
      const packId = session.metadata?.packId || null;
      const customerEmail = session.customer_details?.email || session.customer_email || '';
      const customerName = session.customer_details?.name || null;
      const trialEndAt = computeTrialEndAt(session);

      const attribution = extractAttribution(session.metadata);
      const result = provisionApiKey(customerId, {
        installId,
        credits,
        source: 'stripe_webhook_checkout_completed'
      });
      const trialEmail = await sendTrialActivationEmail({
        sessionId: session.id,
        customerId,
        customerEmail,
        customerName,
        trialEndAt,
        apiKey: result.key,
        planId: session.metadata?.planId || packId || null,
        appOrigin: process.env.THUMBGATE_PUBLIC_APP_ORIGIN,
        source: 'stripe_webhook_checkout_completed',
      });
      const funnelRecord = {
        stage: 'paid',
        event: 'stripe_checkout_completed',
        evidence: session.id,
        metadata: {
          customerId,
          sessionId: session.id,
          traceId,
          packId,
          ...extractJourneyFields(session.metadata),
          ...attribution,
        },
      };
      if (!hasFunnelEventMatch(loadFunnelLedger(), funnelRecord)) {
        appendFunnelEvent({
          stage: 'paid',
          event: 'stripe_checkout_completed',
          installId,
          traceId,
          evidence: session.id,
          metadata: funnelRecord.metadata,
        });
      }
      // Write checkout_paid_confirmed event with amount/currency for funnel analytics
      appendFunnelEvent({
        stage: 'paid',
        event: 'checkout_paid_confirmed',
        installId,
        traceId,
        evidence: session.id,
        metadata: {
          source: 'stripe_webhook_checkout_completed',
          amount: session.amount_total,
          currency: session.currency,
          customerId,
          ...funnelRecord.metadata,
        },
      });
      const revenueRecord = {
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        customerId,
        orderId: session.id,
        metadata: {
          ...extractJourneyFields(session.metadata),
          sessionId: session.id,
          mode: session.mode || null,
          paymentStatus: session.payment_status || null,
          packId,
        },
      };
      if (!hasRevenueEventMatch(loadRevenueLedger(), revenueRecord)) {
        appendRevenueEvent({
          ...revenueRecord,
          installId,
          traceId,
          evidence: session.id,
          amountCents: session.amount_total,
          currency: session.currency,
          amountKnown: session.amount_total !== undefined && session.amount_total !== null,
          recurringInterval: session.mode === 'subscription' ? 'month' : null,
          attribution,
        });
      }
      return {
        handled: true,
        action: 'provisioned_api_key',
        result,
        trialEmail,
        email: trialEmailToWebhookEmailResult(trialEmail),
      };
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      return { handled: true, action: 'disabled_customer_keys', result: disableCustomerKeys(sub.customer) };
    }
    default: return { handled: false, reason: `unhandled_event_type:${event.type}` };
  }
}

function verifyGithubWebhookSignature(rawBody, signature) {
  if (!CONFIG.GITHUB_MARKETPLACE_WEBHOOK_SECRET) return true;
  if (!signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', CONFIG.GITHUB_MARKETPLACE_WEBHOOK_SECRET).update(rawBody).digest('hex');
  const digest = Buffer.from(`sha256=${expected}`, 'utf8');
  const checksum = Buffer.from(signature, 'utf8');
  return checksum.length === digest.length && crypto.timingSafeEqual(digest, checksum);
}

function buildGithubMarketplaceRevenueMetadata(marketplacePurchase = {}, marketplaceOrderId, planPricing = {}) {
  const plan = marketplacePurchase && typeof marketplacePurchase.plan === 'object'
    ? marketplacePurchase.plan
    : {};
  return {
    accountId: normalizeText(marketplacePurchase.account && marketplacePurchase.account.id),
    accountType: normalizeText(marketplacePurchase.account && marketplacePurchase.account.type),
    planId: normalizeText(plan.id),
    planName: normalizeText(plan.name),
    marketplaceOrderId: normalizeText(marketplaceOrderId),
    billingCycle: normalizeText(marketplacePurchase.billing_cycle ?? marketplacePurchase.billingCycle),
    unitCount: normalizeInteger(marketplacePurchase.unit_count ?? marketplacePurchase.unitCount),
    priceModel: normalizeText(plan.price_model ?? plan.priceModel),
    monthlyPriceInCents: normalizeInteger(plan.monthly_price_in_cents ?? plan.monthlyPriceInCents),
    yearlyPriceInCents: normalizeInteger(plan.yearly_price_in_cents ?? plan.yearlyPriceInCents),
    githubMarketplaceAmountSource: normalizeText(planPricing.pricingSource),
  };
}

function handleGithubWebhook(event) {
  if (!event) return { handled: false, reason: 'missing_payload_data' };
  const { action, marketplace_purchase: mp } = event;
  if (!action || !mp || !mp.account?.id) return { handled: false, reason: 'missing_payload_data' };
  const customerId = `github_${String(mp.account.type).toLowerCase()}_${mp.account.id}`;
  const marketplaceOrderId = normalizeText(mp.id) || `github_marketplace_${String(mp.account.id)}_${String(mp.plan?.id || 'unknown')}`;
  const planPricing = resolveGithubPlanPricing(mp.plan?.id, mp);
  const githubMetadata = buildGithubMarketplaceRevenueMetadata(mp, marketplaceOrderId, planPricing);
  switch (action) {
    case 'purchased': {
      const result = provisionApiKey(customerId, { source: 'github_marketplace_purchased' });
      const funnelRecord = {
        stage: 'paid',
        event: 'github_marketplace_purchased',
        evidence: marketplaceOrderId,
        metadata: {
          provider: 'github_marketplace',
          customerId,
          source: 'github_marketplace',
          ...githubMetadata,
        },
      };
      if (!hasFunnelEventMatch(loadFunnelLedger(), funnelRecord)) {
        appendFunnelEvent(funnelRecord);
      }
      const revenueRecord = {
        provider: 'github_marketplace',
        event: 'github_marketplace_purchased',
        status: 'paid',
        customerId,
        orderId: marketplaceOrderId,
        metadata: githubMetadata,
      };
      if (!hasRevenueEventMatch(loadRevenueLedger(), revenueRecord)) {
        appendRevenueEvent({
          ...revenueRecord,
          evidence: marketplaceOrderId,
          amountCents: planPricing.amountCents,
          currency: planPricing.currency,
          amountKnown: planPricing.amountKnown,
          recurringInterval: planPricing.recurringInterval,
          attribution: { source: 'github_marketplace' },
          metadata: githubMetadata,
        });
      }
      return { handled: true, action: 'provisioned_api_key', result };
    }
    case 'cancelled':
      if (!hasRevenueEventMatch(loadRevenueLedger(), {
        provider: 'github_marketplace',
        event: 'github_marketplace_cancelled',
        status: 'cancelled',
        customerId,
        orderId: marketplaceOrderId,
        metadata: { marketplaceOrderId },
      })) {
        appendRevenueEvent({
          provider: 'github_marketplace',
          event: 'github_marketplace_cancelled',
          status: 'cancelled',
          customerId,
          orderId: marketplaceOrderId,
          evidence: marketplaceOrderId,
          amountCents: planPricing.amountCents,
          currency: planPricing.currency,
          amountKnown: planPricing.amountKnown,
          recurringInterval: planPricing.recurringInterval,
          attribution: { source: 'github_marketplace' },
          metadata: githubMetadata,
        });
      }
      return { handled: true, action: 'disabled_customer_keys', result: disableCustomerKeys(customerId) };
    case 'changed': {
      if (!hasRevenueEventMatch(loadRevenueLedger(), {
        provider: 'github_marketplace',
        event: 'github_marketplace_changed',
        status: 'changed',
        customerId,
        orderId: marketplaceOrderId,
        metadata: { marketplaceOrderId },
      })) {
        appendRevenueEvent({
          provider: 'github_marketplace',
          event: 'github_marketplace_changed',
          status: 'changed',
          customerId,
          orderId: marketplaceOrderId,
          evidence: marketplaceOrderId,
          amountCents: planPricing.amountCents,
          currency: planPricing.currency,
          amountKnown: planPricing.amountKnown,
          recurringInterval: planPricing.recurringInterval,
          attribution: { source: 'github_marketplace' },
          metadata: githubMetadata,
        });
      }
      return { handled: true, action: 'plan_changed', result: provisionApiKey(customerId, { source: 'github_marketplace_changed' }) };
    }
    default: return { handled: false, reason: `unhandled_action:${action}` };
  }
}

module.exports = {
  CONFIG, createCheckoutSession, getCheckoutSessionStatus, provisionApiKey, rotateApiKey, validateApiKey, recordUsage, disableCustomerKeys, handleWebhook, verifyWebhookSignature, verifyGithubWebhookSignature, handleGithubWebhook, loadKeyStore, appendFunnelEvent, appendRevenueEvent, loadFunnelLedger, loadRevenueLedger, loadNewsletterSubscribers, loadResolvedRevenueEvents, getFunnelAnalytics, getBusinessAnalytics, getBillingSummary, getBillingSummaryLive, listStripeReconciledRevenueEvents, repairGithubMarketplaceRevenueLedger,
  _buildCheckoutSessionPayload: buildCheckoutSessionPayload,
  _buildTrialActivationEmail: buildTrialActivationEmail,
  _sendTrialActivationEmail: sendTrialActivationEmail,
  _resolveSubscriptionCheckoutSelection: resolveSubscriptionCheckoutSelection,
  _API_KEYS_PATH: () => CONFIG.API_KEYS_PATH,
  _FUNNEL_LEDGER_PATH: () => CONFIG.FUNNEL_LEDGER_PATH,
  _REVENUE_LEDGER_PATH: () => CONFIG.REVENUE_LEDGER_PATH,
  _LOCAL_CHECKOUT_SESSIONS_PATH: () => CONFIG.LOCAL_CHECKOUT_SESSIONS_PATH,
  _TRIAL_EMAIL_LEDGER_PATH: () => CONFIG.TRIAL_EMAIL_LEDGER_PATH,
  _LOCAL_MODE: () => LOCAL_MODE(),
  _withTimeout: withTimeout,
  // Default to the real Resend-backed mailer so production webhooks send the
  // marketing-grade trial-welcome template. Tests overwrite this with a stub
  // (freshBilling() re-requires the module so the default is restored between
  // tests — see tests/billing-webhook-email.test.js).
  _mailer: mailer,
};
