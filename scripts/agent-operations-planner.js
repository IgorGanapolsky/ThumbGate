#!/usr/bin/env node
'use strict';

const path = require('node:path');

function toList(value) {
  if (Array.isArray(value)) return value.map(String).map((entry) => entry.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return [];
}

const BUSINESS_FUNCTION_AGENT_SOURCE = 'https://events.aiunleashedglobalsummit.com/aias-registration-yt';
const BUSINESS_FUNCTIONS = Object.freeze([
  Object.freeze({ id: 'lead_generation', label: 'Lead Generation' }),
  Object.freeze({ id: 'content_creation', label: 'Content Creation' }),
  Object.freeze({ id: 'product_validation', label: 'Product Development & Validation' }),
  Object.freeze({ id: 'marketing', label: 'Personalized Marketing' }),
  Object.freeze({ id: 'sales_conversion', label: 'Sales & Conversion' }),
  Object.freeze({ id: 'operations', label: 'Operations & Automation' }),
]);
const BUSINESS_FUNCTION_HANDOFF_EDGES = Object.freeze([
  Object.freeze({ from: 'content_creation', to: 'marketing' }),
  Object.freeze({ from: 'product_validation', to: 'marketing' }),
  Object.freeze({ from: 'marketing', to: 'lead_generation' }),
  Object.freeze({ from: 'lead_generation', to: 'sales_conversion' }),
  Object.freeze({ from: 'sales_conversion', to: 'operations' }),
]);
const BUSINESS_FUNCTION_IDS = new Set(BUSINESS_FUNCTIONS.map((entry) => entry.id));
const BUSINESS_FUNCTION_EDGE_IDS = new Set(
  BUSINESS_FUNCTION_HANDOFF_EDGES.map((edge) => `${edge.from}:${edge.to}`),
);
const BUSINESS_FUNCTION_RISKS = new Set(['low', 'medium', 'high']);
const INTERNAL_BUSINESS_ACTION = /^internal:/i;

function cleanText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function cleanUniqueList(value) {
  return Array.from(new Set(toList(value)));
}

function finiteNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundNumber(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function hasMeasuredBaseline(baseline) {
  if (!baseline || typeof baseline !== 'object') return false;
  const measuredAt = cleanText(baseline.measuredAt);
  return finiteNumber(baseline.value) !== null
    && Boolean(cleanText(baseline.unit))
    && Boolean(cleanText(baseline.source))
    && Boolean(measuredAt)
    && Number.isFinite(Date.parse(measuredAt));
}

function failedBusinessRules(rules) {
  return rules.filter(([valid]) => !valid).map(([, issue]) => issue);
}

function calculateBusinessCandidateEstimates(values) {
  const {
    estimatedMonthlyValueUsd,
    recurringMonthlyCostUsd,
    implementationCostUsd,
    confidence,
  } = values;
  const valueInputsValid = estimatedMonthlyValueUsd !== null
    && estimatedMonthlyValueUsd > 0
    && recurringMonthlyCostUsd !== null
    && recurringMonthlyCostUsd >= 0
    && confidence !== null
    && confidence > 0
    && confidence <= 1;
  const expectedMonthlyNetValueUsd = valueInputsValid
    ? roundNumber((estimatedMonthlyValueUsd * confidence) - recurringMonthlyCostUsd)
    : null;
  const costInputsValid = implementationCostUsd !== null
    && implementationCostUsd > 0
    && expectedMonthlyNetValueUsd !== null
    && expectedMonthlyNetValueUsd > 0;

  return {
    expectedMonthlyNetValueUsd,
    paybackMonths: costInputsValid
      ? roundNumber(implementationCostUsd / expectedMonthlyNetValueUsd, 3)
      : null,
  };
}

function normalizeBusinessFunctionCandidate(input = {}) {
  const functionId = cleanText(input.functionId);
  const estimatedMonthlyValueUsd = finiteNumber(input.estimatedMonthlyValueUsd);
  const recurringMonthlyCostUsd = finiteNumber(input.recurringMonthlyCostUsd);
  const implementationCostUsd = finiteNumber(input.implementationCostUsd);
  const implementationHours = finiteNumber(input.implementationHours);
  const confidence = finiteNumber(input.confidence);
  const risk = cleanText(input.risk).toLowerCase();
  const evidence = cleanUniqueList(input.evidence);
  const estimates = calculateBusinessCandidateEstimates({
    estimatedMonthlyValueUsd,
    recurringMonthlyCostUsd,
    implementationCostUsd,
    confidence,
  });
  const issues = failedBusinessRules([
    [BUSINESS_FUNCTION_IDS.has(functionId), 'unsupported_business_function'],
    [Boolean(cleanText(input.objective)), 'missing_objective'],
    [Boolean(cleanText(input.primaryKpi)), 'missing_primary_kpi'],
    [Boolean(cleanText(input.inputSource)), 'missing_input_source'],
    [hasMeasuredBaseline(input.baseline), 'missing_measured_baseline'],
    [estimatedMonthlyValueUsd !== null && estimatedMonthlyValueUsd > 0, 'missing_estimated_monthly_value_usd'],
    [recurringMonthlyCostUsd !== null && recurringMonthlyCostUsd >= 0, 'missing_recurring_monthly_cost_usd'],
    [implementationCostUsd !== null && implementationCostUsd > 0, 'missing_implementation_cost_usd'],
    [implementationHours !== null && implementationHours > 0, 'missing_implementation_hours'],
    [confidence !== null && confidence > 0 && confidence <= 1, 'invalid_confidence'],
    [BUSINESS_FUNCTION_RISKS.has(risk), 'invalid_risk'],
    [evidence.length > 0, 'missing_evidence'],
    [
      estimates.expectedMonthlyNetValueUsd === null || estimates.expectedMonthlyNetValueUsd > 0,
      'non_positive_expected_monthly_net_value',
    ],
  ]);

  return {
    agentId: cleanText(input.agentId) || functionId || 'unnamed-agent',
    functionId: functionId || null,
    objective: cleanText(input.objective) || null,
    primaryKpi: cleanText(input.primaryKpi) || null,
    inputSource: cleanText(input.inputSource) || null,
    baseline: hasMeasuredBaseline(input.baseline) ? {
      value: finiteNumber(input.baseline.value),
      unit: cleanText(input.baseline.unit),
      measuredAt: new Date(input.baseline.measuredAt).toISOString(),
      source: cleanText(input.baseline.source),
    } : null,
    estimates: {
      estimatedMonthlyValueUsd,
      recurringMonthlyCostUsd,
      implementationCostUsd,
      implementationHours,
      confidence,
      ...estimates,
    },
    risk: risk || null,
    evidence,
    status: issues.length === 0 ? 'evidence_complete' : 'insufficient_evidence',
    launchGate: risk === 'high' ? 'human_review_required' : 'standard_governance',
    issues: Array.from(new Set(issues)),
  };
}

function rejectDuplicateBusinessAgentIds(candidates) {
  const counts = new Map();
  for (const candidate of candidates) {
    counts.set(candidate.agentId, (counts.get(candidate.agentId) || 0) + 1);
  }
  return candidates.map((candidate) => (
    counts.get(candidate.agentId) > 1
      ? {
        ...candidate,
        status: 'insufficient_evidence',
        issues: Array.from(new Set([...candidate.issues, 'duplicate_agent_id'])),
      }
      : candidate
  ));
}

function rankBusinessFunctionAgents(candidates = []) {
  const normalized = Array.isArray(candidates)
    ? rejectDuplicateBusinessAgentIds(candidates.map(normalizeBusinessFunctionCandidate))
    : [];
  const eligible = normalized
    .filter((candidate) => candidate.status === 'evidence_complete')
    .sort((left, right) => (
      left.estimates.paybackMonths - right.estimates.paybackMonths
      || right.estimates.expectedMonthlyNetValueUsd - left.estimates.expectedMonthlyNetValueUsd
      || left.estimates.implementationHours - right.estimates.implementationHours
      || left.agentId.localeCompare(right.agentId)
    ));
  const ranks = new Map(eligible.map((candidate, index) => [candidate.agentId, index + 1]));
  const rankedCandidates = normalized.map((candidate) => ({
    ...candidate,
    rank: ranks.get(candidate.agentId) || null,
  })).sort((left, right) => {
    if (left.rank === null && right.rank === null) return left.agentId.localeCompare(right.agentId);
    if (left.rank === null) return 1;
    if (right.rank === null) return -1;
    return left.rank - right.rank;
  });

  return {
    schemaVersion: 'business-function-agent-ranking-v1',
    status: eligible.length > 0 ? 'ranked_estimates' : 'insufficient_evidence',
    source: {
      url: BUSINESS_FUNCTION_AGENT_SOURCE,
      claimsVerifiedByThumbGate: false,
    },
    methodology: {
      estimated: true,
      formula: 'paybackMonths = implementationCostUsd / ((estimatedMonthlyValueUsd * confidence) - recurringMonthlyCostUsd)',
      warning: 'Planning estimate; not achieved revenue or production proof.',
    },
    candidateCount: normalized.length,
    evidenceCompleteCount: eligible.length,
    recommendedPilot: eligible.length > 0 ? eligible[0].agentId : null,
    candidates: rankedCandidates,
  };
}

function validBusinessObjectSchema(schema) {
  const properties = schema?.properties;
  if (schema?.type !== 'object' || !properties || typeof properties !== 'object') return false;
  const propertyNames = Object.keys(properties);
  return propertyNames.length > 0
    && Array.isArray(schema.required)
    && schema.required.length > 0
    && schema.required.every((field) => propertyNames.includes(field));
}

function validBusinessConsent(consent) {
  if (consent?.verified !== true) return false;
  const recordedAt = cleanText(consent.recordedAt);
  return Boolean(cleanText(consent.source))
    && Boolean(recordedAt)
    && Number.isFinite(Date.parse(recordedAt));
}

function validBusinessApproval(approval) {
  return approval?.status === 'approved' && Boolean(cleanText(approval.approvalId));
}

function buildBusinessHandoffIssues(context) {
  const {
    input,
    fromFunction,
    toFunction,
    requestedActions,
    requiredEvidence,
    qualificationEvidence,
    dataScopes,
    estimatedCostUsd,
    maxCostUsd,
    slaMinutes,
  } = context;
  const isLeadToSales = fromFunction === 'lead_generation' && toFunction === 'sales_conversion';
  const externalActionRequested = requestedActions.some((action) => !INTERNAL_BUSINESS_ACTION.test(action));

  return failedBusinessRules([
    [BUSINESS_FUNCTION_IDS.has(fromFunction), 'unsupported_source_function'],
    [BUSINESS_FUNCTION_IDS.has(toFunction), 'unsupported_target_function'],
    [BUSINESS_FUNCTION_EDGE_IDS.has(`${fromFunction}:${toFunction}`), 'undeclared_handoff_edge'],
    [Boolean(cleanText(input.workflowId)), 'missing_workflow_id'],
    [Boolean(cleanText(input.correlationId)), 'missing_correlation_id'],
    [Boolean(cleanText(input.objective)), 'missing_objective'],
    [Boolean(cleanText(input.primaryKpi)), 'missing_primary_kpi'],
    [Boolean(cleanText(input.expectedOutcome)), 'missing_expected_outcome'],
    [validBusinessObjectSchema(input.inputSchema), 'invalid_input_schema'],
    [validBusinessObjectSchema(input.outputSchema), 'invalid_output_schema'],
    [dataScopes.length > 0, 'missing_data_scope'],
    [typeof input.containsPersonalData === 'boolean', 'missing_data_classification'],
    [requiredEvidence.length > 0, 'missing_required_evidence'],
    [Boolean(cleanText(input.idempotencyKey)), 'missing_idempotency_key'],
    [estimatedCostUsd !== null && estimatedCostUsd >= 0, 'invalid_estimated_cost_usd'],
    [maxCostUsd !== null && maxCostUsd >= 0, 'invalid_max_cost_usd'],
    [estimatedCostUsd === null || maxCostUsd === null || estimatedCostUsd <= maxCostUsd, 'handoff_over_budget'],
    [slaMinutes !== null && slaMinutes > 0, 'invalid_sla_minutes'],
    [input.containsPersonalData !== true || validBusinessConsent(input.consent), 'personal_data_requires_verified_consent'],
    [!isLeadToSales || qualificationEvidence.length > 0, 'lead_to_sales_requires_qualification_evidence'],
    [!isLeadToSales || validBusinessConsent(input.consent), 'lead_to_sales_requires_verified_consent'],
    [!externalActionRequested || validBusinessApproval(input.approval), 'external_action_requires_approval_receipt'],
  ]);
}

function buildBusinessOutcomeReceiptTemplate(contract) {
  return {
    schemaVersion: 'task-outcome-template-v1',
    recordable: false,
    verificationState: 'not_run',
    reason: 'Add verified results before recording.',
    taskOutcome: {
      taskId: contract.correlationId,
      taskType: `business_handoff:${contract.fromFunction}:${contract.toFunction}`,
      goal: contract.objective,
      expectedOutcome: contract.expectedOutcome,
      status: null,
      verification: { performed: false, passed: false, evidence: [] },
      toolCalls: [],
      policy: null,
      efficiency: null,
      businessOutcome: null,
      metadata: {
        workflowId: contract.workflowId,
        primaryKpi: contract.primaryKpi,
        estimateOnly: true,
      },
    },
  };
}

function evaluateBusinessFunctionHandoff(input = {}) {
  const fromFunction = cleanText(input.fromFunction);
  const toFunction = cleanText(input.toFunction);
  const requestedActions = cleanUniqueList(input.requestedActions);
  const requiredEvidence = cleanUniqueList(input.requiredEvidence);
  const qualificationEvidence = cleanUniqueList(input.qualificationEvidence);
  const dataScopes = cleanUniqueList(input.dataScopes);
  const estimatedCostUsd = finiteNumber(input.budget?.estimatedCostUsd);
  const maxCostUsd = finiteNumber(input.budget?.maxCostUsd);
  const slaMinutes = finiteNumber(input.slaMinutes);
  const issues = buildBusinessHandoffIssues({
    input,
    fromFunction,
    toFunction,
    requestedActions,
    requiredEvidence,
    qualificationEvidence,
    dataScopes,
    estimatedCostUsd,
    maxCostUsd,
    slaMinutes,
  });

  const contract = {
    contractVersion: 'business-function-handoff-v1',
    workflowId: cleanText(input.workflowId) || null,
    correlationId: cleanText(input.correlationId) || null,
    fromFunction: fromFunction || null,
    toFunction: toFunction || null,
    objective: cleanText(input.objective) || null,
    primaryKpi: cleanText(input.primaryKpi) || null,
    expectedOutcome: cleanText(input.expectedOutcome) || null,
    inputSchema: validBusinessObjectSchema(input.inputSchema) ? input.inputSchema : null,
    outputSchema: validBusinessObjectSchema(input.outputSchema) ? input.outputSchema : null,
    dataScopes,
    containsPersonalData: input.containsPersonalData === true,
    consent: validBusinessConsent(input.consent) ? {
      verified: true,
      source: cleanText(input.consent.source),
      recordedAt: new Date(input.consent.recordedAt).toISOString(),
    } : null,
    qualificationEvidence,
    requestedActions,
    budget: { estimatedCostUsd, maxCostUsd },
    slaMinutes,
    idempotencyKey: cleanText(input.idempotencyKey) || null,
    requiredEvidence,
    approval: validBusinessApproval(input.approval)
      ? { status: 'approved', approvalId: cleanText(input.approval.approvalId) }
      : null,
  };
  const decision = issues.length === 0 ? 'allow' : 'deny';

  return {
    schemaVersion: 'business-function-handoff-evaluation-v1',
    decision,
    issues: Array.from(new Set(issues)),
    contract,
    outcomeReceiptTemplate: decision === 'allow'
      ? buildBusinessOutcomeReceiptTemplate(contract)
      : null,
  };
}

function parseBusinessAgentJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    const invalidJson = new Error('Business agent JSON input is invalid.');
    invalidJson.code = 'INVALID_BUSINESS_AGENT_JSON';
    invalidJson.cause = error;
    throw invalidJson;
  }
}

