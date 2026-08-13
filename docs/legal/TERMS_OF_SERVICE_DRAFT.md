# ThumbGate Terms of Service (Draft for Product Counsel Review)

**Last Updated**: August 12, 2026

These Terms of Service ("**Terms**" or "**Agreement**") govern access to and use of the software, services, cloud runners, APIs, web applications, and professional services provided by ThumbGate ("**ThumbGate**", "**we**", "**us**", or "**our**"), including the local engine (`thumbgate` npm package), the hosted platform (`thumbgate.app`), and custom workflow implementation services.

By installing, accessing, or using any part of the Services, you ("**Customer**" or "**you**") agree to be bound by these Terms. If you are entering into this Agreement on behalf of a company or other legal entity, you represent that you have authority to bind such entity.

---

## 1. Master Structure & Product Modules

This Agreement consists of these Core Terms and the following Product-Specific Modules:
* **Module 1**: Local Software Engine & Pro License Terms
* **Module 2**: Professional Services Statement of Work ($499 Hardened Workflow Gate)
* **Module 3**: Hosted Cloud Runners & Mobile Pairing (`thumbgate.app`)

---

## 2. Core Commercial Terms

### 2.1 Account Creation & Registration
You must register an account to access paid tiers, cloud runners, or professional services. You agree to provide accurate, current, and complete information and maintain the security of your credentials. You are responsible for all activities occurring under your account.

### 2.2 Billing, Subscriptions & Renewals
* **Fees**: Subscription fees for Pro and Enterprise tiers, as well as one-time fees for professional services, are specified on our pricing pages (`https://thumbgate.ai/pricing` or `https://thumbgate.app/pro`).
* **Auto-Renewal**: Recurring subscriptions automatically renew for successive terms (monthly or annually) unless canceled prior to the renewal date via your account dashboard.
* **Taxes**: All fees exclude applicable federal, state, local, or value-added taxes, which will be added to invoices where applicable.

### 2.3 Trials & Free Tiers
Free tiers, open-source local binaries, and promotional trials are provided strictly **"AS-IS"** without service level agreements (SLAs), indemnification, or technical support obligations. We reserve the right to modify or terminate free tiers at any time.

### 2.4 Refund Policy
* **General Subscriptions**: All recurring subscription fees are non-refundable except as required by law or explicitly stated herein.
* **$499 Workflow Gate Refund Boundary**: Refund conditions for $499 Workflow Gate purchases are strictly defined in **Module 2, Section 2.4**.

### 2.5 Acceptable Use Policy (AUP)
You shall NOT:
1. Use the Services to violate any applicable law or third-party intellectual property, privacy, or security rights.
2. Attempt to bypass, disable, or tamper with third-party software protection mechanisms or engage in unauthorized security testing/exploitation.
3. Reverse-engineer, decompile, or disassemble proprietary hosted components of `thumbgate.app`.
4. Submit malicious payloads, virus-laden repositories, or unauthorized prompt injections designed to compromise agent execution environments.
5. Use automated agents or cloud runners to conduct unauthorized scraping, spamming, or denial-of-service attacks.

### 2.6 Beta & Experimental Features
From time to time, ThumbGate may make preview, alpha, beta, or experimental
features available ("Beta Features"). Beta Features are provided for evaluation
purposes only and are subject to change, removal, or discontinuation at any time
without notice. Beta Features are provided **"AS-IS"** without SLA, warranty,
indemnification, or support commitments. Customer use of a Beta Feature is at
Customer's sole risk and does not constitute a guarantee that the feature will
be released in a generally-available form.

### 2.7 Support Boundaries
* **Standard Support**: Available during ThumbGate's published business hours via
  in-app chat, email, or the community issue tracker. Standard support covers
  ThumbGate configuration, documented APIs, and known-issues with the open-source
  engine and hosted platform.
* **Excluded Support**: ThumbGate does not provide debugging, remediation, or
  code-level support for Customer's custom LLM prompts, third-party agent
  configurations, model-provider API errors, or Customer-specific CI/CD pipeline
  logic outside the configured gate parameters. Such work may be scoped under a
  separate Professional Services Statement of Work.
* **Premium / Enterprise Support**: Available under a separate Enterprise Support
  Addendum with defined response-time SLAs.

