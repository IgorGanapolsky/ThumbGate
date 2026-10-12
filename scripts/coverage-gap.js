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

function isCommentOnly(source) {
  let offset = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset])) { offset += 1; continue; }
    if (source.startsWith('//', offset)) {
      offset += 2;
      while (offset < source.length && !'\n\r\u2028\u2029'.includes(source[offset])) offset += 1;
    } else if (source.startsWith('/*', offset)) {
      const end = source.indexOf('*/', offset + 2);
      if (end === -1) return false;
      offset = end + 2;
    } else return false;
  }
  return true;
}

function classifySource(src, filePath = '') {
  const name = String(filePath).replace(/\\/g, '/');
  if (/\.d\.ts$/.test(name)) return 'types';
  const body = String(src || '').trim();
  if (isCommentOnly(body)) return 'empty';
  if (/^export\s*\{[\w\s,$]*\}\s*from\s+['"][^'"\n]+['"]\s*;?\s*$/.test(body)) return 'reexport';
  const code = body.replace(/^['"]use strict['"];?/gm, '').trim();
  const literal = String.raw`(?:-?\d+(?:\.\d+)?|true|false|null|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`;
  const field = String.raw`\s*[A-Za-z_$][\w$]*\s*:\s*${literal}\s*`;
  const frozen = new RegExp(String.raw`^(?:module\.exports\s*=|(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=)\s*Object\.freeze\(\{(?:${field}(?:,${field})*,?)?\}\)\s*;?$`);
  if (frozen.test(code)) return 'enum';
  const constant = new RegExp(String.raw`^(?:(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*${literal}\s*;\s*)+$`);
  if (constant.test(code)) return 'constants';
  return 'behavior';
}

function inScope(filePath, scope) {
  if (!scope) return true;
  const n = String(filePath).replace(/\\/g, '/');
  const s = String(scope).replace(/\\/g, '/').replace(/^\.\//, '');
  return n === s || n.startsWith(`${s.replace(/\/$/, '')}/`) || n.includes(`/${s.replace(/\/$/, '')}/`);
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
    const statements = entry.s && typeof entry.s === 'object' ? Object.values(entry.s) : [];
    const statementOnly = entry.lines == null && entry.covered == null && statements.length > 0;
    rows.push({
      path: filePath.replace(/\\/g, '/'),
      pct: filePct(entry),
      lines: statementOnly ? statements.length : Number(entry.lines) || 0,
      covered: statementOnly ? statements.filter(value => Number(value) > 0).length : Number(entry.covered) || 0,
      kind,
      noBehavior: NO_BEHAVIOR_KINDS.includes(kind) || entry.noBehavior === true,
    });
  }
  return rows;
}

function baselineCoverage(coverage, options = {}) {
  const floor = options.floor == null ? DEFAULT_FLOOR : Number(options.floor);
  if (!Number.isFinite(floor) || floor < 0 || floor > 100) throw new RangeError('Coverage floor must be a finite percentage from 0 to 100');
  const scope = options.scope || '';
  const skipNoBehavior = options.skipNoBehavior !== false;
  const rows = normalizeFiles(coverage).filter((r) => inScope(r.path, scope));
  const skipped = skipNoBehavior ? rows.filter((r) => r.noBehavior) : [];
  const behavioral = skipNoBehavior ? rows.filter((r) => !r.noBehavior) : rows;
  const gaps = behavioral.filter((r) => r.pct < floor).sort((a, b) => a.pct - b.pct);
  const coveredSum = behavioral.reduce((n, r) => n + r.covered, 0);
  const lineSum = behavioral.reduce((n, r) => n + r.lines, 0);
  const pct = lineSum > 0 ? Math.round((1000 * coveredSum) / lineSum) / 10 : (behavioral.length ? 0 : null);
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
  const oldGapPaths = new Set(before.gaps.map(gap => gap.path));
  const newGaps = after.gaps.filter(gap => !oldGapPaths.has(gap.path));
  if (newGaps.length) findings.push({ severity: 'fail', id: 'new_gaps', message: `New uncovered behavioral files: ${newGaps.map(gap => gap.path).join(', ')}` });
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
  if (before.files === 0 || after.files === 0) {
    findings.push({ severity: 'fail', id: 'no_behavioral_data', message: 'Both measurements need behavioral coverage in the selected scope.' });
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
  if (!Number.isFinite(floor) || floor < 0 || floor > 100) throw new RangeError('Coverage floor must be a finite percentage from 0 to 100');
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

  if (baseline && baseline.files === 0 && !findings.some((f) => f.id === 'no_behavioral_data')) {
    findings.push({ severity: 'fail', id: 'no_behavioral_data', message: 'No behavioral coverage in the selected scope.' });
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
  const booleanFlags = {
    json: 'json',
    strict: 'strict',
    'clone-test-agent': 'clone-test-agent',
    'claim-100': 'claim100',
    'include-no-behavior': 'include-no-behavior',
  };
  for (const arg of argv) {
    const flag = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (flag && Object.hasOwn(booleanFlags, flag[1])) {
      options[booleanFlags[flag[1]]] = normalizeBoolean(flag[2] === undefined ? true : flag[2]);
    } else if (arg.startsWith('--coverage=')) options.coverage = arg.slice('--coverage='.length);
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
  normalizeBoolean,
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
