'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  generateSilentFailureCandidates,
  redactSecrets,
  normalizePaths,
  normalizeForSignature,
  extractToolEvents,
  pairCallsWithResults,
  isFailedCall,
  hasAdjacentFeedback,
  argsToSignature,
  clusterFailures,
  candidateFromCluster,
  MIN_CLUSTER_SIZE,
  MIN_DAILY_CALLS_FOR_USEFUL_CLUSTERING,
} = require('../scripts/silent-failure-cluster');

function makeTmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sfc-${label}-`));
}

function writeJsonl(filePath, entries) {
  fs.writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function isoOffset(minutesAgo) {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
}

function makeCall({ id, tool, args, timestamp }) {
  return { type: 'tool_call', tool, args, callId: id, timestamp };
}

function makeResult({ id, exit_code, output, timestamp, is_error }) {
  return {
    type: 'tool_result',
    tool_use_id: id,
    exit_code,
    output: output || '',
    is_error: Boolean(is_error),
    timestamp,
  };
}

// Synthesize N identical Bash failures so they form a clusterable group.
function synthFailureGroup({ tool = 'Bash', args, count, baseTime = isoOffset(60) }) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const id = `${tool}-${args.command || args.file_path || 'x'}-${i}`;
    const ts = new Date(Date.parse(baseTime) + i * 1000).toISOString();
    out.push(makeCall({ id, tool, args, timestamp: ts }));
    out.push(makeResult({ id, exit_code: 1, output: 'Error: thing failed', timestamp: ts }));
  }
  return out;
}

function synthSuccessGroup({ tool = 'Bash', args, count, baseTime = isoOffset(60) }) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const id = `${tool}-ok-${i}`;
    const ts = new Date(Date.parse(baseTime) + i * 1000).toISOString();
    out.push(makeCall({ id, tool, args, timestamp: ts }));
    out.push(makeResult({ id, exit_code: 0, output: 'ok', timestamp: ts }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

test('redactSecrets — strips github personal access token', () => {
  const input = 'authorization: ghp_0000000000000000000000000000000000000';
  const out = redactSecrets(input);
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /ghp_0000/);
});

test('redactSecrets — strips sk-ant- key', () => {
  // Low-entropy obviously-fake fixture (matches sk-ant- regex without
  // tripping ggshield's PAT-shape heuristic — see .gitguardian.yaml).
  const input = 'ANTHROPIC_API_KEY=sk-ant-0000000000000000000000000000000000';
  const out = redactSecrets(input);
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /sk-ant-0000/);
});

test('redactSecrets — strips sk-proj- and npm_ and AKIA tokens', () => {
  // All three are obviously-fake low-entropy strings. They match the redaction
  // regex shapes but don't trip ggshield's heuristic detectors.
  const inputs = [
    'OPENAI_KEY=sk-proj-00000000000000000000000000',
    'NPM_TOKEN=npm_00000000000000000000000000000000',
    'AWS_ACCESS_KEY_ID=AKIA0000000000000000',
  ];
  for (const i of inputs) {
    const out = redactSecrets(i);
    assert.match(out, /\[REDACTED\]/, `failed to redact: ${i}`);
  }
});

test('redactSecrets — strips JWT', () => {
  const jwt = 'eyJ0000000000000000000000000.eyJ00000000000.0000000000000000';
  const out = redactSecrets(`token=${jwt}`);
  assert.match(out, /\[REDACTED-JWT\]/);
});

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

test('normalizePaths — replaces /Users/<name>/ with <HOME>', () => {
  const input = '/Users/alice/projects/foo/bar.js';
  assert.equal(normalizePaths(input), '<HOME>/projects/foo/bar.js');
});

test('normalizePaths — replaces /home/<name>/ with <HOME>', () => {
  const input = '/home/bob/code/x.py';
  assert.equal(normalizePaths(input), '<HOME>/code/x.py');
});

test('normalizePaths — replaces process.env.HOME prefix with <HOME>', () => {
  const home = process.env.HOME || os.homedir();
  if (!home) return;
  const input = `${home}/some/path`;
  assert.equal(normalizePaths(input), '<HOME>/some/path');
});

test('normalizePaths — replaces /tmp/<random> with /tmp/<X>', () => {
  const input = '/tmp/xyzABC123/file.txt';
  assert.equal(normalizePaths(input), '/tmp/<X>/file.txt');
});

// ---------------------------------------------------------------------------
// Tool event extraction
// ---------------------------------------------------------------------------

test('extractToolEvents — extracts from simplified fixture shape', () => {
  const entries = [
    { type: 'tool_call', tool: 'Bash', args: { command: 'ls' }, callId: 'a1', timestamp: isoOffset(1) },
    { type: 'tool_result', tool_use_id: 'a1', exit_code: 0, output: 'ok', timestamp: isoOffset(1) },
  ];
  const events = entries.flatMap(extractToolEvents);
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'call');
  assert.equal(events[0].tool, 'Bash');
  assert.equal(events[1].kind, 'result');
  assert.equal(events[1].exitCode, 0);
});

test('extractToolEvents — extracts from Claude Code transcript shape', () => {
  const assistantEntry = {
    type: 'assistant',
    timestamp: isoOffset(2),
    message: {
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'npm test' } },
      ],
    },
  };
  const resultEntry = {
    type: 'user',
    timestamp: isoOffset(2),
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'tu_1', content: 'Error: test failed', is_error: true },
      ],
    },
  };
  const events = [...extractToolEvents(assistantEntry), ...extractToolEvents(resultEntry)];
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'call');
  assert.equal(events[0].tool, 'Bash');
  assert.equal(events[1].kind, 'result');
  assert.equal(events[1].isError, true);
});

// ---------------------------------------------------------------------------
// Failure filter
// ---------------------------------------------------------------------------

test('isFailedCall — exit_code != 0 is a failure', () => {
  const pair = {
    call: { kind: 'call', tool: 'Bash', args: { command: 'x' } },
    result: { kind: 'result', exitCode: 2, output: '' },
  };
  assert.equal(isFailedCall(pair), true);
});

test('isFailedCall — exit_code 0 with clean output is a success', () => {
  const pair = {
    call: { kind: 'call', tool: 'Bash', args: { command: 'x' } },
    result: { kind: 'result', exitCode: 0, output: 'all good' },
  };
  assert.equal(isFailedCall(pair), false);
});

test('isFailedCall — exit_code 0 BUT output matches ERROR_PATTERNS is a failure', () => {
  const pair = {
    call: { kind: 'call', tool: 'Bash', args: { command: 'x' } },
    result: { kind: 'result', exitCode: 0, output: 'TypeError: cannot read property x of undefined' },
  };
  assert.equal(isFailedCall(pair), true);
});

test('isFailedCall — is_error=true is a failure regardless of exit_code', () => {
  const pair = {
    call: { kind: 'call', tool: 'Bash', args: { command: 'x' } },
    result: { kind: 'result', exitCode: 0, output: 'fine', isError: true },
  };
  assert.equal(isFailedCall(pair), true);
});

// ---------------------------------------------------------------------------
// Feedback proximity exclusion
// ---------------------------------------------------------------------------

test('hasAdjacentFeedback — true if within ±5min', () => {
  const now = Date.now();
  const callTs = new Date(now).toISOString();
  const feedbacks = [now - 2 * 60 * 1000];
  assert.equal(hasAdjacentFeedback(callTs, feedbacks), true);
});

test('hasAdjacentFeedback — false if outside ±5min', () => {
  const now = Date.now();
  const callTs = new Date(now).toISOString();
  const feedbacks = [now - 10 * 60 * 1000];
  assert.equal(hasAdjacentFeedback(callTs, feedbacks), false);
});

test('hasAdjacentFeedback — false when no feedback log', () => {
  assert.equal(hasAdjacentFeedback(isoOffset(1), []), false);
});

// ---------------------------------------------------------------------------
// Signature & clustering
// ---------------------------------------------------------------------------

test('argsToSignature — Bash command normalized + redacted', () => {
  const sig = argsToSignature('Bash', { command: 'curl -H "Authorization: Bearer ghp_0000000000000000000000000000000000000" https://api' });
  assert.match(sig, /^Bash:/);
  assert.match(sig, /\[REDACTED\]/);
});

test('argsToSignature — Read file_path normalized', () => {
  const sig = argsToSignature('Read', { file_path: '/Users/alice/proj/x.js' });
  assert.equal(sig, 'Read:<HOME>/proj/x.js');
});

test('clusterFailures — enforces min cluster size 3', () => {
  const failures = [
    { tool: 'Bash', args: { command: 'foo --bar' }, output: 'Error', timestamp: isoOffset(5) },
    { tool: 'Bash', args: { command: 'foo --bar' }, output: 'Error', timestamp: isoOffset(4) },
    // only 2 — not a cluster
  ];
  const clusters = clusterFailures(failures);
  assert.equal(clusters.length, 0);
});

test('clusterFailures — emits cluster when >= 3 identical signatures', () => {
  const failures = [
    { tool: 'Bash', args: { command: 'foo --bar' }, output: 'Error', timestamp: isoOffset(5) },
    { tool: 'Bash', args: { command: 'foo --bar' }, output: 'Error', timestamp: isoOffset(4) },
    { tool: 'Bash', args: { command: 'foo --bar' }, output: 'Error', timestamp: isoOffset(3) },
  ];
  const clusters = clusterFailures(failures);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].size, 3);
});

// ---------------------------------------------------------------------------
// Candidate emission — origin field
// ---------------------------------------------------------------------------

test('candidateFromCluster — sets origin: silent-failure-cluster', () => {
  const cluster = {
    signature: 'Bash:foo --bar --baz', tool: 'Bash', size: 5,
    sampleArgs: '{"command":"foo --bar --baz"}', sampleOutput: 'Error: thing',
  };
  const cand = candidateFromCluster(cluster);
  assert.equal(cand.origin, 'silent-failure-cluster');
  assert.equal(cand.source, 'silent-failure-cluster');
  assert.ok(cand.pattern && cand.pattern.length > 0);
  assert.ok(cand.message.includes('Silent-failure'));
});

// ---------------------------------------------------------------------------
// End-to-end: generateSilentFailureCandidates
// ---------------------------------------------------------------------------

test('generateSilentFailureCandidates — insufficient-data path returns empty + skippedReason', () => {
  const dir = makeTmpDir('insufficient');
  const logPath = path.join(dir, 'conv.jsonl');
  writeJsonl(logPath, synthFailureGroup({ args: { command: 'flaky' }, count: 5 }));

  const result = generateSilentFailureCandidates({
    logPaths: [logPath],
    minDailyCalls: 100, // higher than what's in the log
  });

  assert.deepEqual(result.candidates, []);
  assert.ok(result.stats.skippedReason && result.stats.skippedReason.includes('insufficient-data'));
});

test('generateSilentFailureCandidates — clusters failures and emits candidates with origin', () => {
  const dir = makeTmpDir('happy');
  const logPath = path.join(dir, 'conv.jsonl');
  // 60 total calls: 6 failed at the same signature + 54 successes => above 50 threshold
  const entries = [
    ...synthFailureGroup({ args: { command: 'npm run flaky-test' }, count: 6 }),
    ...synthSuccessGroup({ args: { command: 'npm test' }, count: 54 }),
  ];
  writeJsonl(logPath, entries);

  const result = generateSilentFailureCandidates({
    logPaths: [logPath],
    minDailyCalls: 50,
  });

  assert.ok(result.candidates.length >= 1, `expected >=1 candidate, got ${result.candidates.length}`);
  for (const c of result.candidates) {
    assert.equal(c.origin, 'silent-failure-cluster');
  }
  assert.equal(result.stats.failedCalls, 6);
  assert.ok(result.stats.clusters >= 1);
  assert.equal(result.stats.skippedReason, null);
});

test('generateSilentFailureCandidates — excludes failures within ±5min of feedback-log entry', () => {
  const dir = makeTmpDir('feedback-exclude');
  const logPath = path.join(dir, 'conv.jsonl');
  const feedbackLogPath = path.join(dir, 'feedback-log.jsonl');

  // Anchor all failures around a known time so we can place the feedback nearby.
  const anchor = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const failureEntries = synthFailureGroup({
    args: { command: 'rm -rf protected/path' },
    count: 6,
    baseTime: anchor,
  });
  const successPadding = synthSuccessGroup({ args: { command: 'ls' }, count: 60 });
  writeJsonl(logPath, [...failureEntries, ...successPadding]);

  // Feedback within 1 minute of the anchor — should mask ALL 6 failures
  // (they were synthesized 1s apart, well within ±5min of feedback).
  writeJsonl(feedbackLogPath, [
    { timestamp: new Date(Date.parse(anchor) + 30 * 1000).toISOString(), thumb: 'down' },
  ]);

  const result = generateSilentFailureCandidates({
    logPaths: [logPath],
    feedbackLogPath,
    minDailyCalls: 50,
  });

  assert.equal(result.stats.filteredByFeedback, 6, `expected 6 filtered, got ${result.stats.filteredByFeedback}`);
  // After filtering, no failures remain in this signature, so no clusters.
  assert.equal(result.candidates.length, 0);
});

test('generateSilentFailureCandidates — only exit_code != 0 (or error-pattern match) survives', () => {
  const dir = makeTmpDir('exit-filter');
  const logPath = path.join(dir, 'conv.jsonl');
  // 50 success + 4 silently-failed (exit_code !=0, identical signature) + 1 success-with-no-error
  const entries = [
    ...synthSuccessGroup({ args: { command: 'echo hello' }, count: 50 }),
    ...synthFailureGroup({ args: { command: 'broken-cmd' }, count: 4 }),
  ];
  writeJsonl(logPath, entries);

  const result = generateSilentFailureCandidates({
    logPaths: [logPath],
    minDailyCalls: 50,
  });

  assert.equal(result.stats.failedCalls, 4);
  assert.equal(result.stats.clusters, 1);
  assert.equal(result.candidates[0].origin, 'silent-failure-cluster');
});

test('generateSilentFailureCandidates — normalized paths in cluster signature (Read tool)', () => {
  const dir = makeTmpDir('path-norm');
  const logPath = path.join(dir, 'conv.jsonl');
  // 3 failures on Read with different per-user paths but same logical path → must cluster
  const baseEntries = [];
  let i = 0;
  for (const userHome of ['/Users/alice', '/Users/bob', '/Users/carol']) {
    const id = `read-${i}`;
    baseEntries.push({ type: 'tool_call', tool: 'Read', args: { file_path: `${userHome}/proj/missing.txt` }, callId: id, timestamp: isoOffset(10 + i) });
    baseEntries.push({ type: 'tool_result', tool_use_id: id, exit_code: 1, output: 'Error: ENOENT', timestamp: isoOffset(10 + i) });
    i += 1;
  }
  // pad to clear the ≥50 daily threshold
  const padding = synthSuccessGroup({ args: { command: 'ls' }, count: 60 });
  writeJsonl(logPath, [...baseEntries, ...padding]);

  const result = generateSilentFailureCandidates({
    logPaths: [logPath],
    minDailyCalls: 50,
  });

  // After normalization the three reads share the SAME signature.
  assert.equal(result.stats.clusters, 1, `expected 1 cluster (paths normalized), got ${result.stats.clusters}`);
});

test('generateSilentFailureCandidates — secret in args is redacted in emitted candidate', () => {
  const dir = makeTmpDir('secret-redact');
  const logPath = path.join(dir, 'conv.jsonl');
  const fakeSecret = 'ghp_0000000000000000000000000000000000000';
  const entries = [
    ...synthFailureGroup({ args: { command: `curl -H "Authorization: Bearer ${fakeSecret}" https://x` }, count: 4 }),
    ...synthSuccessGroup({ args: { command: 'ls' }, count: 60 }),
  ];
  writeJsonl(logPath, entries);

  const result = generateSilentFailureCandidates({
    logPaths: [logPath],
    minDailyCalls: 50,
  });

  assert.ok(result.candidates.length >= 1);
  for (const c of result.candidates) {
    const blob = JSON.stringify(c);
    assert.doesNotMatch(blob, /ghp_0000/, 'candidate must not contain raw GitHub token');
  }
});

test('module exports — constants are stable', () => {
  assert.equal(MIN_CLUSTER_SIZE, 3);
  assert.equal(MIN_DAILY_CALLS_FOR_USEFUL_CLUSTERING, 50);
});

test('pairCallsWithResults — drops orphan results (no matching call)', () => {
  const events = [
    { kind: 'result', callId: 'orphan', exitCode: 1, output: 'nope' },
  ];
  assert.deepEqual(pairCallsWithResults(events), []);
});

test('normalizeForSignature — redaction happens before path replacement', () => {
  // A token that happens to contain "/Users/" should still be redacted first.
  const out = normalizeForSignature('sk-ant-0000000000000000000000000000000000');
  assert.match(out, /\[REDACTED\]/);
});
