# Apple Minions (`arXiv:2610.12970`) & Apple Silicon System-One UMA Steal

> **Sources**:
> 1. **Apple Machine Learning Research (`arXiv:2610.12970`, Oct 2026)**: *“Minions: A Dynamic and Distributed Virtual GPU Cloud Built on Idle Apple Silicon Devices”* (Jianhua Li, Yun Xing, Girisha De Silva, Ryan Flint, Kai Yuan, Sean Suchter) — [Paper](https://arxiv.org/html/2610.12970v1) · [Tom's Hardware Coverage](https://www.tomshardware.com/tech-industry/artificial-intelligence/apple-researchers-turn-idle-macs-into-a-virtual-gpu-cloud-with-minions-researchers-say-the-distributed-scheme-could-scale-globally-and-support-model-training)
> 2. **Apple Silicon UMA "System One" Decision Engines**: `Laya-MLX` (`mizorewww/laya-mlx`, 13.4ms single-pass logit scoring on M3 Max), `jev-visual` (multimodal visual logit scoring), and zero-allocation deterministic `PreToolUse` routers (`scripts/apple-minions-idle-compute-steal.js`).

---

## 1. Triage Decision (`ADOPT` / `ADAPT` / `DROP`)

| Category | Mechanism | Decision & Implementation in ThumbGate (`scripts/apple-minions-idle-compute-steal.js`) |
| :--- | :--- | :--- |
| **ADOPT** | **Pull-Based Idle-Mac Executor (`claimNextIdleSubtask`)** | Instead of a push scheduler that fails when a MacBook lid closes or goes to sleep, idle Apple Silicon workers pull discrete subtasks only when `checkAppleSiliconIdleHealth()` confirms `loadRatio <= 0.85`, `freeMemRatio >= 0.05`, and `thermalState === 'nominal'`. |
| **ADOPT** | **Watchdog Lease Recovery (`reclaimExpiredSubtasks`)** | Every leased subtask carries a monotonic `leasedAtMs` + `leaseTtlMs`. If an Apple Silicon node disconnects mid-computation, the watchdog automatically re-queues the subtask for the next healthy node. |
| **ADOPT** | **4-Field Tenant Scope Isolation** | Apple noted that teams worry about sensitive data running on devices outside their group. Every Minion subtask enforces our complete 4-field scope (`entityId`, `projectId`, `processId`, `sessionId`) before a worker can claim it. |
| **ADOPT** | **Single-Pass "System One" UMA Decision Battery (`evaluateSystemOneUmaBattery`)** | Rather than autoregressive token generation ("System Two") or calling cloud `api.typesafe.ai`, we evaluate atomic hazard predicates + `jev-visual` UI confidence in a single parallel pass on Apple Silicon (`<0.1ms`), with **code** owning `route() -> pass | review | block`. |
| **DROP** | **Cloud TypeSafe Jev SDK (`typesafe-sdk`) & Unverified Distributed Training** | Per `typesafe-typed-questions-not-clone`, never install `typesafe-sdk` or let a model emit `permissionDecision`. Per `arXiv:2610.12970`, Minions is strictly for **inference** (embeddings + local Ollama completions + DPO scoring), not internet-wide weight training. |

---

## 2. Verification Commands

```bash
node scripts/apple-minions-idle-compute-steal.js
node --test tests/apple-minions-idle-compute-steal.test.js
```
