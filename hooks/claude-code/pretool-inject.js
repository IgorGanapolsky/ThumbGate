#!/usr/bin/env node
/**
 * PreToolUse Hook — Contextual Bandit Injection
 *
 * Intercepts Claude Code tool calls and injects targeted warnings for
 * tool+context combinations with low Thompson Sampling reliability scores.
 *
 * How it works:
 *   1. Claude Code fires a PreToolUse hook before each tool call
 *   2. This script derives a compound context key (e.g. "Bash:git_push")
 *   3. Looks up the key in the Thompson model to get reliability (mu)
 *   4. If mu < threshold: injects a warning via additionalContext
 *   5. If mu >= threshold: allows silently (no overhead)
 *
 * Install:
 *   npx rlhf-feedback-loop install-hooks
 *
 * Or manually add to ~/.claude/settings.local.json:
 *   {
 *     "hooks": {
 *       "PreToolUse": [{
 *         "matcher": "*",
 *         "hooks": [{
 *           "type": "command",
 *           "command": "node node_modules/rlhf-feedback-loop/hooks/claude-code/pretool-inject.js"
 *         }]
 *       }]
 *     }
 *   }
 *
 * Performance budget: <50ms (no network, no model loading — just JSON lookups)
 *
 * References:
 *   - Contextual Bandits for LLM Routing (arxiv:2510.07429)
 *   - Neural Thompson Sampling (arxiv:2010.00827)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WEAK_ARM_THRESHOLD = parseFloat(process.env.RLHF_WEAK_THRESHOLD || '0.6');
const MAX_CONTEXT_LEN = 200;

// Model path: project-local first, then global fallback
const PROJECT_MODEL = path.join(process.cwd(), '.rlhf', 'thompson-model.json');
const GLOBAL_MODEL = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.rlhf',
  'thompson-model.json',
);

// ---------------------------------------------------------------------------
// Context Key Derivation
// ---------------------------------------------------------------------------

/**
 * Derive a compound context key from a tool call.
 *
 * Splits flat tool categories into fine-grained keys so that e.g.
 * "git push" failures don't penalize "npm test" reliability.
 *
 * @param {string} toolName - The tool being called (Bash, Edit, Read, etc.)
 * @param {Object} toolInput - The tool's input parameters
 * @returns {string} Compound key like "Bash:git_push" or "Edit:test"
 */
function deriveContextKey(toolName, toolInput) {
  const name = (toolName || '').toLowerCase();

  if (name === 'bash') {
    return 'Bash:' + deriveBashKey(toolInput);
  }
  if (name === 'edit' || name === 'write') {
    return name.charAt(0).toUpperCase() + name.slice(1) + ':' + deriveFileKey(toolInput);
  }
  if (name === 'read') {
    return 'Read:' + deriveReadKey(toolInput);
  }
  if (name === 'glob' || name === 'grep') {
    return name.charAt(0).toUpperCase() + name.slice(1) + ':' + deriveSearchKey(toolInput);
  }

  return 'tool:' + name;
}

function deriveBashKey(input) {
  const cmd = (input.command || input.cmd || '').trim();
  if (/^git\s+push/i.test(cmd)) return 'git_push';
  if (/^git\s+commit/i.test(cmd)) return 'git_commit';
  if (/^git\s+reset/i.test(cmd)) return 'git_reset';
  if (/^git\s+/i.test(cmd)) return 'git_other';
  if (/^npm\s+test/i.test(cmd)) return 'npm_test';
  if (/^npm\s+run/i.test(cmd)) return 'npm_run';
  if (/^npm\s+install/i.test(cmd)) return 'npm_install';
  if (/^(rm|del)\s/i.test(cmd)) return 'destructive';
  if (/^curl\s/i.test(cmd)) return 'network';
  if (/\|\s*(grep|awk|sed)\s/i.test(cmd)) return 'pipe';
  return 'general';
}

function deriveFileKey(input) {
  const filePath = (input.file_path || input.path || '').toLowerCase();
  if (/\.(test|spec)\.[jt]sx?$/.test(filePath) || /__tests__/.test(filePath)) return 'test';
  if (/\.env/.test(filePath)) return 'config';
  if (/package\.json/.test(filePath)) return 'deps';
  if (/\.(yml|yaml)$/.test(filePath) || /\.github/.test(filePath)) return 'ci';
  if (/\.md$/.test(filePath)) return 'docs';
  return 'source';
}

