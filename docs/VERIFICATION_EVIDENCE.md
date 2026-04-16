# ThumbGate — Verification Evidence

> Every feature ships with proof. This document is the complete audit trail of verification runs, test output, and deployment evidence.

## What's verified

| Category | Evidence |
|----------|---------|
| **Pre-action gates** | Block known mistakes before tool use — tested with real feedback patterns |
| **Feedback capture** | Up/down signals with context, tags, rubric scores — schema-validated |
| **Prevention rules** | Auto-promoted from repeated failures — regression-tested |
| **Filesystem search** | ContextFS files searchable without embeddings — regression-tested |
| **Social analytics** | Multi-platform polling pipeline — regression-tested |
| **ThumbGate search** | Two-tier search (MCP tool + REST API) — regression-tested |
| **MCP/API parity** | Every MCP tool has a matching REST endpoint — proven by OpenAPI parity tests |
| **CI pipeline** | All PRs require green CI (tests + CodeQL + GitGuardian + Socket Security) |
| **Railway deployment** | Auto-deploy on merge, SHA-verified, health-checked |

## Verify it yourself

```bash
git clone https://github.com/IgorGanapolsky/thumbgate.git
cd thumbgate && npm ci
npm test                    # full repository suite
npm run prove:adapters      # Adapter compatibility proof
npm run prove:automation    # Automation proof harness
npm run test:coverage       # Coverage report
```

## Search through lessons learned

```bash
# Free tier — any LLM invokes search_thumbgate via MCP
# Tool: search_thumbgate { query: "database mock", source: "all" }

# Paid tier — authenticated REST API
curl -H "Authorization: Bearer YOUR_KEY" \
  "https://thumbgate-production.up.railway.app/v1/search?q=test+failure"
```

---

# Verification log

## April 9, 2026: technical debt audit follow-through for stale-claim cleanup, docs hygiene regression coverage, and protected-system revalidation

Scope:

- Audited active operator-facing docs, launch copy, and the landing page for brittle hardcoded verification counts and stale product-surface metrics.
- Replaced those claims with evergreen proof-backed wording.
- Added `tests/docs-claim-hygiene.test.js` to block future reintroduction of exact-count drift in selected active docs.
- Updated `tests/public-landing.test.js` and `package.json` so the new hygiene check is enforced in `test:workflow`.
- Revalidated protected systems: ContextFS/RAG, orchestration, coverage, proof harnesses, and self-heal health.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/worktrees/thumbgate-decision-learning-loop-20260409`:

```bash
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
git diff --check
```

Observed result:

- `npm test` exited `0`.
- `npm run test:coverage` exited `0` with all-files coverage at:
  - `90.23` lines
  - `76.74` branches
  - `93.45` functions
- `npm run prove:adapters` exited `0`: `48` passed, `0` failed.
- `npm run prove:automation` exited `0`: `55` passed, `0` failed.
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `6/6 healthy` checks.
- `git diff --check` exited `0`.
- Repository inventory delta for this pass, excluding `.git` and `node_modules`:
  - files before: `874`
  - files after: `875`
  - lines before: `224174`
  - lines after: `224216`
- The one new file added in this pass is `tests/docs-claim-hygiene.test.js`.
- No tracked RAG/runtime artifacts were added or modified; `.thumbgate/*` and `.claude/*` outputs remained local-only.
- The latest branch-level GitHub Actions failure observed before PR creation was policy-only: `release_sensitive_changes_require_pr`. That blocker indicates the release-sensitive integrity rule requires an open PR; it does not indicate a failing local verification suite.

Requirements verified:

- Active docs and landing surfaces no longer rely on brittle hardcoded verification counts.
- A regression test now protects those claim surfaces from drifting again.
- Protected systems remained operational after the cleanup pass.
- Repo-wide coverage remains below `100%`, so the requested 100% coverage target is still unmet and must not be claimed.

## April 6, 2026: technical debt audit hardening for Node 20 coverage, deterministic Pro-gate tests, and CI gate completeness

Scope:

- Hardened `scripts/test-coverage.js` to feature-detect `--test-coverage-include` / `--test-coverage-exclude` before using them.
- Added regression coverage in `tests/test-coverage.test.js` for runtimes with and without those Node coverage flags.
- Refactored `scripts/pro-features.js` so Pro-gated tests can inject license predicates and output sinks instead of depending on operator-local saved license state.
- Hardened `scripts/multi-hop-recall.js`, `scripts/synthetic-dpo.js`, `tests/license.test.js`, `tests/multi-hop-recall.test.js`, and `tests/synthetic-dpo.test.js` so the unlicensed path stays deterministic in CI.
- Added `npm run budget:status` and `npm run test:coverage` to `.github/workflows/ci.yml`, with `tests/deployment.test.js` enforcing that workflow contract.
- Removed the tracked runtime artifact `.claude/context-engine/quality-log.json` and kept it ignored via `.gitignore`.
- Updated `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `docs/TECHNICAL_DEBT_AUDIT.md` with the new prevention rules and audit evidence.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/audit-worktrees/thumbgate-audit-20260406c`:

```bash
npm run feedback:stats --silent
npm test
npm run test:coverage
tmp=$(mktemp -d) && THUMBGATE_PROOF_DIR="$tmp/proof" npm run prove:adapters
tmp=$(mktemp -d) && THUMBGATE_AUTOMATION_PROOF_DIR="$tmp/proof-automation" npm run prove:automation
npm run self-heal:check
git diff --check
```

Observed result:

- `npm run feedback:stats --silent` exited `0` with `total=51`, `positive=3`, `negative=48`, `trend=stable`.
- `npm test` exited `0`.
- `npm run test:coverage` exited `0` with all-files coverage at:
  - `90.26` lines
  - `76.57` branches
  - `93.73` functions
- `THUMBGATE_PROOF_DIR=... npm run prove:adapters` exited `0`: `48` passed, `0` failed.
- `THUMBGATE_AUTOMATION_PROOF_DIR=... npm run prove:automation` exited `0`: `55` passed, `0` failed.
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `6/6 healthy` checks.
- `git diff --check` remained clean after reverting generated drift from `primer.md` and `config/skill-packs/react-testing.json`.
- The pre-fix failure was reproduced before the hardening work: on Node 20, `npm run test:coverage` exited with `/opt/homebrew/Cellar/node@20/20.20.1/bin/node: bad option: --test-coverage-include`.
- No tracked ThumbGate memory artifacts were added or modified by this audit; the only tracked file removed was the generated runtime log `.claude/context-engine/quality-log.json`.
- Revalidated after rebasing the audit commit onto `origin/main` at `05641e599aa60ae69326567c369c7edfc38f39b5`; the rebased branch remained locally green with the same proof counts and a healthy `self-heal:check`.

## March 21, 2026: ShieldCortex-backed memory ingress hardening and runtime source label cleanup

Scope:

- Added `scripts/memory-firewall.js` as the single ingress decision point for feedback/memory writes, with provider selection for `auto`, `shieldcortex`, `local`, and `off`.
- Added `scripts/shieldcortex-memory-firewall-runner.mjs` so the gateway can use the optional `shieldcortex` package without making it a hard runtime dependency.
- Hardened `scripts/feedback-loop.js` to block secret-bearing feedback before any raw write to `feedback-log.jsonl` or `memory-log.jsonl`, while recording only redacted diagnostics.
- Replaced the stale runtime source label `shieldcortex` in `scripts/context-engine.js` with the truthful live storage labels `jsonl-memory` and `lancedb-vectors`.
- Added regression coverage in `tests/feedback-loop.test.js` and `tests/intelligence.test.js`.
- Documented the optional ingress firewall controls in `README.md` and `.env.example`.
- Added `shieldcortex` as an optional dependency, not a required runtime dependency.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/thumbgate/.worktrees/fix-thumbgate-source-labels`:

```bash
npm ci
node --check scripts/memory-firewall.js
node --check scripts/feedback-loop.js
node - <<'PY'
const { evaluateMemoryIngress } = require('./scripts/memory-firewall');
(async () => {
  const decision = await evaluateMemoryIngress({
    feedbackEvent: {
      signal: 'down',
      context: 'Accidentally pasted anthropic API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890 into feedback.'
    },
    memoryRecord: {
      title: 'Dangerous memory',
      text: 'anthropic api key sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890 leaked'
    },
    options: { provider: 'shieldcortex', mode: 'strict' }
  });
  console.log(JSON.stringify({
    allowed: decision.allowed,
    provider: decision.provider,
    mode: decision.mode,
    degraded: decision.degraded,
    reason: decision.reason,
    threatIndicators: decision.threatIndicators,
    blockedPatterns: decision.blockedPatterns
  }, null, 2));
})();
PY
node --test tests/feedback-loop.test.js tests/intelligence.test.js
npm test >/tmp/mcp_npm_test_fix_thumbgate_source_labels.log 2>&1
npm run test:coverage >/tmp/mcp_test_coverage_fix_thumbgate_source_labels.log 2>&1
THUMBGATE_PROOF_DIR=/tmp/mcp_proof_adapters_fix_thumbgate npm run prove:adapters >/tmp/mcp_prove_adapters_fix_thumbgate.log 2>&1
THUMBGATE_AUTOMATION_PROOF_DIR=/tmp/mcp_proof_automation_fix_thumbgate npm run prove:automation >/tmp/mcp_prove_automation_fix_thumbgate.log 2>&1
npm run self-heal:check >/tmp/mcp_self_heal_check_fix_thumbgate.log 2>&1
git diff --check
```

Observed result:

- `npm ci` exited `0`: `added 296 packages` and `found 0 vulnerabilities`.
- `node --check scripts/memory-firewall.js` exited `0`.
- `node --check scripts/feedback-loop.js` exited `0`.
- The direct ShieldCortex ingress probe exited `0` and returned:
  - `allowed: false`
  - `provider: "shieldcortex"`
  - `mode: "strict"`
  - `reason: "Blocked: credential leak detected (anthropic api_key)"`
  - `threatIndicators: ["credential_leak"]`
- `node --test tests/feedback-loop.test.js tests/intelligence.test.js` exited `0`: `74` passed, `0` failed.
- `npm test` exited `0` on the patched worktree (`/tmp/mcp_npm_test_fix_thumbgate_source_labels.log`).
- The full-suite rerun included the new ThumbGate/security checks:
  - `evaluateMemoryIngress: ShieldCortex blocks secret-bearing payload when explicitly enabled`
  - `captureFeedback: blocks secret-bearing feedback before any raw memory write`
- `npm run test:coverage` exited `0` with all-files coverage at:
  - `89.71` lines
  - `75.40` branches
  - `93.21` functions
- `THUMBGATE_PROOF_DIR=/tmp/mcp_proof_adapters_fix_thumbgate npm run prove:adapters` exited `0`: `48` passed, `0` failed.
- `THUMBGATE_AUTOMATION_PROOF_DIR=/tmp/mcp_proof_automation_fix_thumbgate npm run prove:automation` exited `0`: `55` passed, `0` failed.
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `4/4 healthy` checks.
- `git diff --check` exited `0`.

Evidence caveat:

- The `prove:adapters` and `prove:automation` commands in this repo are test harnesses (`node --test ...`), not a fresh tracked-artifact publisher.
- The current run proved those contracts through the green harness output and exit codes above.
- The checked-in `proof/compatibility/report.json` and `proof/automation/report.json` files still carry older `generatedAt` timestamps, so they must not be claimed as freshly regenerated evidence for this specific run.

Requirements verified:

- Secret-bearing or hostile feedback can now be blocked before any raw memory promotion write.
- When ShieldCortex is installed, the ingress firewall can use it directly; when it is absent, the gateway falls back to the local secret scanner without breaking runtime operation.
- The runtime memory manifest no longer falsely claims `shieldcortex` as a live memory source.
- The change did not break the ThumbGate feedback loop, adapter contracts, automation contracts, or self-healing checks.

## March 21, 2026: Social publish hardening + self-heal reliability fix + archive-WIP retirement decision

Scope:

- Hardened `scripts/self-healing-check.js` so the standard health gate survives large command output and gives `prove:automation` its own isolated proof directory.
- Hardened `scripts/social-pipeline.js` so copied-profile Chrome automation now retries temp-profile cleanup, waits longer for DevTools startup, reports TikTok preflight timeouts as an authenticated-upload-surface failure, and dismisses Instagram's discard-confirmation modal while advancing to the draft editor.
- Confirmed the archived local WIP commit `2063a6e57a37663603245298716c24dd32de0982` remains intentionally unshipped because it deletes `scripts/behavioral-extraction.js`, adds a scratch verifier, and diverges from the hardened social-pipeline lane.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/worktrees/thumbgate-social-archive-recovered`:

```bash
npm ci
node --check scripts/self-healing-check.js
node --test tests/self-healing-check.test.js
node --check scripts/social-pipeline.js
node --test tests/social-pipeline.test.js tests/social-marketing-assets.test.js
for db in "$HOME/Library/Application Support/Google/Chrome"/*/Cookies; do profile=$(basename "$(dirname "$db")"); ig=$(sqlite3 "$db" "select count(*) from cookies where host_key like '%instagram%';" 2>/dev/null || echo err); tt=$(sqlite3 "$db" "select count(*) from cookies where host_key like '%tiktok%';" 2>/dev/null || echo err); echo "$profile instagram=$ig tiktok=$tt"; done
npm run social:publish -- \
  --bundle .artifacts/social/live-combined-preflight-proof-20260321c/bundle.json \
  --platforms instagram,tiktok \
  --no-share \
  --cleanup-drafts \
  --backend playwright \
  --profile-dir Default \
  --headless
npm run social:publish -- \
  --bundle .artifacts/social/live-combined-preflight-proof-20260321c/bundle.json \
  --platforms instagram \
  --no-share \
  --cleanup-drafts \
  --backend playwright \
  --profile-dir Default
