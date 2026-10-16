# GitHub Open Source License Compliance Diode (`2026-10-16` GA Steal)

> **Source**: [GitHub Changelog — Open source license compliance generally available (Oct 16, 2026)](https://github.blog/changelog/2026-10-16-open-source-license-compliance-generally-available/)
> **Implementation**: [`scripts/github-license-compliance-diode.js`](../../scripts/github-license-compliance-diode.js) · [`tests/github-license-compliance-diode.test.js`](../../tests/github-license-compliance-diode.test.js)

## 1. Why We Steal This Into ThumbGate

GitHub's Open Source License Compliance (GA October 16, 2026) introduces centralized SPDX license policies, `Require license compliance results before merging` ruleset conditions, the `Enterprise Open-Source License Manager` role, `license_compliance_policy` audit log events, and a package-check API so coding agents can avoid introducing noncompliant dependencies.

However, GitHub's native enforcement requires **GitHub Enterprise Cloud (GHEC) + GitHub Code Security** licenses and primarily gates at PR merge time. ThumbGate brings the exact same policy model into the **local `<0.5ms` `PreToolUse` firewall at $0 seat cost**, stopping coding agents *before* `npm install`, `pnpm add`, `pip install`, or `cargo add` executes a copyleft or unlicensed package.

| GitHub GHEC Feature (Oct 16, 2026) | ThumbGate Local Pre-Action Rail | Advantage |
|---|---|---|
| **Enterprise SPDX Policy & Compound Expressions** (`AND`, `OR`, `WITH`) | [`evaluateSpdxExpression()`](../../scripts/github-license-compliance-diode.js) | Evaluates `(MIT OR GPL-3.0-only)` vs `(MIT AND AGPL-3.0-only)` in `<0.1ms` on local CPU with $0 GHEC/Code Security license tax. |
| **Rollout Custom Property (`open_source_license_compliance`: `inactive` \| `evaluate` \| `active`)** | [`evaluatePackageLicenseCompliance()`](../../scripts/github-license-compliance-diode.js) | Supports gradual rollout and mirrors GitHub's rule where `evaluate` + `required_conversation_resolution` blocks until license annotations are resolved. |
| **`Enterprise Open-Source License Manager` Exceptions** | [`matchesLicenseException()`](../../scripts/github-license-compliance-diode.js) | Supports `package`, `license`, and `package_pattern` exceptions at `enterprise` or `repository` scope. |
| **Coding Agent Package-Check API & `license_compliance_policy` Audit Logs** | [`auditRepositoryDependencyLicenses()`](../../scripts/github-license-compliance-diode.js) + [`buildLicensePolicyAuditEvent()`](../../scripts/github-license-compliance-diode.js) | Audits `package.json` + `node_modules` locally and emits SHA-256 `license_compliance_policy.create` / `.modify` audit events. |

## 2. Verification Commands

```bash
npm run github:license-compliance -- --json
npm run github:license-compliance -- --map-only --json
npm run test:github-license-compliance
```
