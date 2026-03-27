# ThumbGate

## What This Is

Production-grade RLHF operations for AI coding agents — a plugin that any developer using Claude Code, Codex, Gemini Code, or Amp CLI can install and start capturing feedback, learning from mistakes, and improving agent behavior immediately. Ships as OSS core with a hosted Context Gateway tier for teams.

## North Star

**$100/day after-tax** — sustainable, recurring revenue from the RLHF platform.

That's ~$3,000/month gross (~$3,650/month pre-tax assuming ~18% effective rate).
Path: 104 customers x $29/mo Pro, or mixed (80 x $29 Pro + organic free-to-pro conversion).

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

### Active — v3.0: Commercialization (Cloudflare Workers Architecture)

- [ ] Cloudflare Workers deployment for Pro tier (cloud-synced memories, unlimited usage)
- [ ] Free tier enforcement: 500 memories, 100 retrievals/day limits in local `npx mcp-memory-gateway serve`
- [ ] Stripe billing ($29/mo Pro checkout, API key provisioning)
- [ ] npm package for instant `npx mcp-memory-gateway serve` install
- [ ] Cloud sync API (memories, prevention rules, gate configs)
- [ ] Usage dashboard (memories, retrievals, cache hits, cost savings)
- [ ] Team sharing of prevention rules (Pro)
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

- **Budget**: $5/mo hosting (Cloudflare Workers free tier → $5 paid) + $0 Stripe (free until revenue)
- **No tech debt**: Tests for everything, proof for everything
- **Speed**: First dollar > perfect architecture
- **Plugin-first**: Every platform must have a one-command install story

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Cloudflare Workers over Railway/Fly.io | Edge deployment, generous free tier, global low-latency | — Active |
| Free/Pro split at $29/mo | Free local with limits (500 mem, 100 ret/day) + cloud Pro unlimited | — Active |
| npm package for distribution | `npx mcp-memory-gateway serve` is the universal install | — Pending |
| Plugin-per-platform | Each AI tool gets native install experience | — Pending |

## Current Milestone: v3.1 First Dollar

**Goal:** Publish to every free distribution channel, post marketing content across developer communities, and close the first paying customer ($49 one-time Pro).

**Target features:**
- Submit to 15+ MCP directories (MCP.so, Glama, Smithery, LobeHub, etc.)
- Submit to IDE marketplaces (Cursor Directory, VS Code, JetBrains)
- Post on r/ClaudeCode (8 thread replies + standalone post), Show HN, DEV.to
- Submit to awesome-mcp-servers GitHub lists (5 PRs)
- Verify checkout flow end-to-end ($49 one-time on Railway)
- Track and attribute first conversion

---
*Last updated: 2026-03-18 after v3.1 milestone start*
