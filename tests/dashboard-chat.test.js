'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildChatPrompt,
  parseGeminiAnswer,
  answerDataQuestion,
  resolveBudgetedProviderRoute,
} = require(path.join(__dirname, '..', 'scripts', 'dashboard-chat'));
const { FrontierBudget } = require('../scripts/model-tier-router');
const { _resetFrontierDayCounts } = require('../scripts/tier-budget-guard');

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

test('budget tiers map to the actual Gemini model and fail closed when unmapped', () => {
  const mini = resolveBudgetedProviderRoute({
    requestedModel: 'gemini-2.5-pro',
    budgetTier: 'mini',
  });
  assert.deepEqual(mini, {
    allowed: true,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    tier: 'mini',
  });
  const unmapped = resolveBudgetedProviderRoute({
    isPerplexity: true,
    budgetTier: 'nano',
  });
  assert.equal(unmapped.allowed, false);
  assert.match(unmapped.reason, /no_perplexity_model_for_tier:nano/);
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

test('a frontier budget downgrade changes the actual provider model', async () => {
  const previous = process.env.THUMBGATE_MAX_FRONTIER_PER_DAY;
  process.env.THUMBGATE_MAX_FRONTIER_PER_DAY = '0';
  _resetFrontierDayCounts();
  let calledUrl = '';
  try {
    const result = await answerDataQuestion('review architecture', {
      apiKey: 'k',
      feedbackDir: '/tmp/does-not-exist-xyz',
      taskType: 'review',
      tags: ['cross-file'],
      model: 'gemini-2.5-pro',
      qualityTier: { qualityTier: 'degraded', semanticClaimsAllowed: false, degradedReasons: [] },
      fetch: async (url) => {
        calledUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
        };
      },
    });
    assert.equal(result.ok, true);
    assert.match(calledUrl, /gemini-2\.5-flash:generateContent$/);
    assert.equal(result.envelope.tier, 'mini');
    assert.equal(result.envelope.model, 'gemini-2.5-flash');
  } finally {
    if (previous == null) delete process.env.THUMBGATE_MAX_FRONTIER_PER_DAY;
    else process.env.THUMBGATE_MAX_FRONTIER_PER_DAY = previous;
    _resetFrontierDayCounts();
  }
});

test('successful frontier calls charge the reusable session budget', async () => {
  const budget = new FrontierBudget({ tokenCap: 10_000 });
  _resetFrontierDayCounts();
  const result = await answerDataQuestion('review architecture', {
    apiKey: 'k',
    feedbackDir: '/tmp/does-not-exist-xyz',
    taskType: 'review',
    tags: ['cross-file'],
    model: 'gemini-2.5-pro',
    frontierBudget: budget,
    qualityTier: { qualityTier: 'degraded', semanticClaimsAllowed: false, degradedReasons: [] },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    }),
  });
  assert.equal(result.ok, true);
  assert.ok(budget.spent > 0);
  assert.equal(budget.invocations.length, 1);
  assert.equal(result.envelope.budget.frontierSessionCharge.success, true);
  _resetFrontierDayCounts();
});

