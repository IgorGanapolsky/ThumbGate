# Commercial legal first pass (priority order)

**Separate from employment/IP (ECI) workstream.**  
Even with outside-activity permission, scale paid usage only after a basic legal-operational package.

## Priority order

### 1. Product and subscription terms (`/terms`)
MIT vs paid, account eligibility, billing/renewals, cancellation, refunds, trials, support, feature changes, suspension, AUP, third-party dependencies, customer responsibilities, termination, production-approval ownership.

### 2. Privacy and data handling (`/privacy` + `/legal/data-flow`)
Local install, dashboard, hosted sync (if any), Stripe, support, managed service. What leaves the machine, retention/deletion, subprocessors, security roles, deletion requests. **DPA** only if business customers need it after the map (see `DPA_POSTURE.md`).

### 3. Open-source boundary (`/legal/licensing`)
What is MIT, what Pro licenses, what is proprietary, who owns customer-specific rules, reuse of generalized improvements, support/hosted inclusions.

### 4. Risk allocation (in `/terms`)
Warranty disclaimer, liability cap, no consequential damages (as permitted), customer responsible for production approvals; align hard deny vs warning vs unsupported cases with contract language.

### 5. Managed-services paperwork (`/legal/msa-sow`) — **if** implementation/diagnostic offers remain
MSA + narrow SOW: supported workflow, access/materials, acceptance, deliverables, exclusions, change requests, approvals, confidentiality, IP, fees, liability, termination.

## Highest-value first deliverable

**Short data-flow map + subscription terms + privacy policy + open-source boundary.**  
That package exposes whether MSA, DPA, or enterprise addendum is actually required.

## Contacts

| Address | Use |
| --- | --- |
| **support@thumbgate.ai** | Primary public commercial contact (billing, cancel, product) |
| **legal@thumbgate.ai** | Formal legal notices only |
| **privacy@thumbgate.ai** | Deletion / privacy requests |
| **security@thumbgate.ai** | Vulnerability reports only |

Do **not** spray a long list of addresses on every page. Provision mailbox, forwarding, access control, and retention **before** receiving customer personal data at these addresses.

## Counsel review focus

Product counsel + privacy counsel on actual flows: Stripe checkout, work-email collection, hosted sync, managed access.
