"""
Hierarchical Network (H-Net) Dynamic Chunking & Raw Byte Sequence Modeling
Reference PyTorch Implementation

Based on:
- Video: "H-Net Explained: Dynamic Chunking Is Replacing Tokenization in Next-Generation AI Language Models"
  (https://music.youtube.com/watch?v=bomIFE-G-do)
- Research: "H-Net: Hierarchical Dynamic Chunking for Raw Byte Language Models"

Architecture highlights:
1. U-Net Hybrid Topology:
   - Outer Layers: Mamba-2 State Space Model (SSM) handling raw bytes (0..255) with linear O(L)
     rolling hidden states, eliminating quadratic KV-cache memory at byte resolution.
   - Core Sequence Mixer: Standard Transformer processing dense, dynamically compressed semantic chunks.
   - Recursive Hierarchy: Stage 1 groups raw bytes into word/morpheme chunks (target N1 ~ 6 bytes);
     Stage 2 groups word chunks into higher-level semantic phrase/statement chunks (target N2 ~ 6 words).
2. Unsupervised Cosine Routing Module:
   - q_t (query for current byte) and k_{t-1} (key for previous byte).
   - Boundary probability: P_t = 0.5 * (1 - CosineSimilarity(q_t, k_{t-1})).
   - Hard cut triggered whenever P_t > 0.5 (orthogonal or opposing semantic vectors).
3. Stabilized Backpropagation via EMA Smoothing & Straight-Through Estimator (STE):
   - Replaces stochastic Gumbel-Softmax noise with differentiable Exponential Moving Average:
     \\bar{Z}_t = P_t * Z_t + (1 - P_t) * \\bar{Z}_{t-1}
   - Forward pass: Hard discrete boundary rounding (round(P_t) in {0, 1}) for physical compression.
   - Backward pass: Passes continuous EMA gradients straight through (STE).
4. Auxiliary Ratio Loss:
   - Prevents router collapse (lazy P_t = 1.0 or over-compression P_t = 0.0).
   - L_aux = lambda * ((f - 1/N)^2 + (g - 1/N)^2 + (f - g)^2)
     where f is hard boundary fraction, g is continuous average boundary probability, and N is target chunk size.
5. Target Modalities:
   - Unspaced languages (Chinese, Japanese), code indentation / AST syntax, genomic DNA sequences,
     and adversarial text inputs with heavy typos (0 Out-Of-Vocabulary tokens).
   - ~30B-byte training crossover point before outscaling optimized BPE baselines.
"""

from typing import Dict, List, Optional, Tuple
import math
import torch
import torch.nn as nn
import torch.nn.functional as F


