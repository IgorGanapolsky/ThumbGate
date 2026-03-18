#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-IgorGanapolsky/mcp-memory-gateway}"

# Runtime + deploy secrets used by hosted billing and CI.
SECRET_KEYS=(
  GH_PAT
  SENTRY_DSN
  SENTRY_AUTH_TOKEN
  LLM_GATEWAY_BASE_URL
  LLM_GATEWAY_API_KEY
  TETRATE_API_KEY
  RLHF_API_KEY
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  GITHUB_MARKETPLACE_WEBHOOK_SECRET
  RAILWAY_TOKEN
)

VARIABLE_KEYS=(
  RLHF_PUBLIC_APP_ORIGIN
  RLHF_BILLING_API_BASE_URL
  RLHF_FEEDBACK_DIR
  RLHF_GA_MEASUREMENT_ID
  RLHF_GOOGLE_SITE_VERIFICATION
  RAILWAY_PROJECT_ID
  RAILWAY_ENVIRONMENT_ID
  RAILWAY_SERVICE
  RAILWAY_HEALTHCHECK_URL
  RLHF_API_KEY_ROTATED_AT
  STRIPE_SECRET_KEY_ROTATED_AT
  STRIPE_WEBHOOK_SECRET_ROTATED_AT
  GITHUB_MARKETPLACE_WEBHOOK_SECRET_ROTATED_AT
  RAILWAY_TOKEN_ROTATED_AT
  GEMINI_API_KEY_ROTATED_AT
  PERPLEXITY_API_KEY_ROTATED_AT
  X_API_KEY_ROTATED_AT
  X_API_SECRET_ROTATED_AT
  X_ACCESS_TOKEN_ROTATED_AT
  X_ACCESS_TOKEN_SECRET_ROTATED_AT
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

echo "Syncing repo variables to $REPO (only keys present in current environment)..."

for key in "${VARIABLE_KEYS[@]}"; do
  value="${!key:-}"
  if [[ -z "$value" ]]; then
    echo "- skip $key (not set)"
    continue
  fi

  gh variable set "$key" -R "$REPO" --body "$value"
  echo "- set $key"
done

echo "Done."
