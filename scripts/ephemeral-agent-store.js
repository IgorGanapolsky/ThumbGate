#!/usr/bin/env node
'use strict';

/**
 * Ephemeral Agent Store — per-agent isolated feedback + auto-merge + compaction.
 *
 * Built for the agentic era (Databricks: agents create 4x more data, <10s lifetimes).
 *
 * 1. Per-agent namespace isolation — each agent writes to agent-{id}/
 * 2. Auto-merge — on agent completion, merge into main store after governance check
 * 3. Data compaction — compress old JSONL logs, keep only promoted lessons
 */

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

function getFeedbackDir() { return resolveFeedbackDir(); }
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function readJsonl(fp) {
  if (!fs.existsSync(fp)) return [];
  const raw = fs.readFileSync(fp, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 1. Per-Agent Namespace Isolation
// ---------------------------------------------------------------------------

/**
 * Create an isolated feedback store for an ephemeral agent.
 * Returns the namespace path and writer functions.
 */
function createEphemeralStore(agentId) {
  const id = agentId || `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const storeDir = path.join(getFeedbackDir(), 'ephemeral', id);
  ensureDir(storeDir);

  const feedbackPath = path.join(storeDir, 'feedback.jsonl');
  const metaPath = path.join(storeDir, 'meta.json');

  const meta = {
    agentId: id,
    createdAt: new Date().toISOString(),
    status: 'active',
    entryCount: 0,
    mergedAt: null,
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');

  return {
    agentId: id,
    storeDir,
    feedbackPath,
    metaPath,

    /** Append a feedback entry to this agent's isolated store. */
    append(entry) {
      const e = { ...entry, _ephemeralAgent: id, _ephemeralTs: new Date().toISOString() };
      fs.appendFileSync(feedbackPath, JSON.stringify(e) + '\n');
      meta.entryCount++;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
      return e;
    },

    /** Read all entries in this agent's store. */
    read() { return readJsonl(feedbackPath); },

    /** Get the entry count. */
    count() { return meta.entryCount; },
  };
}

/**
 * List all ephemeral agent stores.
 */
function listEphemeralStores() {
  const ephDir = path.join(getFeedbackDir(), 'ephemeral');
  if (!fs.existsSync(ephDir)) return [];
  return fs.readdirSync(ephDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const metaPath = path.join(ephDir, d.name, 'meta.json');
      let meta = { agentId: d.name, status: 'unknown', entryCount: 0 };
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* ok */ }
      return meta;
    });
}

// ---------------------------------------------------------------------------
// 2. Auto-Merge
// ---------------------------------------------------------------------------

/**
 * Merge an ephemeral agent's feedback into the main store.
 * Runs governance check before merging. Marks store as merged.
 */
function mergeEphemeralStore(agentId) {
  const storeDir = path.join(getFeedbackDir(), 'ephemeral', agentId);
  const feedbackPath = path.join(storeDir, 'feedback.jsonl');
  const metaPath = path.join(storeDir, 'meta.json');

  if (!fs.existsSync(feedbackPath)) return { merged: 0, agentId, error: 'store not found' };

  const entries = readJsonl(feedbackPath);
  const mainLogPath = path.join(getFeedbackDir(), 'feedback-log.jsonl');
  ensureDir(path.dirname(mainLogPath));

  let merged = 0;
  let skipped = 0;

  for (const entry of entries) {
    // Governance check: skip entries that look malicious (PII in context)
    let safe = true;
    try {
      const { scanForPii, sensitivityRank } = require('./pii-scanner');
      const scan = scanForPii(entry.context || '');
      if (sensitivityRank(scan.highestSensitivity) > sensitivityRank('internal')) {
        safe = false;
        skipped++;
      }
    } catch { /* pii-scanner unavailable — allow */ }

    if (safe) {
      fs.appendFileSync(mainLogPath, JSON.stringify(entry) + '\n');
      merged++;
    }
  }

  // Mark as merged
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.status = 'merged';
    meta.mergedAt = new Date().toISOString();
    meta.mergedCount = merged;
    meta.skippedCount = skipped;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  } catch { /* ok */ }

  return { agentId, merged, skipped, total: entries.length };
}

/**
 * Merge all active ephemeral stores and clean up.
 */
function mergeAllEphemeralStores() {
  const stores = listEphemeralStores().filter((s) => s.status === 'active');
  const results = stores.map((s) => mergeEphemeralStore(s.agentId));
  const totalMerged = results.reduce((sum, r) => sum + (r.merged || 0), 0);
  return { stores: results.length, totalMerged, results };
}

// ---------------------------------------------------------------------------
// 3. Data Compaction
// ---------------------------------------------------------------------------

/**
 * Compact old JSONL feedback logs.
 * Keeps only entries from the last retentionDays, plus all promoted lessons.
 * Writes compacted data back to the same file.
 */
function compactFeedbackLog({ retentionDays = 90 } = {}) {
  const logPath = path.join(getFeedbackDir(), 'feedback-log.jsonl');
  if (!fs.existsSync(logPath)) return { before: 0, after: 0, removed: 0 };

  const entries = readJsonl(logPath);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  const kept = entries.filter((e) => {
    // Keep if recent
    const ts = new Date(e.timestamp || e.createdAt || 0).getTime();
    if (ts > cutoff) return true;
    // Keep if promoted (has a memory record)
    if (e.actionType === 'store-mistake' || e.actionType === 'store-learning') return true;
    // Keep if has high rubric score
    if (e.rubric && e.rubric.promotionEligible) return true;
    return false;
  });

  const removed = entries.length - kept.length;
  if (removed > 0) {
    fs.writeFileSync(logPath, kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length > 0 ? '\n' : ''));
  }

  return { before: entries.length, after: kept.length, removed, retentionDays };
}

/**
 * Clean up merged ephemeral stores older than retentionDays.
 */
function cleanupEphemeralStores({ retentionDays = 7 } = {}) {
  const ephDir = path.join(getFeedbackDir(), 'ephemeral');
  if (!fs.existsSync(ephDir)) return { cleaned: 0 };

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let cleaned = 0;

  for (const dir of fs.readdirSync(ephDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const metaPath = path.join(ephDir, dir.name, 'meta.json');
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (meta.status === 'merged' && meta.mergedAt && new Date(meta.mergedAt).getTime() < cutoff) {
        fs.rmSync(path.join(ephDir, dir.name), { recursive: true, force: true });
        cleaned++;
      }
    } catch { /* skip */ }
  }

  return { cleaned, retentionDays };
}

module.exports = {
  createEphemeralStore, listEphemeralStores,
  mergeEphemeralStore, mergeAllEphemeralStores,
  compactFeedbackLog, cleanupEphemeralStores,
};
