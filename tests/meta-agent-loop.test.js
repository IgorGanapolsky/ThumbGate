'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  extractSuccessDefinition,
  extractBlockPatterns,
  getRecentFailures,
  getRecentSuccesses,
  generateCandidatesHeuristic,
  scoreCandidate,
  readGateProgram,
  CANDIDATES_PER_RUN,
  MIN_SCORE_THRESHOLD,
  FP_WEIGHT,
} = require('../scripts/meta-agent-loop');

// ---------------------------------------------------------------------------
// gate-program.md parsing
// ---------------------------------------------------------------------------

const SAMPLE_GATE_PROGRAM = `# ThumbGate Gate Program

## Success Looks Like

- No force-pushes to main
- Tests pass before merge
- Secrets never committed

## Patterns to Block (Hard Stop)

1. **Force push to main** — git push --force on main or master
2. **Secret in output** — any ANTHROPIC_API_KEY in logs
3. **Skip CI** — --no-verify flag
`;

describe('extractSuccessDefinition', () => {
  it('extracts the success section', () => {
    const def = extractSuccessDefinition(SAMPLE_GATE_PROGRAM);
    assert.ok(def.includes('No force-pushes'), 'should include success items');
  });

  it('returns empty string when section missing', () => {
    assert.strictEqual(extractSuccessDefinition('# No sections here'), '');
  });

  it('returns empty string for null input', () => {
    assert.strictEqual(extractSuccessDefinition(null), '');
  });
});

describe('extractBlockPatterns', () => {
  it('extracts numbered block patterns', () => {
    const patterns = extractBlockPatterns(SAMPLE_GATE_PROGRAM);
    assert.ok(patterns.length >= 2, 'should extract at least 2 patterns');
    assert.ok(patterns.some((p) => p.includes('force') || p.includes('main')), 'should include force-push pattern');
  });

  it('returns empty array when section missing', () => {
    const patterns = extractBlockPatterns('# No block section');
    assert.deepStrictEqual(patterns, []);
  });
});

// ---------------------------------------------------------------------------
// scoreCandidate
// ---------------------------------------------------------------------------

describe('scoreCandidate', () => {
  const makeEntry = (signal, context, tags = []) => ({
    signal,
    context,
    tags,
    timestamp: new Date().toISOString(),
  });

  it('gives high score when rule catches failures but not successes', () => {
    const failures = [
      makeEntry('negative', 'git push --force origin main'),
      makeEntry('negative', 'force pushing to main branch'),
    ];
    const successes = [
      makeEntry('positive', 'npm test passed all cases'),
    ];
    const { score, hitRate, fpRate } = scoreCandidate(
      { pattern: 'force.*push|push.*force' },
      failures,
      successes
    );
    assert.ok(hitRate > 0, 'should have positive hit rate');
    assert.strictEqual(fpRate, 0, 'should not match successes');
    assert.ok(score >= MIN_SCORE_THRESHOLD, 'score should exceed threshold');
  });

  it('penalises false positives heavily', () => {
    const failures = [
      makeEntry('negative', 'force push on main'),
    ];
    // Broad pattern matches everything
    const successes = [
      makeEntry('positive', 'git push feature-branch'),
      makeEntry('positive', 'git push origin feat/new'),
    ];
    const { score, fpRate } = scoreCandidate(
      { pattern: 'git push' },   // too broad — hits successes
      failures,
      successes
    );
    assert.ok(fpRate > 0, 'should have false positives');
    // score = hitRate - FP_WEIGHT * fpRate; with FP_WEIGHT=2 this should be depressed
    assert.ok(score < 1.0, 'score should be penalised');
  });

  it('returns zero score with empty inputs', () => {
    const { score } = scoreCandidate({ pattern: 'anything' }, [], []);
    assert.strictEqual(score, 0);
  });

  it('handles invalid regex gracefully', () => {
    // Should not throw
    const failures = [makeEntry('negative', 'some error context')];
    const { hitRate } = scoreCandidate({ pattern: '[invalid(regex' }, failures, []);
    assert.strictEqual(hitRate, 0, 'invalid regex should match nothing');
  });
});

// ---------------------------------------------------------------------------
// generateCandidatesHeuristic
// ---------------------------------------------------------------------------

describe('generateCandidatesHeuristic', () => {
  it('generates candidates from block patterns', () => {
    const blockPatterns = [
      'git push --force on main or master',
      'ANTHROPIC_API_KEY in logs or diffs',
    ];
    const candidates = generateCandidatesHeuristic([], blockPatterns);
    assert.ok(candidates.length > 0, 'should generate at least one candidate');
    assert.ok(candidates.length <= CANDIDATES_PER_RUN, 'should not exceed max candidates');
  });

  it('generates candidates from repeated failure contexts', () => {
    const failures = [
      { context: 'force push to main branch', timestamp: new Date().toISOString(), signal: 'negative' },
      { context: 'force push to main branch', timestamp: new Date().toISOString(), signal: 'negative' },
      { context: 'force push to main branch', timestamp: new Date().toISOString(), signal: 'negative' },
    ];
    const candidates = generateCandidatesHeuristic(failures, []);
    assert.ok(candidates.length > 0, 'should derive candidate from repeated context');
  });

  it('returns empty array when no signal', () => {
    const candidates = generateCandidatesHeuristic([], []);
    assert.deepStrictEqual(candidates, []);
  });
});

// ---------------------------------------------------------------------------
// getRecentFailures / getRecentSuccesses — file-based
// ---------------------------------------------------------------------------

describe('getRecentFailures and getRecentSuccesses', () => {
  let tmpDir;
  let logPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-agent-test-'));
    logPath = path.join(tmpDir, 'feedback-log.jsonl');
    const now = new Date().toISOString();
    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

    const entries = [
      { signal: 'negative', context: 'recent failure', timestamp: now },
      { signal: 'positive', context: 'recent success', timestamp: now },
      { signal: 'negative', context: 'old failure', timestamp: oldDate },
    ];
    fs.writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns only recent failures within window', () => {
    const failures = getRecentFailures(logPath, 14);
    assert.strictEqual(failures.length, 1, 'only 1 failure within 14-day window');
    assert.ok(failures[0].context.includes('recent'), 'should be the recent one');
  });

  it('returns only recent successes within window', () => {
    const successes = getRecentSuccesses(logPath, 14);
    assert.strictEqual(successes.length, 1, 'only 1 success within 14-day window');
  });

  it('returns empty array when file does not exist', () => {
    const failures = getRecentFailures('/nonexistent/path.jsonl', 14);
    assert.deepStrictEqual(failures, []);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('module constants', () => {
  it('FP_WEIGHT is greater than 1 (false positives penalised more than true positives)', () => {
    assert.ok(FP_WEIGHT > 1, 'FP_WEIGHT should be > 1');
  });

  it('MIN_SCORE_THRESHOLD is positive', () => {
    assert.ok(MIN_SCORE_THRESHOLD > 0, 'threshold should be positive');
  });

  it('CANDIDATES_PER_RUN is reasonable', () => {
    assert.ok(CANDIDATES_PER_RUN >= 3 && CANDIDATES_PER_RUN <= 20);
  });
});
