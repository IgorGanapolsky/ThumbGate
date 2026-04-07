'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Helper: fresh require with env overrides pointing to tmpDir
// ---------------------------------------------------------------------------

function freshModule(tmpDir) {
  process.env.THUMBGATE_FEEDBACK_LOG = path.join(tmpDir, 'feedback-log.jsonl');
  process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = path.join(tmpDir, 'attributed-feedback.jsonl');
  process.env.THUMBGATE_GUARDS_PATH = path.join(tmpDir, 'pretool-guards.json');
  delete require.cache[require.resolve('../scripts/hybrid-feedback-context')];
  return require('../scripts/hybrid-feedback-context');
}

function writeJsonl(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// describe: evaluatePretool — no prior data
// ---------------------------------------------------------------------------

describe('evaluatePretool — no prior data', () => {
  let tmpDir;
  let evaluatePretool;
  let evaluatePretoolFromState;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfc-allow-test-'));
    ({ evaluatePretool, evaluatePretoolFromState } = freshModule(tmpDir));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.THUMBGATE_FEEDBACK_LOG;
    delete process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
    delete process.env.THUMBGATE_GUARDS_PATH;
  });

  it('returns mode:allow for never-seen tool+input', () => {
    // Empty tmpdir — no guard artifact, no feedback — should default to allow
    const result = evaluatePretool('Read', 'some-new-file.md', {
      guardArtifactPath: path.join(tmpDir, 'pretool-guards.json'),
      feedbackLogPath: path.join(tmpDir, 'feedback-log.jsonl'),
      attributedFeedbackPath: path.join(tmpDir, 'attributed-feedback.jsonl'),
    });
    assert.strictEqual(result.mode, 'allow', `Expected allow for never-seen input, got: ${result.mode}`);
  });

  it('returns mode:allow via state with empty negative patterns', () => {
    // Construct empty state directly
    const emptyState = { recurringNegativePatterns: [], negativeToolCounts: {}, negativeToolCountsAttributed: {} };
    const result = evaluatePretoolFromState(emptyState, 'Bash', 'npm test');
    assert.strictEqual(result.mode, 'allow', `Expected allow for empty state, got: ${result.mode}`);
  });
});

// ---------------------------------------------------------------------------
// describe: evaluatePretool — with seeded negative patterns
// ---------------------------------------------------------------------------

