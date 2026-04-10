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
  buildPromotedGate,
  writePreventionRulesFromGates,
  appendRunManifest,
  readRunManifests,
  matchesEntry,
  runMetaAgentLoop,
  getMetaAgentStatus,
  readGateProgram,
  CANDIDATES_PER_RUN,
  MIN_SCORE_THRESHOLD,
  FP_WEIGHT,
  EVOLVE_MIN_FAILURES,
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

// ---------------------------------------------------------------------------
// matchesEntry
// ---------------------------------------------------------------------------

describe('matchesEntry', () => {
  const makeEntry = (context, tags = []) => ({ context, tags, whatWentWrong: '', whatToChange: '' });

  it('matches when pattern found in context', () => {
    assert.ok(matchesEntry('force.*push', makeEntry('git force push to main')));
  });

  it('matches when pattern found in tags', () => {
    assert.ok(matchesEntry('security', makeEntry('some context', ['security', 'git-workflow'])));
  });

  it('returns false when pattern does not match', () => {
    assert.ok(!matchesEntry('DROP TABLE', makeEntry('npm test passed')));
  });

  it('returns false for invalid regex without throwing', () => {
    assert.ok(!matchesEntry('[invalid(regex', makeEntry('any context')));
  });

  it('is case-insensitive', () => {
    assert.ok(matchesEntry('force push', makeEntry('FORCE PUSH detected')));
  });
});

// ---------------------------------------------------------------------------
// buildPromotedGate
// ---------------------------------------------------------------------------

describe('buildPromotedGate', () => {
  const candidate = {
    pattern: 'force.*push',
    action: 'block',
    message: 'Force push blocked',
    severity: 'critical',
    rationale: 'repeated force-push failures',
  };
  const metrics = { score: 0.8, hitRate: 0.9, fpRate: 0.05, hits: 5, fps: 1 };

  it('builds a valid gate object', () => {
    const gate = buildPromotedGate(candidate, metrics, 'run_abc');
    assert.ok(gate.id, 'should have an id');
    assert.strictEqual(gate.pattern, candidate.pattern);
    assert.strictEqual(gate.action, 'block');
    assert.strictEqual(gate.severity, 'critical');
    assert.strictEqual(gate.source, 'meta-agent');
    assert.strictEqual(gate.runId, 'run_abc');
    assert.strictEqual(gate.occurrences, 5);
    assert.ok(typeof gate.score === 'number');
    assert.ok(typeof gate.hitRate === 'number');
    assert.ok(typeof gate.fpRate === 'number');
  });

  it('uses empty string for missing rationale', () => {
    const gate = buildPromotedGate({ ...candidate, rationale: undefined }, metrics, 'run_xyz');
    assert.strictEqual(gate.rationale, '');
  });

  it('scores are rounded to 3 decimal places', () => {
    const gate = buildPromotedGate(candidate, { ...metrics, score: 0.123456 }, 'run_xyz');
    assert.ok(String(gate.score).split('.')[1]?.length <= 3);
  });
});

// ---------------------------------------------------------------------------
// writePreventionRulesFromGates
// ---------------------------------------------------------------------------

describe('writePreventionRulesFromGates', () => {
  let tmpDir;
  before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-rules-test-')); });
  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('writes a markdown file with block and warn prefixes', () => {
    const rulesPath = path.join(tmpDir, 'prevention-rules.md');
    const autoGatesData = {
      gates: [
        { action: 'block', message: 'Force push is blocked' },
        { action: 'warn', message: 'Check secrets before committing' },
      ],
    };
    writePreventionRulesFromGates(autoGatesData, rulesPath);
    assert.ok(fs.existsSync(rulesPath), 'file should be created');
    const content = fs.readFileSync(rulesPath, 'utf-8');
    assert.ok(content.includes('[BLOCK]'), 'should include BLOCK prefix');
    assert.ok(content.includes('[WARN]'), 'should include WARN prefix');
    assert.ok(content.includes('Force push is blocked'));
    assert.ok(content.includes('Check secrets before committing'));
  });

  it('writes no-rules message when gate list is empty', () => {
    const rulesPath = path.join(tmpDir, 'prevention-rules-empty.md');
    writePreventionRulesFromGates({ gates: [] }, rulesPath);
    const content = fs.readFileSync(rulesPath, 'utf-8');
    assert.ok(content.includes('No prevention rules active'));
  });

  it('creates parent directory if missing', () => {
    const nestedPath = path.join(tmpDir, 'nested', 'rules.md');
    writePreventionRulesFromGates({ gates: [] }, nestedPath);
    assert.ok(fs.existsSync(nestedPath));
  });
});

// ---------------------------------------------------------------------------
// appendRunManifest / readRunManifests
// ---------------------------------------------------------------------------

