# Skill Exporter — Proof Report

**Date:** 2026-03-31
**Feature:** OpenAI Skills + Codex Plugin export layer

## Feature Description

The Skill Exporter compiles ThumbGate's internal SkillSpec definitions (vendor-neutral IR)
into two target surface formats:

1. **OpenAI Skill JSON** — name, description, model_class, instructions (from policy bundles),
   scripts (gate check + recall injection), and assets (prevention rules, memory scope, tools).
2. **Codex Plugin manifest** — `.codex-plugin/plugin.json` (matching existing codex-profile format),
   `.mcp.json` with tool permissions, and `AGENTS.md` with gating instructions.

Pure local file transformation — no external APIs required.

## Example: OpenAI Skill (pr-reviewer)

```json
{
  "name": "pr-reviewer",
  "description": "Reviews pull requests with ThumbGate memory and gates",
  "model_class": "mini",
  "instructions": "Policy: Balanced autonomous execution bundle with human checkpoints on high-risk actions.\nDefault MCP Profile: default\n\n## Approval Gates\nRequired risk levels for approval: high, critical\n\n## Available Intents\n- capture_feedback_loop [low]: Capture user outcome and update memory artifacts. (capture_feedback, feedback_summary)\n- improve_response_quality [medium]: Summarize recent failures and regenerate prevention rules. (feedback_summary, prevention_rules, construct_context_pack)\n- publish_dpo_training_data [high]: Export DPO preference pairs for model improvement pipelines. (export_dpo_pairs)\n- publish_databricks_analytics_bundle [high]: Export RLHF analytics and proof artifacts as a Databricks-ready bundle. (export_databricks_bundle)\n- incident_postmortem [medium]: Construct evidence pack and record evaluation for incident review. (construct_context_pack, context_provenance, evaluate_context_pack)\n\n## Escalation Rules\n- escalate-on-security-finding\n- escalate-on-breaking-change",
  "scripts": {
    "gate_check": "recall --scope pr-review,code-quality --enforce",
    "recall_injection": "recall --query \"{{context}}\" --scope pr-review,code-quality"
  },
  "assets": {
    "prevention_rules": "config/policy-bundles/default-v1.json",
    "memory_scope": ["pr-review", "code-quality"],
    "tools": ["recall", "capture_feedback", "search_lessons", "enforcement_matrix"]
  }
}
```

## Example: Codex Plugin (pr-reviewer)

**plugin.json:**
```json
{
  "name": "pr-reviewer",
  "version": "0.8.5",
  "description": "Reviews pull requests with ThumbGate memory and gates",
  "author": { "name": "Igor Ganapolsky", "url": "https://github.com/IgorGanapolsky" },
  "homepage": "https://rlhf-feedback-loop-production.up.railway.app",
  "repository": "https://github.com/IgorGanapolsky/ThumbGate",
  "license": "MIT",
  "keywords": ["codex", "codex-plugin", "thumbgate", "pr-reviewer", "pr-review", "code-quality"],
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "ThumbGate: pr-reviewer",
    "shortDescription": "Reviews pull requests with ThumbGate memory and gates",
    "category": "Developer Tools",
    "capabilities": ["Interactive", "Write"],
    "brandColor": "#0ea5e9"
  }
}
```

**.mcp.json:**
```json
{
  "mcpServers": {
    "rlhf": {
      "command": "npx",
      "args": ["-y", "mcp-memory-gateway@0.8.5", "serve"],
      "tools": ["recall", "capture_feedback", "search_lessons", "enforcement_matrix"]
    }
  }
}
```

## Compatibility Matrix

| Spec | OpenAI Skill | Codex Plugin | Model Class | Policy Bundle | Escalation Rules |
|------|-------------|--------------|-------------|---------------|-----------------|
| pr-reviewer | ✅ | ✅ | mini | default-v1 | 2 rules |
| ticket-triage | ✅ | ✅ | nano | constrained-v1 | 1 rule |
| release-status | ✅ | ✅ | nano | default-v1 | 0 rules |

All 3 specs export to both surfaces without error. Policy bundle instructions and escalation
rules are correctly embedded in both OpenAI `instructions` and Codex `longDescription` fields.

## Test Evidence

```
TAP version 13
# Subtest: loadSkillSpec loads pr-reviewer spec correctly
ok 1 - loadSkillSpec loads pr-reviewer spec correctly
# Subtest: loadSkillSpec throws for missing spec
ok 2 - loadSkillSpec throws for missing spec
# Subtest: listAvailableSpecs returns all 3 specs
ok 3 - listAvailableSpecs returns all 3 specs
# Subtest: compileToOpenAISkill produces valid structure with name, description, instructions, model_class
ok 4 - compileToOpenAISkill produces valid structure with name, description, instructions, model_class
# Subtest: compileToOpenAISkill includes gate instructions from policy bundle
ok 5 - compileToOpenAISkill includes gate instructions from policy bundle
# Subtest: compileToCodexPlugin produces plugin.json matching existing codex-profile format
ok 6 - compileToCodexPlugin produces plugin.json matching existing codex-profile format
# Subtest: compileToCodexPlugin includes .mcp.json with correct tool list
ok 7 - compileToCodexPlugin includes .mcp.json with correct tool list
# Subtest: exportSkill writes files to dist/skills/{name}/
ok 8 - exportSkill writes files to dist/skills/{name}/
# Subtest: exportSkill supports target filtering (openai only)
ok 9 - exportSkill supports target filtering (openai only)
# Subtest: exportSkill supports target filtering (codex only)
ok 10 - exportSkill supports target filtering (codex only)
# Subtest: round-trip: spec → openai export → validate required fields present
ok 11 - round-trip: spec → openai export → validate required fields present
# Subtest: round-trip: spec → codex export → validate required fields present
ok 12 - round-trip: spec → codex export → validate required fields present
# Subtest: all 3 reference specs compile without error
ok 13 - all 3 reference specs compile without error
# Subtest: default model class is preserved in exports
ok 14 - default model class is preserved in exports
# Subtest: escalation rules appear in generated instructions
ok 15 - escalation rules appear in generated instructions
1..15
# tests 15
# pass 15
# fail 0
# duration_ms 54.865958
```
