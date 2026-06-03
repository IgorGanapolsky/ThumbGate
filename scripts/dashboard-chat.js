'use strict';

// scripts/dashboard-chat.js
// -----------------------------------------------------------------------------
// "Chat with your data" — the dashboard chat backend. Answers a natural-language
// question about THIS install's ThumbGate data (captured lessons + prevention
// rules) by retrieving the most relevant lessons and asking Gemini to answer
// grounded ONLY in that retrieved context (RAG). No data leaves the box except
// the retrieved snippets + the question, sent to the configured Gemini endpoint.
//
// Enterprise framing: this is the in-product "chat with your governed data"
// experience. (The Dialogflow CX messenger widget is the separate path where a
// customer connects their own DFCX agent + the ThumbGate webhook gate.)
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
  if (Object.prototype.hasOwnProperty.call(opts, 'apiKey')) {
    key = opts.apiKey || '';
  } else {
    key = opts.apiKey || process.env.GEMINI_API_KEY || process.env.THUMBGATE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.PERPLEXITY_API_KEY || process.env.THUMBGATE_PERPLEXITY_API_KEY || '';
  }
  if (!key) return '';
  return key.trim().replace(/^["']|["']$/g, '');
}

// Retrieve the most relevant stored lessons for the question.
function retrieveContext(question, opts = {}) {
  let searchLessons;
  try {
    ({ searchLessons } = require(path.join(__dirname, 'lesson-search')));
  } catch (_) {
    return [];
  }
  let res;
  try {
    res = searchLessons(String(question || ''), {
      limit: MAX_CONTEXT_LESSONS,
      feedbackDir: opts.feedbackDir,
    });
  } catch (_) {
    return [];
  }
  const rows = (res && (res.results || res.lessons)) || [];
  return rows.slice(0, MAX_CONTEXT_LESSONS).map((l) => ({
    id: l.id,
    signal: l.signal || l.feedback || '',
    title: (l.title || '').replace(/^(?:MISTAKE|SUCCESS):\s*/i, '').slice(0, 160),
    content: String(l.content || l.context || '').replace(/\s+/g, ' ').trim().slice(0, 600),
    tags: l.tags || [],
  })).filter((l) => l.content || l.title);
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
  const parts = body
    && body.candidates
    && body.candidates[0]
    && body.candidates[0].content
    && body.candidates[0].content.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
}

// Answer a question grounded in this install's lessons. Returns
// { ok, answer, sources, model } or { ok:false, error, ... }.
async function answerDataQuestion(question, opts = {}) {
  const q = String(question || '').trim();
  if (!q) return { ok: false, error: 'empty_question', message: 'Ask a question about your data.' };
  if (q.length > MAX_QUESTION_CHARS) {
    return { ok: false, error: 'question_too_long', message: `Question exceeds ${MAX_QUESTION_CHARS} characters.` };
  }

  const apiKey = resolveApiKey(opts);
  const lessons = retrieveContext(q, opts);
  const sources = lessons.map((l) => ({ id: l.id, title: l.title, signal: l.signal }));

  if (!apiKey) {
    return {
      ok: false,
      error: 'no_api_key',
      message: 'Chat is not configured. Set a valid GEMINI_API_KEY or PERPLEXITY_API_KEY (for hybrid local-cloud) in the project .env or via dashboard Save. See adapters/perplexity/HYBRID.md.',
      sources,
    };
  }

  const model = resolveModel(opts.model);
  const prompt = buildChatPrompt(q, lessons);
  const fetchImpl = opts.fetch || globalThis.fetch;
  const isPerplexity = apiKey.startsWith('pplx-') || apiKey.includes('perplexity');

  try {
    if (isPerplexity) {
      // Use Perplexity hybrid-capable API (OpenAI compatible) for RAG chat with your data
      const res = await fetchImpl(PERPLEXITY_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'sonar', // or llama-3.1 etc for hybrid
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 1024,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (json && json.error && json.error.message) ? String(json.error.message).split('\n')[0] : `HTTP ${res.status}`;
        return { ok: false, error: 'perplexity_error', status: res.status, message: msg, sources };
      }
      const answer = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
      return { ok: true, answer: answer.trim() || '(no answer returned)', sources, model: json.model || 'perplexity-hybrid' };
    } else {
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
        const msg = (json && json.error && json.error.message) ? String(json.error.message).split('\n')[0] : `HTTP ${res.status}`;
        return { ok: false, error: 'gemini_error', status: res.status, message: msg, sources };
      }
      const answer = parseGeminiAnswer(json);
      return { ok: true, answer: answer || '(no answer returned)', sources, model: json.modelVersion || model };
    }
  } catch (err) {
    return { ok: false, error: 'network', message: err && err.message ? err.message : String(err), sources };
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
