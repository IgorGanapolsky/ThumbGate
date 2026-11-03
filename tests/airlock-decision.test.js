'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  ENABLEMENT_SOURCE,
  classify,
  decideSharedAction,
} = require('../scripts/airlock-decision');

function tempLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airlock-'));
  return path.join(dir, 'airlock.jsonl');
}

function lines(logPath) {
  return fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

test('printing a secret is a block, and asking does not lift it', () => {
  assert.deepEqual(classify('cat .env', true), { decision: 'block', rule: 'secret' });
  assert.deepEqual(classify('echo the api_key', false), { decision: 'block', rule: 'secret' });
  const logPath = tempLog();
  const token = 'A'.repeat(40);
  const decision = decideSharedAction({
    toolName: 'Bash',
    toolInput: { command: `echo the api_key ${token}` },
    logPath,
  });
  assert.equal(decision.decision, 'block');
  assert.equal(decision.reason.includes(token), false);
  assert.equal(decision.reason.includes('echo'), false);
  const recorded = lines(logPath);
  assert.equal(recorded[0].event, 'enabled');
  assert.equal(recorded[0].source, ENABLEMENT_SOURCE);
  assert.equal(recorded[1].action, '[redacted]');
  assert.equal(JSON.stringify(recorded).includes(token), false);
});

test('a live charge, a live order, and closing RealEstate stay blocked', () => {
  assert.equal(classify('stripe payment_intents create', true).rule, 'live-payment');
  assert.equal(classify('place the order', true).rule, 'live-order');
  assert.equal(classify('draft the order', false).rule, 'local');
  assert.equal(classify('merge the real-estate pull request', true).rule, 'realestate-operator');
});

test('a work repo pushed to a personal GitHub account is a block', () => {
  const decision = classify('git push secure-yolo to igorganapolsky', true);
  assert.equal(decision.decision, 'block');
  assert.equal(decision.rule, 'personal-github');
});

test('force-push of main stays blocked, and another force-push waits unless this action was asked', () => {
  assert.equal(classify('git push --force origin main', true).rule, 'force-push-default');
  assert.equal(classify('git push --force origin feat/airlock', false).decision, 'ask');
  assert.equal(classify('git push --force origin feat/airlock', true).decision, 'allow');
});

test('a push from a work checkout waits, and the home directory name is not the destination', () => {
  const waited = decideSharedAction({
    toolName: 'Bash',
    toolInput: { command: 'git push origin HEAD' },
    cwd: '/tmp/secure-yolo',
    logPath: tempLog(),
  });
  assert.equal(waited.decision, 'ask');
  assert.equal(waited.rule, 'protected-push');
  const home = decideSharedAction({
    toolName: 'Bash',
    toolInput: { command: 'git push origin HEAD' },
    cwd: '/Users/iganapolsky/workspace/ThumbGate',
    logPath: tempLog(),
  });
  assert.equal(home.decision, 'allow');
  assert.equal(home.rule, 'local');
});

test('deleting a remote and sending mail wait, and an asked send is allowed', () => {
  assert.equal(classify('git push origin --delete feat/old', false).rule, 'remote-delete');
  assert.equal(classify('gh repo delete some-repo', false).decision, 'ask');
  assert.equal(classify('send the email', false).rule, 'outbound');
  assert.equal(classify('send the email', true).decision, 'allow');
  assert.equal(classify('open the email', false).decision, 'allow');
  assert.equal(classify('git status', false).rule, 'local');
});

test('the log starts at enablement and a broken log does not freeze a local command', () => {
  const logPath = tempLog();
  decideSharedAction({
    toolName: 'Bash',
    toolInput: { command: 'git status' },
    logPath,
  });
  decideSharedAction({
    toolName: 'Bash',
    toolInput: { command: `show ${'B'.repeat(32)}` },
    logPath,
  });
  const recorded = lines(logPath);
  assert.equal(recorded.filter((row) => row.event === 'enabled').length, 1);
  assert.equal(recorded[2].action.includes('B'.repeat(32)), false);
  assert.match(recorded[2].action, /\[redacted-token\]/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airlock-corrupt-'));
  const corrupt = path.join(dir, 'airlock.jsonl');
  fs.writeFileSync(corrupt, '{\n');
  const decision = decideSharedAction({
    toolName: 'Bash',
    toolInput: { command: 'git status' },
    logPath: corrupt,
  });
  assert.equal(decision.decision, 'allow');
  const raw = fs.readFileSync(corrupt, 'utf8').split('\n')[0];
  assert.equal(raw, '{');

  const blockedParent = path.join(dir, 'not-a-directory');
  fs.writeFileSync(blockedParent, 'file');
  const frozen = decideSharedAction({
    toolName: 'Bash',
    toolInput: { command: 'git status' },
    logPath: path.join(blockedParent, 'airlock.jsonl'),
  });
  assert.equal(frozen.decision, 'allow');
  assert.equal(frozen.rule, 'local');
});

test('the pre-tool hook stops a secret print and a send, and an env flag does not lift the ask', () => {
  const logPath = tempLog();
  const root = path.resolve(__dirname, '..');
  const secret = spawnSync(process.execPath, ['scripts/hook-pre-tool-use.js'], {
    cwd: root,
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'cat .env' },
    }),
    encoding: 'utf8',
    env: { ...process.env, THUMBGATE_AIRLOCK_LOG: logPath },
    timeout: 15000,
  });
  assert.equal(secret.status, 0, secret.stderr);
  const secretParsed = JSON.parse(secret.stdout);
  assert.equal(secretParsed.decision, 'block');
  assert.equal(secretParsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(secretParsed.reason, /print a secret/);
  assert.equal(secretParsed.reason.includes('.env'), false);

  const sendLog = tempLog();
  const send = spawnSync(process.execPath, ['scripts/hook-pre-tool-use.js'], {
    cwd: root,
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'send the email' },
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      THUMBGATE_AIRLOCK_LOG: sendLog,
      THUMBGATE_AIRLOCK_IGOR_ASKED: '1',
    },
    timeout: 15000,
  });
  assert.equal(send.status, 0, send.stderr);
  const sendParsed = JSON.parse(send.stdout);
  assert.equal(sendParsed.decision, 'block');
  assert.match(sendParsed.reason, /waits for Igor/);
  assert.equal(sendParsed.reason.includes('send the email'), false);
  const enabled = fs.readFileSync(logPath, 'utf8').split('\n')[0];
  assert.match(enabled, /"event":"enabled"/);
});
