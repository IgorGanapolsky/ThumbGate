# JIT harness compose (FORMAT steal)

Doctor: `npx thumbgate jit-harness-compose --task="…" --json`

Steals the **four-module harness protocol** from [JIT-Agent (arXiv:2608.25593)](https://arxiv.org/abs/2608.25593) — memory, planning, action, capability — and maps it onto **existing** ThumbGate rails. This is a compare-not-clone doctor. It does **not** train a harness model, download JIT-Agent-27B, or vendor [bingreeky/JIT](https://github.com/bingreeky/JIT). Not affiliated.

## Module → rail map

| Module | ThumbGate rails |
|--------|-----------------|
| memory | lesson-retrieval (BM25F / hybrid RRF), `.claude/memory/feedback`, contextfs, `capture-feedback.js` |
| planning | `bin/agent-loop` Plan stage, GSD, harness-selector task class, implementation-notes |
| action | PreToolUse / gates-engine, `config/gates/*.json`, switchyard-router step roles, session-lease |
| capability | `config/subagent-profiles.json`, MCP allowlists, skills registry, switchyard / model-candidates |

## Task classes

`code_edit` · `review` · `deploy` · `research` · `secure` · `routine` · `db_write` · `default`

Classifier uses `harness-selector` plus vocabulary heuristics. Override with `--class=` / `--harness=` / `--profile=`.

## Fail closed

Attempts to serve/download JIT-Agent, clone HarnessFactory, or emit free-form harness programs return `status=fail` with `jit_clone_refused`.

## Skill

`.agents/skills/jit-harness-compare-not-clone/SKILL.md` — `/jit-harness-compare-not-clone`
