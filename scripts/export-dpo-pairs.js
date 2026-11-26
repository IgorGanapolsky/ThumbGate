#!/usr/bin/env node
/**
 * DPO Preference Pair Exporter
 *
 * Transforms error + learning memories into DPO JSONL triples.
 */

const fs = require('fs');
const { projectForRecord, matchesProject } = require('./project-identity');
const path = require('path');
const { traceForDpoPair, aggregateTraces } = require('./code-reasoning');
const { resolveFeedbackDir } = require('./feedback-paths');
const { normalizeConversationWindow } = require('./conversation-context');
const { redactSecretsDeep } = require('./secret-redaction');

const DEFAULT_LOCAL_MEMORY_LOG = path.join(resolveFeedbackDir(), 'memory-log.jsonl');

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractDomainKeys(memory) {
  const keys = new Set();
  const genericTags = new Set(['feedback', 'positive', 'negative']);

  if (Array.isArray(memory.tags)) {
    for (const tag of memory.tags) {
      if (!genericTags.has(tag)) keys.add(tag);
    }
  }

  const titleWords = (memory.title || '')
    .replace(/^(MISTAKE|SUCCESS|ERROR|LEARNING|PREFERENCE):\s*/i, '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 3);

  for (const word of titleWords) keys.add(word);

  return Array.from(keys);
}

function domainOverlap(keysA, keysB) {
  const setB = new Set(keysB);
  let overlap = 0;
  for (const key of keysA) {
    if (setB.has(key)) overlap++;
  }
  return overlap;
}

function inferPrompt(error, learning) {
  const shared = (error.tags || []).filter((t) => (learning.tags || []).includes(t));
  if (shared.length > 0) {
    return `Task domain: ${shared.join(', ')}. How should the agent handle this scenario?`;
  }

  const scenario = (error.title || '').replace(/^(MISTAKE|ERROR):\s*/i, '').trim();
  if (scenario) return `Scenario: ${scenario}. What is the better response?`;
  return 'How should the agent respond in this situation?';
}

function getRubricWeightedScore(memory) {
  if (!memory || !memory.rubricSummary) return null;
  const score = Number(memory.rubricSummary.weightedScore);
  if (!Number.isFinite(score)) return null;
  return score;
}

function buildRubricDelta(error, learning) {
  const errorScore = getRubricWeightedScore(error);
  const learningScore = getRubricWeightedScore(learning);
  if (errorScore == null && learningScore == null) return null;
  const delta = (learningScore != null && errorScore != null)
    ? Math.round((learningScore - errorScore) * 1000) / 1000
    : null;
  return {
    learningWeightedScore: learningScore,
    errorWeightedScore: errorScore,
    weightedDelta: delta,
    errorFailingCriteria: error && error.rubricSummary ? error.rubricSummary.failingCriteria || [] : [],
    learningFailingCriteria: learning && learning.rubricSummary ? learning.rubricSummary.failingCriteria || [] : [],
  };
}

/**
 * Find distractor errors for a learning: same-domain errors that are NOT
 * the best match but look similar (high overlap, low rubric delta).
 * These are harder negatives that train retrieval precision.
 */
function findDistractors(learning, errorKeys, usedErrorId, maxDistractors) {
  const learningKeys = extractDomainKeys(learning);
  return errorKeys
    .filter((err) => err.memory.id !== usedErrorId && matchesProject(err.memory, projectForRecord(learning).projectKey))
    .map((err) => {
      const overlap = domainOverlap(err.keys, learningKeys);
      return { memory: err.memory, overlap };
    })
    .filter((d) => d.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, maxDistractors)
    .map((d) => ({
      id: d.memory.id,
      title: d.memory.title,
      content: d.memory.content,
      overlap: d.overlap,
    }));
}

function buildDpoPairs(errors, learnings, { maxDistractors = 2 } = {}) {
  const identity = (row) => projectForRecord(row).projectKey + ':' + row.id;
  const pairs = [];
  const usedErrors = new Set();
  const usedLearnings = new Set();

  const errorKeys = errors.map((e) => ({ memory: e, keys: extractDomainKeys(e) }));
  const learningKeys = learnings.map((l) => ({ memory: l, keys: extractDomainKeys(l) }));

  for (const err of errorKeys) {
    let best = null;
    let bestScore = 0;
    let bestOverlap = 0;

    for (const learn of learningKeys) {
      if (!matchesProject(learn.memory, projectForRecord(err.memory).projectKey)) continue;
      if (usedLearnings.has(identity(learn.memory))) continue;
      const overlap = domainOverlap(err.keys, learn.keys);
      const rubric = buildRubricDelta(err.memory, learn.memory);
      const rubricDelta = rubric && rubric.weightedDelta != null ? rubric.weightedDelta : 0;
      const score = overlap + Math.max(0, rubricDelta);
      if (score > bestScore) {
        best = learn;
        bestScore = score;
        bestOverlap = overlap;
      }
    }

    if (best && bestScore > 0 && bestOverlap > 0) {
      const distractors = findDistractors(best.memory, errorKeys, err.memory.id, maxDistractors);
      pairs.push({
        ...projectForRecord(err.memory),
        prompt: inferPrompt(err.memory, best.memory),
        chosen: best.memory.content,
        rejected: err.memory.content,
        distractors: distractors.length > 0 ? distractors : undefined,
        metadata: {
          errorId: err.memory.id,
          learningId: best.memory.id,
          matchScore: bestScore,
          overlapScore: domainOverlap(err.keys, best.keys),
          matchedKeys: err.keys.filter((k) => best.keys.includes(k)),
          errorTitle: err.memory.title,
          learningTitle: best.memory.title,
          rubric: buildRubricDelta(err.memory, best.memory),
          distractorCount: distractors.length,
        },
      });
      usedErrors.add(identity(err.memory));
      usedLearnings.add(identity(best.memory));
    }
  }

  return {
    pairs,
    unpairedErrors: errors.filter((e) => !usedErrors.has(identity(e))),
    unpairedLearnings: learnings.filter((l) => !usedLearnings.has(identity(l))),
  };
}

// ---- Strict pairing -------------------------------------------------------------------------------------------
// A DPO pair is two responses or actions to the SAME prompt/context. The keyword matcher above joined two unrelated
// records that shared a tag ("Task domain: feedback, ..." / "great job, Claude" / an unrelated complaint), which is not
// a pair. The strict builder pairs only inside one feedback record or one prompt:
//   rejected = the action that was thumbed down (lastAction), prompt = the conversation window before it,
//   chosen   = the corrective action written for that same record (whatToChange), or a thumbs-up recorded on the same
//              session AND the same prompt id whose lastAction is the better action.
// Everything else is reported in `dropped` with a reason.
const VAGUE_NEGATIVE = /^(thumbs?[- ]?down|bad|wrong|no|nope|nah|fix (it|this)|this is (wrong|bad)[!.]*|\W*)$/i;
const PRAISE_ONLY = /^(?:what worked:\s*)?(?:great|good|nice|perfect|awesome|excellent|thanks|thank you|love it|well done|works?)\b[^.]{0,40}$/i;
const REINFORCE = /^when answering .*: reinforce\b/i;

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('\n').trim();
  if (typeof value === 'object') {
    const direct = value.text || value.content || value.command || value.summary || value.description;
    if (direct) return textOf(direct);
    const tool = value.tool || value.toolName || value.name;
    const input = value.input || value.args || value.arguments;
    if (tool) return `${tool}${input ? ` ${typeof input === 'string' ? input : JSON.stringify(input)}` : ''}`.trim();
  }
  return '';
}

