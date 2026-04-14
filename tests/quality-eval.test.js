'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { evaluate, evaluateBatch, getEvalSummary, heuristicScore, DIMENSIONS } = require('../scripts/quality-eval');

test('DIMENSIONS covers gate, lesson, and session types', () => {
  assert.ok(DIMENSIONS.gate);
  assert.ok(DIMENSIONS.lesson);
  assert.ok(DIMENSIONS.session);
  assert.ok(Object.keys(DIMENSIONS.gate).length >= 3);
  assert.ok(Object.keys(DIMENSIONS.lesson).length >= 3);
  assert.ok(Object.keys(DIMENSIONS.session).length >= 3);
});

test('heuristicScore returns scores for all dimensions of a lesson', () => {
  const scores = heuristicScore('lesson', {
    lesson: 'Avoid running git push --force on main branch to prevent overwriting teammate commits',
  });
  assert.ok(Array.isArray(scores));
  assert.equal(scores.length, Object.keys(DIMENSIONS.lesson).length);
  for (const s of scores) {
    assert.ok(s.dimension);
    assert.ok(s.score >= 1 && s.score <= 5);
    assert.equal(s.reasoning, 'heuristic evaluation');
  }
});

test('heuristicScore gives higher score to specific lessons than vague ones', () => {
  const specific = heuristicScore('lesson', {
    lesson: 'Avoid running git push --force on main branch — this overwrites remote history and can destroy teammate work. Always use --force-with-lease instead.',
  });
  const vague = heuristicScore('lesson', {
    lesson: 'stuff',
  });
  const avgSpecific = specific.reduce((s, d) => s + d.score, 0) / specific.length;
  const avgVague = vague.reduce((s, d) => s + d.score, 0) / vague.length;
  assert.ok(avgSpecific > avgVague, `Specific (${avgSpecific}) should score higher than vague (${avgVague})`);
});

test('heuristicScore handles gate type', () => {
  const scores = heuristicScore('gate', {
    pattern: 'rm -rf /',
    message: 'Blocked destructive filesystem operation that would wipe the root directory',
    severity: 'high',
  });
  assert.equal(scores.length, Object.keys(DIMENSIONS.gate).length);
  const avg = scores.reduce((s, d) => s + d.score, 0) / scores.length;
  assert.ok(avg >= 3, 'Well-defined gate should score at least 3');
});

test('heuristicScore handles session type', () => {
  const scores = heuristicScore('session', {
    wasteCount: 0,
    confusionSignals: [],
    goalAchieved: true,
  });
  assert.equal(scores.length, Object.keys(DIMENSIONS.session).length);
  const avg = scores.reduce((s, d) => s + d.score, 0) / scores.length;
  assert.ok(avg >= 4, 'Clean session should score high');
});

test('evaluate returns result with heuristic fallback when no API key', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-geval-'));
  const origDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  try {
    const result = await evaluate('lesson', {
      lesson: 'Never deploy on Fridays without rollback plan',
    }, { forceHeuristic: true });

    assert.equal(result.type, 'lesson');
    assert.equal(result.model, 'heuristic');
    assert.ok(Array.isArray(result.scores));
    assert.ok(result.average >= 1 && result.average <= 5);
    assert.ok(result.evaluatedAt);

    // Check log was written
    const logPath = path.join(tmpDir, 'quality-eval-log.jsonl');
    assert.ok(fs.existsSync(logPath));
    const logged = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
    assert.equal(logged.type, 'lesson');
  } finally {
    if (origDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = origDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('evaluate rejects unknown type', async () => {
  const result = await evaluate('unknown', {});
  assert.ok(result.error);
  assert.match(result.error, /Unknown eval type/);
});

test('evaluateBatch scores multiple items and returns batch average', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-geval-batch-'));
  const origDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  try {
    const result = await evaluateBatch('gate', [
      { pattern: 'DROP TABLE', message: 'Blocked SQL table drop', severity: 'high' },
      { pattern: 'x', message: 'y', severity: 'low' },
    ], { forceHeuristic: true });

    assert.equal(result.type, 'gate');
    assert.equal(result.count, 2);
    assert.ok(result.batchAverage >= 1 && result.batchAverage <= 5);
    assert.equal(result.results.length, 2);
  } finally {
    if (origDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = origDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getEvalSummary returns empty message when no history exists', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-geval-empty-'));
  const origDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  try {
    const summary = getEvalSummary();
    assert.ok(summary.message);
    assert.match(summary.message, /No evaluations yet/);
  } finally {
    if (origDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = origDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getEvalSummary aggregates scores from eval log', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-geval-summary-'));
  const origDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  try {
    // Run two evaluations to populate the log
    await evaluate('lesson', { lesson: 'Always verify before deploying' }, { forceHeuristic: true });
    await evaluate('gate', { pattern: 'rm -rf', message: 'Block destructive ops', severity: 'high' }, { forceHeuristic: true });

    const summary = getEvalSummary();
    assert.equal(summary.totalEvaluations, 2);
    assert.ok(summary.summary.lesson);
    assert.ok(summary.summary.gate);
    assert.ok(summary.summary.lesson.averageScore >= 1);
    assert.ok(summary.summary.gate.averageScore >= 1);
    assert.ok(Object.keys(summary.summary.lesson.dimensions).length >= 3);
  } finally {
    if (origDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = origDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP tool registration includes quality_eval tools', () => {
  const { TOOLS } = require('../scripts/tool-registry');
  const names = TOOLS.map((t) => t.name);
  assert.ok(names.includes('quality_eval'), 'quality_eval tool must be registered');
  assert.ok(names.includes('quality_eval_batch'), 'quality_eval_batch tool must be registered');
  assert.ok(names.includes('quality_eval_summary'), 'quality_eval_summary tool must be registered');
});
