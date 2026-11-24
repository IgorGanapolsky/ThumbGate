#!/usr/bin/env node
'use strict';

/**
 * Ship policy evaluator: the free stand-in for Claude Approvals.
 *
 * Reads config/ship-policy.json and decides, for one pull request, whether it
 * may merge without a human (verdict "auto"), must wait for Igor ("human"), or
 * is held ("hold"). It also writes the deterministic review comment, picks the
 * tests the ship gate runs, and summarises check state for the merge step.
 *
 * The ship-gate workflow always runs this file from main, never from the PR.
 *
 * CLI:
 *   node scripts/ship-policy.js evaluate --pr 123 [--repo o/r] [--review-out f] [--json]
 *   node scripts/ship-policy.js select-tests --files a.js,b.js
 *   node scripts/ship-policy.js checks --pr 123 [--repo o/r]
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DEFAULT_POLICY_PATH = path.join(ROOT, 'config', 'ship-policy.json');
const REVIEW_MARKER = '<!-- ship-gate-review -->';

function loadPolicy(policyPath = DEFAULT_POLICY_PATH) {
  return JSON.parse(fs.readFileSync(policyPath, 'utf8'));
}

function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // "**/" matches zero or more directories; a bare "**" matches anything.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

function matchesAny(filePath, globs = []) {
  return globs.some((glob) => globToRegExp(glob).test(filePath));
}

function addedLines(patch = '') {
  const lines = [];
  let newLine = 0;
  for (const raw of String(patch).split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      lines.push({ line: newLine, text: raw.slice(1) });
      newLine += 1;
    } else if (!raw.startsWith('-')) {
      newLine += 1;
    }
  }
  return lines;
}

function scanFiles(files = [], policy) {
  const findings = [];
  const patterns = (policy.riskyPatterns || []).map((p) => ({ ...p, re: new RegExp(p.regex) }));
  for (const file of files) {
    if (matchesAny(file.filename, policy.scanExcludePaths || [])) continue;
    for (const { line, text } of addedLines(file.patch)) {
      for (const pattern of patterns) {
        if (pattern.re.test(text)) {
          findings.push({
            id: pattern.id,
            severity: pattern.severity,
            file: file.filename,
            line,
            message: pattern.message,
          });
        }
      }
    }
  }
  return findings;
}

function evaluatePr(pr = {}, files = [], policy = loadPolicy()) {
  const reasons = [];
  const warnings = [];
  const labels = new Set((pr.labels || []).map((l) => (typeof l === 'string' ? l : l.name)));
  const author = pr.author || '';
  const headRef = pr.headRef || '';
  const isDependabot = author === 'dependabot[bot]' || headRef.startsWith('dependabot/');
  const auto = policy.autoMerge || {};
  const names = files.map((f) => f.filename);
  const changedLines = files.reduce((sum, f) => sum + (f.additions || 0) + (f.deletions || 0), 0);
  const findings = scanFiles(files, policy);

  if (pr.isDraft) {
    return { verdict: 'hold', reasons: ['Draft PR. Mark it ready when local tests pass.'], warnings, findings, changedLines, files: names };
  }
  if (labels.has(policy.labels.hold)) {
    return { verdict: 'hold', reasons: [`Labelled \`${policy.labels.hold}\`.`], warnings, findings, changedLines, files: names };
  }

  // needs-igor is the gate's own label and is recomputed every run; igor-review
  // is Igor's and the gate never removes it.
  if (policy.labels.ownerReview && labels.has(policy.labels.ownerReview)) {
    reasons.push(`Labelled \`${policy.labels.ownerReview}\` (Igor asked to review it).`);
  }
  if (!auto.enabled) reasons.push('Auto-merge is switched off in config/ship-policy.json.');
  if (pr.base && pr.base !== policy.base) reasons.push(`Targets \`${pr.base}\`, not \`${policy.base}\`.`);
  if (pr.isCrossRepository) reasons.push('Opened from a fork.');
  if (!(auto.allowedAuthors || []).includes(author)) reasons.push(`Author \`${author || 'unknown'}\` is not on the auto-merge list.`);
  const prefixOk = (auto.allowedBranchPrefixes || []).some((p) => headRef.startsWith(p)) || labels.has(policy.labels.optIn);
  if (!prefixOk) reasons.push(`Branch \`${headRef}\` has no routine prefix and no \`${policy.labels.optIn}\` label.`);

  if (isDependabot) {
    const outside = names.filter((n) => !matchesAny(n, policy.dependabotAllowedPaths || []));
    if (outside.length) reasons.push(`Dependabot touched files outside manifests: ${outside.map((n) => `\`${n}\``).join(', ')}.`);
  } else {
    const sensitive = names.filter((n) => matchesAny(n, policy.humanReviewPaths || []));
    if (sensitive.length) reasons.push(`Touches paths Igor reviews: ${sensitive.map((n) => `\`${n}\``).join(', ')}.`);
    if (changedLines > auto.maxChangedLines) reasons.push(`${changedLines} changed lines (routine limit ${auto.maxChangedLines}).`);
    if (names.length > auto.maxFiles) reasons.push(`${names.length} files (routine limit ${auto.maxFiles}).`);
  }

  const deletedTests = files.filter((f) => f.status === 'removed' && matchesAny(f.filename, policy.testPaths || []));
  if (deletedTests.length) reasons.push(`Deletes tests: ${deletedTests.map((f) => `\`${f.filename}\``).join(', ')}.`);

  for (const f of findings.filter((x) => x.severity === 'block')) {
    reasons.push(`${f.message} (\`${f.file}:${f.line}\`)`);
  }
  for (const f of findings.filter((x) => x.severity !== 'block')) {
    warnings.push(`${f.message} (\`${f.file}:${f.line}\`)`);
  }

  const codeChanged = names.some((n) => matchesAny(n, policy.codePaths || []));
  const testsChanged = names.some((n) => matchesAny(n, policy.testPaths || []));
  if (codeChanged && !testsChanged && !isDependabot) {
    warnings.push('Code changed but no test changed. Say in the PR body why no test is needed.');
  }

  const hardBlock = findings.some((x) => x.severity === 'block');
  let verdict = reasons.length ? 'human' : 'auto';
  if (verdict === 'human' && pr.ownerApprovedHead && !hardBlock) {
    verdict = 'auto';
    warnings.unshift('Igor approved this exact commit, so it merges despite the reasons above.');
  }

  return {
    verdict,
    reasons,
    warnings,
    findings,
    changedLines,
    files: names,
  };
}

