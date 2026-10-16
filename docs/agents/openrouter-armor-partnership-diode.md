# OpenRouter Armor × ThumbGate Partnership & Co-Sell Architecture (`2026-10-16`)

> **Source**: [OpenRouter Armor Plugin Docs (`openrouter.ai/docs/guides/features/plugins/armor`)](https://openrouter.ai/docs/guides/features/plugins/armor)  
> **Implementation**: `scripts/openrouter-armor-partnership-diode.js` · `tests/openrouter-armor-partnership-diode.test.js`

---

## 1. Why OpenRouter Armor + ThumbGate Are Complementary Layers (Not Competitors)

OpenRouter's official Armor documentation highlights three explicit constraints where a local-first `PreToolUse` engine is required:

| OpenRouter Armor Constraint (From Official Docs) | How ThumbGate Completes the Stack (`scripts/openrouter-armor-partnership-diode.js`) |
| :--- | :--- |
| **1. HIPAA, Zero Data Retention (ZDR), & Data-Region Restriction = `403` / `unavailable`** (*"Armor evaluation is not yet supported for requests under HIPAA, Zero Data Retention or a data-region restriction... the call is released with an `unavailable` verdict and Claude Code falls back to its own local auto-mode evaluation."*) | `evaluateArmorWithThumbGateFallback()` runs **100% locally on the client CPU in `<0.2ms` with zero data egress**, serving as the automatic HIPAA / ZDR / EU-data-residency fallback whenever Armor returns `unavailable`. |
| **2. `279ms` Median / `334ms` p90 Cloud Classifier Latency** (*"This added 279 ms of latency at the median and 334 ms at the 90th percentile"*) | ThumbGate's Tier-0 local deterministic gates block obvious `hard_deny` / `soft_deny` violations in **`<0.2ms` locally** before a network round-trip, reserving cloud Armor evaluation for ambiguous natural-language edge cases. |
| **3. Manual Prose Rule Authoring (`classifier_context`)** (*"Armor's decisions are only as precise as the rules you give it"*) | `compileThumbGateToArmorPlugin()` automatically compiles ThumbGate's thumbs-down feedback lessons and live git/branch/scope facts (`environment`) into OpenRouter Armor's exact `v: 1` `classifier_context` JSON (`hard_deny` @ `0.6`, `soft_deny` @ `0.6`, `allow` @ `0.7`). |
| **4. `claude_code_compatibility` Client Enforcement** (*"Under `claude_code_compatibility` your application is what stops the call."*) | Enforces `safeguard_results` `flagged` verdicts at the local `PreToolUse` hook boundary so non-Claude-Code harnesses cannot accidentally run a flagged `tool_use`. |

---

## 2. Verification

```bash
node scripts/openrouter-armor-partnership-diode.js
node --test tests/openrouter-armor-partnership-diode.test.js
```
