'use strict';

/**
 * Procedural Context & Skill Graph Engine
 * Architectural steal from Zachary Blumenfeld:
 * "Make Your AI Agents Predictable With Graph Engineering" (https://www.youtube.com/watch?v=g_NgCLTibiM)
 *
 * Implements the 6-step deterministic graph workflow:
 * 1. Unified 3-Layer Context Graph (short-term conversation memory, long-term domain entities + Systems of Record, timestamped decision traces).
 * 2. Initial Agent Decision Trace Capture & Canonical Working Path Discovery across inconsistent unconstrained runs.
 * 3. Unstructured SKILL.md + Decision Trace -> Deterministic Graph YAML Compiler (hard_rule_script, validation_lint_loop, escalation_router, calibrated_decision_model).
 * 4. Lightweight Procedural Graph Executor (programmatic routing without runtime LLM loops).
 * 5. Small Model (SLM / Claude Haiku / Local Drex Max v1) Execution Downgrader once routing is offloaded to graph edges.
 * 6. Graph Governance & Provenance Persistence (audit triggered vs. skipped conditional branches and detect drift over time).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_GRAPH_PATH =
  process.env.THUMBGATE_CONTEXT_GRAPH_PATH ||
  path.join(os.homedir(), '.thumbgate', 'runtime', 'procedural-context-graph.json');

const SUPPORTED_SYSTEMS_OF_RECORD = Object.freeze([
  'snowflake',
  'databricks',
  'obsidian_markdown',
  'stripe_billing',
  'github_repo',
  'thumbgate_ledger',
]);

const NODE_TYPES = Object.freeze({
  HARD_RULE_SCRIPT: 'hard_rule_script',
  VALIDATION_LINT_LOOP: 'validation_lint_loop',
  ESCALATION_ROUTER: 'escalation_router',
  CALIBRATED_DECISION_MODEL: 'calibrated_decision_model',
  TERMINAL_OUTCOME: 'terminal_outcome',
});

function createEmptyGraphState() {
  return {
    schemaVersion: '1.0.0',
    updatedAt: new Date().toISOString(),
    layers: {
      shortTermMemory: [],
      longTermMemory: [],
      decisionTraces: [],
    },
    compiledGraphs: {},
    persistedSkillRuns: [],
    edges: [],
  };
}

function loadGraphState(filePath = DEFAULT_GRAPH_PATH) {
  try {
    if (!fs.existsSync(filePath)) {
      return createEmptyGraphState();
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.layers) {
      return createEmptyGraphState();
    }
    parsed.layers.shortTermMemory = Array.isArray(parsed.layers.shortTermMemory)
      ? parsed.layers.shortTermMemory
      : [];
    parsed.layers.longTermMemory = Array.isArray(parsed.layers.longTermMemory)
      ? parsed.layers.longTermMemory
      : [];
    parsed.layers.decisionTraces = Array.isArray(parsed.layers.decisionTraces)
      ? parsed.layers.decisionTraces
      : [];
    parsed.compiledGraphs =
      parsed.compiledGraphs && typeof parsed.compiledGraphs === 'object'
        ? parsed.compiledGraphs
        : {};
    parsed.persistedSkillRuns = Array.isArray(parsed.persistedSkillRuns)
      ? parsed.persistedSkillRuns
      : [];
    parsed.edges = Array.isArray(parsed.edges) ? parsed.edges : [];
    return parsed;
  } catch (_err) {
    return createEmptyGraphState();
  }
}

function saveGraphState(state, filePath = DEFAULT_GRAPH_PATH) {
  state.updatedAt = new Date().toISOString();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

/**
 * 1. Build a Unified Context Graph Layer
 * Connects Systems of Record (Snowflake, Databricks, Markdown/Obsidian docs) alongside:
 * - shortTermMemory (conversation history)
 * - longTermMemory (extracted domain entities)
 * - decisionTraces (timestamped reasoning/decision traces with tool calls)
 */
