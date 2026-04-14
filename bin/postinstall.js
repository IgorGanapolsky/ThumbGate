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
const WORKFLOW_SPRINT_URL = 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake';

process.stderr.write(`
  ┌──────────────────────────────────────────────────────┐
  │  ✅ ThumbGate installed — stop AI mistakes before    │
  │     they happen.                                     │
  │                                                      │
  │  Get started:                                        │
  │    npx thumbgate init          Wire hooks + gates    │
  │    npx thumbgate doctor        Health check          │
  │                                                      │
  │  Free: 3 feedback captures/day, enforced gates.      │
  │  Pro:  Unlimited + dashboard + exports.              │
  │    ${PRO_PRICE_LABEL}: ${PRO_MONTHLY_PAYMENT_LINK}   │
  └──────────────────────────────────────────────────────┘

`);
