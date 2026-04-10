#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveFeedbackDir } = require('./feedback-paths');
const { parseFeedbackFile, classifySignal, analyzeWithLLM, analyze, promoteToGates } = require('./feedback-to-rules');
const { inferStructuredLessonLLM, inferStructuredLesson, createLesson } = require('./lesson-inference');
const { isAvailable } = require('./llm-client');

const MAX_ENTRIES_PER_RUN = 20;
const DELAY_BETWEEN_CALLS_MS = 500;
const MANIFEST_DIR = path.join(os.homedir(), '.thumbgate');
const MANIFEST_PATH = path.join(MANIFEST_DIR, 'managed-agent-runs.jsonl');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProcessedIds() {
  if (!fs.existsSync(MANIFEST_PATH)) return new Set();
  const ids = new Set();
  for (const line of fs.readFileSync(MANIFEST_PATH, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const run = JSON.parse(trimmed);
      if (Array.isArray(run.processedIds)) {
        for (const id of run.processedIds) ids.add(id);
      }
    } catch { /* skip */ }
  }
  return ids;
}

function writeManifest(manifest) {
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  fs.appendFileSync(MANIFEST_PATH, JSON.stringify(manifest) + '\n');
}

function getManagedAgentStatus() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  const lines = fs.readFileSync(MANIFEST_PATH, 'utf8').split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  try {
    const last = JSON.parse(lines[lines.length - 1]);
    return {
      lastRun: last.runAt,
      entriesProcessed: last.entriesProcessed,
      lessonsCreated: last.lessonsCreated,
      gatesPromoted: last.gatesPromoted,
      model: last.model,
      durationMs: last.durationMs,
      totalRuns: lines.length,
    };
  } catch {
    return null;
  }
}

async function runManagedAgent({ dryRun = false, limit, model } = {}) {
  const startTime = Date.now();
  const feedbackDir = resolveFeedbackDir();
  const logPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const entries = parseFeedbackFile(logPath);

  if (entries.length === 0) {
    return { entriesProcessed: 0, lessonsCreated: 0, gatesPromoted: 0, model: 'none', durationMs: 0, message: 'No feedback entries found' };
  }

  const processedIds = getProcessedIds();
  const pending = entries
    .filter((e) => {
      const id = e.id || e.feedbackId || e.timestamp;
      return id && !processedIds.has(id);
    })
    .slice(0, limit || MAX_ENTRIES_PER_RUN);

  if (pending.length === 0) {
    return { entriesProcessed: 0, lessonsCreated: 0, gatesPromoted: 0, model: 'none', durationMs: Date.now() - startTime, message: 'All entries already processed' };
  }

  const useLLM = isAvailable();
  const modelUsed = useLLM ? 'claude-haiku-4-5' : 'heuristic';
  let lessonsCreated = 0;
  const newProcessedIds = [];

  for (const entry of pending) {
    const id = entry.id || entry.feedbackId || entry.timestamp;
    const signal = classifySignal(entry);
    if (!signal) {
      newProcessedIds.push(id);
      continue;
    }

    const window = Array.isArray(entry.conversationWindow) ? entry.conversationWindow : [];
    const context = entry.context || '';

    let structuredLesson = null;
    if (useLLM) {
      structuredLesson = await inferStructuredLessonLLM(window, signal, context);
      if (structuredLesson && !dryRun) {
        await sleep(DELAY_BETWEEN_CALLS_MS);
      }
    }

    if (!structuredLesson) {
      structuredLesson = inferStructuredLesson(window, signal, context);
    }

    if (!dryRun && structuredLesson) {
      try {
        createLesson({
          feedbackId: id,
          signal,
          inferredLesson: structuredLesson.action?.description || '',
          triggerMessage: structuredLesson.examples?.[0]?.assistantAction || '',
          priorSummary: '',
          confidence: structuredLesson.confidence || 0.5,
          tags: structuredLesson.tags || entry.tags || [],
          metadata: { ...structuredLesson.metadata, managedAgent: true, format: structuredLesson.format },
        });
        lessonsCreated++;
      } catch { /* lesson creation is best-effort */ }
    } else if (dryRun && structuredLesson) {
      lessonsCreated++;
    }

    newProcessedIds.push(id);
  }

  // Rule generation pass
  let gatesPromoted = 0;
  if (useLLM) {
    const llmIssues = await analyzeWithLLM(entries);
    if (llmIssues && llmIssues.length > 0) {
      if (!dryRun) {
        promoteToGates(llmIssues);
      }
      gatesPromoted = llmIssues.filter((i) => i.severity === 'critical').length;
    }
  } else {
    const report = analyze(entries);
    gatesPromoted = report.recurringIssues.filter((i) => i.severity === 'critical').length;
  }

  const manifest = {
    runAt: new Date().toISOString(),
    entriesProcessed: pending.length,
    lessonsCreated,
    gatesPromoted,
    model: modelUsed,
    dryRun,
    durationMs: Date.now() - startTime,
    processedIds: newProcessedIds,
  };

  if (!dryRun) {
    writeManifest(manifest);
  }

  return manifest;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitFlag = args.find((a) => a.startsWith('--limit'));
  const limit = limitFlag ? Number(args[args.indexOf(limitFlag) + 1]) || MAX_ENTRIES_PER_RUN : undefined;

  runManagedAgent({ dryRun, limit })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('Managed agent error:', err.message);
      process.exit(1);
    });
}

module.exports = { runManagedAgent, getManagedAgentStatus };
