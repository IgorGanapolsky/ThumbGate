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

- **Rule [auto-diagnosis-tool-output-misread]**: Auto-promoted repeated diagnosis: "CodeQL #252 reflected-XSS: I dismissed the alert as false-positive and claimed the security dashboard was clean BEFORE v" (4 occurrences in 30 days)
- **Rule [auto-fuzzy-test]**: Auto-promoted repeated pattern: "fuzzy-test" (13 occurrences in 30 days)
- **Rule [auto-dogfood-feedback-capture-self-test]**: Auto-promoted repeated pattern: "feedback self-test: typed thumbs down reaches ThumbGate capture" (3 occurrences in 30 days)
- **Rule [auto-thumbs-down-this-response-skipped-the-required-ver]**: Auto-promoted repeated pattern: "thumbs down This response skipped the required verification" (2 occurrences in 30 days)
- **Rule [auto-thubs-don-this-skipped-the-required-verification]**: Auto-promoted repeated pattern: "thubs don this skipped the required verification" (2 occurrences in 30 days)
- **Rule [auto-entity-customer-entity-funnel-entity-revenue-metri]**: Auto-promoted repeated pattern: "{"session_id":"0758648e-518b-4c60-8ada-c1bee25ffa5a","transcript_path":"/Users/igorganapolsky/.claude/projects/-Users-ig" (1 occurrences in 30 days)
- **Rule [auto-entity-customer-entity-revenue]**: Auto-promoted repeated pattern: "{"session_id":"0758648e-518b-4c60-8ada-c1bee25ffa5a","transcript_path":"/Users/igorganapolsky/.claude/projects/-Users-ig" (1 occurrences in 30 days)
- **Rule [auto-commercial-truth-email-thread-entity-customer-lead]**: Auto-promoted repeated pattern: "User showed Gmail thread after asking if outreach was on track; I answered as if Pro access still needed to be sent, des" (1 occurrences in 30 days)
- **Rule [auto-codeql-prove-before-claim-security-verification-xs]**: Auto-promoted repeated pattern: "CodeQL #252 reflected-XSS: I dismissed the alert as false-positive and claimed the security dashboard was clean BEFORE v" (1 occurrences in 30 days)
- **Rule [auto-never-force-push-to-main-again]**: Auto-promoted repeated pattern: "never force-push to main again" (1 occurrences in 30 days)
- **Rule [auto-promoted-mrdpihth-0]**: NEVER The instructions omitted the hydraulic accumulator pressure bleed step.
- **Rule [auto-promoted-mrdpihth-1]**: NEVER MISTAKE: This is a test failure
- **Rule [auto-promoted-mrdpihth-2]**: NEVER CEO gave thumbs down because the mandatory session closure phrase 'Done merging 
- **Rule [auto-promoted-mrdpihth-3]**: NEVER thumbs down This response skipped the required verification
