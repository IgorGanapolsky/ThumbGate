'use strict';

/**
 * tests/governance-conflict-audit.test.js
 *
 * Every detector gets a POSITIVE case (the defect is present and is detected)
 * and a NEGATIVE case (the surface is clean and nothing is flagged). Each
 * positive case is modelled on the real defect that motivated the detector, so
 * a regression here means the detector stopped catching something that actually
 * happened in this repository.
 *
 * Every fixture is written into a fresh temp directory. Nothing in this file
 * reads or writes the operator's real repo, gate configs, or ThumbGate store.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  auditGovernanceConflicts,
  renderConflictAuditText,
  auditGateConfigs,
  auditSilentlyRedChecks,
  auditAnalysisBlindspots,
  auditZeroCallSites,
  auditMainCheckUnderSymlink,
  globToRegExp,
  parseProperties,
  parseEntryExportNames,
  parseEntryBindings,
  extractEntryExportStatement,
  deriveGitHubRepo,
  resolveGhBinary,
  makeGhApiReader,
  GH_BINARY_CANDIDATES,
  stripComments,
  countCodeLines,
  DETECTOR_STATUS,
  SEVERITY,
  SEVERITY_RULES,
} = require('../scripts/governance-conflict-audit');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const tempRoots = [];

/** Build a throwaway repo from a { relativePath: contents } map. */
function makeFixtureRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-conflict-audit-'));
  tempRoots.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents, 'utf8');
  }
  return root;
}

