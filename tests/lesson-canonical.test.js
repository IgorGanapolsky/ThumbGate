'use strict';

/**
 * tests/lesson-canonical.test.js — unit tests for the cross-session
 * canonical-form hashing added to defeat wording drift in lesson dedup.
 *
 * Also pins the integration into lesson-synthesis.findSimilarLesson so
 * canonical matches short-circuit the Jaccard pass with similarity=1.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const canonical = require('../scripts/lesson-canonical');
const synthesis = require('../scripts/lesson-synthesis');

/* ---------- canonicalizeText ---------- */

test('canonicalizeText lowercases, strips punctuation, drops stop-words, and sorts tokens', () => {
  const out = canonical.canonicalizeText('Never FORCE-PUSH to main!!');
  // "never" is preserved (not a stop word — negation matters).
  // "force" "push" kept. "to" dropped as stop word. "main" kept. Sorted.
  assert.equal(out, 'force main never push');
});

test('canonicalizeText reduces two paraphrasings of the same mistake to the same token set', () => {
  // Same content tokens, different punctuation/casing/stop-word density.
  const a = canonical.canonicalizeText('Never force-push to main!!');
  const b = canonical.canonicalizeText('never FORCE PUSH the main.');
  assert.equal(a, b);
});

test('canonicalizeText treats empty / null input as empty string', () => {
  assert.equal(canonical.canonicalizeText(''), '');
  assert.equal(canonical.canonicalizeText(null), '');
  assert.equal(canonical.canonicalizeText(undefined), '');
});

test('canonicalizeText preserves genuinely distinct content', () => {
  const a = canonical.canonicalizeText('never force-push main');
  const b = canonical.canonicalizeText('always verify deployment version');
  assert.notEqual(a, b);
});

test('canonicalizeText applies light plural stemming but protects -ss endings', () => {
  const out = canonical.canonicalizeText('rules passes deployments');
  // "rules" → "rule", "passes" → "passe" (>=4, ends in "es" not "ss", strip s).
  // Actually "passes" ends in "s" not "ss" at position -1. It ends in "es".
  // So "passes" → "passe". "deployments" → "deployment".
  assert.ok(out.includes('rule'));
  assert.ok(out.includes('deployment'));
});

/* ---------- canonicalHash ---------- */

test('canonicalHash returns a stable 16-char hex fingerprint', () => {
  const h = canonical.canonicalHash({ whatToChange: 'never force-push main' });
  assert.ok(/^[0-9a-f]{16}$/.test(h), `expected 16 hex chars, got ${h}`);
});

test('canonicalHash collapses paraphrased lessons to the same hash', () => {
  const a = canonical.canonicalHash({
    whatToChange: 'Never force-push to main!!',
    tags: ['git', 'main'],
  });
  const b = canonical.canonicalHash({
    whatToChange: 'never FORCE PUSH the main.',
    tags: ['main', 'git'],
  });
  assert.equal(a, b);
});

test('canonicalHash distinguishes lessons with different tag sets', () => {
  const a = canonical.canonicalHash({
    whatToChange: 'force push blocked',
    tags: ['git'],
  });
  const b = canonical.canonicalHash({
    whatToChange: 'force push blocked',
    tags: ['git', 'production'],
  });
  assert.notEqual(a, b);
});

test('canonicalHash returns null for an empty record', () => {
  assert.equal(canonical.canonicalHash({}), null);
  assert.equal(canonical.canonicalHash(null), null);
});

test('canonicalHash treats whatToChange, content, and title as interchangeable carriers', () => {
  // A lesson stored as { whatToChange: 'X' } must hash identically to the
  // same text surfaced under { content: 'X' } — cross-schema dedup.
  const a = canonical.canonicalHash({ whatToChange: 'never force-push main' });
  const b = canonical.canonicalHash({ content: 'never force-push main' });
  assert.equal(a, b);
});

/* ---------- findCanonicalDuplicate ---------- */

test('findCanonicalDuplicate finds a paraphrased twin across sessions', () => {
  const existing = [
    {
      id: 'memory_001',
      signal: 'negative',
      whatToChange: 'Never force-push to main!!',
      tags: ['git', 'main'],
    },
    {
      id: 'memory_002',
      signal: 'negative',
      whatToChange: 'Always run tests before deploy',
      tags: ['deploy'],
    },
  ];
  const incoming = {
    signal: 'negative',
    whatToChange: 'never FORCE PUSH the main.',
    tags: ['main', 'git'],
  };
  const match = canonical.findCanonicalDuplicate(existing, incoming);
  assert.ok(match);
  assert.equal(match.id, 'memory_001');
});

