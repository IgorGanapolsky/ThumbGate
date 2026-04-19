'use strict';

const MIN_WINDOW_HOURS = 1;
const MAX_WINDOW_HOURS = 24 * 30;
const DEFAULT_WINDOW_HOURS = 24;

function normalizeWindowHours(input) {
  if (input === null || input === undefined || input === '') return DEFAULT_WINDOW_HOURS;
  const n = Number(input);
  if (!Number.isFinite(n)) return DEFAULT_WINDOW_HOURS;
  if (n < MIN_WINDOW_HOURS) return MIN_WINDOW_HOURS;
  if (n > MAX_WINDOW_HOURS) return MAX_WINDOW_HOURS;
  return Math.floor(n);
}

function topNegativeTags(tags, limit = 5) {
  if (!tags || typeof tags !== 'object') return [];
  return Object.entries(tags)
    .map(([tag, counts]) => ({
      tag,
      negative: (counts && counts.negative) || 0,
      positive: (counts && counts.positive) || 0,
      total: (counts && counts.total) || 0,
    }))
    .filter((row) => row.negative > 0)
    .sort((a, b) => b.negative - a.negative)
    .slice(0, limit);
}

function topGates(byGate, limit = 5) {
  if (!byGate || typeof byGate !== 'object') return [];
  return Object.entries(byGate)
    .map(([gate, counts]) => ({
      gate,
      blocked: (counts && counts.blocked) || 0,
      warned: (counts && counts.warned) || 0,
      pendingApproval: (counts && counts.pendingApproval) || 0,
    }))
    .sort((a, b) => b.blocked - a.blocked || b.warned - a.warned)
    .slice(0, limit);
}

function summarizeProvenance(events, sinceMs) {
  if (!Array.isArray(events)) return { total: 0, byType: {} };
  const byType = {};
  let total = 0;
  for (const evt of events) {
    const ts = Date.parse(evt && evt.timestamp ? evt.timestamp : '');
    if (!Number.isFinite(ts) || ts < sinceMs) continue;
    total += 1;
    const type = (evt && evt.type) || 'unknown';
    byType[type] = (byType[type] || 0) + 1;
  }
  return { total, byType };
}

function buildSessionReport({ windowHours } = {}) {
  const hours = normalizeWindowHours(windowHours);
  const sinceMs = Date.now() - hours * 60 * 60 * 1000;
  const report = {
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    since: new Date(sinceMs).toISOString(),
    feedback: { totalPositive: 0, totalNegative: 0, topNegativeTags: [] },
    gates: { blocked: 0, warned: 0, passed: 0, topGates: [] },
    provenance: { total: 0, byType: {} },
    errors: {},
  };

  try {
    const { analyzeFeedback } = require('./feedback-loop');
    const feedback = analyzeFeedback() || {};
    report.feedback = {
      totalPositive: feedback.totalPositive || 0,
      totalNegative: feedback.totalNegative || 0,
      topNegativeTags: topNegativeTags(feedback.tags || {}),
    };
  } catch (err) {
    report.errors.feedback = String(err && err.message ? err.message : err);
  }

  try {
    const { loadStats } = require('./gates-engine');
    const stats = loadStats() || {};
    report.gates = {
      blocked: stats.blocked || 0,
      warned: stats.warned || 0,
      passed: stats.passed || 0,
      pendingApproval: stats.pendingApproval || 0,
      topGates: topGates(stats.byGate || {}),
    };
  } catch (err) {
    report.errors.gates = String(err && err.message ? err.message : err);
  }

  try {
    const { getProvenance } = require('./contextfs');
    const events = getProvenance(500) || [];
    report.provenance = summarizeProvenance(events, sinceMs);
  } catch (err) {
    report.errors.provenance = String(err && err.message ? err.message : err);
  }

  if (Object.keys(report.errors).length === 0) {
    delete report.errors;
  }

  return report;
}

module.exports = {
  buildSessionReport,
  normalizeWindowHours,
  topNegativeTags,
  topGates,
  summarizeProvenance,
  MIN_WINDOW_HOURS,
  MAX_WINDOW_HOURS,
  DEFAULT_WINDOW_HOURS,
};
