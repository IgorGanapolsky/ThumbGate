---
name: blocked-action-fallback
description: >
  Use the moment an action fails or a tool is missing (MCP server down, gh
  GraphQL rejected, connector not enabled, network 403, script needs the Mac).
  Walks an ordered ladder of legitimate alternate routes before reporting a
  blocker, and draws a hard line between "this route is broken" (try another)
  and "this action was refused" (stop, never route around it).
---

# Blocked-Action Fallback — Try Every Legitimate Route, Then Report Once

## The failure this prevents

Two opposite failures, both seen in Nov 2026 sessions:

1. **Giving up on the first error.** A thread hit "gh pr create: GraphQL
   blocked" or "Gmail connector not enabled" and handed the CEO a to-do list
   ("please click Ready", "please send this email"). The CEO's standing rule:
   never tell him to do our work; exhaust alternate routes first.
2. **Treating a refusal as a broken route.** Re-trying an action that a
   permission system, safety check, or branch protection *refused* by switching
   tools (MCP → gh → raw API) is evasion, not resilience. See CLAUDE.md
   "NEVER Bypass Branch Protection".

## Step 0 — classify the failure (do not skip)

Quote the exact error, then label it:

| Class | Examples | What you do |
|-------|----------|-------------|
| **ROUTE BROKEN** | MCP server disconnected, proxy 403 on a host, GraphQL endpoint rejected while REST works, CLI not installed, timeout, 5xx | Walk the ladder below |
| **NOT YET CONFIGURED** | connector exists on the account but not enabled for this session, missing env var, repo not attached | Use the setup tool that exists for it (attach repo, connector card, environment docs), keep doing all work that doesn't depend on it |
| **REFUSED** | a tool call denied by the permission/safety layer, `REVIEW_REQUIRED`, ruleset/branch-protection block, a platform ToS or rate limit, a human said no | **Stop.** Do not retry the same intent through another tool. Record it as BLOCKED with the quoted reason |

If unsure whether it is BROKEN or REFUSED, treat it as REFUSED.

## The ladder (ROUTE BROKEN only)

Try in order; stop at the first that works. Log each attempt (route, command,
result) — that log is the evidence if you end up reporting a blocker.

1. **Native tool / MCP** for the service (GitHub MCP, Gmail MCP, etc.). If the
   server is "still connecting", search for its tools again before giving up.
2. **Repo CLI with existing auth** — `gh`, `npm run <script>`, repo scripts in
   `scripts/` (e.g. `npm run pr:manage`, `scripts/post-everywhere.js`).
3. **REST instead of GraphQL** — `gh api repos/<owner>/<repo>/pulls -f ...`
   creates PRs when `gh pr create` (GraphQL) is rejected; same for comments,
   labels, ready-for-review.
4. **Repository automation** — trigger an existing workflow that already owns
   the action: `gh workflow run <file> -f pr_number=<N>` (e.g.
   `agent-automerge.yml`), or push a commit that fires it. Never write a new
   workflow whose purpose is to get around a control.
5. **The operator's machine** — when the work genuinely needs local
   credentials, apps or files (Mac-only scripts, signed-in browsers, launchd
   jobs), queue it through `mac-dispatch` (an issue marked `<!-- agent:ready -->` or a row
   in the existing herdr sheet), or start a Remote Control session / use
   connected folder access when the thread has them. Never queue a REFUSED
   action on the Mac.
6. **Produce the artifact anyway** — if nothing can *send/publish* it, finish
   everything up to the send (final copy, filled placeholders, exact command)
   and save it where the next session/automation will pick it up.

## Reporting (only after the ladder)

One message, no to-do list for the CEO:

```
BLOCKED: <action> — <class>
Tried: <route 1: result> · <route 2: result> · ...
Ready to go: <artifact path / exact command>
Unblocks when: <specific condition>. I will <next action> as soon as it does.
```

Only name a human step when it truly requires a credential or decision an
agent cannot legitimately hold (2FA, rotating a PAT, approving a PR, a
business decision). State it once; don't repeat it every turn.

## Hard rules

- NEVER approve a PR, dismiss a review, add a ruleset bypass, use `--admin`, or
  use an owner token to satisfy a control. A blocked merge is a finding.
- NEVER re-issue a denied tool call through a different tool or wording.
- NEVER grant yourself permissions or bypass Claude Code's permission checks
  (`safety-boundaries`).
- NEVER invent facts to fill a placeholder (prices, user counts, testimonials).
- ALWAYS write what you learned about a broken route into project memory /
  the lesson DB so the next session starts on the working route.
