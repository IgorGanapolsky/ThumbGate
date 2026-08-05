# Hugging Face Context Course — ThumbGate Governance Adapter

The [Hugging Face Context Course](https://huggingface.co/learn/context-course) teaches
context engineering for AI code agents using Claude Code, Codex, and OpenCode. ThumbGate
provides the pre-action enforcement, feedback capture, and prevention-rules layer that
makes every exercise safer and every mistake a learning opportunity.

**Key insight**: *An agent is only as good as the context it has.* ThumbGate ensures the
right governance context (gates, lessons, prevention rules) is available at the pre-action
boundary — before every tool call.

## Setup

The **validate-context-before-codegen** gate template ensures agents check AGENTS.md freshness
before code edits. Enable it in `config/gates/default.json`.

### 1. Install ThumbGate Hooks

Add ThumbGate gates to each supported code agent:

```bash
# Claude Code — add to settings.json hooks
npx thumbgate serve

# Codex — add to ~/.codex/config.toml
# [hooks.pre_tool_use]
# command = "npx"
# args = ["--yes", "--package", "thumbgate@1.34.3", "thumbgate", "gate-check"]

# OpenCode — add MCP server to ~/.config/opencode.json
```

### 2. Enable Context-Engineering Gates

```bash
# Ensure AGENTS.md freshness for every exercise repo
npx thumbgate gate-templates | grep "agent-context-freshness"

# Validate synthesized skills against prevention rules
npx thumbgate gate-templates | grep "validate-synthesized-skills"
```

### 3. Capture Feedback From Exercises

```bash
npx thumbgate capture \
  --signal down \
  --context "Agent generated code without checking AGENTS.md" \
  --tags "context-engineering,missing-context,claude-code" \
  --whatWentWrong "Agent did not read AGENTS.md before editing, introduced style violation" \
  --whatToChange "Enforce require-agent-context-freshness gate before code edits"
```

## Unit-by-Unit Integration

### Unit 0: Onboarding
- Install ThumbGate hooks on day 1
- Enable `local-only-git-writes` for practice repos
- Gate `npx` and install scripts with `blocked-npx-content`
- Auto-capture feedback from the onboarding exercise

### Unit 1: Agent Skills
- Enable `validate-synthesized-skills-against-rules` before writing any new skill
- Use `prevent-infinite-skill-synthesis-loops` to cap repeated rewrites
- Capture feedback on every skill that fails validation

### Unit 2: MCP
- Gate MCP tool calls: `mcp-sql-delete-block`, `mcp-sql-execute-warn`, `mcp-sql-bulk-update-warn`
- Use ThumbGate MCP server for context retrieval and lesson queries
- Block MCP tools with missing side-effect annotations

### Unit 3: Plugins
- Use ThumbGate's `self-protect-config` gate to prevent agents from modifying gate rules
- Capture feedback on plugin installation decisions
- Validate plugin provenance before use

### Unit 4: Sub-agents
- Use context-engineering subagent profiles from `config/subagent-profiles.json`
- Profiles enforce: read-only, no network egress, no git push
- All subagent actions logged to feedback loop

### Unit 5: Hooks
- ThumbGate IS the hook system: `gate-check` is your PreToolUse hook
- Add `hook-thumbgate-cache-updater.js` for automatic feedback capture
- Use `hook-auto-capture.js` to capture lessons from blocked actions

### Unit 6: Nano Harness
- Build your mini agent loop with ThumbGate gates as the pre-action layer
- See `scripts/prove-hf-context.js` for a context-engineering proof harness
- Run `npm run prove:hf-context` to validate your harness

## Adapter Files

- `VLT.md`: This guide
- `config.toml`: For Codex-style (copy into ~/.codex/config.toml)
- `opencode.json`: For OpenCode (copy into ~/.config/opencode.json)
- `.mcp.json`: For Claude Code (copy into project .mcp.json)

All configs pin `thumbgate@1.34.3`.

## Model Candidates

The `context-engineering` workload is registered in `config/model-candidates.json`.
Candidate: `huggingface/context-engineering-agent` — evaluated for context structuring,
skill synthesis, and MCP tool governance.

## References

- Course: https://huggingface.co/learn/context-course/unit0/introduction
- Positioning: `docs/guides/huggingface-context-course-governance.md`
- Proof harness: `scripts/prove-hf-context.js`
- Gate templates: `config/gate-templates.json`
- Subagent profiles: `config/subagent-profiles.json`
- VERIFICATION_EVIDENCE.md
