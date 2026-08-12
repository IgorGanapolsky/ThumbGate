# ThumbGate legal package (product counsel drafts)

> **Status:** Product-counsel checklist drafts for engineer/product use.
> **Not legal advice.** A qualified startup/product lawyer must review and
> finalize these documents before enterprise outreach or broad paid adoption.

## Priority sequence (counsel mandate)

1. Product and data-flow map — `PRODUCT_AND_DATA_FLOW.md`
2. Terms for each paid surface — `TERMS_OF_SERVICE.md` (MSA + modules)
3. Privacy policy and DPA posture — `PRIVACY_POLICY.md`, `DPA_POSTURE.md`
4. Security / incident language — `SECURITY_AND_INCIDENT.md`
5. Trademark and open-source/IP hygiene — `TRADEMARK_AND_IP.md`,
   root `THIRD_PARTY_NOTICES.md`, `CLAIMS_SUBSTANTIATION.md`

## Live public routes

| URL | Purpose | Source of truth |
| --- | --- | --- |
| `/terms` | Stripe / checkout Terms of Service URL | `src/api/server.js` (must match refund + control-layer language on site) |
| `/privacy` | Privacy Policy URL for marketplaces | `src/api/server.js` |
| `/support` | Customer support URL | `src/api/server.js` |
| `/security` | Security overview (public) | `src/api/server.js` |
| `/legal` | Index of legal surfaces | `src/api/server.js` |

Markdown under `docs/legal/` is the longer counsel package. Public HTML
routes are the buyer-facing summaries that Stripe and marketplaces require.
When refund, deliverable, or data-boundary language changes, update **both**
the markdown package and the HTML routes in the same PR.

## Commercial surfaces covered

| Surface | Offer | Contract module |
| --- | --- | --- |
| Local engine + Pro | MIT CLI; Pro $19/mo or $149/yr self-serve | Module A |
| Enterprise Workflow Gate | $499 one-time, one supported workflow | Module B |
| Hosted / ThumbGate.app | Pairing, mobile, cloud runners, leases | Module C |

## Hard product truths (do not dilute)

- ThumbGate is a **control layer**, not a guarantee that every unsafe action
  is detected or blocked.
- Hard deny vs warning behavior depends on configuration, strict mode,
  supported integrations, and customer testing.
- The public $499 refund fence is **full refund if not a supported fit** —
  contract language must match the site exactly.
- Local workspace code stays local unless the customer routes work through
  hosted surfaces. “No workspace telemetry” is narrower than full privacy
  coverage for account, billing, device, and runner metadata.
- Do not claim ThumbGate SOC 2, HIPAA, or executed GDPR DPA status until
  those artifacts exist (`docs/COMMERCIAL_TRUTH.md`).

## Counsel handoff package

Give counsel this folder plus:

- Live pricing / diagnostic copy (`public/pricing.html`, `public/diagnostic.html`)
- `docs/COMMERCIAL_TRUTH.md`
- `docs/legal/CLAIMS_SUBSTANTIATION.md`
- `THIRD_PARTY_NOTICES.md` and `LICENSE`
- Current production hosts: `thumbgate.ai`, `thumbgate.app`,
  `thumbgate-production.up.railway.app`

## Employment IP hygiene

See `EMPLOYMENT_IP_HYGIENE.md` for generic (employer-agnostic) rules: no confidential employer inputs, and invention-assignment risk is not cured by nights-and-weekends alone.


## Commercial site legal hygiene (apart from employment IP)

| Public route | Purpose |
| --- | --- |
| `/legal` | Index of legal surfaces (sitemap + footer) |
| `/terms` | Terms / EULA, refunds, AUP, liability |
| `/privacy` | Privacy Policy |
| `/support` | Support + refunds + cancellation contact |
| `/security` | Security overview |
| `/legal/licensing` | MIT vs paid boundary, customer rules ownership |
| `/legal/msa-sow` | Managed services MSA/SOW template summary |

Domain commercial contacts: `legal@`, `privacy@`, `security@`, `igor@` on `thumbgate.ai` (not personal Gmail on commercial/legal pages).

Markdown sources: `COMMERCIAL_LICENSING_BOUNDARY.md`, `MSA_SOW_TEMPLATE.md`, `TERMS_OF_SERVICE.md`, `PRIVACY_POLICY.md`.
