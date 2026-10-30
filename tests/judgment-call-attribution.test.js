'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  evaluateJudgmentCallAttribution,
  SOURCE_URL,
  adoptedStudyRates,
} = require('../scripts/judgment-call-attribution');
const gates = require('../scripts/gates-engine');

function bash(command) {
  return { toolName: 'Bash', toolInput: { command }, command };
}

function edit(filePath, text) {
  return {
    toolName: 'Edit',
    toolInput: { file_path: filePath, new_string: text, old_string: 'before' },
    command: '',
  };
}

test('a recommendation on a decision record names the lean and the other option', () => {
  const unnamed = evaluateJudgmentCallAttribution(edit(
    '.herd-swarm/decisions.md',
    'recommendation: roll the program out',
  ));
  assert.equal(unnamed.failureReason, 'lean_not_named');

  const oneSided = evaluateJudgmentCallAttribution(edit(
    'decisions.md',
    'source_agent: scout@workshop\nrecommendation: roll the program out',
  ));
  assert.equal(oneSided.failureReason, 'other_option_missing');

  const complete = evaluateJudgmentCallAttribution(edit(
    '.herd-swarm/decisions.md',
    'source_agent: scout@workshop\nother_option: discontinue\nrecommendation: roll the program out',
  ));
  assert.equal(complete, null);
});

test('a sign-off is not an independent decision', () => {
  const claimed = evaluateJudgmentCallAttribution(edit(
    '.herd-swarm/decisions.md',
    'source_agent: scout@workshop\nother_option: discontinue\nThis is my own judgment. recommendation: roll out',
  ));
  assert.equal(claimed.failureReason, 'signoff_is_not_independence');

  const prior = evaluateJudgmentCallAttribution(edit(
    '.herd-swarm/decisions.md',
    'source_agent: scout@workshop\nother_option: discontinue\nhuman_view_first: roll out\nmy own judgment matches that view',
  ));
  assert.equal(prior, null);

  const deferred = evaluateJudgmentCallAttribution(edit(
    '.herd-swarm/sow-latest.json',
    'source_agent: scout@workshop\nother_option: discontinue\ndeferred: judge\nrecommendation: leave the call open',
  ));
  assert.equal(deferred, null);
});

test('a shared fact on the swarm record names its source', () => {
  const bare = evaluateJudgmentCallAttribution(edit(
    '.herd-swarm/sow-latest.json',
    '{ "shared_facts": [{ "text": "measure yield per hectare" }] }',
  ));
  assert.equal(bare.failureReason, 'lean_not_named');

  const credited = evaluateJudgmentCallAttribution(edit(
    '.herd-swarm/sow-latest.json',
    '{ "shared_facts": [{ "text": "measure yield per hectare", "source_agent": "scout@workshop" }] }',
  ));
  assert.equal(credited, null);
});

test('ordinary code, a printed sentence, and a refusal line are left alone', () => {
  assert.equal(
    evaluateJudgmentCallAttribution(edit('src/api/server.js', 'I recommend the shorter query')),
    null,
  );
  assert.equal(
    evaluateJudgmentCallAttribution(bash('echo recommendation: roll the program out')),
    null,
  );
  assert.equal(
    evaluateJudgmentCallAttribution(edit(
      'docs/notes.md',
      'Do not record a recommendation without source_agent and the other option.',
    )),
    null,
  );
});

test('appending an uncredited recommendation to the decision file is denied', () => {
  const appended = evaluateJudgmentCallAttribution(bash(
    "cat >> .herd-swarm/decisions.md << 'EOF'\nrecommendation: roll the program out\nEOF",
  ));
  assert.equal(appended.failureReason, 'lean_not_named');
});

test('the study rates are not ThumbGate measurements', () => {
  assert.equal(adoptedStudyRates, false);
  assert.equal(SOURCE_URL, 'https://www.anthropic.com/research/agents-judgment-calls');
  const source = fs.readFileSync(path.join(__dirname, '../scripts/judgment-call-attribution.js'), 'utf8');
  assert.equal(source.includes('paperBenchmarks'), false);
  assert.equal(source.includes('112/123'), false);
});

test('editing this test is not a judgment record', () => {
  const own = fs.readFileSync(path.join(__dirname, 'judgment-call-attribution.test.js'), 'utf8');
  assert.equal(
    evaluateJudgmentCallAttribution(edit('tests/judgment-call-attribution.test.js', own)),
    null,
  );
});

test('the hard floor denies an uncredited decision record', () => {
  const body = JSON.parse(gates.runHardFloor({
    tool_name: 'Edit',
    tool_input: {
      file_path: '.herd-swarm/decisions.md',
      new_string: 'recommendation: roll the program out',
      old_string: 'before',
    },
  }));
  assert.equal(body.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /\[GATE:judgment-call-attribution\]/);
});