function ingestUnifiedContextNode(options = {}, filePath = DEFAULT_GRAPH_PATH) {
  const state = loadGraphState(filePath);
  const now = new Date().toISOString();

  if (options.shortTermTurn && typeof options.shortTermTurn === 'object') {
    const turnId =
      options.shortTermTurn.id ||
      `stm_${crypto.randomBytes(6).toString('hex')}`;
    const node = {
      id: turnId,
      layer: 'short_term_memory',
      sessionId: String(options.shortTermTurn.sessionId || 'default_session'),
      role: String(options.shortTermTurn.role || 'user'),
      content: String(options.shortTermTurn.content || '').slice(0, 2000),
      timestamp: options.shortTermTurn.timestamp || now,
    };
    state.layers.shortTermMemory.push(node);
    if (state.layers.shortTermMemory.length > 500) {
      state.layers.shortTermMemory = state.layers.shortTermMemory.slice(-500);
    }
  }

  if (options.longTermEntity && typeof options.longTermEntity === 'object') {
    const entity = options.longTermEntity;
    const entityId =
      entity.id ||
      `ltm_${String(entity.entityType || 'entity').toLowerCase()}_${crypto
        .createHash('sha256')
        .update(String(entity.name || entity.uri || now))
        .digest('hex')
        .slice(0, 10)}`;
    const sor = SUPPORTED_SYSTEMS_OF_RECORD.includes(entity.systemOfRecord)
      ? entity.systemOfRecord
      : 'obsidian_markdown';
    const existingIdx = state.layers.longTermMemory.findIndex(
      (e) => e.id === entityId
    );
    const ltmNode = {
      id: entityId,
      layer: 'long_term_memory',
      entityType: String(entity.entityType || 'domain_policy'),
      name: String(entity.name || entityId),
      systemOfRecord: sor,
      sourceUri: String(entity.sourceUri || `${sor}://${entityId}`),
      attributes:
        entity.attributes && typeof entity.attributes === 'object'
          ? entity.attributes
          : {},
      updatedAt: now,
    };
    if (existingIdx >= 0) {
      state.layers.longTermMemory[existingIdx] = ltmNode;
    } else {
      state.layers.longTermMemory.push(ltmNode);
    }
    state.edges.push({
      from: entityId,
      to: `sor:${sor}`,
      relation: 'SOURCED_FROM_SOR',
      timestamp: now,
    });
  }

  if (options.decisionTrace && typeof options.decisionTrace === 'object') {
    recordDecisionTraceInternal(state, options.decisionTrace, now);
  }

  saveGraphState(state, filePath);
  return {
    ok: true,
    counts: {
      shortTermMemory: state.layers.shortTermMemory.length,
      longTermMemory: state.layers.longTermMemory.length,
      decisionTraces: state.layers.decisionTraces.length,
      edges: state.edges.length,
    },
  };
}

function recordDecisionTraceInternal(state, traceInput, now = new Date().toISOString()) {
  const traceId =
    traceInput.id || `trace_${crypto.randomBytes(6).toString('hex')}`;
  const steps = Array.isArray(traceInput.steps)
    ? traceInput.steps.map((s, idx) => ({
        stepIndex: idx + 1,
        action: String(s.action || s.tool || s.name || `step_${idx + 1}`),
        toolName: s.toolName || s.tool || null,
        reasoning: String(s.reasoning || ''),
        verdict: String(s.verdict || 'PASS').toUpperCase(),
        durationMs: Number(s.durationMs || 1),
      }))
    : [];
  const traceNode = {
    id: traceId,
    layer: 'decision_traces',
    taskType: String(traceInput.taskType || 'policy_compliance'),
    sessionId: String(traceInput.sessionId || 'default_session'),
    outcome: String(traceInput.outcome || 'PASS').toUpperCase(),
    steps,
    toolCalls: steps.filter((s) => Boolean(s.toolName)).map((s) => s.toolName),
    entityIds: Array.isArray(traceInput.entityIds) ? traceInput.entityIds : [],
    timestamp: traceInput.timestamp || now,
  };
  state.layers.decisionTraces.push(traceNode);
  for (const entId of traceNode.entityIds) {
    state.edges.push({
      from: traceId,
      to: entId,
      relation: 'EVALUATED_ENTITY',
      timestamp: traceNode.timestamp,
    });
  }
  return traceNode;
}

