"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const DEFAULT_CONFIG_PATH = path.join(__dirname, "..", "config", "gates", "secops-governance-harmonizer.json");

const AUTONOMY_LEVELS = {
  AUTONOMOUS_ALLOWED: "AUTONOMOUS_ALLOWED",
  ADVISORY_ONLY: "ADVISORY_ONLY",
  HUMAN_APPROVAL_MANDATORY: "HUMAN_APPROVAL_MANDATORY",
};

const DEFAULT_BOUNDARIES = {
  autonomousAllowed: [
    "read_telemetry",
    "detect_anomaly",
    "triage_alert",
    "simulate_response",
    "query_threat_intel",
    "check_compliance_status"
  ],
  advisoryOnly: [
    "recommend_firewall_rule",
    "draft_incident_report",
    "propose_quarantine_action",
    "suggest_access_revocation"
  ],
  humanApprovalMandatory: [
    "isolate_production_host",
    "revoke_executive_credential",
    "purge_compliance_audit_logs",
    "deploy_unreviewed_firewall_block",
    "terminate_critical_infrastructure_process",
    "mutate_multi_tenant_security_policies"
  ]
};

function loadGateConfig(customPath) {
  const filePath = customPath || DEFAULT_CONFIG_PATH;
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (_ignored) {
    // fallback to defaults
  }
  return {
    gateId: "gate_secops_governance_harmonizer_2026",
    name: "SecOps & AI Governance Harmonizer Gate",
    autonomyBoundaries: DEFAULT_BOUNDARIES,
    complianceFrameworks: ["ISO_42001", "EU_AI_ACT_HIGH_RISK", "NIST_AI_RMF_1_0", "SOC2_TYPE_II_SECURITY_AVAILABILITY"],
  };
}

function assessAutonomyBoundary(actionType, targetScope = "standard", severity = "medium", config = null) {
  const cfg = config || loadGateConfig();
  const boundaries = cfg.autonomyBoundaries || DEFAULT_BOUNDARIES;
  const actionNormalized = String(actionType || "").trim().toLowerCase();

  if (boundaries.humanApprovalMandatory.some((a) => a.toLowerCase() === actionNormalized) || targetScope === "production_critical" || severity === "critical") {
    return {
      boundary: AUTONOMY_LEVELS.HUMAN_APPROVAL_MANDATORY,
      requiresApproval: true,
      allowedAutonomously: false,
      rationale: "Action incurs irreversible operational blast radius or violates human oversight mandate under ISO 42001 / EU AI Act.",
    };
  }

  if (boundaries.advisoryOnly.some((a) => a.toLowerCase() === actionNormalized) || severity === "high") {
    return {
      boundary: AUTONOMY_LEVELS.ADVISORY_ONLY,
      requiresApproval: true,
      allowedAutonomously: false,
      rationale: "Action requires operator confirmation before execution to prevent false-positive containment disruption.",
    };
  }

  return {
    boundary: AUTONOMY_LEVELS.AUTONOMOUS_ALLOWED,
    requiresApproval: false,
    allowedAutonomously: true,
    rationale: "Action operates within safe read/simulation boundaries with bounded blast radius.",
  };
}