function selectTests(changed = [], policy = loadPolicy(), options = {}) {
  const exists = options.exists || ((p) => fs.existsSync(path.join(ROOT, p)));
  const listTests = options.listTests || (() => fs.readdirSync(path.join(ROOT, 'tests')).filter((n) => n.endsWith('.test.js')));
  const selected = new Set((policy.fastTests || []).filter(exists));
  const testNames = listTests();
  const cache = new Map();
  const readTest = options.readTest || ((name) => {
    if (!cache.has(name)) {
      try { cache.set(name, fs.readFileSync(path.join(ROOT, 'tests', name), 'utf8')); } catch { cache.set(name, ''); }
    }
    return cache.get(name);
  });
  const referenced = new Set();

  for (const file of changed) {
    // Changed tests are taken as-is: a test the PR adds is not on main yet, and
    // the test job runs against the PR head where it does exist.
    if (/^tests\/.*\.test\.js$/.test(file)) {
      selected.add(file);
      continue;
    }
    const base = path.basename(file).replace(/\.(c|m)?js$|\.json$|\.html$/, '');
    if (!base || base === file) continue;
    for (const name of testNames) {
      const stem = name.replace(/\.test\.js$/, '');
      if (stem === base || stem.startsWith(`${base}-`)) selected.add(`tests/${name}`);
    }
    // Tests that load or read the changed file by path, e.g.
    // require('../scripts/foo') or path.join(..., 'config', 'foo.json').
    const dir = path.dirname(file);
    const needles = [`${dir}/${base}`, `'${dir.split('/').pop()}', '${path.basename(file)}'`];
    for (const name of testNames) {
      const body = readTest(name);
      if (needles.some((n) => body.includes(n))) referenced.add(`tests/${name}`);
    }
  }
  // Direct matches first, then tests that only reference the file.
  for (const t of referenced) selected.add(t);

  const list = [...selected];
  return list.slice(0, policy.maxSelectedTests || list.length);
}

