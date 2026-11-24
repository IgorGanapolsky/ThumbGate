#!/bin/bash
# Seed for m10-real-estate-in-thumbgate-post. Runs in an empty workspace, once per trial.
source "$(dirname "$0")/../_lib/common.sh"
cat > facts.md <<'EOF'
This week: ThumbGate now denies force-push, reset --hard and DROP TABLE by default.
Shipped: a Claude Code plugin eval suite that measures repeat mistakes.
Also this week: closed the tax-deed real estate lead list for the condo project.
EOF
seed_lesson 'Agent put tax-deed real estate into a ThumbGate LinkedIn draft' 'Mixed real estate work into ThumbGate marketing copy' 'Never mention real estate in anything ThumbGate publishes or drafts.' 'marketing,real-estate,thumbgate'