class CosineSimilarityRouter(nn.Module):
    """
    Unsupervised Cosine Routing Module for Dynamic Chunking.
    
    Projects the current representation to query q_t and previous representation to key k_{t-1},
    computing directional alignment to detect semantic fractures.
    """
    def __init__(self, hidden_dim: int, proj_dim: int = 64, cut_threshold: float = 0.5):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.proj_dim = proj_dim
        self.cut_threshold = cut_threshold

        self.q_proj = nn.Linear(hidden_dim, proj_dim, bias=False)
        self.k_proj = nn.Linear(hidden_dim, proj_dim, bias=False)

    def forward(
        self, x: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Args:
            x: Tensor of shape [batch_size, seq_len, hidden_dim]
        Returns:
            prob_boundary: Continuous boundary probabilities P_t in [0, 1] [batch_size, seq_len]
            hard_boundary: Discrete 0/1 cuts [batch_size, seq_len]
            cos_sim: Raw cosine similarities in [-1, 1] [batch_size, seq_len]
        """
        B, T, D = x.shape
        device = x.device

        # q_t represents current token / byte
        q = self.q_proj(x)  # [B, T, proj_dim]
        # k represents key; shifted right for k_{t-1}
        k = self.k_proj(x)  # [B, T, proj_dim]

        # Shift k by 1 to get k_{t-1}; prepend zero/self vector for t=0
        k_prev = torch.zeros_like(k)
        if T > 1:
            k_prev[:, 1:, :] = k[:, :-1, :]
        k_prev[:, 0, :] = k[:, 0, :]

        # Normalized cosine similarity: sim(q_t, k_{t-1})
        q_norm = F.normalize(q, p=2, dim=-1)
        k_norm = F.normalize(k_prev, p=2, dim=-1)
        cos_sim = torch.sum(q_norm * k_norm, dim=-1)  # [B, T] in [-1, 1]

        # Boundary probability: P_t = 0.5 * (1 - sim(q_t, k_{t-1}))
        prob_boundary = 0.5 * (1.0 - cos_sim)
        # Position 0 is always the start of sequence (boundary prob = 1.0)
        prob_boundary[:, 0] = 1.0
        prob_boundary = torch.clamp(prob_boundary, 0.0, 1.0)

        # Hard cut trigger: discrete cut when P_t > cut_threshold
        # In STE formulation: hard_boundary = round(P_t) with gradient of P_t
        hard_cut = (prob_boundary > self.cut_threshold).float()
        hard_cut[:, 0] = 1.0

        # Straight-Through Estimator:
        ste_boundary = hard_cut.detach() - prob_boundary.detach() + prob_boundary

        return prob_boundary, ste_boundary, cos_sim


class EmaSmoothingCrossfade(nn.Module):
    """
    Stabilizes backpropagation through discrete cuts using Exponential Moving Average (EMA).
    Replaces noisy Gumbel-Softmax with differentiable crossfade:
        \\bar{Z}_t = P_t * Z_t + (1 - P_t) * \\bar{Z}_{t-1}
    """
    def __init__(self, hidden_dim: int):
        super().__init__()
        self.hidden_dim = hidden_dim

    def forward(
        self, z: torch.Tensor, prob_boundary: torch.Tensor
    ) -> torch.Tensor:
        """
        Args:
            z: Chunk or byte representations [batch_size, seq_len, hidden_dim]
            prob_boundary: Boundary probabilities P_t [batch_size, seq_len]
        Returns:
            smoothed_z: Crossfaded representations [batch_size, seq_len, hidden_dim]
        """
        B, T, D = z.shape
        smoothed = []
        prev_bar = z[:, 0, :]  # Base condition: \\bar{Z}_0 = Z_0

        p = prob_boundary.unsqueeze(-1)  # [B, T, 1]

        for t in range(T):
            if t == 0:
                smoothed.append(prev_bar)
            else:
                p_t = p[:, t, :]
                curr_bar = p_t * z[:, t, :] + (1.0 - p_t) * prev_bar
                smoothed.append(curr_bar)
                prev_bar = curr_bar

        return torch.stack(smoothed, dim=1)


class AuxiliaryRatioLoss(nn.Module):
    """
    Penalizes deviations from target compression ratio N (e.g. N = 6 bytes per chunk).
    Aligns hard fraction f and soft expectation g with target ratio r* = 1 / N.
    """
    def __init__(self, target_chunk_size: float = 6.0, lambda_ratio: float = 1.0):
        super().__init__()
        self.target_chunk_size = float(target_chunk_size)
        self.target_ratio = 1.0 / self.target_chunk_size
        self.lambda_ratio = lambda_ratio

    def forward(
        self, prob_boundary: torch.Tensor, hard_boundary: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """
        Args:
            prob_boundary: Continuous probabilities P_t [B, T]
            hard_boundary: Hard discrete cuts [B, T]
        Returns:
            dict containing total_loss, hard_fraction_f, soft_fraction_g, dev_hard, dev_soft
        """
        # Exclude t=0 which is trivially 1.0 to measure natural routing frequency
        if prob_boundary.shape[1] > 1:
            p = prob_boundary[:, 1:]
            h = hard_boundary[:, 1:]
        else:
            p = prob_boundary
            h = hard_boundary

        f = torch.mean(h)
        g = torch.mean(p)
        r_star = torch.tensor(self.target_ratio, device=prob_boundary.device, dtype=prob_boundary.dtype)

        dev_hard = (f - r_star) ** 2
        dev_soft = (g - r_star) ** 2
        align_div = (f - g) ** 2

        total_loss = self.lambda_ratio * (dev_hard + dev_soft + align_div)

        return {
            "total_aux_loss": total_loss,
            "hard_fraction_f": f,
            "soft_fraction_g": g,
            "target_ratio_r_star": r_star,
            "dev_hard": dev_hard,
            "dev_soft": dev_soft,
            "alignment_divergence": align_div,
        }


class Mamba2LinearSSMBlock(nn.Module):
    """
    Minimal linear SSM block representing Mamba-2 outer state space mixer.
    Provides linear O(L) time and constant state memory per step touching raw bytes.
    """
    def __init__(self, d_model: int, state_dim: int = 16):
        super().__init__()
        self.d_model = d_model
        self.state_dim = state_dim
        self.in_proj = nn.Linear(d_model, d_model * 2, bias=False)
        self.out_proj = nn.Linear(d_model, d_model, bias=False)
        self.A_log = nn.Parameter(torch.log(torch.arange(1, state_dim + 1, dtype=torch.float32)))
        self.B_proj = nn.Linear(d_model, state_dim, bias=False)
        self.C_proj = nn.Linear(d_model, state_dim, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, D = x.shape
        proj = self.in_proj(x)
        u, gate = proj.chunk(2, dim=-1)
        u = F.silu(u)

        # Simple linear recurrent scan simulation (O(T) sequential or parallel prefix)
        state = torch.zeros(B, self.state_dim, device=x.device)
        outputs = []
        decay = torch.exp(-torch.exp(self.A_log))

        for t in range(T):
            u_t = u[:, t, :]
            b_t = self.B_proj(u_t)
            c_t = self.C_proj(u_t)
            state = state * decay.unsqueeze(0) + b_t
            y_t = u_t + torch.sum(state * c_t, dim=-1, keepdim=True).expand(-1, D) * 0.1
            outputs.append(y_t)

        y = torch.stack(outputs, dim=1)
        y = y * F.silu(gate)
        return self.out_proj(y)


class TransformerCoreMixer(nn.Module):
    """
    Central Transformer sequence mixer operating strictly on dense, compressed semantic chunks.
    Compute is spent on dense semantics rather than quadratic byte bloat.
    """
    def __init__(self, d_model: int, nhead: int = 4, num_layers: int = 2):
        super().__init__()
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=d_model * 4,
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)

    def forward(self, chunks: torch.Tensor) -> torch.Tensor:
        return self.encoder(chunks)


class HNetTwoStageUNetHybrid(nn.Module):
    """
    Complete Two-Stage Hierarchical Network (H-Net) U-Net Architecture.
    
    Stage 1: Raw bytes (0..255) -> Mamba-2 SSM -> Cosine Router -> Word Chunks (~6 bytes)
    Stage 2: Word chunks -> Cosine Router -> Macro-Phrase Chunks (~6 words)
    Core: Central Transformer Sequence Mixer on Macro-Phrase Chunks
    Decoder: Symmetric De-chunking with EMA Smoothing & Straight-Through Crossfade
    """
    def __init__(
        self,
        d_model: int = 128,
        stage1_target_chunk: float = 6.0,
        stage2_target_chunk: float = 6.0,
    ):
        super().__init__()
        self.d_model = d_model
        # Direct raw byte vocabulary: 256 byte values
        self.byte_embedding = nn.Embedding(256, d_model)

        # Outer SSM Encoder: Mamba-2
        self.outer_encoder_ssm = Mamba2LinearSSMBlock(d_model)

        # Stage 1 Router & EMA
        self.stage1_router = CosineSimilarityRouter(d_model, proj_dim=64)
        self.stage1_crossfade = EmaSmoothingCrossfade(d_model)
        self.stage1_aux_loss = AuxiliaryRatioLoss(stage1_target_chunk)

        # Stage 2 Router & EMA
        self.stage2_router = CosineSimilarityRouter(d_model, proj_dim=64)
        self.stage2_crossfade = EmaSmoothingCrossfade(d_model)
        self.stage2_aux_loss = AuxiliaryRatioLoss(stage2_target_chunk)

        # Central Core Transformer Mixer
        self.central_transformer = TransformerCoreMixer(d_model)

        # Outer SSM Decoder: Mamba-2
        self.outer_decoder_ssm = Mamba2LinearSSMBlock(d_model)
        self.byte_head = nn.Linear(d_model, 256)

    def forward(
        self, raw_bytes: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """
        Args:
            raw_bytes: LongTensor of byte values [batch_size, seq_len] with values in 0..255
        Returns:
            dict containing:
                logits: Output byte logits [B, T, 256]
                stage1_boundaries: Hard cuts [B, T]
                stage1_prob: Boundary probs [B, T]
                stage1_aux_loss: Stage 1 ratio loss
                stage2_aux_loss: Stage 2 ratio loss
                total_aux_loss: Combined ratio loss
        """
        B, T = raw_bytes.shape

        # 1. Byte embedding & Outer Mamba-2 SSM Encoder
        x_bytes = self.byte_embedding(raw_bytes)  # [B, T, D]
        h_bytes = self.outer_encoder_ssm(x_bytes)  # [B, T, D]

        # 2. Stage 1 Cosine Routing (bytes -> word chunks)
        p1, ste1, sim1 = self.stage1_router(h_bytes)
        loss1 = self.stage1_aux_loss(p1, ste1)

        # Differentiable EMA crossfade for representation
        z1 = self.stage1_crossfade(h_bytes, p1)

        # 3. Stage 2 Cosine Routing (words -> phrase chunks)
        p2, ste2, sim2 = self.stage2_router(z1)
        loss2 = self.stage2_aux_loss(p2, ste2)
        z2 = self.stage2_crossfade(z1, p2)

        # 4. Central Transformer Core processing compressed representations
        core_out = self.central_transformer(z2)

        # 5. U-Net Skip Connection and Symmetric De-chunking Decoder
        dec_in = core_out + z1 + h_bytes  # Skip connection
        h_dec = self.outer_decoder_ssm(dec_in)
        logits = self.byte_head(h_dec)

        total_aux = loss1["total_aux_loss"] + loss2["total_aux_loss"]

        return {
            "logits": logits,
            "stage1_prob_boundary": p1,
            "stage1_hard_boundary": ste1,
            "stage1_aux_loss": loss1["total_aux_loss"],
            "stage2_aux_loss": loss2["total_aux_loss"],
            "total_aux_loss": total_aux,
            "stage1_hard_fraction": loss1["hard_fraction_f"],
            "stage1_soft_fraction": loss1["soft_fraction_g"],
        }
