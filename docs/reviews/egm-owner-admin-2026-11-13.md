# Owner admin Goldfish design review

Target: `docs/designs/owner-admin.md`. Standard: owner-admin-20261113 brief. Review performed before implementation, against f6baec7f5.

Fresh independent subagents with no inherited conversation:
- `egm_design`: persona `~/.claude/plugins/marketplaces/egm/agents/design_critic.md`.
- `egm_readiness`: persona `~/.claude/plugins/marketplaces/egm/agents/implementation_readiness.md`.

| Finding | Severity | Resolution in reviewed specification |
| --- | --- | --- |
| Reused broad revenue totals do not prove exclusion of historical owner/test purchases | Blocker | Billing retains classification evidence, deduplicates and supplies external totals by currency plus excluded/unknown counts; admin uses shared fields only. Historical synthetic fixtures required. |
| Reconciliation catches timeouts/failure as empty data and omits pagination completeness | Major | Shared diagnostics distinguish empty success, unconfigured, timeout, error and incomplete lists. Ledger fallback is partial. |
| Provider/filesystem/concurrency budgets unspecified | Major | Numeric request, page, file, record, response, deadline and concurrency limits; cancellation stops subsequent IO; responsiveness fixtures. |
| Session helper provisions keys/prunes data and caches revoked sessions | Major | Read-only durable identity adapter; no provisioning/pruning; warmed-cache durable revocation and unchanged-store tests. |
| Hosted accounts, free-to-paid joins and expired sessions ambiguous | Major | Explicit sources, join precedence, partition deduplication and current-known coverage; no source migration. |
| Tenant integration deferred beyond acceptance | Major | Require actual tenant-isolation baseline and A/B/root-override regressions before release. |
| Stripe defaults can omit canceled subscriptions and payment identity unclear | Major | status all, charges as payments, inactive catalog records, item arrays and partial refund fields. |
| API routes/query schemas and HEAD undefined | Major | Exact routes, query bounds, owner-only invalid-query handling, HEAD with no collection. |
| Telemetry 204 can include failed ingest | Major | Count only successful persistence; bucket expiry/failed-write/ring-eviction tests. |

The architecture alternatives were evaluated independently. Select a thin collector module with financial classification in billing and identity authority in the server. This resolves the design findings; implementation and tests must prove each requirement before closing the review.

External read-only audit reused: codex owner-admin audit lane p10, `/tmp/thumbgate-owner-admin-independent-audit-20261113.md`. Its anonymous production 404 observation is a baseline, not feature completion.

Fresh recheck: design reviewer reports no unresolved design findings. Readiness corrections specify 60 one-second telemetry buckets with explicit interval precision, charges as the sole payment resource, and stable pagination beyond 500 accounts. Implementation tests remain required.


## Independent implementation review, repair round 1

The parent coordinator supplied eight unique major findings from independent implementation reviewers. The earlier p10 financial audit also identified refund-overlay evidence gaps. The original builder applied the repairs below; independent re-review and headless UI verification remain separate gates.

| Finding | Repair | Regression evidence |
| --- | --- | --- |
| Receipt email masks expanded owner customer | Billing evaluates all email and metadata scopes conservatively and preserves identity evidence in reconciled events | Conflicting receipt/customer and nested-refund tests |
| Missing live email erases ledger evidence | Nonempty ledger identity survives overlay; evidence is unioned and internal/test classifications remain conservative | Existing external order remains external; prior internal evidence cannot become external |
| Timed-out requests release capacity while SDK calls remain active | Shared billing semaphore owns actual provider promises independently of response deadlines | Repeated refresh plus shared analytics stays at two outstanding requests until actual settlement |
| Preflight omits enabled legacy and trial sources | Real loaders and preflight share the source resolver | Oversized merged legacy revenue and trial fallback block collection before synchronous reads |
| Unusable inventory appears as a complete zero | Both unavailable sources yield unavailable/null; partial inventories expose lower-bound known count and unknown complete total | Missing/corrupt/partial source fixtures |
| Free session appears to have an active API key | Separate hasCurrentSession and hasActiveKey | Free-session fixture has session true and active key false |
| Embedded subscription item truncation is inaccessible | Protected subscription-items endpoint, bounded cursor validation and View all prices UI | Two-page price traversal and invalid subscription/cursor fixtures |
| Billing interval count is dropped | Shared UI formatter renders Every 3 months and other interval/count combinations | UI function regression using the actual embedded script |
| Compressed UI and raw monetary units hinder use | HTML/CSS/JS formatted for maintenance; currency formatter honors Stripe charge exponents | USD, JPY, ISK, UGX, KWD and MGA fixtures; source https://docs.stripe.com/currencies |

