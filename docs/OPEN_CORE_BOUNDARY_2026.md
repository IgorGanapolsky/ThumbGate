# ThumbGate Open-Core Boundary (2026)

## Decision

ThumbGate uses a two-part distribution model:

- `mcp-memory-gateway`: public OSS core on the public npm registry
- `@igorganapolsky/mcp-memory-gateway-pro`: private Pro package on GitHub Packages

## Public Core

The public package may include:

- local-first feedback capture
- lesson storage and retrieval
- prevention rules and gates
- MCP server and public adapters
- basic CLI and OSS docs

The public package must not include a publishable Pro package manifest or a workflow that publishes Pro from the public tree.

## Private Pro

The private Pro package may include:

- premium dashboard runtime
- premium configuration packs
- premium exports and advanced analytics
- private operational helpers for licensed customers

## Hosted Control Plane

The hosted control plane remains the right place for:

- checkout and license issuance
- team sync and org-wide visibility
- telemetry aggregation
- any logic that should not ship to customer machines

## Enforcement Rules

1. Pro package distribution must use a scoped private package name.
2. Public npm publishing must use provenance.
3. Public and private repos must each own their own release workflows.
4. Public repo tests should fail if a dedicated public Pro publish workflow or public Pro package manifest reappears.
