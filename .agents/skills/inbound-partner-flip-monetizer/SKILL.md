---
name: inbound-partner-flip-monetizer
description: Convert inbound newsletter, podcast, Boardy, Substack, LinkedIn, and founder DMs/emails into $0-outbound-spend revenue-share partners and $100/$499 buyers. Use whenever an external founder, creator, or vendor messages Igor for a swap, intro, or pitch.
---

# Inbound Partner-Flip Monetizer ($0 Outbound Spend — They Pay Us)

## Non-Negotiable Rules

1. **Zero Outbound Cash Spend (`outboundCashSpendUsd === 0`):** Never pay for sponsorships, ad slots, external SaaS tiers, or upfront wires.
2. **Reciprocal Distribution Proof First:** When a newsletter/creator (e.g., Substack recommendation swap) has a smaller list or high outbound dilution, require them to add Igor's link first and send a screenshot/URL before adding theirs.
3. **Two-Tier Monetization Hook in Every Reply:**
   - **Direct Purchase / Bundle:** `$100` Founding Tier (`https://thumbgate.ai/go/pro-direct`) or `$499` Managed Workflow Gate Diagnostic (`https://thumbgate.ai/diagnostic`).
   - **Self-Liquidating Partner Cut:** Offer a **50% partner revenue share paid strictly out of net cash collected** in Stripe from customers they bring in first (`0` sales = `$0` payout).
4. **Anti-Bot-Slop Verification (Mandatory):**
   Every generated reply must pass:
   ```bash
   bash /Users/iganapolsky/workspace/projects/secure-yolo/scripts/verify-human-paste-anti-slop.sh check --file <draft.txt>
   ```

## CLI Usage

```bash
node scripts/fast-money-engine.js --partner-flip \
  --name "Mohamed" \
  --publication "AI-Native Founder" \
  --hook "your note on the $100 a night for robot small talk problem when agent loops and RAG calls run unmetered" \
  --out ~/Documents/AI-Agent-Sync/Social-Drafts/partner-reply.txt
```
