'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'gates', 'ai-liability-defense.json');

/**
 * Load AI Liability Defense Gate Configuration.
 */
function loadLiabilityConfig(configPath = DEFAULT_CONFIG_PATH) {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    // Return fallback safe config
  }

  return {
    gateId: 'gate_ai_liability_defense_2026',
    name: 'AI Liability Defense & Pre-Action Compliance Gate',
    version: '1.0.0',
    enforcementMode: 'fail_closed',
    rules: [
      { id: 'LIABILITY_01_DESTRUCTIVE_OPS', severity: 'CRITICAL', autonomyLimit: 'L2_GATED_EXECUTION' },
      { id: 'LIABILITY_02_CREDENTIAL_MUTATION', severity: 'CRITICAL', autonomyLimit: 'L2_GATED_EXECUTION' },
      { id: 'LIABILITY_03_FINANCIAL_DISPATCH', severity: 'CRITICAL', autonomyLimit: 'L2_GATED_EXECUTION' },
      { id: 'LIABILITY_04_PUBLIC_RELEASE_DEPLOY', severity: 'HIGH', autonomyLimit: 'L3_AUTONOMOUS_BOUNDED' },
      { id: 'LIABILITY_05_EU_AI_ACT_RECORDKEEPING', severity: 'HIGH', autonomyLimit: 'L3_AUTONOMOUS_BOUNDED' }
    ],
    governance: {
      jurisdictions: ['EU_AI_ACT', 'SEC_RULE_33_11216', 'DORA_ART_30', 'FTC_ACT_SEC_5'],
      dualKeyRequiredSeverities: ['CRITICAL'],
      retentionDays: 180
    }
  };
}

/**
 * Evaluate action payload for legal/executive liability risk and regulatory compliance.
 *
 * @param {Object} action - Action descriptor { type, target, command, parameters, agentIdentity, sessionScope }
 * @param {Object} options - Evaluation options { configPath, strictMode, operatorApproved }
 * @returns {Object} Evaluation verdict { allowed, verdict, riskScore, severity, requiredAutonomy, dualKeyRequired, matchedRules, complianceObligations }
 */
function evaluateActionLiability(action = {}, options = {}) {
  const config = loadLiabilityConfig(options.configPath);
  const strictMode = options.strictMode !== undefined ? options.strictMode : (config.enforcementMode === 'fail_closed');
  
  const cmd = String(action.command || action.target || action.type || '').toLowerCase();
  const matchedRules = [];
  let severity = 'LOW';
  let requiredAutonomy = 'L4_UNRESTRICTED';

  // Rule 1: Destructive Ops (rm -rf, DROP TABLE, git reset --hard, truncate)
  if (/\b(rm\s+-rf|drop\s+table|drop\s+database|git\s+reset\s+--hard|truncate|fdisk|mkfs)\b/i.test(cmd)) {
    matchedRules.push('LIABILITY_01_DESTRUCTIVE_OPS');
    severity = 'CRITICAL';
    requiredAutonomy = 'L2_GATED_EXECUTION';
  }

  // Rule 2: Credential Mutation (env token overwrite, ssh key injection, IAM role change)
  if (/\b(ssh-keygen|authorized_keys|aws\s+iam|chmod\s+777|chown\s+root|export\s+.*token=)\b/i.test(cmd) ||
      action.type === 'CREDENTIAL_ROTATION' || action.type === 'IAM_ELEVATION') {
    matchedRules.push('LIABILITY_02_CREDENTIAL_MUTATION');
    severity = 'CRITICAL';
    requiredAutonomy = 'L2_GATED_EXECUTION';
  }

  // Rule 3: Financial Dispatch (stripe charge, payout, crypto transfer, wire)
  if (/\b(stripe\s+(payouts|charges|transfers)|wire\s+transfer|wallet\s+send)\b/i.test(cmd) ||
      action.type === 'FINANCIAL_TRANSACTION') {
    matchedRules.push('LIABILITY_03_FINANCIAL_DISPATCH');
    severity = 'CRITICAL';
    requiredAutonomy = 'L2_GATED_EXECUTION';
  }

  // Rule 4: Public Release / Deploy (npm publish, git push origin main, railway up, vercel --prod)
  if (/\b(npm\s+publish|git\s+push.*main|railway\s+up|vercel\s+--prod|docker\s+push)\b/i.test(cmd) ||
      action.type === 'PRODUCTION_DEPLOY') {
    matchedRules.push('LIABILITY_04_PUBLIC_RELEASE_DEPLOY');
    if (severity !== 'CRITICAL') {
      severity = 'HIGH';
      requiredAutonomy = 'L3_AUTONOMOUS_BOUNDED';
    }
  }

  // Rule 5: EU AI Act High-Risk Surface Recordkeeping
  if (action.highRiskDomain || action.classification === 'HIGH_RISK' || matchedRules.length > 0) {
    matchedRules.push('LIABILITY_05_EU_AI_ACT_RECORDKEEPING');
    if (severity === 'LOW') {
      severity = 'MEDIUM';
      requiredAutonomy = 'L3_AUTONOMOUS_BOUNDED';
    }
  }

  const dualKeyRequired = config.governance.dualKeyRequiredSeverities.includes(severity);
  const operatorApproved = Boolean(options.operatorApproved || action.operatorSignature);

  let allowed = true;
  let verdict = 'ALLOW';

  if (dualKeyRequired && !operatorApproved) {
    allowed = false;
    verdict = 'DENY_DUAL_KEY_REQUIRED';
  } else if (severity === 'CRITICAL' && !operatorApproved && strictMode) {
    allowed = false;
    verdict = 'DENY_EXECUTIVE_LIABILITY_RISK';
  } else if (matchedRules.length > 0 && !operatorApproved) {
    verdict = 'WARN_AUDIT_REQUIRED';
  }

  const riskScore = severity === 'CRITICAL' ? 95 : severity === 'HIGH' ? 70 : severity === 'MEDIUM' ? 40 : 10;

  const complianceObligations = {
    euAiAct: {
      article12_recordKeeping: true,
      article14_humanOversight: dualKeyRequired,
      retentionMonths: 6
    },
    secItem105: {
      materialityAssessmentRequired: severity === 'CRITICAL',
      fourDayDisclosureTrigger: false
    },
    doraArt30: {
      thirdPartyAuditTrail: true,
      immutableLogRequired: true
    },
    cisoDefenseWarranty: {
      safeHarborEligible: allowed || operatorApproved,
      preActionGateEnforced: true
    }
  };

  return {
    gateId: config.gateId,
    timestamp: new Date().toISOString(),
    allowed,
    verdict,
    riskScore,
    severity,
    requiredAutonomy,
    dualKeyRequired,
    operatorApproved,
    matchedRules,
    complianceObligations
  };
}