function deriveReadKey(input) {
  const filePath = (input.file_path || input.path || '').toLowerCase();
  if (/\.env/.test(filePath)) return 'config';
  if (/\.(test|spec)\.[jt]sx?$/.test(filePath)) return 'test';
  if (/package\.json/.test(filePath) || /node_modules/.test(filePath)) return 'deps';
  return 'source';
}

function deriveSearchKey(input) {
  const pattern = (input.pattern || input.query || '').toLowerCase();
  if (/\*\.tsx?$/.test(pattern)) return 'typescript';
  if (/\*\.test\./.test(pattern)) return 'test';
  return 'general';
}

// ---------------------------------------------------------------------------
// Model Lookup
// ---------------------------------------------------------------------------

/**
 * Load the Thompson model from disk. Returns null if not found.
 * Checks project-local path first, then global fallback.
 */
function loadModel() {
  for (const modelPath of [PROJECT_MODEL, GLOBAL_MODEL]) {
    try {
      if (fs.existsSync(modelPath)) {
        return JSON.parse(fs.readFileSync(modelPath, 'utf8'));
      }
    } catch (_) {
      // Corrupted model — skip
    }
  }
  return null;
}

/**
 * Get the reliability (mu = alpha / (alpha + beta)) for a context key.
 * Falls back to the parent tool key, then to 0.5 (uninformative prior).
 */
function getReliability(model, contextKey) {
  if (!model || !model.categories) return 0.5;

  // Exact match
  const cat = model.categories[contextKey];
  if (cat) {
    const total = (cat.alpha || 1) + (cat.beta || 1);
    return (cat.alpha || 1) / total;
  }

  // Fallback: parent key (e.g. "Bash:git_push" → "Bash")
  const parent = contextKey.split(':')[0].toLowerCase();
  const parentCat = model.categories[parent] || model.categories['tool:' + parent];
  if (parentCat) {
    const total = (parentCat.alpha || 1) + (parentCat.beta || 1);
    return (parentCat.alpha || 1) / total;
  }

  return 0.5;
}

// ---------------------------------------------------------------------------
// Warning Lookup
// ---------------------------------------------------------------------------

/**
 * Build a targeted warning message for a weak context key.
 * Uses prevention rules if available, otherwise a generic caution.
 */
function buildWarning(contextKey, mu) {
  const parts = [`CAUTION [${contextKey}]: reliability=${mu.toFixed(3)} (below ${WEAK_ARM_THRESHOLD}).`];

  // Load prevention rules for additional context
  for (const rulesPath of [
    path.join(process.cwd(), '.rlhf', 'prevention-rules.md'),
    path.join(process.env.HOME || '', '.rlhf', 'prevention-rules.md'),
  ]) {
    try {
      if (fs.existsSync(rulesPath)) {
        const rules = fs.readFileSync(rulesPath, 'utf8');
        // Extract rules relevant to this context key
        const keyParts = contextKey.toLowerCase().split(':');
        const relevant = rules
          .split('\n')
          .filter((line) => keyParts.some((k) => line.toLowerCase().includes(k)))
          .slice(0, 3)
          .join(' ');
        if (relevant.length > 10) {
          parts.push('Past issues: ' + relevant.slice(0, MAX_CONTEXT_LEN - parts[0].length));
        }
        break;
      }
    } catch (_) {}
  }

  return parts.join(' ').slice(0, MAX_CONTEXT_LEN);
}

// ---------------------------------------------------------------------------
// Main Hook Handler
// ---------------------------------------------------------------------------

/**
 * Process a PreToolUse hook event from stdin.
 * Outputs JSON with optional additionalContext for weak arms.
 */
function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const event = JSON.parse(input);
      const toolName = event.tool_name || '';
      const toolInput = event.tool_input || {};

      const contextKey = deriveContextKey(toolName, toolInput);
      const model = loadModel();
      const mu = getReliability(model, contextKey);

      if (mu < WEAK_ARM_THRESHOLD) {
        const warning = buildWarning(contextKey, mu);
        const result = { additionalContext: warning };
        process.stdout.write(JSON.stringify(result));
      }
      // Strong arm → output nothing (allow silently)
    } catch (_) {
      // Parse error or unexpected input → allow silently
    }
  });
}

// ---------------------------------------------------------------------------
// Exports (for testing) + CLI entry
// ---------------------------------------------------------------------------

module.exports = {
  deriveContextKey,
  loadModel,
  getReliability,
  buildWarning,
  WEAK_ARM_THRESHOLD,
};

if (require.main === module) {
  main();
}
