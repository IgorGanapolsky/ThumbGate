---
name: context-engineering-checklist
description: >
  HARD checklist before new skills, MCP tools, hooks/gates, plugins, or multi-agent
  workflows. Maps Hugging Face Context Course units 1–5 onto ThumbGate. Auto-invoke
  when creating SKILL.md, PreToolUse hooks, gate patterns, MCP tools, Grok workflows,
  slash commands, or when user says context engineering, HF context course, GSD,
  Ralph Loop, or agent context. Slash: /context-engineering-checklist.
---

# Context Engineering Checklist (HF course → ThumbGate)

Source: [The Context Course](https://huggingface.co/learn/context-course/unit0/introduction)

## Pick the right layer (Clarify)

| Need | Layer | Do not |
|------|--------|--------|
| How-to / policy for agents | **Skill** (Unit 1) | Long chat-only prompts |
| External API/tool | **MCP** (Unit 2) | Fake tools in prose |
| Multi-step pack / fan-out | **Workflow/plugin** (Unit 3) | One mega-prompt |
| Parallel specialists | **Sub-agents** (Unit 4) | Dual-edit without locks |
| Irreversible deny | **Hook/gate** (Unit 5) | Skill-only “never do X” |

## Unit 1 — Skills

- [ ] `SKILL.md` frontmatter: `name`, trigger-rich `description`, slash
- [ ] One failure class per skill
- [ ] NEVER / ALWAYS table with zero-ratio rules
- [ ] Scripts for mechanical steps; no secrets in body

## Unit 2 — MCP

- [ ] Tool names match discovery / allowlist
- [ ] Side-effect annotations truthful
- [ ] Mutating tools covered by PreToolUse / gate-check

## Unit 3 — Plugins / workflows

- [ ] Context → specialists → verify → synthesize
- [ ] Smoke + full modes; read-only reviews

## Unit 4 — Sub-agents

- [ ] Linear claim or complement (no steal)
- [ ] Vault one-writer; scoped prompts

## Unit 5 — Hooks / gates

- [ ] Matchable tool surface (not English prose)
- [ ] Hard floor if irreversible
- [ ] Deny + allow + false-positive tests
- [ ] Live probe before “protected”

## Six-block context envelope

Before generation, package reusable context into all six blocks:

1. `goal`: one measurable outcome.
2. `businessData`: current evidence with source and timestamp.
3. `examples`: concrete good or bad few-shot cases.
4. `procedures`: ordered actions and verification.
5. `constraints`: safety, business, and SLA limits.
6. `rubric`: grading criteria supplied before the answer is generated.

Use `construct_context_pack.contextEnvelope` instead of repeating these blocks
in chat. All blocks are required when the envelope is present, count against
`maxChars`, and are part of semantic-cache identity.

For connector evidence, set `metadata.sourceUpdatedAt`,
`metadata.maxAgeSeconds`, and `metadata.sourceUrl` on the stored context
object. Treat `stale`, `future`, `invalid`, and `unknown` freshness as
explicit evidence states, not current truth.

## Scripts

```bash
bash ~/.grok/skills/context-engineering-checklist/scripts/check_context_layers.sh [path...]
```

## Related

- [[gsd-ralph-context-loop]]
- [[three-bus-ship-cycle]]
- [[xai-workflows-for-system]]
