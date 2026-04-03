#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Gate validators
// ---------------------------------------------------------------------------

function countTableRows(content, sectionHeading) {
  const sectionRegex = new RegExp(
    `#+\\s*${sectionHeading}[^\\n]*\\n([\\s\\S]*?)(?=\\n#+\\s|$)`,
  );
  const match = content.match(sectionRegex);
  if (!match) return 0;

  const lines = match[1].split('\n').filter((l) => l.trim().startsWith('|'));
  // Subtract header row and separator row
  const dataRows = lines.filter(
    (l) => !/^\|\s*-+/.test(l.trim()) && !/^\|\s*:?-+/.test(l.trim()),
  );
  // First row is the header
  return Math.max(0, dataRows.length - 1);
}

function countContracts(content) {
  const sectionRegex = /#+\s*Contracts[^\n]*\n([\s\S]*?)(?=\n#+\s|$)/;
  const match = content.match(sectionRegex);
  if (!match) return 0;

  const section = match[1];
  // Find code blocks and look for interface/type keywords inside them
  const codeBlockRegex = /```[\s\S]*?```/g;
  let count = 0;
  let blockMatch;
  while ((blockMatch = codeBlockRegex.exec(section)) !== null) {
    const block = blockMatch[0];
    const interfaceMatches = block.match(/\b(interface|type)\s+\w+/g);
    if (interfaceMatches) count += interfaceMatches.length;
  }
  return count;
}

function countValidationScenarios(content) {
  const sectionRegex =
    /#+\s*Validation\s+Checklist[^\n]*\n([\s\S]*?)(?=\n#+\s|$)/;
  const match = content.match(sectionRegex);
  if (!match) return 0;

  const lines = match[1].split('\n');
  return lines.filter((l) => /^\s*-\s*\[\s*\]/.test(l)).length;
}

function getStatus(content) {
  const match = content.match(/#+\s*Status[^\n]*\n\s*(\S+)/);
  return match ? match[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function validatePlan(content) {
  const questionCount = countTableRows(content, 'Clarifying Questions Resolved');
  const contractCount = countContracts(content);
  const scenarioCount = countValidationScenarios(content);
  const status = getStatus(content);

  const gates = [
    {
      name: 'Clarifying Questions',
      pass: questionCount >= 3,
      detail: `${questionCount} questions resolved`,
    },
    {
      name: 'Contracts Defined',
      pass: contractCount >= 1,
      detail: `${contractCount} interface${contractCount !== 1 ? 's' : ''} found`,
    },
    {
      name: 'Validation Checklist',
      pass: scenarioCount >= 2,
      detail: `${scenarioCount} scenarios defined`,
    },
    {
      name: 'Status',
      pass: status !== 'COMPLETE',
      detail:
        status === 'COMPLETE'
          ? 'COMPLETE (already finished — cannot re-approve)'
          : `${status || 'UNKNOWN'} (not COMPLETE)`,
    },
  ];

  const allPass = gates.every((g) => g.pass);
  return { gates, allPass };
}

function formatReport(result) {
  const lines = result.gates.map(
    (g) => `${g.pass ? '✅' : '❌'} ${g.name}: ${g.detail}`,
  );
  lines.push('');
  lines.push(
    result.allPass
      ? 'RESULT: PASS — all gates satisfied'
      : 'RESULT: BLOCKED — resolve issues above before spawning agents',
  );
  return lines.join('\n');
}

function run() {
  const args = process.argv.slice(2);
  const jsonFlag = args.includes('--json');
  const filePath = args.find((a) => a !== '--json');

  if (!filePath) {
    console.error('Usage: node scripts/plan-gate.js <plan-file.md> [--json]');
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  const result = validatePlan(content);

  if (jsonFlag) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatReport(result));
  }

  process.exit(result.allPass ? 0 : 1);
}

// Export for testing
module.exports = {
  validatePlan,
  formatReport,
  countTableRows,
  countContracts,
  countValidationScenarios,
  getStatus,
};

// Run only when executed directly
if (require.main === module) {
  run();
}
