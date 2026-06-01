# Live Vertex / Gemini proof

This records a **real** Generative Language (Gemini) API round-trip made by the
shipped `vertex-scorer.js` module — not a mock. Reproduce it yourself with a
Gemini API key in `GEMINI_API_KEY` (see below). No key is stored in this repo.

## 1. Raw API call (proves the key + endpoint are real)

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
header: x-goog-api-key: <GEMINI_API_KEY>
body:   {"contents":[{"role":"user","parts":[{"text":"Reply with exactly this token and nothing else: THUMBGATE_VERTEX_LIVE_OK"}]}],"generationConfig":{"temperature":0}}
```

Actual response (captured 2026-06-01):

```
model reply : THUMBGATE_VERTEX_LIVE_OK
modelVersion: gemini-2.5-flash
responseId  : L7kdaoH7OLjXz7IP2LTe2Q8
token usage : {"promptTokenCount":20,"candidatesTokenCount":10,"totalTokenCount":54,"serviceTier":"standard"}
```

## 2. Shipped module call (proves `vertex-scorer.js` itself works live)

```js
const vs = require('./adapters/gcp/vertex-scorer');
vs.isConfigured();                       // => true (GEMINI_API_KEY present)
await vs.scoreWithGemini(
  'A Dialogflow CX agent wants to run tool dfcx:process-refund with ' +
  '{account_id:"A-200", amount:5000}. Rate the risk of executing this ' +
  'side-effect from 0 (safe) to 1 (dangerous). Answer with just a number.'
);
// => { text: "1", transport: "generativelanguage", model: "gemini-2.5-flash" }
```

The model scored a $5,000 refund side-effect as risk **1** (dangerous) over the
real `generativelanguage` transport.

## Reproduce

```bash
export GEMINI_API_KEY=...                # from https://aistudio.google.com/app/apikey
node -e 'require("./adapters/gcp/vertex-scorer").scoreWithGemini("...prompt...").then(console.log)'
```

## Honest scope / limits

- `gemini-2.0-flash` returns `429 RESOURCE_EXHAUSTED` (free-tier limit 0) on the
  test project; `gemini-2.5-flash` (the module default) has working quota.
- Vertex AI (`aiplatform.googleapis.com`) on the OAuth/gcloud project was **not**
  used — that API and Service Usage are disabled on the test project, and
  enabling them requires billing setup. This proof uses the Generative Language
  (AI Studio key) transport, which is what `vertex-scorer.js` defaults to.
- This is the optional scoring layer. The core DFCX gate (repeat-block + input
  validation) runs with **zero** external calls — see `dogfood-dfcx.js`.
