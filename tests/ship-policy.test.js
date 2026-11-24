'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  REVIEW_MARKER,
  addedLines,
  evaluatePr,
  globToRegExp,
  loadPolicy,
  matchesAny,
  renderReview,
  selectTests,
  summarizeChecks,
} = require('../scripts/ship-policy');

const policy = loadPolicy();
const routinePr = { author: 'IgorGanapolsky', headRef: 'claude/fix-thing', base: 'main', isDraft: false, labels: [] };
const file = (filename, extra = {}) => ({ filename, additions: 5, deletions: 1, status: 'modified', patch: '@@ -1,1 +1,2 @@\n line\n+added', ...extra });

test('globs: ** spans directories, * stays inside one', () => {
  assert.ok(globToRegExp('.github/workflows/**').test('.github/workflows/ci.yml'));
  assert.ok(globToRegExp('src/**/*stripe*').test('src/api/stripe-webhook.js'));
  assert.ok(globToRegExp('src/**/*stripe*').test('src/stripe.js'));
  assert.ok(!globToRegExp('scripts/*stripe*').test('scripts/sub/stripe.js'));
  assert.ok(matchesAny('README.md', ['**/*.md']));
});

test('routine agent PR with code and tests is auto', () => {
  const r = evaluatePr(routinePr, [file('scripts/foo.js'), file('tests/foo.test.js')], policy);
  assert.equal(r.verdict, 'auto', r.reasons.join('; '));
  assert.deepEqual(r.warnings, []);
});

test('sensitive paths, size, unknown author, fork and odd branch each need Igor', () => {
  const cases = [
    [routinePr, [file('.github/workflows/ci.yml')], /Igor reviews/],
    [routinePr, [file('scripts/stripe-sync.js')], /Igor reviews/],
    [routinePr, [file('config/ship-policy.json')], /Igor reviews/],
    [routinePr, [file('scripts/a.js', { additions: 900 })], /changed lines/],
    [{ ...routinePr, author: 'someone' }, [file('docs/a.md')], /not on the auto-merge list/],
    [{ ...routinePr, isCrossRepository: true }, [file('docs/a.md')], /fork/],
    [{ ...routinePr, headRef: 'random-branch' }, [file('docs/a.md')], /routine prefix/],
    [{ ...routinePr, base: 'release' }, [file('docs/a.md')], /Targets/],
    [routinePr, [file('tests/old.test.js', { status: 'removed' })], /Deletes tests/],
  ];
  for (const [pr, files, re] of cases) {
    const r = evaluatePr(pr, files, policy);
    assert.equal(r.verdict, 'human', `${files[0].filename} should need Igor`);
    assert.match(r.reasons.join(' '), re);
  }
});

test('automerge label lets an unprefixed branch through', () => {
  const r = evaluatePr({ ...routinePr, headRef: 'random', labels: [{ name: 'automerge' }] }, [file('docs/a.md')], policy);
  assert.equal(r.verdict, 'auto');
});

test("Igor's igor-review label always needs Igor; the gate's own needs-igor label is recomputed", () => {
  const r = evaluatePr({ ...routinePr, labels: ['igor-review'] }, [file('docs/a.md')], policy);
  assert.equal(r.verdict, 'human');
  assert.match(r.reasons.join(' '), /igor-review/);
  assert.equal(evaluatePr({ ...routinePr, labels: ['needs-igor'] }, [file('docs/a.md')], policy).verdict, 'auto');
});

test('drafts and do-not-merge are held', () => {
  assert.equal(evaluatePr({ ...routinePr, isDraft: true }, [file('docs/a.md')], policy).verdict, 'hold');
  assert.equal(evaluatePr({ ...routinePr, labels: ['do-not-merge'] }, [file('docs/a.md')], policy).verdict, 'hold');
});

test('secrets and --no-verify in added lines block; owner approval cannot override a secret', () => {
  const secret = file('scripts/x.js', { patch: '@@ -1,0 +10,1 @@\n+const k = "AKIA' + 'ABCDEFGHIJKLMNOP";' });
  const r = evaluatePr({ ...routinePr, ownerApprovedHead: true }, [secret, file('tests/x.test.js')], policy);
  assert.equal(r.verdict, 'human');
  assert.match(r.reasons.join(' '), /AWS access key\. \(`scripts\/x\.js:10`\)/);

  const hook = file('scripts/y.js', { patch: '@@ -1,0 +1,1 @@\n+git commit --no' + '-verify' });
  assert.equal(evaluatePr(routinePr, [hook, file('tests/y.test.js')], policy).verdict, 'human');

  // Removed lines and markdown are not scanned.
  const removed = file('scripts/z.js', { patch: '@@ -1,1 +1,0 @@\n-git commit --no' + '-verify' });
  const doc = file('docs/z.md', { patch: '@@ -1,0 +1,1 @@\n+never use --no' + '-verify' });
  assert.equal(evaluatePr(routinePr, [removed, doc, file('tests/z.test.js')], policy).verdict, 'auto');
});

test('owner approval of the head commit turns a path-only "human" into auto', () => {
  const r = evaluatePr({ ...routinePr, ownerApprovedHead: true }, [file('.github/workflows/ci.yml')], policy);
  assert.equal(r.verdict, 'auto');
  assert.match(r.warnings[0], /Igor approved/);
});

test('warnings: code without tests, skipped test', () => {
  const r = evaluatePr(routinePr, [file('src/api/a.js')], policy);
  assert.equal(r.verdict, 'auto');
  assert.match(r.warnings.join(' '), /no test changed/);
  const skip = file('tests/q.test.js', { patch: '@@ -1,0 +1,1 @@\n+test.skip("x", () => {})' });
  assert.match(evaluatePr(routinePr, [skip], policy).warnings.join(' '), /skipped/);
});

