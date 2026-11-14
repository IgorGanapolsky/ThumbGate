'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { projectFromRemote } = require('../scripts/project-identity');
const A = projectFromRemote('https://github.com/account/a');
const B = projectFromRemote('https://github.com/account/b');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-gates-'));
process.env.THUMBGATE_FEEDBACK_DIR = dir;
process.env.THUMBGATE_SANDBOX_EVAL = '1';
const gates = require('../scripts/gates-engine');
const fixture = path.join(dir, 'gates.json');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
test('sync and async evaluators isolate project gates before matching and satisfaction', async () => {
  fs.writeFileSync(fixture, JSON.stringify({ gates: [{ id: 'project-fixture', scope: 'project', ...A, tool: 'ProjectProbe', pattern: 'scoped-fixture', action: 'warn', unless: 'fixture-ready' }] }));
  for (const evaluate of [gates.evaluateGates, gates.evaluateGatesAsync]) {
    const a = await evaluate('ProjectProbe', { command: 'scoped-fixture' }, fixture, { ...A, feedbackDir: dir });
    const b = await evaluate('ProjectProbe', { command: 'scoped-fixture' }, fixture, { ...B, feedbackDir: dir });
    assert.equal(a?.gate, 'project-fixture');
    assert.notEqual(b?.gate, 'project-fixture');
  }
});
test('satisfaction including global conditions is per project and account', () => {
  delete process.env.THUMBGATE_SANDBOX_EVAL;
  const other = path.join(dir, 'other'); fs.mkdirSync(other);
  gates.satisfyCondition('ready', 'fixture', null, { ...A, feedbackDir: dir });
  assert.equal(gates.isConditionSatisfied('ready', { ...A, feedbackDir: dir }), true);
  assert.equal(gates.isConditionSatisfied('ready', { ...B, feedbackDir: dir }), false);
  assert.equal(gates.isConditionSatisfied('ready', { ...A, feedbackDir: other }), false);
  process.env.THUMBGATE_SANDBOX_EVAL = '1';
});
test('promotion thresholds and IDs do not combine identical commands across projects', () => {
  const promotion = require('../scripts/auto-promote-gates');
  const records = [A, A, B].map((project, i) => ({ ...project, id: 'f' + i, signal: 'negative', timestamp: new Date().toISOString(), context: 'git push --force', whatWentWrong: 'force push failed', tags: ['git'] }));
  const groups = Object.values(promotion.groupNegativeFeedback(records, 30));
  assert.deepEqual(groups.map((g) => g.count).sort(), [1, 2]);
  const rules = groups.map((group) => promotion.buildGateRule(group));
  assert.notEqual(rules[0].id, rules[1].id);
  assert.equal(rules.every((rule) => rule.scope === 'project' && rule.action === 'warn'), true);
});
test('catastrophic evaluator uses explicit project rather than process cwd', async () => {
  const local = require('../scripts/project-identity').resolveLocalProject(process.cwd());
  fs.writeFileSync(fixture, JSON.stringify({ gates: [{ id: 'force-push', ...local, scope: 'project', tool: 'ProjectProbe', pattern: 'scoped-fixture', action: 'block' }] }));
  for (const evaluate of [gates.evaluateGates, gates.evaluateGatesAsync]) {
    assert.notEqual((await evaluate('ProjectProbe', { command: 'scoped-fixture' }, fixture, { ...B, feedbackDir: dir }))?.gate, 'force-push');
    assert.equal((await evaluate('ProjectProbe', { command: 'scoped-fixture' }, fixture, { ...local, feedbackDir: dir }))?.gate, 'force-push');
  }
});
test('hybrid learned guards cannot reuse another project or unscoped compiled artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-hybrid-'));
  try {
    const rows = [1, 2, 3].map((id) => ({ ...A, id: String(id), timestamp: new Date().toISOString(), signal: 'negative', tool_name: 'Bash', context: 'git push force main branch override', source: 'attributed' }));
    fs.writeFileSync(path.join(root, 'attributed-feedback.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
    const hybrid = require('../scripts/hybrid-feedback-context');
    const a = hybrid.evaluatePretool('Bash', 'git push force main branch override', { feedbackDir: root, projectKey: A.projectKey });
    const b = hybrid.evaluatePretool('Bash', 'git push force main branch override', { feedbackDir: root, projectKey: B.projectKey });
    assert.equal(a.mode, 'block'); assert.equal(b.mode, 'allow');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('catalog reports active gates and latest recorded activity for a gate-only project', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-gate-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { buildProjectCatalog } = require('../scripts/project-catalog');
  const baselineGlobal = buildProjectCatalog(root).globalGateCount;
  fs.writeFileSync(path.join(root, 'custom-gates.json'), JSON.stringify({ gates: [
    { ...A, id: 'active', scope: 'project', action: 'warn', timestamp: '2026-01-01T00:00:00.000Z', promotedAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' },
    { ...A, id: 'inactive', scope: 'project', action: 'block', active: false, timestamp: '2025-01-01T00:00:00.000Z' },
    { ...A, id: 'disabled', scope: 'project', action: 'block', enabled: false },
    { id: 'shared-fixture', scope: 'global', action: 'warn', timestamp: '2026-02-01T00:00:00.000Z' },
  ] }));
  const catalog = buildProjectCatalog(root);
  assert.equal(catalog.projects.length, 1);
  const project = catalog.projects[0];
  assert.equal(project.projectKey, A.projectKey);
  assert.equal(project.counts.gates, 1);
  assert.equal(project.counts.lessons, 0);
  assert.equal(project.counts.feedback, 0);
  assert.equal(project.lastActivity, '2026-01-03T00:00:00.000Z');
  assert.equal(catalog.globalGateCount, baselineGlobal + 1);
});
test('manual promotion returns the persisted project gate ID and updates only that project', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-force-promotion-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { forcePromote } = require('../scripts/auto-promote-gates');
  const a = forcePromote('git push --force origin fixture', 'block', { ...A, feedbackDir: root, hosted: true });
  const b = forcePromote('git push --force origin fixture', 'warn', { ...B, feedbackDir: root, hosted: true });
  const retried = forcePromote('git push --force origin fixture', 'block', { ...A, feedbackDir: root, hosted: true });
  assert.notEqual(a.gateId, b.gateId); assert.equal(retried.gateId, a.gateId);
  const rows = JSON.parse(fs.readFileSync(path.join(root, 'auto-promoted-gates.json'))).gates;
  assert.equal(rows.length, 2);
  assert.equal(rows.find((gate) => gate.id === a.gateId).projectKey, A.projectKey);
  assert.equal(rows.find((gate) => gate.id === a.gateId).active, true);
  assert.equal(rows.find((gate) => gate.id === b.gateId).action, 'warn');
});
