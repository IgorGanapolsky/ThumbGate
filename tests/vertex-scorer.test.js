'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  geminiConfig, isConfigured, buildGeminiRequest, parseGeminiResponse, scoreWithGemini, DEFAULT_MODEL,
} = require(path.join(__dirname, '..', 'adapters', 'gcp', 'vertex-scorer'));

test('geminiConfig: GEMINI_API_KEY selects the generative-language transport', () => {
  const cfg = geminiConfig({ GEMINI_API_KEY: 'k123' });
  assert.equal(cfg.transport, 'generativelanguage');
  assert.equal(cfg.model, DEFAULT_MODEL);
  assert.match(cfg.url, /generativelanguage\.googleapis\.com.*generateContent$/);
  assert.equal(cfg.headers['x-goog-api-key'], 'k123', 'key goes in a header, not the URL');
  assert.ok(!/k123/.test(cfg.url), 'key must NOT appear in the URL');
  assert.equal(cfg.headers.authorization, undefined);
});

test('geminiConfig: Vertex env selects the vertex transport with a Bearer token', () => {
  const cfg = geminiConfig({
    GOOGLE_VERTEX_PROJECT: 'proj', GOOGLE_VERTEX_LOCATION: 'us-central1', GOOGLE_VERTEX_TOKEN: 'tok',
    THUMBGATE_GEMINI_MODEL: 'gemini-2.5-pro',
  });
  assert.equal(cfg.transport, 'vertex');
  assert.equal(cfg.model, 'gemini-2.5-pro');
  assert.match(cfg.url, /us-central1-aiplatform\.googleapis\.com.*projects\/proj.*models\/gemini-2\.5-pro:generateContent$/);
  assert.equal(cfg.headers.authorization, 'Bearer tok');
});

test('geminiConfig/isConfigured: unconfigured env yields null/false', () => {
  assert.equal(geminiConfig({}), null);
  assert.equal(isConfigured({}), false);
  assert.equal(isConfigured({ GEMINI_API_KEY: 'x' }), true);
});

test('buildGeminiRequest: correct generateContent shape, temperature 0 default', () => {
  const r = buildGeminiRequest('score this');
  assert.equal(r.contents[0].parts[0].text, 'score this');
  assert.equal(r.generationConfig.temperature, 0);
  assert.equal(r.generationConfig.maxOutputTokens, 512);
});

test('parseGeminiResponse: extracts and concatenates candidate text', () => {
  assert.equal(parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab');
  assert.equal(parseGeminiResponse({}), '');
  assert.equal(parseGeminiResponse({ candidates: [] }), '');
});

test('scoreWithGemini: sends the right URL/body and parses the response (mocked fetch)', async () => {
  let seenUrl = null;
  let seenBody = null;
  let seenHeaders = null;
  const fetchImpl = async (url, init) => {
    seenUrl = url;
    seenBody = JSON.parse(init.body);
    seenHeaders = init.headers;
    return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: 'risk=0.8' }] } }] }; } };
  };
  const out = await scoreWithGemini('rate this action', {
    env: { GEMINI_API_KEY: 'KEY' },
    fetchImpl,
  });
  assert.equal(out.text, 'risk=0.8');
  assert.equal(out.transport, 'generativelanguage');
  assert.match(seenUrl, /generateContent$/);
  assert.ok(!/KEY/.test(seenUrl), 'key must not be in the request URL');
  assert.equal(seenHeaders['x-goog-api-key'], 'KEY');
  assert.equal(seenBody.contents[0].parts[0].text, 'rate this action');
});

test('scoreWithGemini: throws clearly when unconfigured', async () => {
  await assert.rejects(
    () => scoreWithGemini('x', { env: {}, fetchImpl: async () => ({}) }),
    /not configured/,
  );
});

test('scoreWithGemini: surfaces a non-ok HTTP error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, async text() { return 'PERMISSION_DENIED'; } });
  await assert.rejects(
    () => scoreWithGemini('x', { env: { GEMINI_API_KEY: 'k' }, fetchImpl }),
    /failed: 403/,
  );
});
