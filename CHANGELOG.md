# Changelog

## 1.12.1

### Patch Changes

- [#990](https://github.com/IgorGanapolsky/ThumbGate/pull/990) [`6698e44`](https://github.com/IgorGanapolsky/ThumbGate/commit/6698e449d4e234b22bd6c772eba70b090237c5ce) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a structural local-only gate that blocks remote git, PR, release, and publish actions before configurable gate evaluation.

  Update published Claude Code MCP installers to resolve `thumbgate@latest` without reusing stale installed runtime binaries.

- [#980](https://github.com/IgorGanapolsky/ThumbGate/pull/980) [`81f81b4`](https://github.com/IgorGanapolsky/ThumbGate/commit/81f81b48a5cc3bfc66bd91e576c3f34fad7e86db) Thanks [@dependabot](https://github.com/apps/dependabot)! - Add the release note required for the `@anthropic-ai/sdk` 0.90.0 dependency bump so manifest-only Dependabot updates pass ThumbGate's release hygiene checks.

## 1.12.0

### Minor Changes

- [#991](https://github.com/IgorGanapolsky/ThumbGate/pull/991) [`f6525ef`](https://github.com/IgorGanapolsky/ThumbGate/commit/f6525efb73d1dc05682c06ef3b1f642132c67ca2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Drop X/Twitter from the active distribution loop and consolidate on six focus channels: Reddit, LinkedIn, Threads, Bluesky, Instagram, YouTube. `scripts/post-everywhere.js` now exports a frozen `DEFAULT_PLATFORMS` list with dispatchers for each channel; Threads and Bluesky route through the Zernio aggregator. Marketing-autopilot, reply-monitor, weekly-social-post, Ralph mode/loop, social-engagement-hourly, GTM autonomous loop, daily revenue loop, and social-analytics workflows no longer reference X/Twitter secrets or fallback posters. `tests/post-everywhere-channels.test.js` pins the new focus list and rejects X/Twitter regressions. Legacy `scripts/post-to-x*.js` modules remain on disk for manual ad-hoc use only.

## 1.11.1

### Patch Changes

- [#993](https://github.com/IgorGanapolsky/ThumbGate/pull/993) [`e2a1af1`](https://github.com/IgorGanapolsky/ThumbGate/commit/e2a1af1a296d62744eac746ca8acaba7cd8d1c94) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Repair stale Codex hook/statusline wiring automatically when the ThumbGate Codex MCP server starts, and cover the legacy two-hook config shape with regression tests.

- [#985](https://github.com/IgorGanapolsky/ThumbGate/pull/985) [`d11547a`](https://github.com/IgorGanapolsky/ThumbGate/commit/d11547a4393fc438ba1448561e560927f4ca530c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Automate Dependabot release hygiene by generating changesets for manifest-only dependency PRs and skipping branch-protection or SonarCloud checks that bot tokens cannot satisfy.

- [#976](https://github.com/IgorGanapolsky/ThumbGate/pull/976) [`0e3153a`](https://github.com/IgorGanapolsky/ThumbGate/commit/0e3153ad80cad311ecf7f810bba12c19ed946321) Thanks [@dependabot](https://github.com/apps/dependabot)! - Add the release note required for the `@changesets/cli` 2.31.0 dependency bump so manifest-only Dependabot updates pass ThumbGate's release hygiene checks.

## 1.11.0

### Minor Changes

- [#986](https://github.com/IgorGanapolsky/ThumbGate/pull/986) [`3b4dabf`](https://github.com/IgorGanapolsky/ThumbGate/commit/3b4dabfe777f0b034499609ced20c0eb98f7a362) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a context footprint optimizer for MCP agents, including a read-only `plan_context_footprint` tool and a public `.well-known/mcp/footprint.json` report that quantifies progressive schema-loading savings.

## 1.10.1

### Patch Changes

- [#961](https://github.com/IgorGanapolsky/ThumbGate/pull/961) [`7149291`](https://github.com/IgorGanapolsky/ThumbGate/commit/714929162a9a2886f6df3a8c9c977596e7f8a6b1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix mailer sender-DNS regex to match Resend's actual SES MX host (`amazonses.com`, not `amazonaws.com`), and add granular unit tests for `hasResendSenderDns`, `resolveSenderAddress`, `recordsHaveResendDns`, and the 10-minute `senderDnsCache` TTL. The regex bug meant the positive branch of sender-domain verification never matched in production — every send through a custom domain fell back to `onboarding@resend.dev` even after DNS was correctly configured.

## 1.10.0

### Minor Changes

- [#963](https://github.com/IgorGanapolsky/ThumbGate/pull/963) [`289fc4f`](https://github.com/IgorGanapolsky/ThumbGate/commit/289fc4f27ce36ce7300381b65b39cd919c8fe002) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Bayes-optimal decision layer for the pre-tool-use gate. The legacy gate blocks when any matched lesson tag has a heuristic risk score ≥ a single global threshold — a "threshold-on-heuristic" rule that cannot express asymmetric misclassification costs (e.g., false-allowing a `deploy-prod`-tagged call is orders of magnitude more expensive than false-blocking a lint fix). The new layer computes `P(harmful | tags)` via a clipped Bayes-factor update over the trained scorer's probability and per-tag empirical risk rates, then picks the action that minimizes expected loss under a configurable loss matrix. The gate also now exposes a Bayes-error-rate metric (the irreducible floor of the current feature set) on `gate-stats` — a stopping rule for threshold tuning. The decision path is opt-in via `THUMBGATE_HOOKS_BAYES_OPTIMAL=1` or `bayesOptimalEnabled: true` in `config/enforcement.json`, and fails open back to the legacy rule on any error. Thompson Sampling gains an `argmaxPosteriors` + `pickBestCategory` exploit-mode counterpart to `samplePosteriors` for hot-path selection without exploration noise.

- [#960](https://github.com/IgorGanapolsky/ThumbGate/pull/960) [`b479da1`](https://github.com/IgorGanapolsky/ThumbGate/commit/b479da1964a32b461589be1d45c7d960e1dbe6c3) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add high-ROI MCP agent-discovery and research-loop surfaces.

  - Publish progressive MCP discovery manifests under `.well-known/mcp`, including a compact tool index, per-tool schema URLs, skill manifests, and application manifests so AI agents and crawlers can load ThumbGate without stuffing every tool into context.
  - Add `run_autoresearch` as a bounded MCP tool for Shopify-style baseline, hypothesis, holdout, and keep/discard loops around revenue and reliability metrics.
  - Add `plan_multimodal_retrieval` so operators can plan screenshot, PDF, dashboard, and proof-artifact retrieval using multimodal sentence-transformer guidance, Matryoshka-style dimensions, reranker metrics, and hard-negative holdouts before spending GPU time.

## 1.9.0

### Minor Changes

- [#957](https://github.com/IgorGanapolsky/ThumbGate/pull/957) [`68b3de3`](https://github.com/IgorGanapolsky/ThumbGate/commit/68b3de3c00ec861ee5709e5667535f6f6ddd2586) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Agentic-engineering Leader Agent endpoints: completion gate, swarm coordinator, and unified observability.

  Adds three MCP tools that lift ThumbGate from a bag of primitives into a Leader-Agent coordination layer (per the LangChain agentic-engineering framing — worker agents consume, leader endpoints coordinate and verify):

  - `require_evidence_for_claim` — completion gate. Wraps `verifyClaimEvidence` with a first-class `blocking` boolean and mode (`blocking` default, `advisory`). Records the decision to the audit trail under `gateId: completion_claim`. Agents call this before declaring done/fixed/shipped; hooks honor the blocking flag to stop evidence-free completion claims.
  - `distribute_context_to_agents` — swarm coordinator. Constructs one context pack via `constructContextPack` and records a `context_pack_distributed` provenance event per named agent (dedup'd, capped at `MAX_AGENTS=32`, TTL defaults to 15 minutes). Replaces N independent context derivations by auto-agents (perplexity-bug-resolver, codex-reviewer, grok-x-intelligence, etc.) with one shared pack.
  - `session_report` — unified observability rollup. Aggregates feedback stats, gate stats, and windowed provenance into a single LangSmith-style report. `windowHours` clamps to `[1, 720]`; invalid/missing input falls back to the 24h default. Errors in any section are isolated via a per-section `errors` map so one broken source doesn't sink the report.

  Exposed in `default`, `essential`, `readonly`, and `dispatch` MCP profiles. No OpenAPI surface changes (MCP-only). Ships with 24 new tests across `tests/swarm-coordinator.test.js`, `tests/session-report.test.js`, and `tests/require-evidence-gate.test.js`; regression runs clean across `test:api` (834), `test:gates` (198), `test:tool-registry` (11), `test:proof` (96), `test:deployment` (55), `test:e2e` (29), `test:workflow` (98), `test:schema` (8), and `test:mcp-config` (9).

### Patch Changes

- [#925](https://github.com/IgorGanapolsky/ThumbGate/pull/925) [`e0c89bc`](https://github.com/IgorGanapolsky/ThumbGate/commit/e0c89bc4015bf37e6eb23aefdc9146fde1858304) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump transitive dependency `protobufjs` from 7.5.4 to 7.5.5 (security/bugfix release). Lockfile-only change via Dependabot.

- [#947](https://github.com/IgorGanapolsky/ThumbGate/pull/947) [`b326963`](https://github.com/IgorGanapolsky/ThumbGate/commit/b3269631fcfdf2093a5c0a12ad6f331ce0b053b5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Mailer module now accepts `THUMBGATE_RESEND_API_KEY` as a fallback for the bare `RESEND_API_KEY`, matching the dual-read behavior already implemented in `scripts/billing.js`. Prevents a silent "skipped: no_api_key" regression if an operator sets only the prefixed variable name. Adds a positive unit test that sends with only the prefixed variant set.

- Fix repo bootstrap so worktree checkouts can create local MCP wiring and info exclude entries without failing on `.git` pointer files.

## 1.8.0

### Minor Changes

- [#954](https://github.com/IgorGanapolsky/ThumbGate/pull/954) [`d48608e`](https://github.com/IgorGanapolsky/ThumbGate/commit/d48608ea2f7956aa4d513878b8d5e7d82596f213) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Enforcement teeth: move ThumbGate's PreToolUse path from advisory to preventive.

  - `capture_feedback` now surfaces `correctiveActions` as a top-level `<system-reminder>` block in the MCP response (content[1]) alongside the JSON body (content[0]), so prior lessons reach the calling agent as first-class context instead of buried JSON.
  - Replaces the no-op `scripts/hook-verify-before-done.sh` with `scripts/hook-pre-tool-use.js` (matcher expanded to `Bash|Edit|Write`). The new hook: (1) preserves the existing curl-to-prod timestamp tracking; (2) calls `retrieveWithRerankingSync` against the about-to-run tool and injects matched lessons via `hookSpecificOutput.additionalContext`; (3) opt-in via `THUMBGATE_HOOKS_ENFORCE=1`, blocks tool calls with `decision:"block"` when a matched lesson carries a high-risk tag at/above threshold (default 5, configurable via `THUMBGATE_HOOKS_ENFORCE_THRESHOLD`); (4) opt-in via `THUMBGATE_AUTOGATE_PR_COMMITS=1`, auto-registers a `thread-resolution-verified` claim gate when `git commit` runs on a non-main branch.
  - `bin/cli.js session-start` now emits top ThumbGate hard-block rules and top high-risk tags as a structured `hookSpecificOutput.additionalContext` reminder (with stderr fallback for older Claude Code versions), so session start forces the agent to see current enforcement state rather than relying on opt-in `recall`.
  - Every enforcement path fails open: malformed hook stdin, missing risk model, or any uncaught exception in the hook exits 0 with no block, ensuring a bug never deadlocks the agent. Flags default to OFF so the first misfiring regex can be corrected in the same session that shipped it.

- Add a canonical autonomous control-plane workflow to ThumbGate itself.

  - Add `scripts/autonomous-workflow.js`, a durable `intent -> plan -> execute -> verify -> report` runner built on top of the existing async job runtime, workflow checkpoints, and proof-backed workflow logs.
  - Extend `scripts/workflow-gate-checkpoint.js` so checkpoints can persist workflow phase, status, plan, intent, evidence, report metadata, and merged workflow-level metadata across restarts.
  - Persist evidence-backed workflow artifacts under `.thumbgate/autonomous-workflows/<workflowId>/` and record proof-backed workflow runs only when verification accepts the output and artifacts exist.
  - Wire package scripts and package contents so the autonomous runner ships in the npm tarball and stays covered by high-ROI and workflow checkpoint tests.

### Patch Changes

- [#951](https://github.com/IgorGanapolsky/ThumbGate/pull/951) [`3270c2a`](https://github.com/IgorGanapolsky/ThumbGate/commit/3270c2ab90eb51a7a1f59df87dbdc8cb16172327) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Hard-enforce pre-tool prevention signals: matching high-risk boosted tags now block risky actions, PR-branch git commits register a required thread-resolution verification gate before the next unsafe tool call, and corrective actions surface as top-level reminders instead of being buried in JSON.

## 1.6.0

### Minor Changes

- [#931](https://github.com/IgorGanapolsky/ThumbGate/pull/931) [`8161e51`](https://github.com/IgorGanapolsky/ThumbGate/commit/8161e5130c8112447327689dcf00bf8a5f407026) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Replace the `👍👎` emoji header logo with a crisp teal-on-navy `TG` gate monogram across every customer-facing surface (landing page, dashboard, lessons, Pro, Learn hub, Learn articles, SEO-GSD generated pages, and the post-checkout Context Gateway Activated page). Ships `public/assets/brand/thumbgate-mark.svg`, refreshed checkout PNGs, `public/thumbgate-icon.png`, and `public/og.png`; wires `rel="icon"`, `apple-touch-icon`, and `og:image` tags on the main pages so tab icons, Stripe thumbnails, and link previews render the brand consistently instead of OS-dependent Unicode glyphs or the old chart-like mark. Hero-thumbs decorative art on the landing page is preserved intentionally.

- [#922](https://github.com/IgorGanapolsky/ThumbGate/pull/922) [`30cf554`](https://github.com/IgorGanapolsky/ThumbGate/commit/30cf554cb023982663d024f550b72b21d8c8d625) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Cursor plugin: fix broken promises and add real wiring. README claimed `npx thumbgate init --agent cursor` worked; it didn't. Added cursor detection + dispatcher + `wireCursorHooks` that writes `.cursor/mcp.json` with the ThumbGate MCP server (preserves other entries, idempotent). Added dedicated "🎯 Cursor plugin" card to the landing page Compatibility section with a real install URL. Added Cursor install link to the First-Dollar step 1 and hero secondary CTAs. 5 new tests guard the wiring. Also hardens landing-page pills into real `<a>` clickable links with hover/focus states.

- [#909](https://github.com/IgorGanapolsky/ThumbGate/pull/909) [`a9e0f0d`](https://github.com/IgorGanapolsky/ThumbGate/commit/a9e0f0da30535e95c2311960681c58739a454244) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Insights tab to dashboard with interactive Chart.js charts (feedback trend, lessons generated, gate effectiveness), clickable pipeline visualization, and data consistency fix across all stat paths.

- [#902](https://github.com/IgorGanapolsky/ThumbGate/pull/902) [`94d3882`](https://github.com/IgorGanapolsky/ThumbGate/commit/94d38820541d05dfed391754d95ed45671fa3761) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add ElevenLabs-based demo voiceover automation (`scripts/generate-demo-voiceover.js`) that extracts narration from the canonical demo video script and synthesizes an mp3 via the ElevenLabs TTS API. Promote the landing page demo video out of the collapsed `<details>` into a visible inline hero embed, add a 90-second demo section to the top of `README.md`, and rewrite the Show HN launch draft around the token-cost mission. Schedule `reply-monitor.yml` daily at 13:00 UTC with LinkedIn environment passthrough, and ship two LinkedIn ops docs: a 2-minute daily manual-check runbook and a fully-drafted LinkedIn Community Management API application package.

- [#926](https://github.com/IgorGanapolsky/ThumbGate/pull/926) [`d8d1047`](https://github.com/IgorGanapolsky/ThumbGate/commit/d8d10477a013609acaf69c8e9c14794f232ffe7d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add lightweight durable-step helper (`scripts/durability/step.js`) inspired by Vercel Workflows' "use step" pattern. Wraps external I/O with uniform retry + idempotency semantics without pulling in a full durable-execution runtime:

  - **`runStep(name, opts, fn)`** — retry with exponential backoff, classifying transient vs permanent errors (HTTP 429/5xx retry, 4xx bail, socket codes retry, `nonRetryable` flag bails immediately)
  - **`idempotencyKey(...parts)`** — stable SHA-256-derived 32-char key for safe POST retry

  Wired into three highest-leverage call sites:

  1. **Zernio publisher** (`publishPost`, `schedulePost`) — adds `Idempotency-Key` header so retried POSTs collapse to one published post on Zernio's side. Plan-quota errors are tagged `nonRetryable` to avoid wasting retries on 402-equivalents.
  2. **LanceDB vector write** (`upsertFeedback`) — survives transient filesystem contention (EBUSY / lock timeouts) with 2-retry backoff; embedding is pure CPU so not retried.
  3. **Anthropic SDK call** (`callClaude`) — retries 429/5xx, bails on malformed-prompt / auth errors. Contract-preserving: callers still get `null` on permanent failure.

  21 unit tests cover success/retry/exhaustion/nonRetryable paths and idempotency-key stability.

  Not a Vercel Workflows migration — deliberately scoped to capture ~70% of the reliability benefit with ~60 lines of code and zero new infrastructure.

- [#912](https://github.com/IgorGanapolsky/ThumbGate/pull/912) [`f1fccae`](https://github.com/IgorGanapolsky/ThumbGate/commit/f1fccaeefab882e5d6de193e0986d7f7cd3e2a4c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - PreToolUse hook now injects semantically-relevant past negative lessons into `additionalContext` before every tool call. Turns ThumbGate from a passive log into an active governor: captured lessons surface at decision time so the agent sees its past mistakes BEFORE executing, not after. Shipped by default via `thumbgate init --agent claude-code|codex` — users already running that get the enforcement automatically on next hook invocation.

- [#952](https://github.com/IgorGanapolsky/ThumbGate/pull/952) [`dadf4ba`](https://github.com/IgorGanapolsky/ThumbGate/commit/dadf4bae8cd328d032121ebe265733ffc84d9b38) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `buildRecentCorrectiveActionsContext` to `scripts/gates-engine.js`: surfaces the 3 most recent captured mistakes (from `memory-log.jsonl`, last 24h) as `hookSpecificOutput.additionalContext` on every tool call. Plugs the cold-start gap where a just-captured mistake would otherwise wait for semantic match or the recurring-pattern threshold before reaching the agent's context.

- [#889](https://github.com/IgorGanapolsky/ThumbGate/pull/889) [`bc79ae2`](https://github.com/IgorGanapolsky/ThumbGate/commit/bc79ae264d6f4813af84d536b7ddb963946914b9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Reposition ThumbGate around a single sharp mission: **stop your AI from making the same mistake twice.** Repeated AI mistakes cost real money in tokens — one thumbs-down captures the lesson and ThumbGate blocks that exact pattern on every future call, across every agent.

  - **New hero copy everywhere** — plain-English, pain-point-in-one-sentence, no buzzword cadence. Applied to landing page, README, meta/OG tags, JSON-LD, package.json, plugin.json, and `config/github-about.json`.
  - **Live "💸 Tokens Saved" counter** on the dashboard. New `scripts/token-savings.js` helper (21 tests, Sonnet-blended default) turns blocked-gate + bot-deflection counts into a live token + dollar estimate. Swap in your own model mix to honestly reflect your Anthropic / OpenAI bill.
  - **New ClawHub / OpenClaw distribution skill** — `dist/clawhub-skill/SKILL.md` — ready for `npm run clawhub:publish` once authenticated. Expands the distribution surface to the OpenClaw skill marketplace alongside the Claude Extension, Codex plugin, npm, and MCP marketplaces.
  - **SEO blog post** `docs/marketing/blog-token-cost-mission.md` ranking on "save Claude tokens" / "reduce LLM cost" / "AI agent token waste."
  - **Pre-validated social pack** `docs/marketing/token-cost-mission-social-pack.md` (X/Threads/LinkedIn/HN/Reddit/TikTok) under every platform's char limit.

- [#922](https://github.com/IgorGanapolsky/ThumbGate/pull/922) [`30cf554`](https://github.com/IgorGanapolsky/ThumbGate/commit/30cf554cb023982663d024f550b72b21d8c8d625) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Real token-savings on the dashboard — no more hardcoded numbers. The Insights tab now shows `$ saved` computed from actual gate-stats.blocked count × conservative tokens/block × published Sonnet/Opus/Haiku prices. Zero blocks → shows $0.00 honestly (not a marketing placeholder). Methodology (input/output tokens per block, model mix, blended price) is disclosed inline. Landing page hero still uses the "Sample" demo — dashboard now uses real data.

- [#931](https://github.com/IgorGanapolsky/ThumbGate/pull/931) [`8161e51`](https://github.com/IgorGanapolsky/ThumbGate/commit/8161e5130c8112447327689dcf00bf8a5f407026) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Send a branded welcome email with the license key and activation command whenever
  `checkout.session.completed` fires. Uses Resend (`RESEND_API_KEY`) with
  `onboarding@resend.dev` as the default sender so the webhook keeps working
  without a verified domain. If the key is unset, the webhook logs a warning and
  continues — the license key is always persisted regardless of email state.

### Patch Changes

- [#919](https://github.com/IgorGanapolsky/ThumbGate/pull/919) [`7be5cc6`](https://github.com/IgorGanapolsky/ThumbGate/commit/7be5cc628a4da37a93084347b1db569283647078) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix recurring regression: add `public/pro.html`, `public/blog.html`, `public/learn.html` to npm files whitelist so they actually ship. New `tests/public-package-parity.test.js` asserts (a) every HTML in `public/` is in whitelist, (b) every whitelist entry exists on disk, (c) no stale `$99/seat` Team pricing ships. Prevents the packaging-bug pattern that hit 1.5.0, 1.5.1, 1.5.3.

- [#949](https://github.com/IgorGanapolsky/ThumbGate/pull/949) [`c8b31e9`](https://github.com/IgorGanapolsky/ThumbGate/commit/c8b31e9fe5fe685fa981b1230535b8f0b97b37fb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add an Autoresearch Safety Pack acquisition wedge with a buyer guide, landing-page CTAs, LLM context, SEO/GEO seeds, and regression tests for self-improving agent safety discovery.

- [#918](https://github.com/IgorGanapolsky/ThumbGate/pull/918) [`f063c1a`](https://github.com/IgorGanapolsky/ThumbGate/commit/f063c1a3723bafc1ef52ae5208fc67af3d36d702) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Version bump to 1.5.3 — publish the landing page congruence fixes, dashboard deep-linking, and README corrections that merged as [#914](https://github.com/IgorGanapolsky/ThumbGate/issues/914) after 1.5.2 had already been published from [#911](https://github.com/IgorGanapolsky/ThumbGate/issues/911).

- [#858](https://github.com/IgorGanapolsky/ThumbGate/pull/858) [`204dbbe`](https://github.com/IgorGanapolsky/ThumbGate/commit/204dbbeb42c9140318b2907f9bea4156b67e390a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Expose the ChatGPT Actions OpenAPI YAML import before bearer auth and document the GPT Builder bearer key setup.

- [#869](https://github.com/IgorGanapolsky/ThumbGate/pull/869) [`5bac711`](https://github.com/IgorGanapolsky/ThumbGate/commit/5bac711e8ff8e232fc66b6da3abe8ec9a48841f7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Deflect checkout crawlers and link-preview bots before creating Stripe sessions so revenue telemetry reflects real buyer intent.

- [#932](https://github.com/IgorGanapolsky/ThumbGate/pull/932) [`bc9f0c0`](https://github.com/IgorGanapolsky/ThumbGate/commit/bc9f0c0b4052a58fe957e36cc7368d692aa268c6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Replace stale checkout logo assets with ThumbGate brand marks and add activation email delivery instrumentation for trial provisioning.

- [#877](https://github.com/IgorGanapolsky/ThumbGate/pull/877) [`1c7140e`](https://github.com/IgorGanapolsky/ThumbGate/commit/1c7140ec44f328bfa14d946984324631915260f9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add prominent "Install Claude Extension →" CTA to the landing page hero section, matching the existing Codex plugin link. Links to the .mcpb bundle download with PostHog tracking.

- [#922](https://github.com/IgorGanapolsky/ThumbGate/pull/922) [`30cf554`](https://github.com/IgorGanapolsky/ThumbGate/commit/30cf554cb023982663d024f550b72b21d8c8d625) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Compat cards that promise a download now link directly to the release asset instead of a docs/source page. Codex plugin card was linking to `INSTALL.md` source despite saying "download the zip"; Claude Desktop Extension card was linking to a guide page despite saying "install the .mcpb bundle today". Both now go straight to the `.zip` / `.mcpb` on GitHub Releases. Setup-instruction secondary links preserved inline. New test `landing-page-claims.test.js` guards against regression: any compat card with "Download" in the arrow MUST have href pointing at `releases/.../download/`.

- [#935](https://github.com/IgorGanapolsky/ThumbGate/pull/935) [`1785ca9`](https://github.com/IgorGanapolsky/ThumbGate/commit/1785ca989f22642396baf804194bf8ff0f165bce) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Clarify the Codex plugin marketing card so it sends users to the install page and keeps MCP directory install copy on ThumbGate's npx path.

- [#927](https://github.com/IgorGanapolsky/ThumbGate/pull/927) [`4742253`](https://github.com/IgorGanapolsky/ThumbGate/commit/4742253e2b3bd0d89d79881e54b343653d2f875d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Codex MCP installs now resolve `thumbgate@latest` when Codex starts the MCP server or hook bundle, instead of preferring a stale already-installed runtime binary. The repo-local Codex plugin, standalone bundle config, README, landing page, and distribution docs now advertise the auto-updating Codex plugin path truthfully while preserving local source fallback for unpublished development builds.

- [#895](https://github.com/IgorGanapolsky/ThumbGate/pull/895) [`fbc66c9`](https://github.com/IgorGanapolsky/ThumbGate/commit/fbc66c989c830acd2513ff77769627e2aa242919) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Wire the full Codex hook bundle during init and add the Codex status line target to the generated local config.

- [#880](https://github.com/IgorGanapolsky/ThumbGate/pull/880) [`7ddf48f`](https://github.com/IgorGanapolsky/ThumbGate/commit/7ddf48f664dd113dc933006f46f2c78e905a66ac) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Landing page conversion overhaul: restructure visual hierarchy for conversion

  - Hero: single dominant CTA (install command + Install Free CLI), secondary CTAs grouped and visually demoted
  - Terminal demo: moved immediately after hero to show the product before any explanation
  - Trust bar: added above-the-fold honest social proof (MIT, GitHub stars, local-first, 6 integrations)
  - Hero headline: rewritten for clarity ("Stop expensive AI agent mistakes before they happen")
  - Nav: simplified to 4 visible links (How It Works, Pricing, FAQ, GitHub) + Install Free CTA
  - Enterprise intake form: collapsed behind a details/summary toggle to reduce page overwhelm
  - Newsletter section: simplified headline, removed internal jargon ("Buyer Follow-Up" → "Stay Updated")
  - Final CTA: simplified to 2 primary actions, secondary CTAs visually demoted
  - CSS: added conversion hierarchy styles to reduce visual weight of secondary sections
  - Pro pricing card: added email capture input (pro-email) for 7-day trial flow
  - All 36 landing page tests pass

- [#906](https://github.com/IgorGanapolsky/ThumbGate/pull/906) [`6db3ab1`](https://github.com/IgorGanapolsky/ThumbGate/commit/6db3ab1c09fd500d31b2d426c02540f0635e01e4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Rewrite postinstall banner to drive first-dollar conversion. Lead with concrete token-waste pain point, add tracked `/go/pro` click-through (UTM: source=npm, medium=postinstall, campaign=first_dollar) alongside direct Stripe link, clean up ragged box formatting. Every npm install sees this banner — making it the highest-leverage conversion touchpoint.

- [#924](https://github.com/IgorGanapolsky/ThumbGate/pull/924) [`3a8ec38`](https://github.com/IgorGanapolsky/ThumbGate/commit/3a8ec38b7b35cc384514e6f2054a09777c13d46e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Unlock the full dashboard demo (no blur-wall paywall), point GSD-brief CTAs directly at `/checkout/pro` instead of the homepage 301 hop, and fix the sticky sidebar overflow so long right-rails scroll internally on GSD-brief pages.

- [#893](https://github.com/IgorGanapolsky/ThumbGate/pull/893) [`e699073`](https://github.com/IgorGanapolsky/ThumbGate/commit/e6990730014d4151837ee61e4d46544bb07d4712) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add decision-trace module for full gate evaluation observability. Logs passes, blocks, and near-misses (constraints that almost matched). Includes session trace summaries showing safety posture at a glance — inspired by Ethan Mollick's observation that operators need to see agent thinking traces.

- [#910](https://github.com/IgorGanapolsky/ThumbGate/pull/910) [`b1c4c28`](https://github.com/IgorGanapolsky/ThumbGate/commit/b1c4c28bc54e982976f1955d60601468b3e2715a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Replace the landing-page explainer video with a reproducible 90-second animated
  walkthrough that actually explains the mechanism — same-mistake-different-session
  pain, 👎 → Pre-Action Gate extraction, gate fires on the next bad call,
  compounding token savings, one-line install. Adds an offline render pipeline
  (`scripts/render-demo-video/`) that drives a scripted 1920×1080 HTML animation
  through headless Playwright and muxes an ElevenLabs/`say` narration track —
  byte-reproducible on every re-render, no live agent session required. New
  npm scripts: `demo:narration`, `demo:render`, `demo:render:full`.

- [#924](https://github.com/IgorGanapolsky/ThumbGate/pull/924) [`3a8ec38`](https://github.com/IgorGanapolsky/ThumbGate/commit/3a8ec38b7b35cc384514e6f2054a09777c13d46e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Replace legacy "MCP Memory Gateway" green logo in `docs/logo-400x400.png` with the proper ThumbGate brand mark (cyan thumbs-up + wordmark on dark background). Also detached the stale image from the Stripe Product (`prod_UE7SR5NFBkumEp`) so checkout no longer shows the legacy asset. Fixes CEO-reported "weird MCP logo on Stripe annual checkout" bug.

- [#866](https://github.com/IgorGanapolsky/ThumbGate/pull/866) [`8a62372`](https://github.com/IgorGanapolsky/ThumbGate/commit/8a623727f45d41a73738d1db71f5d4f01a00316c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix wire-hooks to clean stale project-level Claude Code hooks referencing missing files. Previously only cleaned user-level settings, leaving broken hooks in .claude/settings.json that caused "UserPromptSubmit hook error".

- [#902](https://github.com/IgorGanapolsky/ThumbGate/pull/902) [`94d3882`](https://github.com/IgorGanapolsky/ThumbGate/commit/94d38820541d05dfed391754d95ed45671fa3761) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix: serve public static assets (`/assets/*`, `/favicon.ico`, `/thumbgate-logo.png`, `/og.png`, `/apple-touch-icon.png`) without requiring an API key. Before this change the landing page rendered but every image, video, and icon fell through to the `/v1/*` API-key guard and returned 401, leaving visitors with an empty video player and broken poster images. Adds path-traversal-safe asset routing with correct MIME types, `Cache-Control: public, max-age=86400, immutable`, and HEAD-request support. Covered by `tests/public-static-assets.test.js`.

- [#903](https://github.com/IgorGanapolsky/ThumbGate/pull/903) [`689a9bd`](https://github.com/IgorGanapolsky/ThumbGate/commit/689a9bda46e0d584041ff33fd20d69e7ad073784) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add gate-coherence analyzer to detect pseudo-unification across enforcement layers. Runs 20 probes across spec-gate and gate-config layers, detects contradictions (one blocks, another allows), coverage gaps (dangerous input passes all layers), and false positives. Reports coherence score and grade (unified/divergent/over-blocking). Inspired by entropy-probing research on pseudo-unification in multimodal models.

- [#898](https://github.com/IgorGanapolsky/ThumbGate/pull/898) [`bc67f55`](https://github.com/IgorGanapolsky/ThumbGate/commit/bc67f55199b4dc0512e0823142a808cb4ede0fe8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add gate-eval module for systematic evaluation of gate effectiveness. Operators define eval suites (expected block/pass outcomes), run them against specs, get precision/recall/F1 metrics, compare spec versions A/B, and track effectiveness trends over time. Ships with 16-case agent-safety eval suite. Inspired by Anthropic's prompt evaluation framework.

- [#941](https://github.com/IgorGanapolsky/ThumbGate/pull/941) [`fdcbb13`](https://github.com/IgorGanapolsky/ThumbGate/commit/fdcbb13b78f07c9cc858970789f62ab54572eecc) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix header logo rendering as tiny iOS-launcher tile across all site surfaces. The existing `/assets/brand/thumbgate-mark.svg` is designed as an app-icon (full 512×512 canvas with a `#0a0d12` rounded-square backdrop filling the entire viewBox). When inlined in headers at 28–32px next to the wordmark it read as "a dark tile with a microscopic icon inside" rather than as a clean brand mark. Adds a new transparent full-bleed companion `/assets/brand/thumbgate-mark-inline.svg` and repoints every header `<img src=…>` (landing, dashboard, lessons, pro, learn hub + 5 learn articles, post-checkout success page, SEO-GSD generator — 12 surfaces) to the inline variant. `apple-touch-icon` / PWA / OG link tags intentionally still reference the app-icon tile — that is the correct asset for iOS home-screen bookmarks. Adds a regression-guard in `brand-assets.test.js` that fails if the app-icon tile is ever re-inlined in a header, and an inline-mark transparency assertion that blocks reintroducing a full-canvas dark rectangle.

- [#931](https://github.com/IgorGanapolsky/ThumbGate/pull/931) [`8161e51`](https://github.com/IgorGanapolsky/ThumbGate/commit/8161e5130c8112447327689dcf00bf8a5f407026) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Rewrite the post-checkout "Hosted API setup" section on the Context Gateway Activated page with a plain-English value prop: what it is, when teams and CI users need it, when solo-laptop users can skip it, then the setup steps. Fixes the feedback that customers finish checkout and see jargon with no explanation of why the Hosted API matters.

- [#904](https://github.com/IgorGanapolsky/ThumbGate/pull/904) [`c5b5204`](https://github.com/IgorGanapolsky/ThumbGate/commit/c5b5204f75fc748641fee6e69e85cdb061dda8da) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add incremental dashboard review checkpoints so operators can mark the current state as reviewed and then see only new feedback, promoted lessons, and gate blocks that landed afterward. This ships the persisted review baseline, the dashboard checkpoint controls, and the `/v1/dashboard/review-state` API for reading and resetting the current checkpoint.

- [#943](https://github.com/IgorGanapolsky/ThumbGate/pull/943) [`7ac112c`](https://github.com/IgorGanapolsky/ThumbGate/commit/7ac112c0c210dd1be2bd4e9a14e1892b803ae0e3) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Replace the header inline logo and legacy favicon SVGs with the TG gate monogram so checkout, dashboard, and marketing headers use the same professional ThumbGate identity.

- [#879](https://github.com/IgorGanapolsky/ThumbGate/pull/879) [`5f3e1fc`](https://github.com/IgorGanapolsky/ThumbGate/commit/5f3e1fc7e842aa9d4602741b104b6dd024d2a070) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix Instagram publishing end-to-end. `post-video.js` now uses the Zernio presign upload flow + shared `publishPost`, matching the `{ url, key, size, contentType, type }` media-item shape Instagram requires (legacy `/media` multipart + minimal `{ url, type }` payload was silently rejected). Added `instagram` dispatcher to `post-everywhere.js` (previously a silent no-op). Added daily `instagram-autopilot.yml` workflow that posts a ThumbGate card via `publish-instagram-thumbgate.js`.

- [#945](https://github.com/IgorGanapolsky/ThumbGate/pull/945) [`2f8e670`](https://github.com/IgorGanapolsky/ThumbGate/commit/2f8e670f6ac4020febc43cbf852bc9fade2b39d7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Welcome email v2: consolidate the trial welcome email through the `scripts/mailer/resend-mailer.js` module and upgrade the template. Adds personalized greeting (first name from Stripe `customer_details.name`), explicit trial-end date (from Stripe `subscription.trial_end`), branded header mark, founder signoff, quickstart P.S., `reply_to: hello@thumbgate.app`, and a CAN-SPAM footer (business name, physical address, unsubscribe mailto) on every send. `handleWebhook` now threads `customerName` and `trialEndAt` through to the mailer. The legacy inline transport remains as a fallback and its `no_api_key` skip reason is normalized to `missing_resend_api_key` so dashboards and support tooling see a stable vocabulary regardless of which transport produced the skip.

- [#878](https://github.com/IgorGanapolsky/ThumbGate/pull/878) [`927e3ca`](https://github.com/IgorGanapolsky/ThumbGate/commit/927e3cacd6eccb4a02fe68f5f2912bb4ab16d626) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat: Claude-first landing page overhaul

  Restructures the entire landing page to prominently feature Claude plugin, Claude Extension, and Claude Code alongside (and above) the GPT promotion:

  - Hero section: rewrites subtitle from GPT-first to agent-agnostic, adds "Install Claude Extension" as a primary amber CTA button
  - New dedicated Claude Code section added before the ChatGPT GPT section
  - Compatibility grid reordered: Claude Desktop Extension first, Claude Code Skill second, ChatGPT demoted to last
  - First-Dollar Activation Path rewritten from GPT-centric to agent-agnostic install flow
  - Proof bar reordered with Claude links first
  - Final CTA adds Claude Extension button
  - Nav bar adds Claude link and Claude Extension CTA
  - GPT section renamed to "Also Available" to reduce GPT-first impression

- [#914](https://github.com/IgorGanapolsky/ThumbGate/pull/914) [`e6c6012`](https://github.com/IgorGanapolsky/ThumbGate/commit/e6c60120cc88021e59517eed0184e39c17548456) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Landing page congruence fixes and dashboard deep-linking:

  - Remove misleading "1 agent" Free tier bullet (no per-agent enforcement exists in rate-limiter)
  - Rephrase Free tier bullets to match actual code behavior (1 auto-promoted prevention rule, built-in safety gates)
  - Add hash-based deep-linking to dashboard: `/dashboard#insights`, `/dashboard#gates`, `/dashboard#export` now auto-switch tabs
  - "Visual gate debugger" link on Pro tier now deep-links to `#insights` (was pointing to root `/dashboard`)
  - "DPO training data export" link on Pro tier now deep-links to `#export`
  - Add `public/dashboard.html`, `scripts/prompt-eval.js`, `bench/prompt-eval-suite.json`, `CHANGELOG.md` to npm files whitelist — these were missing, breaking the dashboard for users running `npx thumbgate pro`
  - New tests: 19 landing-page-claims (code-backed claim audit), 3 dashboard-deeplink-e2e (real server + HTTP fetch + hash validation)

- [#913](https://github.com/IgorGanapolsky/ThumbGate/pull/913) [`7dddb46`](https://github.com/IgorGanapolsky/ThumbGate/commit/7dddb46f0d0972a04d5cf22e0199f9110534e9ac) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add LinkedIn one-shot comment engagement: `publishComment` publisher
  (`scripts/social-analytics/publishers/linkedin-comment.js`) that posts a comment
  on a specified activity URN via the socialActions endpoint, plus a
  `linkedin-comment-engage.yml` workflow_dispatch that runs it with the
  `LINKEDIN_ACCESS_TOKEN` / `LINKEDIN_PERSON_URN` secrets. Used for
  high-signal targeted engagements on prospect / thought-leader posts
  whose audience overlaps ThumbGate's ICP; bulk / scheduled engagement
  still flows through Ralph Loop.

- [#924](https://github.com/IgorGanapolsky/ThumbGate/pull/924) [`3a8ec38`](https://github.com/IgorGanapolsky/ThumbGate/commit/3a8ec38b7b35cc384514e6f2054a09777c13d46e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add LinkedIn Post Dispatch workflow — first-party post publisher with optional article link-preview card. Fallback path when Comment API and Quote-Post reshare are blocked by LinkedIn's permission model.

- [#920](https://github.com/IgorGanapolsky/ThumbGate/pull/920) [`bb7a1f8`](https://github.com/IgorGanapolsky/ThumbGate/commit/bb7a1f8935a8a462ba055813c5a40124509b3475) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add LinkedIn quote-post engagement pivot: `linkedin-quote-post.js` publisher + `linkedin-quote-post-engage.yml` workflow_dispatch. Publishes a standalone post on the authenticated member's feed with `reshareContext.parent` referencing the target activity URN, so we can engage with thought-leader posts when the Community Management API (`socialActions/{urn}/comments`) is not available on the app. Uses only `w_member_social` — already granted via the existing "Share on LinkedIn" product — no additional LinkedIn Developer Portal approvals required. The original author receives a mention-style notification through the reshare reference.

- [#886](https://github.com/IgorGanapolsky/ThumbGate/pull/886) [`f72d242`](https://github.com/IgorGanapolsky/ThumbGate/commit/f72d2428a7481c949af7c7dafaa968fa84255f44) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Marketing assets and README overhaul: conversion-optimized README with architecture diagrams, SEO tutorial article, Manus AI skill, and technical architecture diagrams (MCP flow, feedback pipeline, agent integration).

- [#863](https://github.com/IgorGanapolsky/ThumbGate/pull/863) [`2a048e2`](https://github.com/IgorGanapolsky/ThumbGate/commit/2a048e2f9d910da2b2689656109af2e2364f7ee1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Wire Stripe pricing calls to action into the marketing autopilot and scheduled X revenue loop.

- [#881](https://github.com/IgorGanapolsky/ThumbGate/pull/881) [`91e971d`](https://github.com/IgorGanapolsky/ThumbGate/commit/91e971daa57d69ec5ce8ab2e85f0ac349828dd15) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(monetization): enforce lifetime free-tier caps, reduce Team pricing to $49/seat

  - Rate limiter switched from daily resets to lifetime caps (3 captures, 1 rule, recall blocked)
  - Team plan reduced from $99 to $49/seat/month with new Stripe price ID
  - Landing page rewritten with pain-first copy, hard limits visible, updated CTAs

- [#921](https://github.com/IgorGanapolsky/ThumbGate/pull/921) [`a97ef8e`](https://github.com/IgorGanapolsky/ThumbGate/commit/a97ef8e15448d5cbf8720a1c1167be085293a700) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add pre-commit + pre-push git hooks to catch regressions before CI. Hooks live in `.githooks/` (no new npm deps), auto-activate via `prepare` npm script, enforce: public/ HTML package parity, version sync, check-congruence, landing-page-claims, gates-engine regression tests, npm pack dry-run, internal link validation. Also adds CI publish-guard that fails when a merge leaves shipped content un-bumped (prevents the "1.5.2 already on npm, content didn't ship" silent no-op that forced 1.5.3/1.5.4).

- [#917](https://github.com/IgorGanapolsky/ThumbGate/pull/917) [`d33b81f`](https://github.com/IgorGanapolsky/ThumbGate/commit/d33b81fbb9f66f108ca3ecf99bcee7680d3fc5ee) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Put the Pro pricing card INSIDE the homepage hero (between subtitle and dashboard preview) so `$19/mo` and `$149/yr` never get buried. The card shows both Monthly and Annual plans side-by-side with dedicated "Choose monthly / Choose annual" buttons and a "SAVE 35%" pill on annual — visible in pixel [#1](https://github.com/IgorGanapolsky/ThumbGate/issues/1) on any viewport, not hidden behind scroll. `/pro` is now a permanent `301` redirect to `/#pro-pitch` (the id of the in-hero pricing card), so every README, plugin manifest, guide, and compare page link still works and passes link equity onto a single canonical landing page. `/pro` also removed from the sitemap entry list and from the JSON root-endpoint listing so search engines index `/` directly instead of chasing the redirect.

- [#896](https://github.com/IgorGanapolsky/ThumbGate/pull/896) [`cb1657f`](https://github.com/IgorGanapolsky/ThumbGate/commit/cb1657fbd2c655ee60464017362151d09d002b7a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add prompt-evaluation positioning to the README and landing page so ThumbGate explains that prompt engineering is only the start, and proof lanes plus self-heal checks are how behavior gets measured and enforced.

- [#929](https://github.com/IgorGanapolsky/ThumbGate/pull/929) [`29bb812`](https://github.com/IgorGanapolsky/ThumbGate/commit/29bb81213ee1e74c51ebba5e6cb94be87342fea9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Make the landing-page proof-bar links individually clickable with padded hit targets and keyboard focus states, and show both thumbs-up reinforcement and thumbs-down correction examples in the first-dollar activation path.

- [#857](https://github.com/IgorGanapolsky/ThumbGate/pull/857) [`2f3fa15`](https://github.com/IgorGanapolsky/ThumbGate/commit/2f3fa15e8fa644b8d6ad1ae8bee4f8f4ae0306a0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix public landing page version synchronization so multiple release markers update in one pass.

- [#911](https://github.com/IgorGanapolsky/ThumbGate/pull/911) [`1d36bab`](https://github.com/IgorGanapolsky/ThumbGate/commit/1d36babae12901b5d44dac85fee593d513968b6f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Include `public/dashboard.html`, `scripts/prompt-eval.js`, and `bench/prompt-eval-suite.json` in the published npm package. The 1.5.1 release shipped without `dashboard.html`, breaking the local Pro dashboard for users who ran `npx thumbgate pro`. This patch restores the dashboard and ships the prompt evaluation framework.

- [#868](https://github.com/IgorGanapolsky/ThumbGate/pull/868) [`e42391d`](https://github.com/IgorGanapolsky/ThumbGate/commit/e42391d90138140fc819d24afaa78457b85b486d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden revenue observability by preferring hosted billing-summary truth over local fallback when `THUMBGATE_API_KEY` is available, adding machine-readable Stripe live status diagnostics, and wiring the daily revenue loop to audit hosted revenue, Stripe, and Plausible checkout attribution with artifacts.

- [#855](https://github.com/IgorGanapolsky/ThumbGate/pull/855) [`69157d2`](https://github.com/IgorGanapolsky/ThumbGate/commit/69157d2c483f03bbfc6d8b6a4a403915ee2ac19e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a local sales pipeline ledger for first-dollar workflow hardening outbound, and update GTM targeting so direct outreach leads with the Workflow Hardening Sprint before self-serve Pro follow-up.

- [#905](https://github.com/IgorGanapolsky/ThumbGate/pull/905) [`d3f7195`](https://github.com/IgorGanapolsky/ThumbGate/commit/d3f7195f911fd870fdc079df0823c3a8d42daa36) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add sandbox scope to spec-gate constraints for secure code execution environments. Adds 2 sandbox-specific constraints (no-sandbox-network, no-sandbox-fs-escape) to agent-safety spec. Also adds workflow-gate-checkpoint module for persisting gate state across long-running workflow restarts. Inspired by Vercel's Open Agents infrastructure.

- [#888](https://github.com/IgorGanapolsky/ThumbGate/pull/888) [`9fcc0a0`](https://github.com/IgorGanapolsky/ThumbGate/commit/9fcc0a00aaf354964c5d795548482ab249963245) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add session health sensor and episodic session store for real-time and cross-session agent degradation detection. Tracks repeat errors, negative feedback density, stagnation, context amnesia, time-of-day risk, category risk, recurring errors, and feedback effectiveness trends.

- [#892](https://github.com/IgorGanapolsky/ThumbGate/pull/892) [`86152fa`](https://github.com/IgorGanapolsky/ThumbGate/commit/86152fa0198f8ccff21d54257e809423eed8086a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add spec-gate module for proactive correctness enforcement. Operators define specs (constraints + invariants) upfront as JSON; gates enforce them from session start, not just from learned failures. Ships with agent-safety spec covering force-push, secrets, destructive ops, and test-before-commit invariants.

- [#939](https://github.com/IgorGanapolsky/ThumbGate/pull/939) [`adcc368`](https://github.com/IgorGanapolsky/ThumbGate/commit/adcc368adcb784b8ab4cd23355e75529e13cd4ac) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix broken logo on /success (Context Gateway Activated) page. After PR [#932](https://github.com/IgorGanapolsky/ThumbGate/issues/932) moved brand assets to `/assets/brand/`, the HTML templates from PR [#931](https://github.com/IgorGanapolsky/ThumbGate/issues/931) still referenced the legacy `/brand/thumbgate-mark.svg` path — which Railway's route guard now returns 401 for. Migrates all 15 customer-facing surfaces (landing, dashboard, lessons, pro, learn hub + 5 learn articles, post-checkout success page, SEO-GSD generator) to the correct `/assets/brand/thumbgate-mark.svg` path (serves 200). Also migrates favicon link from the 401ing `/favicon.svg` to the 200ing `/thumbgate-icon.png`, and `og:image` from `/brand/thumbgate-og.svg` to `/og.png`, with correct MIME types. Updates brand-assets test suite to pin the new paths so this can't regress.

- [#865](https://github.com/IgorGanapolsky/ThumbGate/pull/865) [`81dac4e`](https://github.com/IgorGanapolsky/ThumbGate/commit/81dac4e7b65f5a1099d7f0b7376b3b01553e8091) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Enforce ThumbGate-only launch, GPT Actions, analytics, and outreach surfaces so legacy repository names cannot leak into active product guidance.

- [#940](https://github.com/IgorGanapolsky/ThumbGate/pull/940) [`5a39d1c`](https://github.com/IgorGanapolsky/ThumbGate/commit/5a39d1c9fb15423a60c5c6263c05c6b0ad4ec8fe) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Polish the ThumbGate Pro trial email so checkout activation uses conversion-ready copy, a clear dashboard call to action, Pre-Action Gates positioning, and Resend sender configuration synced into Railway deploys.

- [#924](https://github.com/IgorGanapolsky/ThumbGate/pull/924) [`3a8ec38`](https://github.com/IgorGanapolsky/ThumbGate/commit/3a8ec38b7b35cc384514e6f2054a09777c13d46e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Enforce per-platform character limits in the Zernio publisher before posting or scheduling. The previous path blasted identical content to every connected platform — a 315-char post silently failed at Bluesky's 300-char ceiling (CEO-reported post `69d939ba88955f0579e44fa7`, 2026-04-16). New `platform-limits.js` module maps canonical limits (Bluesky 300, X/Twitter 280, LinkedIn 3000, etc.) and rejects over-limit targets with actionable `{ reason, platform, limit, length, overBy }` detail rather than letting the provider eat the failure.

## 1.5.1

### Minor Changes

- Add **Insights tab** to the dashboard with interactive Chart.js charts:
  - **Feedback Trend** (30-day line chart): daily thumbs-up/down signals over time
  - **Lessons Generated** (bar + cumulative line): how many lessons were distilled each day
  - **Gate Effectiveness** (stacked bar): 14-day audit of blocked/warned/allowed actions
  - **Feedback → Lesson Pipeline**: clickable flow showing how signals convert to lessons, gates, and blocked actions with conversion rates
  - **How ThumbGate Learns**: 4-step visual explainer (React → Distill → Promote → Block)
- New backend functions: `computeFeedbackTimeSeries()` (30-day daily up/down/lesson counts) and `computeLessonPipeline()` (stage-by-stage conversion metrics)
- Dashboard API (`/v1/dashboard`) now returns `feedbackTimeSeries` and `lessonPipeline` fields

## 1.5.0

### Minor Changes

- [#815](https://github.com/IgorGanapolsky/ThumbGate/pull/815) [`9211b17`](https://github.com/IgorGanapolsky/ThumbGate/commit/9211b1726ebb11a852f459a34bb2b81aacdaf3e3) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Agent-first CLI experience: add `--json` flag to all commands, `thumbgate status` health check, `thumbgate explore` subcommands (lessons/rules/gates/firings), output context signals ([LOCAL], [ACTIVE], [LEARNING], [BLOCKED], [ALLOWED]), and `thumbgate demo` simulated walkthrough. AI agents can now programmatically check gate status, search lessons, and introspect ThumbGate state.

- [#812](https://github.com/IgorGanapolsky/ThumbGate/pull/812) [`66277a7`](https://github.com/IgorGanapolsky/ThumbGate/commit/66277a7adfd6778a0c4954339ea4408e5bc63848) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add autonomous four-hour marketing autopilots for text, video, Reddit, Dev.to, and Zernio-backed distribution with cached deduplication state.

- [#805](https://github.com/IgorGanapolsky/ThumbGate/pull/805) [`82a5849`](https://github.com/IgorGanapolsky/ThumbGate/commit/82a5849cf9fb123c6c5308bcc392e9c4d7b452a0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Steal Cloudflare CLI ideas: schema-first help, --json everywhere, --local/--remote

  Three improvements stolen from Cloudflare's CLI architecture post:

  **1. Schema-first CLI (`scripts/cli-schema.js`)**
  Single source of truth for all CLI command metadata. `help()` is now generated
  from the schema rather than hardcoded console.log lines. Each command declares
  its name, description, flags (with types), group, and MCP tool binding.
  Adding a new command in cli-schema.js auto-updates help output and the explore
  TUI command browser.

  **2. `--json` everywhere**

  - `thumbgate stats --json` → structured payload with total, positives, negatives,
    approvalRate, recentTrend, revenueAtRisk, topTags, recentActivity
  - `thumbgate gate-stats --json` → all gate engine metrics except the full gates
    array (add `--verbose` to include it)
  - `thumbgate doctor --json` already existed; now documented in schema

  **3. `--local` / `--remote` flag on `lessons`**

  - `thumbgate lessons --local` (default) uses the local JSONL/SQLite store
  - `thumbgate lessons --remote` fetches from the hosted Railway instance at
    `GET /v1/lessons/search?q=...&limit=...` — same response shape
  - Respects `THUMBGATE_API_URL` env var for custom deployments

- [#707](https://github.com/IgorGanapolsky/ThumbGate/pull/707) [`03c26b9`](https://github.com/IgorGanapolsky/ThumbGate/commit/03c26b9f69100c6779c4148096fbfdd39377be06) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add context-stuffing mode: dump all lessons into agent context bypassing RAG. New MCP tool context_stuff_lessons.

- [#789](https://github.com/IgorGanapolsky/ThumbGate/pull/789) [`258f7ef`](https://github.com/IgorGanapolsky/ThumbGate/commit/258f7ef86a4b4058d5b6a725d41ba369fb1396a8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add cross-encoder reranker to lesson retrieval pipeline (Advanced RAG)

  Introduces `scripts/lesson-reranker.js` — a field-weighted BM25F cross-encoder
  that processes (query, lesson) pairs jointly rather than independently:

  - **Field weighting**: query terms in `whatWentWrong` (weight 3.0) contribute
    more than the same term in `tags` (weight 0.4), catching field-specific
    relevance that bi-encoders miss
  - **Synonym expansion**: "deploy" ↔ "deployment/release/publish", "force-push"
    ↔ "git push --force", ".env" ↔ "secret/dotenv", and 8 more synonym clusters
  - **Signal coherence**: failure-sounding queries boost negative-signal lessons
    by 1.2× so the right cautionary lesson surfaces first
  - **Tool name joint scoring**: exact tool match in `metadata.toolsUsed` adds
    a 1.3× ranking bonus
  - **Score blending**: final score = 0.7 × normalised BM25 + 0.3 × original
    bi-encoder score so retrieval signal is never fully discarded

  The pipeline is now two-stage: bi-encoder retrieves top-50 candidates, then
  the cross-encoder reranks and returns top-K. Both the PreToolUse hook path
  (`lesson-retrieval.js`) and the MCP `search_lessons` path (`lesson-search.js`)
  use the reranker.

- [#768](https://github.com/IgorGanapolsky/ThumbGate/pull/768) [`9f05bbb`](https://github.com/IgorGanapolsky/ThumbGate/commit/9f05bbb870ba26ceca3cfd8b0c208824c2381c7f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Position ThumbGate as AI agent security infrastructure across the public landing context, LLM context, and social launch visuals.

- [#689](https://github.com/IgorGanapolsky/ThumbGate/pull/689) [`0467bf1`](https://github.com/IgorGanapolsky/ThumbGate/commit/0467bf11353b1d6a57a8c1b08081a075976e29c1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add policy and runbook document ingestion with searchable local storage, CLI/API/MCP import surfaces, and proposed gate generation for team workflows.

- [#805](https://github.com/IgorGanapolsky/ThumbGate/pull/805) [`82a5849`](https://github.com/IgorGanapolsky/ThumbGate/commit/82a5849cf9fb123c6c5308bcc392e9c4d7b452a0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `thumbgate explore` — interactive TUI explorer for lessons, gates, stats, and rules

  Inspired by Cloudflare's Local Explorer pattern: a zero-dependency, keyboard-driven
  terminal interface that lets developers and AI agents discover what ThumbGate has
  learned and what gates are active.

  Features:

  - 4 tabs (1-4 or Tab key): Lessons · Gates · Stats · Rules
  - ↑/↓ or j/k to navigate, `/` to search/filter, Enter for detail view
  - Color-coded signal indicators (● negative = red, ● positive = green)
  - Relative timestamps, truncation, terminal-resize awareness
  - Works entirely from local JSONL/SQLite — no network required

- [#690](https://github.com/IgorGanapolsky/ThumbGate/pull/690) [`04674fa`](https://github.com/IgorGanapolsky/ThumbGate/commit/04674fa44db7d3d31dc6327e4115018266dee91d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add ForgeCode agent adapter, Plausible analytics tracking across all pages, YouTube Shorts in weekly workflow, and daily revenue loop GitHub Actions workflow.

- [#743](https://github.com/IgorGanapolsky/ThumbGate/pull/743) [`a14279c`](https://github.com/IgorGanapolsky/ThumbGate/commit/a14279c8806eb85ece5a98c52eae603819b6c6ae) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Wire up hosted billing integration with a dedicated THUMBGATE_OPERATOR_KEY. Run `node bin/cli.js billing:setup` to generate a key, then set it on Railway — the CFO dashboard will pull live production revenue automatically.

- [#656](https://github.com/IgorGanapolsky/ThumbGate/pull/656) [`bbf835c`](https://github.com/IgorGanapolsky/ThumbGate/commit/bbf835ce07ea6c8ec2345fc77838ab5549ea40b5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add LLM-powered managed lesson agent, Anthropic SDK integration, AEO discovery (llms.txt), and founding member CTA across upgrade prompts

- [#684](https://github.com/IgorGanapolsky/ThumbGate/pull/684) [`fe326d3`](https://github.com/IgorGanapolsky/ThumbGate/commit/fe326d351357d31dc925069ad198f90afe055d76) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add meta-agent self-improvement loop (`scripts/meta-agent-loop.js`) and `gate-program.md` for closed-loop prevention rule generation without requiring human feedback on every iteration

- [#816](https://github.com/IgorGanapolsky/ThumbGate/pull/816) [`f3a1cd2`](https://github.com/IgorGanapolsky/ThumbGate/commit/f3a1cd2361af4624046a9954c81edfc3b7885d94) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Perplexity MCP adapter configs for Claude Code, Codex, and OpenCode. Register perplexity_search, perplexity_ask, perplexity_research, and perplexity_reason in MCP allowlists. Add enrichWithPerplexity() to lesson-search for optional web-context enrichment of search results.

- [#735](https://github.com/IgorGanapolsky/ThumbGate/pull/735) [`0b48d35`](https://github.com/IgorGanapolsky/ThumbGate/commit/0b48d35af245a429dcdf0a73bde1eb4e1ac90cb5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `npx thumbgate quick-start` command for zero-config complete enforcement setup

- [#770](https://github.com/IgorGanapolsky/ThumbGate/pull/770) [`b38cd7e`](https://github.com/IgorGanapolsky/ThumbGate/commit/b38cd7e3fa499a2770a246110d3c6523b26183ca) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Ralph Loop CI for always-on audience engagement, with hourly analytics polling, stateful reply monitoring, launch asset sync, and Reliability Gateway evidence artifacts.

- [#785](https://github.com/IgorGanapolsky/ThumbGate/pull/785) [`9f3fae7`](https://github.com/IgorGanapolsky/ThumbGate/commit/9f3fae7e61845dc11ce5978cfe80cd27f10034e8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add session analyzer coverage and Perplexity visibility checks so Ralph Mode CI can detect wasted agent turns, confusion signals, and AI-search discoverability regressions.

- [#656](https://github.com/IgorGanapolsky/ThumbGate/pull/656) [`bbf835c`](https://github.com/IgorGanapolsky/ThumbGate/commit/bbf835ce07ea6c8ec2345fc77838ab5549ea40b5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Pivot to team governance positioning ($99/seat/mo), add AEO for LLM discovery, fix LinkedIn poller

- [#694](https://github.com/IgorGanapolsky/ThumbGate/pull/694) [`6dffca9`](https://github.com/IgorGanapolsky/ThumbGate/commit/6dffca9006dd3fda2ab85de5bbb7c6626f36c3db) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Tighten free tier to 3 captures/day and 5 searches/day, add Pro CTA to CLI init output, and prepare Reddit seeding posts.

### Patch Changes

- [#726](https://github.com/IgorGanapolsky/ThumbGate/pull/726) [`b5ed367`](https://github.com/IgorGanapolsky/ThumbGate/commit/b5ed367e995c7e66859371b559b32355a3a3e3be) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Publish the AI agent security campaign updates across the site blog and launch assets.

- [#699](https://github.com/IgorGanapolsky/ThumbGate/pull/699) [`db8bd9f`](https://github.com/IgorGanapolsky/ThumbGate/commit/db8bd9fd4f822e68e17b1e83961276018368d4ea) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Weave AI authenticity enforcement angle across all buyer-facing and AI-discovery surfaces: README hero, landing page signal pill, llm-context.md discovery section, MARKETING_COPY_CONGRUENCE.md terminology rules, and package.json keywords.

- [#683](https://github.com/IgorGanapolsky/ThumbGate/pull/683) [`eb06538`](https://github.com/IgorGanapolsky/ThumbGate/commit/eb06538fbc5c02ea88313705e487fbad31461eb1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Weave AI authenticity enforcement angle across all discovery surfaces (README, landing page hero, FAQ, llm-context, marketing docs, NPM keywords).

- [#672](https://github.com/IgorGanapolsky/ThumbGate/pull/672) [`d9d9ae7`](https://github.com/IgorGanapolsky/ThumbGate/commit/d9d9ae7674936ac8ead0e5f670ab42b018339772) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Reframe the public product story around an enterprise-first workflow hardening motion while keeping the free CLI as the adoption wedge and Solo Pro as a secondary self-serve lane. This aligns the README, landing page, LLM context, commercial docs, and discovery assets with the current team-governance positioning.

- [#799](https://github.com/IgorGanapolsky/ThumbGate/pull/799) [`adaab1a`](https://github.com/IgorGanapolsky/ThumbGate/commit/adaab1ac6ce6d9312f2156dbf88a3bd299df90e4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the ChatGPT GPT Builder instructions around the Reliability Gateway loop, pre-action decision checks, typed feedback capture, prevention-rule generation, and proof export so the public GPT no longer uses generic setup-concierge positioning.

- [#769](https://github.com/IgorGanapolsky/ThumbGate/pull/769) [`1ae2873`](https://github.com/IgorGanapolsky/ThumbGate/commit/1ae28739614a78a348cbf178acd11ed3659321b9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Tighten the ChatGPT GPT Store packet for regular users. The docs now make the owner-managed Actions API key explicit, keep API keys and JSON away from regular GPT users, use the hosted privacy policy URL, and reinforce the thumbs-up/down answer-memory loop.

- [#766](https://github.com/IgorGanapolsky/ThumbGate/pull/766) [`c90604c`](https://github.com/IgorGanapolsky/ThumbGate/commit/c90604c5b03e162dad6d4c61b0fa1db19b90a3d6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Clarify Claude and ChatGPT distribution paths. The ChatGPT GPT Actions lane now explains the regular-user loop: reply with thumbs up/down on ChatGPT answers, save lessons, prevent repeated bad answer patterns, and reinforce answers that worked.

- [#739](https://github.com/IgorGanapolsky/ThumbGate/pull/739) [`2f4168c`](https://github.com/IgorGanapolsky/ThumbGate/commit/2f4168c393184b595798cc2eaf436e025dfd8cd7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Strengthen Claude plugin listing readiness docs, release assets, and submission packaging

- [#737](https://github.com/IgorGanapolsky/ThumbGate/pull/737) [`188319b`](https://github.com/IgorGanapolsky/ThumbGate/commit/188319b4cb23525d512fa7c3a8378a40524e9539) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Update Claude plugin manifests to current marketplace spec for directory listing

- [#692](https://github.com/IgorGanapolsky/ThumbGate/pull/692) [`7f962ea`](https://github.com/IgorGanapolsky/ThumbGate/commit/7f962ea3dc982582d5865076038a0a8e8f73f5e7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden merge integrity by blocking failing non-required quality checks, syncing main branch protection to the critical check set, and reporting landed merge commits instead of branch head SHAs.

- [#655](https://github.com/IgorGanapolsky/ThumbGate/pull/655) [`5d564a9`](https://github.com/IgorGanapolsky/ThumbGate/commit/5d564a9e3d8682f7864d52d8066a0bfaa35864ed) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh SonarCloud on `main` pushes without blocking on legacy baseline debt, while keeping strict PR quality-gate enforcement and stamping analyses with the package version for release-aligned verification.

- [#729](https://github.com/IgorGanapolsky/ThumbGate/pull/729) [`5f9eef8`](https://github.com/IgorGanapolsky/ThumbGate/commit/5f9eef8bb7a12392857bb9d1764f180ec8bfb6c8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Promote the published Codex plugin bundle more clearly from the landing page and README.

- [#701](https://github.com/IgorGanapolsky/ThumbGate/pull/701) [`0a773dd`](https://github.com/IgorGanapolsky/ThumbGate/commit/0a773dd6babfe9c70c1fa9d2623fa84ff3e60b82) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Publish a standalone Codex plugin zip, direct-download release aliases, and the matching GitHub Actions release workflow.

- [#835](https://github.com/IgorGanapolsky/ThumbGate/pull/835) [`c0024cd`](https://github.com/IgorGanapolsky/ThumbGate/commit/c0024cd32ec77c1412fe31724a3d78baba31663e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Lead public marketing, README, LLM context, and ChatGPT GPT instructions with
  costly AI mistake prevention outcomes while clarifying that the GPT provides
  advice/checkpointing and hard enforcement runs through the local ThumbGate
  Reliability Gateway.

- [#657](https://github.com/IgorGanapolsky/ThumbGate/pull/657) [`5a16509`](https://github.com/IgorGanapolsky/ThumbGate/commit/5a16509868f73cee5aaf0c59e8bad655e82ee3e7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Bound Railway deploy health checks with explicit curl timeouts so unhealthy releases fail predictably instead of stalling verification indefinitely.

- [#681](https://github.com/IgorGanapolsky/ThumbGate/pull/681) [`8400073`](https://github.com/IgorGanapolsky/ThumbGate/commit/8400073b496cd0eea33778ba022c3cf673dae883) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Give live GitHub About verification a longer CI retry window so post-merge mainline checks do not fail on transient GitHub metadata propagation lag.

- [#669](https://github.com/IgorGanapolsky/ThumbGate/pull/669) [`c8f0c0a`](https://github.com/IgorGanapolsky/ThumbGate/commit/c8f0c0a3d87fc457b9b485e0ba7a9da64cd51bea) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Include .well-known/ in Docker image so llms.txt is served in production

- [#678](https://github.com/IgorGanapolsky/ThumbGate/pull/678) [`eb35983`](https://github.com/IgorGanapolsky/ThumbGate/commit/eb35983d50339a7e5241645403eb087b8ac1a6a1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Remove brittle hardcoded verification-count claims from docs and landing page; add docs-claim-hygiene regression test.

- [#848](https://github.com/IgorGanapolsky/ThumbGate/pull/848) [`804a284`](https://github.com/IgorGanapolsky/ThumbGate/commit/804a28406eb511c6be9147d2e2b1c2eb47550534) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Clarify the first-dollar activation path across the landing page, README, and ChatGPT GPT docs so cold users start by proving one blocked repeated mistake before upgrading to Pro or entering the Workflow Hardening Sprint.

- [#842](https://github.com/IgorGanapolsky/ThumbGate/pull/842) [`8ea4a16`](https://github.com/IgorGanapolsky/ThumbGate/commit/8ea4a16f49fa9322ff142b580fa16287796be1bd) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add first-party marketing link routing and conversion-funnel telemetry so ThumbGate can attribute GPT, install, Pro checkout, and trial-email intent without adding Branch.io.

- [#666](https://github.com/IgorGanapolsky/ThumbGate/pull/666) [`622630b`](https://github.com/IgorGanapolsky/ThumbGate/commit/622630bc056165a76b4505f686caf3deba623e4b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Narrow Railway deploy detection so shell-only script changes like the Claude statusline do not trigger production deploys, while runtime JavaScript modules still do.

- [#784](https://github.com/IgorGanapolsky/ThumbGate/pull/784) [`9c9bcab`](https://github.com/IgorGanapolsky/ThumbGate/commit/9c9bcab28b3478cdeed33b1a5dc9b3bba272c03b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix checkout mode from one-time payment to monthly subscription. Corrects billing.ts to use mode: 'subscription' with the $19/mo price instead of mode: 'payment' with the $49 one-time price. Updates auth.ts error message to match.

- [#693](https://github.com/IgorGanapolsky/ThumbGate/pull/693) [`2be9345`](https://github.com/IgorGanapolsky/ThumbGate/commit/2be93457916984ecbd30249325ef3351d2916655) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Restore clickable Claude statusline affordances for ThumbGate. The packaged statusline once again exposes OSC 8 hyperlinks for `👍`, `👎`, `Dashboard`, and `Lessons`, auto-boots the local Pro dashboard server when needed, and prefers the installed runtime binary over repeated `npm exec` launches.

- [#775](https://github.com/IgorGanapolsky/ThumbGate/pull/775) [`a9145d1`](https://github.com/IgorGanapolsky/ThumbGate/commit/a9145d152949f09cdab1e840aaf56013eaca98bb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Close 7 enforcement loop gaps that caused 1:33 thumbs ratio. Lower auto-promote thresholds (WARN 2, BLOCK 3), fix auto-gates overwrite bug, add compiled guard staleness check, broaden memory guard to all write operations, and inject behavioral context on every tool call.

- [#747](https://github.com/IgorGanapolsky/ThumbGate/pull/747) [`6b09d59`](https://github.com/IgorGanapolsky/ThumbGate/commit/6b09d59c8b2d0cba358e13e6189e02270d175c16) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix hosted billing fetch in proxy environments. Node.js native fetch (undici) does not honour HTTPS_PROXY env vars; bootstraps ProxyAgent when a proxy URL is detected so `node bin/cli.js cfo --today` works correctly in sandboxed or corporate network environments.

- [#846](https://github.com/IgorGanapolsky/ThumbGate/pull/846) [`c988ea8`](https://github.com/IgorGanapolsky/ThumbGate/commit/c988ea8e1a074250ccd7157e01cd5e0be8aa9e1e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Include public/lessons.html and public/index.html in npm package. The server
  reads these at runtime — excluding them degrades the lessons UI to a stub page.
  Added CI test to prevent this regression.

- [#843](https://github.com/IgorGanapolsky/ThumbGate/pull/843) [`83ec53d`](https://github.com/IgorGanapolsky/ThumbGate/commit/83ec53dff0da18e41ccccc12f8563b0d84a53076) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix hash navigation on Lessons page: scrollIntoView silently failed on elements
  inside hidden tabs (display:none). Now switches to the correct tab before querying
  for the target element. Statusbar "Latest mistake" links now scroll to the right
  rule card.

- [#803](https://github.com/IgorGanapolsky/ThumbGate/pull/803) [`ccea486`](https://github.com/IgorGanapolsky/ThumbGate/commit/ccea48621ff2a7d90f4a14efabd62d0a98aa2922) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix operator key blocked by general auth gate when THUMBGATE_API_KEY is also set. The general isAuthorized gate only checked the admin key, causing operator key requests to get 401 before reaching the billing/summary endpoint handler. Now the operator key is allowed to bypass the general gate specifically for GET /v1/billing/summary.

- [#814](https://github.com/IgorGanapolsky/ThumbGate/pull/814) [`ed86638`](https://github.com/IgorGanapolsky/ThumbGate/commit/ed8663876b084a840a0712b9a97862ffbd84c391) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix wire-hooks to clean stale project-level Claude Code hooks referencing missing files. Previously only cleaned user-level settings, leaving broken hooks in .claude/settings.json that caused "UserPromptSubmit hook error".

- [#827](https://github.com/IgorGanapolsky/ThumbGate/pull/827) [`d356712`](https://github.com/IgorGanapolsky/ThumbGate/commit/d3567126ac4881c7201d4ed29d23945fa75fd1fe) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix: make Dashboard and Lessons links clickable in Claude Code statusbar using OSC 8 terminal hyperlinks

- [#776](https://github.com/IgorGanapolsky/ThumbGate/pull/776) [`0efa4fa`](https://github.com/IgorGanapolsky/ThumbGate/commit/0efa4faac3e4c025a8970ee54c1a9286ffcf6398) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Make statusbar lesson text readable: prefer structured rule actions over raw feedback, increase truncation to 60 chars, strip localhost links from display.

- [#741](https://github.com/IgorGanapolsky/ThumbGate/pull/741) [`1d63aa7`](https://github.com/IgorGanapolsky/ThumbGate/commit/1d63aa7ef1cbca549d11aa4eca7ee1862a9432f4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix test fixture isolation: disable commit signing in temp git repos and use empty feedback dir in workflow-sentinel unit tests so CI environments with signing servers and accumulated learned-policy data don't cause false failures.

- [#841](https://github.com/IgorGanapolsky/ThumbGate/pull/841) [`f420136`](https://github.com/IgorGanapolsky/ThumbGate/commit/f42013663b6288837c90feeb97db09f775098de1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix Stripe webhook handler silently dropping all paid events when STRIPE_WEBHOOK_SECRET is not configured. When no webhook secret is set, skip stripe.webhooks.constructEvent (which always throws on empty secret) and parse the raw body directly — consistent with verifyWebhookSignature which is already lenient in this case.

- [#834](https://github.com/IgorGanapolsky/ThumbGate/pull/834) [`7df6108`](https://github.com/IgorGanapolsky/ThumbGate/commit/7df61081479b99040f445d5e30a719b06ce1c345) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix: lead with free CLI install as primary CTA, make Pro secondary

  10 visitors clicked "Start 7-day free trial" but 0 completed checkout because
  Stripe requires a credit card upfront. Flip the CTA strategy: lead with the
  zero-friction free CLI install (`npx thumbgate init`) as the hero action, and
  position Pro as the upgrade path once users hit free tier limits (3 captures/day).

  Changes:

  - Hero: `npx thumbgate init` is now the prominent hero element with enlarged
    copy-to-clipboard; "Install Free CLI" is the primary button; "Upgrade to Pro"
    is smaller and secondary
  - Sticky bottom bar: leads with `npx thumbgate init` copy command, "Go Pro" is
    a smaller secondary link
  - Final CTA section: install command and free CLI link are primary, Pro is
    secondary
  - Pricing section: Free tier gets cyan highlight border, "Most Popular" badge,
    and inline install command; Pro card border demoted
  - PostHog events updated: `hero_install_click`, `hero_pro_click`,
    `sticky_pro_click`, `final_install_click`, `final_pro_click`
  - Tests updated to match new CTA text patterns

- [#661](https://github.com/IgorGanapolsky/ThumbGate/pull/661) [`bf9ae08`](https://github.com/IgorGanapolsky/ThumbGate/commit/bf9ae089f14a3edc40c2ae93afb1c1ac83dca0e9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fail Railway deploys early when the required `THUMBGATE_API_KEY` runtime secret is missing or empty.

- [#783](https://github.com/IgorGanapolsky/ThumbGate/pull/783) [`b912807`](https://github.com/IgorGanapolsky/ThumbGate/commit/b9128070f9381c9a708093cec7f9fec898c055b0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep gate-denial audit events out of user-facing feedback statistics, including the local summary view, while preserving separate gate-event analytics for Reliability Gateway enforcement.

- [#851](https://github.com/IgorGanapolsky/ThumbGate/pull/851) [`6972f40`](https://github.com/IgorGanapolsky/ThumbGate/commit/6972f4009e0f91a47832cdb6bbfaa85991345835) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden the GitHub CI release process by using the tested changeset checker in PR workflows, trimming duplicate npm publish validation, and adding slower npm registry propagation retries to package smoke tests.

- [#665](https://github.com/IgorGanapolsky/ThumbGate/pull/665) [`588956d`](https://github.com/IgorGanapolsky/ThumbGate/commit/588956defd9e3fdc1f8033d142f9194ea67b18da) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Prevent hosted boot crashes when operational integrity loads without git on the runtime image, and install git in the Railway container so integrity checks can execute after startup.

- [#725](https://github.com/IgorGanapolsky/ThumbGate/pull/725) [`19417e1`](https://github.com/IgorGanapolsky/ThumbGate/commit/19417e103497d8b4e042812638597b4e6159687e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Google Cloud agent safety framework alignment to public proof and LLM context surfaces.

- [#653](https://github.com/IgorGanapolsky/ThumbGate/pull/653) [`5bbf039`](https://github.com/IgorGanapolsky/ThumbGate/commit/5bbf039adabdede600d6a7d0a26a1dce041898d2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden operational integrity git revision validation so unsafe refs and commit
  arguments are rejected before invoking git, and add regression coverage for the
  SonarCloud command-argument findings.

- [#654](https://github.com/IgorGanapolsky/ThumbGate/pull/654) [`2043ab0`](https://github.com/IgorGanapolsky/ThumbGate/commit/2043ab06e4aa18fd5950cc53c9a5a4a22b2c060e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refocus the public buyer path around the Workflow Hardening Sprint, align Team pricing and messaging with commercial truth, and add a first-dollar execution playbook plus warm outreach scripts for turning one qualified workflow into the next booked pilot.

- [#689](https://github.com/IgorGanapolsky/ThumbGate/pull/689) [`0467bf1`](https://github.com/IgorGanapolsky/ThumbGate/commit/0467bf11353b1d6a57a8c1b08081a075976e29c1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden HTML sanitization in document-intake to resolve SonarCloud security hotspots, fix malformed tag handling, and restore SonarCloud branch protection CI config.

- [#692](https://github.com/IgorGanapolsky/ThumbGate/pull/692) [`7f962ea`](https://github.com/IgorGanapolsky/ThumbGate/commit/7f962ea3dc982582d5865076038a0a8e8f73f5e7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden merge integrity enforcement, add branch protection tests to npm parity checks, fix SonarCloud gh CLI security findings.

- [#752](https://github.com/IgorGanapolsky/ThumbGate/pull/752) [`f0de3f0`](https://github.com/IgorGanapolsky/ThumbGate/commit/f0de3f01bf0d428fdd6e9c9fd9cddf20ef038576) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Rewrite the landing page hero to lead with pain, not solution category. New H1: 'Your AI agent just made that mistake again. One thumbs-down. It never happens again.' Concrete session 1 → session 2 before/after replaces consultant-speak. Primary CTA is now the install command. Title and meta description updated to match.

- [#733](https://github.com/IgorGanapolsky/ThumbGate/pull/733) [`26f8b8e`](https://github.com/IgorGanapolsky/ThumbGate/commit/26f8b8e2d16537f42e7250babd50e63b9cc5f9ed) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add prominent "Install for Your Agent" sections to README and landing page with per-agent commands

- [#664](https://github.com/IgorGanapolsky/ThumbGate/pull/664) [`c491470`](https://github.com/IgorGanapolsky/ThumbGate/commit/c49147088efa6a56047264d22499764a86f8e915) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix Claude Code statusline feedback counts when the hook runs from the ThumbGate runtime directory by honoring the session's project cwd.

- [#791](https://github.com/IgorGanapolsky/ThumbGate/pull/791) [`67de961`](https://github.com/IgorGanapolsky/ThumbGate/commit/67de961556ada7f9914246c361961f22cdfe6a94) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add prominent checkout CTAs to landing page hero, pricing card, final section, and sticky bottom bar

- [#668](https://github.com/IgorGanapolsky/ThumbGate/pull/668) [`471f140`](https://github.com/IgorGanapolsky/ThumbGate/commit/471f1408bc78c45da722726178feb9e681449e73) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Serve llms.txt from public route without auth so LLM crawlers can discover ThumbGate

- [#812](https://github.com/IgorGanapolsky/ThumbGate/pull/812) [`66277a7`](https://github.com/IgorGanapolsky/ThumbGate/commit/66277a7adfd6778a0c4954339ea4408e5bc63848) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(ci): autonomous marketing autopilot every 4 hours — video, text posts, Reddit, Dev.to

  - video-autopilot.yml: generates slide-based MP4 (6 rotating templates), posts to TikTok/YouTube/Instagram via Zernio every 4 hours with per-platform cooldowns
  - marketing-autopilot.yml: rewritten to fire every 4 hours (was Mon/Wed/Fri), all secrets wired (DEVTO_API_KEY, Reddit password OAuth, full X API), fixed reddit.publishToReddit() call, added Dev.to article step with 7-day dedup
  - marketing-db.js: SQLite dedup + analytics tracker prevents double-posting
  - post-video.js: full slide→ffmpeg→Zernio pipeline

- [#839](https://github.com/IgorGanapolsky/ThumbGate/pull/839) [`4787185`](https://github.com/IgorGanapolsky/ThumbGate/commit/47871852b109ab89f5eff3dda8c627ef77c5cfdb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Switch CLI upgrade link to no-card 7-day trial — 2,478 cloners seeing card-required checkout was killing conversion.

- [#670](https://github.com/IgorGanapolsky/ThumbGate/pull/670) [`2b49a4a`](https://github.com/IgorGanapolsky/ThumbGate/commit/2b49a4af707ed69782427c9c905c27cd568cd79b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Retry published runtime smoke installs after transient npm registry propagation misses so successful releases do not fail their post-publish verification step.

- [#825](https://github.com/IgorGanapolsky/ThumbGate/pull/825) [`e77aa38`](https://github.com/IgorGanapolsky/ThumbGate/commit/e77aa38221974fc31285857fb7b167a8b4463e9b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden package and Claude plugin boundaries so generated runtime state cannot leak into npm tarballs and Claude plugin skill paths remain spec-compliant.

- [#788](https://github.com/IgorGanapolsky/ThumbGate/pull/788) [`2e3bb77`](https://github.com/IgorGanapolsky/ThumbGate/commit/2e3bb775f94458e1dc3e641a1f4b745207facb1e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a Perplexity Max command center for AI-search visibility checks, Search API lead discovery, Agent API acquisition briefs, and official Perplexity MCP config generation.

- [#751](https://github.com/IgorGanapolsky/ThumbGate/pull/751) [`01bebb7`](https://github.com/IgorGanapolsky/ThumbGate/commit/01bebb7c69f716b8fdafcbcdd6a1cf4b8f9a3961) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Wire PostHog analytics into the landing page for funnel visibility. Tracks four CTA events: workflow_sprint, install_codex, install_claude, and pro_upgrade. API key is now server-injected via the **POSTHOG_API_KEY** placeholder in hostedConfig, not hardcoded in the HTML.

- [#806](https://github.com/IgorGanapolsky/ThumbGate/pull/806) [`4ce250d`](https://github.com/IgorGanapolsky/ThumbGate/commit/4ce250d08658590ab2470b847f8c8d1539257da5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add automatic $pageview tracking and PostHog reverse proxy for ad-blocker bypass

  - Added posthog.capture('$pageview') after init to track all landing page visits
  - Added /ingest reverse proxy route in server.js to forward PostHog events through own domain
  - Changed PostHog api_host from us.i.posthog.com to /ingest to bypass ad blockers

- [#676](https://github.com/IgorGanapolsky/ThumbGate/pull/676) [`4aa3794`](https://github.com/IgorGanapolsky/ThumbGate/commit/4aa379422fa0e7451ceeb80999d26820b342d178) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden merge integrity by blocking failed quality gates, syncing branch protection to the audited required checks, and verifying the legacy Stripe webhook signature path.

- [#709](https://github.com/IgorGanapolsky/ThumbGate/pull/709) [`dadb030`](https://github.com/IgorGanapolsky/ThumbGate/commit/dadb030e408cc6ae3e509772dc6723e44989e3fc) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden public pricing congruence checks so retired ThumbGate pricing experiments cannot reappear in buyer-facing docs.

- [#696](https://github.com/IgorGanapolsky/ThumbGate/pull/696) [`46f7c4a`](https://github.com/IgorGanapolsky/ThumbGate/commit/46f7c4a9e895365dd3404156d38049691a9ba511) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Align Team pricing across the public landing page, README, marketing materials,
  runtime commercial constants, and congruence tests at $99/seat/mo with a 3-seat
  minimum.

- [#691](https://github.com/IgorGanapolsky/ThumbGate/pull/691) [`d733437`](https://github.com/IgorGanapolsky/ThumbGate/commit/d733437cf692b878fa9a1f27902643c6326fbee2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden LLM rule generation with expert role framing, few-shot examples, and chain-of-thought reasoning; include what_went_wrong/what_to_change fields in batch context; upgrade to claude-sonnet-4-6 for rule analysis; add Stage 6 token-budget enforcement to compactContext; group toRules output by severity with action labels.

- [#662](https://github.com/IgorGanapolsky/ThumbGate/pull/662) [`fdeffc9`](https://github.com/IgorGanapolsky/ThumbGate/commit/fdeffc98490fbdb01990d68acc0c5e794b594016) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Capture Railway service diagnostics on deploy health-check failures and add a manual Railway diagnostics workflow for restart, redeploy, and live log inspection.

- [#778](https://github.com/IgorGanapolsky/ThumbGate/pull/778) [`1356942`](https://github.com/IgorGanapolsky/ThumbGate/commit/135694227b3d95a08b3d99ce1c0916014b368c83) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Trim Ralph Mode X credentials before signing requests without logging credential prefixes in CI output.

- [#771](https://github.com/IgorGanapolsky/ThumbGate/pull/771) [`93e351f`](https://github.com/IgorGanapolsky/ThumbGate/commit/93e351f75554687afd215008c2b8cb98e3a4eeb3) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Ralph Mode CI workflow for 24/7 automated engagement via GitHub Actions

- [#795](https://github.com/IgorGanapolsky/ThumbGate/pull/795) [`cfeff43`](https://github.com/IgorGanapolsky/ThumbGate/commit/cfeff433e8f30fd881d4ba0270715c0112f87b7a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Stop Ralph Mode from reporting failed X API posts or replies as successful audience-engagement actions.

- [#848](https://github.com/IgorGanapolsky/ThumbGate/pull/848) [`804a284`](https://github.com/IgorGanapolsky/ThumbGate/commit/804a28406eb511c6be9147d2e2b1c2eb47550534) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add npm publish receipt metadata and a downloadable full release-notes artifact to the publish workflow, so npm's bare "Successfully published" email can be reconciled with complete Changeset-backed release notes, tarball URL, shasum, and verification evidence.

- [#837](https://github.com/IgorGanapolsky/ThumbGate/pull/837) [`4580274`](https://github.com/IgorGanapolsky/ThumbGate/commit/45802749554b54b660a92ffa5243f1f8ea95505a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Generate full Changeset-backed release notes during the npm publish workflow, write them into the GitHub Release, upload them as a release asset, and copy them into the GitHub Actions summary linked from npm's publish email.

- [#693](https://github.com/IgorGanapolsky/ThumbGate/pull/693) [`2be9345`](https://github.com/IgorGanapolsky/ThumbGate/commit/2be93457916984ecbd30249325ef3351d2916655) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Restore clickable statusline affordances, harden localhost links, and restore statusline test parity.

- [#686](https://github.com/IgorGanapolsky/ThumbGate/pull/686) [`c8a544d`](https://github.com/IgorGanapolsky/ThumbGate/commit/c8a544dad95070347721dde8c1c582566980fae4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Block raw GitHub auto-merge paths and require terminal quality-check validation before autonomous PR merges.

- [#828](https://github.com/IgorGanapolsky/ThumbGate/pull/828) [`a1828a9`](https://github.com/IgorGanapolsky/ThumbGate/commit/a1828a97028f5ec82ceced3657d7fe3f09d00126) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Slim the npm package boundary by moving the package main entrypoint to `src/index.js`, publishing only runtime-required files, and adding tarball budget tests that block public marketing assets, plugin bundles, and social automation from shipping to npm.

- [#658](https://github.com/IgorGanapolsky/ThumbGate/pull/658) [`f07c657`](https://github.com/IgorGanapolsky/ThumbGate/commit/f07c65707b1d8503c37d6d943a1d4748ea6c6a2f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Stamp default-branch SonarCloud refreshes with a unique package-version-plus-commit identifier so mainline quality checks reset cleanly without weakening strict PR quality-gate enforcement.

- [#677](https://github.com/IgorGanapolsky/ThumbGate/pull/677) [`52a51ed`](https://github.com/IgorGanapolsky/ThumbGate/commit/52a51edc8e644af507623f74e096bbaa93260eb7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add 3 pre-action gates for Microsoft SQL MCP Server: block delete_record, warn on execute_entity DDL, block bulk updates.

- [#731](https://github.com/IgorGanapolsky/ThumbGate/pull/731) [`6e07853`](https://github.com/IgorGanapolsky/ThumbGate/commit/6e07853f526e8e6d86536c5739cfb528233e9633) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Clarify the Claude statusbar lesson chip so it shows the latest mistake with a timestamp and deep link, and falls back to the latest success when no mistakes exist.

- [#790](https://github.com/IgorGanapolsky/ThumbGate/pull/790) [`02fe6cb`](https://github.com/IgorGanapolsky/ThumbGate/commit/02fe6cb612c79bddd3da3037d240926f73114622) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Scope statusline feedback stats to the active project and keep the Pre-Action Gates cross-encoder reranker covered by the root CI test suite.

- [#772](https://github.com/IgorGanapolsky/ThumbGate/pull/772) [`382eeb7`](https://github.com/IgorGanapolsky/ThumbGate/commit/382eeb78aae5791c364b4476932ce8da4012b9ac) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add an audited Stripe webhook signing-secret rotation workflow. The workflow creates a fresh billing webhook endpoint, stores the returned signing secret in GitHub Actions secrets, updates rotation timestamp variables, and keeps deploy-policy evidence aligned without exposing secret values.

- [#663](https://github.com/IgorGanapolsky/ThumbGate/pull/663) [`62979f5`](https://github.com/IgorGanapolsky/ThumbGate/commit/62979f524f9384884b931b4848bad53648e5e199) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Skip Railway deploys when a main push only changes workflows, tests, or changesets and leaves runtime-serving files untouched.

- [#813](https://github.com/IgorGanapolsky/ThumbGate/pull/813) [`46122d5`](https://github.com/IgorGanapolsky/ThumbGate/commit/46122d59b3dbeb5909b53b7ef6f1e80cdeefaf04) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add ThumbGate Bench, a deterministic pre-action gate benchmark with mock workflow scenarios, safety/capability metrics, report artifacts, documentation, and CI test coverage.

- [#682](https://github.com/IgorGanapolsky/ThumbGate/pull/682) [`510b6e8`](https://github.com/IgorGanapolsky/ThumbGate/commit/510b6e87ba04020e899526b83cb3bb07df1f06d0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Split the short GitHub repo description from the richer landing-page meta description so GitHub About sync can succeed without weakening the website metadata.

- [#695](https://github.com/IgorGanapolsky/ThumbGate/pull/695) [`251f24f`](https://github.com/IgorGanapolsky/ThumbGate/commit/251f24fa096007ad41e8349038ee0cbe2a556cc5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Submit main-branch automerge requests to Trunk without polling helper workflow checks or waiting for a final merge commit inside GitHub Actions.

- [#700](https://github.com/IgorGanapolsky/ThumbGate/pull/700) [`f8496e6`](https://github.com/IgorGanapolsky/ThumbGate/commit/f8496e6e9d666c4b4b361fd8f82e2a71298f4939) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Treat Zernio monthly post-limit responses as controlled social-publisher skips so the daily acquisition workflow does not mark main unhealthy when the external posting budget is exhausted. Also isolate Trunk merge comment automation from shared personal access token rate limits.

## 1.3.0

### Minor Changes

- [#643](https://github.com/IgorGanapolsky/ThumbGate/pull/643) [`abdae7d`](https://github.com/IgorGanapolsky/ThumbGate/commit/abdae7dcdf040856649a0975902aac74a347b441) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add GLM 5.1 as a zero-cost local frontier tier. Self-hosting GLM 5.1 (open-source, SWE-Bench Pro SOTA) eliminates frontier API spend: `localFrontier` tier has `costMultiplier: 0.0` and no token budget enforcement. Set `THUMBGATE_LOCAL_MODEL_FAMILY=glm-*` to activate automatic frontier → localFrontier routing in `recommendExecutionPlan`.

### Patch Changes

- [#644](https://github.com/IgorGanapolsky/ThumbGate/pull/644) [`fd1aa82`](https://github.com/IgorGanapolsky/ThumbGate/commit/fd1aa82164c5a00c374493abea60a46d4f5446db) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add packaged-runtime smoke proof: installs the npm artifact into a clean prefix and validates the shipped dashboard, lessons, and thumbs quick links before any publish step; prevents packaged runtime regressions from reaching npm or Claude release assets.

- [#645](https://github.com/IgorGanapolsky/ThumbGate/pull/645) [`6fcaeb8`](https://github.com/IgorGanapolsky/ThumbGate/commit/6fcaeb8b35185958f632d5ef6135e5d9a6fc59e9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix 59 pre-existing test failures: add `commit.gpgsign=false` to temp-repo helpers so tests work in signing-enforced environments; make `trackEvent` respect `THUMBGATE_API_URL` to prevent DNS hangs in sandboxed CI; add `process.exit(0)` to unlicensed pro command paths for clean CLI exit.

- Improve feedback proof surfaces by adding a daily gate-audit series to the Lessons timeline, making day-level activity clickable, and backfilling missed Claude thumbs signals before local counts render.

- [#640](https://github.com/IgorGanapolsky/ThumbGate/pull/640) [`347ce33`](https://github.com/IgorGanapolsky/ThumbGate/commit/347ce332ad663b2d78e2bd7e38d084eebddacb50) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add lesson count, latest lesson snippet, and dashboard link to Claude Code statusline. Previously only showed version, tier, and feedback counts.

- [#649](https://github.com/IgorGanapolsky/ThumbGate/pull/649) [`99816f8`](https://github.com/IgorGanapolsky/ThumbGate/commit/99816f8d9b7141e9a1ba482283545aacd3b97007) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Strengthen the enterprise release-confidence story across the README, docs, and landing pages so package publishes clearly show their Changeset coverage, SemVer discipline, verification evidence, and exact-merge proof chain.

- [#650](https://github.com/IgorGanapolsky/ThumbGate/pull/650) [`102026a`](https://github.com/IgorGanapolsky/ThumbGate/commit/102026a116cd29b60af342203138b7d3e8bee66a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Compact the Claude statusline so dashboard and lesson links stay visible under tight width budgets, even when recent lesson text is long.

- [#642](https://github.com/IgorGanapolsky/ThumbGate/pull/642) [`1e098ec`](https://github.com/IgorGanapolsky/ThumbGate/commit/1e098ec8a562213afa77a846609447ece87fadaa) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Retry live GitHub About verification after sync so mainline CI does not fail on GitHub metadata propagation delays.

## 1.2.0

### Minor Changes

- [#637](https://github.com/IgorGanapolsky/ThumbGate/pull/637) [`d1e83c9`](https://github.com/IgorGanapolsky/ThumbGate/commit/d1e83c9dffb0fb84a7e081d7474a697a94327d28) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add @changesets/cli for auditable release management. Every feat/fix PR now requires a changeset file describing the change and semver impact. CHANGELOG.md backfilled from 0.9.5 through 1.1.0. CI workflow enforces changeset presence on feature PRs.

- [#634](https://github.com/IgorGanapolsky/ThumbGate/pull/634) [`3e580af`](https://github.com/IgorGanapolsky/ThumbGate/commit/3e580affc3b46d72c77382773d6e1bdc22cf1bc6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Docker sandbox routing guidance for risky local autonomy and introduce an enforced Changesets-based release record so version bumps and customer-facing release notes stay explicit.

### Patch Changes

- [#639](https://github.com/IgorGanapolsky/ThumbGate/pull/639) [`181da25`](https://github.com/IgorGanapolsky/ThumbGate/commit/181da252c7b77f4e39dbf273a9e34c1545590089) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Restore clickable Claude statusline affordances for ThumbGate. The packaged statusline once again exposes OSC 8 hyperlinks for `👍`, `👎`, `Dashboard`, and `Lessons`, auto-boots the local Pro dashboard server when needed, and prefers the installed runtime binary over repeated `npm exec` launches.

## [1.1.0] - 2026-04-08

### Added

- **HuggingFace Dataset Export**: New `export_hf_dataset` MCP tool and `npm run export:hf` CLI command. Exports PII-redacted agent traces (traces.jsonl) and DPO preference pairs (preferences.jsonl) as HuggingFace-compatible datasets with dataset_info.json metadata.
- **Unified Context Manager**: `unified_context` MCP tool provides one-call context assembly combining session state, user profile, relevant lessons, prevention guards, context pack, and code-graph impact. Tiered graceful degradation: full, warm, cold.
- **Role-Aware Context Filtering**: Agent profiles (Claude, Cursor, ForgeCode, Codex) shape context budget, lesson count, and feature inclusion per agent type.
- **Changesets**: Added `@changesets/cli` for auditable release management with auto-generated changelogs.

## [1.0.0] - 2026-04-08

### Added

- **ForgeCode Adapter**: `npx thumbgate init --agent=forge` scaffolds ForgeCode agent integration.
- **Workflow Sentinel**: Pre-tool guard that predicts workflow failures before execution.
- **Durable Hosted Jobs**: API server supports long-running job execution with status polling.
- **Buyer-Intent Geo Pages**: SEO landing pages for location-based discovery.
- **Daily Revenue Loop**: GitHub Actions workflow for automated revenue tracking.
- **Plausible Analytics**: Privacy-first analytics across all public pages.

### Changed

- Scoped dashboard and status to active project context.
- Extended Railway rollout verification window for more reliable deploys.
- Closed all duplicate social posting code paths.

## [0.9.9] - 2026-04-05

### Changed

- Social quality gate wired into all publishers — blocks bot slop before posting.
- Dependency bumps: Stripe 22.0, Playwright 1.59, dotenv 17.4, HuggingFace Transformers 4.0.

### Fixed

- Hardened coverage and verification gates for CI stability.
- Inferred tags for promotable feedback signals.

## [0.9.5] - 2026-04-03

### Added

- **Landing Page Repositioning**: Visual diagrams, "bad AI PRs" messaging, self-improving agents positioning.
- **Social Posting Strategy**: Overhauled based on top SaaS research.
- **Governance Hardening**: Integrity governance assertions stabilized.

### Fixed

- Restored dashboard and lesson follow-up state.
- Removed legacy RLHF references.
- Repaired release health for Railway and npm publish.

## [0.9.4] - 2026-04-02

### Added

- **Conversation Window Capture**: `capture_feedback` now accepts a `conversationWindow` parameter — an array of the last 5-10 conversation turns. Raw messages are stored alongside feedback for full context awareness.
- **Structured IF/THEN Lesson Inference**: New `lesson-inference.js` module extracts structured rules from conversation windows with trigger/action/confidence/scope classification.
- **Per-Action Lesson Retrieval**: New `retrieve_lessons` MCP tool returns top-K relevant lessons for a given tool/action context using keyword matching, file path overlap, recency decay, and signal weighting.
- **Reflector Agent**: Self-healing post-mortem system. On negative feedback with conversation context, automatically analyzes what went wrong, checks for recurrence, and proposes a specific rule back to the user.
- **Statusbar Lesson Link**: Claude Code statusbar now displays the latest lesson with memory ID, signal icon, summary, and conversation turn count after every feedback capture.

### Changed

- `captureFeedback` enriches `whatWentWrong`/`whatWorked` from conversation window when caller doesn't provide them.
- Memory records now include `structuredRule` (IF/THEN format) and `conversationWindow` (capped at 10 messages, 500 chars each).
- Statusline cache includes `last_lesson` metadata for real-time statusbar updates.

### Performance

- All changes are backwards compatible — `conversationWindow` is optional. Omitting it preserves existing behavior.

## [0.9.0] - 2026-04-02

### Fixed

- **Stripe API timeout**: All Stripe API calls in billing pipeline now have a 5-second timeout via `Promise.race`, preventing indefinite hangs when Stripe is slow or rate-limited (`scripts/billing.js`).
- **SQLite WAL lock hangs**: Added `busy_timeout = 3000` pragma to all SQLite database connections, preventing deadlocks when multiple processes contend for the WAL lock (`lesson-db.js`, `store.js`, `github.js`).
- **Duplicate server instances**: Lock file detection now exits fatally when an active server PID exists, and cleans stale locks from dead processes (`server-stdio.js`).

### Performance

- **MCP tool call latency**: `capture_feedback`, `feedback_stats`, `recall`, `feedback_summary`, and `prevention_rules` now skip metric gate evaluation entirely — eliminating the 5-minute stall caused by live Stripe API calls on every tool invocation (`gates-engine.js`).
- **readJSONL tail-read**: Large JSONL files (300KB+) now default to reading only the last 500 lines instead of the entire file, reducing event loop blocking during feedback capture (`feedback-loop.js`).
- **Metric gate timeout**: Non-feedback tools now have a 3-second fail-open timeout on metric gate evaluation, preventing cascading hangs.

### Changed

- `getBillingSummaryLive()` returns a safe default object on any failure (timeout or otherwise) instead of throwing, so metric gates degrade gracefully.
- `readJSONL()` accepts `{ maxLines }` option; callers needing all entries pass `{ maxLines: 0 }`.

## 0.8.2 - 2026-03-26

- Bumped all version surfaces to 0.8.2 (package.json, server.json, mcpize.yaml, landing page).
- Branch coverage improvements: added tests for 10 lowest-coverage files and 15 previously untested scripts.
- Railway deploy fix: switched to `--detach` mode with health-check polling to avoid intermittent "Failed to retrieve build log" CLI streaming errors.

## 0.8.1 - 2026-03-26

- Unified ThumbGate branding across all public surfaces (README, AGENTS.md, CLAUDE.md, GEMINI.md, landing page, package.json).
- Landing page SEO: "human-in-the-loop enforcement", "vibe coding" positioning, FAQPage JSON-LD schema for Google rich results.
- Added congruence CI check (`scripts/check-congruence.js`) — enforces version, branding, tech stack terms, and honest disclaimer across README and landing page on every PR.
- Performance: deferred non-critical side-effects in `captureFeedback` (contextFs, RLAIF self-audit) via `setImmediate`.
- Added `_captureMs` timing field to accepted feedback responses for observability.
- Added `mcpize.yaml` to version sync targets.
- Dead code removal: -1,551 lines (contract-audit.js, prove-rlaif.js, stale landing-page.html, 3 duplicate docs).
- Fixed GitGuardian incident #29200799: scrubbed hardcoded Google API key from git history.
- Social automation pipeline: post-everywhere CLI, reply monitor with AutoMod-safe Reddit posts.
- TDS article draft: "Beyond Prompt Rules: How Pre-Action Gates Stop AI Coding Agents From Repeating Mistakes".

## 0.8.0 - 2026-03-25

- **Lesson DB:** SQLite + FTS5 full-text search replaces linear Jaccard token-overlap. Sub-millisecond ranked search indexed by signal, domain, tags, importance.
- **Corrective actions:** On negative feedback, `capture_feedback` returns `correctiveActions[]` — top 3 remediation steps inferred from similar past failures.
- **search_lessons MCP tool:** Exposes corrective actions, lifecycle state, linked rules, linked gates, and next harness fixes per lesson.
- **search_thumbgate MCP tool:** Searches raw ThumbGate state across feedback logs, ContextFS memory, and prevention rules.
- **Rejection ledger:** Tracks why vague feedback was rejected with revival conditions.
- **Bayesian belief updates:** Each memory carries a posterior that updates on new evidence; high-entropy contradictions auto-prune.

## 0.7.4 - 2026-03-20

- Added `session_handoff` and `session_primer` MCP tools for seamless cross-session context continuity.
- New `session` namespace in ContextFS stores primer.json with auto-captured git state (branch, last 5 commits, modified files, working tree status), last completed task, next step, and blockers.
- `session_handoff` records provenance events for full audit trail of session transitions.
- Closes Layer 2 (primer.md) of the 5-layer memory stack — no manual primer file needed.

## 0.6.11 - 2026-03-10

- Added Inverse Sink Weighting and Anchor-Memory management to prevent runaway negative memory accumulation and stabilize agent behavior over long sessions.
- Hardened MCP startup reliability: retry logic, process health checks, and graceful degradation on server init failures.
- North Star Phase 1: KTO export pipeline, MCP install workflow, and FDD (Feedback-Driven Development) rebrand replacing prior loop branding.
- System hygiene: documented session directives in CLAUDE.md and fixed environment-dependent billing test failures causing flaky CI.
- A2UI model for dynamic agent-to-user interaction: agents can now emit structured UI events that surface inline prompts, confirmation dialogs, and progress updates.
- ADK memory consolidator with Gemini integration: deduplicates and ranks cross-session memories using Gemini embeddings for relevance scoring.
- OpenDev patterns: adaptive context compaction (auto-prune low-signal context items), event-driven reminder injection (surface forgotten constraints mid-session), and model role router (dispatch sub-tasks to appropriately-sized models based on complexity).

## 0.5.0 - 2026-03-03

- Added autonomous GitOps workflows: agent auto-merge, Dependabot auto-merge, self-healing monitor, and merge-branch fallback.
- Enabled CI proof artifact uploads and strengthened CI concurrency/branch scoping.
- Added self-healing command layer (`scripts/self-healing-check.js`, `scripts/self-heal.js`) with unit tests.
- Added semantic cache for ContextFS context-pack construction with TTL + similarity gating and provenance events.
- Added secret-sync helper (`scripts/sync-gh-secrets-from-env.sh`) and docs for required repo settings/secrets.

## 0.4.0 - 2026-03-03

- Added rubric-based feedback scoring with configurable criteria and weighted evaluation.
- Added anti-reward-hacking safeguards: guardrail checks and multi-judge disagreement detection.
- Added rubric-aware memory promotion gates for positive feedback.
- Added rubric-aware context evaluation, prevention-rule dimensions, and DPO export metadata.
- Extended API/MCP/Gemini contracts for rubric scores and guardrails.
- Added automated proof harness for rubric + intent + API/MCP end-to-end validation (`proof/automation/*`).

## 0.3.0 - 2026-03-03

- Added production API server with secure auth defaults and safe-path checks.
- Added local MCP server for Claude/Codex integrations.
- Added ChatGPT, Gemini, Codex, Claude, and Amp adapter bundles.
- Added budget guard and PaperBanana generation workflow.
- Added platform research, packaging plan, and verification artifacts.
