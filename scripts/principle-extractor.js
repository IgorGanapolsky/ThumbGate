'use strict';

/**
 * MemAlign-style principle extraction from NL feedback.
 *
 * Distills whatWentWrong / whatToChange / whatWorked into reusable
 * NEVER/ALWAYS semantic principles stored in principles.jsonl.
 */

const fs = require('fs');
const path = require('path');
const { getFeedbackPaths, readJSONL, inferDomain } = require('./feedback-loop');

const PRINCIPLES_FILENAME = 'principles.jsonl';

/**
 * Extract a semantic principle from a single feedback entry.
 *
 * @param {object} entry - A feedback log entry.
 * @returns {object|null} A principle object or null if nothing extractable.
 */
function extractPrinciple(entry) {
  if (!entry) return null;

  const signal = String(entry.signal || '').toLowerCase();
  const isNegative = ['negative', 'down', 'thumbs-down', 'thumbsdown'].includes(signal);
  const isPositive = ['positive', 'up', 'thumbs-up', 'thumbsup'].includes(signal);

  if (!isNegative && !isPositive) return null;

  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  const domain = inferDomain(tags, entry.context || '');

  if (isNegative) {
    const wrong = (entry.whatWentWrong || '').trim();
    const change = (entry.whatToChange || '').trim();
    if (!wrong && !change) return null;

    const text = change
      ? `NEVER: ${wrong || change}. INSTEAD: ${change}`
      : `NEVER: ${wrong}`;

    return {
      id: `prin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'constraint',
      polarity: 'negative',
      text,
      source: wrong,
      correction: change || null,
      tags,
      domain,
      sourceCount: 1,
      createdAt: new Date().toISOString(),
    };
  }

  // Positive
  const worked = (entry.whatWorked || '').trim();
  if (!worked) return null;

  return {
    id: `prin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'heuristic',
    polarity: 'positive',
    text: `ALWAYS: ${worked}`,
    source: worked,
    correction: null,
    tags,
    domain,
    sourceCount: 1,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Batch-extract principles from a feedback log, deduplicating by text.
 *
 * @param {string} [logPath] - Path to feedback-log.jsonl.
 * @param {string} [principlesPath] - Path to write principles.jsonl.
 * @returns {{ created: number, updated: number, total: number }}
 */
function extractAllPrinciples(logPath, principlesPath) {
  const paths = getFeedbackPaths();
  const feedbackLog = logPath || paths.FEEDBACK_LOG_PATH;
  const outPath = principlesPath || path.join(path.dirname(feedbackLog), PRINCIPLES_FILENAME);

  const entries = readJSONL(feedbackLog);
  const existing = readJSONL(outPath);

  // Index existing by normalized text for dedup
  const byText = new Map();
  for (const p of existing) {
    if (p && p.text) byText.set(p.text, p);
  }

  let created = 0;
  let updated = 0;

  for (const entry of entries) {
    const principle = extractPrinciple(entry);
    if (!principle) continue;

    const match = byText.get(principle.text);
    if (match) {
      match.sourceCount = (match.sourceCount || 1) + 1;
      updated++;
    } else {
      byText.set(principle.text, principle);
      created++;
    }
  }

  // Write all principles
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const lines = [...byText.values()].map((p) => JSON.stringify(p)).join('\n');
  fs.writeFileSync(outPath, lines ? `${lines}\n` : '');

  return { created, updated, total: byText.size };
}

/**
 * Retrieve principles with optional filtering.
 *
 * @param {object} opts
 * @param {string[]} [opts.tags] - Filter by tags (any match).
 * @param {string}   [opts.domain] - Filter by domain.
 * @param {number}   [opts.limit] - Max results.
 * @param {string}   [opts.principlesPath] - Path to principles.jsonl.
 * @returns {object[]} Matching principles.
 */
function getPrinciples({ tags, domain, limit, principlesPath } = {}) {
  const paths = getFeedbackPaths();
  const filePath = principlesPath || path.join(paths.FEEDBACK_DIR, PRINCIPLES_FILENAME);
  const all = readJSONL(filePath);

  let results = all;

  if (tags && tags.length > 0) {
    const tagSet = new Set(tags.map((t) => t.toLowerCase()));
    results = results.filter((p) =>
      Array.isArray(p.tags) && p.tags.some((t) => tagSet.has(t.toLowerCase()))
    );
  }

  if (domain) {
    results = results.filter((p) => p.domain === domain);
  }

  if (typeof limit === 'number' && limit > 0) {
    results = results.slice(0, limit);
  }

  return results;
}

module.exports = {
  PRINCIPLES_FILENAME,
  extractPrinciple,
  extractAllPrinciples,
  getPrinciples,
};
