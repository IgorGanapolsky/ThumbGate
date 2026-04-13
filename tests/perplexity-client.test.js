'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PerplexityApiError,
  PerplexityClient,
  buildUrl,
  extractAgentText,
  extractChatText,
  extractCitations,
  normalizeSearchResults,
  redactSecrets,
} = require('../scripts/perplexity-client');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

test('buildUrl normalizes base URLs and paths', () => {
  assert.equal(buildUrl('https://api.perplexity.ai/', '/search'), 'https://api.perplexity.ai/search');
  assert.equal(buildUrl('https://api.perplexity.ai', 'v1/agent'), 'https://api.perplexity.ai/v1/agent');
});

test('redactSecrets removes Perplexity and Bearer tokens from errors', () => {
  const redacted = redactSecrets('bad key pplx-live-secret with Bearer abc.def-123');
  assert.equal(redacted, 'bad key pplx-*** with Bearer ***');
});

test('chatCompletion posts to the chat completions endpoint', async () => {
  const calls = [];
  const client = new PerplexityClient({
    apiKey: 'pplx-test',
    baseUrl: 'https://example.test',
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ choices: [{ message: { content: 'ThumbGate result' } }], citations: ['https://example.com'] });
    },
  });

  const response = await client.chatCompletion({
    model: 'sonar',
    messages: [{ role: 'user', content: 'test' }],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer pplx-test');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: 'sonar',
    messages: [{ role: 'user', content: 'test' }],
  });
  assert.equal(extractChatText(response), 'ThumbGate result');
  assert.deepEqual(extractCitations(response), ['https://example.com']);
});

test('search posts official Search API fields', async () => {
  const calls = [];
  const client = new PerplexityClient({
    apiKey: 'pplx-test',
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ results: [{ title: 'A', url: 'https://a.example', snippet: 'text' }] });
    },
  });

  const response = await client.search({ query: 'agent guardrails', maxResults: 3, maxTokensPerPage: 512 });
  assert.equal(calls[0].url, 'https://api.perplexity.ai/search');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    query: 'agent guardrails',
    max_results: 3,
    max_tokens_per_page: 512,
  });
  assert.deepEqual(normalizeSearchResults(response), [{
    rank: 1,
    title: 'A',
    url: 'https://a.example',
    snippet: 'text',
    source: '',
    date: null,
  }]);
});

test('agentResponse posts to Agent API and extracts output text', async () => {
  const client = new PerplexityClient({
    apiKey: 'pplx-test',
    fetchFn: async (url, options) => {
      assert.equal(url, 'https://api.perplexity.ai/v1/agent');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'openai/gpt-5.4');
      assert.equal(body.input, 'brief');
      assert.deepEqual(body.tools, [{ type: 'web_search' }]);
      return jsonResponse({ output: [{ content: [{ text: 'agent brief' }] }] });
    },
  });

  const response = await client.agentResponse({
    input: 'brief',
    tools: [{ type: 'web_search' }],
  });
  assert.equal(extractAgentText(response), 'agent brief');
});

test('requestJson fails clearly when API key is missing', async () => {
  const client = new PerplexityClient({ apiKey: '', fetchFn: async () => jsonResponse({}) });
  await assert.rejects(
    () => client.search({ query: 'x' }),
    /PERPLEXITY_API_KEY is required/
  );
});

test('requestJson redacts secrets from API errors', async () => {
  const client = new PerplexityClient({
    apiKey: 'pplx-test',
    fetchFn: async () => ({
      ok: false,
      status: 401,
      text: async () => 'invalid pplx-live-secret Bearer abc.def',
    }),
  });

  await assert.rejects(
    () => client.search({ query: 'x' }),
    (err) => {
      assert.ok(err instanceof PerplexityApiError);
      assert.equal(err.status, 401);
      assert.doesNotMatch(err.message, /pplx-live-secret|abc\.def/);
      assert.match(err.message, /pplx-\*\*\*/);
      assert.match(err.message, /Bearer \*\*\*/);
      return true;
    }
  );
});
