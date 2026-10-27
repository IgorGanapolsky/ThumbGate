'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const gate = require('../scripts/craft-playbook-gate');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'craft-playbook-gate.js');
const SOURCE = 'https://www.youtube.com/watch?v=CMkwClAm2TI';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function outline(overrides = {}) {
  return {
    kind: 'outline',
    id: 'inbox-triage',
    deliverable: 'Triage one inbox',
    triggerKind: 'schedule',
    trigger: 'hourly',
    inputs: ['unread emails'],
    steps: [{ id: 'tag', detail: 'Tag each unread thread with one label.' }],
    output: 'Inbox triaged',
    escalation: 'Edge cases go to a person',
    triggerWord: 'inbox-triage',
    home: 'git',
    path: 'playbooks/inbox-triage.md',
    ...overrides,
  };
}

function playbook(overrides = {}) {
  return {
    id: 'inbox-triage',
    path: 'playbooks/inbox-triage.md',
    triggerKind: 'schedule',
    trigger: 'hourly',
    inputs: ['unread emails'],
    steps: [{ id: 'tag', detail: 'Tag each unread thread with one label.', escalate: false }],
    output: 'Inbox triaged',
    escalation: 'Ambiguous threads go to a person',
    humanSteps: [{ id: 'edge', reason: 'Judgment' }],
    ...overrides,
  };
}

function editDoc(before, after, extra = {}) {
  return {
    kind: 'edit',
    before,
    after,
    backup: {
      sha256: gate.backupDigest(before),
      path: 'playbooks/inbox-triage.bak.json',
    },
    ...extra,
  };
}

function craft(overrides = {}) {
  return {
    kind: 'craft',
    cycle: 1,
    stages: { clear: true, realistic: true, setup: false, feedback: false, rollout: false },
    humanSteps: [{ id: 'edge', reason: 'Judgment on ambiguous mail' }],
    zeroTouch: false,
    ...overrides,
  };
}

function allStages() {
  return { clear: true, realistic: true, setup: true, feedback: true, rollout: true };
}

function stack(overrides = {}) {
  return {
    kind: 'stack',
    managerId: 'morning-brief',
    children: ['inbox-triage', 'calendar-scan'],
    mode: 'local-board',
    tasks: [
      { id: 't1', playbookId: 'inbox-triage', status: 'done', output: 'Inbox triaged', verified: true },
      { id: 't2', playbookId: 'calendar-scan', status: 'done', output: 'Calendar scanned', verified: true },
    ],
    ...overrides,
  };
}

function runCli(args, input = '') {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    input,
    encoding: 'utf8',
  });
}

test('an empty document and a missing kind hold, and null does not throw', () => {
  assert.doesNotThrow(() => gate.evaluate(null));
  for (const doc of [null, [], {}, { kind: 'morning' }]) {
    const result = gate.evaluate(doc);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'kind_required');
    assert.equal(result.wrote, false);
    assert.equal(result.mayApply, false);
  }
});

test('a complete outline is one git deliverable and writes nothing', () => {
  const result = gate.evaluate(outline());
  assert.equal(result.ok, true);
  assert.equal(result.code, 'outline_ready');
  assert.equal(result.decision, 'accept');
  assert.equal(result.mayApply, false);
  assert.equal(result.wrote, false);
});

test('a role, a whole department, a string input, and a vague step are refused', () => {
  assert.equal(gate.evaluate(outline({ scope: 'role' })).code, 'scope_refused');
  assert.equal(gate.evaluate(outline({ deliverable: 'Automate the entire role' })).code, 'scope_refused');
  assert.equal(gate.evaluate(outline({ inputs: 'unread emails' })).code, 'inputs_must_be_a_list');
  assert.equal(gate.evaluate(outline({ inputs: [''] })).code, 'inputs_required');
  assert.equal(gate.evaluate(outline({
    steps: [{ id: 'tag', detail: 'handle it' }],
  })).code, 'step_vague');
  const duplicate = gate.evaluate(outline({
    steps: [
      { id: 'tag', detail: 'Tag each unread thread with one label.' },
      { id: 'tag', detail: 'Tag the second pass with one label.' },
    ],
  }));
  assert.equal(duplicate.code, 'step_id_duplicate');
  assert.match(duplicate.message, /tag/);
});

