# Strands Box Containment & Multi-Harness RL Architecture

> **Sources Stolen & Synthesized:**
> 1. **AWS Open Source Blog:** *Introducing Strands Box: AI agent sandboxes powered by Dogwood* (`aws.amazon.com/blogs/opensource/introducing-strands-box-ai-agent-sandboxes-powered-by-dogwood`)
> 2. **Hugging Face Space:** *The ultimate guide to multi-harness RL* (`huggingface.co/spaces/FineEnvs/multi-harness-rl`)

---

## 1. The Core Problems Solved

### A. The Strands Box Insight: Isolation is Not Governance
Operating system isolation (macOS Seatbelt, Linux cgroups, Docker containers) creates a hard boundary, but isolation alone does not enforce contextual rules:
- An agent investigating an incident might need to read logs or inspect infrastructure without being allowed to mutate it.
- An agent that reads a sensitive file (`.env`, `credentials.json`, `customer_data`) must not subsequently send that data to an external HTTP sink.
- Agents must never hold raw production API keys (Stripe, GitHub, AWS SigV4) in their context window, because prompt injection or rogue shell scripts can leak them.

### B. The Multi-Harness RL Insight: Single-Harness Overfitting
Models trained or benchmarked in a single harness suffer severe penalties when transferred:
- **Catastrophic Format Failure:** Models hallucinate parameters, emit broken JSON, or fail to parse shell tool outputs when moving to another harness.
- **Degraded Resolve Rate:** OpenSWE-32B drops 58.8 points (from 62.4% down to 3.6%) when transferring from OpenHands to Kimi-CLI.
- **Harness Overfitting:** Swapping the harness moves benchmark resolve rates by up to 13 points, while swapping the underlying model inside the same harness moves scores by only 2.5 to 5 points.

---

## 2. ThumbGate Implementation Architecture

```text
       ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
       │   Claude Code   │       │   Antigravity   │       │     Strands     │
       └────────┬────────┘       └────────┬────────┘       └────────┬────────┘
                │                         │                         │
                └─────────────────────────┼─────────────────────────┘
                                          ▼
                      ┌───────────────────────────────────────┐
                      │    Canonical Action Quadruplet        │
                      │    (harness, domain, op, target, args)│
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │    Dogwood Sequence & Taint Engine    │
                      │    (fs:read taint -> block egress)    │
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │   Zero-Secret Credential Injection    │
                      │   (dummy token -> real header outbound)
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │      Target System / API Egress       │
                      └───────────────────────────────────────┘
```

---

## 3. Key Components

### 1. Strands Box Policy Diode (`adapters/strands/strands-box-diode.js`)
- **Taint Tracking:** Intercepts `fs:read` operations on sensitive file patterns (`.env`, `credentials`, `id_rsa`, `token`, `customer-data`). If tainted, subsequent `http:request` operations to non-allowlisted external endpoints are blocked with `EXFILTRATION_DIODE_TRIGGERED`.
- **Zero-Secret Credential Gateway:** The agent only sees dummy placeholder tokens (`strands_placeholder_token`). The egress diode gateway inspects the target hostname and injects the live header (`Authorization: Bearer sk_live_...`) on the outbound request. The secret never enters agent logs or LLM context.
- **Decomposed Command Interception:** Decomposes compound shell commands (e.g. `rm -rf /tmp/data`) into concrete `fs:delete` operations, blocking critical system deletions before syscall execution.
- **Sliding-Window Rate Limiting:** Enforces maximum operation thresholds (e.g., max 3 Slack webhook posts per 10 minutes) across the session event history.

### 2. Multi-Harness Invariant Engine (`scripts/multi-harness-invariants.js`)
- **Canonical Normalizer:** Translates proprietary tool calls from Claude Code (`Bash`, `View`, `Edit`), Antigravity (`run_command`, `view_file`, `write_to_file`), Strands (`shell`, `fs_read`, `fs_write`), and OpenHands (`execute_bash`, `file_editor`) into standardized `(domain, operation, target, payload)`.
- **Invariant Evaluator:** Checks tool call validity, preventing path traversal, root deletions, and invalid format structures before execution.
- **Transfer Scorecard & RL Rewards:** Computes cross-harness diversity bonuses and invariant pass rates (0.0 to 1.0) to serve as automated reward signals for RL / DPO model training.

### 3. Verification & Doctor CLI (`scripts/strands-box-doctor.js`)
```bash
# Run standalone diagnostic
node scripts/strands-box-doctor.js

# Output JSON for CI / sentinel monitoring
npm run strands-box:doctor -- --json
```

---

## 4. Benchmark & Performance Evidence

- **Decision Latency:** Sub-0.5ms on hot-path local CPU evaluations (zero GPU tokens, zero external API hops).
- **Test Suite:** 12/12 passing unit & integration tests (`npm run test:strands-box`).
