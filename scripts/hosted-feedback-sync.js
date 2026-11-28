#!/usr/bin/env node
'use strict';

/**
 * hosted-feedback-sync.js
 *
 * Pulls thumbs-up / thumbs-down feedback that was recorded on the hosted
 * ThumbGate server (https://thumbgate.ai/mcp, the remote MCP connector used
 * from claude.ai chats, Claude Desktop, Claude projects and cloud Claude Code
 * sessions) into the LOCAL ThumbGate store, through the normal captureFeedback
 * pipeline. That way feedback given anywhere becomes the same local lessons,
 * prevention rules and PreToolUse gates as feedback typed in a local session.
 *
 * Flow:
 *   1. Resolve an operator/admin key (same order as sync-telemetry-from-prod.js:
 *      env THUMBGATE_OPERATOR_KEY > ~/.config/thumbgate/operator.json > env
 *      THUMBGATE_API_KEY). The key is never printed.
 *   2. POST <base>/v1/lessons/export (inline bundle).
 *   3. Keep only hosted feedback events (ids starting with "fb_"; the export
 *      also lists the derived memory rows, which captureFeedback re-derives).
 *   4. Skip ids already recorded in <feedbackDir>/hosted-feedback-sync-state.json
 *      and anything that this machine itself pushed (tag "local-origin").
 *   5. captureFeedback() each new one with tags hosted-connector + origin tags.
 *
 * Usage:
 *   node scripts/hosted-feedback-sync.js [--dry-run] [--json] [--base-url URL]
 *   npx thumbgate sync-hosted
 */

const fs = require('node:fs');
const path = require('node:path');

const { captureFeedback, buildFeedbackSourceIdentity } = require('./feedback-loop');
const { resolveFeedbackDir } = require('./feedback-paths');
const { resolveOperatorConfig } = require('./sync-telemetry-from-prod');
const { resolveLocalProject } = require('./project-identity');

const EXPORT_PATH = '/v1/lessons/export';
const STATE_FILE = 'hosted-feedback-sync-state.json';
const DEFAULT_HOSTED_BASE_URL = 'https://thumbgate.ai';
const DEFAULT_TIMEOUT_MS = 8000;

function getStatePath(options = {}) {
  const feedbackDir = options.feedbackDir || resolveFeedbackDir({});
  return path.join(feedbackDir, STATE_FILE);
}

function readState(statePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      processedIds: Array.isArray(raw.processedIds) ? raw.processedIds : [],
      lastSyncAt: raw.lastSyncAt || null,
    };
  } catch {
    return { processedIds: [], lastSyncAt: null };
  }
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  // Every id is kept: dropping old ids would re-import them on the next run.
  const tmp = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, statePath);
}

function normalizeSignal(signal) {
  const s = String(signal || '').toLowerCase();
  if (['down', 'negative', 'thumbs_down', 'thumbsdown'].includes(s)) return 'down';
  if (['up', 'positive', 'thumbs_up', 'thumbsup'].includes(s)) return 'up';
  return null;
}

/**
 * A hosted lesson belongs here when it has no project (claude.ai chats, Desktop)
 * or its project is the one this checkout resolves to. Lessons from other
 * projects stay on the server so they never gate the wrong repository.
 */
function belongsToProject(lesson, projectKey) {
  const key = lesson && lesson.projectKey;
  return !key || key === 'unassigned' || key === projectKey;
}

/** Hosted feedback events that should become local lessons, oldest first. */
function selectHostedFeedback(bundle, processed = new Set()) {
  const lessons = bundle && Array.isArray(bundle.lessons) ? bundle.lessons : [];
  return lessons
    .filter((l) => l && typeof l.id === 'string' && l.id.startsWith('fb_'))
    .filter((l) => normalizeSignal(l.signal))
    .filter((l) => !processed.has(l.id))
    .filter((l) => !(Array.isArray(l.tags) && l.tags.includes('local-origin')))
    .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || ''), 'en'));
}

