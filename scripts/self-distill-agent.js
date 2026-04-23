#!/usr/bin/env node
'use strict';

/**
 * Self-Distillation Agent — Automatic Self-Improvement for AI Coding Agents
 *
 * Reads recent agent conversation history, evaluates action outcomes,
 * and auto-generates lessons using the if-then-v1 format — no human
 * thumbs-down required.
 *
 * Heuristic signals (always available):
 *   - Tool call errors (Error:, FAIL, not ok, exit code != 0)
 *   - Reverted edits (same file edited then edited back, user says "undo"/"revert")
 *   - Correction patterns (user: "no", "wrong", "that's not", "don't", "stop", "undo")
 *   - Test failures ("test failed", "FAIL", "not ok")
 *   - Success patterns (pass, All tests passed, user: "good", "perfect", "yes")
 *
 * LLM-powered analysis (when ANTHROPIC_API_KEY is set):
 *   Sends conversation windows to Claude for structured lesson extraction.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');
const { createLesson, inferStructuredLesson } = require('./lesson-inference');
const { buildStableId } = require('./conversation-context');
const { ensureParentDir, readJsonl } = require('./fs-utils');

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir() || '';
const SELF_DISTILL_RUNS_PATH = path.join(HOME, '.thumbgate', 'self-distill-runs.jsonl');

// ---------------------------------------------------------------------------
// 1. Conversation Log Discovery
// ---------------------------------------------------------------------------

function discoverConversationLogs({ limit = 20 } = {}) {
  const logs = [];

  // Primary: ~/.claude/projects/*/conversation-log.jsonl
  const claudeProjectsDir = path.join(HOME, '.claude', 'projects');
  if (fs.existsSync(claudeProjectsDir)) {
    try {
      const projects = fs.readdirSync(claudeProjectsDir).filter((name) => {
        const stat = fs.statSync(path.join(claudeProjectsDir, name));
        return stat.isDirectory();
      });
      for (const project of projects) {
        const logPath = path.join(claudeProjectsDir, project, 'conversation-log.jsonl');
        if (fs.existsSync(logPath)) {
          logs.push(logPath);
        }
      }
    } catch { /* permission or read errors — skip */ }
  }

  // Fallback: feedback dir's conversation-window.jsonl
  try {
    const feedbackDir = resolveFeedbackDir();
    const fallback = path.join(feedbackDir, 'conversation-window.jsonl');
    if (fs.existsSync(fallback)) {
      logs.push(fallback);
    }
  } catch { /* resolve errors — skip */ }

  return logs.slice(0, limit);
}

// ---------------------------------------------------------------------------
// 2. Heuristic Signal Detection
// ---------------------------------------------------------------------------

const ERROR_PATTERNS = [
  /\bError:/i,
  /\bFAIL\b/,
  /\bnot ok\b/,
  /exit code\s*(?:!=\s*0|[1-9]\d*)/i,
  /\bERROR\b/,
  /\bTypeError\b/,
  /\bReferenceError\b/,
  /\bSyntaxError\b/,
  /\bcommand failed\b/i,
  /\bexited with\s+[1-9]/i,
];

const TEST_FAILURE_PATTERNS = [
  /\btest failed\b/i,
  /\bFAIL\b/,
  /\bnot ok\b/,
  /\btests?\s+failed\b/i,
  /\bfailing\s+tests?\b/i,
];

const SUCCESS_PATTERNS = [
  /\u2705/,
  /\bpass(?:ed|ing)?\b/i,
  /\bAll tests passed\b/i,
  /\bok\s+\d/,
  /\bsuccess(?:ful(?:ly)?)?\b/i,
];

const CORRECTION_PATTERNS = [
  /\bno[,.]?\s/i,
  /\bwrong\b/i,
  /\bthat'?s?\s+not\b/i,
  /\bdon'?t\b/i,
  /\bstop\b/i,
  /\bundo\b/i,
  /\brevert\b/i,
  /\bactually\b/i,
  /\bwait\b/i,
];

const USER_SUCCESS_PATTERNS = [
  /\bgood\b/i,
  /\bperfect\b/i,
  /\byes\b/i,
  /\bthanks?\b/i,
  /\bgreat\b/i,
  /\bworks?\b/i,
  /\blooks? good\b/i,
  /\bnice\b/i,
  /\u2705/,
];

