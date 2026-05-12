#!/usr/bin/env python3
"""
Offline feedback quality evaluation for ThumbGate.

This is intentionally stdlib-only. It turns feedback-log.jsonl into a small
quality report that answers: where are repeated failures clustering, how stable
is the signal, and do we have enough labeled gate decisions to compute true
precision/recall yet?
"""

import argparse
import json
import math
import os
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


PROJECT_ROOT = Path(__file__).parent.parent

DEFAULT_CATEGORIES = {
    "code_edit": {
        "keywords": ["edit", "write", "implement", "refactor", "fix", "update", "create file"],
        "tools": ["edit", "write", "multiedit"],
    },
    "git": {
        "keywords": ["commit", "push", "branch", "merge", "pr", "pull request", "rebase", "cherry-pick"],
        "tools": ["bash", "git"],
    },
    "testing": {
        "keywords": ["test", "jest", "coverage", "verify", "verification", "spec", "mock", "assert"],
        "tools": [],
    },
    "review": {
        "keywords": ["review", "pr comment", "resolve", "thread", "feedback"],
        "tools": [],
    },
    "search": {
        "keywords": ["search", "find", "grep", "glob", "explore", "where is", "look for", "rg"],
        "tools": ["grep", "glob", "read", "rg"],
    },
    "security": {
        "keywords": ["security", "secret", "credential", "token", "auth", "injection", "xss"],
        "tools": [],
    },
    "debugging": {
        "keywords": ["debug", "error", "crash", "stack trace", "log", "diagnose", "investigate"],
        "tools": [],
    },
}


def resolve_feedback_dir() -> Path:
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


def read_jsonl(path: Path) -> Tuple[List[Dict[str, Any]], int]:
    rows: List[Dict[str, Any]] = []
    invalid = 0
    if not path.exists():
        return rows, invalid

    with path.open("r", encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                invalid += 1
                continue
            if isinstance(parsed, dict):
                rows.append(parsed)
            else:
                invalid += 1
    return rows, invalid


def load_sqlite_lessons(db_path: Optional[Path]) -> Dict[str, Any]:
    if not db_path:
        return {
            "available": False,
            "path": None,
            "totalLessons": 0,
            "bySignal": {},
            "byDomain": {},
            "sourceFeedbackIds": [],
            "error": None,
        }
    if not db_path.exists():
        return {
            "available": False,
            "path": str(db_path),
            "totalLessons": 0,
            "bySignal": {},
            "byDomain": {},
            "sourceFeedbackIds": [],
            "error": "SQLite lesson DB does not exist.",
        }

    try:
        connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        try:
            table_exists = connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='lessons'"
            ).fetchone()
            if not table_exists:
                return {
                    "available": False,
                    "path": str(db_path),
                    "totalLessons": 0,
                    "bySignal": {},
                    "byDomain": {},
                    "sourceFeedbackIds": [],
                    "error": "SQLite DB does not contain a lessons table.",
                }

            rows = connection.execute(
                "SELECT id, signal, domain, sourceFeedbackId FROM lessons WHERE pruned = 0"
            ).fetchall()
        finally:
            connection.close()
    except sqlite3.Error as exc:
        return {
            "available": False,
            "path": str(db_path),
            "totalLessons": 0,
            "bySignal": {},
            "byDomain": {},
            "sourceFeedbackIds": [],
            "error": str(exc),
        }

    by_signal = Counter(str(row["signal"] or "unknown") for row in rows)
    by_domain = Counter(str(row["domain"] or "unknown") for row in rows)
    source_ids = sorted({
        str(row["sourceFeedbackId"])
        for row in rows
        if row["sourceFeedbackId"]
    })
    return {
        "available": True,
        "path": str(db_path),
        "totalLessons": len(rows),
        "bySignal": dict(sorted(by_signal.items())),
        "byDomain": dict(sorted(by_domain.items())),
        "sourceFeedbackIds": source_ids,
        "error": None,
    }


def normalize_signal(entry: Dict[str, Any]) -> Optional[str]:
    raw = str(entry.get("signal") or entry.get("feedback") or "").strip().lower()
    if raw in {"positive", "up", "thumbsup", "thumbs_up", "👍"}:
        return "positive"
    if raw in {"negative", "down", "thumbsdown", "thumbs_down", "👎"}:
        return "negative"

    reward = entry.get("reward")
    if isinstance(reward, (int, float)):
        if reward > 0:
            return "positive"
        if reward < 0:
            return "negative"
    return None


