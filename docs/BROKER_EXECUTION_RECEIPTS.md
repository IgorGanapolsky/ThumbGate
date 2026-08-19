# Broker-signed execution receipts

## Split of responsibility

| Role | Owns |
|------|------|
| **Broker** (e.g. aigate) | Provider credentials, Ed25519 signing key, minting receipts |
| **ThumbGate** | Schema, verification, hash-chain ledger, PreToolUse gate |

A receipt an agent can rewrite is **not** evidence. Only signatures from a trusted broker public key count.

A verified receipt proves the broker signed the bound decision. It does **not** prove an independent world-state outcome, and it does not mean a public page or listing is invocable. A `decision: "deny"` receipt is a signed policy decision; it is not proof that the action executed or changed the external world. An unexecuted action has no execution receipt.

## Schema

`config/schemas/broker-execution-receipt.schema.json` (`broker-execution-receipt-v1`)

Bound fields: principal, target (provider/action/resource), decision, idempotencyKey, providerEventId, issuedAt, broker (`kind: "broker"` only), payloadHash, signature, previousReceiptHash, receiptHash.

## Host configuration

```bash
# Mode: off | verify (default) | enforce
export THUMBGATE_BROKER_RECEIPT_MODE=enforce

# Trusted broker public key (PEM) — required for verify/enforce
export THUMBGATE_BROKER_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----..."

# Optional: only on the broker host (never on the agent)
export THUMBGATE_BROKER_SIGNING_KEY="-----BEGIN PRIVATE KEY-----..."
```

Or store keys as JSON under the project feedback dir: `broker-public-keys.json`.

## MCP tools

- `verify_broker_execution_receipt`
- `issue_broker_execution_receipt` (fails without `THUMBGATE_BROKER_SIGNING_KEY`)
- `record_broker_execution_receipt`
- `get_broker_execution_receipts`
- `reconcile_broker_receipt_chain`

## Gate behavior

`evaluateBrokerReceiptGate` runs from `gates-engine`:

- **verify**: if `tool_input.brokerReceipt` is present, it must verify
- **enforce**: high-risk provider actions require a valid receipt
- **off**: no-op

Attach proof as:

```json
{
  "command": "stripe charges create ...",
  "brokerReceipt": { "...signed receipt..." }
}
```

## Local module

`scripts/broker-execution-receipts.js` — issue, verify, ledger, reconcile, gate evaluation.
