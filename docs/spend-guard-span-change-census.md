# Spend-guard span-change census (full, not sampled)

**Date:** 2026-08-04  
**Branch:** `fix/guard-bare-word-emergency`  
**Guards compared:**
- OLD: bare-word `DIRECT_CHECKOUT_PATH` + action∧object self-deny (`/tmp/guard-old.js`)
- MID: path-precision only (`/tmp/guard-fixed2.js`)
- NEW: path-precision + non-overlapping span requirement (`scripts/thumbgate-spend-guard.js`)

## Harness integrity

Diff is gated: comparison aborts unless known-deny vectors still deny on OLD/MID/NEW.

| Check | Result |
|-------|--------|
| Known denials (vendor hosts + path/fragment forms) | **8/8** deny on OLD, MID, NEW |
| Live process spawn of NEW guard | **8/8** exit 2 deny |
| `git checkout -b feature/x` on NEW | allow |
| Bare prose "dirty primary checkout" on NEW | allow |
| Signature form | `(toolName, toolInput)` — wrong-arity harnesses rejected by sanity gate |

Harness: `scripts/proof/spend-guard-decision-diff.js`  
Raw summary: `scripts/proof/spend-guard-decision-diff-summary.json`

## Full decision surface (repository text corpus)

Each non-empty tracked text line → one `Bash` payload `{ command: line }`.

| Metric | Count |
|--------|------:|
| payloads evaluated | 414,735 |
| OLD denies | 6,269 |
| MID denies | 2,631 |
| NEW denies | 1,770 |
| **LOOSENED** (old deny → new allow) | **4,499** |
| **TIGHTENED** (old allow → new deny) | **0** |

### Loosened by OLD ruleId

| Rule | Count |
|------|------:|
| `checkout_path` | 3,638 |
| `financial_action_and_object` | 861 |

The path-matcher fix alone accounts for the `checkout_path` bulk (bare-word "checkout/purchase/…" in prose).  
The span fix accounts for the `financial_action_and_object` bulk.

> Note: an earlier report on a smaller corpus (234,768 payloads) measured LOOSENED 3,229 (checkout_path 2,730 · financial_action_and_object 499; span 481). Same shape, different corpus size. **Raw counts above are the census from this worktree.** Do not restate as "zero regressions."

## Span-change census (MID deny `financial_action_and_object` → NEW allow)

| Metric | Count |
|--------|------:|
| span-change cases | **861** |
| SELF_DENY_SHARED_TOKEN (`checkout`/`Checkout`/`CHECKOUT` matches both lists at same span) | **861** |
| OVERLAPPING_DIFFERENT_TOKENS | **0** |
| DISTINCT non-overlapping pairs loosened | **0** (impossible under the span rule — those still deny) |
| ANOMALY (could not re-derive action/object on full line) | **0** |

### Why 100% are shared-token self-denies

`checkout` is the only bare token that appears in **both** `MUTATION_ACTION` and `FINANCIAL_OBJECT`. The span rule only allows when the action match and object match occupy overlapping spans. Therefore the only corpus loosenings attributable to the span fix are lines where that single shared token self-satisfied the old conjunction.

### Tagging false alarm (not residual risk)

8 lines were auto-tagged `SEMANTIC_RISK` because the word `click` co-occurs near `checkout` in docs/tests (e.g. "proof click, Pro checkout start", "when checkout is detached"). **Full-line re-read of all 8:** every one is still `action=checkout object=checkout sameToken=true`. They are documentation / test prose, not live spend intents.

### What still denies (proven, not inferred)

Live `node scripts/thumbgate-spend-guard.js` process (not pure function):

- `https://checkout.stripe.com/...` → deny
- `https://buy.stripe.com/...` → deny
- `https://app.apollo.io/#/settings/plans/upgrade` → deny
- `https://example.com/checkout|purchase|upgrade|subscribe` and `#billing` → deny (8/8)

Distinct action+object still denies, e.g. `buy` + `subscription`, `upgrade` + `plan` (unchanged path; not in the span-loosened set).

## Claims that are and are not supported

| Claim | Status |
|-------|--------|
| The change only loosens, never tightens (this corpus) | **Proven** (tightened = 0) |
| All 861 span-change loosenings are shared-token `"checkout"` self-denies | **Proven** (full census, full lines) |
| Vendor hosts + path/fragment commerce forms still deny | **Proven** (8/8 live process) |
| All 4,499 loosened payloads are "safe" in production | **Not claimed** — corpus is repository text, not live agent traffic |
| "Zero regressions" | **Retracted** — use the raw counts |

## Method lessons (harness integrity)

1. Gate every OLD/NEW diff on reproducing known denials first. A harness that returns OLD denies = 0 is broken, not clean.
2. Report raw counts, not summary adjectives ("zero regressions").
3. Span-change audit must use **full lines**; truncating to 500 chars falsely reported 5 non-self-deny cases (matches lived past the slice).
