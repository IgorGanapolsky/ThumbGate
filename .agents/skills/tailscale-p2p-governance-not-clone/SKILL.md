---
name: tailscale-p2p-governance-not-clone
description: >
  Tailscale PAM and HiveMind (2026-09) are decentralized sync & Zero-Trust network
  formats, not ThumbGate clones. Steal the P2P G-Set CRDT rule sync and PAM privileged
  execution diode onto existing ThumbGate PreToolUse rails; never vendor HiveMind,
  require root SSH, or expose public broker endpoints. Slash: /tailscale-p2p-governance-not-clone.
---

# Tailscale P2P Governance — compare, do not clone

## Goal

Provide zero-trust, peer-to-peer synchronization of agent prevention rules, thumbs feedback, and privileged action diodes across multi-machine development swarms over a private Tailnet — without external cloud dependencies or centralized coordinator bottlenecks.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Clone HiveMind (`projectmentor/hive-mind`) | Map P2P sync onto ThumbGate's G-Set CRDT prevention rules |
| Depend on external cloud servers for agent memory sync | Keep rule sync peer-to-peer over private Tailnet (WireGuard) |
| Require root SSH access or passwordless sudo across nodes | Enforce local PreToolUse diodes on each node independently |
| Transmit raw un-redacted secret blobs across the mesh | Enforce secret-deny redaction before any P2P sync |
| Allow unauthenticated peers to inject prevention rules | Verify Tailscale node identity & cryptographic receipts |
| Claim 100% cloud elimination without local doctor proof | Run `node scripts/tailscale-p2p-doctor.js --json` |

HARD fail closed. REFUSE unverified sync brokers.

## Architectural Steal

1. **FORMAT Steal from HiveMind:**
   - Append-only journal.
   - G-Set CRDT (monotonically growing set of prevention rules).
   - Local-first, decentralized replication over private Tailnet.
2. **FORMAT Steal from Tailscale PAM:**
   - Network layer (Tailscale PAM): controls host-to-host and infrastructure access.
   - Execution layer (ThumbGate PreToolUse): controls agent command/tool invocation before execution.

## Verification & Usage

```bash
# Verify local Tailscale P2P governance status
node scripts/tailscale-p2p-doctor.js --json

# Run unit tests
npm test -- tests/tailscale-p2p-adapter.test.js
```

## References

- Tailscale September 2026 Newsletter (`tailscale.pdf`)
- `adapters/tailscale/TAILSCALE.md`
- `scripts/tailscale-p2p-doctor.js`
- https://tailscale.com/community/community-projects
