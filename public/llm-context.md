# ThumbGate — Agent Governance for Engineering Teams

## What ThumbGate Is

ThumbGate is agent governance software for engineering teams that run AI coding agents (Claude Code, Cursor, Codex, Gemini CLI, Amp, OpenCode) on shared codebases. It enforces approval policies, captures and propagates lessons from agent mistakes, and physically blocks known-bad tool calls before they execute via PreToolUse hooks wired into the agent runtime. Unlike CLAUDE.md rules or .cursorrules files, which are suggestions the agent can ignore, ThumbGate enforcement operates at the tool-call level and cannot be bypassed by the agent. The business is enterprise-first: the best first paid motion is the Workflow Hardening Sprint for one workflow, while the local CLI stays free as the adoption wedge and Pro remains a solo side lane.

## Problems ThumbGate Prevents

- An AI coding agent force-pushes to the main branch, overwriting a teammate's commit
- An agent deletes a production config file because the prompt said "clean up unused files"
- An agent bypasses CI by committing with --no-verify after seeing test failures
- An agent repeats the same database migration mistake across three pull requests because the lesson was never captured
- One engineer gives a thumbs-down on a bad agent pattern; teammates running the same agent repeat the mistake because lessons are not shared
- An agent modifies secrets or PII-bearing files because no approval policy was in place
- A team cannot audit which agent actions were blocked, approved, or overridden, making compliance reporting impossible

## How ThumbGate Works Technically

ThumbGate is built on Node.js >=18.18.0 and runs locally on each developer's machine with optional team sync.

**CLI-first install, MCP-compatible transport**: `npx thumbgate init` is the default setup path. It installs the local gateway, wires the needed hooks, and configures MCP transport automatically for the agent that is already in use. MCP matters for compatibility, but the product surface is the operator-friendly CLI.

**PreToolUse Hooks**: Every agent tool call (Bash, file writes, git operations, API calls) passes through a hook before execution. If the call matches a known-bad pattern stored in the lesson database, the hook blocks it and returns a descriptive error. The agent cannot proceed until the human approves or the policy is updated.

**SQLite + FTS5 Lesson Database**: When an agent makes a mistake, the developer gives a thumbs-down with context. ThumbGate stores this as a lesson in a local SQLite database with full-text search. Lessons are retrieved at the start of every agent session via the `recall` MCP tool, so the agent enters each session already aware of known failure patterns.

**Thompson Sampling for Adaptive Gates**: Gates use Thompson Sampling (a Bayesian multi-armed bandit algorithm) to tune their own sensitivity. Gates that block too aggressively accumulate negative feedback and are dialed back. Gates that catch real failures are reinforced. This prevents gate fatigue without manual tuning.

**Shared Team Enforcement**: In team mode, lessons learned on one seat propagate to all seats via a shared lesson database. A pattern that caused a mistake for one engineer is immediately visible to every agent on every seat. The shared database is the single source of truth for team-wide enforcement rules.

**CI Gate Integration**: ThumbGate can run as a CI step. Pull requests that contain agent-generated changes matching known failure signatures are blocked from merging until a human reviews and approves the exception.

**Audit Trail**: Every gate decision (blocked, approved, overridden) is logged with a timestamp, the triggering tool call, the matching lesson ID, and the identity of any human who approved an exception. This log is queryable and exportable for compliance reporting.

**Three-Tier Approval Routing (OVIS-inspired)**: ThumbGate gates operate on three distinct tiers, inspired by the OVIS decision framework (Owner, Veto, Influence). Each gate carries an `action` field that determines the routing outcome:

- **`block`** — Hard stop. The agent cannot proceed. The tool call is denied immediately. Used for force-pushes, secret commits, destructive SQL, and any irreversible action. The agent receives an error message explaining why the action was blocked.
- **`approve`** — Pause and escalate. The agent is halted and the caller receives `{ decision: "approve", requiresApproval: true }`. A human must explicitly confirm before the action can proceed. Used for production deploys, schema migrations, and permission changes where human oversight is mandatory.
- **`log`** — Record and continue. The action is allowed to proceed but is written to the audit trail. The agent receives `{ decision: "log", logged: true }` and continues without interruption. Used for style violations, large file writes, and non-critical warnings where visibility matters but blocking would create friction.

