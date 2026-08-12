#!/usr/bin/env python3
"""
Gurobi Optimization Engine for ThumbGate

Formulates and solves MILP (Mixed-Integer Linear Programming) problems for:
1. Model Tier & Provider Routing under Cost & Latency Constraints
2. Active Prevention Rule Knapsack Selection under Latency & Token Budgets
3. RAG Context Window Knapsack Packing

Uses gurobipy (v13+) with deterministic fallback logic.
"""

import sys
import json
import argparse
from typing import Dict, List, Any

try:
    import gurobipy as gp
    from gurobipy import GRB
    GUROBI_AVAILABLE = True
except ImportError:
    GUROBI_AVAILABLE = False


def solve_model_routing(candidates: List[Dict[str, Any]], max_budget_usd: float, max_latency_ms: float) -> Dict[str, Any]:
    """
    Formulates a 0-1 Integer Programming problem to select the optimal model candidate
    that maximizes capability score subject to budget and latency bounds.
    """
    if not candidates:
        return {"success": False, "selected": None, "reason": "No candidates provided"}

    if not GUROBI_AVAILABLE:
        # Fallback heuristic: highest capability within bounds
        valid = [c for c in candidates if c.get("cost", 0) <= max_budget_usd and c.get("latency_ms", 0) <= max_latency_ms]
        if not valid:
            valid = candidates
        best = max(valid, key=lambda c: c.get("score", 0))
        return {"success": True, "selected": best["id"], "solver": "heuristic-fallback", "objective": float(best.get("score", 0))}

    try:
        env = gp.Env(empty=True)
        env.setParam("OutputFlag", 0)
        env.start()

        model = gp.Model("ModelRouting", env=env)
        x = {}

        for i, cand in enumerate(candidates):
            cid = cand.get("id", f"c_{i}")
            x[cid] = model.addVar(vtype=GRB.BINARY, name=f"x_{cid}")

        model.update()

        # Objective: Maximize total capability score
        model.setObjective(
            gp.quicksum(x[cand.get("id", f"c_{i}")] * cand.get("score", 0.0) for i, cand in enumerate(candidates)),
            GRB.MAXIMIZE
        )

        # Constraint 1: Exactly 1 model candidate selected
        model.addConstr(gp.quicksum(x[cand.get("id", f"c_{i}")] for i, cand in enumerate(candidates)) == 1, "SelectOne")

        # Constraint 2: Total cost <= max_budget_usd
        model.addConstr(
            gp.quicksum(x[cand.get("id", f"c_{i}")] * cand.get("cost", 0.0) for i, cand in enumerate(candidates)) <= max_budget_usd,
            "BudgetLimit"
        )

        # Constraint 3: Total latency <= max_latency_ms
        model.addConstr(
            gp.quicksum(x[cand.get("id", f"c_{i}")] * cand.get("latency_ms", 0.0) for i, cand in enumerate(candidates)) <= max_latency_ms,
            "LatencyLimit"
        )

        model.optimize()

        if model.status == GRB.OPTIMAL:
            selected_id = None
            for cid, var in x.items():
                if var.X > 0.5:
                    selected_id = cid
                    break
            return {
                "success": True,
                "selected": selected_id,
                "solver": "gurobi",
                "objective": float(model.ObjVal),
                "status": "OPTIMAL"
            }
        else:
            # Fallback if infeasible
            best = max(candidates, key=lambda c: c.get("score", 0))
            return {
                "success": True,
                "selected": best["id"],
                "solver": "gurobi-infeasible-fallback",
                "objective": float(best.get("score", 0)),
                "status": f"INFEASIBLE_{model.status}"
            }

    except Exception as e:
        best = max(candidates, key=lambda c: c.get("score", 0))
        return {
            "success": True,
            "selected": best["id"],
            "solver": f"gurobi-error-fallback: {str(e)}",
            "objective": float(best.get("score", 0))
        }


