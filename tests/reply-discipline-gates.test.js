'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gates = require('../scripts/reply-discipline-gates');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('replies that hand the person manual steps are denied; 2FA is exempt', () => {
  for (const text of [
    'Please paste the API key here.',
    'You need to open Settings and add the connector.',
    'Sign in and click Approve.',
    'Can you run npm test on your Mac?',
  ]) {
    const r = gates.evaluateReply('mcp__hearthbot__post_message', { text });
    assert.equal(r.deny, true, text);
    assert.equal(r.rule, 'no-manual-steps');
  }
  assert.equal(gates.evaluateReply('mcp__hearthbot__post_message', { text: 'GitHub asks for your 2FA code; you need to type it on your phone.' }).deny, false);
  assert.equal(gates.evaluateReply('mcp__hearthbot__post_message', { text: 'I opened PR #12 and I am watching its checks.' }).deny, false);
  const card = gates.evaluateReply('mcp__hearthbot__request_decision', { question: 'Pick one', options: [{ label: 'A', consequence: 'You need to run the script yourself.' }] });
  assert.equal(card.deny, true, 'decision cards are checked too');
});

test('a completion claim in a reply needs proof from this turn', () => {
  const transcript = path.join(tmp('tg-rdg-'), 't.jsonl');
  const user = { type: 'user', message: { content: [{ type: 'text', text: 'ship it' }] } };
  fs.writeFileSync(transcript, `${JSON.stringify(user)}\n`);
  const noProof = gates.evaluateReply('mcp__hearthbot__post_message', { text: 'It is deployed and verified.' }, { transcript_path: transcript });
  assert.equal(noProof.deny, true);
  assert.equal(noProof.rule, 'proof-before-claim');

  const toolUse = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'curl -s https://thumbgate.ai/health' } }] } };
  const toolResult = { type: 'user', message: { content: [{ type: 'tool_result', content: '{"status":"ok","version":"1.42.2"}' }] } };
  fs.appendFileSync(transcript, `${JSON.stringify(toolUse)}\n${JSON.stringify(toolResult)}\n`);
  const withProof = gates.evaluateReply('mcp__hearthbot__post_message', { text: 'It is deployed and verified: curl /health shows 1.42.2.' }, { transcript_path: transcript });
  assert.equal(withProof.deny, false);

  // Proof from an earlier turn does not count.
  fs.appendFileSync(transcript, `${JSON.stringify(user)}\n`);
  assert.equal(gates.evaluateReply('mcp__hearthbot__post_message', { text: 'Still deployed and verified.' }, { transcript_path: transcript }).deny, true);
});

test('gates are off by default and on with THUMBGATE_PR_DISCIPLINE=1 or config/pr-discipline.json', () => {
  const dir = tmp('tg-rdg-cfg-');
  assert.equal(gates.loadConfig({ cwd: dir, env: {} }).enabled, false);
  assert.equal(gates.loadConfig({ cwd: dir, env: { THUMBGATE_PR_DISCIPLINE: '1' } }).enabled, true);
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'pr-discipline.json'), JSON.stringify({ enabled: true }));
  assert.equal(gates.loadConfig({ cwd: dir, env: {} }).enabled, true);
});

async function capture(fn) {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  try { await fn(); } finally { process.stdout.write = orig; }
  return chunks.map((c) => JSON.parse(c));
}

test('main emits hook-format deny and Stop block, and stays quiet when off', async () => {
  const transcript = path.join(tmp('tg-rdg-stop-'), 't.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Please paste the token and I will continue.' }] } })}\n`);
  const on = { THUMBGATE_PR_DISCIPLINE: '1' };
  const [pre, stop, stopAgain, off] = await capture(async () => {
    await gates.main('pre', { env: on, stdin: JSON.stringify({ tool_name: 'mcp__hearthbot__post_message', tool_input: { text: 'You need to click Approve in Settings.' } }) });
    await gates.main('stop', { env: on, stdin: JSON.stringify({ transcript_path: transcript }) });
    await gates.main('stop', { env: on, stdin: JSON.stringify({ transcript_path: transcript, stop_hook_active: true }) });
    await gates.main('pre', { env: {}, stdin: JSON.stringify({ tool_name: 'mcp__hearthbot__post_message', tool_input: { text: 'You need to click Approve.' } }) });
  });
  assert.equal(pre.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(stop.decision, 'block');
  assert.deepEqual(stopAgain, {}, 'blocks once, never loops');
  assert.deepEqual(off, {});
});