async function fetchHostedLessons({ baseUrl, apiKey, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}${EXPORT_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ inline: true }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`hosted export failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const body = await res.json();
    return body.bundle || { lessons: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function syncHostedFeedback(options = {}) {
  const config = resolveOperatorConfig({ baseUrl: options.baseUrl, configPath: options.configPath });
  const apiKey = options.apiKey || config.apiKey;
  const baseUrl = options.baseUrl
    || process.env.THUMBGATE_HOSTED_BASE_URL
    || (config.baseUrl && !config.baseUrl.includes('railway.app') ? config.baseUrl : DEFAULT_HOSTED_BASE_URL);
  if (!apiKey) {
    return { ok: false, skipped: true, reason: 'no_operator_key', imported: 0 };
  }
  const statePath = getStatePath(options);
  const state = readState(statePath);
  const processed = new Set(state.processedIds);

  const bundle = await fetchHostedLessons({
    baseUrl,
    apiKey,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  const cwd = options.cwd || process.cwd();
  const local = options.localProject || resolveLocalProject(cwd);
  const candidates = selectHostedFeedback(bundle, processed);
  const fresh = candidates.filter((l) => belongsToProject(l, local.projectKey));
  const skippedOtherProject = candidates.length - fresh.length;
  const capture = options.captureImpl || captureFeedback;
  const imported = [];
  const failed = [];
  for (const lesson of fresh) {
    const signal = normalizeSignal(lesson.signal);
    if (!options.dryRun) {
      try {
      const tags = [...new Set([...(Array.isArray(lesson.tags) ? lesson.tags : []), 'hosted-connector', 'hosted-sync'])];
      capture({
        signal,
        context: lesson.context || lesson.title || '',
        whatWentWrong: lesson.whatWentWrong || undefined,
        whatToChange: lesson.whatToChange || undefined,
        whatWorked: lesson.whatWorked || undefined,
        tags,
        skill: lesson.skill || undefined,
        reviewOrigin: 'human',
        sourceEvent: buildFeedbackSourceIdentity({
          signal,
          promptText: lesson.context || lesson.title || lesson.id,
          promptId: lesson.id,
          timestamp: Date.parse(lesson.timestamp || '') || Date.now(),
          source: 'hosted-connector',
        }),
        cwd,
      }, options.feedbackDir ? { feedbackDir: options.feedbackDir, cwd } : { cwd });
      } catch (err) {
        // Left out of processedIds so the next run retries it.
        failed.push({ id: lesson.id, error: err.message });
        continue;
      }
      processed.add(lesson.id);
    }
    imported.push({ id: lesson.id, signal, timestamp: lesson.timestamp || null });
  }
  if (!options.dryRun) {
    writeState(statePath, { processedIds: [...processed], lastSyncAt: new Date().toISOString(), baseUrl });
  }
  return {
    ok: true,
    baseUrl,
    keySource: options.apiKey ? 'option' : config.keySource,
    hostedFeedback: (bundle.lessons || []).filter((l) => String(l.id || '').startsWith('fb_')).length,
    projectKey: local.projectKey,
    imported: imported.length,
    skippedOtherProject,
    failed,
    importedIds: imported,
    dryRun: Boolean(options.dryRun),
  };
}

function parseArgs(argv) {
  const out = { dryRun: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--json') out.json = true;
    else if (a === '--base-url') { out.baseUrl = argv[i + 1]; i += 1; }
    else if (a.startsWith('--base-url=')) out.baseUrl = a.slice('--base-url='.length);
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  try {
    const result = await syncHostedFeedback(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.skipped) {
      process.stdout.write('Hosted sync skipped: no operator key. Set THUMBGATE_OPERATOR_KEY or add operatorKey to ~/.config/thumbgate/operator.json.\n');
    } else {
      process.stdout.write(`Hosted sync from ${result.baseUrl}: ${result.imported} new of ${result.hostedFeedback} hosted feedback events${result.dryRun ? ' (dry run)' : ''}.\n`);
    }
    return (result.ok && !(result.failed || []).length) || result.skipped ? 0 : 1;
  } catch (err) {
    process.stderr.write(`Hosted sync failed: ${err.message}\n`);
    return 1;
  }
}

module.exports = {
  EXPORT_PATH,
  STATE_FILE,
  DEFAULT_HOSTED_BASE_URL,
  normalizeSignal,
  belongsToProject,
  selectHostedFeedback,
  fetchHostedLessons,
  syncHostedFeedback,
  parseArgs,
  main,
};

// Path-based entrypoint check (require.main === module is flagged by SonarCloud S3403).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().then((code) => { process.exitCode = code; });
}
