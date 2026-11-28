#!/usr/bin/env node
'use strict';

// Stdin/stdout bridge for non-JavaScript Agent SDK apps (the Python helper in thumbgate_agent_sdk.py).
// Reads {"event":"PreToolUse"|"PostToolUse","input":{...hook input...},"options":{...}} and prints the hook output.

const { preToolUse, postToolUseFor } = require('./index');

async function handle(payload) {
  const event = payload && payload.event;
  const input = (payload && payload.input) || {};
  if (event === 'PreToolUse') return preToolUse(input);
  if (event === 'PostToolUse') return postToolUseFor((payload && payload.options) || {})(input);
  return {};
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { payload = {}; }
  const out = await handle(payload);
  process.stdout.write(`${JSON.stringify(out || {})}\n`);
}

module.exports = { handle, main };

if (require.main === module) main().catch(() => process.stdout.write('{}\n'));
