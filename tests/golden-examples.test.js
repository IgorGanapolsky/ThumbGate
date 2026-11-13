'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  storeGoldenExample,
  rankGoldenExamples,
  retrieveGoldenExamples,
  formatGoldenExamplesRecallSection,
  voteOnLesson,
} = require('../scripts/verified-lessons');
const { captureFeedback } = require('../scripts/feedback-loop');
const { callTool } = require('../adapters/mcp/server-stdio');

function createTempFeedbackDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-golden-test-'));
  return dir;
}

test('storeGoldenExample creates a golden example record in golden-examples.jsonl', () => {
  const tmpDir = createTempFeedbackDir();
  try {
    const entry = {
      title: 'Optimal AST parser pattern',
      diff: '--- a/parser.js\n+++ b/parser.js\n@@ -1,3 +1,3 @@\n-old()\n+new()',
      prLink: 'https://github.com/IgorGanapolsky/ThumbGate/pull/4900',
      tags: ['ast', 'parser', 'golden'],
      context: 'Clean AST traversal with zero memory leaks',
      whatWorked: 'Used visitor pattern instead of recursive stack',
    };

    const stored = storeGoldenExample(entry, { feedbackDir: tmpDir });
    assert.ok(stored.id.startsWith('golden_'));
    assert.equal(stored.title, 'Optimal AST parser pattern');
    assert.equal(stored.prLink, 'https://github.com/IgorGanapolsky/ThumbGate/pull/4900');
    assert.ok(stored.diff.includes('+new()'));

    const goldenFile = path.join(tmpDir, 'golden-examples.jsonl');
    assert.ok(fs.existsSync(goldenFile));
    const lines = fs.readFileSync(goldenFile, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.id, stored.id);
    assert.equal(parsed.prLink, entry.prLink);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('captureFeedback on thumbs-up tagged "golden" automatically captures accepted diff and PR link', () => {
  const tmpDir = createTempFeedbackDir();
  try {
    const diffText = 'diff --git a/src/core.js b/src/core.js\n+export function cleanCore() { return true; }';
    const prUrl = 'https://github.com/IgorGanapolsky/ThumbGate/pull/4905';

    const result = captureFeedback({
      signal: 'positive',
      context: 'Implemented clean zero-downtime database migration',
      whatWorked: `Adopted expand-contract schema pattern. PR: ${prUrl}`,
      diff: diffText,
      prLink: prUrl,
      tags: ['database', 'migration', 'golden'],
    }, { feedbackDir: tmpDir });

    assert.equal(result.accepted, true);
    assert.equal(result.promoted, true);
    assert.ok(result.goldenExample, 'goldenExample must be returned in captureFeedback result');
    assert.equal(result.goldenExample.prLink, prUrl);
    assert.equal(result.goldenExample.diff, diffText);

    // Verify golden-examples.jsonl has the entry
    const goldenFile = path.join(tmpDir, 'golden-examples.jsonl');
    assert.ok(fs.existsSync(goldenFile));
    const lines = fs.readFileSync(goldenFile, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const stored = JSON.parse(lines[0]);
    assert.equal(stored.prLink, prUrl);
    assert.ok(stored.tags.includes('golden'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('rankGoldenExamples orders candidates by query relevance and vote weight', () => {
  const ex1 = {
    id: 'g1',
    title: 'PostgreSQL connection pooler optimization',
    context: 'Use pgBouncer connection transaction pooling',
    whatWorked: 'Scaled to 10k connections with low memory',
    tags: ['postgres', 'database', 'golden'],
    upVotes: 2,
    downVotes: 0,
    netVotes: 2,
  };

  const ex2 = {
    id: 'g2',
    title: 'React component render optimization',
    context: 'Use useMemo and useCallback for large virtual tables',
    whatWorked: 'Eliminated frame drops on table re-renders',
    tags: ['react', 'ui', 'golden'],
    upVotes: 10,
    downVotes: 0,
    netVotes: 10,
  };

  const ex3 = {
    id: 'g3',
    title: 'PostgreSQL database index selection for composite queries',
    context: 'Added partial btree index on active tenants database tables',
    whatWorked: 'Query latency dropped from 1500ms to 4ms on indexed postgres queries',
    tags: ['postgres', 'database', 'index', 'golden'],
    upVotes: 5,
    downVotes: 0,
    netVotes: 5,
  };

  const rankedPg = rankGoldenExamples('postgres database index', [ex1, ex2, ex3]);
  // ex3 has 3 term hits and higher votes, ranking first
  assert.equal(rankedPg[0].id, 'g3');
  assert.equal(rankedPg[1].id, 'g1');
  assert.equal(rankedPg[2].id, 'g2');

  const rankedReact = rankGoldenExamples('react virtual tables', [ex1, ex2, ex3]);
  assert.equal(rankedReact[0].id, 'g2');
});

test('retrieveGoldenExamples excludes demoted items (downVotes > upVotes)', () => {
  const tmpDir = createTempFeedbackDir();
  try {
    storeGoldenExample({
      id: 'golden_active',
      title: 'Active pattern for micro-benchmarks',
      context: 'Use hrtime.bigint for sub-millisecond precision',
      tags: ['perf', 'benchmark', 'golden'],
      upVotes: 3,
      downVotes: 0,
    }, { feedbackDir: tmpDir });

    storeGoldenExample({
      id: 'golden_demoted',
      title: 'Deprecated benchmark pattern',
      context: 'Use Date.now for benchmarks',
      tags: ['perf', 'benchmark', 'golden'],
      upVotes: 0,
      downVotes: 2,
    }, { feedbackDir: tmpDir });

    const retrieved = retrieveGoldenExamples('benchmark precision', { feedbackDir: tmpDir });
    assert.equal(retrieved.length, 1);
    assert.equal(retrieved[0].id, 'golden_active');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('formatGoldenExamplesRecallSection outputs clean markdown for recall context', () => {
  const examples = [
    {
      title: 'Strict Input Validation Diode',
      prLink: 'https://github.com/IgorGanapolsky/ThumbGate/pull/4890',
      diff: '@@ -10,3 +10,5 @@\n+if (!schema.isValid(input)) {\n+  throw new ValidationError();\n+}',
    },
  ];

  const formatted = formatGoldenExamplesRecallSection(examples);
  assert.ok(formatted.includes('## Golden Examples'));
  assert.ok(formatted.includes('Strict Input Validation Diode'));
  assert.ok(formatted.includes('PR: https://github.com/IgorGanapolsky/ThumbGate/pull/4890'));
  assert.ok(formatted.includes('ValidationError'));
});

test('retrieve_lessons MCP tool returns matching golden examples in results', async () => {
  const tmpDir = createTempFeedbackDir();
  const prevEnv = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  try {
    storeGoldenExample({
      id: 'golden_mcp_test',
      title: 'Clean AST traversal visitor pattern',
      prLink: 'https://github.com/IgorGanapolsky/ThumbGate/pull/4901',
      diff: '+function visit(node) { return node.type; }',
      tags: ['ast', 'parser', 'golden'],
      context: 'ast traversal without deep recursion',
    }, { feedbackDir: tmpDir });

    const response = await callTool('retrieve_lessons', {
      toolName: 'ast_parser',
      actionContext: 'refactoring the ast traversal visitor in parser',
    });

    assert.ok(response && response.content);
    assert.ok(Array.isArray(response.content) && response.content.length > 0);
    const text = response.content[0].text;
    assert.ok(text.includes('golden') || text.includes('GOLDEN EXAMPLE') || text.includes('ast traversal visitor'));
  } finally {
    process.env.THUMBGATE_FEEDBACK_DIR = prevEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('recall MCP tool returns Golden Examples section when matching examples exist', async () => {
  const tmpDir = createTempFeedbackDir();
  const prevEnv = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  try {
    storeGoldenExample({
      id: 'golden_recall_test',
      title: 'Decoupled Event Emitter Architecture',
      prLink: 'https://github.com/IgorGanapolsky/ThumbGate/pull/4902',
      diff: '+class SafeEmitter extends EventEmitter {}',
      tags: ['architecture', 'events', 'golden'],
      context: 'safe asynchronous event dispatch',
    }, { feedbackDir: tmpDir });

    const response = await callTool('recall', {
      query: 'asynchronous event emitter architecture',
    });

    assert.ok(response && response.content);
    const text = response.content[0].text;
    assert.ok(text.includes('## Golden Examples') || text.includes('Decoupled Event Emitter Architecture'));
  } finally {
    process.env.THUMBGATE_FEEDBACK_DIR = prevEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
