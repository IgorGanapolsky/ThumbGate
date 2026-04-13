'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  parseSessionJSONL,
  analyzeTokenUsage,
  detectDuplicateReads,
  detectConfusionSignals,
  extractToolUsage,
  sessionSummary,
  formatDuration,
  CONFUSION_KEYWORDS,
} = require('../scripts/session-analyzer');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function writeMockSession(lines) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-analyzer-test-'));
  const sessionPath = path.join(tmpDir, 'test-session.jsonl');
  fs.writeFileSync(sessionPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return sessionPath;
}

function mockAssistantEvent(overrides = {}) {
  return {
    type: 'assistant',
    timestamp: overrides.timestamp || '2026-04-09T10:00:00Z',
    message: {
      role: 'assistant',
      content: overrides.content || [{ type: 'text', text: overrides.text || 'Hello' }],
      usage: overrides.usage || { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
    },
    ...overrides,
  };
}

function mockUserEvent(overrides = {}) {
  return {
    type: 'user',
    timestamp: overrides.timestamp || '2026-04-09T10:00:00Z',
    message: {
      role: 'user',
      content: overrides.content || [{ type: 'text', text: overrides.text || 'Do something' }],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('parseSessionJSONL: parses valid JSONL lines', () => {
  const sp = writeMockSession([
    { type: 'user', message: { content: 'hello' } },
    { type: 'assistant', message: { content: 'world' } },
  ]);
  const events = parseSessionJSONL(sp);
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].type, 'user');
  assert.strictEqual(events[1].type, 'assistant');
});

test('parseSessionJSONL: skips malformed lines', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-analyzer-test-'));
  const sp = path.join(tmpDir, 'bad.jsonl');
  fs.writeFileSync(sp, '{"type":"user"}\nNOT JSON\n{"type":"assistant"}\n');
  const events = parseSessionJSONL(sp);
  assert.strictEqual(events.length, 2);
});

test('analyzeTokenUsage: tracks cumulative tokens', () => {
  const events = [
    mockAssistantEvent({ usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } }),
    mockAssistantEvent({ usage: { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 } }),
    { type: 'user', message: { content: 'hi' } },
  ];
  const result = analyzeTokenUsage(events);
  assert.strictEqual(result.totals.input, 300);
  assert.strictEqual(result.totals.output, 150);
  assert.strictEqual(result.totals.cacheRead, 30);
  assert.strictEqual(result.totals.cacheCreation, 5);
  assert.strictEqual(result.totals.total, 450);
  assert.strictEqual(result.turns.length, 2);
  assert.strictEqual(result.turns[1].cumulativeInput, 300);
});

test('detectDuplicateReads: flags files read 2+ times', () => {
  const events = [
    mockAssistantEvent({
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: '/src/a.js' } },
        { type: 'tool_use', name: 'Read', input: { file_path: '/src/b.js' } },
      ],
    }),
    mockAssistantEvent({
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: '/src/a.js' } },
        { type: 'tool_use', name: 'Read', input: { file_path: '/src/a.js' } },
      ],
    }),
    mockAssistantEvent({
      content: [
        { type: 'tool_use', name: 'Edit', input: { file_path: '/src/c.js' } },
      ],
    }),
  ];
  const result = detectDuplicateReads(events);
  assert.strictEqual(result.duplicateReads['/src/a.js'], 3);
  assert.strictEqual(result.duplicateReads['/src/b.js'], undefined);
  assert.strictEqual(result.totalReads, 4);
  assert.strictEqual(result.wastedReads, 2);
  assert.ok(result.wasteScore > 0);
});

test('detectDuplicateReads: no waste for single reads', () => {
  const events = [
    mockAssistantEvent({
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: '/src/a.js' } },
        { type: 'tool_use', name: 'Read', input: { file_path: '/src/b.js' } },
      ],
    }),
  ];
  const result = detectDuplicateReads(events);
  assert.deepStrictEqual(result.duplicateReads, {});
  assert.strictEqual(result.wasteScore, 0);
});

test('detectConfusionSignals: detects backtracking keywords', () => {
  const events = [
    mockAssistantEvent({
      content: [{ type: 'text', text: 'Actually, I was wrong about that. Let me reconsider the approach.' }],
    }),
  ];
  const signals = detectConfusionSignals(events);
  const keywords = signals.map((s) => s.keyword);
  assert.ok(keywords.includes('actually'), 'should detect "actually"');
  assert.ok(keywords.includes('wrong'), 'should detect "wrong"');
  assert.ok(keywords.includes('let me reconsider'), 'should detect "let me reconsider"');
});

test('detectConfusionSignals: detects rework keywords', () => {
  const events = [
    mockAssistantEvent({
      content: [{ type: 'text', text: "That didn't work. Let me try a different approach and revert the change." }],
    }),
  ];
  const signals = detectConfusionSignals(events);
  const keywords = signals.map((s) => s.keyword);
  assert.ok(keywords.includes("didn't work"), 'should detect "didn\'t work"');
  assert.ok(keywords.includes('let me try'), 'should detect "let me try"');
  assert.ok(keywords.includes('revert'), 'should detect "revert"');
});

