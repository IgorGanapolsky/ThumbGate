#!/usr/bin/env node
'use strict';

// One check that fails when the places a version lives disagree:
// package.json, the git tag on HEAD, npm `latest`, the live site /health
// version, and the top CHANGELOG.md heading.
//
//   node scripts/check-version-truth.js                 strict (post-release): all sources must match
//   node scripts/check-version-truth.js --allow-ahead   PR mode: package.json and CHANGELOG may be
//                                                       ahead of npm latest, the tag and /health
//   --offline                                           skip npm and /health (tests, no network)
//   --health-url <url>                                  default https://thumbgate.ai/health
//
// A source that cannot be read is reported as "not checked", never as a match.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function cmp(a, b) {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function parseChangelogTop(text) {
  const m = /^##\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/m.exec(text || '');
  return m ? m[1] : null;
}

// sources: { package, tag, npmLatest, health, changelog }. package is the reference.
// allowAhead: sources that trail a release (tag, npmLatest, health) may be behind
// package.json; none may be ahead of it.
function compareVersions(sources, { allowAhead = false } = {}) {
  const ref = sources.package;
  const problems = [];
  const checked = [];
  const notChecked = [];
  for (const [name, value] of Object.entries(sources)) {
    if (value === null || value === undefined || value === '') {
      notChecked.push(name);
      continue;
    }
    checked.push(name);
    if (name === 'package') continue;
    if (!SEMVER.test(value)) {
      problems.push(`${name} ${value} is not a version`);
      continue;
    }
    if (value === ref) continue;
    const trailing = name === 'tag' || name === 'npmLatest' || name === 'health';
    if (allowAhead && trailing && cmp(value, ref) < 0) continue;
    problems.push(`${name} ${value} != package ${ref}`);
  }
  return { problems, checked, notChecked };
}

function readArg(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function tryExec(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }).trim();
  } catch {
    return null;
  }
}

async function main(argv = process.argv.slice(2)) {
  const root = readArg(argv, '--root') || process.cwd();
  const offline = argv.includes('--offline');
  const allowAhead = argv.includes('--allow-ahead');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const changelogPath = path.join(root, 'CHANGELOG.md');

  const tagRaw = tryExec('git', ['describe', '--tags', '--exact-match', '--match', 'v*', 'HEAD'], root);
  const sources = {
    package: pkg.version,
    tag: tagRaw ? tagRaw.replace(/^v/, '') : null,
    changelog: fs.existsSync(changelogPath) ? parseChangelogTop(fs.readFileSync(changelogPath, 'utf8')) : null,
    npmLatest: null,
    health: null,
  };
  if (!offline) {
    sources.npmLatest = tryExec('npm', ['view', pkg.name, 'dist-tags.latest']);
    try {
      const res = await fetch(readArg(argv, '--health-url') || 'https://thumbgate.ai/health', { signal: AbortSignal.timeout(15000) });
      sources.health = res.ok ? (await res.json()).version || null : null;
    } catch {
      sources.health = null;
    }
  }
  const result = compareVersions(sources, { allowAhead });
  console.log(JSON.stringify({ sources, ...result }));
  if (result.problems.length) {
    for (const p of result.problems) console.error(`version-truth: ${p}`);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = { compareVersions, parseChangelogTop, cmp };