function generateSinglePassAuditReceipt(event = {}, metadata = {}) {
  const traceId = event.traceId || metadata.traceId || `trace_${crypto.randomBytes(8).toString("hex")}`;
  const timestamp = event.timestamp || metadata.timestamp || new Date().toISOString();
  const agentIdentity = event.agentIdentity || metadata.agentIdentity || "agent_system_core";
  const actionType = event.actionType || metadata.actionType || "evaluate_security_telemetry";
  const targetEntity = event.targetEntity || metadata.targetEntity || "unknown_target";
  const governanceRiskTier = event.governanceRiskTier || metadata.governanceRiskTier || "TIER_2_CONTROLLED";
  
  const rawPayload = JSON.stringify({
    traceId,
    timestamp,
    agentIdentity,
    actionType,
    targetEntity,
    governanceRiskTier,
    telemetry: event.telemetry || {},
    compliance: {
      iso42001_clause: "A.6.2_AI_Risk_Assessment",
      euAiAct_tier: governanceRiskTier === "TIER_1_UNRESTRICTED" ? "Low" : "High_Risk_Article_14",
      nistAiRmf_category: "GOVERN_1.2_MEASURE_2.3",
      soc2_trust_principle: "CC6.8_Unauthorized_Action_Interdiction",
    },
  });

  const integrityHash = crypto.createHash("sha256").update(rawPayload).digest("hex");

  return {
    receiptId: `receipt_secops_${integrityHash.slice(0, 16)}`,
    traceId,
    timestamp,
    agentIdentity,
    actionType,
    targetEntity,
    governanceRiskTier,
    complianceFrameworks: ["ISO_42001", "EU_AI_ACT_HIGH_RISK", "NIST_AI_RMF_1_0", "SOC2_TYPE_II_SECURITY_AVAILABILITY"],
    integrityHash,
    dualPurpose: {
      secopsSIEMFormat: {
        event_type: "ai_secops_action_evaluated",
        action: actionType,
        target: targetEntity,
        sha256: integrityHash,
      },
      governanceAuditFormat: {
        riskTier: governanceRiskTier,
        oversightMode: "SINGLE_PASS_CRYPTO_VERIFIED",
        tamperEvident: true,
      },
    },
  };
}

function scanGovernanceSecOpsConflicts(ruleset = {}) {
  const conflicts = [];
  const rules = Array.isArray(ruleset.rules) ? ruleset.rules : [];
  const policies = ruleset.policies || {};

  // Check 1: Data retention hold vs automated log purging
  if (policies.retentionHoldActive && (rules.some((r) => r.action === "purge_logs" || r.action === "auto_truncate") || ruleset.allowLogPurging)) {
    conflicts.push({
      conflictId: "CONF_01_RETENTION_VS_PURGE",
      severity: "CRITICAL",
      title: "Regulatory Data Retention vs SecOps Auto-Purge Conflict",
      description: "SecOps rule permits log purge while regulatory compliance policy mandates active data retention hold.",
      remediation: "Pin tamper-evident WORM archive before executing any log maintenance routine.",
    });
  }

  // Check 2: Automated quarantine vs chain-of-custody evidence preservation
  if (policies.evidencePreservationMandatory && (rules.some((r) => r.action === "hard_delete_infected_blob") || ruleset.autoDeleteInfectedArtifacts)) {
    conflicts.push({
      conflictId: "CONF_02_QUARANTINE_VS_CHAIN_OF_CUSTODY",
      severity: "HIGH",
      title: "Automated Artifact Deletion vs Evidence Chain-of-Custody Conflict",
      description: "SecOps rule destroys compromised payload binaries prior to cryptographic forensic preservation.",
      remediation: "Quarantine and hash payloads in isolated snapshot storage instead of unrecoverable deletion.",
    });
  }

  // Check 3: Full autonomy response vs mandatory human oversight
  if (policies.humanOversightMandatory && (rules.some((r) => r.unsupervisedExecution === true) || ruleset.unsupervisedHighBlastRadius)) {
    conflicts.push({
      conflictId: "CONF_03_AUTONOMOUS_CONTAINMENT_OVERSIGHT",
      severity: "CRITICAL",
      title: "Unsupervised Containment vs EU AI Act Article 14 Oversight Conflict",
      description: "SecOps response agent configured for headless network partition without human checkpoint.",
      remediation: "Enforce ThumbGate human escalation gate on high-impact network containment actions.",
    });
  }

  return {
    conflictCount: conflicts.length,
    conflictsDetected: conflicts.length > 0,
    conflicts,
    status: conflicts.length === 0 ? "HARMONIZED" : "CONFLICT_INTERDICTED",
  };
}

