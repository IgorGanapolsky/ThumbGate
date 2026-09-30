# Tailscale P2P Governance & Zero-Trust Diode Adapter

> **Format Steal (HiveMind & Tailscale PAM) — Compare, Not Clone**
>
> **Steal from HiveMind (`projectmentor/hive-mind`):** Peer-to-peer decentralized synchronization over a private Tailnet using append-only journals and G-Set CRDTs (Conflict-free Replicated Data Types).
>
> **Steal from Tailscale PAM:** Zero-Trust identity verification and privileged infrastructure diode, pairing network-level WireGuard access control with ThumbGate's tool-level PreToolUse gating.
>
> **Never clone:** Do not clone HiveMind's passive notes-only memory format, do not require root SSH access across nodes, and do not introduce centralized cloud brokers or coordinators.

---

## 1. Problem: The Disconnected Fleet Vulnerability

Autonomous coding agents (Claude Code, Hermes, Codex, Gemini CLI) frequently run across multiple machines in a development team (developer laptops, CI/CD runners, staging servers, and headless devboxes).

In traditional setups:
1. **Isolated Lessons:** When an agent on Developer Mac 1 makes a dangerous mistake (e.g. executing an unvetted `rm -rf`, leaking an API token, or triggering an unsafe database migration) and is corrected via thumbs-down feedback, that prevention rule remains stored locally on Developer Mac 1.
2. **Repeated Failures:** An agent operating on Developer Mac 2 or in a CI runner has zero visibility into that failure and will execute the exact same dangerous mistake.
3. **Cloud Egress Risks:** Routing agent lessons, audit traces, and internal commands through public SaaS databases introduces intellectual property and credential leakage risks.

---

## 2. The Solution: Tailscale Peer-to-Peer Rule Mesh

ThumbGate's Tailscale adapter turns your private Tailnet into a decentralized, encrypted, peer-to-peer governance mesh.

```
 +-----------------------------------------------------------------------+
 |                     Your Private Tailnet (WireGuard)                  |
 |                                                                       |
 |   +--------------------+                    +---------------------+   |
 |   | Developer Node 1   |                    | CI / Runner Node 2  |   |
 |   | 100.x.y.1          |                    | 100.x.y.2           |   |
 |   |                    |                    |                     |   |
 |   | +----------------+ |   P2P Rule Sync    | +-----------------+ |   |
 |   | | ThumbGate      | | <----------------> | | ThumbGate       | |   |
 |   | | PreToolUse     | |  (G-Set CRDT Mesh) | | PreToolUse      | |   |
 |   | +----------------+ |    Port: 9877      | +-----------------+ |   |
 |   |         |          |                    |          |          |   |
 |   |         v          |                    |          v          |   |
 |   | Local Thumbs-Down  |                    | Instant Fleet-Wide  |   |
 |   | "Block destructive |                    | Immunity to the     |   |
 |   |  git push --force" |                    | Same Mistake        |   |
 |   +--------------------+                    +---------------------+   |
 +-----------------------------------------------------------------------+
```

### Architectural Pillars

1. **G-Set CRDT Append-Only Rule Journal:**
   Prevention rules, thumbs-down patterns, and interdiction receipts form an append-only set. Any rule learned by one agent node monotonically converges across all peer nodes without merge conflicts or split-brain states.

2. **Tailscale PAM + PreToolUse Diode:**
   - *Network Layer (Tailscale PAM):* Controls which machines and services the host can reach.
   - *Agent Execution Layer (ThumbGate):* Controls which tools, CLI commands, and flags the agent is allowed to invoke before execution.
   - Together, they form an airtight defense-in-depth perimeter for autonomous agents.

3. **Zero External Cloud Dependency:**
   All communication occurs over point-to-point WireGuard tunnels authenticated by Tailscale machine identities. No third-party servers, cloud databases, or external telemetry required.

---

## 3. Comparison: ThumbGate vs. HiveMind

| Feature | HiveMind (`projectmentor/hive-mind`) | ThumbGate Tailscale Adapter |
| :--- | :--- | :--- |
| **Primary Domain** | Passive shared memory & agent notes | **Active Pre-Action Governance & Infrastructure Firewall** |
| **Enforcement Point** | None (read-only advisory notes) | **PreToolUse Interdiction (blocks bad commands sub-millisecond)** |
| **Sync Content** | Text facts & journal entries | **Deterministic Prevention Rules, Regex Patterns, Thumbs Signals** |
| **Transport** | HTTP on port 9876 + Tailscale SSH | **Authenticated Peer Sync on port 9877 / embedded tsnet** |
| **Access Control** | Peer admission list | **Tailscale PAM + Cryptographic Tool Execution Receipts** |
| **DPO Export** | None | **Direct DPO Training Dataset Generation from Fleet Thumbs** |

---

## 4. Configuration

```toml
# adapters/tailscale/config.toml
[tailscale]
enabled = true
port = 9877
mode = "p2p-mesh"
fail_closed = true
sync_interval_seconds = 60

[crdt]
journal_type = "g-set-append-only"
rules_sync = true
feedback_sync = true
advisory_sync = true

[pam]
enforce_privileged_access = true
audit_interdictions = true
```

---

## 5. Verification & Diagnostics

Run the dedicated health check:
```bash
node scripts/tailscale-p2p-doctor.js --json
```
