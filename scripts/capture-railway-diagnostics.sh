#!/usr/bin/env bash
set -euo pipefail

DIAG_DIR="${1:-railway-diagnostics}"
LOG_LINES="${RAILWAY_LOG_LINES:-200}"
HTTP_LOG_LINES="${RAILWAY_HTTP_LOG_LINES:-50}"
CONNECT_TIMEOUT_SECONDS="${RAILWAY_HEALTHCHECK_CONNECT_TIMEOUT_SECONDS:-5}"
MAX_TIME_SECONDS="${RAILWAY_HEALTHCHECK_MAX_TIME_SECONDS:-20}"

mkdir -p "$DIAG_DIR"

if ! command -v railway >/dev/null 2>&1; then
  echo 'Railway CLI is not installed; skipping Railway diagnostics capture.'
  exit 0
fi

if [ -z "${RAILWAY_PROJECT_ID:-}" ] || [ -z "${RAILWAY_ENVIRONMENT_ID:-}" ]; then
  echo 'RAILWAY_PROJECT_ID and RAILWAY_ENVIRONMENT_ID are required for Railway diagnostics.'
  exit 1
fi

SERVICE_ARGS=()
if [ -n "${RAILWAY_SERVICE:-}" ]; then
  SERVICE_ARGS+=(--service "$RAILWAY_SERVICE")
fi

ENV_ARGS=(--environment "$RAILWAY_ENVIRONMENT_ID")

run_capture() {
  local label="$1"
  local output_path="$2"
  shift 2

  echo "== ${label} =="
  if "$@" >"$output_path" 2>"${output_path}.stderr"; then
    sed -n '1,120p' "$output_path" || true
    return 0
  fi

  sed -n '1,120p' "${output_path}.stderr" || true
  return 1
}

run_capture \
  'railway link' \
  "$DIAG_DIR/link.json" \
  railway link --project "$RAILWAY_PROJECT_ID" "${ENV_ARGS[@]}" "${SERVICE_ARGS[@]}" --json || true

run_capture \
  'railway status' \
  "$DIAG_DIR/status.json" \
  railway status --json || true

run_capture \
  'railway service status' \
  "$DIAG_DIR/service-status.json" \
  railway service status "${SERVICE_ARGS[@]}" "${ENV_ARGS[@]}" --json || true

run_capture \
  'railway deployment logs' \
  "$DIAG_DIR/deployment-logs.jsonl" \
  railway logs "${SERVICE_ARGS[@]}" "${ENV_ARGS[@]}" --latest --deployment --lines "$LOG_LINES" --json || true

run_capture \
  'railway build logs' \
  "$DIAG_DIR/build-logs.jsonl" \
  railway logs "${SERVICE_ARGS[@]}" "${ENV_ARGS[@]}" --latest --build --lines "$LOG_LINES" --json || true

run_capture \
  'railway http logs (/health 5xx)' \
  "$DIAG_DIR/http-health-5xx.jsonl" \
  railway logs "${SERVICE_ARGS[@]}" "${ENV_ARGS[@]}" --latest --http --path /health --status '>=500' --lines "$HTTP_LOG_LINES" --json || true

run_capture \
  'railway http logs (all 5xx)' \
  "$DIAG_DIR/http-5xx.jsonl" \
  railway logs "${SERVICE_ARGS[@]}" "${ENV_ARGS[@]}" --latest --http --status '>=500' --lines "$HTTP_LOG_LINES" --json || true

HEALTHCHECK_URL="${RAILWAY_HEALTHCHECK_URL:-}"
if [ -n "$HEALTHCHECK_URL" ]; then
  echo '== direct health probe =='
  HEALTH_STATUS="$(
    curl \
      --connect-timeout "$CONNECT_TIMEOUT_SECONDS" \
      --max-time "$MAX_TIME_SECONDS" \
      -sS \
      -D "$DIAG_DIR/health-headers.txt" \
      -o "$DIAG_DIR/health-body.txt" \
      -w '%{http_code}' \
      "$HEALTHCHECK_URL" || true
  )"
  printf '%s\n' "$HEALTH_STATUS" > "$DIAG_DIR/health-status.txt"
  echo "Health status: ${HEALTH_STATUS:-<curl_failed>}"
  if [ -s "$DIAG_DIR/health-body.txt" ]; then
    sed -n '1,120p' "$DIAG_DIR/health-body.txt" || true
  fi
fi
