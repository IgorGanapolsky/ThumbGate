#!/usr/bin/env node
'use strict';

/**
 * VS "Today I will improve test coverage" FORMAT steal — not a Test Agent clone.
 *
 * Source: https://devblogs.microsoft.com/visualstudio/today-i-will-improve-test-coverage/
 *
 * Transfers:
 *   1. Baseline first — find gaps before writing tests
 *   2. Skip no-behavior files (enums, re-exports, constants-only)
 *   3. Remeasure the SAME scope after; never cov-fail-under=100
 *
 * Maps onto scripts/test-coverage.js (feature-detected Node coverage flags).
 * Does NOT clone GitHub Copilot Test Agent or `@test #solution`.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URL = 'https://devblogs.microsoft.com/visualstudio/today-i-will-improve-test-coverage/';
const DEFAULT_FLOOR = 50;
const NO_BEHAVIOR_KINDS = Object.freeze(['enum', 'constants', 'reexport', 'empty', 'types']);

const CLONE_PATTERNS = Object.freeze([
  { id: 'test_agent', re: /\b(clone|install|vendor)\b.{0,40}\b(test agent|github copilot testing)\b/i },
  { id: 'at_test_solution', re: /@test\s+#solution/i },
  { id: 'fail_under_100', re: /\bcov-fail-under\s*=\s*100\b/i },
  { id: 'claim_100', re: /\b(claim|require|enforce)\b.{0,30}\b100%\s*coverage\b/i },
]);

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function detectCloneAttempt(text) {
  const t = String(text || '');
  return CLONE_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.id);
}

function stripComments(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .trim();
}

function classifySource(src, filePath = '') {
  const name = String(filePath).replace(/\\/g, '/');
  if (/\.d\.ts$/.test(name) || /\/types\//.test(name)) return 'types';
  const body = stripComments(src);
  if (!body) return 'empty';
  if (/^export\s*\{[\s\S]*\}\s*from\s+['"][^'"]+['"]\s*;?\s*$/.test(body)) return 'reexport';
  const withoutExport = body.replace(/^['"]use strict['"];?/gm, '').trim();
  const hasBehavior = /\b(function|class|if\s*\(|switch\s*\(|try\s*\{|=>|while\s*\(|for\s*\()/.test(withoutExport);
  if (hasBehavior) return 'behavior';
  if (/\benum\b/.test(withoutExport) || /Object\.freeze\s*\(/.test(withoutExport)) return 'enum';
  return 'constants';
}

function inScope(filePath, scope) {
  if (!scope) return true;
  const n = String(filePath).replace(/\\/g, '/');
  const s = String(scope).replace(/\\/g, '/').replace(/^\.\//, '');
  return n === s || n.startsWith(`${s.replace(/\/$/, '')}/`) || n.includes(`/${s.replace(/\/$/, '')}/`) || n.startsWith(s);
}

function filePct(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  if (Number.isFinite(Number(entry.pct))) return Number(entry.pct);
  const lines = Number(entry.lines);
  const covered = Number(entry.covered);
  if (Number.isFinite(lines) && lines > 0 && Number.isFinite(covered)) {
    return Math.round((1000 * covered) / lines) / 10;
  }
  if (entry.s && typeof entry.s === 'object') {
    const vals = Object.values(entry.s);
    if (!vals.length) return 0;
    const hit = vals.filter((n) => Number(n) > 0).length;
    return Math.round((1000 * hit) / vals.length) / 10;
  }
  return 0;
}

function normalizeFiles(coverage) {
  if (!coverage || typeof coverage !== 'object') return [];
  const raw = coverage.files && typeof coverage.files === 'object' && !Array.isArray(coverage.files)
    ? coverage.files
    : coverage;
  const rows = [];
  for (const [filePath, entry] of Object.entries(raw)) {
    if (filePath === 'files' || filePath === 'totals') continue;
    if (!entry || typeof entry !== 'object') continue;
    const src = entry.source != null ? String(entry.source) : '';
    const kind = entry.kind || (src ? classifySource(src, filePath) : (entry.noBehavior ? 'constants' : 'behavior'));
    rows.push({
      path: filePath.replace(/\\/g, '/'),
      pct: filePct(entry),
      lines: Number(entry.lines) || 0,
      covered: Number(entry.covered) || 0,
      kind,
      noBehavior: NO_BEHAVIOR_KINDS.includes(kind) || entry.noBehavior === true,
    });
  }
  return rows;
}

function baselineCoverage(coverage, options = {}) {
  const floor = options.floor == null ? DEFAULT_FLOOR : Number(options.floor);
  const scope = options.scope || '';
  const skipNoBehavior = options.skipNoBehavior !== false;
  const rows = normalizeFiles(coverage).filter((r) => inScope(r.path, scope));
  const skipped = skipNoBehavior ? rows.filter((r) => r.noBehavior) : [];
  const behavioral = skipNoBehavior ? rows.filter((r) => !r.noBehavior) : rows;
  const gaps = behavioral.filter((r) => r.pct < floor).sort((a, b) => a.pct - b.pct);
  const coveredSum = behavioral.reduce((n, r) => n + r.covered, 0);
  const lineSum = behavioral.reduce((n, r) => n + r.lines, 0);
  const pct = lineSum > 0 ? Math.round((1000 * coveredSum) / lineSum) / 10 : (behavioral.length ? 0 : 100);
  return {
    scope: scope || '(all)',
    floor,
    skipNoBehavior,
    files: behavioral.length,
    skippedNoBehavior: skipped.map((r) => ({ path: r.path, kind: r.kind })),
    gaps: gaps.map((r) => ({ path: r.path, pct: r.pct, kind: r.kind })),
    pct,
    claim100: options.claim100 === true,
  };
}

function compareCoverage(beforeCov, afterCov, options = {}) {
  const before = baselineCoverage(beforeCov, options);
  const after = baselineCoverage(afterCov, options);
  const findings = [];
  if (String(options.beforeScope || before.scope) !== String(options.afterScope || after.scope)
    && options.beforeScope && options.afterScope
    && options.beforeScope !== options.afterScope) {
    findings.push({
      severity: 'fail',
      id: 'scope_drift',
      message: `Remeasure used a different scope (${options.afterScope}) than baseline (${options.beforeScope}). Same-scope only.`,
    });
  }
  if (after.claim100 || options.claim100 === true || after.pct >= 100 && options.require100 === true) {
    findings.push({
      severity: 'fail',
      id: 'claim_100',
      message: 'Never cov-fail-under=100 and never claim 100% coverage as the win. Gaps, not completeness.',
    });
  }
  if (after.gaps.length > before.gaps.length) {
    findings.push({
      severity: 'fail',
      id: 'gaps_grew',
      message: `Behavioral gaps grew ${before.gaps.length} → ${after.gaps.length} in scope ${after.scope}.`,
    });
  }
  if (after.pct + 0.05 < before.pct) {
    findings.push({
      severity: 'fail',
      id: 'pct_dropped',
      message: `Scoped behavioral coverage dropped ${before.pct}% → ${after.pct}%.`,
    });
  }
  const newNoBehaviorTests = (after.skippedNoBehavior || []).filter((s) => (
    !(before.skippedNoBehavior || []).some((b) => b.path === s.path)
  ));
  if (options.punishNoBehaviorTests && newNoBehaviorTests.length) {
    findings.push({
      severity: 'fail',
      id: 'tested_no_behavior',
      message: `Wrote tests for no-behavior files (${newNoBehaviorTests.map((s) => s.path).join(', ')}). Skip enums/re-exports.`,
    });
  }
  return { before, after, findings };
}

function loadJson(filePath) {
  if (!filePath) return null;
  if (typeof filePath === 'object') return filePath;
  return JSON.parse(fs.readFileSync(String(filePath), 'utf8'));
}

function collectCloneHaystack(options = {}) {
  const parts = [
    options.task,
    options.query,
    options['clone-test-agent'] ? 'clone Test Agent @test #solution' : '',
    options.require100 ? 'require 100% coverage cov-fail-under=100' : '',
  ];
  if (Array.isArray(options.argv)) parts.push(...options.argv);
  return parts.filter(Boolean).join(' ');
}

function buildCoverageGapReport(options = {}) {
  const findings = [];
  const cloneHits = [...new Set(detectCloneAttempt(collectCloneHaystack(options)))];
  if (cloneHits.length) {
    findings.push({
      severity: 'fail',
      id: 'vs_test_agent_clone_refused',
      message: `Refusing Copilot Test Agent / @test #solution / 100% coverage clones (${cloneHits.join(', ')}). Baseline gaps, skip no-behavior, remeasure same scope.`,
    });
  }

  const floor = options.floor == null ? DEFAULT_FLOOR : Number(options.floor);
  const scope = options.scope || '';
  const skipNoBehavior = options.skipNoBehavior !== false && !normalizeBoolean(options['include-no-behavior']);

  let mode = 'baseline';
  let baseline = null;
  let comparison = null;

  if (options.after && options.before) {
    mode = 'compare';
    comparison = compareCoverage(loadJson(options.before), loadJson(options.after), {
      floor,
      scope,
      skipNoBehavior,
      claim100: normalizeBoolean(options.claim100) || normalizeBoolean(options['claim-100']),
      require100: normalizeBoolean(options.require100),
      beforeScope: options.beforeScope || scope,
      afterScope: options.afterScope || scope,
      punishNoBehaviorTests: options.punishNoBehaviorTests !== false,
    });
    findings.push(...comparison.findings);
    baseline = comparison.after;
  } else if (options.coverage || options.before) {
    baseline = baselineCoverage(loadJson(options.coverage || options.before), {
      floor,
      scope,
      skipNoBehavior,
      claim100: normalizeBoolean(options.claim100) || normalizeBoolean(options['claim-100']),
    });
    if (baseline.claim100) {
      findings.push({
        severity: 'fail',
        id: 'claim_100',
        message: 'Never claim 100% coverage as the win. Report remaining gaps instead.',
      });
    }
  } else if (!cloneHits.length && !normalizeBoolean(options.map || options['map-only'])) {
    findings.push({
      severity: 'warn',
      id: 'no_coverage_input',
      message: 'No --coverage/--before JSON. Pass a coverage fixture to baseline gaps. Maps onto scripts/test-coverage.js.',
    });
  }

  if (normalizeBoolean(options['claim-100']) || normalizeBoolean(options.claim100)) {
    if (!findings.some((f) => f.id === 'claim_100')) {
      findings.push({
        severity: 'fail',
        id: 'claim_100',
        message: 'Never claim 100% coverage as the win.',
      });
    }
  }

  let status = 'ready';
  if (findings.some((f) => f.severity === 'fail')) status = 'fail';
  else if (findings.some((f) => f.severity === 'warn')) status = 'ready_with_warnings';

  return {
    name: 'thumbgate-coverage-gap',
    status,
    ok: status !== 'fail',
    mode,
    baseline,
    comparison: comparison && { before: comparison.before, after: comparison.after },
    compareNotClone: true,
    runner: 'scripts/test-coverage.js',
    never: [
      'clone Copilot Test Agent / @test #solution',
      'cov-fail-under=100',
      'write tests for enums/re-exports/constants-only files',
      'remeasure a different directory than the baseline scope',
      'claim 100% coverage',
    ],
    source: SOURCE_URL,
    disclaimer: 'FORMAT steal only. Not affiliated with Visual Studio, GitHub Copilot, or Test Agent. Gaps first; never 100%.',
    findings,
  };
}

function formatCoverageGapReport(report) {
  const lines = [
    'ThumbGate coverage-gap (VS FORMAT steal)',
    `Status   : ${report.status}`,
    `ok       : ${report.ok}`,
    `Mode     : ${report.mode}`,
  ];
  if (report.baseline) {
    lines.push(`Scope    : ${report.baseline.scope}  floor=${report.baseline.floor}%  pct=${report.baseline.pct}%`);
    lines.push(`Gaps     : ${report.baseline.gaps.length}  skipped-no-behavior=${report.baseline.skippedNoBehavior.length}`);
    for (const g of report.baseline.gaps.slice(0, 12)) {
      lines.push(`  - ${g.path}  ${g.pct}%`);
    }
  }
  if (report.findings?.length) {
    lines.push('Findings:');
    for (const f of report.findings) lines.push(`  [${f.severity}] ${f.id}: ${f.message}`);
  }
  lines.push(`Never    : ${(report.never || []).join('; ')}`);
  lines.push(`Source   : ${report.source}`);
  lines.push(report.disclaimer);
  return `${lines.join('\n')}\n`;
}

function parseArgv(argv) {
  const options = { argv };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--clone-test-agent') options['clone-test-agent'] = true;
    else if (arg === '--claim-100') options.claim100 = true;
    else if (arg === '--include-no-behavior') options['include-no-behavior'] = true;
    else if (arg.startsWith('--coverage=')) options.coverage = arg.slice('--coverage='.length);
    else if (arg.startsWith('--before=')) options.before = arg.slice('--before='.length);
    else if (arg.startsWith('--after=')) options.after = arg.slice('--after='.length);
    else if (arg.startsWith('--scope=')) options.scope = arg.slice('--scope='.length);
    else if (arg.startsWith('--floor=')) options.floor = Number(arg.slice('--floor='.length));
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/coverage-gap.js [options]

VS coverage FORMAT: baseline gaps, skip no-behavior files, remeasure same scope.
Does not clone Copilot Test Agent. Never 100%.

Options:
  --coverage=<file.json>   Baseline a coverage fixture
  --before= --after=       Compare the same --scope
  --scope=scripts/foo/     Limit files (required for honest compare)
  --floor=50               Gap threshold (default 50)
  --claim-100              Fail closed
  --clone-test-agent       Fail closed
  --json --strict
`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  const options = parseArgv(argv);
  const report = buildCoverageGapReport(options);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatCoverageGapReport(report));
  if (options.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  SOURCE_URL,
  DEFAULT_FLOOR,
  NO_BEHAVIOR_KINDS,
  classifySource,
  baselineCoverage,
  compareCoverage,
  detectCloneAttempt,
  buildCoverageGapReport,
  formatCoverageGapReport,
  main,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main();
}
