# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| Latest `main` / current npm `thumbgate` release | Yes |
| Older npm versions | Best-effort; upgrade recommended |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: **iganapolsky@gmail.com** (subject: `ThumbGate security`)

Include:

- Affected package/version or commit
- Reproduction steps / PoC (non-destructive preferred)
- Impact assessment
- Whether the issue is already public

You should receive an acknowledgment within a few business days. We will coordinate disclosure after a fix is available when possible.

## Scope

In scope:

- Remote code execution, auth bypass, secret leakage in the hosted API or npm package
- PreToolUse / gate bypass that allows catastrophic classes despite default deny
- XSS / injection on `thumbgate.ai` production surfaces

Out of scope:

- Issues that require already-compromised local machine root
- Social engineering of the maintainer
- Dependency CVEs already tracked by Dependabot with no practical exploit path in our usage

## Deployment model: gate config lives outside the agent's writable workspace

Follow-up from issue #2781. `scripts/self-protection.js` and
`scripts/gates-engine.js`'s hard-floor gates (`self-protect-config`,
`self-protect-hooks-disable`, etc.) stop an agent from *casually* rewriting
ThumbGate's own hook wiring or gate config with an `Edit`/`Write`/`Bash` tool
call — but they run inside the same process tree the agent's tool calls run
in. An agent with a shell has other ways to reach the filesystem than the
tool-call surface ThumbGate inspects (e.g. a script it writes and executes
separately). Self-protection is a floor against the common failure mode
(the agent decides the gate is slowing it down and edits it away mid-task),
not a sandbox boundary.

For deployments where the agent must not be able to touch its own
governance under any circumstance, put the actual enforcement point outside
the agent's writable workspace:

- Run the `PreToolUse`/hook process under a different OS user than the agent,
  with the gate config (`config/gates/**`, `.claude/settings*.json`,
  `.codex/config.toml`) owned and writable only by that other user.
- Or run the agent in a container/VM where `config/gates/**` and the hook
  scripts are bind-mounted read-only.
- Or centralize enforcement in a hosted/remote gate-check service the agent
  calls into, rather than a local hook script the agent's own process can
  reach on disk.

Every ThumbGate-integrated adapter (Claude Code's `PreToolUse` hook, the
`thumbgate gate-check` CLI path, `thumbgate hermes-gate` for the Hermes
Agent, and MCP tool calls via `src/api/server.js`) already funnels through
the same shared `scripts/gates-engine.js` evaluation engine, so this
self-protection floor is not Claude-Code-specific — but "shared code path"
is not the same guarantee as "outside the agent's reach." Use one of the
isolation patterns above when that stronger guarantee is required.

## Automated scanning

This repository enables:

- GitHub Code scanning (CodeQL)
- Dependabot alerts
- Secret scanning
