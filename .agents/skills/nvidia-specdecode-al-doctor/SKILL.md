---
name: nvidia-specdecode-al-doctor
description: >
  Fail-closed speculative-decoding AL/D doctor for ThumbGate. Checks speedup ≤
  AL/(1+ρD), attention D=128/G-1, tile alignment, and maps to
  checkpoint-speculative-decoding-acceptance. Steal from NVIDIA co-design blog —
  never clone TensorRT/EAGLE/Model-Optimizer. Slash: /nvidia-specdecode-al-doctor.
---

# NVIDIA Speculative-Decoding AL/D Doctor

## When
Speculative decoding, MTP, EAGLE, draft length, accept length, claimed speedup, SPEED-Bench AL talk.

## Do
```bash
npx thumbgate nvidia-specdecode-al-doctor \
  --speculative-decoding \
  --accept-length=AL \
  --draft-length=D \
  --draft-depth-ratio=ρ \
  --claimed-speedup=X \
  --json
```

Pair with:
```bash
npx thumbgate deepseek-v4-runtime-guardrails \
  --speculative-decoding --accept-length=AL --draft-length=D \
  --draft-depth-ratio=ρ --claimed-speedup=X --cache-coherence-eval --json
```

## Never
- Claim speedup without measured AL
- Ship TensorRT-LLM / Model-Optimizer / EAGLE training clones
- Treat missing AL as a pass
