'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildXMemoryHierarchy,
  computeQueryCoverage,
  retrieveHierarchicalDocuments,
  shouldUseHierarchicalRetrieval,
} = require('../scripts/xmemory-lite');

function makeDoc({
  id,
  title,
  content,
  tags,
  namespace = 'memory/error',
  metadata = {},
  createdAt = '2026-03-30T12:00:00.000Z',
}) {
  return {
    id,
    title,
    content,
    tags,
    namespace,
    metadata,
    createdAt,
  };
}

test('buildXMemoryHierarchy groups documents into themes and semantic clusters', () => {
  const docs = [
    makeDoc({
      id: 'doc_1',
      title: 'Verification miss before claiming done',
      content: 'Skipped tests before claiming done on a checkout fix.',
      tags: ['verification', 'testing'],
      metadata: { semanticKey: 'verification-miss', theme: 'verification' },
    }),
    makeDoc({
      id: 'doc_2',
      title: 'Verification miss before claiming done',
      content: 'Skipped proof before claiming done on a webhook fix.',
      tags: ['verification', 'testing'],
      metadata: { semanticKey: 'verification-miss', theme: 'verification' },
    }),
    makeDoc({
      id: 'doc_3',
      title: 'Railway deploy health drift',
      content: 'Verify deployment health and build SHA after Railway deploy.',
      tags: ['deployment', 'railway'],
      metadata: { semanticKey: 'deploy-health', theme: 'deployment' },
    }),
  ];

  const hierarchy = buildXMemoryHierarchy(docs, { query: 'verification railway deploy' });

  assert.equal(hierarchy.themeCount, 2);
  assert.equal(hierarchy.semanticCount, 2);
  assert.equal(hierarchy.themes[0].semanticCount >= 1, true);
  const verificationTheme = hierarchy.themes.find((theme) => theme.id === 'verification');
  assert.ok(verificationTheme);
  assert.equal(verificationTheme.semantics[0].memberCount, 2);
});

test('retrieveHierarchicalDocuments selects diverse representatives before expanding episodes', () => {
  const docs = [
    makeDoc({
      id: 'doc_1',
      title: 'Verification miss before claiming done',
      content: 'Skipped tests before claiming done on a checkout fix.',
      tags: ['verification', 'testing'],
      metadata: { semanticKey: 'verification-miss', theme: 'verification' },
    }),
    makeDoc({
      id: 'doc_2',
      title: 'Verification miss before claiming done',
      content: 'Skipped proof before claiming done on a webhook fix.',
      tags: ['verification', 'testing'],
      metadata: { semanticKey: 'verification-miss', theme: 'verification' },
    }),
    makeDoc({
      id: 'doc_3',
      title: 'Railway deploy health drift',
      content: 'Verify deployment health and build SHA after Railway deploy.',
      tags: ['deployment', 'railway'],
      metadata: { semanticKey: 'deploy-health', theme: 'deployment' },
    }),
  ];

  const result = retrieveHierarchicalDocuments({
    documents: docs,
    query: 'verification railway deploy',
    maxItems: 2,
    maxChars: 10000,
  });

  assert.equal(result.retrieval.strategy, 'hierarchical');
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.retrieval.selectedThemes.sort(), ['deployment', 'verification']);
  assert.equal(result.retrieval.representativeCount, 2);
  assert.equal(result.retrieval.expandedEpisodes, 0);
});

test('retrieveHierarchicalDocuments expands episodes when coverage remains uncertain', () => {
  const docs = [
    makeDoc({
      id: 'doc_1',
      title: 'Deploy health mismatch',
      content: 'Verify deployment health after Railway rollout.',
      tags: ['deployment', 'railway'],
      metadata: { semanticKey: 'deploy-health', theme: 'deployment' },
    }),
    makeDoc({
      id: 'doc_2',
      title: 'Deploy health mismatch',
      content: 'Compare rollback evidence and build SHA during deploy failures.',
      tags: ['deployment', 'rollback'],
      metadata: { semanticKey: 'deploy-health', theme: 'deployment' },
    }),
  ];

  const result = retrieveHierarchicalDocuments({
    documents: docs,
    query: 'railway rollback build',
    maxItems: 2,
    maxChars: 10000,
    coverageTarget: 0.8,
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.retrieval.expandedEpisodes, 1);
  assert.ok(result.retrieval.queryCoverage >= result.retrieval.initialCoverage);
});

test('computeQueryCoverage returns 1 for empty query tokens', () => {
  assert.equal(computeQueryCoverage([], []), 1);
});

test('shouldUseHierarchicalRetrieval skips research-only namespaces', () => {
  assert.equal(shouldUseHierarchicalRetrieval(['research']), false);
  assert.equal(shouldUseHierarchicalRetrieval(['memory/error', 'rules']), true);
});
