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
