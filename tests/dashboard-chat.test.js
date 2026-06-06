'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildChatPrompt,
  parseGeminiAnswer,
  answerDataQuestion,
} = require(path.join(__dirname, '..', 'scripts', 'dashboard-chat'));

test('buildChatPrompt grounds on the provided lessons and the question', () => {
  const prompt = buildChatPrompt('what went wrong?', [
    { signal: 'negative', title: 'hallucinated completion', content: 'claimed published while on a branch', tags: ['gsd'] },
    { signal: 'up', title: 'caught the bug early', content: 'verification pass found it', tags: [] },
  ]);
  assert.match(prompt, /chat with your data/i);
  assert.match(prompt, /\[MISTAKE\] hallucinated completion/);
  assert.match(prompt, /\[WORKED\] caught the bug early/);
  assert.match(prompt, /what went wrong\?/);
  assert.match(prompt, /tags: gsd/);
});

test('parseGeminiAnswer extracts text and tolerates malformed responses', () => {
  assert.equal(parseGeminiAnswer({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab');
  assert.equal(parseGeminiAnswer({}), '');
  assert.equal(parseGeminiAnswer(null), '');
  assert.equal(parseGeminiAnswer({ candidates: [] }), '');
});

test('answerDataQuestion rejects empty questions without calling the model', async () => {
  let called = false;
  const r = await answerDataQuestion('   ', { apiKey: 'k', fetch: async () => { called = true; return {}; } });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'empty_question');
  assert.equal(called, false);
});

test('answerDataQuestion reports a clear message when no API key is configured', async () => {
  const r = await answerDataQuestion('what mistakes?', { apiKey: '', feedbackDir: '/tmp/does-not-exist-xyz' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no_api_key');
  assert.match(r.message, /GEMINI_API_KEY/);
  assert.match(r.message, /THUMBGATE_LOCAL_LLM_ENDPOINT/);
});

test('answerDataQuestion returns a grounded answer with a mocked Gemini', async () => {
  const fakeFetch = async (url, init) => {
    assert.match(url, /generateContent$/);
    assert.equal(init.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(init.body);
    assert.match(body.contents[0].parts[0].text, /grumpy refund bug/i); // the question is in the prompt
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Use --force-with-lease [1].' }] } }], modelVersion: 'gemini-2.5-flash' }),
    };
  };
  const r = await answerDataQuestion('how do we handle the grumpy refund bug?', {
    apiKey: 'test-key',
    feedbackDir: '/tmp/does-not-exist-xyz', // no lessons -> empty context, still answers
    fetch: fakeFetch,
  });
  assert.equal(r.ok, true);
  assert.equal(r.answer, 'Use --force-with-lease [1].');
  assert.equal(r.model, 'gemini-2.5-flash');
  assert.ok(Array.isArray(r.sources));
});

test('answerDataQuestion allowlists the model — junk falls back to default, never routes arbitrarily', async () => {
  let calledUrl = '';
  const fakeFetch = async (url) => {
    calledUrl = url;
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
  };
  await answerDataQuestion('q', { apiKey: 'k', feedbackDir: '/tmp/x', model: '../../evil-model', fetch: fakeFetch });
  assert.match(calledUrl, /models\/gemini-2\.5-flash:generateContent$/, 'junk model must fall back to the default');
  assert.doesNotMatch(calledUrl, /evil-model/);

  await answerDataQuestion('q', { apiKey: 'k', feedbackDir: '/tmp/x', model: 'gemini-2.0-flash', fetch: fakeFetch });
  assert.match(calledUrl, /models\/gemini-2\.0-flash:generateContent$/, 'an allowlisted model passes through');
});

test('answerDataQuestion surfaces a Gemini API error cleanly', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: 'RESOURCE_EXHAUSTED: quota' } }),
  });
  const r = await answerDataQuestion('anything', { apiKey: 'k', feedbackDir: '/tmp/x', fetch: fakeFetch });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'gemini_error');
  assert.equal(r.status, 429);
  assert.match(r.message, /RESOURCE_EXHAUSTED/);
});

test('answerDataQuestion routes to a local OpenAI-compatible endpoint', async () => {
  let calledUrl = '';
  let calledHeaders = {};
  let calledBody = null;
  const fakeFetch = async (url, init) => {
    calledUrl = url;
    calledHeaders = init.headers;
    calledBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'local LLM grounded response' } }],
        model: 'local-model-id',
      }),
    };
  };

  const r = await answerDataQuestion('how to configure gates?', {
    apiKey: 'dummy-local-key',
    localEndpoint: 'http://localhost:11434/v1/chat/completions',
    localModel: 'llama-local',
    feedbackDir: '/tmp/does-not-exist-xyz',
    fetch: fakeFetch,
  });

  assert.equal(r.ok, true);
  assert.equal(r.answer, 'local LLM grounded response');
  assert.equal(r.model, 'local-model-id');
  assert.equal(calledUrl, 'http://localhost:11434/v1/chat/completions');
  assert.equal(calledHeaders.Authorization, 'Bearer dummy-local-key');
  assert.equal(calledBody.model, 'llama-local');
  assert.match(calledBody.messages[0].content, /how to configure gates\?/);
});

test('answerDataQuestion can use a local endpoint without an API key', async () => {
  let calledHeaders = {};
  const fakeFetch = async (url, init) => {
    calledHeaders = init.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'response without apiKey' } }],
      }),
    };
  };

  const r = await answerDataQuestion('how to configure gates?', {
    apiKey: '',
    localEndpoint: 'http://localhost:11434/v1',
    feedbackDir: '/tmp/does-not-exist-xyz',
    fetch: fakeFetch,
  });

  assert.equal(r.ok, true);
  assert.equal(r.answer, 'response without apiKey');
  assert.equal(calledHeaders.Authorization, 'Bearer local');
});
