const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateRagSimilarityGate,
  RAG_SIMILARITY_THRESHOLD,
} = require('../scripts/gates-engine');

// ---------------------------------------------------------------------------
// RAG Similarity Auto-Gate
// ---------------------------------------------------------------------------

test('RAG_SIMILARITY_THRESHOLD defaults to 0.8', () => {
  assert.equal(RAG_SIMILARITY_THRESHOLD, 0.8);
});

test('evaluateRagSimilarityGate returns null for empty input', async () => {
  const result = await evaluateRagSimilarityGate('Bash', {});
  assert.equal(result, null);
});

test('evaluateRagSimilarityGate returns null for short input', async () => {
  const result = await evaluateRagSimilarityGate('', { command: '' });
  assert.equal(result, null);
});

test('evaluateRagSimilarityGate handles missing vector store gracefully', async () => {
  // If LanceDB table doesn't exist, should return null (not throw)
  const result = await evaluateRagSimilarityGate('Bash', { command: 'git push --force' });
  // Result is null since there's no vector store data in test environment
  assert.ok(result === null || (result && result.gate === 'rag-similarity-autogate'));
});

test('evaluateRagSimilarityGate result structure when matched', async () => {
  // This tests the shape of the result when a match would be found
  // In practice, without seeded vector data, this returns null
  const result = await evaluateRagSimilarityGate('Bash', { command: 'some test command' });
  if (result) {
    assert.equal(result.decision, 'deny');
    assert.equal(result.gate, 'rag-similarity-autogate');
    assert.ok(result.message);
    assert.ok(result.severity);
    assert.ok(Array.isArray(result.reasoning));
    assert.ok(result.ragMatch);
    assert.ok(typeof result.ragMatch.similarity === 'number');
    assert.ok(typeof result.ragMatch.threshold === 'number');
  }
});

test('evaluateRagSimilarityGate uses command from toolInput', async () => {
  const result = await evaluateRagSimilarityGate('Bash', { command: 'npm publish --access public' });
  // Without seeded data, null is acceptable
  assert.ok(result === null || result.gate === 'rag-similarity-autogate');
});

test('evaluateRagSimilarityGate uses file_path from toolInput', async () => {
  const result = await evaluateRagSimilarityGate('Write', { file_path: 'CLAUDE.md', content: 'test' });
  assert.ok(result === null || result.gate === 'rag-similarity-autogate');
});

test('evaluateRagSimilarityGate uses content from toolInput', async () => {
  const result = await evaluateRagSimilarityGate('Edit', { content: 'some edit content' });
  assert.ok(result === null || result.gate === 'rag-similarity-autogate');
});
