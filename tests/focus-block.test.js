'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  BLOCK_MS,
  evaluateFocusBlock,
  classifyToolCall,
  decideToolCall,
  startBlock,
  normalizeBlock,
} = require('../scripts/focus-block');

const STARTED = '2026-11-03T14:00:00.000Z';
const INSIDE = '2026-11-03T15:00:00.000Z';
const BLOCK = { startedAt: STARTED, objective: 'checkout-close', blockMs: BLOCK_MS };

test('an inbox reply waits inside the checkout-close block', () => {
  const decision = evaluateFocusBlock({ now: INSIDE, block: BLOCK, kind: 'inbox-reply' });
  assert.equal(decision.decision, 'wait');
  assert.equal(decision.resumeAt, '2026-11-03T17:00:00.000Z');
  assert.match(decision.reason, /checkout close/);
  assert.equal(decision.reason.includes('command'), false);
});

test('the pay link is the job and stays allowed', () => {
  const decision = evaluateFocusBlock({ now: INSIDE, block: BLOCK, kind: 'checkout-pay-link' });
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.reason, 'growth-job');
});

test('a security incident still runs during the block', () => {
  const decision = evaluateFocusBlock({ now: INSIDE, block: BLOCK, kind: 'security-incident' });
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.reason, 'urgent');
});

test('work before and after the three hours is allowed', () => {
  const before = evaluateFocusBlock({
    now: '2026-11-03T13:59:00.000Z',
    block: BLOCK,
    kind: 'social-post',
  });
  const after = evaluateFocusBlock({
    now: '2026-11-03T17:00:00.000Z',
    block: BLOCK,
    kind: 'social-post',
  });
  assert.equal(before.reason, 'outside-block');
  assert.equal(after.reason, 'outside-block');
  assert.equal(before.decision, 'allow');
  assert.equal(after.decision, 'allow');
});

test('a missing, corrupt, or oversized block does not freeze the tool', () => {
  assert.equal(evaluateFocusBlock({ now: INSIDE, block: null, kind: 'inbox-reply' }).reason, 'no-block');
  assert.equal(normalizeBlock({ objective: 'write-a-book', startedAt: STARTED }), null);
  const capped = normalizeBlock({
    objective: 'checkout-close',
    startedAt: STARTED,
    blockMs: BLOCK_MS * 4,
  });
  assert.equal(capped.blockMs, BLOCK_MS);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-block-'));
  const blockPath = path.join(dir, 'focus-block.json');
  fs.writeFileSync(blockPath, '{');
  const decision = decideToolCall({
    now: INSIDE,
    toolName: 'Bash',
    toolInput: { command: 'python3 fo-thumbgate-inbox-cron.py' },
    blockPath,
  });
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.reason, 'no-block');
});

test('the classifier names this morning\'s interrupts and leaves git alone', () => {
  assert.equal(classifyToolCall('Bash', { command: 'python3 fo-thumbgate-inbox-cron.py' }), 'inbox-reply');
  assert.equal(classifyToolCall('Bash', { command: 'node scripts/post-everywhere.js' }), 'social-post');
  assert.equal(classifyToolCall('Read', { file_path: '/Users/me/.claude/screenshots/10.12.40 AM.png' }), 'screenshot-triage');
  assert.equal(classifyToolCall('Bash', { command: 'curl -s https://thumbgate.ai/go/pro-direct' }), 'checkout-pay-link');
  assert.equal(classifyToolCall('Bash', { command: 'git status' }), null);
  const open = decideToolCall({
    now: INSIDE,
    toolName: 'Bash',
    toolInput: { command: 'git status' },
    block: BLOCK,
  });
  assert.equal(open.reason, 'unclassified');
});

test('start writes a three-hour checkout-close block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-start-'));
  const blockPath = path.join(dir, 'focus-block.json');
  const record = startBlock({ now: STARTED, blockPath, blockMs: BLOCK_MS * 9 });
  assert.equal(record.blockMs, BLOCK_MS);
  assert.equal(record.objective, 'checkout-close');
  const decision = decideToolCall({
    now: INSIDE,
    toolName: 'Bash',
    toolInput: { command: 'node scripts/post-to-linkedin.js' },
    blockPath,
  });
  assert.equal(decision.decision, 'wait');
});

test('the pre-tool hook waits on the inbox driver during a block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-hook-'));
  const blockPath = path.join(dir, 'focus-block.json');
  fs.writeFileSync(blockPath, `${JSON.stringify(BLOCK)}\n`);
  const result = spawnSync(process.execPath, ['scripts/hook-pre-tool-use.js'], {
    cwd: path.resolve(__dirname, '..'),
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'python3 /Users/iganapolsky/.local/bin/fo-thumbgate-inbox-cron.py' },
    }),
    encoding: 'utf8',
    env: { ...process.env, THUMBGATE_FOCUS_BLOCK_PATH: blockPath },
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.decision, 'block');
  assert.match(parsed.reason, /checkout close/);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
});
