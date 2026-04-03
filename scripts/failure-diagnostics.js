'use strict';

const {
  loadGatesConfig,
  loadConstraints,
} = require('./gates-engine');
const {
  REQUIRED_PROOF_COMMANDS,
  runWorkflowContractValidation,
} = require('./validate-workflow-contract');

const FAILURE_CATEGORIES = Object.freeze([
  'invalid_invocation',
  'tool_output_misread',
  'intent_plan_misalignment',
  'guardrail_triggered',
  'system_failure',
]);

const COMPLETION_CLAIM_PATTERN = /\b(done|completed|complete|verified|ready|shipped|resolved)\b/i;
const OUTPUT_MISREAD_PATTERN = /\b(claimed|assumed|fabricated|fake|without tests|without evidence|without verification|skipped tests|skipped verification)\b/i;

function safeLoadGatesConfig() {
  try {
    return loadGatesConfig();
  } catch {
    return { version: 1, gates: [] };
  }
}

function safeLoadConstraints() {
  try {
    return loadConstraints();
  } catch {
    return {};
  }
}

function safeWorkflowContract(projectRoot) {
  try {
    return runWorkflowContractValidation(projectRoot ? { projectRoot } : {});
  } catch {
    return {
      ok: false,
      requiredProofCommands: REQUIRED_PROOF_COMMANDS.slice(),
      issues: [],
    };
  }
}

function normalizeViolation(source, constraintId, message, extra = {}) {
  return {
    source,
    constraintId,
    message,
    ...extra,
  };
}

function summarizeToolSchema(tool) {
  const schema = tool && tool.inputSchema ? tool.inputSchema : {};
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties
    : {};
  const enumFields = Object.entries(properties)
    .filter(([, value]) => value && Array.isArray(value.enum))
    .map(([key, value]) => ({ field: key, values: value.enum.slice() }));

  return {
    name: tool.name,
    required: Array.isArray(schema.required) ? schema.required.slice() : [],
    enumFields,
  };
}

function compileFailureConstraints(options = {}) {
  const gateConfig = options.gateConfig || safeLoadGatesConfig();
  const sessionConstraints = options.sessionConstraints || safeLoadConstraints();
  const workflowContract = options.workflowContract || safeWorkflowContract(options.projectRoot);
  const toolSchemas = Array.isArray(options.toolSchemas)
    ? options.toolSchemas.map(summarizeToolSchema)
    : [];
  const intentPlan = options.intentPlan || null;
  const allowedToolNames = Array.isArray(options.allowedToolNames)
    ? options.allowedToolNames.slice()
    : null;
  const mcpProfile = options.mcpProfile || null;

  return {
    generatedAt: new Date().toISOString(),
    toolSchemas,
    mcpPolicy: mcpProfile
      ? {
        profile: mcpProfile,
        allowedToolNames: allowedToolNames || [],
      }
      : null,
    gatePolicies: Array.isArray(gateConfig.gates)
      ? gateConfig.gates.map((gate) => ({
        id: gate.id,
        action: gate.action,
        pattern: gate.pattern,
        severity: gate.severity || 'unknown',
        when: gate.when || null,
      }))
      : [],
    sessionConstraints: Object.entries(sessionConstraints).map(([key, value]) => ({
      key,
      value: value && Object.prototype.hasOwnProperty.call(value, 'value') ? value.value : value,
    })),
    workflowContract: {
      ok: workflowContract.ok === true,
      requiredProofCommands: Array.isArray(workflowContract.requiredProofCommands)
        ? workflowContract.requiredProofCommands.slice()
        : REQUIRED_PROOF_COMMANDS.slice(),
      issues: Array.isArray(workflowContract.issues) ? workflowContract.issues.slice(0, 10) : [],
    },
    approvalRules: intentPlan
      ? {
        intentId: intentPlan.intent && intentPlan.intent.id ? intentPlan.intent.id : intentPlan.intentId || null,
        status: intentPlan.status || null,
        requiresApproval: intentPlan.requiresApproval === true,
        checkpoint: intentPlan.checkpoint || null,
        approved: intentPlan.approved === true,
      }
      : null,
    summary: {
      toolSchemaCount: toolSchemas.length,
      gatePolicyCount: Array.isArray(gateConfig.gates) ? gateConfig.gates.length : 0,
      sessionConstraintCount: Object.keys(sessionConstraints).length,
      workflowProofCommandCount: Array.isArray(workflowContract.requiredProofCommands)
        ? workflowContract.requiredProofCommands.length
        : REQUIRED_PROOF_COMMANDS.length,
      mcpAllowedToolCount: allowedToolNames ? allowedToolNames.length : null,
      approvalRuleCount: intentPlan ? 1 : 0,
    },
  };
}

