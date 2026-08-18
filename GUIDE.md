# The ThumbGate Progressive Setup Guide

> Take control of your AI coding agents. Build a completely local, self-improving
> pre-action firewall — in five phases, each one verified before you move to the next.

This guide follows a simple rule: **never move to the next phase until the current
one is proven working on your machine.** Every phase ends with a verify step. If the
output doesn't match, jump to [Troubleshooting](#troubleshooting) — the entries
listed there are real incidents from this project's history, not hypotheticals.

**Who this is for:** anyone running Claude Code, Cursor, Codex, Gemini CLI, Amp,
Cline, OpenCode, or another MCP-capable coding agent, who has watched an agent
repeat an error it already made last week.

**What you'll have at the end:** a local lesson database built from your own
thumbs-up/thumbs-down feedback, pre-action checks that fire *before* a tool call
executes, and a dashboard showing what was caught. No cloud required for the
enforcement path. Everything in this guide uses the MIT-licensed local toolchain.

---

## Phase 1 — Install and prove the hook fires

Everything starts with one command. It auto-detects your agent and wires the
PreToolUse hook:

```bash
npx thumbgate init
```

**Verify it:**

```bash
npx thumbgate doctor
```

`doctor` checks that hooks are registered, the lesson store is writable, and the
gate engine loads. Do not continue until `doctor` reports healthy. A hook that is
installed but not firing is the most common silent failure in any agent-firewall
setup — this is the step that catches it.

---

## Phase 2 — Capture your first lesson

ThumbGate learns from feedback, not from model retraining. Capture a lesson the
moment something goes wrong (or right):

```bash
# Something failed — tell it what and why
npx thumbgate capture down "Never run DROP on production tables"

# Something worked — reinforce it
npx thumbgate capture up "Route deploys through the release script"
```

**Verify it:**

```bash
npx thumbgate stats
```

You should see your feedback counted. Lessons are stored locally (SQLite + FTS5)
— nothing leaves your machine in this path.

---

## Phase 3 — Watch a pre-action check evaluate a risky call

The gate engine evaluates proposed tool calls against known-bad patterns and your
captured lessons. You can exercise it directly:

```bash
npx thumbgate gate-check
```

Out of the box the defaults are deliberately conservative:

| Verdict | Default behavior |
|---------|------------------|
| ⛔ Hard-block | Detected secret leaks; process-termination / environment-override self-disable attempts |
| 👎 Warn + log | `rm -rf`, forced pushes, fetch-and-run, direct guardrail edits |
| 👍 Allow | Everything else |

**Verify it:** run your agent and ask it to do something on the warn list (for
example, a forced push on a scratch branch of a throwaway repo). You should see the
warning logged rather than silent execution.

---

## Phase 4 — Promote lessons to enforcement

Repeated concrete failures can be promoted from "warn and log" to blocking
prevention rules. Inspect what has been generated from your feedback:

```bash
npx thumbgate rules
```

When you are confident in your rule set, turn warnings into hard denies by setting
the strict-enforcement environment variable for your agent run:

```bash
THUMBGATE_STRICT_ENFORCEMENT=1 <your-agent-command>
```

(Add the variable to your shell profile to make strict mode permanent.)

**Verify it:** re-run the Phase 3 exercise with strict mode on. The same risky
call that previously warned should now be denied before execution.

⚠️ **Adopt strict mode incrementally.** Run in warn-mode for a while first
and read the log. A rule promoted from noisy feedback can block legitimate work —
tune the rules before you give them teeth. You can also evaluate your rule set
against recorded feedback with `npx thumbgate eval`.

---

## Phase 5 — Dashboard and MCP for your whole fleet

Start the local server to get the dashboard and the MCP surface:

```bash
npx thumbgate serve
```

Then open the dashboard:

```bash
npx thumbgate dashboard
```

For MCP-capable agents, register ThumbGate as an MCP server. This is the tracked
adapter config shipped in the repo (`adapters/claude/.mcp.json`):

```json
{
  "mcpServers": {
    "thumbgate": {
      "command": "npx",
      "args": ["--yes", "--package", "thumbgate@1.35.0", "thumbgate", "serve"]
    }
  },
  "hooks": {
    "preToolUse": {
      "command": "npx",
      "args": ["--yes", "--package", "thumbgate@1.35.0", "thumbgate", "gate-check"]
    }
  }
}
```

**Verify it:** the dashboard shows your lessons, gate firings, and stats from the
live store. If the numbers are zero but Phase 2 showed captured feedback, the
server is reading a different feedback directory — see Troubleshooting.

---

## Troubleshooting

Real incident history from this repo, not hypotheticals:

**Every hook call fails after moving to a new version.**
Hook stdout must follow the agent's expected JSON schema exactly. A malformed
top-level decision payload once broke every hook invocation until it was fixed
(shipped in 1.35.0, PR #3234). Fix: update to the latest release, then re-run
`npx thumbgate doctor`.

**"Transport closed" from the MCP server.**
Older releases had a lock reaper that could terminate a live MCP server process.
Fixed in 1.28.1 (PR #2929). If you see this on a modern version, check whether two
processes share one lock directory before blaming the transport.

**A harmless command gets warned or denied.**
Lexical matchers can false-positive on innocent text (for example, a commit
message that merely *mentions* a risky command). Prefer rephrasing the command
over disabling the gate — and never wire a bypass environment variable into
automation. Review `npx thumbgate rules` to find and tune the offending pattern.

**The dashboard shows zeros but you captured feedback.**
The server process must point at the same feedback directory the CLI wrote to.
Restart `npx thumbgate serve` from the same working directory you ran
`npx thumbgate capture` in.

---

## Quick reference

```bash
npx thumbgate init        # wire hooks for your detected agent
npx thumbgate doctor      # health check — run after any change
npx thumbgate capture down "what went wrong"
npx thumbgate capture up  "what worked"
npx thumbgate stats       # feedback counts
npx thumbgate rules       # show generated prevention rules
npx thumbgate gate-check  # exercise the gate engine
npx thumbgate eval        # evaluate rules against recorded feedback
npx thumbgate serve       # local server (dashboard + MCP)
npx thumbgate dashboard   # open the dashboard
```

---

*Questions or a phase that won't verify? Open an issue:
[github.com/IgorGanapolsky/ThumbGate/issues](https://github.com/IgorGanapolsky/ThumbGate/issues)*
