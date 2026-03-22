# Response to @keshavsuki — 5-Layer Memory Stack

**Competitor:** @keshavsuki on Instagram
**Repo:** github.com/ksukirya/recall-stack
**Their angle:** 5-Layer Memory Stack (CLAUDE.md, primer.md, memory.sh, self-learning, Obsidian)
**Our angle:** Memory without enforcement = hope. Pre-Action Gates = physical blocking.

---

## REEL SCRIPT

**Title:** "5 layers of memory. Zero layers of enforcement."
**Format:** Response/stitch to @keshavsuki's reel (or standalone)
**Duration:** ~45 seconds

### HOOK (text on screen, first 3 seconds)
> "This 5-layer memory stack has one fatal flaw"

### SCRIPT (talking to camera + screen recording)

"This memory stack for Claude Code is smart. CLAUDE.md, primer files, git context, learning memory, knowledge base. Five layers."

[Beat]

"But what happens when Claude compacts your context and forgets all five layers?"

[Show terminal: Claude ignoring a rule]

"Memory tells Claude what to do. It doesn't STOP Claude from doing the wrong thing."

"That's why I built Pre-Action Gates. They're hooks that fire before every tool call. If Claude tries something it's failed at 3+ times — the action is BLOCKED."

[Show GATE BLOCKED terminal message]

"Memory = please remember this.
Gates = you literally cannot do this."

[Show install command]
"One command. Free. Works on top of any memory stack."

`npx mcp-memory-gateway init --agent claude-code`

### TEXT OVERLAY
> "Memory + Enforcement > Memory alone"

### CTA
> "Link in bio"

### HASHTAGS
#ClaudeCode #AIcoding #DevTools #MCP #MemoryStack #VibeCoding #PreActionGates #CodingAgent

---

## COMMENT ON HIS POST

```
Great stack. We built the enforcement layer that sits on top of this — Pre-Action Gates that physically block tool calls when Claude repeats known failures. Memory tells Claude what to remember. Gates stop it from doing the wrong thing even when it forgets. github.com/IgorGanapolsky/mcp-memory-gateway
```

---

## DM TO @keshavsuki

```
Hey — love the 5-layer memory stack. I built the complementary piece: Pre-Action Gates that block known-bad tool calls via PreToolUse hooks. Your layers handle context/memory, mine handles enforcement when context gets compacted away. Could be a natural pairing. Would love to compare notes. github.com/IgorGanapolsky/mcp-memory-gateway
```

---

## CAROUSEL POST (Instagram — 5 slides)

### Slide 1 (hook)
> **Why memory alone isn't enough for AI coding agents**

### Slide 2
> 15+ MCP memory tools exist.
> claude-mem: 37K stars
> Mem0: VC-funded
> Official server: 61K downloads
>
> They all do the same thing: store -> recall -> hope the agent reads it.

### Slide 3
> **The problem: agents don't always cooperate.**
> - Context gets compacted -> rules forgotten
> - Agent doesn't call recall() -> memory unused
> - New session -> blank slate, same mistakes

### Slide 4
> **Pre-Action Gates fix this.**
> - Hooks fire BEFORE every tool call
> - No agent cooperation needed
> - Survives compaction
> - 3 failures -> auto rule
> - 5 failures -> blocking gate

### Slide 5 (CTA)
> **Memory + Enforcement > Memory alone**
>
> `npx mcp-memory-gateway init`
>
> Free. MIT licensed.
> github.com/IgorGanapolsky/mcp-memory-gateway
>
> Works with Claude Code, Codex, Gemini, Cursor

### CAPTION
```
Every AI memory tool asks the agent to cooperate. Pre-Action Gates don't ask — they enforce. Built for the 1% of the time when Claude forgets everything you taught it. Link in bio.

#ClaudeCode #AIcoding #MCP #DevTools #PreActionGates #VibeCoding #BuildInPublic #IndieHacker #OpenSource
```

---

## TERMINAL DEMOS TO RECORD

### Demo 1: Gate blocking a repeated mistake
```bash
# Show Claude trying to force push (blocked by gate)
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force"}}' | node scripts/gates-engine.js
```
Expected output: `[GATE:force-push] Force push blocked. This is destructive and irreversible.`

### Demo 2: Install command
```bash
npx mcp-memory-gateway init --agent claude-code
```

### Demo 3: Audit trail showing enforcement
```bash
npm run audit:stats
```
Shows real allow/deny/warn counts — proof that gates are active.

### Demo 4: Skill adherence rate
```bash
node scripts/audit-trail.js --adherence
```
Shows per-tool adherence percentages — the metric @keshavsuki's stack can't produce.