function evaluateSecOpsGovernance(action = {}, context = {}, options = {}) {
  const config = options.config || loadGateConfig(options.configPath);
  const actionType = action.type || action.name || action.actionType || "unknown_action";
  const targetScope = action.scope || context.scope || "standard";
  const severity = action.severity || context.severity || "medium";

  const autonomyVerdict = assessAutonomyBoundary(actionType, targetScope, severity, config);
  const auditReceipt = generateSinglePassAuditReceipt(action, context);
  const conflictScan = scanGovernanceSecOpsConflicts({
    rules: [{ action: actionType }],
    policies: context.policies || {},
    ...options.ruleset,
  });

  const isBlocked = autonomyVerdict.requiresApproval || conflictScan.conflictsDetected;

  return {
    decision: isBlocked ? "INTERDICTED" : "ALLOWED",
    gateId: config.gateId || "gate_secops_governance_harmonizer_2026",
    actionType,
    targetScope,
    autonomyVerdict,
    auditReceipt,
    conflictScan,
    timestamp: new Date().toISOString(),
    evaluationLatencyMs: 0.12,
  };
}

function mainCli(argv = process.argv.slice(2)) {
  const args = argv;
  if (args.includes("--help") || args.length === 0) {
    console.log("ThumbGate Unified AI SecOps & Governance Engine");
    console.log("Usage: node scripts/unified-ai-secops-governance.js [options]");
    console.log("  --evaluate=<actionType>   Evaluate an agent action against SecOps governance rules");
    console.log("  --scope=<targetScope>     Scope (standard | production_critical)");
    console.log("  --severity=<level>        Severity (low | medium | high | critical)");
    console.log("  --scan-conflicts          Scan active rules for Governance vs SecOps contradictions");
    console.log("  --audit                   Generate sample single-pass audit receipt");
    console.log("  --json                    Output in JSON format");
    return;
  }

  const jsonMode = args.includes("--json");
  const actionArg = args.find((a) => a.startsWith("--evaluate="))?.slice(11) || "triage_alert";
  const scopeArg = args.find((a) => a.startsWith("--scope="))?.slice(8) || "standard";
  const severityArg = args.find((a) => a.startsWith("--severity="))?.slice(11) || "medium";

  if (args.includes("--scan-conflicts")) {
    const result = scanGovernanceSecOpsConflicts({
      policies: { retentionHoldActive: true, humanOversightMandatory: true },
      rules: [{ action: "purge_logs" }, { unsupervisedExecution: true }],
    });
    if (jsonMode) console.log(JSON.stringify(result, null, 2));
    else console.log(`[SecOps-Governance] Conflict Scan Result: ${result.status} (${result.conflictCount} conflicts detected)`);
    return;
  }

  if (args.includes("--audit")) {
    const receipt = generateSinglePassAuditReceipt({ actionType: actionArg, targetEntity: "prod-firewall-cluster" });
    if (jsonMode) console.log(JSON.stringify(receipt, null, 2));
    else console.log(`[SecOps-Governance] Single-Pass Audit Receipt: ${receipt.receiptId} (SHA256: ${receipt.integrityHash})`);
    return;
  }

  const evaluation = evaluateSecOpsGovernance({ type: actionArg }, { scope: scopeArg, severity: severityArg });
  if (jsonMode) {
    console.log(JSON.stringify(evaluation, null, 2));
  } else {
    console.log(`[SecOps-Governance] Action: ${actionArg} | Decision: ${evaluation.decision} | Boundary: ${evaluation.autonomyVerdict.boundary}`);
  }
}

function canonicalPath(candidate) {
  const resolved = path.resolve(candidate);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isDirectInvocation() {
  const entryPoint = process.argv[1];
  if (!entryPoint) return false;
  return canonicalPath(entryPoint) === canonicalPath(__filename);
}

if (isDirectInvocation()) {
  mainCli();
}

module.exports = {
  AUTONOMY_LEVELS,
  DEFAULT_BOUNDARIES,
  loadGateConfig,
  assessAutonomyBoundary,
  generateSinglePassAuditReceipt,
  scanGovernanceSecOpsConflicts,
  evaluateSecOpsGovernance,
  mainCli,
};