def normalize_text(*values: Any) -> str:
    parts = []
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


def contains_keyword(text: str, keyword: str) -> bool:
    normalized_keyword = keyword.lower().strip()
    if not normalized_keyword:
        return False
    if len(normalized_keyword) <= 3 or re.fullmatch(r"[a-z0-9_+-]+", normalized_keyword):
        return re.search(rf"(?<![a-z0-9_+-]){re.escape(normalized_keyword)}(?![a-z0-9_+-])", text) is not None
    return normalized_keyword in text


def classify_entry(entry: Dict[str, Any]) -> List[str]:
    tags = entry.get("tags") if isinstance(entry.get("tags"), list) else []
    tool = entry.get("toolName") or entry.get("tool_name") or entry.get("last_tool")
    text = normalize_text(
        entry.get("context"),
        entry.get("whatWentWrong"),
        entry.get("whatToChange"),
        entry.get("whatWorked"),
        entry.get("actionReason"),
        entry.get("failureType"),
        tags,
    )
    tool_text = normalize_text(tool)

    matched = []
    for category, config in DEFAULT_CATEGORIES.items():
        keyword_match = any(contains_keyword(text, keyword) for keyword in config["keywords"])
        tool_match = any(contains_keyword(tool_text, tool_name) for tool_name in config["tools"])
        if keyword_match or tool_match:
            matched.append(category)

    if not matched:
        domain = entry.get("richContext", {}).get("domain") if isinstance(entry.get("richContext"), dict) else None
        if isinstance(domain, str) and domain:
            matched.append(domain)

    return matched or ["uncategorized"]


