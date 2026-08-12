import json
import pytest
from scripts.gurobi_optimizer import solve_model_routing, solve_rule_selection, GUROBI_AVAILABLE


def test_gurobi_available():
    assert GUROBI_AVAILABLE is True, "gurobipy should be installed and importable"


def test_model_routing_optimization():
    candidates = [
        {"id": "c1", "score": 7.0, "cost": 0.001, "latency_ms": 100},
        {"id": "c2", "score": 9.5, "cost": 0.020, "latency_ms": 1500},
        {"id": "c3", "score": 8.8, "cost": 0.005, "latency_ms": 300},
    ]

    # Should pick c3 under budget $0.01 and max latency 500ms
    res = solve_model_routing(candidates, max_budget_usd=0.01, max_latency_ms=500)
    assert res["success"] is True
    assert res["selected"] == "c3"
    assert res["objective"] == 8.8
    assert res["solver"] == "gurobi"
    assert res["status"] == "OPTIMAL"


def test_rule_knapsack_selection():
    rules = [
        {"id": "r1", "risk_mitigation": 90, "eval_time_ms": 5, "token_footprint": 100},
        {"id": "r2", "risk_mitigation": 70, "eval_time_ms": 10, "token_footprint": 150},
        {"id": "r3", "risk_mitigation": 95, "eval_time_ms": 25, "token_footprint": 300},
    ]

    # Max eval time 30ms, max token footprint 450 -> r1 + r3 (time=30, tokens=400, risk=185)
    res = solve_rule_selection(rules, max_eval_time_ms=30.0, max_token_footprint=450)
    assert res["success"] is True
    assert set(res["selected_rules"]) == {"r1", "r3"}
    assert res["objective"] == 185.0
    assert res["solver"] == "gurobi"
    assert res["status"] == "OPTIMAL"