function buildBusinessFunctionAgentPlan(input = {}) {
  const candidates = parseBusinessAgentJson(input.candidatesJson, input.candidates || []);
  const handoff = parseBusinessAgentJson(input.handoffJson, input.handoff || null);
  const ranking = rankBusinessFunctionAgents(candidates);
  const evaluatedHandoff = handoff ? evaluateBusinessFunctionHandoff(handoff) : null;
  return {
    name: 'thumbgate-business-function-agent-team',
    status: evaluatedHandoff?.decision === 'deny'
      ? 'blocked'
      : ranking.status,
    catalog: {
      functions: BUSINESS_FUNCTIONS,
      defaultHandoffEdges: BUSINESS_FUNCTION_HANDOFF_EDGES,
    },
    ranking,
    handoff: evaluatedHandoff,
    nextActions: [
      'Pilot the shortest evidence-backed payback',
      'Gate every cross-function handoff',
      'Record actual KPIs apart from estimates',
    ],
  };
}

function buildLoopRoutinePlan(input = {}) {
  const tasks = toList(input.tasks);
  const cadenceMinutes = Number(input.cadenceMinutes || input.cadence || 60);
  const serverHosted = Boolean(input.serverHosted || input.routine);
  const highRiskTasks = tasks.filter((task) => /merge|deploy|publish|payment|email|post|send|delete|rebase/i.test(task));

  return {
    name: 'thumbgate-loop-routine-plan',
    mode: serverHosted ? 'routine' : 'cron',
    cadenceMinutes,
    status: tasks.length ? 'actionable' : 'needs-tasks',
    tasks,
    gates: [
      'scope each loop to a named workflow before it runs',
      'require idempotency evidence for repeated execution',
      'write a run receipt with inputs, outputs, skipped items, and failures',
      'convert deterministic loop failures into regression tests before retrying automatically',
    ],
    approvalRequired: highRiskTasks.length > 0,
    highRiskTasks,
    nextActions: tasks.length
      ? [
          serverHosted ? 'Configure a hosted routine only after local cron proof is stable' : 'Start as local cron with dry-run output',
          'Add ThumbGate PreToolUse checks around every write/send/deploy action',
          'Review loop receipts before increasing cadence',
        ]
      : ['List the recurring task, owner, cadence, and maximum blast radius before scheduling'],
  };
}

