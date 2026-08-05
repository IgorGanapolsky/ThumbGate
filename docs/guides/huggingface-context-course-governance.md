# Hugging Face Context Course: ThumbGate Governance Integration

> **Keywords**: context engineering, AI code agents, Claude Code, Codex, OpenCode, MCP, context course, Hugging Face, sub-agents, hooks, skills, plugins

The [Hugging Face Context Course](https://huggingface.co/learn/context-course) teaches **context
engineering for AI code agents** — structuring knowledge so an agent can efficiently find what
it needs, when it needs it, to improve generated outputs. This is precisely ThumbGate's domain:
ensuring the right context (gates, prevention rules, lessons, and feedback) is available at the
pre-action boundary so agents make fewer wrong turns, produce cleaner diffs, and avoid rework.

## Unit-by-Unit Mapping

### Unit 0: Onboarding → Student Hook Integration
The course sets up Claude Code, Codex, and OpenCode. ThumbGate provides the **security and
governance onboarding layer**:

- Block dangerous commands during exercises (force-push, `rm -rf`, secret egress)
- Enforce local-only scope for practice repos
- Gate `npx` and install scripts during onboarding
- Auto-capture feedback from every student command

**Recommended**: Install ThumbGate hooks as part of course setup. The
`local-only-git-writes`, `force-push`, `secret-egress`, and `blocked-npx-content` gates are
enabled by default in `config/gates/default.json`.

### Unit 1: Agent Skills → Skill Validation
The course teaches building and sharing agent skills. ThumbGate's
`validate-synthesized-skills-against-rules` gate template ensures that synthesized skills
never write code patterns blocked by active prevention rules.

**Recommended gates**:
- `validate-synthesized-skills-against-rules` (existing)
- `prevent-infinite-skill-synthesis-loops` (existing)
- `require-agent-context-freshness` (existing)

### Unit 2: MCP → MCP Governance
The course covers connecting tools and APIs via MCP. ThumbGate is itself an MCP server
(`adapters/mcp/server-stdio.js`) and provides MCP tool safety gates:

- `mcp-sql-delete-block` — SQL MCP `delete_record` requires task scope
- `mcp-sql-execute-warn` — DDL pattern review before execution
- `mcp-sql-bulk-update-warn` — block bulk updates without WHERE clause

**Recommended**: Use ThumbGate's MCP governance guide when connecting new MCP servers.
Always gate MCP tools before allowing agent consumption.

### Unit 3: Plugins → Plugin Safety
The course covers building plugins and workflows. ThumbGate has plugins for Claude Code,
Codex, OpenCode, Cursor, JetBrains, Gemini, and Amp.

**Recommended**: Every plugin installation is a supply-chain decision. Use ThumbGate's
`unverified-skill-use` gate to warn on unverified skills and capture feedback for
prevention rules.

### Unit 4: Sub-agents → Sub-agent Governance
The course covers spawning specialized agents and multi-agent patterns. ThumbGate has
`config/subagent-profiles.json` that defines read-only, verification-focused subagent
profiles.

**Recommended**: Use context-engineering subagent profiles that enforce:
- Read-only file access
- No network egress
- No git push / publish
- All actions logged to feedback loop

### Unit 5: Hooks → Hook Integration
The course covers hooks for "observing, blocking, and automating the agent lifecycle."
**This is ThumbGate's core layer.** Our `gate-check` PreToolUse hook observes, blocks,
or warns on every tool call before execution.

**Recommended**: For context-engineering students, add ThumbGate's `hook-thumbgate-cache-updater.js`
and `hook-auto-capture.js` to automatically capture feedback from every blocked action,
turning mistakes into prevention rules.

### Unit 6: Nano Harness → Proof Harness
The course covers building a minimal agent loop. ThumbGate has multiple proof harnesses
(`scripts/prove-*.js`, `tests/*-test.js`) that validate governance end-to-end.

**Recommended**: Students build their nano harness with ThumbGate gates as the pre-action
layer. See `scripts/prove-hf-context.js` for a context-engineering-specific proof harness.

## High-ROI Integration Checklist

1. **Install ThumbGate hooks** during course setup (onboarding exercise)
2. **Enable `require-agent-context-freshness`** gate for all skill-building exercises
3. **Use `validate-synthesized-skills-against-rules`** when generating new skills
4. **Add context-engineering subagent profiles** with read-only + no-egress constraints
5. **Capture feedback** from every blocked action using `npx thumbgate capture`
6. **Run the proof harness** (`npm run prove:hf-context`) to validate governance

## Context-Quality Gates (from `config/gate-templates.json`)

| Gate Template | Category | Applies To |
|---|---|---|
| `require-agent-context-freshness` | AI Engineering Stack Safety | AGENTS.md, ownership, test commands |
| `require-risk-tiered-ai-review` | AI Engineering Stack Safety | PR review classification |
| `require-sandboxed-background-agent-runtime` | AI Engineering Stack Safety | On-prem, sandboxed runtimes |
| `validate-synthesized-skills-against-rules` | Nous Research Hermes Agent Governance | Skill synthesis |
| `block-dynamic-tool-creation-without-approval` | Claw-Style Enterprise Agent Governance | Dynamic tool creation |
| `enforce-agent-identity-separation` | Claw-Style Enterprise Agent Governance | Agent vs human credentials |

## Model Candidates for Context Engineering

Add `context-engineering` workload to `config/model-candidates.json` for evaluating
models on context structuring, skill synthesis, and MCP tool governance.

```bash
npx thumbgate model-candidates --workload=context-engineering --json
```

## References

- Course: https://huggingface.co/learn/context-course/unit0/introduction
- ThumbGate MCP server: `adapters/mcp/server-stdio.js`
- ThumbGate gate templates: `config/gate-templates.json`
- ThumbGate subagent profiles: `config/subagent-profiles.json`
- ThumbGate hook docs: `docs/guides/mcp-use-integration.md`
- VERIFICATION_EVIDENCE.md
