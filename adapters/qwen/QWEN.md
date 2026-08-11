# Qwen / Alibaba Cloud Model Studio — ThumbGate Adapter

Steal the **economics and tiering** of Model Studio (Flash / Plus / Max, Token Plan,
OpenAI-compatible API, text-embedding-v4). **Do not** adopt Alibaba’s agent platform
as identity — ThumbGate remains the pre-action firewall, RAG quality gates, and proof layer.

Base URL (intl OpenAI-compatible):

```text
https://dashscope-intl.aliyuncs.com/compatible-mode/v1
```

## Role map (high-ROI default)

| Workload | Model | Candidate id |
|:---|:---|:---|
| `pretool-gating`, `cheap-fast-path` | `qwen3.6-flash` | `alibaba/qwen3.6-flash` |
| coding / `dashboard-analysis` / context engineering | `qwen3.7-plus` | `alibaba/qwen3.7-plus` |
| `long-trace-review`, claw-style | `qwen3.8-max` | `alibaba/qwen3.8-max` |
| RAG embeddings | `text-embedding-v4` | `alibaba/text-embedding-v4` |

```js
const { resolveQwenRoleRoute, decideHybridQwenRoute } = require('./adapters/qwen');
resolveQwenRoleRoute('pretool-gating');
// → { model: 'qwen3.6-flash', ... }

decideHybridQwenRoute({ sensitive: true, localAvailable: true });
// → local-only (never ship secrets to DashScope without allowCloudOnSensitive)
```

## Env

| Variable | Purpose |
|:---|:---|
| `DASHSCOPE_API_KEY` / `QWEN_API_KEY` | Model Studio key (Keychain / env only) |
| `DASHSCOPE_BASE_URL` | Override base (default intl compatible-mode) |
| `THUMBGATE_QWEN_MODEL` | Force chat model |
| `THUMBGATE_QWEN_ROLE_GATE` etc. | Override per role |
| `THUMBGATE_QWEN_MONTHLY_BUDGET_USD` | Token Plan budget (default 18 = Standard) |
| `THUMBGATE_EMBED_PROVIDER=dashscope` | Enable OpenAI-compatible embeds in `vector-store` |
| `THUMBGATE_QWEN_EMBED_MODEL` | Default `text-embedding-v4` |
| `THUMBGATE_QWEN_EMBED_DIM` / `THUMBGATE_MATRYOSHKA_DIM` | Truncate / request dims |

## LiteLLM / Hermes

```js
const { buildLiteLLMProviderEnv } = require('./adapters/qwen');
buildLiteLLMProviderEnv({ workload: 'cheap-fast-path' });
// OPENAI_BASE_URL + LITELLM_MODEL=openai/qwen3.6-flash (key via DASHSCOPE_API_KEY)
```

## Gates

Enable in project gates:

- `gate-qwen-model-studio-egress` — audit DashScope hosts
- `block-unverified-qwen-gui-actions` — computer-use
- `require-cost-evidence-before-model-upgrade` — no blind Max upgrades
- `require-usage-quota-for-multimodal-operations` — block video/image bill shock

`validateQwenEgressGate` **blocks** when projected spend exceeds monthly budget
unless `hasBudgetApproval` is true.

## Cost proof

```bash
node -e "console.log(require('./scripts/qwen38-max-cost-optimizer').calculateQwenSavingsVsClaude({inputTokensM:10,outputTokensM:2,useTokenPlanPromo:true}))"
node -e "console.log(require('./scripts/qwen38-max-cost-optimizer').recommendQwenTier('pretool-gating'))"
```

## What we deliberately did **not** copy

- HappyHorse / Wan video as default harness lanes
- OpenClaw $0.99 “digital employee” as product identity
- Role-play / moderation vertical SKUs
