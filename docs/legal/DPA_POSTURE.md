# Enterprise DPA and data-processing posture

**Status:** Internal + buyer-facing posture document (draft).  
**Not** an executed Data Processing Agreement.

## Why this exists

Business buyers will ask for a DPA, subprocessors list, security overview,
incident-notification terms, deletion/retention rules, and sometimes an
enterprise security addendum. ThumbGate should answer precisely about the
**local-first boundary** versus anything that leaves the machine — without
claiming certifications or signed instruments that do not exist yet.

Aligned with `docs/COMMERCIAL_TRUTH.md`:

> Do not claim sub-processor coverage, SOC 2 status, HIPAA eligibility,
> GDPR DPA terms, or enterprise data residency until those artifacts are
> actually in place.

## Current posture (truthful)

| Artifact | Status |
| --- | --- |
| Public Privacy Policy (`/privacy`) | Live summary + markdown draft package |
| Subprocessors list | Operational list in Privacy Policy (not a claim of signed customer DPAs) |
| Standard DPA (GDPR / UK GDPR / CCPA service-provider terms) | **Not executed at scale** — draft for counsel; offer “available for enterprise negotiation” |
| SCCs / international transfer module | **Not default** — only if counsel attaches to a signed enterprise DPA |
| SOC 2 / ISO 27001 for ThumbGate | **Not claimed** |
| HIPAA eligibility | **Not claimed** |
| Incident notification commitment | Draft target: **72 hours** after confirmed personal-data breach for enterprise customers under signed terms |
| Deletion | Hosted deletion on verified request within 30 days (legal holds excepted) |

## When a DPA is needed

| Deployment | Typical need |
| --- | --- |
| Local-only CLI, no hosted account | Usually customer-controlled processing; DPA often unnecessary for ThumbGate as processor |
| Pro checkout + license email only | Limited processor role (account/billing); short DPA may still be requested |
| Hosted API, pairing, cloud runners | DPA often required for EU/UK business buyers |
| Customer sends production logs for $499 gate | Treat shared samples as customer-instructed processing; prefer non-secret redacted samples |

## Controller / processor sketch (for counsel)

- **Customer as controller** of personal data inside their agent workloads and
  of end-user data their agents touch.  
- **ThumbGate as processor** only for hosted services and for professional
  services materials the customer supplies.  
- **ThumbGate as independent controller** for its own website analytics,
  billing records, and security logs necessary to operate the business.

## What sales and agents may say

**Allowed:**

- “Local engine keeps workspace data on your machine by default.”  
- “Here is our privacy policy and subprocessors list.”  
- “Enterprise DPA is available for negotiation for hosted deployments.”  
- “We aim to notify enterprise customers within 72 hours of a confirmed
  personal-data breach under a signed agreement.”  

**Not allowed until true:**

- “We are SOC 2 certified.”  
- “We have a GDPR DPA for all customers automatically.”  
- “We are HIPAA compliant / BAA ready.”  
- “All subprocessors are covered under our existing SCCs with you.”  

## Security addendum topics for counsel

1. Encryption in transit (TLS) for hosted endpoints  
2. Access control and operator practices  
3. Retention / deletion (30-day ops logs target; billing longer)  
4. Incident notification (72-hour target under contract)  
5. Customer audit rights (reasonable, notice-based, paper/summary first)  
6. Subprocessor change notice for enterprise  
7. Local-first vs hosted data map (attach `PRODUCT_AND_DATA_FLOW.md`)

## Next counsel actions

1. Draft short-form DPA + SCCs module for hosted customers  
2. Confirm subprocessors and transfer mechanisms  
3. Decide breach-notification trigger language and customer contact path  
4. Decide whether Pro self-serve remains under Privacy Policy only until
   enterprise order forms trigger the DPA  
