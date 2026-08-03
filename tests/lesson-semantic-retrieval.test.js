'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  retrieveRelevantLessons,
  retrieveRelevantLessonsAsync,
  reciprocalRankFusion,
  buildQueryVariants,
  buildQueryPlan,
} = require('../scripts/lesson-retrieval');
const {
  cosineSimilarity,
  isEmbedderAvailable,
} = require('../scripts/lesson-embedding-index');

const savedFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-sem-'));
}

test.after(() => {
  if (savedFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
  else process.env.THUMBGATE_FEEDBACK_DIR = savedFeedbackDir;
});

// A deterministic concept-space embedder used ONLY in tests. It maps text to a
// 3-axis vector by concept so that paraphrases land near each other even with
// zero shared keywords — exactly the recall that lexical retrieval cannot give.
async function conceptEmbedder(text) {
  const t = String(text || '').toLowerCase();
  const destruction = /(delete|remove|\brm\b|wipe|erase|destroy|folder|directory|data|tree)/.test(t) ? 1 : 0;
  const git = /(git|push|force|commit|branch|rebase)/.test(t) ? 1 : 0;
  const network = /(curl|fetch|http|request|endpoint|api)/.test(t) ? 1 : 0;
  // Guarantee a non-zero vector so cosine is defined.
  return [destruction, git, network, 0.001];
}

// --- reciprocalRankFusion -------------------------------------------------

test('reciprocalRankFusion merges two ranked lists by rank, not score', () => {
  const fused = reciprocalRankFusion([
    ['a', 'b', 'c'],
    ['c', 'a', 'd'],
  ]);
  const order = fused.map((f) => f.id);
  // 'a' (ranks 1 & 2) and 'c' (ranks 3 & 1) appear in both → outrank singletons.
  assert.ok(order.indexOf('a') < order.indexOf('b'), 'a should beat b');
  assert.ok(order.indexOf('c') < order.indexOf('b'), 'c should beat b');
  assert.deepEqual(new Set(order), new Set(['a', 'b', 'c', 'd']));
});

test('reciprocalRankFusion tolerates empty/garbage input', () => {
  assert.deepEqual(reciprocalRankFusion([]), []);
  assert.deepEqual(reciprocalRankFusion([null, undefined, []]), []);
});

// --- cosineSimilarity -----------------------------------------------------

test('cosineSimilarity: identical vectors = 1, orthogonal = 0', () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
  assert.equal(cosineSimilarity([1, 0], [2, 0]), 1); // scale-invariant
  assert.equal(cosineSimilarity([], [1]), 0); // shape mismatch is safe
});

// --- the core value: dense recall surfaces a lexical-miss -----------------

