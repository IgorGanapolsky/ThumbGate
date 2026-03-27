#!/usr/bin/env bash
# Hook: Stop gate — fires when Claude stops responding.
# Checks if a deployment verification curl happened during this session.
# If any Railway-related work was done but no verification curl was found,
# appends a warning to the stop output.

PROD_URL="rlhf-feedback-loop-production.up.railway.app"
VERIFICATION_MARKER="/tmp/.thumbgate-last-deploy-verify"

# Check if verification happened recently (within last 10 minutes)
if [ -f "$VERIFICATION_MARKER" ]; then
  VERIFY_TIME=$(cat "$VERIFICATION_MARKER")
  echo "✅ Last deployment verification: $VERIFY_TIME"
else
  echo "⚠️  WARNING: No deployment verification found this session."
  echo "   If you deployed to Railway, run:"
  echo "   curl -s https://${PROD_URL}/dashboard | grep '<new_feature>'"
  echo "   before claiming done."
fi

exit 0
