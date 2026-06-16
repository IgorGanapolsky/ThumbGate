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

- **Rule [auto-promoted-mqf6zaon-0]**: NEVER repeated problem context string
- **Rule [auto-manual-ingest-markdown-migration]**: Auto-promoted repeated pattern: "MISTAKE: This is a test failure" (1 occurrences in 30 days)
- **Rule [auto-entity-customer-evidence-first-honesty-revenue-str]**: Auto-promoted repeated pattern: "User is angry because I implied ThumbGate was fixed while Stripe production billing remained blocked by an expired live " (1 occurrences in 30 days)
- **Rule [auto-autonomy-entity-customer-revenue-stripe-thumbs-dow]**: Auto-promoted repeated pattern: "User provided valid live Stripe key and was angry I stopped for confirmation despite full authorization to fix productio" (1 occurrences in 30 days)
