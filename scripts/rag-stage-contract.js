#!/usr/bin/env node
'use strict';

/**
 * Runtime telemetry for the canonical contracts in rag-stage-contracts.js.
 * The plural module remains the single source of truth for why/failure/measure;
 * this compatibility module adds privacy-safe observations and health rollups.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getFeedbackPaths } = require('./feedback-loop');
const { STAGES } = require('./rag-stage-contracts');

const TELEMETRY_FILENAME = 'telemetry.jsonl';
const MAX_TELEMETRY_RECORDS = 2000;
const RAG_STAGE_CONTRACTS = STAGES;
const STAGE_IDS = new Set(STAGES.map((entry) => entry.id));

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function resolveTelemetryPath(feedbackDir) {
  const root = feedbackDir || getFeedbackPaths().FEEDBACK_DIR;
  return path.join(root, 'rag', TELEMETRY_FILENAME);
}

function safeMetricValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(safeMetricValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 30)
        .map(([key, entry]) => [String(key).slice(0, 80), safeMetricValue(entry)]),
    );
  }
  return String(value || '').slice(0, 160);
}

function sanitizeMetrics(metrics = {}) {
  return Object.fromEntries(
    Object.entries(metrics)
      .slice(0, 40)
      .map(([key, value]) => [String(key).slice(0, 80), safeMetricValue(value)]),
  );
}

function assertStage(stageId) {
  if (!STAGE_IDS.has(stageId)) throw new Error(`Unknown RAG stage: ${stageId}`);
}

class RagRunTelemetry {
  constructor(options = {}) {
    this.clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
    this.feedbackDir = options.feedbackDir || null;
    this.persist = options.persist !== false;
    this.startedAtMs = this.clock();
    this.runId = options.runId || `rag_${this.startedAtMs}_${Math.random().toString(36).slice(2, 8)}`;
    this.queryFingerprint = sha256(options.query || '').slice(0, 16);
    this.scope = sanitizeMetrics(options.scope || {});
    this.stages = [];
    this.active = new Map();
    this.fallbacks = [];
  }

  start(stageId, metrics = {}) {
    assertStage(stageId);
    this.active.set(stageId, {
      startedAtMs: this.clock(),
      metrics: sanitizeMetrics(metrics),
    });
    return this;
  }

  success(stageId, metrics = {}) {
    return this.completeStage(stageId, 'success', metrics);
  }

  failure(stageId, error, metrics = {}) {
    const message = error && error.message ? error.message : String(error || 'unknown failure');
    return this.completeStage(stageId, 'failure', {
      ...metrics,
      errorType: error && error.name ? error.name : 'Error',
      errorFingerprint: sha256(message).slice(0, 16),
    });
  }

  fallback(stageId, reason, metrics = {}) {
    assertStage(stageId);
    this.fallbacks.push({
      stageId,
      reason: String(reason || 'unspecified').slice(0, 120),
      atMs: this.clock(),
      metrics: sanitizeMetrics(metrics),
    });
    return this;
  }

  completeStage(stageId, status, metrics = {}) {
    assertStage(stageId);
    const endedAtMs = this.clock();
    const active = this.active.get(stageId) || { startedAtMs: endedAtMs, metrics: {} };
    this.active.delete(stageId);
    this.stages.push({
      stageId,
      status,
      durationMs: Math.max(endedAtMs - active.startedAtMs, 0),
      metrics: sanitizeMetrics({ ...active.metrics, ...metrics }),
    });
    return this;
  }

  finish(metrics = {}) {
    const endedAtMs = this.clock();
    for (const stageId of [...this.active.keys()]) {
      this.failure(stageId, new Error('stage did not complete'));
    }
    const record = {
      schemaVersion: 1,
      runId: this.runId,
      queryFingerprint: this.queryFingerprint,
      startedAt: new Date(this.startedAtMs).toISOString(),
      durationMs: Math.max(endedAtMs - this.startedAtMs, 0),
      status: this.stages.some((entry) => entry.status === 'failure') ? 'failure' : 'success',
      scope: this.scope,
      stages: this.stages,
      fallbacks: this.fallbacks,
      metrics: sanitizeMetrics(metrics),
    };
    if (this.persist) appendTelemetry(record, { feedbackDir: this.feedbackDir });
    return record;
  }
}

function readTelemetry(options = {}) {
  const filePath = resolveTelemetryPath(options.feedbackDir);
  if (!fs.existsSync(filePath)) return [];
  const limit = Math.max(1, Math.min(Number(options.limit) || 200, MAX_TELEMETRY_RECORDS + 1));
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendTelemetry(record, options = {}) {
  const filePath = resolveTelemetryPath(options.feedbackDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  const rows = readTelemetry({ feedbackDir: options.feedbackDir, limit: MAX_TELEMETRY_RECORDS + 1 });
  if (rows.length > MAX_TELEMETRY_RECORDS) {
    fs.writeFileSync(
      filePath,
      `${rows.slice(-MAX_TELEMETRY_RECORDS).map((row) => JSON.stringify(row)).join('\n')}\n`,
      'utf8',
    );
  }
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  return sorted[Math.min(Math.ceil(sorted.length * fraction) - 1, sorted.length - 1)];
}

function summarizeRagHealth(options = {}) {
  const records = options.records || readTelemetry(options);
  const stages = {};
  for (const contract of STAGES) {
    const samples = records.flatMap((record) => (
      (record.stages || []).filter((entry) => entry.stageId === contract.id)
    ));
    const failures = samples.filter((entry) => entry.status === 'failure').length;
    stages[contract.id] = {
      samples: samples.length,
      successRate: samples.length ? Number(((samples.length - failures) / samples.length).toFixed(4)) : null,
      failureCount: failures,
      fallbackCount: records.flatMap((record) => record.fallbacks || [])
        .filter((entry) => entry.stageId === contract.id).length,
      latencyP50Ms: percentile(samples.map((entry) => entry.durationMs), 0.5),
      latencyP95Ms: percentile(samples.map((entry) => entry.durationMs), 0.95),
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    runs: records.length,
    successfulRuns: records.filter((record) => record.status === 'success').length,
    failedRuns: records.filter((record) => record.status === 'failure').length,
    stages,
  };
}

function getRagOperationsSpec() {
  return {
    schemaVersion: 1,
    stages: STAGES,
    hardGates: {
      scopeLeakageRate: 0,
      staleRetrievalRate: 0,
      finalStructuredOutputValidRate: 1,
      annRecallAt10: 0.9,
    },
  };
}

module.exports = {
  MAX_TELEMETRY_RECORDS,
  RAG_STAGE_CONTRACTS,
  RagRunTelemetry,
  appendTelemetry,
  getRagOperationsSpec,
  readTelemetry,
  resolveTelemetryPath,
  summarizeRagHealth,
};
