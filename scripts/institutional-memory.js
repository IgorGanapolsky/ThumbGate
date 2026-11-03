'use strict';

/**
 * Institutional Memory Layer — AI Operating System steal adaptation.
 *
 * Force-captures operational lessons, recalls them before tasks,
 * and refines via upvote/downvote feedback loop.
 *
 * Stolen from: "How to Build an AI Operating System" (FSX5FJS9PQ)
 */

const fs = require('node:fs');
const path = require('node:path');

const MEMORY_DIR = path.join(__dirname, '..', '.claude', 'memory', 'feedback');
const UPVOTES_FILE = path.join(MEMORY_DIR, 'lesson-votes.json');

function ensureMemoryDir() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function submitLesson(lesson) {
  ensureMemoryDir();
  const timestamp = new Date().toISOString();
  const lessonWithMeta = {
    ...lesson,
    id: lesson.id || `lesson_${Date.now().toString(36)}`,
    submittedAt: timestamp,
    votes: { up: 0, down: 0 },
    confidence: 0.5, // starts neutral, grows with votes
    status: 'active',
  };

  const filePath = path.join(MEMORY_DIR, `lesson_${lessonWithMeta.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(lessonWithMeta, null, 2));
  console.log(`Lesson captured: ${lessonWithMeta.id}`);
  return lessonWithMeta;
}

function voteOnLesson(lessonId, voteType) {
  ensureMemoryDir();
  const filePath = path.join(MEMORY_DIR, `lesson_${lessonId}.json`);
  if (!fs.existsSync(filePath)) {
    console.error(`Lesson not found: ${lessonId}`);
    return null;
  }

  const lesson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  lesson.votes[voteType] = (lesson.votes[voteType] || 0) + 1;
  const total = lesson.votes.up + lesson.votes.down;
  lesson.confidence = total > 0 ? lesson.votes.up / total : 0.5;

  fs.writeFileSync(filePath, JSON.stringify(lesson, null, 2));
  console.log(`Vote "${voteType}" recorded for ${lessonId}. Confidence: ${(lesson.confidence * 100).toFixed(1)}%`);
  return lesson;
}

function recallLessons(query, scope = null) {
  ensureMemoryDir();
  const files = fs.readdirSync(MEMORY_DIR).filter((f) => f.startsWith('lesson_') && f.endsWith('.json'));

  const matches = [];
  for (const file of files) {
    const lesson = JSON.parse(fs.readFileSync(path.join(MEMORY_DIR, file), 'utf-8'));
    const content = JSON.stringify(lesson).toLowerCase();

    let score = 0;
    for (const term of query.toLowerCase().split(/\s+/)) {
      if (content.includes(term)) score += 1;
    }

    if (score > 0 && (!scope || lesson.scope === scope)) {
      matches.push({ ...lesson, matchScore: score });
    }
  }

  return matches.sort((a, b) => b.matchScore - a.matchScore || b.confidence - a.confidence);
}

function shouldProceed(task, lessons) {
  const blockLessons = lessons.filter((l) => l.severity === 'BLOCK');
  const warnLessons = lessons.filter((l) => l.severity === 'WARN');

  return {
    proceed: blockLessons.length === 0,
    blockReasons: blockLessons.map((l) => l.resolution || 'Historical lesson: ' + l.context),
    warnings: warnLessons.map((l) => l.resolution || l.context),
  };
}

module.exports = { submitLesson, voteOnLesson, recallLessons, shouldProceed, MEMORY_DIR };
