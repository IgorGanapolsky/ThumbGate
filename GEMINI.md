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

- **Rule [auto-budget-gate-hooks-self-lockout-session-state]**: Auto-promoted repeated pattern: "ThumbGate budget gate blocked every Bash/Edit/Write call in CTO session: budget-state.json session_start was 25 days sta" (1 occurrences in 30 days)
- **Rule [auto-fleet-routing-hermes-yolo-multi-agent-coordination]**: Auto-promoted repeated pattern: "hermes-yolo unusable: printed hallucinated JSON tool-calls as text 14:37-15:00" (1 occurrences in 30 days)
- **Rule [auto-entity-customer-entity-funnel-entity-revenue]**: Auto-promoted repeated pattern: "{"session_id":"0758648e-518b-4c60-8ada-c1bee25ffa5a","transcript_path":"/Users/igorganapolsky/.claude/projects/-Users-ig" (2 occurrences in 30 days)
- **Rule [auto-diagnosis-tool-output-misread]**: Auto-promoted repeated diagnosis: "{"session_id":"0758648e-518b-4c60-8ada-c1bee25ffa5a","transcript_path":"/Users/igorganapolsky/.claude/projects/-Users-ig" (3 occurrences in 30 days)
- **Rule [auto-fuzzy-test]**: Auto-promoted repeated pattern: "fuzzy-test" (6 occurrences in 30 days)
- **Rule [auto-dogfood-feedback-capture-self-test]**: Auto-promoted repeated pattern: "feedback self-test: typed thumbs down reaches ThumbGate capture" (1 occurrences in 30 days)
- **Rule [auto-thumbs-down-this-response-skipped-the-required-ver]**: Auto-promoted repeated pattern: "thumbs down This response skipped the required verification" (1 occurrences in 30 days)
- **Rule [auto-thubs-don-this-skipped-the-required-verification]**: Auto-promoted repeated pattern: "thubs don this skipped the required verification" (1 occurrences in 30 days)
- **Rule [auto-entity-customer-entity-funnel-entity-revenue-metri]**: Auto-promoted repeated pattern: "{"session_id":"0758648e-518b-4c60-8ada-c1bee25ffa5a","transcript_path":"/Users/igorganapolsky/.claude/projects/-Users-ig" (1 occurrences in 30 days)
- **Rule [auto-meta-mistake-failure]**: Repeated failure pattern: mistake this is a test failure
- **Rule [auto-promoted-mrcvn187-0]**: NEVER The instructions omitted the hydraulic accumulator pressure bleed step.
- **Rule [auto-promoted-mrcvn187-1]**: NEVER CEO gave thumbs down because the mandatory session closure phrase 'Done merging 
- **Rule [auto-promoted-mrcvn187-2]**: NEVER thumbs down This response skipped the required verification
- **Rule [auto-promoted-mrcvokr5-0]**: NEVER repeated problem context string
