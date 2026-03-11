# Pro Prevention Rules — Battle-Tested from 500+ Agentic Sessions

## PR Workflow Rules

### Rule: pr-thread-verify
- **Trigger:** Agent says "done", "pushed", "resolved", "ready for review"
- **Gate:** Must show `gh pr view --json reviewDecision,comments` output with 0 unresolved threads
- **Recurrence:** 47 occurrences across sessions
- **Fix:** Stop hook blocks completion claims without thread evidence

### Rule: post-push-recheck
- **Trigger:** Successful `git push`
- **Gate:** Must run `gh pr view` after push to catch new Copilot/reviewer threads
- **Recurrence:** 31 occurrences
- **Fix:** Reminder engine injects mandatory recheck after push detection

### Rule: ci-before-merge
- **Trigger:** Agent attempts merge or declares "CI green"
- **Gate:** Must show actual CI status output, not assume from previous run
- **Recurrence:** 22 occurrences
- **Fix:** PostToolUse hook validates `gh pr checks` output

## Git Hygiene Rules

### Rule: atomic-commits
- **Trigger:** `git add -A` or `git add .`
- **Gate:** Never stage all files — only stage files related to current task
- **Recurrence:** 18 occurrences
- **Fix:** Pre-commit hook warns on broad staging

### Rule: branch-cleanup
- **Trigger:** PR merged successfully
- **Gate:** Delete feature branch and worktree after merge confirmation
- **Recurrence:** 15 occurrences
- **Fix:** Post-merge reminder to clean up

## Tool Misuse Rules

### Rule: read-before-edit
- **Trigger:** Agent calls edit_file on a file it hasn't read
- **Gate:** Must Read file before proposing changes
- **Recurrence:** 29 occurrences
- **Fix:** Context tracking validates file was read in current session

### Rule: no-placeholder-params
- **Trigger:** Tool call with placeholder values ("TODO", "xxx", "REPLACE_ME")
- **Gate:** All parameters must be concrete values
- **Recurrence:** 12 occurrences
- **Fix:** Schema validation on tool parameters

## Memory Rules

### Rule: evidence-before-claim
- **Trigger:** Agent claims "tests pass", "build succeeds", "no errors"
- **Gate:** Must show command output proving the claim
- **Recurrence:** 41 occurrences
- **Fix:** Verification-before-completion protocol

### Rule: consolidate-after-session
- **Trigger:** Session end or context window >80% full
- **Gate:** Run memory consolidation to promote STM → LTM
- **Recurrence:** 8 occurrences
- **Fix:** End-of-session hook triggers consolidation
