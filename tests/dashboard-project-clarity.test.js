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

test('project switcher anchors under the app nav, offers only real projects and uses a grid', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'project-switcher.js'), 'utf8');
  assert.match(source, /\.app-top-nav/);
  assert.match(source, /function isRealProject\(project\) \{ return \/\^repo_\/\.test/);
  assert.match(source, /grid-template-columns/);
  assert.doesNotMatch(source, /\(legacy\)|Unassigned \(before/);
});

test('the status line names the project and its folder, and the catalog reports the server project folder', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'project-switcher.js'), 'utf8');
  assert.match(source, /replace\(\/\^\\\/Users\\\/\[\^\/\]\+\/, '~'\)/);
  assert.match(source, /if \(data\.projectDir\) next\.searchParams\.set\('projectDir', data\.projectDir\)/);
});

test('dashboard states the scope of its headline feedback numbers', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  assert.match(html, /id="feedbackScopeNote"/);
  assert.match(html, /function renderFeedbackScope/);
  assert.match(html, /not counted/);
});

test('the project picker loads with the first stats render, not after the 10 second hydration timer', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  assert.match(html, /setSelectedCard\('all'\);\s*window\.ThumbGateProjects\.refresh\(getHeaders\(\)\);/);
});

test('a bare dashboard URL opens on a project and All projects is an explicit project=all choice', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'project-switcher.js'), 'utf8');
  assert.match(source, /var explicit = selected !== null;/);
  assert.match(source, /if \(!explicit\) \{/);
  assert.match(source, /window\.location\.replace\(next\.href\)/);
  assert.match(source, /next\.searchParams\.set\('project', select\.value \|\| 'all'\)/);
});

test('every dashboard section heading carries its tab name, with the descriptive name as a subtitle', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  const tabs = [...html.matchAll(/switchTab\('([\w-]+)'\)">[^<]*?([A-Za-z][A-Za-z ]+)<\/div>/g)];
  const expected = { gates: 'Active Gates', team: 'Team', 'ai-inventory': 'AI Inventory', generated: 'Generated Views', templates: 'Gate Templates', insights: 'Insights', export: 'Export' };
  for (const [id, name] of Object.entries(expected)) {
    assert.match(html, new RegExp(`id="tab-${id}"[\\s\\S]*?<h2>${name}</h2><p class="section-sub">`), `${id} heading`);
  }
  assert.ok(tabs.length >= 7);
  assert.match(html, /\.tab-content\{scroll-margin-top:\d+px\}/);
});

test('the picker placeholder names the project folder instead of saying "Selected project"', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'project-switcher.js'), 'utf8');
  assert.doesNotMatch(source, /textContent = 'Selected project'/);
  assert.match(source, /selectedDir \? selectedDir\.split\('\/'\)\.filter\(Boolean\)\.pop\(\) : 'Loading project/);
});
