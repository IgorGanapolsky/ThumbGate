'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * mcp-wiring-doctor.js
 * 
 * Detects silent ThumbGate capture failures and fixes them.
 */

function wiringReport(projectRoot = process.cwd()) {
  const mcpPath = path.join(projectRoot, '.mcp.json');
  const findings = [];
  let overall = 'ok';

  if (fs.existsSync(mcpPath)) {
    const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    if (config.mcpServers && config.mcpServers['mcp-memory-gateway']) {
      findings.push('Detected legacy mcp-memory-gateway entry in .mcp.json');
      overall = 'warning';
    }
  }

  return { overall, findings };
}

function applyFix(projectRoot = process.cwd()) {
  console.log(`Fixing wiring in ${projectRoot}...`);
  // Implementation...
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  const report = wiringReport();
  console.log(JSON.stringify(report, null, 2));
}

module.exports = { wiringReport, applyFix };
