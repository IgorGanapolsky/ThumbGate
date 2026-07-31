// tests/capability-wiring-ratchet.test.js
'use strict';

// Ratchet against the most expensive defect class of 2026-07-31: a component that
// is well-written, fully tested, named after a capability — and wired to nothing.
//
// Three independent instances surfaced in a single session:
//   1. auto-promote-gates.js  — promoted gates carried tag-derived patterns that
//      could never match a command. Tests asserted promotion HAPPENED, never that
//      the gate ENFORCED. Fixed in #3125.
//   2. judge-reward-function.js — 408 lines of LLM-as-a-Judge. `buildCompositeReward`
//      is called only from its own test; nothing injects a judge fn, so scoringMode
//      is permanently 'deterministic_only'.
//   3. cross-encoder-reranker.js — named for a cross-encoder, actually an LLM
//      reranker gated on ANTHROPIC_API_KEY with a silent heuristic fallback.
//
// Unit tests cannot catch this: each module passes its own tests in isolation.
// The defect is the ABSENCE of a caller. So we ratchet the orphan count instead —
// same pattern as tests/package-boundary.test.js. The number may fall freely as
// dead code is deleted or wired; it may not rise without a deliberate bump.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');

// Baseline captured 2026-07-31 against 475 scripts. Raising this means a new
// capability shipped with no caller — justify it in the bump or wire the module.
const MAX_ORPHANS = 19;

function trackedTextFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).filter((f) => /\.(js|json|ya?ml|sh|md|toml)$/.test(f));
}

/**
 * A script is an ORPHAN when its basename appears nowhere in the tracked tree
 * except inside its own file and under tests/.
 *
 * Substring matching is deliberate and permissive: a require(), an npm script, a
 * workflow step, or even a docs mention all count as "something references this".
 * We are hunting modules with NO reachable caller at all, not enforcing import
 * hygiene — so false negatives are acceptable and false positives are not.
 */
function findOrphans() {
  const scriptsDir = path.join(root, 'scripts');
  const scripts = fs.readdirSync(scriptsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.slice(0, -3));

  const corpus = [];
  for (const rel of trackedTextFiles()) {
    if (rel.startsWith('tests/')) continue;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    corpus.push([rel, fs.readFileSync(abs, 'utf8')]);
  }

  return scripts.filter((name) => {
    const self = `scripts/${name}.js`;
    return !corpus.some(([rel, text]) => rel !== self && text.includes(name));
  }).sort();
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

test('capability wiring: a module claiming to gate or score is reachable', () => {
  // Narrower, higher-signal check. These are the modules whose NAMES make a
  // product claim — the ones whose silence is most expensive, because the
  // landing page and the pitch both assume they run.
  const claimBearing = ['gates-engine', 'auto-promote-gates', 'lesson-retrieval'];
  const orphans = new Set(findOrphans());
  for (const name of claimBearing) {
    assert.ok(
      fs.existsSync(path.join(root, 'scripts', `${name}.js`)),
      `${name}.js is missing — a claim-bearing module was deleted`
    );
    assert.ok(!orphans.has(name), `${name}.js is orphaned: nothing outside tests/ calls it`);
  }
});
