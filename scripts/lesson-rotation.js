'use strict';

const STALE_THRESHOLD_DAYS = 60;
const ARCHIVE_THRESHOLD_DAYS = 90;

/**
 * Add last_triggered and archived columns if they don't exist.
 * Safe to call multiple times — uses IF NOT EXISTS logic via pragma.
 */
function migrateSchema(db) {
  const columns = db.pragma('table_info(lessons)').map((c) => c.name);
  if (!columns.includes('last_triggered')) {
    db.exec('ALTER TABLE lessons ADD COLUMN last_triggered TEXT');
  }
  if (!columns.includes('archived')) {
    db.exec('ALTER TABLE lessons ADD COLUMN archived INTEGER DEFAULT 0');
  }
  if (!columns.includes('trigger_count')) {
    db.exec('ALTER TABLE lessons ADD COLUMN trigger_count INTEGER DEFAULT 0');
  }
}

/**
 * Record that a lesson was triggered (matched a gate or retrieved for context).
 */
function recordTrigger(db, lessonId) {
  migrateSchema(db);
  db.prepare(
    'UPDATE lessons SET last_triggered = ?, trigger_count = COALESCE(trigger_count, 0) + 1 WHERE id = ?'
  ).run(new Date().toISOString(), lessonId);
}

/**
 * Score lesson staleness: 0 = fresh, 1 = completely stale.
 */
function stalenessScore(lesson) {
  const ref = lesson.last_triggered || lesson.timestamp;
  if (!ref) return 1;
  const ageDays = (Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24);
  return Math.min(1, ageDays / ARCHIVE_THRESHOLD_DAYS);
}

/**
 * Get all stale lessons (not triggered in STALE_THRESHOLD_DAYS).
 */
function findStaleLessons(db) {
  migrateSchema(db);
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_DAYS * 86400000).toISOString();
  return db.prepare(
    `SELECT * FROM lessons
     WHERE archived = 0 AND pruned = 0
     AND (last_triggered IS NULL OR last_triggered < ?)
     AND timestamp < ?
     ORDER BY COALESCE(last_triggered, timestamp) ASC`
  ).all(cutoff, cutoff);
}

/**
 * Auto-archive lessons that haven't been triggered in ARCHIVE_THRESHOLD_DAYS.
 * Returns { archived: number, reviewed: number }
 */
function autoArchive(db) {
  migrateSchema(db);
  const cutoff = new Date(Date.now() - ARCHIVE_THRESHOLD_DAYS * 86400000).toISOString();
  const result = db.prepare(
    `UPDATE lessons SET archived = 1
     WHERE archived = 0 AND pruned = 0
     AND (last_triggered IS NULL OR last_triggered < ?)
     AND timestamp < ?`
  ).run(cutoff, cutoff);
  return { archived: result.changes };
}

/**
 * Restore a lesson from archive.
 */
function restoreLesson(db, lessonId) {
  migrateSchema(db);
  db.prepare('UPDATE lessons SET archived = 0 WHERE id = ?').run(lessonId);
}

/**
 * Get archived lessons for review.
 */
function getArchivedLessons(db) {
  migrateSchema(db);
  return db.prepare(
    'SELECT * FROM lessons WHERE archived = 1 ORDER BY timestamp DESC'
  ).all();
}

/**
 * Generate a staleness report for the monthly review digest.
 * Returns { stale: [...], archivable: [...], healthy: number }
 */
function stalenessReport(db) {
  migrateSchema(db);
  const staleThresholdDate = new Date(Date.now() - STALE_THRESHOLD_DAYS * 86400000).toISOString();
  const archiveThresholdDate = new Date(Date.now() - ARCHIVE_THRESHOLD_DAYS * 86400000).toISOString();

  const total = db.prepare('SELECT COUNT(*) as count FROM lessons WHERE archived = 0 AND pruned = 0').get().count;
  const stale = findStaleLessons(db);
  const archivable = stale.filter((l) => {
    const ref = l.last_triggered || l.timestamp;
    return ref && ref < archiveThresholdDate;
  });

  return {
    total,
    healthy: total - stale.length,
    stale: stale.map((l) => ({
      id: l.id,
      context: (l.context || '').slice(0, 80),
      importance: l.importance,
      daysSinceActive: Math.round((Date.now() - new Date(l.last_triggered || l.timestamp).getTime()) / 86400000),
      triggerCount: l.trigger_count || 0,
    })),
    archivable: archivable.map((l) => ({
      id: l.id,
      context: (l.context || '').slice(0, 80),
      importance: l.importance,
    })),
  };
}

module.exports = {
  migrateSchema,
  recordTrigger,
  stalenessScore,
  findStaleLessons,
  autoArchive,
  restoreLesson,
  getArchivedLessons,
  stalenessReport,
  STALE_THRESHOLD_DAYS,
  ARCHIVE_THRESHOLD_DAYS,
};
