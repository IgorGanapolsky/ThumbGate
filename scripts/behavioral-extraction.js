#!/usr/bin/env node
/**
 * behavioral-extraction.js
 * 
 * Layer 4: Behavioral Learning
 * Extracts user preference patterns from feedback logs to adjust agent approach.
 */

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const localRlhf = path.join(process.cwd(), '.rlhf');
const localClaude = path.join(process.cwd(), '.claude', 'memory', 'feedback');
const baseDir = fs.existsSync(localRlhf) ? localRlhf : localClaude;

const FEEDBACK_LOG_PATH = path.join(baseDir, 'feedback-log.jsonl');
const TRAITS_PATH = path.join(baseDir, 'behavioral-traits.json');

const TRAIT_DEFINITIONS = [
  {
    id: 'surgical-over-rewrite',
    patterns: [/surgical/i, /targeted/i, /don't rewrite/i, /minimal change/i],
    threshold: 2,
    description: 'User prefers surgical edits over full file rewrites.'
  },
  {
    id: 'concise-over-verbose',
    patterns: [/concise/i, /short/i, /less talk/i, /too much chat/i],
    threshold: 2,
    description: 'User prefers concise, direct communication.'
  },
  {
    id: 'test-driven',
    patterns: [/test first/i, /where is the test/i, /run tests/i, /tdd/i],
    threshold: 2,
    description: 'User prioritizes test coverage and verification.'
  }
];

function extractTraits() {
  if (!fs.existsSync(FEEDBACK_LOG_PATH)) {
    console.log('No feedback log found at', FEEDBACK_LOG_PATH);
    return [];
  }

  const logLines = fs.readFileSync(FEEDBACK_LOG_PATH, 'utf-8').split('\n').filter(Boolean);
  const evidenceCount = {};

  logLines.forEach(line => {
    try {
      const entry = JSON.parse(line);
      const text = `${entry.context || ''} ${entry.whatWorked || ''} ${entry.whatWentWrong || ''} ${entry.whatToChange || ''}`;
      
      TRAIT_DEFINITIONS.forEach(trait => {
        if (trait.patterns.some(p => p.test(text))) {
          evidenceCount[trait.id] = (evidenceCount[trait.id] || 0) + 1;
        }
      });
    } catch (e) {
      // skip malformed lines
    }
  });

  const activeTraits = TRAIT_DEFINITIONS
    .filter(trait => (evidenceCount[trait.id] || 0) >= trait.threshold)
    .map(trait => ({
      id: trait.id,
      description: trait.description,
      evidenceCount: evidenceCount[trait.id]
    }));

  return activeTraits;
}

function run() {
  console.log('🤖 [Layer 4] Extracting behavioral patterns...');
  const traits = extractTraits();
  
  if (traits.length > 0) {
    fs.writeFileSync(TRAITS_PATH, JSON.stringify({
      generatedAt: new Date().toISOString(),
      traits
    }, null, 2));
    console.log(`✅ Extracted ${traits.length} behavioral traits.`);
    traits.forEach(t => console.log(`  - ${t.id} (${t.evidenceCount} evidences)`));
  } else {
    console.log('No strong behavioral patterns identified yet.');
  }
}

if (require.main === module) {
  run();
}

module.exports = { extractTraits };
