---
name: colab-compute-honesty-not-clone
description: >
  Google Colab /signup is a compute-unit storefront, not a ThumbGate GPU SKU.
  Steal CU-pack honesty (subscribe≠receipt, CU≠dedicated GPU, 24h background
  is Pro+). Never buy Pro/Pro+/PAYG from an agent session. Never clone
  colab-cli. Slash: /colab-compute-honesty-not-clone.
---

# Colab compute honesty — compare, do not clone

## Goal

Fail-closed compute claims for whom: ThumbGate evals and fleet offload talk —
so "Colab Pro+ A100" cannot pass without a live Current-plan receipt.
Colab stays a neighbor notebook host, not a product.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Buy Colab Pro / Pro+ / Compute Units | `npx thumbgate colab-compute-honesty --json` |
| Claim Pro+ because Subscribe is on /signup | `--plan-proof` from a Current-plan receipt |
| colab-cli / ngrok SSH / zero-cost A100 | GitHub Actions remains the eval runner |
| Dual-edit unverified `google-colab-pro-runner` theater | Treat that skill as a claim to audit |

HARD fail closed. REFUSE SKU clones. Do NOT spend.

## Reference

- https://colab.research.google.com/signup (live 2026-09-17, `iganapolsky@gmail.com`)
- PAYG $9.99/100 CU and $49.99/500 CU (buttons disabled on that account)
- Pro $9.99/mo and Pro+ $49.99/mo still showed Subscribe
- `scripts/colab-compute-honesty.js`

## Examples (show, don't tell)

Weak: Subscribe to Pro+ and offload gate-eval to A100 via colab-cli.

Gold:

```bash
$ npx thumbgate colab-compute-honesty --json --map-only
ok: true
$ npx thumbgate colab-compute-honesty --json --claim='Colab Pro+ A100 eval sweep'
ok: false  # paid_feature_without_plan_proof
```

## Procedures

```bash
npx thumbgate colab-compute-honesty --json --map-only
npx thumbgate colab-compute-honesty --json --claim='offload to Colab A100'
npx thumbgate colab-compute-honesty --json --clone-colab
npm run test:colab-compute-honesty
```

1. Open /signup signed in. Subscribe visible ⇒ not a receipt.
2. Do not click Buy / Subscribe.
3. Run the doctor on any Colab/GPU offload claim.
4. Keep ThumbGate tests on GitHub Actions.

## Rubric

- `--map-only` → `ok=true`
- Pro+/A100/24h without `--plan-proof` → fail
- live snapshot with Subscribe + `--plan-proof=proplus` → `subscribe_button_is_not_receipt`
- `--buy-pro` / `colab-cli` → fail
- doctor tests PASS
- evidence: `--json` in the same turn
