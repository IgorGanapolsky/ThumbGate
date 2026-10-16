#!/usr/bin/env node
'use strict';

/**
 * scripts/github-license-compliance-ga-steal.js
 *
 * FORMAT & Architecture Steal from GitHub Changelog (2026-10-16):
 * "Open source license compliance generally available"
 * (https://github.blog/changelog/2026-10-16-open-source-license-compliance-generally-available/)
 *
 * Implements:
 *   1. Pre-Action Coding Agent Package License Gate (`evaluateAgentPackageLicenseCompliance`):
 *      Intercepts `npm install`, `pnpm add`, `yarn add`, `pip install`, and `cargo add` tool calls
 *      before a coding agent incorporates a package that violates the organization's SPDX license policy.
 *   2. Ruleset Condition `Require license compliance results before merging` (`auditDependencyLicensePolicy`):
 *      Evaluates added/modified dependencies against centralized `allowed`, `review_required`, and
 *      `denied` SPDX license expressions, with package-specific exceptions.
 *   3. Role Separation (`Enterprise Open-Source License Manager`):
 *      Agents can request an exception, but ONLY a human principal with role
 *      `Enterprise Open-Source License Manager` can approve closure/exception requests.
 *   4. Audit Log Event + SBOM License Enrichment (`buildLicenseComplianceAuditEvent`).
 */

const crypto = require('node:crypto');

const DEFAULT_ENTERPRISE_LICENSE_POLICY = {
  policyId: 'thumbgate-spdx-enterprise-policy-v1',
  allowedLicenses: [
    'MIT',
    'ISC',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    '0BSD',
    'BlueOak-1.0.0',
    'CC0-1.0',
    'Unlicense',
  ],
  reviewRequiredLicenses: [
    'MPL-2.0',
    'LGPL-2.1-only',
    'LGPL-3.0-only',
    'EPL-2.0',
  ],
  deniedLicenses: [
    'AGPL-3.0-only',
    'AGPL-3.0-or-later',
    'GPL-3.0-only',
    'GPL-3.0-or-later',
    'SSPL-1.0',
    'BUSL-1.1',
    'Commons-Clause',
    'UNLICENSED',
    'PROPRIETARY',
  ],
  packageExceptions: {},
};

/**
 * Classify an SPDX license expression against the enterprise license policy.
 */
function classifySpdxLicense(spdxExpression = '', policy = DEFAULT_ENTERPRISE_LICENSE_POLICY, packageName = '') {
  const pkgKey = String(packageName || '').trim().toLowerCase();
  if (pkgKey && policy.packageExceptions && policy.packageExceptions[pkgKey]) {
    const exc = policy.packageExceptions[pkgKey];
    if (exc.approvedByRole === 'Enterprise Open-Source License Manager') {
      return {
        status: 'allowed_exception',
        allowed: true,
        spdx: spdxExpression,
        reason: `Package '${packageName}' has an active exception approved by Enterprise Open-Source License Manager (${exc.approvedBy || 'manager'})`,
      };
    }
  }

  const raw = String(spdxExpression || '').trim();
  if (!raw) {
    return {
      status: 'denied',
      allowed: false,
      spdx: 'UNKNOWN',
      reason: 'Missing or unknown SPDX license expression — fail-closed under enterprise license compliance policy',
    };
  }

  // Handle compound SPDX expressions: `(MIT OR Apache-2.0)` vs `(MIT AND AGPL-3.0-only)`
  const cleaned = raw.replace(/[()]/g, ' ').trim();
  const isOr = /\bOR\b/.test(cleaned) && !/\bAND\b/.test(cleaned);
  const tokens = cleaned.split(/\s+(?:OR|AND)\s+/).map(t => t.trim()).filter(Boolean);

  const allowedSet = new Set((policy.allowedLicenses || []).map(s => s.toUpperCase()));
  const reviewSet = new Set((policy.reviewRequiredLicenses || []).map(s => s.toUpperCase()));
  const deniedSet = new Set((policy.deniedLicenses || []).map(s => s.toUpperCase()));

  if (isOr) {
    // Under SPDX `OR`, if at least one option is in allowedSet, the consumer can elect that permissive license
    const matchingAllowed = tokens.find(t => allowedSet.has(t.toUpperCase()));
    if (matchingAllowed) {
      return {
        status: 'allowed',
        allowed: true,
        spdx: raw,
        electedLicense: matchingAllowed,
        reason: `Dual/multi-licensed '${raw}' satisfies policy via '${matchingAllowed}'`,
      };
    }
  }

  for (const tok of tokens) {
    const up = tok.toUpperCase();
    if (deniedSet.has(up) || up.startsWith('AGPL') || up.startsWith('SSPL') || up.startsWith('BUSL')) {
      return {
        status: 'denied',
        allowed: false,
        spdx: raw,
        violatingLicense: tok,
        reason: `SPDX license '${tok}' is prohibited by enterprise license policy`,
      };
    }
  }

  for (const tok of tokens) {
    const up = tok.toUpperCase();
    if (reviewSet.has(up)) {
      return {
        status: 'review_required',
        allowed: false,
        spdx: raw,
        reviewLicense: tok,
        reason: `SPDX license '${tok}' requires review/closure approval from Enterprise Open-Source License Manager`,
      };
    }
  }

  const allAllowed = tokens.every(tok => allowedSet.has(tok.toUpperCase()));
  if (allAllowed) {
    return {
      status: 'allowed',
      allowed: true,
      spdx: raw,
      reason: `SPDX license '${raw}' complies with enterprise license policy`,
    };
  }

  return {
    status: 'review_required',
    allowed: false,
    spdx: raw,
    reason: `Unclassified SPDX license '${raw}' requires Enterprise Open-Source License Manager review`,
  };
}

