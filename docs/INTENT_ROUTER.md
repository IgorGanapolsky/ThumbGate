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

- `RLHF_POLICY_BUNDLE=default-v1`
- Optional direct path override: `RLHF_POLICY_BUNDLE_PATH=/abs/path/bundle.json`

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

## Examples

```bash
npm run intents:list
npm run intents:plan
```
