#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureParentDir } = require('./fs-utils');
const { sanitizeToolInput } = require('./audit-trail');

const HOSTED_TEAM_SYNC_VERSION = '1.0.0';
const HOSTED_TEAM_DIRNAME = 'hosted-team';
const HOSTED_LESSONS_FILENAME = 'lessons.jsonl';
const HOSTED_AUDIT_FILENAME = 'audit-trail.jsonl';
const MAX_SYNC_LESSONS = 1000;
const MAX_AUDIT_EVENTS = 1000;
const DEFAULT_HOSTED_TEAM_HASH_SECRET = 'thumbgate-hosted-team-sync-v1';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSignal(signal) {
  const normalized = normalizeText(signal).toLowerCase();
  if (['up', 'positive', 'thumbs_up', 'thumbsup'].includes(normalized)) return 'up';
  if (['warn', 'warning'].includes(normalized)) return 'warn';
  return 'down';
}

function hashValue(value, length = 16) {
  return crypto
    .createHmac('sha256', process.env.THUMBGATE_HOSTED_TEAM_HASH_SECRET || DEFAULT_HOSTED_TEAM_HASH_SECRET)
    .update(String(value || ''))
    .digest('hex')
    .slice(0, length);
}

function redactHostedText(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return '';
  return text
    .replace(/\btg_(?:pro_)?[A-Za-z0-9_:-]{12,}\b/g, '[redacted:thumbgate-key]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[redacted:github-token]')
    .replace(/\blsv2_[A-Za-z0-9_:-]{20,}\b/g, '[redacted:langsmith-key]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[redacted:api-key]');
}

function redactHostedValue(value) {
  if (typeof value === 'string') return redactHostedText(value);
  if (Array.isArray(value)) return value.map((item) => redactHostedValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactHostedValue(item)]));
  }
  return value;
}

function asTags(value) {
  if (Array.isArray(value)) {
    return value.map((tag) => normalizeText(tag)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((tag) => normalizeText(tag)).filter(Boolean);
  }
  return [];
}

function hostedCustomerHash(customerId) {
  const normalized = normalizeText(customerId);
  if (!normalized) throw new Error('customerId is required for hosted team sync');
  return normalized
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'customer';
}

function getHostedTeamPaths(customerId, options = {}) {
  const baseDir = options.baseDir || process.env.THUMBGATE_HOSTED_TEAM_DATA_DIR || options.safeDataDir;
  if (!baseDir) throw new Error('baseDir or safeDataDir is required for hosted team sync');
  const customerHash = hostedCustomerHash(customerId);
  const dir = path.join(baseDir, HOSTED_TEAM_DIRNAME, customerHash);
  return {
    customerHash,
    dir,
    lessonsPath: path.join(dir, HOSTED_LESSONS_FILENAME),
    auditPath: path.join(dir, HOSTED_AUDIT_FILENAME),
  };
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeJsonl(filePath, rows) {
  ensureParentDir(filePath);
  const text = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, text ? `${text}\n` : '', 'utf8');
}

function lessonStableKey(lesson = {}) {
  const explicitId = normalizeText(lesson.id || lesson.originalId);
  if (explicitId) return `id:${explicitId}`;
  const fingerprint = [
    normalizeSignal(lesson.signal),
    normalizeText(lesson.title || lesson.context).toLowerCase(),
    normalizeText(lesson.whatWentWrong).toLowerCase(),
    normalizeText(lesson.whatToChange).toLowerCase(),
    normalizeText(lesson.whatWorked).toLowerCase(),
  ].join('|');
  return `hash:${hashValue(fingerprint, 24)}`;
}

function sanitizeLesson(lesson = {}, context = {}) {
  const mergedTags = new Set([
    ...asTags(lesson.tags),
    'hosted-team-sync',
  ]);
  return {
    id: `hosted_lesson_${hashValue(lessonStableKey(lesson), 24)}`,
    originalId: normalizeText(lesson.id || lesson.originalId) || null,
    stableKey: lessonStableKey(lesson),
    signal: normalizeSignal(lesson.signal),
    title: redactHostedText(normalizeText(lesson.title || lesson.context)),
    context: redactHostedText(normalizeText(lesson.context)),
    whatWentWrong: redactHostedText(normalizeText(lesson.whatWentWrong)),
    whatWorked: redactHostedText(normalizeText(lesson.whatWorked)),
    whatToChange: redactHostedText(normalizeText(lesson.whatToChange)),
    tags: Array.from(mergedTags),
    timestamp: normalizeText(lesson.timestamp) || new Date().toISOString(),
    failureType: normalizeText(lesson.failureType) || null,
    skill: normalizeText(lesson.skill) || null,
    structuredRule: redactHostedValue(lesson.structuredRule || lesson.rule || null),
    diagnosis: redactHostedValue(lesson.diagnosis || null),
    source: context.source || lesson.source || null,
    syncedAt: new Date().toISOString(),
  };
}

function readLocalLessonRecords(feedbackDir) {
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');
  const feedbacks = readJsonl(feedbackLogPath);
  const memories = readJsonl(memoryLogPath);
  const lessonMap = new Map();

  for (const record of feedbacks) {
    if (!record || !record.id) continue;
    lessonMap.set(record.id, { ...record });
  }
  for (const record of memories) {
    if (!record || !record.id) continue;
    lessonMap.set(record.id, { ...(lessonMap.get(record.id) || {}), ...record });
  }

  return Array.from(lessonMap.values());
}

function buildLocalLessonBundle(feedbackDir, options = {}) {
  const records = readLocalLessonRecords(feedbackDir)
    .slice(0, Number(options.limit || MAX_SYNC_LESSONS));
  return {
    version: HOSTED_TEAM_SYNC_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      project: normalizeText(options.project) || path.basename(process.cwd()),
      hostname: os.hostname(),
      source: options.source || 'cli_hosted_team_sync',
    },
    lessonCount: records.length,
    lessons: records.map((record) => sanitizeLesson(record, {
      customerId: options.customerId || 'local',
      source: {
        project: normalizeText(options.project) || path.basename(process.cwd()),
        hostname: os.hostname(),
      },
    })),
  };
}