test.after(() => {
  for (const root of tempRoots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function gatesConfig(gates) {
  return JSON.stringify({ gates }, null, 2);
}

function findingsWithRule(detector, rule) {
  return detector.findings.filter((f) => f.rule === rule);
}

/** Minimal fake `gh api` reader driven by a route table. */
function makeFakeGh(routes) {
  return function fakeGhApi(apiPath) {
    for (const [pattern, value] of routes) {
      if (typeof pattern === 'string' ? apiPath === pattern : pattern.test(apiPath)) {
        if (value instanceof Error) throw value;
        return typeof value === 'function' ? value(apiPath) : value;
      }
    }
    const err = new Error(`unrouted: ${apiPath}`);
    err.stderr = `gh: Not Found (${apiPath})`;
    throw err;
  };
}

/** Build a check-runs payload for one commit. */
function checkRuns(entries) {
  return { check_runs: entries.map(([name, conclusion]) => ({ name, status: 'completed', conclusion })) };
}

// ---------------------------------------------------------------------------
// D1 — inert-or-overmatching gate shape
// ---------------------------------------------------------------------------

test('D1 positive: a `patterns` array with no `pattern` is reported as overmatching', () => {
  const root = makeFixtureRepo({
    'config/gates/default.json': gatesConfig([
      { id: 'plural-gate', toolNames: ['Bash', 'Write'], patterns: ['rm -rf', 'chmod 777'], action: 'block' },
    ]),
  });
  const { d1 } = auditGateConfigs({ repoRoot: root, gatesDir: 'config/gates' });

  assert.equal(d1.status, DETECTOR_STATUS.RAN);
  assert.equal(d1.findings.length, 1);
  const finding = d1.findings[0];
  assert.equal(finding.detector, 'D1');
  assert.equal(finding.severity, SEVERITY.HIGH);
  assert.equal(finding.rule, 'D1.overmatching');
  assert.match(finding.location, /plural-gate/);
  // The whole point: it does not narrow, it fires on the whole toolNames list.
  assert.match(finding.actually, /matches every tool in toolNames \(Bash, Write\)/);
  assert.match(finding.evidence, /pattern=absent/);
});

test('D1 positive: no toolNames either raises the finding to critical', () => {
  const root = makeFixtureRepo({
    'config/gates/default.json': gatesConfig([
      { id: 'catch-all', patterns: ['secret'], action: 'block' },
    ]),
  });
  const { d1 } = auditGateConfigs({ repoRoot: root, gatesDir: 'config/gates' });

  assert.equal(d1.findings.length, 1);
  assert.equal(d1.findings[0].severity, SEVERITY.CRITICAL);
  assert.equal(d1.findings[0].rule, 'D1.no-tool-names');
  assert.match(d1.findings[0].actually, /every tool call/);
});

test('D1 positive: a `patterns` array alongside a real `pattern` is dead config', () => {
  const root = makeFixtureRepo({
    'config/gates/default.json': gatesConfig([
      { id: 'shadowed', toolNames: ['Bash'], pattern: 'rm\\s+-rf', patterns: ['chmod 777'], action: 'block' },
    ]),
  });
  const { d1 } = auditGateConfigs({ repoRoot: root, gatesDir: 'config/gates' });

  assert.equal(findingsWithRule(d1, 'D1.shadowed').length, 1);
  assert.equal(d1.findings[0].severity, SEVERITY.MEDIUM);
});

test('D1 negative: a correctly shaped gate is not flagged', () => {
  const root = makeFixtureRepo({
    'config/gates/default.json': gatesConfig([
      { id: 'ok-gate', toolNames: ['Bash'], pattern: 'rm\\s+-rf\\s+/', action: 'block' },
      { id: 'no-pattern-gate', toolNames: ['Write'], fileGlobs: ['**/*.env'], action: 'approve' },
    ]),
  });
  const { d1 } = auditGateConfigs({ repoRoot: root, gatesDir: 'config/gates' });

  assert.equal(d1.status, DETECTOR_STATUS.RAN);
  assert.deepEqual(d1.findings, []);
  assert.equal(d1.inspected.gatesChecked, 2);
});

test('D1 reads the key name it is told the engine reads, not a hardcoded one', () => {
  // If gates-engine.js ever switched to `patterns`, D1 must invert — a detector
  // that trusts its own docs over the engine is the defect, not the fix.
  const root = makeFixtureRepo({
    'config/gates/default.json': gatesConfig([
      { id: 'plural-gate', toolNames: ['Bash'], patterns: ['rm -rf'] },
    ]),
  });
  const { d1 } = auditGateConfigs({ repoRoot: root, gatesDir: 'config/gates', patternKeyReadByEngine: 'patterns' });
  assert.deepEqual(d1.findings, []);
});

// ---------------------------------------------------------------------------
// D2 — regex that cannot compile
// ---------------------------------------------------------------------------

test('D2 positive: an inline (?i) flag group is detected by attempting compilation', () => {
  const root = makeFixtureRepo({
    'config/gates/default.json': gatesConfig([
      { id: 'inline-flag-gate', toolNames: ['Bash'], pattern: '(?i)curl\\s+.*api[_-]?key', action: 'block' },
    ]),
  });
  const { d2 } = auditGateConfigs({ repoRoot: root, gatesDir: 'config/gates' });

  assert.equal(d2.status, DETECTOR_STATUS.RAN);
  assert.equal(d2.findings.length, 1);
  assert.equal(d2.findings[0].severity, SEVERITY.HIGH);
  assert.equal(d2.findings[0].rule, 'D2.uncompilable');
  // Evidence must carry the ACTUAL thrown message, not a canned string.
  assert.match(d2.findings[0].evidence, /new RegExp\(\) threw:/);
  assert.match(d2.findings[0].evidence, /\(\?i\)/);
  assert.match(d2.findings[0].actually, /swallowed/);
});

test('D2 positive: any uncompilable pattern is caught, not just inline flags', () => {
  const root = makeFixtureRepo({
    'config/gates/default.json': gatesConfig([
      { id: 'unbalanced', toolNames: ['Bash'], pattern: 'rm\\s+-rf\\s+(unclosed' },
    ]),
  });
  const { d2 } = auditGateConfigs({ repoRoot: root, gatesDir: 'config/gates' });
  assert.equal(d2.findings.length, 1);
  assert.match(d2.findings[0].evidence, /new RegExp\(\) threw:/);
});

test('D2 negative: compilable patterns produce no findings and are counted', () => {
  const root = makeFixtureRepo({
    'config/gates/default.json': gatesConfig([
      { id: 'a', toolNames: ['Bash'], pattern: 'rm\\s+-rf' },
      { id: 'b', toolNames: ['Bash'], pattern: '(?:sudo|doas)\\s+' },
    ]),
  });
  const { d2 } = auditGateConfigs({ repoRoot: root, gatesDir: 'config/gates' });

  assert.deepEqual(d2.findings, []);
  assert.equal(d2.inspected.patternsCompiled, 2);
});

// ---------------------------------------------------------------------------
// D1/D2 availability
// ---------------------------------------------------------------------------

test('D1/D2 report UNAVAILABLE when the gate config directory does not exist', () => {
  const root = makeFixtureRepo({ 'README.md': '# nothing here\n' });
  const { d1, d2 } = auditGateConfigs({ repoRoot: root, gatesDir: 'config/gates' });

  for (const d of [d1, d2]) {
    assert.equal(d.status, DETECTOR_STATUS.UNAVAILABLE);
    assert.match(d.reason, /does not exist/);
    assert.deepEqual(d.findings, []);
  }
});

test('D1/D2 report PARTIAL when a gate config cannot be parsed', () => {
  const root = makeFixtureRepo({
    'config/gates/good.json': gatesConfig([{ id: 'ok', toolNames: ['Bash'], pattern: 'rm' }]),
    'config/gates/broken.json': '{ this is not json',
  });
  const { d1, d2 } = auditGateConfigs({ repoRoot: root, gatesDir: 'config/gates' });

  for (const d of [d1, d2]) {
    assert.equal(d.status, DETECTOR_STATUS.PARTIAL);
    assert.match(d.reason, /could not be parsed/);
    assert.equal(d.notInspected.length, 1);
    assert.match(d.notInspected[0], /broken\.json/);
  }
  // The parseable file was still checked.
  assert.equal(d1.inspected.gatesChecked, 1);
});

// ---------------------------------------------------------------------------
// D3 — silently-red non-required check
// ---------------------------------------------------------------------------

const D3_COMMITS = [
  { sha: 'aaaaaaa1111111111111111111111111111111a1', commit: { author: { date: '2026-08-21T22:24:43Z' } } },
  { sha: 'bbbbbbb2222222222222222222222222222222b2', commit: { author: { date: '2026-08-21T21:17:54Z' } } },
  { sha: 'ccccccc3333333333333333333333333333333c3', commit: { author: { date: '2026-08-21T20:31:03Z' } } },
  { sha: 'ddddddd4444444444444444444444444444444d4', commit: { author: { date: '2026-08-21T18:03:41Z' } } },
  { sha: 'eeeeeee5555555555555555555555555555555e5', commit: { author: { date: '2026-08-20T19:56:16Z' } } },
];

/**
 * @param {string[]} contexts         required by CLASSIC branch protection
 * @param {string[]} [rulesetContexts] required by a repository RULESET only
 * @param {Error}   [rulesetError]     the rulesets endpoint fails
 * @param {boolean} [noRulesetRoute]   no route at all → the reader throws
 */
function d3Routes({
  contexts, perCommit, protectionError, rulesetContexts, rulesetError, noRulesetRoute,
}) {
  const routes = [];
  routes.push([/branches\/main\/protection$/, protectionError || { required_status_checks: { contexts } }]);
  if (!noRulesetRoute) {
    routes.push([/\/rules\/branches\//, rulesetError || [
      { type: 'required_linear_history', ruleset_id: 7 },
      {
        type: 'required_status_checks',
        ruleset_id: 7,
        parameters: {
          required_status_checks: (rulesetContexts || []).map((context) => ({ context })),
        },
      },
    ]]);
  }
  routes.push([/\/commits\?sha=/, D3_COMMITS]);
  for (const [sha, entries] of Object.entries(perCommit)) {
    routes.push([new RegExp(`commits/${sha}/check-runs`), checkRuns(entries)]);
  }
  return routes;
}

test('D3 positive: a non-required check red on N consecutive commits is reported (the Railway deploy case)', () => {
  // Modelled on `deploy` / `verify` failing 18 straight main commits between
  // 2026-08-19 and 2026-08-21 while `test` stayed green.
  const perCommit = {};
  for (const c of D3_COMMITS) perCommit[c.sha] = [['test', 'success'], ['deploy', 'failure'], ['verify', 'failure']];

  const d3 = auditSilentlyRedChecks({
    gitHubRepo: 'Example/Repo',
    branch: 'main',
    consecutiveFailureThreshold: 3,
    commitLimit: 5,
    ghApi: makeFakeGh(d3Routes({ contexts: ['test'], perCommit })),
  });

  assert.equal(d3.status, DETECTOR_STATUS.RAN);
  const names = d3.findings.map((f) => f.location);
  assert.equal(d3.findings.length, 2, 'both deploy and verify are silently red');
  assert.ok(names.some((n) => n.includes('"deploy"')));
  assert.ok(names.some((n) => n.includes('"verify"')));
  for (const f of d3.findings) {
    assert.equal(f.severity, SEVERITY.HIGH);
    assert.equal(f.rule, 'D3.still-failing');
    assert.match(f.evidence, /streak of 5 consecutive 'failure'/);
    assert.match(f.evidence, /aaaaaaa1/);
    assert.match(f.evidence, /required by branch protection = \[test\]/);
    assert.match(f.evidence, /required by ruleset\(s\) 7 = \[\]/);
  }
});

test('D3 positive: a recovered streak is reported at medium, not high', () => {
  const perCommit = {};
  D3_COMMITS.forEach((c, i) => {
    perCommit[c.sha] = [['test', 'success'], ['deploy', i === 0 ? 'success' : 'failure']];
  });

  const d3 = auditSilentlyRedChecks({
    gitHubRepo: 'Example/Repo',
    branch: 'main',
    consecutiveFailureThreshold: 3,
    commitLimit: 5,
    ghApi: makeFakeGh(d3Routes({ contexts: ['test'], perCommit })),
  });

  assert.equal(d3.findings.length, 1);
  assert.equal(d3.findings[0].severity, SEVERITY.MEDIUM);
  assert.equal(d3.findings[0].rule, 'D3.recovered');
  assert.match(d3.findings[0].actually, /has since recovered/);
});

test('D3 negative: a REQUIRED check that is red is not a silent failure', () => {
  const perCommit = {};
  for (const c of D3_COMMITS) perCommit[c.sha] = [['test', 'failure']];

  const d3 = auditSilentlyRedChecks({
    gitHubRepo: 'Example/Repo',
    branch: 'main',
    consecutiveFailureThreshold: 3,
    commitLimit: 5,
    ghApi: makeFakeGh(d3Routes({ contexts: ['test'], perCommit })),
  });

  assert.equal(d3.status, DETECTOR_STATUS.RAN);
  assert.deepEqual(d3.findings, [], 'a required check that fails already blocks the merge');
});

test('D3 negative: a streak shorter than the threshold is not reported', () => {
  const perCommit = {};
  D3_COMMITS.forEach((c, i) => {
    perCommit[c.sha] = [['test', 'success'], ['deploy', i < 2 ? 'failure' : 'success']];
  });

  const d3 = auditSilentlyRedChecks({
    gitHubRepo: 'Example/Repo',
    branch: 'main',
    consecutiveFailureThreshold: 3,
    commitLimit: 5,
    ghApi: makeFakeGh(d3Routes({ contexts: ['test'], perCommit })),
  });

  assert.deepEqual(d3.findings, []);
});

test('D3 negative: a skipped or absent conclusion breaks the streak instead of counting as failure', () => {
  const perCommit = {};
  D3_COMMITS.forEach((c, i) => {
    // failure, failure, skipped, failure, failure — longest real streak is 2.
    const conclusion = i === 2 ? 'skipped' : 'failure';
    perCommit[c.sha] = [['test', 'success'], ['deploy', conclusion]];
  });

  const d3 = auditSilentlyRedChecks({
    gitHubRepo: 'Example/Repo',
    branch: 'main',
    consecutiveFailureThreshold: 3,
    commitLimit: 5,
    ghApi: makeFakeGh(d3Routes({ contexts: ['test'], perCommit })),
  });

  assert.deepEqual(d3.findings, []);
});

test('D3 reports UNAVAILABLE when branch protection cannot be read', () => {
  const err = new Error('HTTP 403');
  err.stderr = 'gh: Resource not accessible by integration';
  const d3 = auditSilentlyRedChecks({
    gitHubRepo: 'Example/Repo',
    branch: 'main',
    consecutiveFailureThreshold: 3,
    commitLimit: 5,
    ghApi: makeFakeGh(d3Routes({ contexts: [], perCommit: {}, protectionError: err })),
  });

  assert.equal(d3.status, DETECTOR_STATUS.UNAVAILABLE);
  assert.match(d3.reason, /could not read/);
  assert.match(d3.reason, /not accessible/);
  assert.deepEqual(d3.findings, []);
});

test('D3 reports UNAVAILABLE when no GitHub repo can be determined', () => {
  const d3 = auditSilentlyRedChecks({
    gitHubRepo: null,
    consecutiveFailureThreshold: 3,
    commitLimit: 5,
    ghApi: () => { throw new Error('should never be called'); },
  });
  assert.equal(d3.status, DETECTOR_STATUS.UNAVAILABLE);
  assert.match(d3.reason, /no GitHub repo/);
});

test('D3 reports PARTIAL when some commits could not be read', () => {
  const perCommit = {};
  D3_COMMITS.slice(0, 3).forEach((c) => { perCommit[c.sha] = [['deploy', 'failure']]; });
  // The last two commits have no route and will throw.

  const d3 = auditSilentlyRedChecks({
    gitHubRepo: 'Example/Repo',
    branch: 'main',
    consecutiveFailureThreshold: 3,
    commitLimit: 5,
    ghApi: makeFakeGh(d3Routes({ contexts: ['test'], perCommit })),
  });

  assert.equal(d3.status, DETECTOR_STATUS.PARTIAL);
  assert.match(d3.reason, /could not be read/);
  assert.equal(d3.notInspected.length, 2);
});

test('D3 negative: a check required ONLY by a repository ruleset is not reported as blocking nothing', () => {
  // The defect this guards against: ThumbGate layers the "main governance"
  // ruleset over classic branch protection. Reading only
  // branches/main/protection would report `deploy` — required by the ruleset,
  // red, and blocking every merge — as a check that "blocks nothing". That is
  // a fabricated verdict, which is precisely the class D3 exists to detect.
  const perCommit = {};
  for (const c of D3_COMMITS) perCommit[c.sha] = [['test', 'success'], ['deploy', 'failure']];

  const d3 = auditSilentlyRedChecks({
    gitHubRepo: 'Example/Repo',
    branch: 'main',
    consecutiveFailureThreshold: 3,
    commitLimit: 5,
    ghApi: makeFakeGh(d3Routes({ contexts: ['test'], rulesetContexts: ['deploy'], perCommit })),
  });

  assert.equal(d3.status, DETECTOR_STATUS.RAN);
  assert.deepEqual(d3.findings, [], 'the ruleset makes `deploy` required, so its failure already blocks the merge');
  assert.deepEqual(d3.inspected.requiredContexts, ['deploy', 'test']);
  assert.deepEqual(d3.inspected.requiredByBranchProtection, ['test']);
  assert.deepEqual(d3.inspected.requiredByRulesets, ['deploy']);
  assert.deepEqual(d3.inspected.rulesetsWithRequiredChecks, ['7']);
});

test('D3 positive: a check required by NEITHER surface is still reported when rulesets are readable', () => {
  const perCommit = {};
  for (const c of D3_COMMITS) perCommit[c.sha] = [['test', 'success'], ['deploy', 'failure']];

  const d3 = auditSilentlyRedChecks({
    gitHubRepo: 'Example/Repo',
    branch: 'main',
    consecutiveFailureThreshold: 3,
    commitLimit: 5,
    ghApi: makeFakeGh(d3Routes({ contexts: ['test'], rulesetContexts: ['CodeQL'], perCommit })),
  });

  assert.equal(d3.status, DETECTOR_STATUS.RAN);
  assert.equal(d3.findings.length, 1);
  assert.match(d3.findings[0].location, /"deploy"/);
  assert.match(d3.findings[0].actually, /required by NEITHER classic branch protection NOR any repository ruleset/);
  assert.match(d3.findings[0].evidence, /required by ruleset\(s\) 7 = \[CodeQL\]/);
});

test('D3 reports PARTIAL, naming the unread surface, when the rulesets endpoint fails', () => {
  const perCommit = {};
  for (const c of D3_COMMITS) perCommit[c.sha] = [['test', 'success'], ['deploy', 'failure']];
  const err = new Error('HTTP 403');
  err.stderr = 'gh: Resource not accessible by integration';

  const d3 = auditSilentlyRedChecks({
    gitHubRepo: 'Example/Repo',
    branch: 'main',
    consecutiveFailureThreshold: 3,
    commitLimit: 5,
    ghApi: makeFakeGh(d3Routes({ contexts: ['test'], rulesetError: err, perCommit })),
  });

  // It still reports what it CAN see, but never claims the surface was whole.
  assert.equal(d3.status, DETECTOR_STATUS.PARTIAL);
  assert.match(d3.reason, /ruleset-required contexts could NOT be read/);
  assert.match(d3.reason, /misreported below as blocking nothing/);
  assert.equal(d3.inspected.requiredByRulesets, '(NOT READ)');
  assert.ok(d3.notInspected.some((n) => n.includes('rules/branches/main')));
  assert.equal(d3.findings.length, 1, 'the finding is still surfaced, flagged as resting on a partial surface');
});

// ---------------------------------------------------------------------------
// gh binary resolution — the reader must not depend on $PATH
// ---------------------------------------------------------------------------

test('resolveGhBinary only ever returns an absolute path from the fixed candidate list', () => {
  for (const candidate of GH_BINARY_CANDIDATES) {
    assert.ok(path.isAbsolute(candidate), `${candidate} must be absolute`);
    assert.equal(path.basename(candidate), 'gh');
  }
  const resolved = resolveGhBinary();
  if (resolved !== null) {
    assert.ok(GH_BINARY_CANDIDATES.includes(resolved));
    assert.ok(path.isAbsolute(resolved));
  }
  // A candidate list that resolves to nothing must return null, never a bare
  // name that the OS would then look up through an attacker-writable $PATH.
  assert.equal(resolveGhBinary(['/nonexistent/definitely/not/here/gh']), null);
});

test('makeGhApiReader throws a NAMED error when gh is absent, so D3 renders UNAVAILABLE', () => {
  // The failure mode being guarded: a reader that quietly returned empty data
  // would make D3 report a surface it never read as clean.
  const reader = makeGhApiReader(null);
  assert.throws(() => reader('repos/x/y'), (err) => {
    assert.equal(err.code, 'ENOENT');
    assert.match(err.message, /`gh` CLI was not found in any fixed install location/);
    return true;
  });

  const d3 = auditSilentlyRedChecks({
    gitHubRepo: 'Example/Repo',
    branch: 'main',
    consecutiveFailureThreshold: 3,
    commitLimit: 5,
    ghApi: reader,
  });
  assert.equal(d3.status, DETECTOR_STATUS.UNAVAILABLE);
  assert.match(d3.reason, /`gh` CLI could not be executed/);
  assert.deepEqual(d3.findings, []);
});

// ---------------------------------------------------------------------------
// D4 — analysis blindspots
// ---------------------------------------------------------------------------

function bigJs(lines) {
  return Array.from({ length: lines }, (_, i) => `const v${i} = ${i};`).join('\n');
}

test('D4 positive: a path excluded from BOTH lists is reported high with its real line count', () => {
  // Modelled on commit 0943e9b9, which added four Future AGI scripts to
  // sonar.exclusions AND sonar.coverage.exclusions before the cause was known.
  const root = makeFixtureRepo({
    'sonar-project.properties': [
      'sonar.sources=src,scripts',
      'sonar.exclusions=scripts/future-agi-evaluator.js,**/node_modules/**',
      'sonar.coverage.exclusions=scripts/future-agi-evaluator.js',
    ].join('\n'),
    'scripts/future-agi-evaluator.js': bigJs(200),
    'src/app.js': bigJs(10),
  });

  const d4 = auditAnalysisBlindspots({ repoRoot: root, excludedLineThreshold: 50 });

  assert.equal(d4.status, DETECTOR_STATUS.RAN);
  assert.equal(d4.findings.length, 1);
  assert.equal(d4.findings[0].severity, SEVERITY.HIGH);
  assert.equal(d4.findings[0].rule, 'D4.hidden-from-both');
  assert.match(d4.findings[0].evidence, /matches 1 file\(s\)/);
  assert.match(d4.findings[0].evidence, /totalling 200 non-blank line\(s\)/);
});

test('D4 positive: a path excluded from only one list is reported medium', () => {
  const root = makeFixtureRepo({
    'sonar-project.properties': [
      'sonar.sources=scripts',
      'sonar.exclusions=',
      'sonar.coverage.exclusions=scripts/big.js',
    ].join('\n'),
    'scripts/big.js': bigJs(120),
  });

  const d4 = auditAnalysisBlindspots({ repoRoot: root, excludedLineThreshold: 50 });
  assert.equal(d4.findings.length, 1);
  assert.equal(d4.findings[0].severity, SEVERITY.MEDIUM);
  assert.equal(d4.findings[0].rule, 'D4.hidden-from-one');
});

test('D4 negative: exclusions that hide nothing inside sonar.sources are not findings', () => {
  const root = makeFixtureRepo({
    'sonar-project.properties': [
      'sonar.sources=src',
      'sonar.exclusions=**/node_modules/**,**/coverage/**,public/**,scripts/tiny.js',
      'sonar.coverage.exclusions=**/node_modules/**',
    ].join('\n'),
    'src/app.js': bigJs(300),
    'scripts/tiny.js': bigJs(4),
    'public/page.js': bigJs(900),
  });

  const d4 = auditAnalysisBlindspots({ repoRoot: root, excludedLineThreshold: 50 });
  assert.equal(d4.status, DETECTOR_STATUS.RAN);
  assert.deepEqual(d4.findings, [], 'excluding paths outside sonar.sources hides no analyzed code');
  assert.equal(d4.inspected.analyzedFiles, 1);
});

test('D4 negative: an exclusion below the line threshold is not a finding', () => {
  const root = makeFixtureRepo({
    'sonar-project.properties': [
      'sonar.sources=src',
      'sonar.exclusions=src/small.js',
      'sonar.coverage.exclusions=src/small.js',
    ].join('\n'),
    'src/small.js': bigJs(10),
    'src/app.js': bigJs(10),
  });

  const d4 = auditAnalysisBlindspots({ repoRoot: root, excludedLineThreshold: 50 });
  assert.deepEqual(d4.findings, []);
});

test('D4 reports UNAVAILABLE when sonar-project.properties is missing', () => {
  const root = makeFixtureRepo({ 'src/app.js': bigJs(10) });
  const d4 = auditAnalysisBlindspots({ repoRoot: root, excludedLineThreshold: 50 });

  assert.equal(d4.status, DETECTOR_STATUS.UNAVAILABLE);
  assert.match(d4.reason, /not found/);
  assert.deepEqual(d4.findings, []);
});

// ---------------------------------------------------------------------------
// D5 — zero production call sites
// ---------------------------------------------------------------------------

test('D5 positive: in an UNPUBLISHED package, a module the entry re-exports but nothing requires is dead (the HermesPlatformProtocol case)', () => {
  const root = makeFixtureRepo({
    'package.json': JSON.stringify({ name: 'fx', main: 'src/index.js' }),
    'src/index.js': [
      "'use strict';",
      "const { DeadClass, evaluateThreat } = require('./dead-module');",
      'module.exports = Object.assign({}, {}, { DeadClass, evaluateThreat });',
    ].join('\n'),
    'src/dead-module.js': [
      "'use strict';",
      'class DeadClass {}',
      'function evaluateThreat() { return null; }',
      'module.exports = { DeadClass, evaluateThreat };',
    ].join('\n'),
    'scripts/unrelated.js': "'use strict';\nmodule.exports = {};\n",
  });

  const d5 = auditZeroCallSites({
    repoRoot: root,
    entryFile: 'src/index.js',
    productionRoots: ['src', 'scripts'],
    publicApi: false, // nothing is published, so "no caller here" == "no caller"
  });

  assert.equal(d5.status, DETECTOR_STATUS.RAN);
  assert.equal(findingsWithRule(d5, 'D5.module-unused').length, 1);
  assert.equal(findingsWithRule(d5, 'D5.module-unused')[0].location, 'src/dead-module.js');
  // Both re-exported symbols are uncalled; the defining module must not count
  // as a call site, which is exactly how evaluateThreat stayed invisible.
  const uncalled = findingsWithRule(d5, 'D5.export-uncalled').map((f) => f.location);
  assert.equal(uncalled.length, 2);
  assert.ok(uncalled.some((l) => l.includes('DeadClass')));
  assert.ok(uncalled.some((l) => l.includes('evaluateThreat')));
});

test('D5 negative: a module with a real production consumer is not flagged', () => {
  const root = makeFixtureRepo({
    'package.json': JSON.stringify({ name: 'fx', main: 'src/index.js' }),
    'src/index.js': [
      "'use strict';",
      "const { LiveClass } = require('./live-module');",
      'module.exports = { LiveClass };',
    ].join('\n'),
    'src/live-module.js': "'use strict';\nclass LiveClass {}\nmodule.exports = { LiveClass };\n",
    'scripts/consumer.js': [
      "'use strict';",
      "const { LiveClass } = require('../src/live-module');",
      'module.exports = () => new LiveClass();',
    ].join('\n'),
  });

  const d5 = auditZeroCallSites({
    repoRoot: root,
    entryFile: 'src/index.js',
    productionRoots: ['src', 'scripts'],
  });

  assert.equal(d5.status, DETECTOR_STATUS.RAN);
  assert.deepEqual(d5.findings, []);
});

test('D5 negative: a symbol mentioned only in a COMMENT is still reported uncalled', () => {
  // The auditor's own header names the dead symbols it detects. Without comment
  // stripping it counted its own documentation as a call site.
  const root = makeFixtureRepo({
    'package.json': JSON.stringify({ name: 'fx', main: 'src/index.js' }),
    'src/index.js': [
      "'use strict';",
      "const { GhostClass } = require('./ghost');",
      'module.exports = { GhostClass };',
    ].join('\n'),
    'src/ghost.js': "'use strict';\nclass GhostClass {}\nmodule.exports = { GhostClass };\n",
    'scripts/docs.js': "'use strict';\n// TODO: wire GhostClass into the pipeline one day\nmodule.exports = {};\n",
  });

  const d5 = auditZeroCallSites({
    repoRoot: root,
    entryFile: 'src/index.js',
    productionRoots: ['src', 'scripts'],
  });

  assert.equal(findingsWithRule(d5, 'D5.export-uncalled').length, 1);
});

test('D5 reports UNAVAILABLE when the package entry does not exist', () => {
  const root = makeFixtureRepo({ 'scripts/a.js': 'module.exports = {};\n' });
  const d5 = auditZeroCallSites({ repoRoot: root, entryFile: 'src/index.js', productionRoots: ['scripts'] });

  assert.equal(d5.status, DETECTOR_STATUS.UNAVAILABLE);
  assert.match(d5.reason, /not found/);
  assert.deepEqual(d5.findings, []);
});

/** The published-package fixture used by the public-API tests below. */
function publishedPackageFixture() {
  return makeFixtureRepo({
    'package.json': JSON.stringify({ name: 'fx-published', main: 'src/index.js' }),
    'src/index.js': [
      "'use strict';",
      "const { PublicClass, publicFn } = require('./public-module');",
      'module.exports = Object.assign({}, {}, { PublicClass, publicFn });',
    ].join('\n'),
    'src/public-module.js': [
      "'use strict';",
      'class PublicClass {}',
      'function publicFn() { return null; }',
      'module.exports = { PublicClass, publicFn };',
    ].join('\n'),
    'scripts/unrelated.js': "'use strict';\nmodule.exports = {};\n",
  });
}

test('D5 does NOT call a published entry export dead — it reports it NOT INSPECTED and drops to PARTIAL', () => {
  // The defect this guards against: for a package on npm, the entry exports ARE
  // the public API and their callers are downstream consumers that no local
  // corpus can contain. "No internal reference" is not the same fact as "dead",
  // and emitting it as a finding would be an invented verdict — the same class
  // of dishonesty every other detector in this file exists to catch.
  const root = publishedPackageFixture();

  const d5 = auditZeroCallSites({
    repoRoot: root,
    entryFile: 'src/index.js',
    productionRoots: ['src', 'scripts'],
    publicApi: true,
    packageName: 'fx-published',
  });

  assert.deepEqual(d5.findings, [], 'no fabricated dead-code verdict against the public API');
  assert.equal(d5.status, DETECTOR_STATUS.PARTIAL, 'and it is NOT reported clean either');
  assert.match(d5.reason, /downstream npm consumers are outside every corpus/);
  assert.match(d5.reason, /reported neither dead NOR clean/);
  assert.equal(d5.inspected.publishedPackage, 'fx-published');
  assert.equal(d5.inspected.publicApiNotAnalyzable, 3);

  // The module AND both exports are named, so a reader can see exactly what
  // went uninspected rather than inferring it from a silence.
  const gaps = d5.notInspected.join('\n');
  assert.match(gaps, /src\/public-module\.js — re-exported by src\/index\.js/);
  assert.match(gaps, /export "PublicClass"/);
  assert.match(gaps, /export "publicFn"/);
  for (const gap of d5.notInspected) assert.match(gap, /fx-published/);
});

test('D5 renders the published-API gap in the PARTIAL COVERAGE block, not as a clean bill of health', () => {
  const root = publishedPackageFixture();
  const report = auditGovernanceConflicts({ repoRoot: root, offline: true, gitHubRepo: null });
  const text = renderConflictAuditText(report);

  assert.equal(report.detectors.D5.status, DETECTOR_STATUS.PARTIAL);
  assert.match(text, /PARTIAL — some of the surface was NOT checked/);
  assert.match(text, /!\s+PARTIAL COVERAGE/);
  assert.ok(
    !/D5\s+Zero production call sites\n\s+RAN — CLEAN/.test(text),
    'a surface that could not be inspected must never render as CLEAN',
  );
});

test('D5 still reports a module the entry pulls in WITHOUT re-exporting, even in a published package', () => {
  // Requiring a module for a side effect and never exporting anything from it
  // leaves no public entry point, so "no caller" IS provable here.
  const root = makeFixtureRepo({
    'package.json': JSON.stringify({ name: 'fx-published', main: 'src/index.js' }),
    'src/index.js': [
      "'use strict';",
      "const { PublicClass } = require('./public-module');",
      "const internalOnly = require('./internal-module');",
      'module.exports = { PublicClass };',
    ].join('\n'),
    'src/public-module.js': "'use strict';\nclass PublicClass {}\nmodule.exports = { PublicClass };\n",
    'src/internal-module.js': "'use strict';\nmodule.exports = { helper() { return 1; } };\n",
    'scripts/unrelated.js': "'use strict';\nmodule.exports = {};\n",
  });

  const d5 = auditZeroCallSites({
    repoRoot: root,
    entryFile: 'src/index.js',
    productionRoots: ['src', 'scripts'],
    publicApi: true,
    packageName: 'fx-published',
  });

  const unused = findingsWithRule(d5, 'D5.module-unused').map((f) => f.location);
  assert.deepEqual(unused, ['src/internal-module.js']);
  assert.ok(!unused.includes('src/public-module.js'), 'the re-exported module is public API, not dead');
});

test('parseEntryBindings maps destructured and default require bindings to their specifier', () => {
  const bindings = parseEntryBindings([
    "const { A, B: renamed } = require('./one');",
    "const Whole = require('./two');",
    "const external = require('lodash');",
  ].join('\n'));

  assert.deepEqual(bindings, [
    { specifier: './one', names: ['A', 'renamed'] },
    { specifier: './two', names: ['Whole'] },
    { specifier: 'lodash', names: ['external'] },
  ]);
});

test('extractEntryExportStatement returns the whole assignment, or empty when there is none', () => {
  const src = "const a = 1;\nmodule.exports = Object.assign({}, base, {\n  A,\n});\nconst after = 2;";
  const statement = extractEntryExportStatement(src);
  assert.match(statement, /^module\.exports = Object\.assign/);
  assert.ok(statement.includes('A,'));
  assert.ok(!statement.includes('const after'));
  assert.equal(extractEntryExportStatement('const a = 1;\n'), '');
});

// ---------------------------------------------------------------------------
// D6 — main-check broken under symlink
// ---------------------------------------------------------------------------

const BARE_FORM = 'if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) { run(); }';

test('D6 positive: the bare form in a package.json#bin target is high severity', () => {
  const root = makeFixtureRepo({
    'package.json': JSON.stringify({ name: 'fx', bin: { fx: 'bin/fx.js' } }),
    'bin/fx.js': `'use strict';\nconst path = require('path');\nfunction run() {}\n${BARE_FORM}\n`,
  });

  const d6 = auditMainCheckUnderSymlink({
    repoRoot: root,
    productionRoots: ['bin'],
    binTargets: ['bin/fx.js'],
  });

  assert.equal(d6.status, DETECTOR_STATUS.RAN);
  assert.equal(d6.findings.length, 1);
  assert.equal(d6.findings[0].severity, SEVERITY.HIGH);
  assert.equal(d6.findings[0].rule, 'D6.bin-target');
  assert.equal(d6.inspected.binTargetsAffected, 1);
});

test('D6 positive: the bare form in a non-bin file is low severity, not a false alarm', () => {
  const root = makeFixtureRepo({
    'package.json': JSON.stringify({ name: 'fx', bin: { fx: 'bin/fx.js' } }),
    'bin/fx.js': "'use strict';\nmodule.exports = {};\n",
    'scripts/helper.js': `'use strict';\nconst path = require('path');\nfunction run() {}\n${BARE_FORM}\n`,
  });

  const d6 = auditMainCheckUnderSymlink({
    repoRoot: root,
    productionRoots: ['bin', 'scripts'],
    binTargets: ['bin/fx.js'],
  });

  assert.equal(d6.findings.length, 1);
  assert.equal(d6.findings[0].severity, SEVERITY.LOW);
  assert.equal(d6.findings[0].rule, 'D6.not-bin-target');
  assert.equal(d6.inspected.binTargetsAffected, 0);
  assert.equal(d6.inspected.nonBinFilesAffected, 1);
});

test('D6 negative: a realpathSync-hardened main check is not flagged', () => {
  const root = makeFixtureRepo({
    'package.json': JSON.stringify({ name: 'fx', bin: { fx: 'bin/fx.js' } }),
    'bin/fx.js': [
      "'use strict';",
      "const fs = require('fs');",
      "const path = require('path');",
      'function run() {}',
      'if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename)) { run(); }',
    ].join('\n'),
  });

  const d6 = auditMainCheckUnderSymlink({ repoRoot: root, productionRoots: ['bin'], binTargets: ['bin/fx.js'] });
  assert.equal(d6.status, DETECTOR_STATUS.RAN);
  assert.deepEqual(d6.findings, []);
});

test('D6 negative: a commented-out bare form enforces nothing and is not flagged', () => {
  const root = makeFixtureRepo({
    'package.json': JSON.stringify({ name: 'fx', bin: {} }),
    'scripts/helper.js': `'use strict';\n// legacy: ${BARE_FORM}\nmodule.exports = {};\n`,
  });

  const d6 = auditMainCheckUnderSymlink({ repoRoot: root, productionRoots: ['scripts'], binTargets: [] });
  assert.deepEqual(d6.findings, []);
});

test('D6 negative: the bare form quoted inside a help STRING is documentation, not code', () => {
  // Found by running this auditor against its own repo: bin/cli.js's only
  // occurrence of the bare form is inside the conflict-audit --help text, and
  // the detector reported that string as a live high-severity bin defect.
  const root = makeFixtureRepo({
    'package.json': JSON.stringify({ name: 'fx', bin: { fx: 'bin/fx.js' } }),
    'bin/fx.js': [
      "'use strict';",
      "const HELP = 'D6 detects the bare `path.resolve(process.argv[1]) === path.resolve(__filename)` main check';",
      'module.exports = { HELP };',
    ].join('\n'),
  });

  const d6 = auditMainCheckUnderSymlink({ repoRoot: root, productionRoots: ['bin'], binTargets: ['bin/fx.js'] });
  assert.deepEqual(d6.findings, [], 'a quoted main check enforces nothing and must not be reported');
});

test('stripComments({ stripStrings: true }) blanks string bodies but keeps surrounding code', () => {
  const out = stripComments('const HELP = "argv[1] talk"; const real = 1;', { stripStrings: true });
  assert.ok(!out.includes('argv[1] talk'));
  assert.ok(out.includes('const HELP ='));
  assert.ok(out.includes('const real = 1;'));
});

// ---------------------------------------------------------------------------
// CLEAN vs UNAVAILABLE — the output-contract guarantee
// ---------------------------------------------------------------------------

test('a CLEAN detector and an UNAVAILABLE detector render visibly differently', () => {
  const root = makeFixtureRepo({
    // D1/D2 clean.
    'config/gates/default.json': gatesConfig([{ id: 'ok', toolNames: ['Bash'], pattern: 'rm\\s+-rf' }]),
    // D4 clean.
    'sonar-project.properties': 'sonar.sources=src\nsonar.exclusions=\nsonar.coverage.exclusions=\n',
    'package.json': JSON.stringify({ name: 'fx', main: 'src/index.js', bin: {} }),
    'src/index.js': "'use strict';\nmodule.exports = {};\n",
  });

  // D3 is UNAVAILABLE because no ghApi is supplied.
  const report = auditGovernanceConflicts({ repoRoot: root, gitHubRepo: null, ghApi: null });
  const text = renderConflictAuditText(report);

  assert.equal(report.detectors.D1.status, DETECTOR_STATUS.RAN);
  assert.deepEqual(report.detectors.D1.findings, []);
  assert.equal(report.detectors.D3.status, DETECTOR_STATUS.UNAVAILABLE);

  // The two must not read the same. "clean" states it was checked;
  // "unavailable" states it was NOT, and says so loudly.
  assert.match(text, /D1  Inert-or-overmatching gate shape\n\s+RAN — CLEAN \(checked, nothing found\)/);
  assert.match(text, /D3  Silently-red non-required check\n\s+UNAVAILABLE — NOT CHECKED/);
  assert.match(text, /COVERAGE GAP/);
  assert.match(text, /Their surfaces are NOT reported clean/);
  assert.ok(!/D3.*CLEAN/.test(text), 'an unavailable detector must never be described as clean');
});

test('a fully clean report still names its coverage honestly', () => {
  const root = makeFixtureRepo({
    'config/gates/default.json': gatesConfig([{ id: 'ok', toolNames: ['Bash'], pattern: 'rm' }]),
    'sonar-project.properties': 'sonar.sources=src\nsonar.exclusions=\nsonar.coverage.exclusions=\n',
    'package.json': JSON.stringify({ name: 'fx', main: 'src/index.js', bin: {} }),
    'src/index.js': "'use strict';\nmodule.exports = {};\n",
  });

  const report = auditGovernanceConflicts({ repoRoot: root, gitHubRepo: null, ghApi: null });
  const text = renderConflictAuditText(report);

  assert.equal(report.counts.findings, 0);
  assert.equal(report.counts.detectorsUnavailable, 1);
  // Zero findings must NOT be summarised as "everything checked out".
  assert.match(text, /5 of 6 detector\(s\) ran over their full surface/);
});

test('every finding carries a severity backed by a documented rule', () => {
  const root = makeFixtureRepo({
    'config/gates/default.json': gatesConfig([
      { id: 'plural', toolNames: ['Bash'], patterns: ['x'] },
      { id: 'badregex', toolNames: ['Bash'], pattern: '(?i)x' },
    ]),
    'sonar-project.properties': 'sonar.sources=src\nsonar.exclusions=src/big.js\nsonar.coverage.exclusions=src/big.js\n',
    'src/big.js': bigJs(300),
    'package.json': JSON.stringify({ name: 'fx', main: 'src/index.js', bin: { fx: 'bin/fx.js' } }),
    'src/index.js': "'use strict';\nconst { A } = require('./mod');\nmodule.exports = { A };\n",
    'src/mod.js': "'use strict';\nconst A = 1;\nmodule.exports = { A };\n",
    'bin/fx.js': `'use strict';\nconst path = require('path');\nfunction run() {}\n${BARE_FORM}\n`,
  });

  const report = auditGovernanceConflicts({ repoRoot: root, gitHubRepo: null, ghApi: null });

  assert.ok(report.findings.length > 0);
  for (const f of report.findings) {
    assert.ok(SEVERITY_RULES[f.rule], `severity rule "${f.rule}" must be documented`);
    assert.ok(f.appears && f.actually && f.evidence, 'every finding states appears / actually / evidence');
    assert.match(f.detector, /^D[1-6]$/);
  }
  // Findings are ordered worst-first.
  const ranks = report.findings.map((f) => ['critical', 'high', 'medium', 'low'].indexOf(f.severity));
  assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b));
});

