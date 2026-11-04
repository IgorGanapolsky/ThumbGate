'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ANSWER_TEMPLATES,
  appendTrackerEntry,
  buildAnswer,
  dedupeQuestions,
  discoverAndStage,
  fetchQuestionsForTag,
  getGateExamples,
  getMonetization,
  getShortAnswer,
  getTemplateBody,
  main,
  rankQuestions,
  selectTemplate,
  showStatus,
  slugifyTitle,
  soSearch,
  stageRankedQuestion,
  verifyAntiSlop,
} = require('../scripts/so-answer-cron');

test('slugifyTitle strips non-alphanumeric characters and trims leading/trailing hyphens without backtracking', () => {
  assert.equal(slugifyTitle('  ---How to gate Claude Code & Cursor?!---  '), 'how-to-gate-claude-code-cursor');
  assert.equal(slugifyTitle('---'), '');
  assert.equal(slugifyTitle(null), '');
});

test('selectTemplate and buildAnswer cover safety, branch_review, and devops templates', () => {
  const examples = getGateExamples();
  assert.match(examples.hardBlock, /secret-exfiltration/);
  assert.match(examples.warning, /rm -rf/);

  const safetyTpl = selectTemplate(['claude-code', 'codex']);
  assert.equal(safetyTpl, ANSWER_TEMPLATES.safety);
  const safetyBuilt = buildAnswer({ title: 'Prevent rm -rf in Claude Code' }, safetyTpl, examples);
  assert.equal(safetyBuilt.slug, 'prevent-rm-rf-in-claude-code');
  assert.match(safetyBuilt.body, /PreToolUse/);
  assert.match(safetyBuilt.body, /thumbgate\.ai\/go\/pro-direct/);

  const branchTpl = selectTemplate(['git', 'code-review', 'cursor-ide']);
  assert.equal(branchTpl, ANSWER_TEMPLATES.branch_review);
  assert.match(getShortAnswer({}, branchTpl), /buffer changes/);
  assert.match(getTemplateBody({}, branchTpl, examples), /security-central/);
  assert.match(getMonetization(branchTpl), /Enterprise:/);

  const devopsTpl = selectTemplate(['ci-cd', 'mcp']);
  assert.equal(devopsTpl, ANSWER_TEMPLATES.devops);
  assert.match(getShortAnswer({}, devopsTpl), /shift left/);
  assert.match(getTemplateBody({}, devopsTpl, examples), /agent-loop --health --json/);
  assert.match(getMonetization({ file: 'DevOps pipeline guardrails' }), /\$499 Workflow Gate Diagnostic/);
});

test('rankQuestions filters answered, old, low-score, closed, and wiki items and sorts by ROI', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const questions = [
    { question_id: 1, title: 'Valid high ROI', score: 4, view_count: 200, answer_count: 0, creation_date: nowSec - 3600, tags: ['claude-code', 'mcp'] },
    { question_id: 2, title: 'Already well answered', score: 6, view_count: 500, answer_count: 2, creation_date: nowSec - 3600, tags: ['claude-code'] },
    { question_id: 3, title: 'Too old', score: 3, view_count: 100, answer_count: 0, creation_date: nowSec - 10 * 86400, tags: ['claude-code'] },
    { question_id: 4, title: 'Zero score', score: 0, view_count: 100, answer_count: 0, creation_date: nowSec - 3600, tags: ['claude-code'] },
    { question_id: 5, title: 'Closed question', score: 3, view_count: 100, answer_count: 0, creation_date: nowSec - 3600, closed_date: nowSec, tags: ['claude-code'] },
    { question_id: 6, title: 'Community wiki', score: 3, view_count: 100, answer_count: 0, creation_date: nowSec - 3600, community_owned_date: nowSec, tags: ['claude-code'] },
    { question_id: 7, title: 'Valid lower ROI', score: 1, view_count: 20, answer_count: 1, creation_date: nowSec - 86400, tags: ['unknown-tag'] },
  ];

  const ranked = rankQuestions(questions);
  assert.deepEqual(ranked.map((q) => q.question_id), [1, 7]);
  assert.ok(ranked[0].roi > ranked[1].roi);
});

