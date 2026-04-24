#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const promptCache = new Map();
const {
  createUnavailableReport,
  loadOptionalModule,
} = require('../../scripts/private-core-boundary');

function getCachedPrompt(key) {
  return promptCache.get(key);
}

function setCachedPrompt(key, prompt) {
  promptCache.set(key, prompt);
}

// Tool schemas for Anthropic-style fine-grained calling
const toolSchemas = {
  exec: {
    name: 'exec',
    description: 'Run shell commands',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' }
      }
    }
  }
};
const {
  captureFeedback,
  feedbackSummary,
  analyzeFeedback,
  writePreventionRules,
  listEnforcementMatrix,
  FEEDBACK_LOG_PATH,
  readJSONL,
  getFeedbackPaths,
} = require('../../scripts/feedback-loop');
const {
  ensureContextFs,
  normalizeNamespaces,
  constructContextPack,
  evaluateContextPack,
  getProvenance,
  writeSessionHandoff,
  readSessionHandoff,
} = require('../../scripts/contextfs');
const { buildRubricEvaluation } = require('../../scripts/rubric-engine');
const {
  getActiveMcpProfile,
  getAllowedTools,
  assertToolAllowed,
} = require('../../scripts/mcp-policy');
const {
  evaluateGates,
  evaluateGatesAsync,
  evaluateSecretGuard,
  satisfyCondition,
  loadStats: loadGateStats,
  setTaskScope,
  setBranchGovernance,
  getScopeState,
  getBranchGovernanceState,
  approveProtectedAction,
  trackAction,
  verifyClaimEvidence,
  registerClaimGate,
} = require('../../scripts/gates-engine');
const {
  evaluateOperationalIntegrity,
} = require('../../scripts/operational-integrity');
const {
  evaluateWorkflowSentinel,
} = require('../../scripts/workflow-sentinel');
const { diagnoseFailure } = require('../../scripts/failure-diagnostics');
const {
  analyzeCodeGraphImpact,
  formatCodeGraphRecallSection,
} = require('../../scripts/codegraph-context');
const {
  exportDpoFromMemories,
  DEFAULT_LOCAL_MEMORY_LOG,
} = require('../../scripts/export-dpo-pairs');
const { exportDatabricksBundle } = require('../../scripts/export-databricks-bundle');
const { generateDashboard } = require('../../scripts/dashboard');
const { getSettingsStatus } = require('../../scripts/settings-hierarchy');
const { generateSkills } = require('../../scripts/skill-generator');
const { buildNativeMessagingAudit } = require('../../scripts/native-messaging-audit');
const {
  loadModel,
  getReliability,
} = require('../../scripts/thompson-sampling');
const {
  retrieveRelevantLessons,
} = loadOptionalModule(path.join(__dirname, '../../scripts/lesson-retrieval'), () => ({
  retrieveRelevantLessons: () => [],
}));
const {
  searchThumbgate,
} = require('../../scripts/thumbgate-search');
const {
  buildMultimodalRetrievalPlan,
} = require('../../scripts/multimodal-retrieval-plan');
const {
  importDocument,
  listImportedDocuments,
  readImportedDocument,
} = require('../../scripts/document-intake');
const { checkLimit, UPGRADE_MESSAGE } = require('../../scripts/rate-limiter');
const { generateOrgDashboard } = loadOptionalModule(path.join(__dirname, '../../scripts/org-dashboard'), () => ({
  generateOrgDashboard: () => ({
    activeAgents: 0,
    totalAgents: 0,
    orgAdherenceRate: 0,
    topBlockedGates: [],
    riskAgents: [],
    upgradeMessage: 'Org dashboard requires ThumbGate-Core.',
    ...createUnavailableReport('Org dashboard'),
  }),
}));
const {
  listHarnesses,
  runHarness,
} = require('../../scripts/natural-language-harness');
const { runLoop: runAutoresearchLoop } = require('../../scripts/autoresearch-runner');
const { TOOLS } = require('../../scripts/tool-registry');
const { buildContextFootprintReport } = require('../../scripts/context-footprint');
const { reflect: reflectOnFeedback } = loadOptionalModule(path.join(__dirname, '../../scripts/reflector-agent'), () => ({
  reflect: () => createUnavailableReport('Feedback reflection'),
}));
const { submitProductIssue } = require('../../scripts/product-feedback');
const {
  assembleUnifiedContext,
  formatUnifiedContext,
} = require('../../scripts/context-manager');
const { exportHfDataset } = require('../../scripts/export-hf-dataset');

const PRO_CHECKOUT_URL = 'https://thumbgate-production.up.railway.app/checkout/pro';
const PRIVATE_MCP_MODULES = Object.freeze({
  intentRouter: path.resolve(__dirname, '../../scripts/intent-router.js'),
  delegationRuntime: path.resolve(__dirname, '../../scripts/delegation-runtime.js'),
  orgDashboard: path.resolve(__dirname, '../../scripts/org-dashboard.js'),
  reflectorAgent: path.resolve(__dirname, '../../scripts/reflector-agent.js'),
  swarmCoordinator: path.resolve(__dirname, '../../scripts/swarm-coordinator.js'),
  sessionReport: path.resolve(__dirname, '../../scripts/session-report.js'),
  operatorArtifacts: path.resolve(__dirname, '../../scripts/operator-artifacts.js'),
  managedLessonAgent: path.resolve(__dirname, '../../scripts/managed-lesson-agent.js'),
  semanticLayer: path.resolve(__dirname, '../../scripts/semantic-layer.js'),
  lessonInference: path.resolve(__dirname, '../../scripts/lesson-inference.js'),
  lessonSearch: path.resolve(__dirname, '../../scripts/lesson-search.js'),
});

