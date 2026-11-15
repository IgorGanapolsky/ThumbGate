'use strict';

/**
 * Packed CLI require-closure guard.
 *
 * thumbgate@1.39.0 and 1.40.1 shipped without scripts/third-author-governance.js
 * while bin/cli.js required it, so `npx thumbgate gate-check` printed
 * "Cannot find module" from a clean install. This test packs the repo, unpacks
 * the tarball, and checks that every local module reachable from bin/cli.js
 * (static require('./x'), require(path.join(PKG_ROOT, ...)), and everything
 * those files require in turn) exists in the tarball.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const ENTRYPOINTS = ['bin/cli.js'];
const EXTS = ['', '.js', '.json', '.cjs', '/index.js'];

function resolveFile(base) {
  for (const ext of EXTS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// Returns [{ spec, target }] where target is an absolute path candidate base.
function extractRequires(file, root) {
  const src = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const out = [];
  const rel = /\brequire\(\s*(['"`])(\.{1,2}\/[^'"`$]+)\1\s*\)/g;
  for (let m = rel.exec(src); m; m = rel.exec(src)) {
    out.push({ spec: m[2], base: path.resolve(dir, m[2]) });
  }
  const joined = /\brequire\(\s*path\.(?:join|resolve)\(\s*(?:PKG_ROOT|ROOT|REPO_ROOT|PROJECT_ROOT|__dirname)\s*,\s*((?:(['"])[^'"]+\2\s*,?\s*)+)\)\s*\)/g;
  for (let m = joined.exec(src); m; m = joined.exec(src)) {
    const parts = [...m[1].matchAll(/(['"])([^'"]+)\1/g)].map((p) => p[2]);
    const useDirname = /__dirname\s*,/.test(m[0]);
    out.push({ spec: parts.join('/'), base: path.resolve(useDirname ? dir : root, ...parts) });
  }
  return out;
}

function closure(root, entries) {
  const seen = new Set();
  const missing = [];
  const queue = entries.map((e) => path.join(root, e));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { spec, base } of extractRequires(file, root)) {
      const resolved = resolveFile(base);
      if (!resolved) {
        missing.push(`${path.relative(root, file)} -> ${spec}`);
      } else if (/\.(c?js)$/.test(resolved)) {
        queue.push(resolved);
      }
    }
  }
  return { files: [...seen], missing };
}

let tmp;
let pkgRoot;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-pack-'));
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', tmp], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }));
  const tarball = path.join(tmp, (Array.isArray(packed) ? packed[0] : packed).filename);
  const unpacked = path.join(tmp, 'unpacked');
  fs.mkdirSync(unpacked);
  execFileSync('tar', ['-xzf', tarball, '-C', unpacked]);
  pkgRoot = path.join(unpacked, 'package');
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

function childEnv() {
  return { ...process.env, THUMBGATE_FEEDBACK_DIR: path.join(tmp, 'feedback'), THUMBGATE_NO_TELEMETRY: '1' };
}

// Only local (relative or in-package absolute) misses count: a bare package
// name such as better-sqlite3 is a dependency, not a packaging omission.
function localMissing(output) {
  const hits = [];
  for (const m of output.matchAll(/Cannot find module '([^']+)'/g)) {
    if (m[1].startsWith('.') || m[1].startsWith(pkgRoot)) hits.push(m[1]);
  }
  return hits;
}

test('every closure file loads from the unpacked package without a missing local module', () => {
  const { files } = closure(pkgRoot, ENTRYPOINTS);
  const loadable = files.filter((f) => /\.c?js$/.test(f) && path.relative(pkgRoot, f) !== path.join('bin', 'cli.js'));
  const failures = [];
  for (const file of loadable) {
    const run = spawnSync(process.execPath, ['-e', 'require(process.argv[1])', file], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(),
    });
    const hits = localMissing(`${run.stdout || ''}\n${run.stderr || ''}`);
    if (hits.length > 0) failures.push(`${path.relative(pkgRoot, file)}: ${[...new Set(hits)].join(', ')}`);
  }
  assert.deepEqual(failures, [], `require() hit MODULE_NOT_FOUND in the unpacked package:\n${failures.join('\n')}`);
});

test('unpacked CLI gate-check prints no missing-module or ThumbGate Error output', () => {
  const run = spawnSync(process.execPath, [path.join(pkgRoot, 'bin', 'cli.js'), 'gate-check'], {
    cwd: tmp,
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv(),
  });
  const out = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.equal(/Cannot find module/.test(out), false, `gate-check hit a missing module:\n${out.slice(0, 1500)}`);
  assert.equal(/\[ThumbGate Error\]/.test(out), false, `gate-check printed [ThumbGate Error]:\n${out.slice(0, 1500)}`);
});

test('every module reachable from bin/cli.js exists in the packed tarball', () => {
  {
    const { files, missing } = closure(pkgRoot, ENTRYPOINTS);
    assert.ok(files.length > 10, `closure walk looks empty (${files.length} files)`);
    // A require whose target is absent from the source tree too is a guarded
    // optional load (try/catch), not a packaging omission.
    const omitted = [...new Set(missing)].filter((entry) => {
      const [from, spec] = entry.split(' -> ');
      const srcBase = path.resolve(repoRoot, path.dirname(from), spec);
      const rootBase = path.resolve(repoRoot, spec);
      return resolveFile(srcBase) || resolveFile(rootBase);
    }).sort();
    assert.deepEqual(
      omitted,
      [],
      `packed tarball is missing modules required by bin/cli.js:\n${omitted.join('\n')}`
    );
  }
});
