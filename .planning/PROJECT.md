# MCP Memory Gateway

## What This Is

Production-grade RLHF operations for AI coding agents — a plugin that any developer using Claude Code, Codex, Gemini Code, or Amp CLI can install and start capturing feedback, learning from mistakes, and improving agent behavior immediately. Ships as OSS core with a hosted Context Gateway tier for teams.

## North Star

**$100/day after-tax** — sustainable, recurring revenue from the RLHF platform.

That's ~$3,000/month gross (~$3,650/month pre-tax assuming ~18% effective rate).
Path: 62 customers × $49/mo Context Gateway, or 25 mixed (20 × $49 + 5 × $299 Enterprise).

## Core Value

Every feature must have tests, pass CI, and produce verification evidence — no tech debt, no placeholders, no unproven claims.

## Requirements

### Validated (v1.0 + v2.0)

- ✓ Feedback capture with schema validation + richContext + inferOutcome
- ✓ Prevention rules from recurring failures
- ✓ Rubric-based scoring with promotion gates
- ✓ JSONL + LanceDB vector storage
- ✓ Thompson Sampling + time-decay + LSTM sequences + diversity tracking
- ✓ RLAIF self-audit + DPO optimizer + meta-policy extraction
- ✓ Budget guard ($10/mo cap) + intent router + policy bundles
- ✓ ContextFS with semantic cache
- ✓ Self-healing monitor + auto-fix workflows
- ✓ Feedback attribution + pre-tool guard
- ✓ Context engine + skill quality tracker
- ✓ Feedback-to-rules + plan gate + inbox reader + memory bridge
- ✓ PyTorch/CSV/action-analysis training export
- ✓ 5 platform adapters (ChatGPT, Claude, Codex, Gemini, Amp)
- ✓ REST API (11 endpoints) + MCP stdio server
- ✓ 314 tests, 12 proof reports, $0 budget spent

### Active — v3.0: Commercialization

- [ ] Dockerfile + hosted deployment (Railway/Fly.io)
- [ ] Stripe billing (checkout, API key provisioning, usage metering)
- [ ] npm package for instant `npx` install
- [ ] Claude Code skill plugin (one-command install)
- [ ] Codex MCP plugin (config.toml ready)
- [ ] Gemini extension plugin (function declarations ready)
- [ ] Amp skill plugin (SKILL.md ready)
- [ ] Landing page with pain→value→demo flow
- [ ] ChatGPT GPT Store listing
- [ ] Claude MCP Hub submission
- [ ] Onboarding docs (5-minute setup guide)

### Out of Scope (v3)

- Enterprise SSO/RBAC (v4)
- Multi-tenant data isolation (v4)
- Custom model fine-tuning service (v4)
- PaperBanana PNG diagrams (Gemini API blocked)

## Context

- Product is at 314 tests, 42 scripts, 12 proof reports
- All adapters exist but none are published to marketplaces
- API server exists but is not deployed anywhere
- No billing integration exists
- No npm package exists

## Constraints

- **Budget**: $5/mo hosting (Railway free tier → $5 starter) + $0 Stripe (free until revenue)
- **No tech debt**: Tests for everything, proof for everything
- **Speed**: First dollar > perfect architecture
- **Plugin-first**: Every platform must have a one-command install story

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Railway over AWS/GCP | Cheapest path to deployed API ($5/mo vs $20+) | — Pending |
| Stripe Token Billing | Auto price-sync across LLM providers, margin control | — Pending |
| npm package for distribution | `npx rlhf-feedback-loop init` is the universal install | — Pending |
| Plugin-per-platform | Each AI tool gets native install experience | — Pending |

## Current Milestone: v3.0 Commercialization

**Goal:** Deploy hosted API, add Stripe billing, publish plugins to all 5 platforms, get first paying customer.

---
*Last updated: 2026-03-04 after v3.0 milestone start*
