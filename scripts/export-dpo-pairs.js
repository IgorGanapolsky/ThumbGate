#!/usr/bin/env node
/**
 * DPO Preference Pair Exporter
 *
 * Transforms error + learning memories into DPO JSONL triples.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const FEEDBACK_DIR = process.env.RLHF_FEEDBACK_DIR || path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback');
const DEFAULT_LOCAL_MEMORY_LOG = path.join(FEEDBACK_DIR, 'memory-log.jsonl');

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

function buildDpoPairs(errors, learnings) {
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
      if (usedLearnings.has(learn.memory.id)) continue;
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
      pairs.push({
        prompt: inferPrompt(err.memory, best.memory),
        chosen: best.memory.content,
        rejected: err.memory.content,
        metadata: {
          errorId: err.memory.id,
          learningId: best.memory.id,
          matchScore: bestScore,
          overlapScore: domainOverlap(err.keys, best.keys),
          matchedKeys: err.keys.filter((k) => best.keys.includes(k)),
          errorTitle: err.memory.title,
          learningTitle: best.memory.title,
          rubric: buildRubricDelta(err.memory, best.memory),
        },
      });
      usedErrors.add(err.memory.id);
      usedLearnings.add(best.memory.id);
    }
  }

  return {
    pairs,
    unpairedErrors: errors.filter((e) => !usedErrors.has(e.id)),
    unpairedLearnings: learnings.filter((l) => !usedLearnings.has(l.id)),
  };
}

function toJSONL(pairs) {
  return `${pairs.map((p) => JSON.stringify(p)).join('\n')}\n`;
}

function exportDpoFromMemories(memories) {
  const errors = memories.filter((m) => m.category === 'error');
  const learnings = memories.filter((m) => m.category === 'learning');
  const result = buildDpoPairs(errors, learnings);
  return {
    ...result,
    errors,
    learnings,
    jsonl: toJSONL(result.pairs),
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
  buildDpoPairs,
  toJSONL,
  exportDpoFromMemories,
  DEFAULT_LOCAL_MEMORY_LOG,
};

if (require.main === module) {
  runCli();
}
