'use strict';

// AGENT-3667, 24 Nov 2026 (faults brief, item D): did a lesson help? For each injection (lesson-injections.jsonl,
// written by prompt-lessons.js) check whether the same mistake class came back: a later thumbs-down from the person
// that shares a specific tag with the injected lesson. Reported as repeat misses per 100 injections.
//
// Assumptions, stated so the number is read correctly:
//  - "same mistake class" means a shared tag that is not one of the generic capture tags below;
//  - a later thumbs-down counts once per injection, however many tags it shares;
//  - an injection with no specific tag cannot be matched, so it counts in the denominator and never as a repeat.
const fs = require('node:fs');
const path = require('node:path');

const INJECTION_LOG = 'lesson-injections.jsonl';
const GENERIC_TAGS = new Set([
  'thumbs-down', 'thumbs-up', 'user-prompt-thumbs', 'feedback', 'negative', 'positive', 'human', 'user', 'agent',
  'claude-history-sync', 'auto-captured', 'mistake', 'lesson', 'general',
]);

function specificTags(tags) {
  return (Array.isArray(tags) ? tags : []).map((tag) => String(tag).toLowerCase()).filter((tag) => tag && !GENERIC_TAGS.has(tag));
}

function readInjections(dirs) {
  const rows = [];
  for (const dir of new Set((dirs || []).map((d) => path.resolve(d)))) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, INJECTION_LOG), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const at = Date.parse(row.injectedAt || '');
        if (Number.isFinite(at)) rows.push({ at, sessionId: row.sessionId || '', lessonId: row.lessonId || '', tags: specificTags(row.tags) });
      } catch { /* a torn line is skipped */ }
    }
  }
  return rows;
}

// downs: [{ at: ms, tags: [...] }] — the person's thumbs-down rows for this project.
function computeLessonEffect(injections, downs) {
  const total = injections.length;
  let repeats = 0;
  for (const injection of injections) {
    if (injection.tags.length === 0) continue;
    const recurred = downs.some((down) => down.at > injection.at && specificTags(down.tags).some((tag) => injection.tags.includes(tag)));
    if (recurred) repeats += 1;
  }
  return {
    injections: total,
    repeatMisses: repeats,
    repeatMissesPer100: total === 0 ? null : Math.round((repeats / total) * 1000) / 10,
  };
}

module.exports = { INJECTION_LOG, GENERIC_TAGS, specificTags, readInjections, computeLessonEffect };
