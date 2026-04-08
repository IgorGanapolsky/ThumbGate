#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  getThumbgateFeedbackDir,
  listFeedbackArtifactPaths,
} = require('./feedback-paths');

const JSONL_ARTIFACTS = new Set([
  'funnel-events.jsonl',
  'telemetry-pings.jsonl',
  'revenue-events.jsonl',
  'workflow-sprint-leads.jsonl',
]);

const JSON_ARTIFACTS = new Map([
  ['api-keys.json', () => ({ keys: {} })],
  ['local-checkout-sessions.json', () => ({ sessions: {} })],
]);

const CONSOLIDATED_ARTIFACTS = [
  'api-keys.json',
  'funnel-events.jsonl',
  'telemetry-pings.jsonl',
  'revenue-events.jsonl',
  'local-checkout-sessions.json',
  'workflow-sprint-leads.jsonl',
];

function getScopedProjectOptions(options = {}) {
  if (options.feedbackDir) return options;

  const projectDir = options.projectDir || options.cwd;
  if (!projectDir) return options;

  return {
    ...options,
    projectDir,
    explicitProjectDir: true,
  };
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile(filePath, fallbackFactory) {
  if (!filePath || !fs.existsSync(filePath)) return fallbackFactory();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallbackFactory();
  } catch {
    return fallbackFactory();
  }
}

function readJsonlFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function stableArtifactTimestamp(record = {}) {
  return String(
    record.timestamp ||
    record.receivedAt ||
    record.submittedAt ||
    record.updatedAt ||
    record.createdAt ||
    ''
  );
}

function dedupeJsonlRows(rows = []) {
  const merged = [];
  const seen = new Set();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }

  return merged.sort((a, b) => {
    const timeCompare = stableArtifactTimestamp(a).localeCompare(stableArtifactTimestamp(b));
    if (timeCompare !== 0) return timeCompare;
    return JSON.stringify(a).localeCompare(JSON.stringify(b));
  });
}

function mergeKeyStorePayloads(payloads = []) {
  const merged = { keys: {} };
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') continue;
    Object.assign(merged, payload);
    merged.keys = {
      ...(merged.keys || {}),
      ...((payload && payload.keys) || {}),
    };
  }
  return merged;
}

function mergeCheckoutSessionsPayloads(payloads = []) {
  const merged = { sessions: {} };
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') continue;
    Object.assign(merged, payload);
    merged.sessions = {
      ...(merged.sessions || {}),
      ...((payload && payload.sessions) || {}),
    };
  }
  return merged;
}

function serializeJson(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function serializeJsonl(rows = []) {
  const serialized = rows.map((row) => JSON.stringify(row)).join('\n');
  return serialized ? `${serialized}\n` : '';
}

function writeIfChanged(filePath, nextContent, write = true) {
  const currentContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  const changed = currentContent !== nextContent;

  if (write && changed) {
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, nextContent, 'utf8');
  }

  return {
    changed,
    wrote: write && changed,
  };
}

function consolidateJsonArtifact(fileName, primaryPath, sourcePaths, write) {
  const fallbackFactory = JSON_ARTIFACTS.get(fileName);
  const payloads = sourcePaths.map((candidate) => readJsonFile(candidate, fallbackFactory));
  const merged = fileName === 'api-keys.json'
    ? mergeKeyStorePayloads(payloads)
    : mergeCheckoutSessionsPayloads(payloads);
  const initializedEmpty = sourcePaths.length === 0;
  const writeResult = writeIfChanged(primaryPath, serializeJson(merged), write);

  return {
    fileName,
    format: 'json',
    primaryPath,
    sourcePaths,
    sourceCount: sourcePaths.length,
    initializedEmpty,
    wrote: writeResult.wrote,
    changed: writeResult.changed,
    keyCount: Object.keys(merged.keys || {}).length,
    sessionCount: Object.keys(merged.sessions || {}).length,
  };
}

function consolidateJsonlArtifact(fileName, primaryPath, sourcePaths, write) {
  const merged = dedupeJsonlRows(sourcePaths.flatMap((candidate) => readJsonlFile(candidate)));
  const initializedEmpty = sourcePaths.length === 0;
  const writeResult = writeIfChanged(primaryPath, serializeJsonl(merged), write);

  return {
    fileName,
    format: 'jsonl',
    primaryPath,
    sourcePaths,
    sourceCount: sourcePaths.length,
    initializedEmpty,
    wrote: writeResult.wrote,
    changed: writeResult.changed,
    rowCount: merged.length,
  };
}

function consolidateArtifact(fileName, options = {}) {
  const artifactPaths = listFeedbackArtifactPaths(fileName, options);
  const primaryPath = artifactPaths[0];
  const sourcePaths = artifactPaths.filter((candidate) => fs.existsSync(candidate));
  const write = options.write !== false;

  if (JSONL_ARTIFACTS.has(fileName)) {
    return consolidateJsonlArtifact(fileName, primaryPath, sourcePaths, write);
  }

  return consolidateJsonArtifact(fileName, primaryPath, sourcePaths, write);
}

function consolidateFeedbackRoot(options = {}) {
  const scopedOptions = getScopedProjectOptions(options);
  const feedbackDir = scopedOptions.feedbackDir
    || getThumbgateFeedbackDir(scopedOptions);
  const artifacts = CONSOLIDATED_ARTIFACTS.map((fileName) => consolidateArtifact(fileName, {
    ...scopedOptions,
    feedbackDir,
  }));
  const sourceRoots = Array.from(new Set(
    artifacts.flatMap((artifact) => artifact.sourcePaths.map((candidate) => path.dirname(candidate)))
  )).sort();

  return {
    feedbackDir,
    write: options.write !== false,
    artifactCount: artifacts.length,
    wroteArtifacts: artifacts.filter((artifact) => artifact.wrote).length,
    changedArtifacts: artifacts.filter((artifact) => artifact.changed).length,
    initializedArtifacts: artifacts.filter((artifact) => artifact.initializedEmpty).map((artifact) => artifact.fileName),
    sourceRoots,
    artifacts,
  };
}

function runCli() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const summary = consolidateFeedbackRoot({ write: !dryRun });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

module.exports = {
  CONSOLIDATED_ARTIFACTS,
  consolidateArtifact,
  consolidateFeedbackRoot,
  dedupeJsonlRows,
  getScopedProjectOptions,
  mergeCheckoutSessionsPayloads,
  mergeKeyStorePayloads,
};

if (require.main === module) {
  runCli();
}
