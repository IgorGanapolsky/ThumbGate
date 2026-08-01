// tests/capability-wiring-ratchet.test.js
'use strict';

// Ratchet against the most expensive defect class of 2026-07-31: a component that
// is well-written, fully tested, named after a capability — and wired to nothing.
//
// Instances found in a single session:
//   1. auto-promote-gates.js  — promoted gates carried tag-derived patterns that
//      could never match a command. Tests asserted promotion HAPPENED, never that
//      the gate ENFORCED. Fixed in #3125.
//   2. judge-reward-function.js — 408 lines of LLM-as-a-Judge whose
//      buildCompositeReward was called only from its own test.
//   3. cross-encoder-reranker.js — named for a cross-encoder, actually an LLM
//      reranker whose useLLM flag defaults false with no caller overriding it.
//   4. inference-cache-policy / observability-setup / decision-trace /
//      agent-audit-trace — zero runtime callers apiece.
//
// Unit tests structurally cannot catch this: each module passes its own tests in
// isolation. The defect is the ABSENCE of a caller.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');

// Baseline captured 2026-08-01: 42 orphans across 544 scripts.
//
// The first version reported 19/475 — wrong twice over. It scanned only immediate
// children of scripts/ (hiding 69 nested modules) and counted package.json's
// `files` array as a call site, which lists every packaged script and so marked
// almost the whole tree "wired". The ratchet was close to a no-op.
//
// May fall freely; raising it means a capability shipped with no caller — wire it,
// delete it, or bump with a note saying why it ships uncalled.
const MAX_ORPHANS = 42;

function trackedTextFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).filter((f) => /\.(js|json|ya?ml|sh|md|toml)$/.test(f));
}

/**
 * Every capability script, including nested ones.
 *
 * The first version scanned only immediate children of scripts/, leaving 69
 * modules under scripts/lib, scripts/durability, scripts/social-analytics and
 * friends permanently invisible to the ratchet.
 */
function allCapabilityScripts() {
  const scriptsDir = path.join(root, 'scripts');
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__pycache__') continue;
        walk(abs);
      } else if (entry.name.endsWith('.js')) {
        found.push({
          name: entry.name.slice(0, -3),
          rel: path.relative(root, abs).split(path.sep).join('/'),
        });
      }
    }
  };
  walk(scriptsDir);
  return found;
}

/**
 * Text that can legitimately prove a module is REACHED.
 *
 * package.json needs special handling: its `files` array lists every packaged
 * script by path, so a naive substring scan marks the entire tree "wired" and the
 * ratchet silently measures nothing. Only the `scripts` block counts — an npm run
 * entry is a real invocation; a packaging manifest is not.
 */
function referenceCorpus() {
  const corpus = [];
  for (const rel of trackedTextFiles()) {
    if (rel.startsWith('tests/')) continue;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;

    if (rel === 'package.json') {
      try {
        const pkg = JSON.parse(fs.readFileSync(abs, 'utf8'));
        corpus.push([rel, JSON.stringify(pkg.scripts || {})]);
      } catch { /* unreadable manifest proves nothing */ }
      continue;
    }
    corpus.push([rel, fs.readFileSync(abs, 'utf8')]);
  }
  return corpus;
}

/**
 * A script is an ORPHAN when its basename appears nowhere outside its own file,
 * tests/, and packaging manifests.
 *
 * Matching stays permissive — a require, an npm script, a workflow step, or a docs
 * mention all count. We hunt modules with NO reachable caller, not import hygiene,
 * so false positives are unacceptable and false negatives are tolerable.
 */
function findOrphans() {
  const scripts = allCapabilityScripts();
  const corpus = referenceCorpus();

  return scripts
    .filter(({ name, rel }) => !corpus.some(([r, text]) => r !== rel && text.includes(name)))
    .map(({ rel }) => rel)
    .sort();
}

test('capability wiring: orphan scripts do not grow', () => {
  const orphans = findOrphans();
  assert.ok(
    orphans.length <= MAX_ORPHANS,
    `orphan scripts rose to ${orphans.length} (max ${MAX_ORPHANS}). `
    + `A capability shipped with no caller anywhere outside tests/:\n  ${orphans.join('\n  ')}\n`
    + 'Wire it, delete it, or bump MAX_ORPHANS with a note saying why it ships uncalled.'
  );
});

test('capability wiring: the packaging manifest never counts as a caller', () => {
  // package.json `files` lists every packaged script by path. Counting it as a
  // reference made the first version of this ratchet a near no-op — almost the
  // whole tree looked wired. Guard the guard.
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packagedScripts = (pkg.files || []).filter((f) => f.startsWith('scripts/') && f.endsWith('.js'));
  assert.ok(packagedScripts.length > 0, 'package.json still lists packaged scripts — precondition for this guard');

  const corpus = referenceCorpus();
  const manifest = corpus.find(([rel]) => rel === 'package.json');
  assert.ok(manifest, 'package.json is in the corpus');

  // An npm `scripts` entry like `node scripts/foo.js` IS a real call site, so the
  // manifest corpus legitimately contains some script paths. The property that
  // matters: a module listed ONLY for packaging, never invoked, must not be
  // rescued by its presence in `files`.
  const invoked = JSON.stringify(pkg.scripts || {});
  const packagedOnly = packagedScripts.filter((f) => !invoked.includes(f.slice('scripts/'.length, -3)));
  assert.ok(
    packagedOnly.length > 0,
    'expected at least one script packaged but never invoked — precondition for this guard'
  );
  for (const entry of packagedOnly.slice(0, 20)) {
    assert.ok(
      !manifest[1].includes(entry),
      `${entry} is packaged but never invoked; the files[] listing must not count as a call site`
    );
  }
});

test('capability wiring: nested scripts are in scope', () => {
  // 69 modules under scripts/*/ were invisible to the first version.
  const all = allCapabilityScripts();
  const nested = all.filter((s) => s.rel.split('/').length > 2);
  assert.ok(nested.length > 0, 'nested capability scripts exist and must be scanned');
});

test('capability wiring: a module claiming to gate or score is reachable', () => {
  // The modules whose NAMES make a product claim — the ones whose silence is most
  // expensive, because the landing page and the pitch assume they run.
  const orphans = new Set(findOrphans());
  for (const name of ['gates-engine', 'auto-promote-gates', 'lesson-retrieval']) {
    const rel = `scripts/${name}.js`;
    assert.ok(fs.existsSync(path.join(root, rel)), `${rel} is missing — a claim-bearing module was deleted`);
    assert.ok(!orphans.has(rel), `${rel} is orphaned: nothing outside tests/ calls it`);
  }
});
