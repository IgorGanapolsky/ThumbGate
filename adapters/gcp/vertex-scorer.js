'use strict';

// adapters/gcp/vertex-scorer.js
// -----------------------------------------------------------------------------
// Thin, dependency-free Gemini / Vertex AI client so ThumbGate scoring &
// planning prompts can run on Google models INSIDE the customer's GCP tenant —
// no conversational data leaves to Anthropic/OpenAI. Uses fetch + REST only (no
// SDK), so it adds zero weight to the published npm bundle.
//
// Two transports, auto-selected by env:
//   1. Vertex AI (preferred for enterprise / in-VPC):
//        GOOGLE_VERTEX_PROJECT + GOOGLE_VERTEX_LOCATION + GOOGLE_VERTEX_TOKEN
//   2. Generative Language API (simpler, key-based):
//        GEMINI_API_KEY
//
// Default model: gemini-2.5-flash (override with THUMBGATE_GEMINI_MODEL).
// Enterprise add-on — not part of the published npm bundle.
// -----------------------------------------------------------------------------

const DEFAULT_MODEL = 'gemini-2.5-flash';

// Resolve the transport + endpoint from env. Returns null when unconfigured.
function geminiConfig(env = process.env) {
  const model = env.THUMBGATE_GEMINI_MODEL || DEFAULT_MODEL;
  if (env.GOOGLE_VERTEX_PROJECT && env.GOOGLE_VERTEX_LOCATION && env.GOOGLE_VERTEX_TOKEN) {
    const loc = env.GOOGLE_VERTEX_LOCATION;
    return {
      transport: 'vertex',
      model,
      url: 'https://' + loc + '-aiplatform.googleapis.com/v1/projects/'
        + env.GOOGLE_VERTEX_PROJECT + '/locations/' + loc
        + '/publishers/google/models/' + model + ':generateContent',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.GOOGLE_VERTEX_TOKEN },
    };
  }
  if (env.GEMINI_API_KEY) {
    return {
      transport: 'generativelanguage',
      model,
      url: 'https://generativelanguage.googleapis.com/v1beta/models/' + model
        + ':generateContent?key=' + env.GEMINI_API_KEY,
      headers: { 'content-type': 'application/json' },
    };
  }
  return null;
}

function isConfigured(env = process.env) {
  return geminiConfig(env) !== null;
}

function buildGeminiRequest(prompt, opts = {}) {
  return {
    contents: [{ role: 'user', parts: [{ text: String(prompt) }] }],
    generationConfig: {
      temperature: opts.temperature != null ? opts.temperature : 0,
      maxOutputTokens: opts.maxOutputTokens || 512,
    },
  };
}

function parseGeminiResponse(json) {
  const cand = json && json.candidates && json.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  if (!parts || !parts.length) return '';
  return parts.map((p) => p.text || '').join('').trim();
}

// Run a single scoring/planning prompt on Gemini/Vertex.
// Returns { text, transport, model }. `opts.fetchImpl` / `opts.env` are injectable.
async function scoreWithGemini(prompt, opts = {}) {
  const env = opts.env || process.env;
  const cfg = geminiConfig(env);
  if (!cfg) {
    throw new Error('Gemini/Vertex not configured: set GEMINI_API_KEY or GOOGLE_VERTEX_PROJECT/LOCATION/TOKEN');
  }
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) throw new Error('no fetch implementation available');

  const res = await fetchImpl(cfg.url, {
    method: 'POST',
    headers: cfg.headers,
    body: JSON.stringify(buildGeminiRequest(prompt, opts)),
  });
  if (!res.ok) {
    const detail = typeof res.text === 'function' ? await res.text() : '';
    throw new Error('Gemini request failed: ' + res.status + ' ' + String(detail).slice(0, 200));
  }
  const json = await res.json();
  return { text: parseGeminiResponse(json), transport: cfg.transport, model: cfg.model };
}

module.exports = {
  DEFAULT_MODEL,
  geminiConfig,
  isConfigured,
  buildGeminiRequest,
  parseGeminiResponse,
  scoreWithGemini,
};