/**
 * 2. Capture Initial Agent Decision Traces & Discover Working Paths
 * Unconstrained agents take inconsistent paths of varying lengths across identical runs.
 * Filters strictly for successful runs (outcome === 'PASS') and extracts the canonical working path.
 */
function discoverCanonicalPath(taskType, filePath = DEFAULT_GRAPH_PATH) {
  const state = loadGraphState(filePath);
  const matching = state.layers.decisionTraces.filter(
    (t) => !taskType || t.taskType === taskType
  );
  const successful = matching.filter((t) => t.outcome === 'PASS' && t.steps.length > 0);

  if (successful.length === 0) {
    return {
      ok: false,
      taskType: taskType || 'all',
      error: 'no_successful_traces_found',
      totalRuns: matching.length,
      successfulRuns: 0,
    };
  }

  const pathLengths = matching.map((t) => t.steps.length);
  const minLen = Math.min(...pathLengths);
  const maxLen = Math.max(...pathLengths);
  const avgLen =
    pathLengths.reduce((acc, n) => acc + n, 0) / Math.max(1, pathLengths.length);

  // Group successful runs by normalized action signature and pick the shortest verified working path
  const signatureMap = new Map();
  for (const trace of successful) {
    const actions = trace.steps.map((s) => s.action);
    // Deduplicate consecutive retry loops to find the clean procedural spine
    const dedupedActions = actions.filter(
      (act, idx) => idx === 0 || act !== actions[idx - 1]
    );
    const sig = dedupedActions.join(' -> ');
    const existing = signatureMap.get(sig) || {
      signature: sig,
      actions: dedupedActions,
      supportCount: 0,
      sampleTraceId: trace.id,
    };
    existing.supportCount += 1;
    signatureMap.set(sig, existing);
  }

  const candidates = Array.from(signatureMap.values()).sort((a, b) => {
    if (b.supportCount !== a.supportCount) return b.supportCount - a.supportCount;
    return a.actions.length - b.actions.length;
  });

  const canonical = candidates[0];
  const varianceReductionPct =
    maxLen > canonical.actions.length
      ? Number(
          (((maxLen - canonical.actions.length) / maxLen) * 100).toFixed(1)
        )
      : 0;

  return {
    ok: true,
    taskType: taskType || 'all',
    totalRuns: matching.length,
    successfulRuns: successful.length,
    observedPathLengths: {
      min: minLen,
      max: maxLen,
      avg: Number(avgLen.toFixed(2)),
    },
    canonicalPath: {
      steps: canonical.actions,
      stepCount: canonical.actions.length,
      supportCount: canonical.supportCount,
      sampleTraceId: canonical.sampleTraceId,
      varianceReductionPct,
    },
  };
}

/**
 * Classify a prose instruction or trace step into one of Blumenfeld's 4 deterministic graph node types:
 * - hard_rule_script
 * - validation_lint_loop
 * - escalation_router
 * - calibrated_decision_model
 */
function classifyProseRuleToNodeType(text = '') {
  const lower = String(text).toLowerCase();
  if (
    /\b(if|when|escalate|block|refuse|deny|route|branch|approval|human|threshold|walk-away)\b/.test(
      lower
    )
  ) {
    return NODE_TYPES.ESCALATION_ROUTER;
  }
  if (
    /\b(verify|lint|test|validate|schema|assert|isolated-verifier|coverage)\b/.test(
      lower
    )
  ) {
    return NODE_TYPES.VALIDATION_LINT_LOOP;
  }
  if (
    /\b(classify|score|predict|calibrate|model|confidence|rubric|evaluate|intent)\b/.test(
      lower
    )
  ) {
    return NODE_TYPES.CALIBRATED_DECISION_MODEL;
  }
  return NODE_TYPES.HARD_RULE_SCRIPT;
}

/**
 * Deterministic YAML serializer for Procedural Graph specs (zero external dependencies).
 */
