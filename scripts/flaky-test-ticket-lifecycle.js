#!/usr/bin/env node
'use strict';

/**
 * flaky-test-ticket-lifecycle.js — Pure state machine for Trunk-style flaky
 * test ticketing: create / reopen / close when test health changes.
 *
 * Does not call GitHub/Trunk APIs by default; consumers apply the action.
 *
 * Status vocabulary:
 *   healthy | flaky | failing
 *
 * Usage:
 *   node scripts/flaky-test-ticket-lifecycle.js --json --from healthy --to flaky
 */

const path = require('node:path');

const STATUSES = new Set(['healthy', 'flaky', 'failing', 'unknown', 'none']);

function normalizeStatus(value) {
  const s = String(value || 'none').trim().toLowerCase();
  if (s === '' || s === 'null' || s === 'undefined') return 'none';
  if (STATUSES.has(s)) return s;
  // Flaky markers before generic "pass" so "pass-on-retry" is not healthy.
  if (/flaky|intermittent|pass[\s_-]?on[\s_-]?retry/.test(s)) return 'flaky';
  if (/fail|red|broken/.test(s)) return 'failing';
  if (/pass|green|ok|healthy/.test(s)) return 'healthy';
  return 'unknown';
}

/**
 * Decide ticket action for one test when status transitions.
 * @returns {{ action: 'create'|'reopen'|'close'|'none', reason: string }}
 */
function nextTicketAction({
  previousStatus = 'none',
  currentStatus = 'unknown',
  ticketExists = false,
  ticketOpen = false,
} = {}) {
  const prev = normalizeStatus(previousStatus);
  const curr = normalizeStatus(currentStatus);

  if (curr === prev && ticketExists) {
    return { action: 'none', reason: 'status_unchanged' };
  }

  // Newly flaky or chronically failing → need an open ticket
  if (curr === 'flaky' || curr === 'failing') {
    if (!ticketExists) {
      return { action: 'create', reason: `status_${prev}_to_${curr}` };
    }
    if (ticketExists && !ticketOpen) {
      return { action: 'reopen', reason: `status_${prev}_to_${curr}` };
    }
    return { action: 'none', reason: 'ticket_already_open' };
  }

  // Recovered to healthy → close open ticket
  if (curr === 'healthy' && ticketExists && ticketOpen) {
    return { action: 'close', reason: `status_${prev}_to_healthy` };
  }

  return { action: 'none', reason: 'no_ticket_transition' };
}

/**
 * Batch apply transitions (e.g. after a CI run).
 * @param {Array<{ testId: string, previousStatus?: string, currentStatus: string, ticketExists?: boolean, ticketOpen?: boolean }>} rows
 */
function planTicketUpdates(rows = []) {
  const plans = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const decision = nextTicketAction(row);
    plans.push({
      testId: row.testId || row.name || 'unknown',
      previousStatus: normalizeStatus(row.previousStatus),
      currentStatus: normalizeStatus(row.currentStatus),
      ...decision,
    });
  }
  return {
    create: plans.filter((p) => p.action === 'create'),
    reopen: plans.filter((p) => p.action === 'reopen'),
    close: plans.filter((p) => p.action === 'close'),
    none: plans.filter((p) => p.action === 'none'),
    plans,
  };
}

function parseArgs(argv) {
  const args = { json: false, from: 'none', to: 'flaky', ticketExists: false, ticketOpen: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--ticket-exists') args.ticketExists = true;
    else if (a === '--ticket-open') args.ticketOpen = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node scripts/flaky-test-ticket-lifecycle.js --from <status> --to <status> [--ticket-exists] [--ticket-open] [--json]');
    process.exit(0);
  }
  const decision = nextTicketAction({
    previousStatus: args.from,
    currentStatus: args.to,
    ticketExists: args.ticketExists,
    ticketOpen: args.ticketOpen,
  });
  if (args.json) console.log(JSON.stringify(decision));
  else console.log(`${decision.action} (${decision.reason})`);
  process.exit(0);
}

module.exports = {
  normalizeStatus,
  nextTicketAction,
  planTicketUpdates,
  STATUSES,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