function buildSkillFirstAgentPlan(input = {}) {
  const skills = toList(input.skills);
  const allowedTools = new Set(toList(input.allowedTools));
  const instructionFiles = toList(input.instructionFiles || input.instructions || ['CLAUDE.md', 'AGENTS.md', 'clauded.md']);
  const autoLoadPaths = toList(input.autoLoadPaths || input.pluginPaths || ['.claude/skills']);
  const needsWrite = Boolean(input.needsWrite || input.createFiles || input.editFiles);
  const missingTools = ['read', 'edit', 'bash']
    .concat(needsWrite ? ['write'] : [])
    .filter((tool) => !allowedTools.has(tool));

  return {
    name: 'thumbgate-skill-first-agent-plan',
    status: missingTools.length ? 'blocked' : 'ready',
    instructionFiles,
    autoLoadPaths,
    skills,
    allowedTools: Array.from(allowedTools),
    missingTools,
    gates: [
      'load project instructions before enabling skills',
      'map every skill to a bounded workflow and proof command',
      'verify plugin auto-load from project skill folders after session restart',
      'deny filesystem writes when write permission is absent',
      'record which skill produced each high-risk tool call',
    ],
    nextActions: missingTools.length
      ? missingTools.map((tool) => `Grant or explicitly deny ${tool} before running the agent`)
      : ['Run one dry-run with the selected skills', 'Promote stable skill failures into ThumbGate lessons'],
  };
}

