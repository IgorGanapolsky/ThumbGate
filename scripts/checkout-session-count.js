#!/usr/bin/env node
'use strict';

/**
 * Checkout starts without crawlers.
 *
 * Stripe's own session list counts every session ever created, and until 2026-11-18 (the human-click
 * gate, scripts/checkout-human-gate.js) a crawler opening a payment link created one. Sessions made
 * since then carry `metadata.uaClass` (browser | bot | unknown), set from the click's user agent.
 *
 *   human         uaClass = browser  -> the only bucket counted as a real start
 *   bot           uaClass = bot      -> excluded
 *   unknownUa     uaClass = unknown  -> excluded (no user agent sent)
 *   unclassified  no uaClass         -> excluded: created before the gate, user agent not recorded,
 *                                       cannot be told apart from a crawler session
 *   internal      owner email, or metadata.source = internal_audit -> excluded
 *
 * Read-only. Needs STRIPE_SECRET_KEY in the environment (run under `railway run`); never prints it.
 *
 * Usage: node scripts/checkout-session-count.js [--days 7] [--json]
 */

const { getOwnerEmails } = require('./bot-detection');

// When the human-click gate went live: 2026-11-18 7:04 PM ET. Sessions created before it carry no user-agent class.
const BOT_CHECK_BEGAN_AT = '2026-11-19T00:04:00.000Z';
const BOT_CHECK_BEGAN_LABEL = '18 Nov 2026, 7:04 PM ET';

function classifySession(session, { ownerEmails = [] } = {}) {
  const metadata = (session && session.metadata) || {};
  if (metadata.source === 'internal_audit') return 'internal';
  const email = String((session && (session.customer_email || (session.customer_details && session.customer_details.email))) || '').toLowerCase();
  if (email && ownerEmails.some((owner) => email.includes(owner))) return 'internal';
  if (metadata.uaClass === 'browser') return 'human';
  if (metadata.uaClass === 'bot') return 'bot';
  if (metadata.uaClass === 'unknown') return 'unknownUa';
  return 'unclassified';
}

function countSessions(sessions, { ownerEmails = getOwnerEmails() } = {}) {
  const excluded = { bot: 0, unknownUa: 0, unclassified: 0, internal: 0 };
  let human = 0;
  let completed = 0;
  let humanCompleted = 0;
  let humanPaid = 0;
  const list = Array.isArray(sessions) ? sessions : [];
  for (const session of list) {
    const kind = classifySession(session, { ownerEmails });
    const isComplete = session && session.status === 'complete';
    if (isComplete) completed += 1;
    if (kind === 'human') {
      human += 1;
      if (isComplete) humanCompleted += 1;
      if (session.payment_status === 'paid') humanPaid += 1;
    } else {
      excluded[kind] += 1;
    }
  }
  return {
    started: list.length,
    nonCrawlerStarted: human,
    nonCrawlerCompleted: humanCompleted,
    nonCrawlerPaid: humanPaid,
    completedAll: completed,
    excluded,
  };
}

async function listSessions({ days = 7, stripe, nowMs = Date.now() } = {}) {
  const since = Math.floor(nowMs / 1000) - days * 86400;
  const rows = [];
  for await (const session of stripe.checkout.sessions.list({ created: { gte: since }, limit: 100 })) {
    // Only this product's sessions, same filter the daily audit uses.
    if (/thumbgate/i.test(String(session.success_url || ''))) rows.push(session);
  }
  return rows;
}

function parseArgs(argv) {
  const options = { days: 7, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') options.json = true;
    else if (argv[i] === '--days') options.days = Number(argv[++i]) || 7;
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!process.env.STRIPE_SECRET_KEY) {
    process.stderr.write('STRIPE_SECRET_KEY is not set. Run under: railway run -s thumbgate -- node scripts/checkout-session-count.js\n');
    process.exit(2);
  }
  const Stripe = require('stripe');
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sessions = await listSessions({ days: options.days, stripe });
  const counts = countSessions(sessions);
  const report = { at: new Date().toISOString(), days: options.days, ...counts };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  const ex = counts.excluded;
  process.stdout.write(
    `Checkout starts, last ${options.days} days: ${counts.nonCrawlerStarted} from real browsers `
    + `(${counts.started} sessions in Stripe; excluded: ${ex.unclassified} before the human-click gate, `
    + `${ex.bot} bot, ${ex.unknownUa} no user agent, ${ex.internal} internal). `
    + `Completed: ${counts.nonCrawlerCompleted} real, ${counts.completedAll} all. Paid: ${counts.nonCrawlerPaid} real.\n`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`checkout-session-count error: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { classifySession, countSessions, listSessions, parseArgs, BOT_CHECK_BEGAN_AT, BOT_CHECK_BEGAN_LABEL };
