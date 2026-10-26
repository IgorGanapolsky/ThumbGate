# Make-Money Autonomous Loop Specification (`make-money` v1 — Elephant SDD)

> **Trigger Phrase:** `"make money"` / `"make money faster"` / `/make-money`
> **Canonical Skill:** `.agents/skills/make-money/SKILL.md` (mirrored to `~/.agents/skills/make-money/SKILL.md` & `.claude/skills/make-money/SKILL.md`)
> **Canonical Command:** `npm run make:money` (`node scripts/fast-money-engine.js --make-money`)
> **North Star Mandate:** Earn **`$100/day`** after-tax profit at **`$0.00` outbound cash spend** (`outboundCashSpendUsd === 0`).

---

## 1. The Problem

When Igor says `"make money"`, agents previously had to piece together 7 separate scripts (`revenue-status.js`, `daily-content-generator.js`, `gumroad-product-publisher.js`, `social-carousel-generator.js`, `thumbgate-24x7-sales-promotion-job.js`, `checkout-recovery.js`, `revenue-observability-dashboard.js`) or ask clarifying questions. Under the **Leave-Work-at-Work Family Sanctuary Mandate** (`humanInterruptionsCount === 0`), `"make money"` must immediately trigger a single deterministic, end-to-end autonomous pipeline with zero babysitting.

---

## 2. The 6-Stage Autonomous Execution Pipeline (`node scripts/fast-money-engine.js --make-money`)

Whenever triggered by `"make money"`, the agent executes all 6 stages in sequence and writes a signed receipt to `.thumbgate/make-money-last-run.json`:

| Stage | Subsystem Executed | Concrete Output / Revenue Action |
| --- | --- | --- |
| **Stage 1: Live Revenue Truth & Funnel Diode** | `scripts/revenue-status.js` + `evaluateFastMoneyFunnelAndTierLadder()` | Queries live Stripe/Railway billing + traffic telemetry, verifies `/go/pro-direct` 1-click Stripe routing, and enforces `$0.00` outbound spend across all 4 tiers (`$9.99`, `$49`, `$100`, `$499`). |
| **Stage 2: 24/7 Inbox Triage, Show HN Partner Discovery & 9-Channel GraphRAG** | `scripts/thumbgate-24x7-sales-promotion-job.js` (`runSalesPromotion24x7Cycle`) | Sweeps non-ECI inbox threads, discovers live Show HN & founder partner targets (`30` targets), writes partner pitch files to `marketing/partner-offers/`, and runs the 9-channel Thompson-Sampling + GraphRAG promotion cycle. |
| **Stage 3: 30 Daily Omnichannel Drafts + 9-Platform Viral Carousels** | `scripts/daily-content-generator.js` + `scripts/social-carousel-generator.js --all-platforms` + `generateViralCarouselDeck()` | Generates `30` platform-tailored posts (`10` platforms × `3` posts) with the full 4-tier money ladder plus `9`-platform carousel JSONs and the `7`-slide verified HTML carousel deck (`overlappingElementsCount === 0`, LinkedIn caption-link adaptation). |
| **Stage 4: Thesys OpenUI Lang Root-First Offer Stream** | `compileOpenUiLangPricingAndCarouselStream()` | Compiles and validates the root-first `OpenUI Lang` 4-tier pricing card stream (`-52.8%` to `-67.1%` fewer tokens than JSON, catalog-bounded, zero `eval`). |
| **Stage 5: Gumroad 4-Product Inventory & Live URL Verification** | `~/Documents/AI-Agent-Sync/Projects/ThumbGate/Gumroad-Products/products.json` | Verifies the live published Gumroad catalog (`yhdbza` `$0.99`, `flyczx` `$0.99`, `odrkon` `$9.99` Playbook, `vcrho` `$49.00` One-Time Corporate-Expense Production Kit). |
| **Stage 6: Freebutter Abandoned Checkout Recovery & Receipt** | `scripts/checkout-recovery.js` (`economicsGate` + `recoverCheckout`) | Verifies `LTV/CAC = 1935x` (`$96.75` contribution vs `$0.05` CAC in `<50ms`) and emits a signed receipt into `.thumbgate/make-money-last-run.json`. |

---

## 3. Alternatives Considered & Rejected

- **Manual Multi-Step Agent Improvisation (Rejected):** Forces the agent to rediscover scripts every session and wastes tokens.
- **Single-Tier `$0.99` Promotion Only (Rejected):** Requires 102 sales/day; our 4-tier ladder (`$9.99` Playbook, `$49` One-Time Expense Bundle, `$100` One-Time Pass, `$499` Diagnostic) hits `$100/day` on 1–2 conversions.
- **Outbound Paid Ads or Upfront Partner Fees (Rejected):** Violates `$0` outbound spend (`outboundCashSpendUsd === 0`).

---

## 4. Detailed Implementation — Every File Enumerated

1. `docs/specs/make-money-autonomous-loop.md` & `obsidian/Make-Money-Spec.md` (mirrored to `~/Documents/AI-Agent-Sync/Projects/ThumbGate/Make-Money-Spec.md`)
2. `.agents/skills/make-money/SKILL.md` (mirrored to `~/.agents/skills/make-money/SKILL.md` & `.claude/skills/make-money/SKILL.md`)
3. `scripts/fast-money-engine.js` (`runMakeMoneyAutonomousLoop` + `--make-money` CLI flag)
4. `package.json` (`"make:money": "node scripts/fast-money-engine.js --make-money"`)
5. `tests/fast-money-engine.test.js` (automated tests for `runMakeMoneyAutonomousLoop`)
