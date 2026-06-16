# Policy Engine Adapter

Policy engines decide whether an action satisfies a rule. ThumbGate turns that decision into a local pre-action boundary before the agent executes the tool call.

Use this adapter when a team already has a governance SDK or policy API, such as:

- OracleTech Guardian SDK / Ethicore-style policy checks
- Open Policy Agent
- AWS Bedrock Guardrails
- Custom compliance, risk, data-loss, or approval services

## Contract

The adapter accepts common decision shapes:

```js
{ decision: 'allow', reason: 'read-only operation' }
{ decision: 'block', reason: 'off-scope network egress', policyId: 'egress-001' }
{ status: 'requires_review', message: 'human approval required' }
{ allowed: false, violations: [{ ruleId: 'prod-db', reason: 'production write' }] }
```

It normalizes them into:

```js
{
  allowed: false,
  blocked: true,
  approvalRequired: false,
  decision: 'block',
  reason: 'off-scope network egress',
  source: 'policy-engine',
  policyId: 'egress-001',
  evidence: []
}
```

## Usage

```js
const {
  createPolicyEngineGuard,
} = require('./adapters/policy-engine/thumbgate-policy-engine-adapter');

const guardedTool = createPolicyEngineGuard({
  source: 'guardian-sdk',
  policyCheck: async (action) => guardian.evaluate(action),
  gateCheck: async ({ normalizedAction, policyDecision }) => thumbgate.evaluate({
    ...normalizedAction,
    policyDecision,
  }),
  executeTool: async (input) => dangerousTool(input),
});
```

## Positioning

This does not replace a policy engine. It makes the policy engine operational for AI agents:

- Policy engine: decides based on a policy model.
- ThumbGate: intercepts the concrete shell, file, MCP, browser, deploy, or API action before it runs.
- Together: policy reasoning plus deterministic local enforcement and audit evidence.
