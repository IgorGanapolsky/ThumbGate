---
name: ideabrowser-connector
description: Secure IdeaBrowser agent connector with read-only vs mutating classification, zero plaintext credentials, and fail-closed pre-action diodes. Closes ThumbGate issue #3823.
---

# IdeaBrowser Agent Connector & Governance Diode

> **Issue #3823 Resolution Reference**: Implements a hardened IdeaBrowser connector for ThumbGate without credential leakage, classifying all actions into read-only or mutating tiers.

---

## 🛡️ Security & Governance Invariants

1. **Zero Plaintext Credentials**:
   - Connector tokens/secrets must **never** be stored in tracked repository files or plaintext configuration files.
   - Resolve credentials via authenticated environment variables (`IDEABROWSER_API_KEY`) or secure secret storage.

2. **Strict Tool Classification**:
   - Every discovered tool/action from IdeaBrowser must be classified into one of two operational tiers:
     - `read-only`: Information gathering, DOM inspection, status query, screenshot, URL retrieval. Allowed by default.
     - `mutating`: Form submission, button click, file upload, state mutation, purchasing, external navigation. Gated by ThumbGate pre-action interdiction.
   - **Fail-Closed on Provider Drift**: Any newly introduced or unclassified tool defaults immediately to `mutating` and triggers a gate check.

3. **Pre-Action Interdiction**:
   - Before executing any `mutating` tool, `executeTool` evaluates:
     - Target domain against configured allowlist (empty allowlist fails closed).
     - Caller-provided `context.blocked` flag (upstream policy is responsible for evaluating blast radius, authorization, and scope state to set `context.blocked`).
   - All interdiction event payloads recursively redact sensitive keys, query parameters, and error reasons before notifying listeners.