function buildContinuousBatchingPlan(input = {}) {
  const concurrentUsers = Number(input.concurrentUsers || input.users || 1);
  const gpuHosted = Boolean(input.gpuHosted || input.selfHosted);
  const averageDecodeTokens = Number(input.averageDecodeTokens || input.decodeTokens || 256);
  const needsBatching = gpuHosted && concurrentUsers >= 3;

  return {
    name: 'thumbgate-continuous-batching-plan',
    status: needsBatching ? 'adopt-continuous-batching' : 'use-managed-or-simple-serving',
    concurrentUsers,
    averageDecodeTokens,
    scheduling: needsBatching ? 'iteration-level scheduling with queued-request admission' : 'provider-managed or simple request queue',
    guardrails: [
      'do not put LLM batching in the PreToolUse hot path unless latency proof exists',
      'cap queue wait time before admitting a request',
      'emit per-request receipts so one user cannot hide another user failure',
      'measure p95 latency, throughput, and timeout rate before and after batching',
    ],
    nextActions: needsBatching
      ? ['Evaluate vLLM, SGLang, or provider-native continuous batching', 'Add backpressure and queue-time metrics', 'Keep deterministic gates outside the model batch']
      : ['Stay with managed inference or deterministic local checks until concurrency justifies GPU scheduling'],
  };
}

function buildLegalAgentGovernancePlan(input = {}) {
  const actions = toList(input.actions);
  const agents = toList(input.agents);
  const privileged = Boolean(input.privileged || input.privilege);
  const matterId = input.matterId || input.matter || 'matter-unscoped';
  const externalActions = actions.filter((action) => /email|send|file|serve|submit|publish|client|court|opposing/i.test(action));

  return {
    name: 'thumbgate-legal-agent-governance-plan',
    status: matterId === 'matter-unscoped' ? 'blocked' : 'ready-for-pilot',
    matterId,
    agents,
    privileged,
    approvalRequired: privileged || externalActions.length > 0,
    gates: [
      'matter-scoped memory and retrieval before any legal-agent action',
      'privilege and confidentiality check before reading or writing documents',
      'unsupported-citation and hallucinated-authority check before legal output leaves draft mode',
      'human approval before external send, filing, client advice, or opposing-party communication',
      'audit trail with agent, matter, source pointers, approver, and final disposition',
    ],
    externalActions,
    nextActions: matterId === 'matter-unscoped'
      ? ['Assign a matter ID and allowed data boundary before enabling legal agents']
      : ['Run in observe-only mode on one matter', 'Capture blocked unsupported claims as lessons', 'Export audit evidence for risk/pricing review'],
  };
}

function buildDynamicWorkflowReadinessPlan(input = {}) {
  const task = String(input.task || input.objective || '').trim();
  const successCriteria = toList(input.successCriteria || input.criteria || input.oracles);
  const parallelAgents = Number(input.parallelAgents || input.agents || 1);
  const tokenBudget = Number(input.tokenBudget || input.maxTokens || 0);
  const needsVerifier = Boolean(input.needsVerifier || input.securitySweep || input.migration || input.research);
  const objectiveOracle = successCriteria.length > 0;
  const enoughScale = parallelAgents >= 4;
  const budgeted = tokenBudget > 0;
  const approved = objectiveOracle && enoughScale && budgeted && needsVerifier;

  return {
    name: 'thumbgate-dynamic-workflow-readiness-plan',
    status: approved ? 'ready-for-human-plan-review' : 'use-single-agent-or-subagent',
    task,
    successCriteria,
    parallelAgents,
    tokenBudget,
    gates: [
      'require an objective success oracle before dynamic workflow execution',
      'require a versioned script plan before spawning concurrent agents',
      'require human review of the generated workflow plan before spend begins',
      'track stage status, verifier results, and token usage in the workflow receipt',
    ],
    missingEvidence: [
      objectiveOracle ? null : 'objective success criteria',
      enoughScale ? null : 'parallel scale requirement',
      budgeted ? null : 'token or cost budget',
      needsVerifier ? null : 'independent verifier or adversarial check',
    ].filter(Boolean),
    nextActions: approved
      ? ['Generate a versioned workflow script', 'Review plan before launch', 'Run with token/cost dashboard open']
      : ['Keep this in a cheaper single-agent or focused subagent path until the missing evidence exists'],
  };
}

function buildOpenModelCustomizationPlan(input = {}) {
  const workload = String(input.workload || input.task || 'unspecified-workload').trim();
  const proprietarySignals = toList(input.proprietarySignals || input.signals || input.embeddings);
  const runtimeEncoding = Boolean(input.runtimeEncoding || input.encodeAtRuntime);
  const baselineCost = Number(input.baselineCost || input.currentCost || 0);
  const hasBenchmark = Boolean(input.hasBenchmark || input.benchmark || input.accuracyBaseline);
  const shouldCustomize = proprietarySignals.length > 0 && baselineCost > 0 && hasBenchmark;

  return {
    name: 'thumbgate-open-model-customization-plan',
    status: shouldCustomize ? 'customize-and-benchmark' : 'measure-before-customizing',
    workload,
    proprietarySignals,
    runtimeEncodingRisk: runtimeEncoding ? 'high-latency-runtime-encoding' : 'precomputed-or-not-applicable',
    gates: [
      'prove task-specific data quality before replacing a frontier model lane',
      'precompute proprietary embeddings when runtime encoding would add latency',
      'benchmark accuracy, p95 latency, and cost per request against the current model',
      'keep fallback routing to the frontier model for low-confidence or unsupported cases',
    ],
    nextActions: shouldCustomize
      ? ['Build an offline embedding/index job', 'Run side-by-side eval against the frontier baseline', 'Route only the passing workload slice to the customized model']
      : ['Capture current cost, latency, accuracy, and proprietary signal inventory before changing the model stack'],
  };
}