test('thresholds are honoured and surfaced in the report', () => {
  const root = makeFixtureRepo({
    'sonar-project.properties': 'sonar.sources=src\nsonar.exclusions=src/mid.js\nsonar.coverage.exclusions=\n',
    'src/mid.js': bigJs(100),
    'package.json': JSON.stringify({ name: 'fx', main: 'src/index.js', bin: {} }),
    'src/index.js': "'use strict';\nmodule.exports = {};\n",
  });

  const strict = auditGovernanceConflicts({ repoRoot: root, gitHubRepo: null, ghApi: null, excludedLineThreshold: 50 });
  const lax = auditGovernanceConflicts({ repoRoot: root, gitHubRepo: null, ghApi: null, excludedLineThreshold: 500 });

  assert.equal(strict.detectors.D4.findings.length, 1);
  assert.equal(lax.detectors.D4.findings.length, 0);
  assert.equal(strict.thresholds.excludedLineThreshold, 50);
  assert.equal(lax.thresholds.excludedLineThreshold, 500);
});

// ---------------------------------------------------------------------------
// Helper units — each one had a real bug during development
// ---------------------------------------------------------------------------

test('globToRegExp distinguishes * from ** and anchors the whole path', () => {
  assert.ok(globToRegExp('scripts/*.js').test('scripts/a.js'));
  assert.ok(!globToRegExp('scripts/*.js').test('scripts/nested/a.js'));
  assert.ok(globToRegExp('scripts/**').test('scripts/nested/deep/a.js'));
  assert.ok(globToRegExp('**/*.test.js').test('tests/a.test.js'));
  assert.ok(globToRegExp('**/*.test.js').test('a.test.js'));
  assert.ok(globToRegExp('scripts/self-heal*.js').test('scripts/self-healing-check.js'));
  assert.ok(!globToRegExp('bin/cli.js').test('bin/cli.js.map'));
});

