# ThumbGate Agent Reference Pack (Moved from `CLAUDE.md`)

> Detailed reference sections extracted from `CLAUDE.md` on 2026-11-06 to keep per-call prompt overhead under 8 KB while preserving full operational runbooks.

## 1. Claw-Style + Hybrid Enterprise Agents (`adapters/claw/CLAW.md`, `adapters/perplexity/HYBRID.md`)

From Automation Anywhere EnterpriseClaw + Perplexity hybrid local-cloud analysis:
- Claw-style agents: device FS access, runtime dynamic tool creation, screen/UI interaction, orchestration (on-prem/air-gapped/hybrid).
- Hybrid inference: autonomous local vs. cloud routing for privacy, cost, and intelligence.
- **ThumbGate governance layer:** Claw gates (`dynamic-tool`, `screen`, `identity`, `FS`) + hybrid routing approval (`evaluateClawPretool` in `scripts/hybrid-feedback-context.js` for `agent_id`, `claw_action_type`, `hybrid_route`).
- Add `claw`/`hybrid` tags to contexts, gate dynamic tools/screen/cloud escalations on sensitive data, and route local-sensitive work to local candidates.

## 2. Distribution Channel Focus (`scripts/post-everywhere.js`)

Active outbound channels (2026-04-20 onward): **Reddit, LinkedIn, Threads, Bluesky, Instagram, YouTube.**
- X/Twitter was retired from active distribution 2026-04-20. Do not re-introduce X as a primary channel without CEO approval.
- Default platform list is enforced by `DEFAULT_PLATFORMS` in `scripts/post-everywhere.js` and pinned by `tests/post-everywhere-channels.test.js`.

## 3. Social Stack: Zernio Canonical (`scripts/social-analytics/poll-all.js`)

All social publishing and analytics route through Zernio (`https://zernio.com/api/v1`).
- **Analytics:** `scripts/social-analytics/poll-all.js` runs `github`, `plausible`, `zernio` by default. Direct pollers (`LEGACY_POLLERS`) require `THUMBGATE_USE_DIRECT_POLLERS=1`.
- **Visibility:** `npm run social:zernio:status` (`scripts/social-analytics/zernio-status.js`) prints 24h row counts per platform and exits non-zero when zero rows are ingested.
- **Reply monitoring:** `scripts/social-reply-monitor.js` (Reddit/LinkedIn) and `scripts/social-reply-monitor-bluesky.js` (Bluesky AT Protocol) queue drafts to `.thumbgate/reply-drafts.jsonl` for human review and never auto-post.
- **Regression guards:** `tests/zernio-canonical-pollers.test.js` and `tests/zernio-status.test.js`.

## 4. Moat — Hosted Services, Not Closed-Source Intelligence (`MOAT.md`)

Decision (2026-05-18): the moat is hosted infrastructure + adapter compatibility + dashboard + support. Public code is permissive on purpose.
1. **Public code is permissive:** ranking, synthesis, and adaptive gates land in the public repo by default.
2. **Bundle ratchet:** `tests/public-bundle-ratchet.test.js` and `tests/public-core-boundary.test.js` guard against accidental bundle bloat and forbid direct `ThumbGate-Core` imports.
3. **Pricing copy follows reality:** `/pricing` describes hosted state, adapter coverage, and support.

## 5. Prompt Tuning Format (Ultramarine FORMAT Steal — `docs/agents/format-steals.md`)

From Paper Instruments' Ultramarine 1 Flash — applied at drafting time:
- **Concision with completeness:** Concision never comes at the cost of completeness.
- **Stopping rule:** Finish when the requested result is usable and observable requirements are satisfied. Once complete, hand off immediately (`YOU MUST NOT KEEP WORKING ON FINISHED WORK`).
- **No self-evaluation:** Never produce summaries of what you did, apologies, or meta-commentary.
- **Agent lean disclosure:** When influenced by another agent's analysis, cite the source agent explicitly.

## 6. Post-Loop Architecture: Outcome Goals & Builder–Reviewer–Verifier (`src/builder-reviewer-verifier-engine.js`)

1. **Outcome Goals, Not Step-by-Step Instructions:** Define verifiable outcome metrics alongside tools rather than micro-step procedural micromanagement.
2. **No Spec Decomposition into Micro-Tickets:** Keep compaction threshold >=400k tokens so a single builder implements coherent specs.
3. **Subagent Fan-Out Only for Truly Independent Tasks:** Restrict parallel subagents to isolated workloads with zero shared state.
4. **Effort Scaling Across Model Tiers:** Escalate to frontier advisor only on complex problems; route routine self-contained tasks to fast workers.
5. **Builder–Reviewer–Verifier (BRV) Pipeline:** Route reviewer and verifier findings back to the original builder instance; verify at capability edges; prune obsolete scaffolding.
6. **Chief of Staff Principle:** Single coordinator thread delegating typed tool calls to sandboxed workers.

## 7. Context Engineering Table (`bin/agent-loop`)

