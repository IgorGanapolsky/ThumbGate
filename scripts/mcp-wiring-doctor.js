#!/usr/bin/env node
'use strict';

/**
 * mcp-wiring-doctor.js
 *
 * Detects the structural RAG-loop break that unattended agents hit:
 * AGENTS.md mandates recall/capture_feedback, but:
 *  1. `.mcp.json` may not list the thumbgate MCP server
 *  2. The lessons store may be missing (Mac-local only / empty container)
 *  3. Remote hosted capture env may be unset, so cloud runs cannot write
 *
 * High-ROI: make the gap loud at session-start / doctor instead of silent.
 */

const fs = require('fs');
const path = require('path');
const { resolveMcpEntry } = require('./mcp-config');

const PKG_ROOT = path.resolve(__dirname, '..');
const PKG_VERSION = require('../package.json').version;

const LEGACY_MCP_KEYS = new Set(['mcp-memory-gateway', 'rlhf']);

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { __parseError: true };
  }
}

function listMcpServers(config) {
  if (!config || typeof config !== 'object') return [];
  const servers = config.mcpServers || config.servers || {};
  return Object.keys(servers || {});
}

function hasThumbgateServer(config) {
  if (!config || config.__parseError) return false;
  const servers = config.mcpServers || config.servers || {};
  if (servers.thumbgate) return true;
  // Accept explicit package/npx forms under alternate keys only if command mentions thumbgate
  return Object.entries(servers).some(([key, entry]) => {
    if (LEGACY_MCP_KEYS.has(key)) return false;
    const blob = JSON.stringify(entry || {}).toLowerCase();
    return blob.includes('thumbgate') || blob.includes('server-stdio.js');
  });
}

function resolveLessonsStore(projectRoot, env = process.env) {
  const candidates = [
    env.THUMBGATE_FEEDBACK_DIR,
    path.join(projectRoot, '.thumbgate'),
    path.join(projectRoot, '.claude', 'memory', 'feedback'),
    env.HOME ? path.join(env.HOME, '.thumbgate') : null,
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        const writable = (() => {
          try {
            fs.accessSync(dir, fs.constants.W_OK);
            return true;
          } catch {
            return false;
          }
        })();
        return { path: dir, present: true, writable };
      }
    } catch {
      /* continue */
    }
  }

  const preferred = candidates[0] || path.join(projectRoot, '.thumbgate');
  let parent = preferred;
  while (!fs.existsSync(parent)) {
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  try {
    fs.accessSync(parent, fs.constants.W_OK);
    return { path: preferred, present: false, writable: true, creatable: true };
  } catch {
    return { path: preferred, present: false, writable: false, creatable: false };
  }
}

function remoteCaptureConfigured(env = process.env) {
  const base = String(env.THUMBGATE_API_BASE_URL || env.THUMBGATE_API_URL || '').trim();
  const key = String(env.THUMBGATE_API_KEY || '').trim();
  return {
    configured: Boolean(base && key),
    baseUrl: base || null,
    hasKey: Boolean(key),
  };
}

function isContainerLike(env = process.env) {
  if (env.container || env.CONTAINER) return true;
  if (fs.existsSync('/.dockerenv')) return true;
  return false;
}

/**
 * @returns {{
 *   overall: 'ok'|'warning'|'error',
 *   findings: string[],
 *   mcp: object,
 *   lessonsStore: object,
 *   remote: object,
 *   unattendedCaptureReady: boolean,
 * }}
 */