test('the playbook home is git, and a generic trigger word is refused', () => {
  assert.equal(gate.evaluate(outline({ home: 'vendor-ui' })).code, 'home_refused');
  assert.equal(gate.evaluate(outline({ home: 'claude-project' })).code, 'home_refused');
  assert.equal(gate.evaluate(outline({ path: '' })).code, 'path_required');
  const generic = gate.evaluate(outline({ triggerWord: 'feedback' }));
  assert.equal(generic.code, 'trigger_word_generic');
  assert.match(generic.message, /feedback/);
  assert.match(generic.message, /nitpicking/);
});

test('cycle 1 stays in the loop and refuses zero-touch', () => {
  const staying = gate.evaluate(craft());
  assert.equal(staying.ok, true);
  assert.equal(staying.code, 'in_loop');
  assert.equal(staying.decision, 'in_loop');
  assert.equal(staying.mayApply, false);
  assert.equal(staying.wrote, false);
  assert.equal(gate.evaluate(craft({ zeroTouch: true })).code, 'zero_touch_refused');
  assert.equal(gate.evaluate(craft({ humanSteps: [], zeroTouch: false })).code, 'human_steps_required');
  assert.equal(gate.evaluate(craft({ zeroTouch: 'true' })).code, 'zero_touch_type');
  assert.equal(gate.evaluate(craft({ cycle: '1' })).code, 'cycle_invalid');
});

test('a later CRAFT stage cannot be done before an earlier one', () => {
  assert.equal(gate.evaluate(craft({
    stages: { clear: 'true', realistic: true },
  })).code, 'stage_order');
  assert.equal(gate.evaluate(craft({
    stages: { clear: true, realistic: true, setup: true, feedback: false, rollout: true },
  })).code, 'stage_order');
});

test('zero-touch on a later cycle needs every stage, no human steps, and wins inside steps', () => {
  const base = {
    cycle: 2,
    zeroTouch: true,
    stages: allStages(),
    humanSteps: [],
    feedback: { errorsReviewed: true, lockedWins: ['executive summary'] },
    steps: [{ id: 's1', detail: 'Draft the reply and add an executive summary.' }],
  };
  const ready = gate.evaluate(craft(base));
  assert.equal(ready.ok, true);
  assert.equal(ready.code, 'zero_touch');
  assert.equal(ready.decision, 'zero_touch');
  assert.equal(ready.wrote, false);
  assert.equal(gate.evaluate(craft({
    ...base,
    stages: { clear: true, realistic: true, setup: true, feedback: true, rollout: false },
  })).code, 'stages_incomplete');
  assert.equal(gate.evaluate(craft({
    ...base,
    humanSteps: [{ id: 'edge', reason: 'Still a person' }],
  })).code, 'human_steps_remain');
  assert.equal(gate.evaluate(craft({
    ...base,
    feedback: { errorsReviewed: 'true', lockedWins: ['executive summary'] },
  })).code, 'errors_not_reviewed');
  assert.equal(gate.evaluate(craft({
    ...base,
    feedback: { errorsReviewed: true, lockedWins: true },
  })).code, 'wins_not_locked');
  assert.equal(gate.evaluate(craft({
    ...base,
    steps: [{ id: 's1', detail: 'Draft the reply.' }],
  })).code, 'win_not_in_steps');
  const stillHuman = gate.evaluate(craft({
    cycle: 2,
    zeroTouch: false,
    stages: allStages(),
    humanSteps: [{ id: 'edge', reason: 'Still a person' }],
  }));
  assert.equal(stillHuman.ok, true);
  assert.equal(stillHuman.code, 'in_loop');
});

