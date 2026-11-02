# ThumbGate Specs

This directory consolidates all version-controlled specifications for ThumbGate's
pre-action enforcement gates, API contracts, and compliance attestation artifacts.

## Structure

- `specs/openapi/` — Canonical OpenAPI contract (`openapi.yaml`) defining all
  HTTP API routes with bounded six-block envelopes (request/response/error).
  Adapters (e.g., `adapters/chatgpt/openapi.yaml`) must remain parity with this
  canonical contract. See `tests/openapi-parity.test.js`.

- `specs/conformance/` — Provider attestation and conformance test vectors
  (`provider-attestation/vectors.json`). Machine-readable compliance proof
  artifacts. See `tests/provider-attestation-conformance.test.js`.

- `specs/gates/` — (Planned) Gate program specifications and decision records.

## Edit Policy

All spec changes must reference a Linear ticket or GitHub issue. Spec changes
that alter API contracts or attestation vectors require review and must pass
the full test suite (`npm run test:api`).
