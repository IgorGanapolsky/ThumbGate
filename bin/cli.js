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
 *   npx thumbgate import-doc    # import a local policy/runbook document and propose gates
 *   npx thumbgate export-dpo    # export DPO training pairs
 *   npx thumbgate export-databricks   # export Databricks-ready analytics bundle
 *   npx thumbgate eval --from-feedback # turn feedback into reusable prompt evals
 *   npx thumbgate code-graph-guardrails # map code-graph signals to pre-action checks
 *   npx thumbgate proxy-pointer-rag-guardrails # map visual document RAG signals to gates
 *   npx thumbgate rag-precision-guardrails # map retrieval tuning regressions to gates
 *   npx thumbgate long-running-agent-context-guardrails # map structured-memory gaps to gates
 *   npx thumbgate reasoning-efficiency-guardrails # map reasoning compression signals to gates
 *   npx thumbgate deepseek-v4-runtime-guardrails # map sparse-attention runtime signals to gates
 *   npx thumbgate upstream-contributions # rank upstream repo issues for trust-building PRs
 *   npx thumbgate stats         # feedback analytics + Revenue-at-Risk
 *   npx thumbgate background-governance  # background-agent run report + risk check
 *   npx thumbgate cfo           # local operational billing summary
 *   npx thumbgate pro           # solo dashboard + exports side lane
 *   npx thumbgate diagnostic    # team workflow diagnostic intake + checkout path
 *   npx thumbgate audit <file>  # audit an agent transcript for repeat-mistake token waste
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { execSync, execFileSync, execFile, spawn } = require('child_process');
const {
  codexAutoUpdateCliEntry,
  codexAutoUpdateMcpEntry,
  isSourceCheckout,
  localMcpEntry,
  resolveMcpEntry,
} = require(path.join(__dirname, '..', 'scripts', 'mcp-config'));
const { trackEvent } = require(path.join(__dirname, '..', 'scripts', 'cli-telemetry'));
const {
  PRO_MONTHLY_PAYMENT_LINK,
  PRO_PRICE_LABEL,
} = require(path.join(__dirname, '..', 'scripts', 'commercial-offer'));

const COMMAND = process.argv[2];
const CWD = process.cwd();
const PKG_ROOT = path.join(__dirname, '..');

const PRO_URL = 'https://thumbgate.ai';
const PRO_CHECKOUT_URL = PRO_MONTHLY_PAYMENT_LINK;
// Mirrors scripts/rate-limiter.js TRIAL_DAYS — must stay in sync. Gitar
// caught a 14-vs-7 mismatch on PR #2337 (banner said "7-day trial" but
// the date label was computed 14 days out).
const TRIAL_DAYS = 7;

function checkoutUrlFor(source, content) {
  try {
    const base = content === 'capture_feedback'
      ? 'https://buy.stripe.com/7sYfZhaiE1eSbO99uj3sI0d'
      : PRO_CHECKOUT_URL;
    const url = new URL(base);
    url.searchParams.set('utm_source', source || 'cli');
    url.searchParams.set('utm_medium', 'cli');
    url.searchParams.set('utm_campaign', 'pro_conversion');
    if (content) url.searchParams.set('utm_content', content);
    return url.toString();
  } catch (_) {
    return content === 'capture_feedback'
      ? 'https://buy.stripe.com/7sYfZhaiE1eSbO99uj3sI0d'
      : PRO_CHECKOUT_URL;
  }
}

function pricingUrlFor(source, content) {
  try {
    const url = new URL('/pricing', PRO_URL);
    url.searchParams.set('utm_source', source || 'cli');
    url.searchParams.set('utm_medium', 'cli');
    url.searchParams.set('utm_campaign', 'pro_education');
    if (content) url.searchParams.set('utm_content', content);
    return url.toString();
  } catch (_) {
    return `${PRO_URL}/pricing`;
  }
}

function diagnosticUrlFor(source, content) {
  try {
    const url = new URL('/diagnostic', PRO_URL);
    url.searchParams.set('utm_source', source || 'cli');
    url.searchParams.set('utm_medium', 'cli');
    url.searchParams.set('utm_campaign', 'workflow_hardening_diagnostic');
    if (content) url.searchParams.set('utm_content', content);
    return url.toString();
  } catch (_) {
    return `${PRO_URL}/diagnostic`;
  }
}

function diagnosticCheckoutUrlFor(source, content) {
  try {
    const url = new URL('/go/diagnostic', PRO_URL);
    url.searchParams.set('utm_source', source || 'cli');
    url.searchParams.set('utm_medium', 'cli');
    url.searchParams.set('utm_campaign', 'workflow_hardening_diagnostic');
    if (content) url.searchParams.set('utm_content', content);
    return url.toString();
  } catch (_) {
    return `${PRO_URL}/go/diagnostic`;
  }
}

function trialDeadlineLabel(now = new Date()) {
  const deadline = new Date(now.getTime() + (TRIAL_DAYS * 24 * 60 * 60 * 1000));
  return deadline.toISOString().slice(0, 10);
}

function upgradeNudge() {
  if (process.env.THUMBGATE_NO_NUDGE === '1') return;
  try {
    const { isProTier } = require(path.join(PKG_ROOT, 'scripts', 'rate-limiter'));
    if (isProTier()) return;
  } catch (_) { return; }
  const pricingUrl = pricingUrlFor('cli_upgrade_nudge', COMMAND || 'general');
  const diagnosticUrl = diagnosticUrlFor('cli_upgrade_nudge', COMMAND || 'general');
  process.stderr.write(
    '\n  Enterprise entry: $499 Enterprise Workflow Gate for one workflow\n' +
    `  ${diagnosticUrl}\n` +
    `\n  Solo side lane: Pro — ${PRO_PRICE_LABEL}\n` +
    '  Removes solo caps; adds personal recall, dashboard proof, exports, and managed adapters.\n' +
    `  ${pricingUrl}\n\n`
  );
}

function diagnostic() {
  const intakeUrl = diagnosticUrlFor('cli_diagnostic', COMMAND || 'diagnostic');
  const checkoutUrl = diagnosticCheckoutUrlFor('cli_diagnostic', COMMAND || 'diagnostic');
  console.log('');
  console.log('  ThumbGate Enterprise Workflow Gate — $499');
  console.log('  ------------------------------------------');
  console.log('  Use this when one repeated AI-agent workflow failure is already costing');
  console.log('  review time, release confidence, customer trust, or money.');
  console.log('');
  console.log('  Best fit: one workflow, one repeated failure, one owner who can review proof.');
  console.log('  Output: failure taxonomy, block/warn/human-review split, and proof checklist.');
  console.log('');
  console.log('  Start with intake:');
  console.log(`  ${intakeUrl}`);
  console.log('');
  console.log('  Ready to pay now:');
  console.log(`  ${checkoutUrl}`);
  console.log('');
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
  const apiUrl = process.env.THUMBGATE_API_URL || 'https://thumbgate.ai';
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
  try {
    const { isProTier } = require(path.join(PKG_ROOT, 'scripts', 'rate-limiter'));
    if (isProTier()) return;
  } catch (_) { /* if rate-limiter is unavailable, fall through and nudge */ }
  const checkoutUrl = checkoutUrlFor('cli_nudge', context || COMMAND || 'general');
  const pricingUrl = pricingUrlFor('cli_nudge', context || COMMAND || 'general');
  const messages = [
    `\n  💡 Pro (${PRO_PRICE_LABEL}): personal recall, dashboard proof, exports, and managed adapters.\n     See pricing: ${pricingUrl}\n`,
    `\n  💡 You just taught ThumbGate something locally. Pro keeps personal lessons searchable and exportable without free-tier caps.\n     See pricing: ${pricingUrl}\n`,
    `\n  💡 ThumbGate Pro maintains adapter coverage across Claude, Codex, Cursor, containers, and CI. ${PRO_PRICE_LABEL}.\n     Start Pro: ${checkoutUrl}\n`,
  ];
  // Rotate message daily — no Math.random (security policy)
  const msg = messages[Math.floor(Date.now() / 86400000) % messages.length];
  process.stderr.write(msg);
}

function limitNudge(action, limitResult = {}) {
  if (process.env.THUMBGATE_NO_NUDGE === '1') return;
  const checkoutUrl = checkoutUrlFor('cli_limit', action);
  const usageLine = Number.isFinite(limitResult.used) && Number.isFinite(limitResult.limit)
    ? `     Usage: ${limitResult.used}/${limitResult.limit} (${limitResult.limitType || 'limit'}).\n`
    : '';
  const reason = limitResult.message
    ? String(limitResult.message).split('\n')[0]
    : 'Free tier limit reached.';
  process.stderr.write(
    `\n  🔒 ${reason}\n` +
    usageLine +
    `     Upgrade to Pro (${PRO_PRICE_LABEL}) to continue ${action.replace(/_/g, ' ')}:\n` +
    `     ${checkoutUrl}\n\n`
  );
}

function printInitConversionPrompt(email) {
  if (process.env.THUMBGATE_NO_NUDGE === '1') return;
  const checkoutUrl = checkoutUrlFor('cli_init', email ? 'init_email' : 'init_no_email');
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────────┐');
  console.log(`  │  7-day Pro trial active through ${trialDeadlineLabel()}.               │`);
  console.log('  │  Pro keeps lessons/rules/dashboard synced everywhere.   │');
  console.log('  │  Add onboarding: npx thumbgate init --email you@company.com │');
  console.log(`  │  Upgrade: ${checkoutUrl}`);
  console.log('  └──────────────────────────────────────────────────────────┘');
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

function probeDash(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: 750 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitDash(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeDash(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function ensureDash(port) {
  if (await probeDash(port)) {
    return { started: false, pid: null };
  }

  const serverPath = path.join(PKG_ROOT, 'src', 'api', 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    cwd: PKG_ROOT,
    detached: true,
    env: { ...process.env, PORT: String(port), THUMBGATE_ALLOW_INSECURE: process.env.THUMBGATE_ALLOW_INSECURE || 'true' },
    stdio: 'ignore',
  });
  child.unref();

  if (!(await waitDash(port))) {
    throw new Error('Dashboard API timeout');
  }

  return { started: true, pid: child.pid };
}

function openBrowser(url) {
  if (process.env.THUMBGATE_DASHBOARD_NO_OPEN === '1') {
    console.log(`Ready: ${url}`);
    return Promise.resolve();
  }
  const [command, args] = ({ darwin: ['open', [url]], win32: ['cmd', ['/c', 'start', '', url]] }[process.platform] || ['xdg-open', [url]]);
  return new Promise((resolve, reject) => {
    execFile(command, args, (err) => (err ? reject(err) : resolve()));
  });
}

function parseTtlMs(value, fallbackMs = 5 * 60 * 1000) {
  if (value === undefined || value === null || value === true || value === '') return fallbackMs;
  const raw = String(value).trim().toLowerCase();
  const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallbackMs;
  const unit = match[2] || 'ms';
  const factor = unit === 'h' ? 60 * 60 * 1000
    : unit === 'm' ? 60 * 1000
      : unit === 's' ? 1000
        : 1;
  return Math.round(amount * factor);
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
// Legacy aliases are cleanup-only. Do not use them as active product or launch surfaces.
const LEGACY_MCP_SERVER_NAMES = ['mcp-memory-gateway', 'rlhf'];
const MCP_SERVER_NAMES = [MCP_SERVER_NAME, ...LEGACY_MCP_SERVER_NAMES];

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

function canonicalCodexMcpEntry() {
  // Codex config is user-global and must survive disposable worktree cleanup.
  // Use the stable published launcher even when init is invoked from source;
  // developers can explicitly opt into a checkout-pinned runtime when needed.
  if (isSourceCheckout(PKG_ROOT) && process.env.THUMBGATE_CODEX_USE_SOURCE_RUNTIME === '1') {
    return localMcpEntry(PKG_ROOT, 'home');
  }
  return codexAutoUpdateMcpEntry();
}

function canonicalCodexCliEntry(commandArgs) {
  if (isSourceCheckout(PKG_ROOT) && process.env.THUMBGATE_CODEX_USE_SOURCE_RUNTIME === '1') {
    return {
      command: 'node',
      args: [path.join(PKG_ROOT, 'bin', 'cli.js'), ...commandArgs],
    };
  }
  return codexAutoUpdateCliEntry(commandArgs);
}

function mcpSectionBlock(name = MCP_SERVER_NAME, scope = 'project') {
  const entry = canonicalMcpEntry(scope);
  return `[mcp_servers.${name}]\ncommand = "${entry.command}"\nargs = ${formatTomlStringArray(entry.args)}\n`;
}

function codexMcpSectionBlock(name = MCP_SERVER_NAME) {
  const entry = canonicalCodexMcpEntry();
  return `[mcp_servers.${name}]\ncommand = "${entry.command}"\nargs = ${formatTomlStringArray(entry.args)}\n`;
}

function codexPreToolHookSectionBlock() {
  const entry = canonicalCodexCliEntry(['gate-check']);
  return `[hooks.pre_tool_use]\ncommand = "${entry.command}"\nargs = ${formatTomlStringArray(entry.args)}\n`;
}

function codexUserPromptHookSectionBlock() {
  const entry = canonicalCodexCliEntry(['hook-auto-capture']);
  return `[hooks.user_prompt_submit]\ncommand = "${entry.command}"\nargs = ${formatTomlStringArray(entry.args)}\n`;
}

function mcpSectionRegex(name) {
  return new RegExp(
    `^\\[mcp_servers\\.${escapeRegExp(name)}\\]\\n(?:^(?!\\[).*(?:\\n|$))*`,
    'm'
  );
}

function tomlSectionRegex(name) {
  return new RegExp(
    `^\\[${escapeRegExp(name)}\\]\\n(?:^(?!\\[).*(?:\\n|$))*`,
    'm'
  );
}

function upsertCodexServerConfig(content) {
  const canonicalBlock = codexMcpSectionBlock(MCP_SERVER_NAME);
  const canonicalHookBlock = codexPreToolHookSectionBlock();
  const canonicalUserPromptHookBlock = codexUserPromptHookSectionBlock();
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
      content: `${prefix}${prefix ? '\n\n' : ''}${canonicalBlock}\n${canonicalHookBlock}\n${canonicalUserPromptHookBlock}`,
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

  const hookRegex = tomlSectionRegex('hooks.pre_tool_use');
  if (hookRegex.test(nextContent)) {
    const current = nextContent.match(hookRegex)[0];
    if (current !== canonicalHookBlock) {
      nextContent = nextContent.replace(hookRegex, canonicalHookBlock);
      changed = true;
    }
  } else {
    const prefix = nextContent.trimEnd();
    nextContent = `${prefix}${prefix ? '\n\n' : ''}${canonicalHookBlock}`;
    changed = true;
  }

  const userPromptHookRegex = tomlSectionRegex('hooks.user_prompt_submit');
  if (userPromptHookRegex.test(nextContent)) {
    const current = nextContent.match(userPromptHookRegex)[0];
    if (current !== canonicalUserPromptHookBlock) {
      nextContent = nextContent.replace(userPromptHookRegex, canonicalUserPromptHookBlock);
      changed = true;
    }
  } else {
    const prefix = nextContent.trimEnd();
    nextContent = `${prefix}${prefix ? '\n\n' : ''}${canonicalUserPromptHookBlock}`;
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
  if (!cmd || /[\\/]/.test(cmd)) return false;
  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  return pathEntries.some((entry) => extensions.some((extension) => {
    const candidate = path.join(entry, `${cmd}${extension}`);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.statSync(candidate).isFile();
    } catch (_) {
      return false;
    }
  }));
}

function setupClaude() {
  const mcpChanged = mergeMcpJson(path.join(CWD, '.mcp.json'), 'Claude Code', 'project');
  const { wireHooks } = require(path.join(PKG_ROOT, 'scripts', 'auto-wire-hooks'));
  const hookResult = wireHooks({ agent: 'claude-code' });

  if (hookResult.error) {
    console.log(`  Claude Code hooks: ${hookResult.error}`);
    return mcpChanged;
  }

  if (!hookResult.changed) {
    console.log(`  Claude Code hooks: already configured at ${hookResult.settingsPath}`);
  } else {
    for (const h of hookResult.added) {
      console.log(`  Claude Code: wired ${h.lifecycle} hook`);
    }
    console.log(`  Claude Code settings: ${hookResult.settingsPath}`);
  }

  return mcpChanged || hookResult.changed;
}

function setupCodex() {
  const configPath = path.join(HOME, '.codex', 'config.toml');
  let configChanged = false;
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, upsertCodexServerConfig('').content);
    console.log('  Codex: created ~/.codex/config.toml');
    configChanged = true;
  } else {
    const content = fs.readFileSync(configPath, 'utf8');
    const updated = upsertCodexServerConfig(content);
    if (updated.changed) {
      fs.writeFileSync(configPath, updated.content);
      console.log('  Codex: appended MCP server to ~/.codex/config.toml');
      configChanged = true;
    }
  }

  const { wireCodexHooks } = require(path.join(PKG_ROOT, 'scripts', 'auto-wire-hooks'));
  const hookResult = wireCodexHooks({});
  if (hookResult.changed) {
    console.log('  Codex: updated ~/.codex/config.json with hooks and status line');
  }

  return configChanged || hookResult.changed;
}

function setupGemini(options = {}) {
  // Importing a plugin executes an external package manager and can mutate
  // machine-wide Gemini state. Keep ordinary init/quick-start deterministic;
  // operators can opt in explicitly when they want the plugin import too.
  const importPlugin = options.importPlugin === true
    || process.env.THUMBGATE_IMPORT_AGENT_PLUGINS === '1';
  let pluginImported = false;
  if (importPlugin) {
    for (const binName of ['agy', 'gemini']) {
      try {
        execFileSync(binName, ['plugin', 'import', PKG_ROOT, '--force'], {
          stdio: 'ignore',
          timeout: 5000,
        });
        console.log(`  Gemini: imported thumbgate plugin via ${binName}`);
        pluginImported = true;
        break;
      } catch (err) {
        // A missing, failing, or slow optional plugin manager must not block init.
      }
    }
  }

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

    if (!changed) return pluginImported;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.log('  Gemini: updated ~/.gemini/settings.json');
    return true;
  }
  // Fallback: project-level .gemini/settings.json
  const mcpChanged = mergeMcpJson(path.join(CWD, '.gemini', 'settings.json'), 'Gemini', 'project');
  return pluginImported || mcpChanged;
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

function setupOpenCode() {
  // OpenCode was listed in README's install table and in `init --help` since the
  // adapter asset landed, but no setup function ever existed — `--agent opencode`
  // silently wrote Claude/Codex/Gemini config and exited 0. OpenCode has no hook
  // surface, so this wires the MCP server, which is its real integration point.
  const configPath = path.join(HOME, '.config', 'opencode', 'opencode.json');
  const srcPath = path.join(PKG_ROOT, 'adapters', 'opencode', 'opencode.json');
  if (!fs.existsSync(srcPath)) return false;

  let src;
  try { src = JSON.parse(fs.readFileSync(srcPath, 'utf8')); } catch (_) { return false; }
  const desired = (src.mcp || {}).thumbgate;
  if (!desired) return false;

  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      // Resetting to {} here and writing would replace the whole file — silently deleting
      // the user's model, provider, plugin and other MCP settings just to add ours.
      // A config we cannot parse is a reason to stop, not to overwrite.
      console.error(`  OpenCode: ${configPath} could not be parsed (${error.message}).`);
      console.error('  Refusing to overwrite it. Fix or move the file, then re-run.');
      process.exitCode = 1;
      return false;
    }
  }
  config.mcp = config.mcp || {};
  if (JSON.stringify(config.mcp[MCP_SERVER_NAME]) === JSON.stringify(desired)) return false;

  config.$schema = config.$schema || src.$schema;
  config.mcp[MCP_SERVER_NAME] = desired;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`  OpenCode: registered thumbgate MCP server in ${configPath}`);
  return true;
}

