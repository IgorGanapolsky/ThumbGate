---
name: hnet-dynamic-chunking-honesty
description: H-Net Dynamic Chunking (arXiv:2507.07955) architectural steal. Replaces static line/BPE truncation with a 2-stage U-Net hierarchy, O(n) rolling state-space byte de-obfuscation, Unsupervised Cosine Boundary Routing (P_t = 0.5*(1 - cos(q_t, k_{t-1}))), EMA crossfade smoothing + Straight-Through Estimator (STE), and Auxiliary Ratio Loss (N=6). Never vendor mamba-ssm or claim sub-30B-byte training beats BPE. Slash: /hnet-dynamic-chunking-honesty.
---

# H-Net Dynamic Chunking Honesty (`arXiv:2507.07955`)

> **FORMAT Steal — Not a Model Clone.**
> Sources:
> - Paper: [Dynamic Chunking for End-to-End Hierarchical Sequence Modeling (`arXiv:2507.07955`)](https://arxiv.org/abs/2507.07955)
> - Breakdown: [H-Net Explained: Dynamic Chunking Is Replacing Tokenization](https://www.youtube.com/watch?v=bomIFE-G-do)

## What We Steal vs. What We Refuse

| H-Net Concept (`arXiv:2507.07955`) | ThumbGate Production Transfer (`scripts/hnet-dynamic-chunking-honesty.js`) | Anti-Clone Refusal |
|---|---|---|
| **1. U-Net Hybrid Topology & Outer Mamba-2 Byte Layer** | `scanOuterByteStream()` runs a linear $O(n)$ rolling state-space recurrence ($h_t = \alpha h_{t-1} + (1-\alpha)x_t$) over raw UTF-8 bytes, stripping zero-width characters (`\u200B-\u200F`), shell `${IFS}` splinters, and mid-token backslash escapes (`c\at /e\tc/passwd`) before `PreToolUse` evaluation. | Never `pip install mamba-ssm` or `causal-conv1d` inside ThumbGate. |
| **2. Unsupervised Cosine Boundary Routing** | `computeBoundaryProbability(q_t, k_{t-1})` computes $P_t = \frac{1}{2}(1 - \text{CosineSimilarity}(q_t, k_{t-1}))$ and triggers hard semantic cuts at $P_t > 0.5$. | Never use static N-line truncation when shunting noisy build/test logs. |
| **3. EMA Crossfade + Straight-Through Estimator (STE)** | `emaSmoothChunks()` replaces high-variance Gumbel-Softmax with $\bar{Z}_t = P_t Z_t + (1 - P_t)\bar{Z}_{t-1}$; `straightThroughEstimatorStep()` rounds forward cuts to `{0, 1}` while passing continuous gradients straight through. | Never inject stochastic Gumbel noise into deterministic `PreToolUse` gates. |
| **4. Auxiliary Ratio Loss ($N=6$) & 30B-Byte Crossover** | `computeAuxiliaryRatioLoss()` penalizes router collapse ($P_t \to 1$ or $P_t \to 0$) against target compression $N=6$; `evaluateByteCrossoverThreshold()` enforces the 30B-byte training crossover rule. | Never claim byte-level H-Net weight training beats BPE below `30,000,000,000` bytes. |

## Verification Command

```bash
node scripts/hnet-dynamic-chunking-honesty.js --json
node --test tests/hnet-dynamic-chunking-honesty.test.js
```

## PyTorch Reference Implementation (Cosine Router + EMA-STE De-Chunker + Ratio Loss)

For offline weight-training experiments above the 30B-byte regime:

```python
import torch
import torch.nn as nn
import torch.nn.functional as F


class HNetCosineRouterEMASTE(nn.Module):
    """H-Net (arXiv:2507.07955) Unsupervised Cosine Router + EMA-STE De-Chunker."""

    def __init__(self, d_model: int, target_ratio_n: float = 6.0, threshold: float = 0.5):
        super().__init__()
        self.q_proj = nn.Linear(d_model, d_model, bias=False)
        self.k_proj = nn.Linear(d_model, d_model, bias=False)
        self.target_ratio_n = target_ratio_n
        self.threshold = threshold

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        # x: [B, T, D]
        q = F.normalize(self.q_proj(x[:, 1:, :]), dim=-1)
        k_prev = F.normalize(self.k_proj(x[:, :-1, :]), dim=-1)

        # P_t = 0.5 * (1 - CosineSimilarity(q_t, k_{t-1})), with P_0 = 1.0
        cos_sim = (q * k_prev).sum(dim=-1)  # [B, T-1]
        p_rest = 0.5 * (1.0 - cos_sim)
        p_0 = torch.ones((x.size(0), 1), device=x.device, dtype=x.dtype)
        p_t = torch.cat([p_0, p_rest], dim=1)  # [B, T]

        # Straight-Through Estimator (STE): hard binary forward, continuous backward
        hard_cuts = (p_t > self.threshold).to(x.dtype)
        ste_cuts = p_t + (hard_cuts - p_t).detach()

        # EMA Crossfade De-Chunking Upsampler: Z_bar_t = P_t * Z_t + (1 - P_t) * Z_bar_{t-1}
        p_unsq = ste_cuts.unsqueeze(-1)  # [B, T, 1]
        z_bar = torch.zeros_like(x)
        z_prev = x[:, 0, :]
        z_bar[:, 0, :] = z_prev
        for t in range(1, x.size(1)):
            p_step = p_unsq[:, t, :]
            z_prev = p_step * x[:, t, :] + (1.0 - p_step) * z_prev
            z_bar[:, t, :] = z_prev

        # Auxiliary Ratio Loss (penalizes deviation from target compression N)
        f = hard_cuts.mean(dim=-1)  # hard fraction
        g = p_t.mean(dim=-1)        # continuous mean probability
        n = self.target_ratio_n
        target_frac = 1.0 / n
        ratio_loss = ((f - target_frac) ** 2 + (g - target_frac) ** 2).mean()

        return {
            "z_bar": z_bar,
            "p_t": p_t,
            "hard_cuts": hard_cuts,
            "ste_cuts": ste_cuts,
            "ratio_loss": ratio_loss,
        }
```
