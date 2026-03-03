# Verification Evidence (March 3, 2026)

## Automated test suite

Command:

```bash
npm test
```

Result summary:

- `test:schema`: 7 passed, 0 failed
- `test:loop`: 10 passed, 0 failed
- `test:dpo`: 6 passed, 0 failed
- `test:api`: 45 passed, 0 failed
- `test:proof`: 2 passed, 0 failed

## Adapter compatibility proof harness

Command:

```bash
npm run prove:adapters
```

Observed result:

- Summary: `19 passed`, `0 failed`
- Evidence artifacts:
  - `proof/compatibility/report.json`
  - `proof/compatibility/report.md`
- Verified checks include:
  - API auth and feedback/context/intents routes
  - Rubric-based gating for positive feedback (`422` when guardrails/disagreement fail)
  - Rubric-aware context evaluation payloads
  - API auth config hardening (`RLHF_API_KEY` required unless insecure mode enabled)
  - Context namespace traversal rejection on API + MCP surfaces
  - Intent router checkpoint flow (`checkpoint_required` for unapproved high-risk intents)
  - MCP initialize/list/call flow (including `plan_intent` and rubric-gated `capture_feedback`)
  - MCP locked-profile write denial
  - OpenAPI parity for ChatGPT adapter
  - Gemini declaration validity
  - Subagent profile and MCP policy consistency

## Automation proof harness

Command:

```bash
npm run prove:automation
```

Observed result:

- Summary: `10 passed`, `0 failed`
- Evidence artifacts:
  - `proof/automation/report.json`
  - `proof/automation/report.md`
- Verified checks include:
  - rubric-pass positive promotion
  - rubric-gated positive rejection for guardrail/disagreement violations
  - rubric failure dimensions in prevention rules
  - rubric metadata in DPO output
  - API + MCP rubric gate behavior
  - intent checkpoint enforcement
  - rubric-aware context evaluation

## API smoke verification

Command sequence:

- Start API with `RLHF_API_KEY=test-key` on port `8791`
- `GET /healthz` with bearer token
- `GET /v1/feedback/stats` without token (expect 401)
- `POST /v1/feedback/capture` with valid payload
- `GET /v1/feedback/summary`

Observed results:

- Health endpoint responded with status `ok`
- Unauthorized stats call returned `401`
- Capture endpoint returned `accepted: true` and produced memory record
- Summary endpoint returned markdown summary payload

## Security regression checks

- Unauthorized API request returns `401` (default auth required).
- API initialization fails fast if `RLHF_API_KEY` is missing and insecure mode is not explicitly enabled.
- API rejects external output paths outside feedback root.
- MCP `prevention_rules` blocks external `outputPath`.
- MCP `export_dpo_pairs` blocks external `memoryLogPath`.
- MCP allowlists enforce profile-scoped tool access (`default`, `readonly`, `locked`).
- Rubric anti-hacking gate blocks unsafe positive memory promotion when guardrails fail or judges disagree.

## Budget status

Command:

```bash
npm run budget:status
```

Observed result:

- Month: `2026-03`
- Tracked spend: `0.3`
- Budget: `10`
- Remaining: `9.7`

## PaperBanana verification

Command:

```bash
npm run diagrams:paperbanana
```

Observed blocker:

- PaperBanana call reached Gemini endpoint and failed with `400 INVALID_ARGUMENT` (`API_KEY_INVALID`).
- This proves integration path is wired, but the provided key is not currently valid for generation.

Current status:

- Diagram pipeline is implemented and budget-guarded.
- Final diagram artifacts require a valid Gemini/Google API key.
- Failed generation attempts do not increase budget ledger spend.