npm test
npm run test:coverage
tmp=$(mktemp -d) && THUMBGATE_PROOF_DIR="$tmp/proof" npm run prove:adapters
tmp=$(mktemp -d) && THUMBGATE_AUTOMATION_PROOF_DIR="$tmp/proof-automation" npm run prove:automation
npm run self-heal:check
git diff --check
git cherry -v main codex/archive-primary-dirty-20260320
git show --stat --summary --format=medium 2063a6e57a37663603245298716c24dd32de0982
```

Observed result:

- `npm ci` exited `0`.
- `node --check scripts/self-healing-check.js` exited `0`.
- `node --test tests/self-healing-check.test.js` exited `0`: `15` passed, `0` failed.
- `node --check scripts/social-pipeline.js` exited `0`.
- `node --test tests/social-pipeline.test.js tests/social-marketing-assets.test.js` exited `0`: `19` passed, `0` failed.
- `npm test` exited `0`.
- The first `npm run test:coverage` run exposed a full-suite CLI handshake timeout in `tests/cli.test.js`; widening the helper timeout from `10s` to `20s` removed that flake. The rerun then exited `0` with all-files coverage at `88.01` lines, `75.59` branches, and `92.54` functions.
- `THUMBGATE_PROOF_DIR=... npm run prove:adapters` exited `0`: `48` passed, `0` failed.
- `THUMBGATE_AUTOMATION_PROOF_DIR=... npm run prove:automation` exited `0`: `55` passed, `0` failed.
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `4/4` healthy checks (`budget_status 150ms`, `tests 61973ms`, `prove_adapters 1151ms`, `prove_automation 1159ms`).
- `git diff --check` exited `0`.
- The Chrome cookie scan on this machine showed:
  - `Default instagram=7 tiktok=0`
  - `Profile 1 instagram=0 tiktok=0`
- The prepared bundle at `.artifacts/social/live-combined-preflight-proof-20260321c/` contains exactly `5` slide PNGs, `instagram.txt`, `tiktok.txt`, `tiktok-fallback.mp4`, and attempt-proof subdirectories.
- `sips` verified `.artifacts/social/live-combined-preflight-proof-20260321c/slides/slide-01.png` at `1080x1080`.
- The bundle manifest recorded these immutable hashes:
  - caption SHA-256: `834ec9b32f36d082998cd74a1af3c1ce50fc1ec568f83415c1196d0b2d489e44`
  - TikTok fallback MP4 SHA-256: `1d9ab0a7cb237e750907c88b68eed1d0d909269a858deb90fa65f7a86260d693`
  - slide SHA-256 values: `d2dfd30faefab16a2e5280a35233d761a4b45ee27c611ba1120abc817071bb7c`, `3b87cce4a311d8a77b005ed4c98b98988a60213514b4b576edc7dd49f9e86eac`, `ed1c8bef64842219744f1146693ed02335812182ec94fcafb41aa37c5de6eb9c`, `0d5dcbacdafecff4c73f035286e9e852e16adfb6de55ebc519149e9550a92a71`, `aaf7b3c8a0e97fd9d2fa02b6d65ad0a2e586bcee577eae889954810df3b458fb`.
- The combined headless publish lane halted before any partial post with:
  - `TikTok did not reach an authenticated upload surface: {"error":"Timed out waiting for browser state on https://www.tiktok.com/tiktokstudio/"}`
- The Instagram-only no-share publish lane succeeded on the same prepared bundle:
  - CLI result: `[{"platform":"instagram","mode":"draft-ready","assetCount":5}]`
  - Attempt record: `.artifacts/social/live-combined-preflight-proof-20260321c/publish-attempts/instagram-1774117555400-pccxyr/attempt.json`
  - Attempt screenshots: `instagram-preflight.png`, `instagram-uploaded.png`, `instagram-draft-ready.png`
- The latest local publish-history rows show the repaired sequence truthfully:
  - earlier copied-profile failures (`playwright-core` missing, DevTools startup budget too short, generic TikTok timeout, Instagram discard modal)
  - final successful Instagram draft-ready row for attempt `instagram-1774117555400-pccxyr`
- `git cherry -v main codex/archive-primary-dirty-20260320` showed one unique archive commit, `2063a6e...`.
- `git show --stat --summary --format=medium 2063a6e...` proved the archive commit is not a safe promotion candidate:
  - deletes `scripts/behavioral-extraction.js`
  - adds scratch-only `scripts/gsd-final-verification.js`
  - changes `bin/memory.sh`, `bin/obsidian-sync.sh`, `primer.md`, and adds `docs/OPERATIONAL_LOOPS.md` without a coherent verification lane
- A stronger live browser proof was attempted with `npm run social:publish -- --bundle .artifacts/social/pre-action-gates-proof/bundle.json --platforms instagram --no-share --cleanup-drafts`. The repo-side tab-focus bug was fixed first, but the live attempt still failed outside repo control because Google Chrome returned: `Executing JavaScript through AppleScript is turned off. To turn it on, from the menu bar, go to View > Developer > Allow JavaScript from Apple Events.`
- `npm audit --json` exited `0` with `0` vulnerabilities.
- `git diff --check` exited `0`.

Requirements verified:

- The product now has a low-debt, repo-owned zero-filming social pipeline instead of an external-only posting playbook.
- Instagram and TikTok assets are generated from one canonical local source, so the same content can be repurposed without manual screenshots or duplicate copy.
- TikTok web fallback is explicit and truthful: the automation path generates a `1080x1920` MP4 because the current TikTok desktop surface accepts `video/*` rather than a guaranteed photo-carousel path.
- Scheduler support is implemented and proven in dry-run form, but should be installed only from a durable checkout path because the generated `launchd` plist points at the installing repo path.
- The remaining live-posting blocker is a browser runtime setting in Google Chrome, not missing repo logic.
- No new npm dependencies were added.

## March 20, 2026: AI workflow control-plane positioning + semantic cache efficiency proof

Scope:

- Repositioned the public landing page away from generic "memory server" framing and toward "AI workflow control plane" language, while preserving the existing Pre-Action Gates product contract.
- Added a comparison section that clarifies the difference between memory servers, agentic RAG, and the workflow control layer this product actually sells.
- Surfaced semantic cache efficiency metrics in the dashboard/API by reusing existing ContextFS provenance (`contextfs/provenance/packs.jsonl`) rather than introducing a new ledger or duplicate write path.
- Updated the commercial truth copy so the Pro package promises concrete efficiency metrics: semantic cache hit rate and reused context tokens.
- Fixed the required session handoff hook by cleaning `bin/obsidian-sync.sh` and adding a regression test so `./bin/memory.sh` exits cleanly when no Obsidian vault env is configured.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/worktrees/thumbgate-llm-efficiency-roi`:

```bash
npm ci
node --test tests/dashboard.test.js
node --test tests/api-server.test.js
node --test tests/public-landing.test.js
node --test tests/session-handoff.test.js
./bin/memory.sh
npm test
npm run test:coverage
tmp=$(mktemp -d) && THUMBGATE_PROOF_DIR="$tmp" npm run prove:adapters
tmp=$(mktemp -d) && THUMBGATE_AUTOMATION_PROOF_DIR="$tmp" npm run prove:automation
npm run self-heal:check
git diff --check
npm run revenue:status -- --json
```

Observed result:

- `npm ci` exited `0`.
- `node --test tests/dashboard.test.js` exited `0`: `17` passed, `0` failed.
- `node --test tests/api-server.test.js` exited `0`: `55` passed, `0` failed.
- `node --test tests/public-landing.test.js` exited `0`: `12` passed, `0` failed.
- `node --test tests/session-handoff.test.js` exited `0`: `10` passed, `0` failed.
- `./bin/memory.sh` exited `0` and now cleanly reports `THUMBGATE_OBSIDIAN_VAULT_PATH not set. Skipping sync.` with no shell errors.
- `npm test` exited `0`.
- `npm run test:coverage` exited `0` with all-files coverage at `89.68` lines, `75.72` branches, and `93.16` functions.
- `THUMBGATE_PROOF_DIR=... npm run prove:adapters` exited `0`: `48` passed, `0` failed.
- `THUMBGATE_AUTOMATION_PROOF_DIR=... npm run prove:automation` exited `0`: `55` passed, `0` failed.
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `4/4` healthy checks on a serial rerun (`tests 99171ms`, `prove_adapters 7235ms`, `prove_automation 3873ms`).
- `git diff --check` exited `0`.
- `npm run revenue:status -- --json` exited `0` with `source: hosted-via-railway-env`; public probes returned `/health 200`, `/ 200`, and `/v1/telemetry/ping 204`.

Behavioral proof points:

- The public landing page now explicitly says the product acts as an "AI workflow control plane" and is "not another generic memory server."
- The new category section contrasts `Memory servers`, `Agentic RAG`, and `ThumbGate`, so buyers can place the product correctly before evaluating pricing.
- The Pro offer now exposes concrete efficiency metrics in public copy: semantic cache hit rate and reused context tokens.
- The session handoff path is cleaner than before: `./bin/memory.sh` refreshes `primer.md` without the broken shell-comment noise that previously leaked from `bin/obsidian-sync.sh`.
- `generateDashboard()` now computes efficiency from existing context-pack provenance:
  - `contextPackRequests`
  - `semanticCacheHits`
  - `semanticCacheHitRate`
  - `averageSemanticSimilarity`
  - `estimatedContextCharsReused`
  - `estimatedContextTokensReused`
- `/v1/dashboard` now returns those efficiency metrics alongside funnel and revenue analytics, and regression tests verify the API contract.
- Hosted-first operational truth still reports `bookedRevenueTodayCents: 0`, so this change improves positioning and measurement clarity, not current-day revenue by itself.

No-tech-debt notes:

- No new dependencies were added.
- No new runtime ledger was introduced.
- Efficiency reporting reuses existing ContextFS provenance instead of creating a second telemetry path.

## March 20, 2026: Railway rollout verification wait-budget hardening

Scope:

- Removed `--detach` from the Railway deploy commands in `.github/workflows/ci.yml` and `.github/workflows/deploy-railway.yml` so GitHub Actions waits for the Railway build stream instead of queueing a deploy and immediately polling the old live app.
- Increased the health-verification wait budget from `8` attempts to `12` in CI and to `18` in the main deploy workflow so rollout activation has enough time to promote the new build before the SHA check fails.
- Added regression coverage in `tests/deployment.test.js` to lock the workflow contract: no detached Railway deploys, stamped build metadata, and a longer SHA-verification budget.
- Verified the root cause against production: merge commit `ebd5189d290b73c24b6b9cdc9f5181042e225171` eventually reached Railway successfully even though workflow run `23355558359` failed early while `/health` still reported the previous build SHA.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/worktrees/thumbgate-railway-verifier-wait`:

```bash
npm ci
node --test tests/deployment.test.js
npm test
npm run test:coverage
tmp=$(mktemp -d) && THUMBGATE_PROOF_DIR="$tmp/proof" npm run prove:adapters
tmp=$(mktemp -d) && THUMBGATE_AUTOMATION_PROOF_DIR="$tmp/proof-automation" npm run prove:automation
npm run self-heal:check
git diff --check
gh run view 23355558359 --repo IgorGanapolsky/thumbgate --log-failed
curl -sS https://thumbgate-production.up.railway.app/health
sleep 90 && curl -sS https://thumbgate-production.up.railway.app/health
```

Observed result:

- `npm ci` exited `0`.
- `node --test tests/deployment.test.js` exited `0`: `14` passed, `0` failed.
- `npm test` exited `0`.
- `npm run test:coverage` exited `0` with all-files coverage at `89.68` lines, `75.72` branches, and `93.16` functions.
- `THUMBGATE_PROOF_DIR=... npm run prove:adapters` exited `0`: `48` passed, `0` failed.
- `THUMBGATE_AUTOMATION_PROOF_DIR=... npm run prove:automation` exited `0`: `55` passed, `0` failed.
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `4/4` healthy checks.
- `git diff --check` exited `0`.
- Root-cause evidence from GitHub Actions run `23355558359`:
  - the deploy step stamped `config/build-metadata.json` with `ebd5189d290b73c24b6b9cdc9f5181042e225171`;
  - the Railway deploy queued successfully and returned build logs for deployment `f5e4a9ab-92a5-41b9-9537-8862d529c4c3`;
  - the health verifier then polled the live app too early and saw the still-healthy previous build `93daccdd7f5ac7efa3bf53e75d90b854976cb337` for all `8/8` attempts.
- Live production proof after the failed workflow showed the new build did eventually promote:
  - immediate `/health`: `buildSha: 93daccdd7f5ac7efa3bf53e75d90b854976cb337`
  - after ~90 seconds: `buildSha: ebd5189d290b73c24b6b9cdc9f5181042e225171`

Requirements verified:

- The broken `main` signal was a false-negative workflow verifier, not a failure of the immutable build-metadata implementation or the Railway rollout itself.
- The workflow repair is low debt: it removes premature detachment, increases the rollout wait budget, and locks the contract with tests instead of adding ad hoc manual retries.

## March 20, 2026: Immutable Railway build identity and Smithery capability scan hardening

Scope:

- Added `scripts/build-metadata.js` plus tracked `config/build-metadata.json` so deploys stamp an immutable build SHA into the shipped artifact instead of trusting mutable Railway runtime variables.
- Updated `.github/workflows/deploy-railway.yml` to generate build metadata during the deploy workflow and removed the old `THUMBGATE_BUILD_SHA` runtime-variable sync.
- Updated `src/api/server.js` so `/health` reads the stamped build metadata and protected endpoints accept `x-api-key` as an alternate auth header in addition to `Authorization: Bearer ...`.
- Added regression coverage in `tests/api-server.test.js` and `tests/deployment.test.js` for stamped build metadata, alternate auth headers, and the public server-card schema contract.
- Added the missing empty-object `inputSchema` to `get_reliability_rules` in `scripts/tool-registry.js` so Smithery and other directory scanners can enumerate the tool list without schema errors.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/worktrees/thumbgate-immutable-buildsha`:

```bash
npm ci
node --test tests/api-server.test.js tests/deployment.test.js tests/mcp-server.test.js
npm test
npm run test:coverage
tmp=$(mktemp -d) && THUMBGATE_PROOF_DIR="$tmp/proof" npm run prove:adapters
tmp=$(mktemp -d) && THUMBGATE_AUTOMATION_PROOF_DIR="$tmp/proof-automation" npm run prove:automation
npm run self-heal:check
git diff --check
```

Observed result:

- `npm ci` exited `0`.
- `node --test tests/api-server.test.js tests/deployment.test.js tests/mcp-server.test.js` exited `0`: `86` passed, `0` failed.
- `npm test` exited `0`.
- `npm run test:coverage` exited `0` with all-files coverage at `89.67` lines, `75.73` branches, and `93.14` functions.
- `THUMBGATE_PROOF_DIR=... npm run prove:adapters` exited `0`: `48` passed, `0` failed.
- `THUMBGATE_AUTOMATION_PROOF_DIR=... npm run prove:automation` exited `0`: `55` passed, `0` failed.
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `4/4` healthy checks.
- Local targeted proof confirmed the new behavior directly:
  - `/health` returned the stamped `buildSha` from the metadata file instead of reading a mutable env var.
  - admin-protected endpoints accepted `x-api-key` as an alternate auth header.
  - every public MCP tool entry exposed an `inputSchema` object, including `get_reliability_rules`.
- `git diff --check` exited `0`.

Requirements verified:

- Railway deploy proof can now compare `/health.buildSha` against the actual shipped revision instead of a mutable runtime variable that can drift across deploys.
- Smithery and other public MCP scanners now have a complete `inputSchema` for every exposed tool.
- Header-based API key clients can authenticate without having to reformat credentials into bearer-token syntax.
- The fix is low debt: no new dependencies, no duplicate health endpoint, and no product-runtime feature fork.

## March 20, 2026: Hosted analytics and revenue audit hardening

Scope:

- Added `scripts/revenue-status.js` and repointed `npm run revenue:status` to prefer hosted Railway-backed truth before falling back to the local CFO summary.
- Preserved the old local-only operator path as `npm run revenue:status:local` instead of deleting it, so the change removes a blind spot without breaking existing local workflows.
- Added targeted regression coverage in `tests/revenue-status.test.js` for GitHub variable parsing, public landing signal detection, hosted diagnosis, and the hosted-audit happy path.
- Set Railway production runtime vars `THUMBGATE_PUBLIC_APP_ORIGIN` and `THUMBGATE_BILLING_API_BASE_URL` explicitly to the canonical hosted origin so the deployed app no longer relies on implicit defaults.
- Verified the live public app, live telemetry ingress, live hosted billing summary, and the repo-standard verification suite from a dedicated clean worktree.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/worktrees/thumbgate-analytics-revenue-audit`:

```bash
npm ci
node --check scripts/revenue-status.js
node --test tests/revenue-status.test.js
npm test
npm run test:coverage
tmp=$(mktemp -d) && THUMBGATE_PROOF_DIR="$tmp/proof" npm run prove:adapters
tmp=$(mktemp -d) && THUMBGATE_AUTOMATION_PROOF_DIR="$tmp/proof-automation" npm run prove:automation
npm run self-heal:check
npm run revenue:status -- --json
railway variable set -s thumbgate -e production \
  THUMBGATE_PUBLIC_APP_ORIGIN=https://thumbgate-production.up.railway.app \
  THUMBGATE_BILLING_API_BASE_URL=https://thumbgate-production.up.railway.app --json
git diff --check
```

Observed result:

- `npm ci` exited `0`.
- `node --check scripts/revenue-status.js` exited `0`.
- `node --test tests/revenue-status.test.js` exited `0`: `4` passed, `0` failed.
- `npm test` exited `0`.
- `npm run test:coverage` exited `0` with all-files coverage at `89.37`, `75.65`, and `92.99` on the tool's aggregate line.
- `THUMBGATE_PROOF_DIR=... npm run prove:adapters` exited `0`: `48` passed, `0` failed.
- `THUMBGATE_AUTOMATION_PROOF_DIR=... npm run prove:automation` exited `0`: `55` passed, `0` failed.
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `4/4` healthy checks.
- `npm run revenue:status -- --json` exited `0` with `source: hosted-via-railway-env`.
- The live public probes inside `npm run revenue:status -- --json` reported:
  - `/health` returned `200` with `version: 0.7.4`.
  - `/health` deployment metadata matched the canonical hosted origin for both `appOrigin` and `billingApiBaseUrl`.
  - `/` returned `200` and exposed `plausibleScript: true`, `telemetryEndpoint: true`, and `workflowSprintIntake: true`.
  - `/` still exposed `gaEventHook: true` but `gaLoaderScript: false`, which matches the known GA runtime gap rather than a broken page.
  - `/v1/telemetry/ping` accepted the live probe and returned `204`.
- The hosted Railway-backed billing summary reported truthfully:
  - `today`: `13` visitors, `8` page views, `2` checkout starts, `2` unique leads, `2` paid orders, `$20.00` booked historical revenue, and `$0.00` booked today.
  - `30d`: `28` visitors, `19` page views, `9` checkout starts, `6` unique leads, `2` paid orders, and `$20.00` booked revenue.
  - `lifetime`: the same counts as `30d` at verification time.
  - `dataQuality.telemetryCoverage`, `dataQuality.attributionCoverage`, and `dataQuality.amountKnownCoverage` were all `1`.
  - `diagnosis.primaryIssue` was `operator_blind_spot_local_fallback`, not missing analytics or missing revenue data.
- Live runtime presence in Railway reported:
  - `THUMBGATE_FEEDBACK_DIR: true`
  - `THUMBGATE_API_KEY: true`
  - `THUMBGATE_PUBLIC_APP_ORIGIN: true`
  - `THUMBGATE_BILLING_API_BASE_URL: true`
  - `THUMBGATE_GA_MEASUREMENT_ID: false`
  - `THUMBGATE_CHECKOUT_FALLBACK_URL: true`
  - `STRIPE_SECRET_KEY: true`
- Live container inspection over Railway SSH confirmed durable analytics persistence under `/data/feedback`:
  - `telemetry-pings.jsonl` existed and contained `850` lines.
  - `funnel-events.jsonl` existed and contained `6` lines.
- `railway variable set ... --json` succeeded for `THUMBGATE_PUBLIC_APP_ORIGIN` and `THUMBGATE_BILLING_API_BASE_URL`, and Railway redeployed the production service with the explicit canonical values.
- `git diff --check` exited `0`.

Requirements verified:

- Production analytics and tracking are implemented and live; the earlier zeroed local output was a local operator fallback, not evidence that nobody uses the system.
- Production revenue evidence exists and is queryable from the hosted admin surface; the truthful statement for March 20, 2026 is still `$0.00` booked today and `$20.00` booked historically.
- The no-tech-debt path is in place: the repo now has a hosted-first operator audit command with no new dependencies, no duplicate billing logic, and a preserved local fallback.
- The remaining live gap is external configuration, not product logic: GA4 is still missing a Railway `THUMBGATE_GA_MEASUREMENT_ID`, so the page exposes GA hooks but does not load the GA script.

## March 19, 2026: Railway deploy health verification retry hardening

Scope:

- Replaced the single-shot Railway health check in `.github/workflows/ci.yml` with bounded retry logic so transient cold-start `502` responses do not fail a healthy deployment.
- Replaced the same brittle single-shot health check in `.github/workflows/deploy-railway.yml` with the same bounded retry logic and response-body logging.
- Hardened post-deploy verification without changing the actual production app contract.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/worktrees/thumbgate-fix-prod-analytics`:

```bash
node --test tests/deployment.test.js tests/deploy-policy.test.js
npm test
npm run test:coverage
tmp=$(mktemp -d) && THUMBGATE_PROOF_DIR="$tmp/proof" npm run prove:adapters
tmp=$(mktemp -d) && THUMBGATE_AUTOMATION_PROOF_DIR="$tmp/proof-automation" npm run prove:automation
npm run self-heal:check
git diff --check
```

Observed result:

- `node --test tests/deployment.test.js tests/deploy-policy.test.js` exited `0`: `17` passed, `0` failed.
- `npm test` exited `0`.
- `npm run test:coverage` exited `0` with all-files coverage at `89.49%` lines, `75.89%` branches, and `93.11%` functions.
- `THUMBGATE_PROOF_DIR=... npm run prove:adapters` exited `0`: `48` passed, `0` failed.
- `THUMBGATE_AUTOMATION_PROOF_DIR=... npm run prove:automation` exited `0`: `55` passed, `0` failed.
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `4/4` healthy checks.
- `git diff --check` exited `0`.
- Root-cause proof from the failed post-merge deploy run on `main`:
  - Railway variable sync timed out once at `https://backboard.railway.com/graphql/v2`, then succeeded on rerun.
  - The remaining deploy failure was the health verifier receiving a transient `502` from `https://thumbgate-production.up.railway.app/health` after a single 30-second wait.
  - The production app still reported healthy via `/healthz` with durable feedback paths under `/data/feedback`.

Requirements verified:

- Deployment verification now retries through transient warmup responses instead of failing on a single `502`.
- The hardening is isolated to workflow verification logic; no product-runtime behavior changed.

## March 19, 2026: Evidence-first intent ranking hardening after CI flake

Scope:

- Hardened `scripts/intent-router.js` so the `strict_reviewer` partner profile deterministically front-loads evidence-producing actions (`construct_context_pack`, `context_provenance`) ahead of `evaluate_context_pack` when `verificationMode` is `evidence_first`.
- Added regression coverage in `tests/intent-router.test.js` for the evidence-first ordering contract without overconstraining the relative order between the two evidence producers.
- Re-ran the full required verification suite after GitHub CI exposed the probabilistic ordering bug.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/worktrees/thumbgate-fix-prod-analytics`:

```bash
node --test tests/intent-router.test.js
npm test
npm run test:coverage
tmp=$(mktemp -d) && THUMBGATE_PROOF_DIR="$tmp/proof" npm run prove:adapters
tmp=$(mktemp -d) && THUMBGATE_AUTOMATION_PROOF_DIR="$tmp/proof-automation" npm run prove:automation
npm run self-heal:check
git diff --check
```

Observed result:

- `node --test tests/intent-router.test.js` exited `0`: `21` passed, `0` failed.
- `npm test` exited `0`.
- `npm run test:coverage` exited `0` with all-files coverage at `89.49%` lines, `75.89%` branches, and `93.05%` functions.
- `THUMBGATE_PROOF_DIR=... npm run prove:adapters` exited `0`: `48` passed, `0` failed.
- `THUMBGATE_AUTOMATION_PROOF_DIR=... npm run prove:automation` exited `0`: `55` passed, `0` failed.
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `4/4` healthy checks.
- `git diff --check` exited `0`.

Requirements verified:

- The evidence-first reviewer strategy now matches its contract under repeated runs instead of relying on Thompson-sampling luck.
- The original PR failure mode is closed: `evaluate_context_pack` no longer outranks the evidence-producing actions for strict-reviewer incident plans.

## March 19, 2026: Production durable analytics volume and live Stripe checkout fix

Scope:

- Added a Railway-aware default in `scripts/feedback-loop.js` so hosted deployments automatically persist telemetry under `RAILWAY_VOLUME_MOUNT_PATH/feedback` when `THUMBGATE_FEEDBACK_DIR` is not explicitly set.
- Fixed `scripts/billing.js` so hosted Stripe checkout session creation omits `customer_email` unless a real email is present, instead of passing `null` and triggering live Stripe API failures.
- Added targeted regression coverage for the Railway volume fallback and the hosted checkout payload contract.
- Provisioned a real Railway production volume mounted at `/data`, set `THUMBGATE_FEEDBACK_DIR=/data/feedback`, and redeployed production so funnel and memory logs survive restarts.
- Verified the live hosted `/checkout/pro` route now creates a real Stripe Checkout Session redirect and that live attribution events persist to the durable telemetry ledger.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/worktrees/thumbgate-fix-prod-analytics`:

```bash
npm ci
node --test tests/billing.test.js tests/feedback-loop.test.js
npm test
npm run test:coverage
tmp=$(mktemp -d) && THUMBGATE_PROOF_DIR="$tmp/proof" npm run prove:adapters
tmp=$(mktemp -d) && THUMBGATE_AUTOMATION_PROOF_DIR="$tmp/proof-automation" npm run prove:automation
npm run self-heal:check
git diff --check
railway volume add -m /data --json
railway variable set THUMBGATE_FEEDBACK_DIR=/data/feedback RAILWAY_RUN_UID=0 --json
railway up -d -m "fix(billing): omit null stripe customer_email and default Railway feedback volume"
python3 - <<'PY'
import json, urllib.request
req = urllib.request.Request(
    'https://thumbgate-production.up.railway.app/checkout/pro',
    headers={'User-Agent': 'codex'},
    method='GET'
)
opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler)
try:
    opener.open(req)
except urllib.error.HTTPError as exc:
    print(json.dumps({
        'status': exc.code,
        'location': exc.headers.get('Location')
    }, indent=2))
PY
railway run -- python3 - <<'PY'
import json, os, urllib.request
req = urllib.request.Request(
    'https://thumbgate-production.up.railway.app/v1/billing/summary',
    headers={
        'Authorization': f"Bearer {os.environ['THUMBGATE_API_KEY']}",
        'User-Agent': 'codex'
    }
)
with urllib.request.urlopen(req) as resp:
    data = json.load(resp)
print(json.dumps({
    'status': 'ok',
    'paidOrders': data['revenue']['paidOrders'],
    'bookedRevenueCents': data['revenue']['bookedRevenueCents'],
    'bookedRevenueTodayCents': data['revenue']['bookedRevenueTodayCents'],
    'paidOrdersToday': data['revenue']['paidOrdersToday'],
    'funnelTotalEvents': data['funnel']['totalEvents'],
    'acquisitionBySource': data['funnel']['acquisitionBySource'],
    'acquisitionByCampaign': data['funnel']['acquisitionByCampaign'],
    'acquisitionByCommunity': data['funnel']['acquisitionByCommunity'],
    'acquisitionByPostId': data['funnel']['acquisitionByPostId'],
    'acquisitionByCommentId': data['funnel']['acquisitionByCommentId'],
    'acquisitionByCampaignVariant': data['funnel']['acquisitionByCampaignVariant'],
    'acquisitionByOfferCode': data['funnel']['acquisitionByOfferCode']
}, indent=2))
PY
```

Observed result:

- `npm ci` exited `0`.
- `node --test tests/billing.test.js tests/feedback-loop.test.js` exited `0`: `32` passed, `0` failed.
- `npm test` exited `0`.
- `npm run test:coverage` exited `0` with all-files coverage at `89.46%` lines, `75.83%` branches, and `93.05%` functions.
- `THUMBGATE_PROOF_DIR=... npm run prove:adapters` exited `0`: `48` passed, `0` failed.
- `THUMBGATE_AUTOMATION_PROOF_DIR=... npm run prove:automation` exited `0`: `55` passed, `0` failed.
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `4/4` healthy checks.
- `git diff --check` exited `0`.
- Railway production volume `cd9d854e-4925-4c53-9b41-8f8840ebc889` was created and mounted at `/data`.
- Railway production variables now include:
  - `THUMBGATE_FEEDBACK_DIR=/data/feedback`
  - `RAILWAY_RUN_UID=0`
  - `RAILWAY_VOLUME_MOUNT_PATH=/data`
- Railway deployment `a8c3e0cb-9d0a-4018-8f1a-60984ea44929` succeeded for the exact code fix.
- Live `GET /healthz` reports:
  - `feedbackLogPath: /data/feedback/feedback-log.jsonl`
  - `memoryLogPath: /data/feedback/memory-log.jsonl`
- Live `GET /checkout/pro` now returns `302` with `Location: https://checkout.stripe.com/c/pay/cs_live_...`, proving hosted checkout session creation is working again instead of falling back after a Stripe API failure.
- Live billing summary after a fresh attributed visit reports:
  - `paidOrders: 2`
  - `bookedRevenueCents: 2000`
  - `bookedRevenueTodayCents: 0`
  - `paidOrdersToday: 0`
  - `funnelTotalEvents: 1`
  - `acquisitionBySource.ai_search: 1`
  - `acquisitionByCampaign.prod_checkout_fix: 1`
  - `acquisitionByCommunity.ClaudeCode: 1`
  - `acquisitionByPostId.prod-checkout-fix: 1`
  - `acquisitionByCommentId.proof-final: 1`
  - `acquisitionByCampaignVariant.durable_volume: 1`
  - `acquisitionByOfferCode.OPS-FINAL: 1`

Requirements verified:

- Production analytics are now durable across Railway restarts because telemetry writes to the mounted volume instead of ephemeral container storage.
- Hosted Stripe checkout no longer fails on missing buyer email; the backend now omits `customer_email` rather than sending `null`.
- Live attribution analytics are now persisted and queryable from the admin billing summary.
- The MCP has verified historical booked revenue (`$20.00`), but booked revenue for March 19, 2026 remains truthfully `0`; the fix restores the purchase path and analytics instead of fabricating a same-day sale.

## March 19, 2026: Stripe revenue reconciliation, live checkout cutover, and production billing proof

Scope:

- Added live Stripe revenue reconciliation to `scripts/billing.js` so historical successful charges tied to the current product are included in the billing summary without fabricating same-day revenue.
- Switched the admin billing summary surfaces in `scripts/operational-summary.js` and `src/api/server.js` to the live reconciliation path.
- Replaced buyer-facing Gumroad links on active repo and runtime surfaces with the hosted `/checkout/pro` route, while changing the fallback checkout URL default to the direct Stripe payment link.
- Updated the live Railway production environment so `/checkout/pro` now falls back to Stripe instead of Gumroad.
- Deployed the exact worktree diff to Railway and verified the hosted billing summary now reports the reconciled Stripe revenue truth surface.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/thumbgate-revenue-proof`:

```bash
node --test tests/billing.test.js tests/api-server.test.js tests/cli.test.js tests/version-metadata.test.js tests/recall-limit.test.js tests/public-landing.test.js
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
git diff --check
railway variable set THUMBGATE_CHECKOUT_FALLBACK_URL=https://buy.stripe.com/aFa4gz1M84r419v7mb3sI05
railway up -d -m "revenue proof analytics + stripe checkout fallback"
railway run node - <<'NODE'
const https = require('https');
const options = {
  hostname: 'thumbgate-production.up.railway.app',
  path: '/v1/billing/summary',
  headers: {
    authorization: `Bearer ${process.env.THUMBGATE_API_KEY}`,
    'user-agent': 'codex'
  }
};
const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log(JSON.stringify({ statusCode: res.statusCode, body: body ? JSON.parse(body) : null }, null, 2));
  });
});
req.on('error', (err) => { console.error(err); process.exit(1); });
req.end();
NODE
```

Observed result:

- Targeted monetization/runtime regression pack exited `0`: `116` passed, `0` failed.
- `npm test` exited `0` in the dedicated worktree after the final checkout and analytics edits.
- `npm run test:coverage` exited `0` with all-files coverage at `89.27%` lines, `75.79%` branches, and `93.01%` functions.
- `npm run prove:adapters` exited `0`: `48` passed, `0` failed.
- `npm run prove:automation` exited `0`: `55` passed, `0` failed.
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `4/4` healthy checks.
- `git diff --check` exited `0`.
- Railway env-only redeploy `32717506-102b-4316-88d6-eddb6fdf7150` succeeded after setting `THUMBGATE_CHECKOUT_FALLBACK_URL` to the Stripe payment link.
- Production `GET /checkout/pro` now returns `302` to `https://buy.stripe.com/aFa4gz1M84r419v7mb3sI05...` instead of the old Gumroad URL.
- Railway code deployment `a5fbff33-c410-46bf-b795-ced4163495ac` succeeded for the exact worktree diff.
- The live admin billing summary now returns `200` and reports:
  - `paidOrders: 2`
  - `bookedRevenueCents: 2000`
  - `bookedRevenueTodayCents: 0`
  - `paidOrdersToday: 0`
  - `processorReconciledOrders: 2`
  - `processorReconciledRevenueCents: 2000`
  - `coverage.providerCoverage.stripe: booked_revenue+processor_reconciled`

Requirements verified:

- Historical product revenue is now proven through live Stripe reconciliation instead of being hidden behind a false-zero billing summary.
- The production checkout fallback no longer leaks buyers to Gumroad; the hosted `/checkout/pro` route now falls back to Stripe.
- The repo truth surface now matches live production: the MCP has made money historically, but it is not making booked money on March 19, 2026.

## March 18, 2026: Open SWE-style internal-agent bootstrap, sandbox lane, and MCP/API parity

Scope:

- Added `scripts/internal-agent-bootstrap.js` as a real runtime bootstrap module for internal coding-agent threads, not a marketing-only stub.
- Added a first-class `bootstrap_internal_agent` surface across the MCP tool registry, API server, canonical OpenAPI spec, and Gemini function declarations.
- Added worktree-backed sandbox preparation so bootstrap can create or reuse an isolated git worktree lane for execution.
- Added reviewer-lane planning in the bootstrap result so coding workflows can expose an optional evaluator/reviewer path without making multi-agent orchestration the default.
- Replaced dead placeholder MCP behavior for the tested tool surfaces in `adapters/mcp/server-stdio.js` with real dispatch and payload handling.
- Hardened stdio transport behavior so framed and newline-delimited MCP initialization both work, while malformed ndjson still returns the legacy ndjson error envelope expected by the CLI contract.
- Preserved recall-limit commercial behavior while keeping real recall output and codegraph evidence intact after the adapter rewrite.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/thumbgate-open-swe-plan`:

```bash
npm ci
node --test tests/internal-agent-bootstrap.test.js tests/mcp-server.test.js tests/openapi-parity.test.js tests/prove-adapters.test.js tests/cli.test.js tests/recall-limit.test.js
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR='/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.1Y2VqtnO1F/proof' npm run prove:adapters
env THUMBGATE_AUTOMATION_PROOF_DIR='/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.2gfdnB5cPh/proof-automation' npm run prove:automation
npm run self-heal:check
git status --short
git diff --stat
```

Observed result:

- `npm ci` exited `0`; `150` packages installed, `151` audited, `0` vulnerabilities. Log: `/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.xKAQXDEA64/npm-ci.log`
- Focused Open SWE regression pack exited `0`: `111` passed, `0` failed. Log: `/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.QAW02kTBU1/open-swe-regression.log`
- `npm test` exited `0` end-to-end in the clean worktree. Log: `/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.gkSlebXonX/npm-test.log`
- `npm run test:coverage` exited `0` with all-files coverage at `86.97%` lines, `75.15%` branches, and `92.49%` functions. Log: `/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.omsAOIgi5P/test-coverage.log`
- `env THUMBGATE_PROOF_DIR=... npm run prove:adapters` exited `0`: `48` passed, `0` failed. Log: `/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.1Y2VqtnO1F/prove-adapters.log`
- `env THUMBGATE_AUTOMATION_PROOF_DIR=... npm run prove:automation` exited `0`: `55` passed, `0` failed. Log: `/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.2gfdnB5cPh/prove-automation.log`
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `4/4` healthy checks. Log: `/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.gqN6I7Gfkp/self-heal-check.log`
- Current tracked diff after the implementation:
  - `16` changed paths in the worktree
  - `14` tracked files changed with `1050` insertions and `20` deletions
  - `2` new files: `scripts/internal-agent-bootstrap.js` and `tests/internal-agent-bootstrap.test.js`
- Post-sync verification after merging `origin/main` into `codex/open-swe-adoption-plan` for PR `#258` also passed:
  - `npm ci` exited `0`. Log: `/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.l6cgkKKJVv/npm-ci-merge.log`
  - `npm test` exited `0`. Log: `/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.RRXVoXMSMg/npm-test-merge.log`
  - `npm run test:coverage` exited `0` with all-files coverage at `89.57%` lines, `75.72%` branches, and `93.10%` functions. Log: `/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.S5vGznS7oW/test-coverage-merge.log`
  - `env THUMBGATE_PROOF_DIR=... npm run prove:adapters` exited `0`: `48` passed, `0` failed. Log: `/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.0QvYuLywFK/prove-adapters-merge.log`
  - `env THUMBGATE_AUTOMATION_PROOF_DIR=... npm run prove:automation` exited `0`: `55` passed, `0` failed. Log: `/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.LIxnkdcu80/prove-automation-merge.log`
  - `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `4/4` healthy checks. Log: `/var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/tmp.Xr81UMZGaf/self-heal-check-merge.log`

Requirements verified:

- `bootstrap_internal_agent` is now reachable through the API route, MCP tool surface, canonical OpenAPI document, ChatGPT adapter OpenAPI mirror, and Gemini declarations.
- Bootstrap can normalize GitHub/Slack/Linear-style invocations, build startup context, create or reuse a git worktree sandbox, and emit a reviewer-lane recommendation for coding tasks.
- The MCP stdio server still accepts both `Content-Length` framed requests and newline-delimited JSON requests after the adapter rewrite.
- Malformed ndjson input still returns the expected ndjson error envelope, which keeps `tests/cli.test.js` green instead of silently changing the transport contract.
- Recall still returns actual results, includes codegraph evidence, and appends the post-limit upgrade nudge after five calls.
- Adapter proof coverage increased to `48` passing checks because the new bootstrap surface is exercised by both `api.internal_agent.bootstrap` and `mcp.tools.call.bootstrap_internal_agent`.

## March 18, 2026: North Star truth surface, workflow-run ledger, and hosted analytics durability

Scope:

- Added `scripts/workflow-runs.js` as a dedicated local ledger for proof-backed workflow runs, reviewed runs, paid team runs, and named pilot agreements.
- Added a first-class `north-star` CLI command and a `🎯 North Star` section in the dashboard so the repo now reports the stated product metric directly instead of only adjacent revenue and telemetry proxies.
- Added `scripts/verify-run.js` so `npm run verify:full` records a proof-backed workflow run after the full suite passes.
- Fixed billing and dashboard truth surfaces to use the active feedback directory discovery logic instead of being split between `.thumbgate/` and legacy `.claude/memory/feedback/` defaults.
- Added safe reconciliation logic for historical paid-provider events so legacy paid funnel events become honest `paidOrders` without fabricating booked revenue.
- Wired hosted deployment examples and secret sync flows for durable runtime feedback storage and optional analytics/search-console variables: `THUMBGATE_FEEDBACK_DIR`, `THUMBGATE_GA_MEASUREMENT_ID`, and `THUMBGATE_GOOGLE_SITE_VERIFICATION`.
- Added regression coverage for workflow-run persistence, North Star CLI output, dashboard reporting, direct local telemetry persistence, and billing reconciliation when the revenue ledger is absent.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/thumbgate-northstar-20260318-135757`:

```bash
npm ci
node --test tests/workflow-runs.test.js tests/billing.test.js tests/dashboard.test.js tests/cli.test.js
node --test tests/billing.test.js tests/dashboard.test.js
npm run verify:full
node bin/cli.js north-star
node bin/cli.js dashboard
env _TEST_FUNNEL_LEDGER_PATH='/Users/ganapolsky_i/workspace/git/igor/thumbgate/.claude/memory/feedback/funnel-events.jsonl' \
    _TEST_REVENUE_LEDGER_PATH='/tmp/thumbgate-empty-revenue-events.jsonl' \
    _TEST_API_KEYS_PATH='/tmp/thumbgate-empty-api-keys.jsonl' \
    node -e "const { getBillingSummary } = require('./scripts/billing'); const summary = getBillingSummary(); console.log(JSON.stringify({ paidProviderEvents: summary.revenue.paidProviderEvents, paidOrders: summary.revenue.paidOrders, bookedRevenueCents: summary.revenue.bookedRevenueCents, derivedPaidOrders: summary.revenue.derivedPaidOrders, unreconciledPaidEvents: summary.revenue.unreconciledPaidEvents }, null, 2));"
```

Observed result:

- `npm ci` completed with `0` vulnerabilities.
- `node --test tests/workflow-runs.test.js tests/billing.test.js tests/dashboard.test.js tests/cli.test.js` completed successfully for the workflow-run, billing, dashboard, and CLI ledger surface.
- `node --test tests/billing.test.js tests/dashboard.test.js`: `27` passed, `0` failed.
- `npm run verify:full` exited `0` and completed the standard full suite:
  - `npm test`
  - `npm run test:coverage`
  - `npm run prove:adapters`
  - `npm run prove:automation`
  - `npm run self-heal:check`
- `npm run test:coverage` passed with all-files coverage at `89.79%` lines, `76.04%` branches, and `93.43%` functions.
- `npm run prove:adapters`: `46` passed, `0` failed.
- `npm run prove:automation`: `55` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.
- `node bin/cli.js north-star` now reports the explicit product metric:
  - `Weekly proof-backed workflow runs : 1`
  - `Weekly teams on proof-backed runs : 1`
  - `Reviewed workflow runs            : 1`
  - `Paid orders                       : 4`
  - `Booked revenue                    : $0.00`
  - `North Star status                 : tracking`
- `node bin/cli.js dashboard` now includes the dedicated `🎯 North Star` section and reports:
  - `Weekly Proof Runs: 1`
  - `Weekly Teams     : 1`
  - `Reviewed Runs    : 1`
  - `Paid Team Runs   : 0`
  - `Named Pilots     : 0`
  - `Status           : tracking`
  - `Customer Proof   : missing`
- Historical revenue-truth proof against the real legacy funnel ledger now reconciles paid-stage events correctly without claiming revenue that is not provable:
  - `paidProviderEvents: 23`
  - `paidOrders: 23`
  - `bookedRevenueCents: 0`
  - `derivedPaidOrders: 23`
  - `unreconciledPaidEvents: 0`

Requirements verified:

- The repo now tracks its documented North Star directly: weekly active proof-backed workflow runs.
- Full-suite verification automatically writes a proof-backed workflow-run record after successful completion.
- Dashboard and CLI truth surfaces agree on the same North Star state instead of only showing indirect commercial or telemetry proxies.
- Historical paid-provider events are no longer stranded as unreconciled paid-stage funnel noise when the revenue ledger is missing.
- Hosted deployment tooling now has first-class support for durable runtime feedback storage and optional GA/Search Console wiring without introducing tracked runtime state.

## March 17, 2026: Workflow hardening sprint intake and commercial-truth operator metrics

Scope:

- Replaced the public Workflow Hardening Sprint `mailto:` dependency with a hosted sprint-intake form on the landing page, including structured CTA tracking and success/failure handling.
- Added `scripts/workflow-sprint-intake.js` as the single owner for sprint-intake lead capture, writing contactable workflow leads to the active local feedback runtime as `workflow-sprint-leads.jsonl`.
- Added `POST /v1/intake/workflow-sprint` to the hosted API and wired the landing form to it.
- Strengthened public machine-readable positioning with `Organization`, `SoftwareApplication`, `BuyAction`, and `CommunicateAction` schema on the public landing page.
- Routed active outreach and social assets to the hosted sprint-intake path instead of stale email-first or legacy-growth messaging.
- Integrated workflow-sprint lead counts into the admin billing/CFO summary so pipeline capture is visible in the same truth surface as booked revenue, while explicitly keeping leads separate from revenue claims.
- Corrected operator scripts so `pulse.js` and `money-watcher.js` key off booked revenue and paid orders instead of unreconciled paid-stage funnel events.
- Hardened `tests/delegation-runtime.test.js` temp-dir cleanup so clean-worktree coverage runs no longer fail with transient `ENOTEMPTY` teardown errors.

Commands run in the dedicated clean verification worktree at `/tmp/thumbgate-verify-first-dollar-20260317` on exact branch head `ba83de2`:

```bash
npm ci
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR=/tmp/thumbgate-verify-first-dollar-ba83de2/proof-adapters npm run prove:adapters
env THUMBGATE_AUTOMATION_PROOF_DIR=/tmp/thumbgate-verify-first-dollar-ba83de2/proof-automation npm run prove:automation
npm run self-heal:check
git status --short
```

Additional targeted GTM/commercial regressions run in the implementation worktree:

```bash
node --test tests/public-landing.test.js tests/api-server.test.js tests/workflow-hardening-sprint.test.js tests/social-marketing-assets.test.js tests/version-metadata.test.js tests/commercial-signals.test.js tests/billing.test.js tests/cli.test.js
```

Observed result:

- `npm ci` completed with `0` vulnerabilities.
- `npm test` passed end-to-end on exact branch head `ba83de2`.
- `npm run test:coverage` passed with `1108` passed, `0` failed, `1` skipped.
- All-files coverage on the verified tree: `90.18%` lines, `76.29%` branches, `93.55%` functions.
- `env THUMBGATE_PROOF_DIR=/tmp/thumbgate-verify-first-dollar-ba83de2/proof-adapters npm run prove:adapters`: `46` passed, `0` failed.
- `env THUMBGATE_AUTOMATION_PROOF_DIR=/tmp/thumbgate-verify-first-dollar-ba83de2/proof-automation npm run prove:automation`: `55` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.
- `git status --short` remained empty after the full clean-worktree suite.
- Targeted GTM/commercial regression pack passed with `98` tests passed, `0` failed.

Requirements verified:

- The public sprint offer now has a direct hosted intake path for qualified workflow demand instead of forcing an email handoff.
- Sprint-intake leads are captured as structured local runtime records and exposed in the admin billing/CFO summary without being misrepresented as revenue.
- Public positioning, outreach assets, billing truth surfaces, and operator scripts now agree on the same commercial story: Workflow Hardening Sprint for pipeline, Pro for self-serve $19/mo access.
- Clean-worktree verification is stable again after hardening the delegation test teardown.

## March 16, 2026: Databricks post-merge safety follow-up

Scope:

- Fixed the merged Databricks analytics export so its default output root now uses `getFeedbackPaths()` instead of a legacy `.claude` fallback, keeping implicit bundle writes inside the same safe data boundary used by the API and MCP adapters.
- Normalized Databricks bundle-relative paths to POSIX separators before embedding them in `manifest.json` and `load_databricks.sql`, preventing Windows-hosted exports from generating backslash-separated paths that Databricks SQL cannot read.
- Added regression coverage for:
  - default export-path selection when `.thumbgate/` is present
  - API default export path behavior
  - MCP default export path behavior
  - bundle-relative path normalization

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/thumbgate-databricks-followup`:

```bash
npm ci
node --test tests/databricks-export.test.js tests/api-server.test.js tests/mcp-server.test.js
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed result:

- `npm ci` completed with `0` vulnerabilities.
- Targeted Databricks regressions passed: `51` tests passed, `0` failed.
- `npm test` passed end-to-end on the follow-up branch after the post-merge fixes were applied.
- `npm run test:coverage` passed with `1041` tests, `1040` passed, `0` failed, `1` skipped.
- All-files coverage on the follow-up branch: `83.47%` lines, `69.70%` branches, `86.40%` functions.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `46` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `47` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Requirements verified:

- The Databricks export no longer escapes the safe feedback root when no explicit `outputPath` is provided.
- The Databricks SQL bootstrap always uses forward-slash bundle-relative paths, including on Windows-originated exports.
- API and MCP default exports now inherit the same root-selection behavior as the shared ThumbGate feedback pipeline.

## March 16, 2026: Databricks analytics bundle export

Scope:

- Added `scripts/export-databricks-bundle.js` to export the local ThumbGate control plane into a Databricks-ready analytics bundle instead of coupling the runtime system to an external warehouse.
- Export now emits `feedback_events.jsonl`, `memory_records.jsonl`, `feedback_sequences.jsonl`, `feedback_attributions.jsonl`, `proof_reports.jsonl`, `manifest.json`, and a bootstrap `load_databricks.sql` template with catalog/schema placeholders.
- Added the bundle export to every primary surface:
  - CLI: `npx thumbgate export-databricks`
  - HTTP API: `POST /v1/analytics/databricks/export`
  - MCP: `export_databricks_bundle`
- Updated policy and adapter metadata so intent planning, OpenAPI parity, and Gemini function declarations expose the new analytics-plane export consistently.
- Kept the smart-learning review fix on the same branch and verified it still passes after the Databricks export surface was added.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/thumbgate-smart-learning-fix`:

```bash
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed result:

- Targeted Databricks/API/MCP/OpenAPI/CLI regressions passed: `101` tests passed, `0` failed.
- `npm test` passed end-to-end on the worktree after the analytics export surface and smart-learning fix were combined.
- `npm run test:coverage` passed with `1024` tests, `1023` passed, `0` failed, `1` skipped.
- All-files coverage on the verified tree: `83.44%` lines, `69.92%` branches, `86.33%` functions.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `46` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `43` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Requirements verified:

- The Databricks export is reachable and consistent across CLI, HTTP API, MCP, ChatGPT OpenAPI, and Gemini declarations.
- The bundle contains local ThumbGate memory, attribution, sequence, and proof-report tables without mutating the control-plane storage model.
- The generated SQL bootstrap keeps external warehouse details parameterized rather than hard-coding catalog/schema paths into the product.
- Codegraph-aware intent planning, recall, and proof flows still pass after the analytics export path was introduced.

## March 15, 2026: AgentRx-style failure diagnostics

Scope:

- Added `scripts/failure-diagnostics.js` with a narrow failure taxonomy for `invalid_invocation`, `tool_output_misread`, `intent_plan_misalignment`, `guardrail_triggered`, and `system_failure`.
- Compiled diagnosis constraints from workflow contract rules, gate policies, session constraints, approval checkpoints, and MCP tool schemas.
- Added the `diagnose_failure` MCP tool and made it profile-aware so locked/read-only profiles diagnose disallowed tool calls correctly instead of pretending the full tool catalog is available.
- Threaded diagnoses into the verification loop, self-healing health checks, dashboard aggregation, analytics, and prevention-rule generation through a shared `diagnostic-log.jsonl` path.
- Removed false-positive fallback diagnoses so vague or unsupported negative signals no longer inflate root-cause metrics.
- Updated `README.md` so the MCP tool inventory and profile counts match the shipped product surface.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/thumbgate/.claude/worktrees/agent-agentrx`:

```bash
npm ci
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed result:

- `npm ci` completed with `0` vulnerabilities.
- `npm test` passed end-to-end on the post-fix tree after the review-found diagnostic gaps were closed.
- `npm run test:coverage` passed with `1018` tests, `1017` passed, `0` failed, `1` skipped.
- All-files coverage on the post-fix tree: `83.43%` lines, `69.93%` branches, `86.36%` functions.
- `npm run prove:adapters`: `46` passed, `0` failed.
- `npm run prove:automation`: `43` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Evidence artifacts verified:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`

Requirements verified:

- `diagnose_failure` no longer fabricates `tool_output_misread` for vague or unclassified failures with no real evidence.
- `diagnose_failure` now respects MCP profile allowlists and emits policy-backed invalid-invocation diagnoses for disallowed tools.
- Failed verification runs persist diagnoses into the shared analytics path instead of dying inside transient return payloads.
- `self-heal:check` persists unhealthy-check diagnoses into the same shared analytics path when run via CLI.
- Dashboard and prevention-rule outputs now include persisted verification and self-heal diagnoses, not only diagnoses attached during feedback capture.
- The README tool inventory now matches the shipped MCP surface: essential profile remains `5` tools, full profile is `12` tools including `diagnose_failure`.

## March 13, 2026: PR hygiene and runtime-state cleanup

Scope:

- Removed accidental tracked `.claude/worktrees/agent-*` gitlinks from the repository index so disposable worktree lanes stop polluting `main`.
- Removed tracked live `.thumbgate/*` runtime artifacts from version control and aligned `.gitignore` with the repo policy that ThumbGate memory/state is local operational data.
- Persisted the runtime-state hygiene rule in `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`.
- Archived unique orphan branches before deletion and removed clean redundant worktrees/branches with no active PR or verification role.

Commands run:

```bash
git fetch --all --prune
git worktree add /Users/ganapolsky_i/workspace/git/igor/thumbgate-pr-hygiene-20260313 -b chore/pr-hygiene-20260313 origin/main
npm ci
env THUMBGATE_API_KEY=ci-secret npm test
env THUMBGATE_API_KEY=ci-secret npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run self-heal:check
npm audit --json
git diff --check
```

Observed result:

- GitHub open PRs: `0`.
- `main` CI was already green on `bbfa45576d3ea7136e544e68662253079646feeb`.
- `npm ci` completed with `0` vulnerabilities.
- `env THUMBGATE_API_KEY=ci-secret npm test` passed end-to-end.
- `env THUMBGATE_API_KEY=ci-secret npm run test:coverage` passed with `971` passed, `0` failed, `1` skipped and all-files coverage at `82.59%` lines, `68.77%` branches, `85.37%` functions.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `38` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `37` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run self-heal:check`: `Overall: HEALTHY` with `4/4` checks healthy.
- `npm audit --json` reported `0` open vulnerabilities.
- `git diff --check` passed with no whitespace or patch-format defects.

Cleanup evidence:

- Tracked branch count: `22 -> 18`.
- Worktree count: `18 -> 7`.
- Archived before deletion:
  - `archive/20260313/chore-stripe-incident-response`
  - `archive/20260313/docs-update-product-tiers`
  - `archive/20260313/feat-deep-document-infrastructure`
  - `archive/20260313/feat-fix-verification-failures`
  - `archive/20260313/feat-free-tier-limits`
  - `archive/20260313/feat-step-feedback-export`
  - `archive/20260313/pr-190-readonly`
  - `archive/20260313/worktree-agent-a6591335`
  - `archive/20260313/worktree-agent-a7dc457b`
- Removed clean redundant worktrees/branches:
  - `chore/pr-cleanup-20260312`
  - `feat/context-hub-preflight`
  - `feat/local-provider-abstraction`
  - `worktree-agent-ade17c3c`
  - detached verification worktree `/Users/ganapolsky_i/workspace/git/igor/thumbgate-techdebt-audit`
  - stale `main` worktree `/Users/ganapolsky_i/workspace/git/igor/thumbgate-partner-aware-orchestration`
- Repository hygiene change size: `42` tracked runtime artifacts removed from source control, `1286` tracked lines deleted.

Requirements verified:

- Disposable worktree lanes are no longer a versioned part of the product repository.
- ThumbGate runtime state now matches the documented local-only operating model instead of creating tracked churn in every session.
- Unique orphan branches were preserved before deletion, while clean redundant lanes were removed outright.
- The verification suite still passes after moving runtime state out of version control.

## March 13, 2026: Technical debt audit and CI hardening

Scope:

- Fixed the free-tier gate loading regression in `scripts/gates-engine.js` so core default gates always load and free-tier capping applies only to auto-promoted add-on gates.
- Removed dead duplicate `/healthz` routing in `src/api/server.js`.
- Removed the legacy in-memory recall limiter in `adapters/mcp/server-stdio.js`, switched recall usage to the shared rate-limiter, and kept the free-tier upgrade nudge without dropping recall results.
- Hardened `tests/recall-limit.test.js` so CI-provided secrets like `THUMBGATE_API_KEY` cannot bypass the free-tier assertions.
- Added exact feedback-memory deduplication in `scripts/contextfs.js` so repeated identical lessons no longer create duplicate ContextFS entries.
- Hardened CI to install and verify the `workers/` package, aligned Stripe worker code with the current SDK API version, and removed the repo-local `wrangler` dependency because the current npm advisories did not leave a clean vendored release line.
- Deleted six duplicate ThumbGate memory entries that were already storing the same lessons.

Baseline snapshot before changes:

Commands run in dedicated baseline worktree at `57a7498e42578270a2dc1421c1bfd8d06f07dded`:

```bash
git worktree add /Users/ganapolsky_i/workspace/git/igor/thumbgate-audit-baseline 57a7498e42578270a2dc1421c1bfd8d06f07dded
npm ci
npm --prefix workers ci
node --test tests/contextfs.test.js tests/intent-router.test.js tests/verification-loop.test.js tests/mcp-server.test.js
npm --prefix workers audit --json
npm run test:coverage
```

Observed baseline result:

- Core RAG/orchestration snapshot passed: `57` tests passed, `0` failed across `tests/contextfs.test.js`, `tests/intent-router.test.js`, `tests/verification-loop.test.js`, and `tests/mcp-server.test.js`.
- `npm --prefix workers audit --json` reported `4` moderate vulnerabilities in the worker dependency chain (`esbuild`, `wrangler`, `miniflare`, `undici`).
- `npm run test:coverage` exited non-zero on the pre-audit tree with `957` passed, `4` failed, `1` skipped.
- Baseline coverage summary still emitted: `82.07%` lines, `68.96%` branches, `85.52%` functions.
- The failing baseline regressions were:
  - `tests/gates-engine.test.js`: protected-branch and `.env` gate expectations failed.
  - `tests/recall-limit.test.js`: sixth recall call never emitted the upgrade nudge.

Commands run on the audit branch:

```bash
npm ci
npm --prefix workers ci
npm run test:gates
node --test tests/contextfs.test.js
THUMBGATE_API_KEY=ci-secret node --test tests/recall-limit.test.js
THUMBGATE_API_KEY=ci-secret npm run test:api
node --test tests/mcp-server.test.js tests/api-server.test.js
THUMBGATE_API_KEY=ci-secret npm test
THUMBGATE_API_KEY=ci-secret npm run test:coverage
npm run test:workers
env THUMBGATE_PROOF_DIR="$(mktemp -d)" THUMBGATE_API_KEY=ci-secret npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" THUMBGATE_API_KEY=ci-secret npm run prove:automation
env THUMBGATE_PROOF_DIR="$(mktemp -d)" THUMBGATE_API_KEY=ci-secret npm run prove:workflow-contract
env THUMBGATE_PROOF_DIR="$(mktemp -d)" THUMBGATE_API_KEY=ci-secret npm run prove:autoresearch
THUMBGATE_API_KEY=ci-secret npm run self-heal:check
npm --prefix workers audit --json
wrangler deploy --dry-run
```

Observed result:

- `npm test` passed end-to-end after the audit changes.
- `npm run test:coverage` passed with `968` passed, `0` failed, `1` skipped.
- Current coverage summary on the final audit head: `82.42%` lines, `68.76%` branches, `85.10%` functions.
- `npm run test:gates`, `node --test tests/contextfs.test.js`, `THUMBGATE_API_KEY=ci-secret node --test tests/recall-limit.test.js`, and `node --test tests/mcp-server.test.js tests/api-server.test.js` all passed.
- `THUMBGATE_API_KEY=ci-secret npm run test:api` passed, proving the recall-limit regression is fixed under the same hosted-key environment GitHub Actions uses.
- `npm run test:workers` passed after the worker package gained a dedicated type-check test script.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `38` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `37` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:workflow-contract`: `6` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:autoresearch`: `Phase 9 proof: 5 passed, 0 failed`.
- `THUMBGATE_API_KEY=ci-secret npm run self-heal:check`: `Overall: HEALTHY` with `4/4` checks healthy.
- `npm --prefix workers ci`, `npm run test:workers`, and `npm --prefix workers audit --json` all passed with `0` vulnerabilities after removing the direct `wrangler` dependency from the repo-local worker package.
- `wrangler deploy --dry-run` passed from `workers/` via the globally installed Wrangler CLI (`4.63.0`).

Requirements verified:

- Free-tier users keep the default safety gates (`force-push`, `protected-branch-push`, `.env` edits) while still capping auto-promoted add-on gates.
- Recall requests now share the real rate-limiter state and still return useful content after the free tier is exhausted.
- Recall-limit verification no longer depends on CI secrets or shared test-state, so the free-tier upgrade nudge is exercised deterministically in GitHub Actions.
- Exact duplicate feedback-memory lessons no longer create duplicate ContextFS records, and the repository’s duplicate tracked memory entries were removed.
- The worker package is now covered by CI install and test steps instead of being outside the main pipeline.
- The worker package no longer vendors a vulnerable Wrangler release in-repo; deploys and `wrangler types` continue to use the globally installed CLI already required by `workers/README.md`.

## March 13, 2026: Partner-aware orchestration MVP

Scope:

- Added `config/partner-routing.json` and `scripts/partner-orchestration.js` to define reusable partner profiles, aliases, token-budget rules, and reward coefficients.
- Threaded optional `partnerProfile` through the HTTP API, MCP adapter, and OpenAPI surfaces so intent planning can return a partner-specific strategy summary.
- Updated the intent router and verification loop to adapt action ranking, token budgets, retry behavior, and Thompson updates for `partner_<profile>` reliability learning.
- Extended the automation proof harness and regression suite to verify partner-aware planning and emitted strategy metadata.

Commands run:

```bash
npm ci
node --test tests/intent-router.test.js tests/verification-loop.test.js tests/thompson-sampling.test.js tests/async-job-runner.test.js
node --test tests/api-server.test.js tests/mcp-server.test.js tests/prove-automation.test.js
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run self-heal:check
```

Observed result:

- Both targeted regression commands passed with `0` failures across partner orchestration, API, MCP, and automation-proof coverage.
- `npm test` passed end-to-end after adding partner-aware orchestration.
- `npm run test:coverage` passed with all-files coverage at `82.52%` lines, `68.69%` branches, and `85.19%` functions.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `38` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `37` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run self-heal:check`: `Overall: HEALTHY` with `4/4` checks healthy.

Evidence artifacts:

- Targeted `node --test` output covering `tests/intent-router.test.js`, `tests/verification-loop.test.js`, `tests/thompson-sampling.test.js`, `tests/async-job-runner.test.js`, `tests/api-server.test.js`, `tests/mcp-server.test.js`, and `tests/prove-automation.test.js`.
- Ephemeral adapter and automation proof reports emitted under temporary `THUMBGATE_PROOF_DIR` directories so verification did not leave tracked proof churn in the repository.

Requirements verified:

- `partnerProfile` is accepted by the public API and MCP `plan_intent` and `list_intents` surfaces and reaches the runtime planner.
- Intent plans now emit partner strategy metadata and adapt token budgets plus action ranking for strict, fast, silent-blocker, tool-limited, and balanced counterparts.
- Verification updates now learn partner-specific reliability in Thompson sampling under `partner_<profile>` categories without weakening the existing hard gate model.
- The automation proof harness now checks for `intent.partner_strategy`, so the new orchestration behavior is covered by proof, not only by unit tests.

## March 12, 2026: Commercial truth correction

Scope:

- Replaced stale low-dollar self-serve subscription language on live-facing surfaces with the actual public offer: Pro (`$19/mo`).
- Removed unsupported scarcity and adoption framing from CLI and landing-page copy.
- Added `docs/COMMERCIAL_TRUTH.md` as the source of truth for pricing, traction, and proof claims.

Commands run:

```bash
node --test tests/version-metadata.test.js tests/api-server.test.js tests/cli.test.js
```

Requirements verified:

- Live-facing copy no longer presents a public recurring subscription as the current self-serve offer.
- Live-facing copy no longer treats repo metrics or hardcoded scarcity as customer proof.
- Pricing and traction claims now point back to a single source of truth.

## March 12, 2026: CFO billing summary control plane

Scope:

- Added a shared operational billing summary in `scripts/billing.js` that merges the funnel ledger with the local key store.
- Added admin-only `GET /v1/billing/summary` plus the repo-local `node bin/cli.js cfo` command so API, CLI, watcher, and strategist surfaces share the same summary shape.
- Replaced fake paid-line revenue guessing in operator scripts with the new billing summary proxy.

Commands run:

```bash
node --test tests/billing.test.js tests/api-server.test.js tests/cli.test.js tests/openapi-parity.test.js
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run self-heal:check
```

Observed result:

- Targeted regression coverage passed: `63` tests passed, `0` failed across billing, API server, CLI, and OpenAPI parity.
- `npm test` passed end-to-end after adding the CFO control plane.
- `npm run test:coverage` passed with all-files coverage at `82.18%` lines, `68.13%` branches, and `84.90%` functions.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `38` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `35` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run self-heal:check`: `Overall: HEALTHY` with `4/4` checks healthy.

Evidence artifacts:

- Command output from the targeted regression run is the primary proof for the new CFO control plane.
- Ephemeral `THUMBGATE_PROOF_DIR` directories were used for adapter and automation proof runs to avoid tracked proof churn.

Requirements verified:

- Billing funnel telemetry, active keys, disabled keys, customer usage, and source attribution now resolve from one shared summary shape instead of ad hoc paid-line counting.
- `GET /v1/billing/summary` is admin-only and rejects provisioned billing keys.
- `node bin/cli.js cfo` returns the same machine-readable summary shape as the API surface, while reading the local ledger and key store in the current checkout.
- This surface is an operational billing proxy with ledger-backed `bookedRevenueCents` for providers that emit known amounts; it still does not claim invoice truth.

## March 12, 2026: Revenue Sprint & Conversion Optimization (historical, superseded)

Status:

- Historical pricing experiment notes only.
- Superseded by `docs/COMMERCIAL_TRUTH.md` for current public pricing and proof language.

Scope:

- Version sync across `package.json`, `mcpize.yaml`, and `server.json` to `v0.7.1`.
- Historical pricing experiment: tested a low-dollar founder offer and urgency hooks before the current commercial-truth correction.
- Discovery optimization: Added high-ROI GitHub topics and updated `SKILL.md` auto-indexing keywords.
- Launch content package: Created `docs/marketing/LAUNCH_CONTENT.md` with Reddit, HN, and Discord assets.
- CLI `pro` command was, at that time, updated to reflect the same historical pricing experiment.

Commands run:

```bash
npm test
npm run test:proof
npm run test:coverage
npm run prove:adapters
npm run prove:automation
node bin/cli.js help
node bin/cli.js stats
gh repo view --json repositoryTopics
```

Observed results:

- `npm test`: 100% pass across all 329 tests.
- `npm run test:proof`: all proof gates PASS.
- `npm run prove:adapters`: `{ "passed": 24, "failed": 0 }`.
- `node bin/cli.js stats`: Successfully triggered **Revenue-at-Risk** analyzer showing operational loss metrics.
- `gh repo view`: Verified topics including `agentic-feedback-studio`, `veto-layer`, and `zero-config`.

Evidence artifacts:

- `public/index.html` points checkout and fallback flow at the canonical Railway hosted app.
- `docs/marketing/LAUNCH_CONTENT.md` exists and contains high-intent hooks.
- `SKILL.md` updated with `agent-memory` and `claude-code` keywords.

Requirements verified:

- Pricing and fallback routing align with the current hosted billing funnel.
- Repository is optimized for auto-discovery by AI search and MCP directories.
- Technical integrity is maintained with a 100% test pass rate.

## March 10, 2026: Main CI Railway deploy gate hardening on final hotfix diff

Commands:

```bash
node --test tests/deployment.test.js
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run self-heal:check
```

Observed result:

- Targeted deployment verification passed: `9` tests passed, `0` failed in `tests/deployment.test.js`.
- `npm test` passed end-to-end on the narrowed hotfix diff with only the Railway deploy regression coverage added.
- `npm run test:coverage` passed with overall coverage at `82.97%` lines, `69.36%` branches, and `86.81%` functions.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `24 passed`, `0 failed`.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `14 passed`, `0 failed`.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run self-heal:check`: `HEALTHY` with `4/4` checks healthy.

Evidence artifacts:

- Focused deployment regression output from `node --test tests/deployment.test.js`.
- Ephemeral machine-readable proof reports emitted under temporary `THUMBGATE_PROOF_DIR` directories during the adapter and automation proof runs.

Requirements verified:

- The CI deploy workflow now refuses to enter the Railway deploy path unless explicit repo configuration is present for token, project, environment, and health-check inputs.
- The workflow no longer depends on the previously hard-coded Cloud Run health URL when validating a Railway deploy.
- The hotfix is scoped to deploy-gate behavior plus regression coverage; no unrelated runtime or proof harness changes were required to keep the branch green.

## March 10, 2026: CLI and adapter proof handshake hardening under full-suite load

Commands:

```bash
node --test --experimental-test-coverage --test-concurrency=1 tests/cli.test.js
node --test --test-concurrency=1 tests/prove-adapters.test.js
npm test
npm run test:coverage
npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed result:

- Targeted CLI coverage verification passed: `22` tests passed, `0` failed in `tests/cli.test.js`.
- Targeted adapter proof verification passed: `38` tests passed, `0` failed in `tests/prove-adapters.test.js`.
- `npm test` passed end-to-end after hardening the subprocess handshake budget used by the CLI and adapter proof harnesses.
- `npm run test:coverage` passed with `720` tests passed, `0` failed, and `1` skipped.
- Coverage summary: `83.17%` lines, `69.34%` branches, `86.86%` functions.
- `npm run prove:adapters`: `24 passed`, `0 failed`.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `14 passed`, `0 failed`.
- `npm run self-heal:check`: `HEALTHY` with `4/4` checks healthy.

Evidence artifacts:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`

Requirements verified:

- The CLI `serve` handshake test no longer flakes under full-suite coverage because the helper tolerates realistic subprocess startup latency and surfaces child process spawn errors explicitly.
- The adapter proof harness no longer times out its MCP stdio checks under heavy test load because its subprocess handshake budget matches observed startup behavior.
- Fatal adapter-proof errors now identify the exact MCP or adapter stage that failed instead of attributing late-stage transport failures to the preceding API step.

## March 10, 2026: MCP launcher hardening and proof-cleanup reliability

Commands:

```bash
npm ci
node --test tests/adapters.test.js tests/install-mcp.test.js tests/cli.test.js
node --test tests/prove-adapters.test.js tests/prove-lancedb.test.js
npm test
npm run prove:adapters
npm run prove:automation
node scripts/prove-lancedb.js
npm run self-heal:check
npm run test:coverage
```

Observed result:

- `npm ci` completed successfully with `0 vulnerabilities`.
- Targeted launcher verification passed: `39` tests passed, `0` failed across `tests/adapters.test.js`, `tests/install-mcp.test.js`, and `tests/cli.test.js`.
- Targeted proof cleanup verification passed: `39` tests passed, `0` failed across `tests/prove-adapters.test.js` and `tests/prove-lancedb.test.js`.
- `npm test` passed end-to-end after hardening MCP launcher generation and retry-based cleanup in the proof scripts.
- `npm run prove:adapters`: `24 passed`, `0 failed`.
- `npm run prove:automation`: `14 passed`, `0 failed`.
- `node scripts/prove-lancedb.js`: `5 passed`, `0 failed`, `0 warned`.
- `npm run self-heal:check`: `HEALTHY` with `4/4` checks healthy.
- `npm run test:coverage` passed with overall coverage at `83.16%` lines, `69.30%` branches, and `86.86%` functions (`719` passed, `0` failed, `1` skipped).

Evidence artifacts:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`
- `proof/lancedb-report.json`
- `proof/lancedb-report.md`

Requirements verified:

- Source checkouts now install canonical MCP entries that launch the local stdio server directly via `node adapters/mcp/server-stdio.js`.
- Portable docs and adapter examples now use the version-pinned launcher `npx -y thumbgate@1.5.8 serve` instead of an unpinned `npx` call that can be shadowed by stale local installs.
- Re-running the MCP installer upgrades stale config entries instead of treating them as already configured.
- Adapter and LanceDB proof cleanup now uses retry-capable recursive removal so ephemeral filesystem contention no longer flakes CI.
- Transient `.thumbgate` reminder/A2UI/test-run files are now ignored as local runtime state and do not pollute git hygiene during verification.

## March 10, 2026: Value-led GTM surfaces and hermetic ADK coverage

Commands:

```bash
npm ci
node --test tests/api-server.test.js tests/version-metadata.test.js
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed result:

- `npm ci` completed successfully with `0 vulnerabilities`.
- Targeted landing-page verification passed: `25` tests passed, `0` failed across `tests/api-server.test.js` and `tests/version-metadata.test.js`.
- `npm test` passed end-to-end after the public messaging and GTM doc changes.
- `npm run test:coverage` passed with a serialized Node test runner (`--test-concurrency=1`) so suites that rewrite `process.env` do not race each other during coverage.
- The ADK consolidation path stayed hermetic under test:
  - first-run anchor-only consolidation no longer exits early
  - `ADK_FAKE_CONSOLIDATION=true` is honored only under `NODE_ENV=test`
  - the anchor-memory test opts into deterministic consolidation instead of a live Gemini path
- Coverage summary: `83.20%` lines, `69.28%` branches, `86.78%` functions.
- `npm run prove:adapters`: `24 passed`, `0 failed`.
- `npm run prove:automation`: `14 passed`, `0 failed`.
- `npm run self-heal:check`: `HEALTHY` with `4/4` checks healthy.

Evidence artifacts:

- Targeted landing/API verification was exercised directly by the commands above.
- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`

The command output above is the primary evidence for this run. The tracked proof artifacts listed here were refreshed locally by the proof commands and serve as machine-readable corroboration.

Requirements verified:

- Public-facing GTM surfaces now lead with one workflow outcome instead of generic agent infrastructure.
- The landing page preserves `SoftwareApplication` and `FAQPage` JSON-LD while adding buyer-facing FAQ and comparison content.
- The GTM plan link referenced by the landing page now resolves to `docs/GO_TO_MARKET_REVENUE_WEDGE_2026-03.md`.
- The ADK consolidator and spike/anchor coverage path is deterministic again and no longer blocks the proof gate.

## March 9, 2026: Symphony workflow contract and hermetic coverage

Commands:

```bash
npm ci
npm test
npm run test:coverage
npm run prove:workflow-contract
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed result:

- Clean install completed with `0 vulnerabilities`.
- `npm test` passed end-to-end, including the new `test:workflow` contract gate.
- `npm run test:coverage` passed after hardening `tests/adk-consolidator.test.js` to use explicit deterministic consolidation in test mode instead of relying on a live Gemini key.
- Coverage summary: `83.39%` lines, `67.58%` branches, `86.63%` functions.
- `npm run prove:workflow-contract`: `4 passed`, `0 failed`.
- `npm run prove:adapters`: `21 passed`, `0 failed`.
- `npm run prove:automation`: `14 passed`, `0 failed`.
- `npm run self-heal:check`: `HEALTHY` with `4/4` checks healthy.

Evidence artifacts:

- `proof/workflow-contract/report.json`
- `proof/workflow-contract/report.md`
- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`

Requirements verified:

- Repo-owned `WORKFLOW.md` contract exists and encodes scope, hard stops, proof commands, and done criteria.
- Agent intake is bounded by `.github/ISSUE_TEMPLATE/ready-for-agent.yml`.
- PR handoff now requires proof-first structure via `.github/pull_request_template.md`.
- CI runs machine validation for the workflow contract and uploads workflow-proof artifacts.

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

- Summary: `21 passed`, `0 failed`
- Evidence artifacts:
  - `proof/compatibility/report.json`
  - `proof/compatibility/report.md`
- Verified checks include:
  - API auth and feedback/context/intents routes
  - Rubric-based gating for positive feedback (`422` when guardrails/disagreement fail)
  - Rubric-aware context evaluation payloads
  - API auth config hardening (`THUMBGATE_API_KEY` required unless insecure mode enabled)
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

- Summary: `14 passed`, `0 failed`
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

- Start API with `THUMBGATE_API_KEY=test-key` on port `8791`
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
- API initialization fails fast if `THUMBGATE_API_KEY` is missing and insecure mode is not explicitly enabled.
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

---

## 2026-03-30 — Agentic Data Pipeline Materialization

Implemented a staged internal analytics pipeline so ThumbGate can materialize `raw -> staging -> semantic -> lineage` instead of recomputing business metrics as an ad hoc live join.

Scope:

- Added `scripts/agentic-data-pipeline.js` for snapshot materialization, lineage, reconciliation, and managed job generation.
- Updated `scripts/semantic-layer.js` to read from the shared staged pipeline contract.
- Extended `scripts/schedule-manager.js`, `scripts/verify-run.js`, and `scripts/self-healing-check.js` so the lane is automated and proof-backed.

Commands run:

```bash
npm run test:data-pipeline
npm run test:semantic-layer
npm run prove:data-pipeline
node --test tests/data-pipeline.test.js tests/semantic-layer.test.js tests/schedule-manager.test.js tests/prove-data-pipeline.test.js tests/verify-run.test.js tests/self-healing-check.test.js
```

Observed results:

- `npm run test:data-pipeline`: `5/5` passing
- `npm run test:semantic-layer`: `5/5` passing
- `npm run prove:data-pipeline`: `6 passed, 0 failed`
- Focused regression bundle: `42/42` passing

Behavioral proof points:

- Identical reruns now hold a stable snapshot id and downgrade lineage to `noop`.
- Reconciliation warns on unreconciled paid events and attribution drift instead of silently flattening them.
- Semantic metrics now expose `attributionCoverageRate`, `unreconciledPaidEvents`, and `pipelineWarnings`.
- Managed schedule specs can materialize the pipeline through the interruptible async-job runner without bespoke shell glue.

Artifacts updated:

- `proof/data-pipeline-report.json`
- `proof/data-pipeline-report.md`

## 2026-03-24 Harness Score + Lesson Lifecycle Verification

Scope:

- Harness Score added to the dashboard so operators can see correction coverage, enforcement coverage, diagnostic coverage, repeat-failure pressure, and top next harness fixes in one place.
- `search_lessons` upgraded to expose lifecycle state, linked corrective actions, linked prevention rules, linked auto-gates, and next harness recommendations for each lesson.
- MCP/CLI/tool metadata updated so the new harness-improvement surface is discoverable to agents.

Commands run:

```bash
npm ci
node --test tests/dashboard.test.js tests/lesson-search.test.js tests/api-server.test.js tests/cli.test.js tests/mcp-server.test.js tests/mcp-tools-gates.test.js tests/positioning-contract.test.js
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed results:

- Focused harness suite: `152 passed`, `0 failed`.
- `npm test`: pass. Final test aggregate completed cleanly with `558 pass`, `0 fail`.
- `npm run test:coverage`: pass with:
  - statements: `88.50%`
  - branches: `74.32%`
  - functions: `92.54%`
- `npm run prove:adapters`: `48/48` passed.
- `npm run prove:automation`: `55/55` passed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Behavioral proof points:

- Dashboard empty-state now reports a bootstrapping Harness Score instead of omitting harness-health entirely.
- Repeated negative lessons now surface concrete next actions such as `pre_action_gate`, `prevention_rule`, `verification_harness`, and `diagnostic_capture`.
- Fully enforced lessons with linked rules and gates report zero open harness recommendations.
- API and CLI lesson-search output now includes lifecycle state and harness recommendations, not just memory text.

Files changed:

- `README.md`
- `scripts/dashboard.js`
- `scripts/lesson-search.js`
- `scripts/tool-registry.js`
- `tests/api-server.test.js`
- `tests/cli.test.js`
- `tests/dashboard.test.js`
- `tests/lesson-search.test.js`

## 2026-03-23 ThumbGate raw search + pack template verification

Scope:

- Added `search_thumbgate` as a read-only MCP tool for raw ThumbGate search across feedback logs, ContextFS memory, and prevention rules.
- Added authenticated `GET /v1/search` and `POST /v1/search` API routes with OpenAPI parity.
- Restored reusable ContextFS pack templates for bug investigation, session resume, sales-call prep, and competitor scans.
- Preserved `search_lessons` as the canonical promoted-lesson search surface while salvaging the broader raw-search lane.

Commands run:

```bash
npm ci
node --test --test-concurrency=1 tests/pack-templates.test.js tests/thumbgate-search.test.js tests/openapi-parity.test.js tests/commerce-quality.test.js tests/profile-router.test.js tests/intent-router.test.js
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed results:

- Targeted ThumbGate search suite: `75/75` passing.
- `npm test`: exit `0`.
- `npm run test:coverage`: exit `0` with `all files | 88.44 | 74.11 | 92.50`.
- `npm run prove:adapters`: exit `0` with `48/48` passing.
- `npm run prove:automation`: exit `0` with `55/55` passing.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4 healthy`.

Behavioral proof points:

- `search_thumbgate` is registered as read-only in the MCP tool registry and returns merged or source-filtered ThumbGate search results.
- `/v1/search` is present in the API root JSON listing and in both canonical and ChatGPT OpenAPI specs.
- `search_lessons` call semantics remain unchanged while `search_thumbgate` adds broader retrieval over raw ThumbGate state.
- ContextFS pack templates are exported, enumerable, and validated by dedicated tests.

## 2026-03-23 README trim + explicit tech stack verification

Scope:

- Reduced the root README from a long narrative sales page into a shorter operator-facing overview.
- Added an explicit `Tech Stack` section covering runtime, interfaces, storage, retrieval, enforcement, billing, and hosting.
- Preserved the repo contract requirements for `WORKFLOW.md`, the `ready-for-agent` intake template, `Commercial Truth`, and the free/self-hosted `search_lessons` surface.

Commands run:

```bash
wc -l README.md
node --test tests/positioning-contract.test.js tests/version-metadata.test.js tests/prove-workflow-contract.test.js
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed results:

- `README.md` line count reduced from `506` to `201`.
- Targeted contract/version/docs checks passed `23/23`.
- `npm test` exited `0`.
- `npm run test:coverage` exited `0` with `all files | 88.43 | 74.12 | 92.48`.
- `npm run prove:adapters` exited `0` with `48/48` checks passing.
- `npm run prove:automation` exited `0` with `55/55` checks passing.
- `npm run self-heal:check` reported `Overall: HEALTHY` and `4/4 healthy`.

Behavioral proof points:

- The root README now leads with the shipped product behavior instead of a long narrative sales page.
- The public docs now expose the actual technology stack directly in the README instead of forcing buyers to infer it from `package.json`.
- Required operator-contract links and free/self-hosted lesson-search messaging remain covered by automated tests.

## 2026-03-23 Lesson Search Verification

Scope:

- Added a first-class lesson search surface so any MCP-compatible free or self-hosted agent can search promoted lessons and inspect the corrective action linked to each result.
- Exposed the feature through MCP (`search_lessons`), HTTP (`GET /v1/lessons/search`), and CLI (`npx thumbgate lessons` / `search-lessons`).
- Linked each lesson result to its source feedback, matching prevention rules, and matching auto-promoted gates.
- Updated public docs so the essential profile now advertises lesson search as a free/self-hosted MCP surface.

Commands run:

```bash
npm ci
node --test tests/lesson-search.test.js tests/test-suite-parity.test.js
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed results:

- `node --test tests/lesson-search.test.js tests/test-suite-parity.test.js`: pass (`4/4`).
- `npm test`: pass.
- `npm run test:coverage`: pass with Node coverage summary:
  - line coverage: `88.34%`
  - branch coverage: `74.23%`
  - function coverage: `92.40%`
- `npm run prove:adapters`: pass (`48/48`).
- `npm run prove:automation`: pass (`55/55`).
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.
  - `budget_status`: healthy (`567ms`)
  - `tests`: healthy (`295323ms`)
  - `prove_adapters`: healthy (`200474ms`)
  - `prove_automation`: healthy (`119678ms`)

Behavioral proof points:

- `search_lessons` is available in the `default`, `essential`, `readonly`, `dispatch`, and `locked` MCP profiles.
- Empty queries list recent lessons; text queries rank lessons by query overlap plus recency.
- Search responses expose `correctiveActions` derived from lesson content plus linked prevention rules and auto-gates.
- `GET /v1/lessons/search` and the ChatGPT adapter OpenAPI both include the new search route.
- The CLI `lessons` command prints lesson summaries together with linked corrective actions.

Artifacts updated:

- `README.md`
- `adapters/chatgpt/openapi.yaml`
- `adapters/mcp/server-stdio.js`
- `bin/cli.js`
- `config/mcp-allowlists.json`
- `openapi/openapi.yaml`
- `package.json`
- `scripts/dispatch-brief.js`
- `scripts/intent-router.js`
- `scripts/lesson-search.js`
- `scripts/tool-registry.js`
- `src/api/server.js`
- `tests/api-server.test.js`
- `tests/cli.test.js`
- `tests/intent-router.test.js`
- `tests/lesson-search.test.js`
- `tests/mcp-server.test.js`
- `tests/openapi-parity.test.js`
- `tests/positioning-contract.test.js`
- `tests/profile-router.test.js`

## 2026-03-20 Railway deploy workflow deduplication and SHA-verification hardening

Scope:

- Removed the duplicate Railway deploy job from `.github/workflows/ci.yml` so `main` no longer triggers two concurrent deploy lanes.
- Kept `.github/workflows/deploy-railway.yml` as the single authoritative Railway deploy workflow.
- Preserved the dedicated deploy workflow's `18`-attempt SHA verification budget from `main` instead of reintroducing a stale forked verifier contract.
- Added workflow regression coverage so CI stays test-only and the dedicated deploy workflow keeps the Railway-specific logic.

Problem verified before the fix:

- PR `#287` merged as commit `df5f93d`, but Railway kept serving the previous build SHA `93daccd` for the full `8 x 10s` verification window.
- Failed deploy run `23354231413` died in `Verify deployment health`, not in `railway up`.
- The same merge SHA still passed `CI`, `CodeQL`, and `Publish to NPM`, which isolated the issue to deployment orchestration rather than application correctness.

Commands run:

```bash
node --test tests/deployment.test.js
npm test
npm run test:coverage
THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
THUMBGATE_AUTOMATION_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
git diff --check
```

Observed results:

- `node --test tests/deployment.test.js` exited `0`: `15/15` pass.
- `npm test` exited `0`.
- `npm run test:coverage` exited `0` with all-files coverage at `89.69%` statements, `75.76%` branches, and `93.14%` functions.
- `npm run prove:adapters` exited `0`: `48/48` pass.
- `npm run prove:automation` exited `0`: `55/55` pass.
- `npm run self-heal:check` exited `0`: `Overall: HEALTHY` with `4/4` healthy checks.
- `git diff --check` exited `0`.

Artifacts updated:

- `.github/workflows/ci.yml`
- `docs/VERIFICATION_EVIDENCE.md`
- `tests/deployment.test.js`

## 2026-03-20 Smithery Capability Metadata Fix

Scope:

- Fixed the public `/.well-known/mcp/server-card.json` route to include full MCP `inputSchema` metadata for every tool, instead of only name and description.
- Added an HTTP-level regression test proving the server card exposes tool schemas for directory scanners.

Problem verified before the fix:

- The public Smithery page for `thumbgate-loop/thumbgate-v2` was live, but showed `No capabilities found` and `No deployments found`.
- Production already exposed unauthenticated metadata endpoints:
  - `GET https://thumbgate-production.up.railway.app/.well-known/mcp/server-card.json` -> `200`
  - `GET https://thumbgate-production.up.railway.app/mcp` -> `200`
  - `POST https://thumbgate-production.up.railway.app/mcp` with `initialize` -> `200`
  - `POST https://thumbgate-production.up.railway.app/mcp` with `tools/list` -> `200`
- The bug was that the live server-card route stripped `inputSchema`, which made the static server card materially weaker than `tools/list`.

Commands run:

```bash
npm ci
npm --prefix workers ci
node --test tests/api-server.test.js
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)/proof" npm run prove:adapters
env THUMBGATE_AUTOMATION_PROOF_DIR="$(mktemp -d)/proof-automation" npm run prove:automation
npm run self-heal:check
git diff --check
```

Observed results:

- `node --test tests/api-server.test.js`: `54/54` passing
- `npm test`: exit `0`
- `npm run test:coverage`: exit `0` with `89.58%` lines, `75.61%` branches, `93.07%` functions
- `npm run prove:adapters`: `48/48` passing
- `npm run prove:automation`: `55/55` passing
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks
- `git diff --check`: exit `0`

Artifacts updated:

- `src/api/server.js`
- `tests/api-server.test.js`

## 2026-03-20 Railway Build SHA Deployment Verification

Scope:

- Exposed `buildSha` on `GET /health` from `THUMBGATE_BUILD_SHA`.
- Updated the Railway deploy workflow to set `THUMBGATE_BUILD_SHA` for each deploy and wait until the live `/health` payload reports the exact `GITHUB_SHA`.
- Closed the observed blind spot where a healthy old revision could satisfy the deploy job before the new revision was actually serving traffic.

Problem verified before the fix:

- PR `#285` merged cleanly and GitHub marked `Deploy to Railway` successful.
- The live public endpoint still served the pre-fix server-card shape immediately after that success signal.
- Railway runtime proof showed a new deployment existed, but the GitHub workflow only checked for HTTP `200`, not revision identity.

Commands run:

```bash
node --test tests/api-server.test.js
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)/proof" npm run prove:adapters
env THUMBGATE_AUTOMATION_PROOF_DIR="$(mktemp -d)/proof-automation" npm run prove:automation
npm run self-heal:check
git diff --check
```

Observed results:

- `node --test tests/api-server.test.js`: `54/54` passing
- `npm test`: exit `0`
- `npm run test:coverage`: exit `0` with `89.58%` lines, `75.59%` branches, `93.07%` functions
- `npm run prove:adapters`: `48/48` passing
- `npm run prove:automation`: `55/55` passing
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks
- `git diff --check`: exit `0`

Artifacts updated:

- `.github/workflows/deploy-railway.yml`
- `src/api/server.js`
- `tests/api-server.test.js`

## 2026-03-20 Dispatch-Safe Remote Ops Verification

Scope:

- Added a least-privilege `dispatch` MCP profile for remote review, recall, planning, diagnostics, and metrics.
- Blocked handoff and write workflows when `THUMBGATE_MCP_PROFILE=dispatch`.
- Added a `dispatch` CLI brief so paired-device operators can get a phone-safe operational snapshot without opening write-capable surfaces.
- Updated docs so Dispatch usage routes code and memory mutations back into a dedicated worktree with the `default` profile.

Commands run:

```bash
npm ci
node --test tests/mcp-policy.test.js tests/agent-readiness.test.js tests/delegation-runtime.test.js tests/dispatch-brief.test.js tests/cli.test.js
npm run test:cli
npm test
npm run test:coverage
THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
THUMBGATE_AUTOMATION_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed results:

- Targeted Dispatch lane tests: `55/55` pass, `0` fail.
- `npm run test:cli`: `82/82` pass, `0` fail.
- `npm test`: exit `0`.
- `npm run test:coverage`: exit `0`.
  - all files: `89.63%` statements, `75.35%` branches, `93.03%` functions.
- `npm run prove:adapters`: `48/48` pass, `0` fail.
- `npm run prove:automation`: `55/55` pass, `0` fail.
- `npm run self-heal:check`: `Overall: HEALTHY`, `4/4` healthy.

Behavioral proof points:

- `dispatch` profile exposes metrics, diagnostics, recall, rule inspection, and planning tools while denying `capture_feedback` and `start_handoff`.
- Permission readiness reports `dispatch` as `writeCapable: false` with explicit guidance to switch back to `default` in a dedicated worktree before edits.
- Delegation runtime treats `dispatch` as a single-agent review profile and rejects handoff starts with a `dispatch_profile` block reason.
- `dispatch --json` emits a remote brief with allowed tasks, blocked tasks, key metrics, and prompt templates for phone-safe usage.

Artifacts updated:

- `docs/guides/dispatch-ops.md`
- `docs/guides/mcp-use-integration.md`
- `docs/PLUGIN_DISTRIBUTION.md`
- `docs/marketing/mcp-directories.md`
## 2026-03-20 Technical Debt Audit Verification

Scope:

- Repo-wide technical debt sweep from a dedicated worktree rooted at `origin/main`.
- PR manager merge gate hardening for pending CI and required-review blockers.
- Python trainer cleanup plus new CI smoke coverage for the tracked Python script.
- Direct dependency drift reduction for `@google/genai`.

Commands run:

```bash
npm ci
node --test tests/pr-manager.test.js tests/train-from-feedback.test.js
python3 -m py_compile scripts/train_from_feedback.py
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed results:

- `npm ci`: clean install, `0 vulnerabilities`.
- `node --test tests/pr-manager.test.js tests/train-from-feedback.test.js`: `12` passed, `0` failed.
- `python3 -m py_compile scripts/train_from_feedback.py`: exit `0`.
- `npm test`: exit `0`.
- `npm run test:coverage`: exit `0`, `all files | 89.60 | 75.65 | 93.07`.
- `npm run prove:adapters`: `48/48` passed.
- `npm run prove:automation`: `55/55` passed.
- `npm run self-heal:check`: `Overall: HEALTHY`, `4/4 healthy`.

Behavioral proof points:

- Autonomous PR merges now stop on pending checks instead of treating them as ready.
- `REVIEW_REQUIRED` is now treated as an explicit blocker for autonomous merging.
- The tracked Python trainer is CI-smoke-tested so syntax regressions fail fast.
- The Python trainer no longer repeats category initialization logic or carries stale repository guidance.

## 2026-03-20 Technical Debt Audit + Test-Gate Hardening Verification

Scope:

- PR-management reliability when operating from a branch without an attached PR.
- Default test-gate completeness for repository test files.
- Removal of stale tracked test-output artifacts.
- Fresh technical-debt audit snapshot and verification evidence.

Baseline before changes:

- Tracked files: `573`
- Tracked lines: `115434`
- Coverage baseline from a separate clean `origin/main` worktree:
  - lines: `89.50%`
  - branches: `75.64%`
  - functions: `92.90%`
- `main` GitHub CI status on `fb78e8ae1a36dbdb92dd93867a278c60c92a41c0`: passing

Audit findings fixed:

1. `npm run pr:manage` failed with `no pull requests found for branch ...` on clean worktree branches.
2. `npm test` omitted `23` repository test files despite those tests passing independently.
3. There was no regression guard to stop future `npm test` drift from the actual `tests/**/*.test.js` inventory.
4. `test_output.txt` was a checked-in command transcript with no code or documentation references.

Targeted proof commands:

```bash
node --test tests/contextfs.test.js tests/feedback-to-memory.test.js tests/vector-store.test.js
node --test tests/mcp-server.test.js tests/intent-router.test.js tests/async-job-runner.test.js
node --test tests/pr-manager.test.js tests/test-suite-parity.test.js
npm run test:ops
npm run pr:manage
```

Observed targeted results:

- Local memory/RAG proof batch: `27/27` passing.
- Orchestration proof batch: `53/53` passing.
- PR-manager + parity guard batch: `9/9` passing.
- `npm run test:ops`: `171/171` passing.
- `npm run pr:manage`: clean noop with `[PR Manager] No open pull requests found.`

Full verification commands:

```bash
npm ci
npm --prefix workers ci
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)/proof" npm run prove:adapters
env THUMBGATE_AUTOMATION_PROOF_DIR="$(mktemp -d)/proof-automation" npm run prove:automation
npm run self-heal:check
npm audit --json
npm --prefix workers audit --json
git diff --check
```

Observed final results:

- `npm ci`: exit `0`
- `npm --prefix workers ci`: exit `0`
- `npm test`: exit `0`
- `npm run test:coverage`: exit `0`
  - lines: `89.57%`
  - branches: `75.48%`
  - functions: `93.06%`
- `npm run prove:adapters`: `48/48` passing
- `npm run prove:automation`: `55/55` passing
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4 healthy`
- `npm audit --json`: `0` vulnerabilities
- `npm --prefix workers audit --json`: `0` vulnerabilities
- `git diff --check`: exit `0`

