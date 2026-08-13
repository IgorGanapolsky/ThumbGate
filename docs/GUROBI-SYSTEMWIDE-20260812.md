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

## ThumbGate product bridge

| File | Role |
|------|------|
| `scripts/gurobi_optimizer.py` | MILP: model routing + prevention-rule knapsack |
| `scripts/gurobi-optimizer.js` | Node bridge; prefers `GUROBI_PYTHON` / hermes venv |
| `npm run test:gurobi` | Node unit tests (accepts heuristic fallback in CI) |
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
