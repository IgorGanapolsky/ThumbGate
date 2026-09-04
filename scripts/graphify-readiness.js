#!/usr/bin/env node
'use strict';

/**
 * graphify-readiness.js — Fail-closed check that Graphify-Labs graphify is
 * wired for this ThumbGate checkout (venv binary + graph.json).
 *
 * Does not install packages and does not send code anywhere.
 *
 * Usage:
 *   node scripts/graphify-readiness.js
 *   node scripts/graphify-readiness.js --json
 *   node scripts/graphify-readiness.js --require-graph
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { MIN_VERSION, versionAtLeast } = require('./graphify-setup');

const REPO = path.resolve(__dirname, '..');
const VENV_BIN = path.join(REPO, '.graphify-venv', 'bin', 'graphify');
const GRAPH = path.join(REPO, 'graphify-out', 'graph.json');

function parseArgs(argv) {
  const args = { json: false, requireGraph: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--require-graph') args.requireGraph = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readVersion(bin) {
  if (!fs.existsSync(bin)) return '';
  const result = spawnSync(bin, ['--version'], {
    encoding: 'utf8',
    timeout: 10000,
    shell: false,
  });
  if (result.status !== 0) return '';
  const match = String(result.stdout || '').match(/\b(\d+\.\d+\.\d+)\b/);
  return match ? match[1] : '';
}

function summarizeGraph(graphPath = GRAPH) {
  if (!fs.existsSync(graphPath)) {
    return { exists: false };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    const stat = fs.statSync(graphPath);
    return {
      exists: true,
      path: graphPath,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes.length : 0,
      links: Array.isArray(parsed.links)
        ? parsed.links.length
        : (Array.isArray(parsed.edges) ? parsed.edges.length : 0),
      mtime: stat.mtime.toISOString(),
    };
  } catch (error) {
    return {
      exists: true,
      path: graphPath,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function assess(options = {}) {
  const requireGraph = Boolean(options.requireGraph);
  const bin = options.bin || VENV_BIN;
  const graphPath = options.graphPath || GRAPH;
  const version = readVersion(bin);
  const graph = summarizeGraph(graphPath);
  const reasons = [];

  if (!fs.existsSync(bin)) {
    reasons.push('missing .graphify-venv/bin/graphify — run: npm run graphify:setup');
  } else if (!version || !versionAtLeast(version, MIN_VERSION)) {
    reasons.push(
      `graphify ${version || 'unknown'} below required ${MIN_VERSION} — run: npm run graphify:setup`,
    );
  }

  if (requireGraph && !graph.exists) {
    reasons.push('missing graphify-out/graph.json — run: npm run graphify:setup');
  }
  if (graph.parseError) {
    reasons.push(`graph.json unreadable: ${graph.parseError}`);
  }

  return {
    ok: reasons.length === 0,
    ready: reasons.length === 0 && Boolean(graph.exists),
    version,
    minVersion: MIN_VERSION,
    bin,
    graph,
    reasons,
    commands: {
      setup: 'npm run graphify:setup',
      query: '.graphify-venv/bin/graphify query "<architecture question>"',
      path: '.graphify-venv/bin/graphify path "<A>" "<B>"',
      explain: '.graphify-venv/bin/graphify explain "<concept>"',
      update: '.graphify-venv/bin/graphify update . --no-cluster',
    },
    honesty: {
      product: 'Graphify-Labs/graphify (PyPI: graphifyy)',
      notAClone: true,
      edgeTags: 'EXTRACTED vs INFERRED (upstream graphify)',
      vectorStore: false,
      lesson: 'Prefer graphify query/path/explain over raw grep for architecture questions when graph.json exists.',
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/graphify-readiness.js [--json] [--require-graph]\n',
    );
    process.exit(0);
  }

  const report = assess({ requireGraph: args.requireGraph });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok) {
    const g = report.graph;
    process.stdout.write(
      `graphify-readiness: OK v${report.version}`
      + (g.exists ? ` graph nodes=${g.nodes} links=${g.links}` : ' graph=absent')
      + `\n`,
    );
  } else {
    process.stderr.write(
      `graphify-readiness: NOT READY\n${report.reasons.map((r) => `- ${r}`).join('\n')}\n`,
    );
  }
  process.exit(report.ok ? 0 : 1);
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = { assess, parseArgs, summarizeGraph, readVersion, MIN_VERSION };
