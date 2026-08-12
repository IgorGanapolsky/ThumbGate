# ThumbGate Terms of Service

**Status:** Draft for product counsel review — not legal advice.  
**Last updated:** 2026-08-12  
**Live public summary:** `https://thumbgate.ai/terms` (must stay congruent)

These Terms of Service (“**Terms**”) govern access to and use of software and
services provided under the ThumbGate brand (“**ThumbGate**,” “**we**,” “**us**”),
including the local engine (`thumbgate` npm package), hosted services
(`thumbgate.app` and related APIs), and professional services (including the
$499 Enterprise Workflow Gate).

By installing, accessing, purchasing, or using the Services, you (“**Customer**”
or “**you**”) agree to these Terms. If you accept on behalf of an entity, you
represent that you have authority to bind that entity.

---

## 1. Structure

These Terms are a master agreement with product modules:

| Module | Surface |
| --- | --- |
| **A** | Local software engine and Pro subscription |
| **B** | $499 Enterprise Workflow Gate (professional services SOW) |
| **C** | Hosted platform, pairing, mobile, and cloud runners (`thumbgate.app`) |

If a module conflicts with the core terms on a scoped topic (refund fence,
deliverable, offline policy), the module controls for that surface.

---

## 2. Core commercial terms

### 2.1 Accounts

Paid tiers, hosted pairing, and professional services may require an account
or verified email. You must provide accurate information, protect credentials,
and are responsible for activity under your account.

### 2.2 Payment, billing, and renewals

- Fees appear on `/pricing` and related checkout pages. Currency and tax are
  as shown at checkout (Stripe and any other documented payment rail).
- Recurring subscriptions (e.g., Pro monthly/annual) **auto-renew** until
  canceled through the documented cancellation path before renewal.
- One-time purchases (including the $499 Workflow Gate) are charged once.
- You authorize us and our payment processors to charge the payment method
  you provide.

### 2.3 Trials and free tiers

Free CLI use, open-source MIT distribution, and any trial are provided
**as-is**, without SLA, indemnification, or support commitments beyond what
we publish for community channels.

### 2.4 Refunds (must match public site)

| Product | Refund rule |
| --- | --- |
| **Pro / Team-style subscriptions** | Cancel anytime. Full refund within **7 days** of the first charge on request; thereafter access continues through the paid period unless required by law. |
| **$499 Enterprise Workflow Gate** | If the repeated failure **cannot be reduced to one supported ThumbGate gate**, the order is **refunded in full** instead of being converted into open-ended consulting. After delivery and acceptance of the regression evidence package, the fee is non-refundable except as required by law. |
| **Other one-off purchases** | Refund on request if we cannot deliver the scoped artifact described at purchase. |

### 2.5 Acceptable use

You may not:

1. Use the Services to violate law or third-party rights.  
2. Use ThumbGate primarily to circumvent another provider’s safety controls
   for abuse (security research in your own systems with authorization is fine).  
3. Submit malware, exploit payloads against systems you do not own, spam,
   or unauthorized scraping via runners.  
4. Reverse-engineer proprietary hosted components except as allowed by law.  
5. Resell hosted access without written permission.  
6. Interfere with platform integrity, billing, or other customers.

### 2.6 Support boundaries

- Community / GitHub Issues: open-source CLI bugs and docs.  
- Email support: billing, Pro, Workflow Gate delivery, hosted access.  
- Support does **not** include unlimited debugging of custom agent code,
  unrelated infrastructure, or workflows outside the configured gate scope
  unless purchased separately.

### 2.7 Beta features

Features labeled beta, experimental, preview, or similar may change or be
withdrawn without notice and are provided without warranty or SLA.

### 2.8 Third-party models and cloud dependencies

The Services interoperate with third-party models, IDEs, MCP hosts, clouds,
and payment providers (examples: Anthropic Claude, OpenAI, Cursor, Codex,
Google, Perplexity, GitHub, Railway, Stripe). **ThumbGate is not liable for
outages, rate limits, model behavior, pricing changes, or policy changes of
third parties.** Third-party marks are owned by their respective owners;
use is for compatibility identification only and does not imply endorsement.

### 2.9 Suspension and termination

We may suspend or terminate access for material breach, AUP violation,
non-payment (after notice where practical), or security risk. You may stop
using free software at any time and cancel paid subscriptions per §2.2.
On termination, hosted access ends; local MIT-licensed code remains under
its license. Sections on liability, disclaimers, indemnity (if any), and
governing law survive.

### 2.10 Control-layer disclaimer (all surfaces)

**ThumbGate is a control layer and workflow policy engine.** It is **not** a
guarantee that every unsafe, incorrect, or malicious agent action will be
detected or blocked. Public materials may distinguish hard denies from
warnings; **actual behavior depends on your configuration, strict mode,
supported integrations, and your own testing.** You remain responsible for
reviewing high-impact actions and for outcomes of work your agents perform.

### 2.11 Warranty disclaimer

EXCEPT AS EXPRESSLY STATED IN A SIGNED ORDER, THE SERVICES ARE PROVIDED
“AS IS” AND “AS AVAILABLE.” TO THE MAXIMUM EXTENT PERMITTED BY LAW,
THUMBGATE DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND
NON-INFRINGEMENT.

