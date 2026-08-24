---
'thumbgate': minor
---

Add AI Liability Defense & Executive Safe-Harbor Gate (BrightTALK 668863), Zero-Trust Supply Chain & Provenance Diode (BrightTALK 668780), and Obsidian Bases / Notion-like Database Synchronizer.

- **AI Liability Defense Engine (`scripts/ai-liability-defense-engine.js`)**:
  - Implements multi-jurisdiction compliance matrix for EU AI Act (Art. 12/14/72), SEC Rule 33-11216 (Item 1.05 materiality audit), DORA (Art. 30 third-party ICT audit), and FTC Act Section 5.
  - Enforces fail-closed dual-key operator authorization on destructive operations, credential/IAM mutations, and financial dispatches.
  - Generates tamper-evident cryptographic Pre-Action Liability Proof Receipts (`rcpt_liab_*`).
- **Zero-Trust Supply Chain Diode (`scripts/supply-chain-diode.js`)**:
  - Interdicts malicious lifecycle scripts (`preinstall`, `postinstall`, `install` executing arbitrary shell commands).
  - Enforces exact dependency version pinning and SLSA Level 2+ / npm OIDC provenance.
  - Detects typosquatting attacks against critical dependencies (Axios, Express, React, Trivy, Playwright, Lodash).
  - Emits cryptographic Provenance Receipts (`rcpt_supply_*`).
- **Obsidian Bases & Database Synchronizer (`scripts/obsidian-bases-synchronizer.js`)**:
  - Establishes Obsidian 1.6+ YAML frontmatter property schemas for AI agent coordination.
  - Auto-generates Notion-like Dataview database tables in `00-Databases/` for Active PRs, Security Gates, Agent Tasks, and Supply Chain Audits.
