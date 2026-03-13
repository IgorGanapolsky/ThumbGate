# I Wasted 2 Hours Chasing Bot Comments. Here's How I Made It Impossible.

*March 13, 2026 -- Igor Ganapolsky*

## The loop

Last week I was working on PR #561 -- an Account Landing Screen for a React Native app. Standard feature work. Push, wait for CI, address review comments, push again.

Except there was an AI code review bot on the repo. And it had opinions.

First push: "This stroke color should use a theme token, not a hardcoded hex." Fine. I fix it.

Second push: "The package-lock.json has drift from package.json." I run `git checkout develop -- package-lock.json` to reset it. That breaks CI because now the lockfile doesn't match the dependencies I actually need.

Third push: "Unused icon import on line 47." I remove it. The bot finds a different unused import it missed last time.

Fourth push: "Consider extracting this into a custom hook." I extract it. Now there's a new file the bot hasn't seen yet, so it has fresh complaints.

Six commits later, my approval rate for the session was 26%. I had mass-produced commits that each introduced new surface area for the bot to nitpick. Two hours gone. The feature itself was done after commit one.

## The actual problem

The problem wasn't the bot. The bot was doing its job. The problem was me -- or more precisely, my AI coding agent -- repeating the same structural mistakes:

1. **Pushing without checking review threads first.** Every push triggers a new review cycle. If you push before resolving existing threads, you're adding fuel to the fire.

2. **Resetting package-lock.json from another branch.** This is always wrong. The lockfile should reflect your current dependency tree. `npm install` is the correct fix.

3. **Chasing cosmetic bot feedback** instead of batching fixes and pushing once.

These aren't novel mistakes. I'd made each of them before. The agent had been told not to. The instructions were in the system prompt. But system prompts degrade -- the agent's attention drifts over long sessions, and the instruction that said "check PR threads before pushing" gets buried under 50K tokens of other context.

## The fix: pre-action gates

I needed something that couldn't be ignored. Not a suggestion in a system prompt. A physical block.

Claude Code has a hook system called `PreToolUse` -- it runs a script before every tool invocation (Bash command, file edit, etc.) and the script can return `deny` to block the action entirely. This is the enforcement point.

I built a gates engine. It's a JSON config file that defines patterns to match against tool invocations, and actions to take when they match:

```json
{
  "gates": [
    {
      "id": "push-without-thread-check",
      "trigger": "Bash:git_push",
      "pattern": "git\\s+push",
      "action": "block",
      "unless": "pr_threads_checked",
      "message": "Check PR review threads before pushing"
    },
    {
      "id": "package-lock-reset",
      "trigger": "Bash:package_lock",
      "pattern": "git\\s+checkout\\s+\\S+\\s+--\\s+package-lock\\.json",
      "action": "block",
      "message": "Never reset package-lock.json from another branch. Run npm install instead."
    }
  ]
}
```

When the agent tries to run `git push`, the gates engine intercepts it. If the `pr_threads_checked` condition hasn't been satisfied in the last 5 minutes, the push is denied. The agent is forced to check review threads first, address any unresolved comments, and only then push.

The `unless` mechanism is key. It's not a permanent block -- it's a prerequisite. You can satisfy the condition by actually doing the work:

```javascript
function isConditionSatisfied(conditionId) {
  const state = loadState();
  const entry = state[conditionId];
  if (!entry) return false;
  const age = Date.now() - entry.timestamp;
  return age < TTL_MS; // 5-minute window
}
```

After the agent queries PR threads (and records that it did), the push gate opens for 5 minutes. This enforces the workflow without permanently blocking anything.

## Auto-promotion: mistakes become gates automatically

The manual gates handle known failure patterns. But what about new ones?

The auto-promotion engine scans the feedback log -- every thumbs-down from the developer gets recorded with context about what went wrong. When the same pattern appears 3+ times in 30 days, it automatically becomes a gate:

- **3 occurrences** = `warn` (agent sees a warning but can proceed)
- **5 occurrences** = `block` (agent is physically stopped)

```javascript
const WARN_THRESHOLD = 3;
const BLOCK_THRESHOLD = 5;
const MAX_AUTO_GATES = 10; // Rotate oldest when full

function buildGateRule(group) {
  const action = group.count >= BLOCK_THRESHOLD ? 'block' : 'warn';
  return {
    id: patternToGateId(group.key),
    action,
    message: `Auto-promoted: "${group.latestContext}" (${group.count} occurrences)`,
    source: 'auto-promote',
  };
}
```

The system maintains a maximum of 10 auto-promoted gates, rotating out the oldest when new ones are added. This prevents unbounded growth while keeping the most relevant failure patterns active.

In my case, the "execution-gap" pattern -- announcing completion without actually pushing -- hit 5 occurrences and auto-upgraded from `warn` to `block`. Now the agent literally cannot claim it's done without the push having happened.

## The result

Before gates: I'd lose 30-120 minutes per PR to avoidable loops. The agent would make the same category of mistake it made last week, last month, three months ago.

After gates: those specific failure modes are impossible. Not unlikely. Not "the agent will try harder." Impossible. The `PreToolUse` hook runs before every tool call, every time, regardless of how degraded the context window is.

The architecture is simple:

```
Developer feedback (thumbs down)
       |
       v
  Feedback log (JSONL)
       |
       v
  Auto-promote scan (3+ = warn, 5+ = block)
       |
       v
  gates config (JSON)
       |
       v
  PreToolUse hook (runs before every tool call)
       |
       v
  Block / Warn / Pass
```

No ML. No fine-tuning. No prompt engineering. Just a regex matcher that runs before every action, backed by a config file that grows from your actual mistakes.

## Try it

mcp-memory-gateway v0.7.0 ships the gates engine, the auto-promotion pipeline, and the PreToolUse hook integration for Claude Code.

```bash
npx mcp-memory-gateway init --agent claude-code
```

This sets up:
- `config/gates/default.json` -- starter gates for common failure patterns
- `scripts/gates-engine.js` -- the PreToolUse hook
- `scripts/auto-promote-gates.js` -- the feedback-to-gates pipeline
- Feedback capture via MCP tools

The gates config is just JSON. Add your own patterns, set your own thresholds, define your own `unless` conditions. The engine doesn't care what agent framework you're using -- it just needs a PreToolUse hook that reads stdin and writes stdout.

MIT licensed. Early-stage project.

GitHub: [github.com/IgorGanapolsky/mcp-memory-gateway](https://github.com/IgorGanapolsky/mcp-memory-gateway)
