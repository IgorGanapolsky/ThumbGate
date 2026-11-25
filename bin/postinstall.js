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

const DASHBOARD_URL = 'https://thumbgate.ai/dashboard?utm_source=npm&utm_medium=postinstall&utm_campaign=dashboard_nudge';
const TEAM_PILOT_URL = 'https://thumbgate.ai/pilot?utm_source=npm&utm_medium=postinstall&utm_campaign=team_pilot';

process.stderr.write(`
  ╭─────────────────────────────────────────────────────╮
  │  ThumbGate installed — full features for 7 days.    │
  │                                                     │
  │  Start now:  npx thumbgate init                     │
  │  Updates:    npx thumbgate subscribe you@company.com│
  │                                                     │
  │  Free after trial: 3 rules, 2 captures/day.        │
  │  Teams: request a 30-day pilot at thumbgate.ai/pilot│
  ╰─────────────────────────────────────────────────────╯

  Trial unlocks: unlimited rules and thumbs, recall, lesson search
  and DPO export. After 7 days, free tier limits apply.
  Subscribe for the 5-min setup guide + weekly tips:
  npx thumbgate subscribe you@company.com

  Dashboard: ${DASHBOARD_URL}
  Team pilot: ${TEAM_PILOT_URL}

`);
