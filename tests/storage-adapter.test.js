'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Mock pg module for testing postgres mode
const Module = require('node:module');
const originalRequire = Module.prototype.require;
const mockQueries = [];
const mockPool = {
  query: async (text, params) => {
    mockQueries.push({ text, params });
    return { rows: [] };
  },
  end: async () => {}
};

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

test('storage adapter routes queries dynamically based on config', async () => {
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sqlite-test-'));
  const tempDb = path.join(tmpDir, 'lessons.sqlite');
  process.env.LESSON_DB_PATH = tempDb;

  // 1. Verify default local storage mode
  const adapter = require('../scripts/storage-adapter');
  assert.equal(adapter.getStorageMode(), 'local');

  // Stub embed to avoid HF downloads
  process.env.THUMBGATE_VECTOR_STUB_EMBED = 'true';

  // Test localupsert
  const fbEvent = {
    id: 'fb-local',
    signal: 'down',
    context: 'error',
    whatWentWrong: 'syntax',
    tags: ['local'],
  };
  await adapter.upsertLesson(fbEvent, null);
  
  // Cleanup temp sqlite
  delete process.env.LESSON_DB_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // 2. Test Postgres storage mode
  process.env.THUMBGATE_STORAGE = 'postgres';
  process.env.THUMBGATE_DATABASE_URL = 'postgres://mock:mock@127.0.0.1/db';
  process.env.THUMBGATE_ORG_ID = 'org-storage-test';
  process.env.THUMBGATE_PROJECT_ID = 'project-storage-test';

  // Force re-require to pick up env change
  delete require.cache[require.resolve('../scripts/storage-adapter')];
  const pgAdapter = require('../scripts/storage-adapter');
  assert.equal(pgAdapter.getStorageMode(), 'postgres');

  // Initialize and verify query logs
  mockQueries.length = 0;
  await pgAdapter.initStorage();
  assert.ok(mockQueries.length >= 4);
  assert.ok(mockQueries[0].text.includes('CREATE TABLE IF NOT EXISTS thumbgate.lessons'));
  assert.ok(mockQueries.some((q) => q.text.includes('INSERT INTO thumbgate.projects')));

  // Clean env
  delete process.env.THUMBGATE_STORAGE;
  delete process.env.THUMBGATE_DATABASE_URL;
  delete process.env.THUMBGATE_ORG_ID;
  delete process.env.THUMBGATE_PROJECT_ID;
  delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
});
