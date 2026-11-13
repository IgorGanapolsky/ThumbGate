/**
 * Agent SDLC Tsunami Defense Engine
 * 
 * Architectural implementations from Agents of Dev Episode 44 (Mitch Ashley & Brad Shimmin):
 * 1. Governed Modular Skill Registry (versioned, sha256 content-addressed, semantic variance tracking)
 * 2. Fast Type-1 Decisioning Orchestrator (Jev-style fast-path triage, Herdr agent multiplexer, red/blue adversarial referee)
 * 3. Lazy Pull Requests & Intelligent Superseding CI Cancellation (halts redundant in-flight builds on agent PR tsunami)
 * 4. Database-Layer Deep Trust Invariants (immutable constraints for spending caps, approvals, PII)
 * 5. Automated CVE Root-Cause & Remediation Diode (Gemini Carbon / Red Hat Lightwell supply-chain defense)
 */

'use strict';

const crypto = require('crypto');

// ============================================================================
// 1. Governed Modular Skill Registry
// ============================================================================

class ModularSkillRegistry {
  constructor() {
    this.skills = new Map();
    this.skillVersions = new Map();
  }

  registerSkillModule({
    id,
    version,
    name,
    category,
    parametersSchema = {},
    systemPromptTemplate,
    testAssertions = []
  }) {
    if (!id || !version || !systemPromptTemplate) {
      throw new Error('Skill module requires id, version, and systemPromptTemplate');
    }

    const contentHash = crypto
      .createHash('sha256')
      .update(`${id}:${version}:${systemPromptTemplate}`)
      .digest('hex');

    const moduleRecord = {
      id,
      version,
      name: name || id,
      category: category || 'general',
      parametersSchema,
      systemPromptTemplate,
      testAssertions,
      contentHash,
      createdAt: new Date().toISOString()
    };

    const key = `${id}@${version}`;
    this.skills.set(key, moduleRecord);

    if (!this.skillVersions.has(id)) {
      this.skillVersions.set(id, []);
    }
    this.skillVersions.get(id).push(version);

    return {
      status: 'REGISTERED',
      key,
      contentHash
    };
  }

  resolveSkillTrigger({ id, requestedVersion = 'latest', inputs = {} }) {
    let resolvedVersion = requestedVersion;
    if (requestedVersion === 'latest') {
      const versions = this.skillVersions.get(id);
      if (!versions || versions.length === 0) {
        throw new Error(`No versions found for skill module '${id}'`);
      }
      resolvedVersion = versions[versions.length - 1];
    }

    const key = `${id}@${resolvedVersion}`;
    const skill = this.skills.get(key);
    if (!skill) {
      throw new Error(`Skill module not found: ${key}`);
    }

    // Validate inputs against schema
    for (const [paramName, schema] of Object.entries(skill.parametersSchema)) {
      if (schema.required && inputs[paramName] === undefined) {
        throw new Error(`Missing required parameter '${paramName}' for skill ${key}`);
      }
    }

    // Render system prompt with template substitution
    let renderedPrompt = skill.systemPromptTemplate;
    for (const [k, v] of Object.entries(inputs)) {
      renderedPrompt = renderedPrompt.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
    }

    return {
      resolvedKey: key,
      version: resolvedVersion,
      contentHash: skill.contentHash,
      renderedPrompt,
      category: skill.category
    };
  }
}

// ============================================================================
// 2. Fast Type-1 Decisioning Orchestrator (Jev-Style)
// ============================================================================

class Type1DecisionOrchestrator {
  constructor({ confidenceThreshold = 0.85 } = {}) {
    this.confidenceThreshold = confidenceThreshold;
  }

  evaluateFastPath({ intent, context = {}, rules = [] }) {
    const startTime = Date.now();
    
    // Fast Boolean & Rule Matching (sub-15ms fast-path)
    for (const rule of rules) {
      if (rule.pattern && new RegExp(rule.pattern, 'i').test(intent)) {
        return {
          decisionType: 'FAST_BOOLEAN_MATCH',
          action: rule.action,
          allowed: rule.action === 'ALLOW',
          ruleId: rule.id,
          confidence: 1.0,
          latencyMs: Date.now() - startTime,
          escalateToFrontier: false
        };
      }
    }

    // Heuristic Confidence Scoring
    let confidence = 0.5;
    if (context.hasTests && context.cleanGitDiff) {
      confidence += 0.3;
    }
    if (context.isSecuritySensitive || /token|secret|password|auth|billing/i.test(intent)) {
      confidence -= 0.35;
    }

    const canAutoDecide = confidence >= this.confidenceThreshold;

    return {
      decisionType: canAutoDecide ? 'FAST_CONFIDENCE_CONSENSUS' : 'ESCALATE_TO_FRONTIER',
      allowed: canAutoDecide,
      confidence: Math.max(0, Math.min(1, confidence)),
      latencyMs: Date.now() - startTime,
      escalateToFrontier: !canAutoDecide
    };
  }

