'use strict';

const PRO_MONTHLY_PAYMENT_LINK = 'https://thumbgate.ai/go/pro?utm_source=offer';
const PRO_ANNUAL_PAYMENT_LINK = 'https://buy.stripe.com/3cI8wPfCYaPs2dzdKz3sI07';

const PRO_MONTHLY_PRICE_ID = 'price_1THQY7GGBpd520QYHoS7RG0J';
const PRO_ANNUAL_PRICE_ID = 'price_1THQZ7GGBpd520QYxzDRnxhB';
const TEAM_MONTHLY_PRICE_ID = 'price_1TMIagGGBpd520QY1fUOawZt';

const PRO_MONTHLY_PRICE_DOLLARS = 19;
const PRO_ANNUAL_PRICE_DOLLARS = 149;
const TEAM_MONTHLY_PRICE_DOLLARS = 49;
const TEAM_ANNUAL_PRICE_DOLLARS = 588;
const TEAM_MIN_SEATS = 3;

const PRO_PRICE_LABEL = '$19/mo or $149/yr (individual)';
// Enterprise is the contact-sales tier (absorbs the former Team workflow + the
// regulated-industry lane). Pricing is scoped after intake — no self-serve seat
// price is surfaced. The dormant TEAM_* Stripe constants below remain only as
// inert billing plumbing pending a dedicated cleanup; they are no longer a
// customer-facing tier.
const ENTERPRISE_PRICE_LABEL = 'Custom pricing, scoped after intake — Enterprise agent governance';

function normalizePlanId(value) {
  const text = String(value || '').trim().toLowerCase();
  return text || 'pro';
}

function normalizeBillingCycle(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'yearly') return 'annual';
  return text || 'monthly';
}

function normalizeSeatCount(value, fallback = TEAM_MIN_SEATS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(TEAM_MIN_SEATS, Math.round(parsed));
}

function trackedProUrl(source = 'cli_receipt', content = 'value_receipt') {
  try {
    const url = new URL(PRO_MONTHLY_PAYMENT_LINK);
    url.searchParams.set('utm_source', source);
    url.searchParams.set('utm_medium', 'cli');
    url.searchParams.set('utm_campaign', 'pro_conversion');
    url.searchParams.set('utm_content', content);
    return url.toString();
  } catch (_) {
    return PRO_MONTHLY_PAYMENT_LINK;
  }
}

function pluralize(count, singular, plural = `${singular}s`) {
  return Number(count) === 1 ? singular : plural;
}

function buildCaptureReceipt({ signal, feedbackId, memoryId, actionType } = {}) {
  const normalizedSignal = String(signal || '').toUpperCase() || 'UNKNOWN';
  const lines = [
    '',
    'Value receipt',
    '─'.repeat(50),
    `  Stored proof   : ${normalizedSignal} feedback${feedbackId ? ` (${feedbackId})` : ''}`,
    memoryId ? `  Local memory   : ${memoryId}` : '  Local memory   : saved locally',
    actionType ? `  Rule pressure  : ${actionType}` : '  Rule pressure  : available for promotion',
    '  Free today     : this proof protects this local machine',
    '  Pro recall     : keep this lesson searchable, exportable, and visible in your personal dashboard',
    '  Next proof     : npx thumbgate stats',
    '  Cost proof     : npx thumbgate cost',
    '',
    `  Solo Pro       : ${PRO_PRICE_LABEL} for recall, search, dashboard, managed adapters, and exports`,
    `  Upgrade        : ${trackedProUrl('cli_capture_receipt', actionType || normalizedSignal.toLowerCase())}`,
    `  Enterprise     : ${ENTERPRISE_PRICE_LABEL}; start with one repeated workflow failure`,
    '                   https://thumbgate.ai/#workflow-sprint-intake',
    '',
  ];
  return lines.join('\n');
}

function buildStatsReceipt(stats = {}) {
  const negatives = Number(stats.negatives || stats.totalNegative || 0);
  const blocked = Number(stats.gatesBlocked || stats.blocked || 0);
  const warned = Number(stats.gatesWarned || stats.warned || 0);
  const gates = Number(stats.totalGates || 0);
  const autoPromoted = Number(stats.autoPromotedGates || 0);
  const hasFriction = negatives > 0 || blocked > 0 || warned > 0 || gates > 0;
  if (!hasFriction) return '';

  const interventions = blocked + warned;
  const lines = [
    '',
    'Paid-intent next step',
    '─'.repeat(50),
  ];
  if (interventions > 0) {
    lines.push(`  Proof already seen : ${interventions} gate ${pluralize(interventions, 'intervention')}`);
  }
  if (gates > 0) {
    lines.push(`  Active prevention  : ${gates} ${pluralize(gates, 'gate')} (${autoPromoted} auto-promoted)`);
  }
  if (negatives > 0) {
    lines.push(`  Failure pressure   : ${negatives} negative ${pluralize(negatives, 'signal')}`);
  }
  lines.push('  Show the buyer     : npx thumbgate cost');
  lines.push('  Pro recall value   : keep these lessons/rules searchable, exportable, and visible in your personal dashboard');
  lines.push(`  Solo Pro           : ${trackedProUrl('cli_stats_receipt', 'proof_seen')}`);
  lines.push('  Enterprise         : https://thumbgate.ai/#workflow-sprint-intake');
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  PRO_MONTHLY_PAYMENT_LINK,
  PRO_ANNUAL_PAYMENT_LINK,
  PRO_MONTHLY_PRICE_ID,
  PRO_ANNUAL_PRICE_ID,
  TEAM_MONTHLY_PRICE_ID,
  PRO_MONTHLY_PRICE_DOLLARS,
  PRO_ANNUAL_PRICE_DOLLARS,
  TEAM_MONTHLY_PRICE_DOLLARS,
  TEAM_ANNUAL_PRICE_DOLLARS,
  TEAM_MIN_SEATS,
  PRO_PRICE_LABEL,
  ENTERPRISE_PRICE_LABEL,
  normalizePlanId,
  normalizeBillingCycle,
  normalizeSeatCount,
  buildCaptureReceipt,
  buildStatsReceipt,
  trackedProUrl,
};
