---
"thumbgate": patch
---

Add `thumbgate setup-vertex` CLI command for enterprise Vertex/Dialogflow CX onboarding.

`npx thumbgate setup-vertex [--key=K] [--write] [--model=M] [--json]` verifies a Gemini API key against the **live** Generative Language API — an auth check (model list) plus a real `generateContent` round-trip — and reports the model, `responseId`, and token usage so customers get genuine proof (not a stub) that scoring works. With `--write` it stores the key in `./.env` (chmod 600) and ensures `.env` is gitignored. On success it prints the Cloud Run deploy steps for the DFCX webhook gate. No new files or dependencies — implemented inline in `bin/cli.js` using the built-in `fetch`.