def parse_timestamp(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


def rate(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def wilson_lower_bound(positive: int, total: int, z: float = 1.96) -> float:
    if total <= 0:
        return 0.0
    p = positive / total
    denom = 1 + z * z / total
    centre = p + z * z / (2 * total)
    spread = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total)
    return round((centre - spread) / denom, 4)


def summarize_bucket(name: str, values: Iterable[str], signals: List[str], min_support: int) -> List[Dict[str, Any]]:
    counts: Dict[str, Counter] = defaultdict(Counter)
    for bucket_value, signal in zip(values, signals):
        counts[bucket_value][signal] += 1

    rows = []
    for bucket_value, counter in counts.items():
        positive = counter["positive"]
        negative = counter["negative"]
        total = positive + negative
        if total < min_support:
            continue
        rows.append({
            name: bucket_value,
            "support": total,
            "positive": positive,
            "negative": negative,
            "positiveRate": rate(positive, total),
            "negativeRate": rate(negative, total),
            "wilsonPositiveLower": wilson_lower_bound(positive, total),
        })

    return sorted(rows, key=lambda row: (-row["negativeRate"], -row["support"], row[name]))


def explicit_gate_label(entry: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """Return expected/actual labels when the log carries explicit gate labels.

    expected: harmful/safe based on feedback signal.
    actual: blocked/allowed from gate decision fields.
    """
    signal = normalize_signal(entry)
    if not signal:
        return None, None

    expected = "harmful" if signal == "negative" else "safe"

    for key in ("gateDecision", "decision", "outcome", "status"):
        value = str(entry.get(key) or "").lower()
        if value in {"block", "blocked", "deny", "denied", "rejected"}:
            return expected, "blocked"
        if value in {"allow", "allowed", "pass", "passed", "accepted"}:
            return expected, "allowed"

    if isinstance(entry.get("allowed"), bool):
        return expected, "allowed" if entry["allowed"] else "blocked"
    if isinstance(entry.get("blocked"), bool):
        return expected, "blocked" if entry["blocked"] else "allowed"
    if entry.get("actionType") == "no-action":
        return expected, "blocked"

    return expected, None


def compute_sqlite_metrics(entries: List[Dict[str, Any]], sqlite_lessons: Dict[str, Any]) -> Dict[str, Any]:
    if not sqlite_lessons.get("available"):
        return {
            "available": False,
            "path": sqlite_lessons.get("path"),
            "totalLessons": 0,
            "feedbackLessonCoverage": 0.0,
            "negativeLessonCoverage": 0.0,
            "bySignal": {},
            "byDomain": {},
            "error": sqlite_lessons.get("error"),
        }

    feedback_ids = {str(entry.get("id")) for entry in entries if entry.get("id")}
    negative_ids = {
        str(entry.get("id"))
        for entry in entries
        if entry.get("id") and normalize_signal(entry) == "negative"
    }
    lesson_feedback_ids = set(sqlite_lessons.get("sourceFeedbackIds") or [])

    return {
        "available": True,
        "path": sqlite_lessons.get("path"),
        "totalLessons": sqlite_lessons.get("totalLessons", 0),
        "feedbackLessonCoverage": rate(len(feedback_ids & lesson_feedback_ids), len(feedback_ids)),
        "negativeLessonCoverage": rate(len(negative_ids & lesson_feedback_ids), len(negative_ids)),
        "bySignal": sqlite_lessons.get("bySignal") or {},
        "byDomain": sqlite_lessons.get("byDomain") or {},
        "error": None,
    }


def retrieval_score(row: Dict[str, Any]) -> Optional[float]:
    for key in ("score", "similarity", "distanceScore", "topSimilarity"):
        value = row.get(key)
        if isinstance(value, (int, float)) and math.isfinite(value):
            return float(value)
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def feedback_id_for_retrieval(row: Dict[str, Any]) -> Optional[str]:
    for key in ("feedbackId", "sourceFeedbackId", "queryFeedbackId", "id"):
        value = row.get(key)
        if value:
            return str(value)
    return None


def compute_retrieval_metrics(retrieval_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not retrieval_rows:
        return {
            "available": False,
            "rows": 0,
            "queries": 0,
            "averageTopScore": None,
            "negativeNeighborRate": None,
            "error": None,
        }

    by_feedback: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    scored_rows = []
    negative_neighbors = 0
    labeled_neighbors = 0
    for row in retrieval_rows:
        feedback_id = feedback_id_for_retrieval(row) or "unknown"
        by_feedback[feedback_id].append(row)
        score = retrieval_score(row)
        if score is not None:
            scored_rows.append((feedback_id, score))
        neighbor_signal = normalize_signal({
            "signal": row.get("matchedSignal") or row.get("neighborSignal") or row.get("signal")
        })
        if neighbor_signal:
            labeled_neighbors += 1
            if neighbor_signal == "negative":
                negative_neighbors += 1

    top_scores = []
    for feedback_id, rows in by_feedback.items():
        scores = [retrieval_score(row) for row in rows]
        scores = [score for score in scores if score is not None]
        if scores:
            top_scores.append(max(scores))

    return {
        "available": True,
        "rows": len(retrieval_rows),
        "queries": len(by_feedback),
        "averageTopScore": round(sum(top_scores) / len(top_scores), 4) if top_scores else None,
        "negativeNeighborRate": rate(negative_neighbors, labeled_neighbors) if labeled_neighbors else None,
        "error": None,
    }


def compute_gate_metrics(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    tp = tn = fp = fn = unlabeled = 0

    for entry in entries:
        expected, actual = explicit_gate_label(entry)
        if expected is None:
            continue
        if actual is None:
            unlabeled += 1
            continue
        if expected == "harmful" and actual == "blocked":
            tp += 1
        elif expected == "safe" and actual == "allowed":
            tn += 1
        elif expected == "safe" and actual == "blocked":
            fp += 1
        elif expected == "harmful" and actual == "allowed":
            fn += 1

    labeled = tp + tn + fp + fn
    precision = rate(tp, tp + fp) if labeled else None
    recall = rate(tp, tp + fn) if labeled else None
    f1 = round((2 * precision * recall) / (precision + recall), 4) if precision and recall else (0.0 if labeled else None)

    return {
        "available": labeled > 0,
        "labeledDecisions": labeled,
        "unlabeledFeedback": unlabeled,
        "truePositiveBlocks": tp,
        "trueNegativeAllows": tn,
        "falsePositiveBlocks": fp,
        "falseNegativeAllows": fn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "note": None if labeled else "No explicit gate decision labels found; feedback quality metrics are available, but classifier precision/recall needs blocked/allowed labels.",
    }


def build_recommendations(report: Dict[str, Any]) -> List[str]:
    recommendations = []
    if report["usableEntries"] < 10:
        recommendations.append("Collect at least 10 usable feedback entries before making threshold changes.")

    gate_metrics = report["gateMetrics"]
    if not gate_metrics["available"]:
        recommendations.append("Start logging gate decisions as blocked/allowed so precision, recall, and false-positive rate can be computed.")

    sqlite_metrics = report.get("sqliteLessonMetrics") or {}
    if sqlite_metrics.get("available") and sqlite_metrics.get("negativeLessonCoverage", 0) < 0.8:
        recommendations.append("Backfill SQLite lesson rows for negative feedback before treating SQL dashboards as complete eval evidence.")

    retrieval_metrics = report.get("retrievalMetrics") or {}
    if retrieval_metrics.get("available") and retrieval_metrics.get("negativeNeighborRate") is not None and retrieval_metrics["negativeNeighborRate"] >= 0.5:
        recommendations.append("Inspect LanceDB retrieval neighborhoods: most labeled neighbors are negative, which is a good candidate for repeated-failure clustering.")

    weak_categories = [
        row for row in report["categoryMetrics"]
        if row["support"] >= report["minSupport"] and row["negativeRate"] >= 0.5
    ]
    if weak_categories:
        top = weak_categories[0]
        recommendations.append(
            f"Tighten prevention rules for {top['category']}: {top['negative']} negative signals across {top['support']} entries."
        )

    volatile_tags = [
        row for row in report["tagMetrics"]
        if row["support"] >= report["minSupport"] and 0.35 <= row["positiveRate"] <= 0.65
    ]
    if volatile_tags:
        recommendations.append(
            f"Review mixed-signal tag '{volatile_tags[0]['tag']}' before promoting broad rules; signal is not separable yet."
        )

    if not recommendations:
        recommendations.append("No immediate eval action required; keep collecting feedback and rerun this report after the next batch.")
    return recommendations


def evaluate_feedback(
    entries: List[Dict[str, Any]],
    invalid_entries: int = 0,
    min_support: int = 2,
    sqlite_lessons: Optional[Dict[str, Any]] = None,
    retrieval_rows: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    usable = []
    signals = []
    category_values = []
    tag_values = []
    failure_values = []
    timestamps = []

    for entry in entries:
        signal = normalize_signal(entry)
        if signal not in {"positive", "negative"}:
            continue
        usable.append(entry)
        signals.append(signal)
        categories = classify_entry(entry)
        category_values.append(categories[0])
        tags = entry.get("tags") if isinstance(entry.get("tags"), list) else []
        tag_values.append(str(tags[0]).strip().lower() if tags else "untagged")
        failure_values.append(str(entry.get("failureType") or "unspecified").strip().lower())
        parsed_ts = parse_timestamp(entry.get("timestamp"))
        if parsed_ts:
            timestamps.append(parsed_ts)

    positive = signals.count("positive")
    negative = signals.count("negative")
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "minSupport": min_support,
        "totalEntries": len(entries),
        "usableEntries": len(usable),
        "invalidEntries": invalid_entries,
        "positive": positive,
        "negative": negative,
        "positiveRate": rate(positive, len(usable)),
        "negativeRate": rate(negative, len(usable)),
        "firstTimestamp": min(timestamps).isoformat() if timestamps else None,
        "lastTimestamp": max(timestamps).isoformat() if timestamps else None,
        "categoryMetrics": summarize_bucket("category", category_values, signals, min_support),
        "tagMetrics": summarize_bucket("tag", tag_values, signals, min_support),
        "failureTypeMetrics": summarize_bucket("failureType", failure_values, signals, min_support),
        "gateMetrics": compute_gate_metrics(usable),
        "sqliteLessonMetrics": compute_sqlite_metrics(usable, sqlite_lessons or {"available": False, "error": None}),
        "retrievalMetrics": compute_retrieval_metrics(retrieval_rows or []),
    }
    report["recommendations"] = build_recommendations(report)
    return report


def render_markdown(report: Dict[str, Any]) -> str:
    lines = [
        "# Feedback Quality Eval",
        "",
        f"- Generated: {report['generatedAt']}",
        f"- Usable feedback: {report['usableEntries']} / {report['totalEntries']}",
        f"- Positive rate: {report['positiveRate']}",
        f"- Negative rate: {report['negativeRate']}",
        "",
        "## Gate Metrics",
        "",
    ]
    gate = report["gateMetrics"]
    if gate["available"]:
        lines.extend([
            f"- Labeled decisions: {gate['labeledDecisions']}",
            f"- Precision: {gate['precision']}",
            f"- Recall: {gate['recall']}",
            f"- F1: {gate['f1']}",
            f"- False positive blocks: {gate['falsePositiveBlocks']}",
            f"- False negative allows: {gate['falseNegativeAllows']}",
        ])
    else:
        lines.append(f"- {gate['note']}")

    lines.extend(["", "## Highest-Risk Categories", ""])
    if report["categoryMetrics"]:
        lines.append("| Category | Support | Positive | Negative | Negative rate |")
        lines.append("| --- | ---: | ---: | ---: | ---: |")
        for row in report["categoryMetrics"][:8]:
            lines.append(f"| {row['category']} | {row['support']} | {row['positive']} | {row['negative']} | {row['negativeRate']} |")
    else:
        lines.append("- Not enough category support yet.")

    sqlite_metrics = report["sqliteLessonMetrics"]
    lines.extend(["", "## SQLite Lesson Coverage", ""])
    if sqlite_metrics["available"]:
        lines.extend([
            f"- Lessons: {sqlite_metrics['totalLessons']}",
            f"- Feedback coverage: {sqlite_metrics['feedbackLessonCoverage']}",
            f"- Negative feedback coverage: {sqlite_metrics['negativeLessonCoverage']}",
        ])
    else:
        lines.append(f"- Not available{': ' + sqlite_metrics['error'] if sqlite_metrics.get('error') else ''}.")

    retrieval_metrics = report["retrievalMetrics"]
    lines.extend(["", "## LanceDB Retrieval Export", ""])
    if retrieval_metrics["available"]:
        lines.extend([
            f"- Rows: {retrieval_metrics['rows']}",
            f"- Queries: {retrieval_metrics['queries']}",
            f"- Average top score: {retrieval_metrics['averageTopScore']}",
            f"- Negative neighbor rate: {retrieval_metrics['negativeNeighborRate']}",
        ])
    else:
        lines.append("- Not available. Export retrieval rows to JSONL to evaluate semantic recall quality.")

    lines.extend(["", "## Recommendations", ""])
    lines.extend(f"- {item}" for item in report["recommendations"])
    lines.append("")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate ThumbGate feedback quality from feedback-log.jsonl.")
    parser.add_argument("--feedback-log", help="Path to feedback-log.jsonl. Defaults to the resolved ThumbGate feedback dir.")
    parser.add_argument("--feedback-dir", help="Directory containing feedback-log.jsonl.")
    parser.add_argument("--lesson-db", help="Path to lessons.sqlite for SQL lesson coverage metrics.")
    parser.add_argument("--retrieval-log", help="JSONL export of LanceDB retrieval rows for semantic recall metrics.")
    parser.add_argument("--min-support", type=int, default=2, help="Minimum bucket support for category/tag metrics.")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of Markdown.")
    parser.add_argument("--write-report", help="Write the rendered report to a file.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    feedback_log = Path(args.feedback_log) if args.feedback_log else None
    if feedback_log is None:
        feedback_dir = Path(args.feedback_dir) if args.feedback_dir else resolve_feedback_dir()
        feedback_log = feedback_dir / "feedback-log.jsonl"

    entries, invalid = read_jsonl(feedback_log)
    lesson_db = Path(args.lesson_db) if args.lesson_db else None
    retrieval_log = Path(args.retrieval_log) if args.retrieval_log else None
    retrieval_rows, retrieval_invalid = read_jsonl(retrieval_log) if retrieval_log else ([], 0)
    sqlite_lessons = load_sqlite_lessons(lesson_db)
    report = evaluate_feedback(
        entries,
        invalid_entries=invalid,
        min_support=max(args.min_support, 1),
        sqlite_lessons=sqlite_lessons,
        retrieval_rows=retrieval_rows,
    )
    report["feedbackLog"] = str(feedback_log)
    report["lessonDb"] = str(lesson_db) if lesson_db else None
    report["retrievalLog"] = str(retrieval_log) if retrieval_log else None
    report["invalidRetrievalRows"] = retrieval_invalid

    output = json.dumps(report, indent=2, sort_keys=True) if args.json else render_markdown(report)
    if args.write_report:
        out_path = Path(args.write_report)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output + ("\n" if not output.endswith("\n") else ""), encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
