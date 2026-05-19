---
"thumbgate": minor
---

Add `/policy-vault` ICP landing page mapping ThumbGate to the emerging vault-layer / policy-aware enforcement category, and document ThumbGate's grep-style FTS5 default in `llm-context.md` against the May 2026 Sen et al. arXiv result (*Is Grep All You Need?*).

**Why now.** Three external signals converging in May 2026 point at the same category: the vault-layer playbook for AI agent governance is taking shape, the validating research is landing (grep beats vector for agentic memory across major harnesses), and enterprise architects are framing the shift to long-running autonomous agents as a runtime story. ThumbGate sits exactly in the middle of this — at the tool-call boundary with deterministic policy enforcement and an FTS5 grep-style lesson DB. This PR claims the positioning before the category gets named after someone else's product.

**Changes:**
- `public/policy-vault.html` — new ICP landing page modeled on `/agent-manager`, `/evals`, `/long-running-agents`. Maps the eight canonical vault-layer prescriptions to ThumbGate's surface area with three honest verdicts: Covered (6 prescriptions), Partial (1: chain-level enforcement is Team-tier approval boundaries, not yet auto-derived from a tool graph), Out of scope (1: short-lived credential minting belongs to HashiCorp Vault / AWS STS / GCP STS, not us). JSON-LD `TechArticle` with `about[]: AI agent policy vault / ABAC / PBAC for AI agents / Tool-call boundary enforcement / Identity-aware AI agent governance`.
- `src/api/server.js` — dedicated `/policy-vault` + `/policy-vault.html` route via `servePublicMarketingPage` with `extraTelemetry: { pageType: 'policy_vault' }`. Sitemap entry at priority 0.9.
- `package.json` `files[]` — page added to npm bundle. New script `test:policy-vault` wired into the chain.
- `tests/policy-vault.test.js` — 5 route-handler tests (200 + prescription table + honest boundary + JSON-LD, alias parity, HEAD, pageType telemetry, UTM attribution). All green.
- `public/llm-context.md` — two new sections so AI crawlers pick up the positioning: (a) "Why ThumbGate Uses Grep-Style Full-Text Search By Default, Not Vector Search" citing arXiv:2605.15184 (Sen et al., May 2026) with the LongMemEval-S benchmark result that validates SQLite + FTS5 over vector for agentic memory; (b) "ThumbGate as the AI Agent Policy Vault Layer" listing the eight prescriptions inline so any LLM crawler retrieving the canonical context document sees the mapping without a second hop. Honesty preserved: prescription 5 is explicitly named out of scope.
- `tests/public-bundle-ratchet.test.js` + `tests/package-boundary.test.js` — ceiling 254 → 255, comment blocks explain the single-file additive.

**What this PR does NOT do:**
- Does not name competitors. The page maps prescriptions to ThumbGate's surface area, period.
- Does not over-claim. Prescriptions 5 (credential minting) and 7 (chain-level enforcement) are surfaced with honest verdicts: Out of scope and Partial, respectively. Buyers know exactly what to expect.
- Does not add new dependencies, change pricing, or alter any existing route.

**Verified locally (origin/main bf964cff base):**
- `tests/policy-vault` 5/5
- `test:public-bundle-ratchet` 2/2
- `tests/package-boundary` 4/4
- `test:public-package-parity` 5/5
- `tests/test-suite-parity` 5/5
- `test:landing-page-claims` 23/23
- `test:public-static-assets` 14/14
- Local fetch: `/policy-vault` 200, prescription table + honest boundary both present.

Worktree-isolated to avoid sibling-agent branch contamination observed in prior PRs.
