# Gurobi system-wide setup (2026-08-12)

Source: Fabrizio Ellis (Gurobi AE) email — free **pip gurobipy** first; full trial when models exceed size limits. Contacts: Fabrizio Ellis, Jue Xue. Calendly: https://calendly.com/d/ctn3-5zn-ykz/gurobi-call

## Runtime (this Mac)

| Surface | Path / command |
|---------|----------------|
| Python venv | `~/.hermes/gurobi-venv` (`gurobipy` 13.x) |
| Fleet lib | `~/.hermes/gurobi/gurobi_fleet_lib.py` |
| CLI | `gurobi-fleet` → license / evaluate / solve / dispatch / outreach |
| MCP | `gurobi-mcp` (tools: license, LP, dispatch, outreach, evaluate) |
| Shell | `source ~/.hermes/gurobi/env.sh` (also hooked from `~/.zshrc`) |
| Install / re-sync | `bash scripts/gurobi-systemwide-install.sh` or `bash ~/.hermes/gurobi/install.sh` |
| Eval proof | `~/.hermes/gurobi/evals/latest.json` |

**License honesty:** size-limited free pip, **non-production only** (≤2000 vars / ≤2000 linear constraints / ≤200 quadratic vars). Do not mock “optimal” results.

**Pulse steal (2026-08-19):** real decisions need proof, not plausible answers. A Gurobi solve is certified only when `solver=gurobi` and `status=OPTIMAL`. Infeasible models fail closed and emit IIS constraint names. Heuristic fallbacks stay `certified=false`. `capturedRevenueUsd` is always 0. Not affiliated with Gurobi. No enterprise “certified optimization” claim expansion.

## ThumbGate product bridge

| File | Role |
|------|------|
| `scripts/gurobi_optimizer.py` | MILP: model routing + prevention-rule knapsack |
| `scripts/gurobi-optimizer.js` | Node bridge; prefers `GUROBI_PYTHON` / hermes venv |
| `npm run test:gurobi` | Node unit tests (accepts heuristic fallback in CI) |
| `npm run solver:parity` | Frozen acceptance-set + independent-engine parity |
| `python3 -m pytest tests/test_gurobi.py` | Python tests |

## Evaluation (must be green before “Gurobi is set up”)

```bash
gurobi-fleet evaluate --json
# expect: ok=true, passed=4, total=4
node --test tests/gurobi-optimizer.test.js
python3 -m pytest tests/test_gurobi.py -q
```

## When size-limited fails

Escalate to Fabrizio/Jue for a full evaluation license — do not invent larger solves.

## How this improves and sells ThumbGate (not Gurobi)

**Improve:** MILP model routing + prevention-rule knapsack under real cost/latency/token budgets
(`scripts/gurobi-optimizer.js`). Fail-open heuristics keep CI and free installs working.

**Sell:** run the sales-safe proof, not a partnership claim:

```bash
node scripts/budget-aware-gates-proof.js
npm run test:budget-aware-gates-proof
```

Buyer narrative: *budget-aware enforcement* — we do not load every prevention rule always;
we select high-mitigation rules and affordable models under budgets. Solver is an
implementation detail. **No Gurobi partnership / co-sell / logo claim.**
`capturedRevenueUsd` is never invented from a solve.

## Solver parity (Phase One process, not product)

Freeze the acceptance set, then compare the independent status-quo heuristic
against the solver on the same fixtures and budgets. Do not grade your own
homework: a heuristic fallback is not an independent check.

```bash
npm run solver:parity
npm run test:solver-parity
```

Frozen cases live in `tests/fixtures/solver-acceptance-set.json`.
This is existing-surface maintenance of routing + knapsack. Not an enterprise SKU.

## Beyond LLMs process (not product)

Podcast process steal — *provable/repeatable vs plausible*, plus **human oversight
before action**. Gurobi-as-enterprise-AI-infrastructure does **not** transfer (ECI).

| Layer | ThumbGate meaning |
|-------|-------------------|
| Understanding | Heuristic formulate (`plausibleOnly: true`) |
| Computation | MILP OPTIMAL (`repeatable: true`) |
| Action | `autoApply: false` — PreToolUse does not load solver picks |

```bash
npm run test:gurobi
```
