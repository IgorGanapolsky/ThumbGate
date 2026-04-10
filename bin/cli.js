#!/usr/bin/env node
/**
 * thumbgate CLI
 *
 * Usage:
 *   npx thumbgate init          # scaffold .thumbgate/ config + .mcp.json
 *   npx thumbgate init --wire-hooks          # wire hooks only (auto-detect agent)
 *   npx thumbgate init --agent claude-code   # scaffold + wire hooks for specific agent
 *   npx thumbgate gate-check    # PreToolUse hook: pipe tool JSON via stdin, get verdict
 *   npx thumbgate capture       # capture feedback
 *   npx thumbgate export-dpo    # export DPO training pairs
 *   npx thumbgate export-databricks   # export Databricks-ready analytics bundle
 *   npx thumbgate stats         # feedback analytics + Revenue-at-Risk
 *   npx thumbgate cfo           # local operational billing summary
 *   npx thumbgate pro           # solo dashboard + exports side lane
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');
const { resolveMcpEntry } = require(path.join(__dirname, '..', 'scripts', 'mcp-config'));
const { trackEvent } = require(path.join(__dirname, '..', 'scripts', 'cli-telemetry'));
const {
  cacheUpdateHookCommand,
  preToolHookCommand,
  sessionStartHookCommand,
  statuslineCommand,
  userPromptHookCommand,
} = require(path.join(__dirname, '..', 'scripts', 'hook-runtime'));
const {
  PRO_MONTHLY_PAYMENT_LINK,
  PRO_PRICE_LABEL,
} = require(path.join(__dirname, '..', 'scripts', 'commercial-offer'));

const COMMAND = process.argv[2];
const CWD = process.cwd();
const PKG_ROOT = path.join(__dirname, '..');

const PRO_URL = 'https://thumbgate-production.up.railway.app';
const PRO_CHECKOUT_URL = PRO_MONTHLY_PAYMENT_LINK;

function upgradeNudge() {
  if (process.env.THUMBGATE_NO_NUDGE === '1') return;
  try {
    const { isProTier } = require(path.join(PKG_ROOT, 'scripts', 'rate-limiter'));
    if (isProTier()) return;
  } catch (_) { return; }
  process.stderr.write(
    '\n  Team rollout: start with the Workflow Hardening Sprint\n' +
    '  https://thumbgate-production.up.railway.app/#workflow-sprint-intake\n' +
    `\n  Solo side lane: Pro — ${PRO_PRICE_LABEL}\n` +
    `  ${PRO_CHECKOUT_URL}\n\n`
  );
}

function appendLocalTelemetry(payload) {
  try {
    const { getFeedbackPaths } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
    const { appendTelemetryPing } = require(path.join(PKG_ROOT, 'scripts', 'telemetry-analytics'));
    const { FEEDBACK_DIR } = getFeedbackPaths();
    appendTelemetryPing(FEEDBACK_DIR, payload);
  } catch (_) { /* telemetry is best-effort */ }
}

function syncActiveProjectContext(options = {}) {
  try {
    // Tests and explicitly scoped CLI calls may pin a feedback root directly.
    // In that case, do not inject a project selection that would cause later
    // reads/writes to escape the requested directory.
    if (
      !options.force &&
      process.env.THUMBGATE_FEEDBACK_DIR &&
      !process.env.THUMBGATE_PROJECT_DIR &&
      !process.env.CLAUDE_PROJECT_DIR
    ) {
      return null;
    }
    const {
      resolveProjectDir,
      writeActiveProjectState,
    } = require(path.join(PKG_ROOT, 'scripts', 'feedback-paths'));
    const projectDir = resolveProjectDir({
      cwd: CWD,
      env: process.env,
      includeStored: options.includeStored !== false,
    });
    if (!projectDir) return null;
    process.env.THUMBGATE_PROJECT_DIR = projectDir;
    writeActiveProjectState(projectDir, { env: process.env });
    return projectDir;
  } catch (_) {
    return null;
  }
}

function telemetryPing(installId) {
  if (process.env.THUMBGATE_NO_TELEMETRY === '1') return;
  const payloadObject = {
    installId,
    eventType: 'cli_init',
    clientType: 'cli',
    source: 'cli',
    version: pkgVersion(),
    platform: process.platform,
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  };
  appendLocalTelemetry(payloadObject);
  const apiUrl = process.env.THUMBGATE_API_URL || 'https://thumbgate-production.up.railway.app';
  const payload = JSON.stringify(payloadObject);
  try {
    const url = new URL('/v1/telemetry/ping', apiUrl);
    const mod = url.protocol === 'https:' ? require('https') : require('http');
    const req = mod.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 3000 }, () => {});
    req.on('error', () => {});
    req.on('timeout', () => { req.destroy(); });
    req.on('socket', (s) => s.unref()); // fire-and-forget: never block process exit
    req.end(payload);
  } catch (_) { /* telemetry is best-effort */ }
}

function proNudge(context) {
  if (process.env.THUMBGATE_NO_NUDGE === '1') return;
  const messages = [
    `\n  💡 Unlock Pro (${PRO_PRICE_LABEL}): searchable dashboard, DPO export, multi-repo sync\n     ${PRO_CHECKOUT_URL}\n`,
    `\n  💡 Pro tip: export your feedback as DPO training pairs to improve your models.\n     Get Pro: ${PRO_CHECKOUT_URL}\n`,
    `\n  💡 ThumbGate Pro: search, edit, and sync lessons across repos. ${PRO_PRICE_LABEL}.\n     ${PRO_CHECKOUT_URL}\n`,
  ];
  // Rotate message daily — no Math.random (security policy)
  const msg = messages[Math.floor(Date.now() / 86400000) % messages.length];
  process.stderr.write(msg);
}

function limitNudge(action) {
  if (process.env.THUMBGATE_NO_NUDGE === '1') return;
  process.stderr.write(
    `\n  ⚠️  Free tier limit reached. Upgrade to Pro for unlimited: https://thumbgate-production.up.railway.app/pro\n` +
    `     ${action} daily limit reached. Upgrade to Pro for unlimited usage — ${PRO_PRICE_LABEL}:\n` +
    `     ${PRO_CHECKOUT_URL}\n\n`
  );
}

function parseArgs(argv) {
  const args = {};
  argv.forEach((arg, index) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    if (rest.length) {
      args[key] = rest.join('=');
      return;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      return;
    }

    args[key] = true;
  });
  return args;
}

function readStdinText() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function pkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

// --- Platform auto-detection helpers ---

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const MCP_SERVER_NAME = 'thumbgate';
const MCP_SERVER_NAMES = ['thumbgate', 'mcp-memory-gateway', 'rlhf'];

