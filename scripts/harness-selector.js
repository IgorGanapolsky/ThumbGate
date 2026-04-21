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
 *   3. Command-text heuristic (deploy keywords → deploy, SQL keywords → db-write)
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
});

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

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
function selectHarness(toolName, toolInput) {
  // 1. Explicit override
  if (process.env.THUMBGATE_HARNESS) {
    const override = process.env.THUMBGATE_HARNESS;
    if (HARNESSES[override]) return HARNESSES[override];
    // Allow absolute path override
    if (path.isAbsolute(override)) return override;
  }

  // 2. Edit/Write tools always get code-edit harness
  if (CODE_EDIT_TOOL_NAMES.has(toolName)) {
    return HARNESSES['code-edit'];
  }

  // 3. Inspect command text for Bash tool
  const commandText = extractCommandText(toolInput);
  if (commandText) {
    if (DB_WRITE_PATTERNS.some((p) => p.test(commandText))) {
      return HARNESSES['db-write'];
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
  const hasSpecializedHarnesses = specializedHarnesses.length >= 3;
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
    observations.push('Fewer than three specialized gate harnesses are available for risky workflows.');
    recommendations.push('Add workflow-specific harnesses for deploy, code-edit, and database-write actions so default gates stay lean.');
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

module.exports = {
  selectHarness,
  selectHarnessName,
  listHarnesses,
  getHarnessPath,
  estimateTokenCount,
  collectDefaultHarnessAuditInputs,
  scoreHarnessAudit,
  buildHarnessOptimizationAudit,
  extractCommandText,
  HARNESSES,
  DEPLOY_PATTERNS,
  DB_WRITE_PATTERNS,
  CODE_EDIT_TOOL_NAMES,
};
