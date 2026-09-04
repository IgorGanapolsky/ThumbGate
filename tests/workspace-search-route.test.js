'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  ROUTES,
  classifyQuery,
  normalizeRoute,
  buildWorkspaceSearchRouteReport,
  formatWorkspaceSearchRouteReport,
  detectRemoteEmbedGrant,
} = require('../scripts/workspace-search-route');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'workspace-search-route.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

test('normalizeRoute aliases map onto the five zg-style routes', () => {
  assert.equal(normalizeRoute('bm25'), 'fts');
  assert.equal(normalizeRoute('semantic'), 'vector');
  assert.equal(normalizeRoute('ripgrep'), 'rg');
  assert.equal(normalizeRoute('graphify'), 'graph');
  assert.equal(normalizeRoute('hybrid'), 'hybrid');
  assert.equal(normalizeRoute('nope'), null);
});

test('classifyQuery prefers rg for symbols and paths', () => {
  const c = classifyQuery('session-lease.js');
  assert.equal(c.route, 'rg');
  assert.ok(c.confidence >= 0.8);
});

test('classifyQuery prefers graph for architecture phrasing', () => {
  const c = classifyQuery('how does PreToolUse connect to gates-engine');
  assert.equal(c.route, 'graph');
});

test('classifyQuery defaults natural language to hybrid', () => {
  const c = classifyQuery('why did the agent force push after a failed deploy');
  assert.equal(c.route, 'hybrid');
});

test('ROUTES lists exactly the zg four plus graph', () => {
  assert.deepEqual([...ROUTES].sort(), ['fts', 'graph', 'hybrid', 'rg', 'vector'].sort());
});

test('remote embed grant is fail-closed by default', () => {
  assert.equal(detectRemoteEmbedGrant({}), false);
  assert.equal(detectRemoteEmbedGrant({ THUMBGATE_ALLOW_REMOTE_EMBED: '1' }), true);
});

test('report fails when force-remote without grant', () => {
  const report = buildWorkspaceSearchRouteReport({
    query: 'preferences restore',
    vector: true,
    'force-remote': true,
    env: {},
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'remote_embed_ungranted' || f.id === 'remote_embed_policy'));
  assert.match(formatWorkspaceSearchRouteReport(report), /Remote embed grant: no/);
});

test('explicit --rg overrides classifier', () => {
  const report = buildWorkspaceSearchRouteReport({
    query: 'how does architecture connect',
    rg: true,
  });
  assert.equal(report.route, 'rg');
  assert.equal(report.confidence, 1);
  assert.ok(report.reasons.some((r) => /explicit/.test(r)));
});

test('map-only report includes rail mapping and disclaimer', () => {
  const report = buildWorkspaceSearchRouteReport({
    query: 'lesson retrieval ranking',
    map: true,
  });
  assert.equal(report.name, 'thumbgate-workspace-search-route');
  assert.match(report.disclaimer, /Not affiliated/);
  assert.ok(report.routes.length === 5);
  assert.ok(report.rails.length >= 1);
  assert.equal(report.execution, undefined);
});

test('execute hybrid dry-run returns matchedBy provenance shape', () => {
  const report = buildWorkspaceSearchRouteReport({
    query: 'force push',
    hybrid: true,
    execute: true,
    limit: 3,
  });
  assert.ok(report.execution);
  assert.equal(report.execution.route, 'hybrid');
  assert.equal(report.execution.ok, true);
});

test('script CLI --json exits 0 for map-only hybrid', () => {
  const result = spawnSync(process.execPath, [
    SCRIPT,
    '--query=session lease claim',
    '--hybrid',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.route, 'hybrid');
});

test('thumbgate CLI workspace-search-route is wired', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'workspace-search-route',
    '--query=gates-engine.js',
    '--json',
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-workspace-search-route');
  assert.equal(payload.route, 'rg');
});

test('docs/code-search mentions the zg route map without claiming a zvec dependency', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'agents', 'code-search.md'), 'utf8');
  assert.match(doc, /workspace-search-route|--rg|--fts|--hybrid|zvec-grep FORMAT/i);
  assert.doesNotMatch(doc, /npm install -g @zvec\/zvec-grep/);
  assert.match(doc, /not a ThumbGate SKU|Not affiliated|do not install @zvec/i);
});
