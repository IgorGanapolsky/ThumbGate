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

function parseArgs(argv) {
  const args = {};
  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length ? rest.join('=') : true;
  });
  return args;
}

function normalize(feedback) {
  const raw = String(feedback || '').toLowerCase();
  if (['up', 'thumbs_up', 'thumbsup', 'positive'].includes(raw)) return 'up';
  if (['down', 'thumbs_down', 'thumbsdown', 'negative'].includes(raw)) return 'down';
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
  if (!feedback) {
    console.error('Missing --feedback=up|down');
    process.exit(1);
  }

  const result = captureFeedback({
    signal: feedback,
    context: args.context || '',
    whatWentWrong: args['what-went-wrong'],
    whatToChange: args['what-to-change'],
    whatWorked: args['what-worked'],
    rubricScores: args['rubric-scores'],
    guardrails: args.guardrails,
    tags: args.tags,
    skill: args.skill,
  });

  if (result.accepted) {
    console.log('Feedback captured and converted to actionable memory.');
    console.log(`Feedback ID: ${result.feedbackEvent.id}`);
    console.log(`Memory ID: ${result.memoryRecord.id}`);
    console.log(`Title: ${result.memoryRecord.title}`);
    return;
  }

  console.log('Feedback recorded but not promoted to memory.');
  console.log(`Reason: ${result.reason}`);
  console.log(`Feedback ID: ${result.feedbackEvent ? result.feedbackEvent.id : 'n/a'}`);
  process.exit(2);
}

if (require.main === module) {
  main();
}