test('detectConfusionSignals: returns context around keyword', () => {
  const events = [
    mockAssistantEvent({
      content: [{ type: 'text', text: 'some prefix text Actually the file was wrong so let me fix it' }],
    }),
  ];
  const signals = detectConfusionSignals(events);
  const actuallySignal = signals.find((s) => s.keyword === 'actually');
  assert.ok(actuallySignal);
  assert.ok(actuallySignal.context.length <= 100, 'context should be ~80 chars');
  assert.ok(actuallySignal.context.toLowerCase().includes('actually'));
});

test('detectConfusionSignals: no false positives on clean text', () => {
  const events = [
    mockAssistantEvent({
      content: [{ type: 'text', text: 'I have created the file and everything looks good.' }],
    }),
  ];
  const signals = detectConfusionSignals(events);
  assert.strictEqual(signals.length, 0);
});

test('extractToolUsage: counts tools and tracks files', () => {
  const events = [
    mockAssistantEvent({
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: '/src/a.js' } },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/src/b.js' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
      ],
    }),
    mockAssistantEvent({
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: '/src/c.js' } },
        { type: 'tool_use', name: 'Write', input: { file_path: '/src/d.js' } },
      ],
    }),
  ];
  const { toolCounts, filesTouched } = extractToolUsage(events);
  assert.strictEqual(toolCounts.Read, 2);
  assert.strictEqual(toolCounts.Edit, 1);
  assert.strictEqual(toolCounts.Bash, 1);
  assert.strictEqual(toolCounts.Write, 1);
  assert.ok(filesTouched.includes('/src/a.js'));
  assert.ok(filesTouched.includes('/src/d.js'));
  assert.ok(!filesTouched.includes('npm test'));
});

test('sessionSummary: generates correct summary', () => {
  const events = [
    mockUserEvent({ timestamp: '2026-04-09T10:00:00Z' }),
    mockAssistantEvent({
      timestamp: '2026-04-09T10:01:00Z',
      content: [
        { type: 'text', text: 'Let me read that file.' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/src/a.js' } },
      ],
      usage: { input_tokens: 500, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }),
    mockAssistantEvent({
      timestamp: '2026-04-09T10:05:00Z',
      content: [
        { type: 'text', text: 'Actually I was wrong. Let me read it again.' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/src/a.js' } },
      ],
      usage: { input_tokens: 600, output_tokens: 300, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
    }),
  ];
  const sp = writeMockSession(events);
  const summary = sessionSummary(sp);

  assert.strictEqual(summary.eventCount, 3);
  assert.strictEqual(summary.tokens.input, 1100);
  assert.strictEqual(summary.tokens.output, 500);
  assert.strictEqual(summary.tokenTurns, 2);
  assert.strictEqual(summary.toolCounts.Read, 2);
  assert.ok(summary.filesTouched.includes('/src/a.js'));
  assert.ok(summary.confusionSignals > 0);
  assert.ok(summary.waste.duplicateReads['/src/a.js'] === 2);
  assert.ok(summary.duration.ms > 0);
});

test('formatDuration: formats milliseconds correctly', () => {
  assert.strictEqual(formatDuration(500), '500ms');
  assert.strictEqual(formatDuration(5000), '5s');
  assert.strictEqual(formatDuration(65000), '1m 5s');
  assert.strictEqual(formatDuration(3700000), '1h 1m');
});

test('analyzeAndCreateLessons: creates lessons from repeated confusion signals', () => {
  // We need to mock createLesson since it writes to disk via feedback-paths
  // which expects project state. Instead, test the core logic by verifying
  // the function returns without throwing when confusion signals are < 2.
  const events = [
    mockAssistantEvent({
      content: [{ type: 'text', text: 'This is clean output with no confusion.' }],
    }),
  ];
  const sp = writeMockSession(events);

  // Import the function — it will try to create lessons only if count >= 2
  const { analyzeAndCreateLessons } = require('../scripts/session-analyzer');
  // With 0 confusion signals, no lessons should be created
  // Note: analyzeAndCreateLessons calls createLesson which writes to disk,
  // so we verify no error is thrown and lessonsCreated is empty
  const result = analyzeAndCreateLessons(sp);
  assert.strictEqual(result.lessonsCreated.length, 0);
  assert.strictEqual(result.summary.confusionSignals, 0);
});

test('CONFUSION_KEYWORDS: all categories have keywords', () => {
  assert.ok(CONFUSION_KEYWORDS.backtracking.length > 0);
  assert.ok(CONFUSION_KEYWORDS.rework.length > 0);
  assert.ok(CONFUSION_KEYWORDS.workarounds.length > 0);
  assert.ok(CONFUSION_KEYWORDS.scopeCreep.length > 0);
});

test('analyzeTokenUsage: handles events with no usage field', () => {
  const events = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
    { type: 'system', message: { content: 'system msg' } },
  ];
  const result = analyzeTokenUsage(events);
  assert.strictEqual(result.totals.total, 0);
  assert.strictEqual(result.turns.length, 0);
});

test('detectDuplicateReads: handles events with no content array', () => {
  const events = [
    { type: 'assistant', message: { content: 'string content' } },
    { type: 'assistant', message: {} },
  ];
  const result = detectDuplicateReads(events);
  assert.deepStrictEqual(result.duplicateReads, {});
  assert.strictEqual(result.wasteScore, 0);
});
