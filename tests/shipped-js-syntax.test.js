'use strict';

/**
 * Regression guard: every JavaScript file the npm package ships must parse,
 * and no shipped text file may contain an unresolved merge conflict marker.
 * thumbgate@1.40.10 published scripts/cli-schema.js with conflict markers, which made
 * `thumbgate help all` crash with a SyntaxError.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const JS_EXT = /\.(js|cjs|mjs)$/;
const TEXT_EXT = /\.(js|cjs|mjs|json|md|html|css|yml|yaml|toml|sh|txt)$/;
const MARKER = /^(<<<<<<< |>>>>>>> )/m;

function shippedFiles() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(out);
  return parsed[0].files.map((f) => f.path);
}

const files = shippedFiles();

test('the npm pack list is not empty', () => {
  assert.ok(files.length > 50, `expected a real file list, got ${files.length}`);
});

test('every shipped .js/.cjs/.mjs file passes node --check', () => {
  const failures = [];
  for (const rel of files.filter((f) => JS_EXT.test(f))) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const res = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
    if (res.status !== 0) {
      failures.push(`${rel}: ${(res.stderr || '').split('\n').find((l) => /Error/.test(l)) || 'syntax error'}`);
    }
  }
  assert.deepEqual(failures, [], `shipped files with syntax errors:\n${failures.join('\n')}`);
});

test('no shipped text file contains a merge conflict marker', () => {
  const hits = [];
  for (const rel of files.filter((f) => TEXT_EXT.test(f))) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    if (MARKER.test(fs.readFileSync(abs, 'utf8'))) hits.push(rel);
  }
  assert.deepEqual(hits, [], `conflict markers in: ${hits.join(', ')}`);
});
