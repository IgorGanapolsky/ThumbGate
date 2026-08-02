#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'scripts', 'hook-stop-anti-claim.js');

const {
  CLAIM_PATTERNS,
  PROOF_PATTERNS,
  findClaim,
  hasProof,
  extractText,
  extractToolUseSummary,
} = require('../scripts/hook-stop-anti-claim');

function writeTranscript(message) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-anticlaim-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(
    file,
    `${JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'go' }] } })}\n` +
      `${JSON.stringify({ type: 'assistant', message })}\n`
  );
  return file;
}

function runHook(transcriptPath, options = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ transcript_path: transcriptPath, ...(options.payload || {}) }),
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, ...(options.env || {}) },
  });
  return { stdout: res.stdout || '', stderr: res.stderr || '', status: res.status };
}

function makeVerifierRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-anticlaim-verifier-'));
  fs.mkdirSync(path.join(root, '.thumbgate'));
  fs.writeFileSync(path.join(root, 'README.md'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(root, '.thumbgate', 'claim-verifiers.json'), JSON.stringify({
    verifiers: [{
      id: 'readme-lines',
      kind: 'file_lines',
      match: { kinds: ['file_lines'], paths: ['README.md'] },
      path: 'README.md',
    }],
  }));
  return root;
}

test('findClaim matches "is live" / "deployed" / "fixed" wording', () => {
  assert.ok(findClaim('The feature is live now.'));
  assert.ok(findClaim('Deployed to production.'));
  assert.ok(findClaim('Everything is working.'));
  assert.ok(findClaim('Production-ready.'));
  assert.ok(findClaim('GitHub About metadata has been updated and verified.'));
  assert.ok(findClaim('The topics now match the GitHub repository metadata.'));
  assert.ok(findClaim('The sales tax calculation is correct and checkout charge is verified.'));
  assert.ok(findClaim('Customer-facing permissions are fixed.'));
});

test('findClaim ignores benign phrasing', () => {
  assert.equal(findClaim('live-streaming events'), null);
  assert.equal(findClaim('ready-made template'), null);
  assert.equal(findClaim('I plan to deploy this tomorrow.'), null);
  assert.equal(findClaim('Deployed yet? Not yet.'), null);
});

test('hasProof detects curl, gh, npm test, Bash() Read() tool calls', () => {
  assert.ok(hasProof('I ran curl https://prod/health'));
  assert.ok(hasProof('gh pr view 42'));
  assert.ok(hasProof('npm test ./tests/foo.test.js'));
  assert.ok(hasProof('Bash(command: "echo ok")'));
  assert.ok(hasProof('Read(file_path: "...")'));
});

test('hasProof returns false on unverified prose', () => {
  assert.equal(hasProof('Everything is working great.'), false);
  assert.equal(hasProof('I checked it.'), false);
});

test('hook emits reminder when claim has no proof in same turn', () => {
  const transcript = writeTranscript({
    content: [
      { type: 'text', text: 'The federal page is now live on production.' },
    ],
  });
  const { stdout } = runHook(transcript);
  assert.match(stdout, /anti-claim gate/i);
  assert.match(stdout, /is\s+live|now\s+live/i);
});

test('hook emits reminder for GitHub metadata verification claim with no proof', () => {
  const transcript = writeTranscript({
    content: [
      { type: 'text', text: 'GitHub About metadata has been updated and verified.' },
    ],
  });
  const { stdout } = runHook(transcript);
  assert.match(stdout, /anti-claim gate/i);
  assert.match(stdout, /GitHub About metadata/i);
});

test('hook emits reminder for commercial truth claims with no proof', () => {
  const transcript = writeTranscript({
    content: [
      { type: 'text', text: 'The sales tax calculation is correct and the checkout charge is verified.' },
    ],
  });
  const { stdout } = runHook(transcript);
  assert.match(stdout, /anti-claim gate/i);
  assert.match(stdout, /commercial truth/i);
});

test('hook stays silent when commercial truth claim has Stripe proof in the same turn', () => {
  const transcript = writeTranscript({
    content: [
      { type: 'text', text: 'The checkout charge is verified.' },
      { type: 'tool_use', name: 'Bash', input: { command: 'stripe checkout sessions retrieve cs_test_123' } },
    ],
  });
  const { stdout } = runHook(transcript);
  assert.equal(stdout.trim(), '');
});

test('hook stays silent when GitHub metadata claim has gh api proof in the same turn', () => {
  const transcript = writeTranscript({
    content: [
      { type: 'text', text: 'GitHub About metadata has been updated and verified.' },
      { type: 'tool_use', name: 'Bash', input: { command: 'gh api repos/IgorGanapolsky/ThumbGate --jq .description' } },
    ],
  });
  const { stdout } = runHook(transcript);
  assert.equal(stdout.trim(), '');
});

test('hook stays silent when claim is backed by a curl tool call in the same turn', () => {
  const transcript = writeTranscript({
    content: [
      { type: 'text', text: 'Verified — the federal page is live.' },
      { type: 'tool_use', name: 'Bash', input: { command: 'curl -s https://thumbgate-production.up.railway.app/federal | head' } },
    ],
  });
  const { stdout } = runHook(transcript);
  assert.equal(stdout.trim(), '');
});

