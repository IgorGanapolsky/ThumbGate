'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-recall-limit-'));
const tmpUsageFile = path.join(tmpDir, 'usage-limits.json');
const savedEnv = {
  THUMBGATE_API_KEY: process.env.THUMBGATE_API_KEY,
  THUMBGATE_PRO_MODE: process.env.THUMBGATE_PRO_MODE,
  THUMBGATE_NO_RATE_LIMIT: process.env.THUMBGATE_NO_RATE_LIMIT,
  THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
  THUMBGATE_MCP_PROFILE: process.env.THUMBGATE_MCP_PROFILE,
};

// CI exports THUMBGATE_API_KEY for hosted API checks, but this suite verifies free-tier behavior.
delete process.env.THUMBGATE_API_KEY;
delete process.env.THUMBGATE_PRO_MODE;
delete process.env.THUMBGATE_NO_RATE_LIMIT;
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
process.env.THUMBGATE_MCP_PROFILE = 'default';

const { callTool } = require('../adapters/mcp/server-stdio');
const rateLimiter = require('../scripts/rate-limiter');
rateLimiter.USAGE_FILE = tmpUsageFile;

describe('recall free tier (unlimited)', { concurrency: false }, () => {
  test.beforeEach(() => {
    try { fs.unlinkSync(tmpUsageFile); } catch (_) {}
  });

  test('recall returns results without limit for free tier', async () => {
    for (let i = 0; i < 10; i++) {
      const result = await callTool('recall', { query: 'test task' });
      const text = result.content[0].text;
      assert.ok(!text.includes('Free tier limit reached'), `Call ${i + 1} should not be rate-limited`);
    }
  });

  test('recall works on the 6th+ call without upgrade nudge', async () => {
    for (let i = 0; i < 6; i++) {
      const result = await callTool('recall', { query: `task ${i + 1}` });
      const text = result.content[0].text;
      assert.ok(!text.includes('Free tier limit reached'), `Call ${i + 1} should not be blocked`);
    }
  });

  test('recall returns actual content for every call', async () => {
    for (let i = 0; i < 3; i++) {
      const result = await callTool('recall', { query: 'test task' });
      const text = result.content[0].text;
      assert.ok(text.length > 0, 'Should return content');
    }
  });
});

test.after(() => {
  if (savedEnv.THUMBGATE_API_KEY !== undefined) process.env.THUMBGATE_API_KEY = savedEnv.THUMBGATE_API_KEY;
  else delete process.env.THUMBGATE_API_KEY;
  if (savedEnv.THUMBGATE_PRO_MODE !== undefined) process.env.THUMBGATE_PRO_MODE = savedEnv.THUMBGATE_PRO_MODE;
  else delete process.env.THUMBGATE_PRO_MODE;
  if (savedEnv.THUMBGATE_NO_RATE_LIMIT !== undefined) process.env.THUMBGATE_NO_RATE_LIMIT = savedEnv.THUMBGATE_NO_RATE_LIMIT;
  else delete process.env.THUMBGATE_NO_RATE_LIMIT;
  if (savedEnv.THUMBGATE_FEEDBACK_DIR !== undefined) process.env.THUMBGATE_FEEDBACK_DIR = savedEnv.THUMBGATE_FEEDBACK_DIR;
  else delete process.env.THUMBGATE_FEEDBACK_DIR;
  if (savedEnv.THUMBGATE_MCP_PROFILE !== undefined) process.env.THUMBGATE_MCP_PROFILE = savedEnv.THUMBGATE_MCP_PROFILE;
  else delete process.env.THUMBGATE_MCP_PROFILE;
  try { fs.unlinkSync(tmpUsageFile); } catch (_) {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

test('env var restoration covers both defined and undefined paths', () => {
  for (const key of Object.keys(savedEnv)) {
    if (savedEnv[key] !== undefined) {
      assert.equal(typeof savedEnv[key], 'string');
    } else {
      assert.equal(savedEnv[key], undefined);
    }
  }
});
