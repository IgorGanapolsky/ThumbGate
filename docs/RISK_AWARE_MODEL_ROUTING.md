# Risk-aware model routing

ThumbGate routes complete generation requests between external model tiers. It does not implement a neural Mixture of Experts (MoE): there is no token-level gate, sparse expert layer, capacity factor, expert-weight training, or load-balancing loss.

`scripts/model-tier-router.js` now provides three distinct stages:

1. `recommendExecutionPlan` selects an external tier from task type, context, risk, retries, and local-provider policy.
2. `executeRoutedGeneration` dispatches the request through the selected provider adapter and emits prompt-free route, token, latency, cost, and outcome telemetry.
3. `evaluateRoutingHoldout` compares routed generation against a fixed-model baseline. A caller-supplied deterministic scorer or separately calibrated LLM judge evaluates both outputs; the generation router never judges its own output.

The default runtime supports OpenAI and OpenAI-compatible local endpoints. Other providers register an adapter under their provider or tier name. Cost remains `null` unless the provider or adapter returns a verified cost; ThumbGate does not invent price data.

```js
const {
  executeRoutedGeneration,
  createJsonlTelemetrySink,
} = require('thumbgate/scripts/model-tier-router');

const result = await executeRoutedGeneration(
  { type: 'code-edit', riskLevel: 'medium', contextTokens: 18000 },
  { userPrompt: 'Add validation to this function.' },
  { telemetrySink: createJsonlTelemetrySink('.thumbgate/generation-routes.jsonl') }
);
```

Treat a routing policy as production-ready only after a held-out workload shows acceptable quality regret against a fixed frontier baseline and the recorded cost/latency tradeoff justifies the route.
