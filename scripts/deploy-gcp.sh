#!/bin/bash
# GSD: Deploy ThumbGate Control Plane to Google Cloud Run (Free Tier + Google AI Ultra Credits)

set -euo pipefail

GCLOUD_BIN="${GCLOUD_BIN:-$(command -v gcloud || echo /opt/homebrew/bin/gcloud)}"
PROJECT_ID="${GCP_PROJECT_ID:-$("$GCLOUD_BIN" config get-value project 2>/dev/null)}"
SERVICE_NAME="${CLOUD_RUN_SERVICE:-thumbgate-control-plane}"
REGION="${CLOUD_RUN_REGION:-us-central1}"

: "${PROJECT_ID:?GCP project is required (set GCP_PROJECT_ID or run gcloud config set project <id>)}"
: "${THUMBGATE_API_KEY:?THUMBGATE_API_KEY is required}"
: "${THUMBGATE_API_KEY_ROTATED_AT:?THUMBGATE_API_KEY_ROTATED_AT is required}"
: "${STRIPE_SECRET_KEY:?STRIPE_SECRET_KEY is required}"
: "${STRIPE_SECRET_KEY_ROTATED_AT:?STRIPE_SECRET_KEY_ROTATED_AT is required}"
: "${STRIPE_WEBHOOK_SECRET:?STRIPE_WEBHOOK_SECRET is required}"
: "${STRIPE_WEBHOOK_SECRET_ROTATED_AT:?STRIPE_WEBHOOK_SECRET_ROTATED_AT is required}"
: "${THUMBGATE_PUBLIC_APP_ORIGIN:?THUMBGATE_PUBLIC_APP_ORIGIN is required}"
: "${THUMBGATE_BILLING_API_BASE_URL:?THUMBGATE_BILLING_API_BASE_URL is required}"

THUMBGATE_FEEDBACK_DIR="${THUMBGATE_FEEDBACK_DIR:-/data/feedback}"
THUMBGATE_GA_MEASUREMENT_ID="${THUMBGATE_GA_MEASUREMENT_ID:-}"
THUMBGATE_GOOGLE_SITE_VERIFICATION="${THUMBGATE_GOOGLE_SITE_VERIFICATION:-}"

BILLING_ENABLED="$("$GCLOUD_BIN" billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || echo false)"
if [ "$BILLING_ENABLED" != "True" ] && [ "$BILLING_ENABLED" != "true" ]; then
  echo "❌ Billing is not active on GCP project '$PROJECT_ID' (billingEnabled=$BILLING_ENABLED)." >&2
  echo "   1. Reopen $0.00-balance billing account 01D89E-C33A2C-E60D6C at https://console.cloud.google.com/billing/01D89E-C33A2C-E60D6C/payment" >&2
  echo "   2. Claim the $390.00 Google AI Ultra Developer Platform credits at https://me.developers.google.com/benefits" >&2
  echo "   3. Link project: $GCLOUD_BIN billing projects link $PROJECT_ID --billing-account=01D89E-C33A2C-E60D6C" >&2
  exit 1
fi

node scripts/deploy-policy.js --profiles=runtime,billing

echo "🚀 Deploying Agentic Control Plane to $REGION (project: $PROJECT_ID, free-tier bounded)..."

"$GCLOUD_BIN" services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project "$PROJECT_ID"
"$GCLOUD_BIN" builds submit --project "$PROJECT_ID" --tag "gcr.io/$PROJECT_ID/$SERVICE_NAME"
"$GCLOUD_BIN" run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --image "gcr.io/$PROJECT_ID/$SERVICE_NAME" \
  --platform managed \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=2 \
  --memory=512Mi \
  --cpu=1 \
  --set-env-vars \
THUMBGATE_API_KEY="$THUMBGATE_API_KEY",\
STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY",\
STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET",\
THUMBGATE_PUBLIC_APP_ORIGIN="$THUMBGATE_PUBLIC_APP_ORIGIN",\
THUMBGATE_BILLING_API_BASE_URL="$THUMBGATE_BILLING_API_BASE_URL",\
THUMBGATE_FEEDBACK_DIR="$THUMBGATE_FEEDBACK_DIR",\
THUMBGATE_GA_MEASUREMENT_ID="$THUMBGATE_GA_MEASUREMENT_ID",\
THUMBGATE_GOOGLE_SITE_VERIFICATION="$THUMBGATE_GOOGLE_SITE_VERIFICATION"

echo "✅ Success! Your Control Plane is live."
"$GCLOUD_BIN" run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)'
