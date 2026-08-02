# Financial controls

ThumbGate treats money-touching actions as transactions, not advisory risks.
The workflow sentinel and real pre-tool gate fail closed until the following
append-only lifecycle is complete:

1. `create_purchase_requisition` records the vendor, exact USD amount, purpose,
   source-message identifier, authenticated runtime principal, and evidence. It
   also creates a critical human escalation. The caller cannot select or supply
   the requester identity.
2. An independently configured human reviewer approves or rejects that escalation
   through `POST /v1/escalations/{id}/decision`. The agent MCP surface has no
   approval operation, and the requester cannot approve their own request.
3. `reserve_purchase_requisition` creates a short-lived, single-use reservation
   whose vendor, purpose, amount, and source-message identifier match the approved
   request. Only the authenticated runtime principal that created the request can
   reserve or settle it.
4. The economic tool call includes `costUsd`, an explicit positive budget, and:

   ```json
   {
     "financialControl": {
       "requisitionId": "req_...",
       "reservationId": "res_...",
       "actionId": "unique-provider-action-id",
       "vendor": "Example vendor",
       "purpose": "Exact approved purpose",
       "sourceMessageId": "user-message-..."
     }
   }
   ```

5. The pre-tool gate atomically changes the reservation to `authorized` before
   returning allow. A second invocation cannot reuse it, including a parallel or
   retrying invocation.
6. `settle_purchase_requisition` commits actual spend with receipt evidence or
   releases the unused reservation.
7. `reconcile_purchase_ledger` reports totals, stale reservations, projected
   statuses, event-hash mismatches, malformed rows, and broken global hash-chain
   links. A separately written ledger-head checkpoint also detects tail
   truncation.

## Fail-closed rules

- Explicit `$0` cost budgets hard-block spending; zero is never treated as
  missing configuration.
- An economic action without a positive cost estimate and an explicit budget is
  blocked.
- Missing, pending, expired, released, mismatched, or previously committed
  authorizations are blocked.
- A reservation is single-use and is consumed at authorization, not at optional
  post-action settlement.
- Ledger deletion, reordering, malformed rows, event mutation, and disagreement
  with the atomically updated head checkpoint cause the financial path to fail
  closed. This is tamper-evident, not a cryptographic defense against an attacker
  who can rewrite both the ledger and its checkpoint.
- The trusted host should assign a unique `THUMBGATE_RUNTIME_PRINCIPAL_ID` per
  agent runtime when MCP and hook processes must share an approved requisition.
  Without a shared trusted identity, approved execution fails closed.
- Approval and reservation scope must match the execution scope exactly.
- Deterministic financial-control decisions take priority over learned-policy
  predictions, memories, and prompt instructions.

## No-spend operating mode

For a zero-spend operator, pass both `maxCostUsdPerAction: 0` and
`remainingCostUsd: 0`. ThumbGate will refuse card entry, checkout, paid trials,
credit purchases, upgrades, subscriptions, refunds, payouts, and similar
economic mutations. The remediation is to use a zero-cost path, not to weaken
the gate.