Artifacts updated:

- `docs/TECHNICAL_DEBT_AUDIT.md`

## 2026-03-20 Hosted North Star + Sprint Pipeline Verification

Scope:

- Hosted-first operator truth for `north-star` and `dashboard`.
- Admin-only workflow sprint state advancement from `new -> qualified -> named_pilot -> proof_backed_run -> paid_team`.
- Pricing-decision Sprint CTA at the same moment buyers currently choose Pro.
- OpenAPI parity for the new sprint advancement route and dashboard window parameters.

Key files changed:

- `scripts/operational-dashboard.js`
- `scripts/dashboard.js`
- `src/api/server.js`
- `scripts/workflow-sprint-intake.js`
- `scripts/workflow-runs.js`
- `bin/cli.js`
- `public/index.html`
- `openapi/openapi.yaml`
- `adapters/chatgpt/openapi.yaml`

Targeted proof commands:

```bash
node --test tests/workflow-runs.test.js tests/workflow-sprint-intake.test.js tests/public-landing.test.js
node --test --test-concurrency=1 tests/api-server.test.js tests/openapi-parity.test.js tests/telemetry-analytics.test.js
node --test tests/cli.test.js tests/revenue-status.test.js
```

Targeted proof results:

- Workflow + landing batch: `17` tests passed, `0` failed.
- API + OpenAPI + telemetry batch: `69` tests passed, `0` failed.
- CLI + revenue-status batch: `41` tests passed, `0` failed.

