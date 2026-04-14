#!/usr/bin/env node
'use strict';

/**
 * Session Analyzer — reads Claude Code JSONL transcripts and extracts
 * actionable intelligence: token usage, waste (duplicate reads), confusion
 * signals, and auto-generated lessons for ThumbGate enforcement.
 *
 * Gives ThumbGate parity with Leo Godin's session analyzer plus enforcement
 * integration via lesson-inference.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ---------------------------------------------------------------------------
// 1. JSONL Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Claude Code session JSONL file into an array of event objects.
 * Malformed lines are silently skipped.
 * @param {string} sessionPath - absolute path to the .jsonl file
 * @returns {Array<Object>}
 */
function parseSessionJSONL(sessionPath) {
  const raw = fs.readFileSync(sessionPath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// 2. Token Usage Tracking
// ---------------------------------------------------------------------------

/**
 * Extract per-turn and cumulative token usage from assistant messages.
 * @param {Array<Object>} events
 * @returns {{ turns: Array, totals: Object }}
 */
function analyzeTokenUsage(events) {
  const turns = [];
  let cumulativeInput = 0;
  let cumulativeOutput = 0;
  let cumulativeCacheRead = 0;
  let cumulativeCacheCreation = 0;

  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const usage = event.message?.usage;
    if (!usage) continue;

    const input = usage.input_tokens || 0;
    const output = usage.output_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheCreation = usage.cache_creation_input_tokens || 0;

    cumulativeInput += input;
    cumulativeOutput += output;
    cumulativeCacheRead += cacheRead;
    cumulativeCacheCreation += cacheCreation;

    turns.push({
      timestamp: event.timestamp || null,
      input,
      output,
      cacheRead,
      cacheCreation,
      cumulativeInput,
      cumulativeOutput,
    });
  }

  return {
    turns,
    totals: {
      input: cumulativeInput,
      output: cumulativeOutput,
      cacheRead: cumulativeCacheRead,
      cacheCreation: cumulativeCacheCreation,
      total: cumulativeInput + cumulativeOutput,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Waste Detection — Duplicate File Reads
// ---------------------------------------------------------------------------

/**
 * Find files read more than once in the session.
 * @param {Array<Object>} events
 * @returns {{ duplicateReads: Object<string, number>, wasteScore: number }}
 */
function detectDuplicateReads(events) {
  const readCounts = {};

  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === 'tool_use' && block.name === 'Read' && block.input?.file_path) {
        const fp = block.input.file_path;
        readCounts[fp] = (readCounts[fp] || 0) + 1;
      }
    }
  }

  const duplicateReads = {};
  for (const [fp, count] of Object.entries(readCounts)) {
    if (count >= 2) {
      duplicateReads[fp] = count;
    }
  }

  const totalReads = Object.values(readCounts).reduce((a, b) => a + b, 0);
  const wastedReads = Object.values(duplicateReads).reduce((a, b) => a + b - 1, 0);
  const wasteScore = totalReads > 0 ? Math.round((wastedReads / totalReads) * 100) : 0;

  return { duplicateReads, wasteScore, totalReads, wastedReads };
}

// ---------------------------------------------------------------------------
// 4. Confusion Signal Detection
// ---------------------------------------------------------------------------

const CONFUSION_KEYWORDS = {
  backtracking: ['actually', 'wait', 'wrong', 'mistake', 'let me reconsider', 'should have'],
  rework: ['revert', 'undo', 'let me try', "didn't work", 'failed'],
  workarounds: ['circular', 'workaround', 'hack'],
  scopeCreep: ['refactor', 'restructur', 'redesign'],
};

/**
 * Detect confusion signals in assistant message text.
 * @param {Array<Object>} events
 * @returns {Array<{ category: string, keyword: string, context: string, timestamp: string|null }>}
 */
function detectConfusionSignals(events) {
  const signals = [];

  for (const event of events) {
    for (const block of assistantTextBlocks(event)) {
      signals.push(...detectConfusionInText(block.text, event.timestamp || null));
    }
  }

  return signals;
}

function assistantTextBlocks(event) {
  if (event.type !== 'assistant') return [];
  const content = event.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block.type === 'text' && block.text);
}

function detectConfusionInText(text, timestamp) {
  const signals = [];
  const lower = text.toLowerCase();

  for (const [category, keywords] of Object.entries(CONFUSION_KEYWORDS)) {
    for (const keyword of keywords) {
      for (const idx of keywordIndexes(lower, keyword)) {
        signals.push({
          category,
          keyword,
          context: confusionContext(text, idx, keyword),
          timestamp,
        });
      }
    }
  }

  return signals;
}

