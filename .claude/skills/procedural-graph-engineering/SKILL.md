---
name: procedural-graph-engineering
description: Zachary Blumenfeld "Make Your AI Agents Predictable With Graph Engineering" (https://www.youtube.com/watch?v=g_NgCLTibiM) architectural steal. Builds a 3-layer Unified Context Graph, extracts canonical working paths from unconstrained decision traces, compiles unstructured SKILL.md files into deterministic Graph YAML, wraps execution in a lightweight CLI, downgrades orchestrating models to Haiku / local Drex Max v1, and persists skill runs back to the graph for branch-drift governance. Slash: /procedural-graph-engineering.
---

# Procedural Graph Engineering (`procedural-graph-engineering`)

Operationalizes Zachary Blumenfeld's 6-pillar **Graph Engineering** workflow on ThumbGate's local-first pre-action rails without external Neo4j/hosted vendor lock-in:

1. **Unified 3-Layer Context Graph (`ingestUnifiedContextNode`)**:
   - `short_term_memory`: Active conversation history & session turns.
   - `long_term_memory`: Extracted domain entities linked to Systems of Record (`snowflake`, `databricks`, `obsidian_markdown`, `stripe_billing`, `github_repo`, `thumbgate_ledger`).
   - `decision_traces`: Timestamped reasoning chains & tool calls (`steps`, `toolCalls`, `outcome`, `entityIds`).
2. **Canonical Working Path Discovery (`discoverCanonicalPath`)**:
   - Filters noisy, inconsistent unconstrained agent runs strictly for `outcome === 'PASS'`, strips retry loops, and isolates the shortest canonical step sequence.
3. **Compile Unstructured `SKILL.md` + Traces into Graph YAML (`compileSkillToGraphYaml`)**:
   - Converts prose rules into 4 explicit deterministic node kinds:
     - `hard_rule_script`
     - `validation_lint_loop`
     - `escalation_router`
     - `calibrated_decision_model`
4. **Lightweight CLI Wrapper (`scripts/procedural-graph-cli.js`)**:
   - Compile: `node scripts/procedural-graph-cli.js compile .agent/skills/checkout-recovery/SKILL.md`
   - Run: `node scripts/procedural-graph-cli.js run --graph-id graph_checkout-recovery --context '{"policyCompliant":true,"riskScore":0.1}'`
   - Audit: `node scripts/procedural-graph-cli.js audit --json`
5. **Small Model (SLM) Execution Downgrade (`recommendModelDowngrade`)**:
   - When `deterministicOffloadRatio >= 0.50`, automatically downgrades from `claude-opus-4-7` (`$15/1M`) to `claude-haiku-4-5` (`$0.80/1M`) or local `nace-ai/drex-max-v1-local` (`$0.00/1M`).
6. **Governance & Branch Drift Persistence (`auditGraphGovernance`)**:
   - Logs every run back to the graph (`TRIGGERED_BRANCH`, `GOVERNED_ENTITY`) and reports `neverTriggeredBranches`, `branchCoveragePct`, and `driftScore`.
