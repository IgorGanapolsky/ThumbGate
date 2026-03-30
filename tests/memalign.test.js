'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memalign-test-'));
process.env.RLHF_FEEDBACK_DIR = tmpDir;

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.RLHF_FEEDBACK_DIR;
});

const {
  extractPrinciple,
  extractAllPrinciples,
  getPrinciples,
  PRINCIPLES_FILENAME,
} = require('../scripts/principle-extractor');

const {
  constructWorkingMemory,
  formatWorkingMemoryForContext,
} = require('../scripts/memalign-recall');
const {
  upsertContextObject,
  NAMESPACES,
} = require('../scripts/contextfs');

// --- extractPrinciple ---

describe('extractPrinciple', () => {
  it('extracts negative principle from whatWentWrong + whatToChange', () => {
    const result = extractPrinciple({
      signal: 'negative',
      whatWentWrong: 'Skipped tests before push',
      whatToChange: 'Always run tests before pushing',
      tags: ['testing'],
      context: 'CI broke after push',
    });
    assert.ok(result);
    assert.equal(result.type, 'constraint');
    assert.equal(result.polarity, 'negative');
    assert.ok(result.text.includes('NEVER'));
    assert.ok(result.text.includes('INSTEAD'));
    assert.equal(result.domain, 'testing');
  });

  it('extracts positive principle from whatWorked', () => {
    const result = extractPrinciple({
      signal: 'positive',
      whatWorked: 'Evidence-first verification',
      tags: ['verification'],
      context: 'Caught regression early',
    });
    assert.ok(result);
    assert.equal(result.type, 'heuristic');
    assert.equal(result.polarity, 'positive');
    assert.ok(result.text.includes('ALWAYS'));
  });

  it('returns null on empty entry', () => {
    assert.equal(extractPrinciple({}), null);
    assert.equal(extractPrinciple(null), null);
  });

  it('returns null on unknown signal', () => {
    const result = extractPrinciple({
      signal: 'maybe',
      whatWorked: 'Something',
    });
    assert.equal(result, null);
  });

  it('returns null for negative with no whatWentWrong or whatToChange', () => {
    const result = extractPrinciple({
      signal: 'negative',
      context: 'Something broke',
    });
    assert.equal(result, null);
  });
});

// --- extractAllPrinciples ---

describe('extractAllPrinciples', () => {
  it('creates new principles from feedback log', () => {
    const logPath = path.join(tmpDir, 'extract-all-log.jsonl');
    const principlesPath = path.join(tmpDir, 'extract-all-principles.jsonl');

    fs.writeFileSync(logPath, [
      JSON.stringify({ signal: 'negative', whatWentWrong: 'Forgot to lint', whatToChange: 'Run linter first', tags: ['quality'] }),
      JSON.stringify({ signal: 'positive', whatWorked: 'Wrote tests before code', tags: ['testing'] }),
    ].join('\n') + '\n');

    const result = extractAllPrinciples(logPath, principlesPath);
    assert.equal(result.created, 2);
    assert.equal(result.total, 2);
    assert.ok(fs.existsSync(principlesPath));
  });

  it('deduplicates on rerun (increments sourceCount)', () => {
    const logPath = path.join(tmpDir, 'dedup-log.jsonl');
    const principlesPath = path.join(tmpDir, 'dedup-principles.jsonl');

    const line = JSON.stringify({ signal: 'positive', whatWorked: 'Check PR threads', tags: ['git'] });
    fs.writeFileSync(logPath, `${line}\n`);

    extractAllPrinciples(logPath, principlesPath);
    const result = extractAllPrinciples(logPath, principlesPath);

    assert.equal(result.updated, 1);
    assert.equal(result.total, 1);

    const { readJSONL } = require('../scripts/feedback-loop');
    const principles = readJSONL(principlesPath);
    assert.ok(principles[0].sourceCount >= 2);
  });
});

// --- getPrinciples ---