function normalizeLessonBundle(input) {
  const bundle = input && input.bundle && typeof input.bundle === 'object' ? input.bundle : input;
  const lessons = Array.isArray(bundle && bundle.lessons) ? bundle.lessons : [];
  return {
    version: normalizeText(bundle && bundle.version) || HOSTED_TEAM_SYNC_VERSION,
    exportedAt: normalizeText(bundle && bundle.exportedAt) || null,
    source: bundle && bundle.source && typeof bundle.source === 'object' ? bundle.source : null,
    lessons,
  };
}

function mergeLessonsIntoHostedStore(customerId, input, options = {}) {
  const paths = getHostedTeamPaths(customerId, options);
  const bundle = normalizeLessonBundle(input);
  const existing = readJsonl(paths.lessonsPath);
  const byStableKey = new Map(existing.map((lesson) => [lesson.stableKey || lessonStableKey(lesson), lesson]));
  let imported = 0;
  let skippedDuplicate = 0;

  for (const rawLesson of bundle.lessons.slice(0, Number(options.limit || MAX_SYNC_LESSONS))) {
    const lesson = sanitizeLesson(rawLesson, {
      customerId,
      source: bundle.source,
    });
    if (byStableKey.has(lesson.stableKey)) {
      skippedDuplicate++;
      continue;
    }
    byStableKey.set(lesson.stableKey, lesson);
    imported++;
  }

  const lessons = Array.from(byStableKey.values())
    .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
  writeJsonl(paths.lessonsPath, lessons);

  return {
    imported,
    skippedDuplicate,
    received: bundle.lessons.length,
    totalHostedLessons: lessons.length,
    customerHash: paths.customerHash,
  };
}

function exportHostedLessonBundle(customerId, options = {}) {
  const paths = getHostedTeamPaths(customerId, options);
  const lessons = readJsonl(paths.lessonsPath)
    .slice(-Number(options.limit || MAX_SYNC_LESSONS));
  return {
    version: HOSTED_TEAM_SYNC_VERSION,
    exportedAt: new Date().toISOString(),
    customerHash: paths.customerHash,
    lessonCount: lessons.length,
    lessons,
  };
}

