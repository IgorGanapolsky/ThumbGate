#!/usr/bin/env node
'use strict';

/**
 * Post-install banner — the ONE place every npm user sees ThumbGate.
 * Prints to stderr so it never contaminates piped output.
 * Respects RLHF_NO_NUDGE=1 and CI environments.
 */

const isCI = !!(process.env.CI || process.env.CONTINUOUS_INTEGRATION || process.env.GITHUB_ACTIONS);
const isQuiet = process.env.RLHF_NO_NUDGE === '1' || process.env.npm_config_loglevel === 'silent';

if (isCI || isQuiet) process.exit(0);

const PRO_URL = 'https://rlhf-feedback-loop-production.up.railway.app';
const CHECKOUT_URL = `${PRO_URL}/checkout/pro`;

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
  │   optional hosted API key) — $19/mo:          │
  │     ${CHECKOUT_URL}       │
  │                                                     │
  │   Or run: npx mcp-memory-gateway pro                │
  │                                                     │
  └─────────────────────────────────────────────────────┘

`);