describe('getPrinciples', () => {
  it('filters by tags', () => {
    const principlesPath = path.join(tmpDir, 'filter-principles.jsonl');
    fs.writeFileSync(principlesPath, [
      JSON.stringify({ text: 'ALWAYS: lint', tags: ['quality'], domain: 'testing', sourceCount: 1 }),
      JSON.stringify({ text: 'NEVER: skip review', tags: ['git'], domain: 'git-workflow', sourceCount: 1 }),
    ].join('\n') + '\n');

    const results = getPrinciples({ tags: ['quality'], principlesPath });
    assert.equal(results.length, 1);
    assert.ok(results[0].text.includes('lint'));
  });

  it('filters by domain', () => {
    const principlesPath = path.join(tmpDir, 'filter-domain.jsonl');
    fs.writeFileSync(principlesPath, [
      JSON.stringify({ text: 'ALWAYS: lint', tags: ['quality'], domain: 'testing', sourceCount: 1 }),
      JSON.stringify({ text: 'NEVER: force push', tags: ['git'], domain: 'git-workflow', sourceCount: 1 }),
    ].join('\n') + '\n');

    const results = getPrinciples({ domain: 'git-workflow', principlesPath });
    assert.equal(results.length, 1);
    assert.ok(results[0].text.includes('force push'));
  });

  it('respects limit', () => {
    const principlesPath = path.join(tmpDir, 'filter-limit.jsonl');
    fs.writeFileSync(principlesPath, [
      JSON.stringify({ text: 'A', tags: [], domain: 'general', sourceCount: 1 }),
      JSON.stringify({ text: 'B', tags: [], domain: 'general', sourceCount: 1 }),
      JSON.stringify({ text: 'C', tags: [], domain: 'general', sourceCount: 1 }),
    ].join('\n') + '\n');

    const results = getPrinciples({ limit: 2, principlesPath });
    assert.equal(results.length, 2);
  });
});

// --- constructWorkingMemory ---

describe('constructWorkingMemory', () => {
  it('returns valid structure', () => {
    const wm = constructWorkingMemory({ query: 'test query', maxChars: 2000 });
    assert.ok(wm.principles !== undefined);
    assert.ok(wm.episodes !== undefined);
    assert.ok(wm.charBudget);
    assert.equal(wm.charBudget.total, 2000);
    assert.equal(wm.charBudget.principles, 400);
    assert.equal(wm.charBudget.episodes, 1600);
  });

  it('respects maxChars budget split', () => {
    const wm = constructWorkingMemory({ query: 'safety', maxChars: 1000 });
    assert.equal(wm.charBudget.principles, 200);
    assert.equal(wm.charBudget.episodes, 800);
  });

  it('routes episodic recall through hierarchical context packs', () => {
    upsertContextObject({
      namespace: NAMESPACES.memoryLearning,
      title: 'Railway deploy health drift',
      content: 'Verify deployment health and build SHA after Railway deploy.',
      tags: ['deployment', 'railway'],
      source: 'feedback-memory',
      metadata: {
        semanticKey: 'deploy-health',
        theme: 'deployment',
      },
    });

    const wm = constructWorkingMemory({ query: 'railway deploy health', maxChars: 1200 });
    assert.equal(wm.episodes.retrieval.strategy, 'hierarchical');
    assert.ok(wm.episodes.retrieval.selectedThemes.includes('deployment'));
  });
});

// --- formatWorkingMemoryForContext ---

describe('formatWorkingMemoryForContext', () => {
  it('includes both sections', () => {
    const wm = {
      principles: [{ text: 'ALWAYS: verify first' }],
      episodes: {
        retrieval: { strategy: 'hierarchical', selectedThemes: ['deployment-health'] },
        items: [{ id: 'ep1', title: 'Test Episode', structuredContext: { rawContent: 'Some context' } }],
      },
    };
    const md = formatWorkingMemoryForContext(wm);
    assert.ok(md.includes('## Principles (Semantic Memory)'));
    assert.ok(md.includes('## Relevant Past Episodes (Episodic Memory)'));
    assert.ok(md.includes('ALWAYS: verify first'));
    assert.ok(md.includes('Test Episode'));
    assert.ok(md.includes('Themes: deployment health'));
  });

  it('handles empty principles and episodes', () => {
    const wm = {
      principles: [],
      episodes: { items: [] },
    };
    const md = formatWorkingMemoryForContext(wm);
    assert.ok(md.includes('## Principles (Semantic Memory)'));
    assert.ok(md.includes('## Relevant Past Episodes (Episodic Memory)'));
    assert.ok(md.includes('No principles extracted yet'));
    assert.ok(md.includes('No relevant episodes found'));
  });
});
