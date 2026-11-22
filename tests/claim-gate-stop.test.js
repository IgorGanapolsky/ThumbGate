#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'scripts', 'claim-gate-stop.js');
const { findStateClaims, evaluateDraft, collectTurns } = require('../scripts/claim-gate-stop');

// Unchecked, unlabelled present-tense claims about outside state: must be flagged.
const MUST_FLAG = [
  'Nothing watches the Instinct chat for me.',
  "tinyNature hasn't replied yet.",
  'The WhatsApp tab is closed, so the next send needs a new tab.',
  'No WhatsApp tab exists in the browser right now.',
];

// Labelled, hedged or non-claims: must pass.
const MUST_PASS = [
  'Live: the tinyNature chat still ends at 11:42 AM.',
  "As of 12:44 PM, tinyNature hasn't replied.",
  'Whether the WhatsApp tab is open is not checked.',
  'I checked live and the WhatsApp tab is open.',
  'Is the WhatsApp tab open?',
  'I changed the retry delay from 5 to 10 seconds.',
];

test('flags every unchecked, unlabelled state claim', () => {
  for (const sentence of MUST_FLAG) {
    assert.ok(findStateClaims(sentence).length > 0, `expected a flag: ${sentence}`);
  }
});

test('lets labelled, hedged and non-claim sentences through', () => {
  for (const sentence of MUST_PASS) {
    assert.deepEqual(findStateClaims(sentence), [], `expected a pass: ${sentence}`);
  }
});

test('the agent disclosing its own gap is not a claim about outside state', () => {
  assert.deepEqual(findStateClaims("I haven't opened the docs page, and I haven't run anything."), []);
});

test('a claim in a quote or a code fence is not a claim', () => {
  assert.deepEqual(findStateClaims('> Nothing watches the chat.\n```\ntab is closed\n```'), []);
});

test('a same-turn tool call counts as the check for an ordinary state claim', () => {
  const noLessons = { retrieve: () => [] };
  const claim = 'The WhatsApp tab is closed.';
  assert.equal(evaluateDraft(claim, { toolNames: [], ...noLessons }).block, true);
  assert.equal(evaluateDraft(claim, { toolNames: ['Bash'], ...noLessons }).block, false);
  assert.equal(evaluateDraft(claim, { toolNames: ['TodoWrite'], ...noLessons }).block, true);
});

test('an absence or no-reply claim needs a label even when the turn ran a tool', () => {
  const noLessons = { retrieve: () => [] };
  const draft = "tinyNature hasn't replied yet.";
  assert.equal(evaluateDraft(draft, { toolNames: ['Bash'], ...noLessons }).block, true);
  assert.equal(evaluateDraft('tinyNature hasn\'t replied yet (live).', { toolNames: ['Bash'], ...noLessons }).block, false);
  assert.equal(evaluateDraft("As of 12:44 PM, tinyNature hasn't replied.", { toolNames: ['Bash'], ...noLessons }).block, false);
});

test('the block reason carries the retrieved lesson text', () => {
  const lesson = { rule: null, content: 'Never say a tab is absent without a check from this turn.', signal: 'negative' };
  const verdict = evaluateDraft(MUST_FLAG[2], { toolNames: [], retrieve: () => [lesson] });
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /Never say a tab is absent without a check from this turn/);
  assert.match(verdict.reason, /"live"/);
});

test('turns split on real user prompts and ignore tool results', () => {
  const entries = [
    { type: 'user', timestamp: 't1', message: { content: 'go' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } },
    { type: 'user', timestamp: 't2', message: { content: 'again' } },
  ];
  const turns = collectTurns(entries);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[0].tools, ['Bash']);
  assert.deepEqual(turns[0].text, ['Done.']);
});

function runHook(payload, env = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 8000,
    env: { ...process.env, THUMBGATE_FEEDBACK_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-gate-')), ...env },
  });
}

function writeTranscript(text, tools = []) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-gate-t-')), 'transcript.jsonl');
  const content = [{ type: 'text', text }, ...tools.map((name) => ({ type: 'tool_use', name, input: {} }))];
  fs.writeFileSync(file, `${JSON.stringify({ type: 'user', message: { content: 'status?' } })}\n${JSON.stringify({ type: 'assistant', message: { content } })}\n`);
  return file;
}

test('hook blocks once: a flagged draft blocks, the re-run with stop_hook_active allows', () => {
  const file = writeTranscript('Nothing watches the Instinct chat for me.');
  const first = runHook({ transcript_path: file });
  assert.equal(first.status, 0);
  assert.equal(JSON.parse(first.stdout).decision, 'block');
  const second = runHook({ transcript_path: file, stop_hook_active: true });
  assert.equal(second.stdout.trim(), '');
});

test('hook stays silent for a labelled claim, a checked turn, and THUMBGATE_CLAIM_GATE=0', () => {
  assert.equal(runHook({ transcript_path: writeTranscript('As of 12:44 PM, tinyNature hasn\'t replied.') }).stdout.trim(), '');
  assert.equal(runHook({ transcript_path: writeTranscript('The WhatsApp tab is closed.', ['Bash']) }).stdout.trim(), '');
  assert.equal(runHook({ transcript_path: writeTranscript('Nothing watches the chat.') }, { THUMBGATE_CLAIM_GATE: '0' }).stdout.trim(), '');
});
