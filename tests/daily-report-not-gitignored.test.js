'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github/workflows/daily-revenue-loop.yml');

test('daily-revenue-loop workflow writes reports OUTSIDE the .thumbgate/ gitignored directory', () => {
  // History (2026-05-12): workflow wrote to .thumbgate/daily-reports/ for 5+ days.
  // .thumbgate/ is in .gitignore. `git add` was silently filtered. Workflow ran
  // green but produced zero persisted reports.
  const wf = fs.readFileSync(WORKFLOW, 'utf8');
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
  const checkPath = 'reports/daily/2099-01-01.md'; // pure pattern test, file need not exist
  let exit;
  try {
    execFileSync('git', ['check-ignore', '-q', checkPath], { cwd: ROOT, stdio: 'pipe' });
    exit = 0;
  } catch (err) {
    exit = err.status;
  }
  assert.equal(exit, 1, `reports/daily/ path must not be gitignored (got check-ignore exit ${exit})`);
});
