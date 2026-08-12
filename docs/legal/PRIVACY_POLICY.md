# ThumbGate Privacy Policy

**Status:** Draft for product counsel review — not legal advice.  
**Last updated:** 2026-08-12  
**Live public summary:** `https://thumbgate.ai/privacy`

ThumbGate (“**we**,” “**us**”) provides a local-first control layer for AI
coding agents and optional hosted services. This Privacy Policy describes
how we process information across:

- Local software (`thumbgate` npm package / CLI / MCP hooks)
- Marketing and docs sites (`thumbgate.ai` and related pages)
- Hosted API and product surfaces (`thumbgate.app`, production Railway host)
- Professional services (including the $499 Enterprise Workflow Gate)

---

## 1. Local-first workspace boundary

### What stays on your machine by default

When you use the self-hosted / local engine without pointing it at a hosted
endpoint:

- Source code, local git state, diffs, and workspace files remain local  
- Local feedback, memory/lessons, prevention rules, and proof artifacts
  remain under your project or home directories (for example `~/.thumbgate/`,
  `.claude/memory/`)  
- Local tool traces stay local  

**Zero public workspace telemetry:** we do not fetch or render your
workspace source code on public marketing dashboards. That statement is
about **workspace contents**, not a claim that we process no personal data
at all.

### Optional CLI telemetry

Optional CLI telemetry is best-effort install/usage and health metadata
(for example a random install id and command success/failure). It is not
raw workspace source. Disable with `THUMBGATE_NO_TELEMETRY=1` or
`DO_NOT_TRACK=1`.

---

## 2. Data collection (hosted, account, and commercial)

When you use paid tiers, checkout, intake forms, support, or hosted app
features, we may process:

| Category | Examples | Purpose |
| --- | --- | --- |
| **Account & contact** | Name, email, company | Account, delivery, support |
| **Billing** | Stripe customer id, payment status, invoices | Payment, tax, fraud prevention |
| **Intake / support** | Workflow descriptions, non-secret logs you send | Deliver diagnostic/gate services |
| **Device & pairing** | Device identifiers, push tokens, IP, lease metadata | Pairing, auth, abuse prevention |
| **Cloud runner metadata** | Task timestamps, lease status, success/fail, error summaries | Operate runners, debug, prevent double-execution |
| **Web telemetry** | Page views, CTA events, referrers, coarse geo | Funnel and product analytics |
| **Feedback (hosted)** | Thumbs signals and context you submit to a hosted API | Operate hosted lesson features if you use them |

We do **not** sell personal information.

---

## 3. Data sharing

We share data only with:

- **Service providers / subprocessors** needed to run the product (payments,
  hosting, email, analytics) under contractual restrictions  
- **Professional advisors** or authorities when required by law  
- **Successors** in a merger or asset transfer, with notice where required  

We do not share workspace source code from the local engine with model
trainers. Hosted features only process content you send to those features.

---

## 4. Subprocessors (operational list)

| Subprocessor | Role |
| --- | --- |
| Stripe, Inc. | Payment processing |
| Railway | Application hosting |
| Plausible | Web analytics (privacy-oriented) |
| PostHog | Product analytics where configured |
| Resend | Transactional email where configured |
| PayPal | Alternate payment rail where used |
| GitHub | Repository, issues, marketplace listing surfaces |

This list is operational. Presence on the list is **not** a claim that
ThumbGate has completed enterprise security questionnaires, SOC 2, HIPAA,
or signed SCCs with every customer. Enterprise customers may request a
then-current list and negotiate a DPA when available (see `DPA_POSTURE.md`).

---

## 5. Data retention

| Data | Retention posture |
| --- | --- |
| Local engine files | Until you delete them |
| Hosted account / API key data | While account active; delete on verified request subject to legal holds |
| Cloud runner operational logs | Target **30-day** rolling purge |
| Billing / tax records | Up to **7 years** where required |
| Support tickets / email | Typically up to **2 years** after resolution unless longer needed |
| Web analytics | Per analytics provider retention settings |

---

## 6. Data deletion

Email **igor.ganapolsky@gmail.com** to request deletion of hosted account
data. We will process verified requests within **30 days**, except where we
must retain records for law, fraud prevention, or dispute resolution. Local
data is deleted by removing the local directories.

---

## 7. Security (summary)

We use industry-standard transport encryption (TLS) for hosted endpoints,
access controls on production systems, and least-privilege operator access.
No method of transmission or storage is perfectly secure. See
`/security` and `SECURITY_AND_INCIDENT.md` for posture language suitable
for buyer questionnaires (still subject to counsel review).

---

## 8. International transfers

Hosted infrastructure is primarily in the United States. If you access the
Services from other regions, your information may be processed in the U.S.
Enterprise transfer mechanisms (for example SCCs) are available only when
executed under a negotiated DPA — they are **not** automatically in place
for every free or self-serve user.

---

## 9. Children

The Services are not directed to children under 16, and we do not knowingly
collect their personal information.

---

## 10. Changes

We may update this Privacy Policy by posting a new version on `/privacy`
with an updated date. Material changes for paid customers will be
communicated when practical.

---

## 11. Contact

Privacy and deletion requests: **igor.ganapolsky@gmail.com**  
Terms: `/terms` · Support: `/support` · Security: `/security`
