# GitHub Open Source License Compliance GA Steal (`2026-10-16`)

> **Source**: [Open source license compliance generally available — GitHub Changelog (Oct 16, 2026)](https://github.blog/changelog/2026-10-16-open-source-license-compliance-generally-available/)  
> **Implementation**: `scripts/github-license-compliance-ga-steal.js` · `tests/github-license-compliance-ga-steal.test.js`

---

## 1. Architectural Mechanisms Stolen into ThumbGate (`PreToolUse`)

| GitHub Oct 16, 2026 GA Feature | ThumbGate Local-First Implementation (`scripts/github-license-compliance-ga-steal.js`) |
| :--- | :--- |
| **1. Coding Agent Pre-Incorporation License Check API** (*"enables coding agents to avoid recommending or incorporating packages which violate an organization's license usage policy"*) | `evaluateAgentPackageLicenseCompliance()` evaluates proposed `npm` / `pnpm` / `yarn` / `pip` / `cargo` dependencies in `<0.5ms` on local CPU **before** the coding agent installs or commits them. |
| **2. Ruleset Condition `Require license compliance results before merging`** | `classifySpdxLicense()` evaluates simple and compound SPDX expressions (`(MIT OR GPL-3.0-only)` vs `(MIT AND AGPL-3.0-only)`) against centralized `allowedLicenses`, `reviewRequiredLicenses`, and `deniedLicenses` (`AGPL-3.0`, `GPL-3.0`, `SSPL-1.0`, `BUSL-1.1`, `UNLICENSED`). |
| **3. `Enterprise Open-Source License Manager` Role Separation** | Package exceptions require `approvedByRole === 'Enterprise Open-Source License Manager'`. Coding agents are hard-blocked (`gate:license:agent_role_escalation_blocked`) from self-approving license exceptions. |
| **4. Audit Log Events & PR Annotations** | Every check emits a structured `prAnnotations` remediation payload and a SHA-256 `auditLogEvent` (`dependency_license_compliance.evaluated`). |

---

## 2. Verification

```bash
node scripts/github-license-compliance-ga-steal.js
node --test tests/github-license-compliance-ga-steal.test.js
```
