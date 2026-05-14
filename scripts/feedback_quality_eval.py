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
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).parent))
from feedback_categories import (  # noqa: E402
    DEFAULT_CATEGORIES,
    PROJECT_ROOT,
    classify_entry,
    normalize_signal,
    resolve_feedback_dir,
)


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


def unavailable_retrieval_metrics() -> Dict[str, Any]:
    return {
        "available": False,
        "rows": 0,
        "queries": 0,
        "averageTopScore": None,
        "negativeNeighborRate": None,
        "error": None,
    }


def bucket_retrieval_rows(retrieval_rows: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    by_feedback: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in retrieval_rows:
        feedback_id = feedback_id_for_retrieval(row) or "unknown"
        by_feedback[feedback_id].append(row)
    return by_feedback


def top_retrieval_scores(by_feedback: Dict[str, List[Dict[str, Any]]]) -> List[float]:
    top_scores = []
    for rows in by_feedback.values():
        scores = [score for score in (retrieval_score(row) for row in rows) if score is not None]
        if scores:
            top_scores.append(max(scores))
    return top_scores


def retrieval_neighbor_summary(retrieval_rows: List[Dict[str, Any]]) -> Dict[str, int]:
    summary = {"labeled": 0, "negative": 0}
    for row in retrieval_rows:
        neighbor_signal = normalize_signal({
            "signal": row.get("matchedSignal") or row.get("neighborSignal") or row.get("signal")
        })
        if not neighbor_signal:
            continue
        summary["labeled"] += 1
        if neighbor_signal == "negative":
            summary["negative"] += 1
    return summary


def compute_retrieval_metrics(retrieval_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not retrieval_rows:
        return unavailable_retrieval_metrics()

    by_feedback = bucket_retrieval_rows(retrieval_rows)
    top_scores = top_retrieval_scores(by_feedback)
    neighbor_summary = retrieval_neighbor_summary(retrieval_rows)
    labeled_neighbors = neighbor_summary["labeled"]

    return {
        "available": True,
        "rows": len(retrieval_rows),
        "queries": len(by_feedback),
        "averageTopScore": round(sum(top_scores) / len(top_scores), 4) if top_scores else None,
        "negativeNeighborRate": rate(neighbor_summary["negative"], labeled_neighbors) if labeled_neighbors else None,
        "error": None,
    }


GATE_OUTCOME_KEYS = {
    ("harmful", "blocked"): "truePositiveBlocks",
    ("safe", "allowed"): "trueNegativeAllows",
    ("safe", "blocked"): "falsePositiveBlocks",
    ("harmful", "allowed"): "falseNegativeAllows",
}


def initial_gate_counts() -> Dict[str, int]:
    return {
        "truePositiveBlocks": 0,
        "trueNegativeAllows": 0,
        "falsePositiveBlocks": 0,
        "falseNegativeAllows": 0,
        "unlabeledFeedback": 0,
    }


def count_gate_outcomes(entries: List[Dict[str, Any]]) -> Dict[str, int]:
    counts = initial_gate_counts()

    for entry in entries:
        expected, actual = explicit_gate_label(entry)
        if expected is None:
            continue
        if actual is None:
            counts["unlabeledFeedback"] += 1
            continue

        count_key = GATE_OUTCOME_KEYS.get((expected, actual))
        if count_key:
            counts[count_key] += 1

    return counts


def compute_f1(precision: Optional[float], recall: Optional[float], labeled: int) -> Optional[float]:
    if not labeled:
        return None
    if not precision or not recall:
        return 0.0
    return round((2 * precision * recall) / (precision + recall), 4)


def compute_gate_metrics(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    counts = count_gate_outcomes(entries)
    tp = counts["truePositiveBlocks"]
    tn = counts["trueNegativeAllows"]
    fp = counts["falsePositiveBlocks"]
    fn = counts["falseNegativeAllows"]

    labeled = tp + tn + fp + fn
    precision = rate(tp, tp + fp) if labeled else None
    recall = rate(tp, tp + fn) if labeled else None
    f1 = compute_f1(precision, recall, labeled)

    return {
        "available": labeled > 0,
        "labeledDecisions": labeled,
        "unlabeledFeedback": counts["unlabeledFeedback"],
        "truePositiveBlocks": tp,
        "trueNegativeAllows": tn,
        "falsePositiveBlocks": fp,
        "falseNegativeAllows": fn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "note": None if labeled else "No explicit gate decision labels found; feedback quality metrics are available, but classifier precision/recall needs blocked/allowed labels.",
    }


def base_recommendations(report: Dict[str, Any]) -> List[str]:
    items = []
    if report["usableEntries"] < 10:
        items.append("Collect at least 10 usable feedback entries before making threshold changes.")
    if not report["gateMetrics"]["available"]:
        items.append("Start logging gate decisions as blocked/allowed so precision, recall, and false-positive rate can be computed.")
    return items


def storage_recommendations(report: Dict[str, Any]) -> List[str]:
    items = []
    sqlite_metrics = report.get("sqliteLessonMetrics") or {}
    if sqlite_metrics.get("available") and sqlite_metrics.get("negativeLessonCoverage", 0) < 0.8:
        items.append("Backfill SQLite lesson rows for negative feedback before treating SQL dashboards as complete eval evidence.")

    retrieval_metrics = report.get("retrievalMetrics") or {}
    if retrieval_metrics.get("available") and retrieval_metrics.get("negativeNeighborRate") is not None and retrieval_metrics["negativeNeighborRate"] >= 0.5:
        items.append("Inspect LanceDB retrieval neighborhoods: most labeled neighbors are negative, which is a good candidate for repeated-failure clustering.")
    return items


def category_recommendations(report: Dict[str, Any]) -> List[str]:
    items = []
    weak_categories = [
        row for row in report["categoryMetrics"]
        if row["support"] >= report["minSupport"] and row["negativeRate"] >= 0.5
    ]
    if weak_categories:
        top = weak_categories[0]
        items.append(
            f"Tighten prevention rules for {top['category']}: {top['negative']} negative signals across {top['support']} entries."
        )
    return items


def tag_recommendations(report: Dict[str, Any]) -> List[str]:
    volatile_tags = [
        row for row in report["tagMetrics"]
        if row["support"] >= report["minSupport"] and 0.35 <= row["positiveRate"] <= 0.65
    ]
    if not volatile_tags:
        return []
    return [
        f"Review mixed-signal tag '{volatile_tags[0]['tag']}' before promoting broad rules; signal is not separable yet."
    ]


def build_recommendations(report: Dict[str, Any]) -> List[str]:
    recommendations = []
    recommendations.extend(base_recommendations(report))
    recommendations.extend(storage_recommendations(report))
    recommendations.extend(category_recommendations(report))
    recommendations.extend(tag_recommendations(report))
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
