#!/usr/bin/env python3
"""Shared feedback classification for ThumbGate Python utilities.

Single source of truth for:
  - DEFAULT_CATEGORIES (was duplicated and drifting between
    train_from_feedback.py and feedback_quality_eval.py)
  - resolve_feedback_dir() (env -> .thumbgate -> legacy -> home fallback)
  - normalize_signal() / classify_entry() (regex word-boundary matching;
    field-name aliases for both camelCase and snake_case feedback shapes
    so the trainer also picks up canonical capture-feedback.js entries
    that emit `lastAction` rather than `last_action`).

ThumbGate is model-agnostic. These categories and field aliases must
work for feedback emitted by Claude Code, Cursor, Codex, Gemini, Cline,
Amp, OpenCode, and any other MCP-compatible adapter.
"""

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional


PROJECT_ROOT = Path(__file__).parent.parent


DEFAULT_CATEGORIES: Dict[str, Dict[str, List[str]]] = {
    "code_edit": {
        "keywords": ["edit", "write", "implement", "refactor", "fix", "update", "create file"],
        "tools": ["Edit", "Write", "MultiEdit"],
    },
    "git": {
        "keywords": ["commit", "push", "branch", "merge", "pr", "pull request", "rebase", "cherry-pick"],
        "tools": ["Bash", "git"],
    },
    "testing": {
        "keywords": ["test", "jest", "coverage", "verify", "verification", "spec", "mock", "assert"],
        "tools": [],
    },
    "pr_review": {
        "keywords": ["review", "pr comment", "resolve", "thread", "feedback"],
        "tools": [],
    },
    "search": {
        "keywords": ["search", "find", "grep", "glob", "explore", "where is", "look for", "rg"],
        "tools": ["Grep", "Glob", "Read", "rg"],
    },
    "architecture": {
        "keywords": ["architecture", "design", "pattern", "structure", "fsd", "module", "navigation"],
        "tools": [],
    },
    "security": {
        "keywords": ["security", "secret", "credential", "token", "auth", "vulnerability", "injection", "xss", "owasp", "trufflehog"],
        "tools": [],
    },
    "debugging": {
        "keywords": ["debug", "error", "crash", "stack trace", "log", "diagnose", "investigate"],
        "tools": [],
    },
}


# Tool-name field aliases so classify_entry works across adapter shapes.
# Canonical capture-feedback.js writes `lastAction`; legacy/eval writers
# use `toolName` / `tool_name` / `last_tool`. Read all of them.
TOOL_FIELD_ALIASES = ("toolName", "tool_name", "last_tool", "lastAction", "last_action")

# Sentiment-signal field aliases. `signal` is canonical; `feedback` is legacy.
SIGNAL_FIELD_ALIASES = ("signal", "feedback")

POSITIVE_TOKENS = {"positive", "up", "thumbsup", "thumbs_up", "👍"}
NEGATIVE_TOKENS = {"negative", "down", "thumbsdown", "thumbs_down", "👎"}


def resolve_feedback_dir() -> Path:
    """Resolve the active ThumbGate feedback directory.

    Order:
      1. THUMBGATE_FEEDBACK_DIR env var (explicit override)
      2. <project>/.thumbgate (canonical local)
      3. <project>/.claude/memory/feedback (legacy local)
      4. ~/.thumbgate/projects/<project name> (home fallback)
    """
    env_dir = os.environ.get("THUMBGATE_FEEDBACK_DIR")
    if env_dir:
        return Path(env_dir)

    local_thumbgate = PROJECT_ROOT / ".thumbgate"
    if local_thumbgate.exists():
        return local_thumbgate

    local_legacy = PROJECT_ROOT / ".claude" / "memory" / "feedback"
    if local_legacy.exists():
        return local_legacy

    return Path.home() / ".thumbgate" / "projects" / PROJECT_ROOT.name


