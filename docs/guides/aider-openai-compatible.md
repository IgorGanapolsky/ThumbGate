# Aider With OpenAI-Compatible Backends

This repository ships a worktree-safe Aider launcher for OpenAI-compatible model endpoints, plus pinned defaults for Qwen3 and Kimi through OpenRouter or a LiteLLM gateway.

## What Ships

- `.aider.conf.yml` disables auto-commit and file-watching defaults that create avoidable repo churn.
- `.aider.model.settings.yml` defines `qwen3-dev` and `kimi-2.5-dev` with repo-tested sampling defaults.
- `scripts/aider-launch.js` loads local env files, refuses to run from the primary checkout, and launches Aider against the requested backend.
- `scripts/aider-smoke.js` hits the configured `/v1/chat/completions` endpoint with a minimal `pong` prompt for live connectivity checks.
- `scripts/aider-verify.js` runs fast or full verification using temp proof directories so tracked proof artifacts do not churn.

## Env Loading

The launcher loads env in this order:

1. `~/.config/mcp-memory-gateway/aider.env`
2. `.env.aider`
3. `.env.aider.local`
4. existing process env vars

Later sources override earlier ones.

## Direct OpenRouter Defaults

The fastest path is direct OpenRouter with the repo defaults from `.env.aider.example`:

```bash
OPENROUTER_API_KEY=sk-or-...
AIDER_QWEN3_MODEL=qwen/qwen3-coder
AIDER_KIMI_MODEL=moonshotai/kimi-k2-thinking
```

Then launch from a linked worktree:

```bash
npm run aider:qwen3
npm run aider:kimi
npm run aider:architect
```

`aider:architect` launches the architect target with `--architect` enabled.

## LiteLLM Gateway Mode

If you want one stable OpenAI-compatible endpoint in front of OpenRouter or local providers, set the gateway vars:

```bash
AIDER_API_BASE=http://127.0.0.1:4000/v1
AIDER_API_KEY=litellm-master-key
AIDER_QWEN3_GATEWAY_MODEL=qwen3-dev
AIDER_KIMI_GATEWAY_MODEL=kimi-2.5-dev
```

`config/litellm.aider.example.yaml` is a pinned example that maps those aliases to the OpenRouter Qwen3 and Kimi models.

## Verification

Quick verification:

```bash
npm run aider:verify:quick
```

Full repo verification:

```bash
npm run aider:verify:full
```

Live smoke tests against the configured backend:

```bash
npm run aider:smoke:qwen3
npm run aider:smoke:kimi
```

If smoke fails, the script prints the exact provider response body so the failure is attributable to the endpoint or key policy instead of the repo wiring.