function detectOutcomeSignals(conversationWindow) {
  const window = Array.isArray(conversationWindow) ? conversationWindow : [];

  const signals = {
    errors: [],
    testFailures: [],
    successes: [],
    corrections: [],
    revertedEdits: [],
    userSuccessSignals: [],
  };

  const editedFiles = [];

  for (const msg of window) {
    if (!msg || typeof msg !== 'object') continue;
    const role = String(msg.role || '').toLowerCase();
    const content = String(msg.content || '');
    if (!content) continue;

    // Errors in assistant messages or tool output
    if (role === 'assistant' || role === 'tool') {
      for (const pattern of ERROR_PATTERNS) {
        if (pattern.test(content)) {
          const match = content.match(pattern);
          const lineIdx = content.indexOf(match[0]);
          const lineStart = content.lastIndexOf('\n', lineIdx) + 1;
          const lineEnd = content.indexOf('\n', lineIdx);
          signals.errors.push({
            pattern: pattern.source,
            excerpt: content.slice(lineStart, lineEnd === -1 ? lineStart + 200 : lineEnd).trim().slice(0, 200),
          });
          break; // one error per message
        }
      }

      for (const pattern of TEST_FAILURE_PATTERNS) {
        if (pattern.test(content)) {
          signals.testFailures.push({
            pattern: pattern.source,
            excerpt: content.slice(0, 200).trim(),
          });
          break;
        }
      }

      for (const pattern of SUCCESS_PATTERNS) {
        if (pattern.test(content)) {
          signals.successes.push({
            pattern: pattern.source,
            excerpt: content.slice(0, 200).trim(),
          });
          break;
        }
      }

      // Track file edits for revert detection
      const editMatch = content.match(/(?:edited|modified|wrote|created)\s+([^\s,]+\.\w+)/i);
      if (editMatch) {
        editedFiles.push({ file: editMatch[1], msgIndex: window.indexOf(msg), role });
      }
    }

    // Correction/success patterns in user messages
    if (role === 'user') {
      for (const pattern of CORRECTION_PATTERNS) {
        if (pattern.test(content)) {
          signals.corrections.push({
            pattern: pattern.source,
            excerpt: content.slice(0, 200).trim(),
          });
          break;
        }
      }

      for (const pattern of USER_SUCCESS_PATTERNS) {
        if (pattern.test(content)) {
          signals.userSuccessSignals.push({
            pattern: pattern.source,
            excerpt: content.slice(0, 200).trim(),
          });
          break;
        }
      }

      // Revert detection: user says "undo"/"revert"
      if (/\b(undo|revert)\b/i.test(content)) {
        signals.revertedEdits.push({
          trigger: 'user_request',
          excerpt: content.slice(0, 200).trim(),
        });
      }
    }
  }

  // Detect reverted edits: same file edited more than once
  const fileCounts = {};
  for (const edit of editedFiles) {
    fileCounts[edit.file] = (fileCounts[edit.file] || 0) + 1;
  }
  for (const [file, count] of Object.entries(fileCounts)) {
    if (count >= 2) {
      signals.revertedEdits.push({
        trigger: 'repeated_edit',
        file,
        editCount: count,
      });
    }
  }

  return signals;
}

