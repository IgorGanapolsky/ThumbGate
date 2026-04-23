# ThumbGate Demo Video Script — 60 Seconds

**Format:** Screen recording + voiceover
**Target:** Developers using AI coding agents (Claude Code, Cursor, Codex, Gemini)
**Tone:** Direct, technical, no fluff

---

## Scene 1 — The Problem (0–10s)

**On screen:**
Split terminal. Left: agent session from Monday. Right: same agent, today.
Both show identical error output — agent overwrites an existing file without checking, throws an exception, rolls back.
Text overlay at bottom: "Same mistake. Different session. Again."

**Voiceover:**
"Your AI coding agent just repeated the exact same mistake it made last week. It doesn't remember. Every session starts from zero."

---

## Scene 2 — The Solution (10–25s)

**On screen:**
Terminal. Previous failed agent run is visible. Developer types one command:

```
node .claude/scripts/feedback/capture-feedback.js \
  --feedback=down \
  --context="agent overwrote config.json without checking if file exists" \
  --what-went-wrong="destructive write with no existence check" \
  --what-to-change="always check file existence before writing" \
  --tags="file-ops,destructive"
```

Output appears:
```
Feedback captured. Distilling lesson...
Rule generated: BLOCK tool=Write when pattern=overwrite+no-existence-check
Check active. This pattern will be blocked in future sessions.
```

**Voiceover:**
"One thumbs-down. ThumbGate captures the failure, distills it into a prevention rule, and installs a check. The mistake is now permanently blocked."

---

## Scene 3 — Live Demo Walkthrough (25–45s)

**On screen:**
Three-step terminal sequence, commands appearing one at a time with output shown.

**Step 1 — Install:**
```
npx thumbgate init
```
Output:
```
ThumbGate initialized.
SQLite lesson DB: .thumbgate/lessons.db
PreToolUse hook: .claude/settings.json updated
Checks active: 0
```

**Step 2 — Next agent session attempts the same bad Write call:**
```
[PreToolUse] Evaluating: Write { path: "config.json", mode: "overwrite" }
Check matched: destructive-write-no-existence-check (confidence: 0.91)
BLOCKED. Reason: "always check file existence before writing"
```
Red "BLOCKED" text pulses briefly.

**Step 3 — Dashboard:**
```
npx thumbgate dashboard
```
Simple table appears:
```
Checks active:     3
Blocks today:     1
Lessons learned:  7
Last block:       2 minutes ago — destructive-write-no-existence-check
```

**Voiceover:**
"Install in one command. The PreToolUse hook intercepts every agent action before it executes. When a check matches, the call is blocked — with the exact reason, sourced from your own feedback."

---

## Scene 4 — Results (45–55s)

**On screen:**
Dashboard view. Three stat cards animate in:
- "7 lessons learned"
- "3 checks active"
- "1 mistake blocked today"

Below: a short lessons table with two rows visible:
```
destructive-write-no-existence-check   blocked 4x   confidence 0.91
missing-error-boundary-in-react-route  blocked 2x   confidence 0.83
```

Text overlay: "Local-first. SQLite. Nothing leaves your machine."

**Voiceover:**
"Every blocked mistake is logged. Lessons compound over time. Thompson Sampling keeps high-confidence rules active and retires ones that no longer fire. All data stays local — SQLite, no cloud, no telemetry."

---

## Scene 5 — CTA (55–60s)

**On screen:**
Clean dark background. Two lines of text fade in:

```
npx thumbgate init
```

`thumbgate.dev`

**Voiceover:**
"Try ThumbGate free. One command. Your agents stop repeating themselves."

---

## Production Notes

| Scene | Duration | Key visual element |
|-------|----------|--------------------|
| 1 | 10s | Split terminal, repeated failure — instant recognition for the target audience |
| 2 | 15s | Single feedback command → rule generated — the core aha moment |
| 3 | 20s | Live terminal flow — shows real commands, real output, no slides |
| 4 | 10s | Dashboard numbers — proof it works, builds trust |
| 5 | 5s | CTA — minimal, no clutter |

**Font:** Monospace throughout (JetBrains Mono or Fira Code recommended).
**Color palette:** Dark terminal (#1a1a2e), green for success (#00ff88), red for blocks (#ff4444), white text.
**No background music** in the first 25s — let the terminal output read clearly. Subtle ambient after scene 2 is optional.
**Caption track:** Include for LinkedIn and YouTube distribution.
