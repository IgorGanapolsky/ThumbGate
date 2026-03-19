#!/usr/bin/env node
/**
 * mcp-memory-gateway CLI
 *
 * Usage:
 *   npx mcp-memory-gateway init          # scaffold .rlhf/ config + .mcp.json
 *   npx mcp-memory-gateway init --wire-hooks          # wire hooks only (auto-detect agent)
 *   npx mcp-memory-gateway init --agent claude-code   # scaffold + wire hooks for specific agent
 *   npx mcp-memory-gateway capture       # capture feedback
 *   npx mcp-memory-gateway export-dpo    # export DPO training pairs
 *   npx mcp-memory-gateway export-databricks   # export Databricks-ready analytics bundle
 *   npx mcp-memory-gateway stats         # feedback analytics + Revenue-at-Risk
 *   npx mcp-memory-gateway cfo           # local operational billing summary
 *   npx mcp-memory-gateway pro           # upgrade to Context Gateway
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { resolveMcpEntry } = require(path.join(__dirname, '..', 'scripts', 'mcp-config'));

const COMMAND = process.argv[2];
const CWD = process.cwd();
const PKG_ROOT = path.join(__dirname, '..');

const PRO_URL = 'https://rlhf-feedback-loop-production.up.railway.app';

function appendLocalTelemetry(payload) {
  try {
    const { getFeedbackPaths } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
    const { appendTelemetryPing } = require(path.join(PKG_ROOT, 'scripts', 'telemetry-analytics'));
    const { FEEDBACK_DIR } = getFeedbackPaths();
    appendTelemetryPing(FEEDBACK_DIR, payload);
  } catch (_) { /* telemetry is best-effort */ }
}

function telemetryPing(installId) {
  if (process.env.RLHF_NO_TELEMETRY === '1') return;
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
  const apiUrl = process.env.RLHF_API_URL || 'https://rlhf-feedback-loop-production.up.railway.app';
  const payload = JSON.stringify(payloadObject);
  try {
    const url = new URL('/v1/telemetry/ping', apiUrl);
    const mod = url.protocol === 'https:' ? require('https') : require('http');
    const req = mod.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 3000 }, () => {});
    req.on('error', () => {});
    req.on('timeout', () => { req.destroy(); });
    req.end(payload);
  } catch (_) { /* telemetry is best-effort */ }
}

function proNudge() {
  if (process.env.RLHF_NO_NUDGE === '1') return;
  // Write to stderr so it never contaminates MCP stdio JSON on stdout
  process.stderr.write(
    '\n💡 Like this? Go Pro — hosted dashboard, auto-gate promotion, unlimited gates. $49 one-time.\n' +
    `   → ${PRO_URL}\n\n`
  );
}

function limitNudge(action) {
  process.stderr.write(
    `\nFree tier: ${action} daily limit reached (5/day).\n` +
    `   Upgrade to Pro for unlimited usage: ${PRO_URL}\n` +
    '   Or set RLHF_API_KEY or RLHF_PRO_MODE=1 to bypass.\n\n'
  );
}

function parseArgs(argv) {
  const args = {};
  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length ? rest.join('=') : true;
  });
  return args;
}

function pkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

