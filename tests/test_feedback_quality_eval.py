import math
import sys
from pathlib import Path
import pytest
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from feedback_quality_eval import (
    wilson_lower_bound,
    rate,
    normalize_signal,
    parse_timestamp,
    compute_f1
)

def test_rate():
    assert rate(5, 10) == 0.5
    assert rate(1, 3) == 0.3333
    assert rate(0, 0) == 0.0

def test_wilson_lower_bound():
    wlb = wilson_lower_bound(10, 10)
    assert 0.72 <= wlb <= 0.73
    
    wlb_zero = wilson_lower_bound(0, 10)
    assert wlb_zero == 0.0

    wlb_half = wilson_lower_bound(5, 10)
    assert 0.23 <= wlb_half <= 0.24

def test_normalize_signal():
    assert normalize_signal({"signal": "positive"}) == "positive"
    assert normalize_signal({"signal": "up"}) == "positive"
    assert normalize_signal({"reward": 1}) == "positive"
    
    assert normalize_signal({"signal": "negative"}) == "negative"
    assert normalize_signal({"signal": "down"}) == "negative"
    assert normalize_signal({"reward": -1}) == "negative"
    
    assert normalize_signal({}) is None

def test_parse_timestamp():
    ts_str = "2026-05-14T12:00:00Z"
    dt = parse_timestamp(ts_str)
    assert dt is not None
    assert dt.year == 2026
    assert dt.tzinfo == timezone.utc

    assert parse_timestamp("invalid_date") is None

def test_compute_f1():
    assert compute_f1(1.0, 1.0, 10) == 1.0
    assert compute_f1(0.5, 0.5, 10) == 0.5
    assert compute_f1(1.0, 1.0, 0) is None
    assert compute_f1(0.0, 0.5, 10) == 0.0
