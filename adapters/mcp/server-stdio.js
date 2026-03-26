#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

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
  listIntents,
  planIntent,
} = require('../../scripts/intent-router');
const {
  startHandoff,
  completeHandoff,
} = require('../../scripts/delegation-runtime');
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
} = require('../../scripts/gates-engine');
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
const { generateSkills } = require('../../scripts/skill-generator');
const {
  loadModel,
  getReliability,
} = require('../../scripts/thompson-sampling');
const {
  searchLessons,
} = require('../../scripts/lesson-search');
const {
  searchRlhf,
} = require('../../scripts/rlhf-search');
const { checkLimit } = require('../../scripts/rate-limiter');
const { TOOLS } = require('../../scripts/tool-registry');
const { bootstrapInternalAgent } = require('../../scripts/internal-agent-bootstrap');

const SERVER_INFO = { name: 'mcp-memory-gateway-mcp', version: '0.8.2' };
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

function toTextResult(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return {
    content: [{ type: 'text', text }],
  };
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
    text += 'Hosted API: https://rlhf-feedback-loop-production.up.railway.app\n';
    text += 'Pro pack: https://rlhf-feedback-loop-production.up.railway.app/checkout/pro';
  }

  return toTextResult(text);
}

function buildDiagnoseFailureResponse(args = {}) {
  let intentPlan = null;
  const requestedProfile = args.mcpProfile || getActiveMcpProfile();

  if (args.intentId) {
    try {
      intentPlan = planIntent({
        intentId: args.intentId,
        context: args.context || '',
        mcpProfile: requestedProfile,
        approved: args.approved === true,
        repoPath: args.repoPath,
      });
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
  const firewallResult = (await evaluateGatesAsync(name, args)) || evaluateSecretGuard({ tool_name: name, tool_input: args });
  if (firewallResult && firewallResult.decision === 'deny') {
    const err = new Error(`Action blocked by Semantic Firewall: ${firewallResult.message}`);
    err.errorCategory = 'permission';
    err.isRetryable = false;
    throw err;
  }
  return callToolInner(name, args);
}

async function callToolInner(name, args) {
  // Semantic Aliases for high-level branding alignment
  if (name === 'capture_memory_feedback') name = 'capture_feedback';
  if (name === 'get_reliability_rules') name = 'prevention_rules';
  if (name === 'describe_reliability_entity') name = 'describe_semantic_entity';

  switch (name) {
    case 'capture_feedback':

      return toTextResult(captureFeedback(args));
    case 'feedback_summary':
      return toTextResult(feedbackSummary(Number(args.recent || 20)));
    case 'search_lessons':
      return toTextResult(searchLessons(args.query || '', {
        limit: Number(args.limit || 10),
        category: args.category,
        tags: Array.isArray(args.tags) ? args.tags : [],
      }));
    case 'search_rlhf':
      return toTextResult(searchRlhf({
        query: args.query,
        limit: args.limit,
        source: args.source,
        signal: args.signal,
      }));
    case 'feedback_stats':
      return toTextResult(analyzeFeedback());
    case 'diagnose_failure':
      return buildDiagnoseFailureResponse(args);
    case 'list_intents':
      return toTextResult(listIntents({
        mcpProfile: args.mcpProfile,
        bundleId: args.bundleId,
        partnerProfile: args.partnerProfile,
      }));
    case 'plan_intent':
      return toTextResult(planIntent({
        intentId: args.intentId,
        context: args.context || '',
        mcpProfile: args.mcpProfile,
        bundleId: args.bundleId,
        partnerProfile: args.partnerProfile,
        delegationMode: args.delegationMode,
        approved: args.approved === true,
        repoPath: args.repoPath,
      }));
    case 'start_handoff':
      return toTextResult(startHandoff({
        plan: planIntent({
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
    case 'complete_handoff':
      return toTextResult(completeHandoff({
        handoffId: args.handoffId,
        outcome: args.outcome,
        resultContext: args.resultContext || '',
        attempts: args.attempts,
        violationCount: args.violationCount,
        tokenEstimate: args.tokenEstimate,
        latencyMs: args.latencyMs,
        summary: args.summary || '',
      }));
    case 'enforcement_matrix':
      return toTextResult(listEnforcementMatrix());
    case 'prevention_rules': {
      const outputPath = args.outputPath ? resolveSafePath(args.outputPath) : undefined;
      return toTextResult(writePreventionRules(outputPath, Number(args.minOccurrences || 2)));
    }
    case 'export_dpo_pairs':
      return buildExportDpoResponse(args);
    case 'export_databricks_bundle': {
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
    case 'satisfy_gate': {
      if (!args.gate) {
        throw new Error('gate is required');
      }
      const entry = satisfyCondition(args.gate, args.evidence || '');
      return toTextResult({
        satisfied: true,
        gate: args.gate,
        ...entry,
      });
    }
    case 'gate_stats':
      return toTextResult(loadGateStats());
    case 'dashboard':
      return toTextResult(generateDashboard(getFeedbackPaths().FEEDBACK_DIR));
    case 'commerce_recall':
      return buildCommerceRecallResponse(args);
    case 'get_business_metrics': {
      const { getBusinessMetrics } = require('../../scripts/semantic-layer');
      const metrics = await getBusinessMetrics(args);
      return toTextResult(metrics);
    }
    case 'describe_semantic_entity': {
      const { describeSemanticSchema } = require('../../scripts/semantic-layer');
      const schema = describeSemanticSchema();
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

function startStdioServer() {
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
};
