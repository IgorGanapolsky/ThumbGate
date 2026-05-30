---
name: task-state-ledger
description: >
  Maintain an external state ledger for any multi-step task (3+ steps, multi-PR,
  anything spanning more than one turn or touching production). Triggered when you
  notice yourself re-deriving "where am I" with repeated gh/git/curl dumps, when a
  task crosses turns, or when the user asks "why are you stuck/lost". Prevents the
  "lost" failure mode: re-discovering state every turn instead of reading it.
---

# Task State Ledger — Stop Getting Lost

## The failure this prevents

You re-derive state every turn (where's the PR, what's on main, what's deployed)
with expensive `gh`/`git`/`curl` dumps. The dumps flood context, bury the signal,
and you lose the thread. This is the "constantly stuck and lost" failure. The fix
is mechanical: **write state down once, update it as you go, read it instead of
re-deriving it.** (Anthropic context-engineering: external structured note-taking
is one of the three core long-horizon techniques, alongside compaction and
sub-agents — see https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

## The rule

For any task with 3+ steps or that crosses a turn, the FIRST action is to create
or open a ledger at `.claude/implementation-notes/<date>-<task>.md` (this is
already mandated by CLAUDE.md — actually do it). It is the single source of truth.

## Ledger format (keep it short — it's a dashboard, not a diary)

```markdown
# <task> — <date>

## Goal (one sentence)
<the actual end state that means "done">

## Current step
<the ONE thing in flight right now>

## State (verified facts only — each with how/when verified)
- main HEAD: <sha> (git rev-parse origin/main @ HH:MM)
- deployed buildSha: <sha> (curl /health @ HH:MM)
- PR #NNNN: <state>/<mergeState> (gh pr view @ HH:MM)

## Steps (sequential — one in_progress at a time)
- [x] step that's done — evidence
- [ ] step in flight  ← YOU ARE HERE
- [ ] next step
- [ ] ...

## Decisions & corrections
- <decision> because <why>  (mark VERIFIED / UNVERIFIED)
- WRONG: <thing I claimed that was false> → corrected to <truth> @ HH:MM

## Blockers / open questions for the CEO
- <thing only the user can unblock>
```

## Protocol

1. **Open the ledger before doing anything else** on a multi-step task. If it
   exists, read it instead of re-deriving state.
2. **Update "Current step" + "State" after each verification**, not at the end.
   When you run the verifying command, write its result + timestamp into the ledger.
3. **One step `in_progress` at a time.** If you're tempted to start a second, stop
   — see the `scope-discipline` skill.
4. **Log corrections inline.** When "are you sure?" reveals you were wrong, write
   the WRONG→corrected line. This stops you re-making the same wrong claim.
5. **Read the ledger at the start of every turn** on a continuing task. That is
   how you stop being "lost": the answer to "where am I" is a file read, not 10
   tool calls.

## Anti-patterns

| Pattern | Fix |
|---|---|
| 10 `gh`/`git` calls to recover "where am I" | Read the ledger; it has verified state + timestamps |
| State lives only in your head across turns | State lives in the file; head is cache |
| "I'll remember to update notes at the end" | Update after each step — there may be no clean end |
| Re-running a verify you already ran this session | Check the ledger's State block first |

## Exit criteria

The ledger's Goal is met, every step is `[x]` with evidence, and the State block's
verified facts confirm it (e.g. deployed buildSha == main HEAD). Then — and only
then — say "done", once, with the evidence inline.
