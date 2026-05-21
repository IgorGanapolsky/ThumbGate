'use strict';

/**
 * cost-cli.js — `thumbgate cost` subcommand.
 *
 * Surfaces the existing computeTokenSavings() output as a human-readable
 * report so users can see, in plain dollars, what their PreToolUse gates
 * are worth. Reads gate-stats.json (same file the dashboard reads) and
 * the lesson DB for context.
 *
 * Positioning answer to the 2026 FinOps-for-AI pitch: ThumbGate isn't
 * a competing FinOps tool — it's the *enforcement* layer that prevents
 * the spend FinOps tools would otherwise just be reporting on.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  computeTokenSavings,
  formatDollars,
  formatTokens,
} = require('./token-savings');

const DEFAULT_STATS_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.thumbgate',
  'gate-stats.json',
);

function readGateStats(statsPath = DEFAULT_STATS_PATH) {
  try {
    if (!fs.existsSync(statsPath)) return null;
    const raw = fs.readFileSync(statsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function summarizeTopGate(byGate) {
  if (!byGate || typeof byGate !== 'object') return null;
  let topId = null;
  let topCount = 0;
  for (const [id, stat] of Object.entries(byGate)) {
    const n = Number(stat && stat.blocked) || 0;
    if (n > topCount) {
      topCount = n;
      topId = id;
    }
  }
  return topId ? { id: topId, blocked: topCount } : null;
}

function buildReport({ statsPath = DEFAULT_STATS_PATH, modelMix } = {}) {
  const stats = readGateStats(statsPath) || { blocked: 0, warned: 0, passed: 0, byGate: {} };
  const blockedCalls = Number(stats.blocked) || 0;
  const savings = computeTokenSavings({
    blockedCalls,
    modelMix,
  });
  return {
    statsPath,
    statsExists: !!readGateStats(statsPath),
    blocked: blockedCalls,
    warned: Number(stats.warned) || 0,
    passed: Number(stats.passed) || 0,
    topGate: summarizeTopGate(stats.byGate),
    savings,
  };
}

function renderHuman(report) {
  const out = [];
  out.push('');
  out.push('💰 ThumbGate cost-savings — cumulative');
  out.push('─'.repeat(50));

  if (!report.statsExists) {
    out.push('');
    out.push(`  No gate-stats.json yet at ${report.statsPath}.`);
    out.push('  ThumbGate writes it the first time a PreToolUse gate fires.');
    out.push('  Run `thumbgate init` if you haven\'t installed the hook,');
    out.push('  or wait until your first agent session triggers a block.');
    out.push('');
    return out.join('\n');
  }

  out.push('');
  out.push(`  Tool calls blocked : ${report.blocked.toLocaleString()}`);
  out.push(`  Tool calls warned  : ${report.warned.toLocaleString()}`);
  out.push(`  Tool calls passed  : ${report.passed.toLocaleString()}`);
  if (report.topGate) {
    out.push(`  Top blocker        : ${report.topGate.id} (${report.topGate.blocked} blocks)`);
  }
  out.push('');
  out.push('  Tokens you did NOT spend');
  out.push(`    Input  : ${formatTokens(report.savings.tokensSavedInput)}`);
  out.push(`    Output : ${formatTokens(report.savings.tokensSavedOutput)}`);
  out.push(`    Total  : ${formatTokens(report.savings.tokensSavedTotal)}`);
  out.push('');
  out.push(`  Estimated $ saved  : ${formatDollars(report.savings.dollarsSaved)}`);
  out.push('');
  out.push(
    '  Methodology: conservative, 2k input + 600 output tokens per blocked call,',
  );
  out.push(
    '  Sonnet-heavy mix (80/15/5). Override with `--mix` JSON flag.',
  );
  out.push('');
  return out.join('\n');
}

function parseArgs(argv) {
  const args = { json: false, statsPath: undefined, modelMix: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--stats' || a === '--stats-path') args.statsPath = argv[++i];
    else if (a === '--mix') {
      try { args.modelMix = JSON.parse(argv[++i]); }
      catch { args.modelMix = undefined; }
    }
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = buildReport({ statsPath: args.statsPath, modelMix: args.modelMix });
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(renderHuman(report));
  return 0;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exit(main());
}

module.exports = { buildReport, renderHuman, readGateStats, parseArgs, main };
