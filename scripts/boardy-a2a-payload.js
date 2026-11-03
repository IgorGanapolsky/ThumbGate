#!/usr/bin/env node
'use strict';

/**
 * Boardy A2A Payload Generator
 *
 * Steal pattern: Use Boardy's headless Agent-to-Agent Skill endpoint
 * (boardy.ai/agents) to negotiate intros and deals without voice calls.
 *
 * Sends a structured state-machine payload to boardy@boardy.ai that maps
 * directly to Boardy's internal memory slots.
 *
 * Usage:
 *   node scripts/boardy-a2a-payload.js \
 *     --role "AI Infrastructure Operator" \
 *     --company "ThumbGate" \
 *     --stage "Production" \
 *     --metrics "53/53 verifier tests passing, 0.4ms latency" \
 *     --problem "Cold outbound conversion dropped 40% since August; need warm partner channels" \
 *     --offer "Infrastructure firewall expertise, DPO exports, MCP hook design" \
 *     --stack "Claude Code, Cursor, MCP, Stripe, Railway, GitHub" \
 *     --private "Revenue figures, customer PII, internal pricing"
 *
 * Output: JSON payload printed to stdout, also saved to
 *   ~/Documents/AI-Agent-Sync/Email-Drafts/boardy-a2a-payload.json
 */

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]?.replace(/^--/, '');
  const val = args[i + 1];
  if (key && val) opts[key] = val;
  else if (key) opts[key] = true;
}

const required = ['role', 'company', 'stage', 'metrics', 'problem', 'offer', 'stack'];
const missing = required.filter((k) => !opts[k]);
if (missing.length > 0) {
  console.error(`Missing required flags: ${missing.join(', ')}`);
  console.error('Usage: node scripts/boardy-a2a-payload.js --role "..." --company "..." ...');
  process.exit(1);
}

const now = new Date().toISOString();

const payload = {
  schema: 'boardy-a2a-v1',
  timestamp: now,
  'Who They Are': `${opts.role} at ${opts.company} (${opts.stage})`,
  'Where Things Stand (Timestamped)': opts.metrics,
  'Biggest Problem (Quantified Cost/Duration)': opts.problem,
  'Who They Should Meet & Why Now': opts.meet || `Seeking partners who need ${opts.offer.split(',')[0].trim()} expertise.`,
  'What They Can Offer': opts.offer,
  'Notes (Tech Stack & Infrastructure)': opts.stack,
  ...(opts.private
    ? { 'What to Keep Private': opts.private }
    : { 'What to Keep Private': 'No sensitive data shared.' }),
};

// Output to stdout and save
const output = JSON.stringify(payload, null, 2);
console.log(output);

const draftsDir = path.join(require('os').homedir(), 'Documents/AI-Agent-Sync/Email-Drafts');
if (fs.existsSync(draftsDir)) {
  const filePath = path.join(draftsDir, `boardy-a2a-payload-${Date.now()}.json`);
  fs.writeFileSync(filePath, output, 'utf8');
  console.error(`\nSaved to: ${filePath}`);
} else {
  console.error(`\n${draftsDir} does not exist — payload printed to stdout only.`);
}
