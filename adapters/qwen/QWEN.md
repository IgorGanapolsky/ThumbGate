# Qwen AI & Alibaba Cloud Model Studio Integration Adapter for ThumbGate

Alibaba Cloud Model Studio provides foundation models (**Qwen3.8-Max**, **Qwen3.7-Plus**, **Qwen3.6-Flash**, and **Wan 2.7**) with OpenAI-compatible REST API endpoints (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`).

This is a **high-ROI integration point** for ThumbGate:

- **Vendor-Neutral Governance**: ThumbGate serves as the pre-action reliability firewall regardless of underlying LLM provider.
- **Cost-Controlled Infrastructure**: Qwen's Token Plan starts at $6/month and can lower cost for heavy background evaluation, RAG distillation, and candidate benchmark loops. Credits and promotions must be verified before routing because they are not equivalent to a fixed token count.
- **Visual & GUI Computer-Use Safety**: Qwen3.7-Plus and Qwen3-VL-Plus agents executing visual tool actions are governed by ThumbGate's `Claw-Style Enterprise Agent` and `Qwen Agent Governance` pre-action gates.

---

## Capabilities & Workload Mapping

| Model | Primary Workload | Context | Cost Class | ThumbGate Gate Strategy |
|:---|:---|:---:|:---:|:---|
| `alibaba/qwen3.8-max` | Long-Trace Review / Autonomous Projects | 1M | Medium | `gate-qwen-model-studio-egress`, `evidence-before-done` |
| `alibaba/qwen3.7-plus` | GUI Interaction / Tool-Use Coding | 128k | Low | `block-unverified-qwen-gui-actions`, `require-review-for-screen-interaction` |
| `alibaba/qwen3.6-flash` | PreTool Gating / Cheap Fast Path | 128k | Low | `gate-qwen-model-studio-egress`, fast-path triage |

---

## Cost-per-success routing

Do not route on raw token price alone. Use
`recommendQwenByCostPerSuccess()` with task-outcome telemetry from both models.
The router holds the incumbent until each model has at least 20 measured
outcomes, then requires at least 15% lower cost per successful outcome before
recommending Qwen. Token Plan discounts must be passed as a verified multiplier
and are never assumed to be permanent.

This keeps Qwen in shadow mode until ThumbGate has enough idempotent
task-outcome receipts to prove that lower token cost survives retries and
quality differences.

---

## Configuration & Setup

1. Set environment variable:
   ```bash
   export DASHSCOPE_API_KEY="your-model-studio-api-key"
   ```

2. Base URL for OpenAI SDKs / HTTP clients:
   ```
   https://dashscope-intl.aliyuncs.com/compatible-mode/v1
   ```

3. Enable Qwen pre-action gate templates in `.thumbgate/config.json` or `.mcp.json`:
   ```json
   {
     "gates": [
       "gate-qwen-model-studio-egress",
       "block-unverified-qwen-gui-actions"
     ]
   }
   ```