test('soSearch parses JSON response and handles invalid JSON or network errors', async () => {
  const okResult = await soSearch({ tagged: 'mcp' }, {
    httpGet: (_url, _opts, cb) => {
      const res = new EventEmitter();
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = () => {};
      process.nextTick(() => {
        cb(res);
        res.emit('data', JSON.stringify({ items: [{ question_id: 42 }] }));
        res.emit('end');
      });
      return req;
    },
  });
  assert.equal(okResult.items[0].question_id, 42);

  await assert.rejects(
    () => soSearch({ tagged: 'mcp' }, {
      httpGet: (_url, _opts, cb) => {
        const res = new EventEmitter();
        const req = new EventEmitter();
        req.setTimeout = () => {};
        req.destroy = () => {};
        process.nextTick(() => {
          cb(res);
          res.emit('data', 'not-json');
          res.emit('end');
        });
        return req;
      },
    }),
    /SO API parse error/
  );
});

test('verifyAntiSlop, fetchQuestionsForTag, dedupeQuestions, stageRankedQuestion, appendTrackerEntry, discoverAndStage, showStatus, and main work end-to-end', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-so-cron-test-'));
  const draftsDir = path.join(tmpDir, 'drafts');
  const handoffsDir = path.join(tmpDir, 'handoffs');
    showStatus({ handoffsDir });
    fs.mkdirSync(handoffsDir, { recursive: true });
    fs.writeFileSync(path.join(handoffsDir, 'so-answer-tracker.tsv'), '#timestamp\tquestion_id\n');
    showStatus({ handoffsDir });
    fs.unlinkSync(path.join(handoffsDir, 'so-answer-tracker.tsv'));

  try {
    assert.equal(verifyAntiSlop('/tmp/fake.md', { execSync: () => 'ALLOW\n' }), true);
    assert.equal(verifyAntiSlop('/tmp/fake.md', { execSync: () => { throw new Error('blocked'); } }), false);

    const fetched = await fetchQuestionsForTag('mcp', async () => ({ items: [{ question_id: 10 }] }));
    assert.equal(fetched.length, 1);
    const failedFetch = await fetchQuestionsForTag('mcp', async () => { throw new Error('boom'); });
    assert.deepEqual(failedFetch, []);

    assert.equal(dedupeQuestions([{ question_id: 1 }, { question_id: 1 }, { question_id: 2 }]).length, 2);

    const nowSec = Math.floor(Date.now() / 1000);
    const rejected = stageRankedQuestion(
      { question_id: 99, title: 'Rejected draft', tags: ['mcp'] },
      { draftsDir, verifyAntiSlop: () => false }
    );
    assert.equal(rejected, null);

    const staged = await discoverAndStage({
      tags: ['claude-code', 'mcp'],
      draftsDir,
      handoffsDir,
      verifyAntiSlop: () => true,
      searchFn: async ({ tagged }) => ({
        items: [
          {
            question_id: 101,
            title: `How to guard ${tagged} tool calls`,
            score: 5,
            view_count: 120,
            answer_count: 0,
            creation_date: nowSec - 1800,
            tags: ['claude-code', 'mcp'],
          },
        ],
      }),
    });

    assert.equal(staged.length, 1);
    assert.equal(staged[0].question_id, 101);
    appendTrackerEntry(staged[0], handoffsDir);

    const trackerPath = path.join(handoffsDir, 'so-answer-tracker.tsv');
    const content = fs.readFileSync(trackerPath, 'utf8');
    const headerLines = content.split('\n').filter((line) => line.startsWith('#timestamp'));
    assert.equal(headerLines.length, 1);

    showStatus({ handoffsDir });
    await main(['--status'], { handoffsDir });
    await main(['--post', '101'], { handoffsDir });

    const emptyStaged = await main([], {
      tags: ['mcp'],
      draftsDir,
      handoffsDir,
      searchFn: async () => ({ items: [] }),
    });
    assert.deepEqual(emptyStaged, []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
