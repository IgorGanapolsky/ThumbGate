'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_LEDGER_PATH = path.resolve(__dirname, '..', '..', '.thumbgate', 'post-ledger.json');

function ledgerPath(env = process.env) {
  return env.THUMBGATE_POST_LEDGER_PATH || DEFAULT_LEDGER_PATH;
}

function hashContent(content) {
  return crypto.createHash('sha256').update(String(content || '')).digest('hex');
}

function readLedger(env = process.env) {
  try {
    return JSON.parse(fs.readFileSync(ledgerPath(env), 'utf8'));
  } catch {
    return [];
  }
}

function writeLedger(rows, env = process.env) {
  const target = ledgerPath(env);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(rows, null, 2) + '\n');
}

function entryMatchesContent(entry, content, platform) {
  return entry.platform === platform && entry.hash === hashContent(content);
}

function isDuplicate(content, platform, options = {}) {
  const windowMs = options.windowMs ?? 24 * 60 * 60 * 1000;
  const nowMs = options.nowMs ?? Date.now();
  return readLedger(options.env).some((entry) => {
    if (!entryMatchesContent(entry, content, platform)) return false;
    if (entry.status && entry.status !== 'published') return false;
    const createdMs = Date.parse(entry.createdAt);
    return Number.isFinite(createdMs) && nowMs - createdMs < windowMs;
  });
}

function recordPost(content, platform, meta = {}, options = {}) {
  const now = options.now || new Date();
  const createdAt = typeof now.toISOString === 'function'
    ? now.toISOString()
    : new Date(now).toISOString();
  const rows = readLedger(options.env);
  rows.push({
    platform,
    hash: hashContent(content),
    status: meta.status || 'published',
    createdAt,
    meta,
  });
  writeLedger(rows.slice(-1000), options.env);
}

function recordAttempt(content, platform, meta = {}, options = {}) {
  return recordPost(content, platform, { ...meta, status: meta.status || 'attempted' }, options);
}

function latestForContent(content, platform, options = {}) {
  const rows = readLedger(options.env).filter((entry) => entryMatchesContent(entry, content, platform));
  return rows[rows.length - 1] || null;
}

module.exports = {
  DEFAULT_LEDGER_PATH,
  hashContent,
  isDuplicate,
  latestForContent,
  readLedger,
  recordAttempt,
  recordPost,
};