function mcpEntriesMatch(entry, expectedEntry) {
  return Boolean(
    entry &&
    expectedEntry &&
    entry.command === expectedEntry.command &&
    Array.isArray(entry.args) &&
    Array.isArray(expectedEntry.args) &&
    entry.args.length === expectedEntry.args.length &&
    entry.args.every((arg, index) => arg === expectedEntry.args[index])
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatTomlStringArray(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

function canonicalMcpEntry(scope = 'project') {
  return resolveMcpEntry({
    pkgRoot: PKG_ROOT,
    pkgVersion: pkgVersion(),
    scope,
    targetDir: CWD,
  });
}

function mcpSectionBlock(name = MCP_SERVER_NAME, scope = 'project') {
  const entry = canonicalMcpEntry(scope);
  return `[mcp_servers.${name}]\ncommand = "${entry.command}"\nargs = ${formatTomlStringArray(entry.args)}\n`;
}

function mcpSectionRegex(name) {
  return new RegExp(
    `^\\[mcp_servers\\.${escapeRegExp(name)}\\]\\n(?:^(?!\\[).*(?:\\n|$))*`,
    'm'
  );
}

function upsertCodexServerConfig(content) {
  const canonicalBlock = mcpSectionBlock(MCP_SERVER_NAME, 'home');
  const sections = MCP_SERVER_NAMES.map((name) => ({
    name,
    regex: mcpSectionRegex(name),
  }));
  const matches = sections
    .map((section) => ({ ...section, match: content.match(section.regex) }))
    .filter((section) => section.match);

  if (matches.length === 0) {
    const prefix = content.trimEnd();
    return {
      changed: true,
      content: `${prefix}${prefix ? '\n\n' : ''}${canonicalBlock}`,
    };
  }

  let nextContent = content;
  let changed = false;
  let canonicalPresent = false;

  for (const section of matches) {
    const normalized = canonicalBlock;
    const current = section.match[0];

    if (section.name === MCP_SERVER_NAME) {
      canonicalPresent = true;
      if (current !== normalized) {
        nextContent = nextContent.replace(section.regex, normalized);
        changed = true;
      }
      continue;
    }

    nextContent = nextContent.replace(section.regex, '');
    changed = true;
  }

  if (!canonicalPresent) {
    const prefix = nextContent.trimEnd();
    nextContent = `${prefix}${prefix ? '\n\n' : ''}${canonicalBlock}`;
    changed = true;
  }

  return {
    changed,
    content: nextContent.endsWith('\n') ? nextContent : `${nextContent}\n`,
  };
}

function mergeMcpJson(filePath, label, scope = 'project') {
  const canonicalEntry = canonicalMcpEntry(scope);
  if (!fs.existsSync(filePath)) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: canonicalEntry } }, null, 2) + '\n');
    console.log(`  ${label}: wrote ${path.relative(CWD, filePath)}`);
    return true;
  }
  const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  existing.mcpServers = existing.mcpServers || {};

  let changed = false;
  const currentEntry = existing.mcpServers[MCP_SERVER_NAME];
  if (!mcpEntriesMatch(currentEntry, canonicalEntry)) {
    existing.mcpServers[MCP_SERVER_NAME] = canonicalEntry;
    changed = true;
  }

  for (const serverName of MCP_SERVER_NAMES) {
    if (serverName === MCP_SERVER_NAME) continue;
    if (Object.prototype.hasOwnProperty.call(existing.mcpServers, serverName)) {
      delete existing.mcpServers[serverName];
      changed = true;
    }
  }

  if (!changed) return false;

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n');
  console.log(`  ${label}: updated ${path.relative(CWD, filePath)}`);
  return true;
}

function detectPlatform(name, checks) {
  for (const check of checks) {
    try { if (check()) return true; } catch (_) {}
  }
  return false;
}

function whichExists(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'pipe' }); return true; } catch (_) { return false; }
}

function setupClaude() {
  const mcpChanged = mergeMcpJson(path.join(CWD, '.mcp.json'), 'Claude Code', 'project');

  // Upsert Stop hook into .claude/settings.json for autonomous self-scoring
  const settingsPath = path.join(CWD, '.claude', 'settings.json');
  const stopHookCommand = 'bash scripts/hook-stop-self-score.sh';

  let settings = { hooks: {} };
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (_) { /* fresh */ }
  }
  settings.hooks = settings.hooks || {};

  const stopAlreadyPresent = (settings.hooks.Stop || [])
    .some(entry => (entry.hooks || []).some(h => h.command === stopHookCommand));

  let hooksChanged = false;
  if (!stopAlreadyPresent) {
    settings.hooks.Stop = settings.hooks.Stop || [];
    settings.hooks.Stop.push({ hooks: [{ type: 'command', command: stopHookCommand }] });
    hooksChanged = true;
    console.log('  Claude Code: installed Stop hook');
  }

  // Upsert PostToolUse hook for ThumbGate statusline cache updates
  const cacheHookCommand = cacheUpdateHookCommand();
  const originalPostToolUseCount = (settings.hooks.PostToolUse || []).length;
  settings.hooks.PostToolUse = (settings.hooks.PostToolUse || []).filter(
    (entry) => !(entry.hooks || []).some((h) => h.command && h.command !== cacheHookCommand && /(hook-thumbgate-cache-updater|cache-update\b)/.test(h.command))
  );
  if (settings.hooks.PostToolUse.length !== originalPostToolUseCount) {
    hooksChanged = true;
  }
  const cacheAlreadyPresent = (settings.hooks.PostToolUse || [])
    .some(entry => (entry.hooks || []).some(h => h.command === cacheHookCommand || (h.command && h.command.includes('cache-update'))));

  if (!cacheAlreadyPresent) {
    settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];
    settings.hooks.PostToolUse.push({
      matcher: 'mcp__thumbgate__feedback_stats|mcp__thumbgate__dashboard',
      hooks: [{ type: 'command', command: cacheHookCommand }]
    });
    hooksChanged = true;
    console.log('  Claude Code: installed ThumbGate cache updater hook');
  }

  // Upsert statusLine for ThumbGate feedback display
  const statuslineScript = statuslineCommand();
  if (!settings.statusLine || settings.statusLine.command !== statuslineScript) {
    settings.statusLine = { type: 'command', command: statuslineScript };
    hooksChanged = true;
    console.log('  Claude Code: installed ThumbGate status line');
  }

  if (hooksChanged) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }

  return mcpChanged || hooksChanged;
}

function setupCodex() {
  const configPath = path.join(HOME, '.codex', 'config.toml');
  const block = mcpSectionBlock(MCP_SERVER_NAME, 'home');
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, block);
    console.log('  Codex: created ~/.codex/config.toml');
    return true;
  }
  const content = fs.readFileSync(configPath, 'utf8');
  const updated = upsertCodexServerConfig(content);
  if (!updated.changed) return false;
  fs.writeFileSync(configPath, updated.content);
  console.log('  Codex: appended MCP server to ~/.codex/config.toml');
  return true;
}

function setupGemini() {
  const settingsPath = path.join(HOME, '.gemini', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings.mcpServers = settings.mcpServers || {};
    let changed = false;
    const canonicalEntry = canonicalMcpEntry('home');

    if (!mcpEntriesMatch(settings.mcpServers[MCP_SERVER_NAME], canonicalEntry)) {
      settings.mcpServers[MCP_SERVER_NAME] = canonicalEntry;
      changed = true;
    }

    for (const serverName of MCP_SERVER_NAMES) {
      if (serverName === MCP_SERVER_NAME) continue;
      if (Object.prototype.hasOwnProperty.call(settings.mcpServers, serverName)) {
        delete settings.mcpServers[serverName];
        changed = true;
      }
    }

    if (!changed) return false;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.log('  Gemini: updated ~/.gemini/settings.json');
    return true;
  }
  // Fallback: project-level .gemini/settings.json
  return mergeMcpJson(path.join(CWD, '.gemini', 'settings.json'), 'Gemini', 'project');
}

function setupAmp() {
  const skillDir = path.join(CWD, '.amp', 'skills', 'thumbgate-feedback');
  const destPath = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(destPath)) return false;
  const srcPath = path.join(PKG_ROOT, 'plugins', 'amp-skill', 'SKILL.md');
  if (!fs.existsSync(srcPath)) return false;
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  console.log('  Amp: installed .amp/skills/thumbgate-feedback/SKILL.md');
  return true;
}

function setupCursor() {
  return mergeMcpJson(path.join(CWD, '.cursor', 'mcp.json'), 'Cursor', 'project');
}

function setupForge() {
  const destPath = path.join(CWD, 'forge.yaml');
  if (fs.existsSync(destPath)) {
    // Don't overwrite existing forge.yaml — user may have custom config
    return false;
  }
  const srcPath = path.join(PKG_ROOT, 'adapters', 'forge', 'forge.yaml');
  if (!fs.existsSync(srcPath)) return false;
  fs.copyFileSync(srcPath, destPath);
  console.log('  ForgeCode: installed forge.yaml with ThumbGate skills');
  return true;
}

