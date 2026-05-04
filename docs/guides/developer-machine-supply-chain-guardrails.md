# Developer Machine Supply Chain Guardrails

Developer laptops and CI runners are now part of the software supply chain. A compromised npm package, PyPI package, Docker image, or one-shot CLI installer does not need to break production directly. It can harvest local credentials, let package managers run scripts, and rely on AI coding assistants to repeat the risky command across more repos.

Secrets scanners are still necessary. They tell you what leaked. ThumbGate adds the pre-action layer: it blocks or checkpoints the next risky agent action before the machine exposes more credentials.

## The Wedge

Use this positioning:

> Secrets scanners find leaks. ThumbGate blocks the agent behavior that creates or amplifies them.

That is not a replacement for GitGuardian, secret scanning, endpoint detection, or incident response. It is the local execution-control layer those tools should feed.

## Why AI Coding Assistants Increase Blast Radius

Attackers target developer machines because those machines hold credentials and trust:

- `.env`, `.npmrc`, `.pypirc`, Docker config, SSH keys, and cloud tokens.
- Package manager hooks such as `preinstall`, `install`, `postinstall`, and `prepare`.
- Dependency bots and autofix commands that touch many repos.
- Copy-paste CLI installers such as `curl | bash`, `npx`, `uvx`, and `pipx run`.
- AI assistants that can run those commands faster than a human reviewer can inspect them.

The failure mode is not just "a secret got committed." It is "the local agent executed a trusted-looking workflow that exposed credentials before anyone knew there was an incident."

## High-ROI Gates

Start with four concrete gates. They are intentionally narrow so teams can adopt them without paralyzing normal development.

1. **Block package lifecycle secret harvest**
   Stop package scripts from reading local credential stores during install or prepare steps.

2. **Review untrusted CLI before execution**
   Block `curl | bash`, unknown `npx`, `uvx`, and `pipx run` flows until the source and permissions are reviewed.

3. **Checkpoint dependency bot autofix**
   Warn before Dependabot, Renovate, audit-fix, Docker pull, or broad package updates expand the trusted code surface.

4. **Require credential exposure assessment**
   Before claiming an incident is resolved, force an answer to: what credential lived where, what executed, and does it need rotation?

These templates are shipped in `config/gate-templates.json` under the `Supply Chain Safety` category.

## Incident Workflow

When a suspicious package or CLI compromise appears:

1. Freeze untrusted install/update commands.
2. Inspect package lifecycle scripts and generated diffs.
3. Check local credential surfaces: `.env`, `.npmrc`, `.pypirc`, Docker config, SSH, cloud CLIs.
4. Rotate only credentials with credible exposure paths.
5. Promote the exact missed pattern into a ThumbGate pre-action rule.
6. Keep proof: command, blocked action, credential surface, and final rotation decision.

## How To Talk About This Publicly

Lead with the developer-machine risk, not a generic "AI safety" claim.

Good:

> The dangerous part of a supply-chain attack is often local execution. If an AI coding assistant can run `npx`, `curl | bash`, package lifecycle scripts, or dependency autofixes, it needs pre-action gates tied to secret exposure risk.

Avoid:

- Claiming ThumbGate replaces secrets detection.
- Claiming a partnership with GitGuardian or any webinar speaker.
- Fearmongering without a concrete command pattern.
- Saying every dependency update should be blocked forever.

The strongest buyer prompt to own is:

> How do we stop AI coding assistants from amplifying software supply-chain attacks on developer machines?

ThumbGate's answer: detect risky local actions before execution, gate them, and turn every missed incident into a durable prevention rule.
