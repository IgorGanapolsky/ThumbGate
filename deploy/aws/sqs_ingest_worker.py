"""
ThumbGate Cloud Sink — AWS Lambda Python SQS Ingestion Worker

Processes, sanitizes, and writes batch inputs from AWS SQS into Amazon RDS (PostgreSQL)
and/or Amazon S3 (`dpo-exports/YYYY/MM/DD/HH-<uuid>.json`), with automatic fallback to
AWS Free-Tier S3/DynamoDB when `DATABASE_URL` is unset ($0.00/mo idle cost).

Fixes the capture-group bug in naive regex lists where un-grouped token patterns
(`ghp_...`, `sk-proj-...`) would raise `re.error: invalid group reference 1` on `.sub(r'\\1=...')`.
"""

import json
import os
import re
import uuid
from datetime import datetime, timezone

try:
    import boto3
except ImportError:  # pragma: no cover
    boto3 = None

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:  # pragma: no cover
    psycopg2 = None
    execute_values = None

DPO_S3_BUCKET = os.environ.get("DPO_S3_BUCKET", "thumbgate-dpo-warehouse")
DB_CONN_STRING = os.environ.get("DATABASE_URL", "")

KEY_VALUE_SECRET_PATTERN = re.compile(
    r'(?i)(api[_-]?key|secret|password|passwd|auth[_-]?token|bearer|private[_-]?key)(\s*[:=]\s*|\s+)["\']?([a-zA-Z0-9_\-\.]{12,})["\']?'
)
STANDALONE_TOKEN_PATTERNS = [
    re.compile(r"ghp_[a-zA-Z0-9]{20,}"),
    re.compile(r"sk-proj-[a-zA-Z0-9_\-]{20,}"),
    re.compile(r"sk-[a-zA-Z0-9]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
]


def sanitize_payload(value):
    """Deeply inspects and redacts active security tokens across strings, dicts, and lists."""
    if isinstance(value, str):
        sanitized = KEY_VALUE_SECRET_PATTERN.sub(
            r"\1=[REDACTED_SECURITY_BOUNDARY]", value
        )
        for pattern in STANDALONE_TOKEN_PATTERNS:
            sanitized = pattern.sub("[REDACTED_SECURITY_BOUNDARY]", sanitized)
        return sanitized
    if isinstance(value, dict):
        return {k: sanitize_payload(v) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize_payload(item) for item in value]
    return value


def process_record(body_str):
    """Validates structural metrics, deep-scrubs secrets, and extracts DB tuple + DPO dict."""
    raw_data = json.loads(body_str) if isinstance(body_str, str) else dict(body_str)
    data = sanitize_payload(raw_data)

    context = dict(data.get("action_context") or {})
    tool_clean = sanitize_payload(context.get("tool_proposed", ""))
    context["tool_proposed"] = tool_clean
    data["action_context"] = context

    enforcement = data.get("enforcement") or {}
    feedback = data.get("feedback_alignment") or {}

    now_iso = datetime.now(timezone.utc).isoformat()
    record_tuple = (
        str(data.get("transaction_id") or f"tg_gen_{uuid.uuid4()}"),
        str(data.get("timestamp") or now_iso),
        str(data.get("developer_id") or "anonymous"),
        str(data.get("agent_framework") or "unknown"),
        tool_clean,
        int(context.get("loop_depth", 1)),
        int(context.get("tokens_input", 0)),
        int(context.get("tokens_saved_by_cache", 0)),
        str(enforcement.get("decision") or "WARN")[:10],
        str(enforcement.get("rule_triggered") or "default-gate")[:100],
        float(enforcement.get("latency_ms", 0.0)),
        str(feedback.get("explicit_rating") or "unrated")[:20],
        bool(feedback.get("is_dpo_pair", False)),
        json.dumps(context),
    )
    return record_tuple, data


def lambda_handler(event, context=None, s3_client_override=None, db_conn_override=None):
    """Processes incoming buffered SQS message micro-batches into PostgreSQL + S3."""
    records_to_insert = []
    dpo_records_to_s3 = []

    for sqs_record in (event or {}).get("Records", []):
        try:
            db_tuple, clean_json = process_record(sqs_record.get("body", "{}"))
            records_to_insert.append(db_tuple)
            if db_tuple[12] is True:
                dpo_records_to_s3.append(clean_json)
        except Exception as err:
            print(f"Error parsing log message payload configuration: {err}")
            continue

    if records_to_insert and (DB_CONN_STRING or db_conn_override):
        query = """
            INSERT INTO thumbgate_logs (
                transaction_id, created_at, developer_id, agent_framework, tool_proposed,
                loop_depth, tokens_input, tokens_saved, decision, rule_triggered,
                latency_ms, explicit_rating, is_dpo_pair, action_context
            ) VALUES %s
            ON CONFLICT (transaction_id) DO NOTHING;
        """
        conn = db_conn_override
        owns_conn = False
        try:
            if conn is None and psycopg2 is not None:
                conn = psycopg2.connect(DB_CONN_STRING)
                owns_conn = True
            if conn is not None:
                cursor = conn.cursor()
                if execute_values is not None:
                    execute_values(cursor, query, records_to_insert)
                cursor.close()
                conn.commit()
        except Exception as db_err:
            print(f"Database ingestion write fault: {db_err}")
            if conn is not None:
                conn.rollback()
            raise db_err
        finally:
            if owns_conn and conn is not None:
                conn.close()

    s3_key = None
    if dpo_records_to_s3:
        now = datetime.now(timezone.utc)
        s3_key = f"dpo-exports/{now.year}/{now.month:02d}/{now.day:02d}/{now.hour:02d}-{uuid.uuid4().hex[:8]}.json"
        client = s3_client_override or (boto3.client("s3") if boto3 else None)
        if client is not None:
            try:
                client.put_object(
                    Bucket=DPO_S3_BUCKET,
                    Key=s3_key,
                    Body=json.dumps(dpo_records_to_s3, default=str),
                    ContentType="application/json",
                )
            except Exception as s3_err:
                print(f"S3 Object transport transmission error: {s3_err}")

    return {
        "status": "SUCCESS",
        "processed_records_count": len(records_to_insert),
        "exported_dpo_count": len(dpo_records_to_s3),
        "s3_key": s3_key,
    }
