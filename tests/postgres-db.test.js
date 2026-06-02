'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

// Intercept require to mock 'pg'
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'pg') {
    return {
      Pool: function() {
        return mockPool;
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

// Stub pg Pool for unit testing
const mockQueries = [];
const mockPool = {
  query: async (text, params) => {
    mockQueries.push({ text, params });
    if (text.includes('SELECT') && text.includes('lessons')) {
      return {
        rows: [
          {
            id: 'lesson-123',
            signal: 'negative',
            context: 'npm test failed',
            whatWentWrong: 'forgot imports',
            whatToChange: 'import path',
            whatWorked: null,
            domain: 'general',
            tags: ['ci', 'import'],
            timestamp: new Date().toISOString(),
          }
        ]
      };
    }
    if (text.includes('SELECT') && text.includes('brain_memories')) {
      return {
        rows: [
          {
            id: 'mem-123',
            type: 'decision',
            title: 'Always specify output limit',
            content: 'Set max_tokens to prevent truncation',
            reason: 'Truncation caused JSON parse error',
            source: 'tests',
            tags: ['json'],
            timestamp: new Date().toISOString(),
          }
        ]
      };
    }
    return { rows: [] };
  },
  end: async () => {}
};

test('postgres-db schemas boot successfully and execute queries', async () => {
  // Inject mock pool into our postgres-db module
  process.env.THUMBGATE_DATABASE_URL = 'postgres://mock-user:mock-pass@127.0.0.1:5432/mock-db';
  process.env.THUMBGATE_ORG_ID = 'org-test';
  process.env.THUMBGATE_PROJECT_ID = 'project-test';
  process.env.THUMBGATE_AGENT_ID = 'agent-test';
  
  const pgModule = require('../scripts/postgres-db');
  
  // Patch getPool to return our mock
  const { initPostgresDB, upsertLessonPg, searchLessonsSimilarPg, upsertBrainMemoryPg, searchBrainMemorySimilarPg } = pgModule;
  
  // Verify initPostgresDB runs table bootstrap statements
  await initPostgresDB();
  assert.ok(mockQueries.length >= 4);
  assert.ok(mockQueries[0].text.includes('CREATE EXTENSION IF NOT EXISTS vector'));
  assert.ok(mockQueries[0].text.includes('CREATE TABLE IF NOT EXISTS thumbgate.feedback_events'));
  assert.ok(mockQueries[0].text.includes('CREATE TABLE IF NOT EXISTS thumbgate.lesson_embeddings'));
  assert.ok(mockQueries[1].text.includes('INSERT INTO thumbgate.organizations'));

  // Clear mock history
  mockQueries.length = 0;

  // Test Lesson Upsert
  const feedbackEvent = {
    id: 'fb-123',
    signal: 'negative',
    context: 'test failed',
    whatWentWrong: 'import error',
    whatToChange: 'check imports',
    tags: ['ci'],
  };
  const memoryRecord = {
    id: 'lesson-123',
    importance: 'high',
  };
  const embedding = Array(384).fill(0.1);

  await upsertLessonPg(feedbackEvent, memoryRecord, embedding);
  
  // Verify queries were sent for both feedback_events and lessons tables
  assert.ok(mockQueries.length >= 6);
  assert.ok(mockQueries.some((q) => q.text.includes('INSERT INTO thumbgate.feedback_events')));
  assert.ok(mockQueries.some((q) => q.text.includes('INSERT INTO thumbgate.lessons')));
  assert.ok(mockQueries.some((q) => q.text.includes('INSERT INTO thumbgate.lesson_embeddings')));
  assert.ok(mockQueries.some((q) => Array.isArray(q.params) && q.params.includes('org-test')));

  // Test Lesson search
  mockQueries.length = 0;
  const similar = await searchLessonsSimilarPg(embedding, { limit: 5 });
  assert.equal(similar.length, 1);
  assert.equal(similar[0].id, 'lesson-123');

  // Test Brain Memory Upsert
  mockQueries.length = 0;
  const memoryEntry = {
    id: 'mem-123',
    type: 'decision',
    title: 'Always specify output limit',
    source: 'tests',
    tags: ['json'],
  };
  await upsertBrainMemoryPg(memoryEntry, embedding);
  assert.ok(mockQueries.some((q) => q.text.includes('INSERT INTO thumbgate.brain_memories')));

  // Clean env
  delete process.env.THUMBGATE_DATABASE_URL;
  delete process.env.THUMBGATE_ORG_ID;
  delete process.env.THUMBGATE_PROJECT_ID;
  delete process.env.THUMBGATE_AGENT_ID;
});