function importHostedLessonsIntoFeedbackDir(feedbackDir, input, options = {}) {
  const bundle = normalizeLessonBundle(input);
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const existing = readJsonl(feedbackLogPath);
  const stableKeys = new Set(existing.map((record) =>
    (record && record.provenance && record.provenance.hostedStableKey)
      || record.stableKey
      || lessonStableKey(record)
  ));
  let imported = 0;
  let skippedDuplicate = 0;

  for (const lesson of bundle.lessons.slice(0, Number(options.limit || MAX_SYNC_LESSONS))) {
    const stableKey = lesson.stableKey || lessonStableKey(lesson);
    if (stableKeys.has(stableKey)) {
      skippedDuplicate++;
      continue;
    }
    const record = {
      id: `team_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      signal: normalizeSignal(lesson.signal),
      title: lesson.title || '',
      context: lesson.context || '',
      whatWentWrong: lesson.whatWentWrong || '',
      whatWorked: lesson.whatWorked || '',
      whatToChange: lesson.whatToChange || '',
      tags: Array.from(new Set([...asTags(lesson.tags), 'hosted-team-import'])),
      timestamp: new Date().toISOString(),
      failureType: lesson.failureType || null,
      skill: lesson.skill || null,
      structuredRule: lesson.structuredRule || null,
      diagnosis: lesson.diagnosis || null,
      provenance: {
        importedAt: new Date().toISOString(),
        originalId: lesson.originalId || lesson.id || null,
        source: lesson.source || bundle.source || null,
        hostedStableKey: stableKey,
      },
    };
    ensureParentDir(feedbackLogPath);
    fs.appendFileSync(feedbackLogPath, `${JSON.stringify(record)}\n`, 'utf8');
    stableKeys.add(stableKey);
    imported++;
  }

  return {
    imported,
    skippedDuplicate,
    received: bundle.lessons.length,
  };
}

function normalizeAuditEvent(event = {}, context = {}) {
  const timestamp = normalizeText(event.timestamp) || new Date().toISOString();
  const toolInput = event.toolInput && typeof event.toolInput === 'object' ? event.toolInput : {};
  return {
    id: `hosted_audit_${hashValue(`${event.id || ''}:${timestamp}:${event.toolName || ''}:${event.decision || ''}`, 24)}`,
    originalId: normalizeText(event.id) || null,
    timestamp,
    toolName: normalizeText(event.toolName) || 'unknown',
    toolInput: redactHostedValue(sanitizeToolInput(toolInput)),
    decision: ['allow', 'deny', 'warn'].includes(normalizeText(event.decision).toLowerCase())
      ? normalizeText(event.decision).toLowerCase()
      : 'allow',
    gateId: normalizeText(event.gateId) || null,
    message: redactHostedText(normalizeText(event.message)),
    severity: normalizeText(event.severity) || null,
    latencyMs: typeof event.latencyMs === 'number' ? event.latencyMs : null,
    source: normalizeText(event.source) || 'hosted-team-sync',
    syncedAt: new Date().toISOString(),
  };
}

function appendHostedAuditEvents(customerId, events, options = {}) {
  const paths = getHostedTeamPaths(customerId, options);
  const incoming = (Array.isArray(events) ? events : [events])
    .filter(Boolean)
    .slice(0, Number(options.limit || MAX_AUDIT_EVENTS))
    .map((event) => normalizeAuditEvent(event, { customerId }));
  const existing = readJsonl(paths.auditPath);
  const existingIds = new Set(existing.map((event) => event.id));
  const merged = [...existing];
  let accepted = 0;
  let skippedDuplicate = 0;

  for (const event of incoming) {
    if (existingIds.has(event.id)) {
      skippedDuplicate++;
      continue;
    }
    merged.push(event);
    existingIds.add(event.id);
    accepted++;
  }

  writeJsonl(paths.auditPath, merged);
  return {
    accepted,
    skippedDuplicate,
    received: incoming.length,
    totalHostedAuditEvents: merged.length,
    customerHash: paths.customerHash,
  };
}

function readHostedAuditEvents(customerId, options = {}) {
  const paths = getHostedTeamPaths(customerId, options);
  const limit = Number(options.limit || MAX_AUDIT_EVENTS);
  const events = readJsonl(paths.auditPath).slice(-limit);
  const stats = {
    total: events.length,
    allow: 0,
    deny: 0,
    warn: 0,
    byGate: {},
    bySource: {},
  };
  for (const event of events) {
    stats[event.decision] = (stats[event.decision] || 0) + 1;
    if (event.gateId) {
      stats.byGate[event.gateId] = stats.byGate[event.gateId] || { allow: 0, deny: 0, warn: 0 };
      stats.byGate[event.gateId][event.decision] = (stats.byGate[event.gateId][event.decision] || 0) + 1;
    }
    if (event.source) stats.bySource[event.source] = (stats.bySource[event.source] || 0) + 1;
  }
  return {
    customerHash: paths.customerHash,
    events,
    stats,
  };
}

module.exports = {
  HOSTED_TEAM_SYNC_VERSION,
  HOSTED_TEAM_DIRNAME,
  HOSTED_LESSONS_FILENAME,
  HOSTED_AUDIT_FILENAME,
  MAX_SYNC_LESSONS,
  MAX_AUDIT_EVENTS,
  appendHostedAuditEvents,
  buildLocalLessonBundle,
  exportHostedLessonBundle,
  getHostedTeamPaths,
  hostedCustomerHash,
  importHostedLessonsIntoFeedbackDir,
  lessonStableKey,
  mergeLessonsIntoHostedStore,
  normalizeAuditEvent,
  normalizeLessonBundle,
  readHostedAuditEvents,
  readJsonl,
  redactHostedText,
  sanitizeLesson,
};