function keywordIndexes(text, keyword) {
  const indexes = [];
  let idx = 0;
  while ((idx = text.indexOf(keyword, idx)) !== -1) {
    indexes.push(idx);
    idx += keyword.length;
  }
  return indexes;
}

function confusionContext(text, idx, keyword) {
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + keyword.length + 40);
  return text.slice(start, end).replaceAll('\n', ' ').trim();
}

// ---------------------------------------------------------------------------
// 5. Session Summary
// ---------------------------------------------------------------------------

/**
 * Tool call counts and files touched.
 * @param {Array<Object>} events
 * @returns {{ toolCounts: Object, filesTouched: Set<string> }}
 */
function extractToolUsage(events) {
  const toolCounts = {};
  const filesTouched = new Set();

  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type !== 'tool_use') continue;
      toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;

      if (['Read', 'Write', 'Edit'].includes(block.name) && block.input?.file_path) {
        filesTouched.add(block.input.file_path);
      }
    }
  }

  return { toolCounts, filesTouched: Array.from(filesTouched) };
}

/**
 * Full session summary.
 * @param {string} sessionPath
 * @returns {Object}
 */
function sessionSummary(sessionPath) {
  const events = parseSessionJSONL(sessionPath);
  const tokens = analyzeTokenUsage(events);
  const waste = detectDuplicateReads(events);
  const confusion = detectConfusionSignals(events);
  const { toolCounts, filesTouched } = extractToolUsage(events);

  // Duration
  const timestamps = events
    .map((e) => e.timestamp)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((t) => Number.isFinite(t));

  let durationMs = 0;
  let startTime = null;
  let endTime = null;
  if (timestamps.length >= 2) {
    startTime = new Date(Math.min(...timestamps)).toISOString();
    endTime = new Date(Math.max(...timestamps)).toISOString();
    durationMs = Math.max(...timestamps) - Math.min(...timestamps);
  }

  return {
    sessionPath,
    eventCount: events.length,
    duration: {
      ms: durationMs,
      human: formatDuration(durationMs),
      startTime,
      endTime,
    },
    tokens: tokens.totals,
    tokenTurns: tokens.turns.length,
    toolCounts,
    filesTouched,
    confusionSignals: confusion.length,
    confusionDetails: confusion,
    waste: {
      duplicateReads: waste.duplicateReads,
      wasteScore: waste.wasteScore,
      totalReads: waste.totalReads,
      wastedReads: waste.wastedReads,
    },
  };
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// 6. Integration with ThumbGate Lessons
// ---------------------------------------------------------------------------

/**
 * Analyze a session and create ThumbGate lessons from confusion signals.
 * @param {string} sessionPath
 * @returns {{ summary: Object, lessonsCreated: Array }}
 */
function analyzeAndCreateLessons(sessionPath) {
  const summary = sessionSummary(sessionPath);
  const lessonsCreated = [];

  // Group confusion signals by keyword
  const keywordCounts = {};
  for (const signal of summary.confusionDetails) {
    const key = `${signal.category}:${signal.keyword}`;
    if (!keywordCounts[key]) {
      keywordCounts[key] = { category: signal.category, keyword: signal.keyword, count: 0, contexts: [] };
    }
    keywordCounts[key].count += 1;
    if (keywordCounts[key].contexts.length < 3) {
      keywordCounts[key].contexts.push(signal.context);
    }
  }

  // Create lessons for signals that appear 2+ times
  const { createLesson } = require('./lesson-inference');

  for (const [, info] of Object.entries(keywordCounts)) {
    if (info.count < 2) continue;

    const lessonText = `AVOID: ${info.category} pattern detected — "${info.keyword}" appeared ${info.count} times. Example: "${info.contexts[0]}"`;

    const lesson = createLesson({
      signal: 'negative',
      inferredLesson: lessonText,
      triggerMessage: `Session analysis: confusion signal "${info.keyword}" (${info.category})`,
      priorSummary: `Auto-detected from session transcript at ${sessionPath}`,
      confidence: Math.min(90, 50 + info.count * 10),
      tags: ['session-analysis', info.category, 'auto-learned'],
      metadata: {
        source: 'session-analyzer',
        keyword: info.keyword,
        occurrences: info.count,
        sessionPath,
      },
    });

    lessonsCreated.push(lesson);
  }

  // Create lesson for high waste score
  if (summary.waste.wasteScore > 20 && Object.keys(summary.waste.duplicateReads).length > 0) {
    const topDuplicates = Object.entries(summary.waste.duplicateReads)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([fp, count]) => `${path.basename(fp)} (${count}x)`)
      .join(', ');

    const lesson = createLesson({
      signal: 'negative',
      inferredLesson: `AVOID: duplicate file reads detected (waste score ${summary.waste.wasteScore}%). Top offenders: ${topDuplicates}`,
      triggerMessage: 'Session analysis: duplicate Read tool calls',
      priorSummary: `Auto-detected from session transcript at ${sessionPath}`,
      confidence: Math.min(85, 40 + summary.waste.wasteScore),
      tags: ['session-analysis', 'waste', 'duplicate-reads', 'auto-learned'],
      metadata: {
        source: 'session-analyzer',
        wasteScore: summary.waste.wasteScore,
        duplicateReads: summary.waste.duplicateReads,
        sessionPath,
      },
    });

    lessonsCreated.push(lesson);
  }

  return { summary, lessonsCreated };
}

