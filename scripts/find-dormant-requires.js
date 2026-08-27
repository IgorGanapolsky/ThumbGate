#!/usr/bin/env node
/**
 * find-dormant-requires — report `const X = require(...)` bindings that are
 * never referenced again in the file.
 *
 * Dependency-free on purpose: this repo has no eslint, no prettier and no lint
 * script across 1,331 JS files (measured 2026-08-27 on d0bb3768), so there is
 * no existing tool to lean on and adding one is a separate decision.
 *
 * Deliberately conservative — it only reports a binding when ALL of these hold,
 * so that acting on the output is safe:
 *   - the require is a top-level `const` with a plain identifier or a simple
 *     destructuring pattern
 *   - the identifier appears exactly once in the file (its own declaration)
 *   - the file is not a test fixture and does not use `eval`
 *
 * It does NOT delete anything. Output is a candidate list with file:line.
 *
 * Usage: node scripts/find-dormant-requires.js [--json] [--dir=src]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const dirArg = (argv.find((a) => a.startsWith('--dir=')) || '').slice(6);

function tracked() {
  const out = execFileSync('git', ['ls-files', '*.js'], { cwd: ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => !dirArg || f.startsWith(dirArg))
    .filter((f) => !f.includes('node_modules/'))
    .filter((f) => !/\.min\.js$/.test(f));
}

/**
 * Escape every RegExp metacharacter, backslash included.
 * The first version escaped only the dollar sign, which CodeQL flagged as
 * incomplete escaping (js/incomplete-sanitization): a backslash would survive
 * into the constructed pattern and corrupt it.
 */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, (m) => "\\" + m);
}

// `const NAME = require(` and `const { A, B } = require(`
const SINGLE = /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(/;
const DESTRUCT = /^\s*const\s*\{([^}]+)\}\s*=\s*require\(/;

const findings = [];
let scanned = 0;

for (const rel of tracked()) {
  const abs = path.join(ROOT, rel);
  let src;
  try {
    src = fs.readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  scanned++;
  if (src.includes('eval(')) continue; // identifiers may be referenced dynamically

  const lines = src.split('\n');
  const names = [];
  lines.forEach((line, i) => {
    const s = line.match(SINGLE);
    if (s) {
      names.push({ name: s[1], line: i + 1 });
      return;
    }
    const d = line.match(DESTRUCT);
    if (d) {
      d[1]
        .split(',')
        .map((p) => p.trim().split(':').pop().trim())
        .filter((p) => /^[A-Za-z_$][\w$]*$/.test(p))
        .forEach((n) => names.push({ name: n, line: i + 1 }));
    }
  });
  if (!names.length) continue;

  for (const { name, line } of names) {
    // count whole-word occurrences across the file
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
    const hits = (src.match(re) || []).length;
    if (hits <= 1) findings.push({ file: rel, line, name });
  }
}

if (asJson) {
  console.log(JSON.stringify({ scanned, findings }, null, 2));
} else {
  console.log(`scanned ${scanned} tracked .js files`);
  console.log(`dormant require bindings: ${findings.length}\n`);
  const byFile = {};
  for (const f of findings) (byFile[f.file] ||= []).push(f);
  const sorted = Object.entries(byFile).sort((a, b) => b[1].length - a[1].length);
  for (const [file, list] of sorted.slice(0, 40)) {
    console.log(`  ${file}`);
    for (const f of list) console.log(`      line ${String(f.line).padStart(4)}  ${f.name}`);
  }
  if (sorted.length > 40) console.log(`  ... and ${sorted.length - 40} more files`);
}
