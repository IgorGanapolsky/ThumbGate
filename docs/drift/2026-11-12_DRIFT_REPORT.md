# Drift report 2026-11-12

Scope: `docs/COMMERCIAL_TRUTH.md`, `docs/specs/`, `docs/guides/`, `README.md`, plus live `curl` of `https://thumbgate.ai/`, `/pricing`, `/pro`, and `/operator-framework`. No Stripe links opened. Pricing pages were not edited; rows were sent to `w1:pN`.

## docs/COMMERCIAL_TRUTH.md

- The doc says the only promoted public offer is the `$499` Managed AI Agent Workflow Gate, and that Pro `$19/mo` or `$149/yr` is not promoted on `/` or `/pricing`. Live `/` and `/pricing` show Pro `$19/mo` (`$149/yr`) beside a `$499` Setup Sprint. The live name is not Managed AI Agent Workflow Gate.
- Live `/operator-framework` shows `$2,500` Turnkey Setup, `$500/mo` Managed Retainer, and `iganapolsky@gmail.com`. None of those are the promoted public offer in this doc.
- Live `/pro` shows `$19/mo`, `$149/yr`, a `$15,000` 30-day pilot, and `$10,000/month` after a completed pilot. The doc treats the last two as proposal-only, with no public checkout.

## README.md

No drift detected on force-push. The README says `git push --force` warns by default and denies under `THUMBGATE_STRICT_ENFORCEMENT=1`. Live `/` shows `git push --force origin main → WARN (deny only in strict mode)` and labels the DENY card `strict mode`. `scripts/gates-engine.js` converts non-floor denies to warnings unless strict mode is on. `force-push` is exempt from the free-tier daily-cap downgrade, not from warn-by-default.

- Companion paths `docs/TENCENT-CLOUD-SA9-HUNYUAN-CASE-STUDY.md` and `scripts/tencent_sa9_hunyuan_benchmark.py` are not in this repo. Not rewritten: the sentence points at a companion repository that was not checked out here.

## docs/specs/mckinsey-top-companies-ai-coding-steal.md

- The EXISTS row said `scripts/mac-dispatch-loop.js` polls `ready-for-agent` issues. The loop polls `<!-- agent:ready -->` (`scripts/mac-dispatch-loop.js`). Doc updated.

## docs/guides/huggingface-context-course-governance.md

- Checklist named `npm run prove:hf-context`. The script is `prove:hf-context-course-harness`. Doc updated.
- Unit 5 named `hook-auto-capture.js`. That file is not in the tree. The hook is the `hook-auto-capture` CLI subcommand plus `scripts/hook-auto-capture.sh`. Doc updated.

## docs/guides/vlt-registry-governance.md

- Proof section said `npm run prove:vlt` validates gate templates and adapter pins. That script runs `scripts/prove-vlt-dogfood.js`. The harness is `npm run prove:vlt-governance-harness`. Doc updated.
- Codex example pinned `thumbgate@1.34.3`. `package.json` is `1.39.1`. Doc updated.

## docs/guides/adobe-creative-mcp-gate.md

- `creative-export-publish-approval` is documented to fail closed when `THUMBGATE_AUTONOMOUS=1`. `applyBrandStandardsPretool` returns `decision: 'approve'` and does not read that env (`scripts/brand-standards-gate.js`). Code-side issue. Not changed in this PR.

## docs/specs/TEMPLATE.md

No drift detected

## docs/specs/provider-execution-attestation-v1.md

No drift detected

## docs/guides/mac-dispatch-loop.md

No drift detected

## docs/guides/opencode-integration.md

No drift detected

## docs/guides/developer-machine-supply-chain-guardrails.md

No drift detected

## docs/guides/dispatch-ops.md

No drift detected

## docs/guides/mcp-use-integration.md

No drift detected

## docs/guides/workos-authkit-governance.md

No drift detected

## docs/guides/code-knowledge-graph-guardrails.md

No drift detected

## docs/guides/continuity-tools-integration.md

No drift detected

## scripts/rrsi-doctor.js

- `evaluateElephantGoldfishAutonomousSanctuaryLoop` defaulted `goldfishHasZeroConversationHistory` to true, so the amnesia check passed by self-assertion. The fail-closed fix is in https://github.com/IgorGanapolsky/ThumbGate/pull/5028, not this PR.