function wordCount(text) { return String(text || '').split(/\s+/).filter(Boolean).length; }

// The action itself: a command, input or text. A bare tool name ("Bash") is not an action: captureFeedback stores
// only tool/contextKey/file/timestamp in lastAction, and two different Bash commands would both read "Bash".
function actionContentOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value !== 'object' || Array.isArray(value)) return textOf(value);
  const direct = value.command || value.text || value.content || value.summary || value.description;
  if (direct) return textOf(direct);
  const input = value.input || value.args || value.arguments;
  if (input == null || input === '') return '';
  const tool = value.tool || value.toolName || value.name;
  return `${tool ? `${tool} ` : ''}${typeof input === 'string' ? input : JSON.stringify(input)}`.trim();
}

// The prompt is the context at the decision point: role-preserving, and ending before the rejected action.
// A plain-text window is cut at the first occurrence of the action; a message window drops the message that
// contains the action and everything after it. If nothing is left before the action, there is no prompt.
function promptBefore(windowValue, rejected) {
  if (Array.isArray(windowValue)) {
    const messages = normalizeConversationWindow(windowValue);
    const cut = messages.findIndex((m) => m.content.includes(rejected));
    const kept = cut === -1 ? messages : messages.slice(0, cut);
    return kept.map((m) => `${m.role}: ${m.content}`).join('\n').trim();
  }
  const text = textOf(windowValue);
  const at = text.indexOf(rejected);
  if (at === -1) return text;
  let before = text.slice(0, at);
  // Drop the partial line that introduced the action ("Assistant: ran ") so the prompt ends on a whole turn.
  const lineStart = before.lastIndexOf('\n');
  before = lineStart === -1 ? '' : before.slice(0, lineStart);
  return before.trim();
}

