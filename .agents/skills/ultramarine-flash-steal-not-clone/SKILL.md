---
name: ultramarine-flash-steal-not-clone
description: >
  Steal Paper Instruments Ultramarine 1 Flash FORMAT patterns (stopping rule,
  concision directives, content fingerprint stale-check, compaction dual-trigger,
  token pre-reservation, rate-limit headers, API key prefixes) onto ThumbGate
  rails. Do NOT vendor Ultramarine weights, Paper Office packages, or Feather
  harness. Slash: /ultramarine-flash-steal-not-clone.
---

# Ultramarine 1 Flash FORMAT steal

## Goal

Adopt 11 architectural patterns from Paper Instruments' Ultramarine 1 Flash
agentic model onto existing ThumbGate rails — improving prompt discipline, file
safety, context management, and budget control — **without cloning the
product**.

ThumbGate is the governance layer, not a model trainer. We steal the
*format* of these patterns and adapt them to our Node.js agent harness,
SQLite lesson DB, and PreToolUse gate architecture.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Vendor Ultramarine weights or Feather harness | Apply patterns onto `hook-pre-tool-use.js`, `gates-engine.js`, `src/api/server.js` |
| Install `paper-docx` / `paper-pptx` / `paper-xlsx` Python packages | Adopt the "typed-error, leave file unchanged" pattern in JS gate logic |
| Clone the 3-sentence training system prompt as production prompt | Use minimal prompt only for `local_free` tier routing |
| Claim 4.1-point benchmark gains | Document pattern + implement locally |
| Route API traffic to `api.paperinstruments.com` | Use existing `scripts/rate-limiter.js` for rate-limit headers |

## Stolen Patterns (Implemented)

### 1. Fork Your Prompts — Concision + Stopping Rule

Added to `AGENTS.md` under "Prompt Tuning Format (Ultramarine FORMAT steal)":

> **Concision with completeness.** The balance that matters most in prose is
> concision with completeness. Concision never comes at the cost of completeness.
>
> **Stopping rule.** Finish when the requested result is usable and the observable
> requirements are satisfied. Once you judge the work complete, the next action
> is the handoff. **YOU MUST NOT KEEP WORKING ON FINISHED WORK.**
>
> **No self-evaluation.** Never evaluate yourself. Do not produce summaries of
> what you did, apologies, or meta-commentary. These are drafting-time directives,
> not a cleanup pass.

### 2. Paper Office Pattern — Typed Error on Unsafe Writes

Applied to `scripts/gate-pre-tool-use.js` `summarizeActionRiskContext()`:
when an edit to a protected file path is rejected, return a typed error
message naming the protection rule rather than attempting a suppressed or
partial modification.

### 3. Content Fingerprint Stale-Check

Added to `scripts/gates-engine.js`: `recordFileFingerprint(path)` records
SHA-256 of file contents on read; `checkFileFingerprint(path)` rejects edits
when on-disk content has changed since the last read.

### 4. Compaction Dual-Trigger

Updated from single 75% threshold to Paper Instruments' dual-trigger:
**85% of context window OR 30,000 tokens remaining, whichever occurs first.**

### 5. API Key Environment Prefixes

Adopted `tg_live_` (production) / `tg_test_` (non-production) prefix scheme
in `src/api/server.js` auth middleware.

## Reference

- https://www.paperinstruments.com/ultramarine
- https://huggingface.co/paperinstruments/Ultramarine-1-Flash
- https://docs.paperinstruments.com/docs/ultramarine
- https://www.paperinstruments.com/blog/ultramarine
