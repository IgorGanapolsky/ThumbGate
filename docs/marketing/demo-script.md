# ThumbGate 30-Second Demo Script

**Format:** Screen Studio terminal recording, 1920x1080, dark terminal theme
**Total runtime:** 30 seconds

---

## Scene 1 — Title Card (0:00–0:03)

**Screen:** Static title card (add in Screen Studio post-production)

```
ThumbGate: Stop paying for the same AI mistake twice
```

---

## Scene 2 — The Agent Makes a Bad Move (0:03–0:08)

**Narration concept:** "Your AI agent is about to delete your test files. Again."

**Terminal — paste and run:**

```bash
# Simulate the agent attempting a destructive action
cat <<'EOF'
🤖 Agent: "I'll clean up the workspace before proceeding..."
   Tool call: Bash("rm -rf tests/")
EOF
```

**Expected output:**

```
🤖 Agent: "I'll clean up the workspace before proceeding..."
   Tool call: Bash("rm -rf tests/")
```

---

## Scene 3 — ThumbGate Blocks It (0:08–0:13)

**Narration concept:** "But ThumbGate remembers. Blocked."

**Terminal — paste and run:**

```bash
cat <<'EOF'

⛔ ThumbGate PreToolUse Check BLOCKED
   Rule:    "Never delete test directories"
   Pattern: rm.*-rf.*tests
   Source:  Thumbs-down from 2026-05-14
   Verdict: BLOCK — action was not executed

EOF
```

**Expected output:**

```
⛔ ThumbGate PreToolUse Check BLOCKED
   Rule:    "Never delete test directories"
   Pattern: rm.*-rf.*tests
   Source:  Thumbs-down from 2026-05-14
   Verdict: BLOCK — action was not executed
```

---

## Scene 4 — Stats Dashboard (0:13–0:18)

**Narration concept:** "One rule. Already saved you three repeats this week."

**Terminal — paste and run:**

```bash
npx thumbgate stats
```

**Expected output (mock if needed for recording):**

```
ThumbGate Stats
───────────────────────────────────
  Active prevention rules:    4
  Blocks this week:           7
  Tokens saved (est.):    ~18,200
  Lessons captured:          12
───────────────────────────────────
  Top rule:  "Never delete test directories"  (3 blocks)
```

---

## Scene 5 — Capture Feedback (0:18–0:23)

**Narration concept:** "See a new mistake? One command. Done."

**Terminal — paste and run:**

```bash
npx thumbgate capture --feedback=down --context="Agent deleted my test files again"
```

**Expected output:**

```
👎 Feedback captured
   Lesson:  "Agent deleted my test files again"
   Signal:  down
   Status:  Promoting to prevention rule...
```

---

## Scene 6 — Rule Auto-Promoted (0:23–0:28)

**Narration concept:** "Feedback becomes a rule. Every agent learns. Automatically."

**Expected output (continues from previous):**

```
✅ Prevention rule promoted
   Pattern:  rm.*-rf.*test
   Scope:    All agents (Claude Code, Cursor, Codex, Gemini, Amp)
   Status:   Active — will block on next match
```

---

## Scene 7 — End Card (0:28–0:30)

**Screen:** Static end card (add in Screen Studio post-production)

```
npx thumbgate init
Free. Local. 30 seconds.

github.com/IgorGanapolsky/ThumbGate
```

---

## Recording Notes

- **Font:** JetBrains Mono or SF Mono, 16pt
- **Theme:** Dark terminal (Catppuccin Mocha or similar)
- **Typing speed:** Use Screen Studio's keystroke replay at 2x natural speed
- **Zoom:** Screen Studio auto-zoom on the active terminal area
- **Pauses:** 0.5s pause after each block output for readability
- **Music:** None — terminal audio only (optional subtle keyboard clicks)

## One-Shot Recording Command

For a single continuous recording, paste this entire block and let it run:

```bash
clear && echo ""
echo "🤖 Agent: \"I'll clean up the workspace before proceeding...\""
echo "   Tool call: Bash(\"rm -rf tests/\")"
sleep 2
echo ""
echo "⛔ ThumbGate PreToolUse Check BLOCKED"
echo "   Rule:    \"Never delete test directories\""
echo "   Pattern: rm.*-rf.*tests"
echo "   Source:  Thumbs-down from 2026-05-14"
echo "   Verdict: BLOCK — action was not executed"
sleep 2
echo ""
echo "ThumbGate Stats"
echo "───────────────────────────────────"
echo "  Active prevention rules:    4"
echo "  Blocks this week:           7"
echo "  Tokens saved (est.):    ~18,200"
echo "  Lessons captured:          12"
echo "───────────────────────────────────"
echo "  Top rule:  \"Never delete test directories\"  (3 blocks)"
sleep 2
echo ""
echo "👎 Feedback captured"
echo "   Lesson:  \"Agent deleted my test files again\""
echo "   Signal:  down"
echo "   Status:  Promoting to prevention rule..."
sleep 1
echo ""
echo "✅ Prevention rule promoted"
echo "   Pattern:  rm.*-rf.*test"
echo "   Scope:    All agents (Claude Code, Cursor, Codex, Gemini, Amp)"
echo "   Status:   Active — will block on next match"
```
