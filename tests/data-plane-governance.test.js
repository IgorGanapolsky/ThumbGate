'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  taskContextBillUsd,
  governAgentDataPlane,
  dataPlaneFromTool,
  DATA_PLANE_REFUSES,
} = require('../scripts/financial-control-plane');
const { decideCursorHookAction } = require('../scripts/hook-runtime');

const PRICE = {
  interactions: 4,
  contextTokens: 250000,
  usdPerMillionTokens: 2,
};

test('task bill is interactions times context at the given dollar rate', () => {
  assert.equal(taskContextBillUsd(PRICE), 2);
  assert.equal(taskContextBillUsd({ interactions: 3, contextTokens: 1000, usdPerMillionTokens: 2.5 }), 0.0075);
  assert.equal(taskContextBillUsd({ interactions: -1, contextTokens: 10, usdPerMillionTokens: 1 }), null);
});

test('a priced task inside an explicit budget is one allow record', () => {
  const record = governAgentDataPlane({ ...PRICE, budgetUsd: 2, system: 'lesson-db' });
  assert.equal(record.control, 'allow');
  assert.equal(record.cost.billUsd, 2);
  assert.equal(record.cost.overBudget, false);
  assert.deepEqual(record.context.system, 'lesson-db');
  assert.deepEqual(record.refuses, [...DATA_PLANE_REFUSES]);
  assert.deepEqual(record.triggered, []);
});

test('missing USD budget warns and does not deny', () => {
  const record = governAgentDataPlane(PRICE);
  assert.equal(record.control, 'warn');
  assert.match(record.reasons[0], /Missing explicit USD budget/);
});

test('a context bill over the explicit budget denies', () => {
  const record = governAgentDataPlane({ ...PRICE, budgetUsd: 1 });
  assert.equal(record.control, 'deny');
  assert.equal(record.cost.overBudget, true);
  assert.match(record.reasons[0], /exceeds USD budget/);
});

test('incomplete cost math warns when a budget was declared', () => {
  const record = governAgentDataPlane({ interactions: 2, budgetUsd: 1 });
  assert.equal(record.control, 'warn');
  assert.match(record.reasons.join(' '), /incomplete/);
});

test('CData install and Foundations registration are refused', () => {
  const install = governAgentDataPlane(dataPlaneFromTool('Bash', { command: 'pip install cdata-connect' }));
  assert.equal(install.control, 'deny');
  assert.deepEqual(install.triggered, ['CData install']);

  const cloud = governAgentDataPlane(dataPlaneFromTool('Bash', {
    command: 'curl https://mcp.cloud.cdata.com/tools',
  }));
  assert.equal(cloud.control, 'deny');
  assert.ok(cloud.triggered.includes('CData install'));

  const event = governAgentDataPlane({
    intent: 'register for the CData Foundations event',
  });
  assert.equal(event.control, 'deny');
  assert.deepEqual(event.triggered, ['CData Foundations registration']);
});

test('an ordinary install and a piped echo are not a CData install', () => {
  assert.equal(governAgentDataPlane(dataPlaneFromTool('Bash', { command: 'npm install left-pad' })).control, 'allow');
  assert.equal(
    governAgentDataPlane(dataPlaneFromTool('Bash', { command: 'echo cdata | npm install left-pad' })).control,
    'allow'
  );
  assert.equal(governAgentDataPlane({}).control, 'allow');
});

test('the wrong system and a local-only remote target deny', () => {
  const wrong = governAgentDataPlane({ system: 'lesson-db', targetSystem: 'cdata-cloud' });
  assert.equal(wrong.control, 'deny');
  assert.match(wrong.reasons[0], /lesson-db/);

  const same = governAgentDataPlane({ system: 'Lesson-DB', targetSystem: 'lesson-db' });
  assert.equal(same.control, 'allow');

  const remote = governAgentDataPlane({ localOnly: true, remoteSystem: true });
  assert.equal(remote.control, 'deny');
  assert.match(remote.reasons[0], /Local-only/);
});

test('the Cursor hook denies this gate while it is still in warn mode', () => {
  const decision = decideCursorHookAction({
    gateId: 'data-plane-governance',
    mode: 'warn',
  });
  assert.equal(decision.action, 'deny');
  assert.equal(decision.effectClass, 'third-party');
  assert.equal(decision.incident, true);
});

test('the pre-tool hard floor denies a CData install and an over-budget task', () => {
  const root = path.join(__dirname, '..');
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-data-plane-'));
  const script = `
    const { runHardFloor } = require('./scripts/gates-engine');
    const cases = [
      ['install', { tool_name: 'Bash', tool_input: { command: 'pip install cdata-connect' } }],
      ['plain', { tool_name: 'Bash', tool_input: { command: 'true' } }],
      ['over', { tool_name: 'Bash', tool_input: { dataPlane: { interactions: 4, contextTokens: 250000, usdPerMillionTokens: 2, budgetUsd: 1 } } }],
      ['nobudget', { tool_name: 'Bash', tool_input: { dataPlane: { interactions: 4, contextTokens: 250000, usdPerMillionTokens: 2 } } }],
    ];
    const out = {};
    for (const [name, input] of cases) out[name] = runHardFloor(input);
    process.stdout.write(JSON.stringify(out));
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    env: {
      ...process.env,
      THUMBGATE_STATE_DIR: stateDir,
      THUMBGATE_FEEDBACK_DIR: stateDir,
      HOME: stateDir,
    },
    encoding: 'utf8',
  });
  fs.rmSync(stateDir, { recursive: true, force: true });
  assert.equal(child.status, 0, child.stderr);
  const out = JSON.parse(child.stdout);
  assert.match(out.install, /permissionDecision":"deny"/);
  assert.match(out.install, /GATE:data-plane-governance/);
  assert.match(out.install, /CData install is refused/);
  assert.equal(out.plain, null);
  assert.match(out.over, /exceeds USD budget/);
  assert.equal(out.nobudget, null);
});
