# Agent Brain Steal — Pancake.ai FORMAT Adaptation

## Steal Source
https://pancake.ai/ — GTM brain for go-to-market agents

## What They Do Right (THEIR FORMAT)

1. **GTM Brain** — learns from your website who buys, what to say, where to find them
2. **Play** — one GTM idea deployed with one click, runs daily on auto-pilot
3. **Source-Attributed Leads** — every lead shows WHY they fit and WHERE the data came from (funding rounds, open roles, tech stacks)
4. **Approval Workflow** — human approves/rejects leads, brain learns from what wins
5. **MCP Integration** — connects to Claude/Codex, builds Plays from chat

## How ThumbGate Steals It (OUR FORMAT)

| Pancake Concept | ThumbGate Equivalent |
|---|---|
| GTM Brain (who buys, what to say) | Agent Brain (what mistakes happen, how to prevent) |
| Play = 1 GTM idea | Rule = 1 prevention from a 👎 |
| Source-Attributed Lead | Source-Attributed Block |
| Approval Workflow (approve/reject leads) | Gate Review (human approves rules before enforcement) |
| MCP Server | MCP Server (already exists) |
| Funding/Open Roles/Tech Stack data | Security findings + lesson DB + git history |

### The Steal: "Agent Brain" Pattern

Instead of positioning ThumbGate as "just a firewall," reframe it as the **Agent Brain** — the system that:

1. **Learns** — captures every 👎 mistake from every agent session
2. **Scores** — assigns confidence_pct, source attribution, modes
3. **Prevents** — blocks the exact mistake pattern before re-execution  
4. **Approval Loop** — humans approve which lessons graduate to hard-deny rules
5. **MCP Access** — agents query the brain via MCP for context-aware gating

### The Steal: "Play → Deploy" Pattern

Pancake: "type a GTM idea → builds a Play → one click deploys it"
ThumbGate: "type a security concern → builds a Rule → one command deploys it"

```bash
# Pancake-style flow adapted for ThumbGate
npx thumbgate rule "git push --force origin main" \
  --from-feedback "fb_1785435078277_umex12" \
  --confidence 0.95 \
  --source "user_feedback,git_history,local_graphrag" \
  --deploy
# → Creates prevention rule + deploys in 1 command
```

### The Steal: Source Attribution (like Pancake's "why they fit")

Every ThumbGate block already shows source attribution:
```
source: local_graphrag_deterministic
confidence_pct: 5.0
modes: ['below_accuracy_floor']
handoff: False
```

We expand this to mirror Pancake's lead card format:
```
source: local_graphrag_deterministic
confidence_pct: 5.0
modes: ['below_accuracy_floor']
handoff: False
evidence: ["feedback_id: fb_1785435078277_umex12", "git_log: abc1234", "lesson: git_force_push_dangerous"]
```

## Monetization Hooks

| Pancake Tier | ThumbGate Equivalent | Price |
|---|---|---|
| Individual (1 seat) | Free (local CLI) | $0 |
| Team (3 seats) | Pro | $19/mo |
| Unlimited + MCP | Enterprise | $49/mo |
| Custom + SLA | Private deployment | $499 diagnostic |

### New Revenue Tier: "Agent Team Brain" ($49/mo)

Steals Pancake's team pricing:
- Unlimited agent sessions
- Cross-agent lesson sharing (Agent A's mistake → Agent B blocked)
- Real-time brain sync across team
- MCP server for agent ↔ brain queries
- Team audit log with approval workflow

### Checkout URLs
- Pro: `https://buy.stripe.com/8x2dR91M84r4cSd9uj3sI3f` ($19/mo)
- Team Brain: `https://buy.stripe.com/agent_team_brain_49` (TBD)
- Playbook: `/playbook.html` ($19 one-time)

## Implementation

`scripts/agent-brain.js` — formalizes the "Agent Brain" lifecycle:
1. `submitMistake(feedback, context)` → stores in `.claude/memory/feedback/`
2. `scoreMistake(mistake)` → assigns confidence + source attribution
3. `createRule(mistake, deploy)` → generates prevention rule, optionally deploys
4. `queryBrain(prompt, scope)` → returns relevant lessons before agent acts (PreToolUse)
5. `requestApproval(ruleId, reviewer)` → routes to thumbgate__approve_protected_action for human review

## Steal Command
`npx thumbgate init` → select "agent-brain-pack"
