# Start Here — ThumbGate Operator Lab

Prepared: 2026-05-27

Guardrail: do not claim traction or ROI. Use `docs/COMMERCIAL_TRUTH.md` + `docs/VERIFICATION_EVIDENCE.md` for proof language.

Welcome. ThumbGate is an **Infrastructure Firewall** for AI coding agents: feedback → memory → prevention rules → pre-action blocks.

## Post 1 repeated workflow failure (template)

Paste 3 bullets in the comments (or as a new post):

1. **Agent**: Claude Code / Codex / Cursor / Gemini CLI / MCP tool / other
2. **Workflow**: one workflow you run for real (PR review, deploy, refactor, incident, ETL, etc.)
3. **Repeat failure**: context drift, rollback risk, unsafe tool calls, brittle prompt guardrails, bad handoffs, etc.

If you include a snippet or stack trace, redact secrets.

## What you’ll get back (practical, not theory)

- A smallest-possible **Reliability Gateway** check to block the failure before the tool call.
- A draft prevention rule (policy) that can be enforced locally (pre-tool) and later shared to a team path.
- A “proof run” outline so you can verify the repeat actually stops repeating.

## Two paths (pick the one that matches intent)

- Self-serve setup: https://thumbgate-production.up.railway.app/guide
- If you want hands-on hardening for one workflow: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- If you already know you want the Pro features (self-serve): https://thumbgate-production.up.railway.app/checkout/pro

Engineering proof artifacts:

- `docs/VERIFICATION_EVIDENCE.md`
