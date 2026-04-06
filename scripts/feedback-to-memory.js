#!/usr/bin/env node
/**
 * Feedback → Memory Bridge
 *
 * Converts raw feedback params into a schema-validated memory object
 * suitable for mcp__memory__remember. This is the validation boundary
 * between external feedback signals and MCP memory storage.
 *
 * Usage:
 *   echo '{"signal":"negative","context":"...","whatWentWrong":"...","tags":["testing"]}' | node scripts/feedback-to-memory.js
 *   node scripts/feedback-to-memory.js --test
 *
 * Input (stdin JSON):
 *   signal: "positive" | "negative"
 *   context: string — what the agent was doing
 *   whatWentWrong: string — for negative: what failed
 *   whatToChange: string — for negative: how to avoid
 *   whatWorked: string — for positive: the pattern to repeat
 *   tags: string[] — domain tags (at least 1 non-generic)
 *
 * Output (stdout JSON):
 *   { ok: true, memory: { title, content, category, importance, tags } }
 *   { ok: false, reason: string, issues?: string[] }
 */
'use strict';

const { resolveFeedbackAction, prepareForStorage } = require('./feedback-schema');
const { buildClarificationMessage } = require('./feedback-quality');

function convertFeedbackToMemory(params) {
  const action = resolveFeedbackAction({
    signal: params.signal,
    context: params.context || '',
    whatWentWrong: params.whatWentWrong,
    whatToChange: params.whatToChange,
    whatWorked: params.whatWorked,
    tags: params.tags || [],
  });

  if (!action || action.type === 'no-action') {
    const clarification = buildClarificationMessage({
      signal: params.signal,
      context: params.context || '',
      whatWentWrong: params.whatWentWrong,
      whatToChange: params.whatToChange,
      whatWorked: params.whatWorked,
    });
    return {
      ok: false,
      reason: action ? action.reason : 'Unknown action resolution failure',
      ...(clarification || {}),
    };
  }

  const prep = prepareForStorage(action.memory);
  if (!prep.ok) {
    return { ok: false, reason: `Schema validation failed: ${prep.issues.join('; ')}`, issues: prep.issues };
  }

  return { ok: true, actionType: action.type, memory: prep.memory };
}

// ---------------------------------------------------------------------------
// CLI: stdin mode
// ---------------------------------------------------------------------------

function runStdin() {
  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const params = JSON.parse(input.trim());
      const result = convertFeedbackToMemory(params);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exit(result.ok ? 0 : 2);
    } catch (err) {
      process.stdout.write(JSON.stringify({ ok: false, reason: `Parse error: ${err.message}` }, null, 2) + '\n');
      process.exit(1);
    }
  });
}

// ---------------------------------------------------------------------------
// Built-in Tests
// ---------------------------------------------------------------------------

function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      passed++;
      console.log(`  ✅ ${name}`);
    } else {
      failed++;
      console.log(`  ❌ ${name}`);
    }
  }

  console.log('\n🧪 feedback-to-memory.js — Tests\n');

  // Valid negative feedback → memory
  const neg = convertFeedbackToMemory({
    signal: 'negative',
    context: 'Agent claimed fix without test evidence',
    whatWentWrong: 'No tests were run before claiming the bug was fixed',
    whatToChange: 'Always run tests and show output before claiming done',
    tags: ['verification', 'testing'],
  });
  assert(neg.ok === true, 'valid negative → ok');
  assert(neg.actionType === 'store-mistake', 'negative → store-mistake');
  assert(neg.memory.title.startsWith('MISTAKE:'), 'negative → MISTAKE: prefix');
  assert(neg.memory.category === 'error', 'negative → error category');
  assert(neg.memory.tags.includes('verification'), 'preserves domain tags');

  // Valid positive feedback → memory
  const pos = convertFeedbackToMemory({
    signal: 'positive',
    whatWorked: 'Built schema-validated feedback system with prevention rules',
    tags: ['architecture', 'rlhf'],
  });
  assert(pos.ok === true, 'valid positive → ok');
  assert(pos.actionType === 'store-learning', 'positive → store-learning');
  assert(pos.memory.title.startsWith('SUCCESS:'), 'positive → SUCCESS: prefix');
  assert(pos.memory.category === 'learning', 'positive → learning category');

  // Bare thumbs down → rejected
  const bare = convertFeedbackToMemory({ signal: 'negative' });
  assert(bare.ok === false, 'bare negative → rejected');
  assert(bare.reason.includes('No context') || bare.reason.includes('cannot'), 'reports missing context');

  // Bare thumbs up → rejected
  const bareUp = convertFeedbackToMemory({ signal: 'positive' });
  assert(bareUp.ok === false, 'bare positive → rejected');

  // Unknown signal → rejected
  const unknown = convertFeedbackToMemory({ signal: 'maybe', context: 'test' });
  assert(unknown.ok === false, 'unknown signal → rejected');

  // Context-only negative → ok
  const ctxNeg = convertFeedbackToMemory({
    signal: 'negative',
    context: 'Showed fake ThumbGate statistics panel to user',
    tags: ['rlhf'],
  });
  assert(ctxNeg.ok === true, 'context-only negative → ok');

  // Context-only positive → ok
  const ctxPos = convertFeedbackToMemory({
    signal: 'positive',
    context: 'Ran full test suite and showed green output before responding',
    tags: ['verification'],
  });
  assert(ctxPos.ok === true, 'context-only positive → ok');

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'═'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Exports & main
// ---------------------------------------------------------------------------

module.exports = { convertFeedbackToMemory };

if (require.main === module) {
  if (process.argv.includes('--test')) {
    runTests();
  } else {
    runStdin();
  }
}
