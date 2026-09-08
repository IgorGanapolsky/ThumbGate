#!/usr/bin/env node
'use strict';

/**
 * Gisting FORMAT analog: fail-closed instruction-pack token budget.
 *
 * InfoQ 2026-09-08 — Shopify Gisting compresses LLM system prompts into
 * learned tokens. We steal the *budget* mechanic, not the tokenizer:
 * measure existing instruction packs with context-footprint.estimateTokens
 * and fail when they exceed a declared cap.
 *
 * Does NOT train or store learned gist tokens. Does not clone Shopify Gisting.
 *
 * Usage:
 *   node scripts/gist-prompt-budget.js --json
 *   node scripts/gist-prompt-budget.js --root=DIR --strict --json
 */

const fs = require('node:fs');
const path = require('node:path');
const { estimateTokens } = require('./context-footprint');

const SOURCE = 'InfoQ 2026-09-08 Shopify Gisting FORMAT (measure, do not train)';
const DEFAULT_FILES = Object.freeze(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
const DEFAULT_MAX_TOKENS_PER_FILE = 16000;
const DEFAULT_MAX_TOKENS_TOTAL = 24000;

function toNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeOptions(options = {}) {
  const root = path.resolve(String(options.root || options.cwd || process.cwd()));
  let files = DEFAULT_FILES.slice();
  if (Array.isArray(options.files) && options.files.length) {
    files = options.files.map((f) => String(f));
  } else if (typeof options.files === 'string' && options.files.trim()) {
    files = options.files.split(',').map((f) => f.trim()).filter(Boolean);
  }
  return {
    root,
    files,
    maxTokensPerFile: Math.max(1, toNumber(
      options.maxTokensPerFile || options['max-tokens-per-file'],
      DEFAULT_MAX_TOKENS_PER_FILE,
    )),
    maxTokensTotal: Math.max(1, toNumber(
      options.maxTokensTotal || options['max-tokens-total'],
      DEFAULT_MAX_TOKENS_TOTAL,
    )),
    json: Boolean(options.json),
    strict: Boolean(options.strict),
    help: Boolean(options.help),
  };
}

function realpathIfExists(target) {
  try {
    if (fs.existsSync(target)) return fs.realpathSync(target);
  } catch {
    // fall through to lexical path
  }
  return target;
}

function containedInRoot(rootAbs, candidateAbs) {
  const rootReal = realpathIfExists(rootAbs);
  const candReal = realpathIfExists(candidateAbs);
  const relative = path.relative(rootReal, candReal);
  return relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function readPackFile(root, rel) {
  const rootAbs = realpathIfExists(path.resolve(root));
  const abs = path.resolve(rootAbs, rel);
  if (!containedInRoot(rootAbs, abs)) {
    return { rel, path: abs, error: 'path_escape', tokens: 0, bytes: 0 };
  }
  if (!fs.existsSync(abs)) {
    return { rel, path: abs, missing: true, tokens: 0, bytes: 0 };
  }
  const text = fs.readFileSync(abs, 'utf8');
  const bytes = Buffer.byteLength(text, 'utf8');
  return {
    rel,
    path: abs,
    missing: false,
    bytes,
    tokens: estimateTokens(text),
  };
}

function buildGistPromptBudgetReport(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const packs = options.files.map((rel) => readPackFile(options.root, rel));
  const present = packs.filter((p) => !p.missing && !p.error);
  const totalTokens = present.reduce((sum, p) => sum + p.tokens, 0);
  const findings = [];

  for (const pack of packs) {
    if (pack.error === 'path_escape') {
      findings.push({
        id: 'path_escape',
        severity: 'fail',
        file: pack.rel,
        detail: 'instruction pack path escaped --root',
      });
      continue;
    }
    if (pack.missing) {
      findings.push({
        id: 'instruction_pack_missing',
        severity: 'actionable',
        file: pack.rel,
        detail: 'optional instruction pack not present',
      });
      continue;
    }
    if (pack.tokens > options.maxTokensPerFile) {
      findings.push({
        id: 'instruction_pack_over_file_budget',
        severity: 'fail',
        file: pack.rel,
        tokens: pack.tokens,
        maxTokensPerFile: options.maxTokensPerFile,
        detail: `${pack.rel} estimated ${pack.tokens} tokens > ${options.maxTokensPerFile} per-file cap`,
      });
    }
  }

  if (totalTokens > options.maxTokensTotal) {
    findings.push({
      id: 'instruction_pack_over_total_budget',
      severity: 'fail',
      tokens: totalTokens,
      maxTokensTotal: options.maxTokensTotal,
      detail: `instruction pack total ${totalTokens} tokens > ${options.maxTokensTotal} cap`,
    });
  }

  const failed = findings.some((f) => f.severity === 'fail');
  const actionable = findings.some((f) => f.severity === 'actionable');
  let status = 'ready';
  if (failed) status = 'fail';
  else if (actionable) status = 'actionable';

  return {
    source: SOURCE,
    learnedTokens: false,
    status,
    metrics: {
      filesScanned: present.length,
      filesMissing: packs.filter((p) => p.missing).length,
      totalTokens,
      maxTokensPerFile: options.maxTokensPerFile,
      maxTokensTotal: options.maxTokensTotal,
    },
    packs: packs.map((p) => ({
      file: p.rel,
      missing: Boolean(p.missing),
      error: p.error || null,
      bytes: p.bytes,
      tokens: p.tokens,
      overFileBudget: !p.missing && !p.error && p.tokens > options.maxTokensPerFile,
    })),
    findings,
  };
}

function formatGistPromptBudgetReport(report) {
  const lines = [
    `Gist prompt budget: ${report.status}`,
    `Source: ${report.source}`,
    `Learned tokens: no (measure-only)`,
    `Files: ${report.metrics.filesScanned} scanned, ${report.metrics.filesMissing} missing`,
    `Tokens: ${report.metrics.totalTokens} / ${report.metrics.maxTokensTotal} total; per-file cap ${report.metrics.maxTokensPerFile}`,
  ];
  for (const pack of report.packs) {
    const flag = pack.overFileBudget ? ' OVER' : pack.missing ? ' missing' : '';
    lines.push(`  - ${pack.file}: ${pack.tokens} tokens${flag}`);
  }
  for (const finding of report.findings) {
    lines.push(`  [${finding.severity}] ${finding.id}: ${finding.detail}`);
  }
  return `${lines.join('\n')}\n`;
}

function parseCliArgs(argv = []) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    options[m[1]] = m[2] === undefined ? true : m[2];
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/gist-prompt-budget.js [flags]

Shopify Gisting FORMAT analog: fail when instruction packs exceed a token budget.
Does not train learned tokens.

Flags:
  --root=DIR
  --files=AGENTS.md,CLAUDE.md,GEMINI.md
  --max-tokens-per-file=N   (default ${DEFAULT_MAX_TOKENS_PER_FILE})
  --max-tokens-total=N      (default ${DEFAULT_MAX_TOKENS_TOTAL})
  --strict                  exit 1 unless status=ready
  --json
`);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const report = buildGistPromptBudgetReport(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatGistPromptBudgetReport(report));
  if (args.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  SOURCE,
  DEFAULT_FILES,
  DEFAULT_MAX_TOKENS_PER_FILE,
  DEFAULT_MAX_TOKENS_TOTAL,
  normalizeOptions,
  containedInRoot,
  readPackFile,
  buildGistPromptBudgetReport,
  formatGistPromptBudgetReport,
  parseCliArgs,
  runCli,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = runCli(process.argv.slice(2));
}
