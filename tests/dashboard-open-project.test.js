'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { dashboardProjectParam, resolveLocalProject } = require('../scripts/project-identity');

function repo(remote) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dash-open-')));
  cp.execFileSync('git', ['init', '-q'], { cwd: dir });
  if (remote) cp.execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  return dir;
}

test('REQ-01: a folder with no git remote opens the dashboard on all projects, not on that folder', () => {
  const dir = repo(null);
  try { assert.equal(dashboardProjectParam(dir), 'all'); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('REQ-02: a repo with a remote opens on its own project key, the same key the footer and capture use', () => {
  const dir = repo(['https:', '', 'github.com', 'example-org', 'example-repo.git'].join('/'));
  try {
    const key = dashboardProjectParam(dir);
    assert.match(key, /^repo_/);
    assert.equal(key, resolveLocalProject(dir).projectKey);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
