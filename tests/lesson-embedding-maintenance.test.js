'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  evaluateEmbeddingIndexDrift,
  backfillLessonEmbeddings,
} = require('../scripts/lesson-embedding-maintenance');

function writeCorpus(directory) {
  fs.writeFileSync(path.join(directory, 'memory-log.jsonl'), [
    JSON.stringify({
      id: 'lesson-a',
      title: 'Never force push',
      content: 'Use force-with-lease.',
      tags: ['negative'],
      timestamp: new Date().toISOString(),
    }),
    JSON.stringify({
      id: 'lesson-b',
      title: 'Back up first',
      content: 'Create a snapshot before deletion.',
      tags: ['negative'],
      timestamp: new Date().toISOString(),
    }),
  ].join('\n') + '\n');
}

test('embedding maintenance detects incomplete coverage and repairs it atomically', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-embedding-maint-'));
  try {
    writeCorpus(directory);
    const before = evaluateEmbeddingIndexDrift({
      feedbackDir: directory,
      embedder: async () => [1, 0, 0],
    });
    assert.equal(before.status, 'unhealthy');
    assert.equal(before.coverage, 0);

    const after = await backfillLessonEmbeddings({
      feedbackDir: directory,
      embedder: async (text) => (
        /force/i.test(String(text)) ? [1, 0, 0] : [0, 1, 0]
      ),
      embedderId: 'maintenance-test',
    });
    assert.equal(after.status, 'healthy');
    assert.equal(after.coverage, 1);
    assert.deepEqual(after.providers, { 'maintenance-test': 2 });
    const cachePath = path.join(directory, 'lesson-embeddings.json');
    assert.equal(fs.statSync(cachePath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('embedding maintenance invalidates content changes instead of counting stale vectors', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-embedding-drift-'));
  try {
    writeCorpus(directory);
    const embedder = async () => [1, 0, 0];
    await backfillLessonEmbeddings({
      feedbackDir: directory,
      embedder,
      embedderId: 'maintenance-test',
    });
    writeCorpus(directory);
    const rows = fs.readFileSync(path.join(directory, 'memory-log.jsonl'), 'utf8')
      .trim().split('\n').map(JSON.parse);
    rows[0].content = 'Changed corrective action.';
    fs.writeFileSync(
      path.join(directory, 'memory-log.jsonl'),
      `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    );
    const drift = evaluateEmbeddingIndexDrift({
      feedbackDir: directory,
      embedder,
    });
    assert.equal(drift.status, 'unhealthy');
    assert.equal(drift.staleCount, 1);
    assert.equal(drift.coverage, 0.5);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