### 2.8 Customer Responsibilities
Customer is responsible for:
1. Configuring rule thresholds, strict mode, and context packs appropriate to its
   environment and risk tolerance.
2. Testing gates and enforcement behavior in non-production environments before
   deploying to production workflows.
3. Reviewing and approving any action routed through `thumbgate.app` mobile or
   web approval interfaces.
4. Securing its credentials, API keys, paired devices, and local workstations.
5. Ensuring that all workloads, agent actions, and data submitted to cloud
   runners comply with applicable laws and the AUP.

### 2.9 Suspension & Termination
We may suspend or terminate your access to the Services immediately upon written notice if: (a) you materially breach these Terms or the AUP; (b) your account payment is overdue by more than fourteen (14) days; or (c) we reasonably determine that your use poses a security risk to the platform or other users.

Upon termination, your right to use hosted cloud runners and paid features immediately ceases. Sections 2.11 (Limitation of Liability), 2.12 (Warranties), 2.13 (Governing Law), and 4 (General) shall survive termination.

### 2.10 Third-Party Model & Cloud Dependencies
The Services interoperate with third-party Large Language Models (LLMs), IDEs, APIs, and cloud infrastructure (including Anthropic, OpenAI, Google, Railway, GitHub, and others). **ThumbGate is not responsible or liable for any service interruptions, API rate limits, pricing changes, latency, outages, model hallucinations, or model behavior changes caused by third-party providers.**

### 2.11 Limitation of Liability
TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THUMBGATE, ITS AFFILIATES, OFFICERS, OR SUPPLIERS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES (INCLUDING LOSS OF PROFITS, DATA, GOODWILL, OR BUSINESS INTERRUPTION), REGARDLESS OF THE THEORY OF LIABILITY.

THUMBGATE’S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO THIS AGREEMENT SHALL NOT EXCEED THE TOTAL AMOUNT PAID BY CUSTOMER TO THUMBGATE IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM (OR $100 IF NO FEES HAVE BEEN PAID).

### 2.12 Warranty Disclaimers
EXCEPT AS EXPRESSLY STATED HEREIN, THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE." THUMBGATE DISCLAIMS ALL WARRANTIES OF ANY KIND, EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.

### 2.13 Governing Law & Arbitration
This Agreement is governed by the laws of the State of Delaware, without regard to conflict of law principles. Any dispute arising under this Agreement shall be resolved through binding individual arbitration under the rules of the American Arbitration Association (AAA), and both parties waive any right to participate in a class action lawsuit.

---

## 3. Product-Specific Modules

### MODULE 1: LOCAL ENGINE & GOVERNANCE CONTROL LAYER

#### 1.1 Nature of the Control Layer (Non-Guarantee Disclaimer)
**IMPORTANT NOTICE**: ThumbGate is an **action interdiction control layer and workflow policy engine**. It is **NOT** a guarantee or absolute firewall that every unsafe agent action, prompt injection, code error, or operational mistake will be detected or blocked.

#### 1.2 Hard Denies vs. Warnings
ThumbGate supports multiple enforcement modes, including advisory warnings, manual confirmation prompts, and hard execution denials (exit code 1 / blocked tool call). **The actual interdiction outcome depends strictly upon**:
* Customer's rule configuration and threshold settings.
* Enablement of "strict mode" or enforcement policy flags.
* Compatibility with active IDEs, LLM frameworks, and MCP adapters.
* Thorough pre-deployment testing conducted by Customer in its own environments.

Customer acknowledges that modifying rule configurations, disabling strict mode, or using unsupported agent adapters will alter enforcement behavior.

---

### MODULE 2: $499 HARDENED WORKFLOW GATE (STATEMENT OF WORK)

#### 2.1 Scope & Narrow Deliverable Definition
For the one-time fee of $499, ThumbGate agrees to deliver:
1. **One (1) Supported Workflow Integration**: HARDENING for one (1) specific customer agent workflow (e.g., GitHub PR review gate, database write guardrail, or email dispatch barrier).
2. **One (1) Configured Gate**: Production rule specification file tailored to customer's target environment.
3. **Regression Evidence Package**: Standardized evaluation evidence showing zero-regression performance on customer-provided golden test cases.
4. **Rollout & Rollback Documentation**: Step-by-step instructions for production deployment and emergency rollback.