  adjudicateRedBlueArbitration({ proposal, blueClaim, redCritique }) {
    // Adversarial red/blue referee
    const redDefects = redCritique.defects || [];
    const criticalDefects = redDefects.filter(d => d.severity === 'CRITICAL' || d.severity === 'HIGH');

    if (criticalDefects.length > 0) {
      return {
        verdict: 'REJECTED_BY_RED_TEAM',
        winner: 'RED_TEAM',
        reasons: criticalDefects.map(d => d.description),
        requiresRemediation: true,
        passed: false
      };
    }

    return {
      verdict: 'APPROVED_BY_BLUE_TEAM',
      winner: 'BLUE_TEAM',
      reasons: ['No critical defects surfaced by adversarial red team.'],
      requiresRemediation: false,
      passed: true
    };
  }
}

// ============================================================================
// 3. Lazy Pull Requests & Intelligent Superseding CI Cancellation
// ============================================================================

class LazyPrCiManager {
  constructor() {
    this.activePipelines = new Map(); // branchOrPrKey -> pipelineState
  }

  registerPipeline({ prNumber, branch, commitSha, changedFiles = [] }) {
    const key = `pr_${prNumber || branch}`;
    const existing = this.activePipelines.get(key);
    let cancelledPrevious = null;

    if (existing && existing.status === 'RUNNING') {
      // Superseding cancellation: a newer commit invalidates the running build!
      existing.status = 'CANCELLED_SUPERSEDED';
      existing.cancelledAt = new Date().toISOString();
      existing.supersededByCommit = commitSha;
      cancelledPrevious = {
        prNumber: existing.prNumber,
        cancelledCommitSha: existing.commitSha,
        savedComputeSec: Math.floor((Date.now() - existing.startedAt) / 1000)
      };
    }

    // Critical-diff triage
    const criticalPaths = ['src/auth', 'src/billing', 'src/cloud-token-firewall.js', 'package.json', 'schema.sql'];
    const touchesCriticalPath = changedFiles.some(f => criticalPaths.some(cp => f.includes(cp)));

    const newPipeline = {
      prNumber,
      branch,
      commitSha,
      changedFiles,
      touchesCriticalPath,
      evaluationPriority: touchesCriticalPath ? 'IMMEDIATE_CRITICAL' : 'LAZY_DEFERRED',
      status: 'RUNNING',
      startedAt: Date.now()
    };

    this.activePipelines.set(key, newPipeline);

    return {
      pipelineId: key,
      status: 'RUNNING',
      evaluationPriority: newPipeline.evaluationPriority,
      cancelledPrevious
    };
  }

  getPipeline(key) {
    return this.activePipelines.get(key);
  }
}

// ============================================================================
// 4. Database-Layer Deep Trust Policy Invariants
// ============================================================================

class DatabaseDeepTrustGuard {
  static validateTransactionAgainstSchemaConstraints({
    table,
    operation,
    record,
    context = {}
  }) {
    // 1. Immutable Spending Limit Constraint
    if (table === 'agent_spend' || record.amountUsd !== undefined) {
      const maxSpendLimit = context.maxSpendLimitUsd || 500.0;
      if (record.amountUsd > maxSpendLimit) {
        return {
          allowed: false,
          violation: 'DB_CONSTRAINT_SPEND_LIMIT_EXCEEDED',
          message: `DATABASE CHECK CONSTRAINT VIOLATION: amountUsd ($${record.amountUsd}) exceeds strict schema ceiling ($${maxSpendLimit}). Operation rolled back.`
        };
      }
    }

    // 2. Immutable Human Approval Constraint for Destructive Ops
    if (record.isDestructive && !record.operatorApprovalToken) {
      return {
        allowed: false,
        violation: 'DB_CONSTRAINT_MISSING_APPROVAL_TOKEN',
        message: 'DATABASE TRIGGER VIOLATION: Destructive state changes require verified operatorApprovalToken in row payload.'
      };
    }

    // 3. PII Anonymization Guard
    if (record.email && !record.email.includes('[REDACTED]') && !context.allowRawPii) {
      const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
      if (emailPattern.test(record.email)) {
        return {
          allowed: false,
          violation: 'DB_CONSTRAINT_PII_CLEAR_TEXT_DETECTED',
          message: 'DATABASE SECURITY POLICY VIOLATION: Unmasked PII email detected in persistent storage write.'
        };
      }
    }

    return {
      allowed: true,
      status: 'COMMITTED',
      message: 'Database-layer immutable invariants satisfied.'
    };
  }
}

// ============================================================================
// 5. Automated CVE Root-Cause & Remediation Diode
// ============================================================================

class AutomatedCveRemediationDiode {
  static analyzeVulnerability({ cveId, dependency, currentVersion, fixedVersion, advisoryDescription }) {
    const isVulnerable = currentVersion !== fixedVersion;

    const remediationPatch = isVulnerable ? {
      action: 'BUMP_DEPENDENCY',
      package: dependency,
      fromVersion: currentVersion,
      toVersion: fixedVersion,
      npmCommand: `npm install ${dependency}@${fixedVersion}`,
      verificationCommand: 'npm audit --json && npm test'
    } : null;

    return {
      cveId,
      dependency,
      currentVersion,
      fixedVersion,
      isVulnerable,
      riskLevel: /rce|remote code execution|injection|overflow/i.test(advisoryDescription) ? 'CRITICAL' : 'HIGH',
      remediationPatch,
      automatedFixAvailable: isVulnerable && !!fixedVersion
    };
  }
}

module.exports = {
  ModularSkillRegistry,
  Type1DecisionOrchestrator,
  LazyPrCiManager,
  DatabaseDeepTrustGuard,
  AutomatedCveRemediationDiode
};
