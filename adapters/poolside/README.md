# Poolside Pool + ThumbGate

This adapter gives the Pool terminal agent a local ThumbGate MCP server for
retrieving prior failures, evaluating actions, and recording proof-backed
feedback. It uses Pool's documented `mcp_servers` settings shape and pins the
published ThumbGate version so unattended sessions do not drift.

## Install

Merge [`settings.yaml`](./settings.yaml) into
`~/.config/poolside/settings.yaml`, or run:

```bash
pool mcp add thumbgate -- npx --yes --package thumbgate@1.39.0 thumbgate serve
pool mcp get thumbgate
```

Keep Pool's native permissions, sandbox, tool allow/deny rules, and repository
boundaries enabled. Pool's lifecycle hooks are fail-open by design, so a hook
must not be described as a hard security boundary. MCP makes ThumbGate tools
available to Pool; the agent still has to call the gate before a consequential
action unless Pool adds a fail-closed pre-action contract.

## Governed workflow

1. Ask ThumbGate for relevant prior lessons before the first write or command.
2. Evaluate the pending action through safety, business, and client-SLA policy.
3. Use sidecar or simulation mode for new rules; compare `observedDecision`
   without blocking the host action.
4. Promote a rule to live mode only after deterministic replay passes.
5. Keep the action receipt, test output, and resulting Git SHA together.

This is an independent interoperability adapter. It does not imply a Poolside
partnership or endorsement.

## Laguna 2.1 Model Routing & DFlash Speculative Decoding

| Model Tier | Architecture | Best Deployment Surface | Optimal Use Case |
| --- | --- | --- | --- |
| **Laguna S 2.1** | 118B Total / 8B Active (1M ctx) | Hosted API (`pool login` / `https://inference.poolside.ai`) or OpenRouter (`$0.10/M` in, `$0.20/M` out) | Cross-repo refactoring, race-condition auditing, harness self-optimization |
| **Laguna XS 2.1** | 33B Total / 3B Active (256K ctx) | Local (`vLLM` / `MLX` `Laguna-XS-2.1-NVFP4-mlx` / `llama.cpp` `laguna` branch) + `DFlash` | `auto_mode_classifier` (`poolside/laguna-xs-2.1`), rapid test generation, single-file diffs, subagents |

- **2x Throughput with DFlash (`Laguna-S-2.1-DFlash` / `Laguna-XS-2.1-DFlash`):** When serving on `vLLM >= 0.22.0`, the default DeepGEMM MoE backend conflicts with the DFlash speculative draft path. Force the Triton MoE backend and clamp speculative tokens to `7–15`:
  ```bash
  vllm serve poolside/Laguna-XS-2.1-FP8 \
    --speculative-model poolside/Laguna-XS-2.1-DFlash-FP8 \
    --num-speculative-tokens 7 \
    --moe-backend triton \
    --tool-call-parser poolside_v1
  ```
- **Apple Silicon / 24GB+ Unified Memory:** Run `poolside/Laguna-XS-2.1-NVFP4-mlx` locally or `GGUF`/`INT4` via Poolside's `llama.cpp` `laguna` branch (`--spec-draft-n-max 15`).
- **Dual ACP Multiplexing & Editor Injection:** Run `pool acp setup --editor zed` (or `jetbrains`) and enforce OS sandboxing via `{"command": "pool", "args": ["acp", "--sandbox", "required"]}`.
- **Interleaved Thinking & Mid-Turn Steering:** Enable `enable_thinking: true` in `/plan` mode for root-cause analysis, then toggle thinking **off** in `/agent-mode build` to cut latency in half while keeping the 1M context window. Use mid-turn steering (`poolside/session_steer` or `Ctrl+Enter`) to redirect trajectories without aborting, and double-tap `Esc` to rewind.
- **Anti-Reward-Hacking Guardrails:** Block `git log --all --grep *` and `git reflog *` in `tools.shell.deny` so RL-trained coding agents solve regressions directly instead of mining historical commits. Toggle off data sharing on `platform.poolside.ai` for Zero-Data-Retention confidentiality.

## Upstream opportunity

The useful upstream change is a documented fail-closed pre-action hook mode
with explicit timeout behavior. Until that exists, ThumbGate MCP plus Pool's
native permissions is the honest integration boundary.

Pool settings reference: <https://poolsideai.gitbook.io/pool/settings-reference>
