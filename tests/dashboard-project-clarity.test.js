'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildProjectCatalog } = require('../scripts/project-catalog');
const { resolveLocalProject } = require('../scripts/project-identity');

test('catalog marks projects with nothing recorded as empty and keeps active ones', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-clarity-'));
  fs.writeFileSync(path.join(root, 'feedback-log.jsonl'), JSON.stringify({ id: 'a', timestamp: '2026-01-01T00:00:00Z', projectKey: 'alpha', projectName: 'alpha' }) + '\n');
  const { projects } = buildProjectCatalog(root, {});
  assert.ok(projects.length >= 1);
  for (const project of projects) {
    const total = Object.values(project.counts).reduce((sum, n) => sum + (n || 0), 0);
    assert.equal(project.empty, total === 0, project.projectName);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('a session rooted at the home folder is named as no project, not after the login', () => {
  const resolved = resolveLocalProject(fs.realpathSync(os.homedir()), { machineId: 'test-machine' });
  if (resolved.identitySource === 'local') assert.equal(resolved.projectName, 'Home folder (no project)');
  assert.match(resolved.projectKey, /^(repo|local|legacy)_[a-f0-9]{64}$|^unassigned$/);
});

test('project switcher anchors under the app nav, hides empty projects and uses a grid', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'project-switcher.js'), 'utf8');
  assert.match(source, /\.app-top-nav/);
  assert.match(source, /function hasActivity/);
  assert.match(source, /grid-template-columns/);
  assert.match(source, /with no recorded activity hidden/);
});

test('dashboard states the scope of its headline feedback numbers', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  assert.match(html, /id="feedbackScopeNote"/);
  assert.match(html, /function renderFeedbackScope/);
  assert.match(html, /not counted/);
});
