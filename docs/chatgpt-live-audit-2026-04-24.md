# ChatGPT GPT Live Audit - 2026-04-24

Public GPT URL: https://chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate

This audit records the live published GPT state visible from the public ChatGPT page on 2026-04-24. It exists to make the repair path concrete: the GPT Builder configuration is stale even though the production ThumbGate API is online.

## Confirmed Live Drift

- The published GPT still exposes `thumbgate-production.up.railway.app` as the Actions domain.
- The published Action metadata includes `authorization_type: bearer`, so feedback capture depends on GPT Builder's saved Bearer secret.
- The public page includes the `captureFeedback` route (`/v1/feedback/capture`) and `evaluateDecision` route (`/v1/decisions/evaluate`).
- The Action metadata shows empty custom Action instructions (`instructions: ""` in the embedded action block).
- The GPT profile image fields are present but not populated with a usable ThumbGate asset in the public metadata.
- The GPT is showing ChatGPT's built-in `ember` emoji/theme state instead of the canonical ThumbGate icon.

## Production API Check

Production health endpoint:

```text
GET https://thumbgate-production.up.railway.app/healthz
HTTP 200
{"status":"ok","feedbackLogPath":"/data/feedback/feedback-log.jsonl","memoryLogPath":"/data/feedback/memory-log.jsonl"}
```

Unauthenticated feedback capture check:

```text
POST https://thumbgate-production.up.railway.app/v1/feedback/capture
HTTP 401
{"type":"urn:thumbgate:error:unauthorized","title":"Unauthorized","status":401,"detail":"A valid API key is required to access this endpoint."}
```

This means the backend is correctly requiring a Bearer key. The screenshot failure is consistent with the published GPT Action not having a valid owner-managed Bearer secret configured in GPT Builder, not with the production API being down.

## Required GPT Builder Repair

Use the canonical update packet in `docs/gpt-store-submission.md` and `docs/chatgpt-gpt-instructions.md`.

Minimum live repair checklist:

- Re-import `https://thumbgate-production.up.railway.app/openapi.yaml`.
- Configure Actions authentication as API Key -> Bearer with the raw owner-managed `THUMBGATE_API_KEY`.
- Test `captureFeedback` in GPT Builder until it returns `200 OK` with `accepted: true`.
- Upload `public/assets/brand/thumbgate-icon-512.png` as the GPT avatar.
- Confirm the avatar SHA-256 is `6f0290f7fe50de9a82c18be2299deafba4c686df46b3b5309e363a7d589d89dc`.
- Do not use `docs/logo-400x400.png`, `.claude-plugin/bundle/icon.png`, a generic cube, emoji thumbs, or a generated ChatGPT image.

## User-Facing Failure Copy

If the Action cannot save feedback, the GPT must say:

```text
Not saved in ThumbGate yet.
```

It must not say "I saved this", "I'll remember this", "I'll keep doing this", or "I can still apply it going forward" unless `captureFeedback` returned a successful accepted/promoted result.