test('hybrid retrieval surfaces a paraphrased mistake that lexical retrieval misses', async () => {
  const tmp = mkTmp();
  const now = new Date().toISOString();

  // The dangerous lesson shares NO meaningful tokens with the query phrasing.
  const lessons = [
    {
      id: 'destroy',
      title: 'MISTAKE: rm -rf wiped the contents',
      content: 'How to avoid: never wipe without a backup snapshot',
      tags: ['negative'],
      timestamp: now,
    },
    {
      id: 'gitlesson',
      title: 'force push clobbered history',
      content: 'How to avoid: use --force-with-lease',
      tags: ['negative'],
      timestamp: now,
    },
    {
      id: 'netlesson',
      title: 'curl endpoint timed out',
      content: 'How to avoid: set a request timeout',
      tags: ['positive'],
      timestamp: now,
    },
  ];
  writeJsonl(path.join(tmp, 'memory-log.jsonl'), lessons);

  const query = 'permanently erase a directory tree';

  // Pure lexical retrieval does NOT surface the 'destroy' lesson (no shared tokens
  // above the 3-char tokenizer threshold besides concept-level meaning).
  const lexical = retrieveRelevantLessons('Bash', query, { maxResults: 5, feedbackDir: tmp });
  const lexicalIds = new Set(lexical.map((l) => l.id));
  assert.ok(!lexicalIds.has('destroy'),
    `lexical unexpectedly surfaced 'destroy' (${[...lexicalIds].join(',')}) — pick a stronger paraphrase`);

  // Hybrid retrieval WITH the concept embedder surfaces it via dense similarity.
  const hybrid = await retrieveRelevantLessonsAsync('Bash', query, {
    maxResults: 5,
    feedbackDir: tmp,
    embedder: conceptEmbedder,
  });
  const hybridIds = new Set(hybrid.map((l) => l.id));
  assert.ok(hybridIds.has('destroy'),
    `hybrid should surface the semantically-related 'destroy' lesson, got: ${[...hybridIds].join(',')}`);

  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- honest degradation: errors and missing embedder fall back to lexical --

test('hybrid retrieval falls back to lexical when the embedder throws', async () => {
  const tmp = mkTmp();
  const now = new Date().toISOString();
  writeJsonl(path.join(tmp, 'memory-log.jsonl'), [
    { id: 'm1', title: 'bash git push', content: 'never force push to main', tags: ['negative'], timestamp: now },
    { id: 'm2', title: 'edit lesson', content: 'check file exists', tags: ['positive'], timestamp: now },
  ]);

  const throwingEmbedder = async () => { throw new Error('embedder offline'); };

  const hybrid = await retrieveRelevantLessonsAsync('Bash', 'git push to remote', {
    maxResults: 3,
    feedbackDir: tmp,
    embedder: throwingEmbedder,
  });
  const lexical = retrieveRelevantLessons('Bash', 'git push to remote', { maxResults: 3, feedbackDir: tmp });

  // Identical to lexical → no regression, no thrown error.
  assert.deepEqual(hybrid.map((l) => l.id), lexical.map((l) => l.id));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('hybrid retrieval returns [] for an empty corpus', async () => {
  const tmp = mkTmp();
  const result = await retrieveRelevantLessonsAsync('Bash', 'git push', {
    feedbackDir: tmp,
    embedder: conceptEmbedder,
  });
  assert.deepEqual(result, []);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- embedding cache reuse ------------------------------------------------

test('document vectors are cached and reused across calls', async () => {
  const tmp = mkTmp();
  const now = new Date().toISOString();
  writeJsonl(path.join(tmp, 'memory-log.jsonl'), [
    { id: 'c1', title: 'rm -rf danger', content: 'never delete data', tags: ['negative'], timestamp: now },
  ]);

  let docEmbeds = 0;
  const countingEmbedder = async (text, opts = {}) => {
    if (opts.kind === 'document') docEmbeds += 1;
    return conceptEmbedder(text);
  };

  const opts = { feedbackDir: tmp, embedder: countingEmbedder, maxResults: 3 };
  await retrieveRelevantLessonsAsync('Bash', 'erase the folder', opts);
  const afterFirst = docEmbeds;
  await retrieveRelevantLessonsAsync('Bash', 'wipe the directory', opts);

  assert.equal(afterFirst, 1, 'first call embeds the one document');
  assert.equal(docEmbeds, 1, 'second call reuses the cached document vector (no re-embed)');
  assert.ok(fs.existsSync(path.join(tmp, 'lesson-embeddings.json')), 'cache file persisted');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('embedding cache invalidates when the provider fingerprint or dimension changes', async () => {
  const tmp = mkTmp();
  writeJsonl(path.join(tmp, 'memory-log.jsonl'), [{
    id: 'c-provider',
    title: 'rm danger',
    content: 'never erase data',
    tags: ['negative'],
    timestamp: new Date().toISOString(),
  }]);

  let docEmbeds = 0;
  const embed4 = async (_text, opts = {}) => {
    if (opts.kind === 'document') docEmbeds += 1;
    return [1, 0, 0, 0];
  };
  const embed3 = async (_text, opts = {}) => {
    if (opts.kind === 'document') docEmbeds += 1;
    return [1, 0, 0];
  };

  await retrieveRelevantLessonsAsync('Bash', 'wipe directory', {
    feedbackDir: tmp,
    embedder: embed4,
    embedderId: 'provider-a',
  });
  await retrieveRelevantLessonsAsync('Bash', 'wipe directory', {
    feedbackDir: tmp,
    embedder: embed4,
    embedderId: 'provider-b',
  });
  await retrieveRelevantLessonsAsync('Bash', 'wipe directory', {
    feedbackDir: tmp,
    embedder: embed3,
    embedderId: 'provider-b',
  });

  assert.equal(docEmbeds, 3, 'each provider/dimension transition must re-embed documents');
  const cachePath = path.join(tmp, 'lesson-embeddings.json');
  assert.equal(fs.statSync(cachePath).mode & 0o777, 0o600);
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert.equal(cache['c-provider'].provider, 'provider-b');
  assert.equal(cache['c-provider'].dimension, 3);

  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- availability check is callable and boolean ---------------------------

test('isEmbedderAvailable returns a boolean without loading a model', () => {
  assert.equal(typeof isEmbedderAvailable(), 'boolean');
});

test('runtime provider failure degrades to lexical instead of accepting feature-hash vectors', async () => {
  const tmp = mkTmp();
  writeJsonl(path.join(tmp, 'memory-log.jsonl'), [{
    id: 'provider-failure',
    title: 'rm -rf warning',
    content: 'never delete data',
    tags: ['negative'],
    timestamp: new Date().toISOString(),
  }]);
  const originalFetch = global.fetch;
  try {
    process.env.THUMBGATE_OLLAMA_EMBED_MODEL = 'missing-local-model';
    delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
    global.fetch = async () => { throw new Error('provider offline'); };
    delete require.cache[require.resolve('../scripts/vector-store')];
    const vectorStore = require('../scripts/vector-store');
    vectorStore.setPipelineLoaderForTests(async () => {
      throw new Error('transformer provider offline');
    });
    const lexical = retrieveRelevantLessons('Bash', 'permanently erase a directory', {
      feedbackDir: tmp,
    });
    const result = await retrieveRelevantLessonsAsync('Bash', 'permanently erase a directory', {
      feedbackDir: tmp,
    });
    assert.deepEqual(result.map((row) => row.id), lexical.map((row) => row.id));
    assert.equal(fs.existsSync(path.join(tmp, 'lesson-embeddings.json')), false);
  } finally {
    global.fetch = originalFetch;
    delete process.env.THUMBGATE_OLLAMA_EMBED_MODEL;
    const vectorStore = require('../scripts/vector-store');
    vectorStore.setPipelineLoaderForTests(null);
    delete require.cache[require.resolve('../scripts/vector-store')];
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('bounded query rewriting preserves the original and expands known concepts only', () => {
  const variants = buildQueryVariants('wipe the folder');
  assert.equal(variants[0], 'wipe the folder');
  assert.equal(variants.length, 3);
  assert.match(variants[1], /\b(delete|remove|destroy)\b/);
  assert.match(variants[2], /^failure prevention /);

  const formatting = buildQueryVariants('format the report');
  assert.equal(formatting.some((variant) => /\brm\b/.test(variant)), false,
    'the short synonym "rm" must not match the substring in "format"');

  const device = buildQueryVariants('tablet over the overlay');
  assert.match(device[1], /\bipad\b/);
  assert.match(device[1], /\btailscale\b/);
});

test('HyDE is explicit, bounded, and auditable in the query plan', async () => {
  const plan = await buildQueryPlan('wipe the folder', {
    hydeProvider: 'local-fixture',
    hydeGenerator: async (query, contract) => {
      assert.equal(query, 'wipe the folder');
      assert.equal(contract.maxChars, 700);
      return {
        text: 'A prevention lesson would require a recoverable snapshot before deleting a directory tree.',
        provider: 'local-fixture',
      };
    },
  });
  assert.equal(plan.hydeApplied, true);
  assert.equal(plan.hydeProvider, 'local-fixture');
  assert.equal(plan.strategy, 'deterministic-multi-query+hyde');
  assert.equal(plan.variants.length, 4);
  assert.match(plan.variants[3], /recoverable snapshot/);
});

test('HyDE generator failure degrades to deterministic multi-query with provenance', async () => {
  const plan = await buildQueryPlan('wipe the folder', {
    hydeGenerator: async () => { throw new Error('offline'); },
  });
  assert.equal(plan.hydeApplied, false);
  assert.equal(plan.strategy, 'deterministic-multi-query');
  assert.ok(plan.fallbacks.includes('hyde-generator-failed'));
  assert.deepEqual(plan.variants, buildQueryVariants('wipe the folder'));
});

test('metadata filters prune domain, tags, signal, source, and tools before embedding', async () => {
  const tmp = mkTmp();
  writeJsonl(path.join(tmp, 'memory-log.jsonl'), [
    {
      id: 'wanted',
      title: 'payment retry failed',
      content: 'never retry a charge without idempotency',
      signal: 'negative',
      source: 'operator',
      tags: ['stripe', 'incident'],
      metadata: { domain: 'billing', toolsUsed: ['Bash'] },
      timestamp: new Date().toISOString(),
    },
    {
      id: 'wrong-domain',
      title: 'payment retry failed',
      content: 'database retry notes',
      signal: 'negative',
      source: 'operator',
      tags: ['database', 'incident'],
      metadata: { domain: 'database', toolsUsed: ['SQL'] },
      timestamp: new Date().toISOString(),
    },
  ]);
  const embedded = [];
  const embedder = async (text, options = {}) => {
    if (options.kind === 'document') embedded.push(text);
    return [1, 0, 0, 0];
  };
  const results = await retrieveRelevantLessonsAsync('Bash', 'retry the charge', {
    feedbackDir: tmp,
    embedder,
    embedderId: 'filter-test',
    metadataFilters: {
      domain: 'billing',
      tags: ['stripe', 'incident'],
      signal: 'negative',
      source: 'operator',
      toolsUsed: 'bash',
    },
  });

  assert.deepEqual(results.map((result) => result.id), ['wanted']);
  assert.equal(embedded.some((text) => text.includes('database retry')), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- hybrid pre-filtering / short-circuiting & WHERE-clause pruning -------

test('hybrid retrieval short-circuits (skips embedding) when exact/regex match decides', async () => {
  const tmp = mkTmp();
  const now = new Date().toISOString();
  writeJsonl(path.join(tmp, 'memory-log.jsonl'), [
    {
      id: 'sc-1',
      title: 'exact match bash warning',
      content: 'never use force-push without confirmation',
      tags: ['negative'],
      structuredRule: { if: 'git push', then: 'verify first' },
      timestamp: now,
    },
  ]);

  let embedderCalled = false;
  const spyEmbedder = async (text, opts = {}) => {
    embedderCalled = true;
    return conceptEmbedder(text);
  };

  const results = await retrieveRelevantLessonsAsync('Bash', 'git push to main', {
    feedbackDir: tmp,
    embedder: spyEmbedder,
    maxResults: 3,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'sc-1');
  assert.equal(embedderCalled, false, 'Should have short-circuited and skipped embedding call');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('hybrid retrieval performs WHERE-clause pruning before vector search', async () => {
  const tmp = mkTmp();
  const now = new Date().toISOString();
  writeJsonl(path.join(tmp, 'memory-log.jsonl'), [
    {
      id: 'prune-1',
      title: 'relevant bash mistake',
      content: 'avoid rm -rf',
      tags: ['negative'],
      metadata: { toolsUsed: ['Bash'] },
      timestamp: now,
    },
    {
      id: 'prune-2',
      title: 'unrelated database mistake',
      content: 'drop table prod',
      tags: ['negative'],
      metadata: { toolsUsed: ['SQL'] },
      timestamp: now,
    },
  ]);

  const embeddedDocs = [];
  const spyEmbedder = async (text, opts = {}) => {
    if (opts.kind === 'document') {
      embeddedDocs.push(text);
    }
    return conceptEmbedder(text);
  };

  const results = await retrieveRelevantLessonsAsync('Bash', 'run rm -rf', {
    feedbackDir: tmp,
    embedder: spyEmbedder,
    maxResults: 3,
    strictToolFilter: true,
  });

  // Verify that prune-2 was excluded from embedding generation completely
  assert.ok(embeddedDocs.some(t => t.includes('avoid rm -rf')), 'Should embed relevant document');
  assert.ok(!embeddedDocs.some(t => t.includes('drop table')), 'Should prune unrelated document before vector search');

  fs.rmSync(tmp, { recursive: true, force: true });
});