def normalize_signal(entry: Dict[str, Any]) -> Optional[str]:
    """Return 'positive' / 'negative' / None for a feedback entry.

    Reads `signal` then `feedback` for the sentiment string, and falls
    back to a numeric `reward` field (>0 positive, <0 negative).
    """
    for field in SIGNAL_FIELD_ALIASES:
        raw = str(entry.get(field) or "").strip().lower()
        if raw in POSITIVE_TOKENS:
            return "positive"
        if raw in NEGATIVE_TOKENS:
            return "negative"

    reward = entry.get("reward")
    if isinstance(reward, (int, float)):
        if reward > 0:
            return "positive"
        if reward < 0:
            return "negative"
    return None


def is_positive(entry: Dict[str, Any]) -> bool:
    """True when the entry's normalized signal is positive."""
    return normalize_signal(entry) == "positive"


def _normalize_text(*values: Any) -> str:
    parts: List[str] = []
    for value in values:
        if value is None:
            continue
        if isinstance(value, list):
            parts.extend(str(item) for item in value)
        elif isinstance(value, dict):
            parts.append(json.dumps(value, sort_keys=True))
        else:
            parts.append(str(value))
    return " ".join(parts).lower()


def _contains_keyword(text: str, keyword: str) -> bool:
    """Word-boundary substring match.

    Short / identifier-shaped keywords (<=3 chars or all alphanumeric)
    use a regex word boundary so 'edit' does not match 'credit', 'test'
    does not match 'latest', and 'pr' does not match 'preview'. Longer
    multi-word phrases (e.g. 'pull request') fall back to plain substring
    because they are already specific enough that word-bounding would
    just add false negatives on punctuation.
    """
    needle = keyword.lower().strip()
    if not needle:
        return False
    if len(needle) <= 3 or re.fullmatch(r"[a-z0-9_+-]+", needle):
        return re.search(rf"(?<![a-z0-9_+-]){re.escape(needle)}(?![a-z0-9_+-])", text) is not None
    return needle in text


def _extract_tool_value(entry: Dict[str, Any]) -> Any:
    """Pick the first non-empty tool-name field present on the entry."""
    for field in TOOL_FIELD_ALIASES:
        candidate = entry.get(field)
        if candidate:
            return candidate
    return None


def _category_matches(text: str, tool_text: str, config: Dict[str, List[str]]) -> bool:
    keywords = config.get("keywords", [])
    tools = config.get("tools", [])
    if any(_contains_keyword(text, kw) for kw in keywords):
        return True
    return bool(tools) and any(_contains_keyword(tool_text, t) for t in tools)


def _fallback_domain(entry: Dict[str, Any]) -> Optional[str]:
    rich = entry.get("richContext")
    if not isinstance(rich, dict):
        return None
    domain = rich.get("domain")
    return domain if isinstance(domain, str) and domain else None


def classify_entry(entry: Dict[str, Any], categories: Optional[Dict[str, Dict[str, List[str]]]] = None) -> List[str]:
    """Classify a feedback entry into one or more category names.

    Returns ['uncategorized'] when no rule fires. Reads tool-name from
    every known alias so classification works across capture-feedback.js
    writers (lastAction), legacy trainer writers (last_tool), and
    eval-script writers (toolName / tool_name).
    """
    cats = categories if categories is not None else DEFAULT_CATEGORIES
    tags = entry.get("tags") if isinstance(entry.get("tags"), list) else []
    text = _normalize_text(
        entry.get("context"),
        entry.get("submittedContext"),
        entry.get("message"),
        entry.get("whatWentWrong"),
        entry.get("whatToChange"),
        entry.get("whatWorked"),
        entry.get("actionReason"),
        entry.get("failureType"),
        tags,
    )
    tool_text = _normalize_text(_extract_tool_value(entry))

    matched = [name for name, config in cats.items() if _category_matches(text, tool_text, config)]
    if matched:
        return matched

    fallback = _fallback_domain(entry)
    return [fallback] if fallback else ["uncategorized"]
