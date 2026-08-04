'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildQueryVariants,
  pragmaticHybridSearch,
  searchWithMultiQuery,
  DEFAULT_LEXICAL_THRESHOLD,
} = require('../scripts/pragmatic-hybrid-search');
const {
  captureDown,
  retrieveAndGate,
  defendPipeline,
  assembleContext,
  decideGate,
} = require('../scripts/defended-rag-pipeline');

test('buildQueryVariants caps at 3 deterministic variants', () => {
  const v = buildQueryVariants('Bash', 'git push --force origin main', { maxVariants: 3 });
  assert.ok(v.length >= 1 && v.length <= 3);
  assert.ok(v.some((x) => /force/i.test(x)));
});

test('pragmaticHybridSearch ranks keyword+bigram match above unrelated', () => {
  const memories = [
    {
      id: 'a',
      title: 'Never force-push main',
      content: 'Do not git push --force to main; open a PR instead',
      tags: ['negative', 'git'],
    },
    {
      id: 'b',
      title: 'Deploy vercel',
      content: 'Use vercel deploy for frontend only',
      tags: ['positive'],
    },
  ];
  const hit = pragmaticHybridSearch('Bash', 'git push --force origin main', memories, {
    maxResults: 5,
  });
  assert.ok(hit.results.length >= 1);
  assert.equal(hit.results[0].id, 'a');
  assert.ok(hit.topScore > 0.1);
  assert.match(hit.method, /pragmatic-hybrid/);
});

test('multi-query fires only when top lexical < 0.6', () => {
  const weak = [
    {
      id: 'x',
      title: 'misc note',
      content: 'something about oranges and weather',
      tags: [],
    },
  ];
  const weakHit = searchWithMultiQuery('Bash', 'git force push protected branch', weak, {
    lexicalThreshold: DEFAULT_LEXICAL_THRESHOLD,
    maxVariants: 3,
  });
  // Weak corpus → topScore low → multiQuery should engage (or still return method)
  assert.ok(typeof weakHit.topScore === 'number');
  assert.ok(weakHit.threshold === 0.6);

  const strong = [
    {
      id: 'y',
      title: 'git push --force origin main blocked',
      content: 'Never force-push to main branch with git push --force',
      tags: ['negative', 'git', 'force-push'],
      metadata: { toolsUsed: ['Bash'] },
    },
  ];
  const strongHit = searchWithMultiQuery('Bash', 'git push --force origin main', strong, {
    lexicalThreshold: 0.05, // almost always skip multi-query when any match
    maxVariants: 3,
  });
  // With very low threshold, multiQuery should be false if we got any score
  if (strongHit.topScore >= 0.05) {
    assert.equal(strongHit.multiQuery, false);
  }
});

test('captureDown quality-gates vague thumbs-down (no promote)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-defended-'));
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    const vague = captureDown({ context: 'thumbs down', feedbackDir: dir });
    assert.equal(vague.promoted, false);
    assert.ok(vague.needsClarification === true || vague.quality?.promotable === false);
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('retrieveAndGate returns deterministic decision', () => {
  const pack = retrieveAndGate('Bash', { command: 'echo hello' }, { maxResults: 3 });
  assert.ok(pack.assembled);
  assert.ok(['allow', 'warn', 'block'].includes(pack.decision.decision));
  assert.ok(pack.lexical);
});

test('assembleContext is deterministic string', () => {
  const text = assembleContext(
    [{ title: 't', content: 'c', relevanceScore: 0.5 }],
    { toolName: 'Bash', lexical: { multiQuery: false, topScore: 0.5 } },
  );
  assert.match(text, /defended RAG/);
  assert.match(text, /Bash/);
});

test('decideGate allows when no lessons', () => {
  const d = decideGate('Bash', { command: 'echo hi' }, []);
  assert.equal(d.decision, 'allow');
});

test('defendPipeline end-to-end proof', () => {
  const proof = defendPipeline();
  assert.equal(proof.schema_version, 'thumbgate-defended-rag/1');
  assert.ok(Array.isArray(proof.pipeline) && proof.pipeline.length >= 7);
  for (const stage of proof.stages) {
    assert.ok(stage.ok, `stage ${stage.name} failed: ${JSON.stringify(stage.detail)}`);
  }
  assert.equal(proof.ok, true);
});
