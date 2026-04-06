# Pair Continuity Tools With The Gateway

Continuity tools help you reopen a project and remember where you left off. ThumbGate solves the next problem: making the resumed AI session safer and more repeatable without adding an extra orchestrator, planner, or subagent layer.

Use the continuity layer to regain human context.
Use the Gateway as the reliability layer for:

- recall before work starts
- prevention rules after repeated failures
- pre-action gates before risky tool calls
- verification evidence after the run

## Integration pattern

If an external tool can append structured JSONL entries with a `source` field, the built-in watcher can route those events through the normal feedback pipeline.

Example event:

```json
{"source":"editor-brief","signal":"down","context":"Agent resumed without reading the migration notes","whatWentWrong":"Skipped the resume brief and edited the wrong table","whatToChange":"Read the project brief before schema changes","tags":["continuity","resume","database"]}
```

Then run:

```bash
npx thumbgate watch --source editor-brief
```

That reuses the existing capture pipeline:

- validation and clarification checks
- memory promotion
- vector indexing
- sequence tracking
- DPO export eligibility

## Practical split of responsibilities

- Base agent: does the actual work
- Continuity tool: what was I doing, what changed, what is next
- ThumbGate: what mistakes keep repeating, what should be blocked, what evidence proves the run was safe

## What this is not

- Not a swarm or orchestration layer
- Not a steering wrapper that fights the task
- Not a replacement for the base agent or editor

Keep one sharp agent. Put continuity upstream and reliability downstream.

## Recommended positioning

Do not treat continuity tools as replacements for the Gateway.
Treat them as upstream context suppliers that make recall and gates more useful.
Do not add an orchestration layer unless it improves output enough to justify the handoff overhead.