function classifyOutcome(signals) {
  const negativeCount = signals.errors.length + signals.testFailures.length
    + signals.corrections.length + signals.revertedEdits.length;
  const positiveCount = signals.successes.length + signals.userSuccessSignals.length;

  if (negativeCount > positiveCount) return 'negative';
  if (positiveCount > 0 && negativeCount === 0) return 'positive';
  if (positiveCount > negativeCount) return 'positive';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// 3. Heuristic Lesson Generation
// ---------------------------------------------------------------------------

function generateHeuristicLessons(conversationWindow, signals) {
  const lessons = [];
  const outcome = classifyOutcome(signals);

  if (outcome === 'neutral') return lessons;

  // Generate lessons from errors
  for (const error of signals.errors.slice(0, 3)) {
    lessons.push({
      signal: 'negative',
      trigger: { condition: `Tool call produced error: ${error.excerpt.slice(0, 120)}`, type: 'error-report' },
      action: { type: 'avoid', description: `Avoid actions that produce: ${error.excerpt.slice(0, 200)}` },
      confidence: 0.6,
      evidence: error.excerpt,
    });
  }

  // Generate lessons from test failures
  for (const failure of signals.testFailures.slice(0, 2)) {
    lessons.push({
      signal: 'negative',
      trigger: { condition: `Test failure detected: ${failure.excerpt.slice(0, 120)}`, type: 'error-report' },
      action: { type: 'avoid', description: `Changes caused test failures. Verify tests pass before proceeding.` },
      confidence: 0.7,
      evidence: failure.excerpt,
    });
  }

  // Generate lessons from corrections
  for (const correction of signals.corrections.slice(0, 2)) {
    lessons.push({
      signal: 'negative',
      trigger: { condition: `User correction: ${correction.excerpt.slice(0, 120)}`, type: 'constraint' },
      action: { type: 'avoid', description: `User indicated the approach was wrong: ${correction.excerpt.slice(0, 200)}` },
      confidence: 0.5,
      evidence: correction.excerpt,
    });
  }

  // Generate lessons from reverted edits
  for (const revert of signals.revertedEdits.slice(0, 2)) {
    const desc = revert.file
      ? `Edit to ${revert.file} was reverted (edited ${revert.editCount} times)`
      : `User requested undo/revert: ${(revert.excerpt || '').slice(0, 120)}`;
    lessons.push({
      signal: 'negative',
      trigger: { condition: desc, type: 'error-report' },
      action: { type: 'avoid', description: `Approach was reverted. Confirm intent before making changes.` },
      confidence: 0.6,
      evidence: revert.excerpt || revert.file || '',
    });
  }

  // Generate lessons from successes
  if (outcome === 'positive' && signals.successes.length > 0) {
    const success = signals.successes[0];
    lessons.push({
      signal: 'positive',
      trigger: { condition: `Successful action: ${success.excerpt.slice(0, 120)}`, type: 'general' },
      action: { type: 'do', description: `Repeat this approach: ${success.excerpt.slice(0, 200)}` },
      confidence: 0.5,
      evidence: success.excerpt,
    });
  }

  if (outcome === 'positive' && signals.userSuccessSignals.length > 0) {
    const userSignal = signals.userSuccessSignals[0];
    lessons.push({
      signal: 'positive',
      trigger: { condition: `User approved action: ${userSignal.excerpt.slice(0, 120)}`, type: 'general' },
      action: { type: 'do', description: `This approach was approved by the user.` },
      confidence: 0.5,
      evidence: userSignal.excerpt,
    });
  }

  return lessons;
}

// ---------------------------------------------------------------------------
// 4. LLM-Powered Analysis
// ---------------------------------------------------------------------------

const LLM_SYSTEM_PROMPT = `You are a self-improvement agent for AI coding assistants. Analyze the conversation window below and extract lessons the assistant should learn.

For each lesson, return:
- signal: "positive" (something worked well) or "negative" (something failed)
- trigger: { condition: "...", type: "debugging"|"implementation"|"constraint"|"error-report"|"general" }
- action: { type: "do" (repeat) or "avoid" (don't repeat), description: "..." }
- confidence: 0.0 to 1.0
- evidence: the specific conversation excerpt supporting this lesson

Return JSON only, no markdown fences:
{"lessons": [...]}

Focus on actionable, specific lessons. Ignore trivial interactions.`;

async function callAnthropicApi(conversationText, model) {
  const { callClaudeJson, MODELS } = require('./llm-client');
  return callClaudeJson({
    model: model || MODELS.SMART,
    maxTokens: 2048,
    systemPrompt: LLM_SYSTEM_PROMPT,
    userPrompt: `Analyze this conversation window and extract lessons:\n\n${conversationText}`,
    cache: true,
  });
}

async function generateLlmLessons(conversationWindow, model) {
  const text = conversationWindow.map((msg) => {
    const role = String(msg.role || 'unknown');
    const content = String(msg.content || '').slice(0, 500);
    return `[${role}]: ${content}`;
  }).join('\n\n');

  // Cap to ~4000 chars to stay within token budget
  const truncated = text.slice(0, 4000);
  const result = await callAnthropicApi(truncated, model);
  if (!result || !Array.isArray(result.lessons)) return [];

  return result.lessons.filter((l) =>
    l && l.signal && l.trigger && l.action && typeof l.confidence === 'number'
  );
}

// ---------------------------------------------------------------------------
// 5. Persistence
// ---------------------------------------------------------------------------


function writeRunManifest(manifest) {
  ensureParentDir(SELF_DISTILL_RUNS_PATH);
  fs.appendFileSync(SELF_DISTILL_RUNS_PATH, JSON.stringify(manifest) + '\n');
}

function readRunManifests() {
  return readJsonl(SELF_DISTILL_RUNS_PATH);
}

// ---------------------------------------------------------------------------
// 6. Main Entry Points
// ---------------------------------------------------------------------------

async function runSelfDistill({ dryRun = false, limit = 20, model } = {}) {
  const startedAt = new Date().toISOString();
  const logPaths = discoverConversationLogs({ limit });
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const analysisMode = hasApiKey ? 'llm' : 'heuristic';

  const allLessons = [];
  let sessionsProcessed = 0;
  let sessionsSkipped = 0;

  for (const logPath of logPaths) {
    const entries = readJsonl(logPath);
    if (entries.length === 0) {
      sessionsSkipped++;
      continue;
    }

    // Treat each log file as one conversation session
    const conversationWindow = entries.slice(-30); // last 30 messages max
    const signals = detectOutcomeSignals(conversationWindow);
    const outcome = classifyOutcome(signals);

    if (outcome === 'neutral') {
      sessionsSkipped++;
      continue;
    }

    sessionsProcessed++;

    let lessons;
    if (hasApiKey) {
      lessons = await generateLlmLessons(conversationWindow, model);
      // Fall back to heuristic if LLM returns nothing
      if (!lessons || lessons.length === 0) {
        lessons = generateHeuristicLessons(conversationWindow, signals);
      }
    } else {
      lessons = generateHeuristicLessons(conversationWindow, signals);
    }

    for (const lesson of lessons) {
      if (!dryRun) {
        createLesson({
          feedbackId: null,
          signal: lesson.signal,
          inferredLesson: lesson.action.description,
          triggerMessage: lesson.trigger.condition,
          priorSummary: lesson.evidence || '',
          confidence: Math.round((lesson.confidence || 0.5) * 100),
          tags: ['self-distill', lesson.signal],
          metadata: {
            source: 'self-distill-agent',
            analysisMode,
            triggerType: lesson.trigger.type,
            actionType: lesson.action.type,
            logPath,
          },
        });
      }
      allLessons.push(lesson);
    }
  }

  const manifest = {
    id: buildStableId('distill'),
    startedAt,
    completedAt: new Date().toISOString(),
    dryRun,
    analysisMode,
    sessionsProcessed,
    sessionsSkipped,
    lessonsGenerated: allLessons.length,
    logPaths,
    lessons: allLessons.map((l) => ({
      signal: l.signal,
      trigger: l.trigger,
      action: l.action,
      confidence: l.confidence,
    })),
  };

  if (!dryRun) {
    writeRunManifest(manifest);
  }

  return manifest;
}

function getSelfDistillStatus() {
  const runs = readRunManifests();
  if (runs.length === 0) return null;

  const lastRun = runs[runs.length - 1];
  return {
    lastRunId: lastRun.id,
    lastRunAt: lastRun.completedAt,
    totalRuns: runs.length,
    totalLessons: runs.reduce((sum, r) => sum + (r.lessonsGenerated || 0), 0),
    lastAnalysisMode: lastRun.analysisMode,
    lastSessionsProcessed: lastRun.sessionsProcessed,
    lastLessonsGenerated: lastRun.lessonsGenerated,
  };
}

// ---------------------------------------------------------------------------
// 7. CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit'));
  const limit = limitArg ? Number(limitArg.split('=')[1] || limitArg.split(' ')[1]) || 20 : 20;

  if (args.includes('--status')) {
    const status = getSelfDistillStatus();
    if (!status) {
      console.log('No self-distill runs found.');
    } else {
      console.log(JSON.stringify(status, null, 2));
    }
    return;
  }

  console.log(`Self-distill agent starting (dryRun=${dryRun}, limit=${limit})...`);
  const manifest = await runSelfDistill({ dryRun, limit });
  console.log(`Sessions processed: ${manifest.sessionsProcessed}`);
  console.log(`Sessions skipped: ${manifest.sessionsSkipped}`);
  console.log(`Lessons generated: ${manifest.lessonsGenerated}`);
  console.log(`Analysis mode: ${manifest.analysisMode}`);
  if (dryRun) {
    console.log('\n[DRY RUN] No lessons persisted.');
  }
  if (manifest.lessons.length > 0) {
    console.log('\nLessons:');
    for (const lesson of manifest.lessons) {
      const icon = lesson.signal === 'positive' ? '+' : '-';
      console.log(`  [${icon}] ${lesson.action.type}: ${lesson.action.description.slice(0, 100)}`);
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Self-distill agent failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runSelfDistill,
  getSelfDistillStatus,
  detectOutcomeSignals,
  discoverConversationLogs,
  classifyOutcome,
  generateHeuristicLessons,
  SELF_DISTILL_RUNS_PATH,
};