function serializeGraphToYaml(graphObj) {
  const lines = [
    '# Deterministic Procedural Skill Graph (Zachary Blumenfeld Graph Engineering)',
    `schema_version: "${graphObj.schemaVersion}"`,
    `graph_id: "${graphObj.graphId}"`,
    `skill_name: "${graphObj.skillName}"`,
    `source_skill_path: "${graphObj.sourceSkillPath || 'inline'}"`,
    `compiled_at: "${graphObj.compiledAt}"`,
    `entry_node: "${graphObj.entryNode}"`,
    'model_routing:',
    `  original_model: "${graphObj.modelRouting.originalModel}"`,
    `  recommended_execution_model: "${graphObj.modelRouting.recommendedExecutionModel}"`,
    `  fallback_local_model: "${graphObj.modelRouting.fallbackLocalModel}"`,
    `  deterministic_offload_ratio: ${graphObj.modelRouting.deterministicOffloadRatio}`,
    `  estimated_cost_reduction_pct: ${graphObj.modelRouting.estimatedCostReductionPct}`,
    'nodes:',
  ];

  for (const node of graphObj.nodes) {
    lines.push(`  - id: "${node.id}"`);
    lines.push(`    type: "${node.type}"`);
    lines.push(
      `    label: "${String(node.label || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    );
    lines.push(`    deterministic: ${Boolean(node.deterministic)}`);
    if (node.script) {
      lines.push(
        `    script: "${String(node.script).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      );
    }
    if (node.condition) {
      lines.push(
        `    condition: "${String(node.condition).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      );
    }
    if (node.maxRetries !== undefined) {
      lines.push(`    max_retries: ${node.maxRetries}`);
    }
    if (node.confidenceThreshold !== undefined) {
      lines.push(`    confidence_threshold: ${node.confidenceThreshold}`);
    }
  }

  lines.push('edges:');
  for (const edge of graphObj.edges) {
    lines.push(`  - id: "${edge.id}"`);
    lines.push(`    from: "${edge.from}"`);
    lines.push(`    to: "${edge.to}"`);
    lines.push(`    condition: "${edge.condition || 'ALWAYS'}"`);
  }

  return lines.join('\n') + '\n';
}

/**
 * 5. Swap in Smaller Models for Execution
 * Once routing and policy logic are offloaded to deterministic scripts and graph edges,
 * downgrade the orchestrating LLM to a smaller, faster model (Claude Haiku / Drex Max v1 Local).
 */
function recommendModelDowngrade(nodes = []) {
  const actionableNodes = nodes.filter(
    (n) => n.type !== NODE_TYPES.TERMINAL_OUTCOME
  );
  const total = Math.max(1, actionableNodes.length);
  const deterministicCount = actionableNodes.filter(
    (n) =>
      n.type === NODE_TYPES.HARD_RULE_SCRIPT ||
      n.type === NODE_TYPES.VALIDATION_LINT_LOOP ||
      n.type === NODE_TYPES.ESCALATION_ROUTER
  ).length;
  const ratio = Number((deterministicCount / total).toFixed(3));

  // Frontier pricing baseline: $15.00 / 1M tokens (Opus/GPT-5.4) vs $0.80 / 1M (Haiku 4.5) vs $0.00 (Drex Max v1 local)
  const canDowngradeToSlm = ratio >= 0.5;
  const recommendedExecutionModel = canDowngradeToSlm
    ? 'claude-haiku-4-5'
    : 'claude-sonnet-4-5';
  const fallbackLocalModel = 'nace-ai/drex-max-v1-local';
  const estimatedCostReductionPct = canDowngradeToSlm
    ? Number((Math.min(0.98, 0.72 + ratio * 0.22) * 100).toFixed(1))
    : 35.0;
  const estimatedLatencySavedMs = canDowngradeToSlm
    ? Math.round(1450 * ratio)
    : 350;

  return {
    originalModel: 'claude-opus-4-7',
    recommendedExecutionModel,
    fallbackLocalModel,
    deterministicNodes: deterministicCount,
    totalActionableNodes: total,
    deterministicOffloadRatio: ratio,
    canDowngradeToSlm,
    estimatedCostReductionPct,
    estimatedLatencySavedMs,
  };
}

/**
 * 3. Compile Unstructured Skills (SKILL.md) and Traces into a Deterministic Graph YAML
 */
function compileSkillToGraphYaml(options = {}, filePath = DEFAULT_GRAPH_PATH) {
  const skillMarkdown = String(options.skillMarkdown || '');
  const sourceSkillPath = String(options.skillPath || 'inline/SKILL.md');
  const taskType = String(options.taskType || 'policy_compliance');

  // Parse frontmatter name if present
  const nameMatch = skillMarkdown.match(/^name:\s*(.+)$/m);
  const rawName =
    options.skillName ||
    (nameMatch ? nameMatch[1].trim() : path.basename(path.dirname(sourceSkillPath))) ||
    'compiled-skill';
  const skillName = rawName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const graphId = `graph_${skillName}`;

  // Extract numbered steps, bullet rules, or bash commands from SKILL.md
  const extractedRules = [];
  const lines = skillMarkdown.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(\d+\.|[-*])\s+/.test(trimmed)) {
      const cleaned = trimmed.replace(/^(\d+\.|[-*])\s+/, '').trim();
      if (cleaned.length >= 12 && !cleaned.startsWith('---')) {
        extractedRules.push(cleaned);
      }
    }
  }

  // Also fold in canonical trace steps if available
  const canonicalDiscovery = discoverCanonicalPath(taskType, filePath);
  if (
    canonicalDiscovery.ok &&
    canonicalDiscovery.canonicalPath &&
    Array.isArray(canonicalDiscovery.canonicalPath.steps)
  ) {
    for (const stepAction of canonicalDiscovery.canonicalPath.steps) {
      if (!extractedRules.some((r) => r.toLowerCase().includes(stepAction.toLowerCase()))) {
        extractedRules.push(`Execute canonical trace step: ${stepAction}`);
      }
    }
  }

  if (extractedRules.length === 0) {
    extractedRules.push(
      'Run deterministic pre-action policy check script',
      'Validate output against schema and test invariants',
      'If risk score exceeds threshold or policy fails, escalate or block'
    );
  }

  const nodes = [];
  const edges = [];

  extractedRules.slice(0, 10).forEach((ruleText, idx) => {
    const nodeId = `node_${idx + 1}`;
    const nodeType = classifyProseRuleToNodeType(ruleText);
    const cmdMatch = ruleText.match(/`([^`]+)`/);
    const node = {
      id: nodeId,
      type: nodeType,
      label: ruleText.slice(0, 140),
      deterministic: nodeType !== NODE_TYPES.CALIBRATED_DECISION_MODEL,
    };

    if (nodeType === NODE_TYPES.HARD_RULE_SCRIPT) {
      node.script = cmdMatch ? cmdMatch[1] : `thumbgate-check-step-${idx + 1}`;
    } else if (nodeType === NODE_TYPES.VALIDATION_LINT_LOOP) {
      node.script = cmdMatch ? cmdMatch[1] : 'npm run verify:isolated';
      node.maxRetries = 2;
    } else if (nodeType === NODE_TYPES.ESCALATION_ROUTER) {
      node.condition = 'context.policyCompliant === true && context.riskScore < 0.7';
    } else if (nodeType === NODE_TYPES.CALIBRATED_DECISION_MODEL) {
      node.confidenceThreshold = 0.85;
    }
    nodes.push(node);
  });

  // Terminal nodes for deterministic exit outcomes
  const allowNodeId = 'terminal_allow';
  const blockNodeId = 'terminal_block_or_escalate';
  nodes.push(
    {
      id: allowNodeId,
      type: NODE_TYPES.TERMINAL_OUTCOME,
      label: 'ALLOW: All deterministic graph checks passed',
      deterministic: true,
    },
    {
      id: blockNodeId,
      type: NODE_TYPES.TERMINAL_OUTCOME,
      label: 'BLOCK_OR_ESCALATE: Policy guard or validation loop rejected execution',
      deterministic: true,
    }
  );

  for (let i = 0; i < nodes.length - 2; i += 1) {
    const current = nodes[i];
    const next = i < nodes.length - 3 ? nodes[i + 1] : { id: allowNodeId };

    edges.push({
      id: `edge_${current.id}_pass`,
      from: current.id,
      to: next.id,
      condition: 'ON_PASS',
    });

    edges.push({
      id: `edge_${current.id}_fail`,
      from: current.id,
      to: blockNodeId,
      condition:
        current.type === NODE_TYPES.ESCALATION_ROUTER
          ? 'ON_ESCALATE_OR_DENY'
          : 'ON_VALIDATION_FAIL',
    });
  }

  const modelRouting = recommendModelDowngrade(nodes);
  const compiledGraph = {
    schemaVersion: '1.0',
    graphId,
    skillName,
    taskType,
    sourceSkillPath,
    compiledAt: new Date().toISOString(),
    entryNode: nodes[0].id,
    terminalNodes: [allowNodeId, blockNodeId],
    modelRouting,
    nodes,
    edges,
  };

  compiledGraph.yaml = serializeGraphToYaml(compiledGraph);

  const state = loadGraphState(filePath);
  state.compiledGraphs[graphId] = compiledGraph;
  saveGraphState(state, filePath);

  return {
    ok: true,
    graphId,
    skillName,
    compiledGraph,
    yaml: compiledGraph.yaml,
  };
}

/**
 * 4. Execute Procedural Graph Deterministically &
 * 6. Persist Skill Runs Back to the Graph for Governance
 */
function executeProceduralGraph(options = {}, filePath = DEFAULT_GRAPH_PATH) {
  const state = loadGraphState(filePath);
  const graphId = options.graphId;
  const graph =
    options.compiledGraph ||
    (graphId && state.compiledGraphs[graphId]) ||
    Object.values(state.compiledGraphs)[0];

  if (!graph || !Array.isArray(graph.nodes)) {
    return {
      ok: false,
      error: 'compiled_graph_not_found',
      message: 'Compile a SKILL.md into a procedural graph first.',
    };
  }

  const context =
    options.context && typeof options.context === 'object' ? options.context : {};
  const entityIds = Array.isArray(options.entityIds) ? options.entityIds : [];
  const startMs = Date.now();

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const visitedNodes = [];
  const triggeredBranches = [];
  let currentId = graph.entryNode;
  let finalVerdict = 'ALLOW';
  let stepGuard = 0;

  while (currentId && stepGuard < 50) {
    stepGuard += 1;
    const node = nodeMap.get(currentId);
    if (!node) break;
    visitedNodes.push(node.id);

    if (node.type === NODE_TYPES.TERMINAL_OUTCOME) {
      finalVerdict = node.id === 'terminal_allow' ? 'ALLOW' : 'BLOCK';
      break;
    }

    // Evaluate deterministic node conditions against input context
    let nodePassed = true;
    if (
      context.forceFailNodeId === node.id ||
      (node.type === NODE_TYPES.ESCALATION_ROUTER &&
        (context.policyCompliant === false || Number(context.riskScore || 0) >= 0.7)) ||
      (node.type === NODE_TYPES.VALIDATION_LINT_LOOP &&
        context.validationPassed === false) ||
      (node.type === NODE_TYPES.HARD_RULE_SCRIPT &&
        context.hardRulePassed === false) ||
      (node.type === NODE_TYPES.CALIBRATED_DECISION_MODEL &&
        Number(context.modelConfidence ?? 0.95) < (node.confidenceThreshold || 0.85))
    ) {
      nodePassed = false;
    }

    const outgoing = graph.edges.filter((e) => e.from === node.id);
    const chosenEdge = outgoing.find((e) =>
      nodePassed ? e.condition === 'ON_PASS' : e.condition !== 'ON_PASS'
    );

    if (!chosenEdge) break;
    triggeredBranches.push(chosenEdge.id);
    currentId = chosenEdge.to;
  }

  const allEdgeIds = graph.edges.map((e) => e.id);
  const skippedBranches = allEdgeIds.filter(
    (eid) => !triggeredBranches.includes(eid)
  );
  const durationMs = Math.max(1, Date.now() - startMs);

  const runRecord = {
    runId: `grun_${crypto.randomBytes(6).toString('hex')}`,
    graphId: graph.graphId,
    skillName: graph.skillName,
    verdict: finalVerdict,
    executionModel: graph.modelRouting
      ? graph.modelRouting.recommendedExecutionModel
      : 'claude-haiku-4-5',
    visitedNodes,
    triggeredBranches,
    skippedBranches,
    entityIds,
    durationMs,
    timestamp: new Date().toISOString(),
  };

  state.persistedSkillRuns.push(runRecord);
  for (const branchId of triggeredBranches) {
    state.edges.push({
      from: runRecord.runId,
      to: branchId,
      relation: 'TRIGGERED_BRANCH',
      timestamp: runRecord.timestamp,
    });
  }
  for (const entId of entityIds) {
    state.edges.push({
      from: runRecord.runId,
      to: entId,
      relation: 'GOVERNED_ENTITY',
      timestamp: runRecord.timestamp,
    });
  }

  saveGraphState(state, filePath);

  return {
    ok: true,
    run: runRecord,
    modelRouting: graph.modelRouting,
  };
}

/**
 * 6. Query Persisted Runs to Audit Provenance, Conditional Branch Coverage, and Drift Over Time
 */
function auditGraphGovernance(options = {}, filePath = DEFAULT_GRAPH_PATH) {
  const state = loadGraphState(filePath);
  const graphId = options.graphId || Object.keys(state.compiledGraphs)[0];
  const graph = graphId ? state.compiledGraphs[graphId] : null;
  const runs = state.persistedSkillRuns.filter(
    (r) => !graphId || r.graphId === graphId
  );

  const branchTriggerCounts = {};
  if (graph && Array.isArray(graph.edges)) {
    for (const edge of graph.edges) {
      branchTriggerCounts[edge.id] = 0;
    }
  }

  for (const run of runs) {
    for (const bid of run.triggeredBranches || []) {
      branchTriggerCounts[bid] = (branchTriggerCounts[bid] || 0) + 1;
    }
  }

  const allBranches = Object.keys(branchTriggerCounts);
  const triggeredAtLeastOnce = allBranches.filter(
    (bid) => branchTriggerCounts[bid] > 0
  );
  const neverTriggeredBranches = allBranches.filter(
    (bid) => branchTriggerCounts[bid] === 0
  );
  const branchCoveragePct =
    allBranches.length > 0
      ? Number(
          ((triggeredAtLeastOnce.length / allBranches.length) * 100).toFixed(1)
        )
      : 0;

  // Drift detection: compare first half of runs vs most recent runs on block/escalate rate
  let driftScore = 0;
  let driftDetected = false;
  if (runs.length >= 4) {
    const mid = Math.floor(runs.length / 2);
    const earlyBlockRate =
      runs.slice(0, mid).filter((r) => r.verdict !== 'ALLOW').length / mid;
    const recentBlockRate =
      runs.slice(mid).filter((r) => r.verdict !== 'ALLOW').length /
      (runs.length - mid);
    driftScore = Number(Math.abs(recentBlockRate - earlyBlockRate).toFixed(3));
    driftDetected = driftScore >= 0.35;
  }

  return {
    ok: true,
    graphId: graphId || null,
    totalPersistedRuns: runs.length,
    contextGraphSummary: {
      shortTermTurns: state.layers.shortTermMemory.length,
      longTermEntities: state.layers.longTermMemory.length,
      decisionTraces: state.layers.decisionTraces.length,
      compiledGraphsCount: Object.keys(state.compiledGraphs).length,
      totalEdges: state.edges.length,
    },
    branchTelemetry: {
      totalBranches: allBranches.length,
      triggeredBranchesCount: triggeredAtLeastOnce.length,
      neverTriggeredBranches,
      branchCoveragePct,
      branchTriggerCounts,
    },
    driftAudit: {
      driftDetected,
      driftScore,
      status: driftDetected ? 'DRIFT_ALERT' : 'STABLE',
    },
    recentRuns: runs.slice(-5),
  };
}

module.exports = {
  DEFAULT_GRAPH_PATH,
  SUPPORTED_SYSTEMS_OF_RECORD,
  NODE_TYPES,
  loadGraphState,
  saveGraphState,
  ingestUnifiedContextNode,
  discoverCanonicalPath,
  compileSkillToGraphYaml,
  executeProceduralGraph,
  recommendModelDowngrade,
  auditGraphGovernance,
};
