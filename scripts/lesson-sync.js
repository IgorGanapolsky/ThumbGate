'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function readJsonl(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
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
  } catch {
    return [];
  }
}

function normalizeLessonSignal(signal) {
  const value = String(signal || '').toLowerCase();
  if (['up', 'positive', 'success', 'worked', 'good'].includes(value)) return 'up';
  if (['down', 'negative', 'failure', 'mistake', 'bad'].includes(value)) return 'down';
  return value || 'down';
}

function lessonFingerprint(lesson) {
  const signal = normalizeLessonSignal(lesson && lesson.signal);
  const title = String((lesson && (lesson.title || lesson.context)) || '').trim().toLowerCase();
  const change = String((lesson && (lesson.whatToChange || lesson.whatWorked || lesson.whatWentWrong)) || '').trim().toLowerCase();
  return `${signal}|${title}|${change}`;
}

function normalizeLessonRecord(record) {
  const merged = record || {};
  return {
    id: merged.id || null,
    signal: normalizeLessonSignal(merged.signal),
    title: merged.title || merged.context || '',
    context: merged.context || '',
    whatWentWrong: merged.whatWentWrong || '',
    whatWorked: merged.whatWorked || '',
    whatToChange: merged.whatToChange || '',
    tags: Array.isArray(merged.tags) ? merged.tags : [],
    timestamp: merged.timestamp || null,
    failureType: merged.failureType || null,
    skill: merged.skill || null,
    structuredRule: merged.structuredRule || merged.rule || null,
    diagnosis: merged.diagnosis || null,
  };
}

function buildLessonBundleFromDir(feedbackDir, { source = {} } = {}) {
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const memories = readJsonl(memoryLogPath);
  const feedbacks = readJsonl(feedbackLogPath);

  const lessonMap = new Map();
  for (const rec of feedbacks) {
    const key = rec.id || lessonFingerprint(rec);
    if (key) lessonMap.set(key, { feedbackEvent: rec, memoryRecord: null });
  }
  for (const rec of memories) {
    const key = rec.sourceFeedbackId || rec.id || lessonFingerprint(rec);
    if (!key) continue;
    const existing = lessonMap.get(key);
    if (existing) existing.memoryRecord = rec;
    else lessonMap.set(key, { feedbackEvent: null, memoryRecord: rec });
  }

  const lessons = Array.from(lessonMap.values()).map((pair) => {
    const merged = { ...(pair.memoryRecord || {}), ...(pair.feedbackEvent || {}) };
    if (!merged.title && pair.memoryRecord && pair.memoryRecord.title) {
      merged.title = pair.memoryRecord.title;
    }
    if (!merged.context && pair.memoryRecord && pair.memoryRecord.content) {
      merged.context = pair.memoryRecord.content;
    }
    return normalizeLessonRecord(merged);
  });

  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    source: {
      project: path.basename(feedbackDir),
      hostname: os.hostname(),
      ...source,
    },
    lessonCount: lessons.length,
    lessons,
  };
}

function mergeLessonBundleIntoDir(bundle, feedbackDir, {
  importTag = 'pro-sync',
  now = () => new Date(),
} = {}) {
  if (!bundle || !Array.isArray(bundle.lessons)) {
    throw new Error('Invalid bundle: missing lessons array');
  }

  fs.mkdirSync(feedbackDir, { recursive: true });
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const existing = readJsonl(feedbackLogPath);
  const existingIds = new Set(existing.map((r) => r.id).filter(Boolean));
  const existingFingerprints = new Set(existing.map(lessonFingerprint).filter((h) => h !== '||'));

  let imported = 0;
  let skippedDuplicate = 0;
  const importedIds = [];

  for (const lesson of bundle.lessons) {
    if (lesson.id && existingIds.has(lesson.id)) {
      skippedDuplicate += 1;
      continue;
    }

    const fingerprint = lessonFingerprint(lesson);
    if (fingerprint !== '||' && existingFingerprints.has(fingerprint)) {
      skippedDuplicate += 1;
      continue;
    }

    const timestamp = now().toISOString();
    const importedRecord = {
      id: `sync_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      signal: normalizeLessonSignal(lesson.signal),
      title: lesson.title || lesson.context || '',
      context: lesson.context || '',
      whatWentWrong: lesson.whatWentWrong || '',
      whatWorked: lesson.whatWorked || '',
      whatToChange: lesson.whatToChange || '',
      tags: [...new Set([...(Array.isArray(lesson.tags) ? lesson.tags : []), importTag])],
      timestamp,
      failureType: lesson.failureType || null,
      skill: lesson.skill || null,
      structuredRule: lesson.structuredRule || null,
      diagnosis: lesson.diagnosis || null,
      provenance: {
        importedAt: timestamp,
        originalId: lesson.id || null,
        source: bundle.source || null,
        exportedAt: bundle.exportedAt || null,
      },
    };

    fs.appendFileSync(feedbackLogPath, `${JSON.stringify(importedRecord)}\n`, 'utf8');
    existingIds.add(importedRecord.id);
    existingFingerprints.add(fingerprint);
    importedIds.push(importedRecord.id);
    imported += 1;
  }

  return {
    imported,
    skippedDuplicate,
    total: bundle.lessons.length,
    importedIds,
    source: bundle.source || null,
  };
}

function customerSyncHash(customerId) {
  const id = String(customerId || '').trim();
  if (!id) {
    throw new Error('customerId is required for hosted sync');
  }
  return Buffer.from(id, 'utf8').toString('base64url');
}

function getAccountSyncDir(rootDir, customerId) {
  return path.join(rootDir, 'hosted-sync', customerSyncHash(customerId));
}

function getSyncStatusForDir(feedbackDir) {
  const bundle = buildLessonBundleFromDir(feedbackDir);
  let lastUpdatedAt = null;
  for (const lesson of bundle.lessons) {
    if (lesson.timestamp && (!lastUpdatedAt || lesson.timestamp > lastUpdatedAt)) {
      lastUpdatedAt = lesson.timestamp;
    }
  }
  return {
    lessonCount: bundle.lessonCount,
    lastUpdatedAt,
  };
}

module.exports = {
  buildLessonBundleFromDir,
  customerSyncHash,
  getAccountSyncDir,
  getSyncStatusForDir,
  lessonFingerprint,
  mergeLessonBundleIntoDir,
  normalizeLessonSignal,
  readJsonl,
};
