import json
import os
import tempfile
from pathlib import Path

import pytest

from scripts.gurobi_optimizer import (
    GUROBI_AVAILABLE,
    load_input_payload,
    main,
    run_mode,
    safe_resolve_input_path,
    solve_model_routing,
    solve_rule_selection,
)


def test_gurobi_module_importable():
    """gurobipy is optional in CI; optimizer must still import and expose the flag."""
    assert isinstance(GUROBI_AVAILABLE, bool)


def test_model_routing_optimization():
    candidates = [
        {"id": "c1", "score": 7.0, "cost": 0.001, "latency_ms": 100},
        {"id": "c2", "score": 9.5, "cost": 0.020, "latency_ms": 1500},
        {"id": "c3", "score": 8.8, "cost": 0.005, "latency_ms": 300},
    ]

    # Feasible set under budget $0.01 and max latency 500ms: c1 and c3; best score is c3
    res = solve_model_routing(candidates, max_budget_usd=0.01, max_latency_ms=500)
    assert res["success"] is True
    assert res["selected"] == "c3"
    assert res["objective"] == 8.8
    if GUROBI_AVAILABLE:
        assert res["solver"] == "gurobi"
        assert res["status"] == "OPTIMAL"
    else:
        assert res["solver"] == "heuristic-fallback"


def test_rule_knapsack_selection():
    rules = [
        {"id": "r1", "risk_mitigation": 90, "eval_time_ms": 5, "token_footprint": 100},
        {"id": "r2", "risk_mitigation": 70, "eval_time_ms": 10, "token_footprint": 150},
        {"id": "r3", "risk_mitigation": 95, "eval_time_ms": 25, "token_footprint": 300},
    ]

    res = solve_rule_selection(rules, max_eval_time_ms=30.0, max_token_footprint=450)
    assert res["success"] is True
    selected = set(res["selected_rules"])
    assert selected.issubset({"r1", "r2", "r3"})
    by_id = {r["id"]: r for r in rules}
    total_time = sum(by_id[i]["eval_time_ms"] for i in selected)
    total_tokens = sum(by_id[i]["token_footprint"] for i in selected)
    assert total_time <= 30.0
    assert total_tokens <= 450
    if GUROBI_AVAILABLE:
        assert selected == {"r1", "r3"}
        assert res["objective"] == 185.0
        assert res["solver"] == "gurobi"
        assert res["status"] == "OPTIMAL"
    else:
        assert res["solver"] in {"heuristic-fallback", "heuristic-knapsack"}
        assert res["objective"] == sum(by_id[i]["risk_mitigation"] for i in selected)


def test_empty_inputs_fail_closed():
    assert solve_model_routing([], 1.0, 100)["success"] is False
    assert solve_rule_selection([], 50.0, 1000)["success"] is False


def test_safe_resolve_rejects_path_escape(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    outside = Path(tempfile.gettempdir()) / "thumbgate-gurobi-escape-probe.json"
    outside.write_text('{"candidates":[]}', encoding="utf-8")
    with pytest.raises(ValueError, match="outside the allowed directory"):
        safe_resolve_input_path(str(outside), base_dir=str(tmp_path))
    with pytest.raises(ValueError, match="outside the allowed directory"):
        safe_resolve_input_path("../" + outside.name, base_dir=str(tmp_path))


def test_safe_resolve_accepts_cwd_file(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    payload = {"candidates": [{"id": "a", "score": 1, "cost": 0, "latency_ms": 1}]}
    path = tmp_path / "payload.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    resolved = safe_resolve_input_path("payload.json", base_dir=str(tmp_path))
    assert resolved == os.path.realpath(str(path))
    loaded = load_input_payload("payload.json", base_dir=str(tmp_path))
    assert loaded["candidates"][0]["id"] == "a"


def test_load_input_inline_json():
    payload = load_input_payload(
        json.dumps(
            {
                "candidates": [{"id": "x", "score": 2, "cost": 0.0, "latency_ms": 1}],
                "max_budget_usd": 1,
                "max_latency_ms": 10,
            }
        )
    )
    assert payload["candidates"][0]["id"] == "x"


def test_run_mode_routing_and_rules():
    routing = run_mode(
        "routing",
        {
            "candidates": [
                {"id": "cheap", "score": 5, "cost": 0.001, "latency_ms": 50},
                {"id": "rich", "score": 9, "cost": 1.0, "latency_ms": 50},
            ],
            "max_budget_usd": 0.01,
            "max_latency_ms": 100,
        },
    )
    assert routing["success"] is True
    assert routing["selected"] == "cheap"

    rules = run_mode(
        "rules",
        {
            "rules": [
                {"id": "r1", "risk_mitigation": 10, "eval_time_ms": 1, "token_footprint": 1},
            ],
            "max_eval_time_ms": 5,
            "max_token_footprint": 10,
        },
    )
    assert rules["success"] is True
    assert "r1" in rules["selected_rules"]


def test_main_cli_inline_json(capsys):
    code = main(
        [
            "--mode",
            "routing",
            "--input",
            json.dumps(
                {
                    "candidates": [
                        {"id": "a", "score": 3, "cost": 0.0, "latency_ms": 1},
                    ],
                    "max_budget_usd": 1,
                    "max_latency_ms": 10,
                }
            ),
        ]
    )
    captured = capsys.readouterr()
    body = json.loads(captured.out)
    assert code == 0
    assert body["success"] is True
    assert body["selected"] == "a"


def test_main_cli_rejects_escape_path(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    outside = Path(tempfile.gettempdir()) / "thumbgate-gurobi-cli-escape.json"
    outside.write_text('{"candidates":[{"id":"x","score":1,"cost":0,"latency_ms":1}]}', encoding="utf-8")
    code = main(["--mode", "routing", "--input", str(outside)])
    captured = capsys.readouterr()
    body = json.loads(captured.out)
    assert code == 1
    assert body["success"] is False
    assert "outside the allowed directory" in body["error"]
