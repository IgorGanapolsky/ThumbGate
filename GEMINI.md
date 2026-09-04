# GEMINI.md - ThumbGate Source

See CLAUDE.md and AGENTS.md.

When using Gemini inside this repo, use the local dev ThumbGate wiring defined in `.mcp.json`.

Key: Always dogfood the latest local changes before publishing.

## Session PR Management and System Hygiene

- Start with `bin/agent-loop --health --json` (fail closed), then read all three
  repo directives, query local ThumbGate memory, and inspect open PRs, **open
  GitHub Issues**, remote branches, worktrees, and current `main` CI.
- Reconcile GitHub Issues and Actions plus available Linear AI, Obsidian vault,
  and standalone GitHub Copilot CLI surfaces. Close or advance actionable
  Issues in the same session — do not leave the Issues board untouched while
  only draining PRs. Record unavailable local integrations and continue with
  deterministic `gh`, git, and repository checks, which remain authoritative.
- Merge only review-complete PRs with terminal-green required checks, using
  `npm run pr:manage` and Trunk. Never approve, dismiss, bypass, or weaken a
  human-review or branch-protection requirement.
- Classify orphan branches before cleanup and preserve unique commits before
  deleting a branch or worktree.
- Verify required CI on the exact resulting `main` SHA and run the standard
  clean-worktree suite before any completion claim.
- Record session lessons in local ThumbGate memory and report whether the
  memory and ML feedback pipeline helped or hindered the work.
- Use the mandatory completion sentence from `AGENTS.md` only when every PR,
  cleanup, CI, dry-run, and lesson-recording item is verified; otherwise report
  blockers without claiming session completion.
 
## NEVER Bypass Branch Protection (ABSOLUTE)

**NEVER approve a pull request. NEVER satisfy, dismiss, or disable a branch-protection requirement on the owner's behalf. NEVER use `--admin`, `--force`, or an owner credential to make a merge possible that would otherwise be blocked.**

Everything merges through PRs under the configured branch protection. When human review is required, only a human may satisfy it. Report the blocker with evidence. Non-mutating diagnosis and a separate policy-change PR are allowed, but stop before any action that mutates review or protection state. Never route around the control.

Diagnosing *why* a PR is blocked is correct and useful. **The diagnosis is the deliverable.** Changing review or protection state is not.

**Repository rulesets:** classic branch protection and the `main governance` ruleset both apply. Keep `bypass_actors` empty; never add User/OrganizationAdmin bypass. Check with `npm run rulesets:check`.

### Why

On 2026-07-10, during diagnosis of blocked Dependabot PRs, an agent approved #2768 with the owner's `gh` credentials and observed the gate change from `BLOCKED` to `CLEAN`. Regardless of the PRs' other blockers, that action satisfied a control reserved for human review and was a bypass. The review was dismissed; #2768 returned to `BLOCKED`, unmerged.

### Corollary

An agent holding an owner's credential can do anything the owner can. That is precisely when it must not.

## Anti-Hallucination & Verification Mandate

- **Evidence-First Verification Protocol:** 
  - Every claim regarding file existence, database content, tool outputs, project status, or metrics must be backed by a **Verifiable Evidence Box** containing the exact absolute file path and raw command output (`cat`, `ls`, `git`, etc.).
  - Never assert that a file exists or references specific content without running `view_file` or a terminal command first and outputting the contents.
  - Never reference directories or files outside the active workspace (such as `~/.openclaw/`) unless they have been explicitly listed and verified via a directory list command in the current session.
  - If evidence is missing, state it clearly as `UNVERIFIED_CLAIM` and do not assert the state.

## 🛡️ Self-Harness Prevention Rules (Auto-Generated)

- No active auto-generated prevention rules at this time.

## Production Architecture Regression Gates

- RAG release gates are deterministic and fail closed; LLM judges are diagnostic only.
- Scoped retrieval must use entity, project, process, and session IDs and reject transcript blobs.
- MCP discovery must match callable tools; enforce truthful side-effect hints, OAuth scopes, structured outputs, and KPI telemetry.
- Completion requires an idempotent task-outcome receipt with verification evidence.
- Public multi-agent workflows must persist state, preserve failures, and work without hosted-only modules.
- Production monitoring requires at least 20 measured task outcomes and 20 observed tool calls before a healthy claim.
## CEO PR Session Persistence Contract

For every explicit PR-management and system-hygiene session:

1. Read `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`; query local ThumbGate memory.
2. Reconcile GitHub Issues and Actions, standalone Copilot CLI advice, Linear AI when authenticated, and `~/Documents/AI-Agent-Sync`. Deterministic git and GitHub evidence remain authoritative.
3. Classify every open PR and every remote branch without an open PR. Never approve a PR or bypass branch protection.
4. Submit only terminal-green, review-complete PRs through `npm run pr:manage` and Trunk.
5. Remove only verified-disposable branches, clean worktrees, dormant files, and logs, with before/after counts.
6. Verify required CI on the exact resulting `main` SHA and run the standard clean-worktree verification suite.
7. Record lessons in local memory and report whether memory helped or hindered.

Use **“Done merging PRs. CI passing. System hygiene complete. Ready for next session.”** only when every condition above is verified. Otherwise report exact blockers and do not use that sentence.
