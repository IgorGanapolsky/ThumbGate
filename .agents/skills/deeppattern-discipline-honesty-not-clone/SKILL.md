---
name: deeppattern-discipline-honesty-not-clone
description: >
  DeepPattern Agent Quality Gates + Decision Engine are neighbors, not a
  ThumbGate clone. Steal layer-check (same-layer substitutes only) and
  evidence-closeout (six required items before "done") onto existing rails.
  Never install AQG/DE/dp-install or unpark a cross-vendor audit SKU.
  Slash: /deeppattern-discipline-honesty-not-clone.
---

# DeepPattern discipline honesty — compare, do not clone

## Goal

Fail-closed comparative analysis and completion claims for whom: ThumbGate
FORMAT steals and Completion Claim Contract — so L4 API gateways / hosted
multi-model panels cannot be treated as PreToolUse substitutes, and "done"
cannot pass without six evidence items.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Install AQG, Decision Engine, `dp-install` | `npx thumbgate deeppattern-discipline-honesty --json` |
| Treat OpenRouter / LiteLLM / token pools as ThumbGate competitors | Tag L1–L8; same job-to-be-done only |
| Claim done without evidence heading + six items | `--closeout=path.md --strict` |
| Unpark LLM adjudicator / cross-vendor panel SKU | Deterministic local gates; hosted panel stays external |

HARD fail closed. REFUSE SKU clones.

## Reference

- https://github.com/deeppatternai/agent-quality-gates (evidence-closeout)
- https://github.com/deeppatternai/decision-engine (`/layer-check`)
- ThumbGate Completion Claim Contract in `AGENTS.md` / `CLAUDE.md`
- `scripts/deeppattern-discipline-honesty.js`

## Examples (show, don't tell)

Weak: "LiteLLM commoditizes ThumbGate because both route models."

Gold:

```bash
$ npx thumbgate deeppattern-discipline-honesty --json --map-only
ok: true
$ npx thumbgate deeppattern-discipline-honesty --json \
    --claim='LiteLLM replaces ThumbGate PreToolUse'
ok: false  # cross_layer_substitute
```

## Procedures

```bash
npx thumbgate deeppattern-discipline-honesty --json --map-only
npx thumbgate deeppattern-discipline-honesty --json --claim='DE replaces ThumbGate'
npx thumbgate deeppattern-discipline-honesty --json --closeout=pr-body.md --strict
npm run test:deeppattern-discipline-honesty
```

1. Tag subject + every cited product L1–L8 before competitive claims.
2. Drop cross-layer substitutes; keep dependency language when honest.
3. Before saying done/fixed/shipped: Evidence/Closeout heading + six items.
4. Do not vendor AQG/DE.

## Rubric

- `--map-only` → `ok=true`
- substitute claim naming L4/L2/L5 vs ThumbGate → `cross_layer_substitute`
- `--clone-deeppattern` / `dp-install` → fail
- closeout missing heading or item / placeholder → fail
- doctor tests PASS
- evidence: `--json` in the same turn
