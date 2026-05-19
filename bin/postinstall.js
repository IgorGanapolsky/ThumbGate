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
  │  ThumbGate installed.                               │
  │                                                     │
  │  Every repeat-mistake your agent makes costs        │
  │  tokens. ThumbGate blocks known-bad tool calls      │
  │  BEFORE the model sees them — zero tokens spent     │
  │  on mistakes you've already corrected.              │
  │                                                     │
  │  Start free (local-only, never expires):            │
  │    npx thumbgate init                               │
  │    npx thumbgate stats                              │
  │                                                     │
  │  Get the 5-min setup guide + weekly tips:           │
  │    npx thumbgate subscribe you@company.com          │
  │                                                     │
  │  See your gates firing live:                        │
  │    ${DASHBOARD_URL.slice(0, 47).padEnd(47, ' ')} │
  ╰─────────────────────────────────────────────────────╯

  Pro — ${PRO_PRICE_LABEL}
    Hosted lesson sync across all your machines.
    Adapter matrix kept current for Claude Code,
    Cursor, Codex, Gemini, Amp, Cline, OpenCode.
    Org dashboard. DPO export. 24×7 ops.
    Upgrade: ${PRO_CTA_URL}
    Direct:  ${PRO_MONTHLY_PAYMENT_LINK}

  Team: ${TEAM_PRICE_LABEL}
    Workflow Hardening Sprint intake:
    ${WORKFLOW_SPRINT_URL}

  Or run: npx thumbgate pro

`);