### 2.12 Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, THUMBGATE WILL NOT BE LIABLE FOR
INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE
DAMAGES, OR LOST PROFITS, REVENUE, DATA, OR GOODWILL. THUMBGATE’S TOTAL
AGGREGATE LIABILITY FOR ALL CLAIMS IN ANY TWELVE-MONTH PERIOD IS LIMITED
TO THE AMOUNTS YOU PAID TO THUMBGATE FOR THE SERVICES GIVING RISE TO THE
CLAIM IN THAT PERIOD (OR **USD $100** if you paid nothing).

### 2.13 Customer responsibilities

You are responsible for: lawful use; securing devices and credentials;
configuring and testing gates; providing accurate intake materials for
services; reviewing and approving human-in-the-loop actions; and complying
with licenses of models and tools you connect.

### 2.14 Governing law

These Terms are governed by the laws of the **State of New York**, USA,
excluding conflict-of-law rules. Courts in New York may hear disputes
unless counsel replaces this section with arbitration or another forum.
*(Counsel should confirm jurisdiction, venue, and arbitration posture.)*

### 2.15 Changes

We may update these Terms. Material changes will be posted on `/terms` and,
where we have an email on file for a paid account, notified with reasonable
advance notice when practical. Continued use after the effective date
constitutes acceptance, except where law requires consent.

---

## Module A — Local engine and Pro

1. The public repository and npm package are offered under the **MIT License**
   unless a file states otherwise.  
2. Pro adds hosted commercial features (license validation, optional hosted
   surfaces) described at purchase time — not a transfer of ownership of
   ThumbGate IP.  
3. Local feedback, lessons, and prevention rules default to your machine.  
4. Optional CLI telemetry (install/usage metadata, not workspace source) may
   run unless disabled (`THUMBGATE_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`).  
5. Module A is subject to §2.10 (control layer is not a perfect firewall).

---

## Module B — $499 Enterprise Workflow Gate (SOW)

### B.1 Narrow deliverable

For the one-time fee published on the diagnostic/pricing pages (currently
**$499**), ThumbGate will deliver:

1. **One (1) supported workflow** — a single defined agent workflow failure
   pattern agreed in intake.  
2. **One (1) configured local pre-action gate** — ALLOW / WARN / DENY (or
   approval) behavior wired for a supported integration.  
3. **Regression evidence** — verification that the gate catches the agreed
   bad path(s) without regressing the agreed safe path(s).  
4. **Rollout and rollback proof** — written steps to enable and reverse the
   gate.  
5. **Schedule** — target delivery within **two business days** after you
   provide required access and materials.

### B.2 Customer-provided materials

Within a reasonable time after order (target five business days), you provide:

- Accountable workflow owner and technical contact  
- Non-secret examples, logs, or traces showing the repeated failure  
- Access needed to install or configure the supported integration  
- Golden cases for safe vs unsafe actions (recommended minimum: six)

Delays in customer materials pause the delivery clock.

### B.3 Acceptance

Acceptance occurs on the earlier of: (a) your written confirmation;
(b) delivery of the regression evidence package meeting agreed cases; or
(c) three business days after delivery without a written material-deficiency
notice.

### B.4 Refund boundary (matches public site)

If during discovery we determine the workflow **cannot be reduced to one
supported ThumbGate gate**, we **refund the $499 order in full** rather than
expanding into open consulting. We will not silently convert the order into
a larger engagement.

After acceptance under B.3, fees are non-refundable except as required by law.

### B.5 Out of scope

Unless a separate signed order says otherwise: multi-workflow rollout,
org-wide policy programs, hosted team SSO/sync, compliance certifications
(SOC 2 packaging, HIPAA, etc.), 24/7 monitoring, guaranteed incident
prevention, guaranteed savings, and legal opinions.

---

## Module C — Hosted platform and ThumbGate.app

### C.1 Pairing, mobile, and leases

Hosted services may pair devices, mobile apps, and runners using encrypted
transport (TLS) and session or lease tokens. You must secure paired devices
and revoke lost devices promptly.

### C.2 Eligible work and customer content

You may only submit workloads you are authorized to run. You are responsible
for the content of prompts, repos, and actions executed under your account.
You grant ThumbGate a limited license to process customer content solely to
provide the Services.

### C.3 Offline and disconnection

If a required approval client or paired device is offline, gated critical
actions should **fail closed or pause** by default. Customer configuration
may alter offline behavior; you accept residual risk of delay or blocked work.

### C.4 Failure and duplicate-execution behavior

Lease locks and single-writer controls are designed to reduce concurrent
mutation and double-execution. Network partitions, retries, or worker
restarts may still cause **delayed execution, timeouts, or duplicate
notifications**. ThumbGate is not liable for those residual failure modes
beyond §2.12.

### C.5 Human review responsibility

Where the product requests human approval, **the human operator is solely
responsible** for reviewing context and choosing approve or reject. An
approval is authorization to proceed with the presented action.

### C.6 Data handling and retention (summary)

Account, device, lease, and operational logs may be processed as described
in the Privacy Policy. Operational runner logs are retained for a limited
period (target: 30 days) unless longer retention is required for security
or law. Billing records are retained longer as required.

### C.7 Subprocessors

Infrastructure and payment vendors process data as needed to operate hosted
Services. See Privacy Policy subprocessors list. Enterprise customers may
request a then-current list and, when available, a negotiated DPA.

---

## Contact

Billing, refunds, and legal notices: **igor.ganapolsky@gmail.com**  
Support: `https://thumbgate.ai/support`  
Privacy: `https://thumbgate.ai/privacy`  
Security overview: `https://thumbgate.ai/security`
