#!/usr/bin/env node
/**
 * rlhf-feedback-loop CLI
 *
 * Usage:
 *   npx rlhf-feedback-loop init          # scaffold .rlhf/ config + .mcp.json
 *   npx rlhf-feedback-loop capture       # capture feedback
 *   npx rlhf-feedback-loop export-dpo    # export DPO training pairs
 *   npx rlhf-feedback-loop stats         # feedback analytics + Revenue-at-Risk
 *   npx rlhf-feedback-loop pro           # upgrade to Cloud Pro
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const COMMAND = process.argv[2];
const CWD = process.cwd();
const PKG_ROOT = path.join(__dirname, '..');

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
const MCP_SERVER_ENTRY = {
  command: 'node',
  args: [path.relative(CWD, path.join(PKG_ROOT, 'adapters', 'mcp', 'server-stdio.js'))],
};

function mergeMcpJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ mcpServers: { 'rlhf-feedback-loop': MCP_SERVER_ENTRY } }, null, 2) + '\n');
    console.log(`  ${label}: wrote ${path.relative(CWD, filePath)}`);
    return true;
  }
  const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (existing.mcpServers && existing.mcpServers['rlhf-feedback-loop']) return false;
  existing.mcpServers = existing.mcpServers || {};
  existing.mcpServers['rlhf-feedback-loop'] = MCP_SERVER_ENTRY;
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
  return mergeMcpJson(path.join(CWD, '.mcp.json'), 'Claude Code');
}

function setupCodex() {
  const configPath = path.join(HOME, '.codex', 'config.toml');
  const block = `\n[mcp_servers.rlhf_feedback_loop]\ncommand = "node"\nargs = ["${MCP_SERVER_ENTRY.args[0]}"]\n`;
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, block);
    console.log('  Codex: created ~/.codex/config.toml');
    return true;
  }
  const content = fs.readFileSync(configPath, 'utf8');
  if (content.includes('[mcp_servers.rlhf_feedback_loop]')) return false;
  fs.appendFileSync(configPath, block);
  console.log('  Codex: appended MCP server to ~/.codex/config.toml');
  return true;
}

function setupGemini() {
  const settingsPath = path.join(HOME, '.gemini', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (settings.mcpServers && settings.mcpServers['rlhf-feedback-loop']) return false;
    settings.mcpServers = settings.mcpServers || {};
    settings.mcpServers['rlhf-feedback-loop'] = MCP_SERVER_ENTRY;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.log('  Gemini: updated ~/.gemini/settings.json');
    return true;
  }
  // Fallback: project-level .gemini/settings.json
  return mergeMcpJson(path.join(CWD, '.gemini', 'settings.json'), 'Gemini');
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
  return mergeMcpJson(path.join(CWD, '.cursor', 'mcp.json'), 'Cursor');
}

function init() {
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
  console.log(`rlhf-feedback-loop v${pkgVersion()} initialized.`);
  console.log('Run: npx rlhf-feedback-loop help');

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
}

function capture() {
  const args = parseArgs(process.argv.slice(3));

  // Delegate to the full engine
  const { captureFeedback, analyzeFeedback, feedbackSummary, writePreventionRules } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));

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
    console.log('  Action Required: Run "npx rlhf-feedback-loop rules" to generate guardrails.');
    console.log('  Strategic Recommendation: Upgrade to Cloud Pro to sync these rules across your team.');
    console.log('  Run: npx rlhf-feedback-loop pro');
  } else {
    console.log('\n✅ System is currently high-reliability. No immediate revenue loss detected.');
  }
}

function pro() {
  const stripeUrl = 'https://buy.stripe.com/bJe14neyU4r4f0leOD3sI02';
  console.log('\n🚀 RLHF Feedback Loop — Cloud Pro');
  console.log('─'.repeat(50));
  console.log('Unlock the full Agentic Control Plane:');
  console.log('  - Hosted Team API (Shared memory across all repos)');
  console.log('  - ShieldCortex Managed Context Packs');
  console.log('  - Automated DPO Training Pipelines');
  console.log('  - SOC2-ready Governance Dashboard');
  console.log('\n👉 Complete your upgrade here:');
  console.log(`   ${stripeUrl}`);
  console.log('\nOnce upgraded, run: npx rlhf-feedback-loop init --key=YOUR_PRO_KEY\n');
}

function summary() {
  const args = parseArgs(process.argv.slice(3));
  const { feedbackSummary } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  console.log(feedbackSummary(Number(args.recent || 20)));
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
    console.error('Available: adapters, automation, attribution, lancedb, data-quality, intelligence, loop-closure, training-export');
    process.exit(1);
  }
  try {
    execSync(`node "${script}"`, { encoding: 'utf8', stdio: 'inherit', cwd: CWD });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

function serve() {
  const rlhfDir = path.join(CWD, '.rlhf');
  if (!fs.existsSync(rlhfDir) && !fs.existsSync(path.join(CWD, '.claude', 'memory', 'feedback'))) {
    // If not initialized, ensure global fallback exists
    const projectName = path.basename(CWD) || 'default';
    const globalDir = path.join(HOME, '.rlhf', 'projects', projectName);
    if (!fs.existsSync(globalDir)) {
      fs.mkdirSync(globalDir, { recursive: true });
    }
  }

  // Start MCP server over stdio
  const mcpServer = path.join(PKG_ROOT, 'adapters', 'mcp', 'server-stdio.js');
  const { startStdioServer } = require(mcpServer);
  startStdioServer();
}

function install() {
  console.log('Installing RLHF Feedback Loop as a global MCP skill...');
  const results = [
    setupClaude(),
    setupCodex(),
    setupGemini(),
    setupCursor()
  ];
  const success = results.some(r => r === true);
  if (success) {
    console.log('\nSuccess! RLHF Feedback Loop is now available to your agents.');
    console.log('Try asking your agent: "Capture positive feedback for this task"');
  } else {
    console.log('\nRLHF Feedback Loop is already configured.');
  }
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
  console.log(`rlhf-feedback-loop v${v}`);
  console.log('');
  console.log('Commands:');
  console.log('  init                  Scaffold .rlhf/ config + MCP server in current project');
  console.log('  serve                 Start MCP server (stdio) — for claude/codex/gemini mcp add');
  console.log('  capture [flags]       Capture feedback (--feedback=up|down --context="..." --tags="...")');
  console.log('  stats                 Show feedback analytics + Revenue-at-Risk');
  console.log('  summary               Human-readable feedback summary');
  console.log('  export-dpo            Export DPO training pairs (prompt/chosen/rejected JSONL)');
  console.log('  rules                 Generate prevention rules from repeated failures');
  console.log('  self-heal             Run self-healing check and auto-fix');
  console.log('  pro                   Upgrade to Cloud Pro ($10/mo)');
  console.log('  prove [--target=X]    Run proof harness (adapters|automation|attribution|lancedb|...)');
  console.log('  start-api             Start the RLHF HTTPS API server');
  console.log('  help                  Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npx rlhf-feedback-loop init');
  console.log('  npx rlhf-feedback-loop stats');
  console.log('  npx rlhf-feedback-loop pro');
}

switch (COMMAND) {
  case 'init':
    init();
    break;
  case 'install':
    install();
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
  case 'summary':
    summary();
    break;
  case 'export-dpo':
  case 'dpo':
    exportDpo();
    break;
  case 'rules':
    rules();
    break;
  case 'self-heal':
    selfHeal();
    break;
  case 'pro':
    pro();
    break;
  case 'prove':
    prove();
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
      console.error('Run: npx rlhf-feedback-loop help');
      process.exit(1);
    } else {
      help();
    }
}
