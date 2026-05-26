#!/usr/bin/env bash
# Revenue Truth Bootstrap — runs at SessionStart.
# Prints live billing summary so future "are you sure?" loops are unnecessary.
# Never logs secret values; only their presence/absence and the API response.

set -u
set -o pipefail

BILLING_HOST="${THUMBGATE_BILLING_HOST:-https://thumbgate-production.up.railway.app}"
ADMIN_KEY_PRESENT="missing"
STRIPE_KEY_PRESENT="missing"

if [ -n "${THUMBGATE_ADMIN_KEY:-}" ]; then
  ADMIN_KEY_PRESENT="set"
fi
if [ -n "${STRIPE_SECRET:-}" ]; then
  STRIPE_KEY_PRESENT="set"
fi

echo "=== ThumbGate revenue-truth bootstrap ==="
echo "Host: ${BILLING_HOST}"
echo "THUMBGATE_ADMIN_KEY: ${ADMIN_KEY_PRESENT}"
echo "STRIPE_SECRET: ${STRIPE_KEY_PRESENT}"

if [ "${ADMIN_KEY_PRESENT}" = "missing" ]; then
  cat <<'EOF'

NO LIVE REVENUE NUMBERS THIS SESSION.
- THUMBGATE_ADMIN_KEY is not set in this container's environment.
- Set it in the Railway/harness env (not in chat). See:
  .claude/skills/revenue-truth/SKILL.md
- Until then, the agent MUST cite docs/VERIFICATION_EVIDENCE.md with the
  snapshot date and explicitly mark numbers as historical, not current.
EOF
  exit 0
fi

SUMMARY="$(curl -fsS --max-time 8 \
  -H "Authorization: Bearer ${THUMBGATE_ADMIN_KEY}" \
  "${BILLING_HOST}/v1/billing/summary?window=30d" 2>/dev/null || true)"

if [ -z "${SUMMARY}" ]; then
  echo "Billing endpoint did not respond. Treat all revenue numbers as historical until next refresh."
  exit 0
fi

echo ""
echo "Live 30d truth:"
echo "${SUMMARY}" | jq -r '{
  window,
  booked_cents: .revenue.bookedRevenueCents,
  paid_orders: .revenue.paidOrders,
  checkout_starts: .funnel.checkoutStarts,
  visitors: .funnel.uniqueVisitors,
  acquisition: .funnel.acquisitionBySource
}' 2>/dev/null || echo "${SUMMARY}"