function loadFeedbackIndex(options = {}) {
  const rows = options.feedbackRows || readJSONL(path.join(options.feedbackDir || resolveFeedbackDir(), 'feedback-log.jsonl'));
  const byId = new Map();
  for (const row of rows) if (row && row.id) byId.set(row.id, row);
  return { rows, byId };
}

function strictPairFor(error, feedback, positives) {
  if (!feedback) return { reason: 'no_source_feedback_record' };
  const whatWrong = textOf(feedback.whatWentWrong) || textOf(feedback.context);
  if (wordCount(whatWrong) < 4 || VAGUE_NEGATIVE.test(whatWrong)) return { reason: 'vague_negative_feedback' };
  if (!feedback.lastAction) return { reason: 'no_rejected_action_recorded' };
  const rejected = actionContentOf(feedback.lastAction);
  if (!rejected) return { reason: 'rejected_action_has_no_content' };
  if (!textOf(feedback.conversationWindow)) return { reason: 'no_prompt_context_recorded' };
  const window = promptBefore(feedback.conversationWindow, rejected);
  if (!window) return { reason: 'no_prompt_context_before_rejected_action' };
  let chosen = textOf(feedback.whatToChange);
  let chosenSource = 'same_record_corrective_action';
  if (chosen && (REINFORCE.test(chosen) || PRAISE_ONLY.test(chosen))) chosen = '';
  if (!chosen) {
    const promptId = feedback.sourceEvent && feedback.sourceEvent.promptIdHash;
    const session = feedback.scope && feedback.scope.sessionId;
    const match = promptId && session ? positives.find((p) => p.sourceEvent && p.sourceEvent.promptIdHash === promptId
      && p.scope && p.scope.sessionId === session && actionContentOf(p.lastAction) && !PRAISE_ONLY.test(actionContentOf(p.lastAction))) : null;
    if (!match) return { reason: 'no_corrective_or_same_prompt_positive_action' };
    chosen = actionContentOf(match.lastAction);
    chosenSource = 'thumbs_up_same_session_and_prompt';
  }
  if (chosen === rejected) return { reason: 'chosen_equals_rejected' };
  return { pair: { prompt: window, rejected, chosen, chosenSource, whatWentWrong: whatWrong } };
}

