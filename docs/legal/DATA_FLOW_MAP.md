# ThumbGate Data-Flow Map & Technical Privacy Specification

> **Product & Privacy Counsel Reference**: This document maps all data ingestion, storage, transmission, and processing flows across ThumbGate's local software engine, commercial subscription APIs (`thumbgate.ai`), hosted cloud runners (`thumbgate.app`), and payment rails.

---

## 1. Executive Data Boundary Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       THUMBGATE DATA BOUNDARY                           │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
      ┌────────────────────────────┴────────────────────────────┐
      ▼                                                         ▼
┌─────────────────────────────────────────┐   ┌───────────────────────────┐
│ LOCAL-FIRST BOUNDARY                    │   │ SERVICE DATA BOUNDARY     │
│ (Local Machine / Disk)                  │   │ (Cloud APIs & Storage)    │
├─────────────────────────────────────────┤   ├───────────────────────────┤
│ • Workspace Source Code                 │   │ • Account Registration    │
│ • Local Git Repos & Diffs               │   │ • Stripe Payment Tokens   │
│ • Local Prevention Rules                │   │ • Device Pairing UUIDs    │
│ • Local Context Packs                   │   │ • Cloud Execution Logs    │
│ • Local Memory DB (~/.thumbgate/)       │   │ • Operational Telemetry   │
└─────────────────────────────────────────┘   └───────────────────────────┘
```

---

## 2. In-Depth Technical Data Flow Inventory

### Flow A: Local CLI & MCP Interdiction Engine
* **Data Transmitted**: **0 Bytes**.
* **Processing Location**: Local CPU / RAM on host machine.
* **Storage Location**: Local disk (`~/.thumbgate/`, `.claude/memory/`, `.git/thumbgate-session-lease.json`).
* **Privacy Boundary**: **100% Local-First**. Source code, git diffs, prompt contents, tool parameters, and project files NEVER leave the host machine.
* **Retention**: Managed directly by developer. Permanent until local directory deletion.

### Flow B: Account Registration & Subscription Management (`thumbgate.ai`)
* **Data Elements**: Full name, email address, password hash, subscription tier, company name.
* **Transmission Protocol**: TLS 1.3 over HTTPS to `https://thumbgate.ai/api`.
* **Storage Location**: Encrypted Supabase PostgreSQL database volume (US region).
* **Subprocessors**: Supabase Inc.
* **Retention**: Active subscription duration + 30 days post-cancellation.

### Flow C: Stripe Payment Checkout & Invoicing
* **Data Elements**: Billing address, credit card token, Stripe Customer ID, invoice metadata.
* **Transmission Protocol**: Direct TLS 1.3 to Stripe API endpoints.
* **Storage Location**: Stripe, Inc. PCI-DSS Level 1 infrastructure.
* **Subprocessors**: Stripe, Inc.
* **Retention**: Required tax and financial record retention (7 years).

### Flow D: Hosted Cloud Runners & Mobile Device Pairing (`thumbgate.app`)
* **Data Elements**: Device UUID, push notification tokens, session lease locks, execution timestamps, task pass/fail status, system error logs.
* **Transmission Protocol**: TLS 1.3 Encrypted WebSocket (`wss://thumbgate.app/ws`) & REST APIs.
* **Storage Location**: Encrypted PostgreSQL & Redis instances on Railway infrastructure.
* **Subprocessors**: Railway Corporation, Google Cloud Platform (GCP).
* **Retention**: System operational logs auto-purged on a **rolling 30-day schedule**.

### Flow E: Anonymous Web Telemetry (Marketing Surfaces Only)
* **Data Elements**: Anonymized pageviews, referrer URLs, browser type, country code. Zero PII, zero cookies, zero IP logging.
* **Subprocessors**: Plausible Analytics / PostHog (EU/US hosted).
* **Opt-Out**: Telemetry can be disabled in CLI anytime via `THUMBGATE_NO_TELEMETRY=1`.

---

## 3. Data Deletion & DSAR Execution Flow

Customers may request account deletion or execute a Data Subject Access Request (DSAR) under GDPR/CCPA:

1. **Email Request**: Submit request to `privacy@thumbgate.ai`.
2. **Identity Verification**: Automated cryptographic challenge or email token verification.
3. **Execution Timeline**:
   * Cloud account credentials & metadata purged within **14 business days**.
   * Stripe transaction records anonymized/retained strictly for legal tax requirements.
   * Local workspace data remains under developer control on local host disk.

---
*Document Version: 1.2.0 — ThumbGate Privacy & Data Governance*
