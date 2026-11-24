'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-monthly-report-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmp;
process.env.THUMBGATE_API_KEY = 'test-api-key';
process.env._TEST_API_KEYS_PATH = path.join(tmp, 'api-keys.json');

const { aggregate, renderPage } = require('../scripts/build-monthly-report');
const { startServer } = require('../src/api/server');

const ROOT = path.resolve(__dirname, '..');
const MONTH = '2026-11';
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'reports', `${MONTH}.data.json`), 'utf8'));
const pageHtml = fs.readFileSync(path.join(ROOT, 'public', 'reports', `${MONTH}.html`), 'utf8');

function writeJsonl(file, rows) {
  fs.writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

test('aggregate counts a fixture fleet by action type and keeps only counts', () => {
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  writeJsonl(path.join(home, 'gate-events-log.jsonl'), [
    { gateId: 'force-push', decision: 'deny', toolName: 'Bash', timestamp: '2026-11-03T10:00:00Z', message: 'SECRET-MESSAGE' },
    { gateId: 'force-push', decision: 'deny', toolName: 'Bash', timestamp: '2026-11-04T10:00:00Z' },
    { gateId: 'supply-chain-dep-add', decision: 'warn', toolName: 'Edit', timestamp: '2026-11-05T10:00:00Z' },
    { gateId: 'force-push', decision: 'deny', toolName: 'Bash', timestamp: '2026-10-31T23:59:59Z' },
    { gateId: 'force-push', decision: 'deny', toolName: 'Bash', timestamp: '2026-11-18T00:00:00Z' },
  ]);
  writeJsonl(path.join(home, 'audit-trail.jsonl'), [
    { source: 'gates-engine', toolName: 'Bash', decision: 'allow', timestamp: '2026-11-03T10:00:00Z', toolInput: { command: 'rm -rf ./build' } },
    { source: 'gates-engine', toolName: 'Bash', decision: 'deny', timestamp: '2026-11-03T11:00:00Z', toolInput: { command: 'git push --force origin main' } },
    { source: 'gates-engine', toolName: 'Edit', decision: 'allow', timestamp: '2026-11-03T12:00:00Z', toolInput: { file_path: '/secret/path' } },
    { source: 'gates-engine', toolName: 'capture_feedback', decision: 'allow', timestamp: '2026-11-03T12:00:00Z', toolInput: { context: 'rm -rf in prose' } },
    { source: 'tool-latency', toolName: 'Bash', decision: 'allow', timestamp: '2026-11-03T12:00:00Z' },
  ]);
  writeJsonl(path.join(home, 'agent-registry.jsonl'), [
    { id: 'a', registeredAt: '2026-11-02T00:00:00Z', project: 'private-project' },
    { id: 'b', registeredAt: '2026-11-17T23:00:00Z', project: 'private-project' },
    { id: 'c', registeredAt: '2026-11-18T01:00:00Z', project: 'private-project' },
  ]);

  const out = aggregate({ home, month: MONTH, through: '2026-11-17' });
  assert.equal(out.gateDecisions.total, 3);
  assert.equal(out.gateDecisions.denied, 2);
  assert.equal(out.gateDecisions.warned, 1);
  assert.deepEqual(out.gateDecisions.byActionType.find((r) => r.actionType === 'Force-push'), { actionType: 'Force-push', denied: 2, warned: 0, total: 2 });
  assert.equal(out.fleet.agentSessionsRegistered, 2);
  assert.equal(out.gateEngineEvaluations.agentActions.evaluated, 3);
  assert.equal(out.gateEngineEvaluations.thumbgateToolCalls.evaluated, 1);
  const byId = Object.fromEntries(out.shellCommandPatterns.patterns.map((p) => [p.id, p]));
  assert.equal(out.shellCommandPatterns.shellCommandsEvaluated, 2);
  assert.equal(byId['rm-rf'].allowed, 1);
  assert.equal(byId['git-force-push'].denied, 1);
  assert.equal(byId['sql-drop'].evaluated, 0);

  const text = JSON.stringify(out) + renderPage(out);
  assert.ok(!text.includes('SECRET-MESSAGE') && !text.includes('/secret/path') && !text.includes('private-project'));
});

test('committed page shows exactly the numbers in the committed data file', () => {
  const g = data.gateDecisions;
  const a = data.gateEngineEvaluations.agentActions;
  const fmt = (n) => Number(n).toLocaleString('en-US');
  assert.equal(pageHtml, renderPage(data), 'page must be regenerated with scripts/build-monthly-report.js');
  for (const n of [g.total, g.denied, g.warned, a.evaluated, a.allowed, data.fleet.agentSessionsRegistered]) {
    assert.ok(pageHtml.includes(fmt(n)), `page is missing ${n}`);
  }
  for (const row of g.byActionType) {
    assert.ok(pageHtml.includes(`<td>${row.actionType.replace(/&/g, '&amp;')}</td><td>${fmt(row.denied)}</td><td>${fmt(row.warned)}</td><td>${fmt(row.total)}</td>`));
  }
  assert.match(pageHtml, /data from our own fleet/);
});

test('page carries Article and Dataset JSON-LD and the homepage links to it', () => {
  const blocks = [...pageHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.deepEqual(blocks.map((b) => b['@type']).sort(), ['Article', 'Dataset']);
  assert.equal(blocks.find((b) => b['@type'] === 'Dataset').temporalCoverage, `${data.window.from}/${data.window.through}`);
  assert.match(fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8'), /href="\/reports\/2026-11"/);
});

test('server serves /reports/2026-11 and lists it in the sitemap', async () => {
  const handle = await startServer({ port: 0 });
  const origin = `http://127.0.0.1:${handle.port}`;
  try {
    const res = await fetch(`${origin}/reports/${MONTH}`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>What AI coding agents tried to do in November 2026 \| ThumbGate<\/title>/);
    assert.equal((await fetch(`${origin}/reports/2099-01`)).status, 404);
    const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
    assert.match(sitemap, /<loc>[^<]*\/reports\/2026-11<\/loc>/);
  } finally {
    handle.server.closeIdleConnections?.();
    handle.server.closeAllConnections?.();
    await new Promise((resolve) => handle.server.close(resolve));
  }
});