test('parseProperties ignores comments and keeps values containing "="', () => {
  const props = parseProperties('# c\nsonar.sources=src,scripts\n\n!bang\nk=a=b\n');
  assert.equal(props.get('sonar.sources'), 'src,scripts');
  assert.equal(props.get('k'), 'a=b');
  assert.equal(props.has('# c'), false);
});

test('parseEntryExportNames reads past the empty object in Object.assign({}, …)', () => {
  // The real src/index.js uses this shape. A scanner that stopped at the first
  // `{` reported zero exports and silently skipped the whole D5b check.
  const names = parseEntryExportNames("module.exports = Object.assign({}, base, {\n  A,\n  B: b,\n});\n");
  assert.deepEqual(names, ['A', 'B']);
});

test('stripComments blanks comments without touching strings or regex literals', () => {
  const src = [
    'const url = "https://example.com/x"; // trailing comment mentioning Ghost',
    'const re = /https?:\\/\\/[a-z]+/;',
    '/* block mentioning Ghost */',
    'const real = Ghost;',
  ].join('\n');
  const out = stripComments(src);
  const lines = out.split('\n');

  assert.equal((out.match(/Ghost/g) || []).length, 1, 'only the real reference survives');
  // Exact-equality on the stripped line, never a substring probe. A
  // `.includes(<url>)` check here is what CodeQL's
  // js/incomplete-url-substring-sanitization flags: a substring test on an
  // unparsed URL proves nothing about what surrounds it. Equality proves the
  // whole line, which is what this test actually means to assert — the `//`
  // inside the string literal must NOT be mistaken for a comment start.
  assert.equal(lines[0].trimEnd(), 'const url = "https://example.com/x";', 'string literals are preserved intact');
  assert.equal(lines[1], 'const re = /https?:\\/\\/[a-z]+/;', 'regex literals are preserved intact');
  assert.equal(lines.length, src.split('\n').length, 'line count is preserved');
});

test('deriveGitHubRepo keeps dots in the repository name and strips only a terminal .git', () => {
  // A `[^\\s.]+` capture truncates `foo.bar.git` to `foo`, which then queries an
  // unrelated repository and reports D3 unavailable for the wrong reason.
  const cases = [
    ['https://github.com/acme/foo.bar.git', 'acme/foo.bar'],
    ['https://github.com/acme/foo.bar', 'acme/foo.bar'],
    ['git@github.com:acme/foo.bar.git', 'acme/foo.bar'],
    ['https://github.com/IgorGanapolsky/ThumbGate.git', 'IgorGanapolsky/ThumbGate'],
    ['https://github.com/acme/plain', 'acme/plain'],
  ];
  for (const [url, expected] of cases) {
    const root = makeFixtureRepo({
      '.git/config': `[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
    });
    assert.equal(deriveGitHubRepo(root), expected, url);
  }
});

test('countCodeLines ignores blank lines', () => {
  assert.equal(countCodeLines('a\n\n  \nb\n'), 2);
  assert.equal(countCodeLines(''), 0);
});
