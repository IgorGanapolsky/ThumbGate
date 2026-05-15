import os
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
import pytest
from datetime import datetime, timedelta

import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from train_from_feedback import (
    time_decay_weight,
    HALF_LIFE_DAYS,
    classify_entry,
    DEFAULT_CATEGORIES,
    is_positive,
    dpo_log_ratio,
    create_initial_model,
)

def test_time_decay_weight():
    now = datetime.now().isoformat() + "Z"
    weight = time_decay_weight(now)
    assert 0.99 <= weight <= 1.0

    half_life_ago = (datetime.now() - timedelta(days=HALF_LIFE_DAYS)).isoformat() + "Z"
    weight_half = time_decay_weight(half_life_ago)
    assert 0.49 <= weight_half <= 0.51

def test_is_positive():
    assert is_positive({"reward": 1}) == True
    assert is_positive({"reward": -1}) == False
    assert is_positive({"signal": "positive"}) == True
    assert is_positive({"signal": "negative"}) == False
    assert is_positive({"feedback": "thumbsup"}) == True

def test_classify_entry():
    entry = {"context": "Need to write a new file for the test", "last_tool": "Write"}
    cats = classify_entry(entry, DEFAULT_CATEGORIES)
    assert "code_edit" in cats

    entry_git = {"message": "merge this pr", "last_tool": "Bash"}
    cats_git = classify_entry(entry_git, DEFAULT_CATEGORIES)
    assert "git" in cats_git

def test_dpo_log_ratio():
    adj = dpo_log_ratio(1.0, 0.1, beta=0.1)
    assert adj > 0

    adj = dpo_log_ratio(0.1, 1.0, beta=0.1)
    assert adj < 0