function buildStrictDpoPairs(errors, learnings, options = {}) {
  const { byId, rows } = loadFeedbackIndex(options);
  const positives = rows.filter((r) => r && r.signal === 'positive');
  const pairs = [];
  const dropped = [];
  for (const error of errors) {
    const feedback = byId.get(error.sourceFeedbackId);
    const result = strictPairFor(error, feedback, positives);
    if (result.pair) {
      pairs.push({
        ...projectForRecord(error),
        prompt: result.pair.prompt,
        chosen: result.pair.chosen,
        rejected: result.pair.rejected,
        metadata: { errorId: error.id, sourceFeedbackId: error.sourceFeedbackId, chosenSource: result.pair.chosenSource, whatWentWrong: result.pair.whatWentWrong },
      });
    } else {
      dropped.push({ id: error.id, kind: 'error', reason: result.reason });
    }
  }
  // A learning (thumbs-up) alone has no rejected side. A learning only enters a pair as a same-prompt positive above.
  for (const learning of learnings) dropped.push({ id: learning.id, kind: 'learning', reason: 'positive_without_a_rejected_action_on_the_same_prompt' });
  const reasons = {};
  for (const d of dropped) reasons[d.reason] = (reasons[d.reason] || 0) + 1;
  return { pairs, dropped, droppedByReason: reasons };
}

function toJSONL(pairs) {
  return `${pairs.map((p) => JSON.stringify(p)).join('\n')}\n`;
}

