# Verification Evidence (March 4, 2026)

## Phase 6: Feedback Attribution

- Proof report: `proof/attribution-report.md`
- Machine evidence: `proof/attribution-report.json`
- Requirements: ATTR-01 (recordAction + attributeFeedback), ATTR-02 (pre-tool guard), ATTR-03 (test coverage)

## Phase 5 RLAIF and DPO Optimization proof

Command:

```bash
node scripts/prove-rlaif.js
```

Observed result:

- Summary: `4 passed`, `0 failed`
- Evidence artifacts:
  - `proof/rlaif-report.json`
  - `proof/rlaif-report.md`
- Requirements verified:
  - DPO-01: selfAudit() returns score float in [0,1] with 6 constraints; selfAuditAndLog() writes self-score-log.jsonl
  - DPO-02: dpoOptimizer.run() writes dpo-model.json with generated + pairs_processed fields
  - DPO-03: extractMetaPolicyRules() extracts rules from seeded negative entries; meta-policy-rules.json written
  - DPO-04: node --test all 3 RLAIF test files: 24 passing tests, 0 failures; delta from Phase 4 baseline (93): +24 RLAIF tests = 117 total



## Automated test suite

Command:

```bash
npm test
```

Result summary:

- `test:schema`: 7 passed, 0 failed
- `test:loop`: 10 passed, 0 failed
- `test:dpo`: 6 passed, 0 failed
- `test:api`: 52 passed, 0 failed
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

- Summary: `12 passed`, `0 failed`
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
  - semantic-cache hit behavior for similar context queries
  - self-healing helper execution health checks

## Self-healing automation verification

Commands:

```bash
npm run self-heal:check
node scripts/self-healing-check.js --json > proof/automation/self-healing-health.json
node scripts/self-heal.js --reason=manual > proof/automation/self-heal-run.json
```

Observed result:

- Health status: `healthy` (4/4 checks healthy: budget, tests, adapter proof, automation proof)
- Self-heal execution: `healthy: true`, no failing fix steps
- Evidence artifacts:
  - `proof/automation/self-healing-health.json`
  - `proof/automation/self-heal-run.json`

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

## Autonomous GitOps verification

GitHub API checks:

- `allow_auto_merge: true`
- `delete_branch_on_merge: true`
- `main` branch protection retains:
  - required approvals: `1`
  - required check contexts: `["test"]`
  - required linear history: `true`
  - required conversation resolution: `true`

Workflow syntax validation command:

```bash
for f in .github/workflows/*.yml; do ruby -e 'require "yaml"; YAML.load_file(ARGV[0]); puts "OK #{ARGV[0]}"' "$f"; done
```

Observed result:

- All workflow files parsed successfully (`OK` for each).

## Budget status

Command:

```bash
npm run budget:status
```

Observed result:

- Month: `2026-03`
- Tracked spend: `0`
- Budget: `10`
- Remaining: `10`

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

## 2026-03-06 MCP startup hardening verification

Scope:

- Added MCP stdio transport compatibility for both `Content-Length` framed JSON-RPC and newline-delimited JSON requests.
- Fixed CLI `serve` bootstrap to explicitly start the stdio listener when loaded via `require()`.
- Removed duplicate/dead `serve` switch branch collision with `start-api`.
- Hardened proof/test reliability for external Subway repo discovery and proof test determinism.

Commands run:

```bash
node --test tests/cli.test.js tests/prove-adapters.test.js
npm run test:proof
npm test
npm run prove:adapters
npm run prove:automation
```

Observed results:

- `tests/cli.test.js`: pass (includes framed + newline `initialize` handshake coverage)
- `tests/prove-adapters.test.js`: pass with adapter proof checks increased to `>=21`
- `npm run test:proof`: pass (`75` pass, `0` fail)
- `npm test`: pass (all scripted test phases complete)
- `npm run prove:adapters`: `{ "passed": 21, "failed": 0 }`
- `npm run prove:automation`: `{ "passed": 14, "failed": 0 }`

Artifacts updated:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`

Cross-project Codex startup proof:

```bash
cd /Users/ganapolsky_i/workspace/git/igor/trading
codex exec "Print OK only" --skip-git-repo-check
```

Observed result:

- MCP startup reports `ready: rlhf, sentry, github, context7, playwright`
- No `rlhf` timeout and no MCP handshake error
- Command completed with output `OK`