Measured validation after these repairs: Node 20 owner suite 23/23; combined owner, billing, API-server and telemetry suite 277/277. No production claim follows from these local results. Parent retains headless browser verification, full required checks, independent re-review and tenant-isolation integration.

## Independent re-review and headless verification

Both original independent reviewers rechecked their repaired findings and found no remaining concrete defects in their bounded scopes. Parent verification against the real local API server passed 48 anonymous page/API requests with 404 and no-store, and 15 headless Chromium checks with zero page errors. The browser checks included all resource sections, subscription-item pagination, unavailable providers, desktop/mobile layout, XSS text rendering, non-owner denial and logout revocation. Synthetic fixtures only. The production signed-in owner journey remains unverified under the owner's headless-only instruction.

The current repository has neither the `verify:isolated` npm script nor `tests/isolated-verifier.test.js`; both requested commands report missing. No replacement verifier result is claimed. Existing full-suite, health and proof-pack checks are reported separately.


## Tenant isolation integration

Baseline: tenant-isolation draft PR 5066 at `07eb863e938f286ef0a3bc7df780876ac9ceba9b`, integrated into `feat/owner-admin` in the isolated release clone. GitButler conflict resolution preserves both package test chains/script registrations and both server imports. The owner dispatcher runs before early private-route recursion and project selection. Root resolution and the authorized owner collector explicitly exit tenant scope. The core identity resolver and its customer-scoped routes remain intact. A WeakSet installs the HTTP error observer once per request even through recursive scoped handling.

New integration tests use actual owner/customer HTTP requests and actual scoped handler invocation. They prove owner counts for two distinct accounts, separate A/B customer totals, request-controlled project/root rejection, owner visibility under an inherited A scope, restoration of that frozen A context, no subsequent cross-request leakage, and exactly one error observation from a recursive private route.

Measured on Node 20.20.2 with compatible native dependencies: owner/core focused suites 47/47; owner, feedback-scope, hosted-tenant-isolation, API-server, billing, telemetry, billing-portal and paid-order-attribution suites 315/315. These results cover the integrated source, not merely the original base.

Validation limits: the coordinator's full npm run on the original base exceeded its allowed duration and was stopped; full-suite completion is not claimed. The coordinator's supported-Node quick-start rerun passed 8/8. The configured isolated-verifier command and test file are absent from this repository snapshot. Parent retains coverage/performance/health checks, headless verification, independent integration review, protected delivery and signed-in production verification. No production identity acceptance is claimed.

## Final integrated acceptance

The independent design reviewer performed a bounded review of the tenant-baseline integration and found no actionable defects. Durable owner authorization precedes global collection; customer A/B reads stay partitioned; request-selected roots cannot redirect private reads; inherited scopes restore after collection; recursive dispatch records each response once. The reviewer inspected source; the parent and builder ran the tests.

Against the integrated checkout, the parent repeated 48 anonymous GET/HEAD/OPTIONS checks (all 404 with no-store) and 15 headless Chromium checks (zero page errors). Health is HEALTHY with no required failures, proof-pack metrics/score/report checks pass, and the performance budget suite passes 3/3. Only synthetic fixtures were used. No visible browser or signed-in production session was accessed.


## Updated tenant dispatcher dependency

Tenant dependency advanced to `cfd7d1b453878d788de6cfd0325282f3c1dcdd3f`. The coordinator picked this update into a new unpublished commit above published owner commit `ac62f44e`. Only that new commit's constructor conflict was resolved with GitButler. The upstream unscoped external dispatcher and trusted continuation are preserved; owner dependencies are passed into the inner server constructor, and the owner gate still precedes private-route scoping. No published owner history was rewritten.

Measured validation: 316/316 tests pass on Node 20.20.2 across owner-admin, feedback-scope, hosted-tenant-isolation, API-server, billing, telemetry, billing-portal and paid-order-attribution. This includes the upstream inherited-scope/one-metering regression and the owner cross-tenant/context-restoration regressions.

Coverage limitation supplied by the coordinator: coverage was stopped at exactly 300 seconds after 3712 success markers and no failure markers. It produced no completed coverage percentage. Full-suite and coverage completion remain unclaimed. Signed-in production verification remains unverified. No browser, CDP or production actions were performed for this dependency integration.

The independent reviewer rechecked the final private-dispatch refinement and found no concrete issue. Parent repeated headless UI acceptance (15 checks, zero page errors) and anonymous denial (48/48) on that final source. The previously published owner commit was preserved; the dependency update is a separate integration commit.
