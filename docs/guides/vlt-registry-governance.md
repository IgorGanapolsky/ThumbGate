# vlt Registry Governance: ThumbGate as the Infrastructure Firewall for the New JavaScript Package Ecosystem

> **Keywords**: vlt, vlt.sh, JavaScript package manager, npm alternative, self-hosted registry, VSR, supply chain security, dependency governance, enterprise agent governance, Infrastructure Firewall

## The vlt Challenge

On August 4, 2026, vlt launched its hosted registry service — a new foundation for
the JavaScript package ecosystem featuring:

- A powerful new package manager client (`vlt install`, `vlt add`, `vlt publish`)
- A self-hosted serverless registry (VSR) for on-prem and air-gapped environments
- A secure npm mirror for faster, more secure dependency consumption
- Universal Dependency Selector Syntax (DSS)
- Built-in supply chain observability

vlt explicitly aims to provide "faster and more secure consumption of npm dependencies."
But like every package registry before it, the security surface is the agent that
consumes from it. AI coding assistants can run `vlt install` autonomously, redirect
registries via `.npmrc` overrides, publish unsigned packages, and pin floating
dependencies — all without human review.

**ThumbGate is the pre-action enforcement layer for vlt agents.**

## Why High-ROI

### 1. New Attack Surface = New Governance Gap
vlt's hosted registry and self-hosted VSR replace npm for many teams. Every
`vlt install`, `vlt add`, and `vlt publish` is a supply-chain decision. ThumbGate
gates these decisions before execution — blocking vulnerable packages, registry
redirects, unpinned versions, and unsigned publishes.

### 2. Enterprise On-Prem/Air-Gapped Market
VSR is built for environments where most enterprise data lives outside public cloud.
ThumbGate's local-first design (MCP hooks, CLI, dashboard) is purpose-built for this
reality. We don't fight the cloud — we govern the local execution boundary.

### 3. Feedback Goldmine
vlt agents create new failure modes: registry redirects to malicious hosts,
floating `@latest` tags hijacked for supply-chain attacks, unsigned package publishes,
wildcard version ranges in monorepos. ThumbGate captures every decision and turns
mistakes into automated prevention rules.

### 4. Claw-Style Agent Synergy
vlt's target users are autonomous agents with file system access and tool-use capabilities.
These are exactly the **claw-style enterprise agents** described in ThumbGate's
governance framework. Combine vlt with:
- Claw-style agent gates: block dynamic tool creation, require review for screen interaction
- Perplexity hybrid inference: local for sensitive vlt workspace operations, cloud for reasoning
- Agent identity separation: claw agents must not use human credentials for audit trails

See: [adapters/claw/CLAW.md](../claw/CLAW.md) and [adapters/perplexity/HYBRID.md](../perplexity/HYBRID.md)

## Implemented Gate Templates

Five new templates in `config/gate-templates.json` under the
**"JavaScript Package Registry Governance"** category:

| Gate | Severity | Action | Blocks |
|---|---|---|---|
| `block-vlt-install-vulnerable-deps` | critical | block | `vlt install`/`vlt add` with CVE-critical/high patterns |
| `require-review-vlt-registry-override` | critical | block | `vlt config set registry` / `vlt registry add` to non-approved hosts |
| `enforce-vlt-workspace-dep-pinning` | high | block | `vlt add`/`vlt install` with `*`, `^`, `~`, `>`, `<`, `>=`, `<=`, `latest`, `next` |
| `gate-vlt-package-publishing` | critical | block | `vlt publish`/`npm publish` without provenance, unsigned, or typosquatting scope |
| `block-vlt-private-registry-bypass` | critical | block | `.npmrc`/env/`vlt config` redirects to non-allowlisted registry hosts |

**Enable**: Add these to your `config/gates/default.json` or use
`npx thumbgate gate-templates` to install from the template catalog.

## Model Candidates

Two vlt candidates are registered in `config/model-candidates.json`:

- **`vlt/vlt-registry-hosted`** — Hosted registry with secure npm mirror
- **`vlt/vlt-vsr-self-hosted`** — Self-hosted VSR for on-prem/air-gapped

New workload: **`js-package-registry-governance`** with metrics for dependency audit
recall, typosquatting detection rate, registry override block rate, and provenance
attestation rate.

```bash
npx thumbgate model-candidates --workload=js-package-registry-governance --json
```

## Getting Started

### Step 1: Install ThumbGate with vlt Agent Config

Add ThumbGate gates to your agent configuration:

```bash
# Claude Code (Claude Code settings → MCP):
npx thumbgate serve

# Codex (~/.codex/config.toml):
# [hooks.pre_tool_use]
# command = "npx"
# args = ["--yes", "--package", "thumbgate@1.34.3", "thumbgate", "gate-check"]

# OpenCode (~/.config/opencode.json):
# Add the thumbgate MCP server with preToolUse gate-check hook
```

See `adapters/vlt/config.toml`, `adapters/vlt/opencode.json`, and
`adapters/vlt/.mcp.json` for ready-to-use configs.

### Step 2: Enable vlt Gate Templates

```bash
npx thumbgate gate-templates | grep "JavaScript Package Registry Governance"
```

### Step 3: Capture Feedback from vlt Agent Sessions

```bash
npx thumbgate capture \
  --signal down \
  --context "vlt install pulled package with known CVE" \
  --tags "vlt,security-risk,supply-chain" \
  --whatWentWrong "Agent installed vulnerable package without running vulnerability scan" \
  --whatToChange "Add gate: block vlt install of packages with critical CVEs"
```

## Proof & Verification

Run the vlt proof harness:

```bash
npm run prove:vlt
```

This validates:
- Gate template patterns match dangerous vlt commands (block path)
- Gate template patterns do NOT match safe vlt commands (allow path)
- Model candidates are registered and recommendable
- Adapter files are valid and pin the shipped version
- All templates satisfy the shared rollout metadata contract

## References

- vlt launch announcement: https://vlt.io/blog/1-0
- ThumbGate gate templates: `config/gate-templates.json`
- ThumbGate model candidates: `config/model-candidates.json`
- vlt adapter guide: `adapters/vlt/VLT.md`
- Proof harness: `scripts/prove-vlt.js` / `tests/vlt-proof.test.js`
- VERIFICATION_EVIDENCE.md
