---
name: Agent Memory
description: Recall past mistakes and capture feedback so your agent stops repeating errors. Works locally via MCP server — no API key needed.
---

# Agent Memory

Give your agent persistent memory across sessions. Before starting any task, recall what went wrong last time. After completing work, capture whether it succeeded or failed. Prevention rules are auto-generated from repeated mistakes.

## Setup

Add the MCP server (one-time):

```bash
claude mcp add rlhf -- npx -y mcp-memory-gateway serve
```

No API key needed. All data stays local.

## When to Use

- Starting a new task or session — recall past context first
- After completing work that succeeded or failed — capture feedback
- When the agent keeps making the same mistake — check prevention rules

## Workflow

### Step 1: Recall past context (do this FIRST on every task)

Call the `recall` MCP tool with a description of your current task. The tool returns:

- Past feedback relevant to this task (vector similarity search)
- Active prevention rules (auto-generated from repeated failures)
- Recent feedback summary with approval rate

Read the prevention rules carefully. These are patterns that failed before — follow them.

### Step 2: Do your work

Complete the task as normal. Keep track of what you did and whether it worked.

### Step 3: Capture feedback

Call the `capture_feedback` MCP tool:

**If succeeded:**
- signal: `up`
- context: What worked and why
- tags: Category labels

**If failed:**
- signal: `down`
- context: What you were trying to do
- whatWentWrong: Specific failure description
- whatToChange: How to avoid this next time
- tags: Category labels

Vague feedback like "it failed" will be rejected. Be specific.

### Step 4: Check improvement (optional)

Call the `feedback_stats` MCP tool to see approval rate, top failure domains, and whether the agent is trending better or worse.

## Available MCP Tools

| Tool | What it does |
|------|-------------|
| `recall` | Search past feedback and prevention rules for current task |
| `capture_feedback` | Record what worked or failed with structured context |
| `prevention_rules` | View auto-generated rules from repeated mistakes |
| `feedback_stats` | Approval rate, trend analysis, top failure domains |
| `feedback_summary` | Human-readable summary of recent signals |

## MCP Profiles

| Profile | Tools | Use case |
|---------|-------|----------|
| `essential` | 5 core tools | Default — start here |
| `commerce` | 6 tools + commerce_recall | Agentic commerce agents |
| `default` | 12 tools | Full pipeline including DPO export |

Set profile: `RLHF_MCP_PROFILE=essential npx mcp-memory-gateway serve`

## How Prevention Rules Work

1. Agent makes mistake A → you capture `down` feedback
2. Agent makes mistake A again → you capture `down` feedback again
3. System detects pattern → auto-generates prevention rule: "NEVER do A"
4. Next session → `recall` returns the rule → agent follows it

This is the core value. The agent doesn't learn — but it reads the rules and follows them.

## Links

- [GitHub](https://github.com/IgorGanapolsky/thumbgate)
- [npm](https://www.npmjs.com/package/mcp-memory-gateway)
- [MCP Registry](https://registry.modelcontextprotocol.io)
