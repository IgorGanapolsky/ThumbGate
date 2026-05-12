# Code Knowledge Graph Guardrails

Code knowledge graphs are useful context. ThumbGate is the enforcement layer that turns that context into pre-action checks before an AI coding agent edits, runs, deploys, or publishes.

This guide is for teams evaluating tools such as Understand Anything, code-graph MCP servers, architecture maps, or internal dependency graphs. Those systems help an agent understand what a codebase looks like. They do not, by themselves, decide whether the next action is allowed to execute.

## The Wedge

Use the graph to answer:

- Which files, functions, and services are connected?
- Which modules are high-centrality or high-risk?
- Which layers will a proposed change cross?
- Which tests, owners, or docs should be checked before editing?

Use ThumbGate to enforce:

- Block edits to high-centrality files until impact has been reviewed.
- Warn before a refactor touches multiple architectural layers.
- Block manual edits to generated graph artifacts.
- Promote known-good graph-guided workflows into reusable lessons.
- Convert thumbs-down feedback into durable prevention rules.

## High-ROI Gate Templates

The first rollout should stay narrow. Do not try to govern every node in the graph. Start with the three cases where context has direct execution value:

1. **Require diff impact before central edits**
   If a graph marks a file as central or critical, a write or patch should require an impact check first.

2. **Checkpoint cross-layer refactors**
   If one agent run crosses API, service, data, and UI layers, require a checkpoint and proof plan before continuing.

3. **Protect generated graph artifacts**
   Knowledge-graph output should be regenerated from source, not hand-edited by the agent.

These templates are shipped in `config/gate-templates.json` under the `Knowledge Graph Safety` category.

Run this after a graph refresh to get the concrete rollout plan:

```bash
npx thumbgate code-graph-guardrails --central-files=src/api/server.js --layers=api,data --generated-artifacts=.codegraph/index.json --json
```

## How To Position This Publicly

Do not pitch ThumbGate as a substitute for graph-based code understanding. That is false and weak.

Use this:

> Code graphs tell the agent what the system is. ThumbGate decides what the agent is allowed to do next.

That makes graph tools partners and demand signals, not enemies.

## Workflow

1. Generate or refresh the code graph.
2. Label high-centrality files, architecture layers, and generated graph outputs.
3. Enable the three graph-informed ThumbGate templates.
4. Run one real AI coding task.
5. Turn any thumbs-down correction into a narrower pre-action rule.
6. Keep proof: command, blocked action, reason, and resulting rule.

The output is not a prettier dashboard. The output is a safer agent run.
