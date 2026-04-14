'use strict';

/**
 * cli-schema.js — single source of truth for thumbgate CLI commands.
 *
 * Inspired by Cloudflare's schema-first CLI architecture: one definition
 * drives both the CLI help text and the explore TUI command browser.
 * MCP tool bindings are listed via `mcpTool` so the two surfaces stay in sync.
 *
 * Groups: capture | discovery | gates | export | ops | advanced
 */

const CLI_COMMANDS = [
  // -------------------------------------------------------------------------
  // Capture
  // -------------------------------------------------------------------------
  {
    name: 'capture',
    aliases: ['feedback'],
    description: 'Capture an up/down signal — turns feedback into a stored lesson',
    group: 'capture',
    mcpTool: 'capture_feedback',
    flags: [
      { name: 'feedback',        type: 'string',  required: true,  description: 'Signal: up or down' },
      { name: 'context',         type: 'string',  description: 'One-line reason' },
      { name: 'what-went-wrong', type: 'string',  description: 'Root cause (negative feedback)' },
      { name: 'what-to-change',  type: 'string',  description: 'Specific fix required' },
      { name: 'what-worked',     type: 'string',  description: 'What succeeded (positive feedback)' },
      { name: 'tags',            type: 'string',  description: 'Comma-separated tags' },
      { name: 'json',            type: 'boolean', description: 'Output as JSON' },
    ],
  },

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------
  {
    name: 'explore',
    description: 'Interactive TUI — browse lessons, gates, stats, and rules keyboard-first',
    group: 'discovery',
    flags: [
      { name: 'json', type: 'boolean', description: 'Output as JSON (non-interactive)' },
      { name: 'limit', type: 'number', description: 'Max items (default 20)' },
    ],
  },
  {
    name: 'lessons',
    aliases: ['search-lessons'],
    description: 'Search promoted lessons and show linked corrective actions',
    group: 'discovery',
    mcpTool: 'search_lessons',
    flags: [
      { name: 'query',    type: 'string',  description: 'Search query (positional arg also works)' },
      { name: 'limit',    type: 'number',  description: 'Max results (default 10)' },
      { name: 'tags',     type: 'string',  description: 'Comma-separated tag filter' },
      { name: 'category', type: 'string',  description: 'error | learning | preference' },
      { name: 'json',     type: 'boolean', description: 'Output as JSON' },
      { name: 'local',    type: 'boolean', description: 'Use local storage (default)' },
      { name: 'remote',   type: 'boolean', description: 'Fetch from hosted Railway instance' },
    ],
  },
  {
    name: 'stats',
    description: 'Feedback analytics — approval rate, Revenue-at-Risk, recent trend',
    group: 'discovery',
    mcpTool: 'feedback_stats',
    flags: [
      { name: 'json',   type: 'boolean', description: 'Output as JSON' },
      { name: 'remote', type: 'boolean', description: 'Fetch from hosted Railway instance' },
    ],
  },
  {
    name: 'gate-stats',
    description: 'Gate engine statistics — active gates, blocks, warns, time saved',
    group: 'discovery',
    flags: [
      { name: 'json', type: 'boolean', description: 'Output as JSON' },
    ],
  },
  {
    name: 'summary',
    description: 'Human-readable feedback summary',
    group: 'discovery',
    mcpTool: 'feedback_summary',
    flags: [
      { name: 'recent', type: 'number', description: 'Number of recent entries (default 20)' },
      { name: 'json',   type: 'boolean', description: 'Output as JSON' },
    ],
  },
  {
    name: 'doctor',
    description: 'Audit runtime isolation, bootstrap context, and permission tier',
    group: 'discovery',
    flags: [
      { name: 'json', type: 'boolean', description: 'Output as JSON' },
    ],
  },
  {
    name: 'lesson-health',
    aliases: ['stale'],
    description: 'Report on stale lessons (>60d inactive) with optional auto-archive',
    group: 'discovery',
    flags: [
      { name: 'archive', type: 'boolean', description: 'Auto-archive lessons >90d inactive' },
      { name: 'json',    type: 'boolean', description: 'Output as JSON' },
    ],
  },

  // -------------------------------------------------------------------------
  // Gates
  // -------------------------------------------------------------------------
  {
    name: 'gate-check',
    description: 'PreToolUse hook: pipe tool JSON via stdin, get ALLOW/BLOCK verdict',
    group: 'gates',
    flags: [],
  },
  {
    name: 'force-gate',
    description: 'Immediately create a blocking gate from a pattern string',
    group: 'gates',
    flags: [
      { name: 'pattern', type: 'string', description: 'Pattern to block (positional)' },
    ],
  },
  {
    name: 'rules',
    description: 'Generate prevention rules from repeated failure patterns',
    group: 'gates',
    mcpTool: 'prevention_rules',
    flags: [
      { name: 'json', type: 'boolean', description: 'Output as JSON' },
    ],
  },

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------
  {
    name: 'export-dpo',
    aliases: ['dpo'],
    description: 'Export DPO training pairs (prompt/chosen/rejected JSONL)',
    group: 'export',
    flags: [
      { name: 'output', type: 'string', description: 'Output file path' },
    ],
  },
  {
    name: 'export-databricks',
    aliases: ['databricks'],
    description: 'Export feedback + proof artifacts as a Databricks-ready analytics bundle',
    group: 'export',
    flags: [],
  },
  {
    name: 'obsidian-export',
    description: 'Export all feedback as interlinked Obsidian markdown notes',
    group: 'export',
    flags: [
      { name: 'vault-path',  type: 'string', description: 'Obsidian vault path' },
      { name: 'output-dir',  type: 'string', description: 'Output subdirectory (default: AI-Memories/thumbgate)' },
    ],
  },

  // -------------------------------------------------------------------------
  // Ops
  // -------------------------------------------------------------------------
  {
    name: 'status',
    description: 'Agent-friendly health check — gates, lessons, feedback, enforcement',
    group: 'discovery',
    flags: [
      { name: 'json', type: 'boolean', description: 'Output as JSON' },
    ],
  },
  {
    name: 'demo',
    description: 'Simulated walkthrough — see ThumbGate block a bad action in 10 seconds',
    group: 'ops',
    flags: [
      { name: 'json', type: 'boolean', description: 'Output as JSON' },
    ],
  },
  {
    name: 'init',
    description: 'Scaffold .thumbgate/ config and wire agent hooks',
    group: 'ops',
    flags: [
      { name: 'agent',      type: 'string',  description: 'Target agent: claude-code | cursor | codex | gemini | amp' },
      { name: 'wire-hooks', type: 'boolean', description: 'Wire hooks only (skip scaffold)' },
      { name: 'json',       type: 'boolean', description: 'Output as JSON' },
    ],
  },
  {
    name: 'serve',
    description: 'Start MCP server on stdio — connect any MCP-compatible agent',
    group: 'ops',
    flags: [],
  },
  {
    name: 'dashboard',
    description: 'Full ThumbGate dashboard — approval rate, gate stats, prevention impact',
    group: 'ops',
    flags: [],
  },
  {
    name: 'self-heal',
    description: 'Run self-healing check and auto-fix known issues',
    group: 'ops',
    flags: [
      { name: 'check', type: 'boolean', description: 'Check only, no fixes' },
    ],
  },
  {
    name: 'import-doc',
    aliases: ['import-document'],
    description: 'Import a local policy/runbook and propose reviewable gate candidates',
    group: 'ops',
    flags: [
      { name: 'file', type: 'string', description: 'Path to document' },
    ],
  },
  {
    name: 'meta-agent',
    description: 'Run meta-agent loop: generate, evaluate, and promote prevention rules',
    group: 'advanced',
    flags: [
      { name: 'dry-run', type: 'boolean', description: 'Preview rules without writing' },
      { name: 'status',  type: 'boolean', description: 'Show last run summary' },
    ],
  },
  {
    name: 'pro',
    description: `Solo dashboard + exports side lane (${'19'}/mo · ${'149'}/yr)`,
    group: 'ops',
    flags: [
      { name: 'upgrade', type: 'boolean', description: 'Install Pro configs into .thumbgate/' },
      { name: 'info',    type: 'boolean', description: 'Show Pro feature list' },
    ],
  },
];

