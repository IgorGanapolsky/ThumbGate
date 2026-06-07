# ThumbGate Threat Model

ThumbGate is a **policy + learning layer** for AI coding agents, enforced through PreToolUse
hooks and MCP gates. This document states plainly **what that layer enforces** and — just as
importantly — **what it does not, and what you must pair it with**. A guardrail you can't reason
about is a guardrail you can't trust, so we publish the limits, not just the features.

## What ThumbGate is

A local-first interception layer between an AI coding agent (Claude Code, Cursor, Codex, Gemini
CLI, Amp, Cline) and its tool calls. On each call it can **allow / warn / block** based on policy
plus learned rules, and it captures corrections (👍/👎) and promotes them into prevention rules.

## The enforcement boundary (the key distinction)

ThumbGate enforces at the **tool-call boundary** — the call the agent hands to the host. It is a
**policy and observability layer, not a containment boundary.** It decides on the *visible* call;
it does not own the OS, the filesystem, or the network.

### What the hook DOES enforce (policy layer)

- **Known-bad pattern gates** on the visible call — e.g. recursive `chmod`, destructive `rm`
  shapes, and dependency/typosquat installs (`slopsquat-guard`).
- **MCP-profile privilege-escalation detection** — flags a call that jumps outside the agent's
  declared tool allowlist (`agent-security-hardening`).
- **Task scope** — `allowedPaths` / `protectedPaths` for the current task. *Advisory at the hook
  layer:* it can deny a Write it sees; it cannot stop a process the OS still permits.
- **Claw-style gates** — dynamic-tool creation, screen/UI, identity, filesystem, and hybrid
  local/cloud escalation checks.
- **Claim / evidence gates** — block "done / deployed / merged" claims until paired evidence
  exists (the system governs its own agents, too).
- **Learning** — every caught mistake/correction is promoted to a rule, so a bypass caught once is
  denied next time instead of relearned.

### What the hook does NOT contain (honest limits)

A PreToolUse hook evaluates the call it is given. It therefore **cannot, by itself, stop execution
that happens one layer down** from the observed call:

- `curl … | bash` / `wget … | sh` — payload fetched and executed inside one approved call.
- **Write-then-run** — write an allowed helper script, then execute it.
- **Package-script wrappers** — `npm/pnpm/yarn run <script>` where the script does the real work.
- **Subprocess / process handoff** — work delegated to a process the hook never sees.
- **Network egress** the hook is not positioned to observe.

If your threat model includes a capable or adversarial agent, **a hook alone is insufficient.**
This is a property of the layer, not a defect to patch away — interception at the tool boundary is
the wrong place for containment.

## Recommended architecture: policy layer **on top of** a containment boundary

ThumbGate is strongest paired with an OS/sandbox boundary that owns what the hook cannot:

- an **allowlisted working directory** and a **minimal set of writable paths**;
- a **process boundary** (no unsupervised subprocess escape);
- a **network boundary** (egress allowlist).

> **Containment (sandbox)** = what the agent physically *can* do.
> **ThumbGate (policy + learning)** = what the agent is *allowed* to do, and what it learns not to
> repeat.

You want both. ThumbGate does not replace seccomp/containers/VM isolation or Claude Code's own
sandbox — it makes the policy *on top of* those boundaries learnable and auditable. The
`stateful-helper-script-bypass` gate additionally **correlates helper-script and `package.json`
writes with later risky execution**, and blocks the common indirection chains it can see —
`curl … | bash`, `chmod +x` → execute, write-then-run, and package-script (`npm run …`) wrappers.
That is defense-in-depth that catches the obvious bypasses; it is **never** a substitute for the
containment boundary, because a determined agent can still reach execution paths the hook never
observes.

## Reporting a bypass

Found a way around a gate? That is exactly the contribution we want. Open a
[GitHub issue](https://github.com/IgorGanapolsky/ThumbGate/issues), or a private
[security advisory](https://github.com/IgorGanapolsky/ThumbGate/security/advisories/new) for
sensitive reports. Reported bypasses get promoted into prevention rules.
