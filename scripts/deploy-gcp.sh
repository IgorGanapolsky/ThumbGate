#!/bin/bash
# GSD: Deploy RLHF Control Plane to Google Cloud Run

set -euo pipefail

PROJECT_ID=$(gcloud config get-value project)
SERVICE_NAME="rlhf-control-plane"
REGION="us-central1"

: "${RLHF_API_KEY:?RLHF_API_KEY is required}"
: "${RLHF_API_KEY_ROTATED_AT:?RLHF_API_KEY_ROTATED_AT is required}"
: "${STRIPE_SECRET_KEY:?STRIPE_SECRET_KEY is required}"
: "${STRIPE_SECRET_KEY_ROTATED_AT:?STRIPE_SECRET_KEY_ROTATED_AT is required}"
: "${STRIPE_WEBHOOK_SECRET:?STRIPE_WEBHOOK_SECRET is required}"
: "${STRIPE_WEBHOOK_SECRET_ROTATED_AT:?STRIPE_WEBHOOK_SECRET_ROTATED_AT is required}"
: "${RLHF_PUBLIC_APP_ORIGIN:?RLHF_PUBLIC_APP_ORIGIN is required}"
: "${RLHF_BILLING_API_BASE_URL:?RLHF_BILLING_API_BASE_URL is required}"

RLHF_FEEDBACK_DIR="${RLHF_FEEDBACK_DIR:-/data/feedback}"
RLHF_GA_MEASUREMENT_ID="${RLHF_GA_MEASUREMENT_ID:-}"
RLHF_GOOGLE_SITE_VERIFICATION="${RLHF_GOOGLE_SITE_VERIFICATION:-}"

node scripts/deploy-policy.js --profiles=runtime,billing

echo "🚀 Deploying Agentic Control Plane to $REGION..."

gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --set-env-vars \
RLHF_API_KEY="$RLHF_API_KEY",\
STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY",\
STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET",\
RLHF_PUBLIC_APP_ORIGIN="$RLHF_PUBLIC_APP_ORIGIN",\
RLHF_BILLING_API_BASE_URL="$RLHF_BILLING_API_BASE_URL",\
RLHF_FEEDBACK_DIR="$RLHF_FEEDBACK_DIR",\
RLHF_GA_MEASUREMENT_ID="$RLHF_GA_MEASUREMENT_ID",\
RLHF_GOOGLE_SITE_VERIFICATION="$RLHF_GOOGLE_SITE_VERIFICATION"

echo "✅ Success! Your Control Plane is live."
gcloud run services describe $SERVICE_NAME --region $REGION --format='value(status.url)'
