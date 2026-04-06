# Gemini: ThumbGate Function Declarations Install

Import the ThumbGate function declarations into your Gemini agent in under 60 seconds.

## One-Command Install (Node.js)

```bash
# Copy declarations to your project
cp adapters/gemini/function-declarations.json .gemini/rlhf-tools.json
```

## Import in Your Agent Code

```javascript
const fs = require('fs');

// Load ThumbGate tool declarations
const rlhfTools = JSON.parse(
  fs.readFileSync('adapters/gemini/function-declarations.json', 'utf8')
);

// Pass to Gemini SDK
const model = genAI.getGenerativeModel({
  model: 'gemini-pro',
  tools: [{ functionDeclarations: rlhfTools.tools }],
});
```

## Available Functions

| Function | Description |
|---|---|
| `capture_memory_feedback` | Capture success/failure feedback — POST `/v1/feedback/capture` |
| `get_reliability_rules` | Retrieve active prevention rules — POST `/v1/feedback/rules` |
| `get_business_metrics` | Retrieve high-level metrics — GET `/v1/billing/summary` |
| `describe_reliability_entity` | Get canonical definitions — GET `/v1/semantic/describe` |

## Point to Your API

Set the base URL in your Gemini function handler:

```javascript
const THUMBGATE_API_URL = process.env.THUMBGATE_API_URL || 'http://localhost:3000';
const THUMBGATE_API_KEY = process.env.THUMBGATE_API_KEY;

async function callRlhfTool(name, params) {
  const endpoints = {
    capture_memory_feedback:    { method: 'POST', path: '/v1/feedback/capture' },
    get_reliability_rules:      { method: 'POST', path: '/v1/feedback/rules' },
    get_business_metrics:       { method: 'GET',  path: '/v1/billing/summary' },
    describe_reliability_entity: { method: 'GET',  path: '/v1/semantic/describe' },
    plan_intent:                { method: 'POST', path: '/v1/intents/plan' },
  };
  const { method, path } = endpoints[name];
  
  const url = new URL(`${THUMBGATE_API_URL}${path}`);
  if (method === 'GET' && params) {
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
  }

  const res = await fetch(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${THUMBGATE_API_KEY}`, 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(params) : undefined,
  });
  return res.json();
}
```

## Requirements

- Google Gemini SDK (`@google/generative-ai`)
- Node.js 18+ or Python 3.9+
- ThumbGate API running (local or hosted)

## Branding Alignment (Google Cloud)

When setting up your Google Cloud Project for this extension:
1.  **Project Name:** Use `mcp-reliability-gateway` or similar. Avoid placeholder names.
2.  **OAuth Consent Screen:**
    - **App Name:** Enter `MCP Reliability Gateway`.
    - **Support Email:** Use your professional email.
    - **Logo:** Use the provided asset in `docs/logo-400x400.png`.

This ensures that the "App Asking for Consent" matches the product name, providing a professional experience for the CEO and users.

## Verify

```bash
node -e "const t = require('./adapters/gemini/function-declarations.json'); console.log('Tools:', t.tools.map(x=>x.name))"
# Expected: Tools: [ 'capture_memory_feedback', 'get_reliability_rules', 'get_business_metrics', 'describe_reliability_entity', ... ]
```
