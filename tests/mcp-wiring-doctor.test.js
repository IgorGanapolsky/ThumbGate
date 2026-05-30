'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { wiringReport, applyFix } = require('../scripts/mcp-wiring-doctor');

const TEST_ROOT = path.join(__dirname, 'fixtures', 'wiring-test');

test('mcp-wiring-doctor detects legacy mcp-memory-gateway + rlhf in .mcp.json', () => {
  if (fs.existsSync(TEST_ROOT)) fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(TEST_ROOT, '.claude'), { recursive: true });
  
  const mcpConfig = {
    mcpServers: {
      "mcp-memory-gateway": { command: "node", args: ["server.js"] },
      "rlhf": { command: "node", args: ["rlhf.js"] },
      "thumbgate": { command: "node", args: ["thumbgate.js"] }
    }
  };
  fs.writeFileSync(path.join(TEST_ROOT, '.mcp.json'), JSON.stringify(mcpConfig));

  const report = wiringReport(TEST_ROOT);
  assert.equal(report.overall, 'warning');
  assert.ok(report.findings.some(f => f.includes('legacy mcp-memory-gateway')));
});