describe('evaluatePretool — with seeded negative patterns', () => {
  let tmpDir;
  let buildHybridState;
  let evaluatePretoolFromState;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfc-neg-test-'));
    ({ buildHybridState, evaluatePretoolFromState } = freshModule(tmpDir));

    // Seed attributed-feedback.jsonl with 3 entries: same tool='Bash', same normalized context
    const attributedFeedbackPath = path.join(tmpDir, 'attributed-feedback.jsonl');
    const ts = new Date().toISOString();
    writeJsonl(attributedFeedbackPath, [
      {
        timestamp: ts,
        signal: 'negative',
        feedback: 'negative',
        tool_name: 'Bash',
        context: 'git push force main branch override',
        source: 'attributed',
      },
      {
        timestamp: ts,
        signal: 'negative',
        feedback: 'negative',
        tool_name: 'Bash',
        context: 'git push force main branch override',
        source: 'attributed',
      },
      {
        timestamp: ts,
        signal: 'negative',
        feedback: 'negative',
        tool_name: 'Bash',
        context: 'git push force main branch override',
        source: 'attributed',
      },
    ]);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.THUMBGATE_FEEDBACK_LOG;
    delete process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
    delete process.env.THUMBGATE_GUARDS_PATH;
  });

  it('returns mode:block for critical recurring pattern (count >= 3)', () => {
    // Re-require to pick up fresh env
    ({ buildHybridState, evaluatePretoolFromState } = freshModule(tmpDir));
    const state = buildHybridState({
      attributedFeedbackPath: path.join(tmpDir, 'attributed-feedback.jsonl'),
      feedbackLogPath: path.join(tmpDir, 'feedback-log.jsonl'),
    });
    // Should have a recurring pattern with severity matching count >= 3
    assert.ok(
      state.recurringNegativePatterns.length > 0,
      'Expected at least one recurring negative pattern after 3 identical entries'
    );
    const topPattern = state.recurringNegativePatterns[0];
    assert.ok(topPattern.count >= 3, `Expected count >= 3, got: ${topPattern.count}`);

    const result = evaluatePretoolFromState(state, 'Bash', 'git push force main');
    assert.strictEqual(result.mode, 'block', `Expected block for critical pattern, got: ${result.mode}`);
  });

  it('returns mode:warn for medium recurring pattern (count == 2)', () => {
    // Create a fresh tmpdir with only 2 matching entries
    const warnTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfc-warn-test-'));
    try {
      const warnAttrPath = path.join(warnTmpDir, 'attributed-feedback.jsonl');
      const ts = new Date().toISOString();
      writeJsonl(warnAttrPath, [
        {
          timestamp: ts,
          signal: 'negative',
          feedback: 'negative',
          tool_name: 'Bash',
          context: 'git push force main branch override',
          source: 'attributed',
        },
        {
          timestamp: ts,
          signal: 'negative',
          feedback: 'negative',
          tool_name: 'Bash',
          context: 'git push force main branch override',
          source: 'attributed',
        },
      ]);

      // freshModule for warn tmpDir
      process.env.THUMBGATE_FEEDBACK_LOG = path.join(warnTmpDir, 'feedback-log.jsonl');
      process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = warnAttrPath;
      process.env.THUMBGATE_GUARDS_PATH = path.join(warnTmpDir, 'pretool-guards.json');
      delete require.cache[require.resolve('../scripts/hybrid-feedback-context')];
      const { buildHybridState: bhs, evaluatePretoolFromState: eps } = require('../scripts/hybrid-feedback-context');

      const state = bhs({
        attributedFeedbackPath: warnAttrPath,
        feedbackLogPath: path.join(warnTmpDir, 'feedback-log.jsonl'),
      });
      assert.ok(state.recurringNegativePatterns.length > 0, 'Expected recurring pattern for 2 entries');
      const topPattern = state.recurringNegativePatterns[0];
      assert.strictEqual(topPattern.count, 2, `Expected count == 2, got: ${topPattern.count}`);

      const result = eps(state, 'Bash', 'git push force main');
      assert.strictEqual(result.mode, 'warn', `Expected warn for count==2 pattern, got: ${result.mode}`);
    } finally {
      fs.rmSync(warnTmpDir, { recursive: true, force: true });
    }
  });

  it('returns mode:allow for different tool even with negatives on other tool', () => {
    // Restore main tmpDir env
    ({ buildHybridState, evaluatePretoolFromState } = freshModule(tmpDir));
    const state = buildHybridState({
      attributedFeedbackPath: path.join(tmpDir, 'attributed-feedback.jsonl'),
      feedbackLogPath: path.join(tmpDir, 'feedback-log.jsonl'),
    });
    // 'Read' tool — input matches keywords but evaluatePretoolFromState checks patterns by keyword,
    // not tool — so if keywords match pattern it may still block.
    // The test verifies that a truly different context/tool produces allow.
    const result = evaluatePretoolFromState(state, 'Read', 'read a markdown file');
    assert.strictEqual(result.mode, 'allow', `Expected allow for unrelated Read tool input, got: ${result.mode}`);
  });

  it('uses structured scope metadata when free-text context is sparse', () => {
    const structuredTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfc-structured-test-'));
    const prevFeedbackLog = process.env.RLHF_FEEDBACK_LOG;
    const prevAttributedFeedback = process.env.RLHF_ATTRIBUTED_FEEDBACK;
    const prevGuardsPath = process.env.RLHF_GUARDS_PATH;
    try {
      process.env.RLHF_FEEDBACK_LOG = path.join(structuredTmpDir, 'feedback-log.jsonl');
      process.env.RLHF_ATTRIBUTED_FEEDBACK = path.join(structuredTmpDir, 'attributed-feedback.jsonl');
      process.env.RLHF_GUARDS_PATH = path.join(structuredTmpDir, 'pretool-guards.json');
      delete require.cache[require.resolve('../scripts/hybrid-feedback-context')];
      const { buildHybridState: bhs, evaluatePretoolFromState: eps } = require('../scripts/hybrid-feedback-context');

      const ts = new Date().toISOString();
      writeJsonl(process.env.RLHF_FEEDBACK_LOG, [
        {
          id: 'structured-1',
          timestamp: ts,
          signal: 'negative',
          context: '',
          tags: ['scope-creep', 'protected-file'],
          richContext: {
            filePaths: ['AGENTS.md'],
            enforcement: { scopeViolation: true, approvalFailure: true, protectedFileViolation: true },
          },
          structuredRule: {
            action: { description: 'avoid editing protected files without approval' },
            trigger: { condition: 'scope creep on AGENTS.md' },
            metadata: { filesInvolved: ['AGENTS.md'] },
          },
        },
        {
          id: 'structured-2',
          timestamp: ts,
          signal: 'negative',
          context: '',
          tags: ['scope-creep', 'protected-file'],
          richContext: {
            filePaths: ['AGENTS.md'],
            enforcement: { scopeViolation: true, approvalFailure: true, protectedFileViolation: true },
          },
          structuredRule: {
            action: { description: 'avoid editing protected files without approval' },
            trigger: { condition: 'scope creep on AGENTS.md' },
            metadata: { filesInvolved: ['AGENTS.md'] },
          },
        },
      ]);

      const state = bhs({
        feedbackLogPath: process.env.RLHF_FEEDBACK_LOG,
        attributedFeedbackPath: process.env.RLHF_ATTRIBUTED_FEEDBACK,
      });
      assert.ok(state.recurringNegativePatterns.length > 0, 'expected structured metadata to create a recurring pattern');

      const result = eps(state, 'Edit', '{"filePath":"AGENTS.md","reason":"protected file scope creep"}');
      assert.equal(result.mode, 'warn');
    } finally {
      if (prevFeedbackLog === undefined) delete process.env.RLHF_FEEDBACK_LOG;
      else process.env.RLHF_FEEDBACK_LOG = prevFeedbackLog;
      if (prevAttributedFeedback === undefined) delete process.env.RLHF_ATTRIBUTED_FEEDBACK;
      else process.env.RLHF_ATTRIBUTED_FEEDBACK = prevAttributedFeedback;
      if (prevGuardsPath === undefined) delete process.env.RLHF_GUARDS_PATH;
      else process.env.RLHF_GUARDS_PATH = prevGuardsPath;
      fs.rmSync(structuredTmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// describe: compileGuardArtifact + writeGuardArtifact + readGuardArtifact
// ---------------------------------------------------------------------------

describe('compileGuardArtifact + writeGuardArtifact + readGuardArtifact', () => {
  let tmpDir;
  let compileGuardArtifact;
  let writeGuardArtifact;
  let readGuardArtifact;
  let evaluateCompiledGuards;
  let buildHybridState;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfc-compile-test-'));
    ({ compileGuardArtifact, writeGuardArtifact, readGuardArtifact, evaluateCompiledGuards, buildHybridState } = freshModule(tmpDir));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.THUMBGATE_FEEDBACK_LOG;
    delete process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
    delete process.env.THUMBGATE_GUARDS_PATH;
  });

  it('compile produces valid artifact with guards array', () => {
    // Build state with some recurring negative patterns
    const attrPath = path.join(tmpDir, 'attributed-feedback.jsonl');
    const ts = new Date().toISOString();
    writeJsonl(attrPath, [
      { timestamp: ts, signal: 'negative', feedback: 'negative', tool_name: 'Bash', context: 'force push main branch', source: 'attributed' },
      { timestamp: ts, signal: 'negative', feedback: 'negative', tool_name: 'Bash', context: 'force push main branch', source: 'attributed' },
      { timestamp: ts, signal: 'negative', feedback: 'negative', tool_name: 'Bash', context: 'force push main branch', source: 'attributed' },
    ]);

    const state = buildHybridState({
      attributedFeedbackPath: attrPath,
      feedbackLogPath: path.join(tmpDir, 'feedback-log.jsonl'),
    });
    const artifact = compileGuardArtifact(state);
    assert.ok(Array.isArray(artifact.guards), 'artifact.guards must be an Array');
    assert.ok(typeof artifact.compiledAt === 'string', 'artifact.compiledAt must be a string');
    assert.ok(typeof artifact.guardCount === 'number', 'artifact.guardCount must be a number');
  });

  it('write + read round-trip returns identical artifact', () => {
    const guardsPath = path.join(tmpDir, 'guards-roundtrip.json');
    const state = buildHybridState({
      attributedFeedbackPath: path.join(tmpDir, 'attributed-feedback.jsonl'),
      feedbackLogPath: path.join(tmpDir, 'feedback-log.jsonl'),
    });
    const artifact = compileGuardArtifact(state);
    writeGuardArtifact(guardsPath, artifact);
    const read = readGuardArtifact(guardsPath);
    assert.ok(read !== null, 'readGuardArtifact must return non-null');
    assert.deepStrictEqual(read.guards, artifact.guards, 'guards array must survive write+read round-trip');
    assert.strictEqual(read.guardCount, artifact.guardCount, 'guardCount must match after round-trip');
  });

  it('evaluateCompiledGuards returns allow for empty guards', () => {
    const emptyArtifact = { compiledAt: new Date().toISOString(), guardCount: 0, blockThreshold: 3, guards: [] };
    const result = evaluateCompiledGuards(emptyArtifact, 'Bash', 'any input here');
    assert.strictEqual(result.mode, 'allow', `Expected allow for empty guards, got: ${result.mode}`);
  });

  it('evaluateCompiledGuards returns block for matching block guard', () => {
    // Build a specific artifact with one block guard containing keywords matching 'git push --force main'
    const blockArtifact = {
      compiledAt: new Date().toISOString(),
      guardCount: 1,
      blockThreshold: 3,
      guards: [
        {
          hash: 'aabbccdd',
          text: 'git push force main branch',
          words: ['push', 'force', 'main', 'branch'],
          count: 4,
          lastSeen: Date.now(),
          attributed: true,
          mode: 'block',
        },
      ],
    };
    const result = evaluateCompiledGuards(blockArtifact, 'Bash', 'git push --force main');
    assert.strictEqual(result.mode, 'block', `Expected block for matching guard, got: ${result.mode}`);
  });
});

// ---------------------------------------------------------------------------
// describe: buildHybridState
// ---------------------------------------------------------------------------

describe('buildHybridState', () => {
  let tmpDir;
  let buildHybridState;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfc-state-test-'));
    ({ buildHybridState } = freshModule(tmpDir));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.THUMBGATE_FEEDBACK_LOG;
    delete process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
    delete process.env.THUMBGATE_GUARDS_PATH;
  });

  it('returns total count from seeded feedback-log.jsonl', () => {
    const feedbackLogPath = path.join(tmpDir, 'feedback-log.jsonl');
    const ts = new Date().toISOString();
    writeJsonl(feedbackLogPath, [
      { id: 'fb1', signal: 'positive', context: 'great result', timestamp: ts },
      { id: 'fb2', signal: 'positive', context: 'good work done', timestamp: ts },
      { id: 'fb3', signal: 'positive', context: 'tests passed', timestamp: ts },
    ]);

    // Re-require to pick up seeded file
    ({ buildHybridState } = freshModule(tmpDir));
    const state = buildHybridState({
      feedbackLogPath,
      attributedFeedbackPath: path.join(tmpDir, 'attributed-feedback.jsonl'),
    });
    assert.ok(state.counts.total >= 3, `Expected total >= 3, got: ${state.counts.total}`);
  });

  it('recurringNegativePatterns is empty when no negatives', () => {
    const feedbackLogPath = path.join(tmpDir, 'feedback-log-pos.jsonl');
    const ts = new Date().toISOString();
    writeJsonl(feedbackLogPath, [
      { id: 'fb4', signal: 'positive', context: 'all good', timestamp: ts },
      { id: 'fb5', signal: 'positive', context: 'tests pass', timestamp: ts },
    ]);

    const state = buildHybridState({
      feedbackLogPath,
      attributedFeedbackPath: path.join(tmpDir, 'attributed-feedback-empty.jsonl'),
    });
    assert.strictEqual(
      state.recurringNegativePatterns.length,
      0,
      `Expected 0 recurring negative patterns when no negatives seeded, got: ${state.recurringNegativePatterns.length}`
    );
  });
});
