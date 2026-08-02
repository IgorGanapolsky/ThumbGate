# Financial spend control

ThumbGate now provides an ERP-style purchase-order control for supported agent tool adapters. It is a narrow financial interlock, not a bank or a complete ERP.

## Default behavior

A detected purchase, plan change, checkout, transfer, billing action, or similar financial side effect is denied unless all of these are true:

1. The current human message explicitly authorizes a vendor and maximum amount.
2. The PreToolUse event has the same session ID.
3. The adapter supplies a structured `thumbgateSpend` declaration with vendor, amount, currency, and operation.
4. The authorization is less than ten minutes old and has not been superseded by another human message.
5. The requested amount fits inside the remaining authorization.
6. The same committed purchase has not already been reserved.

This gate is an unconditional hard floor. Warn-by-default mode, free-tier block quotas, and the normal operator hotfix bypass do not downgrade it.

## Human purchase order

The authority must come from a UserPromptSubmit event. Suggestions and implied approval do not count.

Accepted example:

```text
I explicitly authorize you to spend up to $100 on Apollo credits.
```

Rejected examples:

```text
We should probably upgrade Apollo.
Go ahead with the best option.
I authorize upgrading Apollo.
```

The last example is rejected because it has no maximum amount.

## Adapter declaration

An action-bearing adapter must expose the proposed financial mutation to ThumbGate before execution:

```json
{
  "tool_name": "Browser",
  "session_id": "session-123",
  "tool_input": {
    "action": "click",
    "description": "Confirm Apollo credit purchase",
    "thumbgateSpend": {
      "vendor": "Apollo",
      "amount": "99.00",
      "currency": "USD",
      "operation": "credit_purchase"
    }
  }
}
```

Adapters that cannot expose this envelope fail closed for detected financial mutations. The declared `operation` is descriptive only: ThumbGate derives checkout-entry versus financial-mutation behavior from the actual tool name and action, so a caller cannot label a purchase as `checkout` to avoid reservation. The declaration is a proposed amount, so high-assurance deployments should also retain provider-side card limits, vendor budgets, and bank controls.

## Ledger and visibility

ThumbGate stores local authorization state in `.thumbgate/spend-authorizations.json` and appends decisions to `.thumbgate/spend-decision-receipts.jsonl`. Parallel reservations use a filesystem lock so two tool calls cannot consume the same authorization concurrently. An allow receipt must persist before the authorization balance is consumed; if the receipt ledger is unavailable, the action is denied and the budget remains unchanged.

Read the current state without creating authority:

```bash
npx thumbgate spend-status
npx thumbgate spend-status --json
```

There is intentionally no agent-facing command that creates a purchase order.

## Security boundary

This control covers actions routed through a ThumbGate PreToolUse hook and recognized by its financial classifier or a supported structured adapter. It does not reverse charges, obtain refunds, independently read a vendor's final settlement amount, or protect a runtime that gives the agent permission to disable or replace the external hook boundary.

For stronger separation, run enforcement outside the agent's writable process boundary and combine ThumbGate with provider-side spend caps. A local agent with the same operating-system privileges as its guardrail cannot be described honestly as impossible to bypass.
