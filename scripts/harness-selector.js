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

const HARNESS_DIR = path.join(__dirname, '..', 'config', 'gates');

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
  extractCommandText,
  HARNESSES,
  DEPLOY_PATTERNS,
  DB_WRITE_PATTERNS,
  CODE_EDIT_TOOL_NAMES,
};
