# ThumbGate for Agentic Commerce

## The Problem

AI agents are becoming the primary shoppers. Morgan Stanley estimates $190B-$385B in agentic commerce by 2030. Protocols like UCP (Google), ACP (OpenAI), and AMP (Azoma) tell agents *about products*. But no one is telling agents *about their own mistakes*.

Without a feedback loop:
- Agents recommend the wrong product size — again
- Agents violate brand guidelines — no one catches it
- Agents ignore regulatory constraints (FDA/DSHEA) — silently
- Bad recommendations repeat because nothing captures what went wrong

**SEO became ACO. Now ACO needs RLHF.**

## Our System

ThumbGate is the feedback and memory layer for AI shopping agents. It plugs into any MCP-compatible agent (Claude, ChatGPT, Gemini, Copilot) and captures what works and what fails — then prevents the same mistakes from repeating.

```
Agent recommends product → User gives thumbs down → "Wrong size for my space"
                                    ↓
                        ThumbGate captures signal
                                    ↓
                        Prevention rule auto-generated:
                        "NEVER recommend furniture without checking room dimensions"
                                    ↓
                        Next session: agent recalls rule before recommending
```

## How It Fits the Stack

```
┌─────────────────────────────────────────────┐
│  Consumer AI Surface (Gemini, ChatGPT, etc) │
├─────────────────────────────────────────────┤
│  UCP / ACP / AMP — product discovery layer  │
├─────────────────────────────────────────────┤
│  MCP — standardized tool interface          │
├─────────────────────────────────────────────┤
│  ThumbGate — feedback & quality    │  ← US
│  capture, recall, prevention rules          │
├─────────────────────────────────────────────┤
│  A2A / AP2 — agent coordination & payments  │
└─────────────────────────────────────────────┘
```

UCP, ACP, and AMP all support MCP transport. Our server runs as a standard MCP tool alongside commerce endpoints. Zero custom integration.

## Value Propositions

### For Brands (L'Oreal, Unilever, Mars, Beiersdorf)
- **Brand compliance enforcement**: Prevention rules ensure agents never misrepresent products, ingredients, or claims
- **Feedback attribution**: Know which agent interactions lead to returns vs. repeat purchases
- **Continuous improvement**: Agents get measurably better at recommending your products over time

### For Commerce Platforms (Shopify, Etsy, Wayfair)
- **Agent quality scoring**: Thompson Sampling reliability scores per product category
- **Return reduction**: Agents that remember past sizing/compatibility mistakes reduce return rates
- **DPO export**: Training data to fine-tune platform-specific shopping agents

### For Agent Builders (OpenAI, Google, Anthropic ecosystem)
- **Drop-in MCP server**: `claude mcp add rlhf -- npx -y mcp-memory-gateway serve`
- **Protocol-native**: Works with UCP, ACP, AMP without custom adapters
- **Local-first**: No data leaves the merchant's infrastructure

## Competitive Positioning

| | Azoma AMP | Google UCP | OpenAI ACP | ThumbGate |
|---|---|---|---|---|
| Product discovery | Yes | Yes | Yes | No |
| Transaction processing | No | Yes | Yes | No |
| Agent feedback capture | No | No | No | **Yes** |
| Prevention rules | No | No | No | **Yes** |
| Memory persistence | No | No | No | **Yes** |
| Fine-tuning export | No | No | No | **Yes** |

We don't compete with AMP/UCP/ACP. We complete them.

## Market Sizing

- $190B-$385B agentic commerce TAM by 2030 (Morgan Stanley)
- If agent quality improvements reduce return rates by even 1%, that's $1.9B-$3.8B in recovered value
- Every agentic commerce merchant needs this layer — it's horizontal infrastructure

## Integration Path

### Phase 1: MCP Add-on (Today)
Any merchant using UCP/ACP/AMP adds our MCP server. Agents start capturing feedback immediately.

### Phase 2: ACO Quality API
REST API for commerce platforms to query agent reliability scores, prevention rules, and feedback analytics.

### Phase 3: DPO Training Pipeline
Export preference pairs for fine-tuning commerce-specific agent models. This is where the real moat builds.

## Proof Points

- 384 tests, 100% pass rate
- 5 agent adapters: Claude, Codex, Gemini, Amp, Cursor
- npm package: `mcp-memory-gateway`
- Open source: MIT license
- Commercial traction is early; use verification evidence for engineering proof and pilots/orders for market proof

## Call to Action

**For Azoma / ACO ecosystem**: Partner integration — add ThumbGate as the recommended quality layer for AMP merchants.

**For brands**: Pilot program — add feedback capture to your existing agentic commerce setup. Measure agent improvement over 30 days.

**For platforms**: API integration — embed agent quality scoring into your merchant dashboard.

---

Contact: Igor Ganapolsky, CEO
GitHub: https://github.com/IgorGanapolsky/ThumbGate
npm: https://www.npmjs.com/package/mcp-memory-gateway