#### 2.2 Customer Required Access & Materials
Customer must provide within five (5) business days of order confirmation: (a) workflow specifications; (b) sample execution logs; (c) at least six (6) golden test cases representing expected safe/unsafe actions; and (d) technical contact access. Delays in customer deliverables pause implementation timelines.

#### 2.3 Acceptance Criteria
Acceptance occurs upon the earlier of: (a) Customer's written confirmation; (b) delivery of the Regression Evidence Package confirming successful execution against golden test cases; or (c) three (3) business days following delivery without written notice of material non-conformance.

#### 2.4 Refund Boundary & Out-of-Scope Contract Terms
If during technical discovery ThumbGate determines that Customer's target workflow cannot be reduced to a supported gate due to unsupported protocols or custom un-exposed customer APIs:
* **Refund Boundary**: ThumbGate will issue a full refund of the $499 fee minus a $99 non-refundable diagnostic/discovery fee, OR at Customer's option, convert the full $499 into service credit for future feature releases.
* Once the Regression Evidence Package is delivered and accepted, the $499 fee is strictly non-refundable.

---

### MODULE 3: HOSTED PLATFORM & CLOUD RUNNERS (`thumbgate.app`)

#### 3.1 Device Pairing & Leases
`thumbgate.app` allows pairing between mobile devices, local machines, and cloud runners via encrypted WebSocket/TLS protocols. Access is governed by cryptographic session lease tokens (`.git/thumbgate-session-lease.json` or cloud lease locks).

#### 3.2 Eligible Workloads & Execution Environments
Cloud runners execute workloads (such as scheduled checks, headless browser verification, or PR analysis) on virtual private servers (VPS) or isolated containers. Customer warrants that all submitted workloads comply with the AUP and do not violate third-party infrastructure policies.

#### 3.3 Disconnection & Offline Policy
If a paired local device or mobile approval client loses network connectivity:
* By default, execution enters a **fail-closed** or **paused state**.
* Cloud runners will not proceed with gated critical actions until re-authenticated or authorized by Customer's configured offline policy.

#### 3.4 Failure & Duplicate-Execution Behavior
Cloud runners utilize distributed lease locks to prevent double-execution of critical agent actions. In the event of network partition, worker failover, or timeout:
* Cloud runners prioritize safety and lock retention over instant execution.
* ThumbGate is not liable for delayed execution, task timeouts, or transient duplicate notifications resulting from network partitions.

#### 3.5 Human-in-the-Loop & Approval Responsibility
Where `thumbgate.app` routes approval requests to Customer's mobile app or web dashboard:
* **The human operator retains sole and exclusive responsibility** for reviewing context, assessing action safety, and clicking "Approve" or "Reject".
* Approval via `thumbgate.app` constitutes explicit customer authorization to execute the target action.

---

## 4. Intellectual Property Ownership & Representations

### 4.1 ThumbGate IP
All right, title, and interest in the ThumbGate software, services, trademarks,
hosted platform, documentation, and proprietary technology remain the property of
ThumbGate and its licensors. The MIT License governs the open-source local engine
repository; all other commercial components are governed by the commercial terms
set forth herein or in a separate written agreement.

### 4.2 No Use of Third-Party Confidential Information
ThumbGate represents that the Services, documentation, and any professional
services deliverables are developed from independently created or publicly
available materials and do not incorporate the confidential information, trade
secrets, or proprietary materials of any third-party employer, customer, or
other entity. ThumbGate's founder and contributors are subject to an employment
boundary policy requiring strict separation between employer-confidential work
and ThumbGate development.

### 4.3 Feedback & Suggestions
Customer may voluntarily provide suggestions, feedback, or feature requests.
Customer grants ThumbGate a perpetual, royalty-free, worldwide license to use such
feedback to improve the Services without obligation or compensation. Feedback
must not include Customer's confidential information unless provided under a
separate written NDA.

---

## 5. Contact Information

For questions regarding these Terms or legal notices, contact:  
**ThumbGate Product Counsel & Legal Operations**  
Email: `legal@thumbgate.ai`  
Web: `https://thumbgate.ai/docs/legal`