function findToolPolicyViolations(toolName, compiledConstraints) {
  const mcpPolicy = compiledConstraints && compiledConstraints.mcpPolicy
    ? compiledConstraints.mcpPolicy
    : null;
  if (!toolName || !mcpPolicy || !Array.isArray(mcpPolicy.allowedToolNames)) {
    return [];
  }
  if (mcpPolicy.allowedToolNames.includes(toolName)) {
    return [];
  }
  return [
    normalizeViolation(
      'mcp_policy',
      `mcp_profile:${mcpPolicy.profile}:${toolName}`,
      `Tool "${toolName}" is not allowed in MCP profile "${mcpPolicy.profile}".`,
      {
        profile: mcpPolicy.profile,
      },
    ),
  ];
}

function findToolSchemaViolations(toolName, toolArgs, toolSchemas, options = {}) {
  if (!toolName || !Array.isArray(toolSchemas) || toolSchemas.length === 0) {
    return [];
  }

  const schema = toolSchemas.find((tool) => tool.name === toolName);
  if (!schema) {
    if (options.skipMissingSchema === true) {
      return [];
    }
    return [
      normalizeViolation(
        'mcp_schema',
        `tool:${toolName}`,
        `Tool "${toolName}" is not registered in the MCP schema catalog.`,
      ),
    ];
  }

  const args = toolArgs && typeof toolArgs === 'object' && !Array.isArray(toolArgs)
    ? toolArgs
    : {};
  const violations = [];

  for (const required of schema.required || []) {
    const value = args[required];
    if (value === undefined || value === null || value === '') {
      violations.push(
        normalizeViolation(
          'mcp_schema',
          `tool:${toolName}:required:${required}`,
          `Tool "${toolName}" is missing required argument "${required}".`,
        ),
      );
    }
  }

  for (const entry of schema.enumFields || []) {
    if (!Object.prototype.hasOwnProperty.call(args, entry.field)) continue;
    if (!entry.values.includes(args[entry.field])) {
      violations.push(
        normalizeViolation(
          'mcp_schema',
          `tool:${toolName}:enum:${entry.field}`,
          `Tool "${toolName}" received invalid value for "${entry.field}".`,
          {
            expected: entry.values,
            actual: args[entry.field],
          },
        ),
      );
    }
  }

  return violations;
}

function findVerificationViolations(verification) {
  if (!verification || !Array.isArray(verification.violations)) {
    return [];
  }

  return verification.violations.map((violation, index) => normalizeViolation(
    'verification',
    violation.ruleSource || `verification:${index}`,
    violation.avoidRule || violation.pattern || 'Verification rule triggered.',
    {
      matchedKeywords: Array.isArray(violation.matchedKeywords) ? violation.matchedKeywords.slice() : [],
      pattern: violation.pattern || null,
    },
  ));
}

function findApprovalViolations(intentPlan) {
  if (!intentPlan || intentPlan.requiresApproval !== true) {
    return [];
  }

  if (intentPlan.status === 'ready' || intentPlan.approved === true) {
    return [];
  }

  return [
    normalizeViolation(
      'approval_rule',
      `intent:${intentPlan.intent && intentPlan.intent.id ? intentPlan.intent.id : intentPlan.intentId || 'unknown'}`,
      `Intent is blocked on approval checkpoint "${intentPlan.checkpoint || 'approval_required'}".`,
      {
        status: intentPlan.status || null,
      },
    ),
  ];
}