function init() {
  const args = parseArgs(process.argv.slice(3));

  // --wire-hooks only mode: skip scaffolding, just wire hooks
  if (args['wire-hooks']) {
    const { wireHooks, parseFlags: parseHookFlags } = require(path.join(PKG_ROOT, 'scripts', 'auto-wire-hooks'));
    const hookResult = wireHooks({ agent: args.agent, dryRun: args['dry-run'] });
    if (hookResult.error) {
      console.error(hookResult.error);
      process.exit(1);
    }
    if (!hookResult.changed) {
      console.log(`Hooks already wired for ${hookResult.agent} at ${hookResult.settingsPath}`);
    } else {
      const prefix = args['dry-run'] ? '[DRY RUN] Would add' : 'Added';
      console.log(`${prefix} hooks for ${hookResult.agent}:`);
      for (const h of hookResult.added) {
        console.log(`  ${h.lifecycle}: ${h.command}`);
      }
      console.log(`  Settings: ${hookResult.settingsPath}`);
    }
    return;
  }

  const thumbgateDir = path.join(CWD, '.thumbgate');
  const configPath = path.join(thumbgateDir, 'config.json');

  if (!fs.existsSync(thumbgateDir)) {
    fs.mkdirSync(thumbgateDir, { recursive: true });
    console.log('Created .thumbgate/');
  } else {
    console.log('.thumbgate/ already exists — updating config');
  }

  let existingInstallId = null;
  if (fs.existsSync(configPath)) {
    try {
      const existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (existingConfig && typeof existingConfig.installId === 'string' && existingConfig.installId.trim()) {
        existingInstallId = existingConfig.installId.trim();
      }
    } catch (_) {
      // Ignore invalid existing config and write a fresh one below.
    }
  }

  const config = {
    version: pkgVersion(),
    apiUrl: process.env.THUMBGATE_API_URL || 'http://localhost:3000',
    logPath: '.thumbgate/feedback-log.jsonl',
    memoryPath: '.thumbgate/memory-log.jsonl',
    installId: existingInstallId || crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log('Wrote .thumbgate/config.json');

  // Always create .mcp.json (project-level MCP config used by Claude, Codex, Cursor)
  mergeMcpJson(path.join(CWD, '.mcp.json'), 'MCP');

  // Auto-detect and configure platform-specific locations
  console.log('');
  console.log('Detecting platforms...');
  let configured = 0;

  const platforms = [
    { name: 'Codex', detect: [() => whichExists('codex'), () => fs.existsSync(path.join(HOME, '.codex'))], setup: setupCodex },
    { name: 'Gemini', detect: [() => whichExists('gemini'), () => fs.existsSync(path.join(HOME, '.gemini'))], setup: setupGemini },
    { name: 'Amp', detect: [() => whichExists('amp'), () => fs.existsSync(path.join(HOME, '.amp'))], setup: setupAmp },
    { name: 'Cursor', detect: [() => fs.existsSync(path.join(HOME, '.cursor', 'mcp.json')), () => fs.existsSync(path.join(CWD, '.cursor'))], setup: setupCursor },
    { name: 'ForgeCode', detect: [() => whichExists('forge'), () => fs.existsSync(path.join(CWD, 'forge.yaml'))], setup: setupForge },
  ];

  for (const p of platforms) {
    if (detectPlatform(p.name, p.detect)) {
      const didSetup = p.setup();
      if (didSetup) configured++;
      else console.log(`  ${p.name}: already configured`);
    }
  }

  // ChatGPT — cannot be automated
  const chatgptSpec = path.join(PKG_ROOT, 'adapters', 'chatgpt', 'openapi.yaml');
  if (fs.existsSync(chatgptSpec)) {
    const projectChatgptSpec = path.join(thumbgateDir, 'chatgpt-openapi.yaml');
    fs.copyFileSync(chatgptSpec, projectChatgptSpec);
    console.log(`  ChatGPT: import ${path.relative(CWD, projectChatgptSpec)} in GPT Builder > Actions`);
  }

  if (configured === 0) console.log('  All detected platforms already configured.');

  // Auto-wire hooks if --agent flag is provided (or auto-detect)
  if (args.agent || args['wire-hooks']) {
    const { wireHooks } = require(path.join(PKG_ROOT, 'scripts', 'auto-wire-hooks'));
    const hookResult = wireHooks({ agent: args.agent, dryRun: args['dry-run'] });
    if (hookResult.error) {
      console.log(`  Hook wiring: ${hookResult.error}`);
    } else if (!hookResult.changed) {
      console.log(`  Hooks: already wired for ${hookResult.agent}`);
    } else {
      const prefix = args['dry-run'] ? '[DRY RUN] Would add' : 'Wired';
      for (const h of hookResult.added) {
        console.log(`  ${prefix} ${h.lifecycle} hook: ${h.command}`);
      }
    }
  }

  // .gitignore
  const gitignorePath = path.join(CWD, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    const entries = ['.thumbgate/feedback-log.jsonl', '.thumbgate/memory-log.jsonl'];
    const missing = entries.filter((e) => !gitignore.includes(e));
    if (missing.length > 0) {
      fs.appendFileSync(gitignorePath, '\n# ThumbGate local feedback data\n' + missing.join('\n') + '\n');
      console.log('Updated .gitignore');
    }
  }

  console.log('');
  console.log(`thumbgate v${pkgVersion()} initialized.`);
  console.log('Run: npx thumbgate help');
  trackEvent('cli_init', { command: 'init' });
  proNudge();
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────────┐');
  console.log('  │  Teams: shared enforcement, CI gates, audit trails      │');
  console.log('  │  One correction protects every agent on your team.      │');
  console.log('  │  https://thumbgate-production.up.railway.app/pro        │');
  console.log('  └──────────────────────────────────────────────────────────┘');

  try {
    const { appendFunnelEvent } = require(path.join(PKG_ROOT, 'scripts', 'billing'));
    appendFunnelEvent({
      stage: 'acquisition',
      event: 'cli_init_completed',
      evidence: 'cli_init_completed',
      installId: config.installId,
      metadata: {
        cwd: CWD,
        version: config.version,
      },
    });
  } catch (_) {
    // Avoid failing init if telemetry write cannot be performed.
  }
  telemetryPing(config.installId);
}

function capture() {
  const args = parseArgs(process.argv.slice(3));

  // Delegate to the full engine
  const { captureFeedback, analyzeFeedback, feedbackSummary, writePreventionRules } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const { checkLimit } = require(path.join(PKG_ROOT, 'scripts', 'rate-limiter'));

  const { getUsage } = require(path.join(PKG_ROOT, 'scripts', 'rate-limiter'));
  const capLimit = checkLimit('capture_feedback');
  if (!capLimit.allowed) {
    limitNudge('capture_feedback');
    process.exit(1);
  }
  trackEvent('cli_capture', { command: 'capture' });

  if (args.stats) {
    stats();
    return;
  }

  if (args.summary) {
    console.log(feedbackSummary(Number(args.recent || 20)));
    return;
  }

  const signal = (args.feedback || '').toLowerCase();
  const normalized = ['up', 'thumbsup', 'thumbs_up', 'positive'].some(v => signal.includes(v)) ? 'up'
    : ['down', 'thumbsdown', 'thumbs_down', 'negative'].some(v => signal.includes(v)) ? 'down'
    : signal;

  if (normalized !== 'up' && normalized !== 'down') {
    console.error('Missing or unrecognized --feedback=up|down');
    process.exit(1);
  }

  const result = captureFeedback({
    signal: normalized,
    context: args.context || '',
    whatWentWrong: args['what-went-wrong'],
    whatToChange: args['what-to-change'],
    whatWorked: args['what-worked'],
    tags: args.tags,
  });

  if (result.accepted) {
    const ev = result.feedbackEvent;
    const mem = result.memoryRecord;
    console.log(`\nFeedback Captured [${normalized.toUpperCase()}]`);
    console.log('─'.repeat(50));
    console.log(`  Feedback ID : ${ev.id}`);
    console.log(`  Signal      : ${ev.signal} (${ev.actionType})`);
    console.log(`  Memory ID   : ${mem.id}`);
    console.log(`  Storage     : JSONL log + LanceDB vector index`);
    if (capLimit.used != null && capLimit.limit != null && capLimit.limit !== Infinity) {
      const pct = Math.round((capLimit.used / capLimit.limit) * 100);
      console.log(`  Usage       : ${capLimit.used}/${capLimit.limit} captures today (${pct}%)`);
      if (capLimit.remaining <= 1) {
        console.log(`  ⚠️  Free tier limit reached. Upgrade to Pro for unlimited: https://thumbgate-production.up.railway.app/pro`);
      }
    }
    console.log('');
    proNudge();
  } else {
    console.log(`\nFeedback Recorded [${normalized.toUpperCase()}] — not promoted`);
    console.log('─'.repeat(50));
    console.log(`  Reason      : ${result.reason}\n`);
    process.exit(2);
  }
}

function stats() {
  trackEvent('cli_stats', { command: 'stats' });
  const { analyzeFeedback } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const data = analyzeFeedback();
  
  console.log('\n📊 ThumbGate Performance Metrics');
  console.log('─'.repeat(50));
  console.log(`  Total Signals   : ${data.total}`);
  console.log(`  Approval Rate   : ${Math.round(data.approvalRate * 100)}%`);
  console.log(`  Recent Trend    : ${Math.round(data.recentRate * 100)}%`);
  
  // The Pitch: Revenue-at-Risk
  const avgCostOfMistake = 2.50; // $2.50 per agent turn/fix
  const revenueAtRisk = (data.totalNegative * avgCostOfMistake).toFixed(2);
  
  if (data.totalNegative > 0) {
    console.log('\n⚠️  REVENUE-AT-RISK ANALYSIS');
    console.log(`  Repeated Failures detected: ${data.totalNegative}`);
    console.log(`  Estimated Operational Loss: $${revenueAtRisk}`);
    console.log('  Action Required: Run "npx thumbgate rules" to generate guardrails.');
    console.log('  Strategic Recommendation: if this is a shared workflow problem, start the Workflow Hardening Sprint.');
    console.log('  Team intake: https://thumbgate-production.up.railway.app/#workflow-sprint-intake');
    console.log('  Solo side lane: npx thumbgate pro');
  } else {
    console.log('\n✅ System is currently high-reliability. No immediate revenue loss detected.');
  }
  proNudge();
}

function compact() {
  const { compactMemories } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const result = compactMemories();

  console.log('\n🧹 Memory Compaction Complete');
  console.log('─'.repeat(50));
  console.log(`  Before : ${result.before} memories`);
  console.log(`  After  : ${result.after} memories`);
  console.log(`  Removed: ${result.removed} duplicates`);

  if (result.removed > 0) {
    console.log(`\n✅ Eliminated ${Math.round((result.removed / result.before) * 100)}% noise.`);
  } else {
    console.log('\n✅ No duplicates found — memory log is clean.');
  }
}

function cfo() {
  const args = parseArgs(process.argv.slice(3));
  const { getOperationalBillingSummary } = require(path.join(PKG_ROOT, 'scripts', 'operational-summary'));
  getOperationalBillingSummary({
    window: args.window,
    timeZone: args.timezone,
    now: args.now,
  })
    .then(({ source, summary, fallbackReason }) => {
      console.log(JSON.stringify({
        source,
        fallbackReason,
        summary,
      }, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });
}

function repairGithubMarketplace() {
  const args = parseArgs(process.argv.slice(3));
  const { repairGithubMarketplaceRevenueLedger } = require(path.join(PKG_ROOT, 'scripts', 'billing'));
  const result = repairGithubMarketplaceRevenueLedger({
    write: Boolean(args.write),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

function northStar() {
  const args = parseArgs(process.argv.slice(3));
  const { getOperationalDashboard } = require(path.join(PKG_ROOT, 'scripts', 'operational-dashboard'));

  getOperationalDashboard({
    window: args.window,
    timeZone: args.timezone,
    now: args.now,
  })
    .then(({ source, data, fallbackReason }) => {
      const summary = data.analytics.northStar || {};
      const revenue = data.analytics.revenue || {};

      console.log('\nNorth Star');
      console.log('─'.repeat(40));
      console.log(`Metrics source                    : ${source}${fallbackReason ? ` (${fallbackReason})` : ''}`);
      console.log(`Weekly proof-backed workflow runs : ${summary.weeklyActiveProofBackedWorkflowRuns || 0}`);
      console.log(`Weekly teams on proof-backed runs : ${summary.weeklyTeamsRunningProofBackedWorkflows || 0}`);
      console.log(`Reviewed workflow runs            : ${summary.reviewedRuns || 0}`);
      console.log(`Named pilot agreements            : ${summary.namedPilotAgreements || 0}`);
      console.log(`Paid team runs                    : ${summary.paidTeamRuns || 0}`);
      console.log(`Paid orders                       : ${revenue.paidOrders || 0}`);
      console.log(`Booked revenue                    : $${(Number(revenue.bookedRevenueCents || 0) / 100).toFixed(2)}`);
      console.log(`Customer proof                    : ${summary.customerProofReached ? 'present' : 'missing'}`);
      console.log(`North Star status                 : ${summary.northStarReached ? 'tracking' : 'not_started'}`);
      if (summary.latestRun) {
        console.log(`Latest proof-backed run           : ${summary.latestRun.workflowId} @ ${summary.latestRun.timestamp}`);
      }
      console.log('');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });
}

function pro() {
  trackEvent('cli_pro_view', { command: 'pro' });
  const args = parseArgs(process.argv.slice(3));
  const {
    resolveProKey,
    saveLicense,
    startLocalProDashboard,
  } = require(path.join(PKG_ROOT, 'scripts', 'pro-local-dashboard'));

  function printProInfo() {
    const hostedUrl = 'https://thumbgate-production.up.railway.app';
    const truthUrl = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md';
    console.log('\nThumbGate Pro — Local Dashboard');
    console.log('─'.repeat(50));
    console.log('Self-serve side lane today: Pro ($19/mo or $149/yr).');
    console.log('Every licensed Pro user gets a personal local dashboard on localhost.');
    console.log('\nWhat is available:');
    console.log('  - Local Pro dashboard: your own browser dashboard for search, gates, and DPO export');
    console.log('  - Team rollout path: shared hosted lessons, org visibility, and workflow proof');
    console.log('  - Commercial truth doc: source of truth for traction, pricing, and proof claims');
    console.log('\nLinks:');
    console.log(`  Buy Pro         : ${PRO_CHECKOUT_URL}`);
    console.log(`  Commercial truth: ${truthUrl}\n`);
    console.log('  Launch dashboard: npx thumbgate pro');
    console.log('  Activate + run  : npx thumbgate pro --activate --key=YOUR_KEY');
    console.log('  Install configs : npx thumbgate pro --upgrade');
    console.log('  Legacy launcher : npx thumbgate-pro (separate package)');
    console.log('  Pro repo        : https://github.com/IgorGanapolsky/thumbgate-pro\n');
  }

  function launchDashboard(key, eventType) {
    return startLocalProDashboard({ key })
      .then(({ url }) => {
        console.log(`\n👍👎 ThumbGate Pro dashboard: ${url}\n`);
        appendLocalTelemetry({
          eventType,
          version: pkgVersion(),
          timestamp: new Date().toISOString(),
        });
      })
      .catch((err) => {
        console.error(err && err.message ? err.message : err);
        process.exit(1);
      });
  }

  if (args.activate) {
    const key = args.key || process.argv.slice(3).find((a) => !a.startsWith('--'));
    if (!key) {
      console.error('❌ License key required. Usage: npx thumbgate pro --activate --key=YOUR_KEY');
      console.error('   Your key was shown on the checkout success page after payment.');
      process.exit(1);
    }

    // Validate key format (THUMBGATE_API_KEY prefix)
    const legacyPrefix = String.fromCharCode(114, 108, 104, 102) + '_';
    if (!key.startsWith('tg_') && !key.startsWith(legacyPrefix)) {
      console.error('❌ Invalid license key format. Keys start with "tg_".');
      process.exit(1);
    }

    const license = {
      key,
      activatedAt: new Date().toISOString(),
      version: pkgVersion(),
    };

    const licensePath = saveLicense(license.key, { version: license.version });
    console.log('\n✅ Pro license activated!');
    console.log(`   Key saved to: ${licensePath}`);
    console.log('   Launching your personal local dashboard...\n');
    return launchDashboard(license.key, 'pro_activate');
  }

  if (args.upgrade) {
    const proDir = path.join(PKG_ROOT, 'pro');
    const thumbgateDir = path.join(CWD, '.thumbgate');
    if (!fs.existsSync(thumbgateDir)) fs.mkdirSync(thumbgateDir, { recursive: true });

    const files = [
      ['constraints-pro.json', '10 RLAIF constraints'],
      ['prevention-rules-pro.md', 'curated production rules'],
      ['thompson-presets.json', '4 sampling presets'],
      ['reminders-pro.json', '8 reminder templates'],
    ];

    for (const [file] of files) {
      fs.copyFileSync(path.join(proDir, file), path.join(thumbgateDir, file));
    }

    console.log('\n✅ Pro configs installed to .thumbgate/');
    for (const [file, desc] of files) {
      console.log(`  - ${file} (${desc})`);
    }
    console.log('');

    appendLocalTelemetry({ eventType: 'pro_upgrade', version: pkgVersion(), timestamp: new Date().toISOString() });
    return;
  }

  if (args.info) {
    printProInfo();
    process.exit(0);
  }

  const resolvedKey = resolveProKey();
  if (resolvedKey && resolvedKey.key) {
    return launchDashboard(resolvedKey.key, 'pro_dashboard_launch');
  }

  printProInfo();
  process.exit(0);
}

function summary() {
  const args = parseArgs(process.argv.slice(3));
  const { feedbackSummary } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  console.log(feedbackSummary(Number(args.recent || 20)));
}

function lessons() {
  trackEvent('cli_recall', { command: 'lessons' });
  const args = parseArgs(process.argv.slice(3));
  const { searchLessons, formatLessonSearchResults } = require(path.join(PKG_ROOT, 'scripts', 'lesson-search'));
  const tags = String(args.tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const query = args.query || process.argv.slice(3).find((arg) => !arg.startsWith('--')) || '';
  const result = searchLessons(query, {
    limit: Number(args.limit || 10),
    category: args.category,
    tags,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  process.stdout.write(formatLessonSearchResults(result));
}

function modelFit() {
  const { writeModelFitReport } = require(path.join(PKG_ROOT, 'scripts', 'local-model-profile'));
  const { reportPath, report } = writeModelFitReport();
  console.log(JSON.stringify({ reportPath, report }, null, 2));
}

function risk() {
  const args = parseArgs(process.argv.slice(3));
  const riskScorer = require(path.join(PKG_ROOT, 'scripts', 'risk-scorer'));

  if (args.context || args.tags || args.skill || args.domain || args['rubric-scores'] || args.guardrails) {
    const { inferDomain } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
    const { buildRubricEvaluation } = require(path.join(PKG_ROOT, 'scripts', 'rubric-engine'));
    const historyRows = riskScorer.readJSONL(riskScorer.sequencePathFor());
    const tags = String(args.tags || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    let rubric = null;
    if (args['rubric-scores'] || args.guardrails) {
      const evaluation = buildRubricEvaluation({
        rubricScores: args['rubric-scores'],
        guardrails: args.guardrails,
      });
      rubric = {
        rubricId: evaluation.rubricId,
        weightedScore: evaluation.weightedScore,
        failingCriteria: evaluation.failingCriteria,
        failingGuardrails: evaluation.failingGuardrails,
        judgeDisagreements: evaluation.judgeDisagreements,
      };
    }

    const candidate = riskScorer.buildRiskCandidate({
      context: args.context || '',
      tags,
      skill: args.skill || null,
      domain: args.domain || inferDomain(tags, args.context || ''),
      rubric,
      filePathCount: Number(args['file-count'] || 0),
      errorType: args['error-type'] || null,
    }, historyRows);
    const model = riskScorer.loadRiskModel() || riskScorer.trainAndPersistRiskModel().model;
    console.log(JSON.stringify({
      prediction: riskScorer.predictRisk(model, candidate),
      candidate,
    }, null, 2));
    return;
  }

  const { model, modelPath } = riskScorer.trainAndPersistRiskModel();
  console.log(JSON.stringify({
    modelPath,
    metrics: model.metrics,
    summary: riskScorer.getRiskSummary(),
  }, null, 2));
}

function exportDpo() {
  const { isProTier } = require(path.join(PKG_ROOT, 'scripts', 'rate-limiter'));
  if (!isProTier(null)) {
    process.stderr.write(
      `\n  🔒 DPO Export requires Pro (${PRO_PRICE_LABEL}).\n` +
      `     Your feedback would generate valuable training pairs.\n` +
      `     Upgrade: ${PRO_CHECKOUT_URL}\n\n`
    );
    process.exit(1);
  }
  const extraArgs = process.argv.slice(3).join(' ');
  try {
    const output = execSync(
      `node "${path.join(PKG_ROOT, 'scripts', 'export-dpo-pairs.js')}" --from-local ${extraArgs}`,
      { encoding: 'utf8', stdio: 'pipe', cwd: CWD }
    );
    process.stdout.write(output);
  } catch (err) {
    process.stderr.write(err.stderr || err.stdout || err.message);
    process.exit(err.status || 1);
  }
}

function exportDatabricks() {
  const { isProTier } = require(path.join(PKG_ROOT, 'scripts', 'rate-limiter'));
  if (!isProTier(null)) {
    process.stderr.write(
      `\n  🔒 Databricks Export requires Pro (${PRO_PRICE_LABEL}).\n` +
      `     Export feedback logs + proof artifacts for analytics.\n` +
      `     Upgrade: ${PRO_CHECKOUT_URL}\n\n`
    );
    process.exit(1);
  }
  const extraArgs = process.argv.slice(3).join(' ');
  try {
    const output = execSync(
      `node "${path.join(PKG_ROOT, 'scripts', 'export-databricks-bundle.js')}" ${extraArgs}`,
      { encoding: 'utf8', stdio: 'pipe', cwd: CWD }
    );
    process.stdout.write(output);
  } catch (err) {
    process.stderr.write(err.stderr || err.stdout || err.message);
    process.exit(err.status || 1);
  }
}

function obsidianExport() {
  const args = parseArgs(process.argv.slice(3));
  const { exportAll } = require(path.join(PKG_ROOT, 'scripts', 'obsidian-export'));
  const { getFeedbackPaths } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));

  const vaultPath = args['vault-path'] || process.env.THUMBGATE_OBSIDIAN_VAULT_PATH || '';
  const outputSubdir = args['output-dir'] || 'AI-Memories/thumbgate';
  let outputDir;
  if (vaultPath) {
    outputDir = path.join(vaultPath, outputSubdir);
  } else {
    outputDir = path.join(CWD, 'obsidian-export');
  }

  const { FEEDBACK_DIR } = getFeedbackPaths();
  const gatesConfigPath = path.join(PKG_ROOT, 'config', 'gates', 'default.json');

  const stats = exportAll({
    feedbackDir: FEEDBACK_DIR,
    outputDir,
    gatesConfigPath,
    includeIndex: true,
  });

  console.log(
    `Exported ${stats.feedback} feedback, ${stats.memories} memories, ` +
    `${stats.rules} rules, ${stats.gates} gates, ${stats.lessons} lessons`
  );
  if (stats.packs > 0) console.log(`  + ${stats.packs} context packs`);
  if (stats.errors.length > 0) {
    console.error(`  ${stats.errors.length} error(s) during export`);
  }
  console.log(`Output: ${outputDir}`);
  process.exit(stats.errors.length > 0 ? 1 : 0);
}

function rules() {
  const args = parseArgs(process.argv.slice(3));
  const { writePreventionRules } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const outPath = args.output || path.join(CWD, '.thumbgate', 'prevention-rules.md');
  const result = writePreventionRules(outPath, Number(args.min || 2));
  console.log(`Wrote prevention rules to ${result.path}`);
}

function selfHeal() {
  try {
    const output = execSync(
      `node "${path.join(PKG_ROOT, 'scripts', 'self-healing-check.js')}" && node "${path.join(PKG_ROOT, 'scripts', 'self-heal.js')}"`,
      { encoding: 'utf8', stdio: 'inherit', cwd: CWD }
    );
  } catch (err) {
    process.exit(err.status || 1);
  }
}

function prove() {
  const args = parseArgs(process.argv.slice(3));
  const target = args.target || 'adapters';
  const script = path.join(PKG_ROOT, 'scripts', `prove-${target}.js`);
  if (!fs.existsSync(script)) {
    console.error(`Unknown proof target: ${target}`);
    console.error('Available: adapters, automation, attribution, lancedb, data-quality, intelligence, local-intelligence, loop-closure, training-export');
    process.exit(1);
  }
  try {
    execSync(`node "${script}"`, { encoding: 'utf8', stdio: 'inherit', cwd: CWD });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

function watchCmd() {
  const args = parseArgs(process.argv.slice(3));
  const { watch, once } = require(path.join(PKG_ROOT, 'scripts', 'jsonl-watcher'));
  const sourceFilter = args.source || undefined;
  if (args.once) {
    once(sourceFilter);
  } else {
    watch(sourceFilter);
  }
}

function status() {
  const statusDashboard = require(path.join(PKG_ROOT, 'scripts', 'status-dashboard'));
  const { getFeedbackPaths } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const data = statusDashboard.generateStatus(FEEDBACK_DIR);
  // printDashboard writes directly to stdout when run as main;
  // for CLI we call the same renderer
  statusDashboard.printDashboard
    ? statusDashboard.printDashboard(data)
    : console.log(JSON.stringify(data, null, 2));
}

function funnel() {
  const { generateFunnelReport } = require(path.join(PKG_ROOT, 'scripts', 'funnel-analytics'));
  generateFunnelReport();
}

function pulse() {
  const { showPulse } = require(path.join(PKG_ROOT, 'scripts', 'pulse'));
  showPulse().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }).then(() => {
    process.exit(0);
  });
}

function dispatchBrief() {
  const args = parseArgs(process.argv.slice(3));
  const {
    getDispatchBrief,
    formatDispatchBrief,
  } = require(path.join(PKG_ROOT, 'scripts', 'dispatch-brief'));

  getDispatchBrief({
    window: args.window,
    timeZone: args.timezone,
    now: args.now,
    profile: args.profile || 'dispatch',
  })
    .then((brief) => {
      if (args.json) {
        console.log(JSON.stringify(brief, null, 2));
      } else {
        process.stdout.write(formatDispatchBrief(brief));
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });
}

function gateStats() {
  const { calculateStats, formatStats } = require(path.join(PKG_ROOT, 'scripts', 'gate-stats'));
  const stats = calculateStats();
  console.log('\n' + formatStats(stats) + '\n');
}

function optimize() {
  const { optimize: doOptimize } = require(path.join(PKG_ROOT, 'scripts', 'optimize-context'));
  doOptimize();
}

function serve() {
  // Start MCP server over stdio
  const mcpServer = path.join(PKG_ROOT, 'adapters', 'mcp', 'server-stdio.js');
  const { startStdioServer } = require(mcpServer);
  startStdioServer();
  // Start watcher as a background daemon alongside MCP server
  try {
    const { watch } = require(path.join(PKG_ROOT, 'scripts', 'jsonl-watcher'));
    watch();
  } catch (_) { /* watcher is non-critical */ }
}

function install() {
  console.log('Installing ThumbGate as a global MCP skill...');
  const results = [
    setupClaude(),
    setupCodex(),
    setupGemini(),
    setupCursor(),
    setupAmp(),
    setupForge()
  ];
  const success = results.some(r => r === true);
  if (success) {
    console.log('\nSuccess! ThumbGate is now available to your agents.');
    console.log('Try asking your agent: "Capture positive feedback for this task"');
  } else {
    console.log('\nThumbGate is already configured.');
  }
}

async function gateCheck() {
  const payload = readStdinText();
  const input = payload ? JSON.parse(payload) : {};
  const gatesEngine = require(path.join(PKG_ROOT, 'scripts', 'gates-engine'));
  const output = await gatesEngine.runAsync(input);
  process.stdout.write(output + '\n');
}

function cacheUpdate() {
  syncActiveProjectContext();
  const payload = readStdinText();
  const { updateCacheFromEvent } = require(path.join(PKG_ROOT, 'scripts', 'hook-thumbgate-cache-updater'));
  updateCacheFromEvent(payload ? JSON.parse(payload) : {});
}

function statuslineRender() {
  syncActiveProjectContext();
  try {
    const { syncClaudeHistoryFeedback } = require(path.join(PKG_ROOT, 'scripts', 'claude-feedback-sync'));
    syncClaudeHistoryFeedback();
  } catch (_) { /* best-effort fallback sync */ }
  const payload = readStdinText();
  const output = execFileSync('bash', [path.join(PKG_ROOT, 'scripts', 'statusline.sh')], {
    encoding: 'utf8',
    input: payload,
    env: process.env,
  });
  process.stdout.write(output);
}

function hookAutoCapture() {
  syncActiveProjectContext();
  const prompt = process.env.CLAUDE_USER_PROMPT || process.env.THUMBGATE_USER_PROMPT || readStdinText().trim();
  const { evaluatePromptGuard } = require(path.join(PKG_ROOT, 'scripts', 'prompt-guard'));
  const { processInlineFeedback, formatCliOutput } = require(path.join(PKG_ROOT, 'scripts', 'cli-feedback'));
  const { recordConversationEntry, readRecentConversationWindow } = require(path.join(PKG_ROOT, 'scripts', 'feedback-history-distiller'));

  recordConversationEntry({
    author: 'user',
    text: prompt,
    source: 'claude_user_prompt',
  });

  const guardResult = evaluatePromptGuard(prompt);
  if (guardResult) {
    process.stdout.write(`${JSON.stringify(guardResult)}\n`);
    return;
  }

  const lower = prompt.toLowerCase();
  const isUp = /(thumbs?\s*up|that worked|looks good|nice work|perfect|good job)/i.test(lower);
  const isDown = /(thumbs?\s*down|that failed|that was wrong|fix this)/i.test(lower);
  if (!isUp && !isDown) {
    return;
  }

  const signal = isDown ? 'down' : 'up';
  const conversationWindow = readRecentConversationWindow({ limit: 8 });
  const result = processInlineFeedback({
    signal,
    context: prompt,
    chatHistory: signal === 'down'
      ? conversationWindow.map((entry) => ({ role: entry.author === 'assistant' ? 'assistant' : 'user', content: entry.text || '' }))
      : undefined,
    whatWentWrong: signal === 'down' ? prompt : undefined,
    whatWorked: signal === 'up' ? prompt : undefined,
  });
  process.stdout.write(formatCliOutput(result) + '\n');
}

function sessionStart() {
  syncActiveProjectContext();
  try {
    const { syncClaudeHistoryFeedback } = require(path.join(PKG_ROOT, 'scripts', 'claude-feedback-sync'));
    syncClaudeHistoryFeedback();
  } catch (_) { /* best-effort fallback sync */ }
  const { analyzeFeedback } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const { refreshStatuslineCache } = require(path.join(PKG_ROOT, 'scripts', 'hook-thumbgate-cache-updater'));
  refreshStatuslineCache(analyzeFeedback());

  // Surface gate-program.md active rules so the agent starts aware of what is blocked.
  try {
    const { readGateProgram, extractBlockPatterns } = require(path.join(PKG_ROOT, 'scripts', 'meta-agent-loop'));
    const gateProgram = readGateProgram();
    if (gateProgram) {
      const blockPatterns = extractBlockPatterns(gateProgram);
      if (blockPatterns.length > 0) {
        process.stderr.write('\n[ThumbGate] Active hard-block rules from gate-program.md:\n');
        blockPatterns.forEach((p, i) => process.stderr.write(`  ${i + 1}. ${p}\n`));
        process.stderr.write('\n');
      }
    }
  } catch (_) { /* gate-program awareness is best-effort */ }
}

function installMcp() {
  const { installMcp: doInstall, parseFlags } = require(path.join(PKG_ROOT, 'scripts', 'install-mcp'));
  const flags = parseFlags(process.argv.slice(3));
  doInstall(flags);
}

function dashboard() {
  const args = parseArgs(process.argv.slice(3));
  const { printDashboard } = require(path.join(PKG_ROOT, 'scripts', 'dashboard'));
  const { getOperationalDashboard } = require(path.join(PKG_ROOT, 'scripts', 'operational-dashboard'));

  getOperationalDashboard({
    window: args.window,
    timeZone: args.timezone,
    now: args.now,
  })
    .then(({ data }) => {
      printDashboard(data);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });
}

function gateStats() {
  const { calculateStats, formatStats } = require(path.join(PKG_ROOT, 'scripts', 'gate-stats'));
  const stats = calculateStats();
  console.log('\n' + formatStats(stats) + '\n');
}

function startApi() {
  const serverPath = path.join(PKG_ROOT, 'src', 'api', 'server.js');
  try {
    execSync(`node "${serverPath}"`, { stdio: 'inherit', cwd: CWD });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

function help() {
  const v = pkgVersion();
  console.log(`thumbgate v${v}`);
  console.log('');
  console.log('Commands:');
  console.log('  init                  Scaffold .thumbgate/ config + MCP server in current project');
  console.log('    --agent=NAME        Wire PreToolUse hooks for agent (claude-code|codex|gemini|forge)');
  console.log('    --wire-hooks        Wire hooks only (auto-detect agent, skip scaffolding)');
  console.log('    --dry-run           Preview hook changes without writing');
  console.log('  install-mcp           Install ThumbGate MCP server into Claude Code settings (--project for local)');
  console.log('  serve                 Start MCP server (stdio) — for claude/codex/gemini/forge mcp add');
  console.log('  gate-check            Internal: evaluate a PreToolUse payload from stdin');
  console.log('  cache-update          Internal: refresh the Claude statusline cache from stdin');
  console.log('  statusline-render     Internal: render the ThumbGate Claude status line');
  console.log('  hook-auto-capture     Internal: process Claude UserPromptSubmit feedback');
  console.log('  session-start         Internal: refresh local ThumbGate session cache');
  console.log('  capture [flags]       Capture feedback (--feedback=up|down --context="..." --tags="...")');
  console.log('  stats                 Show feedback analytics + Revenue-at-Risk');
  console.log('  cfo                   Show hosted billing summary when configured, else local fallback JSON');
  console.log('  repair-github-marketplace  Dry-run or apply legacy GitHub Marketplace amount repairs (--write)');
  console.log('  north-star            Show proof-backed workflow-run progress toward the North Star');
  console.log('  summary               Human-readable feedback summary');
  console.log('  lessons [flags]       Search promoted lessons and show linked corrective actions');
  console.log('  model-fit             Detect the current local embedding profile and write evidence report');
  console.log('  risk [flags]          Train or query the boosted local risk scorer');
  console.log('  doctor                Audit runtime isolation, bootstrap context, and permission tier');
  console.log('  dispatch              Print a Dispatch-safe remote ops brief for phone-driven review sessions');
  console.log('  export-dpo            Export DPO training pairs (prompt/chosen/rejected JSONL)');
  console.log('  export-databricks     Export feedback logs + proof artifacts as a Databricks-ready analytics bundle');
  console.log('  obsidian-export       Export all feedback data as interlinked Obsidian markdown notes');
  console.log('    --vault-path=PATH   Obsidian vault path (or set THUMBGATE_OBSIDIAN_VAULT_PATH)');
  console.log('    --output-dir=DIR    Output subdirectory (default: AI-Memories/thumbgate)');
  console.log('  rules                 Generate prevention rules from repeated failures');
  console.log('  optimize              [PRO] Prune CLAUDE.md and migrate manual rules to Pre-Action Gates');
  console.log('  force-gate <PATTERN>  Immediately create a blocking gate from a pattern');
  console.log('  meta-agent            Run meta-agent loop: generate + evaluate + promote prevention rules');
  console.log('    --dry-run           Preview rules without writing');
  console.log('    --status            Show last run summary');
  console.log('  self-heal             Run self-healing check and auto-fix');
  console.log('  activate <KEY>        Activate a Pro license key (from Stripe checkout)');
  console.log('  pro                   Show Pro plan ($19/mo) + hosted pilot info');
  console.log('    --upgrade           Install Pro configs into .thumbgate/');
  console.log('  prove [--target=X]    Run proof harness (adapters|automation|attribution|lancedb|local-intelligence|...)');
  console.log('  watch [flags]           Watch .thumbgate/ for external signals and ingest through pipeline (--once, --source=X)');
  console.log('  status                  Show feedback tracking dashboard — approval trend + failure domains');
  console.log('  dashboard               Full ThumbGate dashboard — approval rate, gate stats, prevention impact');
  console.log('  funnel                  Show marketing & revenue conversion funnel analytics');
  console.log('  pulse                   Show real-time GTM velocity and Mission Control summary');
  console.log('  dispatch                Dispatch-safe brief — metrics, gates, and read-only prompt templates');
  console.log('  gate-check              PreToolUse hook: reads tool JSON from stdin, outputs gate verdict');
  console.log('  gate-stats              Show gate statistics — active gates, blocks, warns, time saved');
  console.log('  analytics               Unified ThumbGate analytics snapshot (npm, GitHub, landing page)');
  console.log('  start-api             Start the ThumbGate HTTPS API server');
  console.log('  help                  Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npx thumbgate init');
  console.log('  npx thumbgate stats');
  console.log('  npx thumbgate cfo');
  console.log('  npx thumbgate repair-github-marketplace --write');
  console.log('  npx thumbgate lessons --query="verification" --limit=5');
  console.log('  npx thumbgate model-fit');
  console.log('  npx thumbgate risk');
  console.log('  npx thumbgate pro');
  proNudge();
}

if (COMMAND === 'daemon' || COMMAND === 'serve-daemon') {
  const subCmd = process.argv[3] || 'status';
  const { manageDaemon } = require(path.join(PKG_ROOT, 'scripts', 'daemon-manager'));
  manageDaemon(subCmd);
  process.exit(0);
}

switch (COMMAND) {
  case 'init':
    init();
    upgradeNudge();
    break;
  case 'install':
    install();
    break;
  case 'install-mcp':
    installMcp();
    break;
  case 'serve':
  case 'mcp':
    serve();
    break;
  case 'gate-check':
    gateCheck().catch((err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });
    break;
  case 'cache-update':
    cacheUpdate();
    break;
  case 'statusline-render':
    statuslineRender();
    break;
  case 'hook-auto-capture':
    hookAutoCapture();
    break;
  case 'session-start':
    sessionStart();
    break;
  case 'capture':
  case 'feedback':
    capture();
    upgradeNudge();
    break;
  case 'stats':
    stats();
    upgradeNudge();
    break;
  case 'cfo':
  case 'revenue':
    cfo();
    break;
  case 'repair-github-marketplace':
    repairGithubMarketplace();
    break;
  case 'north-star':
    northStar();
    break;
  case 'summary':
    summary();
    break;
  case 'lessons':
  case 'search-lessons':
    lessons();
    break;
  case 'lesson-health':
  case 'stale': {
    const { initDB } = require(path.join(PKG_ROOT, 'scripts', 'lesson-db'));
    const { stalenessReport, autoArchive } = require(path.join(PKG_ROOT, 'scripts', 'lesson-rotation'));
    const staleArgs = parseArgs(process.argv.slice(3));
    const db = initDB();
    if (staleArgs.archive) {
      const result = autoArchive(db);
      console.log(`\n✅ Auto-archived ${result.archived} stale lessons (>90 days inactive)\n`);
    } else {
      const report = stalenessReport(db);
      console.log(`\nLesson Health Report`);
      console.log('─'.repeat(50));
      console.log(`  Total active : ${report.total}`);
      console.log(`  Healthy      : ${report.healthy}`);
      console.log(`  Stale (>60d) : ${report.stale.length}`);
      console.log(`  Archivable   : ${report.archivable.length}`);
      if (report.stale.length > 0) {
        console.log(`\n  Stale lessons:`);
        for (const l of report.stale.slice(0, 10)) {
          console.log(`    ${l.id.slice(0, 8)}... ${l.daysSinceActive}d inactive, ${l.triggerCount} triggers — ${l.context}`);
        }
        if (report.stale.length > 10) console.log(`    ... and ${report.stale.length - 10} more`);
      }
      if (report.archivable.length > 0) {
        console.log(`\n  Run with --archive to auto-archive ${report.archivable.length} lessons >90 days inactive.`);
      }
      console.log('');
    }
    db.close();
    break;
  }
  case 'lesson-review': {
    const { isProTier: isProForReview } = require(path.join(PKG_ROOT, 'scripts', 'rate-limiter'));
    if (!isProForReview(null)) {
      process.stderr.write(`\n  🔒 Lesson Review requires Pro (${PRO_PRICE_LABEL}).\n` +
        `     Review stale lessons and decide what to keep, archive, or promote.\n` +
        `     Upgrade: ${PRO_CHECKOUT_URL}\n\n`);
      process.exit(1);
    }
    const { initDB: initDBReview } = require(path.join(PKG_ROOT, 'scripts', 'lesson-db'));
    const { findStaleLessons, restoreLesson, autoArchive: autoArchiveReview } = require(path.join(PKG_ROOT, 'scripts', 'lesson-rotation'));
    const reviewDb = initDBReview();
    const stale = findStaleLessons(reviewDb);
    if (stale.length === 0) {
      console.log('\n✅ No stale lessons. All lessons are active and healthy.\n');
    } else {
      console.log(`\n📋 Lesson Review — ${stale.length} stale lessons\n`);
      for (const l of stale) {
        const ageDays = Math.round((Date.now() - new Date(l.last_triggered || l.timestamp).getTime()) / 86400000);
        console.log(`  [${l.importance || 'medium'}] ${l.id.slice(0, 12)}  ${ageDays}d inactive`);
        console.log(`    ${(l.context || l.whatToChange || '').slice(0, 100)}`);
        console.log('');
      }
      console.log(`  Run "npx thumbgate stale --archive" to archive all ${stale.length} stale lessons.\n`);
    }
    reviewDb.close();
    break;
  }
  case 'model-fit':
    modelFit();
    break;
  case 'risk':
    risk();
    break;
  case 'doctor': {
    const {
      generateAgentReadinessReport,
      reportToText,
    } = require(path.join(PKG_ROOT, 'scripts', 'agent-readiness'));
    const args = parseArgs(process.argv.slice(3));
    const report = generateAgentReadinessReport({ projectRoot: CWD });
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      process.stdout.write(reportToText(report));
    }
    process.exit(report.overallStatus === 'ready' ? 0 : 1);
    break;
  }
  case 'export-dpo':
  case 'dpo':
    exportDpo();
    break;
  case 'export-databricks':
  case 'databricks':
    exportDatabricks();
    break;
  case 'obsidian-export':
    obsidianExport();
    break;
  case 'rules':
    rules();
    break;
  case 'optimize':
    optimize();
    break;
  case 'force-gate': {
    const context = process.argv.slice(3).find(a => !a.startsWith('--'));
    if (!context) {
      console.error('Error: context string is required for force-gate');
      process.exit(1);
    }
    const { forcePromote } = require('../scripts/auto-promote-gates');
    const result = forcePromote(context, 'block');
    console.log(`✅ Forced block gate created: ${result.gateId}`);
    console.log(`Total auto-promoted gates: ${result.totalGates}`);
    break;
  }
  case 'meta-agent': {
    const metaArgs = parseArgs(process.argv.slice(3));
    if (metaArgs.status) {
      const { getMetaAgentStatus } = require(path.join(PKG_ROOT, 'scripts', 'meta-agent-loop'));
      const status = getMetaAgentStatus();
      if (!status) {
        console.log('No meta-agent runs recorded yet. Run: npx thumbgate meta-agent');
      } else {
        console.log(JSON.stringify(status, null, 2));
      }
    } else {
      const { runMetaAgentLoop } = require(path.join(PKG_ROOT, 'scripts', 'meta-agent-loop'));
      runMetaAgentLoop({ dryRun: Boolean(metaArgs['dry-run']), verbose: true })
        .then((manifest) => {
          console.log(`\nMeta-agent run complete.`);
          console.log(`  Promoted : ${manifest.promotedCount} rule(s)`);
          console.log(`  Reverted : ${manifest.revertedCount} candidate(s)`);
          if (manifest.dryRun) console.log('  [DRY RUN] No rules written.');
        })
        .catch((err) => {
          console.error('Meta-agent failed:', err.message);
          process.exit(1);
        });
    }
    break;
  }
  case 'self-heal':
    selfHeal();
    break;
  case 'pro':
    pro();
    break;
  case 'activate':
    // Top-level alias: npx thumbgate activate <key>
    process.argv.splice(3, 0, '--activate');
    pro();
    break;
  case 'prove':
    prove();
    break;
  case 'watch':
    watchCmd();
    break;
  case 'status':
    status();
    break;
  case 'funnel':
    funnel();
    break;
  case 'pulse':
    pulse();
    break;
  case 'dispatch':
  case 'dispatch-brief':
    dispatchBrief();
    break;
  case 'gate-check': {
    // PreToolUse hook interface: reads tool call JSON from stdin, outputs gate verdict
    // Used by: generate-pretool-hook.sh → npx thumbgate gate-check
    const { run: gateRun, runAsync: gateRunAsync } = require(path.join(PKG_ROOT, 'scripts', 'gates-engine'));
    let stdinData = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { stdinData += chunk; });
    process.stdin.on('end', async () => {
      try {
        const input = JSON.parse(stdinData);
        const output = await gateRunAsync(input);
        process.stdout.write(output + '\n');
        process.exit(0);
      } catch (err) {
        process.stderr.write(`gate-check error: ${err.message}\n`);
        process.stdout.write(JSON.stringify({}) + '\n');
        process.exit(0);
      }
    });
    break;
  }
  case 'gate-stats':
    gateStats();
    break;
  case 'dashboard':
    dashboard();
    break;
  case 'analytics': {
    const { run: runAnalytics } = require(path.join(PKG_ROOT, 'scripts', 'analytics-report'));
    runAnalytics();
    break;
  }
  case 'start-api':
    startApi();
    break;
  case 'help':
  case '--help':
  case '-h':
    help();
    break;
  case 'compact':
    compact();
    break;
  case 'checkin': {
    // User check-in command — asks how it's going after install
    const thumbgateDir = path.join(CWD, '.thumbgate');
    const configPath = path.join(thumbgateDir, 'config.json');
    let installAge = 'unknown';
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.installedAt) {
          const days = Math.floor((Date.now() - new Date(config.installedAt).getTime()) / 86400000);
          installAge = `${days} day${days !== 1 ? 's' : ''}`;
        }
      } catch { /* ignore */ }
    }
    console.log(`\n🔔 thumbgate check-in (installed ${installAge} ago)\n`);
    console.log('Quick questions to help improve this tool:\n');
    console.log('1. Is the gate engine catching real mistakes for you? (y/n/haven\'t tried)');
    console.log('2. What failure pattern do you wish it caught but doesn\'t?');
    console.log('3. Anything confusing or broken?\n');
    console.log('Reply to any of these at: https://github.com/IgorGanapolsky/ThumbGate/discussions');
    console.log('Or email: iganapolsky@gmail.com\n');

    // Log the check-in event
    const checkinLog = path.join(thumbgateDir, 'checkin-log.jsonl');
    if (fs.existsSync(thumbgateDir)) {
      const event = { event: 'checkin_shown', at: new Date().toISOString(), installAge };
      fs.appendFileSync(checkinLog, JSON.stringify(event) + '\n');
    }
    break;
  }
  default:
    if (COMMAND) {
      console.error(`Unknown command: ${COMMAND}`);
      console.error('Run: npx thumbgate help');
      process.exit(1);
    } else {
      help();
    }
}
