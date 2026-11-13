'use strict';

/**
 * verified-lessons.js — Core domain logic for verified lessons, voting,
 * staleness, and exact-error lookup (brief 2026-11-05).
 */

const fs = require('node:fs');
const path = require('node:path');
const { getFeedbackPaths } = require('./feedback-paths');
const { readJSONL } = require('./feedback-loop');

// Built-in seeded lessons catalog (search before solving)
const SEEDED_LESSONS = [
  {
    id: 'lesson_seed_e2e_base_url',
    title: 'MISTAKE: E2E_BASE_URL is not set during pre-push hook',
    errorPattern: 'E2E_BASE_URL is not set',
    fix: 'set E2E_BASE_URL to the STAGE URL and run the push under with-secrets; never E2E_HOOK_SKIP',
    content: [
      'What went wrong: Azure DevOps pre-push hook failed: E2E_BASE_URL is not set in a fresh worktree.',
      'How to avoid: set E2E_BASE_URL to the STAGE URL and run the push under with-secrets; never E2E_HOOK_SKIP',
      'Action needed: Set E2E_BASE_URL to the STAGE URL and run the push under with-secrets; never E2E_HOOK_SKIP.',
    ].join('\n'),
    category: 'error',
    importance: 'high',
    tags: ['git', 'pre-push', 'azure-devops', 'e2e', 'verification'],
    verificationStatus: 'verified',
    verificationCount: 1,
    lastVerifiedAt: '2026-11-05T00:00:00.000Z',
    verifications: [
      {
        date: '2026-11-05',
        check: 'git push with-secrets (E2E_BASE_URL set to STAGE)',
      },
    ],
    upVotes: 1,
    downVotes: 0,
    netVotes: 1,
    timestamp: '2026-11-05T00:00:00.000Z',
  },
];

function normalizeVerificationFields(lesson = {}) {
  const verifications = Array.isArray(lesson.verifications) ? [...lesson.verifications] : [];
  const verificationCount = Number.isInteger(lesson.verificationCount)
    ? lesson.verificationCount
    : verifications.length;
  const lastVerifiedAt = lesson.lastVerifiedAt || (verifications.length > 0 ? verifications[verifications.length - 1].date : null);
  const verificationStatus = lesson.verificationStatus || (verificationCount > 0 ? 'verified' : 'unverified');

  const upVotes = Number.isInteger(lesson.upVotes) ? lesson.upVotes : 0;
  const downVotes = Number.isInteger(lesson.downVotes) ? lesson.downVotes : 0;
  const netVotes = upVotes - downVotes;

  return {
    ...lesson,
    verificationStatus,
    verifications,
    verificationCount,
    lastVerifiedAt,
    upVotes,
    downVotes,
    netVotes,
  };
}

function formatVerificationBadge(lesson) {
  const count = Number(lesson.verificationCount || 0);
  if (count <= 0 || !lesson.lastVerifiedAt) {
    return 'unverified';
  }
  const dateStr = String(lesson.lastVerifiedAt).split('T')[0];
  return `verified ${count}x, last ${dateStr}`;
}

function isLessonStale(lesson, now = new Date()) {
  if (!lesson || !lesson.lastVerifiedAt) return false;
  const last = new Date(lesson.lastVerifiedAt).getTime();
  if (!Number.isFinite(last)) return false;
  const nowDate = (now instanceof Date ? now : new Date(now)).getTime();
  const diffDays = (nowDate - last) / (1000 * 60 * 60 * 24);
  return diffDays > 30;
}

function isLessonDemoted(lesson) {
  if (!lesson) return false;
  const up = Number(lesson.upVotes || 0);
  const down = Number(lesson.downVotes || 0);
  return down > up;
}

/**
 * Atomically updates a lesson in memory-log.jsonl
 */
