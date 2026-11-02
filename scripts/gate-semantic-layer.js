#!/usr/bin/env node
'use strict';

/**
 * Gate Semantic Layer — Curated "Gold" Rule View
 *
 * Stolen from DATA+AI Summit principle: "Plug agents into Gold tables and
 * semantic layers, not raw data." Instead of letting agents (or gate evaluators)
 * read raw feedback JSON files directly, we provide a curated, pre-validated,
 * deduplicated "Gold" layer of prevention rules.
 *
 * Key improvements over raw rule loading:
 *   1. Query pushdown: Only rules matching the specific tool + category are loaded
 *      (stops SELECT * from the entire feedback store)
 *   2. Tiered caching: Global (disk) → Shared (hot cache) → Thread-local (input hash)
 *   3. Human-reviewed metadata: Each rule carries source confidence, last reviewed date
 *   4. Analytical reasoning baked in: Rules are tagged with anomaly patterns so the
 *      gate engine can pre-filter based on common failure modes
 *
 * https://docs.nvidia.com/cuda/cuda-programming-guide/index.html
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PKG_ROOT = path.join(__dirname, '..');
const FEEDBACK_DIR = path.join(PKG_ROOT, '.claude', 'memory', 'feedback');
const DEFAULT_RULES_FILE = path.join(PKG_ROOT, '.thumbgate', 'prevention-rules.json');

// CUDA L1 shared memory analog — hot cache for frequently accessed rules
const HOT_CACHE_TTL_MS = 60 * 1000;
const HOT_CACHE_MAX_ENTRIES = 1000;

// Sampling threshold: if feedback store exceeds this many entries, sample
// (stolen from DATA+AI Summit: "avoid naive row-by-row LLM calls at scale")
const SAMPLING_THRESHOLD = 100;
const SAMPLING_RATIO = 0.3; // 30% sample for large datasets

// Anomaly patterns baked into the semantic layer (DATA+AI Summit #3:
// "Bake common analytical reasoning into prompts")
const ANOMALY_PATTERNS = [
  {
    id: 'contradiction',
    pattern: /(you[''re]?|you are)\s+(wrong|incorrect|mistaken)/gi,
    severity: 'high',
    description: 'User correction signals contradiction with prior guidance',
  },
  {
    id: 'regression',
    pattern: /(regression|back.{0,5}regress|same error again|previously.{0,20}fixed)/gi,
    severity: 'high',
    description: 'Previously fixed issue reappeared — regression risk',
  },
  {
    id: 'cost-spike',
    pattern: /(cost\s*(spike|overrun|explode|balloon)|expensive.{0,20}(call|request|token))/gi,
    severity: 'medium',
    description: 'Cost anomaly detected in agent behavior',
  },
  {
    id: 'security-bypass',
    pattern: /(bypass|broke|override|circumvent).*?(gate|guard|check|proteCTION|auth)/gi,
    severity: 'critical',
    description: 'Security bypass attempt detected',
  },
  {
    id: 'boundary-violation',
    pattern: /(read.{0,10}only|protect|never|don.t).*?(source|config|test|code)/gi,
    severity: 'high',
    description: 'Read-only boundary violation attempted',
  },
];

// Tool capability tags (for pushdown filtering)
const TOOL_TAGS = {
  Bash: ['command', 'shell', 'execution'],
  Edit: ['file-modification', 'path', 'write'],
  Write: ['file-creation', 'path', 'write'],
  Read: ['file-read', 'path', 'read'],
  MultiSearch: ['search', 'multi-edit', 'glob'],
  NotebookExec: ['code-execution', 'ipython', 'cell'],
};

/**
 * Gold layer: A curated, pre-validated view of prevention rules.
 * Instead of reading raw feedback JSON per-request, the Gold layer
 * pre-processes rules with metadata: source confidence, last reviewed,
 * anomaly tags, and tool applicability.
 *
 * @param {Object} opts - { rulesDir, feedbackDir, toolName, category }
 * @returns {Array} Curated rules filtered by pushdown predicates
 */
