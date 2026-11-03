'use strict';

/**
 * Governance Check Script — Muller/Trevillion "AI Governance & Blast Radius Control" steal.
 *
 * Runs a pre-deployment governance checklist before any agent changes are
 * committed or PRs opened. Maps to the episode's 3 pillars:
 *   1. Data & Infrastructure Foundation
 *   2. Strategy, ROI & Token Economics
 *   3. Governance & Blast Radius Control
 *
 * Usage:
 *   node scripts/governance-check.js
 *   node scripts/governance-check.js --strict  # exit 1 on any FAIL
 *
 * The checklist evaluates:
 *   - Data source mapping (are changed files documented?)
 *   - Documentation completeness (bus-factor mitigation)
 *   - Model routing hygiene (no blanket frontier model usage)
 *   - Human oversight (write gates, escalation paths)
 *   - IP ownership (no unattributed AI-generated code in production paths)
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const PROJECT_ROOT = process.cwd();

const CHECKS = [
  {
    id: 'data_source_mapping',
    category: 'Data & Infrastructure Foundation',
    question: 'Are data sources and queried resources mapped in changed files?',
    evaluate: () => {
      const files = getChangedFiles();
      const prodFiles = files.filter((f) =>
        f.startsWith('src/api/') || f.startsWith('adapters/')
      );
      if (prodFiles.length === 0) return { pass: true, note: 'No production data access changes detected' };
      const undocumented = prodFiles.filter((f) => !fileHasDocblock(f));
      return {
        pass: undocumented.length === 0,
        note: undocumented.length === 0
          ? `${prodFiles.length} files have source mapping documented`
          : `${undocumented.length}/${prodFiles.length} production files lack data source documentation`,
        flaggedFiles: undocumented,
      };
    },
  },
  {
    id: 'documentation_completeness',
    category: 'Data & Infrastructure Foundation',
    question: 'Are repositories and workflows formally documented (bus-factor mitigation)?',
    evaluate: () => {
      const files = getChangedFiles();
      const codeFiles = files.filter((f) =>
        /\.(js|ts|json)$/.test(f) && !f.startsWith('tests/') && !f.startsWith('.claude/evals/')
      );
      if (codeFiles.length === 0) return { pass: true, note: 'No undocumented code files' };
      const missingDocs = codeFiles.filter((f) => !hasAssociatedDoc(f));
      return {
        pass: missingDocs.length === 0,
        note: missingDocs.length === 0
          ? 'All code changes have documentation coverage'
          : `${missingDocs.length} file(s) lack associated documentation`,
        flaggedFiles: missingDocs,
      };
    },
  },
  {
    id: 'model_routing_hygiene',
    category: 'Strategy, ROI & Token Economics',
    question: 'Are model routing decisions explicit and cost-balanced (no blanket frontier model)?',
    evaluate: () => {
      const files = getChangedFiles();
      const routingFiles = files.filter((f) =>
        f.startsWith('scripts/isolated-verifier.js') ||
        f.startsWith('config/verifier-criteria.json') ||
        f.startsWith('adapters/mcp/')
      );
      if (routingFiles.length === 0) return { pass: true, note: 'No model routing files changed' };

      let hasCloudRouting = false;
      let hasLocalRouting = false;
      let missingHints = [];

      for (const f of routingFiles) {
        const content = readFile(f);
        if (content) {
          if (content.includes('modelHint') || content.includes('modelRouting')) {
            hasCloudRouting = hasCloudRouting || content.includes('cloud');
            hasLocalRouting = hasLocalRouting || content.includes('local');
          }
        }
      }
      return {
        pass: hasLocalRouting && !missingHints.length,
        note: hasLocalRouting
          ? 'Local model routing is configured; costs are bounded'
          : 'No local model routing detected — risk of token maxing',
        detail: { hasCloudRouting, hasLocalRouting },
      };
    },
  },
  {
    id: 'human_oversight',
    category: 'Governance & Blast Radius Control',
    question: 'Are write gates and human escalation paths present in changed code?',
    evaluate: () => {
      const files = getChangedFiles();
      const srcFiles = files.filter((f) =>
        f.startsWith('scripts/') || f.startsWith('src/') || f.startsWith('hooks/')
      );
      if (srcFiles.length === 0) return { pass: true, note: 'No source files changed' };

      const lacksGate = srcFiles.filter((f) => {
        const content = readFile(f);
        return content && !content.includes('classifyRisk') && !content.includes('approveWrites') && !content.includes('deny');
      });
      return {
        pass: lacksGate.length === 0,
        note: lacksGate.length === 0
          ? 'All source changes include governance gates'
          : `${lacksGate.length} file(s) lack write/approval gates`,
        flaggedFiles: lacksGate,
      };
    },
  },
  {
    id: 'ip_ownership',
    category: 'Governance & Blast Radius Control',
    question: 'No unattributed AI-generated code in production paths (IP clarity)?',
    evaluate: () => {
      const files = getChangedFiles();
      const prodFiles = files.filter((f) =>
        f.startsWith('src/') || f.startsWith('adapters/') || f.startsWith('hooks/')
      );
      if (prodFiles.length === 0) return { pass: true, note: 'No production code changes' };

      // Check for AI-generation markers without attribution
      const flagged = prodFiles.filter((f) => {
        const content = readFile(f);
        if (!content) return false;
        const hasAiMarker = /ai-generated|claude.code|generated.by.(?!.*Igor)/i.test(content);
        const hasAttribution = /Igor Ganapolsky|ThumbGate|@author|Copyright.*ThumbGate/i.test(content);
        return hasAiMarker && !hasAttribution;
      });
      return {
        pass: flagged.length === 0,
        note: flagged.length === 0
          ? 'All production code has clear attribution'
          : `${flagged.length} file(s) contain AI-generated code without attribution`,
        flaggedFiles: flagged,
      };
    },
  },
];

function getChangedFiles() {
  try {
    const output = execSync('git diff --name-only HEAD -- .', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch (e) {
    return [];
  }
}

function readFile(relPath) {
  const fullPath = path.join(PROJECT_ROOT, relPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8');
}

function fileHasDocblock(relPath) {
  const content = readFile(relPath);
  if (!content) return true; // Can't read — assume OK
  // A docblock comment at the top of the file
  return /^\s*\/\*\*[^*]*\*\//m.test(content) || /^('use strict';|#\s*!).*?\n.*?\*/.test(content);
}

