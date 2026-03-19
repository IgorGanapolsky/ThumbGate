# Feature Request: Feedback Command/Hook for Amp CLI

**Filed:** 2026-03-10
**Target:** Sourcegraph Amp CLI (ampcode.com)
**Contact:** amp-devs@ampcode.com / @AmpCode on X
**Related:** anthropics/claude-code#4569 (closed as "not planned")

## Summary

Amp CLI currently has no built-in way for users to signal satisfaction or dissatisfaction with an agent response. Request a `/feedback` command (or similar mechanism) that fires a hook event, allowing local feedback systems and MCP servers to capture user preference signals.

## Problem

Amp is a terminal-based CLI tool. There is no mechanism to:
- Express approval/disapproval of an agent response
- Fire a hook event that local systems can intercept
- Call a registered MCP tool with a feedback signal

The only workaround is typing phrases like "thumbs up" or "that was wrong" as a regular prompt, which the `UserPromptSubmit` hook can regex-match. This is indirect, unreliable, and wastes an agent turn.

## Proposed Solutions

### Option A: `/feedback` Command (Preferred)
Add a command palette entry (like existing `/thread`, `/model`, etc.):

```
/feedback up      — signal positive feedback on last response
/feedback down    — signal negative feedback on last response
```

This fires a new `FeedbackSignal` hook event with environment variables:
- `AMP_FEEDBACK_SIGNAL` — `"positive"` or `"negative"`
- `AMP_FEEDBACK_THREAD_ID` — the current thread ID
- `AMP_FEEDBACK_TURN_INDEX` — which agent turn was rated

### Option B: Keyboard Shortcut
A quick key combo (e.g., `Ctrl+Y` / `Ctrl+N`) that emits the same hook event without requiring a command.

### Option C: MCP Tool Callback
When a feedback signal is given, Amp calls a designated MCP tool (e.g., `capture_feedback`) if one is registered, passing `{ signal, threadId, turnIndex }`.

## Use Cases

1. **Local feedback-to-enforcement pipelines** — Track approval rates per skill, action type, and session
2. **DPO training pair export** — Pair positive/negative signals with agent outputs for preference optimization
3. **Autonomy calibration** — Adjust agent confidence thresholds based on user satisfaction trends
4. **Team quality dashboards** — Aggregate feedback across workspace members

## Context

The [mcp-memory-gateway](https://github.com/IgorGanapolsky/mcp-memory-gateway) npm package already has full receiving infrastructure:
- `captureFeedback()` engine in `scripts/feedback-loop.js`
- `capture_feedback` MCP tool in `adapters/mcp/server-stdio.js`
- JSONL logging, DPO export, self-audit, prevention rules
- Multi-platform support (Claude Code, Amp, Codex, Gemini CLI, Cursor)

All that's missing is a first-class way to emit feedback signals from the Amp CLI itself.
