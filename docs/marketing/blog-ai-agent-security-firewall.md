# Your AI agent is a supply chain attack surface. Here's how to gate it.

*April 10, 2026 -- Igor Ganapolsky*

## The problem

Your AI coding agent runs shell commands. It installs packages. It modifies files, pushes commits, and calls external APIs -- all without requiring you to type a single character.

That's the pitch. That's also the attack surface.

Every tool call the agent makes is a potential injection point. Recent research on prompt injection and supply chain attacks shows that LLMs can be manipulated into executing malicious operations: installing tampered packages, exfiltrating environment variables through shell commands, or writing code that phones home. The attack doesn't have to come from your codebase. It can come from a doc comment, a GitHub issue, a dependency's README -- any text the agent processes.

When the agent decides to run `npm install some-package`, it's making a trust decision. Right now, most setups have no enforcement layer between that decision and its execution.

## Why existing tools aren't enough

Static analysis catches known-bad patterns in code you've already written. Dependency scanners audit lock files after packages are installed. SCA tools check for CVEs after the fact.

By the time your scanner flags a problem, the agent already ran the command. The package is already on disk. The shell script already executed.

These tools operate on the output of agent actions. You need something that operates on the input -- before execution.

Static analysis also doesn't know your team's specific failure patterns. It doesn't know that your agent has a recurring habit of force-pushing to main, or that it keeps reaching for an internal utility that was deprecated last quarter. Generic rules don't encode your context. They can't block what they've never seen.

The gap is pre-action enforcement.

## What ThumbGate does

ThumbGate implements pre-action checks via `PreToolUse` hooks -- Claude Code's built-in interception point that runs before every tool invocation.

The flow:

```
Agent decides: "run npm install unknown-pkg"
       |
       v
PreToolUse hook fires
       |
       v
Gates engine checks: does this match any enforcement rule?
       |
     match → block + explain
     no match → pass through
```

No action reaches execution without passing through the gate. Not Bash commands, not file edits, not web fetches.

What makes this more than a static blocklist is the feedback-to-enforcement pipeline. When something goes wrong -- agent force-pushes, installs the wrong package, runs a destructive command -- you record a thumbs-down with context. That failure feeds a promotion engine. One failure becomes a warning. Three confirmed failures of the same pattern become a hard block. The gates config grows from your actual mistakes, not someone else's generic rules.

```javascript
// Auto-promotion thresholds
const WARN_THRESHOLD = 1;   // warn on first confirmed failure
const BLOCK_THRESHOLD = 3;  // hard block after 3 occurrences
```

The gates are regex-matched against the tool invocation payload. They're serialized as JSON, version-controlled, and shareable across teams. Your enforcement memory is portable.

## Real examples

**Force-push to main**

Agent context degrades over a long session. The instruction that said "never force-push" is buried under 60K tokens of other context. The agent tries `git push --force origin main`.

The gate fires:

```
BLOCKED: git push --force to main is disallowed.
Safe alternative: create a branch, open a PR.
Gate: force-push-main (auto-promoted after 3 incidents)
```

The push never happens.

**Unknown dependency install**

Agent is working on a new feature and decides to pull in a package it found referenced in a Stack Overflow answer. It runs `npm install some-unfamiliar-package`.

The gate fires:

```
FLAGGED for human review: installing unlisted dependency.
Package 'some-unfamiliar-package' is not in the approved dependency manifest.
Action: paused. Awaiting human approval.
```

You get a prompt. You decide. The agent waits.

**Destructive shell command**

Agent decides to clean up build artifacts with `rm -rf dist/`. Normally fine. But the pattern `rm -rf` with a relative path that could expand unexpectedly matches a prevention rule learned from a prior incident.

```
BLOCKED: destructive rm -rf with unqualified path.
Prevention rule: rm-rf-relative-path (promoted from feedback log)
Suggested alternative: rm -rf ./dist (absolute or explicitly scoped)
```

The command is blocked. The agent reformulates with a safer invocation.

These are not hypotheticals. Each maps to a real class of agent failure that shows up in production sessions.

## How to set it up

Five minutes.

```bash
npx thumbgate init
```

This installs the PreToolUse hook into your Claude Code settings and generates a starter gate config:

```json
{
  "gates": [
    {
      "id": "force-push-main",
      "trigger": "Bash",
      "pattern": "git\\s+push\\s+--force\\s+.*main",
      "action": "block",
      "message": "Force-push to main is disallowed. Open a PR instead."
    },
    {
      "id": "unknown-dependency",
      "trigger": "Bash",
      "pattern": "npm\\s+install\\s+(?!.*--save-dev)(?!.*@types)",
      "action": "review",
      "message": "Dependency install flagged for human review."
    }
  ]
}
```

The hook reads this config on every tool invocation. Add patterns. Adjust thresholds. Gates are just JSON -- commit them, review them, share them.

Full setup guide: https://thumbgate-production.up.railway.app/guide

## The bigger picture

This isn't purely a security story. It's an agent governance story.

AI agents make mistakes in patterns. The same categories of failure recur across sessions, across teams, across codebases. Force-pushes. Wrong package installs. Claiming completion before verifying. Resetting lockfiles from the wrong branch. These are not random -- they are predictable failure modes with predictable mitigations.

The problem is that those mitigations live in system prompts, which degrade. They live in code review feedback, which agents don't read. They live in post-mortems, which don't propagate back into enforcement.

ThumbGate closes that loop. Every confirmed failure becomes a prevention rule. Rules are enforced at the PreToolUse layer, which doesn't degrade -- it runs before every action, every time, regardless of context window state.

Teams that share a ThumbGate config share enforcement memory. A mistake one engineer's agent makes can generate a gate that protects every agent on the team. The checks get more precise as the failure log grows. The system learns from operational reality, not from idealized policy documents.

**Human judgment leads. AI supports. ThumbGate enforces it.**

That's the architecture. The agent proposes actions. The gate validates them against learned failure patterns and explicit policy. Humans remain in the decision loop on anything flagged. Nothing destructive executes unreviewed.

AI authenticity enforcement is not a feature you add to an agent -- it's a layer you put between the agent and the world.

---

**Try it: `npx thumbgate init`**

Setup guide and full documentation: https://thumbgate-production.up.railway.app/guide

GitHub: [github.com/IgorGanapolsky/ThumbGate](https://github.com/IgorGanapolsky/ThumbGate)