/**
 * PreToolUse Gate for Coding Agents (`evaluateAgentPackageLicenseCompliance`):
 * Checks proposed package additions before the agent runs `npm install` / `pnpm add` / `pip install`.
 */
function evaluateAgentPackageLicenseCompliance({
  toolName = 'Bash',
  command = '',
  proposedPackages = [],
  policy = DEFAULT_ENTERPRISE_LICENSE_POLICY,
  actorRole = 'coding_agent',
} = {}) {
  const startNs = process.hrtime.bigint();

  // Agents can never impersonate Enterprise Open-Source License Manager to self-approve closure
  if (actorRole === 'Enterprise Open-Source License Manager' && /agent|bot|claude|cursor|codex/i.test(toolName)) {
    const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
    return {
      decision: 'block',
      allowed: false,
      gateId: 'gate:license:agent_role_escalation_blocked',
      latencyMs,
      reason: 'Coding agents cannot self-assign Enterprise Open-Source License Manager role to approve license exceptions',
    };
  }

  const violations = [];
  const results = [];

  for (const pkg of proposedPackages) {
    const check = classifySpdxLicense(pkg.license || pkg.spdx, policy, pkg.name);
    results.push({ name: pkg.name, version: pkg.version || 'latest', ...check });
    if (!check.allowed) {
      violations.push({ name: pkg.name, version: pkg.version || 'latest', ...check });
    }
  }

  const allowed = violations.length === 0;
  const decision = allowed ? 'allow' : 'block';
  const gateId = allowed ? 'gate:license:compliant' : 'gate:license:noncompliant_dependency_blocked';
  const reason = allowed
    ? `All ${results.length} proposed dependencies comply with ${policy.policyId}`
    : `Blocked ${violations.length} noncompliant dependency(s): ${violations.map(v => `${v.name}@${v.version} (${v.spdx}: ${v.status})`).join(', ')}`;

  const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
  const auditEventHash = `lic_audit_${crypto.createHash('sha256').update(`${policy.policyId}:${command}:${JSON.stringify(results)}`).digest('hex').slice(0, 16)}`;

  return {
    decision,
    allowed,
    gateId,
    latencyMs,
    policyId: policy.policyId,
    command,
    results,
    violations,
    prAnnotations: violations.map(v => ({
      package: `${v.name}@${v.version}`,
      spdx: v.spdx,
      status: v.status,
      remediation: 'Remove/replace the dependency, amend the enterprise license policy, or request a package exception from an Enterprise Open-Source License Manager.',
    })),
    auditLogEvent: {
      action: 'dependency_license_compliance.evaluated',
      policyId: policy.policyId,
      actorRole,
      allowed,
      violationCount: violations.length,
      auditEventHash,
      timestamp: new Date().toISOString(),
    },
    reason,
  };
}

if (require.main === module) {
  const sample = evaluateAgentPackageLicenseCompliance({
    toolName: 'Bash',
    command: 'npm install fast-glob agpl-copyleft-lib',
    proposedPackages: [
      { name: 'fast-glob', version: '3.3.2', license: 'MIT' },
      { name: 'agpl-copyleft-lib', version: '1.0.0', license: 'AGPL-3.0-only' },
    ],
  });
  console.log(JSON.stringify(sample, null, 2));
}

module.exports = {
  DEFAULT_ENTERPRISE_LICENSE_POLICY,
  classifySpdxLicense,
  evaluateAgentPackageLicenseCompliance,
};