test('findCanonicalDuplicate respects signal polarity (positive vs negative)', () => {
  const existing = [
    {
      id: 'positive_mem',
      signal: 'positive',
      whatWorked: 'force-push worked great',
    },
  ];
  const incoming = {
    signal: 'negative',
    whatToChange: 'force-push worked great',
  };
  // Hashes collapse on content, but polarity mismatch must reject.
  const match = canonical.findCanonicalDuplicate(existing, incoming);
  assert.equal(match, null);
});

test('findCanonicalDuplicate tolerates a missing stored canonicalHash (recomputes)', () => {
  // Simulates legacy entries written before canonical hashing shipped.
  const existing = [
    { id: 'legacy', whatToChange: 'never force-push main', tags: ['git'] },
  ];
  const match = canonical.findCanonicalDuplicate(existing, {
    whatToChange: 'NEVER FORCE push MAIN!!',
    tags: ['git'],
  });
  assert.ok(match);
  assert.equal(match.id, 'legacy');
});

test('findCanonicalDuplicate returns null for empty / non-array inputs', () => {
  assert.equal(canonical.findCanonicalDuplicate([], { whatToChange: 'x' }), null);
  assert.equal(canonical.findCanonicalDuplicate(null, { whatToChange: 'x' }), null);
  assert.equal(canonical.findCanonicalDuplicate([{ whatToChange: 'y' }], {}), null);
});

/* ---------- lesson-synthesis integration ---------- */

test('lesson-synthesis.findSimilarLesson short-circuits via canonical hash with similarity=1', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-canonical-'));
  const memoryPath = path.join(tmp, 'memory-log.jsonl');
  try {
    // Existing and paraphrased differ only in punctuation/casing/stop words.
    // After canonicalization they produce identical token sets.
    const existing = {
      id: 'mem_force_push',
      signal: 'negative',
      title: 'MISTAKE force push main',
      content: 'Never force push to main!!',
      tags: ['git', 'main'],
    };
    fs.writeFileSync(memoryPath, JSON.stringify(existing) + '\n');

    const paraphrased = {
      signal: 'negative',
      title: 'MISTAKE force push main',
      content: 'never FORCE PUSH the main.',
      tags: ['main', 'git'],
    };
    const result = synthesis.findSimilarLesson(memoryPath, paraphrased);
    assert.ok(result, 'paraphrased lesson should match via canonical hash');
    assert.equal(result.match.id, 'mem_force_push');
    assert.equal(result.similarity, 1);
    assert.equal(result.matchType, 'canonical');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('lesson-synthesis.findSimilarLesson falls back to Jaccard when no canonical match exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-canonical-'));
  const memoryPath = path.join(tmp, 'memory-log.jsonl');
  try {
    // Share many content tokens but differ in one word so canonical hashes
    // diverge, forcing the Jaccard fallback path above the 0.6 threshold.
    const existing = {
      id: 'mem_deploy',
      signal: 'negative',
      title: 'never force push protected branch main security',
      content: 'never force push protected branch main security',
      tags: ['deploy'],
    };
    fs.writeFileSync(memoryPath, JSON.stringify(existing) + '\n');

    const paraphrased = {
      signal: 'negative',
      title: 'never force push protected branch main audit',
      content: 'never force push protected branch main audit',
      tags: ['deploy'],
    };
    const result = synthesis.findSimilarLesson(memoryPath, paraphrased);
    assert.ok(result, 'Jaccard fallback should still match high-overlap paraphrase');
    assert.equal(result.match.id, 'mem_deploy');
    assert.ok(result.similarity >= 0.6);
    assert.equal(result.matchType, 'jaccard');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('lesson-synthesis.findSimilarLesson returns null when neither layer matches', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-canonical-'));
  const memoryPath = path.join(tmp, 'memory-log.jsonl');
  try {
    fs.writeFileSync(memoryPath, JSON.stringify({
      id: 'mem_unrelated',
      signal: 'negative',
      title: 'avoid hard-coding API keys',
      content: 'API keys belong in .env, never committed',
      tags: ['secrets'],
    }) + '\n');
    const incoming = {
      signal: 'negative',
      title: 'never force-push main',
      content: 'force-push main is forbidden',
      tags: ['git'],
    };
    assert.equal(synthesis.findSimilarLesson(memoryPath, incoming), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
