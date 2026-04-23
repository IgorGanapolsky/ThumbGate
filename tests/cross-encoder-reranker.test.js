#!/usr/bin/env node
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  heuristicCrossEncode,
  llmCrossEncode,
  retrieveWithReranking,
  retrieveWithRerankingSync,
  extractPhrases,
  extractVerbs,
} = require('../scripts/cross-encoder-reranker');

const llmClientPath = require.resolve('../scripts/llm-client');

async function withMockedLlmClient(mock, fn) {
  const previous = require.cache[llmClientPath];
  require.cache[llmClientPath] = {
    id: llmClientPath,
    filename: llmClientPath,
    loaded: true,
    exports: mock,
  };
  try {
    return await fn();
  } finally {
    if (previous) {
      require.cache[llmClientPath] = previous;
    } else {
      delete require.cache[llmClientPath];
    }
  }
}

describe('heuristicCrossEncode', () => {
  it('scores exact substring match highest', () => {
    const score = heuristicCrossEncode('git push --force', 'Avoid: git push --force to protected branches');
    assert.ok(score >= 0.8, `Expected >= 0.8, got ${score}`);
  });

  it('scores semantic category match (destructive)', () => {
    const score = heuristicCrossEncode('rm -rf /tmp', 'Blocked destructive delete operation on config files');
    assert.ok(score > 0.2, `Expected > 0.2, got ${score}`);
  });

  it('scores semantic category match (git)', () => {
    const score = heuristicCrossEncode('git rebase main', 'Agent performed unsafe rebase on protected branch');
    assert.ok(score > 0.2, `Expected > 0.2, got ${score}`);
  });

  it('scores unrelated pairs low', () => {
    const score = heuristicCrossEncode('npm install lodash', 'The weather in Paris is nice today');
    assert.ok(score < 0.2, `Expected < 0.2, got ${score}`);
  });

  it('scores negation alignment', () => {
    const withNeg = heuristicCrossEncode('never force push', 'Avoid: force push to main branch');
    const withoutNeg = heuristicCrossEncode('I did a push', 'The push was successful');
    assert.ok(withNeg > withoutNeg, `Negation alignment: ${withNeg} should be > ${withoutNeg}`);
  });

  it('returns score between 0 and 1', () => {
    const pairs = [
      ['git push --force', 'Blocked force push to main'],
      ['delete all files', 'Agent tried to delete production config'],
      ['hello world', 'unrelated document about cooking'],
      ['', ''],
      ['terraform destroy', 'Never run terraform destroy without approval'],
    ];
    for (const [q, d] of pairs) {
      const s = heuristicCrossEncode(q, d);
      assert.ok(s >= 0 && s <= 1, `Score ${s} out of range for (${q}, ${d})`);
    }
  });

  it('handles empty inputs gracefully', () => {
    assert.equal(heuristicCrossEncode('', ''), 0);
    assert.equal(heuristicCrossEncode(null, null), 0);
    assert.equal(heuristicCrossEncode(undefined, undefined), 0);
  });
});

describe('extractPhrases', () => {
  it('extracts consecutive word pairs', () => {
    const phrases = extractPhrases('git push force main');
    assert.ok(phrases.includes('git push'));
    assert.ok(phrases.includes('push force'));
    assert.ok(phrases.includes('force main'));
  });

  it('filters short words', () => {
    const phrases = extractPhrases('a b c deploy the app');
    assert.ok(phrases.some((p) => p.includes('deploy')));
  });
});

describe('extractVerbs', () => {
  it('extracts known action verbs', () => {
    const verbs = extractVerbs('I want to push and deploy the code then test it');
    assert.ok(verbs.includes('push'));
    assert.ok(verbs.includes('deploy'));
    assert.ok(verbs.includes('test'));
  });

  it('returns empty for non-verb text', () => {
    const verbs = extractVerbs('hello world foo bar');
    assert.equal(verbs.length, 0);
  });
});

