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
} = require('../scripts/commercial-offer');

process.stderr.write(`
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │   ThumbGate installed successfully.                 │
  │                                                     │
  │   Quick start:                                      │
  │     npx mcp-memory-gateway init                     │
  │     npx mcp-memory-gateway stats                    │
  │                                                     │
  │   Unlock Pro (personal local dashboard, DPO export, │
  │   optional hosted API key) — ${PRO_PRICE_LABEL}:      │
  │     ${PRO_MONTHLY_PAYMENT_LINK}       │
  │                                                     │
  │   Or run: npx mcp-memory-gateway pro                │
  │                                                     │
  └─────────────────────────────────────────────────────┘

`);