Behavioral proof points:

- `POST /v1/intake/workflow-sprint/advance` is admin-only and rejects non-static billing keys with `403`.
- Sprint lead advancement appends immutable lead snapshots, creates workflow-run evidence for `named_pilot`, `proof_backed_run`, and `paid_team`, and preserves deduplicated North Star counts.
- `GET /v1/dashboard` now accepts `window`, `timezone`, and `now`, and its revenue/traffic numbers follow the live billing-summary path for that window.
- `north-star` now prefers the hosted operational dashboard when `THUMBGATE_BILLING_API_BASE_URL`, `THUMBGATE_API_KEY`, and `THUMBGATE_METRICS_SOURCE=hosted` are configured.
- The pricing section now includes `data-cta-id="pricing_sprint"` pointing directly to `#workflow-sprint-intake`.
- Canonical OpenAPI and ChatGPT adapter specs stay byte-aligned after adding `/v1/intake/workflow-sprint/advance`.

Full verification protocol:

```bash
npm ci
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)/proof" npm run prove:adapters
env THUMBGATE_AUTOMATION_PROOF_DIR="$(mktemp -d)/proof-automation" npm run prove:automation
npm run self-heal:check
git diff --check
```

Observed results:

- `npm ci`: exit `0`; audit reported `0` vulnerabilities.
- `npm test`: exit `0`.
- `npm run test:coverage`: exit `0` with aggregate coverage:
  - line coverage: `89.53%`
  - branch coverage: `75.73%`
  - function coverage: `93.02%`