function buildDigitalPrCitationPlan(input = {}) {
  const audiences = toList(input.audiences || input.buyers || ['engineering leaders', 'legal innovation teams']);
  const proofAssets = toList(input.proofAssets || input.assets);
  const earnedMentions = toList(input.earnedMentions || input.mentions);
  const seasonalHook = input.seasonalHook || input.newsHook || 'agentic AI governance';
  const hasCitationProof = proofAssets.length > 0 && earnedMentions.length > 0;

  return {
    name: 'thumbgate-digital-pr-citation-plan',
    status: hasCitationProof ? 'ready-for-outreach' : 'build-citation-proof-first',
    audiences,
    seasonalHook,
    proofAssets,
    earnedMentions,
    gates: [
      'publish one canonical proof asset before pitching',
      'make claims quotable with current dates, evidence links, and machine-readable context',
      'track citation share of voice across Google AI Overviews, ChatGPT, Perplexity, and Claude',
      'prefer earned expert citations over thin AI-search tactics',
    ],
    nextActions: hasCitationProof
      ? ['Pitch the proof asset to targeted journalists and directory editors', 'Monitor AI citation share, not only clicks']
      : ['Ship proof asset, comparison page, and llm-context update before outreach'],
  };
}

function buildServerlessVectorPlan(input = {}) {
  const bursty = Boolean(input.bursty || input.agentic || input.unpredictableTraffic);
  const idleHours = Number(input.idleHoursPerDay || input.idleHours || 0);
  const managedEndpoint = Boolean(input.managedEndpoint || input.vercelMarketplace || input.opensearchServerless);
  const sensitiveLocalData = Boolean(input.sensitiveLocalData || input.localOnly);
  const serverlessFit = bursty && idleHours >= 6 && managedEndpoint && !sensitiveLocalData;

  return {
    name: 'thumbgate-serverless-vector-plan',
    status: serverlessFit ? 'use-serverless-vector-burst-lane' : 'keep-local-or-prove-managed-fit',
    gates: [
      'use local SQLite/FTS/vector stores for private hot-path enforcement',
      'route bursty non-sensitive search to serverless only with cost and latency receipts',
      'require scale-to-zero and decoupled compute/storage evidence before replacing local storage',
      'keep export/import portability so a marketplace provisioner is not lock-in',
    ],
    nextActions: serverlessFit
      ? ['Provision a managed endpoint in a sandbox project', 'Run burst replay and idle-cost proof', 'Keep ThumbGate local enforcement as fallback']
      : ['Measure traffic burstiness, privacy boundary, idle cost, and latency before adopting serverless search'],
  };
}

function buildMemoryModelPlan(input = {}) {
  const memories = toList(input.memories || input.memoryTypes || ['facts', 'lessons', 'source pointers']);
  const retrainingAvoided = input.retrainingAvoided !== false;
  const sourcePointers = Boolean(input.sourcePointers || input.pointerFirst);

  return {
    name: 'thumbgate-memory-model-plan',
    status: retrainingAvoided && sourcePointers ? 'upgrade-with-memory-not-retraining' : 'add-source-grounding-first',
    memories,
    gates: [
      'store durable facts, lessons, and source pointers outside the model weights',
      'score memory freshness, trust, and matter/workspace scope before retrieval',
      'inject only the minimum relevant memory into the agent harness',
      'promote repeated memory-backed failures into PreToolUse prevention rules',
    ],
    nextActions: retrainingAvoided && sourcePointers
      ? ['Run memory retrieval eval before model routing changes', 'Track blocked repeats as the outcome metric']
      : ['Add pointer-first source grounding before treating memory as a model upgrade'],
  };
}

function buildSandboxManifestPlan(input = {}) {
  const manifestEntries = toList(input.manifestEntries || input.mounts || input.entries);
  const outputDirs = toList(input.outputDirs || input.outputs);
  const sandboxProvider = input.sandboxProvider || input.provider || 'local';
  const checkpointing = Boolean(input.checkpointing || input.rehydration || input.longRunning);
  const secretsInSandbox = Boolean(input.secretsInSandbox || input.credentialsInCompute);
  const ready = manifestEntries.length > 0 && outputDirs.length > 0 && !secretsInSandbox;

  return {
    name: 'thumbgate-sandbox-manifest-plan',
    status: ready ? 'ready-for-sandboxed-agent-run' : 'blocked-until-manifest-safe',
    sandboxProvider,
    manifestEntries,
    outputDirs,
    checkpointing,
    gates: [
      'describe all readable inputs and writable outputs in a manifest before the run',
      'separate harness credentials from sandbox compute where model-generated code executes',
      'enable checkpoint or rehydration proof for long-running work',
      'route subagents to isolated environments instead of sharing a broad workspace',
    ],
    missingEvidence: [
      manifestEntries.length ? null : 'manifest entries',
      outputDirs.length ? null : 'output directories',
      secretsInSandbox ? 'credentials must stay outside sandbox compute' : null,
    ].filter(Boolean),
    nextActions: ready
      ? ['Run one sandbox smoke test with mounted inputs and output receipt', 'Attach manifest and checkpoint evidence to the audit trail']
      : ['Define manifest, outputs, and credential boundary before letting the agent inspect files or run commands'],
  };
}

