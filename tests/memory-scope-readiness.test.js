'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMemoriStyleBenchmarkRecords,
  buildMemoryScopeReadinessReport,
  isSharedMemory,
  memoryScopeKey,
  missingScopeFields,
  normalizeScope,
  selectRecordsForScope,
} = require('../scripts/memory-scope-readiness');

test('normalizeScope accepts existing JSONL and richContext aliases', () => {
  const scope = normalizeScope({
    user_id: 'alice',
    metadata: { project: 'thumbgate', agent_id: 'coder' },
    richContext: { conversationId: 'session-7' },
  });

  assert.deepEqual(scope, {
    entityId: 'alice',
    projectId: 'thumbgate',
    processId: 'coder',
    sessionId: 'session-7',
  });
  assert.equal(
    memoryScopeKey(scope),
    'entityId:alice|projectId:thumbgate|processId:coder|sessionId:session-7',
  );
});

test('missingScopeFields rejects partial memory records before retrieval', () => {
  assert.deepEqual(missingScopeFields({ entityId: 'alice', projectId: 'thumbgate' }), [
    'processId',
    'sessionId',
  ]);
});

test('selectRecordsForScope blocks cross-user recall and allows explicit shared memory', () => {
  const records = buildMemoriStyleBenchmarkRecords();
  const result = selectRecordsForScope(records, {
    entityId: 'alice',
    projectId: 'thumbgate',
    processId: 'agent-a',
    sessionId: 'session-1',
  });

  assert.deepEqual(result.allowed.map((record) => record.id).sort(), [
    'alice-agent-a-session-1',
    'team-shared-checkout-rule',
  ]);
  assert.ok(result.blocked.some((record) => record.id === 'bob-agent-a-session-1'));
  assert.ok(isSharedMemory(result.allowed.find((record) => record.id === 'team-shared-checkout-rule')));
});

test('selectRecordsForScope blocks same user with different process', () => {
  const records = buildMemoriStyleBenchmarkRecords();
  const result = selectRecordsForScope(records, {
    entityId: 'alice',
    projectId: 'thumbgate',
    processId: 'agent-b',
    sessionId: 'session-1',
  }, { includeShared: false });

  assert.deepEqual(result.allowed.map((record) => record.id), ['alice-agent-b-session-1']);
  assert.ok(result.blocked.some((record) => record.id === 'alice-agent-a-session-1'));
});

test('selectRecordsForScope blocks same project with different session', () => {
  const records = buildMemoriStyleBenchmarkRecords();
  const result = selectRecordsForScope(records, {
    entityId: 'alice',
    projectId: 'thumbgate',
    processId: 'agent-a',
    sessionId: 'session-2',
  }, { includeShared: false });

  assert.deepEqual(result.allowed.map((record) => record.id), ['alice-agent-a-session-2']);
  assert.ok(result.blocked.some((record) => record.id === 'alice-agent-a-session-1'));
});

test('buildMemoryScopeReadinessReport flags unscoped records and cross-scope duplicate memories', () => {
  const records = [
    ...buildMemoriStyleBenchmarkRecords(),
    {
      id: 'legacy-jsonl-row',
      userId: 'alice',
      content: 'Legacy row without complete scope.',
    },
    {
      id: 'alice-duplicate-private',
      entityId: 'alice',
      projectId: 'thumbgate',
      processId: 'agent-a',
      sessionId: 'session-1',
      content: 'Private fact should not silently copy across users.',
    },
    {
      id: 'bob-duplicate-private',
      entityId: 'bob',
      projectId: 'thumbgate',
      processId: 'agent-a',
      sessionId: 'session-1',
      content: 'Private fact should not silently copy across users.',
    },
  ];

  const report = buildMemoryScopeReadinessReport(records);

  assert.equal(report.ready, false);
  assert.equal(report.riskLevel, 'high');
  assert.equal(report.totalRecords, 8);
  assert.equal(report.unscopedRecords, 1);
  assert.equal(report.sharedRecords, 1);
  assert.deepEqual(report.missingFieldsByRecord[0], {
    id: 'legacy-jsonl-row',
    index: 5,
    missingFields: ['projectId', 'processId', 'sessionId'],
  });
  assert.equal(report.crossScopeDuplicates.length, 1);
  assert.ok(report.recommendations.some((item) => item.includes('entityId')));
});

test('buildMemoryScopeReadinessReport returns ready for fully scoped isolated fixtures', () => {
  const report = buildMemoryScopeReadinessReport(buildMemoriStyleBenchmarkRecords());

  assert.equal(report.ready, true);
  assert.equal(report.riskLevel, 'low');
  assert.equal(report.unscopedRecords, 0);
  assert.deepEqual(report.crossScopeDuplicates, []);
});
