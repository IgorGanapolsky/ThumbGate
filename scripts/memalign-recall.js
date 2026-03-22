'use strict';
/**
 * MemAlign-style Dual-Memory Recall
 *
 * Combines semantic memory (principles) with episodic memory (contextfs)
 * into a unified working-memory context pack.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { constructContextPack } = require('./contextfs');

let getPrinciplesFn;
try {
  getPrinciplesFn = require('./principle-extractor').getPrinciples;
} catch (_) {
  getPrinciplesFn = () => [];
}

function nowIso() {
  return new Date().toISOString();
}

function makePackId() {
  return `wm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function constructWorkingMemory({
  query = '',
  maxItems = 8,
  maxChars = 6000,
  namespaces = [],
  maxPrinciples = 10,
} = {}) {
  const principlesBudget = Math.floor(maxChars * 0.2);
  const episodeBudget = maxChars - principlesBudget;

  const rawPrinciples = getPrinciplesFn({ limit: maxPrinciples });
  const principles = [];
  let principleChars = 0;

  for (const p of rawPrinciples) {
    const text = typeof p === 'string' ? p : (p.text || p.rule || JSON.stringify(p));
    if (principleChars + text.length > principlesBudget) break;
    principles.push(text);
    principleChars += text.length;
  }

  const episodicPack = constructContextPack({
    query,
    maxItems,
    maxChars: episodeBudget,
    namespaces,
  });

  const episodeItems = episodicPack.items || [];
  const episodeChars = episodicPack.usedChars || 0;

  return {
    packId: makePackId(),
    query,
    createdAt: nowIso(),
    semanticMemory: {
      principles,
      count: principles.length,
      usedChars: principleChars,
    },
    episodicMemory: {
      items: episodeItems,
      count: episodeItems.length,
      usedChars: episodeChars,
    },
    totalUsedChars: principleChars + episodeChars,
    maxChars,
  };
}

function formatWorkingMemoryForContext(workingMemory) {
  const lines = [];

  lines.push('## Principles (Semantic Memory)');
  if (workingMemory.semanticMemory.count === 0) {
    lines.push('- (none)');
  } else {
    for (const p of workingMemory.semanticMemory.principles) {
      lines.push(`- ${p}`);
    }
  }

  lines.push('');

  lines.push('## Relevant Past Episodes (Episodic Memory)');
  if (workingMemory.episodicMemory.count === 0) {
    lines.push('- (none)');
  } else {
    workingMemory.episodicMemory.items.forEach((item, idx) => {
      const label = (item.tags || []).includes('mistake') ? 'MISTAKE'
        : (item.tags || []).includes('success') ? 'SUCCESS'
          : 'EPISODE';
      const score = typeof item.score === 'number' ? ` (score: ${item.score})` : '';
      const title = item.title || 'untitled';
      lines.push(`${idx + 1}. [${label}] ${title}${score}`);
    });
  }

  return lines.join('\n');
}

module.exports = {
  constructWorkingMemory,
  formatWorkingMemoryForContext,
};

if (require.main === module && process.argv.includes('--test')) {
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memalign-test-'));
  const prevDir = process.env.RLHF_FEEDBACK_DIR;
  process.env.RLHF_FEEDBACK_DIR = tmpDir;

  delete require.cache[require.resolve('./contextfs')];
  const ctxfs = require('./contextfs');

  let passed = 0, failed = 0;
  function assert(cond, msg) {
    if (cond) { passed++; console.log(`  PASS ${msg}`); }
    else { failed++; console.log(`  FAIL ${msg}`); }
  }

  try {
    ctxfs.ensureContextFs();
    ctxfs.writeContextObject({ namespace: 'memory/error', title: 'Test error', content: 'Test content', tags: ['mistake'] });

    getPrinciplesFn = ({ limit = 10 } = {}) => ['ALWAYS run tests', 'NEVER skip review'].slice(0, limit);

    const wm = constructWorkingMemory({ query: 'test', maxChars: 4000 });
    assert(wm.packId.startsWith('wm_'), 'packId format');
    assert(wm.semanticMemory.count === 2, 'principles loaded');
    assert(wm.totalUsedChars <= wm.maxChars, 'budget respected');

    const fmt = formatWorkingMemoryForContext(wm);
    assert(fmt.includes('Principles (Semantic Memory)'), 'format has principles');
    assert(fmt.includes('Episodic Memory'), 'format has episodes');

    const empty = formatWorkingMemoryForContext({
      semanticMemory: { principles: [], count: 0 },
      episodicMemory: { items: [], count: 0 },
    });
    assert(empty.includes('(none)'), 'empty shows none');

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevDir === undefined) delete process.env.RLHF_FEEDBACK_DIR;
    else process.env.RLHF_FEEDBACK_DIR = prevDir;
  }
  process.exit(failed > 0 ? 1 : 0);
}
