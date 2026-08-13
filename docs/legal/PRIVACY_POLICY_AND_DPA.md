# ThumbGate Privacy Policy & Enterprise Data Processing Addendum (DPA) Framework

**Last Updated**: August 12, 2026

---

## SECTION I: PRIVACY POLICY

ThumbGate ("**ThumbGate**", "**we**", "**us**", or "**our**") values your privacy. This Privacy Policy explains how we collect, use, store, process, and protect your information across our local software binaries (`thumbgate` npm package), our hosted web and cloud services (`thumbgate.app`), and our marketing websites (`thumbgate.ai`).

### 1. The Local-First Workspace Boundary (Crucial Privacy Guarantee)

**What Stays 100% Local on Your Machine**:
* Your source code, local git repositories, workspace files, and local diffs.
* Local prevention rules, active context packs, and locally stored quality feedback (`~/.thumbgate/`, `.claude/memory/`).
* Local MCP tool execution traces and shell commands.

**Zero Workspace Telemetry**: ThumbGate’s open-source CLI and local engine do **NOT** fetch, transmit, or publicly render your local workspace source code, file contents, or repository data.

---

### 2. Information We Process for Service Operation

When you interact with our paid tiers, cloud platform (`thumbgate.app`), or support channels, we process the following categories of data:

| Data Category | Specific Elements | Purpose of Processing | Legal Basis / Retention |
| :--- | :--- | :--- | :--- |
| **Account & Identity Data** | Name, email address, company name, password hash | Account creation, authentication, administrative communication | Contract performance. Retained for account lifetime. |
| **Billing & Transaction Data** | Billing address, payment token, Stripe Customer ID, invoice history | Processing payments, tax compliance, fraud prevention | Legal obligation & Contract. Retained for 7 years (tax laws). |
| **Device & Pairing Data** | Device UUIDs, OS version, push notification tokens, IP addresses | Cryptographic pairing between mobile apps, local CLIs, and cloud runners | Legitimate interest & Contract. Retained while device is paired. |
| **Cloud Runner Metadata & Logs** | Lease status, execution timestamp, task success/failure status, system error logs | Operating cloud runners, preventing double-execution, system debugging | Contract performance. Operational logs purged after **30 days**. |
| **Support & Diagnostic Data** | Email correspondence, ticket logs, diagnostic outputs voluntarily provided | Troubleshooting customer issues and providing technical support | Consent / Contract performance. Retained for 2 years post-resolution. |
| **Aggregate Web Telemetry** | Pageviews, referring URL, browser user-agent, country code (anonymous) | Measuring landing page performance and conversion rates | Legitimate interest. Processed via privacy-first analytics (Plausible/PostHog). |

---

### 3. Data Retention & Deletion Rules

* **Account Data**: Retained as long as your account remains active. Upon written request for deletion (`privacy@thumbgate.ai`), account credentials and associated cloud metadata are deleted within thirty (30) days.
* **Cloud Execution Logs**: Purged automatically on a **30-day rolling basis**.
* **Local Data**: Controlled entirely by you. Deleting local directories (`~/.thumbgate/` or `.claude/memory/`) permanently removes local lessons and context packs.

---

### 4. International Data Transfers

If you access our Services from the European Economic Area (EEA), United Kingdom, or Switzerland, your data may be transferred to and processed in the United States. We implement Standard Contractual Clauses (SCCs) approved by the European Commission to ensure adequate safeguards for cross-border data transfers.

---

## SECTION II: SUBPROCESSOR DISCLOSURE LIST

ThumbGate engages third-party vendors ("Subprocessors") to perform infrastructure hosting, payment processing, and system operations. All Subprocessors undergo security evaluations and are bound by data processing agreements:

| Subprocessor Name | Role / Function | Data Location | Safeguards / Mechanisms |
| :--- | :--- | :--- | :--- |
| **Stripe, Inc.** | Payment processing and subscription management | United States | PCI-DSS Level 1 Certified, DPA with SCCs |
| **Railway Corporation** | API & Cloud Runner Container Hosting | United States (GCP/AWS) | SOC 2 Type II Certified, Encrypted Storage |
| **Supabase Inc.** | Managed PostgreSQL database for account metadata | United States (AWS) | SOC 2 Type II Certified, AES-256 Encryption |
| **PostHog, Inc. / Plausible** | Anonymous web telemetry (marketing surfaces only) | EU / US | Privacy-first, zero-PDI tracking |
| **Google Cloud Platform (GCP)** | Secondary cloud backup & serverless orchestration | United States | ISO 27001, SOC 2 Type II Certified |

---

## SECTION III: ENTERPRISE DATA PROCESSING ADDENDUM (DPA) FRAMEWORK

This Data Processing Addendum ("**DPA**") forms part of the Master Services Agreement between ThumbGate and enterprise Customers ("**Customer**") processing personal data subject to GDPR, UK GDPR, or CCPA/CPRA.

### 1. Processing Scope & Roles
* **Customer as Controller**: Customer acts as Data Controller for any personal data included within agent workloads or user metadata.
* **ThumbGate as Processor**: ThumbGate acts as Data Processor / Service Provider, processing data solely on Customer's documented instructions.

### 2. Confidentiality & Security Measures
ThumbGate maintains technical and organizational security measures (TOMs), including:
* **Encryption in Transit**: TLS 1.3 encryption for all external network API calls and paired WebSocket tunnels.
* **Encryption at Rest**: AES-256 encryption for database volumes and cloud runner metadata storage.
* **Access Control**: Role-based access control (RBAC), multi-factor authentication (MFA), and zero-trust administrative access policies.

### 3. Incident Notification Terms (72-Hour SLA)
In the event of a confirmed **Security Incident** leading to accidental or unlawful destruction, loss, alteration, or unauthorized disclosure of Customer personal data:
* ThumbGate shall notify Customer’s designated security contact without undue delay and no later than **seventy-two (72) hours** after confirmation.
* The notification will detail the nature of the incident, affected data categories, estimated impact, and corrective mitigation steps taken.

### 4. Data Portability & Return
Upon termination of an enterprise agreement, Customer may request a machine-readable export of its account metadata, cloud execution logs within the retention window, and configured rule/gate schemas. ThumbGate will provide such export within thirty (30) days of a written request and will delete remaining cloud-hosted Customer data no later than ninety (90) days after termination, except where longer retention is required by applicable law. Local data remains under Customer's sole control.

### 5. Audit & Compliance
Upon thirty (30) days advance written notice, Customer may request copies of ThumbGate’s third-party security audit summaries (e.g., SOC 2 reports or penetration test summaries) to verify compliance with this DPA.

---

## SECTION IV: CONTACT & DATA PROTECTION OFFICER

For privacy inquiries, DPA execution requests, or data subject access requests (DSARs):  
**Data Protection Officer & Privacy Operations**  
Email: `privacy@thumbgate.ai`  
Web: `https://thumbgate.ai/docs/legal`
