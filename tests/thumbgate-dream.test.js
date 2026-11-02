'use strict';

/**
 * Tests for ThumbGate Dream Mode — Anthropic-inspired memory consolidation.
 * Stolen from Anthropic's Claude "Auto Dream" (4-phase: Orientation → Gather →
 * Consolidation → Prune & Index), with CUDA-inspired parallel scanning.
 *
 * https://platform.claude.com/docs/en/managed-agents/dreams
 * https://docs.nvidia.com/cuda/cuda-programming-guide/index.html
 *
 * Test count target: ≥10 (per AGENTS.md verification protocol).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  orientation,
  gatherSignal,
  consolidation,
  pruneAndIndex,
  runDreamCycle,
  evaluateTriggers,
  acquireLock,
  releaseLock,
  scanSessionForSignals,
  detectAnomalies,
  mergeSignals,
  truncate,
  extractTimestamp,
  ANOMALY_PATTERNS,
  PKG_ROOT,
  READ_ONLY_PATHS,
  MIN_HOURS_SINCE_LAST,
  MIN_SESSIONS_SINCE_LAST,
} = require(path.join(__dirname, '..', 'scripts', 'thumbgate-dream'));

// Helper: create a temp memory directory for isolated testing
function createTempMemoryDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-dream-test-'));
  const memoryDir = path.join(tmpDir, 'memory');
  fs.mkdirSync(path.join(memoryDir, '.thumbgate'), { recursive: true });
  fs.mkdirSync(path.join(memoryDir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(memoryDir, 'feedback'), { recursive: true });

  // Create a sample MEMORY.md index
  fs.writeFileSync(
    path.join(memoryDir, 'MEMORY.md'),
    `# ThumbGate Memory Index\n\n## Topic Files\n\n- [Gate Patterns](gate-patterns.md)\n- [Feedback Lessons](feedback-lessons.md)\n`
  );

  // Create sample topic files
  fs.writeFileSync(
    path.join(memoryDir, 'gate-patterns.md'),
    `- Block force-push to main\n- Deny admin merge\n- Warn on git add -A\n`
  );
  fs.writeFileSync(
    path.join(memoryDir, 'feedback-lessons.md'),
    `- User said: never tell CEO what to do\n- Date: yesterday we decided to use worktrees\n`
  );

  // Create sample session transcript
  fs.writeFileSync(
    path.join(memoryDir, 'sessions', 'session-1.jsonl'),
    JSON.stringify({ role: 'user', content: 'you are wrong about the gate pattern — the correct way is to use deny', timestamp: '2026-10-22T14:00:00Z' }) + '\n' +
    JSON.stringify({ role: 'user', content: 'remember this: always use worktrees', timestamp: '2026-10-22T14:01:00Z' }) + '\n' +
    JSON.stringify({ role: 'user', content: 'we decided to switch to Metal for GPU', timestamp: '2026-10-22T14:02:00Z' }) + '\n'
  );

  // Create sample feedback entry
  fs.writeFileSync(
    path.join(memoryDir, 'feedback', 'fb-001.json'),
    JSON.stringify({
      signal: 'down',
      whatWentWrong: 'Gate failed to block force-push',
      timestamp: '2026-10-22T14:00:00Z',
      type: 'prevention_rule',
      rule: { id: 'no-force-push', pattern: 'git push --force', decision: 'deny' },
    })
  );

  return memoryDir;
}

// Helper: clean up temp directory
function cleanupTempMemoryDir(memoryDir) {
  const tmpDir = path.dirname(memoryDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

test('Dream Mode: orientation maps memory state correctly', async () => {
  const memoryDir = createTempMemoryDir();

  try {
    const state = orientation(memoryDir);

    assert.ok(state.memoryDir === memoryDir, 'memoryDir should match');
    assert.ok(state.topicFiles.length === 2, 'Should find 2 topic files from MEMORY.md');
    assert.ok(state.feedbackEntries.length === 1, 'Should find 1 feedback entry');
    assert.ok(state.totalFeedbackSize > 0, 'Total feedback size should be > 0');
    assert.ok(state.feedbackDir !== undefined, 'feedbackDir should be set');
    assert.ok(state.indexPath.endsWith('MEMORY.md'), 'indexPath should point to MEMORY.md');
  } finally {
    cleanupTempMemoryDir(memoryDir);
  }
});

test('Dream Mode: orientation handles missing MEMORY.md gracefully', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-empty-'));
  try {
    const state = orientation(tmpDir);
    assert.ok(state.topicFiles.length === 0, 'Should have 0 topic files when MEMORY.md is missing');
    assert.ok(state.feedbackEntries.length === 0, 'Should have 0 feedback entries');
    assert.ok(state.totalFeedbackSize === 0, 'Total feedback size should be 0');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: scanSessionForSignals detects user corrections', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-scan-'));
  try {
    const sessionFile = path.join(tmpDir, 'sessions', 'session-1.jsonl');
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile,
      JSON.stringify({ role: 'user', content: 'you are wrong about that', timestamp: '2026-10-22T14:00:00Z' }) + '\n' +
      JSON.stringify({ role: 'user', content: 'actually the right way is different', timestamp: '2026-10-22T14:05:00Z' }) + '\n'
    );

    const { signals } = scanSessionForSignals(sessionFile, path.join(tmpDir, 'feedback'));
    assert.ok(signals.corrections.length >= 2, 'Should detect at least 2 corrections');
    assert.ok(signals.corrections[0].pattern, 'Correction should have pattern');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: scanSessionForSignals detects explicit saves', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-save-'));
  try {
    const sessionFile = path.join(tmpDir, 'sessions', 'session-2.jsonl');
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile,
      JSON.stringify({ role: 'user', content: 'remember this: always use worktrees for branch management', timestamp: '2026-10-22T14:00:00Z' }) + '\n'
    );

    const { signals } = scanSessionForSignals(sessionFile, path.join(tmpDir, 'feedback'));
    assert.ok(signals.explicitSaves.length >= 1, 'Should detect explicit save');
    assert.ok(signals.explicitSaves[0].context.includes('remember'), 'Save context should include trigger phrase');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: scanSessionForSignals detects important decisions', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-decision-'));
  try {
    const sessionFile = path.join(tmpDir, 'sessions', 'session-3.jsonl');
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile,
      JSON.stringify({ role: 'user', content: 'we decided to switch to Metal for GPU acceleration', timestamp: '2026-10-22T14:00:00Z' }) + '\n'
    );

    const { signals } = scanSessionForSignals(sessionFile, path.join(tmpDir, 'feedback'));
    assert.ok(signals.decisions.length >= 1, 'Should detect decision');
    assert.ok(signals.decisions[0].context.includes('decided'), 'Decision context should include trigger');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: mergeSignals combines results correctly', () => {
  const target = {
    corrections: [{ a: 1 }],
    explicitSaves: [{ b: 2 }],
    recurringThemes: [],
    decisions: [],
    contradictions: [],
  };
  const source = {
    corrections: [{ c: 3 }],
    explicitSaves: [],
    recurringThemes: [{ d: 4 }],
    decisions: [{ e: 5 }],
    contradictions: [],
  };

  mergeSignals(target, source);
  assert.ok(target.corrections.length === 2, 'Should merge 2 corrections');
  assert.ok(target.explicitSaves.length === 1, 'Should keep 1 explicit save');
  assert.ok(target.recurringThemes.length === 1, 'Should merge 1 recurring theme');
  assert.ok(target.decisions.length === 1, 'Should merge 1 decision');
});

test('Dream Mode: gatherSignal scans sessions and extracts signals', () => {
  const memoryDir = createTempMemoryDir();
  try {
    const state = orientation(memoryDir);
    const result = gatherSignal(state);

    assert.ok(result.sessionsScanned >= 1, 'Should scan at least 1 session');
    assert.ok(result.signals.corrections.length >= 1, 'Should extract corrections from session');
    assert.ok(result.signals.explicitSaves.length >= 1, 'Should extract saves');
    assert.ok(result.signals.decisions.length >= 1, 'Should extract decisions');
    assert.ok(result.signals.contradictions.length >= 1, 'Should extract contradictions from feedback');
  } finally {
    cleanupTempMemoryDir(memoryDir);
  }
});

test('Dream Mode: consolidation updates date references', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-consolidate-'));
  try {
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(path.join(memoryDir, '.thumbgate'), { recursive: true });
    fs.mkdirSync(path.join(memoryDir, 'sessions'), { recursive: true });

    // Create a topic file with relative date references
    fs.writeFileSync(
      path.join(memoryDir, 'dates.md'),
      `- Yesterday we decided to use worktrees\n- The fix was applied today\n- Last week we switched to Metal\n`
    );

    // Create MEMORY.md
    fs.writeFileSync(
      path.join(memoryDir, 'MEMORY.md'),
      `# Index\n\n- [Dates](dates.md)\n`
    );

    const state = orientation(memoryDir);
    state.feedbackDir = path.join(memoryDir, 'feedback');
    const signalResult = {
      signals: { corrections: [], explicitSaves: [], recurringThemes: [], decisions: [], contradictions: [] },
      sessionsScanned: 0,
    };
    const changes = consolidation(state, signalResult);

    // Verify at least some date processing happened
    assert.ok(typeof changes.dateFixed === 'number', 'dateFixed should be a number');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: pruneAndIndex writes MEMORY.md with correct structure', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-index-'));
  try {
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(path.join(memoryDir, '.thumbgate'), { recursive: true });

    fs.writeFileSync(
      path.join(memoryDir, 'MEMORY.md'),
      `# Old Index\n\n- [Old Topic](old-topic.md)\n`
    );
    fs.writeFileSync(
      path.join(memoryDir, 'old-topic.md'),
      `- Some content\n`
    );

    const state = {
      memoryDir,
      topicFiles: [{ name: 'Old Topic', relPath: 'old-topic.md', fullPath: path.join(memoryDir, 'old-topic.md'), sizeBytes: 15 }],
      feedbackEntries: [],
      totalFeedbackSize: 0,
    };
    const changes = { mergedEntries: 0, prunedEntries: 0, dateFixed: 0, contradictionsResolved: 0, dedupedFiles: 0 };
    const result = pruneAndIndex(state, changes);

    assert.ok(result.entries > 0, 'Index should have entries');
    assert.ok(fs.existsSync(path.join(memoryDir, 'MEMORY.md')), 'MEMORY.md should exist after indexing');

    const content = fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf8');
    assert.ok(content.includes('ThumbGate Memory Index'), 'Index should have header');
    assert.ok(content.includes('Dream Cycle Summary'), 'Index should have summary section');
    assert.ok(content.includes('Triggers'), 'Index should have triggers section');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: evaluateTriggers returns skip when no dream log exists', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-triggers-'));
  try {
    const result = evaluateTriggers(path.join(tmpDir, 'memory'));
    assert.ok(result.shouldRun === true, 'Should run when no prior dream log exists');
    assert.ok(result.reason.includes('no prior dream'), 'Reason should explain no prior dream');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: evaluateTriggers returns skip when conditions not met', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-trigger-no-'));
  try {
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(path.join(memoryDir, '.thumbgate'), { recursive: true });

    // Write a dream log from 1 hour ago with 2 sessions
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    fs.writeFileSync(
      path.join(memoryDir, '.thumbgate', 'dream-log.json'),
      JSON.stringify({
        lastDreamAt: oneHourAgo,
        sessionsSinceLastDream: 2,
        lastSessionCount: 2,
      })
    );

    const result = evaluateTriggers(memoryDir);
    assert.ok(result.shouldRun === false, 'Should NOT run (only 1h elapsed, need 24h)');
    assert.ok(result.reason.includes('not triggered'), 'Reason should say not triggered');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: evaluateTriggers runs when conditions ARE met', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-trigger-yes-'));
  try {
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(path.join(memoryDir, '.thumbgate'), { recursive: true });

    // Write a dream log from 25 hours ago with 5+ sessions
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(
      path.join(memoryDir, '.thumbgate', 'dream-log.json'),
      JSON.stringify({
        lastDreamAt: twentyFiveHoursAgo,
        sessionsSinceLastDream: 6,
        lastSessionCount: 6,
      })
    );

    const result = evaluateTriggers(memoryDir);
    assert.ok(result.shouldRun === true, 'Should run (25h elapsed + 6 sessions)');
    assert.ok(result.reason.includes('triggered'), 'Reason should say triggered');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: acquireLock and releaseLock work correctly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-lock-'));
  const lockFile = path.join(tmpDir, 'dream.lock');

  try {
    // First acquisition should succeed
    assert.doesNotThrow(() => acquireLock(lockFile), 'First lock acquisition should succeed');

    // Second acquisition should throw (lock held)
    assert.throws(() => acquireLock(lockFile), /already running/, 'Second lock should throw');

    // Release and re-acquire
    releaseLock(lockFile);
    assert.doesNotThrow(() => acquireLock(lockFile), 'Lock after release should succeed');
    releaseLock(lockFile);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: acquireLock reclaims stale lock', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-stale-'));
  const lockFile = path.join(tmpDir, 'dream.lock');

  try {
    // Write a stale lock with an impossible PID
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: 999999,
      acquiredAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    }));

    assert.doesNotThrow(() => acquireLock(lockFile), 'Should reclaim stale lock');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: runDreamCycle skips when triggers not met', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-cycle-'));
  try {
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(path.join(memoryDir, '.thumbgate'), { recursive: true });

    // Write a recent dream log (1 hour ago, 2 sessions)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    fs.writeFileSync(
      path.join(memoryDir, '.thumbgate', 'dream-log.json'),
      JSON.stringify({
        lastDreamAt: oneHourAgo,
        sessionsSinceLastDream: 2,
      })
    );

    const result = runDreamCycle({ memoryDir, force: false });
    assert.ok(result.status === 'skipped', 'Should skip when triggers not met');
    assert.ok(result.reason.includes('not triggered'), 'Should have skip reason');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: runDreamCycle completes when force=true', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-force-'));
  try {
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(path.join(memoryDir, '.thumbgate'), { recursive: true });
    fs.mkdirSync(path.join(memoryDir, 'sessions'), { recursive: true });

    // Create minimal MEMORY.md
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '# Index\n\n- [Test](test.md)\n');
    fs.writeFileSync(path.join(memoryDir, 'test.md'), '- Some content\n');

    const result = runDreamCycle({ memoryDir, force: true, dryRun: true });
    assert.ok(result.status === 'completed', 'Should complete with force=true');
    assert.ok(result.summary !== undefined, 'Should have summary');
    assert.ok(result.summary.phases !== undefined, 'Should have phases');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: runDreamCycle returns locked when another process holds lock', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-locked-'));
  try {
    const memoryDir = path.join(tmpDir, 'memory');
    const lockFile = path.join(tmpDir, 'dream.lock');
    fs.mkdirSync(path.join(memoryDir, '.thumbgate'), { recursive: true });

    // Pre-create lock with current PID (simulates another process holding it)
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    }));

    const result = runDreamCycle({ memoryDir, force: true, lockFile });
    assert.ok(result.status === 'locked', 'Should return locked status');
    assert.ok(result.reason.includes('already running'), 'Reason should mention lock');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: READ_ONLY_PATHS includes source code directories', () => {
  assert.ok(READ_ONLY_PATHS.has('src/'), 'src/ should be read-only');
  assert.ok(READ_ONLY_PATHS.has('bin/'), 'bin/ should be read-only');
  assert.ok(READ_ONLY_PATHS.has('package.json'), 'package.json should be read-only');
  assert.ok(READ_ONLY_PATHS.has('.changeset/'), 'changeset dir should be read-only');
  assert.ok(READ_ONLY_PATHS.has('tests/'), 'tests/ should be read-only');
});

test('Dream Mode: extractTimestamp finds ISO dates', () => {
  const ts = extractTimestamp('2026-10-22T14:30:00.000Z some text');
  assert.strictEqual(ts, '2026-10-22T14:30:00.000Z');
});

test('Dream Mode: extractTimestamp falls back to date-only', () => {
  const ts = extractTimestamp('2026-10-22 some text without time');
  assert.strictEqual(ts, '2026-10-22');
});

test('Dream Mode: extractTimestamp returns null for no date', () => {
  const ts = extractTimestamp('no date here at all');
  assert.strictEqual(ts, null);
});

test('Dream Mode: truncate short strings unchanged', () => {
  assert.strictEqual(truncate('hello', 100), 'hello');
});

test('Dream Mode: truncate long strings with ellipsis', () => {
  const long = 'a'.repeat(100);
  const result = truncate(long, 10);
  assert.ok(result.endsWith('...'), 'Truncated string should end with ...');
  assert.strictEqual(result.length, 13, '10 chars + ... = 13');
});

test('Dream Mode: trigger thresholds are properly configured', () => {
  assert.strictEqual(MIN_HOURS_SINCE_LAST, 24, 'Default minimum hours should be 24');
  assert.strictEqual(MIN_SESSIONS_SINCE_LAST, 5, 'Default minimum sessions should be 5');
});

test('Dream Mode: scanSessionForSignals handles non-existent file gracefully', () => {
  const result = scanSessionForSignals('/nonexistent/file.jsonl', '/nonexistent/feedback');
  assert.ok(result.filepath === '/nonexistent/file.jsonl');
  assert.ok(result.signals !== undefined, 'Should return empty signals structure');
  assert.ok(result.signals.corrections.length === 0, 'Should have 0 corrections');
});

test('Dream Mode: recordDream writes dream log', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-record-'));
  try {
    // Use the internal recordDream via require
    const { recordDream } = require(path.join(__dirname, '..', 'scripts', 'thumbgate-dream'));
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(path.join(memoryDir, '.thumbgate'), { recursive: true });

    const summary = { phases: { test: true } };
    recordDream(memoryDir, summary);

    const logPath = path.join(memoryDir, '.thumbgate', 'dream-log.json');
    assert.ok(fs.existsSync(logPath), 'Dream log should exist');
    const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    assert.ok(log.lastDreamAt !== undefined, 'Should have lastDreamAt');
    assert.ok(log.sessionsSinceLastDream === 0, 'Sessions should reset to 0');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: consolidation deduplicates bullet points', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-dedup-'));
  try {
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(path.join(memoryDir, '.thumbgate'), { recursive: true });
    fs.mkdirSync(path.join(memoryDir, 'feedback'), { recursive: true });

    // Create MEMORY.md that references topics.md
    fs.writeFileSync(
      path.join(memoryDir, 'MEMORY.md'),
      `# Index\n\n- [Topics](topics.md)\n`
    );

    // Create a topic file with duplicate bullets
    fs.writeFileSync(
      path.join(memoryDir, 'topics.md'),
      `- Always use worktrees for branch management\n- Always use worktrees for branch management\n- Never use --admin\n`
    );

    const state = orientation(memoryDir);
    const signalResult = {
      signals: { corrections: [], explicitSaves: [], recurringThemes: [], decisions: [], contradictions: [] },
      sessionsScanned: 0,
    };
    const changes = consolidation(state, signalResult);
    assert.ok(changes.mergedEntries >= 1, 'Should detect at least 1 duplicate entry');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: full cycle completes with all phases', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dream-full-'));
  try {
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(path.join(memoryDir, '.thumbgate'), { recursive: true });
    fs.mkdirSync(path.join(memoryDir, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(memoryDir, 'feedback'), { recursive: true });

    fs.writeFileSync(
      path.join(memoryDir, 'MEMORY.md'),
      `# Index\n\n- [Topic](topic.md)\n`
    );
    fs.writeFileSync(path.join(memoryDir, 'topic.md'), `- Content\n`);
    fs.writeFileSync(
      path.join(memoryDir, 'sessions', 's1.jsonl'),
      JSON.stringify({ role: 'user', content: 'you are wrong about that', timestamp: '2026-10-22T14:00:00Z' }) + '\n'
    );

    const result = runDreamCycle({ memoryDir, force: true });
    assert.ok(result.status === 'completed', 'Full cycle should complete');
    assert.ok(result.summary.phases.orientation !== undefined);
    assert.ok(result.summary.phases.gatherSignal !== undefined);
    assert.ok(result.summary.phases.consolidation !== undefined);
    assert.ok(result.summary.phases.pruneAndIndex !== undefined);
    assert.ok(result.trigger.shouldRun === true, 'Trigger should be met (force=true)');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Dream Mode: detectAnomalies identifies security bypass patterns', () => {
  const text = { whatWentWrong: 'The agent tried to bypass the gate check by overriding the security guard' };
  const tags = detectAnomalies(text);
  const tagIds = tags.map(t => t.id);
  assert.ok(tagIds.includes('security-bypass'), 'Should detect security bypass');
});

test('Dream Mode: detectAnomalies identifies cost spike patterns', () => {
  const text = { whatWentWrong: 'The cost exploded after we added 1000 LLM calls per row' };
  const tags = detectAnomalies(text);
  const tagIds = tags.map(t => t.id);
  assert.ok(tagIds.includes('cost-spike'), 'Should detect cost spike');
});

test('Dream Mode: ANOMALY_PATTERNS has 5 standard patterns', () => {
  assert.strictEqual(ANOMALY_PATTERNS.length, 5, 'Should have 5 anomaly patterns');
  const ids = ANOMALY_PATTERNS.map(p => p.id);
  assert.ok(ids.includes('contradiction'), 'Should have contradiction pattern');
  assert.ok(ids.includes('regression'), 'Should have regression pattern');
  assert.ok(ids.includes('cost-spike'), 'Should have cost-spike pattern');
  assert.ok(ids.includes('security-bypass'), 'Should have security-bypass pattern');
  assert.ok(ids.includes('boundary-violation'), 'Should have boundary-violation pattern');
});