- `npm run prove:adapters`: exit `0` with `48` passed, `0` failed.
- `npm run prove:automation`: exit `0` with `55` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.
- `git diff --check`: exit `0`.

Low-debt implementation notes:

- No new dependencies were added.
- Hosted metrics reuse `getBillingSummaryLive()` plus the existing dashboard generator rather than creating a second analytics stack.
- Sprint state transitions reuse the existing append-only lead ledger and workflow-run ledger rather than introducing a new database path.

## 2026-03-19 GitHub Marketplace Legacy Amount Repair Verification

Scope:

- Read-time GitHub Marketplace amount reconciliation for legacy paid revenue rows that were previously persisted with `amountKnown: false`.
- Explicit dry-run/write repair command for the local gitignored revenue ledger.
- Marketplace pricing metadata capture on new webhook writes so future repairs are auditable.

Commands run:

```bash
node --test tests/billing.test.js
node --test tests/github-billing.test.js
node --test tests/cli.test.js
npx thumbgate repair-github-marketplace
npx thumbgate repair-github-marketplace --write
```

Observed results:

- `tests/billing.test.js` passes the new backfill coverage:
  - summary books revenue from a legacy GitHub Marketplace row at read time when configured pricing is available
  - `repairGithubMarketplaceRevenueLedger({ write: true })` rewrites the local ledger with amount, currency, interval, and repair metadata
