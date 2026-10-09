# Fiddler AI Control Plane Honesty (FORMAT steal)

> Source: [https://www.fiddler.ai/](https://www.fiddler.ai/) — *The Control Plane for Enterprise AI Agents*

## Overview

Fiddler AI positions as the "AI Control Plane for Enterprise AI Agents", securing $30M Series C funding to provide inline guardrails, continuous evaluations, and observability. Their core enterprise narrative centers on three pillars:

1. **Inline Policy Enforcement at the Request/Response Path:** Stopping violations before data leaves the network or damages downstream systems (claiming "under 80ms").
2. **Eliminating the "Evaluation Trust Tax":** Exposing the hidden cost of competitors (LangSmith, Arize, Braintrust, Datadog) who charge customers for calling external LLM APIs (GPT-4o / Claude) to evaluate every single agent trace.
3. **The Two-Layer Control Plane:** Spanning both the **Creation Layer** (where coding agents write code) and the **Production Layer** (where autonomous agents execute business tasks).

## Compare, Not Clone (Honesty)

| Dimension | Fiddler AI Approach | ThumbGate Architectural Stolen Rail |
|:---|:---|:---|
| **Enforcement Point** | Inline proxy at request/response path (claims "under 80ms") | `PreToolUse` L7 infrastructure firewall (<0.5ms on local CPU). ThumbGate operates **160x faster** directly inside agent harness before tool syscall. |
| **Evaluation Trust Tax (TCO)** | Calls Fiddler Centor models or charges $0.002/trace SaaS fee | **$0 token cost** via local regexes, vector slab cache, and deterministic state rules. 100% elimination of evaluation trust tax and cloud vendor lock-in. |
| **Two-Layer Scope** | Creation layer (coding agents) + Production layer (enterprise runtime agents) | **Stolen:** Unified dual-layer policy enforcement across developer workstations (Cursor, Claude Code, Antigravity) and production container runtimes (daemons, API workers). |
| **Continuous Learning Loop** | Manual policy authoring in dashboard + continuous eval drift alerts | **Autonomous feedback loop:** user thumbs-down → lesson store → synthesized prevention rules promoted into immutable pre-action gates. |
| **Data Egress & Privacy** | Requires SaaS or VPC deployment with complex Kubernetes infrastructure | **Zero data egress by design;** runs on local developer/server CPU with no network outbound. Air-gapped compliance. |
| **Auditable GRC Compliance** | SaaS audit logs and Forrester/Gartner compliant reporting dashboards | **Cryptographic proof:** Content-addressed SHA-256 receipts with deterministic replay and microsecond latency timestamps. |

## What We Stole (FORMAT Only)

### 1. The Evaluation Trust Tax & TCO Calculator
Calling external LLMs to evaluate agent safety imposes a staggering "Trust Tax" on enterprises:
$$\text{Annual Trust Tax} = N_{\text{traces}} \times (\text{Input Tokens} \times P_{\text{in}} + \text{Output Tokens} \times P_{\text{out}}) \times F_{\text{eval}}$$
For an enterprise running 1,000,000 agent traces/month:
- **LLM-as-a-Judge (GPT-4o-mini / Haiku):** ~$2,880 to $12,000/year in token fees + 1,250ms latency penalty per call.
- **Fiddler Developer SaaS ($0.002/trace):** ~$24,000/year.
- **ThumbGate Local PreToolUse:** **$0.00/year** (evaluated on local CPU in <0.5ms, 160x faster).

### 2. Unified Two-Layer Control Plane Architecture
Enterprise AI risks manifest at two distinct layers:
- **Creation Layer (Developer Workstations):** Coding agents (Claude Code, Cursor, Copilot, Antigravity) executing destructive shell commands, leaking secrets in commits, wiping worktrees, or attempting branch-protection bypasses.
- **Production Layer (Container / Cloud Runtimes):** Background daemons, API workers, and customer-facing agents executing unauthorized database drops, infinite retry loops, or infrastructure halts.
ThumbGate unifies both layers under a single deterministic PreToolUse firewall.

### 3. Centor-Diode Multi-Stage Fast Discriminant Gate
Instead of deploying heavy 8B+ parameter models or slow external proxies, ThumbGate implements the `Centor-Diode`:
- **Stage 1 (Token Boundary & Command Regexes):** `<0.1ms` execution matching destructive syscalls (`rm -rf`, `DROP TABLE`, `git push --force`, `curl | bash`, secret tokens).
- **Stage 2 (Layer-Specific Invariants):** `<0.2ms` execution verifying creation layer worktree isolation (`git add -A` review requirement) and production service protection (`shutdown` interdiction).
- **Stage 3 (Cryptographic Decision Receipt):** Content-addressed SHA-256 hash attesting decision, matched rule, latency, and zero-data-egress verification.

## Commands

```bash
# Print the honest capability comparison matrix
npx thumbgate fiddler-control-plane-honesty --map-only --json

# Calculate Evaluation Trust Tax & annual dollar savings for your workload
npx thumbgate fiddler-control-plane-honesty --tco-calc --monthly-traces=1000000 --json

# Evaluate a tool invocation through the Centor-Diode pre-action firewall
npx thumbgate fiddler-control-plane-honesty --tool-name=Bash --command="rm -rf /Users/data" --json

# Run test verification suite
npm run test:fiddler-control-plane-honesty
```
