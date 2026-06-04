'use strict';

// scripts/dashboard-chat.js
// -----------------------------------------------------------------------------
// "Chat with your data" — the dashboard chat backend. Local-first RAG over
// this install's ThumbGate data (lessons, raw feedback memories via LanceDB
// vectors, receipts, gate stats). Retrieval is local (lesson search + optional
// vector-store.searchSimilar). Generation uses your configured LLM: a local
// OpenAI-compatible endpoint first, then Gemini or Perplexity when explicitly
// configured.
//
// Dialogflow/Google is not the dashboard chatbot brain. It remains an optional
// guard-adapter path for buyers who already run their own Google agent tenancy.
// -----------------------------------------------------------------------------

const path = require('path');

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const PERPLEXITY_ENDPOINT = 'https://api.perplexity.ai/chat/completions';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_QUESTION_CHARS = 2000;
const MAX_CONTEXT_LESSONS = 8;

// Allowlist the model so a user-supplied `model` cannot route the call to an
// arbitrary / unexpected (or more expensive) endpoint. Anything not on the list
// falls back to the default.
const ALLOWED_MODELS = new Set([
  'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
  'gemini-2.0-flash', 'gemini-2.0-flash-lite',
  'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest',
]);

function resolveModel(requested) {
  const r = String(requested || '').trim();
  if (r && ALLOWED_MODELS.has(r)) return r;
  const envModel = String(process.env.THUMBGATE_GEMINI_MODEL || '').trim();
  if (envModel && ALLOWED_MODELS.has(envModel)) return envModel;
  return DEFAULT_MODEL;
}

function resolveApiKey(opts = {}) {
  let key = '';
  if (Object.hasOwn(opts, 'apiKey')) {
    key = opts.apiKey || '';
  } else {
    key = opts.apiKey || process.env.GEMINI_API_KEY || process.env.THUMBGATE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.PERPLEXITY_API_KEY || process.env.THUMBGATE_PERPLEXITY_API_KEY || '';
  }
  if (!key) return '';
  return key.trim().replace(/^["']|["']$/g, '');
}

function debugChatFallback(label, err) {
  if (process.env.THUMBGATE_DEBUG_CHAT !== '1') return;
  const detail = err?.message ? err.message : String(err);
  console.warn(`[dashboard-chat] ${label}: ${detail}`);
}

function loadLessonSearcher() {
  try {
    return require(path.join(__dirname, 'lesson-search')).searchLessons;
  } catch (err) {
    debugChatFallback('lesson search unavailable', err);
    return null;
  }
}

function lessonToContextItem(lesson) {
  return {
    id: lesson.id,
    signal: lesson.signal || lesson.feedback || '',
    title: (lesson.title || '').replace(/^(?:MISTAKE|SUCCESS):\s*/i, '').slice(0, 160),
    content: String(lesson.content || lesson.context || '').replace(/\s+/g, ' ').trim().slice(0, 600),
    tags: lesson.tags || [],
    source: 'lessons',
  };
}

function vectorMatchToContextItem(match, index) {
  return {
    id: match.id || `vec-${index}`,
    signal: match.signal || '',
    title: String(match.context || match.text || '').slice(0, 100),
    content: match.text || match.context || '',
    tags: match.tags ? String(match.tags).split(',').filter(Boolean) : [],
    source: 'lancedb-vector',
  };
}

function dedupeContextItems(items, limit = MAX_CONTEXT_LESSONS + 3) {
  const seen = new Set();
  return items.filter((item) => {
    if (!(item.content || item.title)) return false;
    const key = item.id || item.content.slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function retrieveLessonContext(question, opts = {}) {
  const searchLessons = loadLessonSearcher();
  if (!searchLessons) return [];
  try {
    const res = searchLessons(String(question || ''), {
      limit: MAX_CONTEXT_LESSONS,
      feedbackDir: opts.feedbackDir,
    });
    const rows = res?.results || res?.lessons || [];
    return rows.slice(0, MAX_CONTEXT_LESSONS).map(lessonToContextItem);
  } catch (err) {
    debugChatFallback('lesson retrieval failed', err);
    return [];
  }
}

async function retrieveVectorContext(question, opts = {}) {
  if (opts.useVectorSearch === false) return [];
  try {
    const vectorStore = require(path.join(__dirname, 'vector-store'));
    const vecResults = vectorStore.searchSimilar
      ? await vectorStore.searchSimilar(String(question || ''), opts.vectorLimit || 4)
      : [];
    return vecResults
      .filter((match) => match?.text)
      .map(vectorMatchToContextItem);
  } catch (err) {
    debugChatFallback('vector retrieval failed', err);
    return [];
  }
}

// Retrieve relevant stored lessons and optional raw feedback vector matches.
async function retrieveContext(question, opts = {}) {
  const lessons = retrieveLessonContext(question, opts);
  const vectors = await retrieveVectorContext(question, opts);
  return dedupeContextItems([...lessons, ...vectors]);
}

// Build a grounded RAG prompt. Pure function (testable).
function buildChatPrompt(question, lessons) {
  const q = String(question || '').slice(0, MAX_QUESTION_CHARS).trim();
  const context = (lessons || []).map((l, i) => {
    const mark = /pos|up/i.test(l.signal) ? 'WORKED' : (/neg|down/i.test(l.signal) ? 'MISTAKE' : 'NOTE');
    const tags = (l.tags || []).length ? ` [tags: ${l.tags.join(', ')}]` : '';
    return `(${i + 1}) [${mark}] ${l.title || ''}${tags}\n    ${l.content}`;
  }).join('\n');

  const system = [
    'You are ThumbGate\'s "chat with your data" assistant. Answer the user\'s question',
    'using ONLY the captured lessons below (this team\'s real feedback history).',
    'Be concise and specific. Cite the lesson numbers you used like [1], [3].',
    'If the lessons do not contain the answer, say so plainly — do not invent facts.',
  ].join(' ');

  return `${system}\n\n=== Captured lessons (your data) ===\n${context || '(no relevant lessons found)'}\n\n=== Question ===\n${q}`;
}

// Parse the Gemini generateContent response into plain text. Pure (testable).
function parseGeminiAnswer(body) {
  const parts = body?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
}

function buildOpenAiChatPayload(prompt, model) {
  return JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 1024,
  });
}

function parseOpenAiChatAnswer(json) {
  return json?.choices?.[0]?.message?.content || '';
}

function parseModelError(json, status) {
  return json?.error?.message ? String(json.error.message).split('\n')[0] : `HTTP ${status}`;
}

async function callLocalOpenAiEndpoint({ endpoint, apiKey, model, prompt, fetchImpl, sources }) {
  const url = endpoint.includes('/chat/completions')
    ? endpoint
    : endpoint.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Authorization': `Bearer ${apiKey || 'local'}`
    },
    body: buildOpenAiChatPayload(prompt, model),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: 'local_llm_error', status: res.status, message: parseModelError(json, res.status), sources };
  }
  const answer = parseOpenAiChatAnswer(json);
  return { ok: true, answer: answer.trim() || '(no answer returned)', sources, model: json.model || model };
}