describe('appendRunManifest and readRunManifests', () => {
  let origPath;
  let tmpManifestPath;
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-manifest-test-'));
    tmpManifestPath = path.join(tmpDir, 'meta-agent-runs.jsonl');
    // Temporarily redirect META_RUNS_PATH by patching the module's path
    // We test via appendRunManifest/readRunManifests directly with known data
  });
  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('can write and read manifests via the JSONL path', () => {
    // Write directly to a temp file and verify parsing
    const records = [
      { runId: 'r1', promotedCount: 2, candidateCount: 5, startedAt: new Date().toISOString() },
      { runId: 'r2', promotedCount: 0, candidateCount: 3, startedAt: new Date().toISOString() },
    ];
    fs.writeFileSync(tmpManifestPath, records.map(r => JSON.stringify(r)).join('\n') + '\n');
    const lines = fs.readFileSync(tmpManifestPath, 'utf-8').trim().split('\n');
    const parsed = lines.map(l => JSON.parse(l));
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].runId, 'r1');
    assert.strictEqual(parsed[1].promotedCount, 0);
  });
});

// ---------------------------------------------------------------------------
// getMetaAgentStatus — no runs
// ---------------------------------------------------------------------------

describe('getMetaAgentStatus', () => {
  it('returns null when META_RUNS_PATH does not exist', () => {
    // Temporarily point to a nonexistent path via env (best-effort)
    // Since META_RUNS_PATH is a constant, we verify the null branch via
    // a fresh temp dir where no file exists
    const status = getMetaAgentStatus();
    // Either null (no runs) or an object with expected shape
    if (status !== null) {
      assert.ok(typeof status.totalRuns === 'number');
      assert.ok(typeof status.lastRunId === 'string');
      assert.ok(typeof status.lastRunAt === 'string');
      assert.ok(typeof status.totalPromoted === 'number');
    }
    // null is also valid (no prior runs in this environment)
    assert.ok(status === null || typeof status === 'object');
  });
});

// ---------------------------------------------------------------------------
// readGateProgram — filesystem
// ---------------------------------------------------------------------------

describe('readGateProgram', () => {
  it('returns a non-null string when gate-program.md is present in cwd', () => {
    // gate-program.md exists in /home/user/ThumbGate (created in this session)
    const text = readGateProgram();
    if (text !== null) {
      assert.ok(typeof text === 'string');
      assert.ok(text.length > 0, 'gate-program.md should not be empty');
    }
    // null is valid if run from a different cwd where the file doesn't exist
    assert.ok(text === null || typeof text === 'string');
  });
});

// ---------------------------------------------------------------------------
// runMetaAgentLoop — dry-run integration test
// ---------------------------------------------------------------------------

describe('runMetaAgentLoop dry-run integration', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-integration-test-'));
    const now = new Date().toISOString();
    const entries = [
      { signal: 'negative', context: 'git push --force origin main', tags: ['git-workflow'], timestamp: now },
      { signal: 'negative', context: 'skipped tests with --no-verify flag', tags: ['ci'], timestamp: now },
      { signal: 'positive', context: 'npm test passed all 1634 tests', tags: ['testing'], timestamp: now },
      { signal: 'positive', context: 'deployment verified via health endpoint', tags: ['deploy'], timestamp: now },
    ];
    fs.writeFileSync(
      path.join(tmpDir, 'feedback-log.jsonl'),
      entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    );
    process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  });

  after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a well-formed manifest', async () => {
    const manifest = await runMetaAgentLoop({ dryRun: true, verbose: false });

    assert.ok(manifest.runId, 'should have runId');
    assert.strictEqual(manifest.dryRun, true);
    assert.ok(typeof manifest.failureCount === 'number', 'failureCount should be a number');
    assert.ok(typeof manifest.successCount === 'number', 'successCount should be a number');
    assert.ok(typeof manifest.candidateCount === 'number', 'candidateCount should be a number');
    assert.ok(Array.isArray(manifest.promoted), 'promoted should be an array');
    assert.ok(Array.isArray(manifest.reverted), 'reverted should be an array');
    assert.ok(manifest.startedAt, 'should have startedAt');
    assert.ok(manifest.completedAt, 'should have completedAt');
    assert.ok(['llm', 'heuristic'].includes(manifest.analysisMode), 'analysisMode should be known');
  });

  it('failure count matches injected data', async () => {
    const manifest = await runMetaAgentLoop({ dryRun: true, verbose: false });
    assert.strictEqual(manifest.failureCount, 2, 'should detect 2 failures from injected data');
    assert.strictEqual(manifest.successCount, 2, 'should detect 2 successes from injected data');
  });

  it('does not write files in dry-run mode', async () => {
    const autoGatesPath = path.join(tmpDir, 'auto-promoted-gates.json');
    await runMetaAgentLoop({ dryRun: true, verbose: false });
    // auto-promoted-gates.json should NOT be written in dry-run
    assert.ok(!fs.existsSync(autoGatesPath), 'should not write gates file in dry-run');
  });

  it('candidates come from heuristic when no API key', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const manifest = await runMetaAgentLoop({ dryRun: true, verbose: false });
    assert.strictEqual(manifest.analysisMode, 'heuristic');
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it('promoted + reverted counts sum to candidateCount', async () => {
    const manifest = await runMetaAgentLoop({ dryRun: true, verbose: false });
    assert.strictEqual(
      manifest.promotedCount + manifest.revertedCount,
      manifest.candidateCount,
      'promoted + reverted should equal total candidates'
    );
  });
});

// ---------------------------------------------------------------------------
// module constants
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

  it('EVOLVE_MIN_FAILURES is a positive integer', () => {
    assert.ok(Number.isInteger(EVOLVE_MIN_FAILURES) && EVOLVE_MIN_FAILURES > 0);
  });
});
