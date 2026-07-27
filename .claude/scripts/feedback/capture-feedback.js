#!/usr/bin/env node
/**
 * Claude-compatible feedback capture wrapper.
 *
 * Example:
 *   node .claude/scripts/feedback/capture-feedback.js --feedback=down --context="Skipped tests" --tags="testing,regression"
 */

const path = require('path');
const {
  captureFeedback,
  analyzeFeedback,
  feedbackSummary,
  writePreventionRules,
} = require('../../../scripts/feedback-loop');

// Statusline cache lives in ~/.thumbgate/statusline_cache.json and is normally
// refreshed by the `cache-update` PostToolUse hook — but ONLY when an
// mcp__thumbgate__feedback_stats or mcp__thumbgate__dashboard tool call fires.
// When feedback is captured via THIS script (a plain Bash invocation), no MCP
// tool fires and the cache stays stale — statusline keeps showing old 👍/👎
// counts until the next dashboard call (could be hours).
//
// Trigger cache refresh inline so the bar updates immediately. We have to
// recompute stats from the freshly-updated feedback log via feedbackSummary()
// because refreshStatuslineCache() merges a stats PAYLOAD into the cache —
// calling it with no args would just bump the timestamp without new numbers.
// Best-effort: if either module is unavailable, silently skip.
function refreshStatuslineCacheBestEffort() {
  try {
    const { refreshStatuslineCache } = require('../../../scripts/hook-thumbgate-cache-updater');
    if (typeof refreshStatuslineCache !== 'function') return;
    // analyzeFeedback() returns the right shape for normalizeStatsPayload —
    // { totalPositive, totalNegative, total, approvalRate, trend, rubric }.
    // feedbackSummary() returns a string (the human-readable summary), which
    // when destructured becomes an array of characters with numeric keys —
    // wrong for the cache merge.
    let stats;
    try {
      stats = analyzeFeedback(undefined, { humanOnly: true }) || {};
    } catch (_err) {
      stats = {};
    }
    refreshStatuslineCache(stats);
  } catch (_err) {
    // No-op — cache-updater not available, statusline will refresh on next PostToolUse
  }
}

function parseArgs(argv) {
  const args = {};
  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length ? rest.join('=') : true;
  });
  return args;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1);
    row[0] = i;
    return row;
  });
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)
      );
  return dp[m][n];
}

function normalize(feedback) {
  const raw = String(feedback || '').toLowerCase().replace(/[^a-z]/g, '');
  const UP_VARIANTS = ['up', 'thumbsup', 'thumbs_up', 'positive', 'thumbup', 'thumbsu'];
  const DOWN_VARIANTS = ['down', 'thumbsdown', 'thumbs_down', 'negative', 'thumbdown'];
  if (UP_VARIANTS.includes(raw)) return 'up';
  if (DOWN_VARIANTS.includes(raw)) return 'down';
  // Fuzzy match: accept if edit distance <= 2 from any known variant
  for (const v of UP_VARIANTS) if (levenshtein(raw, v) <= 2) return 'up';
  for (const v of DOWN_VARIANTS) if (levenshtein(raw, v) <= 2) return 'down';
  return feedback;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.stats) {
    console.log(JSON.stringify(analyzeFeedback(), null, 2));
    return;
  }

  if (args.summary) {
    console.log(feedbackSummary(Number(args.recent || 20)));
    return;
  }

  if (args.rules) {
    const out = args.output || path.join(process.cwd(), '.claude', 'memory', 'feedback', 'prevention-rules.md');
    const result = writePreventionRules(out, Number(args.min || 2));
    console.log(`Wrote prevention rules to ${result.path}`);
    return;
  }

  const feedback = normalize(args.feedback);
  if (!feedback || (feedback !== 'up' && feedback !== 'down')) {
    console.error('Missing or unrecognized --feedback=up|down');
    process.exit(1);
  }

  let chatHistory = undefined;
  try {
    if (args['chat-history-json']) {
      chatHistory = JSON.parse(args['chat-history-json']);
    } else if (args['chat-history-file']) {
      chatHistory = JSON.parse(require('fs').readFileSync(args['chat-history-file'], 'utf8'));
    }
  } catch (error) {
    console.error(`Invalid chat history payload: ${error.message}`);
    process.exit(1);
  }

  const result = captureFeedback({
    signal: feedback,
    context: args.context || '',
    relatedFeedbackId: args['related-feedback-id'],
    chatHistory,
    whatWentWrong: args['what-went-wrong'],
    whatToChange: args['what-to-change'],
    whatWorked: args['what-worked'],
    reasoning: args.reasoning,
    rubricScores: args['rubric-scores'],
    guardrails: args.guardrails,
    tags: args.tags,
    skill: args.skill,
    reviewOrigin: 'human',
  });

  if (result.accepted) {
    // Refresh the statusline cache inline so the bar reflects the new count
    // immediately — without this, the cache stays stale until a PostToolUse
    // hook fires for an mcp__thumbgate__* tool, which may be hours away.
    refreshStatuslineCacheBestEffort();
  }

  if (result.accepted && result.promoted && result.memoryRecord) {
    const ev = result.feedbackEvent;
    const mem = result.memoryRecord;
    console.log('');
    console.log(`ThumbGate Feedback Captured [${feedback.toUpperCase()}]`);
    console.log('─'.repeat(50));
    console.log(`  Feedback ID : ${ev.id}`);
    console.log(`  Signal      : ${ev.signal} (${ev.actionType})`);
    console.log(`  Context     : ${(ev.context || '').slice(0, 80)}${(ev.context || '').length > 80 ? '...' : ''}`);
    console.log(`  Tags        : ${(ev.tags || []).join(', ') || '(none)'}`);
    console.log(`  Timestamp   : ${ev.timestamp}`);
    console.log('');
    console.log(`  Memory ID   : ${mem.id}`);
    console.log(`  Title       : ${mem.title}`);
    console.log(`  Type        : ${mem.type || ev.actionType}`);
    console.log(`  Storage     : JSONL log + LanceDB vector index`);
    console.log('');
    console.log(`  Action: promoted to reusable memory. Prevention rules will auto-update.`);
    console.log(`  DPO export: run \`npx thumbgate export-dpo\` to generate training pairs.`);
    console.log('');
    return;
  }

  if (result.needsClarification) {
    console.log('');
    console.log(`ThumbGate Signal Logged [${feedback.toUpperCase()}] — clarification required`);
    console.log('─'.repeat(50));
    console.log(`  Feedback ID : ${result.feedbackEvent ? result.feedbackEvent.id : 'n/a'}`);
    console.log(`  Reason      : ${result.reason}`);
    console.log(`  Next detail : ${result.prompt}`);
    console.log(`  Example     : ${result.example}`);
    console.log('');
    console.log('  Signal log only: stored in feedback history, but reusable memory was not created yet.');
    console.log('');
    return;
  }

  console.log('');
  console.log(`ThumbGate Feedback Logged [${feedback.toUpperCase()}] — not promoted`);
  console.log('─'.repeat(50));
  console.log(`  Feedback ID : ${result.feedbackEvent ? result.feedbackEvent.id : 'n/a'}`);
  console.log(`  Reason      : ${result.reason}`);
  console.log('');
  console.log('  Signal log only: reusable memory was not created.');
  console.log('  Common causes: rubric guardrails, missing domain tags, or invalid evidence payloads.');
  console.log('');
  if (!result.accepted) process.exit(2);
}

if (require.main === module) {
  main();
}
