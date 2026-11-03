# Drex Max v1 (Nace AI) Decision Model Assimilation & ThumbGate Integration

## 1. Key Ideas Extracted from Drex Max v1 (`marktechpost.com` / `nace-ai/drex-max-v1`)
1. **Decision Model Architecture (Zero Generation, Probabilistic Routing):**
   - Instead of auto-regressive token generation, Drex Max v1 evaluates state (text, JSON, images) plus named options and outputs probabilities for every option in a single forward pass.
   - Ideal for agent routing, ticket triage, and pre-action policy check guardrails.
2. **Dense 27B Parameters with Hybrid Linear/Full Attention:**
   - 64 layers: 48 Gated DeltaNet linear-attention layers (left-to-right) + 16 non-causal full-attention layers (every 4th layer) for global sequence awareness and 262,144 token context window.
3. **Local Apple Silicon & Mac Execution:**
   - Runs locally via MLX or Kapitsa using an affine Q4 checkpoint (~14.45 GB) on 24GB+ Macs, or Q8_0 GGUF on 48GB Macs, matching H100 bf16 precision within 0.02 probability variance.

## 2. System Improvements for ThumbGate & Our Fleet
1. **Drex-Powered Pre-Action Gate Routing:**
   - Integrate Drex Max v1 as an offline local decision model for ThumbGate's `gate_check` and `workflow_sentinel`. Instead of expensive generative LLM reasoning for every tool permission check, use Drex Max's single-pass classification to instantly route or block risky agent actions in milliseconds.
2. **Apple Silicon Local Acceleration:**
   - Leverage local MLX / affine Q4 checkpoints on our Apple Silicon host (`Darwin arm64`) to execute zero-latency policy checks offline without cloud dependencies or data exfiltration risks.

