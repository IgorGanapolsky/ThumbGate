# DeepPattern discipline honesty (FORMAT steal)

Sources (public MIT, 2026-09):

- https://github.com/deeppatternai/agent-quality-gates
- https://github.com/deeppatternai/decision-engine

DeepPattern ships two complementary neighbors:

| Product | Role | ThumbGate relationship |
|---------|------|------------------------|
| **Agent Quality Gates (AQG)** | Local quality-discipline toolkit (skills + hooks + evidence closeout) | Complementary construction/review discipline — not PreToolUse evaluate→block→evidence |
| **Decision Engine (DE)** | Hosted cross-vendor review panel (invite-only) | Optional external second opinion — not a ThumbGate substitute |

## Transfers (FORMAT only)

### 1. Layer-check

Comparative analysis fails when a product at one stack layer is treated as a substitute for another. ThumbGate is **L7** (application / workflow governance: evaluate → block → evidence). LiteLLM / OpenRouter / raw model APIs are **L4** transport — inputs, not competitors.

```bash
npx thumbgate deeppattern-discipline-honesty --json \
  --claim='OpenRouter commoditizes ThumbGate PreToolUse'
# → cross_layer_substitute
```

### 2. Evidence-closeout

Before claiming done, require an Evidence/Closeout heading with six items:

1. scope completed
2. verification run
3. audit adjudicated
4. durable state updated
5. production boundary
6. remaining blockers

Maps onto the ThumbGate Completion Claim Contract (merge SHA, `/health.buildSha`, terminal CI).

## Not transferred

- Installing AQG / DE / `dp-install`
- Cross-vendor hosted audit panel as a ThumbGate SKU
- Unparking LLM adjudicator (#3690/#3687)
- Discussion boards / graphic-explanation / forecast pooling product surfaces

```bash
npx thumbgate deeppattern-discipline-honesty --json --map-only
npx thumbgate deeppattern-discipline-honesty --json --closeout=pr-body.md --strict
npm run test:deeppattern-discipline-honesty
```

Not affiliated with DeepPatternAI.
