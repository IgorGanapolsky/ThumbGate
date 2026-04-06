# Intent Router

The intent router adds an orchestration layer above individual tools.

## Why

It converts free-form work goals into policy-aware plans:

1. Select a named intent.
2. Expand to ordered actions.
3. Apply risk policy for checkpoint requirements.
4. Return `ready` or `checkpoint_required`.
5. Pair execution outcomes with rubric-based evaluation for non-verifiable tasks.

## Policy Bundles

Versioned bundles live in `config/policy-bundles/`:

- `default-v1.json`
- `constrained-v1.json`

Runtime selection:

- `THUMBGATE_POLICY_BUNDLE=default-v1`
- Optional direct path override: `THUMBGATE_POLICY_BUNDLE_PATH=/abs/path/bundle.json`

## Interfaces

- API catalog: `GET /v1/intents/catalog`
- API plan: `POST /v1/intents/plan`
- MCP tools:
  - `list_intents`
  - `plan_intent`

## Approval Semantics

Risk levels: `low`, `medium`, `high`, `critical`.

Each bundle defines which risk levels require human approval for each MCP profile.
If approval is required and `approved` is not set, plan status is `checkpoint_required`.

## Partner-Aware Orchestration

The MVP now accepts `partnerProfile` on both `list_intents` and `plan_intent`.

Supported profiles:

- `balanced`: mixed-pool default with no special bias
- `strict_reviewer`: bias toward evidence, provenance, and larger context packs
- `fast_executor`: favor faster execution with tighter token budgets
- `silent_blocker`: spend more budget surfacing hidden blockers before claiming done
- `tool_limited`: reduce ambiguity quickly when the counterpart has weaker tools

Runtime hooks:

1. `plan_intent` resolves a partner strategy from `config/partner-routing.json`
2. Token budgets are scaled per partner profile
3. Action ranking combines Thompson samples for the action category with partner-specific action bias
4. The verification loop records the outcome under both the task tags and `partner_<profile>`

Reward function:

```text
reward = clamp(
  baseOutcome
  - (attempts - 1) * attemptPenalty
  - min(violationCount * violationPenalty, maxViolationPenalty)
  + rewardBias,
  -1,
  1
)
```

The resulting reward drives a weighted Thompson update so clean one-shot successes and repeated failures shift partner-specific reliability faster than neutral runs.

## Examples

```bash
npm run intents:list
npm run intents:plan
```
