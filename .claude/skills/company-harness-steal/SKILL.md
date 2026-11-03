# Company Harness Steal — LangChain Agent Primitives

## Steal Source
Harrison Chase (LangChain) blog: "The five components of building a company harness"
Tweet: https://x.com/hwchase17/status/2114041443836903662

## What They Do (LangChain Internal Agents)

LangChain built 3 agent types:
- **GTM Agent** — proactive, always-on, monitors email, sends daily briefs
- **OpenSWE** — engineering agent, drafts PRs, runs code review
- **Content Studio** — drafts blogs, images, PowerPoints in company style

## The 5 Company Harness Primitives

1. **Lives where people already work** → LangChain lives in Slack. ThumbGate lives in the terminal + MCP hooks in Claude Code/Cursor/Codex.

2. **Knows who's asking** → OBO identity for some tools (email), fixed identity for others (Twitter). ThumbGate needs identity-scoped rules (global vs per-user vs per-project).

3. **Has memory, scoped globally and/or at user level** → Two-tier memory. ThumbGate has this via `.claude/memory/feedback/` but it's not surfaced as a clean API.

4. **Code runs in a sandbox** → Sandboxes with auth proxy. ThumbGate enforces this via ephemeral verification worktrees.

5. **Large % of runs are scheduled** → Ambient agents, not just on-demand. ThumbGate has no scheduled runner.

## How ThumbGate Steals It

| LangChain Component | ThumbGate Steal |
|---|---|
| Lives in Slack | Lives in PreToolUse hooks (Claude Code, Cursor, Codex) |
| OBO vs Fixed identity | Identity-scoped rules: `scripts/identity-gate.js` |
| Global + User memory | Tiered memory CLI: `node scripts/memory-cli.js [list\|search\|stats]` |
| Sandboxed code execution | Ephemeral verification worktrees (`git worktree add`) |
| Ambient agents (scheduled) | `scripts/ambient-agent.js --once` runs daily health + verification |

### Identity-Scoped Rules (`scripts/identity-gate.js`)
```javascript
// Before agent action, check who's asking + which rules apply
const result = checkIdentityScopedAction('git push --force origin main', {
  userId: 'claude',
  project: 'production',
});
// → { allowed: false, blockedBy: [{ ruleId: 'rule_xyz', scope: 'global', source: 'user_feedback' }] }
```

### Memory Tiers (`scripts/memory-cli.js`)
```bash
node scripts/memory-cli.js stats    # global: 2, user: 0, rules: 0
node scripts/memory-cli.js list all  # all memories
node scripts/memory-cli.js search "git"  # search for git-related lessons
```

### Ambient Agent (`scripts/ambient-agent.js`)
```bash
node scripts/ambient-agent.js --once  # run all ambient tasks now
# Tasks: health_check → verification → memory_cleanup → test_suite → eval_suite
```

## Pro Value
Pro adds:
- Team-wide identity mapping (who blocked what, when)
- Cross-org lesson sharing (Agent A at Company X → Agent B at Company Y)
- Ambient agent scheduling UI (cron-style, no external deps)
- Memory tier analytics (growth rate, hit rate, false-positive rate)

## Steal Command
`npx thumbgate init` → select "company-harness-pack"