- `tests/github-billing.test.js` confirms new Marketplace writes now persist billing cycle, unit count, price model, and pricing source metadata
- `tests/cli.test.js` confirms `repair-github-marketplace` supports both preview mode and `--write`

Behavioral proof points:

- Legacy GitHub Marketplace rows no longer stay stranded as permanent `amountKnown: false` entries when a trusted plan-price mapping exists.
- The billing summary can surface booked revenue truth immediately from reconciled legacy Marketplace rows before a write-back is applied.
- The explicit repair command materializes that truth into the local `.thumbgate` or legacy feedback ledger without fabricating prices.

## 2026-03-17 Workflow Hardening Sprint Revenue-Motion Verification

Scope:

- Tightened the landing page around the Workflow Hardening Sprint as the front-line commercial motion.
- Added a current sprint brief for one workflow, one owner, and one proof review.
- Aligned README, pitch, Anthropic partner strategy, outreach targets, cold outreach, LinkedIn, Reddit, and X assets to the same workflow-hardening story.
- Added regression coverage so the public and sales surfaces do not drift back to generic AI-employee or infrastructure-first language.

Commands run:

```bash
npm ci
node --test tests/public-landing.test.js tests/api-server.test.js tests/social-marketing-assets.test.js tests/version-metadata.test.js tests/anthropic-partner-strategy.test.js tests/workflow-hardening-sprint.test.js
npm test
npm run test:coverage
THUMBGATE_PROOF_DIR=/tmp/thumbgate-workflow-hardening-20260317T133407/proof/compatibility npm run prove:adapters
THUMBGATE_AUTOMATION_PROOF_DIR=/tmp/thumbgate-workflow-hardening-20260317T133407/proof/automation npm run prove:automation
npm run self-heal:check
```

