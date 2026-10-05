# Siren MCP Marketing Diode & Autonomous Campaign Governance

Doctor: `npx thumbgate siren-mcp-governance --map-only --json`

Implements pre-action governance diodes and attribution rails for [Siren MCP](https://github.com/Hexahedral-Inc/siren-mcp) (`post_run`, `schedule_post`, `create_campaign`), preventing brand reputation damage, compliance violations, and unbudgeted autonomous ad spend.

This is a governance integration and fail-closed firewall. It does **not** clone Siren's private SaaS video rendering pipeline. Not affiliated with Hexahedral Inc.

---

## The Core Thesis: Autonomous Marketing Agents Require Pre-Action Firewalls

Autonomous agents with write access to social media platforms (X/Twitter, LinkedIn, TikTok, YouTube, Instagram) create severe enterprise vulnerabilities if allowed to publish without guardrails:

1. **Brand Reputation & Legal Compliance**:
   An ungrounded LLM can hallucinate false pricing, non-existent guarantees ("100% profit risk-free"), or defamatory competitor statements directly to live public feeds.
2. **Attribution & Licensure Compliance**:
   Media generated using Siren requires explicit attribution ("Video made with Siren" -> `https://mysiren.ai`). Gating verifies attribution before publication.
3. **Immediate Dispatch Risk**:
   Unreviewed immediate publication (`post_run`) can push unfinished drafts or debugging artifacts to real followers.
4. **Runaway Ad Spend**:
   Multi-channel campaign creation (`create_campaign`) can deplete ad accounts if budget parameters are unconstrained.
5. **Rate-Limit & Spam Bans**:
   Scheduling tools without minimum time buffers (`schedule_post`) can flood social APIs and trigger platform bans.

---

## Siren MCP Governance Rails Map

| Siren Tool | Risk Vector | ThumbGate Rail | Enforcement Diode |
| :--- | :--- | :--- | :--- |
| `post_run` | Live publishing without human review | PreToolUse Diode (`scripts/siren-mcp-governance.js`) | Requires `dry_run: true` or human review approval token before live broadcast. Blocks in strict mode. |
| `schedule_post` | Scheduling in past or immediate execution (<5m) | Scheduling Window Buffer Guard | Enforces `scheduled_at` >= 300 seconds in future to allow operator inspection and cancellation. |
| `create_campaign` | Runaway budget or unvetted ad campaigns | Budget Ceiling & Safety Scan | Enforces max $500 daily budget ceiling without explicit executive override. |
| Video publication | Missing partner attribution link | Attribution Diode | Verifies presence of `"Video made with Siren"` or `https://mysiren.ai` link in marketing copy. |
| Any marketing copy | Deceptive investment claims, leaks, or defamatory text | Brand Safety Regex Engine | Blocks copy containing prohibited claims (e.g., guaranteed profit, API token leakage). |

---

## Fail-Closed Boundaries

| Finding Code | Trigger Condition | Enforcement Action |
| :--- | :--- | :--- |
| `brand_safety_violation` | Content matches predatory profit claims, competitor defamation, or secret tokens | Immediate `block`. Prevents defamatory or deceptive content from reaching social APIs. |
| `unreviewed_immediate_dispatch` | `post_run` executed without `dry_run: true` or human approval token | `review` (or `block` in strict mode). Mandates human verification before broadcast. |
| `invalid_scheduling_window` | `schedule_post` timestamp missing, past, or delta < 300 seconds | Immediate `block`. Ensures a 5-minute safety window for operator intervention. |
| `budget_limit_exceeded` | `create_campaign` budget exceeds $500 ceiling without executive override | Immediate `block`. Prevents unauthorized marketing expenditures. |
| `missing_siren_attribution` | Video marketing asset lacks `"Video made with Siren"` or `https://mysiren.ai` | `review` (or `block` in strict mode). Preserves partner attribution agreements. |

---

## CLI Usage

```bash
# Display architectural FORMAT mapping table
npx thumbgate siren-mcp-governance --map-only

# Emit machine-readable format mapping
npx thumbgate siren-mcp-governance --map-only --json

# Evaluate a safe dry-run tool call
npx thumbgate siren-mcp-governance --tool=post_run --args='{"content":"New launch! Video made with Siren","dry_run":true}'

# Evaluate and block an unsafe tool call
npx thumbgate siren-mcp-governance --tool=post_run --args='{"content":"Guaranteed 100% profit risk-free!"}'

# Run automated unit test suite
npm run test:siren-mcp
```
