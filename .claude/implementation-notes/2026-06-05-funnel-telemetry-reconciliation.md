# 2026-06-05 funnel-telemetry-reconciliation (SPEC ONLY — not implemented)

## Verified facts
- VERIFIED: scripts/billing.js getBusinessAnalytics() trafficMetrics (lines 2221-2235) reads telemetry.visitors.uniqueVisitors / pageViews = ALL web visitors, bots included. Bot/internal/test-excluded counts already exist at telemetry.qualified (= summary.trafficQuality.external) with uniqueVisitors, pageViews, checkoutStarts, uniqueCheckoutStarters.
- VERIFIED: objection reasons already captured. Client (server.js ~2107) sends reason_not_buying w/ reasonCode in {price_unclear,need_more_proof,need_team_plan,not_urgent}. telemetry-analytics aggregates -> telemetry.buyerLoss.reasonsByCode. NOT surfaced in billing summary or revenue-status.
- VERIFIED: revenue-status.js fetches /v1/billing/summary 3x independently (today,30d,lifetime); formatWindowBlock prints each. No monotonicity reconciliation. Anomaly source = visitor counts (telemetry receivedAt, not ledger) + bots + 3 sequential fetches at different wall-clock.
- VERIFIED: server.js /v1/billing/summary handler (8758) just serializes getBillingSummaryLive output -> all fixes can stay in scripts/* (no server.js edit needed). Avoids racing the other session editing server.js.
- VERIFIED: test isolation pattern = _TEST_FUNNEL_LEDGER_PATH / _TEST_REVENUE_LEDGER_PATH (funnel-invariants.test.js). Existing suites: telemetry-analytics-quality.test.js, billing.test.js, revenue-status.test.js, funnel-invariants.test.js.
