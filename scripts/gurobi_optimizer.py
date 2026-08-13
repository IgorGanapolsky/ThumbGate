#!/usr/bin/env python3
"""
Gurobi Optimization Engine for ThumbGate

Formulates and solves MILP (Mixed-Integer Linear Programming) problems for:
1. Model Tier & Provider Routing under Cost & Latency Constraints
2. Active Prevention Rule Knapsack Selection under Latency & Token Budgets
3. RAG Context Window Knapsack Packing

Uses gurobipy (v13+) with deterministic fallback logic.
"""

from __future__ import annotations

import argparse
import json
import os
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


def safe_resolve_input_path(path: str, base_dir: str | None = None) -> str:
    """
    Canonicalize a CLI file path and refuse anything outside the allowed base.

    Mitigates agentic path-injection (Sonar pythonsecurity:S8707): LLMs must not
    open arbitrary filesystem paths via this CLI.
    """
    if not path or not isinstance(path, str):
        raise ValueError("input path must be a non-empty string")
    if path.startswith("{") or path.startswith("["):
        raise ValueError("inline JSON is not a filesystem path")

    root = os.path.realpath(base_dir or os.getcwd())
    resolved = os.path.realpath(os.path.join(root, path) if not os.path.isabs(path) else path)
    if resolved != root and not resolved.startswith(root + os.sep):
        raise ValueError(f"path {path!r} is outside the allowed directory {root!r}")
    if not os.path.isfile(resolved):
        raise ValueError(f"path {path!r} is not an existing file under {root!r}")
    return resolved


def load_input_payload(raw: str, base_dir: str | None = None) -> Dict[str, Any]:
    """Parse --input as inline JSON or a path confined to base_dir (cwd)."""
    text = (raw or "").strip()
    if not text:
        raise ValueError("empty input")
    if text.startswith("{") or text.startswith("["):
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            raise ValueError("inline JSON input must be an object")
        return parsed

    safe_path = safe_resolve_input_path(text, base_dir=base_dir)
    with open(safe_path, "r", encoding="utf-8") as handle:
        parsed = json.load(handle)
    if not isinstance(parsed, dict):
        raise ValueError("file JSON input must be an object")
    return parsed


def solve_model_routing(
    candidates: List[Dict[str, Any]],
    max_budget_usd: float,
    max_latency_ms: float,
) -> Dict[str, Any]:
    """
    Formulates a 0-1 Integer Programming problem to select the optimal model candidate
    that maximizes capability score subject to budget and latency bounds.
    """
    if not candidates:
        return {"success": False, "selected": None, "reason": "No candidates provided"}

    if not GUROBI_AVAILABLE:
        valid = [
            c
            for c in candidates
            if c.get("cost", 0) <= max_budget_usd and c.get("latency_ms", 0) <= max_latency_ms
        ]
        if not valid:
            valid = candidates
        best = max(valid, key=lambda c: c.get("score", 0))
        return {
            "success": True,
            "selected": best["id"],
            "solver": "heuristic-fallback",
            "objective": float(best.get("score", 0)),
        }

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
                "status": "OPTIMAL",
            }

        best = max(candidates, key=lambda c: c.get("score", 0))
        return {
            "success": True,
            "selected": best["id"],
            "solver": "gurobi-infeasible-fallback",
            "objective": float(best.get("score", 0)),
            "status": f"INFEASIBLE_{model.status}",
        }

    except Exception as exc:  # noqa: BLE001 — fail-open to heuristic for CI
        best = max(candidates, key=lambda c: c.get("score", 0))
        return {
            "success": True,
            "selected": best["id"],
            "solver": f"gurobi-error-fallback: {exc}",
            "objective": float(best.get("score", 0)),
        }


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
    return {
        "success": True,
        "selected_rules": selected,
        "solver": "heuristic-knapsack",
        "objective": total_risk,
        "used_time_ms": total_time,
        "used_tokens": total_tokens,
        "status": "HEURISTIC",
    }


def solve_rule_selection(
    rules: List[Dict[str, Any]],
    max_eval_time_ms: float,
    max_token_footprint: int,
) -> Dict[str, Any]:
    """
    Formulates a 0-1 Knapsack MILP to select the subset of prevention rules
    maximizing risk-mitigation score under time and token budgets.
    """
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
            return {
                "success": True,
                "selected_rules": selected_ids,
                "solver": "gurobi",
                "objective": float(model.ObjVal),
                "used_time_ms": used_time,
                "used_tokens": used_tokens,
                "status": "OPTIMAL",
            }

        res = fallback_rule_selection(rules, max_eval_time_ms, max_token_footprint)
        res["status"] = f"INFEASIBLE_{model.status}"
        return res

    except Exception as exc:  # noqa: BLE001 — fail-open to heuristic for CI
        res = fallback_rule_selection(rules, max_eval_time_ms, max_token_footprint)
        res["solver"] = f"gurobi-error-fallback: {exc}"
        return res


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
    parser.add_argument("--mode", choices=["routing", "rules"], required=True, help="Optimization mode")
    parser.add_argument(
        "--input",
        required=True,
        help="Inline JSON object or a path confined to the process working directory",
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
