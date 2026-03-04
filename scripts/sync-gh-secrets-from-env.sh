#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-IgorGanapolsky/rlhf-feedback-loop}"

# Minimal secret set for autonomous PR merge + optional LLM routing.
SECRET_KEYS=(
  GH_PAT
  SENTRY_DSN
  SENTRY_AUTH_TOKEN
  LLM_GATEWAY_BASE_URL
  LLM_GATEWAY_API_KEY
  TETRATE_API_KEY
)

echo "Syncing secrets to $REPO (only keys present in current environment)..."

for key in "${SECRET_KEYS[@]}"; do
  value="${!key:-}"
  if [[ -z "$value" ]]; then
    echo "- skip $key (not set)"
    continue
  fi

  printf '%s' "$value" | gh secret set "$key" -R "$REPO"
  echo "- set $key"
done

echo "Done."
