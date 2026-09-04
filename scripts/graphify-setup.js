#!/usr/bin/env node
'use strict';

/**
 * graphify-setup.js — Install Graphify-Labs `graphifyy` into `.graphify-venv`
 * and build a local AST-only knowledge graph at `graphify-out/graph.json`.
 *
 * This is the ThumbGate rail for https://github.com/Graphify-Labs/graphify:
 * local deterministic AST parsing, queryable graph, no vector store, no SKU clone.
 *
 * Usage:
 *   node scripts/graphify-setup.js
 *   node scripts/graphify-setup.js --json
 *   node scripts/graphify-setup.js --skip-build
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const VENV = path.join(REPO, '.graphify-venv');
const BIN = path.join(VENV, 'bin', 'graphify');
const PY = path.join(VENV, 'bin', 'python');
const PIP = path.join(VENV, 'bin', 'pip');
const GRAPH = path.join(REPO, 'graphify-out', 'graph.json');
const MIN_VERSION = '0.9.26';
const PACKAGE = 'graphifyy>=0.9.26';

function parseArgs(argv) {
  const args = { json: false, skipBuild: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--skip-build') args.skipBuild = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || REPO,
    encoding: 'utf8',
    timeout: options.timeout || 600000,
    maxBuffer: 1024 * 1024 * 16,
    shell: false,
    env: options.env || process.env,
  });
}

function ensureVenv(options = {}) {
  const py = options.py || PY;
  const venv = options.venv || VENV;
  const runFn = options.runFn || run;
  if (fs.existsSync(py)) return { created: false };
  const result = runFn(process.env.PYTHON || 'python3', ['-m', 'venv', venv], {
    timeout: 120000,
  });
  if (result.status !== 0) {
    throw new Error(`venv create failed: ${(result.stderr || result.stdout || '').slice(0, 500)}`);
  }
  return { created: true };
}

function ensurePackage(options = {}) {
  const py = options.py || PY;
  const pip = options.pip || PIP;
  const bin = options.bin || BIN;
  const runFn = options.runFn || run;
  const check = runFn(py, ['-c', 'import graphify; print(getattr(graphify, "__version__", "ok"))']);
  if (check.status === 0 && fs.existsSync(bin)) {
    return { installed: false, versionProbe: (check.stdout || '').trim() };
  }
  const upgradePip = runFn(pip, ['install', '-U', 'pip', 'wheel'], { timeout: 180000 });
  if (upgradePip.status !== 0) {
    throw new Error(`pip upgrade failed: ${(upgradePip.stderr || '').slice(0, 500)}`);
  }
  const install = runFn(pip, ['install', PACKAGE], { timeout: 300000 });
  if (install.status !== 0 || !fs.existsSync(bin)) {
    throw new Error(`pip install ${PACKAGE} failed: ${(install.stderr || install.stdout || '').slice(0, 800)}`);
  }
  return { installed: true };
}

function graphifyVersion(options = {}) {
  const bin = options.bin || BIN;
  const runFn = options.runFn || run;
  const result = runFn(bin, ['--version'], { timeout: 15000 });
  if (result.status !== 0) return '';
  const match = String(result.stdout || '').match(/\b(\d+\.\d+\.\d+)\b/);
  return match ? match[1] : '';
}

function versionAtLeast(actual, minimum) {
  const parts = (value) => String(value).split('.').map((p) => Number.parseInt(p, 10) || 0);
  const left = parts(actual);
  const right = parts(minimum);
  const width = Math.max(left.length, right.length);
  for (let i = 0; i < width; i += 1) {
    const delta = (left[i] || 0) - (right[i] || 0);
    if (delta !== 0) return delta > 0;
  }
  return true;
}

function summarizeGraph(graphPath = GRAPH) {
  const raw = fs.readFileSync(graphPath, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    path: graphPath,
    nodes: Array.isArray(parsed.nodes) ? parsed.nodes.length : 0,
    links: Array.isArray(parsed.links)
      ? parsed.links.length
      : (Array.isArray(parsed.edges) ? parsed.edges.length : 0),
    mtime: fs.statSync(graphPath).mtime.toISOString(),
  };
}

function buildGraph(options = {}) {
  const bin = options.bin || BIN;
  const graphPath = options.graphPath || GRAPH;
  const runFn = options.runFn || run;
  const result = runFn(bin, ['update', '.', '--no-cluster'], { timeout: 600000 });
  if (result.status !== 0) {
    throw new Error(`graphify update failed: ${(result.stderr || result.stdout || '').slice(0, 800)}`);
  }
  if (!fs.existsSync(graphPath)) {
    throw new Error('graphify update exited 0 but graphify-out/graph.json is missing');
  }
  return summarizeGraph(graphPath);
}

function setupReport(args, options = {}) {
  const report = {
    ok: false,
    repo: options.repo || REPO,
    package: PACKAGE,
    minVersion: MIN_VERSION,
    venv: options.venv || VENV,
    bin: options.bin || BIN,
    steps: {},
  };

  try {
    report.steps.venv = ensureVenv(options);
    report.steps.package = ensurePackage(options);
    report.version = graphifyVersion(options);
    if (!report.version || !versionAtLeast(report.version, MIN_VERSION)) {
      throw new Error(
        `graphify version ${report.version || 'unknown'} is below required ${MIN_VERSION}`,
      );
    }
    const graphPath = options.graphPath || GRAPH;
    if (!args.skipBuild) {
      report.steps.graph = buildGraph(options);
    } else if (fs.existsSync(graphPath)) {
      report.steps.graph = summarizeGraph(graphPath);
      report.steps.graph.skippedBuild = true;
    } else {
      report.steps.graph = { skippedBuild: true, exists: false };
    }
    report.ok = true;
    report.queryExample = '.graphify-venv/bin/graphify query "how does PreToolUse gate check work?"';
    report.pathExample = '.graphify-venv/bin/graphify path "gates-engine.js" "session-lease.js"';
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? error.message : String(error);
  }
  return report;
}

function main(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/graphify-setup.js [--json] [--skip-build]\n'
      + 'Installs Graphify-Labs graphifyy into .graphify-venv and builds graphify-out/.\n',
    );
    return { ok: true, status: 'HELP' };
  }

  const report = setupReport(args, options);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok) {
    const graph = report.steps.graph || {};
    process.stdout.write(
      `graphify-setup: OK v${report.version}`
      + (graph.nodes != null ? ` nodes=${graph.nodes} links=${graph.links}` : '')
      + `\nbin: ${report.bin}\n`
      + `query: ${report.queryExample}\n`,
    );
  } else {
    process.stderr.write(`graphify-setup: FAIL ${report.error}\n`);
  }

  if (options.exit !== false && path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
    process.exit(report.ok ? 0 : 1);
  }
  return report;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = {
  MIN_VERSION,
  PACKAGE,
  buildGraph,
  ensurePackage,
  ensureVenv,
  graphifyBin: BIN,
  graphifyVersion,
  graphPath: GRAPH,
  main,
  parseArgs,
  run,
  setupReport,
  summarizeGraph,
  versionAtLeast,
};
