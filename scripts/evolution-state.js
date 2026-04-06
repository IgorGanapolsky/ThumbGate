'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveFeedbackDir } = require('./feedback-paths');

const DEFAULT_SETTINGS = Object.freeze({
  half_life_days: 7,
  decay_floor: 0.01,
  prevention_min_occurrences: 2,
  verification_max_retries: 3,
  dpo_beta: 0.1,
});

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function appendJSONL(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function normalizeState(state = {}) {
  const normalized = {
    version: Number.isInteger(state.version) ? state.version : 1,
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : null,
    acceptedMutations: Array.isArray(state.acceptedMutations) ? state.acceptedMutations : [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...(state.settings || {}),
    },
  };

  return normalized;
}

function getEvolutionPaths(feedbackDir = resolveFeedbackDir()) {
  return {
    feedbackDir,
    statePath: path.join(feedbackDir, 'evolution-state.json'),
    historyPath: path.join(feedbackDir, 'evolution-history.jsonl'),
    snapshotsDir: path.join(feedbackDir, 'evolution-snapshots'),
  };
}

function readEvolutionState(feedbackDir = resolveFeedbackDir()) {
  const { statePath } = getEvolutionPaths(feedbackDir);
  if (!fs.existsSync(statePath)) {
    return normalizeState();
  }

  try {
    return normalizeState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
  } catch {
    return normalizeState();
  }
}

function writeEvolutionState(state, feedbackDir = resolveFeedbackDir()) {
  const { statePath } = getEvolutionPaths(feedbackDir);
  const normalized = normalizeState({
    ...state,
    updatedAt: new Date().toISOString(),
  });
  ensureDir(path.dirname(statePath));
  fs.writeFileSync(statePath, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

function getEffectiveSetting(key, fallback, feedbackDir = resolveFeedbackDir()) {
  const state = readEvolutionState(feedbackDir);
  const value = state.settings[key];
  return Number.isFinite(value) ? value : fallback;
}

function captureEvolutionSnapshot({
  label = 'snapshot',
  reason = 'manual',
  source = 'workspace-evolver',
  metadata = {},
  state = undefined,
} = {}, feedbackDir = resolveFeedbackDir()) {
  const paths = getEvolutionPaths(feedbackDir);
  const snapshotId = `evo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const normalizedState = normalizeState(state || readEvolutionState(feedbackDir));
  const payload = {
    snapshotId,
    label,
    reason,
    source,
    metadata,
    capturedAt: new Date().toISOString(),
    state: normalizedState,
  };
  const snapshotPath = path.join(paths.snapshotsDir, `${snapshotId}.json`);

  ensureDir(paths.snapshotsDir);
  fs.writeFileSync(snapshotPath, `${JSON.stringify(payload, null, 2)}\n`);

  return {
    snapshotId,
    snapshotPath,
    payload,
  };
}

function applyAcceptedMutation({
  targetKey,
  nextValue,
  experimentId = null,
  summary = '',
  metrics = null,
} = {}, feedbackDir = resolveFeedbackDir()) {
  if (!targetKey) {
    throw new Error('applyAcceptedMutation requires targetKey');
  }
  if (!Number.isFinite(nextValue)) {
    throw new Error('applyAcceptedMutation requires a numeric nextValue');
  }

  const paths = getEvolutionPaths(feedbackDir);
  const currentState = readEvolutionState(feedbackDir);
  const previousValue = currentState.settings[targetKey];
  const rollbackSnapshot = captureEvolutionSnapshot({
    label: `rollback-${targetKey}`,
    reason: 'accepted-mutation',
    source: 'workspace-evolver',
    metadata: {
      targetKey,
      previousValue,
      nextValue,
      experimentId,
    },
    state: currentState,
  }, feedbackDir);

  const entry = {
    id: `mutation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    experimentId,
    targetKey,
    previousValue,
    nextValue,
    summary,
    metrics,
    rollbackSnapshotId: rollbackSnapshot.snapshotId,
    acceptedAt: new Date().toISOString(),
  };

  const nextState = writeEvolutionState({
    ...currentState,
    acceptedMutations: [...currentState.acceptedMutations, entry],
    settings: {
      ...currentState.settings,
      [targetKey]: nextValue,
    },
  }, feedbackDir);

  appendJSONL(paths.historyPath, {
    type: 'mutation_kept',
    targetKey,
    previousValue,
    nextValue,
    experimentId,
    rollbackSnapshotId: rollbackSnapshot.snapshotId,
    timestamp: new Date().toISOString(),
  });

  return {
    state: nextState,
    entry,
    rollbackSnapshot,
  };
}

function restoreEvolutionSnapshot(snapshotId, feedbackDir = resolveFeedbackDir()) {
  if (!snapshotId) {
    throw new Error('restoreEvolutionSnapshot requires snapshotId');
  }

  const paths = getEvolutionPaths(feedbackDir);
  const snapshotPath = path.join(paths.snapshotsDir, `${snapshotId}.json`);
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Evolution snapshot not found: ${snapshotId}`);
  }

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const restoredState = writeEvolutionState(snapshot.state, feedbackDir);
  appendJSONL(paths.historyPath, {
    type: 'snapshot_restored',
    snapshotId,
    timestamp: new Date().toISOString(),
  });

  return {
    snapshotId,
    snapshotPath,
    state: restoredState,
  };
}

function withTemporaryEvolutionSettings(patch, fn, feedbackDir = resolveFeedbackDir()) {
  const paths = getEvolutionPaths(feedbackDir);
  const originalExists = fs.existsSync(paths.statePath);
  const originalContent = originalExists ? fs.readFileSync(paths.statePath, 'utf8') : null;
  const currentState = readEvolutionState(feedbackDir);

  writeEvolutionState({
    ...currentState,
    settings: {
      ...currentState.settings,
      ...(patch || {}),
    },
  }, feedbackDir);

  try {
    return fn();
  } finally {
    if (!originalExists) {
      fs.rmSync(paths.statePath, { force: true });
    } else {
      ensureDir(path.dirname(paths.statePath));
      fs.writeFileSync(paths.statePath, originalContent);
    }
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  applyAcceptedMutation,
  captureEvolutionSnapshot,
  getEffectiveSetting,
  getEvolutionPaths,
  readEvolutionState,
  resolveFeedbackDir,
  restoreEvolutionSnapshot,
  withTemporaryEvolutionSettings,
  writeEvolutionState,
};