// --- Platform auto-detection helpers ---

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const MCP_SERVER_NAME = 'rlhf';
const LEGACY_MCP_SERVER_NAMES = ['rlhf', 'rlhf-feedback-loop', 'rlhf_feedback_loop'];

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
  const sections = LEGACY_MCP_SERVER_NAMES.map((name) => ({
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

  for (const legacyName of LEGACY_MCP_SERVER_NAMES) {
    if (legacyName === MCP_SERVER_NAME) continue;
    if (Object.prototype.hasOwnProperty.call(existing.mcpServers, legacyName)) {
      delete existing.mcpServers[legacyName];
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
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.log('  Claude Code: installed Stop hook in .claude/settings.json');
    hooksChanged = true;
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

    for (const legacyName of LEGACY_MCP_SERVER_NAMES) {
      if (legacyName === MCP_SERVER_NAME) continue;
      if (Object.prototype.hasOwnProperty.call(settings.mcpServers, legacyName)) {
        delete settings.mcpServers[legacyName];
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
  const skillDir = path.join(CWD, '.amp', 'skills', 'rlhf-feedback');
  const destPath = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(destPath)) return false;
  const srcPath = path.join(PKG_ROOT, 'plugins', 'amp-skill', 'SKILL.md');
  if (!fs.existsSync(srcPath)) return false;
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  console.log('  Amp: installed .amp/skills/rlhf-feedback/SKILL.md');
  return true;
}

function setupCursor() {
  return mergeMcpJson(path.join(CWD, '.cursor', 'mcp.json'), 'Cursor', 'project');
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

  const rlhfDir = path.join(CWD, '.rlhf');
  const configPath = path.join(rlhfDir, 'config.json');

  if (!fs.existsSync(rlhfDir)) {
    fs.mkdirSync(rlhfDir, { recursive: true });
    console.log('Created .rlhf/');
  } else {
    console.log('.rlhf/ already exists — updating config');
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
    apiUrl: process.env.RLHF_API_URL || 'http://localhost:3000',
    logPath: '.rlhf/feedback-log.jsonl',
    memoryPath: '.rlhf/memory-log.jsonl',
    installId: existingInstallId || crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log('Wrote .rlhf/config.json');

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
    console.log(`  ChatGPT: import ${path.relative(CWD, chatgptSpec)} in GPT Builder > Actions`);
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
    const entries = ['.rlhf/feedback-log.jsonl', '.rlhf/memory-log.jsonl'];
    const missing = entries.filter((e) => !gitignore.includes(e));
    if (missing.length > 0) {
      fs.appendFileSync(gitignorePath, '\n# RLHF local feedback data\n' + missing.join('\n') + '\n');
      console.log('Updated .gitignore');
    }
  }

  console.log('');
  console.log(`mcp-memory-gateway v${pkgVersion()} initialized.`);
  console.log('Run: npx mcp-memory-gateway help');
  proNudge();

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

  const capLimit = checkLimit('capture_feedback');
  if (!capLimit.allowed) {
    limitNudge('capture_feedback');
    process.exit(1);
  }

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
    console.log(`\nRLHF Feedback Captured [${normalized.toUpperCase()}]`);
    console.log('─'.repeat(50));
    console.log(`  Feedback ID : ${ev.id}`);
    console.log(`  Signal      : ${ev.signal} (${ev.actionType})`);
    console.log(`  Memory ID   : ${mem.id}`);
    console.log(`  Storage     : JSONL log + LanceDB vector index\n`);
    proNudge();
  } else {
    console.log(`\nRLHF Feedback Recorded [${normalized.toUpperCase()}] — not promoted`);
    console.log('─'.repeat(50));
    console.log(`  Reason      : ${result.reason}\n`);
    process.exit(2);
  }
}

function stats() {
  const { analyzeFeedback } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const data = analyzeFeedback();
  
  console.log('\n📊 RLHF Performance Metrics');
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
    console.log('  Action Required: Run "npx mcp-memory-gateway rules" to generate guardrails.');
    console.log('  Strategic Recommendation: Upgrade to Context Gateway to sync these rules across your team.');
    console.log('  Run: npx mcp-memory-gateway pro');
  } else {
    console.log('\n✅ System is currently high-reliability. No immediate revenue loss detected.');
  }
  proNudge();
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
  const { getFeedbackPaths } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const { summarizeWorkflowRuns } = require(path.join(PKG_ROOT, 'scripts', 'workflow-runs'));
  const { getBillingSummary } = require(path.join(PKG_ROOT, 'scripts', 'billing'));
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const summary = summarizeWorkflowRuns(FEEDBACK_DIR);
  const billing = getBillingSummary();

  console.log('\nNorth Star');
  console.log('─'.repeat(40));
  console.log(`Weekly proof-backed workflow runs : ${summary.weeklyActiveProofBackedWorkflowRuns}`);
  console.log(`Weekly teams on proof-backed runs : ${summary.weeklyTeamsRunningProofBackedWorkflows}`);
  console.log(`Reviewed workflow runs            : ${summary.reviewedRuns}`);
  console.log(`Named pilot agreements            : ${summary.namedPilotAgreements}`);
  console.log(`Paid team runs                    : ${summary.paidTeamRuns}`);
  console.log(`Paid orders                       : ${billing.revenue.paidOrders}`);
  console.log(`Booked revenue                    : $${(billing.revenue.bookedRevenueCents / 100).toFixed(2)}`);
  console.log(`Customer proof                    : ${summary.customerProofReached ? 'present' : 'missing'}`);
  console.log(`North Star status                 : ${summary.northStarReached ? 'tracking' : 'not_started'}`);
  if (summary.latestRun) {
    console.log(`Latest proof-backed run           : ${summary.latestRun.workflowId} @ ${summary.latestRun.timestamp}`);
  }
  console.log('');
}

function pro() {
  const hostedUrl = 'https://rlhf-feedback-loop-production.up.railway.app';
  const truthUrl = 'https://github.com/IgorGanapolsky/mcp-memory-gateway/blob/main/docs/COMMERCIAL_TRUTH.md';
  console.log('\nMCP Memory Gateway — Commercial Truth');
  console.log('─'.repeat(50));
  console.log('Self-serve offer today: Pro ($49 one-time).');
  console.log('Hosted Context Gateway access is pilot/by-request.');
  console.log('\nWhat is available:');
  console.log('  - Pro: hosted dashboard, auto-gate promotion, unlimited custom gates, multi-repo sync');
  console.log('  - Hosted demo: public product surface and onboarding shell');
  console.log('  - Commercial truth doc: source of truth for traction, pricing, and proof claims');
  console.log('\nLinks:');
  console.log(`  Pro             : ${hostedUrl}`);
  console.log(`  Commercial truth: ${truthUrl}\n`);
}

function summary() {
  const args = parseArgs(process.argv.slice(3));
  const { feedbackSummary } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  console.log(feedbackSummary(Number(args.recent || 20)));
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

function rules() {
  const args = parseArgs(process.argv.slice(3));
  const { writePreventionRules } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const outPath = args.output || path.join(CWD, '.rlhf', 'prevention-rules.md');
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
  console.log('Installing MCP Memory Gateway as a global MCP skill...');
  const results = [
    setupClaude(),
    setupCodex(),
    setupGemini(),
    setupCursor(),
    setupAmp()
  ];
  const success = results.some(r => r === true);
  if (success) {
    console.log('\nSuccess! MCP Memory Gateway is now available to your agents.');
    console.log('Try asking your agent: "Capture positive feedback for this task"');
  } else {
    console.log('\nMCP Memory Gateway is already configured.');
  }
}

function installMcp() {
  const { installMcp: doInstall, parseFlags } = require(path.join(PKG_ROOT, 'scripts', 'install-mcp'));
  const flags = parseFlags(process.argv.slice(3));
  doInstall(flags);
}

function dashboard() {
  const { generateDashboard, printDashboard } = require(path.join(PKG_ROOT, 'scripts', 'dashboard'));
  const { getFeedbackPaths } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const data = generateDashboard(FEEDBACK_DIR);
  printDashboard(data);
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
  console.log(`mcp-memory-gateway v${v}`);
  console.log('');
  console.log('Commands:');
  console.log('  init                  Scaffold .rlhf/ config + MCP server in current project');
  console.log('    --agent=NAME        Wire PreToolUse hooks for agent (claude-code|codex|gemini)');
  console.log('    --wire-hooks        Wire hooks only (auto-detect agent, skip scaffolding)');
  console.log('    --dry-run           Preview hook changes without writing');
  console.log('  install-mcp           Install RLHF MCP server into Claude Code settings (--project for local)');
  console.log('  serve                 Start MCP server (stdio) — for claude/codex/gemini mcp add');
  console.log('  capture [flags]       Capture feedback (--feedback=up|down --context="..." --tags="...")');
  console.log('  stats                 Show feedback analytics + Revenue-at-Risk');
  console.log('  cfo                   Show hosted billing summary when configured, else local fallback JSON');
  console.log('  repair-github-marketplace  Dry-run or apply legacy GitHub Marketplace amount repairs (--write)');
  console.log('  north-star            Show proof-backed workflow-run progress toward the North Star');
  console.log('  summary               Human-readable feedback summary');
  console.log('  model-fit             Detect the current local embedding profile and write evidence report');
  console.log('  risk [flags]          Train or query the boosted local risk scorer');
  console.log('  doctor                Audit runtime isolation, bootstrap context, and permission tier');
  console.log('  export-dpo            Export DPO training pairs (prompt/chosen/rejected JSONL)');
  console.log('  export-databricks     Export RLHF logs + proof artifacts as a Databricks-ready analytics bundle');
  console.log('  rules                 Generate prevention rules from repeated failures');
  console.log('  optimize              [PRO] Prune CLAUDE.md and migrate manual rules to Pre-Action Gates');
  console.log('  force-gate <PATTERN>  Immediately create a blocking gate from a pattern');
  console.log('  self-heal             Run self-healing check and auto-fix');
  console.log('  pro                   Show Pro plan ($49 one-time) + hosted pilot info');
  console.log('  prove [--target=X]    Run proof harness (adapters|automation|attribution|lancedb|local-intelligence|...)');
  console.log('  watch [flags]           Watch .rlhf/ for external signals and ingest through pipeline (--once, --source=X)');
  console.log('  status                  Show feedback tracking dashboard — approval trend + failure domains');
  console.log('  dashboard               Full RLHF dashboard — approval rate, gate stats, prevention impact');
  console.log('  funnel                  Show marketing & revenue conversion funnel analytics');
  console.log('  pulse                   Show real-time GTM velocity and Mission Control summary');
  console.log('  gate-stats              Show gate statistics — active gates, blocks, warns, time saved');
  console.log('  start-api             Start the Memory Gateway HTTPS API server');
  console.log('  help                  Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npx mcp-memory-gateway init');
  console.log('  npx mcp-memory-gateway stats');
  console.log('  npx mcp-memory-gateway cfo');
  console.log('  npx mcp-memory-gateway repair-github-marketplace --write');
  console.log('  npx mcp-memory-gateway model-fit');
  console.log('  npx mcp-memory-gateway risk');
  console.log('  npx mcp-memory-gateway pro');
  proNudge();
}

switch (COMMAND) {
  case 'init':
    init();
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
  case 'capture':
  case 'feedback':
    capture();
    break;
  case 'stats':
    stats();
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
  case 'self-heal':
    selfHeal();
    break;
  case 'pro':
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
  case 'gate-stats':
    gateStats();
    break;
  case 'dashboard':
    dashboard();
    break;
  case 'start-api':
    startApi();
    break;
  case 'help':
  case '--help':
  case '-h':
    help();
    break;
  default:
    if (COMMAND) {
      console.error(`Unknown command: ${COMMAND}`);
      console.error('Run: npx mcp-memory-gateway help');
      process.exit(1);
    } else {
      help();
    }
}