function updateMemoryRecord(memoryId, updater, options = {}) {
  const paths = getFeedbackPaths(options);
  const memoryLogPath = paths.MEMORY_LOG_PATH;
  const dir = path.dirname(memoryLogPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let lines = [];
  if (fs.existsSync(memoryLogPath)) {
    const raw = fs.readFileSync(memoryLogPath, 'utf8');
    lines = raw.split('\n').filter(Boolean);
  }

  let updatedRecord = null;
  let found = false;
  const newLines = lines.map((line) => {
    try {
      const record = JSON.parse(line);
      if (record.id === memoryId || record.canonicalHash === memoryId || record.title === memoryId) {
        found = true;
        updatedRecord = updater(record);
        return JSON.stringify(updatedRecord);
      }
      return line;
    } catch {
      return line;
    }
  });

  if (!found) {
    const baseRecord = options.initialLesson || {
      id: memoryId,
      title: options.title || memoryId,
      content: options.content || memoryId,
      timestamp: (options.now instanceof Date ? options.now : new Date(options.now || Date.now())).toISOString(),
      signal: 'negative',
    };
    updatedRecord = updater(baseRecord);
    newLines.push(JSON.stringify(updatedRecord));
  }

  if (updatedRecord) {
    fs.writeFileSync(memoryLogPath, newLines.join('\n') + '\n', 'utf8');
  }
  return updatedRecord;
}

/**
 * Record a verification on a lesson.
 * Resets demoted status (if downVotes > upVotes, verification overrides/resets it).
 */
function verifyLesson(lessonId, checkCommand = 'manual check', options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const dateStr = now.toISOString().split('T')[0];

  return updateMemoryRecord(lessonId, (record) => {
    const norm = normalizeVerificationFields(record);
    if (checkCommand === 'check-only') {
      return {
        ...record,
        ...norm,
      };
    }
    const verifications = [...norm.verifications, { date: dateStr, check: checkCommand }];
    const verificationCount = norm.verificationCount + 1;
    const lastVerifiedAt = now.toISOString();

    // Re-verification overrides or offsets downvotes so it is no longer demoted
    let upVotes = norm.upVotes;
    let downVotes = norm.downVotes;
    if (downVotes > upVotes) {
      upVotes = downVotes; // reset netVotes to 0 so downVotes > upVotes is cleared
    }

    return {
      ...record,
      verificationStatus: 'verified',
      verifications,
      verificationCount,
      lastVerifiedAt,
      upVotes,
      downVotes,
      netVotes: upVotes - downVotes,
      demoted: false,
    };
  }, options);
}

/**
 * Vote up or down on a lesson.
 */
function voteOnLesson(lessonId, signal, options = {}) {
  const isUp = signal === 'up' || signal === 'positive';
  const isDown = signal === 'down' || signal === 'negative';
  if (!isUp && !isDown) return null;

  return updateMemoryRecord(lessonId, (record) => {
    const norm = normalizeVerificationFields(record);
    const upVotes = norm.upVotes + (isUp ? 1 : 0);
    const downVotes = norm.downVotes + (isDown ? 1 : 0);
    const netVotes = upVotes - downVotes;
    const demoted = downVotes > upVotes;

    return {
      ...record,
      upVotes,
      downVotes,
      netVotes,
      demoted,
    };
  }, options);
}

/**
 * Edit or relax a stored lesson through Rule change preview.
 * Tightening applies at once; relaxing a lesson that turns recorded blocked calls
 * into allowed calls is held until a human approves it.
 */
function editLesson(lessonId, patch = {}, options = {}) {
  const { applyRuleChange, getAuditLogPath } = require('./audit-trail');
  const paths = getFeedbackPaths(options);
  const existing = fs.existsSync(paths.MEMORY_LOG_PATH)
    ? readJSONL(paths.MEMORY_LOG_PATH, { maxLines: 2000 })
    : [];
  let found = false;
  const nextLessons = existing.map((rec) => {
    if (rec && (rec.id === lessonId || rec.canonicalHash === lessonId || rec.title === lessonId)) {
      found = true;
      return { ...rec, ...patch };
    }
    return rec;
  });
  if (!found) {
    nextLessons.push({
      id: lessonId,
      title: patch.title || lessonId,
      content: patch.content || lessonId,
      signal: patch.signal || 'negative',
      timestamp: new Date().toISOString(),
      ...patch,
    });
  }
  return applyRuleChange({
    changeType: found ? (patch.demoted ? 'relax' : 'edit') : 'add',
    ruleId: lessonId,
    oldLessons: existing,
    newLessons: nextLessons,
    targetMemoryLogPath: paths.MEMORY_LOG_PATH,
    auditEntries: options.auditEntries,
    auditLogPath: options.auditLogPath || getAuditLogPath(),
    feedbackDir: paths.FEEDBACK_DIR,
  });
}

/**
 * Delete a stored lesson through Rule change preview.
 * Held for human approval if any recorded blocked call would become allowed.
 */
function deleteLesson(lessonId, options = {}) {
  const { applyRuleChange, getAuditLogPath } = require('./audit-trail');
  const paths = getFeedbackPaths(options);
  const existing = fs.existsSync(paths.MEMORY_LOG_PATH)
    ? readJSONL(paths.MEMORY_LOG_PATH, { maxLines: 2000 })
    : [];
  const nextLessons = existing.filter(
    (rec) => rec && rec.id !== lessonId && rec.canonicalHash !== lessonId && rec.title !== lessonId,
  );
  return applyRuleChange({
    changeType: 'delete',
    ruleId: lessonId,
    oldLessons: existing,
    newLessons: nextLessons,
    targetMemoryLogPath: paths.MEMORY_LOG_PATH,
    auditEntries: options.auditEntries,
    auditLogPath: options.auditLogPath || getAuditLogPath(),
    feedbackDir: paths.FEEDBACK_DIR,
  });
}

function matchesErrorMemory(norm, cleanQuery) {
  const errPattern = (norm.errorPattern || '').toLowerCase();
  if (errPattern && cleanQuery.includes(errPattern)) return true;
  if (cleanQuery.length < 8) return false;
  const content = (norm.content || '').toLowerCase();
  const title = (norm.title || '').toLowerCase();
  return content.includes(cleanQuery) || title.includes(cleanQuery);
}

function findMemoryErrorMatch(cleanQuery, options = {}) {
  const paths = getFeedbackPaths(options);
  if (!fs.existsSync(paths.MEMORY_LOG_PATH)) return null;
  const rawMemories = readJSONL(paths.MEMORY_LOG_PATH, { maxLines: 500 });
  for (const mem of rawMemories) {
    const norm = normalizeVerificationFields(mem);
    if (matchesErrorMemory(norm, cleanQuery)) {
      return {
        ...norm,
        stale: isLessonStale(norm, options.now),
        badge: formatVerificationBadge(norm),
      };
    }
  }
  return null;
}

/**
 * Exact error text lookup across seeded catalog + memory-log.jsonl
 */
function lookupLessonByError(errorText, options = {}) {
  if (!errorText || typeof errorText !== 'string') return null;
  const cleanQuery = errorText.trim().toLowerCase();
  if (!cleanQuery) return null;

  for (const seed of SEEDED_LESSONS) {
    const pattern = (seed.errorPattern || '').toLowerCase();
    if (pattern && (cleanQuery.includes(pattern) || pattern.includes(cleanQuery))) {
      const norm = normalizeVerificationFields(seed);
      return {
        ...norm,
        isSeeded: true,
        stale: isLessonStale(norm, options.now),
        badge: formatVerificationBadge(norm),
      };
    }
  }

  return findMemoryErrorMatch(cleanQuery, options);
}

module.exports = {
  SEEDED_LESSONS,
  normalizeVerificationFields,
  formatVerificationBadge,
  isLessonStale,
  isLessonDemoted,
  updateMemoryRecord,
  verifyLesson,
  voteOnLesson,
  voteLesson: voteOnLesson,
  editLesson,
  deleteLesson,
  lookupLessonByError,
  DEFAULT_E2E_BASE_URL_LESSON: SEEDED_LESSONS[0],
};