function buildNetworkEgressFirewallPlan(input = {}) {
  const allowedDomains = toList(input.allowedDomains || input.allowlist || input.allowedHosts);
  const observedRequests = toList(input.observedRequests || input.requests);
  const secretPatterns = toList(input.secretPatterns || input.secrets || ['api_key', 'token', 'Authorization']);
  const liveDashboard = Boolean(input.liveDashboard || input.dashboard);
  const unknownRequests = observedRequests.filter((request) => {
    const target = String(request).replace(/^https?:\/\//, '').split('/')[0];
    return target && !allowedDomains.some((domain) => target === domain || target.endsWith(`.${domain}`));
  });

  return {
    name: 'thumbgate-network-egress-firewall-plan',
    status: unknownRequests.length ? 'block-unknown-egress' : 'ready-for-egress-observe-mode',
    allowedDomains,
    observedRequests,
    unknownRequests,
    secretPatterns,
    gates: [
      'proxy outbound agent HTTP requests through a policy check before network egress',
      'block requests that target domains outside the workflow allowlist',
      'scan request headers and bodies for credential-shaped values before sending',
      'record method, target, status, latency, policy decision, and matching rule in a live request ledger',
    ],
    dashboard: liveDashboard
      ? 'show live request table with method, target, latency, decision, and rule'
      : 'write request receipts first; add live dashboard after the ledger is stable',
    nextActions: unknownRequests.length
      ? ['Deny unknown egress', 'Ask for workflow-scoped approval', 'Record blocked target in the audit trail']
      : ['Run in observe mode for one workflow', 'Promote repeated risky egress into deny rules'],
  };
}

function buildSupplyChainVettingPlan(input = {}) {
  const sources = toList(input.sources || input.packages || input.repositories);
  const sandbox = Boolean(input.sandbox || input.vm || input.goldImage);
  const aiAudit = Boolean(input.aiAudit || input.audit);
  const autoUpdatesDisabled = Boolean(input.autoUpdatesDisabled || input.disableAutoUpdates);
  const installScriptsDisabled = Boolean(input.installScriptsDisabled || input.ignoreScripts);
  const exfilTargets = toList(input.exfilTargets || input.exfiltrationTargets || ['GitHub Contents API', 'HuggingFace datasets', 'attacker HTTP endpoint']);
  const ready = sources.length > 0 && sandbox && aiAudit && autoUpdatesDisabled && installScriptsDisabled;

  return {
    name: 'thumbgate-supply-chain-vetting-plan',
    status: ready ? 'ready-to-promote-dependency' : 'quarantine-before-use',
    sources,
    exfilTargets,
    gates: [
      'download GitHub, npm, and PyPI artifacts into a disposable sandbox or gold-image VM first',
      'run AI-assisted code audit plus deterministic scanners before execution on the primary machine',
      'scan install hooks, postinstall scripts, binary droppers, credential reads, recursive file walkers, and network uploads',
      'disable auto-update paths unless the updater is separately reviewed and pinned',
      'prefer ignore-scripts or equivalent install-script quarantine until package provenance and maintainer account risk are reviewed',
      'promote only with source, hash, scanner output, and reviewer receipt',
    ],
    missingEvidence: [
      sources.length ? null : 'artifact source list',
      sandbox ? null : 'sandbox or disposable VM proof',
      aiAudit ? null : 'AI/code audit receipt',
      autoUpdatesDisabled ? null : 'auto-update disabled or pinned proof',
      installScriptsDisabled ? null : 'install scripts disabled or reviewed proof',
    ].filter(Boolean),
    nextActions: ready
      ? ['Promote dependency into the allowed catalog with hash evidence', 'Monitor updates through the same quarantine path']
      : ['Keep the artifact quarantined and do not run install scripts on the primary machine'],
  };
}

function buildMarketingAgencyGtmPlan(input = {}) {
  const channels = toList(input.channels || ['lead-generation', 'social', 'seo']);
  const monthlyRetainer = Number(input.monthlyRetainer || input.retainer || 750);
  const proofAssets = toList(input.proofAssets || input.assets);
  const crmAutomation = Boolean(input.crmAutomation || input.highLevel || input.leadNurture);
  const scheduledContent = Boolean(input.scheduledContent || input.metricool || input.scheduler);
  const qualityReview = Boolean(input.qualityReview || input.writerReview || input.claimReview);
  const ready = proofAssets.length > 0 && crmAutomation && scheduledContent && qualityReview;

  return {
    name: 'thumbgate-marketing-agency-gtm-plan',
    status: ready ? 'ready-to-sell-workflow-sprint' : 'build-gtm-proof-first',
    channels,
    monthlyRetainer,
    offer: 'AI Agent Governance Workflow Hardening Sprint',
    gates: [
      'target lead generation around one expensive repeated AI-agent mistake, not generic AI automation',
      'use CRM automation only after consent, attribution, and unsubscribe paths are configured',
      'schedule social and SEO content from proof assets, not unsupported claims',
      'quality-review ads, translations, captions, and long-form SEO copy against pricing and capability truth',
    ],
    nextActions: ready
      ? ['Launch a narrow lead-gen campaign for engineering and legal innovation buyers', 'Track replies, booked calls, and proof-page citations']
      : ['Create one proof asset, one lead-nurture sequence, one scheduled content batch, and one quality review checklist'],
  };
}

function buildBedrockAgentCorePlan(input = {}) {
  const frameworks = toList(input.frameworks || ['LangGraph']);
  const serverless = Boolean(input.serverless || input.agentCoreRuntime);
  const memory = Boolean(input.memory || input.agentCoreMemory);
  const observability = Boolean(input.observability || input.agentCoreObservability);
  const identity = Boolean(input.identity || input.agentCoreIdentity);
  const ready = serverless && memory && observability && identity;

  return {
    name: 'thumbgate-bedrock-agentcore-plan',
    status: ready ? 'ready-for-agentcore-pilot' : 'missing-production-agent-controls',
    frameworks,
    gates: [
      'treat every AWS agent and subagent as a first-class identity with scoped permissions',
      'externalize memory and checkpoints so serverless agent restarts do not lose state',
      'emit OpenTelemetry-compatible traces for every tool call, handoff, and policy decision',
      'canary and quarantine new agent versions before expanding traffic',
      'keep ThumbGate pre-action gates in front of Bedrock/LangGraph tool writes and customer-system actions',
    ],
    missingEvidence: [
      serverless ? null : 'serverless runtime proof',
      memory ? null : 'AgentCore Memory or equivalent checkpoint proof',
      observability ? null : 'AgentCore Observability/OpenTelemetry proof',
      identity ? null : 'AgentCore Identity or equivalent scoped credentials proof',
    ].filter(Boolean),
    nextActions: ready
      ? ['Pilot one LangGraph workflow on Bedrock AgentCore with ThumbGate tool-call receipts', 'Compare blocked actions, latency, and trace completeness against local mode']
      : ['Do not promote multi-agent AWS deployment until identity, memory, observability, and runtime controls are proven'],
  };
}

function buildCodeQualityEnablementPlan(input = {}) {
  const owner = input.owner || 'IgorGanapolsky';
  const repo = input.repo || 'ThumbGate';
  const languages = toList(input.languages || ['javascript-typescript', 'python']);
  const runnerType = input.runnerType || input.runner || 'github-hosted';
  const previewAvailable = input.previewAvailable !== false;

  return {
    name: 'thumbgate-github-code-quality-enablement-plan',
    status: previewAvailable ? 'enable-or-confirm-code-quality' : 'preview-unavailable',
    owner,
    repo,
    languages,
    runnerType,
    endpoints: [
      `GET /repos/${owner}/${repo}/code-quality/setup`,
      `PATCH /repos/${owner}/${repo}/code-quality/setup`,
    ],
    gates: [
      'retrieve current GitHub Code Quality setup before changing repository settings',
      'enable only supported repository languages and runner type',
      'keep CodeQL, Sonar, and ThumbGate pre-action gates as complementary controls',
      'record API response, schedule, and status-check evidence after enablement',
    ],
    nextActions: previewAvailable
      ? ['GET current Code Quality setup', 'PATCH default setup if disabled', 'Verify status checks appear on the next PR']
      : ['Keep existing CodeQL/Sonar checks and retry when GitHub preview is available to the account'],
  };
}

function buildMediaAssetGovernancePlan(input = {}) {
  const assets = toList(input.assets || input.prompts || input.campaigns);
  const assetTypes = toList(input.assetTypes || input.types || input.formats);
  const brandKit = Boolean(input.brandKit || input.brand);
  const rightsProof = Boolean(input.rightsProof || input.licensedInputs);
  const claimReview = Boolean(input.claimReview || input.proofReview);
  const dynamicSubtitles = Boolean(input.dynamicSubtitles || input.subtitles || input.captions);
  const ready = assets.length > 0 && brandKit && rightsProof && claimReview;

  return {
    name: 'thumbgate-media-asset-governance-plan',
    status: ready ? 'ready-to-generate-assets' : 'block-unreviewed-media-generation',
    assets,
    assetTypes,
    dynamicSubtitles,
    gates: [
      'require brand kit, audience, and campaign goal before image or video generation',
      'require rights proof for inputs, logos, screenshots, voices, and music',
      'block unsupported product claims in generated ad copy or captions',
      'require caption/subtitle review for short-form video before publishing',
      'keep product mockups and ad variants tied to the same source-of-truth pricing and capability claims',
      'store prompt, model, output asset path, approver, and publish destination in an asset receipt',
    ],
    nextActions: ready
      ? ['Generate draft assets in a sandbox workspace', 'Human-review claims and rights before publishing']
      : ['Add brand, rights, and claim-review evidence before using Runway or other media MCPs'],
  };
}

function buildOutputFormatPlan(input = {}) {
  const audience = input.audience || 'operator';
  const artifactType = input.artifactType || input.type || 'report';
  const interactive = Boolean(input.interactive || input.dashboard || input.comparison);
  const repoNative = Boolean(input.repoNative || input.markdown || input.auditLog);
  const format = interactive && !repoNative ? 'html' : 'markdown';

  return {
    name: 'thumbgate-output-format-plan',
    status: `use-${format}`,
    audience,
    artifactType,
    format,
    gates: [
      'use HTML for dense decision reports, comparison grids, dashboards, visual QA, and interactive review surfaces',
      'use Markdown for repo-native docs, audit logs, READMEs, commit notes, and text pipelines',
      'keep a text/Markdown source or export path when HTML becomes the human-facing artifact',
      'test generated HTML for broken links, overflow, accessibility labels, and stale claims before sharing',
    ],
    nextActions: format === 'html'
      ? ['Render an HTML preview and run link/claim checks before sending']
      : ['Keep output as Markdown and avoid decorative HTML that hurts diffs'],
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (['loop', 'skills', 'batching', 'legal', 'dynamic', 'customize', 'pr', 'vector', 'memory', 'sandbox', 'egress', 'supply-chain', 'code-quality', 'media', 'format', 'gtm-agency', 'bedrock'].includes(arg)) args.command = arg;
    else if (arg.startsWith('--tasks=')) args.tasks = arg.slice('--tasks='.length);
    else if (arg.startsWith('--cadence-minutes=')) args.cadenceMinutes = arg.slice('--cadence-minutes='.length);
    else if (arg === '--routine' || arg === '--server-hosted') args.serverHosted = true;
    else if (arg.startsWith('--skills=')) args.skills = arg.slice('--skills='.length);
    else if (arg.startsWith('--allowed-tools=')) args.allowedTools = arg.slice('--allowed-tools='.length);
    else if (arg === '--needs-write') args.needsWrite = true;
    else if (arg.startsWith('--users=')) args.concurrentUsers = arg.slice('--users='.length);
    else if (arg === '--gpu-hosted') args.gpuHosted = true;
    else if (arg.startsWith('--matter=')) args.matterId = arg.slice('--matter='.length);
    else if (arg.startsWith('--agents=')) args.agents = arg.slice('--agents='.length);
    else if (arg.startsWith('--actions=')) args.actions = arg.slice('--actions='.length);
    else if (arg === '--privileged') args.privileged = true;
    else if (arg.startsWith('--task=')) args.task = arg.slice('--task='.length);
    else if (arg.startsWith('--success-criteria=')) args.successCriteria = arg.slice('--success-criteria='.length);
    else if (arg.startsWith('--parallel-agents=')) args.parallelAgents = arg.slice('--parallel-agents='.length);
    else if (arg.startsWith('--token-budget=')) args.tokenBudget = arg.slice('--token-budget='.length);
    else if (arg === '--needs-verifier') args.needsVerifier = true;
    else if (arg.startsWith('--workload=')) args.workload = arg.slice('--workload='.length);
    else if (arg.startsWith('--signals=')) args.proprietarySignals = arg.slice('--signals='.length);
    else if (arg === '--runtime-encoding') args.runtimeEncoding = true;
    else if (arg.startsWith('--baseline-cost=')) args.baselineCost = arg.slice('--baseline-cost='.length);
    else if (arg === '--has-benchmark') args.hasBenchmark = true;
    else if (arg.startsWith('--proof-assets=')) args.proofAssets = arg.slice('--proof-assets='.length);
    else if (arg.startsWith('--earned-mentions=')) args.earnedMentions = arg.slice('--earned-mentions='.length);
    else if (arg === '--bursty') args.bursty = true;
    else if (arg.startsWith('--idle-hours=')) args.idleHours = arg.slice('--idle-hours='.length);
    else if (arg === '--managed-endpoint') args.managedEndpoint = true;
    else if (arg === '--sensitive-local-data') args.sensitiveLocalData = true;
    else if (arg.startsWith('--memories=')) args.memories = arg.slice('--memories='.length);
    else if (arg === '--source-pointers') args.sourcePointers = true;
    else if (arg.startsWith('--manifest-entries=')) args.manifestEntries = arg.slice('--manifest-entries='.length);
    else if (arg.startsWith('--output-dirs=')) args.outputDirs = arg.slice('--output-dirs='.length);
    else if (arg.startsWith('--sandbox-provider=')) args.sandboxProvider = arg.slice('--sandbox-provider='.length);
    else if (arg === '--checkpointing') args.checkpointing = true;
    else if (arg === '--secrets-in-sandbox') args.secretsInSandbox = true;
    else if (arg.startsWith('--allowed-domains=')) args.allowedDomains = arg.slice('--allowed-domains='.length);
    else if (arg.startsWith('--observed-requests=')) args.observedRequests = arg.slice('--observed-requests='.length);
    else if (arg === '--live-dashboard') args.liveDashboard = true;
    else if (arg.startsWith('--sources=')) args.sources = arg.slice('--sources='.length);
    else if (arg === '--sandbox') args.sandbox = true;
    else if (arg === '--ai-audit') args.aiAudit = true;
    else if (arg === '--auto-updates-disabled') args.autoUpdatesDisabled = true;
    else if (arg === '--install-scripts-disabled' || arg === '--ignore-scripts') args.installScriptsDisabled = true;
    else if (arg.startsWith('--exfil-targets=')) args.exfilTargets = arg.slice('--exfil-targets='.length);
    else if (arg.startsWith('--owner=')) args.owner = arg.slice('--owner='.length);
    else if (arg.startsWith('--repo=')) args.repo = arg.slice('--repo='.length);
    else if (arg.startsWith('--languages=')) args.languages = arg.slice('--languages='.length);
    else if (arg.startsWith('--runner-type=')) args.runnerType = arg.slice('--runner-type='.length);
    else if (arg.startsWith('--assets=')) args.assets = arg.slice('--assets='.length);
    else if (arg.startsWith('--asset-types=')) args.assetTypes = arg.slice('--asset-types='.length);
    else if (arg === '--brand-kit') args.brandKit = true;
    else if (arg === '--rights-proof') args.rightsProof = true;
    else if (arg === '--claim-review') args.claimReview = true;
    else if (arg === '--dynamic-subtitles' || arg === '--captions') args.dynamicSubtitles = true;
    else if (arg.startsWith('--artifact-type=')) args.artifactType = arg.slice('--artifact-type='.length);
    else if (arg === '--interactive') args.interactive = true;
    else if (arg === '--repo-native') args.repoNative = true;
    else if (arg.startsWith('--channels=')) args.channels = arg.slice('--channels='.length);
    else if (arg.startsWith('--monthly-retainer=')) args.monthlyRetainer = arg.slice('--monthly-retainer='.length);
    else if (arg === '--crm-automation') args.crmAutomation = true;
    else if (arg === '--scheduled-content') args.scheduledContent = true;
    else if (arg === '--quality-review') args.qualityReview = true;
    else if (arg.startsWith('--frameworks=')) args.frameworks = arg.slice('--frameworks='.length);
    else if (arg === '--serverless') args.serverless = true;
    else if (arg === '--agentcore-memory') args.memory = true;
    else if (arg === '--agentcore-observability') args.observability = true;
    else if (arg === '--agentcore-identity') args.identity = true;
  }
  return args;
}

function readBusinessTeamOption(argv, name) {
  const prefix = `--${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function parseBusinessTeamArgs(argv = process.argv.slice(2)) {
  if (!argv.includes('business-team')) return null;
  return {
    command: 'business-team',
    json: argv.includes('--json'),
    candidatesJson: readBusinessTeamOption(argv, 'candidates-json'),
    handoffJson: readBusinessTeamOption(argv, 'handoff-json'),
  };
}

function runCli(args) {
  const command = args.command || 'loop';
  const builders = {
    skills: buildSkillFirstAgentPlan,
    batching: buildContinuousBatchingPlan,
    legal: buildLegalAgentGovernancePlan,
    dynamic: buildDynamicWorkflowReadinessPlan,
    customize: buildOpenModelCustomizationPlan,
    pr: buildDigitalPrCitationPlan,
    vector: buildServerlessVectorPlan,
    memory: buildMemoryModelPlan,
    sandbox: buildSandboxManifestPlan,
    egress: buildNetworkEgressFirewallPlan,
    'supply-chain': buildSupplyChainVettingPlan,
    'code-quality': buildCodeQualityEnablementPlan,
    media: buildMediaAssetGovernancePlan,
    format: buildOutputFormatPlan,
    'gtm-agency': buildMarketingAgencyGtmPlan,
    bedrock: buildBedrockAgentCorePlan,
    'business-team': buildBusinessFunctionAgentPlan,
    loop: buildLoopRoutinePlan,
  };
  const report = (builders[command] || buildLoopRoutinePlan)(args);

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${report.name}: ${report.status}`);
    for (const action of report.nextActions || []) console.log(`- ${action}`);
  }
}

// Path-based entrypoint check avoids SonarCloud S3403 on `require.main === module`.
if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  runCli(parseBusinessTeamArgs() || parseArgs());
}

module.exports = {
  buildLoopRoutinePlan,
  buildSkillFirstAgentPlan,
  buildContinuousBatchingPlan,
  buildOpenModelCustomizationPlan,
  buildDigitalPrCitationPlan,
  buildServerlessVectorPlan,
  buildMemoryModelPlan,
  buildSandboxManifestPlan,
  buildNetworkEgressFirewallPlan,
  buildSupplyChainVettingPlan,
  buildCodeQualityEnablementPlan,
  buildMediaAssetGovernancePlan,
  buildOutputFormatPlan,
  buildMarketingAgencyGtmPlan,
  buildBedrockAgentCorePlan,
  buildLegalAgentGovernancePlan,
  buildDynamicWorkflowReadinessPlan,
  BUSINESS_FUNCTIONS,
  BUSINESS_FUNCTION_HANDOFF_EDGES,
  normalizeBusinessFunctionCandidate,
  rankBusinessFunctionAgents,
  evaluateBusinessFunctionHandoff,
  buildBusinessOutcomeReceiptTemplate,
  buildBusinessFunctionAgentPlan,
};
