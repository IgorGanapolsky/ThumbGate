# NVIDIA Nemotron 3.5 Lightning + NeMo Switchyard

Email (2026-08-11): *New Tools for Agentic AI* — multi-model routing for agents.

## Ideas we steal (high-ROI)

| NVIDIA claim | ThumbGate implementation |
|:---|:---|
| Agents need **more than one model** | `scripts/switchyard-router.js` routes each step across a pool |
| **Nemotron 3.5 Lightning** 30B MoE / **3B active** for specialized always-on tasks | Default pool member for intent / gate / classify |
| **NeMo Switchyard** routes steps + **evaluates** routing algorithms | `routeAgentSteps` + `evaluateRoutingAlgorithm` (fail-closed without evidence) |
| Balance accuracy, efficiency, customization, control | Cost-class scoring + quality/privacy constraints |

## What we do **not** copy

- NVIDIA product identity as ThumbGate’s brand
- Unmeasured “30B MoE sounds cool” theater without baseline metrics
- Neural MoE claim for our router (we are **application-level** routing)

## Usage

```js
const { routeAgentSteps, buildAlwaysOnAgentPlan, evaluateRoutingAlgorithm } = require('../../scripts/switchyard-router');

const plan = routeAgentSteps(buildAlwaysOnAgentPlan({ highVolume: true }));
// steps → Lightning (intent/gate) + Qwen Max (act) + Claude (review) typically

evaluateRoutingAlgorithm({
  baseline: { costUsd: 1.0, qualityScore: 0.9, latencyMs: 2000 },
  candidate: { costUsd: 0.6, qualityScore: 0.91, latencyMs: 1800 },
});
```

```js
const { planAlwaysOnAgent, buildNemotronConfig } = require('./adapters/nvidia');
planAlwaysOnAgent({ riskLevel: 'high' });
buildNemotronConfig({ env: process.env }); // NIM OpenAI-compatible when NVIDIA_API_KEY set
```

## Gates

- `require-multi-model-routing-for-complex-tasks`
- `checkpoint-model-step-routing-decision`
- `recommend-specialized-models-by-task`
- `require-routing-evidence-for-cost-savings`

## Env (optional NIM)

| Variable | Purpose |
|:---|:---|
| `NVIDIA_API_KEY` / `NGC_API_KEY` / `NIM_API_KEY` | NIM API key |
| `NVIDIA_NIM_BASE_URL` | OpenAI-compatible base (default integrate.api.nvidia.com/v1) |