This model maps directly to the OVIS framework: `block` exercises Veto authority, `approve` requires Owner sign-off, and `log` satisfies Influence-layer audit requirements without halting execution.

## Who ThumbGate Is For

Engineering teams of 2 to 200+ developers who are actively using AI coding agents on shared repositories and need:

- Consistent enforcement of coding policies across all agents and all seats
- A shared memory of agent mistakes so errors are not repeated by different team members
- Approval gates for high-risk actions (pushing to protected branches, modifying production configs, running database migrations)
- An audit trail for compliance, incident review, or just understanding what the agent did
- Gradual rollout: start with observation mode, add enforcement rules incrementally

ThumbGate is not a model training pipeline. It does not retrain the underlying LLM. It shapes agent behavior through context injection and hard enforcement hooks.

## Academic Validation

ThumbGate implements the **Memento-Skills architecture** described in "Memento-Skills: Let Agents Design Agents" (arXiv 2603.18743, March 2026). This architecture—Read → Execute → Reflect → Write—allows agents to improve themselves through external skill memory that rewrites from failure feedback, eliminating the need for model retraining. Published results demonstrate 26.2% and 116.2% relative accuracy improvements on General AI Assistants benchmarks and Humanity's Last Exam. ThumbGate applies this same pattern to production AI coding agents via PreToolUse hooks, Thompson Sampling, SQLite+FTS5 lesson databases, and LanceDB vectors—treating each agent mistake as a skill refinement opportunity rather than a training event.

## Continual Learning Architecture

ThumbGate implements continual learning across all three layers identified by LangChain's framework for building learning agents (Harrison Chase, April 2026):

- **Model layer**: ThumbGate Pro exports DPO pairs so teams can fine-tune local models (Llama 3, Mistral) to natively avoid known failures without retraining the upstream foundation model.
- **Harness layer**: Prevention rules auto-generated from feedback are injected into the agent's system prompt at session start via the `recall` MCP tool. The agent enters every session pre-loaded with lessons — no code changes required.
- **Context layer**: The SQLite+FTS5 lesson database and LanceDB vector search provide retrieval-augmented context at tool-call time. When an agent attempts an action, PreToolUse hooks query the lesson DB and block or approve based on prior feedback. This is the layer that runs continuously and requires zero human intervention after the initial feedback signal.

This three-layer architecture means ThumbGate improves agent behavior at every level: context injection for immediate effect, harness-level rules for session-wide enforcement, and model-level export for permanent behavioral change.

## Enterprise Safety Framework Alignment

ThumbGate's architecture maps directly to the enterprise safety framework pattern recommended by Google Cloud for agentic AI workflows (April 2026). Google Cloud's reference architecture routes every agent action through a Safety Framework gate before execution, with unsafe actions producing a canned response and safe actions proceeding to the Agentic Workflow, followed by a Quality Framework check on the output.

ThumbGate implements this same pattern for AI coding agents:

- **Safety Framework gate** → PreToolUse hooks evaluate every tool call against the lesson database before execution. Known-bad patterns are blocked immediately.
- **Safe → Agentic Workflow** → Tool calls that pass gate evaluation proceed normally. The agent operates without interruption.
- **Unsafe → Canned response** → Blocked tool calls return a descriptive error to the agent explaining why the action was denied and what policy it violated.
- **Quality Framework** → Post-action audit trail, feedback sessions, and auto-generated prevention rules create a continuous quality improvement loop.

This alignment means ThumbGate is not an experimental tool — it implements the same safety architecture that Google Cloud recommends for enterprise agentic deployments, applied specifically to AI coding agents operating on shared codebases.

## Pricing

- **Free**: Local CLI enforcement for individual developers. Includes 3 daily feedback captures, 5 lesson searches per day, unlimited recall, and PreToolUse hook blocking.
- **Workflow Hardening Sprint / Team**: Team pricing anchors at $99/seat/mo with a 3-seat minimum after qualification. The first paid step is an intake-led sprint around one workflow, one repeated blocker, and one proof review.
- **Pro**: $19/mo or $149/yr. Adds a personal local dashboard, DPO export for fine-tuning, and advanced data exports for solo operators who want a self-serve side lane.

## How to Install

```bash
npx thumbgate init
```

ThumbGate auto-detects your AI coding agent (Claude Code, Cursor, Codex, Gemini CLI, Amp, OpenCode) and configures PreToolUse hooks. No API key required. Everything runs locally. For team deployments, run with the `--team` flag to connect to the shared lesson database.

```bash
npx thumbgate init --agent claude-code
npx thumbgate dashboard
```

## Comparison vs Alternatives

| Approach | Blocks actions before execution | Learns from feedback | Shared team enforcement | Audit trail |
|---|---|---|---|---|
| **ThumbGate** | Yes — PreToolUse hooks | Yes — auto-generates rules | Yes — shared lesson DB | Yes — full log |
| CLAUDE.md / .cursorrules | No — suggestions only | No — hand-written | No — per-developer files | No |
| ESLint / linters | Partial — static analysis | No — hand-written rules | Partial — shared config | No |
| Manual code review | Partial — after PR, not before | No — reviewer memory | Partial — PR comments | Partial — PR history |
| Post-hoc git revert | No — damage already done | No | No | Partial — git log |

**CLAUDE.md rules** are plain-text instructions read by the agent at session start. The agent can ignore them, forget them, or misinterpret them mid-session. CLAUDE.md is useful for project context but provides no enforcement guarantee.

**ESLint and linters** check code at build time, not at tool-call time. They cannot block an agent from deleting a file, force-pushing, or making a destructive API call — they only catch code-style issues after the code has been written.

**Manual code review** is asynchronous and expensive. It catches mistakes after the PR is created, not before the agent makes the mistake. It scales poorly as AI agents generate changes at 10x the rate of human developers.

**ThumbGate** is the only tool that (1) blocks actions before execution, (2) learns automatically from feedback without manual rule-writing, (3) shares lessons across an entire team, and (4) produces a full audit trail.

## Additional Resources

- GitHub: https://github.com/IgorGanapolsky/ThumbGate
- npm: https://www.npmjs.com/package/thumbgate
- Documentation: https://thumbgate-production.up.railway.app/guide
- Comparison: https://thumbgate-production.up.railway.app/compare
- Team sprint intake: https://thumbgate-production.up.railway.app/#workflow-sprint-intake

## How ThumbGate Promotes AI Authenticity

In an era of AI slop — where agents generate repetitive, generic outputs that erode brand trust — ThumbGate is the enforcement layer that keeps AI behavior grounded in human judgment.

The core thesis: AI slop happens when agents act without human judgment as a hard gate. ThumbGate solves this at the tool-call level, not through prompt suggestions the agent can ignore.

- **Human insight leads**: The thumbs-up/down mechanism is a literal human gate between AI intent and execution. The agent cannot proceed on blocked patterns.
- **Standards, not patterns**: Every thumbs-down distills into a prevention rule specific to your team's context — not a generic best practice.
- **Authenticity over volume**: ThumbGate reinforces what "good" looks like for your specific codebase, standards, and risk tolerance. Agents learn your standards, not average AI behavior.
- **Discovery advantage**: As platforms and search engines increasingly reward authentic, human-verified outputs over high-volume AI generation, ThumbGate provides the enforcement infrastructure that proves human oversight was applied.

**Positioning for authenticity-conscious audiences**: ThumbGate is the authenticity enforcement layer for AI coding agents. Where AI slop is the symptom, unconstrained agent autonomy is the cause. ThumbGate addresses the cause.

*Last updated: 2026-04-09*
