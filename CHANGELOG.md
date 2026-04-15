# Changelog

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