test('a structural self-edit needs a matching backup and a named approval', () => {
  const before = playbook();
  const after = playbook({ trigger: 'daily' });
  const held = gate.evaluate(editDoc(before, after, {
    maxAutoCommitSelfEditLines: 15,
    selfEditDiffLines: 1,
  }));
  assert.equal(held.code, 'approval_required');
  assert.equal(held.decision, 'approval_required');
  assert.equal(held.requiresApproval, true);
  assert.equal(held.mayApply, false);
  assert.equal(held.wrote, false);
  assert.equal(gate.evaluate(editDoc(before, after, { approved: 'true', approvedBy: 'igor' })).code, 'approval_required');
  assert.equal(gate.evaluate(editDoc(before, after, { approved: 1, approvedBy: 'igor' })).code, 'approval_required');
  assert.equal(gate.evaluate(editDoc(before, after, { approved: true, approvedBy: '   ' })).code, 'approval_required');
  const approved = gate.evaluate(editDoc(before, after, { approved: true, approvedBy: 'igor' }));
  assert.equal(approved.ok, true);
  assert.equal(approved.code, 'approved_major');
  assert.equal(approved.decision, 'approved_major');
  assert.equal(approved.mayApply, true);
  assert.equal(approved.wrote, false);
  assert.equal(gate.evaluate(editDoc(before, playbook({
    steps: [{ id: 'label', detail: 'Tag each unread thread with one label.', escalate: false }],
  }), { approved: true, approvedBy: 'igor' })).decision, 'approved_major');
  assert.equal(gate.evaluate(editDoc(before, playbook({
    steps: [{ id: 'tag', detail: 'Tag each unread thread with one label.', escalate: true }],
  }))).code, 'approval_required');
});

test('a backup must match the previous playbook and must not be the live path', () => {
  const before = playbook();
  const after = playbook({ trigger: 'daily' });
  const mismatch = editDoc(before, after, { approved: true, approvedBy: 'igor' });
  mismatch.backup.sha256 = '0'.repeat(64);
  assert.equal(gate.evaluate(mismatch).code, 'backup_required');
  assert.equal(gate.evaluate(mismatch).mayApply, false);
  const missing = { kind: 'edit', before, after, approved: true, approvedBy: 'igor' };
  assert.equal(gate.evaluate(missing).code, 'backup_required');
  const samePath = editDoc(before, after, { approved: true, approvedBy: 'igor' });
  samePath.backup.path = before.path;
  assert.equal(gate.evaluate(samePath).code, 'backup_required');
  const reversed = { z: 1, a: { b: 2, a: 3 } };
  const ordered = { a: { a: 3, b: 2 }, z: 1 };
  assert.equal(gate.backupDigest(reversed), gate.backupDigest(ordered));
});

test('a detail tweak is minor only with feedback, and an unchanged playbook is not applied', () => {
  const before = playbook();
  const after = playbook();
  after.steps[0].detail = 'Tag each unread thread with one label and add an executive summary.';
  assert.equal(gate.evaluate(editDoc(clone(before), clone(after))).code, 'feedback_ref_required');
  const minor = gate.evaluate(editDoc(clone(before), clone(after), { feedbackRef: 'morning-review' }));
  assert.equal(minor.ok, true);
  assert.equal(minor.code, 'minor');
  assert.equal(minor.decision, 'minor');
  assert.equal(minor.mayApply, true);
  assert.equal(minor.wrote, false);
  const missed = gate.evaluate(editDoc(clone(before), clone(after), {
    feedbackRef: 'run-12',
    lockedWins: ['missing phrase'],
  }));
  assert.equal(missed.code, 'win_not_in_steps');
  const same = playbook();
  const unchanged = gate.evaluate(editDoc(same, clone(same), {
    feedbackRef: 'run-12',
    approved: true,
    approvedBy: 'igor',
  }));
  assert.equal(unchanged.ok, false);
  assert.equal(unchanged.code, 'unchanged');
  assert.equal(unchanged.decision, 'unchanged');
  assert.equal(unchanged.mayApply, false);
});