// Single source of truth for `--agent`. Every value advertised in `init --help`
// and README.md must appear here with a real handler, or the flag lies.
// `hookAgent: true` means scripts/auto-wire-hooks.js can wire a pre-tool hook;
// the rest integrate over MCP only and are wired by their setup function.
const AGENT_ALIASES = {
  claude: 'claude-code',
  'claude_code': 'claude-code',
  'open-code': 'opencode',
};

const SUPPORTED_AGENTS = {
  'claude-code': { hookAgent: true },
  codex: { hookAgent: true },
  gemini: { hookAgent: true },
  forge: { hookAgent: true },
  cursor: { hookAgent: true },
  cline: { hookAgent: false, setup: () => setupCline() },
  amp: { hookAgent: false, setup: () => setupAmp() },
  opencode: { hookAgent: false, setup: () => setupOpenCode() },
};

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

function setupCline() {
  let changed = false;

  // 1. Copy .clinerules into project root (Cline auto-loads this at session start).
  const rulesDest = path.join(CWD, '.clinerules');
  const rulesSrc = path.join(PKG_ROOT, 'adapters', 'cline', '.clinerules');
  if (!fs.existsSync(rulesDest) && fs.existsSync(rulesSrc)) {
    fs.copyFileSync(rulesSrc, rulesDest);
    console.log('  Cline: installed .clinerules with ThumbGate gating rules');
    changed = true;
  }

  // 2. Merge MCP server block into Cline's VS Code globalStorage settings.
  // Extension id: saoudrizwan.claude-dev
  const platform = process.platform;
  let clineSettingsPath = null;
  if (platform === 'darwin') {
    clineSettingsPath = path.join(HOME, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  } else if (platform === 'linux') {
    clineSettingsPath = path.join(HOME, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  } else if (platform === 'win32' && process.env.APPDATA) {
    clineSettingsPath = path.join(process.env.APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  }

  if (clineSettingsPath) {
    let settings = { mcpServers: {} };
    if (fs.existsSync(clineSettingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(clineSettingsPath, 'utf8')); } catch (_) { settings = { mcpServers: {} }; }
    }
    settings.mcpServers = settings.mcpServers || {};
    const canonicalEntry = canonicalMcpEntry('home');
    if (!mcpEntriesMatch(settings.mcpServers[MCP_SERVER_NAME], canonicalEntry)) {
      settings.mcpServers[MCP_SERVER_NAME] = canonicalEntry;
      fs.mkdirSync(path.dirname(clineSettingsPath), { recursive: true });
      fs.writeFileSync(clineSettingsPath, JSON.stringify(settings, null, 2) + '\n');
      console.log(`  Cline: registered thumbgate MCP server in ${clineSettingsPath}`);
      changed = true;
    }
  } else {
    console.log('  Cline: unsupported platform for auto-wiring MCP settings; see adapters/cline/INSTALL.md');
  }

  return changed;
}

function detectAgent(projectDir) {
  if (fs.existsSync(path.join(projectDir, '.claude'))) return 'claude-code';
  if (fs.existsSync(path.join(projectDir, '.clinerules'))) return 'cline';
  if (fs.existsSync(path.join(projectDir, '.cursorrules'))) return 'cursor';
  if (fs.existsSync(path.join(projectDir, '.cursor'))) return 'cursor';
  if (fs.existsSync(path.join(projectDir, '.codex'))) return 'codex';
  if (fs.existsSync(path.join(projectDir, '.gemini'))) return 'gemini';
  if (fs.existsSync(path.join(projectDir, '.amp'))) return 'amp';
  return null;
}

async function setupVertex(options = {}) {
  const { execSync } = require('child_process');
  const dryRun = options.dryRun === true || options['dry-run'] === true;
  console.log(`\nthumbgate setup-vertex v${pkgVersion()}`);
  console.log('  Zero-friction Google Cloud & Vertex AI onboarding...');
  if (dryRun) {
    console.log('  Dry run: will detect gcloud account/project, but will not enable services or write .env.');
  }
  console.log('');

  // 1. Detect gcloud CLI
  let activeAccount = '';
  let activeProject = '';
  try {
    activeAccount = execSync('gcloud config get-value account', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    activeProject = execSync('gcloud config get-value project', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (_) {
    console.log('  ⚠️  Google Cloud SDK (gcloud CLI) not detected or not logged in.');
    console.log('      To automate setup, install the Google Cloud CLI and run: gcloud auth login');
    console.log('      Otherwise, manually set the following variables in your .env file:');
    console.log('      THUMBGATE_PROVIDER_MODE=vertex');
    console.log('      VERTEX_PROJECT_ID=<your-gcp-project-id>');
    console.log('');
    return;
  }

  if (!activeAccount) {
    console.log('  ⚠️  No active Google Cloud account set. Run: gcloud auth login');
    return;
  }

  console.log(`  Active Account : \x1b[36m${activeAccount}\x1b[0m`);
  if (!activeProject) {
    console.log('  ⚠️  No active Google Cloud project set. Run: gcloud config set project <PROJECT_ID>');
    return;
  }
  console.log(`  Active Project : \x1b[36m${activeProject}\x1b[0m`);

  // Validate project ID matches GCP format before use in shell
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(activeProject)) {
    console.log('  ⚠️  Invalid GCP project ID format. Aborting.');
    return;
  }

  if (dryRun) {
    console.log(`  DRY-RUN would enable Vertex AI API for project: ${activeProject}`);
    console.log(`  DRY-RUN would write THUMBGATE_PROVIDER_MODE=vertex and VERTEX_PROJECT_ID=${activeProject} to .env.`);
    console.log('');
    console.log('  Dry run complete. Re-run without --dry-run to apply these changes.');
    return;
  }

  // 2. Auto-enable Vertex AI API
  console.log('  ⚙️  Enabling Vertex AI API in your project (this can take a few seconds)...');
  try {
    execSync(`gcloud services enable aiplatform.googleapis.com --project=${activeProject}`, { stdio: 'inherit' });
    console.log('  ✅  Vertex AI API successfully enabled.');
  } catch (err) {
    console.log('  ⚠️  Could not programmatically enable Vertex AI API. Please make sure your billing is open.');
  }

  // 3. Write env config to .env
  const envPath = path.join(process.cwd(), '.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  // Helper to update or append env values
  function updateEnvKey(content, key, value) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      return content.replace(regex, `${key}=${value}`);
    }
    return content.trim() + `\n${key}=${value}\n`;
  }

  let updatedContent = updateEnvKey(envContent, 'THUMBGATE_PROVIDER_MODE', 'vertex');
  updatedContent = updateEnvKey(updatedContent, 'VERTEX_PROJECT_ID', activeProject);

  fs.writeFileSync(envPath, updatedContent, 'utf8');
  console.log('  ✅  Wrote configuration to local .env file.');

  // 4. Print gorgeous success activation box
  console.log('');
  console.log('  ╭──────────────────────────────────────────────────────────╮');
  console.log('  │  Vertex AI Setup Complete                                │');
  console.log('  │                                                         │');
  console.log('  │  ThumbGate wrote local Vertex routing config.            │');
  console.log('  │  This does not create or verify a Dialogflow CX agent.   │');
  console.log('  │  Verify DFCX with the console or Dialogflow CX REST API. │');
  console.log('  │                                                         │');
  console.log('  │  Try a test run:                                        │');
  console.log('  │  npx thumbgate feedback-self-test                       │');
  console.log('  ╰──────────────────────────────────────────────────────────╯');
  console.log('');
}

function quickStart() {
  const qsArgs = parseArgs(process.argv.slice(3));
  const projectDir = process.cwd();
  const detectedAgent = detectAgent(projectDir);
  const agent = qsArgs.agent || detectedAgent || 'claude-code';
  const thumbgateDir = path.join(projectDir, '.thumbgate');
  const configPath = path.join(thumbgateDir, 'config.json');
  const agentSource = qsArgs.agent ? 'specified' : (detectedAgent ? 'auto-detected' : 'default');

  console.log(`\nthumbgate quick-start v${pkgVersion()}`);
  console.log(`Agent: ${agent} (${agentSource})`);
  console.log('');

  // 1. Run init with the resolved agent so hook wiring uses the same target.
  init({ ...qsArgs, agent });

  // 2. Copy default gates
  const defaultGates = path.join(PKG_ROOT, 'config', 'gates', 'default.json');
  const targetGates = path.join(thumbgateDir, 'gates.json');
  if (fs.existsSync(defaultGates)) {
    fs.mkdirSync(thumbgateDir, { recursive: true });
    fs.copyFileSync(defaultGates, targetGates);
    console.log('  Copied default gates to .thumbgate/gates.json');
  }

  // 3. Write config
  let baseConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      baseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (_) {
      baseConfig = {};
    }
  }
  const config = {
    ...baseConfig,
    selfDistillation: true,
    contextStuffing: true,
    maxTokenBudget: 10000,
    autoGatePromotion: true,
    agent,
    version: pkgVersion(),
    installId: baseConfig.installId || require('crypto').randomBytes(8).toString('hex'),
    quickStart: true,
    createdAt: baseConfig.createdAt || new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log('  Created .thumbgate/config.json');

  console.log('\n  Enforcement setup complete:');
  console.log('    Self-distillation: ON (agent auto-learns from outcomes)');
  console.log('    Context-stuffing:  ON (all lessons injected at session start)');
  console.log('    Auto-gate promotion: ON (recurring failures become hard blocks)');
  console.log('    Default gates: ' + (fs.existsSync(targetGates) ? 'loaded' : 'not found'));
  console.log('\n  Next steps:');
  console.log('    npx thumbgate capture --feedback=down --context="what failed"');
  console.log('    npx thumbgate stats');
  console.log('');
}

// Activation walkthrough (guided first rule + live demonstrated block).
// Implementation lives in scripts/activation-quickstart.js so it can be unit
// tested without executing the CLI's top-level command switch. `init` is
// deliberately untouched — this is an additive, separate command.
function quickstart() {
  return require(path.join(PKG_ROOT, 'scripts', 'activation-quickstart')).quickstart();
}

function init(cliArgs = parseArgs(process.argv.slice(3))) {
  const args = { ...cliArgs };
  // A typo used to exit 0 having wired nothing for the requested agent.
  // Aliases must resolve BEFORE validation: scripts/auto-wire-hooks.js accepts `claude`
  // for `claude-code`, and plugins/claude-skill/README.md publishes that exact command.
  if (args.agent && AGENT_ALIASES[args.agent]) args.agent = AGENT_ALIASES[args.agent];
  if (args.agent && !Object.prototype.hasOwnProperty.call(SUPPORTED_AGENTS, args.agent)) {
    console.error(`Unknown --agent "${args.agent}". Supported: ${Object.keys(SUPPORTED_AGENTS).join(', ')}`);
    process.exit(1);
  }
  if (args.help || args.h) {
    console.log('Usage: npx thumbgate init [--agent <name>] [--wire-hooks] [--import-agent-plugins] [--email you@company.com]');
    console.log('');
    console.log('Scaffold ThumbGate in the current project and wire detected agent integrations.');
    console.log('');
    console.log('Options:');
    console.log(`  --agent <name>           Wire a specific agent: ${Object.keys(SUPPORTED_AGENTS).join(', ')}`);
    console.log('  --wire-hooks             Wire hooks only; do not scaffold project files');
    console.log('  --import-agent-plugins   Also import optional agent plugins when supported');
    console.log('  --email <email>          Subscribe installer to the setup guide and trial reminders');
    console.log('  --dry-run                Show hook changes without writing them');
    return;
  }

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

  // Copy custom slash commands (.claude/commands/*.md) to the project's config directories
  const pkgCommandsDir = path.join(PKG_ROOT, '.claude', 'commands');
  if (fs.existsSync(pkgCommandsDir)) {
    const targets = [
      path.join(CWD, '.claude', 'commands'),
      path.join(CWD, '.gemini', 'commands'),
      path.join(CWD, '.antigravitycli', 'commands')
    ];
    for (const projectCommandsDir of targets) {
      if (!fs.existsSync(projectCommandsDir)) {
        fs.mkdirSync(projectCommandsDir, { recursive: true });
      }
      try {
        const files = fs.readdirSync(pkgCommandsDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            fs.copyFileSync(path.join(pkgCommandsDir, file), path.join(projectCommandsDir, file));
          }
        }
      } catch (err) {
        console.log(`  Failed to copy custom commands to ${path.relative(CWD, projectCommandsDir)}: ${err.message}`);
      }
    }
    console.log('Scaffolded custom slash commands directories (.claude, .gemini, .antigravitycli)');
  }

  // Auto-detect and configure platform-specific locations
  console.log('');
  console.log('Detecting platforms...');
  let configured = 0;

  const platforms = [
    { agent: 'claude-code', name: 'Claude Code', detect: [
      () => whichExists('claude'),
      () => fs.existsSync(path.join(HOME, '.claude')),
      () => fs.existsSync(path.join(CWD, '.claude')),
    ], setup: setupClaude },
    { agent: 'codex', name: 'Codex', detect: [() => whichExists('codex'), () => fs.existsSync(path.join(HOME, '.codex'))], setup: setupCodex },
    {
      agent: 'gemini',
      name: 'Gemini',
      detect: [
        () => whichExists('gemini'),
        () => whichExists('agy'),
        () => fs.existsSync(path.join(HOME, '.gemini')),
      ],
      setup: () => setupGemini({ importPlugin: args['import-agent-plugins'] === true }),
    },
    { agent: 'amp', name: 'Amp', detect: [() => whichExists('amp'), () => fs.existsSync(path.join(HOME, '.amp'))], setup: setupAmp },
    { agent: 'cursor', name: 'Cursor', detect: [() => fs.existsSync(path.join(HOME, '.cursor', 'mcp.json')), () => fs.existsSync(path.join(CWD, '.cursor'))], setup: setupCursor },
    { agent: 'forge', name: 'ForgeCode', detect: [() => whichExists('forge'), () => fs.existsSync(path.join(CWD, 'forge.yaml'))], setup: setupForge },
    { agent: 'cline', name: 'Cline', detect: [
      () => fs.existsSync(path.join(CWD, '.clinerules')),
      () => process.platform === 'darwin' && fs.existsSync(path.join(HOME, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev')),
      () => process.platform === 'linux' && fs.existsSync(path.join(HOME, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev')),
      () => process.platform === 'win32' && process.env.APPDATA && fs.existsSync(path.join(process.env.APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev')),
    ], setup: setupCline },
  ];

  for (const p of platforms) {
    // An explicit target must stay scoped to that integration. Quick-start
    // always resolves one target before calling init; configuring every other
    // CLI merely because it exists on PATH caused surprise machine mutations
    // and multi-second hangs in ordinary onboarding.
    if (args.agent && p.agent !== args.agent) continue;
    if (detectPlatform(p.name, p.detect)) {
      const didSetup = p.setup();
      if (didSetup) configured++;
      else console.log(`  ${p.name}: already configured`);
    }
  }

  // ChatGPT — cannot be automated
  const chatgptSpec = [
    path.join(PKG_ROOT, 'openapi', 'openapi.yaml'),
    path.join(PKG_ROOT, 'adapters', 'chatgpt', 'openapi.yaml'),
  ].find((candidate) => fs.existsSync(candidate));
  if (chatgptSpec) {
    const projectChatgptSpec = path.join(thumbgateDir, 'chatgpt-openapi.yaml');
    fs.copyFileSync(chatgptSpec, projectChatgptSpec);
    console.log(`  ChatGPT: import ${path.relative(CWD, projectChatgptSpec)} in GPT Builder > Actions`);
  }

  if (configured === 0) console.log('  All detected platforms already configured.');

  // Agents without a native pre-tool hook surface (cline, amp, opencode) are wired
  // by their own setup function. Previously only cline was handled here: `--agent amp`
  // and `--agent opencode` fell through to wireHooks, which rejected them, printed the
  // rejection as an ordinary log line, and exited 0 — so the flag appeared to work
  // while writing nothing for that agent.
  const agentSpec = args.agent ? SUPPORTED_AGENTS[args.agent] : null;
  if (agentSpec && agentSpec.setup) {
    // A setup function returns false both when nothing needed doing and when it refused
    // (e.g. an unparseable config it declined to overwrite). Reporting "already
    // configured" for a refusal would repeat the original sin of this PR: a failure
    // dressed up as success. The refusal path sets process.exitCode, so key off that.
    const changed = agentSpec.setup();
    if (!changed && !process.exitCode) console.log(`  ${args.agent}: already configured`);
  } else if (args.agent || args['wire-hooks']) {
    const { wireHooks } = require(path.join(PKG_ROOT, 'scripts', 'auto-wire-hooks'));
    const hookResult = wireHooks({ agent: args.agent, dryRun: args['dry-run'] });
    if (hookResult.error) {
      // An explicit --agent that cannot be wired is a FAILURE, not a note. Exiting 0
      // here is what let a user believe `--agent opencode` had protected them.
      console.error(`  Hook wiring failed for --agent ${args.agent}: ${hookResult.error}`);
      process.exitCode = 1;
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
  console.log(`✅ thumbgate v${pkgVersion()} initialized.`);
  const onboardingEmail = typeof args.email === 'string'
    ? args.email.trim()
    : (typeof args['onboarding-email'] === 'string' ? args['onboarding-email'].trim() : '');
  if (onboardingEmail) {
    try {
      execFileSync(process.execPath, [__filename, 'subscribe', onboardingEmail], {
        cwd: CWD,
        env: process.env,
        stdio: 'inherit',
      });
      trackEvent('cli_init_email_subscribed', { command: 'init', source: 'init_email' });
    } catch (_) {
      console.log(`  Retry onboarding email: npx thumbgate subscribe ${onboardingEmail}`);
    }
  }
  trackEvent('cli_init', { command: 'init' });

  // ---------------------------------------------------------------------------
  // Activation guide: the ONE thing the user should do next.
  // 98.5% of init users never promote their first prevention rule.
  // This is the funnel break — not conversion, not nudges — activation.
  // ---------------------------------------------------------------------------
  console.log('');
  console.log('  ╭──────────────────────────────────────────────────────────╮');
  console.log('  │  NEXT: Prove feedback capture works                     │');
  console.log('  │                                                         │');
  console.log('  │  npx thumbgate feedback-self-test                       │');
  console.log('  │                                                         │');
  console.log('  │  Then dogfood it in chat:                               │');
  console.log('  │  thumbs down: agent skipped verification                │');
  console.log('  ╰──────────────────────────────────────────────────────────╯');
  console.log('');
  printInitConversionPrompt(onboardingEmail);
  if (!onboardingEmail) {
    console.log('  Get trial reminders: npx thumbgate init --email you@company.com');
  }

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
    limitNudge('capture_feedback', capLimit);
    process.exit(1);
  }
  trackEvent('cli_capture', { command: 'capture' });

  if (args.stats) {
    stats();
    return;
  }

  if (args.summary) {
    console.log(feedbackSummary(Number(args.recent || 20), { humanOnly: true }));
    return;
  }

  // Parse pure positional arguments
  const rawArgv = process.argv.slice(3);
  const positionalArgs = [];
  const BOOLEAN_FLAGS = new Set(['--json', '--verbose', '--quiet', '--dry-run', '--stats', '--summary', '--no-nudge', '--help']);
  for (let i = 0; i < rawArgv.length; i++) {
    const arg = rawArgv[i];
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && !BOOLEAN_FLAGS.has(arg)) {
        i++;
      }
    } else {
      positionalArgs.push(arg);
    }
  }

  let signal = (args.feedback || '').toLowerCase();
  let consumedSignalArgs = 0;
  if (!signal && positionalArgs[0]) {
    const { detectFeedbackSignal } = require(path.join(PKG_ROOT, 'scripts', 'feedback-quality'));
    const oneWord = positionalArgs[0];
    const twoWords = positionalArgs.slice(0, 2).join(' ');
    const detected = detectFeedbackSignal(twoWords) || detectFeedbackSignal(oneWord);
    if (detected) {
      signal = detected.signal;
      consumedSignalArgs = detectFeedbackSignal(twoWords) ? Math.min(2, positionalArgs.length) : 1;
    } else {
      const firstPos = positionalArgs[0].toLowerCase();
      if (['up', 'down', 'thumbsup', 'thumbsdown', 'thumbs_up', 'thumbs_down', 'positive', 'negative'].some(v => firstPos.includes(v))) {
        signal = firstPos;
        consumedSignalArgs = 1;
      }
    }
  }

  const normalized = ['up', 'thumbsup', 'thumbs_up', 'positive'].some(v => signal.includes(v)) ? 'up'
    : ['down', 'thumbsdown', 'thumbs_down', 'negative'].some(v => signal.includes(v)) ? 'down'
    : signal;

  if (normalized !== 'up' && normalized !== 'down') {
    console.error('Missing or unrecognized --feedback=up|down (or positional argument)');
    process.exit(1);
  }

  const gateAction = (args.action || '').toLowerCase();
  if (gateAction && !['block', 'approve', 'warn'].includes(gateAction)) {
    console.error('Unrecognized --action. Use: block (default), approve, or warn');
    process.exit(1);
  }

  let context = args.context || '';
  if (!context && consumedSignalArgs > 0) {
    context = positionalArgs.slice(consumedSignalArgs).join(' ');
  } else if (!context && positionalArgs[1]) {
    context = positionalArgs[1];
  }

  let whatWentWrong = args['what-went-wrong'];
  if (!whatWentWrong && consumedSignalArgs > 0 && positionalArgs.length > consumedSignalArgs + 1) {
    whatWentWrong = positionalArgs.slice(consumedSignalArgs + 1).join(' ');
  } else if (!whatWentWrong && positionalArgs[2]) {
    whatWentWrong = positionalArgs[2];
  } else if (!whatWentWrong && normalized === 'down' && context) {
    whatWentWrong = context;
  }

  let whatToChange = args['what-to-change'];
  if (!whatToChange && consumedSignalArgs > 0 && positionalArgs.length > consumedSignalArgs + 2) {
    whatToChange = positionalArgs.slice(consumedSignalArgs + 2).join(' ');
  } else if (!whatToChange && positionalArgs[3]) {
    whatToChange = positionalArgs[3];
  } else if (!whatToChange && normalized === 'down' && context) {
    whatToChange = `avoid: ${context}`;
  }

  const result = captureFeedback({
    signal: normalized,
    context: context,
    whatWentWrong: whatWentWrong,
    whatToChange: whatToChange,
    whatWorked: args['what-worked'],
    tags: args.tags,
    gateAction: gateAction || undefined,
    reviewOrigin: 'human',
  });

  if (result.accepted) {
    const ev = result.feedbackEvent;
    const mem = result.memoryRecord;

    if (args.json) {
      console.log(JSON.stringify({
        ok: true,
        signal: normalized,
        feedbackId: ev.id,
        memoryId: mem.id,
        actionType: ev.actionType,
      }, null, 2));
      return;
    }

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
        console.log(`  ⚠️  Free tier limit reached. Upgrade to Pro for unlimited: https://thumbgate.ai/pro`);
      }
    }
    console.log('');
    try {
      const { buildCaptureReceipt } = require(path.join(PKG_ROOT, 'scripts', 'commercial-offer'));
      console.log(buildCaptureReceipt({
        signal: normalized,
        feedbackId: ev.id,
        memoryId: mem.id,
        actionType: ev.actionType,
      }));
    } catch (_) {
      // Receipt is a conversion aid, not part of feedback persistence.
    }
    proNudge();
  } else {
    if (args.json) {
      console.log(JSON.stringify({
        ok: false,
        signal: normalized,
        reason: result.reason,
      }, null, 2));
      process.exit(2);
    }
    console.log(`\nFeedback Recorded [${normalized.toUpperCase()}] — not promoted`);
    console.log('─'.repeat(50));
    console.log(`  Reason      : ${result.reason}\n`);
    process.exit(2);
  }
}

function readJsonlEntries(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function feedbackSelfTest() {
  const args = parseArgs(process.argv.slice(3));
  const signalArg = String(args.feedback || args.signal || 'down').toLowerCase();
  const normalized = ['up', 'thumbsup', 'thumbs_up', 'positive'].some((v) => signalArg.includes(v)) ? 'up'
    : ['down', 'thumbsdown', 'thumbs_down', 'negative'].some((v) => signalArg.includes(v)) ? 'down'
    : signalArg;

  if (normalized !== 'up' && normalized !== 'down') {
    console.error('feedback-self-test needs --feedback=up|down when overriding the default.');
    process.exit(1);
  }

  const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const previousNoNudge = process.env.THUMBGATE_NO_NUDGE;
  const feedbackDir = args['feedback-dir']
    ? path.resolve(CWD, args['feedback-dir'])
    : args.persist
      ? null
      : fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-feedback-self-test-'));
  const isolated = Boolean(feedbackDir);

  if (feedbackDir) process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  process.env.THUMBGATE_NO_NUDGE = '1';

  try {
    const { captureFeedback, getFeedbackPaths } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
    const context = args.context || `feedback self-test: typed thumbs ${normalized} reaches ThumbGate capture`;
    const result = captureFeedback({
      signal: normalized,
      context,
      whatWentWrong: normalized === 'down'
        ? (args['what-went-wrong'] || 'Need proof that feedback capture is wired in this runtime')
        : undefined,
      whatToChange: normalized === 'down'
        ? (args['what-to-change'] || 'Run a one-command self-test before claiming thumbs feedback is captured')
        : undefined,
      whatWorked: normalized === 'up'
        ? (args['what-worked'] || 'Feedback capture persisted and was verified by a self-test')
        : undefined,
      tags: args.tags || 'self-test,dogfood,feedback-capture',
      reviewOrigin: 'automated',
    });

    const paths = getFeedbackPaths();
    const feedbackRows = readJsonlEntries(paths.FEEDBACK_LOG_PATH);
    const memoryRows = readJsonlEntries(paths.MEMORY_LOG_PATH);
    const feedbackId = result.feedbackEvent && result.feedbackEvent.id;
    const memoryId = result.memoryRecord && result.memoryRecord.id;
    const feedbackStored = Boolean(feedbackId && feedbackRows.some((row) => row.id === feedbackId));
    const memoryStored = Boolean(memoryId && memoryRows.some((row) => row.id === memoryId));
    const ok = Boolean(result.accepted && feedbackStored && memoryStored);

    const payload = {
      ok,
      command: 'feedback-self-test',
      signal: normalized,
      accepted: Boolean(result.accepted),
      feedbackId: feedbackId || null,
      memoryId: memoryId || null,
      feedbackStored,
      memoryStored,
      isolated,
      feedbackDir: paths.FEEDBACK_DIR,
      nextDogfoodCommand: `npx thumbgate capture --feedback=${normalized} --context=${shellSingleQuote(context)}`,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else if (ok) {
      console.log('\nThumbGate feedback self-test: PASS');
      console.log('─'.repeat(50));
      console.log(`  Captured     : ${normalized} (${feedbackId})`);
      console.log(`  Stored lesson: ${memoryId}`);
      console.log(`  Storage      : ${paths.FEEDBACK_DIR}`);
      console.log(`  Mode         : ${isolated ? 'isolated test store' : 'active ThumbGate store'}`);
      console.log('\nDogfood in chat with:');
      console.log(`  thumbs ${normalized}: ${context}`);
    } else {
      console.log('\nThumbGate feedback self-test: FAIL');
      console.log('─'.repeat(50));
      console.log(`  Accepted       : ${payload.accepted}`);
      console.log(`  Feedback stored: ${feedbackStored}`);
      console.log(`  Memory stored  : ${memoryStored}`);
      console.log(`  Storage        : ${paths.FEEDBACK_DIR}`);
    }

    if (!ok) process.exit(2);
  } finally {
    if (previousFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
    if (previousNoNudge === undefined) delete process.env.THUMBGATE_NO_NUDGE;
    else process.env.THUMBGATE_NO_NUDGE = previousNoNudge;
  }
}

function stats() {
  trackEvent('cli_stats', { command: 'stats' });
  const args = parseArgs(process.argv.slice(3));
  const { analyzeFeedback } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const data = analyzeFeedback(undefined, { humanOnly: true });

  // Gate enforcement stats — runtime intercepts + configured gates
  let gateData = { blocked: 0, warned: 0, passed: 0, byGate: {} };
  try { gateData = require(path.join(PKG_ROOT, 'scripts', 'gates-engine')).loadStats(); } catch {}
  let gateConfigData = { totalGates: 0, autoPromotedGates: 0, estimatedHoursSaved: '0.0', topBlocked: null, firstTimeFixRate: null };
  try { gateConfigData = require(path.join(PKG_ROOT, 'scripts', 'gate-stats')).calculateStats(); } catch {}

  const avgCostOfMistake = 2.50;
  const totalInterceptions = gateData.blocked + gateData.warned;
  const payload = {
    total: data.total,
    positives: data.totalPositive,
    negatives: data.totalNegative,
    approvalRate: Math.round(data.approvalRate * 100),
    recentTrend: Math.round(data.recentRate * 100),
    revenueAtRisk: Number((data.totalNegative * avgCostOfMistake).toFixed(2)),
    topTags: data.topTags || [],
    recentActivity: data.recentActivity || [],
    gatesBlocked: gateData.blocked,
    gatesWarned: gateData.warned,
    totalGates: gateConfigData.totalGates,
    autoPromotedGates: gateConfigData.autoPromotedGates,
    estimatedHoursSaved: gateConfigData.estimatedHoursSaved,
    topBlockedGate: gateConfigData.topBlocked ? gateConfigData.topBlocked.id : null,
    firstTimeFixRate: gateConfigData.firstTimeFixRate,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('\n📊 ThumbGate Performance Metrics');
  console.log('─'.repeat(50));
  console.log(`  Total Signals   : ${payload.total}`);
  console.log(`  Approval Rate   : ${payload.approvalRate}%`);
  console.log(`  Recent Trend    : ${payload.recentTrend}%`);

  // Gate enforcement — the high-ROI section
  if (totalInterceptions > 0 || payload.totalGates > 0) {
    console.log('\n🛡️  PRE-ACTION GATE ENFORCEMENT');
    console.log(`  Actions blocked : ${payload.gatesBlocked}`);
    console.log(`  Actions warned  : ${payload.gatesWarned}`);
    console.log(`  Active gates    : ${payload.totalGates} (${payload.autoPromotedGates} auto-promoted)`);
    if (payload.topBlockedGate) console.log(`  Top blocker     : ${payload.topBlockedGate}`);
    console.log(`  Est. time saved : ~${payload.estimatedHoursSaved} hours`);
    const { formatFirstTimeFixRate } = require(path.join(PKG_ROOT, 'scripts', 'gate-stats'));
    console.log(`  First-time fix  : ${formatFirstTimeFixRate(payload.firstTimeFixRate)}`);
  }

  if (payload.negatives > 0) {
    console.log('\n⚠️  REVENUE-AT-RISK ANALYSIS');
    console.log(`  Repeated Failures detected: ${payload.negatives}`);
    console.log(`  Estimated Operational Loss: $${payload.revenueAtRisk}`);
    console.log('  Action Required: Run "npx thumbgate rules" to generate guardrails.');
    console.log('  Strategic Recommendation: if this is a shared workflow problem, start with the $499 Enterprise Workflow Gate.');
    console.log('  Enterprise entry: https://thumbgate.ai/pricing');
    console.log('  Solo side lane: npx thumbgate pro');
  } else {
    console.log('\n✅ System is currently high-reliability. No immediate revenue loss detected.');
  }
  try {
    const { buildStatsReceipt } = require(path.join(PKG_ROOT, 'scripts', 'commercial-offer'));
    const receipt = buildStatsReceipt(payload);
    if (receipt) console.log(receipt);
  } catch (_) {
    // Keep stats resilient if the receipt helper is unavailable in old installs.
  }
  proNudge();
}

function compact() {
  const args = parseArgs(process.argv.slice(3));
  const { compactMemories } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const result = compactMemories();

  if (args.json) {
    console.log(JSON.stringify({ before: result.before, after: result.after, removed: result.removed }, null, 2));
    return;
  }

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
  const { createCliProgress } = require(path.join(PKG_ROOT, 'scripts', 'cli-progress'));
  const progress = createCliProgress();
  const { getOperationalBillingSummary } = require(path.join(PKG_ROOT, 'scripts', 'operational-summary'));
  progress.start('Loading CFO billing summary…');
  getOperationalBillingSummary({
    window: args.window,
    timeZone: args.timezone,
    now: args.now,
    onProgress: (message) => progress.update(message),
  })
    .then(({ source, summary, fallbackReason }) => {
      progress.succeed(`Billing summary ready (${source})`);
      console.log(JSON.stringify({
        source,
        fallbackReason,
        summary,
      }, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      progress.fail('CFO billing summary failed');
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
  const { createCliProgress } = require(path.join(PKG_ROOT, 'scripts', 'cli-progress'));
  const progress = createCliProgress();
  const { getOperationalDashboard } = require(path.join(PKG_ROOT, 'scripts', 'operational-dashboard'));

  progress.start('Loading North Star metrics…');
  getOperationalDashboard({
    window: args.window,
    timeZone: args.timezone,
    now: args.now,
    onProgress: (message) => progress.update(message),
  })
    .then(({ source, data, fallbackReason }) => {
      progress.succeed(`North Star ready (${source})`);
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
      progress.fail('North Star failed');
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });
}

function pro() {
  trackEvent('cli_pro_view', { command: 'pro' });
  const args = parseArgs(process.argv.slice(3));
  const {
    notifyHostedProActivation,
    resolveProKey,
    saveLicense,
    startLocalProDashboard,
  } = require(path.join(PKG_ROOT, 'scripts', 'pro-local-dashboard'));

  function printProInfo() {
    const hostedUrl = 'https://thumbgate.ai';
    const truthUrl = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md';
    console.log('\nThumbGate Pro — Local Dashboard');
    console.log('─'.repeat(50));
    console.log('Self-serve side lane today: Pro ($19/mo or $149/yr).');
    console.log('Every licensed Pro user gets a personal local dashboard on localhost.');
    console.log('\nWhat is available:');
    console.log('  - Personal recall: search lessons, rules, and proof');
    console.log('  - Local Pro dashboard: your own browser dashboard for search, gates, and DPO export');
    console.log('  - Managed adapters: Claude Code, Cursor, Codex, Gemini, Amp, Cline, OpenCode');
    console.log('  - Enterprise Workflow Gate: $499 for one supported workflow; hosted team sync and org dashboard are not GA');
    console.log('  - Commercial truth doc: source of truth for traction, pricing, and proof claims');
    console.log('\nLinks:');
    console.log(`  Buy Pro         : ${PRO_CHECKOUT_URL}`);
    console.log(`  Commercial truth: ${truthUrl}\n`);
    console.log('  Launch dashboard: npx thumbgate pro');
    console.log('  Activate + run  : npx thumbgate pro --activate --key=YOUR_KEY');
    console.log('  Install configs : npx thumbgate pro --upgrade');
    console.log('  Private core    : ThumbGate-Core (private repo)');
    console.log('  Core repo       : https://github.com/IgorGanapolsky/ThumbGate-Core\n');
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
    return notifyHostedProActivation({
      key: license.key,
      source: 'cli_pro_activate',
      version: license.version,
    })
      .then((notificationResult) => {
        appendLocalTelemetry({
          eventType: 'pro_activation_alert',
          version: license.version,
          timestamp: new Date().toISOString(),
          notified: Boolean(notificationResult && notificationResult.notified),
          sent: Boolean(notificationResult && notificationResult.alert && notificationResult.alert.sent),
          reason: notificationResult && notificationResult.reason ? notificationResult.reason : null,
        });
        return launchDashboard(license.key, 'pro_activate');
      });
  }

  if (args.upgrade) {
    const thumbgateDir = path.join(CWD, '.thumbgate');
    if (!fs.existsSync(thumbgateDir)) fs.mkdirSync(thumbgateDir, { recursive: true });

    const files = [
      ['constraints-pro.json', '10 RLAIF constraints'],
      ['prevention-rules-pro.md', 'curated production rules'],
      ['thompson-presets.json', '4 sampling presets'],
      ['reminders-pro.json', '8 reminder templates'],
    ];

    const candidateDirs = [
      path.join(PKG_ROOT, 'config', 'pro'),
      path.join(PKG_ROOT, 'pro'),
    ];
    const proDir = candidateDirs.find((dir) =>
      files.every(([file]) => fs.existsSync(path.join(dir, file)))
    );

    if (!proDir) {
      console.error('Pro upgrade bundle is missing from this ThumbGate install.');
      console.error(`Expected files under: ${path.join(PKG_ROOT, 'config', 'pro')}`);
      console.error('Please upgrade to the latest thumbgate package and retry: npm install -g thumbgate@latest');
      process.exit(1);
    }

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
  // creator-dev legitimately returns {key: '', source: 'creator-dev', plan: 'enterprise'}
  // when THUMBGATE_DEV_KEY is unset — startLocalProDashboard accepts the empty
  // key in that case (see pro-local-dashboard.js:141), so launch on source too.
  if (resolvedKey && (resolvedKey.key || resolvedKey.source === 'creator-dev')) {
    return launchDashboard(resolvedKey.key, 'pro_dashboard_launch');
  }

  printProInfo();
  process.exit(0);
}

function summary() {
  const args = parseArgs(process.argv.slice(3));
  const { feedbackSummary, analyzeFeedback } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  if (args.json) {
    const data = analyzeFeedback(undefined, { humanOnly: true });
    console.log(JSON.stringify({
      total: data.total,
      positives: data.totalPositive,
      negatives: data.totalNegative,
      approvalRate: Math.round(data.approvalRate * 100),
      recentTrend: Math.round(data.recentRate * 100),
    }, null, 2));
    return;
  }
  console.log(feedbackSummary(Number(args.recent || 20), { humanOnly: true }));
}

function lessons() {
  trackEvent('cli_recall', { command: 'lessons' });
  const args = parseArgs(process.argv.slice(3));
  const tags = String(args.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const query = args.query || process.argv.slice(3).find((a) => !a.startsWith('--')) || '';
  const limit = Number(args.limit || 10);
  const { checkLimit } = require(path.join(PKG_ROOT, 'scripts', 'rate-limiter'));
  const searchLimit = checkLimit('search_lessons');
  if (!searchLimit.allowed) {
    trackEvent('cli_upgrade_prompt', { command: 'lessons', action: 'search_lessons', limitType: searchLimit.limitType || null });
    limitNudge('search_lessons', searchLimit);
    process.exit(1);
  }

  // --remote: fetch from hosted Railway instance
  if (args.remote) {
    const apiBase = process.env.THUMBGATE_API_URL || PRO_URL;
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (args.category) params.set('category', args.category);
    if (tags.length) params.set('tags', tags.join(','));
    const url = `${apiBase}/v1/lessons/search?${params}`;
    const mod = url.startsWith('https') ? require('https') : require('http');
    let body = '';
    const req = mod.get(url, { timeout: 8000 }, (res) => {
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (args.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            const { formatLessonSearchResults } = require(path.join(PKG_ROOT, 'scripts', 'lesson-search'));
            process.stdout.write(`[remote: ${apiBase}]\n`);
            process.stdout.write(formatLessonSearchResults(result));
          }
        } catch {
          process.stderr.write(`Error parsing remote response: ${body.slice(0, 200)}\n`);
          process.exit(1);
        }
      });
    });
    req.on('error', (err) => {
      process.stderr.write(`Remote fetch failed: ${err.message}\n`);
      process.exit(1);
    });
    req.on('timeout', () => { req.destroy(); process.stderr.write('Remote fetch timed out\n'); process.exit(1); });
    return;
  }

  // --local (default)
  const { searchLessons, formatLessonSearchResults } = require(path.join(PKG_ROOT, 'scripts', 'lesson-search'));
  const result = searchLessons(query, { limit, category: args.category, tags });

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

function geminiEmbeddingPlan() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildGeminiEmbeddingRolloutPlan,
  } = require(path.join(PKG_ROOT, 'scripts', 'gemini-embedding-policy'));
  const plan = buildGeminiEmbeddingRolloutPlan({
    corpusItems: args['corpus-items'] || args.corpusItems,
    outputDimensionality: args.dim || args.outputDimensionality,
    task: args.task,
    useBatchApi: !args['no-batch'],
  });

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(`Gemini Embedding 2 plan — ${plan.task}`);
  console.log(`Model: ${plan.model}`);
  console.log(`Dimensions: ${plan.outputDimensionality}`);
  console.log(`Corpus: ${plan.corpusItems} items (~${plan.estimatedFloat32Mb} MB float32)`);
  console.log(`Query prefix: ${plan.taskPrefixes.query}`);
  console.log(`Document prefix: ${plan.taskPrefixes.document}`);
  console.log(`Batch API: ${plan.economics.batchApi}`);
}

function agentDesignGovernance() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildAgentDesignGovernancePlan,
    formatAgentDesignGovernancePlan,
  } = require(path.join(PKG_ROOT, 'scripts', 'agent-design-governance'));
  const report = buildAgentDesignGovernancePlan(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(formatAgentDesignGovernancePlan(report));
}

function proactiveAgentEvalGuardrails() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildProactiveAgentEvalGuardrailsPlan,
    formatProactiveAgentEvalGuardrailsPlan,
  } = require(path.join(PKG_ROOT, 'scripts', 'proactive-agent-eval-guardrails'));
  const report = buildProactiveAgentEvalGuardrailsPlan(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(formatProactiveAgentEvalGuardrailsPlan(report));
}

function rewardHackingGuardrails() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildRewardHackingGuardrailsPlan,
    formatRewardHackingGuardrailsPlan,
  } = require(path.join(PKG_ROOT, 'scripts', 'reward-hacking-guardrails'));
  const report = buildRewardHackingGuardrailsPlan(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(formatRewardHackingGuardrailsPlan(report));
}

function ossPrOpportunityScout() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildOssPrOpportunityScoutPlan,
    formatOssPrOpportunityScoutPlan,
  } = require(path.join(PKG_ROOT, 'scripts', 'oss-pr-opportunity-scout'));
  const report = buildOssPrOpportunityScoutPlan(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(formatOssPrOpportunityScoutPlan(report));
}

function chatgptAdsReadinessPack() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildChatgptAdsReadinessPack,
    formatChatgptAdsReadinessPack,
  } = require(path.join(PKG_ROOT, 'scripts', 'chatgpt-ads-readiness-pack'));
  const report = buildChatgptAdsReadinessPack(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(formatChatgptAdsReadinessPack(report));
}

function modelCandidatesCmd() {
  const args = parseArgs(process.argv.slice(3));
  const { writeModelCandidatesReport, renderModelCandidatesReport } = require(path.join(PKG_ROOT, 'scripts', 'model-candidates'));
  const maxCandidates = args.max ? Number(args.max) : undefined;
  const { reportPath, report } = writeModelCandidatesReport(undefined, {
    workload: args.workload,
    workloadFile: args['workload-file'] || args.workloadFile,
    provider: args.provider,
    family: args.family,
    gateway: args.gateway,
    maxCandidates: Number.isFinite(maxCandidates) ? maxCandidates : undefined,
  });

  if (args.json) {
    console.log(JSON.stringify({ reportPath, report }, null, 2));
    return;
  }

  process.stdout.write(renderModelCandidatesReport(report));
  process.stdout.write(`\nReport path: ${reportPath}\n`);
}

function benchCmd() {
  const args = parseArgs(process.argv.slice(3));
  const { runBenchmark } = require(path.join(PKG_ROOT, 'scripts', 'thumbgate-bench'));
  const minScore = args['min-score'] ? Number(args['min-score']) : undefined;
  const report = runBenchmark({
    suitePath: args.scenarios ? path.resolve(CWD, args.scenarios) : undefined,
    programbenchSmoke: Boolean(args['programbench-smoke'] || args.programbench),
    programbenchSuitePath: args['programbench-scenarios']
      ? path.resolve(CWD, args['programbench-scenarios'])
      : undefined,
    outDir: args['out-dir'] ? path.resolve(CWD, args['out-dir']) : undefined,
    minScore: Number.isFinite(minScore) ? minScore : undefined,
    useRuntimeState: Boolean(args['use-runtime-state']),
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`ThumbGate Bench: ${report.metrics.score}/100 ${report.passed ? 'PASS' : 'FAIL'}`);
    if (report.programBench) {
      console.log(`ProgramBench-style smoke: ${report.programBench.metrics.score}/100 ${report.programBench.passed ? 'PASS' : 'FAIL'}`);
    }
    console.log(`Report: ${report.reportPaths.markdown}`);
    console.log(`JSON: ${report.reportPaths.json}`);
  }

  if (!report.passed) {
    process.exitCode = 1;
  }
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
  const { checkLimit } = require(path.join(PKG_ROOT, 'scripts', 'rate-limiter'));
  const exportLimit = checkLimit('export_dpo');
  if (!exportLimit.allowed) {
    limitNudge('export_dpo', exportLimit);
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
  const { checkLimit } = require(path.join(PKG_ROOT, 'scripts', 'rate-limiter'));
  const exportLimit = checkLimit('export_databricks');
  if (!exportLimit.allowed) {
    limitNudge('export_databricks', exportLimit);
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

function importDoc() {
  syncActiveProjectContext();
  const args = parseArgs(process.argv.slice(3));
  const positionalFilePath = process.argv.slice(3).find((arg) => !arg.startsWith('--'));
  const filePath = positionalFilePath || args.file || args.path || null;
  const inlineContent = typeof args.content === 'string' && args.content.trim()
    ? args.content
    : (!filePath ? readStdinText().trim() : '');
  const tags = String(args.tags || args.tag || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (!filePath && !inlineContent) {
    console.error('Error: import-doc requires a file path, --content, or stdin text');
    process.exit(1);
  }

  try {
    const { importDocument: importDocumentLocal } = require(path.join(PKG_ROOT, 'scripts', 'document-intake'));
    const document = importDocumentLocal({
      filePath,
      content: inlineContent || null,
      title: args.title || null,
      sourceFormat: args.format || args['source-format'] || null,
      sourceUrl: args.url || args['source-url'] || null,
      tags,
      proposeGates: args['no-proposals'] ? false : args.proposeGates !== 'false',
    });
    trackEvent('cli_import_doc', {
      command: 'import-doc',
      documentId: document.documentId,
      sourceFormat: document.sourceFormat,
      proposalCount: Array.isArray(document.proposals) ? document.proposals.length : 0,
    });

    const payload = {
      ok: true,
      document,
    };
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Imported document: ${document.title}`);
    console.log(`  ID: ${document.documentId}`);
    console.log(`  Format: ${document.sourceFormat}`);
    console.log(`  Proposals: ${Array.isArray(document.proposals) ? document.proposals.length : 0}`);
    if (Array.isArray(document.proposals) && document.proposals.length > 0) {
      console.log('\nProposed gates:');
      for (const proposal of document.proposals.slice(0, 6)) {
        console.log(`  - [${proposal.type}] ${proposal.title} (${proposal.action}/${proposal.severity})`);
      }
    }
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
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
  if (args.json) {
    // Count rule sections (## headers) from the generated markdown
    const ruleHeaders = (result.markdown || '').match(/^## /gm);
    console.log(JSON.stringify({
      ok: true,
      path: result.path,
      rulesWritten: ruleHeaders ? ruleHeaders.length : 0,
    }, null, 2));
    return;
  }
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
  const args = parseArgs(process.argv.slice(3));
  const { generateAgentStatus, formatStatus } = require(path.join(PKG_ROOT, 'scripts', 'cli-status'));
  const data = generateAgentStatus({ pkgRoot: PKG_ROOT, projectDir: CWD });
  if (args.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  process.stdout.write(formatStatus(data));
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

function checkUpdateCmd() {
  const { checkUpdate } = require(path.join(PKG_ROOT, 'scripts', 'check-update'));
  const args = parseArgs(process.argv.slice(3));
  checkUpdate({ verbose: !args.json, force: args.force }).then((res) => {
    if (args.json) {
      console.log(JSON.stringify(res, null, 2));
    }
    process.exit(0);
  }).catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

function selfUpdateCmd() {
  const { selfUpdate } = require(path.join(PKG_ROOT, 'scripts', 'check-update'));
  const success = selfUpdate();
  process.exit(success ? 0 : 1);
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

function contextPacks() {
  const args = parseArgs(process.argv.slice(3));
  const { generateAutoContextPacks } = require(path.join(PKG_ROOT, 'scripts', 'auto-context-packs'));
  const result = generateAutoContextPacks();
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`\nGenerated ${result.packCount} context pack(s):`);
  for (const p of result.packs) {
    console.log(`  [${p.type}] ${p.name}`);
    console.log(`    -> ${p.filePath}`);
  }
  if (result.packCount === 0) {
    console.log('  (No failure patterns found yet — capture some feedback first.)');
  }
  console.log('');
}

function harnessAudit() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildHarnessOptimizationAudit,
    buildHarnessFitAudit,
    formatHarnessFitAudit,
    buildSolverWorkflowGovernance,
    formatSolverWorkflowGovernance,
  } = require(path.join(PKG_ROOT, 'scripts', 'harness-selector'));

  if (args['harness-fit'] || args.fit) {
    const audit = buildHarnessFitAudit(args);
    if (args.json) {
      console.log(JSON.stringify(audit, null, 2));
      return;
    }
    process.stdout.write(formatHarnessFitAudit(audit));
    return;
  }

  if (args['solver-workflow'] || args.solverWorkflow || args.solver) {
    const audit = buildSolverWorkflowGovernance(args);
    if (args.json) {
      console.log(JSON.stringify(audit, null, 2));
      return;
    }
    process.stdout.write(formatSolverWorkflowGovernance(audit));
    return;
  }

  const audit = buildHarnessOptimizationAudit({
    rootDir: CWD,
    docTokenBudget: args['doc-token-budget'],
  });

  if (args.json) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }

  console.log('\nThumbGate Harness Optimization Audit');
  console.log(`Status : ${audit.status}`);
  console.log(`Score  : ${audit.score}/100`);
  console.log(`Docs   : ~${audit.totals.globalDocEstimatedTokens} tokens across global agent docs`);
  console.log(`MCP    : ${audit.totals.mcpToolCount} indexed tools; progressive discovery ${audit.signals.progressiveToolIndexPresent ? 'on' : 'missing'}`);
  console.log(`Gates  : ${audit.totals.specializedHarnessCount} specialized harnesses`);
  console.log('\nRecommendations:');
  for (const recommendation of audit.recommendations) {
    console.log(`  - ${recommendation}`);
  }
  console.log('');
}

function nativeMessagingAudit() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildNativeMessagingAudit,
    formatNativeMessagingAudit,
  } = require(path.join(PKG_ROOT, 'scripts', 'native-messaging-audit'));
  const report = buildNativeMessagingAudit({
    homeDir: args['home-dir'],
    platform: args.platform,
    aiOnly: args['ai-only'] === true,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(formatNativeMessagingAudit(report));
}

function codeGraphGuardrails() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildCodeGraphGuardrailsPlan,
    formatCodeGraphGuardrailsPlan,
  } = require(path.join(PKG_ROOT, 'scripts', 'code-graph-guardrails'));
  const report = buildCodeGraphGuardrailsPlan(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(formatCodeGraphGuardrailsPlan(report));
}

function proxyPointerRagGuardrails() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildProxyPointerRagGuardrailsPlan,
    formatProxyPointerRagGuardrailsPlan,
  } = require(path.join(PKG_ROOT, 'scripts', 'proxy-pointer-rag-guardrails'));
  const report = buildProxyPointerRagGuardrailsPlan(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(formatProxyPointerRagGuardrailsPlan(report));
}

function ragPrecisionGuardrails() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildRagPrecisionGuardrailsPlan,
    formatRagPrecisionGuardrailsPlan,
  } = require(path.join(PKG_ROOT, 'scripts', 'rag-precision-guardrails'));
  const report = buildRagPrecisionGuardrailsPlan(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(formatRagPrecisionGuardrailsPlan(report));
}

function aiEngineeringStackGuardrails() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildAiEngineeringStackGuardrailsPlan,
    formatAiEngineeringStackGuardrailsPlan,
  } = require(path.join(PKG_ROOT, 'scripts', 'ai-engineering-stack-guardrails'));
  const report = buildAiEngineeringStackGuardrailsPlan(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(formatAiEngineeringStackGuardrailsPlan(report));
}

function deepseekV4RuntimeGuardrails() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildDeepSeekV4RuntimeGuardrailsPlan,
    formatDeepSeekV4RuntimeGuardrailsPlan,
  } = require(path.join(PKG_ROOT, 'scripts', 'deepseek-v4-runtime-guardrails'));
  const report = buildDeepSeekV4RuntimeGuardrailsPlan(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(formatDeepSeekV4RuntimeGuardrailsPlan(report));
}

function nvidiaSpecDecodeAlDoctor() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildNvidiaSpecDecodeAlDoctorReport,
    formatNvidiaSpecDecodeAlDoctorReport,
  } = require(path.join(PKG_ROOT, 'scripts', 'nvidia-specdecode-al-doctor'));
  const report = buildNvidiaSpecDecodeAlDoctorReport(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(formatNvidiaSpecDecodeAlDoctorReport(report));
  }

  if (args.strict && report.status !== 'ready') {
    process.exitCode = 1;
    return;
  }
  if (report.status === 'fail') process.exitCode = 1;
}

function packageManagerHonestyDoctor() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildPackageManagerHonestyReport,
    formatPackageManagerHonestyReport,
  } = require(path.join(PKG_ROOT, 'scripts', 'package-manager-honesty-doctor'));
  const report = buildPackageManagerHonestyReport(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(formatPackageManagerHonestyReport(report));
  }

  if (args.strict && report.status !== 'ready') {
    process.exitCode = 1;
    return;
  }
  if (report.status === 'fail') process.exitCode = 1;
}


function workspaceSearchRoute() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildWorkspaceSearchRouteReport,
    formatWorkspaceSearchRouteReport,
  } = require(path.join(PKG_ROOT, 'scripts', 'workspace-search-route'));
  const report = buildWorkspaceSearchRouteReport(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(formatWorkspaceSearchRouteReport(report));
  }

  if (args.strict && report.status !== 'ready') {
    process.exitCode = 1;
    return;
  }
  if (report.status === 'fail') process.exitCode = 1;
}

function upstreamContributions() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildUpstreamContributionPlan,
    renderUpstreamContributionPlan,
    writeUpstreamContributionPlan,
  } = require(path.join(PKG_ROOT, 'scripts', 'upstream-contribution-engine'));
  const report = buildUpstreamContributionPlan({
    ...args,
    root: CWD,
    maxRepos: args['max-repos'] || args.max,
    maxIssues: args['max-issues'],
    offline: args.live || args.network ? false : true,
  });

  if (args.write || args['write-report']) {
    const paths = writeUpstreamContributionPlan(report, args['out-dir'] || undefined);
    if (args.json) {
      console.log(JSON.stringify({ ...report, paths }, null, 2));
      return;
    }
    process.stdout.write(renderUpstreamContributionPlan(report));
    process.stdout.write(`\nArtifacts: ${paths.mdPath}, ${paths.jsonPath}\n`);
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(renderUpstreamContributionPlan(report));
}

function longRunningAgentContextGuardrails() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildLongRunningAgentContextGuardrailsPlan,
    formatLongRunningAgentContextGuardrailsPlan,
  } = require(path.join(PKG_ROOT, 'scripts', 'long-running-agent-context-guardrails'));
  const report = buildLongRunningAgentContextGuardrailsPlan(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(formatLongRunningAgentContextGuardrailsPlan(report));
}

function reasoningEfficiencyGuardrails() {
  const args = parseArgs(process.argv.slice(3));
  const {
    buildReasoningEfficiencyGuardrailsPlan,
    formatReasoningEfficiencyGuardrailsPlan,
  } = require(path.join(PKG_ROOT, 'scripts', 'reasoning-efficiency-guardrails'));
  const report = buildReasoningEfficiencyGuardrailsPlan(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(formatReasoningEfficiencyGuardrailsPlan(report));
}

function backgroundGovernance() {
  const args = parseArgs(process.argv.slice(3));
  const {
    checkRunGovernance,
    formatGovernanceReport,
    generateGovernanceReport,
  } = require(path.join(PKG_ROOT, 'scripts', 'background-agent-governance'));
  const feedbackDir = args['feedback-dir'];

  if (args.check) {
    const verdict = checkRunGovernance({
      agentId: args['agent-id'] || args.agent || 'unknown',
      runType: args['run-type'] || args.type || 'pr',
      branch: args.branch,
      filesChanged: Number(args['files-changed'] || 0),
    }, feedbackDir);

    if (args.json) {
      console.log(JSON.stringify({
        kind: 'background_agent_governance_check',
        ...verdict,
      }, null, 2));
    } else {
      console.log('\nBackground Agent Governance Check');
      console.log('-'.repeat(50));
      console.log(`  Allowed : ${verdict.allowed ? 'yes' : 'no'}`);
      console.log(`  Score   : ${verdict.governanceScore}/100`);
      if (verdict.blockers.length > 0) {
        console.log('\nBlockers:');
        for (const blocker of verdict.blockers) console.log(`  - ${blocker.rule}: ${blocker.message}`);
      }
      if (verdict.warnings.length > 0) {
        console.log('\nWarnings:');
        for (const warning of verdict.warnings) console.log(`  - ${warning.rule}: ${warning.message}`);
      }
      if (verdict.allowed && verdict.warnings.length === 0) {
        console.log('\nNo governance blockers or warnings found.');
      }
      console.log('');
    }
    process.exit(verdict.allowed ? 0 : 2);
  }

  const report = generateGovernanceReport({
    periodHours: Number(args['window-hours'] || args.window || 24),
    feedbackDir,
  });

  if (args.json) {
    console.log(JSON.stringify({
      kind: 'background_agent_governance_report',
      ...report,
    }, null, 2));
    return;
  }

  console.log('\n' + formatGovernanceReport(report));
  console.log('\nReview relief actions:');
  console.log('  - Run --check before dispatching an unattended PR job.');
  console.log('  - Route protected branches and large blast-radius jobs to human review.');
  console.log('  - Convert CI failures into thumbs-down lessons so repeats become Pre-Action Checks.');
  console.log('\nGuide: https://thumbgate.ai/guides/background-agent-governance\n');
}

function optimize() {
  const { optimize: doOptimize } = require(path.join(PKG_ROOT, 'scripts', 'optimize-context'));
  doOptimize();
}

function syncGcp() {
  const { syncToGcp } = require(path.join(PKG_ROOT, 'adapters', 'gcp', 'sync.js'));
  syncToGcp();
}

function cleanup() {
  console.log('Cleaning up ThumbGate processes...');
  try {
    const { execSync } = require('child_process');
    // Kill all 'thumbgate serve' and 'thumbgate dashboard' processes except this one
    const pids = execSync("ps aux | grep -E 'thumbgate (serve|dashboard|mcp)' | grep -v 'grep' | grep -v 'cleanup' | awk '{print $2}'", { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter(pid => pid !== process.pid);

    if (pids.length > 0) {
      console.log(`Killing ${pids.length} process(es): ${pids.join(', ')}`);
      pids.forEach(pid => {
        try { process.kill(pid, 'SIGTERM'); } catch (_) {}
      });
      // Give them a moment to die
      execSync('sleep 1');
    } else {
      console.log('No other ThumbGate processes found.');
    }

    // Check port 3456 specifically
    try {
      const portPids = execSync("lsof -ti :3456", { encoding: 'utf8' })
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .map(Number);
      portPids.forEach(pid => {
        console.log(`Killing process ${pid} holding port 3456`);
        try { process.kill(pid, 'SIGKILL'); } catch (_) {}
      });
    } catch (_) { /* port already free */ }

    console.log('✅ Cleanup complete. Run "npx thumbgate pro" to restart the dashboard.');
  } catch (err) {
    console.error(`Cleanup failed: ${err.message}`);
  }
}

function serve() {
  try {
    const { repairCodexHooks } = require(path.join(PKG_ROOT, 'scripts', 'codex-self-heal'));
    repairCodexHooks();
  } catch (_) { /* self-heal is best-effort */ }
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
  try {
    const payload = readStdinText();
    const input = payload ? JSON.parse(payload) : {};
    const gatesEngine = require(path.join(PKG_ROOT, 'scripts', 'gates-engine'));

    // The operator bypass only skips advisory and strict-mode gates. Security and
    // self-protection floors are evaluated before the early approval path.
    if (process.env.THUMBGATE_HOTFIX_BYPASS === '1') {
      const hardFloorOutput = gatesEngine.runHardFloor(input);
      if (hardFloorOutput) {
        process.stdout.write(hardFloorOutput + '\n');
        return;
      }
      process.stdout.write(JSON.stringify({
        decision: 'approve',
        reason: 'operator-bypass-opt-in',
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: '' }
      }) + '\n');
      return;
    }

    const output = await gatesEngine.runAsync(input);
    process.stdout.write(output + '\n');
  } catch (err) {
    process.stderr.write(`gate-check error: ${err.message}\n`);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `[ThumbGate Error] ${err.message}`,
      }
    }) + '\n');
  }
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
  const { extractPromptEnvelope } = require(path.join(PKG_ROOT, 'scripts', 'feedback-sanitizer'));
  const rawStdin = readStdinText();
  const promptEnvelope = extractPromptEnvelope(rawStdin);
  // stdin on a UserPromptSubmit hook is the JSON payload
  // {session_id, transcript_path, cwd, prompt, ...}. Persist ONLY the human
  // `.prompt` field — never the whole stdin object — so session metadata blobs
  // can't be promoted as lessons.
  const prompt = process.env.CLAUDE_USER_PROMPT
    || process.env.THUMBGATE_USER_PROMPT
    || process.env.CODEX_USER_PROMPT
    || process.env.USER_PROMPT
    || promptEnvelope.prompt;
  const { evaluatePromptGuard } = require(path.join(PKG_ROOT, 'scripts', 'prompt-guard'));
  const { processInlineFeedback, formatCliOutput } = require(path.join(PKG_ROOT, 'scripts', 'cli-feedback'));
  const { detectFeedbackSignal, isGenericFeedbackText } = require(path.join(PKG_ROOT, 'scripts', 'feedback-quality'));
  const { loadOptionalModule } = require(path.join(PKG_ROOT, 'scripts', 'private-core-boundary'));
  const { recordConversationEntry, readRecentConversationWindow } = loadOptionalModule(
    path.join(PKG_ROOT, 'scripts', 'feedback-history-distiller'),
    () => ({
      recordConversationEntry: () => ({ recorded: false, reason: 'thumbgate_core_required' }),
      readRecentConversationWindow: () => [],
    })
  );

  const guardResult = evaluatePromptGuard(prompt);
  if (guardResult) {
    recordConversationEntry({
      author: 'user',
      text: prompt,
      source: 'claude_user_prompt',
    });
    process.stdout.write(`${JSON.stringify(guardResult)}\n`);
    return;
  }

  const detected = detectFeedbackSignal(prompt);
  if (!detected) {
    recordConversationEntry({
      author: 'user',
      text: prompt,
      source: 'claude_user_prompt',
    });
    return;
  }

  const signal = detected.signal;
  const conversationWindow = readRecentConversationWindow({ limit: 8 });
  const chatHistory = conversationWindow.map((entry) => ({
    role: entry.author === 'assistant' ? 'assistant' : 'user',
    content: entry.text || '',
  }));
  const normalizedSignal = signal === 'down' ? 'negative' : 'positive';
  const genericFeedback = isGenericFeedbackText(prompt, normalizedSignal);
  const { buildFeedbackSourceIdentity } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const sourceEvent = buildFeedbackSourceIdentity({
    signal,
    promptText: prompt,
    sessionId: promptEnvelope.sessionId || process.env.CLAUDE_SESSION_ID,
    promptId: promptEnvelope.promptId,
    projectDir: promptEnvelope.projectDir || CWD,
    timestamp: promptEnvelope.timestamp,
    source: 'claude-user-prompt',
  });
  const result = processInlineFeedback({
    signal,
    context: prompt,
    chatHistory,
    whatWentWrong: signal === 'down' && !genericFeedback ? prompt : undefined,
    whatWorked: signal === 'up' && !genericFeedback ? prompt : undefined,
    sourceEvent,
  });
  if (!result.feedbackResult || !result.feedbackResult.duplicate) {
    recordConversationEntry({
      author: 'user',
      text: prompt,
      source: 'claude_user_prompt',
    });
  }
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
  refreshStatuslineCache(analyzeFeedback(undefined, { humanOnly: true }));

  // Build a top-level <system-reminder> block that Claude Code's SessionStart
  // hook surfaces to the agent as first-class context — not buried stderr.
  // Contract: emit JSON `{hookSpecificOutput:{hookEventName:"SessionStart",
  // additionalContext:"..."}}` to stdout. Supported by Claude Code v0.4+.
  const reminderLines = [];

  // Active hard-block rules from gate-program.md
  try {
    const { readGateProgram, extractBlockPatterns } = require(path.join(PKG_ROOT, 'scripts', 'meta-agent-loop'));
    const gateProgram = readGateProgram();
    if (gateProgram) {
      const blockPatterns = extractBlockPatterns(gateProgram);
      if (blockPatterns.length > 0) {
        reminderLines.push('Active ThumbGate hard-block rules:');
        blockPatterns.forEach((p, i) => reminderLines.push(`  ${i + 1}. ${p}`));
      }
    }
  } catch (_) { /* non-critical */ }

  // MCP + lessons-store wiring — make unattended RAG-loop gaps loud at boot
  try {
    const { wiringReport } = require(path.join(PKG_ROOT, 'scripts', 'mcp-wiring-doctor'));
    const wiring = wiringReport(CWD);
    if (wiring && wiring.overall !== 'ok') {
      if (reminderLines.length > 0) reminderLines.push('');
      reminderLines.push(`ThumbGate RAG wiring: ${wiring.overall.toUpperCase()}`);
      reminderLines.push(
        wiring.unattendedCaptureReady
          ? '  Capture path available (local and/or hosted).'
          : '  Capture path BROKEN for unattended runs — wire .mcp.json thumbgate server and set THUMBGATE_FEEDBACK_DIR or THUMBGATE_API_BASE_URL+THUMBGATE_API_KEY.'
      );
      (wiring.findings || []).slice(0, 4).forEach((finding) => {
        reminderLines.push(`  - ${finding}`);
      });
    }
  } catch (_) { /* non-critical */ }

  // Top high-risk tags — force agent to see them at session start, not opt-in
  try {
    const { getRiskSummary } = require(path.join(PKG_ROOT, 'scripts', 'risk-scorer'));
    const summary = getRiskSummary();
    if (summary && Array.isArray(summary.highRiskTags) && summary.highRiskTags.length > 0) {
      if (reminderLines.length > 0) reminderLines.push('');
      reminderLines.push('Top high-risk tags from prior failures:');
      summary.highRiskTags.slice(0, 5).forEach((bucket, i) => {
        const key = bucket && (bucket.key || bucket.tag);
        const score = bucket && (bucket.risk || bucket.score || bucket.riskScore);
        if (key) reminderLines.push(`  ${i + 1}. ${key} (risk=${score || '?'})`);
      });
    }
  } catch (_) { /* non-critical */ }

  if (reminderLines.length > 0) {
    const additionalContext = ['<system-reminder>', ...reminderLines, '</system-reminder>'].join('\n');
    try {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext,
        },
      }));
    } catch (_) { /* stdout write failure is non-critical */ }
    // Legacy stderr fallback for older Claude Code versions
    process.stderr.write('\n[ThumbGate] ' + reminderLines.join('\n[ThumbGate] ') + '\n');
  }
}

function installMcp() {
  const { installMcp: doInstall, parseFlags } = require(path.join(PKG_ROOT, 'scripts', 'install-mcp'));
  const flags = parseFlags(process.argv.slice(3));
  doInstall(flags);
}

function dashboard() {
  const args = parseArgs(process.argv.slice(3));
  const { createCliProgress } = require(path.join(PKG_ROOT, 'scripts', 'cli-progress'));
  const progress = createCliProgress();

  if (args.open || args.web) {
    const { resolveProjectDir } = require(path.join(PKG_ROOT, 'scripts', 'feedback-paths'));
    const projectDir = resolveProjectDir({ cwd: process.cwd(), env: process.env });
    const port = process.env.PORT || 3456;
    const url = `http://127.0.0.1:${port}/dashboard?project=${encodeURIComponent(projectDir)}`;

    progress.start(`Starting local dashboard on :${port}…`);
    ensureDash(Number(port))
      .then((server) => {
        // Keep the stable stdout contract: scripts/tests parse `API <port> pid <n>`.
        // Progress stays on stderr so humans still see a spinner without breaking parsers.
        if (server.started) {
          console.log(`API ${port} pid ${server.pid}`);
          progress.update(`Local API listening (pid ${server.pid})…`);
        } else {
          progress.update('Local API already running…');
        }
        progress.update('Opening browser…');
        return openBrowser(url);
      })
      .then(() => {
        progress.succeed(`Dashboard open: ${url}`);
        process.exit(0);
      })
      .catch((err) => {
        progress.fail('Failed to open local dashboard');
        console.error(err && err.message ? err.message : err);
        process.exit(1);
      });
    return;
  }

  const { printDashboard } = require(path.join(PKG_ROOT, 'scripts', 'dashboard'));
  const { getOperationalDashboard } = require(path.join(PKG_ROOT, 'scripts', 'operational-dashboard'));

  progress.start('Loading ThumbGate dashboard…');
  getOperationalDashboard({
    window: args.window,
    timeZone: args.timezone,
    now: args.now,
    onProgress: (message) => progress.update(message),
  })
    .then(({ data, source }) => {
      const sourceLabel = source === 'hosted'
        ? 'hosted'
        : source === 'local-unverified'
          ? 'local (hosted unavailable)'
          : 'local';
      progress.succeed(`Dashboard ready (${sourceLabel})`);
      printDashboard(data);
      process.exit(0);
    })
    .catch((err) => {
      progress.fail('Dashboard failed');
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });
}

function artifacts() {
  const argv = process.argv.slice(3);
  const args = parseArgs(argv);
  const positionalType = argv.find((arg) => !arg.startsWith('--'));
  const {
    generateOperatorArtifact,
    formatArtifactMarkdown,
  } = require(path.join(PKG_ROOT, 'scripts', 'operator-artifacts'));

  generateOperatorArtifact({
    type: args.type || positionalType || 'reliability-pulse',
    windowHours: args['window-hours'] || args.window,
  })
    .then((artifact) => {
      if (args.json) {
        console.log(JSON.stringify(artifact, null, 2));
        return;
      }
      process.stdout.write(formatArtifactMarkdown(artifact));
    })
    .catch((err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });
}

function gateStats() {
  const args = parseArgs(process.argv.slice(3));
  const { calculateStats, formatStats } = require(path.join(PKG_ROOT, 'scripts', 'gate-stats'));
  const stats = calculateStats();
  if (args.json) {
    const { gates, ...summary } = stats;
    console.log(JSON.stringify(args.verbose ? stats : summary, null, 2));
    return;
  }
  console.log('\n' + formatStats(stats) + '\n');
}

function evalCmd() {
  syncActiveProjectContext();
  const args = parseArgs(process.argv.slice(3));
  const {
    formatProofReport,
    runFeedbackEvalSuite,
    runSuite,
    loadSuite,
  } = require(path.join(PKG_ROOT, 'scripts', 'prompt-eval'));
  const minScore = args['min-score'] === undefined ? 80 : Number(args['min-score']);
  const maxCases = args['max-cases'] === undefined ? 25 : Number(args['max-cases']);
  const suitePath = args.suite ? path.resolve(CWD, args.suite) : null;
  const fromFeedback = Boolean(args['from-feedback'] || !suitePath);
  const evalRun = fromFeedback
    ? runFeedbackEvalSuite({
        feedbackDir: args['feedback-dir'] ? path.resolve(CWD, args['feedback-dir']) : undefined,
        feedbackLog: args['feedback-log'] ? path.resolve(CWD, args['feedback-log']) : undefined,
        maxCases,
        minScore,
      })
    : {
        suite: loadSuite(suitePath),
        report: runSuite(suitePath, { minScore }),
      };
  const { suite, report } = evalRun;

  if (args['write-suite']) {
    const outputPath = path.resolve(CWD, args['write-suite']);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(suite, null, 2)}\n`, 'utf8');
  }

  if (args['write-report']) {
    const outputPath = path.resolve(CWD, args['write-report']);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${formatProofReport(report, suite)}\n`, 'utf8');
  }

  if (args.json) {
    console.log(JSON.stringify({ ...report, suiteDefinition: fromFeedback ? suite : undefined }, null, 2));
    process.exit(report.pass ? 0 : 1);
  }

  console.log(`\nPrompt Evaluation: ${report.suite}`);
  console.log('─'.repeat(50));
  console.log(`  Score      : ${report.score}% (min ${report.minScore}%)`);
  console.log(`  Cases      : ${report.passed}/${report.total} passing`);
  console.log(`  Failures   : ${report.failed}`);
  console.log(`  Errors     : ${report.errors}`);
  console.log(`  Source     : ${fromFeedback ? 'feedback-derived' : suitePath}`);
  console.log(report.pass ? '\n✅ PASS\n' : '\n❌ FAIL\n');
  process.exit(report.pass ? 0 : 1);
}

function startApi() {
  const serverPath = path.join(PKG_ROOT, 'src', 'api', 'server.js');
  try {
    execSync(`node "${serverPath}"`, { stdio: 'inherit', cwd: CWD });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

function breakGlass() {
  const args = parseArgs(process.argv.slice(3));
  const positionalReason = process.argv.slice(3).find((arg) => !arg.startsWith('--'));
  const reason = String(args.reason || positionalReason || '').trim();
  if (!reason) {
    console.error('Usage: npx thumbgate break-glass --reason "why this recovery is needed" [--ttl=5m] [--json]');
    process.exit(1);
  }

  const ttlMs = parseTtlMs(args.ttl, 5 * 60 * 1000);
  const { breakGlassEmergency } = require(path.join(PKG_ROOT, 'scripts', 'gates-engine'));
  const result = breakGlassEmergency({ reason, ttlMs });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('ThumbGate break-glass active.');
  console.log(`  Reason     : ${result.reason}`);
  console.log(`  Expires    : ${result.expiresAt}`);
  console.log('  Unlocked   : hook settings edits, pr_create_allowed, pr_threads_checked');
  console.log('  Still gated: local-only scope, force-push, protected branch push, unsafe chmod, broad rm -rf');
}

function aiInventory() {
  const args = parseArgs(process.argv.slice(3));
  const {
    scanAiComponents,
    buildCycloneDxMlBom,
    formatInventoryText,
    writeOutput,
  } = require(path.join(PKG_ROOT, 'scripts', 'ai-component-inventory'));
  const rootDir = path.resolve(String(args.root || args.cwd || CWD));
  const format = String(args.format || (args.json ? 'json' : 'summary')).toLowerCase();
  const inventory = scanAiComponents({
    rootDir,
    maxFiles: args['max-files'] ? Number(args['max-files']) : undefined,
    includeSnippets: args.snippets !== false,
  });

  let payload;
  if (format === 'cyclonedx' || format === 'ml-bom' || format === 'mlbom') {
    payload = JSON.stringify(buildCycloneDxMlBom(inventory, { version: pkgVersion() }), null, 2);
  } else if (format === 'json') {
    payload = JSON.stringify(inventory, null, 2);
  } else {
    payload = formatInventoryText(inventory);
  }

  if (args.output) {
    writeOutput(path.resolve(String(args.output)), `${payload}\n`);
    console.log(`Wrote AI inventory evidence to ${path.resolve(String(args.output))}`);
    return;
  }

  console.log(payload);
}

function verifyClaimsCmd() {
  const { runCli } = require(path.join(PKG_ROOT, 'scripts', 'universal-claim-evaluator'));
  process.exitCode = runCli(process.argv.slice(3));
}

function claimStopCheckCmd() {
  const { main } = require(path.join(PKG_ROOT, 'scripts', 'hook-stop-anti-claim'));
  main();
}

function help() {
  const v = pkgVersion();
  const helpArgs = process.argv.slice(3);
  const showAll = helpArgs.includes('all')
    || helpArgs.includes('--all')
    || helpArgs.includes('--full');

  // Default `thumbgate help` shows a curated short list. The full ~70-command
  // surface lives behind `thumbgate help all` so first-time users aren't hit
  // with a wall of text. (Pre-2026-05-18 default: dump everything.)
  if (!showAll) {
    console.log(`thumbgate v${v}  — pre-action checks for AI coding agents`);
    console.log('');
    console.log('Common commands:');
    console.log('  init                                              Detect agent and wire ThumbGate hooks');
    console.log('  feedback-self-test                                Prove thumbs capture works locally');
    console.log('  capture --feedback=up|down --context="<text>"    Capture a thumbs signal as a stored lesson');
    console.log('  stats                                             Approval rate, recent trend, blocked-pattern count');
    console.log('  lessons [query]                                   Search promoted lessons');
    console.log('  explore                                           Interactive TUI for lessons, gates, stats');
    console.log('  dashboard                                         Open the local ThumbGate dashboard');
    console.log('  ai-inventory                                      Scan AI/ML components and export ML-BOM evidence');
    console.log('  verify-claims --claim="..."                     Recheck factual claims against configured sources');
    console.log('  doctor                                            Audit runtime isolation + bootstrap context');
    console.log('  compass                                           6-axis pipeline: wire, lessons, rules, eval');
    console.log('  security-central                                  Free Agent Security Central posture report');
    console.log('  break-glass --reason="..."                       Short TTL recovery if gates over-fire');
    console.log('  brain [--write]                                   Build the agent-readable context brain (lessons + rules + gates)');
    console.log('  pro                                               ThumbGate Pro (dashboard, exports, sync)');
    console.log('  diagnostic                                        $499 Enterprise Workflow Gate for one repeated team failure');
    console.log('  subscribe <email>                                 Get the 5-min setup guide + weekly tips by email');
    console.log('');
    console.log('More:');
    console.log('  thumbgate help all     Full subcommand surface (~70 commands)');
    console.log('  thumbgate <cmd> --help Per-command flags (where supported)');
    console.log('');
    console.log('Docs: https://github.com/IgorGanapolsky/ThumbGate');
    proNudge();
    return;
  }

  const { groupedCommands, commandHelpLine } = require(path.join(PKG_ROOT, 'scripts', 'cli-schema'));
  const groups = groupedCommands();
  const GROUP_LABELS = {
    capture:   'Feedback capture',
    discovery: 'Discovery & inspection',
    gates:     'Checks & rules',
    export:    'Export',
    ops:       'Operations',
    advanced:  'Advanced',
  };

  console.log(`thumbgate v${v}  — pre-action checks for AI coding agents (full command surface)`);
  console.log('');

  for (const [groupKey, label] of Object.entries(GROUP_LABELS)) {
    const cmds = groups[groupKey];
    if (!cmds || cmds.length === 0) continue;
    console.log(`${label}:`);
    for (const cmd of cmds) {
      console.log(commandHelpLine(cmd));
    }
    console.log('');
  }

  // Internal / hook commands (called by agent runtime, not operator-facing schema).
  console.log('Internal hooks (called by agent runtime):');
  console.log('  gate-check            Evaluate PreToolUse payload from stdin -> ALLOW/BLOCK');
  console.log('  cache-update          Refresh Claude statusline cache from stdin');
  console.log('  statusline-render     Render ThumbGate Claude status line');
  console.log('  hook-auto-capture     Process Claude UserPromptSubmit inline feedback');
  console.log('  claim-stop-check      Recheck configured factual claims before Claude stops');
  console.log('  session-start         Refresh local ThumbGate session cache');
  console.log('');

  // Legacy and specialist commands kept visible until they graduate into the schema.
  console.log('Also available:');
  console.log('  install-mcp           Install MCP server + PreToolUse hooks into Claude Code settings');
  console.log('                            default: machine-wide  (~/.claude/settings.json — shared dashboard)');
  console.log('                            --project: per-repo    (<cwd>/.claude/settings.json — isolated dashboard)');
  console.log('                            --no-hooks: MCP only, skip hook wiring');
  console.log('  break-glass           Short TTL recovery if gates over-fire');
  console.log('  cfo                   Hosted billing summary (local fallback JSON)');
  console.log('  billing:setup         Generate operator key + print Railway setup instructions');
  console.log('  repair-github-marketplace  Repair legacy GitHub Marketplace amount mappings');
  console.log('  north-star            Show proof-backed workflow-run progress toward the North Star');
  console.log('  model-fit             Detect local embedding profile and write evidence report');
  console.log('  model-candidates      Rank managed model candidates and benchmark routing plans');
  console.log('  bench                 Run ThumbGate Bench reports (--programbench-smoke for cleanroom proof)');
  console.log('  risk                  Train or query the boosted local risk scorer');
  console.log('  eval                  Turn feedback into reusable prompt/workflow eval proof');
  console.log('  optimize              [PRO] Prune CLAUDE.md and migrate rules to Pre-Action Checks');
  console.log('  prove [--target=X]    Run proof harness (adapters|automation|...)');
  console.log('  compass               6-axis pipeline check (wire → lessons → rules → eval)');
  console.log('  watch                 Watch .thumbgate/ for external signals');
  console.log('  status                Approval trend + failure domain dashboard');
  console.log('  funnel                Marketing and revenue conversion funnel analytics');
  console.log('  pulse                 Real-time GTM velocity and Mission Control summary');
  console.log('  dispatch              Dispatch-safe brief for phone-driven review sessions');
  console.log('  code-graph-guardrails Map code-graph risk signals to Knowledge Graph Safety gates');
  console.log('  proxy-pointer-rag-guardrails Map visual document RAG signals to Document RAG Safety gates');
  console.log('  rag-precision-guardrails Map retrieval tuning regressions to Document RAG Safety gates');
  console.log('  ai-engineering-stack-guardrails Map gateway, MCP, AGENTS.md, LLM wiki, reviewer, and sandbox gaps to stack gates');
  console.log('  ai-inventory          Scan AI/ML components and export JSON or CycloneDX ML-BOM evidence');
  console.log('  upstream-contributions Find dependency issues worth fixing without promotional PRs');
  console.log('  long-running-agent-context-guardrails Map structured-memory gaps to long-running agent gates');
  console.log('  reasoning-efficiency-guardrails Map reasoning compression signals to efficiency gates');
  console.log('  deepseek-v4-runtime-guardrails Map sparse-attention runtime signals to safety gates');
  console.log('  nvidia-specdecode-al-doctor Check speculative AL/D evidence vs AL/(1+ρD) speedup math');
  console.log('  package-manager-honesty-doctor Audit lockfile/CI parity; fail-closed manager switches');
  console.log('  workspace-search-route     Route query to rg/fts/vector/hybrid/graph (zg FORMAT)');
  console.log('  background-governance Background-agent run report and dispatch risk check');
  console.log('  analytics             Unified analytics snapshot (npm, GitHub, landing)');
  console.log('  inventory             Agent action inventory: tool calls, gate denies, false-deny rate');
  console.log('  conflict-audit        Find controls that report success but enforce nothing');
  console.log('  start-api             Start the ThumbGate HTTPS API server');
  console.log('');

  console.log('Global flags (all commands):');
  console.log('  --json                Output as machine-readable JSON');
  console.log('  --local               Use local storage (default for most commands)');
  console.log('  --remote              Fetch from hosted Railway instance');
  console.log('');

  console.log('Explore subcommands (non-interactive):');
  console.log('  explore lessons [--json] [--limit=N]   List lessons with confidence badges');
  console.log('  explore rules   [--json]               List prevention rules');
  console.log('  explore gates   [--json]               List gates with action badges');
  console.log('  explore firings [--json] [--limit=N]   List recent gate firings');
  console.log('');

  console.log('Examples:');
  console.log('  npx thumbgate init');
  console.log('  npx thumbgate feedback-self-test');
  console.log('  npx thumbgate status --json');
  console.log('  npx thumbgate explore lessons --json');
  console.log('  npx thumbgate explore gates --json');
  console.log('  npx thumbgate demo');
  console.log('  npx thumbgate stats --json');
  console.log('  npx thumbgate code-graph-guardrails --central-files=src/api/server.js --layers=api,data --generated-artifacts=.codegraph/index.json --json');
  console.log('  npx thumbgate proxy-pointer-rag-guardrails --tree-path=.rag/tree.json --image-pointers=paper-1/figures/fig2.png --documents=paper-1 --visual-claims --json');
  console.log('  npx thumbgate rag-precision-guardrails --baseline-recall=0.86 --new-recall=0.72 --threshold-change --agentic --structural-near-misses --json');
  console.log('  npx thumbgate ai-engineering-stack-guardrails --mcp-tool-count=182 --direct-provider-keys --llm-wiki-pages=24 --context-freshness-days=30 --background-agents --json');
  console.log('  npx thumbgate ai-inventory --format=cyclonedx --output=.thumbgate/ai-mlbom.json');
  console.log('  npx thumbgate long-running-agent-context-guardrails --request-count=80 --output-mb=3 --raw-chat-only --json');
  console.log('  npx thumbgate reasoning-efficiency-guardrails --baseline-tokens=1200 --compressed-tokens=980 --baseline-accuracy=0.84 --compressed-accuracy=0.85 --verifier --json');
  console.log('  npx thumbgate deepseek-v4-runtime-guardrails --context-tokens=900000 --hybrid-attention --speculative-decoding --accept-length=1.4 --precision-mode=fp8 --json');
  console.log('  npx thumbgate nvidia-specdecode-al-doctor --speculative-decoding --accept-length=1.4 --draft-length=7 --draft-depth-ratio=0.05 --claimed-speedup=3 --json');
  console.log('  npx thumbgate package-manager-honesty-doctor --propose-switch=pnpm --json');
  console.log('  npx thumbgate workspace-search-route --query="how does X connect" --json');
  console.log('  npx thumbgate upstream-contributions --max-repos=10 --write');
  console.log('  npx thumbgate background-governance --json');
  console.log('  npx thumbgate background-governance --check --agent-id=builder --branch=main --files-changed=25 --json');
  console.log('  npx thumbgate eval --from-feedback --json');
  console.log('  npx thumbgate lessons "force push" --json');
  console.log('  npx thumbgate lessons --query="deploy" --remote');
  console.log('  npx thumbgate gate-stats --json');
  console.log('  npx thumbgate capture --feedback=down --context="agent broke deploy" --json');
  proNudge();
}

if (COMMAND === 'daemon' || COMMAND === 'serve-daemon') {
  const subCmd = process.argv[3] || 'status';
  const { manageDaemon } = require(path.join(PKG_ROOT, 'scripts', 'daemon-manager'));
  manageDaemon(subCmd);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Global --help interceptor: `thumbgate <cmd> --help` shows per-command help
// instead of running the command. Commands with their own --help guard (init)
// handle it internally; everything else falls through here.
// ---------------------------------------------------------------------------
const _cliSubArgs = process.argv.slice(3);
const _wantsHelp = _cliSubArgs.includes('--help') || _cliSubArgs.includes('-h');

const SUBCOMMAND_HELP = {
  capture:       'Usage: npx thumbgate capture --feedback=up|down --context="..." [--what-worked="..."] [--what-went-wrong="..."] [--what-to-change="..."] [--tags=a,b]',
  feedback:      'Usage: npx thumbgate feedback --feedback=up|down --context="..." [--what-worked="..."] [--what-went-wrong="..."] [--what-to-change="..."] [--tags=a,b]',
  'feedback-self-test': 'Usage: npx thumbgate feedback-self-test [--json] [--persist] [--feedback=up|down]\n\nCapture a synthetic thumbs signal and verify feedback-log + memory-log writes. Defaults to an isolated test store; use --persist to dogfood the active ThumbGate store.',
  dogfood:       'Usage: npx thumbgate dogfood [--json] [--persist] [--feedback=up|down]\n\nAlias for feedback-self-test.',
  stats:         'Usage: npx thumbgate stats\n\nShow gate enforcement statistics: blocked/warned counts, active gates, time saved.',
  trial:         'Usage: npx thumbgate trial\n\nShow Pro trial status, remaining days, and upgrade path.',
  pro:           'Usage: npx thumbgate pro [--activate <key>]\n\nLaunch the local Pro dashboard or activate a Pro license key.',
  diagnostic:    'Usage: npx thumbgate diagnostic\n\nShow the $499 Enterprise Workflow Gate fit-check and checkout paths for teams with one repeated AI-agent workflow failure.',
  subscribe:     'Usage: npx thumbgate subscribe <email>\n\nSubscribe to the 5-minute setup guide + trial reminders.',
  lessons:       'Usage: npx thumbgate lessons [--query="..."] [--limit=N]\n\nSearch the lesson database (Pro feature).',
  search:        'Usage: npx thumbgate search <query>\n\nSearch ThumbGate knowledge base (Pro feature).',
  'gate-check':  'Usage: npx thumbgate gate-check\n\nPreToolUse hook interface: reads tool call JSON from stdin, outputs gate verdict.',
  'claim-stop-check': 'Usage: npx thumbgate claim-stop-check\n\nClaude Stop-hook interface: reads the hook payload from stdin and blocks factual claims that disagree with configured sources.',
  'verify-claims': 'Usage: npx thumbgate verify-claims --claim="the row count is 1,284" [--config=.thumbgate/claim-verifiers.json] [--cwd=path] [--json]\n\nRecheck supported factual claims against operator-configured SQLite, filesystem, and JSON sources. Exits non-zero on mismatch, missing verifier, or verifier error.',
  'hermes-gate': 'Usage: npx thumbgate hermes-gate\n\nNous Research Hermes Agent pre_tool_call shell hook: reads Hermes tool-call JSON from stdin, runs the ThumbGate gate pipeline (strict by default), and outputs {"decision":"block","reason":...} to veto or {} to allow. Gates terminal/patch/skill_manage etc. See adapters/hermes/config.yaml.',
  'break-glass': 'Usage: npx thumbgate break-glass --reason="why" [--ttl=5m] [--json]\n\nShort-lived recovery path for over-firing gates. Allows hook settings edits and satisfies PR-create/thread-check gates without disabling core destructive-action protections.',
  serve:         'Usage: npx thumbgate serve\n\nStart the MCP stdio server. This is for agent runtimes, not the local HTTP dashboard.',
  mcp:           'Usage: npx thumbgate mcp\n\nAlias for `thumbgate serve`.',
  dashboard:     'Usage: npx thumbgate dashboard [--window=today|7d|30d] [--open]\n\nPrint the operational dashboard summary or open the browser HTTP dashboard (use --open). Defaults to PORT=3456.',
  'start-api':   'Usage: npx thumbgate start-api\n\nStart the local ThumbGate HTTP API/dashboard. Defaults to PORT=8787; use PORT=3456 for statusline localhost links.',
  'export-dpo':  'Usage: npx thumbgate export-dpo [--format=jsonl|csv]\n\nExport feedback as DPO training pairs (Pro feature).',
  status:        'Usage: npx thumbgate status\n\nShow ThumbGate system health and active configuration.',
  watch:         'Usage: npx thumbgate watch\n\nWatch for feedback changes and auto-regenerate prevention rules.',
  compact:       'Usage: npx thumbgate compact\n\nCompact the lesson database and reclaim disk space.',
  'context-packs': 'Usage: npx thumbgate context-packs\n\nGenerate context packs from top failure patterns.',
  suggest:       'Usage: npx thumbgate suggest <gate-id>\n\nSuggest fixes for a specific gate based on lesson history.',
  inventory:     'Usage: npx thumbgate inventory [--json] [--days=N] [--data-dir=path] [--max-bytes=N]\n\nRead-only inventory of agent activity in this repo\'s ThumbGate store: agents seen, tool calls by tool, allow/deny counts, deny reasons per gate, top gates, per-day activity, and the false-deny rate.\n\nEvery source reports its own status (ok / empty / missing) so an uninstrumented store never looks like a quiet one. falseDenyRate is null with a stated reason whenever a real denominator was not observed; falseDenyNumerator and falseDenyDenominator are always emitted raw.\n\nEach source is read as a bounded tail (default 8 MiB, --max-bytes to change) so a multi-hundred-MB audit log is never loaded whole. If the tail did not reach back to the start of the window, windowFullyCovered is false and the text output says so.',
  'conflict-audit': 'Usage: npx thumbgate conflict-audit [--json] [--offline] [--repo-root=path] [--github-repo=owner/name] [--branch=main] [--consecutive-failures=N] [--excluded-lines=N] [--commits=N]\n\nDeterministic detector for controls that report success but enforce nothing. Six detectors, no model involved:\n\n  D1 gate configs declaring a `patterns` array when the engine reads `pattern` (the match block is skipped, so the gate fires on every tool in its toolNames)\n  D2 gate patterns that cannot compile (an inline (?i) flag group throws; the engine swallows the throw as "no match")\n  D3 checks required by NEITHER classic branch protection NOR any repository ruleset, which have failed on N or more consecutive recent commits\n  D4 sonar.exclusions / sonar.coverage.exclusions entries that hide non-trivial code inside sonar.sources from scanning\n  D5 modules and entry exports with zero production call sites outside their own tests (for a PUBLISHED package the entry surface is public API whose callers are downstream npm consumers, so those are reported NOT INSPECTED rather than dead)\n  D6 the bare `path.resolve(process.argv[1]) === path.resolve(__filename)` main check, which no-ops under an npm bin shim\n\nEvery detector reports its own status: `ran` (inspected), `partial` (some of the surface was not inspected, and which), or `unavailable` (could not inspect at all). An unavailable detector is NEVER reported as clean. D3 needs the `gh` CLI (resolved from a fixed install location, never through $PATH) plus read access to branch protection and repository rulesets; use --offline to skip it explicitly.',
  cost:          'Usage: npx thumbgate cost [--json] [--stats <path>] [--mix \'{"claude-sonnet-4-5":0.8,...}\']\n\nShow cumulative $ and tokens saved by PreToolUse gate blocks. Reads ~/.thumbgate/gate-stats.json.',
  savings:       'Usage: npx thumbgate savings [--json] [--stats <path>] [--mix \'{"claude-sonnet-4-5":0.8,...}\']\n\nAlias for `thumbgate cost`.',
  'setup-vertex': 'Usage: npx thumbgate setup-vertex [--dry-run]\n\nAuto-enable Vertex AI API on GCP and write local Vertex routing config to .env. With --dry-run, only detect the active account/project and print the planned changes. This does not create or verify a Dialogflow CX agent; use the Dialogflow CX REST API or console for live-agent evidence.',
  'ai-inventory': 'Usage: npx thumbgate ai-inventory [--root <dir>] [--format=summary|json|cyclonedx] [--output <path>] [--max-files=N]\n\nScan source/manifests/model artifacts for AI, ML, agent-framework, vector DB, Vertex, Gemini, and Dialogflow CX components. Use --format=cyclonedx to produce exportable ML-BOM evidence for enterprise reviews.',
  brain: 'Usage: npx thumbgate brain [--write] [--json] [--limit=N]\n\nBuild the agent-readable "context brain" — a single artifact consolidating this\nrepo\'s lessons, prevention rules, active gates, and project context for a coding\nagent to read BEFORE acting. --write saves it to .thumbgate/BRAIN.md (versioned,\ndeterministic). --json emits the structured model. --limit caps lessons (default 15).',
  'team-sync': 'Usage: npx thumbgate team-sync\n\nSynchronize prevention rules and context brain with your team\'s git repository (git pull --rebase & git push), then auto-rebuild the local brain.',
};

if (_wantsHelp && COMMAND && SUBCOMMAND_HELP[COMMAND]) {
  console.log(SUBCOMMAND_HELP[COMMAND]);
  process.exit(0);
}

// -----------------------------------------------------------------------------
// brain — consolidate ThumbGate's institutional memory (lessons + prevention
// rules + active gates + project context) into a single, versioned,
// agent-readable "context brain". The persistent context a coding agent should
// read BEFORE acting, so it stops repeating mistakes. Composes the existing
// explore-subcommands primitives; output is deterministic (no volatile
// timestamp) so `.thumbgate/BRAIN.md` diffs only when the underlying memory
// changes.
// -----------------------------------------------------------------------------
function buildBrainModel(opts = {}) {
  const { exploreLessons, exploreRules, exploreGates } = require(path.join(PKG_ROOT, 'scripts', 'explore-subcommands'));
  let feedbackDir;
  try {
    const { getFeedbackPaths } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
    feedbackDir = getFeedbackPaths().FEEDBACK_DIR;
  } catch (_) { feedbackDir = path.join(CWD, '.thumbgate'); }
  const limit = Math.max(1, Number(opts.limit) || 15);
  const safe = (fn, fallback) => { try { return fn(); } catch (_) { return fallback; } };
  const lessons = safe(() => exploreLessons({ feedbackDir, pkgRoot: PKG_ROOT, limit, json: true }), { lessons: [], total: 0 });
  const rules = safe(() => exploreRules({ feedbackDir, pkgRoot: PKG_ROOT, json: true }), { rules: [], total: 0 });
  const gates = safe(() => exploreGates({ feedbackDir, pkgRoot: PKG_ROOT, json: true }), { gates: [], total: 0 });
  const instructionFiles = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.cursorrules', '.thumbgate/config.json']
    .filter((f) => { try { return fs.existsSync(path.join(CWD, f)); } catch (_) { return false; } });
  return { lessons, rules, gates, project: { root: CWD, instructionFiles } };
}

function renderBrainMarkdown(model) {
  const out = [];
  out.push('# ThumbGate Context Brain');
  out.push('');
  out.push('<!-- The persistent context a coding agent should read BEFORE acting in this repo.');
  out.push('     Generated by `npx thumbgate brain`. Rebuild after capturing feedback. -->');
  out.push('');
  out.push('> Institutional memory for AI coding agents working here: what has been');
  out.push('> learned, what to avoid, and what is enforced. Read this first.');
  out.push('');

  out.push('## What this codebase taught its agents (lessons)');
  out.push('');
  const lessons = (model.lessons && model.lessons.lessons) || [];
  if (!lessons.length) {
    out.push('_No lessons captured yet. Run `npx thumbgate capture --feedback=down --context="what failed"`._');
  } else {
    for (const l of lessons) {
      const sig = String(l.signal || '').toLowerCase();
      const mark = (sig.includes('positive') || sig === 'up') ? '✅' : ((sig.includes('negative') || sig === 'down') ? '⛔' : '•');
      const enforced = l.confidence === 'active' ? ' _(enforced)_' : '';
      const ctx = String(l.context || '').replace(/\s+/g, ' ').trim().slice(0, 220);
      if (ctx) out.push(`- ${mark} ${ctx}${enforced}`);
    }
  }
  out.push('');

  out.push('## Guardrails — do NOT repeat these (prevention rules)');
  out.push('');
  const rules = (model.rules && model.rules.rules) || [];
  if (!rules.length) {
    out.push('_No prevention rules yet._');
  } else {
    for (const r of rules) {
      out.push(`- **${String(r.title || '').trim()}**`);
      const body = String(r.body || '').split('\n')[0].trim();
      if (body && body !== r.title) out.push(`  - ${body.slice(0, 200)}`);
    }
  }
  out.push('');

  out.push('## Active enforcement (gates)');
  out.push('');
  const gates = (model.gates && model.gates.gates) || [];
  if (!gates.length) {
    out.push('_No active gates._');
  } else {
    for (const g of gates) {
      const occ = g.occurrences ? ` (${g.occurrences}×)` : '';
      out.push(`- \`${g.pattern || g.id}\` → **${g.action}**${occ}`);
    }
  }
  out.push('');

  out.push('## Project context');
  out.push('');
  out.push(`- Repo root: \`${model.project.root}\``);
  const files = model.project.instructionFiles;
  out.push(`- Agent instruction files: ${files.length ? files.map((f) => '`' + f + '`').join(', ') : '_none detected_'}`);
  out.push('');
  out.push('---');
  const lt = (model.lessons && model.lessons.total) || 0;
  const rt = (model.rules && model.rules.total) || 0;
  const gt = (model.gates && model.gates.total) || 0;
  out.push(`_${lt} lessons · ${rt} rules · ${gt} gates. Rebuild with \`npx thumbgate brain --write\`._`);
  out.push('');
  return out.join('\n');
}

function cmdBrain(args = {}) {
  const model = buildBrainModel({ limit: args.limit });
  if (args.json) { console.log(JSON.stringify(model, null, 2)); return 0; }
  const md = renderBrainMarkdown(model);
  if (args.write) {
    const dir = path.join(CWD, '.thumbgate');
    const target = path.join(dir, 'BRAIN.md');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, md);
    } catch (err) {
      // Surface a clean, actionable error instead of an uncaught stack trace
      // (e.g. permission denied, read-only filesystem).
      console.error(`Could not write ${target}: ${err && err.message ? err.message : err}`);
      return 1;
    }
    const lt = (model.lessons && model.lessons.total) || 0;
    const rt = (model.rules && model.rules.total) || 0;
    const gt = (model.gates && model.gates.total) || 0;
    console.log(`\u{1f9e0} Wrote context brain to .thumbgate/BRAIN.md (${lt} lessons · ${rt} rules · ${gt} gates).`);
    console.log('   Point your agent at it: add "Read .thumbgate/BRAIN.md first" to CLAUDE.md / AGENTS.md.');
    return 0;
  }
  process.stdout.write(md);
  return 0;
}

async function teamSync() {
  const { execSync } = require('child_process');

  // Verify we are in a Git repo
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore', cwd: CWD });
  } catch (err) {
    console.error('❌ Error: The current directory is not a Git repository.');
    process.exit(1);
  }

  console.log('🔄 Checking shared prevention rules status...');

  const rulesRelative = '.thumbgate/prevention-rules.md';
  const brainRelative = '.thumbgate/BRAIN.md';
  const rulesPath = path.join(CWD, rulesRelative);

  if (!fs.existsSync(rulesPath)) {
    console.log('⚠️  No local prevention rules file found to sync.');
  }

  let statusOutput = '';
  try {
    statusOutput = execSync('git status --porcelain', { encoding: 'utf8', cwd: CWD }) || '';
  } catch (_) {}
  const hasLocalChanges = statusOutput.includes(rulesRelative) || statusOutput.includes(brainRelative) || statusOutput.includes('.thumbgate/');

  if (hasLocalChanges) {
    console.log('📝 Local changes detected in prevention rules. Committing locally...');
    try {
      const filesToAdd = [rulesRelative, brainRelative].filter(f => fs.existsSync(path.join(CWD, f)));
      if (filesToAdd.length > 0) {
        const filesStr = filesToAdd.map(f => `"${f}"`).join(' ');
        execSync(`git add -f ${filesStr}`, { cwd: CWD });
        execSync('git commit -m "chore(thumbgate): update shared prevention rules [skip ci]"', { cwd: CWD });
        console.log('✅ Local rules committed successfully.');
      } else {
        console.log('✨ No local rules files exist to commit.');
      }
    } catch (e) {
      console.log('✨ No changes to commit (already staged/clean).');
    }
  } else {
    console.log('✨ No local rules changes to commit.');
  }

  // Pull from remote
  console.log('📥 Pulling rules from teammate remote (git pull --rebase)...');
  try {
    execSync('git pull --rebase', { stdio: 'inherit', cwd: CWD });
  } catch (pullErr) {
    console.error('❌ Git pull failed. Please resolve conflicts manually.');
    process.exit(1);
  }

  // Push to remote
  console.log('📤 Pushing rules to teammate remote (git push)...');
  try {
    execSync('git push', { stdio: 'inherit', cwd: CWD });
  } catch (pushErr) {
    console.error('❌ Git push failed. You may need to run git push manually.');
    process.exit(1);
  }

  // Rebuild the context brain (.thumbgate/BRAIN.md) from the newly merged rules
  console.log('🧠 Rebuilding local context brain from merged rules...');
  try {
    const brainArgs = { write: true };
    cmdBrain(brainArgs);
  } catch (brainErr) {
    console.warn(`⚠️  Failed to rebuild context brain: ${brainErr.message}`);
  }

  console.log('\n🚀 Team rules synchronization complete! Your agents now share team-wide learning.');
}

switch (COMMAND) {
  case 'team-sync':
  case 'git-sync':
    teamSync().catch((err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });
    break;
  case '--version':
  case '-v':
  case 'version':
    console.log(pkgVersion());
    break;
  case 'init':
    init();
    upgradeNudge();
    break;
  case 'quickstart':
  case 'first-rule':
    quickstart();
    break;
  case 'quick-start':
    quickStart();
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
  case 'cleanup':
    cleanup();
    break;
  case 'sync-gcp':
    syncGcp();
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
  case 'claim-stop-check':
    claimStopCheckCmd();
    break;
  case 'session-start':
    sessionStart();
    break;
  case 'capture':
  case 'feedback':
    capture();
    upgradeNudge();
    break;
  case 'feedback-self-test':
  case 'dogfood':
    feedbackSelfTest();
    break;
  case 'setup-vertex':
    setupVertex(parseArgs(process.argv.slice(3))).catch((err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });
    break;
  case 'stats':
    stats();
    upgradeNudge();
    break;
  case 'cfo':
  case 'revenue':
    cfo();
    break;
  case 'cost':
  case 'savings':
  case 'costs': {
    const { main: costMain } = require(path.join(PKG_ROOT, 'scripts', 'cost-cli'));
    process.exit(costMain(process.argv.slice(3)));
    // process.exit doesn't return, but keep an explicit break so the switch
    // cannot accidentally fall through to case 'billing:setup' if a future
    // refactor wraps costMain in try/finally that intercepts the exit, or
    // a test runner stubs process.exit (flagged by gitar-bot on PR #2281).
    break;
  }
  case 'brain': {
    const sub = process.argv.slice(3).find((arg) => !arg.startsWith('--'));
    if (sub && ['init', 'context', 'remember', 'check', 'cleanup', 'status'].includes(sub)) {
      brain();
    } else {
      const brainArgs = parseArgs(process.argv.slice(3));
      process.exitCode = cmdBrain(brainArgs);
    }
    break;
  }
  case 'billing:setup':
    require(path.join(PKG_ROOT, 'scripts', 'billing-setup'));
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
  case 'notes': {
    const { cli: notesCli } = require(path.join(PKG_ROOT, 'scripts', 'implementation-notes'));
    notesCli(process.argv.slice(3));
    break;
  }
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
  case 'gemini-embedding-plan':
  case 'embedding-plan':
    geminiEmbeddingPlan();
    break;
  case 'agent-design-governance':
  case 'agent-architecture':
  case 'agent-governance-plan':
    agentDesignGovernance();
    break;
  case 'proactive-agent-eval-guardrails':
  case 'pare-guardrails':
  case 'proactive-agent-guardrails':
    proactiveAgentEvalGuardrails();
    break;
  case 'reward-hacking-guardrails':
  case 'proxy-reward-guardrails':
  case 'reward-guardrails':
    rewardHackingGuardrails();
    break;
  case 'oss-pr-opportunity-scout':
  case 'github-pr-scout':
  case 'upstream-pr-scout':
    ossPrOpportunityScout();
    break;
  case 'chatgpt-ads-readiness-pack':
  case 'chatgpt-ads-plan':
  case 'ai-ads-plan':
    chatgptAdsReadinessPack();
    break;
  case 'model-candidates':
  case 'managed-models':
    modelCandidatesCmd();
    break;
  case 'bench':
  case 'benchmark':
    benchCmd();
    break;
  case 'upstream-contributions':
  case 'upstream-contribution-engine':
  case 'upstream-prs':
  case 'oss-pr-opportunities':
    upstreamContributions();
    break;
  case 'risk':
    risk();
    break;
  case 'doctor': {
    const {
      generateAgentReadinessReport,
      reportToText,
    } = require(path.join(PKG_ROOT, 'scripts', 'agent-readiness'));
    const { wiringReport, formatReport } = require(path.join(PKG_ROOT, 'scripts', 'mcp-wiring-doctor'));
    const args = parseArgs(process.argv.slice(3));
    const report = generateAgentReadinessReport({ projectRoot: CWD });
    const wiring = wiringReport(CWD);
    if (args.json) {
      console.log(JSON.stringify({ ...report, wiring }, null, 2));
    } else {
      process.stdout.write(reportToText(report));
      process.stdout.write(`\n${formatReport(wiring)}\n`);
    }
    const ready = report.overallStatus === 'ready' && wiring.overall !== 'error';
    process.exit(ready ? 0 : 1);
    break;
  }
  case 'compass':
  case 'pipeline':
  case 'pipeline-compass': {
    const { getPipelineCompass, formatPipelineCompass } = require(path.join(PKG_ROOT, 'src', 'pipeline-compass'));
    const args = parseArgs(process.argv.slice(3));
    const report = getPipelineCompass({ projectRoot: CWD });
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatPipelineCompass(report));
    process.exit(report.ready ? 0 : 1);
    break;
  }
  case 'writeguard':
  case 'mcp-writeguard': {
    const { main } = require(path.join(PKG_ROOT, 'scripts', 'mcp-writeguard'));
    main();
    break;
  }
  case 'latency':
  case 'latency-budget': {
    const { main } = require(path.join(PKG_ROOT, 'scripts', 'latency-budget'));
    main();
    break;
  }
  case 'wiring-doctor':
  case 'mcp-wiring-doctor': {
    const { wiringReport, formatReport, applyFix } = require(path.join(PKG_ROOT, 'scripts', 'mcp-wiring-doctor'));
    const args = parseArgs(process.argv.slice(3));
    if (args.fix) applyFix(CWD);
    const wiring = wiringReport(CWD);
    if (args.json) console.log(JSON.stringify(wiring, null, 2));
    else console.log(formatReport(wiring));
    process.exit(wiring.overall === 'error' ? 2 : wiring.overall === 'warning' ? 1 : 0);
    break;
  }
  case 'security-central':
  case 'security:central':
  case 'agent-security-central': {
    const {
      buildSecurityCentralReport,
      formatSecurityCentralReport,
    } = require(path.join(PKG_ROOT, 'scripts', 'agent-security-central'));
    const args = parseArgs(process.argv.slice(3));
    const report = buildSecurityCentralReport({ projectRoot: CWD });
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatSecurityCentralReport(report));
    process.exit(report.posture.band === 'critical' ? 2 : report.posture.band === 'at_risk' ? 1 : 0);
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
  case 'import-doc':
  case 'import-document':
    importDoc();
    break;
  case 'rules':
    rules();
    break;
  case 'context-packs':
    contextPacks();
    break;
  case 'harness-audit':
  case 'harness':
    harnessAudit();
    break;
  case 'native-messaging-audit':
  case 'bridge-audit':
    nativeMessagingAudit();
    break;
  case 'code-graph-guardrails':
  case 'knowledge-graph-guardrails':
  case 'graph-guardrails':
    codeGraphGuardrails();
    break;
  case 'proxy-pointer-rag-guardrails':
  case 'document-rag-guardrails':
  case 'multimodal-rag-guardrails':
    proxyPointerRagGuardrails();
    break;
  case 'rag-precision-guardrails':
  case 'retrieval-precision-guardrails':
  case 'agentic-rag-guardrails':
    ragPrecisionGuardrails();
    break;
  case 'ai-engineering-stack-guardrails':
  case 'ai-stack-guardrails':
  case 'internal-ai-stack-guardrails':
  case 'llm-wiki-guardrails':
    aiEngineeringStackGuardrails();
    break;
  case 'ai-inventory':
  case 'ai-component-inventory':
  case 'ml-bom':
  case 'mlbom':
    aiInventory();
    break;
  case 'deepseek-v4-runtime-guardrails':
  case 'deepseek-runtime-guardrails':
  case 'sparse-attention-runtime-guardrails':
    deepseekV4RuntimeGuardrails();
    break;
  case 'nvidia-specdecode-al-doctor':
  case 'specdecode-al-doctor':
  case 'speculative-decoding-al-doctor':
  case 'nvidia-speculative-decoding-doctor':
    nvidiaSpecDecodeAlDoctor();
    break;
  case 'package-manager-honesty-doctor':
  case 'pm-honesty-doctor':
  case 'pnpm12-honesty-doctor':
  case 'lockfile-ci-parity-doctor':
    packageManagerHonestyDoctor();
    break;
  case 'workspace-search-route':
  case 'zg-search-route':
  case 'zvec-grep-route':
  case 'search-route':
    workspaceSearchRoute();
    break;
  case 'long-running-agent-context-guardrails':
  case 'agent-context-guardrails':
  case 'slack-context-guardrails':
    longRunningAgentContextGuardrails();
    break;
  case 'reasoning-efficiency-guardrails':
  case 'sas-guardrails':
  case 'reasoning-compression-guardrails':
    reasoningEfficiencyGuardrails();
    break;
  case 'background-governance':
  case 'background-agent-governance':
  case 'agent-governance':
    backgroundGovernance();
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
  case 'workflow':
  case 'swarm': {
    const args = parseArgs(process.argv.slice(3));
    let objective = args.objective;
    if (!objective) {
      const firstPositional = process.argv.slice(3).find((a, idx, arr) => {
        if (a.startsWith('--')) return false;
        const prev = arr[idx - 1];
        if (prev && prev.startsWith('--') && !prev.includes('=')) return false;
        return true;
      });
      if (firstPositional) objective = firstPositional;
    }
    if (!objective) {
      console.error('Error: objective is required. Run with --objective="your objective" or provide it as a positional argument.');
      process.exit(1);
    }
    const { executeWorkflow } = require(path.join(PKG_ROOT, 'scripts', 'parallel-workflow-orchestrator'));
    const concurrency = args.concurrency ? Number(args.concurrency) : undefined;
    const timeoutMs = args.timeoutMs ? Number(args.timeoutMs) : undefined;
    executeWorkflow(objective, { concurrency, timeoutMs, cwd: CWD })
      .then((res) => {
        if (args.json) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(`\n✅ Parallel workflow execution complete.`);
          console.log(`  Workflow ID: ${res.workflowId}`);
          console.log(`  Objective  : ${res.objective}`);
          console.log(`  Duration   : ${(res.durationMs / 1000).toFixed(2)}s`);
          console.log(`  Report Path: ${res.reportPath}`);
          console.log(`\nReport Summary:\n`);
          console.log(fs.readFileSync(res.reportPath, 'utf8'));
        }
        process.exit(0);
      })
      .catch((err) => {
        console.error('Workflow execution failed:', err.message);
        process.exit(1);
      });
    break;
  }
  case 'trial': {
    // Show trial status — connects the 4K monthly npm installers to checkout
    const { isProTier, isInTrialPeriod, trialDaysRemaining, getInstallAgeDays } = require(path.join(PKG_ROOT, 'scripts', 'rate-limiter'));
    const ageDays = getInstallAgeDays();
    const inTrial = isInTrialPeriod();
    const remaining = trialDaysRemaining();
    const isPro = isProTier();
    console.log('');
    console.log('  ThumbGate Pro Trial');
    console.log('  ──────────────────');
    if (isPro && !inTrial) {
      console.log('  Status: ✅ Pro (active license or API key)');
    } else if (inTrial) {
      const expiryDate = new Date(Date.now() + remaining * 86400000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      console.log(`  Status: 🎁 Active (${remaining} day${remaining === 1 ? '' : 's'} remaining)`);
      console.log(`  Expires: ${expiryDate}`);
      console.log('');
      console.log('  All Pro features unlocked:');
      console.log('    • Unlimited prevention rules (free tier: 5)');
      console.log('    • Recall, lesson search, DPO export');
      console.log('    • Cross-machine sync via API key');
    } else {
      console.log('  Status: ⏰ Expired');
      if (ageDays !== null) {
        console.log(`  Installed: ${Math.floor(ageDays)} days ago`);
      }
      console.log('');
      console.log('  Free tier: 5 active rules, no recall/search/export');
    }
    console.log('');
    console.log(`  Keep Pro: ${PRO_CHECKOUT_URL}`);
    console.log(`  Or set: THUMBGATE_API_KEY=<your-key>`);
    console.log('');
    break;
  }
  case 'pro':
    pro();
    break;
  case 'diagnostic':
  case 'workflow-diagnostic':
  case 'sprint-diagnostic':
    diagnostic();
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
  case 'break-glass':
  case 'breakglass':
    breakGlass();
    break;
  case 'funnel':
    funnel();
    break;
  case 'pulse':
    pulse();
    break;
  case 'check-update':
  case 'upgrade-check':
    checkUpdateCmd();
    break;
  case 'self-update':
  case 'upgrade-cli':
    selfUpdateCmd();
    break;
  case 'dispatch':
  case 'dispatch-brief':
    dispatchBrief();
    break;
  case 'hermes-gate': {
    // Nous Research Hermes Agent `pre_tool_call` shell hook.
    // Hermes pipes each pending tool call as JSON to stdin and reads a decision from stdout;
    // {"decision":"block","reason":...} vetoes the call. We reuse the SAME gate pipeline as
    // `gate-check` (runAsync → secret guard, security scan, force-push / skill_manage / learned
    // prevention rules) and translate the verdict into Hermes's format.
    //
    // Hermes `pre_tool_call` is binary (block or allow) with no warn channel, and the whole point
    // of wiring it is to gate, so we run STRICT enforcement by default — otherwise ThumbGate's
    // warn-by-default posture would pass every deny through and the hook would block nothing.
    // Opt out with THUMBGATE_HERMES_WARN_ONLY=1; the operator bypass also leaves ordinary gates advisory.
    // Wire it in ~/.hermes/config.yaml — see adapters/hermes/config.yaml.
    if (process.env.THUMBGATE_HERMES_WARN_ONLY !== '1' && process.env.THUMBGATE_HOTFIX_BYPASS !== '1') {
      process.env.THUMBGATE_STRICT_ENFORCEMENT = '1';
    }
    const { runAsync: hermesGateRun } = require(path.join(PKG_ROOT, 'scripts', 'gates-engine'));
    let hermesStdin = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { hermesStdin += chunk; });
    process.stdin.on('end', async () => {
      try {
        const payload = JSON.parse(hermesStdin);
        const hermesToolName = String(payload.tool_name || '');
        const canonicalToolNames = {
          terminal: 'Bash',
          process: 'Bash',
          execute_code: 'Bash',
          patch: 'Edit',
          write_file: 'Write',
          read_file: 'Read',
        };
        const verdict = await hermesGateRun({
          tool_name: canonicalToolNames[hermesToolName] || hermesToolName,
          tool_input: {
            ...(payload.tool_input || {}),
            hermes_tool_name: hermesToolName,
          },
        });
        let parsed = {};
        try { parsed = JSON.parse(verdict); } catch (_e) { parsed = {}; }
        const hso = parsed.hookSpecificOutput || {};
        if (hso.permissionDecision === 'deny') {
          process.stdout.write(JSON.stringify({
            decision: 'block',
            reason: hso.permissionDecisionReason || 'Blocked by ThumbGate prevention rule.',
          }) + '\n');
        } else {
          // warn / no match → allow. The gate engine already logged the decision.
          process.stdout.write(JSON.stringify({}) + '\n');
        }
        process.exit(0);
      } catch (err) {
        // Hermes hooks fail OPEN on error/timeout — emit an explicit allow so a gate fault
        // never wedges the agent (reliability ≈ enforcement; keep this fast).
        process.stderr.write(`hermes-gate error: ${err.message}\n`);
        process.stdout.write(JSON.stringify({}) + '\n');
        process.exit(0);
      }
    });
    break;
  }
  case 'gate-stats':
    gateStats();
    break;
  case 'verify-claims':
  case 'verify-claim':
    verifyClaimsCmd();
    break;
  case 'eval':
  case 'prompt-eval':
    evalCmd();
    break;
  case 'explore': {
    const subCmd = process.argv[3];
    const exploreArgs = parseArgs(process.argv.slice(3));
    // If a known subcommand is given (or --json), use non-interactive mode
    const knownSubs = ['lessons', 'rules', 'gates', 'firings'];
    if (knownSubs.includes(subCmd) || exploreArgs.json) {
      const { exploreLessons, exploreRules, exploreGates, exploreGateFirings } = require(path.join(PKG_ROOT, 'scripts', 'explore-subcommands'));
      const { getFeedbackPaths } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
      const { FEEDBACK_DIR } = getFeedbackPaths();
      const subOptions = {
        feedbackDir: FEEDBACK_DIR,
        pkgRoot: PKG_ROOT,
        limit: Number(exploreArgs.limit || 20),
        json: Boolean(exploreArgs.json),
      };
      const effectiveSub = knownSubs.includes(subCmd) ? subCmd : 'lessons';
      let output;
      switch (effectiveSub) {
        case 'lessons': output = exploreLessons(subOptions); break;
        case 'rules':   output = exploreRules(subOptions); break;
        case 'gates':   output = exploreGates(subOptions); break;
        case 'firings': output = exploreGateFirings(subOptions); break;
        default:        output = exploreLessons(subOptions); break;
      }
      if (exploreArgs.json) {
        console.log(JSON.stringify(output, null, 2));
      } else {
        process.stdout.write(output);
      }
    } else {
      // No subcommand and no --json → launch interactive TUI
      const { run: runExplore } = require(path.join(PKG_ROOT, 'scripts', 'explore'));
      runExplore();
    }
    break;
  }
  case 'demo': {
    const demoArgs = parseArgs(process.argv.slice(3));
    const { runDemo } = require(path.join(PKG_ROOT, 'scripts', 'cli-demo'));
    const demoOutput = runDemo({ json: Boolean(demoArgs.json) });
    if (demoArgs.json) {
      console.log(JSON.stringify(demoOutput, null, 2));
    } else {
      process.stdout.write(demoOutput);
    }
    break;
  }
  case 'audit': {
    const auditFile = process.argv[3];
    if (!auditFile) {
      console.error('Usage: npx thumbgate audit <path-to-transcript.txt>');
      process.exit(1);
    }
    const { runAudit } = require(path.join(PKG_ROOT, 'scripts', 'audit'));
    const { results, totalWaste, error } = runAudit(auditFile);
    if (error) {
      console.error(error);
      process.exit(1);
    }
    console.log('\n🔍 AI Bill Audit Results\n');
    if (results.length === 0) {
      console.log('✅ No repeat-offender patterns found. Your sessions are efficient!');
    } else {
      console.table(results);
      console.log('\n💰 Total estimated monthly waste: $' + totalWaste);
      console.log('\nBlock these mistakes permanently with ThumbGate Pro:');
      console.log(PRO_CHECKOUT_URL);
    }
    break;
  }
  case 'dashboard':
    dashboard();
    break;
  case 'artifact':
  case 'artifacts':
    artifacts();
    break;
  case 'analytics': {
    const { run: runAnalytics } = require(path.join(PKG_ROOT, 'scripts', 'analytics-report'));
    runAnalytics();
    break;
  }
  case 'inventory': {
    // Read-only rollup of what agents did in this repo's ThumbGate store:
    // tool calls, allow/deny counts, deny reasons per gate, per-day activity,
    // and the false-deny rate (null when it cannot be honestly computed).
    const inventoryArgs = parseArgs(process.argv.slice(3));
    const {
      buildInventory,
      renderInventoryText,
    } = require(path.join(PKG_ROOT, 'scripts', 'agent-action-inventory'));
    const { resolveFeedbackDir } = require(path.join(PKG_ROOT, 'scripts', 'feedback-paths'));
    const inventory = buildInventory({
      dataDir: inventoryArgs['data-dir'] || resolveFeedbackDir(),
      windowDays: inventoryArgs.days,
      maxBytes: inventoryArgs['max-bytes'] ? Number(inventoryArgs['max-bytes']) : undefined,
    });
    if (inventoryArgs.json) {
      console.log(JSON.stringify(inventory, null, 2));
    } else {
      process.stdout.write(renderInventoryText(inventory));
    }
    break;
  }
  case 'conflict-audit': {
    // Deterministic sweep for controls that report success but enforce
    // nothing. Each detector reports its own status, so a surface that could
    // not be inspected is never rendered as a clean bill of health.
    const conflictArgs = parseArgs(process.argv.slice(3));
    const {
      auditGovernanceConflicts,
      renderConflictAuditText,
    } = require(path.join(PKG_ROOT, 'scripts', 'governance-conflict-audit'));
    const conflictReport = auditGovernanceConflicts({
      repoRoot: conflictArgs['repo-root'] || process.cwd(),
      gitHubRepo: conflictArgs['github-repo'],
      branch: conflictArgs.branch,
      consecutiveFailureThreshold: conflictArgs['consecutive-failures'],
      excludedLineThreshold: conflictArgs['excluded-lines'],
      commitLimit: conflictArgs.commits,
      offline: Boolean(conflictArgs.offline),
    });
    if (conflictArgs.json) {
      console.log(JSON.stringify(conflictReport, null, 2));
    } else {
      process.stdout.write(`${renderConflictAuditText(conflictReport)}\n`);
    }
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
  case 'subscribe': {
    // Capture an installer's email so we can send the 5-minute setup
    // guide + weekly tips. Drops to /v1/marketing/install-email on the
    // hosted endpoint; the server fires sendNewsletterWelcomeEmail via
    // Resend and persists the address for follow-up.
    //
    // Usage:
    //   npx thumbgate subscribe you@company.com
    //   npx thumbgate subscribe --email=you@company.com
    //
    // Never prompts interactively — postinstall must stay non-interactive
    // for CI safety. This is the deliberate opt-in path the banner points
    // at; if the operator runs it, they want the email.
    const args = process.argv.slice(3);
    let email = '';
    for (const arg of args) {
      if (arg.startsWith('--email=')) email = arg.slice('--email='.length).trim();
      else if (!arg.startsWith('--')) email = arg.trim();
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error('Usage: npx thumbgate subscribe <email>');
      console.error('       npx thumbgate subscribe --email=you@company.com');
      console.error('');
      console.error('We send a 5-minute setup guide + weekly tips. One-click unsubscribe.');
      process.exit(1);
    }
    const endpoint = process.env.THUMBGATE_INSTALL_EMAIL_ENDPOINT
      || 'https://thumbgate.ai/v1/marketing/install-email';
    const payload = JSON.stringify({
      email,
      source: 'cli_subscribe',
      installId: (() => {
        try {
          const configPath = path.join(CWD, '.thumbgate', 'config.json');
          if (!fs.existsSync(configPath)) return null;
          return (JSON.parse(fs.readFileSync(configPath, 'utf8')).installId) || null;
        } catch { return null; }
      })(),
      cliVersion: pkgVersion(),
    });
    const url = new URL(endpoint);
    const transport = url.protocol === 'https:' ? require('node:https') : require('node:http');
    const req = transport.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': `thumbgate-cli/${pkgVersion()}`,
      },
      timeout: 8000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`✓ Subscribed ${email}.`);
          console.log('  Check your inbox in ~30 seconds for the setup guide.');
          console.log('  Unsubscribe link is in every email.');
          process.exit(0);
        } else {
          console.error(`✗ Subscribe failed: HTTP ${res.statusCode}${body ? ` — ${body.slice(0, 200)}` : ''}`);
          process.exit(2);
        }
      });
    });
    req.on('error', (err) => {
      console.error(`✗ Subscribe failed: ${err.message}`);
      console.error('  Network issue? Try again, or email support@thumbgate.ai directly.');
      process.exit(3);
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout after 8000ms'));
    });
    req.write(payload);
    req.end();
    break;
  }
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