function loadPrivateMcpModule(key) {
  const modulePath = PRIVATE_MCP_MODULES[key];
  if (!modulePath) {
    throw new Error(`Unknown private MCP module: ${key}`);
  }
  try {
    return require(modulePath);
  } catch (error) {
    const message = String(error && error.message || '');
    if ((error && (error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_MODULE_NOT_FOUND'))
      && (message.includes(modulePath) || message.includes(path.basename(modulePath)))) {
      return null;
    }
    throw error;
  }
}

function unavailablePrivateMcpFeature(toolName) {
  return toTextResult({
    ok: false,
    availability: 'private_core',
    tool: toolName,
    message: `${toolName} is only available in the ThumbGate private core or hosted runtime.`,
  });
}

function enforceLimit(action) {
  const limit = checkLimit(action);
  if (!limit.allowed) {
    const err = new Error(
      `Free tier limit reached. Upgrade to Pro for unlimited: https://thumbgate-production.up.railway.app/pro\n${UPGRADE_MESSAGE}\nUpgrade now: ${PRO_CHECKOUT_URL}`
    );
    err.errorCategory = 'rate_limit';
    err.isRetryable = false;
    throw err;
  }
}
const { bootstrapInternalAgent } = require('../../scripts/internal-agent-bootstrap');
const {
  openSession: openFeedbackSession,
  appendToSession: appendFeedbackContext,
  finalizeSession: finalizeFeedbackSession,
} = require('../../scripts/feedback-session');

const SERVER_INFO = { name: 'thumbgate-mcp', version: '1.16.0' };
const COMMERCE_CATEGORIES = [
  'product_recommendation',
  'brand_compliance',
  'sizing',
  'pricing',
  'regulatory',
];
const SAFE_DATA_DIR = path.resolve(path.dirname(FEEDBACK_LOG_PATH));

function resolveSafePath(targetPath, { mustExist = false } = {}) {
  const baseDir = SAFE_DATA_DIR;
  const resolved = path.resolve(baseDir, String(targetPath || ''));
  const relative = path.relative(baseDir, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path must stay within ${baseDir}`);
  }

  if (mustExist && !fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }

  return resolved;
}

function resolveImportDocumentPath(targetPath) {
  const workspaceRoot = path.resolve(process.cwd());
  const resolved = path.resolve(workspaceRoot, String(targetPath || ''));
  const allowedRoots = [workspaceRoot, SAFE_DATA_DIR]
    .filter(Boolean)
    .map((root) => path.resolve(root));
  const allowed = allowedRoots.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });

  if (!allowed) {
    throw new Error(`Path must stay within ${workspaceRoot} or ${SAFE_DATA_DIR}`);
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }

  return resolved;
}

function resolveWorkspaceCwd(targetPath) {
  if (!targetPath) return undefined;
  const workspaceRoot = path.resolve(process.cwd());
  const resolved = path.resolve(workspaceRoot, String(targetPath));
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`cwd must stay within ${workspaceRoot}`);
  }
  return resolved;
}

function toTextResult(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return {
    content: [{ type: 'text', text }],
  };
}

// Format corrective actions as a top-level <system-reminder> block so the
// calling agent treats them as first-class guidance, not buried JSON.
// Shape of `actions` varies: lesson-db.inferCorrectiveActions returns
// {whatToChange, tags, timestamp}; lesson-search.buildSystemActions returns
// {type, source, text}. Normalize to a single bulleted list.
function formatCorrectiveActionsReminder(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return '';
  const lines = ['<system-reminder>', 'ThumbGate surfaced prior lessons matching this failure.', 'REVIEW BEFORE YOUR NEXT ACTION:'];
  actions.slice(0, 5).forEach((action, idx) => {
    const text = (action && (action.whatToChange || action.text || action.message)) || '';
    if (!text) return;
    const tags = Array.isArray(action.tags) && action.tags.length > 0 ? ` [${action.tags.join(', ')}]` : '';
    lines.push(`${idx + 1}. ${String(text).trim()}${tags}`);
  });
  lines.push('</system-reminder>', '');
  return lines.join('\n');
}

// Wrap capture_feedback payloads so correctiveActions surface as a
// top-level <system-reminder> text block appended alongside the JSON body.
//
// Ordering: JSON body is content[0] (preserves backward compatibility with
// callers that parse content[0].text as JSON); the reminder is content[1]
// so it still appears as a top-level block the agent must process — not
// buried inside the JSON structure.
function toCaptureFeedbackTextResult(result) {
  const body = JSON.stringify(result, null, 2);
  const blocks = [{ type: 'text', text: body }];
  const reminder = result && Array.isArray(result.correctiveActions)
    ? formatCorrectiveActionsReminder(result.correctiveActions)
    : '';
  if (reminder) {
    blocks.push({ type: 'text', text: reminder });
  }
  return { content: blocks };
}

function formatContextPack(pack) {
  const lines = [
    '## Context Pack',
    '',
    `Pack ID: ${pack.packId}`,
    `Items: ${Array.isArray(pack.items) ? pack.items.length : 0}`,
  ];

  const visibleTitles = pack.visibility && Array.isArray(pack.visibility.visibleTitles)
    ? pack.visibility.visibleTitles
    : [];
  if (visibleTitles.length > 0) {
    lines.push(`Visible titles: ${visibleTitles.join(' | ')}`);
  }

  for (const item of (pack.items || []).slice(0, 5)) {
    lines.push(`- [${item.namespace}] ${item.title} (score ${item.score})`);
  }

  return lines.join('\n');
}

function buildRecallResponse(args = {}) {
  const limit = checkLimit('recall');
  ensureContextFs();
  const pack = constructContextPack({
    query: args.query || '',
    maxItems: Number(args.limit || 5),
  });
  const impact = analyzeCodeGraphImpact({
    intentId: null,
    context: args.query || '',
    repoPath: args.repoPath,
  });
  const section = formatCodeGraphRecallSection(impact);
  let text = section
    ? `${formatContextPack(pack)}\n\n${section}`
    : formatContextPack(pack);

  if (!limit.allowed) {
    text += '\n\n---\n';
    text += 'Upgrade to Context Gateway for unlimited recall, shared workflow memory, and hosted rollout.\n';
    text += 'Hosted API: https://thumbgate-production.up.railway.app\n';
    text += 'Pro pack: https://thumbgate-production.up.railway.app/checkout/pro';
  }

  return toTextResult(text);
}

function buildDiagnoseFailureResponse(args = {}) {
  let intentPlan = null;
  const requestedProfile = args.mcpProfile || getActiveMcpProfile();

  if (args.intentId) {
    try {
      const module = loadPrivateMcpModule('intentRouter');
      intentPlan = module ? module.planIntent({
        intentId: args.intentId,
        context: args.context || '',
        mcpProfile: requestedProfile,
        approved: args.approved === true,
        repoPath: args.repoPath,
      }) : null;
    } catch (_) {
      intentPlan = null;
    }
  }

  const allowedToolNames = getAllowedTools(requestedProfile);
  const result = diagnoseFailure({
    step: args.step,
    context: args.context || '',
    toolName: args.toolName,
    toolArgs: args.toolArgs,
    output: args.output,
    error: args.error,
    exitCode: args.exitCode,
    verification: args.verification,
    guardrails: args.guardrails,
    rubricScores: args.rubricScores,
    intentPlan,
    mcpProfile: requestedProfile,
    allowedToolNames,
    toolSchemas: TOOLS.filter((tool) => allowedToolNames.includes(tool.name)),
    includeConstraints: true,
    projectRoot: args.repoPath,
  });

  return toTextResult(result);
}

function buildContextPackResponse(args = {}) {
  ensureContextFs();
  const namespaces = normalizeNamespaces(Array.isArray(args.namespaces) ? args.namespaces : []);
  const pack = constructContextPack({
    query: args.query || '',
    maxItems: Number(args.maxItems || 8),
    maxChars: Number(args.maxChars || 6000),
    namespaces,
  });
  return toTextResult(pack);
}

function buildContextEvaluationResponse(args = {}) {
  if (!args.packId || !args.outcome) {
    throw new Error('packId and outcome are required');
  }

  let rubricEvaluation = null;
  if (args.rubricScores != null || args.guardrails != null) {
    rubricEvaluation = buildRubricEvaluation({
      rubricScores: args.rubricScores,
      guardrails: args.guardrails,
    });
  }

  const evaluation = evaluateContextPack({
    packId: args.packId,
    outcome: args.outcome,
    signal: args.signal || null,
    notes: args.notes || '',
    rubricEvaluation,
  });

  return toTextResult(evaluation);
}

function buildExportDpoResponse(args = {}) {
  let memories = [];

  if (args.inputPath) {
    const inputPath = resolveSafePath(args.inputPath, { mustExist: true });
    const raw = fs.readFileSync(inputPath, 'utf-8');
    const parsed = JSON.parse(raw);
    memories = Array.isArray(parsed) ? parsed : parsed.memories || [];
  } else {
    const memoryLogPath = args.memoryLogPath
      ? resolveSafePath(args.memoryLogPath, { mustExist: true })
      : DEFAULT_LOCAL_MEMORY_LOG;
    memories = readJSONL(memoryLogPath);
  }

  const result = exportDpoFromMemories(memories);
  if (args.outputPath) {
    const outputPath = resolveSafePath(args.outputPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, result.jsonl);
  }

  return toTextResult({
    pairs: result.pairs.length,
    errors: result.errors.length,
    learnings: result.learnings.length,
    unpairedErrors: result.unpairedErrors.length,
    unpairedLearnings: result.unpairedLearnings.length,
    outputPath: args.outputPath ? resolveSafePath(args.outputPath) : null,
  });
}

function buildCommerceRecallResponse(args = {}) {
  const requestedCategories = Array.isArray(args.categories) && args.categories.length > 0
    ? args.categories
    : COMMERCE_CATEGORIES;
  const modelPath = path.join(SAFE_DATA_DIR, 'feedback_model.json');
  const reliability = getReliability(loadModel(modelPath));
  const lines = ['## Commerce Quality Scores', ''];

  for (const category of requestedCategories) {
    const stats = reliability[category];
    if (!stats) continue;
    const successRate = typeof stats.success_rate === 'number'
      ? `${(stats.success_rate * 100).toFixed(1)}%`
      : 'n/a';
    lines.push(`- ${category}: ${successRate} success rate over ${stats.total || 0} samples`);
  }

  if (lines.length === 2) {
    lines.push('- No commerce quality scores recorded yet.');
  }

  lines.push('');
  lines.push(`Query: ${args.query || ''}`);
  return toTextResult(lines.join('\n'));
}

function buildEstimateUncertaintyResponse(args = {}) {
  const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
  const { MEMORY_LOG_PATH } = getFeedbackPaths();
  const memories = readJSONL(MEMORY_LOG_PATH);
  const matching = memories.filter((entry) => {
    if (!tags.length) return Boolean(entry && entry.bayesian);
    const entryTags = Array.isArray(entry && entry.tags) ? entry.tags : [];
    return entry && entry.bayesian && entryTags.some((tag) => tags.includes(tag));
  });

  const uncertainties = matching
    .map((entry) => Number(entry.bayesian && entry.bayesian.uncertainty))
    .filter((value) => Number.isFinite(value));
  const averageUncertainty = uncertainties.length > 0
    ? Number((uncertainties.reduce((sum, value) => sum + value, 0) / uncertainties.length).toFixed(4))
    : 0;

  return toTextResult({
    tags,
    matches: matching.length,
    averageUncertainty,
    minUncertainty: uncertainties.length > 0 ? Math.min(...uncertainties) : 0,
    maxUncertainty: uncertainties.length > 0 ? Math.max(...uncertainties) : 0,
  });
}

async function callTool(name, args = {}) {
  assertToolAllowed(name, getActiveMcpProfile());
  if (name !== 'workflow_sentinel') {
    const firewallResult = (await evaluateGatesAsync(name, args)) || evaluateSecretGuard({ tool_name: name, tool_input: args });
    if (firewallResult && firewallResult.decision === 'deny') {
      const err = new Error(`Action blocked by Semantic Firewall: ${firewallResult.message}`);
      err.errorCategory = 'permission';
      err.isRetryable = false;
      throw err;
    }
  }
  const startMs = Date.now();
  const result = await callToolInner(name, args);
  const latencyMs = Date.now() - startMs;
  try {
    const { recordAuditEvent } = require('../../scripts/audit-trail');
    recordAuditEvent({
      toolName: name,
      toolInput: args,
      decision: 'allow',
      latencyMs,
      source: 'tool-latency',
    });
  } catch { /* audit write failure must never break tool response */ }
  return result;
}

async function callToolInner(name, args) {
  args = args || {};
  // Semantic Aliases for high-level branding alignment
  if (name === 'capture_memory_feedback') name = 'capture_feedback';
  if (name === 'get_reliability_rules') name = 'prevention_rules';
  if (name === 'describe_reliability_entity') name = 'describe_semantic_entity';

  switch (name) {
    case 'capture_feedback':

      return toCaptureFeedbackTextResult(captureFeedback(args));
    case 'feedback_summary':
      return toTextResult(feedbackSummary(Number(args.recent || 20)));
    case 'search_lessons': {
      const module = loadPrivateMcpModule('lessonSearch');
      if (!module) return unavailablePrivateMcpFeature('search_lessons');
      return toTextResult(module.searchLessons(args.query || '', {
        limit: Number(args.limit || 10),
        category: args.category,
        tags: Array.isArray(args.tags) ? args.tags : [],
      }));
    }
    case 'retrieve_lessons': {
      // Cross-encoder reranking: retrieve more candidates, then rerank for precision
      const { retrieveWithRerankingSync } = loadOptionalModule(path.join(__dirname, '../../scripts/cross-encoder-reranker'), () => ({
        retrieveWithRerankingSync: (toolName, actionContext, options = {}) => retrieveRelevantLessons(
          toolName,
          actionContext,
          { maxResults: options.maxResults || 5 },
        ),
      }));
      return toTextResult(retrieveWithRerankingSync(
        args.toolName,
        args.actionContext || '',
        {
          candidateCount: 20,
          maxResults: Number(args.maxResults || 5),
        },
      ));
    }
    case 'search_thumbgate':
      enforceLimit('search_thumbgate');
      return toTextResult(searchThumbgate({
        query: args.query,
        limit: args.limit,
        source: args.source,
        signal: args.signal,
      }));
    case 'import_document':
      return toTextResult(importDocument({
        filePath: args.filePath ? resolveImportDocumentPath(args.filePath) : null,
        content: typeof args.content === 'string' ? args.content : null,
        title: args.title,
        sourceFormat: args.sourceFormat,
        sourceUrl: args.sourceUrl,
        tags: Array.isArray(args.tags) ? args.tags : [],
        proposeGates: args.proposeGates !== false,
      }));
    case 'list_imported_documents':
      return toTextResult(listImportedDocuments({
        query: args.query || '',
        tag: args.tag || null,
        limit: Number(args.limit || 20),
      }));
    case 'get_imported_document': {
      const document = readImportedDocument(args.documentId);
      if (!document) {
        throw new Error(`Imported document not found: ${args.documentId}`);
      }
      return toTextResult(document);
    }
    case 'feedback_stats':
      return toTextResult(analyzeFeedback());
    case 'diagnose_failure':
      return buildDiagnoseFailureResponse(args);
    case 'reflect_on_feedback':
      {
        const module = loadPrivateMcpModule('reflectorAgent');
        if (!module) return unavailablePrivateMcpFeature('reflect_on_feedback');
        return toTextResult(module.reflect({
        conversationWindow: args.conversationWindow || [],
        context: args.context || '',
        whatWentWrong: args.whatWentWrong || '',
        structuredRule: null,
        feedbackEvent: args.feedbackEventId ? { id: args.feedbackEventId } : null,
        }));
      }
    case 'report_product_issue':
      return toTextResult(await submitProductIssue({
        title: args.title,
        body: args.body,
        category: args.category || 'bug',
        source: 'mcp tool',
      }));
    case 'list_intents':
      {
        const module = loadPrivateMcpModule('intentRouter');
        if (!module) return unavailablePrivateMcpFeature('list_intents');
        return toTextResult(module.listIntents({
          mcpProfile: args.mcpProfile,
          bundleId: args.bundleId,
          partnerProfile: args.partnerProfile,
        }));
      }
    case 'plan_intent':
      {
        const module = loadPrivateMcpModule('intentRouter');
        if (!module) return unavailablePrivateMcpFeature('plan_intent');
        return toTextResult(module.planIntent({
          intentId: args.intentId,
          context: args.context || '',
          mcpProfile: args.mcpProfile,
          bundleId: args.bundleId,
          partnerProfile: args.partnerProfile,
          delegationMode: args.delegationMode,
          approved: args.approved === true,
          repoPath: args.repoPath,
        }));
      }
    case 'start_handoff':
      {
        const intentRouter = loadPrivateMcpModule('intentRouter');
        const delegationRuntime = loadPrivateMcpModule('delegationRuntime');
        if (!intentRouter || !delegationRuntime) return unavailablePrivateMcpFeature('start_handoff');
        return toTextResult(delegationRuntime.startHandoff({
          plan: intentRouter.planIntent({
            intentId: args.intentId,
            context: args.context || '',
            mcpProfile: args.mcpProfile,
            bundleId: args.bundleId,
            partnerProfile: args.partnerProfile,
            delegationMode: 'sequential',
            approved: args.approved === true,
            repoPath: args.repoPath,
          }),
          context: args.context || '',
          mcpProfile: args.mcpProfile || getActiveMcpProfile(),
          partnerProfile: args.partnerProfile || null,
          repoPath: args.repoPath,
          delegateProfile: args.delegateProfile || null,
          plannedChecks: Array.isArray(args.plannedChecks) ? args.plannedChecks : [],
        }));
      }
    case 'complete_handoff':
      {
        const module = loadPrivateMcpModule('delegationRuntime');
        if (!module) return unavailablePrivateMcpFeature('complete_handoff');
        return toTextResult(module.completeHandoff({
          handoffId: args.handoffId,
          outcome: args.outcome,
          resultContext: args.resultContext || '',
          attempts: args.attempts,
          violationCount: args.violationCount,
          tokenEstimate: args.tokenEstimate,
          latencyMs: args.latencyMs,
          summary: args.summary || '',
        }));
      }
    case 'enforcement_matrix':
      return toTextResult(listEnforcementMatrix());
    case 'security_scan': {
      const { scanCode, scanDependencyChange, scanGitDiff } = require('../../scripts/security-scanner');
      if (args.diffMode) {
        return toTextResult(scanGitDiff(args.content));
      }
      const codeResult = scanCode(args.content, args.filePath || '');
      if (args.filePath && args.filePath.endsWith('package.json')) {
        const supplyResult = scanDependencyChange('', args.content);
        codeResult.findings = (codeResult.findings || []).concat(supplyResult.findings || []);
        codeResult.detected = codeResult.detected || supplyResult.detected;
      }
      return toTextResult(codeResult);
    }
    case 'prevention_rules': {
      const outputPath = args.outputPath ? resolveSafePath(args.outputPath) : undefined;
      return toTextResult(writePreventionRules(outputPath, Number(args.minOccurrences || 2)));
    }
    case 'export_dpo_pairs':
      enforceLimit('export_dpo');
      return buildExportDpoResponse(args);
    case 'export_hf_dataset': {
      enforceLimit('export_dpo');
      const outputDir = args.outputDir ? resolveSafePath(args.outputDir) : undefined;
      return toTextResult(exportHfDataset({
        outputDir,
        includeProvenance: args.includeProvenance !== false,
      }));
    }
    case 'export_databricks_bundle': {
      enforceLimit('export_databricks');
      const outputPath = args.outputPath ? resolveSafePath(args.outputPath) : undefined;
      return toTextResult(exportDatabricksBundle(undefined, outputPath));
    }
    case 'construct_context_pack':
      return buildContextPackResponse(args);
    case 'evaluate_context_pack':
      return buildContextEvaluationResponse(args);
    case 'context_provenance':
      return toTextResult({ events: getProvenance(Number(args.limit || 50)) });
    case 'generate_skill':
      return toTextResult({
        skills: generateSkills({
          minClusterSize: Number(args.minOccurrences || 3),
        }).filter((entry) => {
          if (!Array.isArray(args.tags) || args.tags.length === 0) return true;
          return args.tags.some((tag) => entry.skillName.includes(String(tag)));
        }),
      });
    case 'recall':
      return buildRecallResponse(args);
    case 'unified_context': {
      const ctx = assembleUnifiedContext({
        query: args.query || '',
        toolName: args.toolName,
        toolInput: args.toolInput,
        agentType: args.agentType,
        repoPath: args.repoPath,
      });
      return toTextResult(formatUnifiedContext(ctx));
    }
    case 'satisfy_gate': {
      if (!args.gate) {
        throw new Error('gate is required');
      }
      const entry = satisfyCondition(args.gate, args.evidence || '', args.structuredReasoning || null);
      const result = { satisfied: true, gate: args.gate, ...entry };
      // Log structured reasoning to audit trail for learning
      if (args.structuredReasoning) {
        recordAuditEvent({
          toolName: 'satisfy_gate',
          toolInput: { gate: args.gate },
          decision: 'allow',
          gateId: args.gate,
          message: `Gate satisfied with structured reasoning: ${args.structuredReasoning.conclusion || 'no conclusion'}`,
          source: 'structured-reasoning',
        });
      }
      return toTextResult(result);
    }
    case 'set_task_scope':
      return toTextResult({
        scope: setTaskScope({
          taskId: args.taskId,
          summary: args.summary,
          allowedPaths: args.allowedPaths,
          protectedPaths: args.protectedPaths,
          repoPath: args.repoPath,
          localOnly: args.localOnly === true,
          clear: args.clear === true,
        }),
      });
    case 'get_scope_state':
      return toTextResult(getScopeState());
    case 'set_branch_governance':
      return toTextResult({
        branchGovernance: setBranchGovernance({
          branchName: args.branchName,
          baseBranch: args.baseBranch,
          prRequired: args.prRequired,
          prNumber: args.prNumber,
          prUrl: args.prUrl,
          queueRequired: args.queueRequired,
          localOnly: args.localOnly === true,
          releaseVersion: args.releaseVersion,
          releaseEvidence: args.releaseEvidence,
          releaseSensitiveGlobs: args.releaseSensitiveGlobs,
          clear: args.clear === true,
        }),
      });
    case 'get_branch_governance':
      return toTextResult(getBranchGovernanceState());
    case 'approve_protected_action':
      return toTextResult({
        approved: true,
        approval: approveProtectedAction({
          pathGlobs: args.pathGlobs,
          reason: args.reason,
          evidence: args.evidence,
          taskId: args.taskId,
          ttlMs: args.ttlMs,
        }),
      });
    case 'track_action': {
      const entry = trackAction(args.actionId, args.metadata || {});
      return toTextResult({
        tracked: true,
        actionId: args.actionId,
        ...entry,
      });
    }
    case 'verify_claim':
      return toTextResult(verifyClaimEvidence(args.claim));
    case 'require_evidence_for_claim': {
      if (!args.claim || typeof args.claim !== 'string') {
        throw new Error('claim is required and must be a string');
      }
      const verification = verifyClaimEvidence(args.claim);
      const mode = args.mode === 'advisory' ? 'advisory' : 'blocking';
      const hasMatchingChecks = Array.isArray(verification.checks) && verification.checks.length > 0;
      const evidenceMissing = hasMatchingChecks && !verification.verified;
      const blocking = mode === 'blocking' && evidenceMissing;
      const missingActions = hasMatchingChecks
        ? Array.from(new Set(verification.checks.flatMap((check) => check.missing || [])))
        : [];
      try {
        const { recordAuditEvent } = require('../../scripts/audit-trail');
        recordAuditEvent({
          toolName: 'require_evidence_for_claim',
          toolInput: { claim: args.claim, mode, sessionId: args.sessionId || null },
          decision: blocking ? 'deny' : 'allow',
          gateId: 'completion_claim',
          message: blocking
            ? `Completion claim blocked — missing evidence: ${missingActions.join(', ') || 'unknown'}`
            : `Completion claim verified (${verification.verified ? 'evidence present' : 'no matching gate'})`,
          source: 'completion-gate',
        });
      } catch { /* audit write must never break tool response */ }
      return toTextResult({
        claim: args.claim,
        mode,
        blocking,
        verified: verification.verified,
        matchedChecks: hasMatchingChecks,
        missingActions,
        checks: verification.checks,
        sessionId: args.sessionId || null,
      });
    }
    case 'distribute_context_to_agents':
      {
        const module = loadPrivateMcpModule('swarmCoordinator');
        if (!module) return unavailablePrivateMcpFeature('distribute_context_to_agents');
        return toTextResult(module.distributeContextToAgents({
        query: args.query || '',
        agents: args.agents,
        maxItems: args.maxItems,
        maxChars: args.maxChars,
        namespaces: Array.isArray(args.namespaces) ? args.namespaces : [],
        ttlMs: args.ttlMs,
        }));
      }
    case 'session_report':
      {
        const module = loadPrivateMcpModule('sessionReport');
        if (!module) return unavailablePrivateMcpFeature('session_report');
        return toTextResult(module.buildSessionReport({ windowHours: args.windowHours }));
      }
    case 'generate_operator_artifact': {
      const module = loadPrivateMcpModule('operatorArtifacts');
      if (!module) return unavailablePrivateMcpFeature('generate_operator_artifact');
      const artifact = await module.generateOperatorArtifact({
        type: args.type,
        windowHours: args.windowHours,
      });
      if (args.format === 'markdown') {
        return toTextResult(module.formatArtifactMarkdown(artifact));
      }
      return toTextResult(artifact);
    }
    case 'check_operational_integrity':
      return toTextResult(evaluateOperationalIntegrity({
        repoPath: args.repoPath,
        baseBranch: args.baseBranch,
        command: args.command,
        requirePrForReleaseSensitive: args.requirePrForReleaseSensitive === true,
        requireVersionNotBehindBase: args.requireVersionNotBehindBase === true,
        branchGovernance: getBranchGovernanceState(),
      }));
    case 'workflow_sentinel':
      return toTextResult(evaluateWorkflowSentinel(args.toolName, {
        command: args.command,
        path: args.filePath,
        changedFiles: Array.isArray(args.changedFiles) ? args.changedFiles : [],
        repoPath: args.repoPath,
        baseBranch: args.baseBranch,
      }, {
        repoPath: args.repoPath,
        baseBranch: args.baseBranch,
        affectedFiles: Array.isArray(args.changedFiles) ? args.changedFiles : undefined,
        requirePrForReleaseSensitive: args.requirePrForReleaseSensitive === true,
        requireVersionNotBehindBase: args.requireVersionNotBehindBase === true,
        governanceState: getScopeState(),
      }));
    case 'register_claim_gate':
      return toTextResult(registerClaimGate(args.claimPattern, args.requiredActions, args.message));
    case 'gate_stats':
      return toTextResult(loadGateStats());
    case 'dashboard':
      return toTextResult(generateDashboard(getFeedbackPaths().FEEDBACK_DIR));
    case 'org_dashboard':
      {
        const module = loadPrivateMcpModule('orgDashboard');
        if (!module) return unavailablePrivateMcpFeature('org_dashboard');
        return toTextResult(module.generateOrgDashboard({ windowHours: Number(args.windowHours || 24) }));
      }
    case 'settings_status':
      return toTextResult(getSettingsStatus());
    case 'native_messaging_audit':
      return toTextResult(buildNativeMessagingAudit({
        platform: args.platform,
        homeDir: args.homeDir,
        aiOnly: args.aiOnly === true,
      }));
    case 'commerce_recall':
      enforceLimit('commerce_recall');
      return buildCommerceRecallResponse(args);
    case 'get_business_metrics': {
      const module = loadPrivateMcpModule('semanticLayer');
      if (!module) return unavailablePrivateMcpFeature('get_business_metrics');
      const metrics = await module.getBusinessMetrics(args);
      return toTextResult(metrics);
    }
    case 'describe_semantic_entity': {
      const module = loadPrivateMcpModule('semanticLayer');
      if (!module) return unavailablePrivateMcpFeature('describe_semantic_entity');
      const schema = module.describeSemanticSchema();
      const entity = schema.entities[args.type] || schema.metrics[args.type];
      if (!entity) {
        throw new Error(`Unknown semantic entity: ${args.type}`);
      }
      return toTextResult(entity);
    }
    case 'estimate_uncertainty':
      return buildEstimateUncertaintyResponse(args);
    case 'bootstrap_internal_agent':
      return toTextResult(bootstrapInternalAgent(args));
    case 'session_handoff':
      return toTextResult(writeSessionHandoff(args));
    case 'session_primer': {
      const primer = readSessionHandoff();
      if (!primer) return toTextResult({ message: 'No session primer found. This is the first session.' });
      return toTextResult(primer);
    }
    case 'list_harnesses':
      return toTextResult({ harnesses: listHarnesses({ tag: args.tag }) });
    case 'run_harness':
      return toTextResult(runHarness(args.harness, args.inputs || {}, { jobId: args.jobId }));
    case 'plan_multimodal_retrieval':
      return toTextResult(buildMultimodalRetrievalPlan(args));
    case 'plan_context_footprint':
      return toTextResult(buildContextFootprintReport({
        tools: TOOLS,
        entries: Array.isArray(args.entries) ? args.entries : undefined,
        anchors: Array.isArray(args.anchors) ? args.anchors : undefined,
        schemaUrlTemplate: args.schemaUrlTemplate || '/.well-known/mcp/tools/{name}.json',
        targetReduction: args.targetReduction,
        windowSize: args.windowSize,
        perEntryMaxChars: args.perEntryMaxChars,
        totalMaxChars: args.totalMaxChars,
      }));
    case 'run_autoresearch': {
      const iterations = Math.max(1, Math.min(5, Number(args.iterations || 1)));
      const timeoutMs = Math.max(1000, Math.min(600000, Number(args.timeoutMs || 120000)));
      const holdoutCommands = Array.isArray(args.holdoutCommands)
        ? args.holdoutCommands.filter((command) => typeof command === 'string' && command.trim())
        : [];
      const result = await runAutoresearchLoop({
        iterations,
        targetName: args.targetName || undefined,
        nextValue: Number.isFinite(args.nextValue) ? args.nextValue : undefined,
        testCommand: args.testCommand || 'npm test',
        holdoutCommands,
        timeoutMs,
        cwd: resolveWorkspaceCwd(args.cwd),
        researchQuery: args.researchQuery || null,
        paperLimit: Math.max(1, Math.min(10, Number(args.paperLimit || 5))),
      });
      return toTextResult({
        ...result,
        controls: {
          iterations,
          timeoutMs,
          holdoutCommands,
          maxIterationsPerCall: 5,
          maxTimeoutMs: 600000,
        },
      });
    }
    case 'open_feedback_session':
      return toTextResult(openFeedbackSession(args.feedbackEventId, args.signal, args.initialContext));
    case 'append_feedback_context':
      return toTextResult(appendFeedbackContext(args.sessionId, args.message, args.role));
    case 'finalize_feedback_session':
      return toTextResult(finalizeFeedbackSession(args.sessionId));
    case 'run_managed_lesson_agent': {
      const module = loadPrivateMcpModule('managedLessonAgent');
      if (!module) return unavailablePrivateMcpFeature('run_managed_lesson_agent');
      return toTextResult(await module.runManagedAgent({ dryRun: args.dryRun, limit: args.limit, model: args.model }));
    }
    case 'managed_agent_status': {
      const module = loadPrivateMcpModule('managedLessonAgent');
      if (!module) return unavailablePrivateMcpFeature('managed_agent_status');
      return toTextResult(module.getManagedAgentStatus() || { message: 'No managed agent runs recorded yet.' });
    }
    case 'run_self_distill': {
      const { runSelfDistill } = require('../../scripts/self-distill-agent');
      return toTextResult(await runSelfDistill({ dryRun: args.dryRun, limit: args.limit, model: args.model }));
    }
    case 'self_distill_status': {
      const { getSelfDistillStatus } = require('../../scripts/self-distill-agent');
      return toTextResult(getSelfDistillStatus() || { message: 'No self-distill runs found.' });
    }
    case 'context_stuff_lessons': {
      const module = loadPrivateMcpModule('lessonInference');
      if (!module) return unavailablePrivateMcpFeature('context_stuff_lessons');
      return toTextResult(module.getAllLessonsForContext({
        maxTokenBudget: args.maxTokenBudget,
        signal: args.signal,
        format: args.format,
      }));
    }
    default:
      throw new Error(`Unsupported tool: ${name}`);
  }
}

async function handleRequest(message) {
  // Notifications have no id and expect no response
  if (message.id === undefined || message.id === null) {
    return null;
  }
  if (message.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    };
  }
  if (message.method === 'ping') return {};
  if (message.method === 'tools/list') return { tools: TOOLS };
  if (message.method === 'tools/call') return callTool(message.params.name, message.params.arguments);
  throw new Error(`Unsupported method: ${message.method}`);
}

function tryParseMessage(buffer) {
  const source = buffer.toString('utf8');

  const headerEnd = source.indexOf('\r\n\r\n');
  if (headerEnd !== -1) {
    const header = source.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      throw new Error('Missing Content-Length header');
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) {
      return null;
    }
    let request;
    try {
      request = JSON.parse(buffer.slice(bodyStart, bodyStart + length).toString('utf8'));
    } catch (err) {
      err.transport = 'framed';
      err.jsonrpcCode = -32700;
      throw err;
    }
    return {
      request,
      remaining: buffer.slice(bodyStart + length),
      transport: 'framed',
    };
  }

  const newlineIndex = source.indexOf('\n');
  if (newlineIndex === -1) return null;
  const line = source.slice(0, newlineIndex).trim();
  if (!line) {
    return {
      request: null,
      remaining: Buffer.from(source.slice(newlineIndex + 1)),
    };
  }
  let request;
  try {
    request = JSON.parse(line);
  } catch (err) {
    err.transport = 'ndjson';
    err.jsonrpcCode = -32603;
    throw err;
  }
  return {
    request,
    remaining: Buffer.from(source.slice(newlineIndex + 1)),
    transport: 'ndjson',
  };
}

function writeResponse(id, payload, error = null) {
  const body = JSON.stringify(error
    ? { jsonrpc: '2.0', id, error }
    : { jsonrpc: '2.0', id, result: payload });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

function writeNdjsonResponse(id, payload, error = null) {
  const body = JSON.stringify(error
    ? { jsonrpc: '2.0', id, error }
    : { jsonrpc: '2.0', id, result: payload });
  process.stdout.write(`${body}\n`);
}

/**
 * Default staleness threshold: if a lock is older than this (ms), the holder
 * is considered orphaned even if its PID is still alive — it likely belongs
 * to a defunct Claude Code session whose process was never reaped.
 */
const LOCK_STALE_MS = Number(process.env.THUMBGATE_LOCK_STALE_MS) || 2 * 60 * 60 * 1000; // 2 hours

/**
 * Acquire a file-system lock to prevent duplicate MCP server instances.
 * Returns { lockFile, cleanupLock } on success, or calls process.exit(1)
 * if another live server holds the lock.
 *
 * Staleness reaping: if the lock-holding process is alive but the lock is
 * older than LOCK_STALE_MS, the holder is killed (SIGTERM) and the lock is
 * reclaimed. This prevents orphaned `thumbgate serve` processes from permanently
 * blocking new sessions.
 */
function acquireLock() {
  const feedbackDir = getFeedbackPaths().FEEDBACK_DIR;
  const lockFile = path.join(feedbackDir, '.mcp-server.lock');
  try {
    fs.mkdirSync(feedbackDir, { recursive: true });
    if (fs.existsSync(lockFile)) {
      const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      let isRunning = false;
      try { process.kill(lockData.pid, 0); isRunning = true; } catch { /* process is dead */ }

      if (isRunning) {
        const lockAge = Date.now() - new Date(lockData.startedAt).getTime();
        if (lockAge > LOCK_STALE_MS) {
          // Orphaned process — kill it and take over
          process.stderr.write(`[thumbgate] Lock held by PID ${lockData.pid} is ${Math.round(lockAge / 60000)}m old (threshold: ${Math.round(LOCK_STALE_MS / 60000)}m). Reaping orphaned process.\n`);
          try { process.kill(lockData.pid, 'SIGTERM'); } catch { /* already gone */ }
        } else {
          // Another session's MCP server is running — coexist via per-session lock.
          // Each Claude session communicates via its own stdio pipe and needs its own server.
          // SQLite WAL mode handles concurrent access safely.
          process.stderr.write(`[thumbgate] Another MCP server (PID ${lockData.pid}) is running for ${feedbackDir}. Starting concurrent session.\n`);
          const sessionLockFile = path.join(feedbackDir, `.mcp-server-${process.pid}.lock`);
          fs.writeFileSync(sessionLockFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
          const cleanupSessionLock = () => { try { fs.unlinkSync(sessionLockFile); } catch { /* already removed */ } };
          process.on('exit', cleanupSessionLock);
          process.on('SIGTERM', () => { cleanupSessionLock(); process.exit(0); });
          process.on('SIGINT', () => { cleanupSessionLock(); process.exit(0); });
          return { lockFile: sessionLockFile, cleanupLock: cleanupSessionLock };
        }
      }
      // Stale lock from a dead or reaped process — remove it
      try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
      process.stderr.write(`[thumbgate] Removed stale lock (PID ${lockData.pid} is no longer running).\n`);
    }
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const cleanupLock = () => { try { fs.unlinkSync(lockFile); } catch { /* already removed */ } };
    process.on('exit', cleanupLock);
    process.on('SIGTERM', () => { cleanupLock(); process.exit(0); });
    process.on('SIGINT', () => { cleanupLock(); process.exit(0); });
    return { lockFile, cleanupLock };
  } catch { /* best-effort lock */ }
  return { lockFile, cleanupLock: () => {} };
}

function startStdioServer() {
  acquireLock();

  process.stdin.resume();
  let buffer = Buffer.alloc(0);
  // Auto-detect transport from first request and lock it for the session.
  // mcp-proxy (Glama) sends NDJSON and expects NDJSON back.
  let sessionTransport = process.env.MCP_TRANSPORT || null;

  process.stdin.on('data', async (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);

    while (buffer.length > 0) {
      let parsed;
      try {
        parsed = tryParseMessage(buffer);
      } catch (err) {
        const error = {
          code: err.jsonrpcCode || -32700,
          message: err.message,
        };
        if (err.transport === 'ndjson' || sessionTransport === 'ndjson') {
          writeNdjsonResponse(null, null, error);
        } else {
          writeResponse(null, null, error);
        }
        buffer = Buffer.alloc(0);
        return;
      }

      if (!parsed) return;
      buffer = parsed.remaining;
      if (!parsed.request) continue;

      // Lock transport on first successful parse
      if (!sessionTransport && parsed.transport) {
        sessionTransport = parsed.transport;
      }

      const respond = sessionTransport === 'ndjson' ? writeNdjsonResponse : writeResponse;

      try {
        const result = await handleRequest(parsed.request);
        if (result !== null) {
          respond(parsed.request.id ?? null, result);
        }
      } catch (err) {
        respond(parsed.request.id ?? null, null, {
          code: -32603,
          message: err.message,
        });
      }
    }
  });
}

if (require.main === module) startStdioServer();

module.exports = {
  TOOLS,
  SAFE_DATA_DIR,
  handleRequest,
  callTool,
  startStdioServer,
  acquireLock,
  toCaptureFeedbackTextResult,
  formatCorrectiveActionsReminder,
  __test__: {
    PRIVATE_MCP_MODULES,
    loadPrivateMcpModule,
    unavailablePrivateMcpFeature,
    callToolInner,
  },
};
