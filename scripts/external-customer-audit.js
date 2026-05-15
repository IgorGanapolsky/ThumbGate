#!/usr/bin/env node
/**
 * external-customer-audit.js — answer "how many REAL customers paid us?"
 *
 * Background. The unified revenue rollup ships raw Stripe totals: lifetime
 * net, MRR, active subscription count. Those numbers include the owner's
 * own purchases and subscriptions. On a small operator-run product that
 * inflates the apparent customer base — the difference between "1 active
 * sub" and "0 real customers" is whether the operator subscribed to their
 * own product to test billing.
 *
 * This script splits Stripe activity by owner-vs-external email and reports
 * the external-only counts. Owner emails are configured via the
 * THUMBGATE_OWNER_EMAILS env var (comma-separated, case-insensitive). Defaults
 * to the THUMBGATE_TRIAL_EMAIL_REPLY_TO support address used elsewhere.
 *
 * Runs in CI under the Daily Revenue Loop alongside the existing Stripe
 * audit, so we can compare raw vs external-only counts.
 *
 * Usage:
 *   node scripts/external-customer-audit.js
 *   node scripts/external-customer-audit.js --json
 *   node scripts/external-customer-audit.js --strict   # exit 1 if 0 external customers
 *
 * Env:
 *   STRIPE_SECRET_KEY        required
 *   THUMBGATE_OWNER_EMAILS   comma-separated owner emails to exclude
 *                            (default: iganapolsky@gmail.com,igor.ganapolsky@gmail.com)
 */

'use strict';

function parseArgs(argv = []) {
  return {
    json: argv.includes('--json'),
    strict: argv.includes('--strict'),
  };
}

function parseOwnerEmails(env = process.env) {
  const raw = env.THUMBGATE_OWNER_EMAILS;
  if (raw?.trim()) {
    return raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  }
  return [
    'iganapolsky@gmail.com',
    'igor.ganapolsky@gmail.com',
  ];
}

function isOwnerEmail(email, ownerEmails) {
  if (!email) return false;
  return ownerEmails.includes(String(email).toLowerCase().trim());
}

function dollars(cents) {
  return Number(cents || 0) / 100;
}

function loadStripe(requireFn = require) {
  return requireFn('stripe');
}

