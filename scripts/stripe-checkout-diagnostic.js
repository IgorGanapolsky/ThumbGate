#!/usr/bin/env node
/**
 * stripe-checkout-diagnostic.js — answer "WHY did 1000 checkout sessions
 * produce 0 completed payments?"
 *
 * Background. The external-customer-audit (PR #2095) revealed that lifetime
 * checkout sessions on acct_1TWIXn73 are 1000+ with 0 completions. That is
 * not a "small sample" — it's a definitive funnel collapse at the Stripe
 * page. The unified rollup reports the COUNT but not the CAUSE. This script
 * pulls the actual cause distribution from Stripe.
 *
 * What this exposes:
 *   1. Checkout session terminal status breakdown (complete / expired /
 *      open / etc) plus payment_intent status when present.
 *   2. PaymentIntent last_payment_error reasons (decline codes, network
 *      rejections, fraud blocks).
 *   3. Stripe Account requirements — currently_due, past_due,
 *      eventually_due — the explicit fields blocking the account from
 *      processing payments normally.
 *   4. Charges_enabled / payouts_enabled / disabled_reason on the account.
 *   5. Webhook endpoint health — when did we last receive a
 *      checkout.session.completed event vs the last attempt.
 *
 * This is the diagnostic that should run BEFORE anyone speculates about
 * "is the checkout broken" — it produces hard data on which exact failure
 * mode is biting.
 *
 * Run modes:
 *   node scripts/stripe-checkout-diagnostic.js           # markdown report
 *   node scripts/stripe-checkout-diagnostic.js --json    # machine output
 *
 * Required env:
 *   STRIPE_SECRET_KEY     live Stripe key (read access)
 */

'use strict';

const path = require('node:path');

function parseArgs(argv = []) {
  return {
    json: argv.includes('--json'),
    // Default raised from 100 to 10000 to match the audit's uncapped posture.
    // A diagnostic framed around "lifetime 2000+ sessions" should look at
    // the lifetime, not a 100-row sample. Caller can pass --limit=N to
    // restrict for development.
    limit: extractIntFlag(argv, '--limit=', 10000),
  };
}

function extractIntFlag(argv, prefix, fallback) {
  const match = argv.find((arg) => arg.startsWith(prefix));
  if (!match) return fallback;
  const n = Number(match.slice(prefix.length));
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function loadStripe(requireFn = require) {
  return requireFn('stripe');
}

async function listAllPaged(listFn, params = {}, max = 100000) {
  // Default raised from 1000 to 100,000 to match external-customer-audit's
  // uncapped posture (Codex P1). The cap is a runaway-guard, not a silent
  // truncator. Tests pass a small max to exercise the bound explicitly.
  const out = [];
  let startingAfter;
  while (out.length < max) {
    const page = await listFn({ ...params, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    if (!page?.data) break;
    for (const row of page.data) {
      out.push(row);
      if (out.length >= max) return out;
    }
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

function bucketSessions(sessions) {
  const byStatus = new Map();
  const byPaymentStatus = new Map();
  for (const s of sessions) {
    const status = s.status || 'unknown';
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
    const ps = s.payment_status || 'none';
    byPaymentStatus.set(ps, (byPaymentStatus.get(ps) || 0) + 1);
  }
  return {
    byStatus: Object.fromEntries(byStatus),
    byPaymentStatus: Object.fromEntries(byPaymentStatus),
  };
}

function bucketPaymentIntentErrors(intents) {
  const byErrorCode = new Map();
  const byErrorType = new Map();
  const byDeclineCode = new Map();
  let withError = 0;
  for (const pi of intents) {
    const err = pi.last_payment_error;
    if (!err) continue;
    withError += 1;
    const code = err.code || 'no_code';
    const type = err.type || 'no_type';
    const decline = err.decline_code || 'no_decline_code';
    byErrorCode.set(code, (byErrorCode.get(code) || 0) + 1);
    byErrorType.set(type, (byErrorType.get(type) || 0) + 1);
    byDeclineCode.set(decline, (byDeclineCode.get(decline) || 0) + 1);
  }
  return {
    intentsWithError: withError,
    intentsTotal: intents.length,
    byErrorCode: Object.fromEntries(byErrorCode),
    byErrorType: Object.fromEntries(byErrorType),
    byDeclineCode: Object.fromEntries(byDeclineCode),
  };
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function classifyCheckoutFunnel({ sessions = [], paymentIntents = [], account = {} } = {}) {
  const buckets = bucketSessions(sessions);
  const total = sessions.length;
  const complete = buckets.byStatus.complete || 0;
  const expired = buckets.byStatus.expired || 0;
  const open = buckets.byStatus.open || 0;
  const paid = buckets.byPaymentStatus.paid || 0;
  const piErrors = bucketPaymentIntentErrors(paymentIntents);
  const conversionRate = safeRate(complete, total);
  const paidRate = safeRate(paid, total);
  const abandonmentRate = safeRate(expired + open, total);

  let primaryDiagnosis = 'insufficient_data';
  let recommendation = 'Collect more checkout sessions before changing the offer.';

  if (account.configured && account.chargesEnabled === false) {
    primaryDiagnosis = 'stripe_account_blocked';
    recommendation = 'Resolve Stripe account requirements before changing landing-page copy.';
  } else if (piErrors.intentsWithError > 0) {
    primaryDiagnosis = 'payment_attempt_failures';
    recommendation = 'Fix the payment-method or decline-code pattern shown in PaymentIntent errors.';
  } else if (total >= 20 && complete === 0 && paymentIntents.length === 0 && abandonmentRate >= 0.8) {
    primaryDiagnosis = 'pre_payment_abandonment';
    recommendation = 'Buyers are leaving before a payment attempt. Simplify the offer, reduce competing CTAs, and move proof closer to checkout.';
  } else if (total >= 20 && conversionRate < 0.01 && abandonmentRate >= 0.8) {
    primaryDiagnosis = 'severe_checkout_abandonment';
    recommendation = 'Checkout is mechanically reachable, but trust/price/offer clarity is failing before purchase.';
  } else if (complete > 0 && paid === 0) {
    primaryDiagnosis = 'post_checkout_payment_or_webhook_gap';
    recommendation = 'Inspect payment status and webhook provisioning because sessions complete without paid confirmation.';
  } else if (complete > 0) {
    primaryDiagnosis = 'checkout_can_convert';
    recommendation = 'Checkout can convert. Attribute the converting source and scale that segment cautiously.';
  }

  return {
    totalSessions: total,
    completedSessions: complete,
    paidSessions: paid,
    expiredOrOpenSessions: expired + open,
    checkoutConversionRate: conversionRate,
    paidSessionRate: paidRate,
    abandonmentRate,
    paymentIntentsTotal: paymentIntents.length,
    paymentIntentsWithError: piErrors.intentsWithError,
    primaryDiagnosis,
    recommendation,
  };
}

async function getAccountHealth(stripe) {
  try {
    const account = await stripe.accounts.retrieve();
    return {
      configured: true,
      id: account.id,
      type: account.type,
      country: account.country,
      defaultCurrency: account.default_currency,
      detailsSubmitted: account.details_submitted,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      disabledReason: account.requirements?.disabled_reason || null,
      currentlyDue: account.requirements?.currently_due || [],
      pastDue: account.requirements?.past_due || [],
      eventuallyDue: account.requirements?.eventually_due || [],
      pendingVerification: account.requirements?.pending_verification || [],
      capabilities: account.capabilities || {},
    };
  } catch (error) {
    return { configured: false, gap: `accounts.retrieve failed: ${error.message}` };
  }
}

async function getWebhookHealth(stripe) {
  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
    const summary = (endpoints.data || []).map((ep) => ({
      id: ep.id,
      url: ep.url,
      status: ep.status,
      enabledEvents: ep.enabled_events,
      apiVersion: ep.api_version,
      createdAt: new Date(ep.created * 1000).toISOString(),
    }));
    return { configured: true, endpoints: summary };
  } catch (error) {
    return { configured: false, gap: `webhookEndpoints.list failed: ${error.message}` };
  }
}

async function runDiagnostic({
  stripeClient = null,
  secretKey = process.env.STRIPE_SECRET_KEY,
  limit = 10000,
} = {}) {
  if (!secretKey && !stripeClient) {
    return { configured: false, gap: 'STRIPE_SECRET_KEY is not set' };
  }
  let stripe = stripeClient;
  if (!stripe) {
    try {
      const factory = loadStripe();
      stripe = factory(secretKey);
    } catch (error) {
      return { configured: false, gap: `Stripe SDK unavailable: ${error.message}` };
    }
  }
  if (!stripe?.checkout?.sessions?.list || !stripe?.paymentIntents?.list || !stripe?.accounts?.retrieve) {
    return { configured: false, gap: 'Stripe client does not expose the expected endpoints' };
  }

  const [sessions, account, webhooks] = await Promise.all([
    listAllPaged((p) => stripe.checkout.sessions.list(p), {}, limit),
    getAccountHealth(stripe),
    getWebhookHealth(stripe),
  ]);

  // Codex P1: only analyze PaymentIntents that came from checkout sessions.
  // The previous version pulled the account's entire paymentIntents.list
  // — that contaminates the error-rate analysis with intents from other
  // flows (subscriptions, manual invoices, etc.). Pulling per-session keeps
  // the error rate tied to checkout flow specifically.
  const checkoutLinkedIntentIds = sessions
    .map((s) => (typeof s.payment_intent === 'string' ? s.payment_intent : null))
    .filter(Boolean);
  const paymentIntents = await Promise.all(
    checkoutLinkedIntentIds.slice(0, limit).map(async (id) => {
      try {
        return await stripe.paymentIntents.retrieve(id);
      } catch {
        return null;
      }
    })
  ).then((arr) => arr.filter(Boolean));

  // Cross-link: for the most recent N sessions, look up the associated
  // payment_intent's last_payment_error if any.
  const recentSessions = sessions.slice(0, Math.min(20, sessions.length));
  const recentSessionDetail = await Promise.all(
    recentSessions.map(async (s) => {
      let piError = null;
      if (s.payment_intent && typeof s.payment_intent === 'string') {
        try {
          const pi = await stripe.paymentIntents.retrieve(s.payment_intent);
          piError = pi.last_payment_error || null;
        } catch (_e) {
          piError = null;
        }
      }
      return {
        id: s.id,
        status: s.status,
        paymentStatus: s.payment_status,
        createdAt: new Date(s.created * 1000).toISOString(),
        expiresAt: s.expires_at ? new Date(s.expires_at * 1000).toISOString() : null,
        customerEmail: s.customer_email || s.customer_details?.email || null,
        amountTotal: s.amount_total,
        currency: s.currency,
        url: s.url,
        paymentIntentId: typeof s.payment_intent === 'string' ? s.payment_intent : null,
        piErrorCode: piError?.code || null,
        piErrorType: piError?.type || null,
        piErrorDeclineCode: piError?.decline_code || null,
        piErrorMessage: piError?.message || null,
      };
    })
  );

  const funnelDiagnosis = classifyCheckoutFunnel({
    sessions,
    paymentIntents,
    account,
  });

  return {
    configured: true,
    generatedAt: new Date().toISOString(),
    sessionsExamined: sessions.length,
    paymentIntentsExamined: paymentIntents.length,
    sessionBuckets: bucketSessions(sessions),
    paymentIntentErrors: bucketPaymentIntentErrors(paymentIntents),
    funnelDiagnosis,
    account,
    webhooks,
    recentSessions: recentSessionDetail,
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Stripe Checkout Diagnostic');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt || new Date().toISOString()}`);
  if (!report.configured) {
    lines.push(`Status: NOT CONFIGURED — ${report.gap}`);
    return lines.join('\n') + '\n';
  }
  lines.push('');
  lines.push('## Headline question: why are checkout sessions not completing?');
  lines.push('');
  lines.push(`Examined ${report.sessionsExamined} checkout sessions and ${report.paymentIntentsExamined} payment intents.`);
  if (report.funnelDiagnosis) {
    lines.push('');
    lines.push(`**Primary diagnosis: \`${report.funnelDiagnosis.primaryDiagnosis}\`**`);
    lines.push(`Recommendation: ${report.funnelDiagnosis.recommendation}`);
    lines.push(`Checkout completion rate: ${(report.funnelDiagnosis.checkoutConversionRate * 100).toFixed(2)}%; paid-session rate: ${(report.funnelDiagnosis.paidSessionRate * 100).toFixed(2)}%; expired/open rate: ${(report.funnelDiagnosis.abandonmentRate * 100).toFixed(2)}%.`);
  }
  lines.push('');
  lines.push('### Checkout session status breakdown');
  lines.push('');
  lines.push('| Status | Count |');
  lines.push('| --- | ---: |');
  for (const [k, v] of Object.entries(report.sessionBuckets.byStatus)) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push('');
  lines.push('### Payment status breakdown');
  lines.push('');
  lines.push('| Payment status | Count |');
  lines.push('| --- | ---: |');
  for (const [k, v] of Object.entries(report.sessionBuckets.byPaymentStatus)) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push('');
  lines.push('## Payment intent failure modes');
  lines.push('');
  const pie = report.paymentIntentErrors;
  lines.push(`${pie.intentsWithError} of ${pie.intentsTotal} payment intents have a recorded \`last_payment_error\`.`);
  if (pie.intentsWithError > 0) {
    lines.push('');
    lines.push('### By error code');
    lines.push('');
    lines.push('| Code | Count |');
    lines.push('| --- | ---: |');
    for (const [k, v] of Object.entries(pie.byErrorCode)) {
      lines.push(`| \`${k}\` | ${v} |`);
    }
    lines.push('');
    lines.push('### By decline code (card-specific)');
    lines.push('');
    lines.push('| Decline code | Count |');
    lines.push('| --- | ---: |');
    for (const [k, v] of Object.entries(pie.byDeclineCode)) {
      lines.push(`| \`${k}\` | ${v} |`);
    }
  }
  lines.push('');
  lines.push('## Stripe Account health (acct from STRIPE_SECRET_KEY)');
  lines.push('');
  if (report.account.configured) {
    lines.push(`- Account ID: \`${report.account.id}\``);
    lines.push(`- Type / Country / Currency: ${report.account.type} / ${report.account.country} / ${report.account.defaultCurrency}`);
    lines.push(`- **details_submitted: ${report.account.detailsSubmitted}**`);
    lines.push(`- **charges_enabled: ${report.account.chargesEnabled}**`);
    lines.push(`- **payouts_enabled: ${report.account.payoutsEnabled}**`);
    lines.push(`- disabled_reason: \`${report.account.disabledReason || '(none)'}\``);
    lines.push(`- currently_due: ${report.account.currentlyDue.length ? '`' + report.account.currentlyDue.join('`, `') + '`' : '_(none)_'}`);
    lines.push(`- past_due: ${report.account.pastDue.length ? '`' + report.account.pastDue.join('`, `') + '`' : '_(none)_'}`);
    lines.push(`- pending_verification: ${report.account.pendingVerification.length ? '`' + report.account.pendingVerification.join('`, `') + '`' : '_(none)_'}`);
    lines.push('');
    lines.push('**This is the single most diagnostic block.** If `charges_enabled` is `false`, every checkout session WILL fail at the payment step regardless of UI quality. If `currently_due` or `past_due` is non-empty, Stripe is gating the account on operator action.');
  } else {
    lines.push(`Account: NOT AVAILABLE — ${report.account.gap}`);
  }
  lines.push('');
  lines.push('## Webhook endpoints');
  lines.push('');
  if (report.webhooks.configured) {
    if (report.webhooks.endpoints.length === 0) {
      lines.push('_No webhook endpoints configured._ Payment confirmation cannot be received post-checkout. **This alone produces a 100% "no completed checkouts" perception** even when checkouts actually complete on Stripe, because our local ledger is never written.');
    } else {
      lines.push('| Status | URL | Events |');
      lines.push('| --- | --- | ---: |');
      for (const ep of report.webhooks.endpoints) {
        lines.push(`| ${ep.status} | \`${ep.url}\` | ${ep.enabledEvents.length} |`);
      }
    }
  } else {
    lines.push(`Webhooks: NOT AVAILABLE — ${report.webhooks.gap}`);
  }
  lines.push('');
  lines.push('## Recent sessions (last 20)');
  lines.push('');
  lines.push('| Created | Status | Pay status | Amount | Email | PI error code | PI decline |');
  lines.push('| --- | --- | --- | ---: | --- | --- | --- |');
  for (const s of report.recentSessions) {
    const amt = s.amountTotal != null ? `${(s.amountTotal / 100).toFixed(2)} ${(s.currency || '').toUpperCase()}` : '—';
    const email = s.customerEmail ? s.customerEmail.replace(/@/, ' (at) ') : '_no email_';
    const code = s.piErrorCode || '—';
    const decline = s.piErrorDeclineCode || '—';
    lines.push(`| ${s.createdAt} | ${s.status} | ${s.paymentStatus} | ${amt} | ${email} | \`${code}\` | \`${decline}\` |`);
  }
  lines.push('');
  lines.push('## Top diagnosis paths');
  lines.push('');
  lines.push('Read top-to-bottom. The first match is almost always the bottleneck.');
  lines.push('');
  if (report.account.configured) {
    if (!report.account.chargesEnabled) {
      lines.push('1. **`charges_enabled = false`** — the account cannot process payments. Every session fails at the Stripe page. Resolve by completing the `currently_due` / `past_due` requirements above. **This is the binding blocker.**');
    } else if (report.account.currentlyDue.length || report.account.pastDue.length) {
      lines.push('1. **Account has outstanding requirements** — charges may be enabled but with friction. Resolve the listed items before treating any other diagnosis seriously.');
    }
  }
  const expired = report.sessionBuckets.byStatus.expired || 0;
  const open = report.sessionBuckets.byStatus.open || 0;
  const complete = report.sessionBuckets.byStatus.complete || 0;
  if (complete === 0 && expired + open > 50) {
    lines.push('2. **Sessions are uniformly expiring or staying open with zero completions.** Combined with healthy account flags, this points at buyer-side abandonment OR a checkout UX problem (e.g. price too high, missing trust signals, payment-method limitations).');
  }
  if (report.paymentIntentErrors.intentsWithError === 0 && report.paymentIntentErrors.intentsTotal > 0) {
    lines.push('3. **Zero payment intents have a `last_payment_error`** — buyers are abandoning BEFORE attempting to pay. The funnel is leaking at the Stripe form itself, not at the card-decline step. Look at the recent-sessions table for missing emails (= buyers bailed at email entry) or zero amount_total values (= configuration miss).');
  }
  if (report.webhooks.configured && report.webhooks.endpoints.length === 0) {
    lines.push('4. **No webhooks configured.** The session counts above come from Stripe API directly and are NOT undercounted by missing webhooks (Codex P2 correction). What missing webhooks DO break: post-completion side effects on our backend — provisioning, trial-welcome emails, local revenue-ledger writes. Wire `https://thumbgate.ai/v1/billing/webhook` listening for `checkout.session.completed` / `payment_intent.succeeded` to close that loop.');
  }
  lines.push('');
  lines.push('## Honest limits of this diagnostic');
  lines.push('');
  lines.push('- This script reports what Stripe has on file. It cannot see UX friction outside Stripe (broken redirects, blocked-region geofencing, slow page loads).');
  lines.push('- Recent-sessions table is the last 20 only; for full forensics inspect Stripe Dashboard → Payments → Checkout Sessions.');
  lines.push('- Webhook delivery success rates are not available via the list endpoint; check Stripe Dashboard → Developers → Webhooks for per-event attempt history.');
  return lines.join('\n') + '\n';
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = await runDiagnostic({ limit: args.limit });
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderMarkdown(report));
  }
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main().catch((error) => {
    process.stderr.write(`stripe-checkout-diagnostic FAILED: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  bucketSessions,
  bucketPaymentIntentErrors,
  classifyCheckoutFunnel,
  runDiagnostic,
  renderMarkdown,
};
