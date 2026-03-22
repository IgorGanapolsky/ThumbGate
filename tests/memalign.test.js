'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('principle-extractor', () => {
  const { extractPrinciple, extractAllPrinciples, getPrinciples, PRINCIPLES_FILENAME } = require('../scripts/principle-extractor');

  let tmpDir, feedbackLog, principlesFile;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memalign-pe-test-'));
    feedbackLog = path.join(tmpDir, 'feedback-log.jsonl');
    principlesFile = path.join(tmpDir, PRINCIPLES_FILENAME);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('extractPrinciple', () => {
    it('returns valid principle from negative feedback with whatWentWrong + whatToChange', () => {
      const p = extractPrinciple({
        signal: 'negative',
        whatWentWrong: 'committed secrets to git',
        whatToChange: 'run secret-scanner before every commit',
        tags: ['security'],
      });
      assert.ok(p);
      assert.ok(p.text.includes('NEVER'));
      assert.ok(p.text.includes('ALWAYS'));
      assert.equal(p.sourceSignal, 'negative');
      assert.equal(p.sourceCount, 1);
    });

    it('returns valid principle from positive feedback with whatWorked', () => {
      const p = extractPrinciple({
        signal: 'positive',
        whatWorked: 'running tests before committing',
        tags: ['testing'],
      });
      assert.ok(p);
      assert.ok(p.text.includes('ALWAYS'));
      assert.equal(p.sourceSignal, 'positive');
    });

    it('returns null for entries missing NL fields', () => {
      assert.equal(extractPrinciple({ signal: 'negative', tags: ['test'] }), null);
    });

    it('returns null for entries with unknown signal', () => {
      assert.equal(extractPrinciple({ signal: 'maybe', whatWentWrong: 'something' }), null);
    });
  });

  describe('extractAllPrinciples', () => {
    it('creates new principles from a feedback log', () => {
      fs.writeFileSync(feedbackLog, [
        JSON.stringify({ signal: 'negative', whatWentWrong: 'forgot lint', whatToChange: 'always lint', tags: ['git'] }),
        JSON.stringify({ signal: 'positive', whatWorked: 'used TDD approach', tags: ['testing'] }),
        JSON.stringify({ signal: 'negative', tags: [] }),
      ].join('\n') + '\n');

      const result = extractAllPrinciples(feedbackLog, principlesFile);
      assert.equal(result.newCount, 2);
      assert.equal(result.deduped, 0);
      assert.equal(result.principles.length, 2);
    });

    it('deduplicates and increments sourceCount on re-run', () => {
      const result = extractAllPrinciples(feedbackLog, principlesFile);
      assert.equal(result.newCount, 0);
      assert.equal(result.deduped, 2);
      assert.equal(result.principles.length, 2);
      assert.equal(result.principles[0].sourceCount, 2);
    });
  });

  describe('getPrinciples', () => {
    it('filters by tags', () => {
      const result = getPrinciples({ principlesPath: principlesFile, tags: ['testing'] });
      assert.equal(result.length, 1);
      assert.ok(result[0].tags.includes('testing'));
    });

    it('filters by domain', () => {
      const result = getPrinciples({ principlesPath: principlesFile, domain: 'git-workflow' });
      assert.equal(result.length, 1);
    });

    it('respects limit', () => {
      const result = getPrinciples({ principlesPath: principlesFile, limit: 1 });
      assert.equal(result.length, 1);
    });
  });
});

describe('memalign-recall', () => {
  const { constructWorkingMemory, formatWorkingMemoryForContext } = require('../scripts/memalign-recall');

  describe('constructWorkingMemory', () => {
    it('returns valid structure with packId, semanticMemory, episodicMemory', () => {
      const wm = constructWorkingMemory({ query: 'test', maxChars: 4000 });
      assert.ok(wm.packId.startsWith('wm_'));
      assert.ok(wm.semanticMemory);
      assert.ok(wm.episodicMemory);
      assert.ok(typeof wm.totalUsedChars === 'number');
    });

    it('respects maxChars total budget', () => {
      const wm = constructWorkingMemory({ query: 'test', maxChars: 2000 });
      assert.ok(wm.totalUsedChars <= wm.maxChars);
    });
  });

  describe('formatWorkingMemoryForContext', () => {
    it('outputs correct markdown format with both sections', () => {
      const wm = constructWorkingMemory({ query: 'test', maxChars: 4000 });
      const formatted = formatWorkingMemoryForContext(wm);
      assert.ok(formatted.includes('## Principles (Semantic Memory)'));
      assert.ok(formatted.includes('## Relevant Past Episodes (Episodic Memory)'));
    });

    it('handles empty memory gracefully', () => {
      const empty = {
        semanticMemory: { principles: [], count: 0 },
        episodicMemory: { items: [], count: 0 },
      };
      const formatted = formatWorkingMemoryForContext(empty);
      assert.ok(formatted.includes('(none)'));
    });
  });
});
