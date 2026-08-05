#!/usr/bin/env node
'use strict';

/**
 * ci-agent-copy-prompt.js — Trunk browser-extension "Copy Prompt" analogue.
 * Builds an agent-ready fix brief from PR metadata + check rollup.
 *
 * Usage:
 *   node scripts/ci-agent-copy-prompt.js --pr 3230
 *   node scripts/ci-agent-copy-prompt.js --pr-file pr.json --checks-file checks.json
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildAgentCopyPrompt, summarizeChecks } = require('./pr-manager');

function parseArgs(argv) {
  const args = { pr: null, prFile: null, checksFile: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--pr') args.pr = argv[++i];
    else if (a === '--pr-file') args.prFile = argv[++i];
    else if (a === '--checks-file') args.checksFile = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fetchPr(prNumber) {
  const n = String(prNumber || '').trim();
  if (!/^[1-9]\d*$/.test(n)) throw new Error(`Unsafe PR number: ${prNumber}`);
  const pr = spawnSync('gh', [
    'pr', 'view', n,
    '--json', 'number,title,url,headRefName,baseRefName,statusCheckRollup',
  ], { encoding: 'utf8' });
  if (pr.status !== 0) throw new Error((pr.stderr || pr.stdout || 'gh pr view failed').trim());
  const checks = spawnSync('gh', [
    'pr', 'checks', n, '--json', 'bucket,name,state,workflow,link',
  ], { encoding: 'utf8' });
  const checkRows = checks.status === 0 ? JSON.parse(checks.stdout || '[]') : [];
  return { pr: JSON.parse(pr.stdout), checks: checkRows };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node scripts/ci-agent-copy-prompt.js --pr N | --pr-file f --checks-file f [--json]');
    process.exit(0);
  }

  let pr;
  let checks;
  if (args.prFile) {
    pr = loadJson(args.prFile);
    checks = args.checksFile ? loadJson(args.checksFile) : (pr.statusCheckRollup || []);
  } else if (args.pr) {
    const fetched = fetchPr(args.pr);
    pr = fetched.pr;
    checks = fetched.checks;
  } else {
    console.error('Provide --pr or --pr-file');
    process.exit(2);
  }

  if (Array.isArray(checks) === false) checks = [];
  // Map gh pr checks "state" into conclusion when needed
  const normalized = checks.map((c) => ({
    ...c,
    conclusion: c.conclusion || (/fail|timed/i.test(String(c.bucket || c.state || ''))
      ? String(c.state || 'FAILURE').toUpperCase()
      : c.conclusion),
  }));

  const checkSummary = summarizeChecks(normalized);
  const prompt = buildAgentCopyPrompt({ pr, checks: normalized, checkSummary });

  if (args.json) {
    console.log(JSON.stringify({ prompt, checkSummary }, null, 2));
  } else {
    process.stdout.write(`${prompt}\n`);
  }
  process.exit(checkSummary.failing.length > 0 ? 1 : 0);
}

module.exports = { parseArgs, main };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
