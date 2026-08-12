# Marketing claims substantiation matrix

Every strong public claim should map to a test, scope, version, and documented
limitation. This matrix is for product, marketing, and counsel — not a
performance warranty.

| Claim | Technical meaning | Evidence hooks | Scope / limitation | Copy guidance |
| --- | --- | --- | --- | --- |
| **Hard allow / deny** | Gate engine can allow or block tool calls / actions | Gate unit/integration tests; enforcement matrix | Requires installed hooks/MCP, matching rules, and often strict mode | Say “hard deny when configured,” not “blocks all unsafe actions” |
| **Warnings vs hard denies** | Checkpoint / warn paths differ from exit-deny | Workflow sentinel / gate mode tests | Customer config chooses severity | Keep the site’s warn vs deny distinction; terms reinforce it |
| **Encrypted pairing** | TLS for hosted pairing / websockets | Server TLS deployment; pairing auth code | Endpoint security still customer’s job | “Encrypted in transit,” not “unbreakable pairing” |
| **Fenced VPS / runner** | Isolated container/runtime for hosted work | Deploy/runtime config; runner docs | Bounded by container isolation; customer audits workloads | Avoid implying hardware-enforced multi-tenant TEE unless true |
| **No double-write / lease** | Single-writer checkout / session lease | `npm run test:session-lease`; lease script | Only if agents honor lease protocol; per-checkout | “Reduces concurrent mutation,” not “impossible to double-write” |
| **Production data** | Metrics from live systems when cited | Stripe/Plausible/health with date | Must be dated and scoped | Never invent revenue or uptime |
| **Proof** | Verification evidence, golden tests, receipts | `docs/VERIFICATION_EVIDENCE.md`, prove scripts | Proof is for named suites/versions | Link evidence; don’t use “proof” as vibes |
| **Self-improving** | Local feedback → lessons → prevention rules | Feedback-to-rules tests; memory lifecycle | **Not** model weight training; not silent autonomous policy without human signal path | Always clarify: local rules from feedback, not LLM retrain |
| **Zero workspace telemetry** | Local engine doesn’t upload workspace source by default | Local path defaults; privacy docs | Account/billing/device/runner metadata still processed on hosted paths | Keep narrow wording from privacy policy |
| **$499 two-business-day delivery** | Service schedule after access + materials | Diagnostic page + Module B terms | Clock starts after customer materials | Don’t promise calendar-day delivery from payment alone |

## Phrases to prefer

- “Control layer” / “pre-action gate”  
- “Configured hard deny”  
- “Regression evidence for the agreed workflow”  
- “Local lessons and rule promotion”  
- “Refund if not a supported fit”  

## Phrases to avoid or qualify

- “Guarantees no bad agent actions”  
- “Self-training model” / “autonomous policy evolution” without human feedback framing  
- “Enterprise-grade compliance” without naming actual artifacts  
- “SOC 2 / HIPAA” without certificates  
- “Always encrypted pairing” without TLS/host context  

## Review cadence

Update this matrix when:

- A landing page adds a new absolute claim  
- A paid surface changes deliverables or refunds  
- A security questionnaire answer is reused in marketing  
