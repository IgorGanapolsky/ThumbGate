'use strict';

process.env.THUMBGATE_PRO_MODE = '1';
process.env.THUMBGATE_NO_RATE_LIMIT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const { run } = require('../scripts/gates-engine');
const retrieval = require('../scripts/lesson-retrieval');

/**
 * Mixed-signal lessons about DIFFERENT topics. Before the graph layer this
 * set tripped the knowledge-conflict entropy warning on nearly every call —
 * topic diversity was misread as disagreement.
 */
function mixedTopicLessons({ graphResolved }) {
  const graph = graphResolved ? { resolved: true } : undefined;
  return [
    {
      id: 'positive-lesson',
      title: 'ALLOW: Gemini key setup worked',
      content: 'Past successful setup allowed package install for Gemini credentials.',
      signal: 'positive',
      relevanceScore: 1,
      ...(graph ? { graph } : {}),
    },
    {
      id: 'negative-lesson',
      title: 'MISTAKE: unrelated Upwork workflow failed',
      content: 'How to avoid: do not apply Upwork-specific memory to unrelated setup commands.',
      signal: 'negative',
      relevanceScore: 1,
      ...(graph ? { graph } : {}),
    },
  ];
}

async function withStubbedRetrieval(lessons, fn) {
  const originalRetrieve = retrieval.retrieveRelevantLessons;
  const originalRetrieveAsync = retrieval.retrieveRelevantLessonsAsync;
  const originalEntropy = retrieval.calculateRetrievalEntropy;
  retrieval.retrieveRelevantLessons = () => lessons;
  retrieval.retrieveRelevantLessonsAsync = async () => lessons;
  retrieval.calculateRetrievalEntropy = () => 1;
  try {
    return await fn();
  } finally {
    retrieval.retrieveRelevantLessons = originalRetrieve;
    retrieval.retrieveRelevantLessonsAsync = originalRetrieveAsync;
    retrieval.calculateRetrievalEntropy = originalEntropy;
  }
}

test('graph-resolved mixed-signal set skips the knowledge-conflict entropy warning', async () => {
  await withStubbedRetrieval(mixedTopicLessons({ graphResolved: true }), () => {
    const raw = run({
      tool_name: 'Bash',
      tool_input: { command: 'pip install paperbanana' },
    });
    assert.ok(!raw.includes('Knowledge conflict warning'),
      'graph-vetted set must not warn: ' + raw.slice(0, 300));
    assert.ok(raw.includes('Past mistakes relevant to this action'),
      'negative lesson context still injected: ' + raw.slice(0, 300));
  });
});

test('non-graph-resolved mixed-signal set keeps the legacy conflict warning', async () => {
  await withStubbedRetrieval(mixedTopicLessons({ graphResolved: false }), () => {
    const raw = run({
      tool_name: 'Bash',
      tool_input: { command: 'pip install paperbanana' },
    });
    assert.ok(raw.includes('Knowledge conflict warning'),
      'legacy behavior preserved for unvetted lessons: ' + raw.slice(0, 300));
  });
});

test('partially graph-resolved set stays conservative and warns', async () => {
  const lessons = mixedTopicLessons({ graphResolved: true });
  delete lessons[1].graph; // one lesson unknown to the graph
  await withStubbedRetrieval(lessons, () => {
    const raw = run({
      tool_name: 'Bash',
      tool_input: { command: 'pip install paperbanana' },
    });
    assert.ok(raw.includes('Knowledge conflict warning'),
      'any unvetted lesson keeps the warning: ' + raw.slice(0, 300));
  });
});
