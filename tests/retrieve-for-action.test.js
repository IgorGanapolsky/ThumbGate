#!/usr/bin/env node
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  retrieveForAction,
  assembleActionContext,
  resolveQueryVariants,
  probeTopLexical,
  mergeFtsSeed,
  ftsRowsToMemories,
  DEFAULT_REWRITE_BELOW,
} = require('../scripts/retrieve-for-action');

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    'utf8',
  );
}

describe('retrieve-for-action defended contract', () => {
  let tmpDir;
  let feedbackDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-rfa-'));
    feedbackDir = path.join(tmpDir, 'feedback');
    fs.mkdirSync(feedbackDir, { recursive: true });
    writeJsonl(path.join(feedbackDir, 'memory-log.jsonl'), [
      {
        id: 'mem_force_push',
        title: 'MISTAKE: force push to main',
        content: 'What went wrong: Agent ran git push --force to main\nHow to avoid: Never force-push protected branches; open a PR instead',
        tags: ['negative', 'git', 'security'],
        signal: 'negative',
        whatToChange: 'Never force-push protected branches; open a PR instead',
        timestamp: new Date().toISOString(),
        metadata: { toolsUsed: ['Bash'] },
      },
      {
        id: 'mem_tests',
        title: 'MISTAKE: claimed green without tests',
        content: 'What went wrong: Claimed done without npm test\nHow to avoid: Always run npm test and show output before claiming done',
        tags: ['negative', 'verification', 'testing'],
        signal: 'negative',
        whatToChange: 'Always run npm test and show output before claiming done',
        timestamp: new Date().toISOString(),
        metadata: { toolsUsed: ['Bash'] },
      },
      {
        id: 'mem_unrelated',
        title: 'SUCCESS: documented API',
        content: 'What worked: Wrote OpenAPI docs before shipping the endpoint',
        tags: ['positive', 'docs'],
        signal: 'positive',
        timestamp: new Date().toISOString(),
      },
    ]);
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('resolveQueryVariants keeps original when lexical is strong', () => {
    const plan = resolveQueryVariants('git push --force main', 0.85, {});
    assert.equal(plan.rewriteApplied, false);
    assert.equal(plan.variants.length, 1);
    assert.equal(plan.rewriteBelowScore, DEFAULT_REWRITE_BELOW);
  });

  it('resolveQueryVariants expands up to 3 variants when lexical is weak', () => {
    const plan = resolveQueryVariants('force push secrets protected branch', 0.2, {});
    assert.ok(plan.variants.length >= 1 && plan.variants.length <= 3);
    assert.equal(plan.rewriteApplied, plan.variants.length > 1);
  });

  it('retrieveForAction ranks force-push lesson for force-push query', () => {
    const { lessons, meta } = retrieveForAction(
      'Bash',
      'git push --force origin main',
      { feedbackDir, maxResults: 3, useFts5: false },
    );
    assert.ok(lessons.length >= 1, 'expected at least one lesson');
    assert.ok(
      lessons.some((l) => /force/i.test(l.content || l.title || l.whatToChange || '')),
      `force-push lesson missing: ${JSON.stringify(lessons.map((l) => l.id))}`,
    );
    assert.ok(Array.isArray(meta.rerankStages));
    assert.ok(meta.rerankStages.includes('pairwise-heuristic'));
    assert.ok(Number.isFinite(meta.topLexical));
    assert.ok(lessons[0].retrieval?.stages?.length >= 1);
  });

  it('assembleActionContext includes citation ids and scores', () => {
    const { lessons, meta } = retrieveForAction(
      'Bash',
      'git push --force origin main',
      { feedbackDir, maxResults: 2, useFts5: false },
    );
    const text = assembleActionContext(lessons, { meta });
    assert.match(text, /system-reminder/);
    assert.match(text, /score=/);
    if (lessons[0]?.id) {
      assert.match(text, new RegExp(lessons[0].id));
    }
  });

  it('ftsRowsToMemories maps sqlite rows into memory shape', () => {
    const memories = ftsRowsToMemories([
      {
        id: 'll_1',
        signal: 'negative',
        context: 'pre-tool-use',
        whatWentWrong: 'force push',
        whatToChange: 'block force push',
        tags: ['git'],
        timestamp: '2026-01-01T00:00:00.000Z',
        rank: -1.2,
      },
    ]);
    assert.equal(memories.length, 1);
    assert.equal(memories[0].id, 'll_1');
    assert.match(memories[0].content, /force push/);
    assert.equal(memories[0].metadata.source, 'sqlite-fts5');
  });

  it('probeTopLexical returns higher score for matching lesson', () => {
    const corpus = [
      {
        id: 'a',
        title: 'force push blocked',
        content: 'never git push --force to main',
        tags: ['negative', 'git'],
      },
      {
        id: 'b',
        title: 'weather',
        content: 'the weather is nice',
        tags: ['positive'],
      },
    ];
    const probe = probeTopLexical(corpus, 'Bash', 'git push --force main');
    assert.ok(probe.topLexical > 0.1);
    assert.equal(probe.topId, 'a');
  });

  it('mergeFtsSeed skips when scoped isolation requested', () => {
    const out = mergeFtsSeed([{ id: 'x' }], 'force push', {
      scope: { project: 'demo' },
      requireScope: true,
    });
    assert.equal(out.fts.applied, false);
    assert.equal(out.fts.reason, 'scoped-isolation');
  });
});
