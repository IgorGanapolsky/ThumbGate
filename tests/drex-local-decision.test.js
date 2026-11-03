'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  answerRequest,
  checkAction,
} = require('../scripts/drex-local-decision');

function gate(action, extra) {
  const payload = {
    state: { action, ...extra },
    questions: {
      gate: {
        type: 'choice',
        instructions: 'Which gate?',
        criteria: { allow: 'do it', ask: 'wait', block: 'stop' },
      },
    },
  };
  return answerRequest(payload).answers.gate;
}

test('a local read is allow and the probabilities sum to one', () => {
  const row = gate('read the local file');
  assert.equal(row.choice, 'allow');
  assert.equal(row.source, 'airlock');
  assert.equal(row.probabilities.allow, 1);
  assert.equal(row.probabilities.ask + row.probabilities.block + row.probabilities.allow, 1);
  assert.equal(row.abstain, undefined);
});

test('sending asks, and a personal push of a protected repo blocks', () => {
  const asked = gate('send email to the team');
  assert.equal(asked.choice, 'ask');
  assert.equal(asked.probabilities.ask, 1);
  const blocked = gate('git push https://github.com/IgorGanapolsky/secure-yolo.git');
  assert.equal(blocked.choice, 'block');
  assert.equal(blocked.rule, 'personal-github');
  assert.equal(blocked.probabilities.block, 1);
});

test('an explicit ask lifts an ask and leaves a block in place', () => {
  const lifted = gate('send email to the team', { igor_asked: true });
  assert.equal(lifted.choice, 'allow');
  const still = gate('git push https://github.com/IgorGanapolsky/secure-yolo.git', { igor_asked: true });
  assert.equal(still.choice, 'block');
});

test('a gate outside the offered options abstains with no probability', () => {
  const row = answerRequest({
    state: 'git push https://github.com/IgorGanapolsky/secure-yolo.git',
    questions: {
      gate: { type: 'choice', criteria: { allow: 'do it', ask: 'wait' } },
    },
  }).answers.gate;
  assert.equal(row.abstain, true);
  assert.equal(row.probabilities, undefined);
});

test('a desk choice and every score abstain', () => {
  const answers = answerRequest({
    state: { ticket: 'I was charged twice.' },
    questions: {
      team: {
        type: 'choice',
        instructions: 'Which desk?',
        criteria: { billing: 'money', technical: 'bugs' },
      },
      urgency: {
        type: 'score',
        instructions: 'How urgent?',
        criteria: ['routine', 'soon', 'urgent'],
      },
    },
  }).answers;
  assert.equal(answers.team.abstain, true);
  assert.equal(answers.urgency.abstain, true);
  assert.equal(answers.team.probabilities, undefined);
  assert.equal(answers.urgency.score, undefined);
});

test('proceed is yes only when the gate allows', () => {
  const local = answerRequest({
    state: { action: 'read the local file' },
    questions: {
      proceed: { type: 'noul', id: 'proceed' },
      other: { type: 'noul', instructions: 'Is the sky clear?' },
    },
  }).answers;
  assert.equal(local.proceed.noul, 1);
  assert.equal(local.other.abstain, true);
  const send = answerRequest({
    state: 'send email to the team',
    questions: {
      proceed: { type: 'noul', instructions: 'May the agent proceed?' },
    },
  }).answers.proceed;
  assert.equal(send.noul, 0);
});

test('the check command names the local rule and no weight file', () => {
  const body = checkAction('read the local file', false);
  assert.equal(body.model, 'local-rules');
  assert.equal(body.weights, 'none');
  assert.equal(body.answers.gate.choice, 'allow');
  assert.equal(body.answers.proceed.noul, 1);
});

test('the script does not name a remote decision endpoint', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/drex-local-decision.js'), 'utf8');
  assert.equal(source.includes('console.nace.ai'), false);
  assert.equal(source.includes('openrouter.ai'), false);
  assert.equal(source.includes('hf download'), false);
  assert.equal(/67\.52/.test(source), false);
});

test('the answer command reads a local request and does not proceed on a send', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drex-local-'));
  const file = path.join(dir, 'request.json');
  fs.writeFileSync(file, JSON.stringify({
    state: { action: 'send email to the team' },
    questions: {
      gate: {
        type: 'choice',
        criteria: { allow: 'do it', ask: 'wait', block: 'stop' },
      },
      proceed: { type: 'noul', id: 'proceed' },
    },
  }));
  const result = spawnSync(process.execPath, ['scripts/drex-local-decision.js', 'answer', '--request', file], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.weights, 'none');
  assert.equal(body.answers.gate.choice, 'ask');
  assert.equal(body.answers.proceed.noul, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
