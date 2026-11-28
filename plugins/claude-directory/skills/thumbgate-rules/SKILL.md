---
name: thumbgate-rules
description: List the active ThumbGate prevention rules, reliability rules, and the promoted lessons behind them, so the user can see which guardrails are currently protecting this project and WHY each one exists. Reads the live rule and lesson stores via the prevention_rules, get_reliability_rules, and search_lessons MCP tools (CLI fallback `npx thumbgate rules`). Use when the user says "what is ThumbGate protecting me from", "show my rules", "show my gates", "what has the agent learned", "list active guardrails", or "what's blocked here". Do NOT use to CREATE a new rule (use the thumbgate-guard skill), to see runtime enforcement counts of what actually fired (use the thumbgate-blocked skill), or to diagnose whether ThumbGate is wired up at all (use the thumbgate-doctor skill).
---

# ThumbGate Rules

Show the guardrails currently in force for this project: the auto-promoted prevention rules, the
reliability rules, and the lessons they came from — so the user sees not just *what* is blocked
but *why*.

This skill wraps existing ThumbGate capability and adds **no new logic** — it reads the live rule
and lesson stores.

## Workflow

1. **List active rules** with the `prevention_rules` MCP tool (CLI fallback: `npx thumbgate rules`).
2. **Pull reliability rules** with `get_reliability_rules` to show which tool-call shapes are gated.
3. **Surface the lesson** behind each rule with `search_lessons`, so the user sees the origin, not
   just the block.
4. **Present a compact table** (see the example below).
5. **If there are zero active rules,** point the user to the thumbgate-guard skill to promote
   their first one.

Field-by-field tool output and how rules map to lessons are in
[references/rule-stores.md](references/rule-stores.md).

## Example

Input: "what is ThumbGate protecting me from in this repo?"

Action: call `prevention_rules` + `get_reliability_rules`, enrich each with `search_lessons`, then:

| Rule / Gate | Blocks | From lesson | State |
|-------------|--------|-------------|-------|
| no-force-push-main | `git push --force` to `main` | overwrote a teammate's commit (2026-05) | active |
| verify-before-deploy | deploy without `npm test` | shipped a broken build | active |

## Troubleshooting

- **Empty list:** no rules promoted yet — use the thumbgate-guard skill, or `npx thumbgate rules`
  returns nothing because the lesson store is fresh.
- **`prevention_rules` errors / MCP unreachable:** fall back to `npx thumbgate rules`, then run the
  thumbgate-doctor skill to check wiring.
- **A rule exists but never blocks:** that's an enforcement question — check the thumbgate-blocked
  skill for fire counts and the thumbgate-doctor skill for hook installation.

## Quality checklist (self-verify before delivering)

- [ ] I listed the live rules via `prevention_rules` (or the `npx thumbgate rules` fallback), not from memory.
- [ ] I tied each rule to its originating lesson via `search_lessons` so the user sees *why*.
- [ ] I distinguished prevention rules from reliability rules (`get_reliability_rules`).
- [ ] On an empty store, I pointed to the thumbgate-guard skill instead of inventing rules.
- [ ] I added no new logic — only read existing rule/lesson stores.