async function callPerplexityEndpoint({ apiKey, prompt, fetchImpl, sources }) {
  const res = await fetchImpl(PERPLEXITY_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: buildOpenAiChatPayload(prompt, 'sonar'),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: 'perplexity_error', status: res.status, message: parseModelError(json, res.status), sources };
  }
  const answer = parseOpenAiChatAnswer(json);
  return { ok: true, answer: answer.trim() || '(no answer returned)', sources, model: json.model || 'perplexity-hybrid' };
}

async function callGeminiEndpoint({ apiKey, model, prompt, fetchImpl, sources }) {
  const res = await fetchImpl(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: 'gemini_error', status: res.status, message: parseModelError(json, res.status), sources };
  }
  const answer = parseGeminiAnswer(json);
  return { ok: true, answer: answer || '(no answer returned)', sources, model: json.modelVersion || model };
}

// Answer a question grounded in this install's lessons. Returns
// { ok, answer, sources, model } or { ok:false, error, ... }.
async function answerDataQuestion(question, opts = {}) {
  const q = String(question || '').trim();
  if (!q) return { ok: false, error: 'empty_question', message: 'Ask a question about your data.' };
  if (q.length > MAX_QUESTION_CHARS) {
    return { ok: false, error: 'question_too_long', message: `Question exceeds ${MAX_QUESTION_CHARS} characters.` };
  }

  const localEndpoint = opts.localEndpoint || process.env.THUMBGATE_LOCAL_LLM_ENDPOINT || '';
  const localModel = opts.localModel || process.env.THUMBGATE_LOCAL_LLM_MODEL || 'llama3';
  const apiKey = resolveApiKey(opts);
  const lessons = await retrieveContext(q, opts);
  const sources = lessons.map((l) => ({ id: l.id, title: l.title, signal: l.signal }));

  if (!apiKey && !localEndpoint) {
    return {
      ok: false,
      error: 'no_api_key',
      message: 'Chat is not configured. Set a valid GEMINI_API_KEY, PERPLEXITY_API_KEY, or THUMBGATE_LOCAL_LLM_ENDPOINT in the project .env.',
      sources,
    };
  }

  const model = resolveModel(opts.model);
  const prompt = buildChatPrompt(q, lessons);
  const fetchImpl = opts.fetch || globalThis.fetch;
  const isPerplexity = apiKey && (apiKey.startsWith('pplx-') || apiKey.includes('perplexity'));

  try {
    if (localEndpoint) return await callLocalOpenAiEndpoint({ endpoint: localEndpoint, apiKey, model: localModel, prompt, fetchImpl, sources });
    if (isPerplexity) return await callPerplexityEndpoint({ apiKey, prompt, fetchImpl, sources });
    return await callGeminiEndpoint({ apiKey, model, prompt, fetchImpl, sources });
  } catch (err) {
    return { ok: false, error: 'network', message: err?.message || String(err), sources };
  }
}

module.exports = {
  answerDataQuestion,
  buildChatPrompt,
  parseGeminiAnswer,
  retrieveContext,
  DEFAULT_MODEL,
  MAX_QUESTION_CHARS,
};
