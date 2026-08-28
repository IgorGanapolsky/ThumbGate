# vlt Registry Governance Adapter for ThumbGate

vlt (launched Aug 2026) is a new foundation for the JavaScript package ecosystem: a powerful
package manager client, a hosted registry service with a secure npm mirror, a self-hosted
serverless registry (VSR), and a universal Dependency Selector Syntax (DSS). ThumbGate is the
pre-action enforcement, feedback capture, and prevention-rules layer for agents that consume
and publish packages through vlt.

**Announcement**: https://vlt.io/blog/1-0

## Why High-ROI

- **New attack surface**: vlt's hosted registry and self-hosted VSR replace npm for many
  teams. Every `vlt install`, `vlt add`, and `vlt publish` is a supply-chain decision that
  agents make autonomously — exactly what ThumbGate governs.
- **Enterprise on-prem/air-gapped fit**: VSR (self-hosted serverless registry) is built for
  environments where most data lives outside public cloud — ThumbGate's core stronghold.
- **Feedback goldmine**: Registry redirects, wildcard version installs, unsigned publishes,
  and private-registry overrides create new failure modes to learn prevention rules from.
- **Supply-chain observability**: vlt emphasizes "faster and more secure consumption." ThumbGate
  captures every consumption decision and turns mistakes into automated blocks.

## Implemented Gates

New templates in `config/gate-templates.json` under the
**"JavaScript Package Registry Governance"** category:

| Gate Template ID | Severity | Action |
|---|---|---|
| `block-vlt-install-vulnerable-deps` | critical | block |
| `require-review-vlt-registry-override` | critical | block |
| `enforce-vlt-workspace-dep-pinning` | high | block |
| `gate-vlt-package-publishing` | critical | block |
| `block-vlt-private-registry-bypass` | critical | block |

Enable any of these via `npx thumbgate gate-templates` or by adding them to your
`config/gates/default.json`.

## Setup

### 1. MCP / Agent Configs

**`adapters/vlt/config.toml`** — Codex profile:
```toml
[mcp_servers.thumbgate]
command = "npx"
args = ["--yes", "--package", "thumbgate@1.36.1", "thumbgate", "serve"]

[hooks.pre_tool_use]
command = "npx"
args = ["--yes", "--package", "thumbgate@1.36.1", "thumbgate", "gate-check"]
```

**`adapters/vlt/opencode.json`** — OpenCode profile (see file).

**`adapters/vlt/.mcp.json`** — Claude Code profile with `preToolUse` hook.

All configs pin `thumbgate@1.36.1` (the current shipped version).

### 2. Custom Gate Rules (Optional)

Add vlt-specific rules to your `config/gates/default.json`:

```json
{
  "id": "vlt-registry-allowlist",
  "layer": "Supply Chain",
  "pattern": "(vlt\\s+config|vlt\\s+set|vlt\\s+registry).*(registry|registry-url)",
  "action": "block",
  "unless": "registry_override_approved",
  "message": "vlt registry override to non-allowlisted host. Use gate-satisfy to approve approved VSR domains.",
  "severity": "critical"
}
```

### 3. Capture Feedback

When vlt agents make risky decisions, capture feedback with context:

```bash
npx thumbgate capture --signal down \
  --context "vlt install pulled package with known CVE" \
  --tags "vlt,security-risk,supply-chain" \
  --whatWentWrong "Agent installed vulnerable package without running vulnerability scan" \
  --whatToChange "Add gate: block vlt install of packages with critical CVEs"
```

Tag dimensions:
- `vlt-install` / `vlt-add` / `vlt-publish` / `vlt-registry-override`
- `supply-chain` / `typosquatting` / `provenance-failed`
- `hybrid-route-local` / `hybrid-route-cloud` (if using hybrid inference)

## Model Candidates

Two vlt candidates are registered in `config/model-candidates.json`:

- `vlt/vlt-registry-hosted` — hosted registry service
- `vlt/vlt-vsr-self-hosted` — self-hosted VSR for on-prem/air-gapped

Use `npx thumbgate model-candidates --workload=js-package-registry-governance --json`
to see recommendations.

## References

- vlt launch announcement: https://vlt.io/blog/1-0
- vlt website: https://vlt.io
- ThumbGate gate templates: `config/gate-templates.json`
- ThumbGate model candidates: `config/model-candidates.json`
- ThumbGate proof harness: `scripts/prove-vlt.js` / `tests/vlt-proof.test.js`
