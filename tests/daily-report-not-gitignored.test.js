'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOWS_DIR = path.join(ROOT, '.github/workflows');

function workflow(name) {
  return fs.readFileSync(path.join(WORKFLOWS_DIR, name), 'utf8');
}

test('daily-revenue-loop workflow writes reports OUTSIDE the .thumbgate/ gitignored directory', () => {
  // History (2026-05-12): workflow wrote to .thumbgate/daily-reports/ for 5+ days.
  // .thumbgate/ is in .gitignore. `git add` was silently filtered. Workflow ran
  // green but produced zero persisted reports.
  const wf = workflow('daily-revenue-loop.yml');
  assert.doesNotMatch(
    wf,
    /\.thumbgate\/daily-reports/,
    'daily-revenue-loop must NOT write reports to .thumbgate/* — that path is gitignored'
  );
  assert.match(
    wf,
    /reports\/daily/,
    'daily-revenue-loop should commit reports under reports/daily/ — outside the gitignored runtime dir'
  );
});

test('reports/daily/ path is not gitignored', () => {
  // Use git check-ignore exit code: 0 = ignored, 1 = not ignored, other = error.
  const checkPath = 'reports/daily/2099-01-01.md';
  let exit;
  try {
    execFileSync('git', ['check-ignore', '-q', checkPath], { cwd: ROOT, stdio: 'pipe' });
    exit = 0;
  } catch (err) {
    exit = err.status;
  }
  assert.equal(exit, 1, `reports/daily/ path must not be gitignored (got check-ignore exit ${exit})`);
});

test('weekly-social-post workflow does NOT attempt to commit to .thumbgate/', () => {
  // Sister bug (2026-05-12): weekly-social-post.yml ran `git add .thumbgate/`
  // with a comment claiming "git-tracked state (not ignored)". That comment was
  // a lie — .thumbgate/ IS gitignored at line 25. Workflow shipped green for
  // 5+ weekly runs while silently dropping its commit. Removed the commit step
  // entirely; state is regenerable from external APIs each run.
  const wf = workflow('weekly-social-post.yml');
  // Strip YAML comments before pattern-matching so the regression note (which
  // explains the bug for future-readers, including the offending phrase) doesn't
  // false-positive the assertion.
  const activeYaml = wf
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
  assert.doesNotMatch(
    activeYaml,
    /git add \.thumbgate\//,
    'weekly-social-post must NOT actively run `git add .thumbgate/` — that path is gitignored'
  );
  assert.doesNotMatch(
    activeYaml,
    /\.thumbgate\/ which is git-tracked state \(not ignored\)/,
    "remove the lying claim that .thumbgate/ is tracked — it isn't"
  );
});

test('sentry-release workflow does NOT silently swallow failures with continue-on-error', () => {
  // Sister bug (2026-05-12): sentry-release.yml had `continue-on-error: true`
  // on the only meaningful step, so the workflow always finished green even
  // when SENTRY_AUTH_TOKEN was missing or release-creation failed. Combined
  // with the fact that no @sentry/* SDK is instrumented anywhere in the
  // runtime, the entire release pipeline was theater.
  const wf = workflow('sentry-release.yml');
  // Strip YAML comments before pattern-matching so the assertion only looks at
  // active config, not historical-context comments left as a paper trail.
  const activeYaml = wf
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
  assert.doesNotMatch(
    activeYaml,
    /^\s*continue-on-error:\s*true\s*$/m,
    'sentry-release must not have an ACTIVE `continue-on-error: true` — it makes failures invisible'
  );
});
