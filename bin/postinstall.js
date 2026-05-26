#!/usr/bin/env node
'use strict';

/**
 * Post-install banner — the ONE place every npm user sees ThumbGate.
 * Prints to stderr so it never contaminates piped output.
 * Respects THUMBGATE_NO_NUDGE=1 and CI environments.
 */

const isCI = !!(process.env.CI || process.env.CONTINUOUS_INTEGRATION || process.env.GITHUB_ACTIONS);
const isQuiet = process.env.THUMBGATE_NO_NUDGE === '1' || process.env.npm_config_loglevel === 'silent';

if (isCI || isQuiet) process.exit(0);

const {
  PRO_MONTHLY_PAYMENT_LINK,
  PRO_PRICE_LABEL,
  TEAM_PRICE_LABEL,
} = require('../scripts/commercial-offer');

// Tracked click-through path: /go/pro → /checkout/pro → Stripe.
// This captures UTM attribution in our funnel before handing off to Stripe.
const PRO_CTA_URL = 'https://thumbgate.ai/go/pro?utm_source=npm&utm_medium=postinstall&utm_campaign=first_dollar';
const WORKFLOW_SPRINT_URL = 'https://thumbgate.ai/#workflow-sprint-intake';
const DASHBOARD_URL = 'https://thumbgate.ai/dashboard?utm_source=npm&utm_medium=postinstall&utm_campaign=dashboard_nudge';

process.stderr.write(`
  ╭─────────────────────────────────────────────────────╮
  │  ThumbGate installed — 14-day Pro trial is live.    │
  │                                                     │
  │  Start now:  npx thumbgate init                     │
  │  Updates:    npx thumbgate subscribe you@company.com│
  │                                                     │
  │  Free after trial: 3 rules, 10 captures/day.       │
  │  Pro ($19/mo): unlimited everything.                │
  ╰─────────────────────────────────────────────────────╯

  Trial unlocks: unlimited rules, lesson search, DPO export,
  hosted dashboard. After 14 days, free tier limits apply.
  Subscribe for the 5-min setup guide + weekly tips:
  npx thumbgate subscribe you@company.com

  Dashboard: ${DASHBOARD_URL}
  Keep Pro: ${PRO_CTA_URL}

`);
