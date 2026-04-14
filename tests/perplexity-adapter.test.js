'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

describe('Perplexity adapter configs', () => {
  const adapterDir = path.join(ROOT, 'adapters', 'perplexity');

  test('.mcp.json exists and is valid JSON with both servers', () => {
    const raw = fs.readFileSync(path.join(adapterDir, '.mcp.json'), 'utf8');
    const config = JSON.parse(raw);
    assert.ok(config.mcpServers.thumbgate, 'should have thumbgate server');
    assert.ok(config.mcpServers.perplexity, 'should have perplexity server');
    assert.ok(config.mcpServers.perplexity.env.PERPLEXITY_API_KEY, 'should reference API key env var');
    assert.ok(config.mcpServers.perplexity.args.includes('@perplexity-ai/mcp-server'), 'should use official MCP package');
    assert.ok(config.hooks.preToolUse, 'should have preToolUse hook');
  });

  test('config.toml exists and has both MCP sections', () => {
    const raw = fs.readFileSync(path.join(adapterDir, 'config.toml'), 'utf8');
    assert.ok(raw.includes('[mcp_servers.thumbgate]'), 'should have thumbgate section');
    assert.ok(raw.includes('[mcp_servers.perplexity]'), 'should have perplexity section');
    assert.ok(raw.includes('@perplexity-ai/mcp-server'), 'should use official MCP package');
    assert.ok(raw.includes('PERPLEXITY_API_KEY'), 'should reference API key');
  });

  test('opencode.json exists and is valid JSON with both servers', () => {
    const raw = fs.readFileSync(path.join(adapterDir, 'opencode.json'), 'utf8');
    const config = JSON.parse(raw);
    assert.ok(config.mcp.thumbgate, 'should have thumbgate');
    assert.ok(config.mcp.perplexity, 'should have perplexity');
    assert.ok(config.mcp.perplexity.enabled, 'perplexity should be enabled');
    assert.ok(config.mcp.perplexity.env.PERPLEXITY_API_KEY, 'should reference API key env var');
  });
});

describe('MCP allowlists include Perplexity tools', () => {
  const allowlists = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'mcp-allowlists.json'), 'utf8'));

  test('default profile includes all 4 Perplexity tools', () => {
    const tools = allowlists.profiles.default;
    assert.ok(tools.includes('perplexity_search'), 'missing perplexity_search');
    assert.ok(tools.includes('perplexity_ask'), 'missing perplexity_ask');
    assert.ok(tools.includes('perplexity_research'), 'missing perplexity_research');
    assert.ok(tools.includes('perplexity_reason'), 'missing perplexity_reason');
  });

  test('readonly profile includes read-only Perplexity tools', () => {
    const tools = allowlists.profiles.readonly;
    assert.ok(tools.includes('perplexity_search'), 'readonly should allow perplexity_search');
    assert.ok(tools.includes('perplexity_ask'), 'readonly should allow perplexity_ask');
  });

  test('dispatch profile includes read-only Perplexity tools', () => {
    const tools = allowlists.profiles.dispatch;
    assert.ok(tools.includes('perplexity_search'), 'dispatch should allow perplexity_search');
    assert.ok(tools.includes('perplexity_ask'), 'dispatch should allow perplexity_ask');
  });

  test('locked profile does NOT include Perplexity tools', () => {
    const tools = allowlists.profiles.locked;
    assert.ok(!tools.includes('perplexity_search'), 'locked must not allow perplexity_search');
    assert.ok(!tools.includes('perplexity_ask'), 'locked must not allow perplexity_ask');
  });
});

describe('enrichWithPerplexity', () => {
  test('returns payload unchanged when no API key', async () => {
    const originalKey = process.env.PERPLEXITY_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    try {
      const { enrichWithPerplexity } = require('../scripts/lesson-search');
      const payload = { results: [{ title: 'test', lesson: { summary: 'something broke' } }], backend: 'jsonl-jaccard' };
      const result = await enrichWithPerplexity(payload);
      assert.equal(result.backend, 'jsonl-jaccard', 'backend should not change without API key');
      assert.ok(!result.results[0].perplexityContext, 'should not enrich without API key');
    } finally {
      if (originalKey) process.env.PERPLEXITY_API_KEY = originalKey;
    }
  });

  test('returns payload unchanged when results are empty', async () => {
    const { enrichWithPerplexity } = require('../scripts/lesson-search');
    const payload = { results: [], backend: 'jsonl-jaccard' };
    const result = await enrichWithPerplexity(payload);
    assert.equal(result.results.length, 0);
  });

  test('adds normalized Perplexity sources to eligible lessons', async () => {
    const originalKey = process.env.PERPLEXITY_API_KEY;
    process.env.PERPLEXITY_API_KEY = 'pplx-test-key';

    const clientModule = require('../scripts/perplexity-client');
    const originalSearch = clientModule.PerplexityClient.prototype.search;
    clientModule.PerplexityClient.prototype.search = async ({ query, maxResults }) => {
      assert.equal(query, 'CLI agents repeated a known deployment mistake');
      assert.equal(maxResults, 3);
      return {
        results: [
          {
            title: 'Deployment guardrails',
            url: 'https://example.com/deployment-guardrails',
            snippet: 'Block repeated release mistakes before execution.',
          },
        ],
      };
    };

    try {
      const { enrichWithPerplexity } = require('../scripts/lesson-search');
      const payload = {
        backend: 'jsonl-jaccard',
        results: [
          {
            title: 'deployment mistake',
            lesson: { whatWentWrong: 'CLI agents repeated a known deployment mistake' },
          },
          {
            title: 'short',
            lesson: { summary: 'too short' },
          },
        ],
      };

      const result = await enrichWithPerplexity(payload, { enrichLimit: 2 });
      assert.equal(result.backend, 'jsonl-jaccard+perplexity');
      assert.equal(result.results[0].perplexityContext.sources.length, 1);
      assert.equal(result.results[0].perplexityContext.sources[0].url, 'https://example.com/deployment-guardrails');
      assert.match(result.results[0].perplexityContext.enrichedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.ok(!result.results[1].perplexityContext, 'short queries should not call Perplexity');
    } finally {
      clientModule.PerplexityClient.prototype.search = originalSearch;
      if (originalKey === undefined) delete process.env.PERPLEXITY_API_KEY;
      else process.env.PERPLEXITY_API_KEY = originalKey;
    }
  });

  test('keeps local lesson results when Perplexity enrichment fails', async () => {
    const originalKey = process.env.PERPLEXITY_API_KEY;
    process.env.PERPLEXITY_API_KEY = 'pplx-test-key';

    const clientModule = require('../scripts/perplexity-client');
    const originalSearch = clientModule.PerplexityClient.prototype.search;
    clientModule.PerplexityClient.prototype.search = async () => {
      throw new Error('network unavailable');
    };

    try {
      const { enrichWithPerplexity } = require('../scripts/lesson-search');
      const payload = {
        backend: 'jsonl-jaccard',
        results: [{
          title: 'deployment mistake',
          lesson: { summary: 'CLI agents repeated a known deployment mistake' },
        }],
      };

      const result = await enrichWithPerplexity(payload);
      assert.equal(result.backend, 'jsonl-jaccard+perplexity');
      assert.equal(result.results[0].title, 'deployment mistake');
      assert.ok(!result.results[0].perplexityContext);
    } finally {
      clientModule.PerplexityClient.prototype.search = originalSearch;
      if (originalKey === undefined) delete process.env.PERPLEXITY_API_KEY;
      else process.env.PERPLEXITY_API_KEY = originalKey;
    }
  });
});
