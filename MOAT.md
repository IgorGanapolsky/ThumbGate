# ThumbGate Moat

> **Update 2026-07-09:** the commercialization decision now lives in [`docs/COMMERCIALIZATION_STRATEGY.md`](docs/COMMERCIALIZATION_STRATEGY.md) — **open-core: free permissive runtime as the adoption wedge, valuable intelligence (learned models + exporters + hosted) behind a real paywall.** That doc supersedes this one where they conflict. This audit's core finding still holds: the moat is data + hosted state + adapter breadth, **not** hidden code — so we protect the valuable parts with entitlement + server-side execution, not by relicensing (see the strategy doc for why relicensing now is premature).

Plain-language statement of where ThumbGate's defensibility actually lives, written 2026-05-18 after a strict audit of the public/private repo split.

## The moat is *not* closed-source intelligence

The previous CLAUDE.md described a two-repo product: a thin public shell and a private `ThumbGate-Core` repo holding "ranking, synthesis, policy, billing intelligence." That description does not match reality:

- Public repo `scripts/`: **412 files**
- Private `ThumbGate-Core/scripts/`: 216 files
- Scripts present in both: **212** (98 % of Core)
- Scripts only in private Core: **4** (`hook-rlhf-cache-updater.js`, `hook-verify-before-done.sh`, `prove-subway-upgrades.js`, `rlhf-search.js`)

Everything materially load-bearing — Thompson Sampling adaptive gating, lesson DB internals, reward functions, RLAIF audit, the auto-promotion algorithm, vector store, semantic dedup, multi-agent supervisor loops — ships in the public npm bundle. A competitor running `npm pack thumbgate` gets 98 % of Core in 30 seconds.

Pretending otherwise produces two failure modes:
1. **Pricing-page incoherence** — "Why pay $19/mo when `npm install thumbgate` gives me everything?" is a legitimate question we cannot answer with a straight face.
2. **Wasted engineering** — debating the public/private boundary on every new feature, when the boundary doesn't exist in practice.

## What the moat actually is

Four real defensibility surfaces, in descending order of leverage:

### 1. Hosted infrastructure + reliability operator

The npm package gives you the gate runtime. **Operating it well** — keeping the SQLite DB intact across upgrades, syncing rules across machines, running the dashboard, rotating embeddings cleanly, fixing SonarCloud regressions in 24 hours — is the work the customer is buying back from us. The Railway deployment + 24×7 ownership is the durable surface.

### 2. Pre-built rule library + adapter compatibility matrix

Customers pay for a curated set of prevention rules that already work against Claude Code, Cursor, Codex, Gemini, Amp, Cline, and OpenCode — across version drift, hook-API breaking changes, and provider-specific quirks. Maintaining that matrix is full-time work. Cloning the npm package gives you a runtime; cloning our adapter matrix takes a team a quarter.

### 3. The dashboard + DPO export pipeline

The Pro / Team-tier dashboard, lesson search UI, DPO preference-pair export, model hardening advisor, and HuggingFace dataset export are gated behind an API key the customer holds. The code that *generates* these is open. The hosted instance with their data + the export-ready format is what they pay for.

### 4. Support + workflow hardening expertise

`$499` diagnostic, `$1,500` sprint, `$3,997` setup. None of this scales like SaaS; all of it is the kind of high-touch revenue that funds product work in the early stage. The product knowledge required to land a sprint is real and is not in the public repo.

## What this means for engineering

- **Public code is permissive on purpose.** New intelligence features land in the public repo by default. The bundle-ratchet test (`tests/public-bundle-ratchet.test.js`) prevents *accidental* growth, but the bias is permissive.
- **`ThumbGate-Core` is now used only for** (a) the 4 RLHF/cache scripts that genuinely cannot be public and (b) staging of features before public release. It is not the moat surface.
- **The public/private boundary tests** (`tests/public-core-boundary.test.js`) stay green; they test that the *public CI* doesn't require Core, which is still a real correctness property.

## What this means for pricing copy

The `/pricing` page should explain what the subscription buys in terms of **hosted state + adapter coverage + support**, not "private features you can't see." See PR #2116 — the SaaS-first restructure already moves in this direction.

## How to re-evaluate this

If someone forks ThumbGate and ships a hosted competitor that gets traction, the moat assumption is wrong and we revisit. Until then: hosted-services moat, permissive public code, no theater.
