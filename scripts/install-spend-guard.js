#!/usr/bin/env node
'use strict';

/**
 * Install the financial spend guard into ~/.thumbgate/bin (live PreToolUse hook).
 *
 * The live path is often uchg-locked so agents cannot silently weaken it.
 * This installer: unlocks → copies guard + ERP dependency tree → re-locks → proves.
 *
 * Usage:
 *   node scripts/install-spend-guard.js
 *   node scripts/install-spend-guard.js --dry-run
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'scripts');
const DST_DIR = path.join(process.env.HOME || os.homedir(), '.thumbgate', 'bin');
const ENTRY = 'thumbgate-spend-guard.js';
const HARDENED = 'thumbgate-spend-guard.HARDENED.js';
const DRY = process.argv.includes('--dry-run');

function listRelativeRequires(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const out = [];
  for (const m of text.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)) {
    let rel = m[1].slice(2);
    if (!rel.endsWith('.js')) rel = `${rel}.js`;
    out.push(rel);
  }
  return out;
}

function collectTree(seedNames) {
  const seen = new Set();
  const queue = [...seedNames];
  const files = [];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const src = path.join(SRC_DIR, name);
    if (!fs.existsSync(src)) {
      throw new Error(`missing dependency: ${name} (looked in ${src})`);
    }
    files.push(name);
    for (const rel of listRelativeRequires(src)) {
      if (!seen.has(rel)) queue.push(rel);
    }
  }
  return files;
}

function chflags(file, flag) {
  if (!fs.existsSync(file)) return;
  const r = spawnSync('chflags', [flag, file], { encoding: 'utf8' });
  if (r.status !== 0 && flag === 'nouchg') {
    // already unlocked is fine
  }
}

function copyFile(name) {
  const src = path.join(SRC_DIR, name);
  const dst = path.join(DST_DIR, name);
  chflags(dst, 'nouchg');
  if (DRY) {
    console.log(`dry-run: copy ${name}`);
    return;
  }
  fs.mkdirSync(DST_DIR, { recursive: true, mode: 0o700 });
  fs.copyFileSync(src, dst);
  if (name.includes('spend-guard')) {
    fs.chmodSync(dst, 0o700);
  }
}

function prove() {
  const guardPath = path.join(DST_DIR, ENTRY);
  const cases = [
    ['git', { tool_name: 'Bash', tool_input: { command: 'git checkout -b feature/x' } }, 'allow'],
    ['prose', { tool_name: 'Bash', tool_input: { command: 'echo dirty primary checkout' } }, 'allow'],
    ['stripe', { tool_name: 'Bash', tool_input: { command: 'open https://checkout.stripe.com/c/pay/x' } }, 'deny'],
    ['path', { tool_name: 'Bash', tool_input: { command: 'open https://example.com/checkout' } }, 'deny'],
    ['buy', { tool_name: 'Bash', tool_input: { command: 'curl https://buy.stripe.com/test' } }, 'deny'],
    ['apollo', { tool_name: 'Bash', tool_input: { command: 'curl https://app.apollo.io/#/settings/plans/upgrade' } }, 'deny'],
  ];
  let bad = 0;
  for (const [label, event, expect] of cases) {
    const r = spawnSync(process.execPath, [guardPath], {
      input: JSON.stringify(event),
      encoding: 'utf8',
    });
    let decision = '?';
    try {
      const line = String(r.stdout || '').trim().split('\n').filter(Boolean).pop();
      decision = JSON.parse(line).decision;
    } catch {
      // ignore
    }
    const exitOk = expect === 'deny' ? r.status === 2 : r.status === 0;
    const ok = exitOk && decision === expect;
    if (!ok) bad += 1;
    console.log(`${ok ? 'OK' : 'FAIL'} ${label}: exit=${r.status} decision=${decision} expect=${expect}`);
  }
  if (bad) throw new Error(`live prove failed: ${bad} cases`);
}

function main() {
  const files = collectTree([ENTRY]);
  console.log(`Installing spend guard → ${DST_DIR}`);
  console.log(`Tree: ${files.join(', ')}`);
  for (const name of files) copyFile(name);
  // Keep HARDENED as a restore-from copy of the same surface.
  if (!DRY) {
    chflags(path.join(DST_DIR, HARDENED), 'nouchg');
    fs.copyFileSync(path.join(DST_DIR, ENTRY), path.join(DST_DIR, HARDENED));
    fs.chmodSync(path.join(DST_DIR, HARDENED), 0o700);
  } else {
    console.log(`dry-run: mirror ${ENTRY} → ${HARDENED}`);
  }
  if (!DRY) {
    prove();
    chflags(path.join(DST_DIR, ENTRY), 'uchg');
    chflags(path.join(DST_DIR, HARDENED), 'uchg');
    chflags(path.join(DST_DIR, 'financial-control-plane.js'), 'uchg');
  }
  console.log(DRY ? 'dry-run complete' : 'Installed, proved, re-locked (uchg).');
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  try {
    main();
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }
}

module.exports = { collectTree, listRelativeRequires };
