'use strict';

/**
 * scripts/audit.js
 * 
 * Heuristic-based AI bill auditor. Finds repeated mistakes in agent transcripts.
 */

const fs = require('fs');
const path = require('path');

const PATTERNS = [
  {
    id: 'force-push-retry',
    name: 'git push --force after correction',
    regex: /git\s+push.*--force/gi,
    tokenEstimate: 6000,
    costPerRepeat: 0.44,
    why: 'Full diff context reload on error.'
  },
  {
    id: 'import-loop',
    name: 'Hallucinated import retry',
    regex: /(Cannot find module|Module not found|import .* from .*error)/gi,
    tokenEstimate: 4000,
    costPerRepeat: 0.12,
    why: 'Re-indexing and path searching.'
  },
  {
    id: 'apology-loop',
    name: '"I apologize" retry cycle',
    regex: /(I apologize|Let me try a different approach|I will now attempt)/gi,
    tokenEstimate: 5000,
    costPerRepeat: 0.15,
    why: 'Reasoning chain reset.'
  }
];

function runAudit(filePath) {
  if (!fs.existsSync(filePath)) {
    return { error: 'File not found: ' + filePath };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const results = [];
  let totalWaste = 0;

  PATTERNS.forEach(p => {
    const matches = (content.match(p.regex) || []).length;
    if (matches > 1) { // It's only a "repeat" if it happens more than once
      const repeats = matches - 1;
      const waste = repeats * p.costPerRepeat;
      totalWaste += waste;
      results.push({
        pattern: p.name,
        occurrences: repeats,
        waste: waste.toFixed(2),
        why: p.why
      });
    }
  });

  return { results, totalWaste: totalWaste.toFixed(2) };
}

module.exports = { runAudit };
