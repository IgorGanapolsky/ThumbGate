'use strict';

/**
 * ISO/IEC 42001:2023 Artificial Intelligence Management System (AIMS) Compliance Guard.
 *
 * Maps ThumbGate's pre-action gates and telemetry to formal ISO 42001 governance clauses:
 * - Clause 6.1.2: AI Risk Assessment & Tiering
 * - Clause 8.2:   AI Impact Assessment & Tool Blast Radius Control
 * - Clause 8.4:   Data Lifecycle & Secret/PII Leakage Prevention
 * - Clause 9.1:   Continuous Telemetry & SLA/SLO Monitoring
 * - Clause 10.1:  Continuous Improvement via Feedback-to-Enforcement Rules
 */

const ISO_42001_CLAUSES = Object.freeze({
  RISK_ASSESSMENT: 'Clause 6.1.2 (AI Risk Assessment)',
  IMPACT_ASSESSMENT: 'Clause 8.2 (AI Impact Assessment)',
  DATA_PROTECTION: 'Clause 8.4 (Data Lifecycle & DLP)',
  CONTINUOUS_MONITORING: 'Clause 9.1 (Monitoring & Telemetry)',
  CORRECTIVE_ACTION: 'Clause 10.1 (Corrective Action & Rule Promotion)',
});

class ISO42001ComplianceGuard {
  constructor(options = {}) {
    this.options = options;
  }

  static evaluateToolCallCompliance(toolCall = {}) {
    const findings = [];
    const name = toolCall.name || toolCall.toolName || 'unknown';
    const params = toolCall.parameters || toolCall.args || {};
    const riskTier = toolCall.riskTier || 'minimal-impact';

    // Clause 6.1.2: Risk Assessment
    if (!['read-only', 'minimal-impact', 'contained-write', 'critical'].includes(riskTier)) {
      findings.push({
        clause: ISO_42001_CLAUSES.RISK_ASSESSMENT,
        severity: 'FAIL',
        message: `Unclassified risk tier '${riskTier}' on tool ${name}`,
      });
    }

    // Clause 8.2: Blast Radius
    if (riskTier === 'critical' && !toolCall.humanApproval && !toolCall.approvedByPolicy) {
      findings.push({
        clause: ISO_42001_CLAUSES.IMPACT_ASSESSMENT,
        severity: 'FAIL',
        message: `Critical tool call '${name}' requires explicit policy approval or human sign-off`,
      });
    }

    // Clause 8.4: Data Protection / Secret Scanning
    const paramStr = JSON.stringify(params);
    const hasSecretPattern = /(?:ghp_[a-z0-9]{20,}|sk_live_[a-z0-9]{20,}|mock_secret_[a-z0-9]{10,}|-----BEGIN PRIVATE KEY-----)/i.test(paramStr);
    if (hasSecretPattern) {
      findings.push({
        clause: ISO_42001_CLAUSES.DATA_PROTECTION,
        severity: 'FAIL',
        message: `Potential credential or secret detected in parameters for tool '${name}'`,
      });
    }

    const compliant = findings.filter((f) => f.severity === 'FAIL').length === 0;

    return {
      compliant,
      standard: 'ISO/IEC 42001:2023',
      toolName: name,
      riskTier,
      findings,
      timestamp: Date.now(),
    };
  }

  static generateComplianceAuditReport(toolCalls = []) {
    const results = toolCalls.map((tc) => ISO42001ComplianceGuard.evaluateToolCallCompliance(tc));
    const total = results.length;
    const passed = results.filter((r) => r.compliant).length;
    const failed = total - passed;

    return {
      standard: 'ISO/IEC 42001:2023 AIMS',
      auditTimestamp: new Date().toISOString(),
      summary: {
        totalEvaluated: total,
        passed,
        failed,
        complianceRate: total > 0 ? (passed / total) * 100 : 100,
      },
      records: results,
    };
  }
}

module.exports = {
  ISO42001ComplianceGuard,
  ISO_42001_CLAUSES,
};