| Layer | Location |
|---|---|
| Agent loop | `bin/agent-loop` — Recollect -> Plan -> Observe -> Act -> Evaluate -> Learn; `bin/agent-loop --health --json` |
| Skills | `skills/*`, `.claude/skills/*`, `.agents/skills/*` |
| MCP | `adapters/mcp/`, profiles in `config/mcp-allowlists.json` (`default`, `lean`, `readonly`, `locked`) |
| Workflows | `.grok/workflows/*.rhai` |
| Sub-agents | Parallel isolated worktrees + Linear/vault ownership (`.claude/scripts/session-bootstrap/fleet-coordination-check.sh`) |
| Hooks | PreToolUse: `gate-check`, spend-guard, outbound-email-guard |

## 8. Code Search (`docs/agents/code-search.md`)

Use Graphify-Labs `graphify` for architecture queries when wired (`npm run graphify:setup && .graphify-venv/bin/graphify query "<question>"`). Do not clone Graphify into a ThumbGate SKU; do not dual-edit DIRTY lesson-graph PR `#3650`.

## 9. Leave-Work-at-Work Family Sanctuary & Elephant–Goldfish Autonomous Loop (`.agents/skills/elephant-goldfish-family-sanctuary/SKILL.md`)

Enforce `.agents/skills/elephant-goldfish-family-sanctuary/SKILL.md` and `evaluateElephantGoldfishAutonomousSanctuaryLoop` (`scripts/rrsi-doctor.js`):
- **Marriage Sanctuary First (`jw.org` docid=500300102):** Zero babysitting interruptions. Never make Igor act as QA or ask *"are you sure?"*.
- **Elephant Spec (`egm.dev`):** 4-section spec (`Problem`, `Technical Plan`, `Alternatives Rejected`, `Enumerated Files`); critique first.
- **Goldfish Amnesia Swarm:** Zero-context pre-yield verification (`Comprehension` -> `Adversarial Critic` -> `Readiness` -> `Mean Code & Runtime Review`) and vault sync between `<repo>/obsidian/` and `~/Documents/AI-Agent-Sync/Projects/<Project>/`.

## 10. Hard-Won Lessons & Audit Lessons

- **Fix-on-fix commits = systemic failure signal:** After 3 failed attempts, stop pushing, read platform docs, and push one root-cause fix.
- **No rapid-fire pushes to `main`:** Batch related edits into one commit to avoid overlapping Railway container deploys on SQLite.
- **Only ZERO/ALWAYS thresholds are enforceable:** LLMs cannot count ratios across independent sessions.
- **Memory and instructions must be updated together:** When changing `CLAUDE.md`, update any contradicting lesson DB entry or `prevention-rules.md` rule.
- **Post-deploy checks are POST-deploy:** Run Railway `/health` and `/dashboard` curls after merge, never as a pre-merge gate.
- **Avoid `require.main === module` in CommonJS:** Use `path.resolve(process.argv[1]) === path.resolve(__filename)` (SonarCloud S3403).
- **When the CEO says "are you sure?" — dig deeper:** Re-examine build logs, deployment history, and live API state from scratch.
- **Implementation notes:** For multi-step tasks (3+ files or production changes), maintain `.claude/implementation-notes/<date>-<task>.md` with verified vs. unverified assumptions.
- **Pro-gated test isolation:** Inject or stub gate predicates in tests rather than coupling CI to local Pro licenses.

## 11. Session Hygiene Details, Startup, Handoff & Command Reference

### Feedback & Analysis Commands
```bash
node .claude/scripts/feedback/capture-feedback.js --feedback=up --context="..." --what-worked="..." --tags="tag1,tag2"
node .claude/scripts/feedback/capture-feedback.js --feedback=down --context="..." --what-went-wrong="..." --what-to-change="..." --tags="tag1,tag2"
npm run feedback:stats       # show feedback counts
npm run feedback:summary     # generate summary
npm run feedback:rules       # regenerate prevention rules
npm run feedback:export:dpo  # export DPO pairs
npm run self-heal:check      # check system health
npm run self-heal:run        # auto-fix known issues
npm run pr:manage            # review all open PRs
npx thumbgate board-loop --json
node scripts/sync-version.js --check
```

### Standard Verification Commands
```bash
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

### Session Startup & Handoff
- **Startup:** Read `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `primer.md`; run `bash .claude/scripts/session-bootstrap/fleet-coordination-check.sh`, `npm run feedback:summary`, `npm run pr:manage`, and `gh run list --branch main --limit 3`.
- **PR & Branch Hygiene:** Submit terminal-green PRs via `/trunk merge` (`npm run pr:manage`); prune stale/orphan remote branches and prunable worktrees (`>5d`); never spam `/trunk merge` retries on queue failure.
- **Handoff:** Run `node bin/cli.js cfo --today` and `./bin/memory.sh`; state completed outcomes with evidence and next steps. Use *"Done merging PRs. CI passing. System hygiene complete. Ready for next session."* only when every condition in the CEO PR Session Persistence Contract is verified.