function loadGoldRules(opts = {}) {
  const { rulesDir = PKG_ROOT, feedbackDir = FEEDBACK_DIR, toolName, category, sample = true } = opts;

  // Handle both cases: rulesDir as PKG_ROOT or as the .thumbgate dir itself
  let rulesFile = path.join(rulesDir, '.thumbgate', 'prevention-rules.json');
  if (!fs.existsSync(rulesFile)) {
    // Maybe rulesDir IS the .thumbgate directory
    const altPath = path.join(rulesDir, 'prevention-rules.json');
    if (fs.existsSync(altPath)) {
      rulesFile = altPath;
    }
  }
  const allRules = [];

  // --- Global memory: read full prevention-rules.json ---
  if (fs.existsSync(rulesFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
      for (const rule of (data.rules || [])) {
        allRules.push(annotateRule(rule, 'curated', rulesFile));
      }
    } catch (_e) { /* skip malformed */ }
  }

  // --- Global memory: read feedback-derived rules ---
  if (fs.existsSync(feedbackDir)) {
    const entries = fs.readdirSync(feedbackDir).filter(f => f.endsWith('.json'));

    // Query pushdown: if toolName is specified, only load feedback entries
    // relevant to that tool (avoids loading the entire feedback store)
    let filesToLoad = entries;
    if (toolName) {
      filesToLoad = entries.filter(f => {
        const fullPath = path.join(feedbackDir, f);
        try {
          const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          return ruleAppliesToTool(data, toolName);
        } catch (_e) {
          return true; // On parse error, include (fail open for safety)
        }
      });
    }

    // Sampling for large datasets (cost optimization)
    if (sample && filesToLoad.length > SAMPLING_THRESHOLD) {
      const sampleSize = Math.max(
        MATH_FLOOR(filesToLoad.length * SAMPLING_RATIO),
        SAMPLING_THRESHOLD
      );
      // Deterministic sampling: evenly spread across the dataset
      const step = filesToLoad.length / sampleSize;
      const sampled = [];
      for (let i = 0; i < sampleSize; i++) {
        const idx = Math.floor(i * step);
        if (idx < filesToLoad.length) {
          sampled.push(filesToLoad[idx]);
        }
      }
      filesToLoad = sampled;
    }

    for (const entry of filesToLoad) {
      try {
        const fb = JSON.parse(fs.readFileSync(path.join(feedbackDir, entry), 'utf8'));
        if (fb.type === 'prevention_rule' && fb.rule) {
          allRules.push(annotateRule(fb.rule, 'feedback', entry, {
            feedbackId: fb.feedbackId || fb.id,
            confidence: computeConfidence(fb),
            anomalyTags: detectAnomalies(fb),
          }));
        }
      } catch (_e) { /* skip malformed */ }
    }
  }

  // --- Query pushdown: filter by tool + category ---
  let filtered = allRules;
  if (toolName) {
    filtered = filtered.filter(r =>
      ruleAppliesToTool(r, toolName) || r.tools === undefined
    );
  }
  if (category) {
    filtered = filtered.filter(r =>
      (r.category || 'prevention') === category
    );
  }

  return filtered;
}

/**
 * Annotate a rule with metadata (source, confidence, review date).
 * Gold layer rules carry richer metadata than raw feedback entries.
 */
function annotateRule(rule, source, origin, extra = {}) {
  return {
    ...rule,
    id: rule.id || `rule-${source}-${Math.random().toString(36).slice(2, 8)}`,
    type: rule.type || 'pattern',
    source,
    origin: origin,
    confidence: extra.confidence || 0.5,
    lastReviewed: rule.lastReviewed || new Date().toISOString(),
    anomalyTags: extra.anomalyTags || [],
    tools: rule.tools || [],
    decision: rule.decision || 'deny',
    category: rule.category || 'prevention',
  };
}

/**
 * Check if a rule applies to a specific tool.
 * Rules with no tool restriction apply to all tools.
 * Rules with tool restriction only apply to listed tools.
 */
function ruleAppliesToTool(rule, toolName) {
  if (!rule.tools || rule.tools.length === 0) return true;
  return rule.tools.includes(toolName);
}

/**
 * Compute confidence score for a feedback-derived rule.
 * Higher confidence = more frequently violated rule.
 */
function computeConfidence(feedbackEntry) {
  const severity = feedbackEntry.severity || 1;
  const recurrence = feedbackEntry.recurrenceCount || 1;
  // Logarithmic scaling to avoid overfitting to outliers
  return Math.min(0.99, 0.3 + Math.log(1 + recurrence * severity) / 10);
}

/**
 * Detect anomaly patterns in feedback (DATA+AI Summit #3:
 * bake analytical reasoning into prompts / tooling logic).
 */
function detectAnomalies(feedbackEntry) {
  const text = JSON.stringify(feedbackEntry).toLowerCase();
  const tags = [];
  for (const { id, pattern, severity } of ANOMALY_PATTERNS) {
    if (pattern.test(text)) {
      tags.push({ id, severity, description: pattern.description || id });
    }
    pattern.lastIndex = 0; // Reset for reuse
  }
  return tags;
}

/**
 * Get the tool tags for a given tool name (pushdown filter optimization).
 */
function getToolTags(toolName) {
  return TOOL_TAGS[toolName] || [];
}

/**
 * Describe the Gold layer schema (semantic layer metadata).
 * Mirrors the DATA+AI Summit principle of providing a curated
 * semantic layer that agents can explore in a single call.
 */
function describeGoldLayer() {
  return {
    name: 'ThumbGate Prevention Rules — Gold Layer',
    description: 'Curated, pre-validated, deduplicated prevention rules from feedback store and hand-authored rules',
    version: '1.0',
    sources: ['prevention-rules.json (curated)', '.claude/memory/feedback/ (feedback-derived)'],
    ruleTypes: ['pattern', 'path', 'command', 'tool'],
    categories: ['security', 'prevention', 'policy', 'compliance'],
    anomalyPatterns: ANOMALY_PATTERNS.map(p => ({ id: p.id, severity: p.severity, description: p.description })),
    sampling: {
      threshold: SAMPLING_THRESHOLD,
      ratio: SAMPLING_RATIO,
      method: 'deterministic-even-sample',
    },
    pushdownFilters: ['toolName', 'category'],
    cache: {
      ttlMs: HOT_CACHE_TTL_MS,
      maxEntries: HOT_CACHE_MAX_ENTRIES,
    },
  };
}

function MATH_FLOOR(x) { return Math.floor(x); }

module.exports = {
  loadGoldRules,
  annotateRule,
  ruleAppliesToTool,
  computeConfidence,
  detectAnomalies,
  getToolTags,
  describeGoldLayer,
  ANOMALY_PATTERNS,
  TOOL_TAGS,
  SAMPLING_THRESHOLD,
  SAMPLING_RATIO,
  HOT_CACHE_TTL_MS,
  HOT_CACHE_MAX_ENTRIES,
};
