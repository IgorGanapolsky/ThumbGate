#!/usr/bin/env node
/**
 * set-session-constraint.js
 * 
 * Allows the agent to persist session-specific constraints (e.g., local_only=true)
 * into the gate state. This ensures that user instructions are physically 
 * enforced by the pre-action gate engine.
 */

const { setConstraint } = require('./gates-engine');

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: set-session-constraint <key> <value>');
    process.exit(1);
  }

  const key = args[0];
  let value = args[1];

  // Convert string booleans to actual booleans
  if (value === 'true') value = true;
  if (value === 'false') value = false;

  const result = setConstraint(key, value);
  console.log(`[GATE] Session constraint set: ${key} = ${value} (timestamp: ${result.timestamp})`);
}

if (require.main === module) {
  main();
}
