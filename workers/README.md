# ThumbGate — Cloudflare Workers

Paid MCP server for mcp-memory-gateway Pro tier ($49 one-time). Runs on Cloudflare Workers with KV storage and Stripe billing.

## Architecture

- **Compute:** Cloudflare Workers (edge, globally distributed)
- **Storage:** Workers KV (API keys, gate state, memories, feedback)
- **Billing:** Stripe ($49 one-time payment)
- **Protocol:** MCP JSON-RPC 2.0 over HTTP (streamable-http transport)

## Tiers

| Tier | Price | Tools | Rate Limits |
|------|-------|-------|-------------|
| Free | $0 | capture_feedback, recall, feedback_summary, feedback_stats, prevention_rules | 5 calls/day per tool |
| Pro  | $49 one-time | All free tools + construct_context_pack, evaluate_context_pack, export_dpo_pairs, dashboard, generate_skill, list_intents, plan_intent, satisfy_gate | Unlimited |

## Setup

### 1. Prerequisites

```bash
npm install -g wrangler
wrangler login
```

`wrangler` is intentionally kept out of this repository's `package.json` until the current npm advisory set has a clean non-conflicting local release line. Use the global CLI for deploys and `wrangler types`.

### 2. Create KV Namespaces

```bash
wrangler kv namespace create MEMORY_KV
wrangler kv namespace create KEYS_KV
wrangler kv namespace create GATES_KV
```

Copy the namespace IDs into `wrangler.toml`.

### 3. Create Stripe Product

1. Create a product in Stripe Dashboard
2. Add a $49 one-time price
3. Copy the price ID to `STRIPE_PRICE_ID` in `wrangler.toml`
4. Set up a webhook endpoint pointing to `https://your-worker.workers.dev/billing/webhook`
5. Subscribe to event: `checkout.session.completed`

### 4. Set Secrets

```bash
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

### 5. Install and Deploy

```bash
cd workers
npm install
npm run deploy
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/mcp` | MCP JSON-RPC endpoint (tools/list, tools/call) |
| POST | `/billing/checkout` | Create Stripe checkout session |
| POST | `/billing/webhook` | Stripe webhook handler |
| GET | `/health` | Health check |

## MCP Usage

### List tools
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

### Call a free tool (no auth)
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "capture_feedback",
    "arguments": {
      "feedback": "up",
      "context": "Successfully refactored auth module",
      "tags": ["refactoring", "auth"]
    }
  }
}
```

### Call a paid tool (requires API key)
```bash
curl -X POST https://your-worker.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mmg_YOUR_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "dashboard",
      "arguments": {}
    }
  }'
```

## Development

```bash
npm run dev    # Local dev server with wrangler
npm run deploy # Deploy to Cloudflare
npm run tail   # Live logs
npm test       # Type-check the worker package
```

## KV Schema

### KEYS_KV
- `key:{apiKey}` → ApiKeyRecord (customer ID, billing reference, tier, active)
- `billing:{billingReferenceId}` → API key (reverse lookup)
- `customer:{customerId}:apikey` → API key

### MEMORY_KV
- `feedback:{ownerId}:{id}` → FeedbackEntry
- `feedback-index:{ownerId}` → string[] (ordered IDs)
- `memory:{ownerId}:{namespace}:{id}` → MemoryEntry
- `memory-index:{ownerId}:{namespace}` → string[] (ordered IDs)
- `pack:{ownerId}:{packId}` → ContextPack
- `ratelimit:{ownerId}:{action}:{date}` → count (with 24h TTL)

### GATES_KV
- `gate:{ownerId}:{gateId}` → GateState (with TTL)
- `gate-index:{ownerId}` → string[] (gate IDs)
