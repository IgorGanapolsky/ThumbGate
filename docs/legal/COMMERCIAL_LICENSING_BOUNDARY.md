# Commercial licensing boundary (MIT vs paid)

**Last updated:** 2026-08-12  
**Public summary:** also on `/terms` and `/legal`

## What is MIT-licensed

Unless a file states otherwise, the **public repository** `IgorGanapolsky/ThumbGate` and the published **npm package `thumbgate`** are offered under the **MIT License** (`LICENSE`).

That typically includes:

- Local CLI and hooks
- Standard MCP server tooling shipped in the public package
- Public documentation and adapter configs in the open repository
- Tests and scripts published in that package/repo

MIT grants broad rights to use, copy, modify, merge, publish, distribute, sublicense, and sell copies of the software, subject to the license notice and disclaimer.

## What is not MIT (proprietary / commercial)

The following are **not** licensed as MIT merely because the CLI is MIT:

| Surface | Posture |
| --- | --- |
| Hosted API / production cloud service | Proprietary hosted service |
| thumbgate.app pairing / mobile / cloud runners (as offered) | Proprietary hosted product |
| Pro subscription entitlement, license keys, hosted dashboard state | Subscription license to use commercial features — not a transfer of ThumbGate IP |
| Brand, logos, thumbgate.ai / thumbgate.app marks | Trademark / brand — not MIT “code” rights to imply endorsement |
| Managed/professional services deliverables under an SOW | Governed by the SOW/MSA, not the MIT license alone |
| Customer-specific configuration produced under a paid engagement | See ownership rules below |

## What a Pro subscription licenses

A paid **Pro** subscription (e.g. $19/mo or $149/yr) licenses **access to commercial product features** described at purchase time (for example personal dashboard, export features, adapter coverage as listed), for the subscription term, for the licensed operator, subject to Terms.

It does **not**:

- Transfer ownership of ThumbGate source or trademarks
- Expand MIT rights beyond the open-source code
- Include org-wide hosted team features that are not generally available
- Include managed implementation services unless separately purchased

## Customer-specific rules and generalized learning

| Asset | Default ownership / reuse |
| --- | --- |
| **Customer-specific gate rules, configs, and golden tests** the customer creates or provides | **Customer owns** their content; ThumbGate receives a limited license to process it only to provide the service |
| **Customer-specific deliverables** under a paid SOW | Owned as stated in the SOW (default: customer owns custom configs delivered to them; ThumbGate retains pre-existing IP and generic know-how) |
| **Generalized product improvements** (non-confidential patterns, product features, generic templates) | **ThumbGate may reuse** to improve the product, provided customer confidential content is not published |
| **Open-source contributions** customer submits to the public repo | Under the project’s contribution terms (MIT) |

## Support included

| Path | Support |
| --- | --- |
| Free MIT CLI | Community / GitHub Issues only |
| Pro subscription | Billing + product support for licensed features (business-day response target) |
| Managed SOW | Only deliverables and hours defined in the SOW |

## What data leaves the customer machine

| Mode | Data leaving machine |
| --- | --- |
| Local MIT CLI (default) | Workspace code stays local. Optional CLI telemetry (install/usage metadata) if not disabled (`THUMBGATE_NO_TELEMETRY=1` / `DO_NOT_TRACK=1`) |
| Pro / hosted account | Account, billing (via Stripe), license state; hosted features process only what the customer routes to hosted endpoints |
| Managed engagement | Only materials the customer voluntarily shares (prefer redacted, non-secret) |

See Privacy Policy (`/privacy`) for categories, retention, and deletion.

## Customer remains responsible for production approvals

ThumbGate does not replace human ownership of production changes. Customers remain responsible for reviewing and approving high-impact actions, validating gates in their environment, and outcomes of agent work.

