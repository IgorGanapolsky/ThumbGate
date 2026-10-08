'use strict';

process.env.THUMBGATE_PRO_MODE = '1';
process.env.THUMBGATE_NO_RATE_LIMIT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const { run } = require('../scripts/gates-engine');
const retrieval = require('../scripts/lesson-retrieval');

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

test('graph membership alone does not bypass current mixed-signal suppression', async () => {
  await withStubbedRetrieval(mixedTopicLessons({ graphResolved: true }), () => {
    const raw = run({
      tool_name: 'Bash',
      tool_input: { command: 'pip install paperbanana' },
    });
    assert.ok(!raw.includes('Knowledge conflict warning'),
      'graph-vetted set must not warn: ' + raw.slice(0, 300));
    assert.ok(!raw.includes('Past mistakes relevant to this action'),
      'graph membership does not prove contradiction completeness: ' + raw.slice(0, 300));
  });
});

test('unresolved mixed-signal set retains current suppression', async () => {
  await withStubbedRetrieval(mixedTopicLessons({ graphResolved: false }), () => {
    const raw = run({
      tool_name: 'Bash',
      tool_input: { command: 'pip install paperbanana' },
    });
    assert.ok(!raw.includes('Knowledge conflict warning'),
      'current suppression preserved for unvetted lessons: ' + raw.slice(0, 300));
  });
});

test('partially graph-resolved set retains current suppression', async () => {
  const lessons = mixedTopicLessons({ graphResolved: true });
  delete lessons[1].graph; // one lesson unknown to the graph
  await withStubbedRetrieval(lessons, () => {
    const raw = run({
      tool_name: 'Bash',
      tool_input: { command: 'pip install paperbanana' },
    });
    assert.ok(!raw.includes('Knowledge conflict warning'),
      'unvetted lessons do not inject conflict noise: ' + raw.slice(0, 300));
  });
});
