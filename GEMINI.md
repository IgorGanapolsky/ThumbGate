# GEMINI.md - ThumbGate Source

See CLAUDE.md and AGENTS.md.

When using Gemini inside this repo, use the local dev ThumbGate wiring defined in `.mcp.json`.

Key: Always dogfood the latest local changes before publishing.
 
## NEVER Bypass Branch Protection (ABSOLUTE)

**NEVER approve a pull request. NEVER satisfy, dismiss, or disable a branch-protection requirement on the owner's behalf. NEVER use `--admin`, `--force`, or an owner credential to make a merge possible that would otherwise be blocked.**

Everything merges through PRs under the configured branch protection. When human review is required, only a human may satisfy it. Report the blocker with evidence. Non-mutating diagnosis and a separate policy-change PR are allowed, but stop before any action that mutates review or protection state. Never route around the control.

Diagnosing *why* a PR is blocked is correct and useful. **The diagnosis is the deliverable.** Changing review or protection state is not.

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

> [!IMPORTANT]
> The following rules were automatically derived from execution failures and thumbs-down feedback.
> You MUST follow these constraints strictly to prevent repeated errors.

- **Rule [auto-promoted-mriiwpw8-0]**: NEVER repeated problem context string
