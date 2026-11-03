#!/usr/bin/env node
'use strict';

/**
 * ThumbGate Procedural Graph Engineering CLI
 * Based on Zachary Blumenfeld — "Make Your AI Agents Predictable With Graph Engineering"
 * (https://www.youtube.com/watch?v=g_NgCLTibiM)
 *
 * Usage:
 *   node scripts/graph-engineering-cli.js compile [--skill <id>] [--skill-file <path>]
 *   node scripts/graph-engineering-cli.js run [--skill <id>] [--input <json>]
 *   node scripts/graph-engineering-cli.js audit [--skill <id>]
 *   node scripts/graph-engineering-cli.js evaluate
 */

const fs = require('fs');
const path = require('path');
const {
  compileSkillAndTracesToGraphYaml,
  executeCompiledGraphCli,
  persistSkillRunAndAuditGovernance,
  evaluatePredictableGraphEngineeringSteal,
} = require('../src/cloud-token-firewall');

function parseArgs(argv) {
  const args = argv.slice(2);
  const subcommand = args[0] && !args[0].startsWith('--') ? args[0] : 'evaluate';
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = 'true';
      }
    }
  }
  return { subcommand, flags };
}

function main() {
  const { subcommand, flags } = parseArgs(process.argv);
  const skillId = flags.skill || 'thumbgate-policy-compliance-skill';

  if (subcommand === 'compile') {
    let skillMarkdown = '';
    if (flags['skill-file']) {
      const resolved = path.resolve(process.cwd(), flags['skill-file']);
      if (fs.existsSync(resolved)) {
        skillMarkdown = fs.readFileSync(resolved, 'utf8');
      }
    }
    const compiled = compileSkillAndTracesToGraphYaml({ skillId, skillMarkdown });
    if (flags.yaml === 'true') {
      process.stdout.write(compiled.graphYaml);
    } else {
      process.stdout.write(`${JSON.stringify(compiled, null, 2)}\n`);
    }
    return;
  }

  if (subcommand === 'run') {
    let inputPayload = {};
    if (flags.input) {
      try {
        inputPayload = JSON.parse(flags.input);
      } catch {
        process.stderr.write('Invalid --input JSON payload\n');
        process.exitCode = 1;
        return;
      }
    }
    const result = executeCompiledGraphCli({ skillId, inputPayload });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (subcommand === 'audit') {
    const audit = persistSkillRunAndAuditGovernance({ skillId });
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
    return;
  }

  const report = evaluatePredictableGraphEngineeringSteal({ skillId });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };
