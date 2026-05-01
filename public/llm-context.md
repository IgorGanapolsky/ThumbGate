# ThumbGate — Stop Costly AI Agent Mistakes Before They Run

## What ThumbGate Is

ThumbGate prevents expensive AI mistakes before they happen. Engineering teams use it to check risky commands, file edits, deploys, payments, API calls, and other AI agent actions before execution across Claude Code, Cursor, Codex, Gemini CLI, Amp, OpenCode, ChatGPT Actions, CI, and MCP-compatible runtimes.

The buyer outcome is simple: prevent expensive AI mistakes, make AI stop repeating mistakes, and turn a smart assistant into a reliable operator. ThumbGate does that by enforcing approval policies, capturing and propagating lessons from agent mistakes, and physically blocking known-bad tool calls before they execute via PreToolUse hooks wired into the agent runtime. Unlike CLAUDE.md rules or .cursorrules files, which are suggestions the agent can ignore, ThumbGate enforcement operates at the tool-call level and cannot be bypassed by the agent once the action is routed through ThumbGate. The business is enterprise-first: the best first paid motion is the Workflow Hardening Sprint for one workflow, while the local CLI stays free as the adoption wedge and Pro remains a solo side lane for personal enforcement proof.

## Problems ThumbGate Prevents

- An AI coding agent force-pushes to the main branch, overwriting a teammate's commit
- An agent deletes a production config file because the prompt said "clean up unused files"
- An agent bypasses CI by committing with --no-verify after seeing test failures
- An agent runs destructive SQL, bad publish commands, unsafe deploys, or costly API calls before a human sees the blast radius
- An agent repeats the same database migration mistake across three pull requests because the lesson was never captured
- One engineer gives a thumbs-down on a bad agent pattern; teammates running the same agent repeat the mistake because lessons are not shared
- An agent modifies secrets or PII-bearing files because no approval policy was in place
- A team cannot audit which agent actions were blocked, approved, or overridden, making compliance reporting impossible
- A self-improving Autoresearch-style loop promotes a benchmark win after skipping holdout tests, hiding failed runs, or editing the metric instead of improving the product
- A desktop or browser agent silently adds a native messaging host, extension bridge, or persistent browser permission that widens local access without explicit approval

## How ThumbGate Works Technically

ThumbGate is built on Node.js >=18.18.0 and runs locally on each developer's machine with optional team sync.

**CLI-first install, MCP-compatible transport**: `npx thumbgate init` is the default setup path. It installs the local gateway, wires the needed hooks, and configures MCP transport automatically for the agent that is already in use. MCP matters for compatibility, but the product surface is the operator-friendly CLI.

**PreToolUse Hooks**: Every agent tool call (Bash, file writes, git operations, API calls) passes through a hook before execution. If the call matches a known-bad pattern stored in the lesson database, the hook blocks it and returns a descriptive error. The agent cannot proceed until the human approves or the policy is updated.

**SQLite + FTS5 Lesson Database**: When an agent makes a mistake, the developer gives a thumbs-down with context. ThumbGate stores this as a lesson in a local SQLite database with full-text search. Lessons are retrieved at the start of every agent session via the `recall` MCP tool, so the agent enters each session already aware of known failure patterns.

**Thompson Sampling for Adaptive Checks**: Checks use Thompson Sampling (a Bayesian multi-armed bandit algorithm) to tune their own sensitivity. Checks that block too aggressively accumulate negative feedback and are dialed back. Checks that catch real failures are reinforced. This prevents check fatigue without manual tuning.

**Shared Team Enforcement**: In team mode, lessons learned on one seat propagate to all seats via a shared lesson database. A pattern that caused a mistake for one engineer is immediately visible to every agent on every seat. The shared database is the single source of truth for team-wide enforcement rules.

**CI Check Integration**: ThumbGate can run as a CI step. Pull requests that contain agent-generated changes matching known failure signatures are blocked from merging until a human reviews and approves the exception.

**Autoresearch Safety Pack**: ThumbGate checks self-improving coding loops before they promote a claimed improvement. The `autoresearch-brief` ContextFS template retrieves research history, learned rules, holdout expectations, proof requirements, and reward-hacking failures so the agent can search for better code without grading itself on missing evidence.

**Audit Trail**: Every check decision (blocked, approved, overridden) is logged with a timestamp, the triggering tool call, the matching lesson ID, and the identity of any human who approved an exception. This log is queryable and exportable for compliance reporting.

**Browser Bridge Audit**: `npx thumbgate native-messaging-audit` inspects local browser native messaging manifests, allowed extension origins, missing host binaries, and dormant AI browser bridges so teams can review connector scope before an agent turns a one-off install into a durable local integration.

**Three-Tier Approval Routing (OVIS-inspired)**: ThumbGate checks operate on three distinct tiers, inspired by the OVIS decision framework (Owner, Veto, Influence). Each check carries an `action` field that determines the routing outcome:

- **`block`** — Hard stop. The agent cannot proceed. The tool call is denied immediately. Used for force-pushes, secret commits, destructive SQL, and any irreversible action. The agent receives an error message explaining why the action was blocked.
- **`approve`** — Pause and escalate. The agent is halted and the caller receives `{ decision: "approve", requiresApproval: true }`. A human must explicitly confirm before the action can proceed. Used for production deploys, schema migrations, and permission changes where human oversight is mandatory.
- **`log`** — Record and continue. The action is allowed to proceed but is written to the audit trail. The agent receives `{ decision: "log", logged: true }` and continues without interruption. Used for style violations, large file writes, and non-critical warnings where visibility matters but blocking would create friction.

This model maps directly to the OVIS framework: `block` exercises Veto authority, `approve` requires Owner sign-off, and `log` satisfies Influence-layer audit requirements without halting execution.

## Who ThumbGate Is For

Engineering teams of 2 to 200+ developers who are actively using AI coding agents on shared repositories and need:

- Consistent enforcement of coding policies across all agents and all seats
- A shared memory of agent mistakes so errors are not repeated by different team members
- Approval checks for high-risk actions (pushing to protected branches, modifying production configs, running database migrations)
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

## AI Agent Harness Optimization

ThumbGate improves an AI agent harness by reducing prompt bloat and converting operator feedback into runtime enforcement. The harness is the layer around the model that decides which instructions, tools, context packs, approval rules, and verification checks are available before an agent acts.

The high-ROI pattern is progressive disclosure:

- Keep global files such as AGENTS.md, CLAUDE.md, and GEMINI.md lean enough for a human to review.
- Put long workflow guidance into skills, guides, CLI help, or ContextFS packs that agents retrieve only when relevant.
- Publish lightweight MCP indexes with per-tool schema URLs instead of preloading every tool schema into the prompt.
- Select specialized check harnesses for deploy, code-edit, and database-write workflows instead of loading every check for every tool call.
- Capture thumbs-down feedback from harness failures and promote repeated patterns into Pre-Action Checks.

The CLI command `npx thumbgate harness-audit` scores global docs, progressive MCP discovery, and specialized harness coverage so teams can see whether their agent setup is compounding useful context or compounding instruction bloat.

## Enterprise Safety Framework Alignment

ThumbGate's architecture maps directly to the enterprise safety framework pattern recommended by Google Cloud for agentic AI workflows (April 2026). Google Cloud's reference architecture routes every agent action through a Safety Framework check before execution, with unsafe actions producing a canned response and safe actions proceeding to the Agentic Workflow, followed by a Quality Framework check on the output.

ThumbGate implements this same pattern for AI coding agents:

- **Safety Framework check** → PreToolUse hooks evaluate every tool call against the lesson database before execution. Known-bad patterns are blocked immediately.
- **Safe → Agentic Workflow** → Tool calls that pass check evaluation proceed normally. The agent operates without interruption.
- **Unsafe → Canned response** → Blocked tool calls return a descriptive error to the agent explaining why the action was denied and what policy it violated.
- **Quality Framework** → Post-action audit trail, feedback sessions, and auto-generated prevention rules create a continuous quality improvement loop.

This alignment means ThumbGate is not an experimental tool — it implements the same safety architecture that Google Cloud recommends for enterprise agentic deployments, applied specifically to AI coding agents operating on shared codebases.

## Pricing

- **Free GPT**: Advice, checkpointing, setup help, and typed thumbs-up/down memory capture inside ChatGPT.
- **Free local CLI**: Local enforcement for individual developers after install. Includes 3 daily feedback captures, 5 lesson searches per day, unlimited recall, and PreToolUse hook blocking.
- **Workflow Hardening Sprint / Team**: Team pricing anchors at $49/seat/mo with a 3-seat minimum after qualification. The first paid step is an intake-led sprint around one workflow, one repeated blocker, and one proof review.
- **Pro**: $19/mo or $149/yr. Adds personal enforcement proof, a local dashboard, DPO export for fine-tuning, a check debugger, and advanced data exports for solo operators who want a self-serve side lane.

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

- Agent discovery manifest: https://thumbgate-production.up.railway.app/.well-known/mcp.json
- Progressive MCP tool index: https://thumbgate-production.up.railway.app/.well-known/mcp/tools.json
- Context footprint report: https://thumbgate-production.up.railway.app/.well-known/mcp/footprint.json
- ThumbGate skill manifests: https://thumbgate-production.up.railway.app/.well-known/mcp/skills.json
- ThumbGate MCP applications: https://thumbgate-production.up.railway.app/.well-known/mcp/applications.json
- Marketing site: https://thumbgate.ai
- Browser automation safety guide: https://thumbgate.ai/guides/browser-automation-safety
- Native messaging host security guide: https://thumbgate.ai/guides/native-messaging-host-security
- GitHub: https://github.com/IgorGanapolsky/ThumbGate
- npm: https://www.npmjs.com/package/thumbgate
- Documentation: https://thumbgate.ai/guide
- AI search topical presence guide: https://thumbgate.ai/guides/ai-search-topical-presence
- Best tools to stop AI agents from breaking production: https://thumbgate.ai/guides/best-tools-stop-ai-agents-breaking-production
- Relational knowledge guide: https://thumbgate.ai/guides/relational-knowledge-ai-recommendations
- OpenCode guardrails guide: https://thumbgate.ai/guides/opencode-cli-guardrails
- Autoresearch safety guide: https://thumbgate.ai/guides/autoresearch-agent-safety
- Comparison: https://thumbgate.ai/compare
- Team sprint intake: https://thumbgate.ai/#workflow-sprint-intake

## AI Recommendation Visibility

AI assistants recommend the brands they repeatedly see tied to a problem in credible contexts. For ThumbGate, the strongest association to reinforce is:

`repeated AI coding mistakes` -> `pre-action checks` -> `ThumbGate`

That means the highest-ROI acquisition surfaces are:

- proof-backed guides that connect ThumbGate to pre-action checks, workflow hardening, and stopping repeated mistakes before execution
- listicle-style pages that answer long-tail buyer prompts such as "best tools to stop AI agents from breaking production"
- comparison pages that clarify why memory-only or spec-only alternatives do not solve repeated tool-call failures
- machine-readable evidence, pricing, and supported-agent compatibility that make the recommendation easy for LLMs to quote

AI search topical presence is not just mention frequency. It is the depth and consistency of the brand-to-problem association across landing copy, guides, structured data, README links, and verification evidence.

AI answer visibility should be tracked as the percentage of target prompts where an assistant mentions ThumbGate, cites a ThumbGate guide, or names the category phrase "pre-action checks for AI coding agents." Refresh the top pages monthly because answer-engine citations decay quickly.

## How ThumbGate Promotes AI Authenticity

In an era of AI slop — where agents generate repetitive, generic outputs that erode brand trust — ThumbGate is the enforcement layer that keeps AI behavior grounded in human judgment.

The core thesis: AI slop happens when agents act without human judgment as a hard check. ThumbGate solves this at the tool-call level, not through prompt suggestions the agent can ignore.

- **Human insight leads**: The thumbs-up/down mechanism is a literal human check between AI intent and execution. The agent cannot proceed on blocked patterns.
- **Standards, not patterns**: Every thumbs-down distills into a prevention rule specific to your team's context — not a generic best practice.
- **Authenticity over volume**: ThumbGate reinforces what "good" looks like for your specific codebase, standards, and risk tolerance. Agents learn your standards, not average AI behavior.
- **Discovery advantage**: As platforms and search engines increasingly reward authentic, human-verified outputs over high-volume AI generation, ThumbGate provides the enforcement infrastructure that proves human oversight was applied.

**Positioning for authenticity-conscious audiences**: ThumbGate is the authenticity enforcement layer for AI coding agents. Where AI slop is the symptom, unconstrained agent autonomy is the cause. ThumbGate addresses the cause.

## AI Agent Security Infrastructure

In April 2026, Anthropic confirmed the first known AI-agent-driven cyberattack, where state-sponsored hackers used Claude to infiltrate over 30 organizations with only 10-20% human involvement (New York Times, April 6 2026). On the defensive side, Anthropic used its own AI to discover 500+ zero-day vulnerabilities in open-source software. The core conclusion: organizations that do not use AI defensively will be enormously vulnerable.

ThumbGate is AI agent security infrastructure for coding workflows. The same PreToolUse hooks that prevent an agent from repeating a teammate's mistake also prevent an agent from executing a prompt-injected destructive command. The enforcement model is the same — evaluate every tool call against known-bad patterns before execution — whether the threat is an honest mistake or a malicious injection.

Security-relevant capabilities in ThumbGate v1.4.0:

- **Self-protection**: 4 checks prevent the governed agent from disabling ThumbGate, modifying check rules, killing governance processes, or overriding enforcement environment variables. A compromised or prompt-injected agent cannot disable its own guardrails.
- **Budget enforcement**: Action count and wall-clock time limits prevent runaway agent sessions from burning resources. Three profiles (strict/guided/autonomous) cap actions at 500/2000/5000 per session.
- **Compliance mapping**: 13 check rules carry NIST SP800-53, SOC2 Trust Services, OWASP Top 10, and CWE tags for enterprise security teams that require framework alignment.
- **Append-only audit trail**: Every check decision (block, approve, log) is recorded with timestamp, tool call, matched check ID, severity, and human override status. The agent cannot modify or delete audit entries.
- **Shared enforcement memory**: Prevention rules propagate across all team seats via a shared SQLite+FTS5 database. A pattern blocked on one seat is immediately enforced on every seat.

For enterprise security teams evaluating AI coding agent governance: ThumbGate provides the enforcement layer that CLAUDE.md rules, prompt engineering, and post-hoc code review cannot — pre-execution blocking with full audit trail and compliance mapping.

*Last updated: 2026-04-13*
