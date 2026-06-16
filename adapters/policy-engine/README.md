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
{
  is_safe: false,
  recommended_action: 'BLOCK',
  threat_level: 'CRITICAL',
  threat_score: 0.7609,
  threat_types: ['instructionOverride']
}
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

## Ethicore / Guardian live API

Use `ethicore-guardian-client.js` when you have a Guardian API key:

```js
const {
  createPolicyEngineGuard,
} = require('./thumbgate-policy-engine-adapter');
const {
  createEthicorePolicyCheck,
} = require('./ethicore-guardian-client');

const guardedTool = createPolicyEngineGuard({
  source: 'ethicore-guardian',
  policyCheck: createEthicorePolicyCheck({
    // Prefer env vars in real usage:
    // ETHICORE_API_KEY, GUARDIAN_API_KEY, or ORACLES_GUARDIAN_API_KEY
  }),
  executeTool: async (input) => dangerousTool(input),
});
```

The client calls:

```text
POST https://api.oraclestechnologies.com/v1/guardian/analyze
Authorization: Bearer <api-key>
Content-Type: application/json
```

Example normalized block proof shape:

```json
{
  "guardian": {
    "is_safe": false,
    "recommended_action": "BLOCK",
    "threat_level": "CRITICAL",
    "threat_score": 0.760895477911048,
    "confidence": 0.7492857142857144,
    "threat_types": ["instructionOverride", "unknown", "unknown"]
  },
  "thumbgate": {
    "decision": "block",
    "allowed": false,
    "blocked": true,
    "approvalRequired": false,
    "severity": "CRITICAL",
    "score": 0.760895477911048,
    "evidenceCount": 7
  },
  "guardProof": {
    "blocked": true,
    "errorCode": "THUMBGATE_BLOCKED",
    "executed": false
  }
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
