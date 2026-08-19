#!/usr/bin/env python3
"""
Gurobi Optimization Engine for ThumbGate

Formulates and solves MILP (Mixed-Integer Linear Programming) problems for:
1. Model Tier & Provider Routing under Cost & Latency Constraints
2. Active Prevention Rule Knapsack Selection under Latency & Token Budgets

Uses gurobipy (v13+) with deterministic fallback logic.

Security: --input accepts only inline JSON (no filesystem open). The Node bridge
always passes JSON.stringify(payload); agentic path injection is impossible.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List

try:
    import gurobipy as gp
    from gurobipy import GRB
    GUROBI_AVAILABLE = True
except ImportError:
    gp = None  # type: ignore
    GRB = None  # type: ignore
    GUROBI_AVAILABLE = False


def extract_iis(model: Any) -> List[str]:
    """Return IIS constraint names. Empty when computeIIS is unavailable."""
    if not GUROBI_AVAILABLE or model is None:
        return []
    try:
        model.computeIIS()
        return [c.ConstrName for c in model.getConstrs() if bool(getattr(c, "IISConstr", 0))]
    except Exception:  # noqa: BLE001 — IIS is diagnostic, never crash the CLI
        return []


def stamp_receipt(result: Dict[str, Any], *, model: Any = None) -> Dict[str, Any]:
    """Pulse steal: proof, not plausible. Never mark a heuristic as certified."""
    out = dict(result)
    solver = str(out.get("solver") or "")
    status = str(out.get("status") or "")
    certified = solver == "gurobi" and status == "OPTIMAL" and out.get("success") is True
    out["certified"] = certified
    out["capturedRevenueUsd"] = 0
    if certified:
        out.setdefault("proof", "gurobi-optimal")
        if model is not None:
            try:
                out["objBound"] = float(model.ObjBound)
            except Exception:  # noqa: BLE001
                pass
            try:
                out["mipGap"] = float(model.MIPGap)
            except Exception:  # noqa: BLE001
                pass
    elif status.startswith("INFEASIBLE"):
        out.setdefault("proof", "infeasible-iis")
        if "iis" not in out and model is not None:
            out["iis"] = extract_iis(model)
    elif "heuristic" in solver or solver.endswith("-fallback") or "fallback" in solver:
        out.setdefault("proof", "heuristic")
    else:
        out.setdefault("proof", "unproven")
    return out


def load_input_payload(raw: str) -> Dict[str, Any]:
    """Parse --input as inline JSON only (no filesystem access)."""
    text = (raw or "").strip()
    if not text:
        raise ValueError("empty input")
    if not (text.startswith("{") or text.startswith("[")):
        raise ValueError(
            "input must be an inline JSON object (filesystem paths are not accepted)"
        )
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("inline JSON input must be an object")
    return parsed


def solve_model_routing(
    candidates: List[Dict[str, Any]],
    max_budget_usd: float,
    max_latency_ms: float,
) -> Dict[str, Any]:
    """Select one model candidate maximizing score under budget and latency."""
    if not candidates:
        return {"success": False, "selected": None, "reason": "No candidates provided"}

    if not GUROBI_AVAILABLE:
        valid = [
            c
            for c in candidates
            if c.get("cost", 0) <= max_budget_usd and c.get("latency_ms", 0) <= max_latency_ms
        ]
        if not valid:
            return stamp_receipt(
                {
                    "success": False,
                    "selected": None,
                    "solver": "heuristic-fallback",
                    "objective": None,
                    "status": "INFEASIBLE",
                    "iis": ["BudgetLimit", "LatencyLimit"],
                    "reason": "no candidate satisfies budget and latency",
                }
            )
        best = max(valid, key=lambda c: c.get("score", 0))
        return stamp_receipt(
            {
                "success": True,
                "selected": best["id"],
                "solver": "heuristic-fallback",
                "objective": float(best.get("score", 0)),
                "status": "HEURISTIC",
            }
        )

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
        model.setObjective(
            gp.quicksum(
                x[cand.get("id", f"c_{i}")] * cand.get("score", 0.0)
                for i, cand in enumerate(candidates)
            ),
            GRB.MAXIMIZE,
        )
        model.addConstr(
            gp.quicksum(x[cand.get("id", f"c_{i}")] for i, cand in enumerate(candidates)) == 1,
            "SelectOne",
        )
        model.addConstr(
            gp.quicksum(
                x[cand.get("id", f"c_{i}")] * cand.get("cost", 0.0)
                for i, cand in enumerate(candidates)
            )
            <= max_budget_usd,
            "BudgetLimit",
        )
        model.addConstr(
            gp.quicksum(
                x[cand.get("id", f"c_{i}")] * cand.get("latency_ms", 0.0)
                for i, cand in enumerate(candidates)
            )
            <= max_latency_ms,
            "LatencyLimit",
        )
        model.optimize()
        if model.status == GRB.OPTIMAL:
            selected_id = next((cid for cid, var in x.items() if var.X > 0.5), None)
            return stamp_receipt(
                {
                    "success": True,
                    "selected": selected_id,
                    "solver": "gurobi",
                    "objective": float(model.ObjVal),
                    "status": "OPTIMAL",
                },
                model=model,
            )
        iis = extract_iis(model)
        return stamp_receipt(
            {
                "success": False,
                "selected": None,
                "solver": "gurobi",
                "objective": None,
                "status": "INFEASIBLE",
                "iis": iis,
                "reason": "no feasible candidate under budget and latency",
            },
            model=model,
        )
    except Exception as exc:  # noqa: BLE001 — fail-open to heuristic for CI
        valid = [
            c
            for c in candidates
            if c.get("cost", 0) <= max_budget_usd and c.get("latency_ms", 0) <= max_latency_ms
        ]
        if not valid:
            return stamp_receipt(
                {
                    "success": False,
                    "selected": None,
                    "solver": f"gurobi-error-fallback: {exc}",
                    "objective": None,
                    "status": "INFEASIBLE",
                    "reason": str(exc),
                }
            )
        best = max(valid, key=lambda c: c.get("score", 0))
        return stamp_receipt(
            {
                "success": True,
                "selected": best["id"],
                "solver": f"gurobi-error-fallback: {exc}",
                "objective": float(best.get("score", 0)),
                "status": "HEURISTIC",
            }
        )


def fallback_rule_selection(
    rules: List[Dict[str, Any]],
    max_eval_time_ms: float,
    max_token_footprint: int,
) -> Dict[str, Any]:
    sorted_rules = sorted(
        rules,
        key=lambda r: float(r.get("risk_mitigation", 0))
        / max(float(r.get("eval_time_ms", 0.1)), 0.1),
        reverse=True,
    )
    selected = []
    total_time = 0.0
    total_tokens = 0
    total_risk = 0.0
    for rule in sorted_rules:
        r_time = float(rule.get("eval_time_ms", 0.0))
        r_tokens = int(rule.get("token_footprint", 0))
        if total_time + r_time <= max_eval_time_ms and total_tokens + r_tokens <= max_token_footprint:
            selected.append(rule.get("id"))
            total_time += r_time
            total_tokens += r_tokens
            total_risk += float(rule.get("risk_mitigation", 0.0))
    return stamp_receipt(
        {
            "success": True,
            "selected_rules": selected,
            "solver": "heuristic-knapsack",
            "objective": total_risk,
            "used_time_ms": total_time,
            "used_tokens": total_tokens,
            "status": "HEURISTIC",
        }
    )


def solve_rule_selection(
    rules: List[Dict[str, Any]],
    max_eval_time_ms: float,
    max_token_footprint: int,
) -> Dict[str, Any]:
    """0-1 knapsack over prevention rules under time and token budgets."""
    if not rules:
        return {"success": False, "selected_rules": [], "reason": "No rules provided"}

    if not GUROBI_AVAILABLE:
        return fallback_rule_selection(rules, max_eval_time_ms, max_token_footprint)

    try:
        model = gp.Model("RuleKnapsackSelection")
        model.setParam("OutputFlag", 0)
        y = {}
        for i, rule in enumerate(rules):
            rid = rule.get("id", f"r_{i}")
            y[rid] = model.addVar(vtype=GRB.BINARY, name=f"rule_{rid}")
        model.setObjective(
            gp.quicksum(
                y[rule.get("id", f"r_{i}")] * rule.get("risk_mitigation", 0.0)
                for i, rule in enumerate(rules)
            ),
            GRB.MAXIMIZE,
        )
        model.addConstr(
            gp.quicksum(
                y[rule.get("id", f"r_{i}")] * rule.get("eval_time_ms", 0.0)
                for i, rule in enumerate(rules)
            )
            <= max_eval_time_ms,
            "EvalTimeLimit",
        )
        model.addConstr(
            gp.quicksum(
                y[rule.get("id", f"r_{i}")] * rule.get("token_footprint", 0)
                for i, rule in enumerate(rules)
            )
            <= max_token_footprint,
            "TokenFootprintLimit",
        )
        model.optimize()
        if model.status == GRB.OPTIMAL:
            selected_ids = [rid for rid, var in y.items() if var.X > 0.5]
            used_time = sum(
                r.get("eval_time_ms", 0.0) for r in rules if r.get("id") in selected_ids
            )
            used_tokens = sum(
                r.get("token_footprint", 0) for r in rules if r.get("id") in selected_ids
            )
            return stamp_receipt(
                {
                    "success": True,
                    "selected_rules": selected_ids,
                    "solver": "gurobi",
                    "objective": float(model.ObjVal),
                    "used_time_ms": used_time,
                    "used_tokens": used_tokens,
                    "status": "OPTIMAL",
                },
                model=model,
            )
        return stamp_receipt(
            {
                "success": False,
                "selected_rules": [],
                "solver": "gurobi",
                "objective": None,
                "status": "INFEASIBLE",
                "iis": extract_iis(model),
                "reason": "rule knapsack infeasible",
            },
            model=model,
        )
    except Exception as exc:  # noqa: BLE001 — fail-open to heuristic for CI
        res = fallback_rule_selection(rules, max_eval_time_ms, max_token_footprint)
        res["solver"] = f"gurobi-error-fallback: {exc}"
        return stamp_receipt(res)


def run_mode(mode: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if mode == "routing":
        return solve_model_routing(
            candidates=payload.get("candidates", []),
            max_budget_usd=float(payload.get("max_budget_usd", 1.0)),
            max_latency_ms=float(payload.get("max_latency_ms", 5000.0)),
        )
    if mode == "rules":
        return solve_rule_selection(
            rules=payload.get("rules", []),
            max_eval_time_ms=float(payload.get("max_eval_time_ms", 50.0)),
            max_token_footprint=int(payload.get("max_token_footprint", 1000)),
        )
    return {"success": False, "error": f"Unknown mode: {mode}"}


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Gurobi Optimization Engine for ThumbGate")
    parser.add_argument("--mode", choices=["routing", "rules"], required=True)
    parser.add_argument(
        "--input",
        required=True,
        help="Inline JSON object only (no filesystem paths; agent-safe)",
    )
    args = parser.parse_args(argv)

    try:
        payload = load_input_payload(args.input)
        result = run_mode(args.mode, payload)
    except Exception as err:  # noqa: BLE001 — CLI always emits JSON
        print(json.dumps({"success": False, "error": f"Failed to parse input: {err}"}))
        return 1

    print(json.dumps(result, indent=2))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    sys.exit(main())
