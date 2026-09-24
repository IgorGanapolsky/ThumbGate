---
name: soft-memory-thin
description: >-
  Route lasting agent corrections to ThumbGate (capture_feedback → prevention_rules /
  skills / alwaysApply / evals); keep Soft Obsidian Agents/Memory thin — surface leases,
  one-liners, open Waiting - [ ] only. Never Soft Memory diaries / mermaid blueprints /
  research novels. Use when writing Agents/Memory, tempted to log a session diary, after
  Hawk/Harsh "autonomous memory worthless", or deciding ThumbGate vs Soft Memory.
---

# Soft Memory thin (ThumbGate-owned route)

**Why (Hawk/Harsh):** autonomously generated notes/memory are mostly worthless and get
worse as they grow. If a memory tool needs you to review what it captured, it captured
too much. Keep only corrections you’d hate to repeat — those live in **ThumbGate**, not
Obsidian firehose.

## Decision table

| Intent | Rail | Do this |
| --- | --- | --- |
| Correction you’d hate to repeat / lasting pref | `thumbgate_capture` | MCP `capture_feedback` → `prevention_rules` / skill / alwaysApply / eval |
| Shared surface ownership | `memory_lease` | Thin Soft Memory lease: owner + surface + UTC (compose multi-agent-coordination) |
| Blocked on a named human | `memory_waiting` | Soft Memory with `Waiting on X:` + `- [ ]` + owner |
| Research novel / mermaid blueprint / session diary | `reject_firehose` | **Do not write** Soft Memory |

## Commands

```bash
# Classify before writing
node scripts/soft-memory-thin.js route --intent "I'd hate to repeat Fast ON" --json
node scripts/soft-memory-thin.js route --intent "claim psn-qa-iis-deploy lease" --json

# Gate a Soft Memory draft
node scripts/soft-memory-thin.js check --file ~/Documents/Igor/Agents/Memory/note.md
npm run soft-memory:thin -- --fixture-good
npm run soft-memory:thin -- --fixture-bad
npm run test:soft-memory-thin
```

secure-yolo wrapper (calls this script): `bash secure-yolo/scripts/verify-soft-memory-thin.sh`

## Soft Memory budget

- ≤ **40** non-empty body lines (after YAML frontmatter)
- No mermaid / Executive verdict / Architecture essay / session diary
- Lasting-language without a ThumbGate/rule/skill/eval pointer → **FAIL**

## Compose

- `skills/agent-memory` — recall / capture MCP loop
- `skills/thumbgate-guard` — force-promote a block gate
- multi-agent-coordination — leases stay; this skill only thins the Memory write
- fb_1790178290687_j4xiey — Soft Memory firehose → ThumbGate

## Forbidden

```
# ❌ BAD — Soft Memory research blueprint / mermaid / "what I learned this session"
# ❌ BAD — lasting "Igor prefers…" only in Agents/Memory with no ThumbGate capture
# ✅ GOOD — capture_feedback (down) with whatToChange NEVER/ALWAYS → prevention_rules
# ✅ GOOD — Memory lease: owner + surface + UTC (≤40 lines)
# ✅ GOOD — Memory Waiting: - [ ] with owner name
```