Observed results:

- Targeted GTM regression suite: `58` pass, `0` fail.
- `npm test`: pass.
- `npm run test:coverage`: pass with Node test runner coverage summary:
  - line coverage: `84.39%`
  - branch coverage: `70.73%`
  - function coverage: `87.26%`
- `npm run prove:adapters`: pass with `46` passed, `0` failed.
- `npm run prove:automation`: pass with `55` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.
- Proof artifacts for adapter and automation verification were redirected to `/tmp/thumbgate-workflow-hardening-20260317T133407/proof` so the clean worktree did not churn tracked `proof/` artifacts.

Behavioral proof points:

- `public/index.html` now sells the Workflow Hardening Sprint first, keeps Pro truthful and secondary, exposes a proof CTA, and adds Sprint FAQ/schema support without fake partner claims.
- `docs/WORKFLOW_HARDENING_SPRINT.md` now defines the actual service offer, qualification rules, deliverables, contact path, and proof-pack requirement.
- `docs/PITCH.md`, `docs/ANTHROPIC_MARKETPLACE_STRATEGY.md`, `docs/OUTREACH_TARGETS.md`, and `docs/marketing/cold-outreach-sequence.md` now align on the same 30-day revenue motion: founder-led outbound, one workflow, one owner, one proof review.
- `docs/marketing/social-posts.md`, `docs/marketing/linkedin-ai-reliability-post.md`, `docs/marketing/reddit-posts.md`, and `docs/marketing/x-launch-thread.md` now frame the product as workflow hardening instead of generic AI-employee hype.
- `tests/public-landing.test.js`, `tests/api-server.test.js`, `tests/social-marketing-assets.test.js`, `tests/version-metadata.test.js`, `tests/anthropic-partner-strategy.test.js`, and `tests/workflow-hardening-sprint.test.js` now guard the new commercial story against future drift.

Artifacts updated:

- `README.md`
- `docs/WORKFLOW_HARDENING_SPRINT.md`
- `docs/PITCH.md`
- `docs/ANTHROPIC_MARKETPLACE_STRATEGY.md`
- `docs/OUTREACH_TARGETS.md`
- `docs/marketing/cold-outreach-sequence.md`
- `docs/marketing/social-posts.md`
- `docs/marketing/linkedin-ai-reliability-post.md`
- `docs/marketing/reddit-posts.md`
- `docs/marketing/x-launch-thread.md`
- `public/index.html`

## 2026-03-17 Self-Heal Proof Isolation Verification

Scope:

- Fixed `scripts/self-healing-check.js` so proof-bearing health checks run with an isolated temporary `THUMBGATE_PROOF_DIR`.
- Prevented `self-heal:check` from failing on clean merge commits due to shared tracked `proof/` artifacts instead of real behavioral regressions.
- Added regression coverage to prove the health checker both injects and cleans temporary proof directories.

Commands run:

```bash
git diff --check
node --test tests/self-healing-check.test.js
npm ci
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed results:

- `git diff --check`: completed cleanly.
- `node --test tests/self-healing-check.test.js`: `14` passed, `0` failed.
- `npm ci`: completed successfully; `audited 151 packages` and `found 0 vulnerabilities`.
- `npm test`: passed.
- `npm run test:coverage`: `1100` tests, `1099` passed, `0` failed, `1` skipped; coverage `84.40%` lines, `70.77%` branches, `87.18%` functions.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `46` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `55` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Behavioral proof points:

- `DEFAULT_CHECKS` now marks both `prove_adapters` and `prove_automation` for proof-directory isolation.
- `collectHealthReport` provisions a temp `THUMBGATE_PROOF_DIR` per proof check and removes it after execution.
- The repaired `self-heal:check` now stays healthy under the same heavy `tests + prove_*` workload that failed on merge commit `9b5f5a1`.

Artifacts updated:

- `docs/VERIFICATION_EVIDENCE.md`

## 2026-03-17 Growth Observability + Tracking Readiness Verification

Scope:

- Tighten the public category from generic memory phrasing to an AI reliability system for one sharp agent.
- Add optional GA4 and Google Search Console support alongside the existing Plausible + first-party telemetry stack.
- Auto-record SEO landing views from organic and AI-search referrers.
- Surface instrumentation readiness directly in the dashboard so traffic, funnel, revenue, and attribution gaps are explicit.

Commands run in the implementation worktree:

```bash
npm ci
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed results:

- `npm ci`: passed, `150` packages installed, `0` vulnerabilities.
- `npm test`: passed on `feat/growth-observability`.
- `npm run test:coverage`: passed with overall coverage `84.37%` lines / `70.58%` branches / `87.17%` functions.
- `npm run prove:adapters`: passed, `46/46`.
- `npm run prove:automation`: passed, `55/55`.
- `npm run self-heal:check`: `Overall: HEALTHY`, `4/4` healthy.
- `git diff --check`: clean before commit.

Behavioral proof points:

- The landing page keeps Plausible and first-party telemetry, and now injects GA4 and Search Console only when explicit env vars are set.
- Search and AI-search referrers now produce `seo_landing_view` telemetry instead of hiding in generic landing-page traffic.
- The dashboard now reports whether traffic analytics, SEO verification, buyer-loss capture, and revenue attribution are configured and actually receiving events.
- Public and active product copy now lead with AI reliability without orchestration tax instead of drifting back toward generic memory-layer framing.

## 2026-03-17 Claude Workflow Hardening GTM Verification

Scope:

- Repositioned the public landing page around Claude workflow hardening, code modernization, and consultancy/platform-team use cases while keeping the no-orchestration-tax core message intact.
- Added a proof-forward hero CTA and explicit proof-pack link to `VERIFICATION_EVIDENCE.md`.
- Rewrote `docs/ANTHROPIC_MARKETPLACE_STRATEGY.md` as the current Anthropic partner strategy for Claude workflow hardening with packaged offers, buyer story, proof-pack rules, and claim hygiene.
- Updated `docs/marketing/x-launch-thread.md` to a role-based workflow-hardening thread aligned with the public landing message.
- Added regression coverage for the new partner strategy, landing copy, API root rendering, social-marketing messaging, and version-metadata expectations.

Commands run:

