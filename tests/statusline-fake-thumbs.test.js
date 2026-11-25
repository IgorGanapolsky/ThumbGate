'use strict';

// AGENT-3667: the status line showed "35 thumbs up" for a project whose owner never gave that many.
// Three wrong ways a row reached the headline, one test each, built from synthetic rows.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { collectHumanRows, computeHumanCounts } = require('../scripts/statusline-human-counts');

function makeProject() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-fake-thumbs-'));
  const project = path.join(home, 'orchestrator');
  fs.mkdirSync(path.join(project, '.thumbgate'), { recursive: true });
  const options = { cwd: project, projectDir: project, env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, TMPDIR: os.tmpdir() } };
  const { projectKey } = collectHumanRows(options);
  const logFile = path.join(project, '.thumbgate', 'feedback-log.jsonl');
  const write = (rows) => fs.writeFileSync(logFile, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return { home, options, projectKey, logFile, write };
}

const at = (i) => new Date(Date.UTC(2026, 10, 14, 12, i)).toISOString();
// What the MCP store-learning tool writes when the agent records a lesson on its own: origin human, no key.
const agentLearning = (i, signal = 'positive') => ({
  id: `agent_${i}_${signal}`, signal, reviewOrigin: 'human', actionType: 'store-learning', tags: ['verification'],
  context: `Verified remediation number ${i}`, timestamp: at(i),
});
// What the user-prompt hook writes from the person's own message.
const personThumb = (i, signal = 'positive', context = 'Igor: great job') => ({
  id: `person_${i}_${signal}`, signal, reviewOrigin: 'human', tags: ['user-prompt-thumbs'], context, timestamp: at(i),
});

test('case 1: rows with no project key and no sign a person typed them are not counted', () => {
  const p = makeProject();
  try {
    p.write([agentLearning(1), agentLearning(2), agentLearning(3, 'negative'), personThumb(4)]);
    const out = collectHumanRows(p.options);
    assert.equal(out.rows.length, 1, 'only the person thumb counts');
    assert.equal(out.rows[0].id, 'person_4_positive');
    assert.equal(out.excluded.unassignedNoEvidence, 3);
    const counts = computeHumanCounts(p.options);
    assert.deepEqual({ up: counts.up, down: counts.down }, { up: 1, down: 0 });
    assert.equal(counts.notCounted, 3, 'the not-counted number is exposed for the dashboard note');
  } finally {
    fs.rmSync(p.home, { recursive: true, force: true });
  }
});

test('case 2: a row with this project key counts, an agent learning without a key does not', () => {
  const p = makeProject();
  try {
    p.write([
      { ...agentLearning(1), projectKey: p.projectKey },
      agentLearning(2),
      agentLearning(3),
    ]);
    const out = collectHumanRows(p.options);
    assert.deepEqual(out.rows.map((row) => row.id), ['agent_1_positive']);
    assert.equal(out.excluded.unassignedNoEvidence, 2);
  } finally {
    fs.rmSync(p.home, { recursive: true, force: true });
  }
});

test('case 3: a thumb whose context names another project never counts, keyed or not', () => {
  const p = makeProject();
  try {
    const stock = '[Eci.Psn.StockService] Igor: thumbs up';
    p.write([
      personThumb(1, 'positive', stock),
      { ...personThumb(2, 'positive', stock), projectKey: p.projectKey },
      personThumb(3, 'positive', '[orchestrator] Igor: thumbs up'),
      personThumb(4, 'positive', 'Igor: thumbs up'),
    ]);
    const out = collectHumanRows(p.options);
    assert.deepEqual(out.rows.map((row) => row.id).sort(), ['person_3_positive', 'person_4_positive']);
    assert.equal(out.excluded.otherProject, 2);
    assert.equal(out.excluded.unassignedNoEvidence, 0);
  } finally {
    fs.rmSync(p.home, { recursive: true, force: true });
  }
});

test('case 4: text that says a person gave the thumb is the agent\'s wording and does not count without the tag', () => {
  const p = makeProject();
  try {
    const old = (id, context, tags = []) => ({ id, signal: 'positive', reviewOrigin: 'human', actionType: 'store-learning', tags, context, timestamp: at(Number(id.slice(-1))) });
    p.write([
      old('said_1', 'Explicit user thumbs-up after the verified local capture workflow'),
      old('said_2', "Igor said 'great' after the cleanup"),
      old('said_3', 'Thumbs up from CLI'),
      old('agent_4', 'Verified ThumbGate remediation: backfilled embeddings', ['verified-outcome']),
      old('agent_5', 'Positive signal on the turn where I checked the date first'),
    ]);
    const out = collectHumanRows(p.options);
    assert.deepEqual(out.rows, []);
    assert.equal(out.excluded.unassignedNoEvidence, 5);
  } finally {
    fs.rmSync(p.home, { recursive: true, force: true });
  }
});

test('case 5: a keyed thumbs-up the history sync guessed or left empty is not counted, a distilled failure is', () => {
  const p = makeProject();
  try {
    const keyed = (id, signal, context) => ({ id, signal, reviewOrigin: 'human', projectKey: p.projectKey, context, timestamp: at(Number(id.slice(-1))) });
    p.write([
      keyed('guess_1', 'positive', 'History-aware distillation found a successful pattern in recent conversation: <task-notification>'),
      { ...keyed('empty_2', 'positive', ''), actionType: 'no-action' },
      keyed('fail_3', 'negative', 'History-aware distillation linked this failure to stop hijacking my mac'),
      keyed('real_4', 'positive', 'Igor: great job'),
    ]);
    const out = collectHumanRows(p.options);
    assert.deepEqual(out.rows.map((row) => row.id).sort(), ['fail_3', 'real_4']);
    assert.equal(out.excluded.autoGenerated, 2);
  } finally {
    fs.rmSync(p.home, { recursive: true, force: true });
  }
});

test('counting only reads the log: no row is deleted or rewritten', () => {
  const p = makeProject();
  try {
    p.write([agentLearning(1), personThumb(2), personThumb(3, 'positive', '[Other] Igor: thumbs up')]);
    const before = fs.readFileSync(p.logFile, 'utf8');
    collectHumanRows(p.options);
    computeHumanCounts(p.options);
    assert.equal(fs.readFileSync(p.logFile, 'utf8'), before);
  } finally {
    fs.rmSync(p.home, { recursive: true, force: true });
  }
});

test('the headline total equals the rows collectHumanRows returns, which the dashboard also uses', () => {
  const p = makeProject();
  try {
    p.write([agentLearning(1), agentLearning(2, 'negative'), personThumb(3), personThumb(4, 'negative'), personThumb(5, 'negative')]);
    const rows = collectHumanRows(p.options).rows;
    const counts = computeHumanCounts(p.options);
    assert.equal(counts.up + counts.down, rows.length);
    assert.deepEqual({ up: counts.up, down: counts.down }, { up: 1, down: 2 });
  } finally {
    fs.rmSync(p.home, { recursive: true, force: true });
  }
});