test('findClaim catches the 2026-06-11 added completion phrases', () => {
  assert.ok(findClaim('All tests are green.'));
  assert.ok(findClaim('all green now'));
  assert.ok(findClaim('Tests passing.'));
  assert.ok(findClaim('All checks passed.'));
  assert.ok(findClaim('Verified.'));
  assert.ok(findClaim('Confirmed.'));
  assert.ok(findClaim('The build is stable.'));
  assert.ok(findClaim('All clear.'));
  assert.ok(findClaim('Good to go.'));
  assert.ok(findClaim('The race is over.'));
  assert.ok(findClaim('We are no longer racing.'));
});

test('added phrases still respect the proof-gate (claim + test run = silent)', () => {
  const transcript = writeTranscript({
    content: [
      { type: 'text', text: 'All tests pass.' },
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
    ],
  });
  const { stdout } = runHook(transcript);
  assert.equal(stdout.trim(), '');
});

test('added phrase fires the reminder when unproven', () => {
  const transcript = writeTranscript({
    content: [{ type: 'text', text: 'All green, the race is over.' }],
  });
  const { stdout } = runHook(transcript);
  assert.match(stdout, /anti-claim gate/i);
});

test('strict mode (THUMBGATE_STRICT_ENFORCEMENT=1) emits a block decision, not a reminder', () => {
  const transcript = writeTranscript({
    content: [{ type: 'text', text: 'Everything is done and verified.' }],
  });
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ transcript_path: transcript }),
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, THUMBGATE_STRICT_ENFORCEMENT: '1' },
  });
  const out = JSON.parse((res.stdout || '').trim());
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /anti-claim gate \(strict\)/i);
});

test('strict mode stays silent when the claim has proof', () => {
  const transcript = writeTranscript({
    content: [
      { type: 'text', text: 'Verified.' },
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
    ],
  });
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ transcript_path: transcript }),
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, THUMBGATE_STRICT_ENFORCEMENT: '1' },
  });
  assert.equal((res.stdout || '').trim(), '');
});

test('hook stays silent when no claim phrase appears', () => {
  const transcript = writeTranscript({
    content: [
      { type: 'text', text: 'Wrote the workflow file. CI will run on next push.' },
    ],
  });
  const { stdout } = runHook(transcript);
  assert.equal(stdout.trim(), '');
});

test('hook hard-blocks a factual mismatch without requiring an MCP tool call', () => {
  const root = makeVerifierRoot();
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      stop_hook_active: false,
      cwd: root,
      last_assistant_message: 'file README.md has 4 lines',
    }),
    encoding: 'utf8',
    timeout: 5000,
  });
  const out = JSON.parse((res.stdout || '').trim());
  assert.equal(out.decision, 'block');
  assert.equal(out.verification.verified, false);
  assert.equal(out.verification.failures[0].status, 'mismatch');
  assert.equal(out.verification.failures[0].actual, 3);
  fs.rmSync(root, { recursive: true, force: true });
});

test('hook allows a factual claim only after the configured source matches', () => {
  const root = makeVerifierRoot();
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      stop_hook_active: false,
      cwd: root,
      last_assistant_message: 'file README.md has 3 lines',
    }),
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal((res.stdout || '').trim(), '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('hook fails closed when a parsed factual claim has no configured verifier', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-anticlaim-unconfigured-'));
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      stop_hook_active: false,
      cwd: root,
      last_assistant_message: 'the row count is 1,284',
    }),
    encoding: 'utf8',
    timeout: 5000,
  });
  const out = JSON.parse((res.stdout || '').trim());
  assert.equal(out.decision, 'block');
  assert.equal(out.verification.failures[0].status, 'unconfigured');
  fs.rmSync(root, { recursive: true, force: true });
});

test('hook yields on the host correction retry marker', () => {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      stop_hook_active: true,
      last_assistant_message: 'the row count is 1,284',
    }),
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal((res.stdout || '').trim(), '');
});

test('hook is safe with missing transcript_path', () => {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({}),
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(res.status, 0);
  assert.equal((res.stdout || '').trim(), '');
});

test('extractText concatenates text blocks; extractToolUseSummary captures tool inputs', () => {
  const message = {
    content: [
      { type: 'text', text: 'Done.' },
      { type: 'tool_use', name: 'Bash', input: { command: 'echo ok' } },
      { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/x' } },
    ],
  };
  assert.equal(extractText(message), 'Done.');
  const summary = extractToolUseSummary(message);
  assert.match(summary, /Bash: echo ok/);
  assert.match(summary, /Read: \/tmp\/x/);
});

test('CLAIM_PATTERNS and PROOF_PATTERNS are exported as arrays of RegExp', () => {
  assert.ok(Array.isArray(CLAIM_PATTERNS) && CLAIM_PATTERNS.every((p) => p instanceof RegExp));
  assert.ok(Array.isArray(PROOF_PATTERNS) && PROOF_PATTERNS.every((p) => p instanceof RegExp));
});
