# ThumbGate Commercialization Strategy

**Decision date:** 2026-07-09 · **Status:** current · **Owner:** CEO/CTO

This document is the source of truth for how ThumbGate protects its value and makes money. It supersedes the "hosted-services moat, permissive everything" framing in earlier `MOAT.md` where the two conflict. See `MOAT.md` for history.

## The question this answers

*"Anyone can `npm install thumbgate` and get the whole engine for free — how do we protect our IP, sell it, and raise money?"*

## The decision (evidence-backed)

**Open-core productization — NOT a license change (yet).**

We keep a free, permissively-licensed core as the adoption engine, and we put the genuinely valuable parts behind a real paywall. We do **not** relicense to FSL/BUSL right now.

### Why not relicense now
- **The enforcement code is already commoditized.** Meta LlamaFirewall, Pipelock, mcp-firewall, reivo-guard are free OSS agent-firewalls. Nobody needs to fork ThumbGate to compete — so a restrictive license defends a threat that barely exists.
- **The moat isn't the code — it's the data + hosted state.** The accumulated, per-org lesson corpus, adapter breadth, and enterprise audit surface are what compounds and what a forker cannot clone. A license doesn't protect those; being server-side does.
- **Timing is backwards.** HashiCorp and Sentry relicensed *after* massive adoption and revenue. ThumbGate has near-zero adoption and $0 revenue. A non-OSI license now adds friction to the one thing we need most — adoption — to protect an asset that isn't under threat.
- **Relicensing stays an option for later**, once there is adoption and revenue worth fencing (the HashiCorp/Sentry playbook). Not now.

### What we're actually giving away for free (and shouldn't)
Today the valuable intelligence ships free and ungated:
- The 5 trained models: `risk-scorer.js` (AdaBoost), `bayes-optimal-gate.js`, `thompson-sampling.js`, `agent-reward-model.js`, `intervention-policy.js`.
- The data-monetization exporters: `export-dpo-pairs.js`, `export-hf-dataset.js`, `export-databricks-bundle.js` — **currently 0 entitlement checks**.
- `license.js` is a bypassable `tg_`/`tg_pro_` prefix check, not real enforcement.

**That** is the giveaway to fix — with a paywall, not a license.

## The open-core split

**FREE / permissive (adoption engine — keep giving it away on purpose):**
- The PreToolUse runtime firewall (`gates-engine.js`, `hook-runtime.js`, `bin/cli.js gate-check`), all adapters, install/wiring, statusline.
- Built-in starter gates (destructive/secrets/force-push) so it visibly works on install.
- Feedback capture + basic auto-promotion, capped (2 captures/day, 3 active rules — already enforced).

**PAID / entitlement-gated (the moat you pay for):**
- The learned models (the "gets smarter from your feedback" intelligence).
- The data exporters (DPO/HF/Databricks — training-ready assets).
- Hosted dashboard, cross-machine sync, org visibility, DPO/HF export, model-hardening advisor.
- Enterprise: SSO, audit log, compliance reporting, adapter coverage SLAs.

## Repricing (fundable tiers)

$19/mo solo is a side-project price — at $19 ARPU you need ~4,400 payers for $1M ARR. The market already pays $500/mo for guardrails and $200–600/dev/mo for the agents. New model:

| Tier | Price | For | Unlocks |
|---|---|---|---|
| **Free / OSS** | $0 | adoption, logos | runtime firewall, adapters, starter gates, capped capture |
| **Team** | **$49–99 / seat / mo** | teams with token-burn pain | learned models, recall/search, hosted sync + dashboard, exporters |
| **Enterprise** | **$25K–75K+ ACV** (intake) | orgs handing agents prod access | SSO, audit log, compliance evidence, adapter SLAs, hosted state |

**The pitch is "token-insurance," not "a $19 guardrail":** one prevented runaway loop (Uber exhausted its 2026 AI budget in 4 months; a 35-eng team hit an $87K April bill) pays for the year.

## The durable moat (what actually defends us)

Not code. In descending order: (1) **accumulated per-org lesson data** — compounds with usage, un-forkable; (2) **hosted state + adapter breadth** — one governance layer across Claude Code / Cursor / Codex / Gemini is switching-cost the platform-native gates can't match; (3) **enterprise audit surface** — immutable record of what every agent was blocked from doing becomes a system-of-record.

## Sequenced roadmap

1. **Paywall (next PR):** replace `license.js` prefix-check with a real signed entitlement (Ed25519 offline verification of a license token: tier + features + expiry, public key bundled, issued by the hosted billing service). Gate the 3 exporters + the learned-model access behind `requireEntitlement()`. Roll out enforcement behind a flag first (`THUMBGATE_ENFORCE_ENTITLEMENTS`) so existing users aren't broken mid-flight.
2. **Reprice** `public/pricing.html` + billing catalog to Team/Enterprise with the token-insurance ROI framing.
3. **Design partners:** land 3–5 teams with visible token-burn pain; instrument tokens-prevented / catastrophic-blocks as the north-star metric.
4. **Enterprise LOI:** one paid pilot at $25K+ ACV.
5. **Then, and only then, consider FSL** to fence the commercial edition once there's adoption + revenue to protect.

## Investor milestones (2026 seed bar)

$300–500K ARR (or a strong sub-$500K story), 15–20%+ MoM, real usage, 3–5 design partners, ≥1 enterprise LOI. Rounds land $1–4M (median ~$2.5M) for 18–24mo runway. The category took **$3.6B** in 2025–26; the coding-agent-native / MCP-security niche took only **~$40M** — the seat is open.

## Sources
COSS Report 2025 (cossreport.com); Linux Foundation/COSSA VC report; Sentry FSL; HashiCorp BUSL → IBM $6.4B (techcrunch.com); Guardrails AI $7.5M seed; Snyk/Invariant, Palo Alto/Protect AI, Check Point/Lakera acquisitions; SoftwareStrategies agentic-AI-security funding (softwarestrategiesblog.com); DX + digitalapplied AI-coding pricing; CRV seed criteria.
