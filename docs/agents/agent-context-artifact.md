# Agent-context artifact (Wisdom.ai FORMAT steal)

Doctor: `npx thumbgate agent-context-artifact --json --pack=<pack.json>`

Steals **context as a reusable agent artifact** from [Wisdom.ai](https://www.wisdom.ai/) and Soham Mazumdar's episode *[What Context Really Means in Data Engineering and AI](https://music.youtube.com/watch?v=lRuI0imju0Y)*. Compare-not-clone. Not affiliated with Wisdom.ai, Palantir, or Snowflake.

Does **not** clone Adaptive Context Engine, Palantir Foundry, or Snowflake Open Semantic Interchange.

## Artifact contract

| Field | Why (agent consumer, not analyst) |
|-------|-----------------------------------|
| `consumer: "agent"` | Modeling bar changes when agents consume context |
| `goal` | What the pack is for |
| `constraints` | Hard limits (local-only, no Vertex, …) |
| `sources` | Citeable ids/paths/urls — not tribal knowledge |
| `freshness` | `asOf` + `maxAgeHours` |
| `verifier` | Runnable check, not "looks good" |
| `wrongFit` | **Must include `wisdom_ai`** — ACE is the wrong SKU here |

Complements six-block SKILL.md packs and ContextFS. Does not replace them.

## CLI

```bash
npx thumbgate agent-context-artifact --json --pack=tests/fixtures/agent-context-artifact-gold.json
npx thumbgate agent-context-artifact --json --pack=tests/fixtures/agent-context-artifact-human.json
npm run test:agent-context-artifact
```

Skill: `.agents/skills/wisdom-context-artifact-not-clone/SKILL.md`