function findGuardrailViolations(options) {
  const violations = [];
  const rubricEvaluation = options.rubricEvaluation;
  const feedbackEvent = options.feedbackEvent || {};
  const gateDecision = options.gateDecision;

  if (rubricEvaluation) {
    for (const criterion of rubricEvaluation.failingCriteria || []) {
      violations.push(
        normalizeViolation(
          'rubric_guardrail',
          `rubric:${criterion}`,
          `Rubric criterion "${criterion}" failed.`,
        ),
      );
    }
    for (const guardrail of rubricEvaluation.failingGuardrails || []) {
      violations.push(
        normalizeViolation(
          'rubric_guardrail',
          `guardrail:${guardrail}`,
          `Guardrail "${guardrail}" failed.`,
        ),
      );
    }
  }

  if (gateDecision && gateDecision.gate) {
    violations.push(
      normalizeViolation(
        'gate_policy',
        `gate:${gateDecision.gate}`,
        gateDecision.message || 'A gate policy blocked or warned on this action.',
        {
          severity: gateDecision.severity || null,
          decision: gateDecision.decision || null,
        },
      ),
    );
  }

  if (typeof feedbackEvent.actionReason === 'string' && /rubric gate/i.test(feedbackEvent.actionReason)) {
    violations.push(
      normalizeViolation(
        'rubric_guardrail',
        'rubric:promotion_gate',
        feedbackEvent.actionReason,
      ),
    );
  }

  return violations;
}

function findWorkflowViolations(context, compiledConstraints, verification) {
  const text = String(context || '');
  const completionClaim = COMPLETION_CLAIM_PATTERN.test(text);
  const verificationFailed = verification && verification.passed === false;

  if (!completionClaim || !verificationFailed) {
    return [];
  }

  return [
    normalizeViolation(
      'workflow_contract',
      'workflow:proof_commands',
      `Workflow completion claims require proof commands: ${(compiledConstraints.workflowContract.requiredProofCommands || []).join(', ')}.`,
    ),
  ];
}

function findSystemViolations(options) {
  const violations = [];
  const exitCode = Number.isInteger(options.exitCode) ? options.exitCode : null;
  const error = options.error ? String(options.error) : '';
  const healthCheck = options.healthCheck;

  if (healthCheck && healthCheck.status === 'unhealthy') {
    violations.push(
      normalizeViolation(
        'system_check',
        `health:${healthCheck.name || 'unknown'}`,
        `Health check "${healthCheck.name || 'unknown'}" failed with exit code ${healthCheck.exitCode}.`,
        {
          outputTail: healthCheck.outputTail || '',
        },
      ),
    );
  }

  if (exitCode != null && exitCode !== 0) {
    violations.push(
      normalizeViolation(
        'system_check',
        `exit_code:${exitCode}`,
        `Process exited with non-zero status ${exitCode}.`,
      ),
    );
  }

  if (error) {
    violations.push(
      normalizeViolation(
        'system_check',
        'runtime:error',
        error,
      ),
    );
  }

  return violations;
}

function pickCategory(options) {
  const {
    systemViolations,
    approvalViolations,
    guardrailViolations,
    toolPolicyViolations,
    toolSchemaViolations,
    verificationViolations,
    workflowViolations,
    context,
  } = options;

  if (systemViolations.length > 0) return 'system_failure';
  if (approvalViolations.length > 0) return 'intent_plan_misalignment';
  if (guardrailViolations.length > 0) return 'guardrail_triggered';
  if (toolPolicyViolations.length > 0 || toolSchemaViolations.length > 0) return 'invalid_invocation';
  if (verificationViolations.length > 0 || workflowViolations.length > 0 || OUTPUT_MISREAD_PATTERN.test(String(context || ''))) {
    return 'tool_output_misread';
  }
  return null;
}

function buildEvidence(options) {
  const evidence = [];

  if (options.toolName) {
    evidence.push({
      type: 'tool',
      value: options.toolName,
    });
  }

  if (options.context) {
    evidence.push({
      type: 'context',
      value: String(options.context).slice(0, 240),
    });
  }

  if (options.verification && typeof options.verification.score === 'number') {
    evidence.push({
      type: 'verification_score',
      value: options.verification.score,
    });
  }

  if (options.healthCheck && options.healthCheck.outputTail) {
    evidence.push({
      type: 'output_tail',
      value: String(options.healthCheck.outputTail).slice(-240),
    });
  } else if (options.output) {
    evidence.push({
      type: 'output',
      value: String(options.output).slice(-240),
    });
  }

  return evidence;
}