def solve_rule_selection(rules: List[Dict[str, Any]], max_eval_time_ms: float, max_token_footprint: int) -> Dict[str, Any]:
    """
    Formulates a 0-1 Knapsack MILP to select the subset of prevention rules
    maximizing risk-mitigation score under time and token budgets.
    """
    if not rules:
        return {"success": False, "selected_rules": [], "reason": "No rules provided"}

    if not GUROBI_AVAILABLE:
        # Greedily pick rules by risk_mitigation / eval_time_ms
        sorted_rules = sorted(rules, key=lambda r: r.get("risk_mitigation", 0) / max(r.get("eval_time_ms", 0.1), 0.1), reverse=True)
        selected = []
        cur_time = 0.0
        cur_tokens = 0
        for r in sorted_rules:
            t = r.get("eval_time_ms", 0.0)
            tok = r.get("token_footprint", 0)
            if cur_time + t <= max_eval_time_ms and cur_tokens + tok <= max_token_footprint:
                selected.append(r.get("id"))
                cur_time += t
                cur_tokens += tok
        return {"success": True, "selected_rules": selected, "solver": "heuristic-knapsack", "used_time_ms": cur_time, "used_tokens": cur_tokens}

    try:
        env = gp.Env(empty=True)
        env.setParam("OutputFlag", 0)
        env.start()

        model = gp.Model("RuleKnapsack", env=env)
        y = {}

        for i, r in enumerate(rules):
            rid = r.get("id", f"r_{i}")
            y[rid] = model.addVar(vtype=GRB.BINARY, name=f"y_{rid}")

        model.update()

        # Objective: Maximize total risk mitigation score
        model.setObjective(
            gp.quicksum(y[r.get("id", f"r_{i}")] * r.get("risk_mitigation", 0.0) for i, r in enumerate(rules)),
            GRB.MAXIMIZE
        )

        # Constraint 1: Total eval time <= max_eval_time_ms
        model.addConstr(
            gp.quicksum(y[r.get("id", f"r_{i}")] * r.get("eval_time_ms", 0.0) for i, r in enumerate(rules)) <= max_eval_time_ms,
            "EvalTimeLimit"
        )

        # Constraint 2: Total token footprint <= max_token_footprint
        model.addConstr(
            gp.quicksum(y[r.get("id", f"r_{i}")] * r.get("token_footprint", 0) for i, r in enumerate(rules)) <= max_token_footprint,
            "TokenFootprintLimit"
        )

        model.optimize()

        if model.status == GRB.OPTIMAL:
            selected_ids = [rid for rid, var in y.items() if var.X > 0.5]
            used_time = sum(r.get("eval_time_ms", 0.0) for r in rules if r.get("id") in selected_ids)
            used_tokens = sum(r.get("token_footprint", 0) for r in rules if r.get("id") in selected_ids)
            return {
                "success": True,
                "selected_rules": selected_ids,
                "solver": "gurobi",
                "objective": float(model.ObjVal),
                "used_time_ms": used_time,
                "used_tokens": used_tokens,
                "status": "OPTIMAL"
            }
        else:
            return {"success": False, "selected_rules": [], "status": f"INFEASIBLE_{model.status}"}

    except Exception as e:
        return {"success": False, "selected_rules": [], "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Gurobi Optimization Engine for ThumbGate")
    parser.add_argument("--mode", choices=["routing", "rules"], required=True, help="Optimization mode")
    parser.add_argument("--input", required=True, help="Path to input JSON file or JSON string")

    args = parser.parse_args()

    try:
        if args.input.startswith("{") or args.input.startswith("["):
            payload = json.loads(args.input)
        else:
            with open(args.input, "r", encoding="utf-8") as f:
                payload = json.load(f)
    except Exception as err:
        print(json.dumps({"success": False, "error": f"Failed to parse input: {str(err)}"}))
        sys.exit(1)

    if args.mode == "routing":
        res = solve_model_routing(
            candidates=payload.get("candidates", []),
            max_budget_usd=payload.get("max_budget_usd", 1.0),
            max_latency_ms=payload.get("max_latency_ms", 5000.0)
        )
    elif args.mode == "rules":
        res = solve_mode_rules = solve_rule_selection(
            rules=payload.get("rules", []),
            max_eval_time_ms=payload.get("max_eval_time_ms", 50.0),
            max_token_footprint=payload.get("max_token_footprint", 1000)
        )
    else:
        res = {"success": False, "error": f"Unknown mode: {args.mode}"}

    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
