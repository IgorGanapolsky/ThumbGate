#!/usr/bin/env node
'use strict';

/**
 * graphify-staleness-check.js — Detect when graphify-out/graph.json is stale.
 *
 * A stale graph is worse than no graph (agents trust outdated architecture).
 *
 * Usage:
 *   node scripts/graphify-staleness-check.js
 *   node scripts/graphify-staleness-check.js --json
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const GRAPH = path.join(REPO, 'graphify-out', 'graph.json');
const BIN = path.join(REPO, '.graphify-venv', 'bin', 'graphify');
const STALE_COMMIT_THRESHOLD = 50;
const STALE_HOURS_THRESHOLD = 48;

/** Prefer fixed absolute git paths (Sonar S4036 — avoid bare PATH lookup). */
function resolveGitBinary() {
  const candidates = [
    process.env.GIT_BINARY,
    '/usr/bin/git',
    '/opt/homebrew/bin/git',
    '/usr/local/bin/git',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return '/usr/bin/git';
}

function formatAge(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

function checkGraphStaleness() {
  if (!fs.existsSync(GRAPH)) {
    return {
      exists: false,
      stale: true,
      reason: 'graph.json missing — run: npm run graphify:setup',
      graphifyAvailable: fs.existsSync(BIN),
    };
  }

  const stat = fs.statSync(GRAPH);
  const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
  const isoTime = stat.mtime.toISOString().replace(/\.\d+Z$/, 'Z');
  const revList = spawnSync(
    resolveGitBinary(),
    ['-C', REPO, 'rev-list', '--count', `--since=${isoTime}`, 'HEAD'],
    { encoding: 'utf8', timeout: 5000, shell: false, env: process.env },
  );
  const commitsSince = revList.status === 0
    ? Number.parseInt(String(revList.stdout || '').trim(), 10) || 0
    : -1;

  let nodeCount = 0;
  let linkCount = 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
    nodeCount = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
    linkCount = Array.isArray(parsed.links)
      ? parsed.links.length
      : (Array.isArray(parsed.edges) ? parsed.edges.length : 0);
  } catch {
    /* mid-write */
  }

  const stale = ageHours > STALE_HOURS_THRESHOLD || commitsSince > STALE_COMMIT_THRESHOLD;
  return {
    exists: true,
    mtime: stat.mtime.toISOString(),
    ageHours: Math.round(ageHours * 10) / 10,
    ageDisplay: formatAge(ageHours),
    commitsSince,
    nodeCount,
    linkCount,
    stale,
    graphifyAvailable: fs.existsSync(BIN),
    threshold: { hours: STALE_HOURS_THRESHOLD, commits: STALE_COMMIT_THRESHOLD },
    refresh: '.graphify-venv/bin/graphify update . --no-cluster',
  };
}

function main() {
  const json = process.argv.includes('--json');
  const report = checkGraphStaleness();
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!report.exists) {
    process.stdout.write(`graphify-staleness: MISSING — ${report.reason}\n`);
  } else {
    const status = report.stale
      ? `STALE (${report.ageDisplay}, ${report.commitsSince} commits behind)`
      : `fresh (${report.ageDisplay})`;
    process.stdout.write(
      `graphify-staleness: ${status} nodes=${report.nodeCount} links=${report.linkCount}\n`,
    );
  }
  process.exit(0);
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = { checkGraphStaleness, formatAge, resolveGitBinary, STALE_COMMIT_THRESHOLD, STALE_HOURS_THRESHOLD };