function diagnoseFailure(options = {}) {
  const compiledConstraints = options.compiledConstraints || compileFailureConstraints({
    toolSchemas: options.toolSchemas,
    intentPlan: options.intentPlan,
    allowedToolNames: options.allowedToolNames,
    mcpProfile: options.mcpProfile,
    projectRoot: options.projectRoot,
  });
  const toolPolicyViolations = findToolPolicyViolations(
    options.toolName,
    compiledConstraints,
  );
  const toolSchemaViolations = findToolSchemaViolations(
    options.toolName,
    options.toolArgs,
    compiledConstraints.toolSchemas,
    {
      skipMissingSchema: toolPolicyViolations.length > 0,
    },
  );
  const verificationViolations = findVerificationViolations(options.verification);
  const approvalViolations = findApprovalViolations(options.intentPlan);
  const guardrailViolations = findGuardrailViolations(options);
  const workflowViolations = findWorkflowViolations(options.context, compiledConstraints, options.verification);
  const systemViolations = findSystemViolations(options);
  const category = pickCategory({
    systemViolations,
    approvalViolations,
    guardrailViolations,
    toolPolicyViolations,
    toolSchemaViolations,
    verificationViolations,
    workflowViolations,
    context: options.context,
  });

  const evidence = buildEvidence(options);
  const violations = [
    ...systemViolations,
    ...approvalViolations,
    ...guardrailViolations,
    ...toolPolicyViolations,
    ...toolSchemaViolations,
    ...workflowViolations,
    ...verificationViolations,
  ];
  const suspicious = options.suspect === true
    || violations.length > 0
    || (options.verification && options.verification.passed === false);

  if (!category) {
    return {
      diagnosed: false,
      suspicious,
      rootCauseCategory: null,
      criticalFailureStep: null,
      violations: [],
      evidence,
      constraintSummary: compiledConstraints.summary,
    };
  }

  return {
    diagnosed: true,
    suspicious,
    rootCauseCategory: category || 'tool_output_misread',
    criticalFailureStep: options.step || (options.healthCheck && options.healthCheck.name) || options.toolName || 'verification',
    violations,
    evidence,
    constraintSummary: compiledConstraints.summary,
    compiledConstraints: options.includeConstraints === true ? compiledConstraints : undefined,
  };
}

function aggregateFailureDiagnostics(entries) {
  const result = {
    totalDiagnosed: 0,
    categories: [],
    criticalFailureSteps: [],
    repeatedViolations: [],
  };
  const categoryBuckets = new Map();
  const stepBuckets = new Map();
  const violationBuckets = new Map();

  for (const entry of entries || []) {
    const diagnosis = entry && entry.diagnosis ? entry.diagnosis : null;
    if (!diagnosis || !diagnosis.rootCauseCategory) continue;

    result.totalDiagnosed += 1;
    categoryBuckets.set(
      diagnosis.rootCauseCategory,
      (categoryBuckets.get(diagnosis.rootCauseCategory) || 0) + 1,
    );

    if (diagnosis.criticalFailureStep) {
      stepBuckets.set(
        diagnosis.criticalFailureStep,
        (stepBuckets.get(diagnosis.criticalFailureStep) || 0) + 1,
      );
    }

    for (const violation of diagnosis.violations || []) {
      const key = violation.constraintId || violation.message;
      if (!key) continue;
      violationBuckets.set(key, (violationBuckets.get(key) || 0) + 1);
    }
  }

  result.categories = [...categoryBuckets.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
  result.criticalFailureSteps = [...stepBuckets.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
  result.repeatedViolations = [...violationBuckets.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  return result;
}

module.exports = {
  FAILURE_CATEGORIES,
  compileFailureConstraints,
  diagnoseFailure,
  aggregateFailureDiagnostics,
};
