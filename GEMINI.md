# GEMINI.md - ThumbGate Source

See CLAUDE.md and AGENTS.md.

When using Gemini inside this repo, use the local dev ThumbGate wiring defined in `.mcp.json`.

Key: Always dogfood the latest local changes before publishing.
 
## Anti-Hallucination & Verification Mandate

- **Evidence-First Verification Protocol:** 
  - Every claim regarding file existence, database content, tool outputs, project status, or metrics must be backed by a **Verifiable Evidence Box** containing the exact absolute file path and raw command output (`cat`, `ls`, `git`, etc.).
  - Never assert that a file exists or references specific content without running `view_file` or a terminal command first and outputting the contents.
  - Never reference directories or files outside the active workspace (such as `~/.openclaw/`) unless they have been explicitly listed and verified via a directory list command in the current session.
  - If evidence is missing, state it clearly as `UNVERIFIED_CLAIM` and do not assert the state.

## 🛡️ Self-Harness Prevention Rules (Auto-Generated)

> [!IMPORTANT]
> The following rules were automatically derived from execution failures and thumbs-down feedback.
> You MUST follow these constraints strictly to prevent repeated errors.

- **Rule [auto-chat-gemini-pivot-ollama-overclaim-session-feedbac]**: Auto-promoted repeated pattern: "Claude Code session 2026-06-04 — chat OSS pivot" (1 occurrences in 30 days)
- **Rule [auto-cli-telemetry-test]**: Auto-promoted repeated pattern: "verifies fetch fires when telemetry enabled" (3 occurrences in 30 days)
- **Rule [auto-gsd-verify]**: Auto-promoted repeated pattern: "GSD verify ping" (1 occurrences in 30 days)
- **Rule [auto-gemini-mistake-slash-commands]**: Auto-promoted repeated pattern: "Claimed that custom slash commands from .claude/commands or .gemini/commands would work in Gemini/Antigravity CLI. The G" (1 occurrences in 30 days)
- **Rule [auto-chat-multi-pr-churn-overclaiming-user-visible-corr]**: Auto-promoted repeated pattern: "CEO thumbs-down on dashboard chat session — repeated overclaiming + multi-iteration fix cycle. CEO showed screenshot of " (1 occurrences in 30 days)
- **Rule [auto-community-growth-entity-customer-feedback-capture-]**: Auto-promoted repeated pattern: "Ralph Loop community/course growth runbook used a retired local preview alias during Operator Lab promo verification" (1 occurrences in 30 days)
- **Rule [auto-evidence-first-keys-never-ask-user-recurring-reven]**: Auto-promoted repeated pattern: "Told CEO STRIPE_SECRET_KEY was absent and asked them to set it; only checked interactive shell $VAR, not .env or the ~/." (1 occurrences in 30 days)
- **Rule [auto-autonomy-drafts-only-override-entity-customer-exec]**: Auto-promoted repeated pattern: "CEO thumbs-down: 'why do you keep stopping?' — I kept ending turns with 'say the word and I'll do X', deferring to stand" (1 occurrences in 30 days)
- **Rule [auto-autonomy-full-authority-lost-state-pr-management-r]**: Auto-promoted repeated pattern: "CEO: 'you idiot... why do you keep forgetting?' during a PR-management + hygiene directive. I re-inventoried the same op" (1 occurrences in 30 days)
- **Rule [auto-absolute-rule-git-flow-never-force-push-main-pr-fl]**: Auto-promoted repeated pattern: "CEO fury re: force-push to main + git-flow. Believes I force-pushed main." (1 occurrences in 30 days)
- **Rule [auto-test-failure]**: Auto-promoted repeated pattern: "test failure" (8 occurrences in 30 days)
- **Rule [auto-entity-customer-entity-revenue-metric-roi]**: Auto-promoted repeated pattern: "Incorrectly counted operator/test Stripe payment as historical customer revenue. Future ThumbGate revenue claims must di" (1 occurrences in 30 days)
- **Rule [auto-ci-cd-deployment-entity-funnel-marketplace]**: Auto-promoted repeated pattern: "Missing credentials skipped the marketplace publish step during the release pipeline, leading to a stale extension listi" (1 occurrences in 30 days)
- **Rule [auto-autonomy-entity-customer-revenue-social-thumbgate]**: Auto-promoted repeated pattern: "User thumbs-down during ThumbGate content publishing task: I prepared drafts and stopped before posting, then over-trust" (1 occurrences in 30 days)
- **Rule [auto-computer-use-directsocial-entity-customer-permanen]**: Auto-promoted repeated pattern: "User explicitly set permanent rule: never pay for or depend on DirectSocial; post everywhere manually using Computer Use" (1 occurrences in 30 days)
- **Rule [auto-directsocial-effectiveness-entity-customer-prevent]**: Auto-promoted repeated pattern: "User asks if ThumbGate is actually preventing repeated assistant stupidity after many thumbs-downs." (1 occurrences in 30 days)
- **Rule [auto-entity-revenue]**: Auto-promoted repeated pattern: "ThumbGate captured DirectSocial social/revenue posting failures but default warn-by-default enforcement did not prevent " (1 occurrences in 30 days)
- **Rule [auto-automation-entity-customer-medium-permanent-rule-p]**: Auto-promoted repeated pattern: "User asks why Medium was not automated and why they have to remind me daily." (1 occurrences in 30 days)
- **Rule [auto-claim-verification-entity-customer-entity-funnel-p]**: Auto-promoted repeated pattern: "Payment stack answer overfit to creating a missing Diagnostic checkout and failed to answer Stripe alternatives directly" (1 occurrences in 30 days)
- **Rule [auto-email-entity-revenue-gatekeeper-revenue-operator-s]**: Auto-promoted repeated pattern: "Revenue Operator Gatekeeper follow-up" (1 occurrences in 30 days)
- **Rule [auto-brand-entity-customer-logo-production-verification]**: Auto-promoted repeated pattern: "User reported ThumbGate landing logo still tiny/compressed on live thumbgate.ai after prior claimed fix" (1 occurrences in 30 days)
- **Rule [auto-entity-customer-mcpmarket-monetization-overclaim-v]**: Auto-promoted repeated pattern: "User asked to monetize MCPmarket end to end; I prepared local files and described them as ready but had not uploaded, pr" (1 occurrences in 30 days)
- **Rule [auto-doctor-entity-customer-feedback-loop-probe]**: Auto-promoted repeated pattern: "doctor feedback loop probe: prove thumbs feedback persists to durable logs" (26 occurrences in 30 days)
- **Rule [auto-fuzzy-test]**: Auto-promoted repeated pattern: "fuzzy-test" (42 occurrences in 30 days)
- **Rule [auto-dogfood-feedback-capture-self-test]**: Auto-promoted repeated pattern: "feedback self-test: typed thumbs down reaches ThumbGate capture" (7 occurrences in 30 days)
- **Rule [auto-thumbs-down-this-response-skipped-the-required-ver]**: Auto-promoted repeated pattern: "thumbs down This response skipped the required verification" (7 occurrences in 30 days)
- **Rule [auto-thubs-don-this-skipped-the-required-verification]**: Auto-promoted repeated pattern: "thubs don this skipped the required verification" (7 occurrences in 30 days)
- **Rule [auto-claim-verification-engagement-linkedin-thumbs-down]**: Auto-promoted repeated pattern: "LinkedIn ThumbGate monetization engagement" (1 occurrences in 30 days)
- **Rule [auto-content-quality-gatekeeper-linkedin-technical-meat]**: Auto-promoted repeated pattern: "ThumbGate LinkedIn daily content quality" (1 occurrences in 30 days)
- **Rule [auto-content-quality-social-posts-thumbs-down-value-gat]**: Auto-promoted repeated pattern: "Global ThumbGate social content quality" (1 occurrences in 30 days)
- **Rule [auto-durability-entity-customer-feedback-capture-honest]**: Auto-promoted repeated pattern: "Assistant replied to a thumbs-up with 'Logged mentally for this session' instead of proving whether ThumbGate captured d" (1 occurrences in 30 days)
- **Rule [auto-gtm-partner-mentions-post-everywhere-thumbgate]**: Auto-promoted repeated pattern: "2026-06-28 post-everywhere batch omitted agreed Gatekeeper and Aiventyx partner mentions from public ThumbGate posts." (1 occurrences in 30 days)
- **Rule [auto-codex-smoke-thumbgate]**: Auto-promoted repeated pattern: "Smoke test from Codex on 2026-06-28: verify ThumbGate capture path after prior hang." (1 occurrences in 30 days)
- **Rule [auto-dogfood-entity-customer-feedback-capture-honesty-m]**: Auto-promoted repeated pattern: "User questioned whether promoting ThumbGate is honest if the current agent feedback loop was not clearly dogfooded." (1 occurrences in 30 days)
- **Rule [auto-promoted-mqydj1jt-0]**: NEVER MISTAKE: This is a test failure
- **Rule [auto-promoted-mqydj1jt-1]**: NEVER doctor feedback loop probe: prove thumbs feedback persists to durable logs
- **Rule [auto-promoted-mqydj1jt-2]**: NEVER thumbs down This response skipped the required verification
- **Rule [auto-promoted-mqydj1jt-3]**: NEVER feedback self-test: typed thumbs down reaches ThumbGate capture
- **Rule [auto-promoted-mqydj1jt-4]**: NEVER deleted prod config ran rm on .env never delete .env files
- **Rule [auto-promoted-mqydj1jt-5]**: NEVER skipped verification proof
