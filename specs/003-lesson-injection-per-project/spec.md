# Spec 003: Per-Project Lesson Scope and Just-in-Time Lesson Injection

Requested by Igor Ganapolsky on 2026-10-28 ("can't you improve thumbgate to make it useful?"), after a PSN
StockService session captured about 22 negative lessons that were never read back and the same Teams
reply mistake recurred within an hour.

## 1. Constitution Reference
- `AGENTS.md#Verification-Gate-(Single-Source-of-Truth)`: every claim here is backed by `tests/lesson-inject.test.js`.
- `AGENTS.md#Performance-Budgets`: the hooks run on every prompt and on outward tool calls, so they stay
  dependency-free (Node built-ins plus `scripts/feedback-paths.js`) and finish well under 200ms.

## 2. EARS Acceptance Criteria
- **WHEN** an agent calls `capture_feedback`, **WHILE** the `lesson-inject` PreToolUse guard is installed,
  **THE SYSTEM SHALL** stamp `projectId` (git common root basename) and `projectDir` (git common root) from the
  hook's `cwd`, so a git worktree shares its main checkout's project.
- **WHEN** an MCP server started from a launcher cwd (`/` from Claude.app, `~` from Cursor) writes a stamped
  capture into the active project's store, **THE SYSTEM SHALL** still retrieve it for its own `projectId` and
  never for another project. A capture stamped `projectId: "global"`, or copied with `rescope --global` into
  `~/.thumbgate/global`, is retrieved in every project.
- **WHEN** a negative capture has no `whatToChange` (after history inference), **THE SYSTEM SHALL** reject it as
  `no-action` with a clarification instead of promoting a lesson with no rule; the PreToolUse guard denies the
  call with the same reason so the agent retries with a rule.
- **WHEN** a user prompt is submitted, **THE SYSTEM SHALL** rank lessons from the project's store, from records
  tagged with this `projectId` in the known shared stores (local feedback profile, active project), and from the
  global tier, and inject at most 3 lessons in at most 1200 characters (about 300 tokens).
- **WHEN** no lesson matches at least 2 distinct query terms with at least 40% coverage of the query's weight,
  **THE SYSTEM SHALL** print nothing.
- **WHEN** a PreToolUse event is an outward action (`git push`, `but push`, `gh pr create|merge|comment`,
  `az repos pr`, `npm publish`, Jira or Confluence writes, or a browser action whose summary sends, posts or
  replies), **THE SYSTEM SHALL** run the same retrieval on the action text and inject matches as
  `additionalContext`; every other tool call exits silently.
- **WHEN** a lesson was already injected into the same session in the last 15 minutes, **THE SYSTEM SHALL** not
  inject it again.

## 3. Explicit Out-of-Scope Boundaries (Non-Goals)
- Do NOT move or rewrite records in another project's store; `rescope` only appends copies to the target store.
- Do NOT block a prompt or a tool call on retrieval; any retrieval error exits 0 with no output.
- Do NOT inject pruned lessons or lessons with no rule (`How to avoid:` / `What worked:` line).
- Do NOT change `retrieve_lessons` ranking; the injection scorer is separate because it must be able to stay silent.

## 4. Locked Architectural Decisions
- Project identity is the git common root (`git rev-parse --git-common-dir` equivalent, read from `.git` files
  without spawning git), falling back to the non-transient cwd. Agent decision under Igor's delegation, 2026-10-28.
- Project tier store is ThumbGate's existing per-project store (`<root>/.thumbgate`), not a new layout.
- Global tier is `~/.thumbgate/global`, written only for explicit `projectId: "global"` captures.
- Ranking is IDF-weighted term overlap over title, rule, source context and tags with a light suffix stemmer.
- The MCP server does not re-route writes by `projectDir` in this change. `captureFeedback` resolves its store
  from process env in many places, including background side effects, so a per-call env swap would leak across
  concurrent calls. Routing needs a scoped path resolver first (open follow-up). Agent decision, 2026-10-28.
- Seen-cache lives at `~/.thumbgate/runtime/lesson-inject-seen/<session>.json`.

## 5. Worktree-Isolated Atomic Tasks
- `Task 1`: `scripts/feedback-schema.js` (reject negative without `whatToChange`) + `tests/feedback-schema.test.js`.
- `Task 2`: `scripts/feedback-paths.js` (git common root, project identity, global tier dir).
- `Task 3`: `scripts/lesson-inject.js` (retrieval, hooks, capture guard, rescope, Claude installer) + `tests/lesson-inject.test.js`.

## 6. Adversarial Verification & PCP Contract
- **Mutated State Variables Constrained:** `scope.projectId`, the capture's target store, `action.type` for
  rule-less negatives, injected `additionalContext`.
- **Verification Suite:** `node --test tests/lesson-inject.test.js tests/feedback-schema.test.js`.
- **Replay:** lesson `fb_1793210321374` (asked permission before sending Damon a reply) surfaces for "reply to Damon"
  in project `Eci.Psn.StockService`, stays silent for an unrelated prompt and for another project, and the later
  double-post capture `fb_1793212277020` (no `whatToChange`) is rejected.
