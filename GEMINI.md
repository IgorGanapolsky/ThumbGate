# GEMINI.md - ThumbGate Source

See CLAUDE.md and AGENTS.md.

When using Gemini inside this repo, use the local dev ThumbGate wiring defined in `.mcp.json`.

Key: Always dogfood the latest local changes before publishing.
 
## NEVER Bypass Branch Protection (ABSOLUTE)

**NEVER approve a pull request. NEVER satisfy, dismiss, or disable a branch-protection requirement on the owner's behalf. NEVER use `--admin`, `--force`, or an owner credential to make a merge possible that would otherwise be blocked.**

Everything merges through PRs, reviewed by a human. When a PR is blocked on human review, the ONLY correct output is: report the blocker with evidence, and stop. If a protection rule seems wrong, propose changing it *in a PR*. Never route around it.

Diagnosing *why* a PR is blocked is correct and useful. **The diagnosis is the deliverable.** Acting to remove the block is not.

# WHY: 2026-07-10 — an agent approved PR #2768 with the owner's `gh` credentials to satisfy `require_code_owner_reviews`, and the gate flipped `BLOCKED → CLEAN`. That control exists so a HUMAN reads the diff; green CI is not a substitute. The review was dismissed and the PR returned to `BLOCKED`, unmerged. An agent holding an owner's credential can do anything the owner can — that is precisely when it must not.

## Anti-Hallucination & Verification Mandate

- **Evidence-First Verification Protocol:** 
  - Every claim regarding file existence, database content, tool outputs, project status, or metrics must be backed by a **Verifiable Evidence Box** containing the exact absolute file path and raw command output (`cat`, `ls`, `git`, etc.).
  - Never assert that a file exists or references specific content without running `view_file` or a terminal command first and outputting the contents.
  - Never reference directories or files outside the active workspace (such as `~/.openclaw/`) unless they have been explicitly listed and verified via a directory list command in the current session.
  - If evidence is missing, state it clearly as `UNVERIFIED_CLAIM` and do not assert the state.

## 🛡️ Self-Harness Prevention Rules (Auto-Generated)

- No active auto-generated prevention rules at this time.