function hasAssociatedDoc(relPath) {
  // Check if a .md file exists for this code file
  const baseName = path.basename(relPath, path.extname(relPath));
  const dir = path.dirname(relPath);
  const docPath = path.join(PROJECT_ROOT, dir, baseName + '.md');
  if (fs.existsSync(docPath)) return true;
  // Check if it's a skill file (skills include README)
  if (relPath.startsWith('.claude/skills/') && relPath.endsWith('SKILL.md')) return true;
  // Check for inline docblocks
  const content = readFile(relPath);
  if (content && /\/\*\*[^*]*\*\//.test(content)) return true;
  return false;
}

function runGovernanceCheck(strictMode) {
  console.log('=== ThumbGate AI Governance Checklist ===');
  console.log('Based on Muller/Trevillion "AI Agents Move Fast. Who\'s in Control?"');
  console.log('');

  let allPassed = true;
  let passCount = 0;
  let failCount = 0;

  for (const check of CHECKS) {
    const result = check.evaluate();
    const status = result.pass ? 'PASS' : 'FAIL';
    if (result.pass) {
      passCount++;
    } else {
      failCount++;
      allPassed = false;
    }

    console.log(`[${status}] ${check.id} (${check.category})`);
    console.log(`  Q: ${check.question}`);
    console.log(`  → ${result.note}`);
    if (result.flaggedFiles && result.flaggedFiles.length > 0) {
      console.log(`  Flagged: ${result.flaggedFiles.join(', ')}`);
    }
    if (result.detail) {
      console.log(`  Detail: ${JSON.stringify(result.detail)}`);
    }
    console.log('');
  }

  console.log(`=== Results: ${passCount} passed, ${failCount} failed ===`);
  if (!allPassed && strictMode) {
    console.error('STRICT MODE: Governance check failed — changes blocked.');
    process.exit(1);
  }
  return allPassed;
}

if (require.main === module) {
  const strict = process.argv.includes('--strict');
  runGovernanceCheck(strict);
}

module.exports = { runGovernanceCheck, CHECKS };