// Stripe's cursor pagination has no hard stop — we iterate until `has_more`
// is false. The optional `max` is a runaway-guard only; default 100,000
// (well above any sane lifetime list for this product) so the audit never
// silently truncates real data the way an earlier 1000-cap did. Tests can
// pass a small max to exercise truncation behavior explicitly.
async function listAllPaged(listFn, params = {}, max = 100000) {
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

function emailOfCustomer(obj) {
  if (!obj || typeof obj === 'string') return null;
  if (obj.email) return obj.email;
  if (obj.customer && typeof obj.customer === 'object') return obj.customer.email || null;
  return null;
}

function chargeEmail(charge) {
  return emailOfCustomer(charge) || charge.billing_details?.email || null;
}

function partitionCharges(rows, ownerEmails) {
  const result = { all: [], owner: [], external: [] };
  for (const ch of rows) {
    const bucket = isOwnerEmail(chargeEmail(ch), ownerEmails) ? 'owner' : 'external';
    result.all.push(ch);
    result[bucket].push(ch);
  }
  return result;
}

function summarizeCharges(rows) {
  const gross = rows.reduce((s, c) => s + (c.amount || 0), 0);
  const refunded = rows.reduce((s, c) => s + (c.amount_refunded || 0), 0);
  const emails = new Set(
    rows
      .map(chargeEmail)
      .filter(Boolean)
      .map((e) => String(e).toLowerCase().trim())
  );
  return {
    chargeCount: rows.length,
    uniqueCustomerCount: emails.size,
    grossCents: gross,
    refundedCents: refunded,
    netCents: gross - refunded,
    gross: dollars(gross),
    net: dollars(gross - refunded),
  };
}

function subsMRR(rows) {
  return rows.reduce((sum, s) => sum + (s.plan?.amount || 0), 0);
}

async function runAudit({
  stripeClient = null,
  secretKey = process.env.STRIPE_SECRET_KEY,
  ownerEmails = parseOwnerEmails(),
} = {}) {
  if (!secretKey && !stripeClient) {
    return { configured: false, gap: 'STRIPE_SECRET_KEY is not set', ownerEmails };
  }
  let stripe = stripeClient;
  if (!stripe) {
    try {
      const factory = loadStripe();
      stripe = factory(secretKey);
    } catch (error) {
      return { configured: false, gap: `Stripe SDK unavailable: ${error.message}`, ownerEmails };
    }
  }
  // Explicit null guard for static analyzers: at this point the branches
  // above either assigned `stripe` or returned. Make the precondition
  // unambiguous so Sonar's reliability check stays at A.
  if (!stripe?.charges?.list || !stripe?.subscriptions?.list || !stripe?.checkout?.sessions?.list) {
    return { configured: false, gap: 'Stripe client does not expose the expected list endpoints', ownerEmails };
  }

  const [charges, subscriptions, sessions] = await Promise.all([
    listAllPaged((p) => stripe.charges.list(p), { expand: ['data.customer'] }),
    listAllPaged((p) => stripe.subscriptions.list(p), { status: 'all', expand: ['data.customer'] }),
    listAllPaged((p) => stripe.checkout.sessions.list(p), {}),
  ]);

  const paidCharges = charges.filter((c) => c.status === 'succeeded' && !c.refunded);
  const partitioned = partitionCharges(paidCharges, ownerEmails);

  const subs = subscriptions.filter((s) => s.status === 'active' || s.status === 'trialing');
  const externalSubs = subs.filter((s) => !isOwnerEmail(emailOfCustomer(s), ownerEmails));
  const ownerSubs = subs.filter((s) => isOwnerEmail(emailOfCustomer(s), ownerEmails));

  function sessionEmail(s) {
    return s.customer_email || s.customer_details?.email || null;
  }
  const externalSessions = sessions.filter((s) => !isOwnerEmail(sessionEmail(s), ownerEmails));
  const completedSessions = sessions.filter((s) => s.status === 'complete');
  const externalCompletedSessions = externalSessions.filter((s) => s.status === 'complete');
  const allSessions = sessions.length;
  const externalSessionsCount = externalSessions.length;

  return {
    configured: true,
    ownerEmails,
    generatedAt: new Date().toISOString(),
    charges: {
      all: summarizeCharges(partitioned.all),
      owner: summarizeCharges(partitioned.owner),
      external: summarizeCharges(partitioned.external),
    },
    subscriptions: {
      activeOrTrialing: subs.length,
      activeExternal: externalSubs.length,
      activeOwner: ownerSubs.length,
      mrrAllCents: subsMRR(subs),
      mrrExternalCents: subsMRR(externalSubs),
      mrrAll: dollars(subsMRR(subs)),
      mrrExternal: dollars(subsMRR(externalSubs)),
    },
    checkout: {
      totalSessions: allSessions,
      externalSessions: externalSessionsCount,
      completedAll: completedSessions.length,
      completedExternal: externalCompletedSessions.length,
      completionRateAll: allSessions ? completedSessions.length / allSessions : 0,
      // External rate uses the external denominator — dividing external
      // completions by total sessions would systematically undercount the
      // real-customer conversion (Codex P2 finding).
      completionRateExternal: externalSessionsCount ? externalCompletedSessions.length / externalSessionsCount : 0,
    },
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# External Customer Audit');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt || new Date().toISOString()}`);
  if (!report.configured) {
    lines.push(`Status: NOT CONFIGURED — ${report.gap}`);
    return lines.join('\n') + '\n';
  }
  lines.push(`Owner emails filtered: ${report.ownerEmails.join(', ')}`);
  lines.push('');
  lines.push('## Charges (lifetime)');
  lines.push('');
  lines.push('| Bucket | Charges | Unique customers | Gross | Net |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const k of ['all', 'owner', 'external']) {
    const s = report.charges[k];
    lines.push(`| ${k} | ${s.chargeCount} | ${s.uniqueCustomerCount} | $${s.gross.toFixed(2)} | $${s.net.toFixed(2)} |`);
  }
  lines.push('');
  lines.push('## Active subscriptions');
  lines.push('');
  lines.push(`- All active or trialing: ${report.subscriptions.activeOrTrialing} (MRR $${report.subscriptions.mrrAll.toFixed(2)})`);
  lines.push(`- **External (real customers)**: ${report.subscriptions.activeExternal} (MRR $${report.subscriptions.mrrExternal.toFixed(2)})`);
  lines.push(`- Owner: ${report.subscriptions.activeOwner}`);
  lines.push('');
  lines.push('## Checkout sessions');
  lines.push('');
  lines.push(`- Total sessions ever created: ${report.checkout.totalSessions}`);
  lines.push(`- Completed (all): ${report.checkout.completedAll} (${(report.checkout.completionRateAll * 100).toFixed(2)}%)`);
  lines.push(`- **Completed (external)**: ${report.checkout.completedExternal} (${(report.checkout.completionRateExternal * 100).toFixed(2)}%)`);
  lines.push('');
  lines.push('## The one number that matters');
  lines.push('');
  const realCustomers = report.charges.external.uniqueCustomerCount;
  const realRevenue = report.charges.external.net;
  const realSubs = report.subscriptions.activeExternal;
  const realMrr = report.subscriptions.mrrExternal;
  lines.push(`- **Real, non-owner paying customers lifetime: ${realCustomers}**`);
  lines.push(`- **Real, non-owner net revenue lifetime: $${realRevenue.toFixed(2)}**`);
  lines.push(`- **Real, non-owner active subscriptions: ${realSubs}**  (MRR $${realMrr.toFixed(2)})`);
  return lines.join('\n') + '\n';
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = await runAudit();
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderMarkdown(report));
  }
  if (args.strict && report.configured) {
    const real = report.charges.external.uniqueCustomerCount;
    if (real === 0) process.exit(2);
  }
}

const path = require('node:path');
if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main().catch((error) => {
    process.stderr.write(`external-customer-audit FAILED: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  parseOwnerEmails,
  isOwnerEmail,
  runAudit,
  renderMarkdown,
};
