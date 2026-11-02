'use strict';

const fs = require('fs');
const path = require('path');

function agentsFromHerdrList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.agents)) return payload.agents;
  const nested = payload.result;
  if (nested && Array.isArray(nested.agents)) return nested.agents;
  return [];
}

function censusLine(agent) {
  const name = agent.agent || agent.id || '?';
  const state = agent.agent_status || agent.state || '?';
  const cwd = agent.cwd || '';
  const title = String(agent.terminal_title_stripped || agent.terminal_title || '').slice(0, 60);
  return `  ${name} state=${state} cwd=${cwd} title=${title}`;
}

function formatHerdrCensus(payload) {
  const agents = agentsFromHerdrList(payload);
  if (agents.length === 0) return '  none';
  return agents.map(censusLine).join('\n');
}

function main() {
  const raw = fs.readFileSync(0, 'utf8');
  if (!raw.trim()) {
    process.stderr.write('herdr census: empty input\n');
    process.exit(1);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(`herdr census parse failed: ${error.message}\n`);
    process.exit(1);
  }
  process.stdout.write(`${formatHerdrCensus(payload)}\n`);
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = {
  agentsFromHerdrList,
  formatHerdrCensus,
};