/**
 * Return the command definition for a given name or alias.
 */
function findCommand(name) {
  return CLI_COMMANDS.find(
    (cmd) => cmd.name === name || (cmd.aliases || []).includes(name),
  );
}

/**
 * Return commands grouped by their group field.
 */
function groupedCommands() {
  const groups = {};
  for (const cmd of CLI_COMMANDS) {
    const g = cmd.group || 'other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(cmd);
  }
  return groups;
}

/**
 * Generate a compact help string for a single command.
 * Format:  name [aliases]   description   [--flag ...]
 */
function commandHelpLine(cmd, opts = {}) {
  const { showFlags = false } = opts;
  const nameCol = 22;
  const nameStr = [cmd.name, ...(cmd.aliases || []).slice(0, 1)].join(' | ');
  const pad = ' '.repeat(Math.max(1, nameCol - nameStr.length));
  let line = `  ${nameStr}${pad}${cmd.description}`;
  if (cmd.mcpTool) line += ` [mcp:${cmd.mcpTool}]`;
  if (showFlags && cmd.flags.length > 0) {
    const flagStr = cmd.flags
      .map((f) => `--${f.name}${f.required ? ' (required)' : ''}`)
      .join('  ');
    line += `\n    ${flagStr}`;
  }
  return line;
}

module.exports = { CLI_COMMANDS, findCommand, groupedCommands, commandHelpLine };
