#!/usr/bin/env node
'use strict';

const { satisfyCondition } = require('./gates-engine');

function run() {
  const args = process.argv.slice(2);
  let gateId = null;
  let evidence = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--gate' && args[i + 1]) {
      gateId = args[i + 1];
      i++;
    } else if (args[i] === '--evidence' && args[i + 1]) {
      evidence = args[i + 1];
      i++;
    }
  }

  if (!gateId) {
    process.stderr.write('Usage: node scripts/gate-satisfy.js --gate <gate-id> [--evidence "<text>"]\n');
    process.exit(1);
  }

  const entry = satisfyCondition(gateId, evidence);
  const output = { gate: gateId, satisfied: true, timestamp: entry.timestamp, evidence: entry.evidence };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

// Export for MCP tool usage
function satisfyGate(gateId, evidence) {
  if (!gateId) throw new Error('gate ID is required');
  const entry = satisfyCondition(gateId, evidence || '');
  return { gate: gateId, satisfied: true, timestamp: entry.timestamp, evidence: entry.evidence };
}

module.exports = { satisfyGate };

if (require.main === module) {
  run();
}
