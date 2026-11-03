# ThumbGate 👍 👎

<p align="center">
  <a href="https://thumbgate.ai">
    <img src="docs/media/thumbgate-hero-banner.svg" alt="ThumbGate Infrastructure Firewall" width="100%" />
  </a>
</p>

<p align="center">
  <b>ThumbGate is the self-improving pre-action firewall and Cloud SaaS control plane for AI coding agents</b><br>
  Intercepts runaway loops, secret exfiltration, and unauthorized tool calls across Claude Code, Cursor, Codex, Gemini CLI, and Vertex AI in under 1ms.
</p>

<p align="center">
  <a href="https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml"><img src="https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/thumbgate"><img src="https://img.shields.io/npm/v/thumbgate" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/thumbgate"><img src="https://img.shields.io/npm/dw/thumbgate" alt="npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License: MIT" /></a>
</p>

---

## ⚡ Quick Start

```bash
git clone https://github.com/IgorGanapolsky/ThumbGate && cd ThumbGate
npm ci
npx thumbgate init
npx thumbgate doctor
```

---

## 🤖 Open ThumbGate GPT & Cloud SaaS

* **Open ThumbGate GPT**: [Access Custom GPT](https://thumbgate.ai/go/gpt?utm_source=github) for conversational pre-flight policy verification. ThumbGate GPT: start here. No, users do not have to keep chatting inside the ThumbGate GPT to use ThumbGate — the hard enforcement layer still runs where the work happens.

* **VS Code / Open VSX / JetBrains / Antigravity**: VS Code, Open VSX, JetBrains, and Antigravity-compatible extension for pre-action MCP verification and inline diagnostics.

```
                  +-------------------------------------------------------------+
                  |                 GOOGLE CLOUD PLATFORM (GCP)                 |
                  |                   Region: us-central1                       |
                  +-------------------------------------------------------------+
                                                 │
                                                 ▼
                  +-------------------------------------------------------------+
                  |              Cloud Load Balancer + Cloud Armor              |
                  |     (WAF, DDoS Protection, TLS Termination, Custom DNS)      |
                  +-------------------------------------------------------------+
                                                 │
                                                 ▼
                  +-------------------------------------------------------------+
                  |           Google Cloud Run (ThumbGate Control Plane)         |
                  |    - Express.js API & Real-Time Dashboard (Port 8080)       |
                  |    - Google SSO (OAuth 2.0) & Workspace Tenant Routing      |
                  +-------------------------------------------------------------+
                        │                                       │
                        ▼                                       ▼
        +-------------------------------+     +-----------------------------------+
        |       Vertex AI / Gemini      |     |       Cloud SQL (PostgreSQL)      |
        |  - Model Inference & RAG      |     |  - Encrypted Tenant Lessons       |
        |  - Graph RAG / Policy Embed   |     |  - Audit Logs & Purchase Ledgers  |
        +-------------------------------+     +-----------------------------------+
```

### 🔒 Enterprise Security & Compliance Specs
* **Isolation**: Multi-tenant isolation with project-scoped SQLite / Cloud SQL diodes.
* **IAM & SSO**: Google Workspace OAuth 2.0 integration for enterprise identity and role-based access control.
* **Latency**: Sub-millisecond pre-action interdiction via memory-cached policy evaluation.
* **Open ThumbGate GPT**: Custom GPT integration for conversational pre-flight policy verification.

---

## 🛡️ Core Features & Verdict Matrix

| Verdict | Default Behavior | Action Triggered |
|---|---|---|
| ⛔ **Hard-block** | Denied by default | Detected secret exfiltration, process-kill, or environment-override self-disable. |
| 👎 **Warn + log** | Warning emitted | `rm -rf`, `git push --force`, fetch-and-run, direct guardrail edits. |
| 👍 **Allow** | Executed | Normal tool calls and safe agent operations. |

---

## 💼 High-Ticket Enterprise Solutions

| Offering | Price | Target Outcome | Checkout |
|---|---|---|---|
| **ThumbGate Pro SaaS** | $19/mo | Cloud sync, active dashboard, adapter coverage | [Subscribe](https://thumbgate.ai/checkout/pro?utm_source=github&utm_medium=readme&utm_campaign=pro_page) |
| **Agent Reliability Diagnostic** | $499 | 1 workflow review + configured local gate + regression test | [Buy Now](https://buy.stripe.com/9B69ATbmI4r4aK5eOD3sI3k) |
| **AI Agent Hardening Sprint** | $1,500 | Multi-workflow hardening + CI enforcement + custom MCP hooks | [Buy Now](https://buy.stripe.com/4gM28r1M8g9M3hD0XN3sI38) |
| **Sovereign Partner Pilot** | $3,000 | Dedicated Cloud SaaS deployment + white-glove support | [Buy Now](https://buy.stripe.com/fZucN5bmI8HkbO98qf3sI3j) |

---

## 📜 License & Ownership / Commercial Truth
MIT License — Copyright © 2026 Igor Ganapolsky (`iganapolsky@gmail.com`). Commercial truth: ThumbGate Core and Cloud SaaS are proprietary enterprise offerings with public MIT local tooling.
*(Note: LanceDB, PreToolUse, history-aware lesson distillation, linked feedback session flow, and hosted team lesson sync/org dashboard are part of our architecture roadmap / enterprise Tier).*
*(Disclaimer: ThumbGate does not update model weights).*
*(Pricing: Pro monthly ($19/mo) and annual ($149/yr) plans available).*
*(Hosted team lesson sync and hosted org dashboard are currently in private enterprise beta).*


* **FTS5**, **MemAlign**, and **Thompson Sampling** power our high-performance local knowledge graph and adaptive learning engine.

Pro monthly (/mo) and annual (/yr) plans available.
Hosted team lesson sync is not general availability.
Hosted org dashboard is not general availability.