test('dependabot: manifests are routine, anything else needs Igor', () => {
  const bot = { ...routinePr, author: 'dependabot[bot]', headRef: 'dependabot/npm/x' };
  assert.equal(evaluatePr(bot, [file('package.json'), file('package-lock.json')], policy).verdict, 'auto');
  assert.equal(evaluatePr(bot, [file('scripts/evil.js')], policy).verdict, 'human');
});

test('addedLines tracks new-file line numbers across hunks', () => {
  const lines = addedLines('@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d\n@@ -10,1 +20,1 @@\n+z');
  assert.deepEqual(lines, [{ line: 2, text: 'c' }, { line: 3, text: 'd' }, { line: 20, text: 'z' }]);
});

test('selectTests: fast guards plus tests matching changed files, capped', () => {
  const names = ['pr-manager.test.js', 'ship-policy.test.js', 'foo.test.js', 'foo-extra.test.js', 'food.test.js'];
  const out = selectTests(['scripts/foo.js', 'tests/pr-manager.test.js', 'README.md'], { ...policy, fastTests: ['tests/ship-policy.test.js'] }, {
    exists: () => true,
    listTests: () => names,
  });
  assert.deepEqual(out.sort(), ['tests/foo-extra.test.js', 'tests/foo.test.js', 'tests/pr-manager.test.js', 'tests/ship-policy.test.js']);
  // Tests that require or read the changed file are selected even when their name differs.
  const bodies = {
    'uses-foo.test.js': "const foo = require('../scripts/foo');",
    'reads-cfg.test.js': "path.join(__dirname, '..', 'config', 'ship-policy.json')",
    'unrelated.test.js': "require('../scripts/bar')",
  };
  const refs = selectTests(['scripts/foo.js', 'config/ship-policy.json'], { ...policy, fastTests: [] }, {
    exists: () => true,
    listTests: () => Object.keys(bodies),
    readTest: (n) => bodies[n],
  });
  assert.deepEqual(refs.sort(), ['tests/reads-cfg.test.js', 'tests/uses-foo.test.js']);
  // A test the PR adds is selected even though main does not have it yet.
  const added = selectTests(['tests/brand-new.test.js'], { ...policy, fastTests: [] }, { exists: () => false, listTests: () => [] });
  assert.deepEqual(added, ['tests/brand-new.test.js']);
  const capped = selectTests(['scripts/foo.js'], { ...policy, fastTests: [], maxSelectedTests: 1 }, { exists: () => true, listTests: () => names });
  assert.equal(capped.length, 1);
});

test('summarizeChecks ignores optional and self checks', () => {
  assert.equal(summarizeChecks([{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'Entire Gates', status: 'COMPLETED', conclusion: 'FAILURE' }, { name: 'merge', status: 'IN_PROGRESS' }], policy).state, 'green');
  assert.equal(summarizeChecks([{ name: 'pr-size', status: 'IN_PROGRESS' }], policy).state, 'pending');
  assert.deepEqual(summarizeChecks([{ name: 'GitGuardian Security Checks', status: 'COMPLETED', conclusion: 'FAILURE' }], policy).failing, ['GitGuardian Security Checks']);
  assert.equal(summarizeChecks([{ context: 'ext', state: 'PENDING' }], policy).state, 'pending');
  // A run cancelled by a newer run of the same check does not count against the PR.
  assert.equal(summarizeChecks([
    { name: 'test', status: 'COMPLETED', conclusion: 'CANCELLED', startedAt: '2026-11-24T18:36:12Z' },
    { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-11-24T18:36:30Z' },
  ], policy).state, 'green');
});

test('renderReview starts with the sticky marker and says what happens', () => {
  const r = evaluatePr(routinePr, [file('src/api/a.js')], policy);
  const body = renderReview(r, ['tests/a.test.js']);
  assert.ok(body.startsWith(REVIEW_MARKER));
  assert.match(body, /merge on its own/);
  assert.match(body, /tests\/a\.test\.js/);
});

test('ship-gate workflow reads policy from main and merges only the tested commit', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ship-gate.yml'), 'utf8');
  assert.match(wf, /ref: main/);
  assert.match(wf, /--match-head-commit "\$HEAD_SHA"/);
  assert.doesNotMatch(wf, /pull_request_target/);
  assert.doesNotMatch(wf, /--admin/);
  assert.doesNotMatch(wf, /APPROVE/, 'the gate must never approve a PR');
  assert.match(wf, /reviewThreads/);
  assert.match(wf, /pull_request_review:/, 'an approval must re-run the gate');
  assert.match(wf, /format\('-label-\{0\}', github\.run_id\)/, 'gate label churn must not cancel a run');
  assert.match(wf, /fromJSON\('\["do-not-merge","automerge","igor-review"\]'\)/, 'Igor control labels must not get the label-churn group');
  assert.match(wf, /GH_TOKEN="\$MERGE_TOKEN" gh pr merge/, 'only the merge uses the PAT');
  assert.doesNotMatch(wf, /GH_TOKEN:\s*\$\{\{\s*secrets\.GH_PAT/, 'labels and reads must not use the PAT');
  const sweeper = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pr-stale-sweeper.yml'), 'utf8');
  assert.match(wf, /needs\.test\.result == 'failure'/, 'red tests must label needs-fix right away');
  assert.match(sweeper, /prs="\$\(gh pr list [^\n]*--limit 1000/, 'steward re-dispatch must list every routine PR and fail loudly');
});
