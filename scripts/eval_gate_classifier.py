#!/usr/bin/env python3
"""End-to-end binary classifier for ThumbGate gate decisions.

Pipeline (load → preprocess → train → eval → serialize):

  1. Load   .thumbgate/feedback-log.jsonl rows.
  2. Filter to entries with a normalized positive/negative signal label.
  3. Build features: TF-IDF on context text + one-hot category + bag-of-tags.
  4. Stratified train/test split (default 80/20, seeded for reproducibility).
  5. Fit a Pipeline(LogisticRegression, class_weight='balanced').
  6. Score on the held-out set: precision, recall, F1 (per-class + macro),
     ROC-AUC, PR-AUC (average precision), full classification_report.
  7. Serialize the fitted pipeline to <output_dir>/gate_classifier.joblib
     and the metrics card to <output_dir>/gate_classifier_metrics.json.

This is the only sklearn surface in the repo. It is opt-in — sklearn,
joblib, scipy, and numpy are NOT runtime dependencies of the npm
package. Install before running:

    pip install scikit-learn joblib

Run via:

    python scripts/eval_gate_classifier.py
    npm run eval:classifier

Why a binary classifier on top of Thompson Sampling: TS gives reliable
per-category posteriors but cannot rank an unseen tool call against
features it has never bucketed. A small calibrated LR over text + tags
gives a single probability per call that's directly comparable across
adapters and surfaces — useful as a second opinion for the Pre-Action
Gate before the deterministic risk_scorer.js fires.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).parent))
from feedback_quality_eval import (  # noqa: E402
    classify_entry,
    normalize_signal,
    resolve_feedback_dir,
)


SKLEARN_INSTALL_HINT = (
    "scikit-learn is not installed. This is the only sklearn surface in "
    "ThumbGate and it is intentionally opt-in. Install with:\n"
    "    pip install scikit-learn joblib"
)


def _require_sklearn():
    """Lazy import sklearn so the rest of the repo never pays the cost."""
    try:
        import joblib  # noqa: F401
        from sklearn.feature_extraction.text import TfidfVectorizer  # noqa: F401
        from sklearn.linear_model import LogisticRegression  # noqa: F401
        from sklearn.metrics import (  # noqa: F401
            average_precision_score,
            classification_report,
            f1_score,
            precision_score,
            recall_score,
            roc_auc_score,
        )
        from sklearn.model_selection import train_test_split  # noqa: F401
        from sklearn.pipeline import Pipeline  # noqa: F401
        from sklearn.preprocessing import MultiLabelBinarizer  # noqa: F401
    except ImportError as exc:  # pragma: no cover - import guard tested via CLI
        raise SystemExit(f"{SKLEARN_INSTALL_HINT}\n(missing: {exc.name})") from exc


@dataclass
class DatasetStats:
    total_rows: int
    labeled_rows: int
    positive: int
    negative: int
    train_size: int
    test_size: int
    feature_dim: int


@dataclass
class MetricsCard:
    model: str
    random_seed: int
    test_size: float
    dataset: DatasetStats
    precision: Dict[str, float]
    recall: Dict[str, float]
    f1: Dict[str, float]
    roc_auc: Optional[float]
    pr_auc: Optional[float]
    classification_report: Dict[str, Any]
    artifact_path: str


def load_labeled_rows(path: Path) -> List[Dict[str, Any]]:
    """Read JSONL feedback log and keep entries with a positive/negative signal."""
    if not path.exists():
        raise SystemExit(f"feedback log not found: {path}")
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(entry, dict):
                continue
            if normalize_signal(entry) in ("positive", "negative"):
                rows.append(entry)
    return rows


def build_feature_frames(
    rows: List[Dict[str, Any]],
) -> Tuple[List[str], List[List[str]], List[List[str]], List[int]]:
    """Project rows into parallel arrays for the sklearn pipeline.

    Returns (texts, tag_lists, category_lists, labels). category is
    classify_entry's output — multi-label so we treat it as a tag set.
    """
    texts: List[str] = []
    tag_lists: List[List[str]] = []
    category_lists: List[List[str]] = []
    labels: List[int] = []
    for entry in rows:
        text = " ".join(
            str(entry.get(field) or "")
            for field in ("context", "submittedContext", "whatWentWrong", "whatToChange", "whatWorked")
        ).strip()
        tags = entry.get("tags") if isinstance(entry.get("tags"), list) else []
        categories = classify_entry(entry)
        texts.append(text or "(no context)")
        tag_lists.append([str(t).lower() for t in tags] or ["__notag__"])
        category_lists.append(categories or ["uncategorized"])
        labels.append(1 if normalize_signal(entry) == "positive" else 0)
    return texts, tag_lists, category_lists, labels


def stack_features(texts, tag_lists, category_lists, *, fit, fitted=None):
    """Build a sparse feature matrix from text + multi-label encoders.

    On fit=True returns (X, fitted_state). On fit=False uses the supplied
    fitted_state to transform the held-out set with no leakage.
    """
    from scipy.sparse import csr_matrix, hstack
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.preprocessing import MultiLabelBinarizer

    if fit:
        text_vec = TfidfVectorizer(min_df=1, max_features=2000, ngram_range=(1, 2))
        text_x = text_vec.fit_transform(texts)
        tag_mlb = MultiLabelBinarizer()
        tag_x = csr_matrix(tag_mlb.fit_transform(tag_lists))
        cat_mlb = MultiLabelBinarizer()
        cat_x = csr_matrix(cat_mlb.fit_transform(category_lists))
        state = {"text_vec": text_vec, "tag_mlb": tag_mlb, "cat_mlb": cat_mlb}
    else:
        assert fitted is not None
        text_x = fitted["text_vec"].transform(texts)
        # Filter unseen labels per row so MultiLabelBinarizer doesn't warn.
        # Unseen test-only labels carry no learned weight either way; this
        # just removes the stderr noise without changing the math.
        known_tags = set(fitted["tag_mlb"].classes_)
        known_cats = set(fitted["cat_mlb"].classes_)
        scrubbed_tags = [[t for t in row if t in known_tags] for row in tag_lists]
        scrubbed_cats = [[c for c in row if c in known_cats] for row in category_lists]
        tag_x = csr_matrix(fitted["tag_mlb"].transform(scrubbed_tags))
        cat_x = csr_matrix(fitted["cat_mlb"].transform(scrubbed_cats))
        state = fitted

    matrix = hstack([text_x, tag_x, cat_x]).tocsr()
    return matrix, state


def train_and_score(
    rows: List[Dict[str, Any]],
    *,
    output_dir: Path,
    test_size: float,
    random_seed: int,
) -> MetricsCard:
    _require_sklearn()
    import joblib
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import (
        average_precision_score,
        classification_report,
        f1_score,
        precision_score,
        recall_score,
        roc_auc_score,
    )
    from sklearn.model_selection import train_test_split

    texts, tag_lists, category_lists, labels = build_feature_frames(rows)
    if len(set(labels)) < 2:
        raise SystemExit(
            f"Need both positive AND negative labeled rows to train a classifier; "
            f"got {sum(labels)} positive / {len(labels) - sum(labels)} negative."
        )

    indices = list(range(len(rows)))
    train_idx, test_idx = train_test_split(
        indices,
        test_size=test_size,
        stratify=labels,
        random_state=random_seed,
    )

    train_texts = [texts[i] for i in train_idx]
    train_tags = [tag_lists[i] for i in train_idx]
    train_cats = [category_lists[i] for i in train_idx]
    train_y = [labels[i] for i in train_idx]
    test_texts = [texts[i] for i in test_idx]
    test_tags = [tag_lists[i] for i in test_idx]
    test_cats = [category_lists[i] for i in test_idx]
    test_y = [labels[i] for i in test_idx]

    train_x, fitted_state = stack_features(train_texts, train_tags, train_cats, fit=True)
    test_x, _ = stack_features(test_texts, test_tags, test_cats, fit=False, fitted=fitted_state)

    model = LogisticRegression(
        class_weight="balanced",
        max_iter=1000,
        solver="liblinear",
        random_state=random_seed,
    )
    model.fit(train_x, train_y)
    predictions = model.predict(test_x)
    probabilities = model.predict_proba(test_x)[:, 1]

    output_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = output_dir / "gate_classifier.joblib"
    joblib.dump(
        {
            "model": model,
            "feature_state": fitted_state,
            "schema_version": 1,
            "label_map": {"0": "negative", "1": "positive"},
        },
        artifact_path,
    )

    try:
        roc_auc = float(roc_auc_score(test_y, probabilities))
    except ValueError:
        roc_auc = None
    try:
        pr_auc = float(average_precision_score(test_y, probabilities))
    except ValueError:
        pr_auc = None

    card = MetricsCard(
        model="LogisticRegression(class_weight=balanced, solver=liblinear)",
        random_seed=random_seed,
        test_size=test_size,
        dataset=DatasetStats(
            total_rows=len(rows),
            labeled_rows=len(rows),
            positive=int(sum(labels)),
            negative=int(len(labels) - sum(labels)),
            train_size=len(train_idx),
            test_size=len(test_idx),
            feature_dim=int(train_x.shape[1]),
        ),
        precision={
            "positive": float(precision_score(test_y, predictions, pos_label=1, zero_division=0)),
            "negative": float(precision_score(test_y, predictions, pos_label=0, zero_division=0)),
            "macro": float(precision_score(test_y, predictions, average="macro", zero_division=0)),
        },
        recall={
            "positive": float(recall_score(test_y, predictions, pos_label=1, zero_division=0)),
            "negative": float(recall_score(test_y, predictions, pos_label=0, zero_division=0)),
            "macro": float(recall_score(test_y, predictions, average="macro", zero_division=0)),
        },
        f1={
            "positive": float(f1_score(test_y, predictions, pos_label=1, zero_division=0)),
            "negative": float(f1_score(test_y, predictions, pos_label=0, zero_division=0)),
            "macro": float(f1_score(test_y, predictions, average="macro", zero_division=0)),
        },
        roc_auc=roc_auc,
        pr_auc=pr_auc,
        classification_report=classification_report(
            test_y,
            predictions,
            target_names=["negative", "positive"],
            output_dict=True,
            zero_division=0,
        ),
        artifact_path=str(artifact_path),
    )

    metrics_path = output_dir / "gate_classifier_metrics.json"
    metrics_path.write_text(json.dumps(asdict(card), indent=2, sort_keys=True))
    return card


def render_human(card: MetricsCard) -> str:
    lines = [
        "ThumbGate Gate Classifier — Eval Report",
        "=" * 50,
        f"  Model        : {card.model}",
        f"  Seed         : {card.random_seed}",
        f"  Train / Test : {card.dataset.train_size} / {card.dataset.test_size}",
        f"  Pos / Neg    : {card.dataset.positive} / {card.dataset.negative}",
        f"  Features     : {card.dataset.feature_dim}",
        "",
        "  Precision (positive / negative / macro): "
        f"{card.precision['positive']:.3f} / {card.precision['negative']:.3f} / {card.precision['macro']:.3f}",
        "  Recall    (positive / negative / macro): "
        f"{card.recall['positive']:.3f} / {card.recall['negative']:.3f} / {card.recall['macro']:.3f}",
        "  F1        (positive / negative / macro): "
        f"{card.f1['positive']:.3f} / {card.f1['negative']:.3f} / {card.f1['macro']:.3f}",
        "",
        f"  ROC-AUC      : {card.roc_auc if card.roc_auc is not None else 'n/a'}",
        f"  PR-AUC       : {card.pr_auc if card.pr_auc is not None else 'n/a'}",
        "",
        f"  Model artifact : {card.artifact_path}",
        "=" * 50,
    ]
    return "\n".join(lines)


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "--feedback-log",
        type=Path,
        help="Path to feedback-log.jsonl. Defaults to the resolved ThumbGate feedback dir.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Where to write the joblib model + metrics JSON. Defaults to <feedback dir>/eval.",
    )
    parser.add_argument("--test-size", type=float, default=0.2, help="Held-out fraction (default 0.2).")
    parser.add_argument("--random-seed", type=int, default=42, help="Seed for split + LR (default 42).")
    parser.add_argument("--json", action="store_true", help="Emit the metrics card as JSON to stdout.")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    feedback_dir = resolve_feedback_dir()
    feedback_log = args.feedback_log or feedback_dir / "feedback-log.jsonl"
    output_dir = args.output_dir or feedback_dir / "eval"

    rows = load_labeled_rows(feedback_log)
    if len(rows) < 10:
        raise SystemExit(
            f"Need at least 10 labeled rows to train a classifier; "
            f"found {len(rows)} in {feedback_log}."
        )
    card = train_and_score(
        rows,
        output_dir=output_dir,
        test_size=args.test_size,
        random_seed=args.random_seed,
    )
    if args.json:
        print(json.dumps(asdict(card), indent=2, sort_keys=True))
    else:
        print(render_human(card))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
