# Reflection AI `Beam-1.0-501B-A23B` & `Mirror CLI` Steal (`2026-10-16`)

> **Sources**:
> - [Beam is now available — Reflection AI Blog (Oct 16, 2026)](https://reflection.ai/blog/beam-is-available)
> - [Mirror CLI Overview & MCP Docs (`developers.reflection.ai`)](https://developers.reflection.ai/mirror-overview)
> - **Implementation**: `scripts/reflection-beam-steal.js` · `tests/reflection-beam-steal.test.js` · `~/.mirror/mcp/thumbgate.json`

---

## 1. What We Configured & Stole into ThumbGate

| Reflection AI `Beam` / `Mirror CLI` Surface | ThumbGate Integration & Steal |
| :--- | :--- |
| **1. `Mirror CLI` Installed + `~/.mirror/mcp/thumbgate.json` Wired** | Installed `reflection-mirror` (`uv tool install reflection-mirror`) and wrote `~/.mirror/mcp/thumbgate.json` pointing to `adapters/mcp/server-stdio.js` so `mirror` sessions have immediate access to ThumbGate's `gate_check`, `capture_feedback`, and `recall` MCP tools. |
| **2. `mirror --approval-mode auto` PreToolUse Sandbox Diode (`evaluateMirrorCliActionGate`)** | Reflection's docs explicitly warn: *"Approval mode decides what you review. It isn't a sandbox. Approved commands, extensions, and local MCP servers run with your account's full permissions."* `evaluateMirrorCliActionGate()` strips `REFLECTION_API_KEY` and `FIRECRAWL_API_KEY` from subprocess environments, blocks reads of `~/.mirror/reflection_api_key` and `~/.mirror/mcp/credentials/*`, and blocks destructive commands in `<0.5ms`. |
| **3. Verified-Trace Self-Distillation (`filterVerifiedTracesForSelfDistillation`)** | Implements Beam's Figure 5 self-distillation loop — filtering trajectories strictly by deterministic verifier pass (`verifierPassed && exitCode === 0`), zero secret leakage, and token-efficiency ceiling (`maxTokensBudget`) before LoRA training. |
| **4. `Beam-1.0-501B-A23B` (`501B` total / `23B` active MoE, `Apache-2.0`, `1M` context)** | Wired provider config (`https://api.reflection.ai/openai/v1`) for both `Mirror CLI` and `Pi` (`~/.pi/agent/models.json`). |

---

## 2. Verification

```bash
node scripts/reflection-beam-steal.js
node --test tests/reflection-beam-steal.test.js
```
