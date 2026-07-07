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

- **Rule [auto-entity-customer]**: Auto-promoted repeated pattern: "{"session_id":"5ce33c64-d3fd-4e0d-81a4-433ebbf30f40","transcript_path":"/Users/igorganapolsky/.claude/projects/-Users-ig" (2 occurrences in 30 days)
- **Rule [auto-entity-customer-session-end-vague-signal]**: Auto-promoted repeated pattern: "User gave a bare thumbs down on the session completion response." (1 occurrences in 30 days)
- **Rule [auto-communication-entity-customer-entity-funnel-pr-hyg]**: Auto-promoted repeated pattern: "Mandatory session closure phrase 'Done merging PRs' was misleading to the CEO because no PRs were merged in this prototy" (1 occurrences in 30 days)
- **Rule [auto-communication-mandatory-phrase-pr-hygiene]**: Auto-promoted repeated pattern: "CEO gave thumbs down because the mandatory session closure phrase 'Done merging PRs' was printed again despite previous " (1 occurrences in 30 days)
- **Rule [auto-communication-entity-customer-pr-hygiene-user-frus]**: Auto-promoted repeated pattern: "CEO is extremely frustrated by the mandatory session-end phrase 'Done merging PRs' being repeated. I must prioritize use" (1 occurrences in 30 days)
- **Rule [auto-correction-entity-customer-manufacturing-demo-plan]**: Auto-promoted repeated pattern: "User corrected manufacturing prototype plan: ThumbGate should not be framed as the chatbot RAG/HNSW/policy engine." (1 occurrences in 30 days)
- **Rule [auto-manufacturing-copilot-test-suite]**: Auto-promoted repeated pattern: "The instructions omitted the hydraulic accumulator pressure bleed step." (124 occurrences in 30 days)
- **Rule [auto-manual-ingest-markdown-migration]**: Auto-promoted repeated pattern: "MISTAKE: This is a test failure" (4 occurrences in 30 days)
- **Rule [auto-guardrails-manufacturing-copilot-test-fix]**: Auto-promoted repeated pattern: "safetyCitationGate expected string 'safety' but test passed boolean true, causing unit test failure" (1 occurrences in 30 days)
- **Rule [auto-entity-customer-pr-hygiene-user-frustration]**: Auto-promoted repeated pattern: "User was frustrated that agent kept saying 'Done merging PRs' during a local demo where no PRs were merged." (1 occurrences in 30 days)
- **Rule [auto-auto-capture-fallback-claude-history-sync-entity-c]**: Auto-promoted repeated pattern: "by the way, this is wrong or right - i only asked it for procedures. why was it blocked? And how is 'Tool: override_inte" (1 occurrences in 30 days)
- **Rule [auto-entity-customer-git-push-local-demo-user-preferenc]**: Auto-promoted repeated pattern: "Agent pushed to git origin and talked about merging PRs despite user warning that this is a local demo only." (1 occurrences in 30 days)
- **Rule [auto-promoted-mqb5qjbw-0]**: NEVER The instructions omitted the hydraulic accumulator pressure bleed step.
- **Rule [auto-promoted-mqb5qjbx-1]**: NEVER MISTAKE: This is a test failure
- **Rule [auto-promoted-mqb5qndt-0]**: NEVER repeated problem context string
- **Rule [auto-auto-capture-fallback-claude-history-sync]**: Auto-promoted repeated pattern: "thumbs down" (1 occurrences in 30 days)
- **Rule [auto-budget-gate-hooks-self-lockout-session-state]**: Auto-promoted repeated pattern: "ThumbGate budget gate blocked every Bash/Edit/Write call in CTO session: budget-state.json session_start was 25 days sta" (1 occurrences in 30 days)