/**
 * Generate a cryptographically hashed, immutable Pre-Action Liability Proof Receipt.
 *
 * @param {Object} action - Action descriptor
 * @param {Object} evaluation - Output from evaluateActionLiability
 * @param {Object} operatorContext - Context including agent identity, signature key
 * @returns {Object} Signed LiabilityProofReceipt
 */
function generateLiabilityReceipt(action = {}, evaluation = {}, operatorContext = {}) {
  const payloadToHash = {
    actionType: action.type || 'EXECUTE',
    command: action.command || action.target || '',
    agentIdentity: action.agentIdentity || operatorContext.agentIdentity || 'ThumbGate-Autonomous-Agent',
    sessionScope: action.sessionScope || operatorContext.sessionScope || 'default',
    evaluationVerdict: evaluation.verdict,
    riskScore: evaluation.riskScore,
    severity: evaluation.severity,
    timestamp: evaluation.timestamp || new Date().toISOString()
  };

  const payloadString = JSON.stringify(payloadToHash, Object.keys(payloadToHash).sort());
  const receiptHash = crypto.createHash('sha256').update(payloadString).digest('hex');

  return {
    receiptId: `rcpt_liab_${Date.now()}_${receiptHash.slice(0, 8)}`,
    version: '2026-08-DEFENSE',
    gateId: evaluation.gateId || 'gate_ai_liability_defense_2026',
    payloadHash: receiptHash,
    action: payloadToHash,
    evaluation: {
      allowed: evaluation.allowed,
      verdict: evaluation.verdict,
      riskScore: evaluation.riskScore,
      severity: evaluation.severity,
      matchedRules: evaluation.matchedRules || [],
      dualKeyRequired: evaluation.dualKeyRequired || false,
      operatorApproved: evaluation.operatorApproved || false
    },
    complianceWarranty: evaluation.complianceObligations || {},
    proofSignature: crypto.createHmac('sha256', operatorContext.signingSecret || 'thumbgate-liability-anchor')
      .update(receiptHash)
      .digest('hex')
  };
}

/**
 * Verify integrity and authenticity of a LiabilityProofReceipt.
 *
 * @param {Object} receipt - LiabilityProofReceipt
 * @param {string} signingSecret - Secret key used for signature
 * @returns {boolean} True if intact and valid
 */
function verifyLiabilityReceipt(receipt = {}, signingSecret = 'thumbgate-liability-anchor') {
  if (!receipt || !receipt.payloadHash || !receipt.action || !receipt.proofSignature) {
    return false;
  }

  const expectedPayloadString = JSON.stringify(receipt.action, Object.keys(receipt.action).sort());
  const expectedHash = crypto.createHash('sha256').update(expectedPayloadString).digest('hex');

  if (expectedHash !== receipt.payloadHash) {
    return false;
  }

  const expectedSignature = crypto.createHmac('sha256', signingSecret)
    .update(receipt.payloadHash)
    .digest('hex');

  return expectedSignature === receipt.proofSignature;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let actionJson = {};
  if (args.length > 0 && args[0].startsWith('{')) {
    try { actionJson = JSON.parse(args[0]); } catch (e) {}
  } else {
    actionJson = { command: args.join(' ') || 'status' };
  }

  const evalResult = evaluateActionLiability(actionJson);
  const receipt = generateLiabilityReceipt(actionJson, evalResult);
  console.log(JSON.stringify({ evaluation: evalResult, receipt }, null, 2));
}

module.exports = {
  loadLiabilityConfig,
  evaluateActionLiability,
  generateLiabilityReceipt,
  verifyLiabilityReceipt
};
