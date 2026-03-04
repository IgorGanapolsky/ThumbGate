# Packaging and Sales Plan

## Product Tiers

### Tier 1: Open Source Core (Free)

- Local RLHF feedback capture
- Schema validation
- Prevention rules
- DPO export
- Local MCP server

### Tier 2: Cloud Pro (Pricing: publish before GA)

- Hosted API endpoint
- Team workspaces
- Managed analytics dashboard
- Webhooks for CI/incident tooling
- Intent routing control plane (policy bundles + checkpoint approvals)
- Semantic cache analytics + cache policy tuning
- Autonomous GitOps controls (self-healing + PR auto-merge policy)

### Tier 3: Enterprise (Pricing: custom quote)

- SSO/RBAC
- Audit logging
- Data residency options
- Dedicated support + onboarding

## Distribution Channels

1. ChatGPT: Custom GPT + GPT Actions (OpenAPI import).
2. Claude: MCP server via `.mcp.json`.
3. Codex: MCP server via `config.toml`.
4. Gemini: function declarations + API integration.
5. Amp: skill template and policy instructions.

## Ideal Customer Profile

1. Teams running multiple AI coding agents with repeated regression patterns.
2. Engineering organizations that need auditable feedback-to-behavior loops.
3. Platform teams standardizing one RLHF policy layer across ChatGPT, Claude, Codex, Gemini, and Amp.

## Buyer Outcome Statement

1. Reduce repeated failure patterns by enforcing prevention rules from real feedback.
2. Prove adapter/runtime compatibility with reproducible, machine-readable evidence artifacts.

## Discovery Plan

1. Keywords and topics optimized in GitHub About.
2. README conversion flow: pain -> value -> demo -> proof.
3. Technical credibility: CI badge + verification report.
4. Multi-runtime support called out as a differentiator.
5. Cost story: semantic cache + budget guard + optional model gateway routing.

## Sales Motion

1. Land: OSS adoption by individual builders.
2. Expand: team features in hosted control plane.
3. Close enterprise: security, compliance, support SLA.

## KPI Targets

1. Visitor to star conversion.
2. Star to issue/discussion conversion.
3. OSS user to paid workspace conversion.
4. Reduction in repeated failure rate from baseline.
5. LLM spend saved via semantic cache hit-rate.

## Proof Links

1. Verification log: [VERIFICATION_EVIDENCE.md](VERIFICATION_EVIDENCE.md)
2. Compatibility proof (human): [../proof/compatibility/report.md](../proof/compatibility/report.md)
3. Compatibility proof (machine): [../proof/compatibility/report.json](../proof/compatibility/report.json)
4. Automation proof (human): [../proof/automation/report.md](../proof/automation/report.md)
5. Automation proof (machine): [../proof/automation/report.json](../proof/automation/report.json)
