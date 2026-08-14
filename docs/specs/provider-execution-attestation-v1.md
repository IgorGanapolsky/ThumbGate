# ThumbGate Provider Execution Attestation v1

**Status:** Open provider-neutral specification  
**Schema:** [`config/schemas/provider-execution-attestation-v1.schema.json`](../../config/schemas/provider-execution-attestation-v1.schema.json)  
**Normative vectors:** [`conformance/provider-attestation/vectors.json`](../../conformance/provider-attestation/vectors.json)  
**Verifier:** [`scripts/provider-attestation-conformance.js`](../../scripts/provider-attestation-conformance.js)  
**Quality evidence:** [`VERIFICATION_EVIDENCE.md`](../../VERIFICATION_EVIDENCE.md)

## Purpose

This contract lets a credential-holding broker, vault, or gateway attest to the result of a provider-side action without giving the AI agent provider credentials. ThumbGate binds the attestation to its pre-action execution receipt and independently verifies the holder's evidence.

The schema and normative synthetic fixtures are free to evaluate. Provider-specific mapping, live audit-surface calibration, adapter implementation, and conformance certification are commercial integration work.

## Canonicalization and signature

1. Remove the top-level `signature` member.
2. Serialize the remaining payload with JSON Canonicalization Scheme, **RFC 8785 JCS**.
3. Compute lowercase hexadecimal SHA-256 over the UTF-8 canonical bytes.
4. Set `signature.payloadHash` to that digest.
5. Sign the UTF-8 bytes of the lowercase digest with Ed25519.
6. Store the Base64 signature in `signature.value`.

These steps are normative. Implementations that sign ordinary `JSON.stringify` output are non-conformant.

## Reconciliation outcomes

| Outcome | Meaning | Timing rule |
|---|---|---|
| `matched` | Provider evidence agrees with the expected action | Requires `eventId` |
| `mismatched` | Provider evidence exists but disagrees | Requires `eventId` |
| `not-yet-visible` | Event is not visible and the window remains open | Retryable only while `observedAt < windowClosesAt` |
| `absent-after-window` | Event remained absent through the full window | Valid only when `observedAt >= windowClosesAt` |

Absence is not mismatch. Eventual consistency must not become a false deny before the provider window closes.

## Window ownership

ThumbGate owns `maxWindowMs` per provider. The credential holder declares the applied `declaredWindowMs`, which must not exceed the maximum, and reports `observedLagMs`. A holder cannot widen the gate's policy until an event appears.

## Running the normative suite

```bash
node scripts/provider-attestation-conformance.js
```

A conforming implementation must produce the expected verdict for every vector and must reproduce `expectedCanonicalPayload` where present.

## Live canaries

Live-provider canaries should measure real audit lag and validate provider adapters. They are deliberately non-normative because provider availability, credentials, and eventual-consistency behavior cannot make the portable conformance suite deterministic.
