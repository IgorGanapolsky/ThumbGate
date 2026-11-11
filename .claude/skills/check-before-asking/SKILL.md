---
name: check-before-asking
description: >
  Pre-flight before asking the operator anything or handing him a step. Check
  project memory and live state first, act on what's already known, and only
  ask for a decision or credential an agent can't hold. Use whenever you are
  about to write a question, "please run/click/turn on", or a to-do list for
  the operator.
---

# Check Before Asking — The Answer Is Usually Already Known

The operator has said it plainly: be fully autonomous, never tell him to do our
work, never ask him things he has already answered. Every question costs his
attention and stalls the thread until he's back.

## 1. Before any question, check in this order

1. **Project memory** (the memory index and its linked files). Most "is X on?"
   and "where is Y?" questions are answered there.
2. **This thread and the project chat**, for decisions he already made.
3. **Live state** with a read-only call: `gh api` for PRs, workflows, issues
   and labels; the connector for mail, sheets or docs; `curl` for production.
4. **Repo docs and skills** (`CLAUDE.md`, `docs/guides/`, `.claude/skills/`).

If the answer is there, act on it and cite where you found it. Don't ask him to
confirm it.

## 2. Settled facts: never ask about these

Treat these as true unless live state proves otherwise (then report the
evidence, don't ask):

- The promo workflow is ON and the Mac dispatch is loaded. Never ask him to
  turn them on or check them.
- The Mac and phone are wired in. Route Mac work through `mac-dispatch`.
- His standing rule: always send and publish, merge PRs when CI passes, don't
  ask for permission for authorized work.

Add to this list (by PR) whenever he has to repeat himself; see
`weekly-self-review`.

## 3. Never hand him steps we can do

Banned: "please click Ready / merge", "run this command", "turn on the
workflow", "send this email", a to-do list. Instead:

- A tool failed → `blocked-action-fallback`.
- It needs the Mac → `mac-dispatch`.
- It truly needs him (2FA, rotating a credential, reconnecting a connector
  only he can reconnect, a business decision, approving or merging a PR that
  the safety layer reserves for him) → say it **once**, in one line, with the
  exact link, and keep doing everything that doesn't depend on it.

## 4. When a question is legitimate

Only for a choice that changes his goal, or a step that can't be undone and
that he hasn't already authorized. Ask once, recommend an option, and keep
working on the recommended option while you wait (unless it can't be undone).

## 5. Learn from it

If you had to ask something that should have been in memory, write the answer
to memory in the same turn so no thread asks again.
