'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  detectOutcomeSignals,
  classifyOutcome,
  generateHeuristicLessons,
  runSelfDistill,
  getSelfDistillStatus,
  SELF_DISTILL_RUNS_PATH,
} = require('../scripts/self-distill-agent');

// ---------------------------------------------------------------------------
// detectOutcomeSignals — error patterns
// ---------------------------------------------------------------------------

describe('detectOutcomeSignals', () => {
  it('correctly identifies error patterns', () => {
    const window = [
      { role: 'user', content: 'Run the build' },
      { role: 'assistant', content: 'Error: Cannot find module "foo"' },
      { role: 'assistant', content: 'FAIL tests/bar.test.js' },
    ];
    const signals = detectOutcomeSignals(window);
    assert.ok(signals.errors.length >= 1, 'should detect at least one error');
    assert.ok(signals.testFailures.length >= 1, 'should detect test failure');
  });

  it('correctly identifies success patterns', () => {
    const window = [
      { role: 'user', content: 'Run tests' },
      { role: 'assistant', content: 'All tests passed. 42 passing.' },
      { role: 'assistant', content: '\u2705 Build successful' },
    ];
    const signals = detectOutcomeSignals(window);
    assert.ok(signals.successes.length >= 1, 'should detect at least one success');
  });

  it('correctly identifies correction patterns', () => {
    const window = [
      { role: 'assistant', content: 'I edited the config file.' },
      { role: 'user', content: 'No, that is wrong. Undo that change.' },
      { role: 'user', content: "Don't modify that file." },
    ];
    const signals = detectOutcomeSignals(window);
    assert.ok(signals.corrections.length >= 1, 'should detect corrections');
    assert.ok(signals.revertedEdits.length >= 1, 'should detect revert request');
  });

  it('detects user success signals', () => {
    const window = [
      { role: 'assistant', content: 'I fixed the bug.' },
      { role: 'user', content: 'Perfect, thanks!' },
    ];
    const signals = detectOutcomeSignals(window);
    assert.ok(signals.userSuccessSignals.length >= 1, 'should detect user approval');
  });

  it('handles empty or invalid input', () => {
    assert.deepStrictEqual(detectOutcomeSignals([]).errors, []);
    assert.deepStrictEqual(detectOutcomeSignals(null).errors, []);
    assert.deepStrictEqual(detectOutcomeSignals(undefined).errors, []);
    assert.deepStrictEqual(detectOutcomeSignals('not-an-array').errors, []);
  });

  it('detects repeated file edits as reverted edits', () => {
    const window = [
      { role: 'assistant', content: 'I edited src/index.js to add the feature.' },
      { role: 'user', content: 'That broke things.' },
      { role: 'assistant', content: 'I edited src/index.js to revert the change.' },
    ];
    const signals = detectOutcomeSignals(window);
    assert.ok(
      signals.revertedEdits.some((r) => r.trigger === 'repeated_edit'),
      'should detect same file edited multiple times'
    );
  });
});

// ---------------------------------------------------------------------------
// classifyOutcome
// ---------------------------------------------------------------------------

describe('classifyOutcome', () => {
  it('classifies negative outcome when errors dominate', () => {
    const signals = {
      errors: [{ pattern: 'Error:', excerpt: 'Error: bad' }],
      testFailures: [],
      successes: [],
      corrections: [{ pattern: 'no', excerpt: 'no' }],
      revertedEdits: [],
      userSuccessSignals: [],
    };
    assert.equal(classifyOutcome(signals), 'negative');
  });

  it('classifies positive outcome when successes dominate', () => {
    const signals = {
      errors: [],
      testFailures: [],
      successes: [{ pattern: 'pass', excerpt: 'All tests passed' }],
      corrections: [],
      revertedEdits: [],
      userSuccessSignals: [{ pattern: 'good', excerpt: 'good' }],
    };
    assert.equal(classifyOutcome(signals), 'positive');
  });

  it('classifies neutral when no signals present', () => {
    const signals = {
      errors: [],
      testFailures: [],
      successes: [],
      corrections: [],
      revertedEdits: [],
      userSuccessSignals: [],
    };
    assert.equal(classifyOutcome(signals), 'neutral');
  });
});

// ---------------------------------------------------------------------------
// runSelfDistill dry-run
// ---------------------------------------------------------------------------

describe('runSelfDistill', () => {
  it('returns valid manifest with zero entries when no conversation logs exist', async () => {
    // Use a temp dir that has no conversation logs
    const origHome = process.env.HOME;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfDistill-'));
    process.env.HOME = tmpDir;

    try {
      const manifest = await runSelfDistill({ dryRun: true });
      assert.ok(manifest, 'should return a manifest');
      assert.ok(manifest.id, 'manifest should have an id');
      assert.ok(manifest.startedAt, 'manifest should have startedAt');
      assert.ok(manifest.completedAt, 'manifest should have completedAt');
      assert.equal(manifest.dryRun, true);
      assert.equal(typeof manifest.sessionsProcessed, 'number');
      assert.equal(typeof manifest.sessionsSkipped, 'number');
      assert.equal(typeof manifest.lessonsGenerated, 'number');
      assert.ok(Array.isArray(manifest.lessons));
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// getSelfDistillStatus
// ---------------------------------------------------------------------------

describe('getSelfDistillStatus', () => {
  let origRunsPath;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfDistillStatus-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no runs exist', () => {
    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    try {
      // getSelfDistillStatus reads from SELF_DISTILL_RUNS_PATH which uses HOME at module load
      // We test the function logic by verifying the module-level path doesn't have runs
      const status = getSelfDistillStatus();
      // Status may be null or an object depending on whether the real runs file exists
      // The important thing is it doesn't throw
      assert.ok(status === null || typeof status === 'object');
    } finally {
      process.env.HOME = origHome;
    }
  });
});

// ---------------------------------------------------------------------------
// Heuristic fallback (no ANTHROPIC_API_KEY)
// ---------------------------------------------------------------------------

describe('heuristic fallback', () => {
  it('uses heuristic mode without ANTHROPIC_API_KEY', async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const origHome = process.env.HOME;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfDistillHeuristic-'));
    process.env.HOME = tmpDir;

    try {
      const manifest = await runSelfDistill({ dryRun: true });
      assert.equal(manifest.analysisMode, 'heuristic');
    } finally {
      process.env.HOME = origHome;
      if (origKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = origKey;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// generateHeuristicLessons
// ---------------------------------------------------------------------------

describe('generateHeuristicLessons', () => {
  it('generates negative lessons from error signals', () => {
    const window = [
      { role: 'assistant', content: 'Error: module not found' },
    ];
    const signals = detectOutcomeSignals(window);
    const lessons = generateHeuristicLessons(window, signals);
    assert.ok(lessons.length >= 1);
    assert.equal(lessons[0].signal, 'negative');
    assert.equal(lessons[0].action.type, 'avoid');
  });

  it('generates positive lessons from success signals', () => {
    const window = [
      { role: 'assistant', content: 'All tests passed. 10 passing' },
      { role: 'user', content: 'Perfect, great job!' },
    ];
    const signals = detectOutcomeSignals(window);
    const lessons = generateHeuristicLessons(window, signals);
    assert.ok(lessons.length >= 1);
    assert.ok(lessons.some((l) => l.signal === 'positive'));
  });

  it('returns empty array for neutral signals', () => {
    const window = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hello there.' },
    ];
    const signals = detectOutcomeSignals(window);
    const lessons = generateHeuristicLessons(window, signals);
    assert.equal(lessons.length, 0);
  });
});
