---
"thumbgate": patch
---

Add nvidia-specdecode-al-doctor: fail-closed AL/D speculative-decoding checks using speedup ≤ AL/(1+ρD), attention D=128/G-1, and tile alignment. Extends deepseek-v4-runtime-guardrails + checkpoint-speculative-decoding-acceptance. Process steal from NVIDIA co-design blog — not TensorRT/EAGLE/Model-Optimizer.
