#!/usr/bin/env node
'use strict';

/**
 * CLI Feedback — inline thumbs up/down for the terminal.
 *
 * Instead of opening a browser, this echoes the lesson and process info
 * directly to stdout. Designed to be triggered from the Claude Code
 * statusbar or typed as a command.
 *
 * Usage:
 *   node scripts/cli-feedback.js up "what worked"
 *   node scripts/cli-feedback.js down "what went wrong"
 */

const { captureFeedback } = require('./feedback-loop');
const { distillFromHistory } = require('./history-distiller');
const { getRecentLesson, getLessonStats } = require('./lesson-inference');

const G = '\x1b[32m';
const R = '\x1b[31m';
const C = '\x1b[36m';
const M = '\x1b[35m';
const D = '\x1b[90m';
const BD = '\x1b[1m';
const RST = '\x1b[0m';

/**
 * Process a thumbs up/down signal from the CLI.
 * Captures feedback, distills a lesson, and prints everything inline.
 *
 * @param {Object} opts
 * @param {string} opts.signal - 'up' or 'down'
 * @param {string} [opts.context] - What happened
 * @param {Array} [opts.chatHistory] - Conversation messages for distillation
 * @param {string} [opts.whatWentWrong] - For thumbs down
 * @param {string} [opts.whatWorked] - For thumbs up
 * @returns {Object} Result with feedback + lesson + stats
 */
function processInlineFeedback({ signal, context, chatHistory, whatWentWrong, whatWorked } = {}) {
  const isDown = signal === 'down' || signal === 'negative';

  // 1. Capture the feedback
  let feedbackResult;
  try {
    feedbackResult = captureFeedback({
      signal: isDown ? 'down' : 'up',
      context: context || (isDown ? 'Thumbs down from CLI' : 'Thumbs up from CLI'),
      whatWentWrong: whatWentWrong || undefined,
      whatWorked: whatWorked || undefined,
    });
  } catch (err) {
    feedbackResult = { accepted: false, reason: err.message };
  }

  // 2. If thumbs down + chat history, distill a lesson
  let distillResult = null;
  if (isDown && Array.isArray(chatHistory) && chatHistory.length > 0) {
    try {
      distillResult = distillFromHistory({ chatHistory, signal: 'negative', feedbackContext: context || '' });
    } catch { /* non-critical */ }
  }

  // 3. Get the most recent lesson and stats
  const recentLesson = getRecentLesson();
  const stats = getLessonStats();

  return { feedbackResult, distillResult, recentLesson, stats };
}

/**
 * Format the result for terminal output.
 */
function formatCliOutput(result) {
  const lines = [];
  const feedbackSignal = result.feedbackResult
    && (result.feedbackResult.signal || (result.feedbackResult.feedbackEvent && result.feedbackResult.feedbackEvent.signal));
  const isDown = ['down', 'negative', 'thumbs_down'].includes(feedbackSignal);

  // Header
  if (result.feedbackResult && result.feedbackResult.accepted !== false) {
    lines.push(`${isDown ? R : G}${BD}${isDown ? '👎 Thumbs down recorded' : '👍 Thumbs up recorded'}${RST}`);
    const feedbackId = (result.feedbackResult.feedbackEvent && result.feedbackResult.feedbackEvent.id) || result.feedbackResult.id;
    if (feedbackId) {
      lines.push(`${D}  ID: ${feedbackId}${RST}`);
      // Echo feedback ID to stderr so it's visible directly in the terminal,
      // not hidden behind Claude Code's "ctrl+o to expand" MCP call collapse.
      process.stderr.write(`✅ Feedback captured (${feedbackId})\n`);
    }
  } else {
    lines.push(`${R}Feedback not accepted: ${(result.feedbackResult && result.feedbackResult.reason) || 'unknown'}${RST}`);
  }

  // Distilled lesson (if thumbs down)
  if (result.distillResult) {
    lines.push('');
    lines.push(`${C}${BD}Lesson distilled:${RST}`);
    lines.push(`${C}  ${result.distillResult.proposedWhatWentWrong}${RST}`);
    if (result.distillResult.proposedRule) {
      lines.push(`${M}  Rule: ${result.distillResult.proposedRule}${RST}`);
      lines.push(`${D}  ${result.distillResult.ruleInstalled ? '✅ Auto-installed' : '⚠ Not auto-installed (low confidence)'}${RST}`);
    }
    if (result.distillResult.confirmation) {
      lines.push(`${D}  ${result.distillResult.confirmation}${RST}`);
    }
  }

  // Most recent lesson
  if (result.recentLesson) {
    lines.push('');
    lines.push(`${D}Most recent lesson:${RST}`);
    lines.push(`${D}  ${result.recentLesson.lesson}${RST}`);
    lines.push(`${D}  Link: ${result.recentLesson.link}${RST}`);
  }

  // Stats
  if (result.stats && result.stats.total > 0) {
    lines.push('');
    lines.push(`${D}Stats: ${result.stats.positive}👍 ${result.stats.negative}👎 · ${result.stats.total} lessons · ${result.stats.avgConfidence}% avg confidence${RST}`);
  }

  return lines.join('\n');
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const signal = args[0] || 'up';
  const context = args.slice(1).join(' ') || '';

  const result = processInlineFeedback({
    signal,
    context,
    whatWentWrong: signal === 'down' ? context : undefined,
    whatWorked: signal === 'up' ? context : undefined,
  });

  process.stdout.write(formatCliOutput(result) + '\n');
}

module.exports = { processInlineFeedback, formatCliOutput };