function wiringReport(projectRoot = process.cwd(), env = process.env) {
  const root = path.resolve(projectRoot);
  const findings = [];
  let overall = 'ok';

  const mcpPath = path.join(root, '.mcp.json');
  const claudeSettingsPath = path.join(root, '.claude', 'settings.json');
  const cursorMcpPath = path.join(root, '.cursor', 'mcp.json');

  const mcpConfig = readJsonIfExists(mcpPath);
  const claudeSettings = readJsonIfExists(claudeSettingsPath);
  const cursorMcp = readJsonIfExists(cursorMcpPath);

  const mcpServers = listMcpServers(mcpConfig);
  const hasProjectMcpFile = fs.existsSync(mcpPath);
  const thumbgateInProjectMcp = hasThumbgateServer(mcpConfig);
  const thumbgateInCursor = hasThumbgateServer(cursorMcp);
  const thumbgateInClaudeSettings = hasThumbgateServer(claudeSettings);

  if (!hasProjectMcpFile) {
    findings.push('Missing project .mcp.json — bootstrap file required by agent-readiness; MCP tools are not project-wired.');
    overall = 'error';
  } else if (mcpConfig && mcpConfig.__parseError) {
    findings.push('.mcp.json is not valid JSON.');
    overall = 'error';
  } else if (!thumbgateInProjectMcp) {
    findings.push(
      `.mcp.json has no thumbgate server (found: ${mcpServers.join(', ') || 'none'}). ` +
      'capture_feedback / recall are uncallable for agents using this project MCP config. ' +
      'Add mcpServers.thumbgate (see adapters/claude/.mcp.json) or run: node scripts/install-mcp.js --project'
    );
    overall = 'error';
  }

  for (const key of mcpServers) {
    if (LEGACY_MCP_KEYS.has(key)) {
      findings.push(`Detected legacy MCP key "${key}" in .mcp.json — migrate to "thumbgate".`);
      if (overall === 'ok') overall = 'warning';
    }
  }

  if (!thumbgateInClaudeSettings && !thumbgateInCursor && !thumbgateInProjectMcp) {
    findings.push('No thumbgate MCP entry in .mcp.json, .claude/settings.json, or .cursor/mcp.json.');
    overall = 'error';
  }

  const lessonsStore = resolveLessonsStore(root, env);
  const remote = remoteCaptureConfigured(env);
  const container = isContainerLike(env);

  if (!lessonsStore.present && !lessonsStore.writable) {
    findings.push(
      'No lessons store found (.thumbgate/ or THUMBGATE_FEEDBACK_DIR). ' +
      'Local capture_feedback cannot persist. Unattended/cloud runs need THUMBGATE_FEEDBACK_DIR ' +
      'or hosted capture via THUMBGATE_API_BASE_URL + THUMBGATE_API_KEY.'
    );
    if (overall === 'ok') overall = 'warning';
    if (container) overall = 'error';
  } else if (!lessonsStore.writable) {
    findings.push(`Lessons store present but not writable: ${lessonsStore.path}`);
    if (overall === 'ok') overall = 'warning';
  }

  if (container && !lessonsStore.writable && !remote.configured) {
    findings.push(
      'Container/unattended runtime: neither local lessons store nor hosted capture env is configured. ' +
      'AGENTS.md RAG loop (recall → act → capture_feedback) is unenforceable in this environment.'
    );
    overall = 'error';
  }

  if (container && remote.configured) {
    findings.push('Hosted capture env is set — unattended runs can POST feedback to the API when local store is missing.');
  }

  const unattendedCaptureReady = Boolean(
    lessonsStore.writable || remote.configured
  );

  if (!unattendedCaptureReady && overall === 'ok') {
    overall = 'warning';
  }

  return {
    overall,
    findings,
    mcp: {
      projectMcpPath: mcpPath,
      projectMcpPresent: hasProjectMcpFile,
      servers: mcpServers,
      thumbgateInProjectMcp,
      thumbgateInCursor,
      thumbgateInClaudeSettings,
    },
    lessonsStore,
    remote,
    container,
    unattendedCaptureReady,
    recommendation: unattendedCaptureReady
      ? 'RAG capture path is available (local store and/or hosted API).'
      : 'Wire mcpServers.thumbgate in .mcp.json and set THUMBGATE_FEEDBACK_DIR or THUMBGATE_API_BASE_URL+THUMBGATE_API_KEY for unattended agents.',
  };
}

function formatReport(report) {
  const lines = [
    `ThumbGate MCP wiring doctor: ${report.overall.toUpperCase()}`,
    `  Project .mcp.json: ${report.mcp.projectMcpPresent ? 'present' : 'MISSING'} (thumbgate: ${report.mcp.thumbgateInProjectMcp ? 'yes' : 'NO'})`,
    `  Lessons store: ${report.lessonsStore.present ? report.lessonsStore.path : 'NONE'} (writable: ${report.lessonsStore.writable})`,
    `  Hosted capture: ${report.remote.configured ? 'configured' : 'not configured'}`,
    `  Unattended capture ready: ${report.unattendedCaptureReady ? 'yes' : 'NO'}`,
    `  Container-like: ${report.container ? 'yes' : 'no'}`,
  ];
  if (report.findings.length) {
    lines.push('  Findings:');
    for (const f of report.findings) lines.push(`    - ${f}`);
  }
  lines.push(`  ${report.recommendation}`);
  return lines.join('\n');
}

function applyFix(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  const mcpPath = path.join(root, '.mcp.json');
  const desired = {
    mcpServers: {
      thumbgate: resolveMcpEntry({
        pkgRoot: PKG_ROOT,
        pkgVersion: PKG_VERSION,
        scope: 'project',
        targetDir: root,
      }),
    },
  };

  let existing = {};
  if (fs.existsSync(mcpPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    } catch {
      existing = {};
    }
  }

  if (!existing.mcpServers || typeof existing.mcpServers !== 'object') {
    existing.mcpServers = {};
  }
  // Preserve other servers; force thumbgate entry.
  existing.mcpServers.thumbgate = desired.mcpServers.thumbgate;
  for (const legacy of LEGACY_MCP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(existing.mcpServers, legacy)) {
      delete existing.mcpServers[legacy];
    }
  }

  fs.writeFileSync(mcpPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  return { wrote: mcpPath, config: existing };
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');
  const json = args.includes('--json');
  const projectRoot = process.cwd();

  if (fix) {
    const result = applyFix(projectRoot);
    if (json) {
      console.log(JSON.stringify({ fixed: true, ...result }, null, 2));
    } else {
      console.log(`Wrote ${result.wrote}`);
    }
  }

  const report = wiringReport(projectRoot);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }
  process.exit(report.overall === 'error' ? 2 : report.overall === 'warning' ? 1 : 0);
}

module.exports = {
  wiringReport,
  formatReport,
  applyFix,
  hasThumbgateServer,
  resolveLessonsStore,
  remoteCaptureConfigured,
};
