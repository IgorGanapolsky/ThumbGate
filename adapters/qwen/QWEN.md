# Qwen AI & Alibaba Cloud Model Studio Integration Adapter for ThumbGate

Alibaba Cloud Model Studio provides foundation models (**Qwen3.8-Max**, **Qwen3.7-Plus**, **Qwen3.6-Flash**, and **Wan 2.7**) with OpenAI-compatible REST API endpoints (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`).

This is a **high-ROI integration point** for ThumbGate:

- **Vendor-Neutral Governance**: ThumbGate serves as the pre-action reliability firewall regardless of underlying LLM provider.
- **Ultra-Low Cost Infrastructure**: Qwen's Token Plan ($6/mo for 70M+ tokens) lowers cost for heavy background evaluation, RAG distillation, and candidate benchmark loops.
- **Visual & GUI Computer-Use Safety**: Qwen3.7-Plus and Qwen3-VL-Plus agents executing visual tool actions are governed by ThumbGate's `Claw-Style Enterprise Agent` and `Qwen Agent Governance` pre-action gates.

---

## Capabilities & Workload Mapping

| Model | Primary Workload | Context | Cost Class | ThumbGate Gate Strategy |
|:---|:---|:---:|:---:|:---|
| `alibaba/qwen3.8-max` | Long-Trace Review / Autonomous Projects | 200k | Medium | `gate-qwen-model-studio-egress`, `evidence-before-done` |
| `alibaba/qwen3.7-plus` | GUI Interaction / Tool-Use Coding | 128k | Low | `block-unverified-qwen-gui-actions`, `require-review-for-screen-interaction` |
| `alibaba/qwen3.6-flash` | PreTool Gating / Cheap Fast Path | 128k | Low | `gate-qwen-model-studio-egress`, fast-path triage |

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
