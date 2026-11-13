---
'thumbgate': patch
---

Integrate 6-pillar NVIDIA Open-Source AI Systems Accelerator (`scripts/nvidia-open-source-accelerator.js`) across `scripts/gates-engine.js`, `scripts/fiddler-control-plane-honesty.js`, `scripts/local-model-profile.js`, and `bin/cli.js`:
- **NeMo Guardrails (Colang 2.0)**: 5-rail deterministic local diode (`input_rail`, `dialog_rail`, `retrieval_rail`, `execution_rail`, `output_rail`) with fail-closed unverified completion claim enforcement (`<0.5ms`, zero cloud egress).
- **NeMo Agent Toolkit**: Multi-agent call-graph profiler with key-order-invariant duplicate tool-call loop detection, parallel-aware critical path latency, and token amplification guardrails.
- **Dynamo & Dynamo-Triton**: KV-cache-aware smart router minimizing $C(w) = \alpha(1 - \text{KV\_hit}_w) + (1 - \alpha)\text{load}_w$ (including $\alpha = 0$ pure queue-load routing) and hardware-honest NIXL disaggregation.
- **NVIDIA Morpheus**: Real-time Sensitive Information Detection (SID), MITRE ATT&CK tactic classification, Digital Fingerprinting (DFP) z-score anomaly detection, and per-agent chronological exfiltration chain quarantine.
- **cuOpt & KAI Scheduler**: Constrained multi-agent model assignment and KAI GPU quota optimizer with per-task latency SLAs and explicit infeasibility detection.
- **TensorRT-LLM & NVIDIA Nemotron**: Fail-closed speculative decoding AL/D roofline & $(G \times (1 + D)) \bmod 128 = 0$ attention tile alignment doctor + Apple Silicon local Nemotron model role routing (`Llama-3.3-Nemotron-Super-49B-v1.5`, `Llama-3.1-Nemotron-Nano-8B-v1`) and 5-dimensional reward scoring.
