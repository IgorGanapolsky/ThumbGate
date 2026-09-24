'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  PYRAMID_LAYERS,
  archiveStaleMemories,
  buildMemoryLifecyclePolicy,
  buildMemoryLifecycleView,
  classifyPyramidLayer,
  distillMemoryPyramid,
  evaluateMemoryPromotion,
  extractMemoryEntities,
  inferMemoryScope,
  isAutonomousSessionDump,
  normalizeMemoryType,
  pruneAndArchiveExpiredMemories,
  scoreHybridMemoryMatch,
  scoreMemoryDecay,
} = require('../scripts/agent-memory-lifecycle');

describe('agent-memory-lifecycle', () => {
  it('normalizes memory types correctly', () => {
    assert.equal(normalizeMemoryType('semantic'), 'semantic');
    assert.equal(normalizeMemoryType('UNKNOWN_TYPE'), 'episodic');
  });

  it('classifies memory items into semantic pyramid layers (L0-L3)', () => {
    // L3 Persona / SOP / Guardrail rule
    const l3Rule = classifyPyramidLayer({
      type: 'preference',
      tags: ['sop', 'rule'],
      content: 'Always require human review before publishing',
    });
    assert.equal(l3Rule, PYRAMID_LAYERS.L3_PERSONA_SOP);

    // L2 Scenario / Workflow
    const l2Workflow = classifyPyramidLayer({
      type: 'procedural',
      tags: ['workflow'],
      content: 'Multi-step deployment sequence for Railway backend',
    });
    assert.equal(l2Workflow, PYRAMID_LAYERS.L2_SCENARIO);

    // L1 Atomic Fact / Lesson
    const l1Lesson = classifyPyramidLayer({
      type: 'semantic',
      whatWentWrong: 'Passed non-serializable object',
      whatWorked: 'Use JSON payload string',
    });
    assert.equal(l1Lesson, PYRAMID_LAYERS.L1_ATOM);

    // L0 Conversation / Working Memory
    const l0Raw = classifyPyramidLayer({
      type: 'working',
      content: 'Temporary stdout logs from run_command task 12',
    });
    assert.equal(l0Raw, PYRAMID_LAYERS.L0_CONVERSATION);
  });

  it('distills memory pyramid layers and calculates estimated token metrics', () => {
    const memories = [
      { type: 'preference', content: 'SOP rule 1' },
      { type: 'procedural', content: 'Workflow step 1' },
      { type: 'semantic', whatWorked: 'Lesson 1' },
      { type: 'working', content: 'Log transcript line' },
    ];

    const distillation = distillMemoryPyramid(memories);
    assert.equal(distillation.kind, 'semantic-memory-pyramid');
    assert.equal(distillation.totalMemories, 4);
    assert.equal(distillation.layers.L3_PERSONA_SOP.count, 1);
    assert.equal(distillation.layers.L2_SCENARIO.count, 1);
    assert.equal(distillation.layers.L1_ATOM.count, 1);
    assert.equal(distillation.layers.L0_CONVERSATION.count, 1);
  });

  it('evaluates memory promotion policies', () => {
    const validMemory = {
      type: 'semantic',
      content: 'Proven deployment pattern',
      source: 'commit f31dcdbbe',
      outcome: 'success',
    };
    const evalResult = evaluateMemoryPromotion(validMemory);
    assert.equal(evalResult.decision, 'promote');
    assert.equal(evalResult.retrievalEligible, true);

    const secretMemory = {
      type: 'semantic',
      content: 'API Key is api_key_12345 secret token',
      source: 'test',
      outcome: 'success',
    };
    const secretEval = evaluateMemoryPromotion(secretMemory);
    assert.equal(secretEval.decision, 'hold');
    assert.ok(secretEval.issues.includes('secret_like_content'));
  });

  it('extracts entities and infers memory scope', () => {
    const memory = {
      title: 'Stripe deployment issue on Railway',
      content: 'Updated `npm run build` for Claude Code session',
    };

    const entities = extractMemoryEntities(memory);
    const scope = inferMemoryScope(memory);

    assert.ok(entities.some((e) => e.name === 'Stripe'));
    assert.ok(entities.some((e) => e.name === 'Railway'));
    assert.ok(scope === 'project' || scope === 'task');
  });

  it('holds transport transcripts and oversized blobs out of durable promotion', () => {
    const transcript = evaluateMemoryPromotion({
      type: 'semantic',
      content: [
        'user: please dump the chat',
        'assistant: sure',
        'user: continue',
        'assistant: here is more context',
      ].join('\n'),
      source: 'session-log',
      outcome: 'captured',
    });
    assert.equal(transcript.decision, 'hold');
    assert.ok(transcript.issues.includes('transport_transcript'));
    assert.equal(transcript.retrievalEligible, false);

    const oversized = evaluateMemoryPromotion({
      type: 'semantic',
      content: 'x'.repeat(13_000),
      source: 'blob',
      outcome: 'captured',
    });
    assert.equal(oversized.decision, 'hold');
    assert.ok(oversized.issues.includes('oversized_blob'));
    assert.equal(oversized.retrievalEligible, false);
  });

  it('blocks working memory promotion unless explicitly allowed', () => {
    const held = evaluateMemoryPromotion({
      type: 'working',
      content: 'temp scratch note',
      source: 'session',
      outcome: 'ok',
    });
    assert.equal(held.decision, 'hold');
    assert.ok(held.issues.includes('working_memory_not_promotable'));

    const promoted = evaluateMemoryPromotion({
      type: 'working',
      content: 'temp scratch note',
      source: 'session',
      outcome: 'ok',
      allowWorkingPromotion: true,
    });
    assert.equal(promoted.decision, 'promote');
  });

  it('rejects autonomous session dumps and diaries (Hawk principle)', () => {
    assert.equal(isAutonomousSessionDump('what I learned today in this session: things happened'), true);
    assert.equal(isAutonomousSessionDump('autonomous notes: summary of step 1 through 10'), true);
    assert.equal(isAutonomousSessionDump('session diary: tried this and failed'), true);
    assert.equal(isAutonomousSessionDump('clean structured lesson about git branching'), false);

    const held = evaluateMemoryPromotion({
      type: 'episodic',
      content: 'what I did today: explored codebase and wrote random thoughts',
      source: 'capture_feedback',
      outcome: 'failed',
    });
    assert.equal(held.decision, 'hold');
    assert.ok(held.issues.includes('autonomous_session_dump'));
    assert.equal(held.retrievalEligible, false);
  });

  it('scores unpromoted episodic memory decay faster than sticky invariants', () => {
    const now = Date.now();
    const eightyDaysAgo = new Date(now - 80 * 24 * 60 * 60 * 1000).toISOString();

    // Routine episodic memory past 60 days without structured rule -> archive_candidate
    const routineEpisodic = {
      type: 'episodic',
      title: 'Formatting glitch in markdown',
      content: 'Extra whitespace in header',
      tags: ['docs'],
      timestamp: eightyDaysAgo,
    };
    const episodicDecay = scoreMemoryDecay(routineEpisodic, { now });
    assert.equal(episodicDecay.state, 'archive_candidate');
    assert.equal(episodicDecay.score, 0.1);

    // High-risk invariant (git / production / security) remains sticky even at 200 days old
    const twoHundredDaysAgo = new Date(now - 200 * 24 * 60 * 60 * 1000).toISOString();
    const stickyInvariant = {
      type: 'procedural',
      title: 'Git force push policy',
      content: 'Never run git push --force on main branch',
      tags: ['git', 'security'],
      timestamp: twoHundredDaysAgo,
    };
    const stickyDecay = scoreMemoryDecay(stickyInvariant, { now });
    assert.equal(stickyDecay.state, 'sticky');
    assert.equal(stickyDecay.score, 1);
  });

  it('partitions and archives expired memories from memory-log.jsonl', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-lifecycle-archive-'));
    const now = Date.now();

    const memActive = {
      id: 'active-1',
      type: 'episodic',
      title: 'Recent fix',
      content: 'Fixed null check',
      tags: ['bug'],
      timestamp: new Date().toISOString(),
    };
    const memExpired = {
      id: 'expired-1',
      type: 'episodic',
      title: 'Old observation',
      content: 'Temporary quirk in test runner',
      tags: ['test'],
      timestamp: new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString(),
    };

    fs.writeFileSync(
      path.join(tmpDir, 'memory-log.jsonl'),
      [JSON.stringify(memActive), JSON.stringify(memExpired)].join('\n') + '\n',
    );

    const result = pruneAndArchiveExpiredMemories(tmpDir, { now });
    assert.equal(result.activeCount, 1);
    assert.equal(result.archivedCount, 1);
    assert.deepEqual(result.archivedIds, ['expired-1']);

    const activeRemaining = fs.readFileSync(path.join(tmpDir, 'memory-log.jsonl'), 'utf8');
    assert.ok(activeRemaining.includes('active-1'));
    assert.ok(!activeRemaining.includes('expired-1'));

    const archivedStored = fs.readFileSync(path.join(tmpDir, 'memory-archive.jsonl'), 'utf8');
    assert.ok(archivedStored.includes('expired-1'));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

});
