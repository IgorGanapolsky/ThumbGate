# YouTube Episode 1: Your CLAUDE.md File is a Wish List

**Format:** Screen recording + voiceover (no face needed)
**Length:** 6-8 minutes
**CTA:** GitHub star + Pro checkout + Team workflow sprint intake

---

## HOOK (0-5 seconds)

"Your CLAUDE.md file has 50 rules. Your AI agent ignores half of them. Here's why — and what actually works."

## PROBLEM (5-60 seconds)

[Screen: Open a CLAUDE.md with 50+ rules]

"Every Claude Code user eventually builds a massive CLAUDE.md file. Don't edit these files. Always run tests. Never force-push to main.

The problem? These are suggestions. They live in the prompt. The agent can — and does — ignore them.

I watched my agent force-push to main three times in one week. Each time, CLAUDE.md clearly said not to. The rule was RIGHT THERE."

## THE INSIGHT (60-120 seconds)

[Screen: Show a PreToolUse hook intercepting a git push]

"The difference between a suggestion and enforcement is WHERE it lives.

CLAUDE.md is prompt engineering. It's in the context window, competing with everything else for attention.

A PreToolUse hook is a physical gate. It fires BEFORE the tool call executes. The agent literally cannot push to main because the hook blocks the command before it runs.

One is a wish list. The other is a bouncer."

## THE DEMO (120-300 seconds)

[Screen: Terminal — install ThumbGate]

"Let me show you. Starting from zero."

```
npx thumbgate init --agent claude-code
```

"This wires a PreToolUse hook into Claude Code. Now let's create a gate."

[Screen: Give a thumbs-down in Claude Code after a bad action]

"I just told the agent to edit a config file, and it edited the wrong one. Instead of writing a CLAUDE.md rule manually, I give it a thumbs-down."

[Screen: Show the auto-generated prevention rule]

"ThumbGate captures what went wrong, infers a structured lesson, and creates a gate. Next time the agent tries to edit that file without reading it first — blocked."

[Screen: Show the agent being blocked on the next attempt]

"See? The hook fired. The edit was blocked before it executed. Not because of a prompt. Because of a gate."

## THOMPSON SAMPLING (300-360 seconds)

[Screen: Show gate confidence changing over multiple sessions]

"But what if the gate is too aggressive? What if it blocks legitimate edits?

Each gate has a confidence score modeled as a Beta distribution. When it correctly blocks a mistake, confidence goes up. When it fires on a false positive, confidence goes down.

Over time, good gates get stricter. Bad gates relax. Self-correcting. No manual tuning."

## SELF-DISTILLATION (360-420 seconds)

[Screen: Show self-distill agent output]

"New feature: you don't even need to give thumbs-down.

Self-distillation mode evaluates agent outcomes automatically. Did the test fail after the edit? Was the edit reverted? Did the user say 'undo'?

Each detected failure becomes a prevention rule. Your agent gets smarter every session — without you doing anything."

## CTA (420-480 seconds)

[Screen: GitHub repo + Pro checkout + Team intake link]

"ThumbGate is free and open source. Star the repo if this was useful.

If you want the personal local dashboard, DPO export, multi-hop recall, and proof-ready debugging for your own workflow, Pro is $19/mo or $149/yr.

If this needs to protect a team, start with the Workflow Hardening Sprint. Team pricing anchors at $99/seat/mo with a 3-seat minimum after qualification."

---

## TITLE OPTIONS (A/B test)
1. "Your CLAUDE.md File is a Wish List — Here's What Actually Enforces Rules"
2. "I Stopped My AI Agent From Repeating Mistakes (Not With Prompts)"
3. "CLAUDE.md vs PreToolUse Hooks: Which One Actually Works?"

## THUMBNAIL
- Split screen: Left side = messy CLAUDE.md file (red X). Right side = clean terminal with "BLOCKED" message (green check).
- Text overlay: "WISH LIST vs ENFORCEMENT"

## DESCRIPTION
```
Your CLAUDE.md file has 50 rules. Your AI agent ignores half of them.

ThumbGate adds physical enforcement via PreToolUse hooks — every mistake becomes a prevention rule that blocks the action next time.

🔗 GitHub: https://github.com/IgorGanapolsky/ThumbGate
🔗 Pro ($19/mo or $149/yr): https://thumbgate-production.up.railway.app/checkout/pro
🔗 Team workflow sprint intake: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
🔗 npm: npm install thumbgate

Install: npx thumbgate init --agent claude-code

Timestamps:
0:00 The CLAUDE.md problem
1:00 Suggestions vs enforcement
2:00 Live demo: install + first gate
5:00 Thompson Sampling explained
6:00 Self-distillation mode
7:00 How to get started

#ClaudeCode #AIAgents #CodingTools #ThumbGate #PreToolUse
```

## WEEKLY PRODUCTION SCHEDULE

| Day | Content | Format |
|-----|---------|--------|
| Mon | Generate 5 video ideas (prompt 1) | Planning |
| Tue | Write 2 scripts (prompt 2) | Writing |
| Wed | Record 1 long-form + 2 shorts | Recording |
| Thu | Edit + publish long-form | Publish |
| Fri | Publish 2 shorts | Publish |
| Sat | Review analytics, iterate | Optimize |
