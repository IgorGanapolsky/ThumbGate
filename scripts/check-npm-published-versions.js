#!/usr/bin/env node
'use strict';

// Fails when a pinned `thumbgate@x.y.z` in tracked public surfaces is not a
// version that exists on npm (15 Nov 2026: site and plugins pointed at
// versions that were never published).
//
// Usage:
//   node scripts/check-npm-published-versions.js                 strict (post-publish)
//   node scripts/check-npm-published-versions.js --allow-unreleased-package-version
//       PR mode: package.json's version is also allowed when it is strictly
//       greater than the latest published version (an unreleased bump).
//   --published-file <json>  read the published version list from a file
//                            instead of `npm view` (tests, offline runs).
//   --root <dir>             repo root (default: cwd).

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PIN_RE = /(?<![\w/.-])thumbgate@(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)(?![\w@])/g;
const DIR_PREFIXES = ['public/', '.claude-plugin/', '.cursor-plugin/', 'plugins/', 'adapters/', '.well-known/', 'docs/'];
const EXACT_FILES = new Set(['mcpize.yaml', 'README.md', 'server.json']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tgz', '.woff', '.woff2', '.ttf', '.mp4', '.mov', '.mp3', '.wasm']);
const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_IO = { log: console.log, error: console.error };

// Fixed absolute binaries instead of a bare PATH lookup (Sonar S4036).
function firstExisting(candidates, fallback) {
  return candidates.find((c) => {
    try { return fs.existsSync(c); } catch { return false; }
  }) || fallback;
}

function resolveGitBinary() {
  return firstExisting(['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'], '/usr/bin/git');
}

// npm ships next to the running node binary (setup-node, Homebrew, nvm).
function resolveNpmBinary() {
  return firstExisting([
    path.join(path.dirname(process.execPath), 'npm'),
    '/opt/homebrew/bin/npm',
    '/usr/local/bin/npm',
    '/usr/bin/npm',
  ], path.join(path.dirname(process.execPath), 'npm'));
}

function isInScope(file) {
  if (EXACT_FILES.has(file)) return true;
  const base = path.posix.basename(file);
  if (base === 'server.json' || (base.includes('server-card') && base.endsWith('.json'))) return true;
  return DIR_PREFIXES.some((p) => file.startsWith(p));
}

function listTrackedFiles(root) {
  const out = execFileSync(resolveGitBinary(), ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean)
    .filter((f) => !f.split('/').includes('node_modules'))
    .filter(isInScope)
    .filter((f) => !BINARY_EXT.has(path.extname(f).toLowerCase()));
}

function collectPins(root, files) {
  const pins = [];
  for (const file of files) {
    const abs = path.join(root, file);
    let buf;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      buf = fs.readFileSync(abs);
    } catch {
      continue; // deleted in working tree
    }
    if (buf.includes(0)) continue;
    buf.toString('utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(PIN_RE)) {
        pins.push({ file, line: i + 1, version: m[1] });
      }
    });
  }
  return pins;
}

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

function compareIdentifier(p, q) {
  if (p === q) return 0;
  const pn = /^\d+$/.test(p);
  const qn = /^\d+$/.test(q);
  if (pn && qn) return Number(p) > Number(q) ? 1 : -1;
  if (pn !== qn) return pn ? -1 : 1;
  return p > q ? 1 : -1;
}

function comparePrerelease(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const c = compareIdentifier(a[i], b[i]);
    if (c !== 0) return c;
  }
  return 0;
}

function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i] ? 1 : -1;
  }
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;
  if (!y.pre.length) return -1;
  return comparePrerelease(x.pre, y.pre);
}

function loadPublishedVersions({ publishedFile } = {}) {
  const raw = publishedFile
    ? fs.readFileSync(publishedFile, 'utf8')
    : execFileSync(resolveNpmBinary(), ['view', 'thumbgate', 'versions', '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (!list.length || !list.every((v) => typeof v === 'string')) {
    throw new Error('published version list is empty or malformed');
  }
  return list;
}

function checkPins({ pins, published, packageVersion, allowUnreleasedPackageVersion }) {
  const set = new Set(published);
  const latest = published.filter((v) => parseSemver(v) && !v.includes('-')).sort(compareSemver).pop();
  const allowed = allowUnreleasedPackageVersion && packageVersion && parseSemver(packageVersion)
    && (!latest || compareSemver(packageVersion, latest) > 0) ? packageVersion : null;
  return pins.filter((p) => !set.has(p.version) && p.version !== allowed);
}

function parseArgs(argv) {
  const opts = { root: process.cwd(), allowUnreleasedPackageVersion: false, publishedFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--allow-unreleased-package-version') opts.allowUnreleasedPackageVersion = true;
    else if (a === '--published-file') opts.publishedFile = argv[++i];
    else if (a.startsWith('--published-file=')) opts.publishedFile = a.split('=')[1];
    else if (a === '--root') opts.root = path.resolve(argv[++i]);
    else if (a.startsWith('--root=')) opts.root = path.resolve(a.split('=')[1]);
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

function run(argv, io = DEFAULT_IO) {
  const opts = parseArgs(argv);
  const files = listTrackedFiles(opts.root);
  const pins = collectPins(opts.root, files);
  const published = loadPublishedVersions(opts);
  let packageVersion = null;
  try { packageVersion = JSON.parse(fs.readFileSync(path.join(opts.root, 'package.json'), 'utf8')).version; } catch { /* none */ }
  const bad = checkPins({ pins, published, packageVersion, allowUnreleasedPackageVersion: opts.allowUnreleasedPackageVersion });
  if (bad.length) {
    io.error(`Found ${bad.length} pinned thumbgate@<version> not published on npm:`);
    for (const p of bad) io.error(`${p.file}:${p.line} thumbgate@${p.version}`);
    return 1;
  }
  io.log(`OK: ${pins.length} pinned thumbgate@<version> strings in ${files.length} files all exist on npm.`);
  return 0;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    console.error(`check-npm-published-versions: ${err.message}`);
    process.exitCode = 2;
  }
}

module.exports = { run, collectPins, listTrackedFiles, checkPins, compareSemver, PIN_RE };