function summarizeChecks(checks = [], policy = loadPolicy()) {
  const optional = new Set(policy.optionalChecks || []);
  const self = new Set(policy.selfChecks || []);
  const failing = [];
  const pending = [];
  // A re-run (or a run cancelled by a newer one) leaves several entries with
  // the same name on one commit. Only the newest of each name counts.
  const newest = new Map();
  for (const check of checks) {
    const name = check.name || check.context || '';
    const at = Date.parse(check.startedAt || check.completedAt || '') || 0;
    const prev = newest.get(name);
    if (!prev || at >= prev.at) newest.set(name, { check, at });
  }
  for (const { check } of newest.values()) {
    const name = check.name || check.context || '';
    if (!name || optional.has(name) || self.has(name)) continue;
    const status = String(check.status || '').toUpperCase();
    const conclusion = String(check.conclusion || check.state || '').toUpperCase();
    if (status && status !== 'COMPLETED') {
      pending.push(name);
    } else if (['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS'].includes(conclusion)) {
      pending.push(name);
    } else if (!['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(conclusion)) {
      failing.push(name);
    }
  }
  const state = failing.length ? 'red' : pending.length ? 'pending' : 'green';
  return { state, failing, pending };
}

function renderReview(result, tests = []) {
  const head = {
    auto: '**Ship gate: routine.** This PR will merge on its own once every check is green and no review thread is open.',
    human: '**Ship gate: needs Igor.** This PR will not merge on its own.',
    hold: '**Ship gate: on hold.**',
  }[result.verdict];
  const lines = [REVIEW_MARKER, head, ''];
  if (result.reasons.length) {
    lines.push('Why:', ...result.reasons.map((r) => `- ${r}`), '');
  }
  if (result.warnings.length) {
    lines.push('Review notes:', ...result.warnings.map((w) => `- ${w}`), '');
  }
  lines.push(`${result.files.length} files, ${result.changedLines} changed lines.`);
  if (tests.length) lines.push(`Tests run by the gate: ${tests.map((t) => `\`${t}\``).join(', ')}.`);
  lines.push('', '_Policy: `config/ship-policy.json` (read from main). Add `do-not-merge` to stop a merge or `igor-review` to require you. Approving the head commit, resolving a thread or pushing re-runs the gate._');
  return lines.join('\n');
}

function gh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(res.stderr || res.stdout).trim()}`);
  return res.stdout;
}

function fetchPr(prNumber, repo, policy) {
  const pr = JSON.parse(gh(['api', `repos/${repo}/pulls/${prNumber}`]));
  const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${prNumber}/files?per_page=100`])).flat();
  const reviews = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${prNumber}/reviews?per_page=100`])).flat();
  const owner = (policy.owner || 'IgorGanapolsky').toLowerCase();
  const ownerApprovedHead = reviews.some((r) => String(r.user && r.user.login).toLowerCase() === owner
    && r.state === 'APPROVED' && r.commit_id === (pr.head && pr.head.sha));
  return {
    pr: {
      number: pr.number,
      author: pr.user && pr.user.login,
      headRef: pr.head && pr.head.ref,
      headSha: pr.head && pr.head.sha,
      base: pr.base && pr.base.ref,
      isDraft: Boolean(pr.draft),
      isCrossRepository: Boolean(pr.head && pr.head.repo && pr.base && pr.head.repo.full_name !== pr.base.repo.full_name),
      labels: (pr.labels || []).map((l) => l.name),
      ownerApprovedHead,
    },
    files: pages,
  };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i += 1; }
    } else out._.push(argv[i]);
  }
  return out;
}

function writeGithubOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const body = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${body}\n`);
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const policy = loadPolicy(args.policy || DEFAULT_POLICY_PATH);
  const repo = args.repo || process.env.GITHUB_REPOSITORY || 'IgorGanapolsky/ThumbGate';
  const cmd = args._[0];

  if (cmd === 'evaluate') {
    const { pr, files } = fetchPr(args.pr, repo, policy);
    const result = evaluatePr(pr, files, policy);
    const present = files.filter((f) => f.status !== 'removed').map((f) => f.filename);
    const all = selectTests(present, { ...policy, maxSelectedTests: Infinity });
    const tests = all.slice(0, policy.maxSelectedTests || all.length);
    if (all.length > tests.length) {
      result.warnings.push(`${all.length} tests match this change; the gate ran the first ${tests.length}. The full suite runs on the next release tag.`);
    }
    if (args['review-out']) fs.writeFileSync(args['review-out'], renderReview(result, tests));
    writeGithubOutput({ verdict: result.verdict, tests: tests.join(' '), head_sha: pr.headSha });
    console.log(args.json ? JSON.stringify({ ...result, tests }, null, 2) : `verdict=${result.verdict}`);
    return 0;
  }
  if (cmd === 'select-tests') {
    const files = String(args.files || '').split(',').filter(Boolean);
    console.log(selectTests(files, policy).join(' '));
    return 0;
  }
  if (cmd === 'checks') {
    const { statusCheckRollup = [] } = JSON.parse(gh(['pr', 'view', String(args.pr), '--repo', repo, '--json', 'statusCheckRollup']));
    const summary = summarizeChecks(statusCheckRollup, policy);
    console.log(JSON.stringify(summary));
    writeGithubOutput({ state: summary.state });
    return 0;
  }
  console.error('usage: ship-policy.js evaluate|select-tests|checks');
  return 2;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = {
  REVIEW_MARKER,
  addedLines,
  evaluatePr,
  globToRegExp,
  loadPolicy,
  matchesAny,
  renderReview,
  scanFiles,
  selectTests,
  summarizeChecks,
};
