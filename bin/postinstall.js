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
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │   ThumbGate installed successfully.                 │
  │                                                     │
  │   Quick start:                                      │
  │     npx thumbgate init                     │
  │     npx thumbgate stats                    │
  │                                                     │
  │   Team rollout starts with the Workflow Hardening   │
  │   Sprint: ${WORKFLOW_SPRINT_URL} │
  │                                                     │
  │   Solo side lane: Pro (personal local dashboard,    │
  │   DPO export) — ${PRO_PRICE_LABEL}: │
  │     ${PRO_MONTHLY_PAYMENT_LINK}       │
  │   Team: ${TEAM_PRICE_LABEL} after intake. │
  │                                                     │
  │   Or run: npx thumbgate pro                │
  │                                                     │
  └─────────────────────────────────────────────────────┘

`);
