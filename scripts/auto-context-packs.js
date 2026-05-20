#!/usr/bin/env node
'use strict';

/**
 * Auto-Context Packs
 *
 * Automatically assembles context packs from the top recurring failure patterns.
 * Reads feedback logs and gate stats, identifies the top 5 most-blocked gate IDs
 * and top 5 most-common failure tags, then assembles context packs for each.
 *
 * Output: .claude/memory/feedback/contextfs/auto/<pack-name>.json
 */

const fs = require('fs');
const path = require('path');

const { analyzeFeedback } = require('./feedback-loop');
const { calculateStats, loadGatesFile, MANUAL_GATES_PATH } = require('./gate-stats');
const { resolveFeedbackDir } = require('./feedback-paths');
const { ensureDir } = require('./fs-utils');

const TOP_N = 5;
const MAX_FEEDBACK_ENTRIES = 10;

function getAutoPacksDir() {
  if (process.env.THUMBGATE_AUTO_PACKS_DIR) return process.env.THUMBGATE_AUTO_PACKS_DIR;
  const feedbackDir = resolveFeedbackDir();
  return path.join(feedbackDir, 'contextfs', 'auto');
}

function loadFeedbackEntries(logPath) {
  if (!logPath || !fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, 'utf-8').split('\n');
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

function loadAllGateDefinitions() {
  const PROJECT_ROOT = path.join(__dirname, '..');
  const manualGates = loadGatesFile(MANUAL_GATES_PATH);

  // Also try to load auto-promoted gates
  let autoGates = [];
  try {
    const { getAutoGatesPath } = require('./auto-promote-gates');
    autoGates = loadGatesFile(getAutoGatesPath());
  } catch {
    // auto-promoted gates not available — that's fine
  }

  return [...manualGates, ...autoGates];
}

function getTopBlockedGateIds(stats) {
  const gates = (stats.gates || []).filter(
    (g) => g.action === 'block' && Number(g.occurrences || 0) > 0
  );
  gates.sort((a, b) => (b.occurrences || 0) - (a.occurrences || 0));
  return gates.slice(0, TOP_N).map((g) => g.id).filter(Boolean);
}

function getTopFailureTags(analysis) {
  const tags = analysis.tags || {};
  const tagList = Object.entries(tags)
    .map(([tag, counts]) => ({ tag, negative: counts.negative || 0, total: counts.total || 0 }))
    .filter((t) => t.negative > 0)
    .sort((a, b) => b.negative - a.negative);
  return tagList.slice(0, TOP_N).map((t) => t.tag);
}

function getFeedbackForGate(entries, gateId) {
  return entries
    .filter((e) => {
      const tags = e.tags || [];
      return (
        e.gateId === gateId ||
        tags.includes(gateId) ||
        (e.context || '').includes(gateId) ||
        (e.whatWentWrong || '').includes(gateId)
      );
    })
    .slice(-MAX_FEEDBACK_ENTRIES);
}

function getFeedbackForTag(entries, tag) {
  return entries
    .filter((e) => {
      const tags = e.tags || [];
      return tags.includes(tag);
    })
    .slice(-MAX_FEEDBACK_ENTRIES);
}

function extractCorrectiveAction(entry) {
  return entry.whatToChange || entry.correctiveAction || entry.lesson || null;
}

function buildPackForGate(gateId, gateDef, feedbackEntries, allEntries) {
  const relevantFeedback = getFeedbackForGate(allEntries, gateId);
  const correctiveActions = relevantFeedback
    .map(extractCorrectiveAction)
    .filter(Boolean)
    .slice(0, 3);

  return {
    type: 'gate-failure',
    gateId,
    generatedAt: new Date().toISOString(),
    gate: gateDef || { id: gateId },
    recentFeedback: relevantFeedback.map((e) => ({
      signal: e.signal,
      tags: e.tags || [],
      context: (e.context || '').slice(0, 300),
      whatWentWrong: (e.whatWentWrong || '').slice(0, 300),
      timestamp: e.timestamp || null,
    })),
    correctiveActions,
    summary: {
      totalFeedbackMatched: relevantFeedback.length,
      hasCorrectiveAction: correctiveActions.length > 0,
    },
  };
}

function buildPackForTag(tag, feedbackEntries) {
  const relevantFeedback = getFeedbackForTag(feedbackEntries, tag);
  const correctiveActions = relevantFeedback
    .map(extractCorrectiveAction)
    .filter(Boolean)
    .slice(0, 3);

  return {
    type: 'tag-failure',
    tag,
    generatedAt: new Date().toISOString(),
    recentFeedback: relevantFeedback.map((e) => ({
      signal: e.signal,
      tags: e.tags || [],
      context: (e.context || '').slice(0, 300),
      whatWentWrong: (e.whatWentWrong || '').slice(0, 300),
      timestamp: e.timestamp || null,
    })),
    correctiveActions,
    summary: {
      totalFeedbackMatched: relevantFeedback.length,
      hasCorrectiveAction: correctiveActions.length > 0,
    },
  };
}

function toSlug(input) {
  return String(input || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

/**
 * Generate context packs from top failure patterns.
 *
 * @param {Object} [options]
 * @param {string} [options.feedbackLogPath] - Override the feedback log path.
 * @param {string} [options.outputDir] - Override the output directory.
 * @returns {{ packCount: number, packs: Array<{name: string, filePath: string, type: string, id: string}> }}
 */
function generateAutoContextPacks(options = {}) {
  const outputDir = options.outputDir || getAutoPacksDir();
  ensureDir(outputDir);

  // Load analysis data — handle empty/missing gracefully
  let analysis = { tags: {}, topTags: [] };
  try {
    analysis = analyzeFeedback(options.feedbackLogPath || undefined);
  } catch {
    // degrade gracefully if feedback log is missing or unreadable
  }

  let stats = { gates: [], totalBlocked: 0 };
  try {
    stats = calculateStats();
  } catch {
    // degrade gracefully if gate stats cannot be loaded
  }

  // Load raw feedback entries for context matching
  const { getFeedbackPaths } = require('./feedback-loop');
  const feedbackPaths = getFeedbackPaths();
  const logPath = options.feedbackLogPath || feedbackPaths.FEEDBACK_LOG_PATH;
  const allEntries = loadFeedbackEntries(logPath);

  // Load gate definitions for enrichment
  const allGates = loadAllGateDefinitions();
  const gateById = {};
  for (const g of allGates) {
    if (g.id) gateById[g.id] = g;
  }

  const packs = [];

  // -- Top 5 blocked gate IDs --
  const topGateIds = getTopBlockedGateIds(stats);
  for (const gateId of topGateIds) {
    const pack = buildPackForGate(gateId, gateById[gateId] || null, [], allEntries);
    const slug = `gate-${toSlug(gateId)}`;
    const filePath = path.join(outputDir, `${slug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(pack, null, 2) + '\n');
    packs.push({ name: slug, filePath, type: 'gate-failure', id: gateId });
  }

  // -- Top 5 failure tags --
  const topTags = getTopFailureTags(analysis);
  for (const tag of topTags) {
    const pack = buildPackForTag(tag, allEntries);
    const slug = `tag-${toSlug(tag)}`;
    const filePath = path.join(outputDir, `${slug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(pack, null, 2) + '\n');
    packs.push({ name: slug, filePath, type: 'tag-failure', id: tag });
  }

  return { packCount: packs.length, packs };
}

module.exports = {
  generateAutoContextPacks,
  getAutoPacksDir,
  getTopBlockedGateIds,
  getTopFailureTags,
};

if (path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const result = generateAutoContextPacks();
  console.log(`Generated ${result.packCount} context pack(s):`);
  for (const p of result.packs) {
    console.log(`  [${p.type}] ${p.name} -> ${p.filePath}`);
  }
  if (result.packCount === 0) {
    console.log('  (No failure patterns found yet — capture some feedback first.)');
  }
}