function exportDpoFromMemories(memories, options = {}) {
  memories = memories.filter((row) => matchesProject(row, options.projectKey));
  // Paid-feature gate: DPO export is a commercial (Pro+) capability. Advisory by
  // default; enforced when THUMBGATE_ENFORCE_ENTITLEMENTS=1 (then this throws).
  const _ent = require('./entitlement').requireEntitlement('data-export');
  if (!_ent.entitled) {
    console.error(`⚠️ ThumbGate: DPO export is a paid feature (tier: ${_ent.tier}). Advisory mode — set THUMBGATE_ENFORCE_ENTITLEMENTS=1 to enforce. License: https://thumbgate.ai/pricing`);
  }
  const errors = memories.filter((m) => m.category === 'error');
  const learnings = memories.filter((m) => m.category === 'learning');
  const strict = options.strict !== false;
  let result;
  let strictReport = null;
  if (strict) {
    strictReport = buildStrictDpoPairs(errors, learnings, options);
    // How many pairs the old keyword matcher would have made: reported so the drop is visible, never exported.
    const keywordOnly = buildDpoPairs(errors, learnings).pairs.length;
    strictReport.droppedKeywordOnlyCandidates = keywordOnly;
    const usedErrorIds = new Set(strictReport.pairs.map((p) => p.metadata.errorId));
    result = { pairs: strictReport.pairs, unpairedErrors: errors.filter((e) => !usedErrorIds.has(e.id)), unpairedLearnings: learnings };
  } else {
    result = buildDpoPairs(errors, learnings);
  }

  const traces = result.pairs.map((pair) => traceForDpoPair(pair));
  const reasoning = aggregateTraces(traces);

  const pairsWithTraces = result.pairs.map((pair, i) => ({
    ...pair,
    metadata: {
      ...pair.metadata,
      reasoningTrace: {
        traceId: traces[i].traceId,
        confidence: traces[i].summary.confidence,
        passed: traces[i].summary.passed,
        verified: traces[i].summary.verified,
        refuted: traces[i].summary.refuted,
        edgeCases: traces[i].edgeCases,
      },
    },
  }));

  // Redact secrets before the pairs leave this module — they are derived from memory content and
  // are shipped to disk here AND consumed by export-hf-dataset.js. See scripts/secret-redaction.js.
  const redactedPairs = pairsWithTraces.map((pair) => redactSecretsDeep(pair));

  return {
    pairs: redactedPairs,
    unpairedErrors: result.unpairedErrors,
    unpairedLearnings: result.unpairedLearnings,
    errors,
    learnings,
    reasoning,
    strict,
    dropped: strictReport ? strictReport.dropped : [],
    droppedByReason: strictReport ? strictReport.droppedByReason : {},
    droppedKeywordOnlyCandidates: strictReport ? strictReport.droppedKeywordOnlyCandidates : 0,
    jsonl: toJSONL(redactedPairs),
  };
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

function runCli() {
  const args = parseArgs(process.argv.slice(2));

  if (args.test) {
    runTests();
    return;
  }

  let memories = [];

  if (args.input) {
    const raw = fs.readFileSync(args.input, 'utf-8');
    const parsed = JSON.parse(raw);
    memories = Array.isArray(parsed) ? parsed : parsed.memories || [];
  } else if (args['from-local']) {
    memories = readJSONL(DEFAULT_LOCAL_MEMORY_LOG);
  } else {
    console.error('Provide --input=<path-to-json> or --from-local');
    process.exit(1);
  }

  const result = exportDpoFromMemories(memories);
  const jsonl = result.jsonl;

  if (args.output) {
    fs.writeFileSync(args.output, jsonl);
    console.error(`Wrote ${result.pairs.length} DPO pairs to ${args.output}`);
  } else {
    process.stdout.write(jsonl);
  }

  console.error(`Errors=${result.errors.length} Learnings=${result.learnings.length} Pairs=${result.pairs.length}`);
  console.error(`Unpaired errors=${result.unpairedErrors.length} Unpaired learnings=${result.unpairedLearnings.length}`);
}

function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      passed++;
      console.log(`  PASS ${name}`);
    } else {
      failed++;
      console.log(`  FAIL ${name}`);
    }
  }

  console.log('\nexport-dpo-pairs.js tests\n');

  const errors = [
    {
      id: 1,
      title: 'MISTAKE: Claimed done with no test proof',
      content: 'Claimed completion without running tests.',
      category: 'error',
      tags: ['verification', 'feedback'],
      rubricSummary: {
        weightedScore: 0.32,
        failingCriteria: ['verification_evidence'],
        failingGuardrails: ['testsPassed'],
      },
    },
    {
      id: 2,
      title: 'MISTAKE: Generic mismatch',
      content: 'No matching learning memory for this domain.',
      category: 'error',
      tags: ['unique-tag'],
    },
  ];

  const learnings = [
    {
      id: 10,
      title: 'SUCCESS: Always run tests before completion claims',
      content: 'Run tests and include output before saying complete.',
      category: 'learning',
      tags: ['verification', 'feedback'],
      rubricSummary: {
        weightedScore: 0.89,
        failingCriteria: [],
        failingGuardrails: [],
      },
    },
  ];

  const result = buildDpoPairs(errors, learnings);
  assert(result.pairs.length === 1, 'one pair built from overlapping domain keys');
  assert(result.unpairedErrors.length === 1, 'unpaired error left when no match exists');
  assert(result.unpairedLearnings.length === 0, 'no unpaired learnings');

  const jsonl = toJSONL(result.pairs);
  assert(jsonl.endsWith('\n'), 'JSONL output ends with newline');

  const parsed = JSON.parse(jsonl.trim());
  assert(parsed.prompt.includes('verification'), 'inferred prompt includes shared domain');
  assert(parsed.metadata.rubric.weightedDelta > 0, 'rubric delta metadata is attached');

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = {
  readJSONL,
  extractDomainKeys,
  domainOverlap,
  inferPrompt,
  buildRubricDelta,
  findDistractors,
  buildDpoPairs,
  buildStrictDpoPairs,
  toJSONL,
  exportDpoFromMemories,
  DEFAULT_LOCAL_MEMORY_LOG,
};

if (require.main === module) {
  runCli();
}
