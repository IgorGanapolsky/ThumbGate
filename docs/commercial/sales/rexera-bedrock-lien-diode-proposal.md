Subject: Bedrock lien pipeline diode / F.S. § 162 super-priority clearance

Roman,

Rexera’s 1-page "Clear to Close" risk scorecard replaces 3 hours of manual county portal digging—huge leverage for title companies paying $50–$150/search.

When parsing Florida county official records (Broward, Miami-Dade, Palm Beach) on AWS Bedrock, general LLMs hit three severe statutory edge cases:
1. **NOC vs. Recorded Lien Confusion:** Treating a Notice of Commencement (F.S. § 713.13) as a recorded claim of lien when it’s merely construction evidence.
2. **Super-Priority Code Liens (F.S. § 162.09):** Missing unrecorded daily code enforcement fines that survive foreclosures and tax-deed auctions.
3. **Dual-Clock Freshness Drift:** Treating a real-time API response as recorded proof when the County Clerk's recording index watermark is 48–72 hours behind.

We developed the ThumbGate Florida Title & Lien Encumbrance Engine with a strict two-clock freshness architecture (`retrieved_at` vs. `source_watermark`) and statutory satisfaction pairing.

Here is the deterministic pre-action diode contract that runs in-line on Bedrock tool calls:

```json
{
  "parcelId": "5042-03-01-0020",
  "county": "Broward",
  "clerkWatermarkUtc": "2026-10-04T17:00:00Z",
  "statutoryCategory": "FS_162_MUNICIPAL_CODE",
  "documentType": "ORDER_IMPOSING_FINE",
  "accrualRateDaily": 250.00,
  "pairedSatisfactionFound": false,
  "verdict": "BLOCK_CLOSING",
  "riskRating": "CRITICAL_SUPER_PRIORITY"
}
```

Would you be open to running a 10-folio benchmark comparing your raw Bedrock output against our Florida statutory diode to test edge-case accuracy on municipal payoffs?

Best regards,

Igor Ganapolsky  
Founder & CTO, ThumbGate  
igor@igorganapolsky.com | https://thumbgate.ai  
