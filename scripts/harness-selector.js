'use strict';

/**
 * Harness Selector — Context-Aware Gate Harness Loading
 *
 * Auto Agent concept: instead of one monolithic gate config, select a
 * specialized harness based on the workflow type detected from the tool call.
 *
 * Detection priority (first match wins):
 *   1. THUMBGATE_HARNESS env var — explicit override
 *   2. Tool-name heuristic (Edit/Write/MultiEdit → code-edit)
 *   3. Command-text heuristic (deploy keywords → deploy, SQL keywords → db-write, routines → routine)
 *   4. null → load only default.json + auto-promoted gates
 *
 * Each harness is ADDITIVE — default.json gates always load first.
 */

const path = require('path');
const fs = require('fs');

const HARNESS_DIR = path.join(__dirname, '..', 'config', 'gates');
const ROOT_DIR = path.join(__dirname, '..');

const HARNESSES = Object.freeze({
  deploy: path.join(HARNESS_DIR, 'deploy.json'),
  'code-edit': path.join(HARNESS_DIR, 'code-edit.json'),
  'db-write': path.join(HARNESS_DIR, 'db-write.json'),
  routine: path.join(HARNESS_DIR, 'routine.json'),
  'actor-critic-audit': path.join(HARNESS_DIR, 'actor-critic-audit.json'),
  'future-agi-guardrails': path.join(HARNESS_DIR, 'future-agi-guardrails.json'),
  'five-walls-governance': path.join(HARNESS_DIR, 'five-walls-governance.json'),
  'simatree-data-governance': path.join(HARNESS_DIR, 'simatree-data-governance.json'),
  'radware-threat-defense': path.join(HARNESS_DIR, 'radware-threat-defense-2026.json'),
});

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

const SIMATREE_PATTERNS = [
  /\b(simatree|data_lifecycle|why_before_how|pmo_transformation|bayesian_uncertainty|lakehouse_governance)\b/i,
];

const FIVE_WALLS_PATTERNS = [
  /\b(five_walls|five-walls|action_safety|hard_deny|preconditions|index_and_leaf|identity_propagation)\b/i,
];

const FUTURE_AGI_PATTERNS = [
  /\b(future-agi|futureagi|agentcc|traceai|self_healing|adversarial_simulation|simulate_agent)\b/i,
  /\b(prompt_injection|jailbreak|eval_rubric|guardrail_scanner)\b/i,
];

const ACTOR_CRITIC_PATTERNS = [
  /\b(publish_causal_report|causal_inference|target_trial|target-trial|actor-critic|actor_critic|process_audit)\b/i,
  /\b(placebo_test|counterfactual|propensity_score|double_ml)\b/i,
];

const DEPLOY_PATTERNS = [
  /\brailway\s+(deploy|up|run)\b/i,
  /\bdocker\s+(push|build)\b/i,
  /\bnpm\s+publish\b/i,
  /\byarn\s+publish\b/i,
  /\bpnpm\s+publish\b/i,
  /\bgit\s+push\b/i,
  /\bgh\s+pr\s+(create|merge)\b/i,
  /\bchangeset\s+(publish|version)\b/i,
];

