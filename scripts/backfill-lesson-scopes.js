#!/usr/bin/env node
'use strict';

/**
 * backfill-lesson-scopes.js — Backfill project-level scopes and demote transport blobs
 * in memory logs.
 *
 * Implements Item 1 of the Dual-Model MoA & Agentic GraphRAG Playbook brief:
 * "Give each lesson a fixed-schema scope at capture time (project/repo from cwd and git remote,
 * plus tool and failure class), and backfill existing lessons from their text where the project is clear."
 */

const fs = require('node:fs');
const path = require('node:path');
const { getFeedbackPaths, readJSONL } = require('./feedback-loop');
const { inferProjectFromLesson, isTranscriptShaped } = require('./project-scope');

function backfillMemoryLog(filePath, options = {}) {
  const targetPath = filePath || getFeedbackPaths().MEMORY_LOG_PATH;
  if (!fs.existsSync(targetPath)) {
    return { ok: false, reason: `File not found: ${targetPath}` };
  }

  const records = readJSONL(targetPath, { maxLines: 0 });
  let modifiedCount = 0;
  let demotedTranscripts = 0;
  const projectCounts = {};

  const updatedRecords = records.map((record) => {
    if (!record || typeof record !== 'object') return record;

    let modified = false;
    let demoted = record.demoted;
    let demoteReason = record.demoteReason;

    // 1. Demote transcript-shaped blobs
    if (isTranscriptShaped(record) && !demoted) {
      demoted = true;
      demoteReason = 'transcript_shaped_transport_blob';
      demotedTranscripts += 1;
      modified = true;
    }

    // 2. Infer project if missing or generic; unknown remains null (unscoped)
    const existingProject = record.scope?.projectId || record.metadata?.project;
    const inferredProject = inferProjectFromLesson(record);
    const resolvedProject = existingProject && existingProject !== 'default' && existingProject !== 'agent'
      ? existingProject
      : (inferredProject || null);

    const countKey = resolvedProject || 'unscoped';
    projectCounts[countKey] = (projectCounts[countKey] || 0) + 1;

    const existingScope = record.scope || {};
    const scopeModified = existingScope.projectId !== resolvedProject;
    if (scopeModified) {
      modified = true;
    }

    const updatedScope = {
      ...(existingScope.entityId ? { entityId: existingScope.entityId } : {}),
      projectId: resolvedProject,
      processId: existingScope.processId || 'agent',
      sessionId: existingScope.sessionId || `session_${record.timestamp ? new Date(record.timestamp).getTime() : Date.now()}`,
    };

    const existingMetadata = record.metadata || {};
    const updatedMetadata = {
      ...existingMetadata,
      ...(resolvedProject ? { project: resolvedProject, repo: resolvedProject } : {}),
      tool: existingMetadata.tool || record.structuredRule?.metadata?.toolsUsed?.[0] || 'unknown',
      failureClass: existingMetadata.failureClass || (record.category === 'error' ? 'execution' : 'success'),
    };

    if (modified) {
      modifiedCount += 1;
    }

    return {
      ...record,
      demoted,
      ...(demoteReason ? { demoteReason } : {}),
      scope: updatedScope,
      metadata: updatedMetadata,
    };
  });

  if (!options.dryRun && modifiedCount > 0) {
    const tmpPath = `${targetPath}.tmp.${Date.now()}`;
    const serialized = updatedRecords.map((r) => JSON.stringify(r)).join('\n') + (updatedRecords.length ? '\n' : '');
    fs.writeFileSync(tmpPath, serialized, 'utf8');
    fs.renameSync(tmpPath, targetPath);
  }

  return {
    ok: true,
    totalRecords: records.length,
    modifiedCount,
    demotedTranscripts,
    projectCounts,
    dryRun: Boolean(options.dryRun),
    targetPath,
  };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileArgIdx = args.indexOf('--file');
  const targetFile = fileArgIdx !== -1 ? args[fileArgIdx + 1] : null;

  const result = backfillMemoryLog(targetFile, { dryRun });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

module.exports = {
  backfillMemoryLog,
};
