'use strict';

/**
 * Phase 10: Training Export tests
 * Requirements: XPRT-01, XPRT-02, XPRT-03, XPRT-04, XPRT-05
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides) {
  return {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    signal: 'positive',
    feedback: 'up',
    reward: 1,
    context: 'Successfully implemented the feature with tests',
    tags: ['implementation', 'testing'],
    richContext: {
      domain: 'testing',
      outcomeCategory: 'quick-success',
    },
    ...overrides,
  };
}

function makeTmpFeedbackDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xprt-test-'));
  const trainingDir = path.join(dir, 'training-data');
  fs.mkdirSync(trainingDir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// validateMemoryStructure (XPRT-04)
// ---------------------------------------------------------------------------

describe('validateMemoryStructure (XPRT-04)', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/export-training.js')];
    m = require('../scripts/export-training.js');
  });

  it('returns valid for a well-formed memory entry', () => {
    const memory = {
      title: 'SUCCESS: Fixed the auth bug',
      content: 'Identified the root cause and applied a targeted fix with tests.',
      category: 'learning',
      tags: ['auth', 'bugfix'],
    };
    const result = m.validateMemoryStructure(memory);
    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);
  });

  it('rejects null input', () => {
    const result = m.validateMemoryStructure(null);
    assert.equal(result.valid, false);
    assert.ok(result.issues.length > 0);
  });

  it('rejects missing title', () => {
    const memory = { content: 'Some content here.', category: 'error', tags: ['testing'] };
    const result = m.validateMemoryStructure(memory);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.includes('title')));
  });

  it('rejects missing content', () => {
    const memory = { title: 'MISTAKE: Bad approach', category: 'error', tags: ['testing'] };
    const result = m.validateMemoryStructure(memory);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.includes('content')));
  });

  it('rejects content too short', () => {
    const memory = {
      title: 'MISTAKE: Short content',
      content: 'Too short',
      category: 'error',
      tags: ['testing'],
    };
    const result = m.validateMemoryStructure(memory);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.includes('content')));
  });

  it('rejects missing category', () => {
    const memory = {
      title: 'LEARNING: Something',
      content: 'This is long enough content for the validation check.',
      tags: ['testing'],
    };
    const result = m.validateMemoryStructure(memory);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.includes('category')));
  });

  it('rejects empty tags array', () => {
    const memory = {
      title: 'PREFERENCE: Good approach',
      content: 'This is long enough content for the validation check.',
      category: 'preference',
      tags: [],
    };
    const result = m.validateMemoryStructure(memory);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.includes('tags')));
  });

  it('rejects DPO export without chosen field (XPRT-04 key scenario)', () => {
    const memory = {
      title: 'PREFERENCE: Something',
      content: 'This is long enough content for the validation check.',
      category: 'preference',
      tags: ['testing'],
      _dpoExport: true,
      prompt: 'What is the best approach?',
      // chosen missing
      rejected: 'The bad approach',
    };
    const result = m.validateMemoryStructure(memory);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.includes('chosen')));
  });

  it('accepts valid DPO export entry with all required fields', () => {
    const memory = {
      title: 'PREFERENCE: Good approach',
      content: 'This is long enough content for the validation check.',
      category: 'preference',
      tags: ['testing'],
      _dpoExport: true,
      prompt: 'What is the best approach?',
      chosen: 'Write tests first (TDD)',
      rejected: 'Skip tests and ship',
    };
    const result = m.validateMemoryStructure(memory);
    assert.equal(result.valid, true);
  });
});

// ---------------------------------------------------------------------------
// buildPreferencePairs (supports XPRT-01)
// ---------------------------------------------------------------------------

describe('buildPreferencePairs', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/export-training.js')];
    m = require('../scripts/export-training.js');
  });

  it('pairs positive with negative entries', () => {
    const entries = [
      makeEntry({ signal: 'positive', context: 'Test passed', tags: ['testing'] }),
      makeEntry({ signal: 'negative', context: 'Test failed', tags: ['testing'], reward: -1 }),
    ];
    const pairs = m.buildPreferencePairs(entries);
    assert.equal(pairs.length, 1);
    assert.ok(pairs[0].prompt);
    assert.ok(pairs[0].chosen);
    assert.ok(pairs[0].rejected);
  });

  it('returns empty array when no negative entries', () => {
    const entries = [
      makeEntry({ signal: 'positive', context: 'All good' }),
      makeEntry({ signal: 'positive', context: 'Also good' }),
    ];
    const pairs = m.buildPreferencePairs(entries);
    assert.equal(pairs.length, 0);
  });

  it('returns empty array when no positive entries', () => {
    const entries = [
      makeEntry({ signal: 'negative', feedback: 'down', context: 'Bad outcome', reward: -1 }),
    ];
    const pairs = m.buildPreferencePairs(entries);
    assert.equal(pairs.length, 0);
  });

  it('prefers tag-overlapping pairs', () => {
    const entries = [
      makeEntry({ signal: 'positive', context: 'Testing success', tags: ['testing'] }),
      makeEntry({ signal: 'positive', context: 'Auth success', tags: ['auth'] }),
      makeEntry({ signal: 'negative', context: 'Testing failure', tags: ['testing'], reward: -1 }),
      makeEntry({ signal: 'negative', context: 'Auth failure', tags: ['auth'], reward: -1 }),
    ];
    const pairs = m.buildPreferencePairs(entries);
    // 2 positives, 2 negatives — should produce 2 pairs
    assert.equal(pairs.length, 2);
    // Each pair should have tag overlap >= 1 (testing↔testing, auth↔auth)
    assert.ok(pairs.every((p) => p.metadata.tagOverlap >= 1));
  });

  it('handles entries using legacy feedback field schema', () => {
    const entries = [
      { ...makeEntry(), signal: undefined, feedback: 'up', reward: 1 },
      { ...makeEntry(), signal: undefined, feedback: 'down', reward: -1, context: 'Failed' },
    ];
    const pairs = m.buildPreferencePairs(entries);
    assert.equal(pairs.length, 1);
  });
});

// ---------------------------------------------------------------------------
// exportPyTorchJSON (XPRT-01)
// ---------------------------------------------------------------------------

describe('exportPyTorchJSON (XPRT-01)', () => {
  let m;
  let tmpDir;
  before(() => {
    delete require.cache[require.resolve('../scripts/export-training.js')];
    m = require('../scripts/export-training.js');
    tmpDir = makeTmpFeedbackDir();
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces valid JSON file with prompt/chosen/rejected fields (XPRT-01)', () => {
    // Write feedback log
    const entries = [
      makeEntry({ signal: 'positive', context: 'Implemented TDD', tags: ['testing'] }),
      makeEntry({ signal: 'negative', context: 'Skipped tests', tags: ['testing'], reward: -1, feedback: 'down' }),
    ];
    const fbPath = path.join(tmpDir, 'feedback-log.jsonl');
    fs.writeFileSync(fbPath, entries.map((e) => JSON.stringify(e)).join('\n'));

    const outPath = path.join(tmpDir, 'test-pytorch.json');
    const result = m.exportPyTorchJSON(tmpDir, outPath);

    assert.ok(fs.existsSync(result.outputPath));
    const data = JSON.parse(fs.readFileSync(result.outputPath, 'utf-8'));

    assert.ok(data.metadata);
    assert.equal(data.metadata.format, 'pytorch-dpo');
    assert.ok(Array.isArray(data.pairs));
    assert.ok(Array.isArray(data.sequences));

    if (data.pairs.length > 0) {
      assert.ok('prompt' in data.pairs[0], 'pairs must have prompt field');
      assert.ok('chosen' in data.pairs[0], 'pairs must have chosen field');
      assert.ok('rejected' in data.pairs[0], 'pairs must have rejected field');
    }
  });

  it('handles empty feedback log gracefully', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xprt-empty-'));
    try {
      const outPath = path.join(emptyDir, 'empty-pytorch.json');
      const result = m.exportPyTorchJSON(emptyDir, outPath);
      assert.ok(fs.existsSync(result.outputPath));
      const data = JSON.parse(fs.readFileSync(result.outputPath, 'utf-8'));
      assert.equal(data.pairs.length, 0);
      assert.equal(data.sequences.length, 0);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// exportCSV (XPRT-02)
// ---------------------------------------------------------------------------

describe('exportCSV (XPRT-02)', () => {
  let m;
  let tmpDir;
  before(() => {
    delete require.cache[require.resolve('../scripts/export-training.js')];
    m = require('../scripts/export-training.js');
    tmpDir = makeTmpFeedbackDir();
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces CSV with correct headers (XPRT-02)', () => {
    const entries = [
      makeEntry({ signal: 'positive', context: 'Works well' }),
      makeEntry({ signal: 'negative', context: 'Has issues', reward: -1, feedback: 'down' }),
    ];
    const fbPath = path.join(tmpDir, 'feedback-log.jsonl');
    fs.writeFileSync(fbPath, entries.map((e) => JSON.stringify(e)).join('\n'));

    const outPath = path.join(tmpDir, 'test.csv');
    const result = m.exportCSV(tmpDir, outPath);

    assert.ok(fs.existsSync(result.outputPath));
    const csv = fs.readFileSync(result.outputPath, 'utf-8');
    const lines = csv.split('\n');
    const headers = lines[0].split(',');

    assert.ok(headers.includes('id'), 'CSV must have id column');
    assert.ok(headers.includes('timestamp'), 'CSV must have timestamp column');
    assert.ok(headers.includes('signal'), 'CSV must have signal column');
    assert.ok(headers.includes('reward'), 'CSV must have reward column');
    assert.ok(headers.includes('context'), 'CSV must have context column');
    assert.equal(result.rowCount, 2);
    assert.equal(lines.length, 3); // header + 2 rows
  });

  it('escapes commas in values', () => {
    const entry = makeEntry({ context: 'Value with, commas, inside' });
    const fbPath = path.join(tmpDir, 'fb-escape.jsonl');
    fs.writeFileSync(fbPath, JSON.stringify(entry));

    const outPath = path.join(tmpDir, 'escape-test.csv');
    // Write to a separate dir to avoid conflict with earlier test
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'xprt-csv-'));
    try {
      fs.mkdirSync(path.join(dir2, 'training-data'), { recursive: true });
      fs.writeFileSync(path.join(dir2, 'feedback-log.jsonl'), JSON.stringify(entry));
      const result = m.exportCSV(dir2, path.join(dir2, 'out.csv'));
      const csv = fs.readFileSync(result.outputPath, 'utf-8');
      // The context column should be wrapped in quotes
      assert.ok(csv.includes('"Value with, commas, inside"'));
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('escapes double quotes in values', () => {
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'xprt-csv-q-'));
    try {
      fs.mkdirSync(path.join(dir3, 'training-data'), { recursive: true });
      const entry = makeEntry({ context: 'He said "hello" there' });
      fs.writeFileSync(path.join(dir3, 'feedback-log.jsonl'), JSON.stringify(entry));
      const result = m.exportCSV(dir3, path.join(dir3, 'out.csv'));
      const csv = fs.readFileSync(result.outputPath, 'utf-8');
      assert.ok(csv.includes('""hello""'));
    } finally {
      fs.rmSync(dir3, { recursive: true, force: true });
    }
  });

  it('handles empty feedback log', () => {
    const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'xprt-csv-e-'));
    try {
      fs.mkdirSync(path.join(dir4, 'training-data'), { recursive: true });
      const result = m.exportCSV(dir4, path.join(dir4, 'out.csv'));
      assert.ok(fs.existsSync(result.outputPath));
      assert.equal(result.rowCount, 0);
    } finally {
      fs.rmSync(dir4, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// escapeCsvField
// ---------------------------------------------------------------------------

describe('escapeCsvField', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/export-training.js')];
    m = require('../scripts/export-training.js');
  });

  it('returns plain string unchanged', () => {
    assert.equal(m.escapeCsvField('hello'), 'hello');
  });

  it('wraps in quotes when contains comma', () => {
    assert.equal(m.escapeCsvField('a,b'), '"a,b"');
  });

  it('doubles quotes inside quoted string', () => {
    assert.equal(m.escapeCsvField('say "hi"'), '"say ""hi"""');
  });

  it('wraps in quotes when contains newline', () => {
    assert.equal(m.escapeCsvField('line1\nline2'), '"line1\nline2"');
  });

  it('handles null/undefined as empty string', () => {
    assert.equal(m.escapeCsvField(null), '');
    assert.equal(m.escapeCsvField(undefined), '');
  });

  it('handles numbers', () => {
    assert.equal(m.escapeCsvField(42), '42');
    assert.equal(m.escapeCsvField(-1), '-1');
  });
});

// ---------------------------------------------------------------------------
// exportActionAnalysis (XPRT-03)
// ---------------------------------------------------------------------------

describe('exportActionAnalysis (XPRT-03)', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/export-training.js')];
    m = require('../scripts/export-training.js');
  });

  it('produces action analysis JSON with required fields (XPRT-03)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xprt-act-'));
    try {
      fs.mkdirSync(path.join(dir, 'training-data'), { recursive: true });

      // Write feedback entries
      const entries = [
        makeEntry({ signal: 'positive', tags: ['testing'] }),
        makeEntry({ signal: 'negative', tags: ['testing'], reward: -1, feedback: 'down' }),
        makeEntry({ signal: 'positive', tags: ['implementation'] }),
      ];
      fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n'));

      // Write sequences with action patterns
      const seqs = [
        {
          id: 'seq_1',
          features: {
            actionPatterns: { testing: { positive: 3, negative: 1 }, implementation: { positive: 5, negative: 0 } },
          },
          targetReward: 1,
          label: 'positive',
        },
      ];
      fs.writeFileSync(path.join(dir, 'feedback-sequences.jsonl'), seqs.map((s) => JSON.stringify(s)).join('\n'));

      const outPath = path.join(dir, 'analysis.json');
      const { outputPath, report } = m.exportActionAnalysis(dir, outPath);

      assert.ok(fs.existsSync(outputPath));
      assert.ok(report.summary);
      assert.ok(report.actionPatterns);
      assert.ok(Array.isArray(report.topFailureModes));
      assert.ok(Array.isArray(report.recommendations));
      assert.equal(report.summary.totalFeedbackEntries, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles missing sequence file gracefully', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xprt-act-ns-'));
    try {
      fs.mkdirSync(path.join(dir, 'training-data'), { recursive: true });
      const outPath = path.join(dir, 'analysis.json');
      const { report } = m.exportActionAnalysis(dir, outPath);
      assert.equal(report.summary.totalFeedbackEntries, 0);
      assert.equal(report.summary.totalSequences, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// generateActionRecommendations
// ---------------------------------------------------------------------------

describe('generateActionRecommendations', () => {
  let m;
  before(() => {
    delete require.cache[require.resolve('../scripts/export-training.js')];
    m = require('../scripts/export-training.js');
  });

  it('recommends avoiding low-success actions', () => {
    const patterns = {
      badAction: { positive: 1, negative: 5, total: 6, successRate: 0.167 },
    };
    const recs = m.generateActionRecommendations(patterns);
    assert.ok(recs.some((r) => r.includes('badAction') && r.toLowerCase().includes('avoid')));
  });

  it('recommends expanding high-success actions', () => {
    const patterns = {
      greatAction: { positive: 9, negative: 1, total: 10, successRate: 0.9 },
    };
    const recs = m.generateActionRecommendations(patterns);
    assert.ok(recs.some((r) => r.includes('greatAction') && r.toLowerCase().includes('expand')));
  });

  it('returns default message for empty patterns', () => {
    const recs = m.generateActionRecommendations({});
    assert.ok(recs.length > 0);
    assert.ok(recs[0].includes('No actionable'));
  });

  it('ignores patterns with fewer than 3 samples', () => {
    const patterns = {
      rareAction: { positive: 0, negative: 2, total: 2, successRate: 0.0 },
    };
    const recs = m.generateActionRecommendations(patterns);
    // Should not make a recommendation for < 3 samples
    assert.ok(!recs.some((r) => r.includes('rareAction')));
  });
});
