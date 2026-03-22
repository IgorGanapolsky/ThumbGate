#!/usr/bin/env node
/**
 * principle-extractor.js
 *
 * MemAlign-style semantic memory: extracts generalizable principles
 * (reusable guidelines) from natural-language feedback entries.
 *
 * Pipeline:
 *   feedback-log.jsonl → extract NL fields → generalize → dedup → principles.jsonl
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getFeedbackPaths, readJSONL, inferDomain } = require('./feedback-loop');

const PRINCIPLES_FILENAME = 'principles.jsonl';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function appendJSONL(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function normalizePrincipleText(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function generateId() {
  return `prin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function extractPrinciple(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const signal = String(entry.signal || '').toLowerCase();
  const isNegative = ['negative', 'down'].includes(signal);
  const isPositive = ['positive', 'up'].includes(signal);
  if (!isNegative && !isPositive) return null;

  let text = null;

  if (isNegative) {
    const wrong = (entry.whatWentWrong || '').trim();
    const change = (entry.whatToChange || '').trim();
    if (!wrong && !change) return null;

    if (wrong && change) {
      text = `NEVER ${wrong}. ALWAYS ${change}.`;
    } else if (change) {
      text = `ALWAYS ${change}.`;
    } else {
      text = `NEVER ${wrong}.`;
    }
  }

  if (isPositive) {
    const worked = (entry.whatWorked || '').trim();
    if (!worked) return null;

    const ctx = (entry.context || '').trim();
    if (ctx) {
      text = `ALWAYS ${worked} when ${ctx}.`;
    } else {
      text = `ALWAYS ${worked}.`;
    }
  }

  if (!text) return null;

  const tags = Array.isArray(entry.tags) ? [...entry.tags] : [];
  const domain = inferDomain(tags, entry.context || '');

  return {
    id: generateId(),
    text,
    source: entry.id || entry.timestamp || 'unknown',
    sourceSignal: isPositive ? 'positive' : 'negative',
    tags,
    domain,
    extractedAt: new Date().toISOString(),
    sourceCount: 1,
  };
}

function extractAllPrinciples(logPath, principlesPath) {
  const feedbackDir = logPath
    ? path.dirname(logPath)
    : getFeedbackPaths().FEEDBACK_DIR;
  const feedbackLogPath = logPath || path.join(feedbackDir, 'feedback-log.jsonl');
  const outPath = principlesPath || path.join(feedbackDir, PRINCIPLES_FILENAME);

  const entries = readJSONL(feedbackLogPath);
  const existing = readJSONL(outPath);

  const normalizedIndex = new Map();
  for (const p of existing) {
    normalizedIndex.set(normalizePrincipleText(p.text), p);
  }

  let newCount = 0;
  let deduped = 0;

  for (const entry of entries) {
    const principle = extractPrinciple(entry);
    if (!principle) continue;

    const key = normalizePrincipleText(principle.text);
    if (normalizedIndex.has(key)) {
      const dup = normalizedIndex.get(key);
      dup.sourceCount = (dup.sourceCount || 1) + 1;
      deduped++;
    } else {
      normalizedIndex.set(key, principle);
      newCount++;
    }
  }

  const allPrinciples = [...normalizedIndex.values()];
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(
    outPath,
    allPrinciples.map((p) => JSON.stringify(p)).join('\n') + (allPrinciples.length ? '\n' : '')
  );

  return { principles: allPrinciples, newCount, deduped };
}

function getPrinciples(opts = {}) {
  const { tags, domain, limit, principlesPath } = opts;
  const filePath = principlesPath
    || path.join(getFeedbackPaths().FEEDBACK_DIR, PRINCIPLES_FILENAME);

  let principles = readJSONL(filePath);

  if (tags && tags.length > 0) {
    const tagSet = new Set(tags.map((t) => t.toLowerCase()));
    principles = principles.filter((p) =>
      (p.tags || []).some((t) => tagSet.has(t.toLowerCase()))
    );
  }

  if (domain) {
    const d = domain.toLowerCase();
    principles = principles.filter((p) =>
      (p.domain || '').toLowerCase() === d
    );
  }

  if (limit && limit > 0) {
    principles = principles.slice(0, limit);
  }

  return principles;
}

module.exports = {
  PRINCIPLES_FILENAME,
  extractPrinciple,
  extractAllPrinciples,
  getPrinciples,
  normalizePrincipleText,
};

if (require.main === module) {
  if (process.argv.includes('--test')) {
    const os = require('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'principle-test-'));
    const feedbackLog = path.join(tmpDir, 'feedback-log.jsonl');
    const principlesFile = path.join(tmpDir, PRINCIPLES_FILENAME);
    let passed = 0, failed = 0;
    function assert(label, cond) {
      if (cond) { passed++; console.log(`  PASS ${label}`); }
      else { failed++; console.log(`  FAIL ${label}`); }
    }
    const neg = extractPrinciple({ signal: 'negative', whatWentWrong: 'committed secrets', whatToChange: 'run scanner', tags: ['security'] });
    assert('neg principle', neg && neg.text.includes('NEVER'));
    const pos = extractPrinciple({ signal: 'positive', whatWorked: 'ran tests first', tags: ['testing'] });
    assert('pos principle', pos && pos.text.includes('ALWAYS'));
    assert('null on empty', extractPrinciple({ signal: 'negative' }) === null);
    fs.writeFileSync(feedbackLog, [
      JSON.stringify({ signal: 'negative', whatWentWrong: 'forgot lint', whatToChange: 'always lint', tags: ['git'] }),
      JSON.stringify({ signal: 'positive', whatWorked: 'used TDD', tags: ['testing'] }),
    ].join('\n') + '\n');
    const r = extractAllPrinciples(feedbackLog, principlesFile);
    assert('newCount=2', r.newCount === 2);
    const r2 = extractAllPrinciples(feedbackLog, principlesFile);
    assert('dedup on rerun', r2.deduped === 2 && r2.newCount === 0);
    assert('sourceCount incremented', r2.principles[0].sourceCount === 2);
    const byTag = getPrinciples({ principlesPath: principlesFile, tags: ['testing'] });
    assert('filter by tag', byTag.length === 1);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  } else {
    const result = extractAllPrinciples();
    console.log(JSON.stringify(result, null, 2));
  }
}