```bash
npm ci
node --test tests/public-landing.test.js tests/api-server.test.js tests/anthropic-partner-strategy.test.js
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed results:

- Targeted partner/landing/API tests: pass (`43` pass, `0` fail).
- `npm test`: pass.
- `npm run test:coverage`: pass with overall coverage:
  - line coverage: `84.35%`
  - branch coverage: `70.74%`
  - function coverage: `87.14%`
- `npm run prove:adapters`: pass with `46` pass, `0` fail.
- `npm run prove:automation`: pass with `55` pass, `0` fail.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Behavioral proof points:

- `public/index.html` now sells the product as Claude workflow hardening with seven concrete buyer/use-case cards, three packaged offers, and a proof-pack CTA instead of generic continuity-only framing.
- `public/index.html` preserves `SoftwareApplication` and `FAQPage` JSON-LD while adding consultancy/code-modernization FAQ coverage and keeping the no-orchestration-tax contract intact.
- `docs/ANTHROPIC_MARKETPLACE_STRATEGY.md` is now a current-state partner strategy doc, not a stale historical note, and explicitly forbids false partner-membership claims while linking commercial truth and proof.
- `docs/marketing/x-launch-thread.md` now aligns the social message with workflow hardening and code modernization instead of generic "AI employee" hype.
- `tests/public-landing.test.js`, `tests/api-server.test.js`, `tests/anthropic-partner-strategy.test.js`, `tests/social-marketing-assets.test.js`, and `tests/version-metadata.test.js` enforce the new GTM messaging and claim-hygiene contracts.
## 2026-03-17 AI Reliability Social Asset Verification

Scope:

- Repositioned the active social launch copy from a generic memory tool toward an AI reliability system for coding agents.
- Added a canonical operator kit for LinkedIn, X, and Reddit under `docs/marketing/`.
- Added local/private SVG source assets for a six-slide LinkedIn carousel and an X summary card under `docs/marketing/assets/`.
- Added a regression test to keep the new positioning and asset inventory from drifting.

Commands run:

```bash
node --test tests/social-marketing-assets.test.js
npm run test:workflow
git diff --check
```

Observed results:

- `tests/social-marketing-assets.test.js`: pass
- `npm run test:workflow`: pass
- `git diff --check`: clean

Behavioral proof points:

- `docs/marketing/social-posts.md` is now the canonical social launch kit and points to current LinkedIn, X, and Reddit assets instead of older memory-first launch copy.
- `docs/marketing/linkedin-ai-reliability-post.md` contains the current long-form founder post plus the six-slide carousel script and first-comment CTA.
- `docs/marketing/x-launch-thread.md` contains the current nine-post thread focused on reliability, not just memory.
- `docs/marketing/reddit-posts.md` contains the current `r/ClaudeCode` post plus a showcase-safe `r/ClaudeAI` variant.
- `docs/marketing/assets/` contains local/private export-ready SVG assets for LinkedIn and X, avoiding shared-workspace dependency for final posting assets.

## 2026-03-17 Reliability-Without-Orchestration Positioning Verification

Scope:

- Repositioned the public landing page and package metadata around reliability without orchestration or subagent handoff overhead.
- Added explicit FAQ and hero copy that keeps one sharp agent as the primary product story.
- Tightened the continuity guide so it clearly frames the Gateway as the downstream reliability layer, not another planner or swarm.
- Added a positioning contract test so README, package metadata, guide copy, and landing-page assertions cannot drift back to generic memory-layer messaging.

Commands run:

```bash
node --test tests/public-landing.test.js tests/positioning-contract.test.js
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
npm run test:workflow
git diff --check
```

Observed results:

- `tests/public-landing.test.js`: pass
- `tests/positioning-contract.test.js`: pass
- `npm test`: pass
- `npm run test:coverage`: pass
  - `1094` tests, `1093` passed, `0` failed, `1` skipped
  - coverage `84.39%` lines, `70.80%` branches, `87.14%` functions
- `npm run prove:adapters`: pass, `46/46`
- `npm run prove:automation`: pass, `55/55`
- `npm run self-heal:check`: `Overall: HEALTHY`, `4/4 healthy`
- `npm run test:workflow`: pass
- `git diff --check`: clean

Behavioral proof points:

- `public/index.html` now promises `Keep one sharp agent` and explicitly says the Gateway works without another orchestration layer or subagent handoff tax.
- `public/index.html` FAQ now answers whether subagents or orchestration are required and states that the product is meant to keep one sharp agent on task.
- `README.md` now leads with `Local-first reliability layer for AI coding agents` instead of generic context-and-memory phrasing.
- `package.json` now carries reliability-over-orchestration positioning into npm and marketplace metadata.
- `docs/guides/continuity-tools-integration.md` now documents the recommended split: continuity upstream, one base agent doing the work, Gateway downstream as the reliability layer.
- `docs/marketing/LAUNCH_CONTENT.md` now aligns older launch variants with the reliability-without-orchestration story instead of stale persistent-memory-first copy.
- `tests/positioning-contract.test.js` now guards the launch-content variants as well, so active GTM docs cannot silently drift back to memory-layer messaging.

## March 17, 2026: Cursor Marketplace packaging

Scope:

- Added a repo-root Cursor marketplace manifest at `.cursor-plugin/marketplace.json`.
- Added a dedicated Cursor plugin bundle in `plugins/cursor-marketplace/` with `.cursor-plugin/plugin.json`, `.mcp.json`, README, and committed logo asset.
- Switched the Cursor launcher to the portable published package entrypoint `npx -y thumbgate@1.5.8 serve` instead of any checkout-local absolute path.
- Removed the stale `.mcp.json.plugin` legacy config file so the repo has one canonical Cursor packaging path.
- Extended `scripts/sync-version.js` so Cursor manifests and all pinned launcher docs stay version-synced on future releases.
- Added regression coverage for the repo-level marketplace contract, manifest/version consistency, and MCP launcher safety.

Commands run in the dedicated worktree at `/private/tmp/thumbgate-cursor-marketplace-20260317T074440Z`:

```bash
npm ci
npm --prefix workers ci
node scripts/sync-version.js --check
node --test tests/adapters.test.js tests/version-metadata.test.js tests/cursor-plugin.test.js
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
git diff --check
```

Observed result:

- `npm ci` completed with `0` vulnerabilities.
- `npm --prefix workers ci` completed with `0` vulnerabilities.
- `node scripts/sync-version.js --check`: `✔ All 16 targets in sync at v0.7.1`.
- Targeted Cursor packaging regressions passed: `18` tests passed, `0` failed.
- `npm test` passed end-to-end on the Cursor marketplace branch.
- `npm run test:coverage` passed with all-files coverage of `83.92%` lines, `70.52%` branches, and `86.81%` functions.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `46` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `47` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.
- `git diff --check` completed cleanly.

Requirements verified:

- The Cursor marketplace root manifest resolves to a valid repo-relative plugin directory.
- The Cursor marketplace manifest, Cursor plugin manifest, Claude plugin manifest, and package version remain synchronized.
- The Cursor plugin launcher uses the published npm package and does not hardcode `/Users/...` checkout paths.
- The multi-plugin marketplace contract is internally consistent: the marketplace entry name matches the plugin manifest name.
- Version-sync automation now owns the pinned Cursor launcher docs instead of leaving release drift behind.

## 2026-03-13 Truthful Revenue Analytics Verification

Scope:

- Added a dedicated revenue ledger to separate booked revenue from generic paid-stage funnel telemetry.
- Preserved honest provider coverage: Stripe records booked revenue; GitHub Marketplace records paid orders by default and records booked revenue when the webhook payload carries plan pricing or plan pricing is explicitly configured.
- Threaded attribution metadata (`source`, UTM fields, referrer, landing path, CTA id) through public checkout creation, funnel events, revenue events, API summaries, CLI CFO output, and the hosted landing page.
- Replaced hardcoded marketing proof-strip vanity numbers with stable evidence-backed claims on the public landing page.

Commands run:

```bash
npm ci
env THUMBGATE_API_KEY=test-api-key node --test tests/billing.test.js tests/api-server.test.js tests/github-billing.test.js tests/cli.test.js tests/stripe-webhook-route.test.js
env THUMBGATE_API_KEY=test-api-key node --test tests/openapi-parity.test.js tests/adapters.test.js tests/commerce-quality.test.js
env THUMBGATE_API_KEY=ci-secret npm test
env THUMBGATE_API_KEY=ci-secret npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed results:

- `npm ci`: completed successfully; `audited 151 packages` and `found 0 vulnerabilities`.
- Targeted changed-surface suite: `76 passed`, `0 failed`.
- OpenAPI / adapter / commerce suite: `27 passed`, `0 failed`.
- `npm test`: completed successfully across schema, loop, API, proof, E2E, billing, CLI, watcher, workflow, autoresearch, gates, and hardening phases.
- `npm run test:coverage`: `971 passed`, `0 failed`, `1 skipped`; coverage `82.59%` lines, `68.77%` branches, `85.37%` functions.
- `npm run prove:adapters`: `38 passed`, `0 failed`.
- `npm run prove:automation`: `37 passed`, `0 failed`.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4 healthy` checks.

Behavioral proof points:

- `scripts/billing.js` now emits `bookedRevenueCents`, `paidOrders`, `amountKnownCoverageRate`, `unreconciledPaidEvents`, and attribution breakdowns from a dedicated revenue ledger instead of inferring money from stage counts.
- `tests/billing.test.js` proves Stripe booked revenue is summarized truthfully and GitHub Marketplace becomes amount-known when webhook plan pricing is present or explicit plan pricing is configured.
- `tests/api-server.test.js` proves checkout attribution survives the API path and shows up in the admin billing summary.
- `tests/cli.test.js` proves `node bin/cli.js cfo` emits the richer revenue + attribution summary shape.
- `tests/github-billing.test.js` proves GitHub Marketplace purchase events create paid-order records and promote to booked revenue when webhook pricing or plan-pricing config is present.
- `tests/openapi-parity.test.js` and `tests/adapters.test.js` prove the machine-readable adapter surface stayed in sync after the summary shape expansion.

Artifacts updated:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`

## 2026-03-09 Local Intelligence Verification

Scope:

- Hardware-aware local embedding profile selection with machine-readable fit evidence.
- Safe fallback embedding profile selection when the primary local profile fails.
- Boosted local risk scorer trained from ThumbGate feedback sequences.
- CLI surface for `model-fit`, `risk`, and `prove --target=local-intelligence`.

Commands run:

```bash
npm ci
node --test tests/cli.test.js
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run prove:local-intelligence
npm run self-heal:check
```

Observed results:

- `node --test tests/cli.test.js`: `20` passed, `0` failed.
- `npm test`: all suites pass, including:
  - `tests/local-model-profile.test.js`
  - `tests/risk-scorer.test.js`
  - `tests/vector-store.test.js`
  - `tests/feedback-sequences.test.js`
  - `tests/feedback-loop.test.js`
  - `tests/prove-local-intelligence.test.js`
- `npm run test:coverage`: pass with overall coverage `82.86%` lines, `68.01%` branches, `86.00%` functions.
- `npm run prove:adapters`: `{ "passed": 21, "failed": 0 }`
- `npm run prove:automation`: `{ "passed": 14, "failed": 0 }`
- `npm run prove:local-intelligence`: `Status: PASSED`
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Behavioral proof points:

- `FIT-01`: low-RAM override selects the `compact` embedding profile and writes `model-fit-report.json`.
- `FIT-02`: `vector-store` falls back to the safe embedding profile when the primary profile load fails.
- `RISK-01`: feedback capture flow trains and persists `risk-model.json` from sequence data.
- `RISK-02`: analytics expose boosted risk summary with `exampleCount=6`, `mode=boosted`, and top high-risk domain `testing`.

Artifacts updated:

- `proof/local-intelligence-report.json`
- `proof/local-intelligence-report.md`

## 2026-03-17 Reddit GTM Attribution Verification

Scope:

- Added first-party Reddit campaign attribution across the live landing page, hosted checkout bootstrap, fallback checkout URLs, billing funnel events, and telemetry analytics.
- Preserved semantic SEO/GEO structure while introducing Reddit-specific campaign messaging and subreddit-aware attribution logic on the public landing page.
- Added operator documentation for Reddit distribution in `docs/REDDIT_GTM_PLAYBOOK.md`.
- Expanded business analytics so Reddit community, post, comment, campaign-variant, and offer-code performance can be measured end-to-end instead of inferred from raw visit counts.

Commands run:

```bash
git diff --check
npm ci
node --test tests/telemetry-analytics.test.js
node --test tests/public-landing.test.js
node --test tests/billing.test.js
node --test --test-concurrency=1 tests/api-server.test.js
node --test tests/dashboard.test.js
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed results:

- `git diff --check`: completed cleanly.
- `npm ci`: completed successfully; `audited 151 packages` and `found 0 vulnerabilities`.
- Targeted changed-surface tests:
  - `tests/telemetry-analytics.test.js`: passed.
  - `tests/public-landing.test.js`: passed.
  - `tests/billing.test.js`: passed.
  - `tests/api-server.test.js`: passed.
  - `tests/dashboard.test.js`: passed.
- `npm test`: `1070` tests, `1069` passed, `0` failed, `1` skipped.
- `npm run test:coverage`: `1070` tests, `1069` passed, `0` failed, `1` skipped; coverage `84.14%` lines, `70.74%` branches, `86.83%` functions.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `46` passed, `0` failed.
- `env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `47` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Behavioral proof points:

- `public/index.html` now classifies Reddit-origin traffic, preserves `community`, `postId`, `commentId`, `campaignVariant`, and `offerCode`, shows a Reddit campaign banner, and pushes first-party `landing_page_view` telemetry before checkout.
- `src/api/server.js` now threads Reddit attribution through `/checkout/pro`, `/v1/billing/checkout`, checkout bootstrap telemetry, and hosted success/cancel return URLs without overwriting Stripe checkout `session_id`; visitor-session state is preserved separately via `visitor_session_id`.
- `scripts/telemetry-analytics.js` now reports `byCommunity`, `byOfferCode`, `byCampaignVariant`, `topCommunity`, `topOfferCode`, and `topCampaignVariant` for page views and CTA events.
- `scripts/billing.js` now reports acquisition, signup, paid, revenue, and conversion breakdowns by Reddit community, post, comment, campaign variant, and offer code, making first-dollar attribution measurable at the business layer.
- `tests/public-landing.test.js`, `tests/api-server.test.js`, `tests/billing.test.js`, and `tests/telemetry-analytics.test.js` prove the end-to-end Reddit attribution contract from landing click through checkout and analytics summaries.

Artifacts updated:

- `docs/REDDIT_GTM_PLAYBOOK.md`

## 2026-03-17 Agent Readiness Diagnostics Verification

Scope:

- Added `scripts/agent-readiness.js` to audit runtime isolation, bootstrap context, and MCP permission tiers.
- Added `doctor` CLI support in `bin/cli.js`.
- Surfaced readiness data in `scripts/dashboard.js`.
- Added context-pack visibility metadata in `scripts/contextfs.js`.
- Hardened memex indexing so `constructMemexPack()` preserves namespace-aware results.
- Fixed the coverage teardown race in `tests/delegation-runtime.test.js`.

Commands run:

```bash
npm ci
npm test
npm run test:coverage
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env THUMBGATE_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed results:

- `npm ci`: passed, `0` vulnerabilities.
- `npm test`: passed.
- `npm run test:coverage`: passed with Node test runner coverage summary:
  - line coverage: `90.25%`
  - branch coverage: `76.67%`
  - function coverage: `93.68%`
- `npm run prove:adapters`: passed with `46 passed`, `0 failed`.
- `npm run prove:automation`: passed with `55 passed`, `0 failed`.
- `self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Behavioral proof points:

- `doctor --json` reports `overallStatus`, runtime mode, bootstrap readiness, MCP tier, and article-alignment flags.
- `generateDashboard()` exposes readiness truth instead of guessing bootstrap state; the dashboard reflects the repo's actual `.mcp.json` presence.
- `constructContextPack()` and `constructMemexPack()` expose visibility metadata including hidden candidate counts, char-budget hits, and visible titles.
- Memex pack construction no longer drops relevant entries because namespace metadata is preserved in indexed documents and recovered from `stableRef` when needed.

Artifacts updated:

- `README.md`
- `bin/cli.js`
- `scripts/agent-readiness.js`
- `scripts/contextfs.js`
- `scripts/dashboard.js`
- `tests/agent-readiness.test.js`
- `tests/cli.test.js`
- `tests/contextfs.test.js`
- `tests/dashboard.test.js`
- `tests/delegation-runtime.test.js`

## 2026-03-09 Technical Debt Audit Cleanup Verification

Scope:

- Added a portable `npm run test:coverage` command using Node's built-in coverage for `tests/**/*.test.js`.
- Removed the unused `stripe` SDK dependency; billing continues to use direct HTTPS calls in `scripts/billing.js`.
- Synced published version metadata across MCP manifests and public docs to `0.7.1`.
- Refreshed active proof artifacts and pruned stale milestone-era proof files that were no longer referenced.

Commands run:

```bash
npm uninstall stripe
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
node scripts/self-healing-check.js --json > proof/automation/self-healing-health.json
node scripts/self-heal.js --reason=manual > proof/automation/self-heal-run.json
```

Observed results:

- `npm test`: pass.
- `npm run test:coverage`: pass with Node test runner coverage summary:
  - line coverage: `81.61%`
  - branch coverage: `67.06%`
  - function coverage: `83.76%`
- `npm run prove:adapters`: pass with `21 passed`, `0 failed`.
- `npm run prove:automation`: pass with `14 passed`, `0 failed`.
- `self-healing-check`: `Overall: HEALTHY` with `4/4` healthy checks.
- `self-heal:run`: `healthy: true`, no failing fix steps.

Coverage caveat:

- `npm run test:coverage` measures `tests/**/*.test.js`.
- The inline script phases in `test:schema`, `test:loop`, and `test:dpo` still run in CI via `npm test`, but they are not yet folded into the single coverage percentage.

Artifacts updated:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`
- `proof/automation/self-healing-health.json`
- `proof/automation/self-heal-run.json`

Cross-project Codex startup proof:

```bash
cd /Users/ganapolsky_i/workspace/git/igor/trading
codex exec "Print OK only" --skip-git-repo-check
```

Observed result:

- MCP startup reports `ready: thumbgate, sentry, github, context7, playwright`
- No `thumbgate` timeout and no MCP handshake error
- Command completed with output `OK`

## 2026-03-06 Revenue Funnel + Billing Hardening Verification

Scope:

- Public top-of-funnel checkout endpoint (`POST /v1/billing/checkout`) with install correlation metadata.
- Append-only funnel telemetry ledger with acquisition/activation/paid stages.
- Admin boundary hardening: billing API keys cannot call admin provision endpoint.
- Funnel analytics endpoint (`GET /v1/analytics/funnel`) for conversion evidence.
- CLI install correlation (`installId`) persisted and linked to acquisition events.

Commands run:

```bash
npm run feedback:summary
npm run feedback:rules
npm run self-heal:check
npm test
npm run prove:adapters
npm run prove:automation
```

Observed results:

- `self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.
- `npm test`: all suites pass; key monetization checks verified in:
  - `tests/api-server.test.js`
  - `tests/billing.test.js`
  - `tests/cli.test.js`
  - `tests/openapi-parity.test.js`
- `npm run prove:adapters`: `{ "passed": 21, "failed": 0 }`
- `npm run prove:automation`: `{ "passed": 14, "failed": 0 }`

Behavioral proof points:

- Public checkout succeeds without bearer auth and emits acquisition event.
- First authenticated billing-key usage emits exactly one activation event.
- Stripe and GitHub billing flows emit paid-stage funnel events.
- Static admin token is required for `POST /v1/billing/provision`; billing keys receive `403`.
- OpenAPI canonical + ChatGPT adapter include billing and funnel analytics routes with parity checks.

Artifacts updated:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`