test('answerDataQuestion exposes model and privacyRoute for local vs BYO cloud and computeTodayOverview uses real disk/audit counts', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { computeTodayOverview } = require('../scripts/dashboard');

  const localRes = await answerDataQuestion('summarize lessons', {
    localEndpoint: 'http://127.0.0.1:11434/v1',
    localModel: 'qwen2.5-coder:14b',
    feedbackDir: '/tmp/does-not-exist-xyz',
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ model: 'qwen2.5-coder:14b', choices: [{ message: { content: 'Local answer [1].' } }] }),
    }),
  });
  assert.equal(localRes.ok, true);
  assert.equal(localRes.model, 'qwen2.5-coder:14b');
  assert.equal(localRes.privacyRoute, 'Local, no cloud');

  const byoRes = await answerDataQuestion('summarize lessons', {
    apiKey: 'test-gemini-key',
    feedbackDir: '/tmp/does-not-exist-xyz',
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ modelVersion: 'gemini-2.5-flash', candidates: [{ content: { parts: [{ text: 'Cloud answer.' }] } }] }),
    }),
  });
  assert.equal(byoRes.ok, true);
  assert.equal(byoRes.model, 'gemini-2.5-flash');
  assert.equal(byoRes.privacyRoute, 'BYO model (gemini)');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-today-overview-'));
  try {
    const emptyOverview = computeTodayOverview(tmpDir, {
      entries: [],
      memoryEntries: [],
      auditEntries: [],
      gateStats: { totalGates: 0, blocked: 0, warned: 0 },
      gateAudit: { days: [{ dayKey: '2026-11-12', deny: 0, warn: 0, allow: 0 }] },
      gates: [],
    });
    assert.equal(emptyOverview.firstBlockRecorded, false);
    assert.equal(emptyOverview.totalGateBlocks, 0);
    assert.equal(emptyOverview.upNext.kind, 'finish_setup');
    assert.equal(emptyOverview.upNext.title, 'Finish setup to record your first gate block →');
    assert.equal(emptyOverview.upNext.command, 'npx thumbgate quickstart');
    assert.equal(emptyOverview.upNext.actionHref, '/install#quickstart');
    assert.match(emptyOverview.upNext.detail, /npx thumbgate quickstart/);
    assert.match(emptyOverview.upNext.detail, /built-in safety rule pack \+ 3 custom block rules/);
    assert.deepEqual(emptyOverview.gateStatusChips, { blockedToday: 0, warnedToday: 0, activeGates: 0 });
    assert.equal(emptyOverview.lessonStorage.lessonDbBytes, 0);
    assert.equal(emptyOverview.lessonStorage.lessonDbSizeDisplay, '0 B');

    // Feedback captured + warnings logged, but STILL 0 gate blocks -> Finish setup bar remains shown (keyed on first block, not feedback count)
    const feedbackNoBlocksOverview = computeTodayOverview(tmpDir, {
      entries: [{ signal: 'positive', timestamp: '2026-11-12T10:00:00.000Z' }, { signal: 'negative', timestamp: '2026-11-12T10:05:00.000Z' }],
      memoryEntries: [],
      auditEntries: [{ decision: 'warn', gateId: 'gate:env-read', timestamp: '2026-11-12T10:06:00.000Z' }],
      gateStats: { totalGates: 12, blocked: 0, warned: 1 },
      gateAudit: { days: [{ dayKey: '2026-11-12', deny: 0, warn: 1, allow: 4 }], totals: { deny: 0, warn: 1, allow: 4 } },
    });
    assert.equal(feedbackNoBlocksOverview.firstBlockRecorded, false);
    assert.equal(feedbackNoBlocksOverview.totalGateBlocks, 0);
    assert.ok(feedbackNoBlocksOverview.upNext, 'Finish setup bar must stay visible when feedback > 0 but gate blocks === 0');
    assert.equal(feedbackNoBlocksOverview.upNext.kind, 'finish_setup');

    // Once >= 1 gate block is recorded, Finish setup bar disappears (upNext === null)
    const lessonLine = JSON.stringify({ id: 'mem_1', gateId: 'gate:force-push', title: 'Never force-push protected branches', tags: ['git'] }) + '\n';
    fs.writeFileSync(path.join(tmpDir, 'memory-log.jsonl'), lessonLine);
    const nowIso = new Date().toISOString();
    const activeOverview = computeTodayOverview(tmpDir, {
      entries: [{ signal: 'negative', timestamp: nowIso }],
      memoryEntries: [JSON.parse(lessonLine)],
      auditEntries: [
        { decision: 'deny', gateId: 'gate:force-push', timestamp: nowIso },
        { decision: 'deny', gateId: 'gate:force-push', timestamp: nowIso },
        { decision: 'warn', gateId: 'gate:env-read', timestamp: nowIso },
      ],
      gateStats: { totalGates: 12, blocked: 2, warned: 1 },
      gateAudit: { days: [{ dayKey: '2026-11-12', deny: 2, warn: 1, allow: 5 }], totals: { deny: 2, warn: 1, allow: 5 } },
      now: nowIso,
    });
    assert.equal(activeOverview.firstBlockRecorded, true);
    assert.equal(activeOverview.totalGateBlocks, 2);
    assert.equal(activeOverview.upNext, null, 'Finish setup bar must be null/gone once first gate block is recorded');
    assert.deepEqual(activeOverview.gateStatusChips, { blockedToday: 2, warnedToday: 1, activeGates: 12 });
    assert.equal(activeOverview.lessonStorage.lessonDbBytes, Buffer.byteLength(lessonLine));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