const DB_WRITE_PATTERNS = [
  /\b(DROP|TRUNCATE|DELETE|ALTER|INSERT|UPDATE)\s+(TABLE|FROM|INTO|COLUMN)\b/i,
  /\b(sqlite3|better-sqlite3|knex|sequelize)\b.*\.(run|exec|query)\b/i,
  /\brm\s+.*\.sqlite\b/i,
  /\blancedb\b.*(?:create|delete|drop|truncate)/i,
  /\.db\.exec\(|\.db\.prepare\(/i,
];

const ROUTINE_PATTERNS = [
  /\b(routine|scheduled agent|workspace agent|webhook trigger|post[-\s]?merge|nightly|daily audit)\b/i,
  /\b(reasoning_effort|system prompt|developer message|verbosity|length limits)\b/i,
  /\b(gpt-5\.5|gpt-5\.5-pro|xhigh|ultrathink)\b/i,
  /\b(slack|salesforce|gmail|google drive|notion|jira|linear|atlassian)\b.*\b(send|post|write|update|delete|create)\b/i,
  /\b(context|role|expectations|few[-\s]?shot|zero[-\s]?shot|prompt template|prompt library)\b/i,
];

const CODE_EDIT_TOOL_NAMES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Given a tool name and input, return the path to the best matching
 * specialized harness config, or null if none applies.
 *
 * @param {string} toolName  - e.g. "Bash", "Edit", "Write"
 * @param {object|string} toolInput - raw tool input object or string
 * @returns {string|null} absolute path to harness JSON, or null
 */
/**
 * Full-payload text for pattern scanning. extractCommandText short-circuits on
 * file_path for Edit/Write, which never carries an injection string — the
 * content/new_string fields do.
 *
 * @param {object|string} toolInput
 * @returns {string}
 */
function extractPayloadText(toolInput) {
  if (!toolInput) return '';
  if (typeof toolInput === 'string') return toolInput;
  try {
    return JSON.stringify(toolInput);
  } catch {
    return extractCommandText(toolInput);
  }
}

function selectHarness(toolName, toolInput) {
  // 1. Explicit override
  if (process.env.THUMBGATE_HARNESS) {
    const override = process.env.THUMBGATE_HARNESS;
    if (HARNESSES[override]) return HARNESSES[override];
    // Allow absolute path override
    if (path.isAbsolute(override)) return override;
  }

  // 1b. Radware / Bot Manager threat defense — auto-select when evaluateThreat or rate burst
  //     flags ShadowLeak, ZombieAgent, suspicious-bot challenge, or rate burst.
  //     Without this branch the registry entry is inert for normal PreToolUse.
  try {
    const { evaluateThreat } = require('./radware-threat-defense.js');
    const payloadText = extractPayloadText(toolInput) || extractCommandText(toolInput) || String(toolName || '');
    // Content threats only here. Rate-burst is enforced structurally in gates-engine
    // (persisted history) so selector probes cannot false-select this harness.
    const threat = evaluateThreat(payloadText);
    if (threat.blocked || threat.challenged || threat.severity !== 'none') {
      return HARNESSES['radware-threat-defense'];
    }
  } catch {
    // Fail open on selector errors; gates still apply when harness forced via env.
  }

  // 2. Edit/Write tools get the code-edit harness, UNLESS the payload itself
  //    trips a Future AGI pattern. Returning code-edit unconditionally meant
  //    the prompt-injection gates declared for Edit/Write were never active
  //    under automatic selection, since only the selected harness is loaded.
  if (CODE_EDIT_TOOL_NAMES.has(toolName)) {
    const payloadText = extractPayloadText(toolInput);
    if (payloadText && FUTURE_AGI_PATTERNS.some((p) => p.test(payloadText))) {
      return HARNESSES['future-agi-guardrails'];
    }
    return HARNESSES['code-edit'];
  }

  // 3. Inspect command text for Bash tool
  const commandText = extractCommandText(toolInput);
  if (commandText) {
    if (DB_WRITE_PATTERNS.some((p) => p.test(commandText))) {
      return HARNESSES['db-write'];
    }
    if (ACTOR_CRITIC_PATTERNS.some((p) => p.test(commandText))) {
      return HARNESSES['actor-critic-audit'];
    }
    if (FUTURE_AGI_PATTERNS.some((p) => p.test(commandText))) {
      return HARNESSES['future-agi-guardrails'];
    }
    if (FIVE_WALLS_PATTERNS.some((p) => p.test(commandText))) {
      return HARNESSES['five-walls-governance'];
    }
    if (SIMATREE_PATTERNS.some((p) => p.test(commandText))) {
      return HARNESSES['simatree-data-governance'];
    }
    if (ROUTINE_PATTERNS.some((p) => p.test(commandText))) {
      return HARNESSES.routine;
    }
    if (DEPLOY_PATTERNS.some((p) => p.test(commandText))) {
      return HARNESSES['deploy'];
    }
  }

  return null;
}

/**
 * Return the harness name (e.g. "deploy") for a given tool call, or null.
 */
function selectHarnessName(toolName, toolInput) {
  const harnessPath = selectHarness(toolName, toolInput);
  if (!harnessPath) return null;
  return Object.entries(HARNESSES).find(([, p]) => p === harnessPath)?.[0] ?? null;
}

/**
 * Return the full list of available harness names.
 */
function listHarnesses() {
  return Object.keys(HARNESSES);
}

/**
 * Return the path for a harness by name.
 */
function getHarnessPath(name) {
  return HARNESSES[name] ?? null;
}

function estimateTokenCount(text, charsPerToken = 4) {
  const payload = String(text || '');
  const divisor = Math.max(1, Number(charsPerToken) || 4);
  return Math.ceil(Buffer.byteLength(payload, 'utf8') / divisor);
}

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function collectDefaultHarnessAuditInputs(rootDir = ROOT_DIR) {
  const globalDocNames = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];
  const globalDocs = globalDocNames.map((name) => {
    const content = readIfExists(path.join(rootDir, name));
    return {
      name,
      chars: Buffer.byteLength(content, 'utf8'),
      estimatedTokens: estimateTokenCount(content),
      exists: content.length > 0,
    };
  });
  const toolIndex = readJsonIfExists(path.join(rootDir, '.well-known', 'mcp', 'tools.json'));
  const tools = Array.isArray(toolIndex && toolIndex.tools) ? toolIndex.tools : [];

  return {
    globalDocs,
    mcpToolCount: tools.length,
    progressiveToolIndexPresent: tools.some((tool) => typeof tool.schemaUrl === 'string'),
    specializedHarnesses: listHarnesses(),
  };
}

function scoreHarnessAudit(inputs = {}, options = {}) {
  const globalDocs = Array.isArray(inputs.globalDocs) ? inputs.globalDocs : [];
  const totalDocTokens = globalDocs.reduce((sum, doc) => sum + Number(doc.estimatedTokens || 0), 0);
  const totalDocChars = globalDocs.reduce((sum, doc) => sum + Number(doc.chars || 0), 0);
  const docTokenBudget = Number(options.docTokenBudget || 9000);
  const docsOverBudget = totalDocTokens > docTokenBudget;
  const mcpToolCount = Number(inputs.mcpToolCount || 0);
  const progressiveToolIndexPresent = Boolean(inputs.progressiveToolIndexPresent);
  const specializedHarnesses = Array.isArray(inputs.specializedHarnesses) ? inputs.specializedHarnesses : [];
  const hasSpecializedHarnesses = specializedHarnesses.length >= 4;
  const missingDocs = globalDocs.filter((doc) => doc.exists === false).map((doc) => doc.name);
  const observations = [];
  const recommendations = [];

  let score = 100;
  if (docsOverBudget) {
    const overageRatio = totalDocTokens / docTokenBudget;
    score -= Math.min(35, Math.ceil((overageRatio - 1) * 22));
    observations.push(`Global agent docs use about ${totalDocTokens} tokens against a ${docTokenBudget} token harness budget.`);
    recommendations.push('Move verbose runbooks into skills, guides, or tool help, then leave AGENTS.md/CLAUDE.md as short discovery pointers.');
  } else {
    observations.push(`Global agent docs stay within the ${docTokenBudget} token harness budget.`);
  }

  if (!progressiveToolIndexPresent && mcpToolCount > 12) {
    score -= 25;
    observations.push(`${mcpToolCount} MCP tools appear preload-only, which can push agents toward instruction bloat.`);
    recommendations.push('Expose a lightweight MCP tool index with per-tool schema URLs so agents fetch schemas only when needed.');
  } else if (progressiveToolIndexPresent) {
    observations.push('Progressive MCP tool discovery is available through schema URLs.');
  }

  if (!hasSpecializedHarnesses) {
    score -= 18;
    observations.push('Fewer than four specialized gate harnesses are available for risky workflows.');
    recommendations.push('Add workflow-specific harnesses for deploy, code-edit, database-write, and unattended routine actions so default gates stay lean.');
  } else {
    observations.push(`Specialized harnesses are available: ${specializedHarnesses.join(', ')}.`);
  }

  if (missingDocs.length > 0) {
    score -= Math.min(12, missingDocs.length * 4);
    recommendations.push(`Restore missing global discovery docs or remove stale references: ${missingDocs.join(', ')}.`);
  }

  if (recommendations.length === 0) {
    recommendations.push('Keep using Research -> Plan -> Implement prompts and delegate only subtasks whose summaries are enough for the main context.');
  } else {
    recommendations.push('Use Research -> Plan -> Implement prompts so implementation starts after the harness has isolated only the needed context.');
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  const status = normalizedScore >= 85 ? 'compounding' : normalizedScore >= 65 ? 'watch' : 'bloated';

  return {
    name: 'thumbgate-harness-optimization-audit',
    status,
    score: normalizedScore,
    roiPriority: normalizedScore < 85 ? 'conversion' : 'retention',
    totals: {
      globalDocChars: totalDocChars,
      globalDocEstimatedTokens: totalDocTokens,
      mcpToolCount,
      specializedHarnessCount: specializedHarnesses.length,
    },
    signals: {
      docsOverBudget,
      progressiveToolIndexPresent,
      hasSpecializedHarnesses,
      missingDocs,
    },
    observations,
    recommendations,
  };
}

function buildHarnessOptimizationAudit(options = {}) {
  const rootDir = options.rootDir || ROOT_DIR;
  const inputs = options.inputs || collectDefaultHarnessAuditInputs(rootDir);
  return scoreHarnessAudit(inputs, options);
}

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function normalizeOptionalBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true) return true;
  if (value === false) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildHarnessFitAudit(options = {}) {
  const nativeHarness = String(options['native-harness'] || options.native || 'native').trim() || 'native';
  const genericHarness = String(options['generic-harness'] || options.generic || 'generic').trim() || 'generic';
  const sameModelDifferentHarness = normalizeBoolean(options['same-model-different-harness'] || options['same-model'] || options.crossHarness);
  const controls = {
    toolSchemaParity: normalizeOptionalBoolean(options['tool-schema-parity']),
    permissionParity: normalizeOptionalBoolean(options['permission-parity']),
    stateIsolation: normalizeOptionalBoolean(options['state-isolation']),
    patchLoopParity: normalizeOptionalBoolean(options['patch-loop-parity']),
    verificationParity: normalizeOptionalBoolean(options['verification-parity']),
  };
  const handoffDrift = toNumber(options['handoff-drift'] || options['handoff-drift-percent']);
  const gaps = Object.entries(controls)
    .filter(([, value]) => value === false)
    .map(([key]) => key);

  let score = 100;
  if (sameModelDifferentHarness) score -= 15;
  score -= gaps.length * 12;
  if (handoffDrift !== null && handoffDrift > 0) score -= Math.min(20, Math.ceil(handoffDrift));

  const signals = [];
  if (sameModelDifferentHarness || gaps.length > 0) {
    signals.push({
      id: 'model_harness_fit',
      label: 'Same model, different harness',
      values: [
        `${nativeHarness} vs ${genericHarness}`,
        sameModelDifferentHarness ? 'same model run across harnesses' : null,
        ...gaps.map((gap) => `${gap} gap`),
      ].filter(Boolean),
      risk: 'model quality can change when tool schemas, permissions, state, patch loops, or verification differ by harness',
    });
  }
  if (handoffDrift !== null && handoffDrift > 0) {
    signals.push({
      id: 'handoff_drift',
      label: 'Cross-harness handoff drift',
      values: [`${handoffDrift}% drift`],
      risk: 'handoffs between generic and native harnesses can lose task state or weaken verification',
    });
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  return {
    name: 'thumbgate-model-harness-fit-audit',
    status: normalizedScore >= 85 ? 'portable' : normalizedScore >= 65 ? 'watch' : 'native-required',
    score: normalizedScore,
    nativeHarness,
    genericHarness,
    controls,
    metrics: { sameModelDifferentHarness, handoffDrift },
    signals,
    recommendations: [
      'Benchmark the same task, same model, and same repository in native and generic harnesses before standardizing.',
      'Require parity proof for tool schemas, permissions, state isolation, patch application, and verification loops.',
      'Use the native harness for production edits when parity gaps remain; reserve generic harnesses for exploration and read-only analysis.',
    ],
  };
}

function formatHarnessFitAudit(report) {
  const lines = [
    '',
    'ThumbGate Model-Harness Fit Audit',
    '-'.repeat(37),
    `Status : ${report.status}`,
    `Score  : ${report.score}/100`,
    `Harness: ${report.nativeHarness} vs ${report.genericHarness}`,
    `Signals: ${report.signals.length}`,
  ];
  if (report.signals.length > 0) {
    lines.push('', 'Detected harness-fit risks:');
    for (const signal of report.signals) {
      lines.push(`  - ${signal.label}: ${signal.values.join(', ')}`);
      lines.push(`    Risk: ${signal.risk}`);
    }
  }
  lines.push('', 'Recommendations:');
  for (const recommendation of report.recommendations) lines.push(`  - ${recommendation}`);
  return `${lines.join('\n')}\n\n`;
}

function buildSolverWorkflowGovernance(options = {}) {
  const solver = String(options.solver || options['solver-engine'] || 'solver').trim() || 'solver';
  const multiAgent = normalizeBoolean(options['multi-agent'] || options.multiAgent || options.agentic);
  const controls = {
    objectiveDefined: normalizeOptionalBoolean(options['objective-defined']),
    constraintsDefined: normalizeOptionalBoolean(options['constraints-defined']),
    scenarioReplay: normalizeOptionalBoolean(options['scenario-replay']),
    approvalGate: normalizeOptionalBoolean(options['approval-gate']),
    rollbackPlan: normalizeOptionalBoolean(options['rollback-plan']),
    solverProvenance: normalizeOptionalBoolean(options['solver-provenance']),
  };
  const dataFreshnessHours = toNumber(options['data-freshness-hours'] || options['freshness-hours']);
  const gaps = Object.entries(controls)
    .filter(([, value]) => value === false)
    .map(([key]) => key);

  let score = 100;
  if (multiAgent) score -= 8;
  score -= gaps.length * 13;
  if (dataFreshnessHours !== null && dataFreshnessHours > 24) score -= 10;

  const signals = [];
  if (multiAgent || gaps.length > 0) {
    signals.push({
      id: 'solver_workflow_governance',
      label: 'Solver-backed agent workflow',
      values: [
        solver,
        multiAgent ? 'multi-agent orchestration' : null,
        ...gaps.map((gap) => `${gap} gap`),
      ].filter(Boolean),
      risk: 'natural-language-to-optimization workflows need objective, constraint, replay, approval, rollback, and provenance gates',
    });
  }
  if (dataFreshnessHours !== null && dataFreshnessHours > 24) {
    signals.push({
      id: 'solver_data_freshness',
      label: 'Solver data freshness',
      values: [`${dataFreshnessHours}h old`],
      risk: 'optimization results can look mathematically valid while using stale operational data',
    });
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  return {
    name: 'thumbgate-solver-workflow-governance',
    status: normalizedScore >= 85 ? 'ready' : normalizedScore >= 65 ? 'approval-required' : 'blocked',
    score: normalizedScore,
    solver,
    controls,
    metrics: { multiAgent, dataFreshnessHours },
    signals,
    recommendations: [
      'Capture the objective function, hard constraints, soft constraints, and data freshness before invoking the solver.',
      'Replay at least one baseline scenario and one counterfactual before approving optimized actions.',
      'Require human approval and rollback evidence before solver output changes supply chain, routing, scheduling, or pricing decisions.',
    ],
  };
}

function formatSolverWorkflowGovernance(report) {
  const lines = [
    '',
    'ThumbGate Solver Workflow Governance',
    '-'.repeat(38),
    `Status: ${report.status}`,
    `Score : ${report.score}/100`,
    `Solver: ${report.solver}`,
    `Signals: ${report.signals.length}`,
  ];
  if (report.signals.length > 0) {
    lines.push('', 'Detected solver workflow risks:');
    for (const signal of report.signals) {
      lines.push(`  - ${signal.label}: ${signal.values.join(', ')}`);
      lines.push(`    Risk: ${signal.risk}`);
    }
  }
  lines.push('', 'Recommendations:');
  for (const recommendation of report.recommendations) lines.push(`  - ${recommendation}`);
  return `${lines.join('\n')}\n\n`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractCommandText(toolInput) {
  if (!toolInput) return '';
  if (typeof toolInput === 'string') return toolInput;
  if (typeof toolInput === 'object') {
    // Claude Code Bash tool: { command: "..." }
    if (typeof toolInput.command === 'string') return toolInput.command;
    // file_path for Edit/Write tools
    if (typeof toolInput.file_path === 'string') return toolInput.file_path;
    // Generic text fields
    for (const key of ['input', 'text', 'content', 'query']) {
      if (typeof toolInput[key] === 'string') return toolInput[key];
    }
    // Fall back to serialised form
    try { return JSON.stringify(toolInput); } catch { return ''; }
  }
  return '';
}

const { evaluateThreat, evaluatePretoolDefense, checkRateBurst } = require('./radware-threat-defense.js');

module.exports = {
  selectHarness,
  selectHarnessName,
  listHarnesses,
  getHarnessPath,
  estimateTokenCount,
  collectDefaultHarnessAuditInputs,
  scoreHarnessAudit,
  buildHarnessOptimizationAudit,
  buildHarnessFitAudit,
  formatHarnessFitAudit,
  buildSolverWorkflowGovernance,
  formatSolverWorkflowGovernance,
  extractCommandText,
  evaluateThreat,
  evaluatePretoolDefense,
  checkRateBurst,
  HARNESSES,
  DEPLOY_PATTERNS,
  DB_WRITE_PATTERNS,
  CODE_EDIT_TOOL_NAMES,
};