test('nitpicking is a distinct trigger word and a duplicate word collides', () => {
  const ready = gate.evaluate({
    kind: 'vocabulary',
    registry: [{ id: 'critique', triggerWord: 'nitpicking' }],
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.code, 'vocabulary_ready');
  assert.equal(gate.evaluate({
    kind: 'vocabulary',
    registry: [{ id: 'critique', triggerWord: 'Nitpick' }],
  }).code, 'trigger_word_shape');
  const collision = gate.evaluate({
    kind: 'vocabulary',
    registry: [
      { id: 'a', triggerWord: 'nitpicking' },
      { id: 'b', triggerWord: 'nitpicking' },
    ],
  });
  assert.equal(collision.code, 'trigger_word_collision');
  assert.match(collision.message, /nitpicking/);
  assert.equal(gate.evaluate({
    kind: 'vocabulary',
    registry: [{ id: 'a', triggerWord: 'feedback' }],
  }).code, 'trigger_word_generic');
});

test('a stack is done only when every child is verified on the local board', () => {
  const done = gate.evaluate(stack());
  assert.equal(done.ok, true);
  assert.equal(done.code, 'stack_done');
  assert.equal(done.decision, 'stack_done');
  assert.equal(done.mayApply, false);
  assert.equal(done.wrote, false);
  assert.equal(gate.evaluate(stack({ children: ['inbox-triage'] })).code, 'not_a_stack');
  assert.equal(gate.evaluate(stack({ mode: 'asana' })).code, 'mode_refused');
  assert.equal(gate.evaluate(stack({ mode: 'subagent' })).code, 'mode_refused');
  assert.equal(gate.evaluate(stack({
    children: ['morning-brief', 'inbox-triage'],
  })).code, 'stack_self_child');
  assert.equal(gate.evaluate(stack({
    tasks: [
      { id: 't1', playbookId: 'inbox-triage', status: 'done', output: 'Inbox triaged', verified: true },
    ],
  })).code, 'stack_incomplete');
  assert.equal(gate.evaluate(stack({
    tasks: [
      { id: 't1', playbookId: 'inbox-triage', status: 'done', output: 'Inbox triaged', verified: 'true' },
      { id: 't2', playbookId: 'calendar-scan', status: 'done', output: 'Calendar scanned', verified: true },
    ],
  })).code, 'stack_unverified');
});

test('the idea map names the source and refuses the measurements', () => {
  const map = gate.ideaMap();
  assert.equal(map.source, SOURCE);
  assert.equal(map.notOurMeasurement, true);
  assert.equal(map.taken.length, 6);
  assert.equal(map.refused.length, 6);
});

test('the command reads stdin, exits by verdict, and does not write', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  for (const banned of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'child_process', 'require.main']) {
    assert.equal(source.includes(banned), false, banned);
  }
  const mapped = runCli(['--map-only'], '');
  assert.equal(mapped.status, 0);
  const body = JSON.parse(mapped.stdout);
  assert.equal(body.notOurMeasurement, true);
  assert.equal(body.source, SOURCE);
  assert.equal(runCli([], '{').status, 2);
  assert.match(runCli([], '{').stderr, /stdin must be one JSON object/);
  assert.equal(runCli([], '').status, 2);
  const held = runCli([], '{}');
  assert.equal(held.status, 1);
  assert.equal(JSON.parse(held.stdout).code, 'kind_required');
  const accepted = runCli(['outline'], JSON.stringify(outline()));
  assert.equal(accepted.status, 0);
  assert.equal(JSON.parse(accepted.stdout).code, 'outline_ready');
  const mismatch = runCli(['craft'], JSON.stringify(outline()));
  assert.equal(mismatch.status, 2);
  assert.match(mismatch.stderr, /does not match kind/);
});