// ---------------------------------------------------------------------------
// 7. Session Discovery
// ---------------------------------------------------------------------------

/**
 * List recent Claude Code sessions from ~/.claude/projects/.
 * @param {Object} opts
 * @param {number} opts.recent - number of recent sessions to return (default 10)
 * @returns {Array<{ path: string, project: string, sessionId: string, modified: Date, size: number }>}
 */
function listSessions({ recent = 10 } = {}) {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return [];

  const sessions = [];

  try {
    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const pd of projectDirs) {
      if (!pd.isDirectory()) continue;
      const projectPath = path.join(projectsDir, pd.name);
      try {
        const files = fs.readdirSync(projectPath);
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;
          const fullPath = path.join(projectPath, file);
          try {
            const stat = fs.statSync(fullPath);
            sessions.push({
              path: fullPath,
              project: pd.name,
              sessionId: file.replace('.jsonl', ''),
              modified: stat.mtime,
              size: stat.size,
            });
          } catch {
            // skip inaccessible files
          }
        }
      } catch {
        // skip inaccessible directories
      }
    }
  } catch {
    // projects dir not readable
  }

  sessions.sort((a, b) => b.modified - a.modified);
  return sessions.slice(0, recent);
}

// ---------------------------------------------------------------------------
// 8. CLI
// ---------------------------------------------------------------------------

function runCLI() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(`Usage:
  node scripts/session-analyzer.js summary <session-path>
  node scripts/session-analyzer.js tokens <session-path>
  node scripts/session-analyzer.js waste <session-path>
  node scripts/session-analyzer.js confusion <session-path>
  node scripts/session-analyzer.js auto-learn <session-path>
  node scripts/session-analyzer.js list [--recent N]`);
    process.exit(1);
  }

  switch (command) {
    case 'summary': {
      const sp = args[1];
      if (!sp) { console.error('Error: session path required'); process.exit(1); }
      console.log(JSON.stringify(sessionSummary(sp), null, 2));
      break;
    }
    case 'tokens': {
      const sp = args[1];
      if (!sp) { console.error('Error: session path required'); process.exit(1); }
      const events = parseSessionJSONL(sp);
      const tokens = analyzeTokenUsage(events);
      console.log(JSON.stringify(tokens, null, 2));
      break;
    }
    case 'waste': {
      const sp = args[1];
      if (!sp) { console.error('Error: session path required'); process.exit(1); }
      const events = parseSessionJSONL(sp);
      const waste = detectDuplicateReads(events);
      console.log(JSON.stringify(waste, null, 2));
      break;
    }
    case 'confusion': {
      const sp = args[1];
      if (!sp) { console.error('Error: session path required'); process.exit(1); }
      const events = parseSessionJSONL(sp);
      const confusion = detectConfusionSignals(events);
      console.log(JSON.stringify(confusion, null, 2));
      break;
    }
    case 'auto-learn': {
      const sp = args[1];
      if (!sp) { console.error('Error: session path required'); process.exit(1); }
      const result = analyzeAndCreateLessons(sp);
      console.log(JSON.stringify({
        confusionSignals: result.summary.confusionSignals,
        wasteScore: result.summary.waste.wasteScore,
        lessonsCreated: result.lessonsCreated.length,
        lessons: result.lessonsCreated.map((l) => ({ id: l.id, lesson: l.lesson })),
      }, null, 2));
      break;
    }
    case 'list': {
      let recent = 10;
      const recentIdx = args.indexOf('--recent');
      if (recentIdx !== -1 && args[recentIdx + 1]) {
        recent = Number.parseInt(args[recentIdx + 1], 10) || 10;
      }
      const sessions = listSessions({ recent });
      console.log(JSON.stringify(sessions, null, 2));
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

function isCliEntryPoint() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  parseSessionJSONL,
  analyzeTokenUsage,
  detectDuplicateReads,
  detectConfusionSignals,
  extractToolUsage,
  sessionSummary,
  analyzeAndCreateLessons,
  listSessions,
  formatDuration,
  runCLI,
  isCliEntryPoint,
  CONFUSION_KEYWORDS,
};

if (isCliEntryPoint()) {
  runCLI();
}