describe('retrieveWithRerankingSync', () => {
  it('returns empty array when no lessons exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-rerank-'));
    fs.writeFileSync(path.join(tmpDir, 'memory-log.jsonl'), '');
    const results = retrieveWithRerankingSync('Bash', 'git push --force', { feedbackDir: tmpDir });
    assert.deepEqual(results, []);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reranks candidates by cross-encoder score', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-rerank-'));
    const lessons = [
      { id: 'l1', title: 'MISTAKE: force push destroyed main', content: 'Agent ran git push --force to main branch, overwriting team commits', tags: ['negative'], metadata: { toolsUsed: ['Bash'] }, timestamp: new Date().toISOString() },
      { id: 'l2', title: 'SUCCESS: deployed to staging', content: 'Railway deployment to staging went smoothly', tags: ['positive'], metadata: { toolsUsed: ['Bash'] }, timestamp: new Date().toISOString() },
      { id: 'l3', title: 'MISTAKE: rm -rf on config', content: 'Agent deleted production config files with rm -rf', tags: ['negative'], metadata: { toolsUsed: ['Bash'] }, timestamp: new Date().toISOString() },
      { id: 'l4', title: 'SUCCESS: git push to feature branch', content: 'Normal push to feature branch was safe', tags: ['positive'], metadata: { toolsUsed: ['Bash'] }, timestamp: new Date().toISOString() },
      { id: 'l5', title: 'MISTAKE: terraform destroy', content: 'Agent ran terraform destroy on production infrastructure', tags: ['negative'], metadata: { toolsUsed: ['Bash'] }, timestamp: new Date().toISOString() },
      { id: 'l6', title: 'NOTE: updated readme', content: 'Updated README.md with new documentation', tags: ['positive'], metadata: { toolsUsed: ['Edit'] }, timestamp: new Date().toISOString() },
    ];
    fs.writeFileSync(
      path.join(tmpDir, 'memory-log.jsonl'),
      lessons.map((l) => JSON.stringify(l)).join('\n') + '\n'
    );

    const results = retrieveWithRerankingSync('Bash', 'git push --force to main', {
      feedbackDir: tmpDir,
      candidateCount: 6,
      maxResults: 3,
    });

    assert.ok(results.length <= 3, `Expected <= 3 results, got ${results.length}`);

    // The force-push lesson should be ranked first
    if (results.length > 0) {
      assert.ok(
        results[0].id === 'l1' || results[0].title.includes('force push'),
        `Expected force-push lesson first, got: ${results[0].title}`
      );
    }

    // All results should have crossEncoderScore and combinedScore
    for (const r of results) {
      assert.ok('crossEncoderScore' in r, 'Missing crossEncoderScore');
      assert.ok('combinedScore' in r, 'Missing combinedScore');
      assert.ok(r.combinedScore >= 0 && r.combinedScore <= 2, `combinedScore out of range: ${r.combinedScore}`);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('cross-encoder reranking improves precision over keyword-only', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-rerank-'));
    const lessons = [
      { id: 'decoy', title: 'MISTAKE: git pull failed', content: 'Git pull from remote failed due to merge conflict. Used git push to resolve.', tags: ['negative'], metadata: { toolsUsed: ['Bash'] }, timestamp: new Date().toISOString() },
      { id: 'target', title: 'MISTAKE: force push wiped history', content: 'Never use git push --force on protected branches. It destroyed commit history on main.', tags: ['negative'], metadata: { toolsUsed: ['Bash'] }, timestamp: new Date().toISOString() },
    ];
    fs.writeFileSync(
      path.join(tmpDir, 'memory-log.jsonl'),
      lessons.map((l) => JSON.stringify(l)).join('\n') + '\n'
    );

    const results = retrieveWithRerankingSync('Bash', 'git push --force', {
      feedbackDir: tmpDir,
      candidateCount: 10,
      maxResults: 1,
    });

    // The cross-encoder should rank the actual force-push lesson above the decoy
    // (the decoy mentions "git push" but is about pull failures)
    if (results.length > 0) {
      assert.equal(results[0].id, 'target', `Cross-encoder should rank force-push lesson first, got: ${results[0].id} (${results[0].title})`);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('retrieveWithReranking (async)', () => {
  it('returns same results as sync when LLM is disabled', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-rerank-'));
    const lessons = [
      { id: 'a1', title: 'MISTAKE: DROP TABLE users', content: 'Agent executed DROP TABLE on production database', tags: ['negative'], metadata: { toolsUsed: ['Bash'] }, timestamp: new Date().toISOString() },
    ];
    fs.writeFileSync(
      path.join(tmpDir, 'memory-log.jsonl'),
      lessons.map((l) => JSON.stringify(l)).join('\n') + '\n'
    );

    const asyncResults = await retrieveWithReranking('Bash', 'DROP TABLE', {
      feedbackDir: tmpDir,
      useLLM: false,
    });
    const syncResults = retrieveWithRerankingSync('Bash', 'DROP TABLE', {
      feedbackDir: tmpDir,
    });

    assert.equal(asyncResults.length, syncResults.length);
    if (asyncResults.length > 0) {
      assert.equal(asyncResults[0].id, syncResults[0].id);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('falls back to heuristic reranking when LLM mode is requested but unavailable', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-rerank-'));
    const lessons = [
      { id: 'l1', title: 'MISTAKE: force push', content: 'Never git push --force to main', tags: ['negative'], metadata: { toolsUsed: ['Bash'] }, timestamp: new Date().toISOString() },
      { id: 'l2', title: 'MISTAKE: drop table', content: 'Never run DROP TABLE in production', tags: ['negative'], metadata: { toolsUsed: ['Bash'] }, timestamp: new Date().toISOString() },
      { id: 'l3', title: 'SUCCESS: deploy', content: 'Railway deploy completed', tags: ['positive'], metadata: { toolsUsed: ['Bash'] }, timestamp: new Date().toISOString() },
      { id: 'l4', title: 'NOTE: docs', content: 'Updated README', tags: ['positive'], metadata: { toolsUsed: ['Edit'] }, timestamp: new Date().toISOString() },
      { id: 'l5', title: 'MISTAKE: env secret', content: 'Do not print .env secrets', tags: ['negative'], metadata: { toolsUsed: ['Bash'] }, timestamp: new Date().toISOString() },
      { id: 'l6', title: 'MISTAKE: reset hard', content: 'Avoid git reset --hard on shared branches', tags: ['negative'], metadata: { toolsUsed: ['Bash'] }, timestamp: new Date().toISOString() },
    ];
    fs.writeFileSync(
      path.join(tmpDir, 'memory-log.jsonl'),
      lessons.map((l) => JSON.stringify(l)).join('\n') + '\n'
    );

    const results = await withMockedLlmClient({
      isAvailable: () => false,
      callClaude: async () => { throw new Error('should not call unavailable llm'); },
      MODELS: { FAST: 'mock-fast' },
    }, () => retrieveWithReranking('Bash', 'git push --force', {
      feedbackDir: tmpDir,
      candidateCount: 6,
      maxResults: 2,
      useLLM: true,
    }));

    assert.equal(results.length, 2);
    assert.ok(results.every((result) => typeof result.crossEncoderScore === 'number'));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('llmCrossEncode', () => {
  it('returns null when the LLM client is unavailable', async () => {
    const result = await withMockedLlmClient({
      isAvailable: () => false,
      callClaudeJson: async () => { throw new Error('should not call unavailable llm'); },
      MODELS: { FAST: 'mock-fast' },
    }, () => llmCrossEncode('git push', [{ title: 'A', content: 'B' }]));

    assert.equal(result, null);
  });

  it('parses and clamps LLM scores for the document list', async () => {
    const scores = await withMockedLlmClient({
      isAvailable: () => true,
      callClaudeJson: async ({ systemPrompt, userPrompt, model, maxTokens, cache }) => {
        assert.match(systemPrompt, /relevance scoring engine/);
        assert.match(userPrompt, /Query: "git push"/);
        assert.equal(model, 'mock-fast');
        assert.equal(maxTokens, 256);
        assert.equal(cache, true);
        return [1.2, -0.2, 'not numeric'];
      },
      MODELS: { FAST: 'mock-fast' },
    }, () => llmCrossEncode('git push', [
      { title: 'force push', content: 'main branch' },
      { title: 'docs', content: 'readme' },
      { title: 'deploy', content: 'railway' },
    ]));

    assert.deepEqual(scores, [1, 0, 0]);
  });

  it('falls back when the LLM response is not a matching JSON score array', async () => {
    const wrongLength = await withMockedLlmClient({
      isAvailable: () => true,
      callClaudeJson: async () => [0.9],
      MODELS: { FAST: 'mock-fast' },
    }, () => llmCrossEncode('git push', [{ title: 'A' }, { title: 'B' }]));
    assert.equal(wrongLength, null);

    const invalidJson = await withMockedLlmClient({
      isAvailable: () => true,
      callClaudeJson: async () => 'not json',
      MODELS: { FAST: 'mock-fast' },
    }, () => llmCrossEncode('git push', [{ title: 'A' }]));
    assert.equal(invalidJson, null);
  });
});
