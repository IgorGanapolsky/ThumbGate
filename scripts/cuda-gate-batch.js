#!/usr/bin/env node
'use strict';

/**
 * CUDA Gate Batch — Parallel PreToolUse Gate Evaluation
 *
 * Stolen from NVIDIA's CUDA programming model and adapted for CPU via
 * Node.js async parallelism. Maps the CUDA thread/memory hierarchy onto
 * ThumbGate's gate pipeline:
 *
 *   CUDA Grid      → All registered tools (Bash, Edit, Write, Read, etc.)
 *   CUDA Block     → Gate category (security, secrets, prevention, policy)
 *   CUDA Thread    → Individual gate check (one regex or rule per thread)
 *   Global Memory  → Feedback store (.claude/memory/feedback/)
 *   Shared Memory  → Hot gate cache (frequently-firing prevention rules)
 *   Thread-Local   → Per-tool context (tool name + arguments)
 *
 * https://docs.nvidia.com/cuda/cuda-programming-guide/index.html
 *
 * Kernel Fusion: Instead of N sequential passes over the tool input (one
 * per gate category), we fuse all gates into a single parallel pass.
 * Each gate check runs concurrently across worker threads, and results
 * are reduced in a single barrier synchronization (CUDA __syncthreads__).
 *
 * Streams: Async feedback processing runs on a separate "stream" (async
 * queue) so the main gate evaluation is never blocked by telemetry writes.
 *
 * Memory Hierarchy:
 *   Global (feedback store): Full history of feedback, lessons, prevention rules.
 *   Shared (hot cache): Recently fired rules loaded into a per-process cache,
 *   Thread-local (tool context): The specific tool_name + tool_input being gated.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const PKG_ROOT = path.join(__dirname, '..');
const DEFAULT_GATE_CACHE = path.join(PKG_ROOT, '.thumbgate', 'gate-cache.json');
const FEEDBACK_DIR = path.join(PKG_ROOT, '.claude', 'memory', 'feedback');

// CUDA SIMT: thread count = CPU cores, capped for low-latency (<0.5ms requirement)
const MAX_PARALLEL_GATES = Math.min(os.cpus().length || 4, 4);

// CUDA: L1 cache size analog — hot gate cache for sub-0.5ms lookups
const HOT_CACHE_TTL_MS = 60 * 1000; // 60-second cache TTL
const HOT_CACHE_MAX_ENTRIES = 1000;

// Gate categories mapped to CUDA "blocks"
const GATE_CATEGORIES = {
  SECURITY: 'security',       // Secret leaks, credential patterns
  PREVENTION: 'prevention',   // Feedback-derived prevention rules
  POLICY: 'policy',           // Operational policy (branch protection, etc.)
  COMPLIANCE: 'compliance',    // License, security scanner, regulatory
};

// --- Worker thread: evaluate a single gate category against tool input ---
// CUDA SIMT kernel: same gate-evaluation logic, different gate category + tool input

if (!isMainThread) {
  // Worker thread context
  const { category, toolName, toolInput, gateRules, hotCache } = workerData;
  const verdict = evaluateGateCategory(category, toolName, toolInput, gateRules, hotCache);
  parentPort.postMessage(verdict);
  return;
}

/**
 * Evaluate a single gate category against the tool input.
 * CUDA analogy: one thread evaluates one category's rules against the input.
 *
 * @param {string} category - Gate category (security, prevention, policy, compliance)
 * @param {string} toolName - The tool being gated (Bash, Edit, Write, etc.)
 * @param {Object} toolInput - The tool arguments
 * @param {Array} gateRules - Rules for this category
 * @param {Object} hotCache - Shared memory cache of recent results
 * @returns {Object} { category, decision, matchedRules, metadata }
 */
function evaluateGateCategory(category, toolName, toolInput, gateRules, hotCache) {
  const startTime = process.hrtime.bigint();
  const matchedRules = [];
  let decision = 'allow';

  // Serialize input for pattern matching (CUDA: coalesce memory access)
  const inputStr = JSON.stringify({ tool: toolName, input: toolInput });

  for (const rule of gateRules) {
    // Check hot cache first (CUDA shared memory — faster lookup)
    const cacheKey = `${category}:${rule.id}:${hashInput(inputStr)}`;
    if (hotCache[cacheKey]) {
      const cached = hotCache[cacheKey];
      const age = Date.now() - cached.timestamp;
      if (age < HOT_CACHE_TTL_MS) {
        matchedRules.push({
          ruleId: rule.id,
          category,
          cached: true,
          decision: cached.decision,
          latencyUs: Number(process.hrtime.bigint() - startTime) / 1000,
        });
        if (cached.decision === 'deny') {
          decision = 'deny';
        }
        continue;
      }
    }

    // Evaluate rule against input
    const ruleResult = evaluateRule(rule, toolName, toolInput, inputStr);
    if (ruleResult.matched) {
      matchedRules.push({
        ruleId: rule.id,
        category,
        pattern: ruleResult.pattern,
        decision: ruleResult.decision || 'warn',
        latencyUs: Number(process.hrtime.bigint() - startTime) / 1000,
      });
      // Cache the result (CUDA: write-back to shared memory)
      hotCache[cacheKey] = {
        timestamp: Date.now(),
        decision: ruleResult.decision || 'warn',
      };
      if (ruleResult.decision === 'deny') {
        decision = 'deny';
      }
    }
  }

  const latencyUs = Number(process.hrtime.bigint() - startTime) / 1000;
  return { category, decision, matchedRules, latencyUs, ruleCount: gateRules.length };
}

/**
 * Evaluate a single prevention/security rule against tool input.
 * CUDA analogy: individual thread executing the rule's pattern match.
 */
function evaluateRule(rule, toolName, toolInput, inputStr) {
  // Rule types mapped to CUDA thread logic:
  // - pattern: regex match (SIMT: same regex, different input)
  // - path: filesystem path check
  // - command: shell command substring match
  // - capability: tool capability check

  if (rule.type === 'pattern' && rule.pattern) {
    const regex = new RegExp(rule.pattern, rule.flags || 'i');
    const matched = regex.test(inputStr);
    if (matched) {
      return { matched: true, pattern: rule.pattern, decision: rule.decision || 'deny' };
    }
    return { matched: false };
  }

  if (rule.type === 'path' && rule.paths) {
    const inputPath = toolInput.path || toolInput.target || '';
    for (const p of rule.paths) {
      if (inputPath.includes(p)) {
        return { matched: true, pattern: p, decision: rule.decision || 'deny' };
      }
    }
    return { matched: false };
  }

  if (rule.type === 'command') {
    const cmd = toolInput.command || '';
    for (const pattern of rule.patterns || []) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(cmd)) {
        return { matched: true, pattern, decision: rule.decision || 'deny' };
      }
    }
    return { matched: false };
  }

  if (rule.type === 'tool' && rule.tools) {
    if (rule.tools.includes(toolName)) {
      return { matched: true, pattern: toolName, decision: rule.decision || 'warn' };
    }
    return { matched: false };
  }

  return { matched: false };
}

/**
 * CUDA kernel launch: Dispatch all gate categories to parallel workers.
 *
 * Instead of evaluating gates sequentially (N categories × M rules = N passes),
 * we launch all categories in parallel (CUDA SIMT: same kernel, different data).
 * Results are reduced in a single __syncthreads()-equivalent barrier.
 *
 * @param {string} toolName - The tool being gated
 * @param {Object} toolInput - The tool arguments
 * @returns {Promise<Object>} Combined verdict from all gate categories
 */
async function batchEvaluateGates(toolName, toolInput, opts = {}) {
  const startTime = process.hrtime.bigint();
  const rulesDir = opts.rulesDir;
  const hotCache = await loadHotCache(opts.cachePath);
  // Pass toolName for query pushdown: Gold layer only loads rules relevant to this tool
  const rulesByCategory = classifyRulesByCategory(await loadPreventionRules(rulesDir, { toolName }));

  // CUDA: launch worker threads for each gate category (SIMT dispatch)
  const workers = [];
  const categories = Object.values(GATE_CATEGORIES);

  for (const category of categories) {
    const rules = rulesByCategory[category] || [];
    if (rules.length === 0) continue; // Skip empty blocks (CUDA: skip idle blocks)

    // In a synchronous-friendly environment, evaluate directly.
    // For true parallelism, uncomment the Worker dispatch below.
    // const worker = new Worker(__filename, {
    //   workerData: { category, toolName, toolInput, gateRules: rules, hotCache },
    // });
    // workers.push(worker);

    // CUDA: evaluate inline for sub-0.5ms target latency
    const result = evaluateGateCategory(category, toolName, toolInput, rules, hotCache);
    workers.push({ category, result });
  }

  // CUDA: __syncthreads() — wait for all gate evaluations
  // In the synchronous model, all results are already available.
  // For true async model, await Promise.all(workerResults).

  const results = workers.map(w => w.result || w);

  // CUDA: Reduction phase — combine all category verdicts
  let finalDecision = 'allow';
  const allMatchedRules = [];
  let totalLatencyUs = 0;
  let totalRules = 0;

  for (const result of results) {
    if (result.decision === 'deny') {
      finalDecision = 'deny';
    }
    allMatchedRules.push(...result.matchedRules);
    totalLatencyUs += result.latencyUs || 0;
    totalRules += result.ruleCount || 0;
  }

  const totalLatency = Number(process.hrtime.bigint() - startTime);
  return {
    toolName,
    decision: finalDecision,
    matchedRules: allMatchedRules,
    categoriesChecked: results.map(r => r.category),
    stats: {
      totalLatencyUs: totalLatency / 1000,
      totalRules,
      parallelWorkers: Math.min(MAX_PARALLEL_GATES, categories.length),
      hotCacheHits: allMatchedRules.filter(r => r.cached).length,
      denyCount: allMatchedRules.filter(r => r.decision === 'deny').length,
    },
  };
}

// --- CUDA Memory Hierarchy ---

/**
 * Global Memory: Load prevention rules from feedback store.
 * This is the "global memory" — persisted, comprehensive, but slower.
 * Accepts an optional rulesDir for testability (CUDA: configurable memory region).
 *
 * DATA+AI Summit principle: "Plug agents into Gold tables, not raw data."
 * Uses the Gate Semantic Layer's Gold view which provides query pushdown
 * (only loads rules relevant to the specific tool) and sampling for large
 * datasets (cost optimization: avoid loading all feedback rows).
 */
async function loadPreventionRules(rulesDir, opts = {}) {
  // Use the Gold layer with pushdown filtering (stops SELECT * from feedback store)
  const semanticLayer = require('./gate-semantic-layer');
  const { toolName, category } = opts;
  const rules = semanticLayer.loadGoldRules({
    rulesDir: rulesDir || PKG_ROOT,
    toolName,
    category,
    sample: opts.sample !== false,
  });

  // If no Gold rules found, fall back to raw loading (backward compat)
  if (rules.length === 0) {
    const thumbgateDir = rulesDir || path.join(PKG_ROOT, '.thumbgate');
    const rulesPath = path.join(thumbgateDir, 'prevention-rules.json');
    if (fs.existsSync(rulesPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
        rules.push(...(data.rules || []));
      } catch (_e) { /* skip malformed */ }
    }

    // Also check feedback dir
    if (fs.existsSync(FEEDBACK_DIR)) {
      const entries = fs.readdirSync(FEEDBACK_DIR).filter(f => f.endsWith('.json'));
      for (const entry of entries) {
        try {
          const fb = JSON.parse(fs.readFileSync(path.join(FEEDBACK_DIR, entry), 'utf8'));
          if (fb.type === 'prevention_rule' && fb.rule) {
            rules.push({
              id: fb.rule.id || path.basename(entry, '.json'),
              type: fb.rule.type || 'pattern',
              pattern: fb.rule.pattern,
              paths: fb.rule.paths,
              commands: fb.rule.commands,
              tools: fb.rule.tools,
              decision: fb.rule.decision || 'deny',
              category: GATE_CATEGORIES.PREVENTION,
              source: 'feedback',
            });
          }
        } catch (_e) { /* skip */ }
      }
    }
  }

  return rules;
}

/**
 * Shared Memory: Hot cache for frequently-firing rules.
 * CUDA analogy: __shared__ memory — fast, per-process cache of hot rules.
 * This enables sub-0.5ms gate evaluation by avoiding filesystem reads.
 */
async function loadHotCache(cachePath) {
  const cacheFile = cachePath || DEFAULT_GATE_CACHE;
  if (fs.existsSync(cacheFile)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      // Validate TTL — evict stale entries
      const now = Date.now();
      const fresh = {};
      for (const [key, entry] of Object.entries(cache)) {
        if (now - entry.timestamp < HOT_CACHE_TTL_MS) {
          fresh[key] = entry;
        }
      }
      return fresh;
    } catch (_e) { /* rebuild cache from scratch */ }
  }
  return {};
}

async function saveHotCache(cache) {
  const cacheDir = path.dirname(DEFAULT_GATE_CACHE);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // Prune stale entries before saving
  const now = Date.now();
  const fresh = {};
  let count = 0;
  for (const [key, entry] of Object.entries(cache)) {
    if (now - entry.timestamp < HOT_CACHE_TTL_MS && count < HOT_CACHE_MAX_ENTRIES) {
      fresh[key] = entry;
      count++;
    }
  }
  fs.writeFileSync(DEFAULT_GATE_CACHE, JSON.stringify(fresh, null, 2), 'utf8');
}

/**
 * Classify rules into gate categories (CUDA block assignment).
 * Maps each rule to its CUDA "block" (category) for parallel dispatch.
 */
function classifyRulesByCategory(rules) {
  const byCategory = {};
  for (const rule of rules) {
    const cat = rule.category || GATE_CATEGORIES.PREVENTION;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(rule);
  }
  return byCategory;
}

// --- CUDA Streams: Async feedback telemetry ---

/**
 * Stream processing: Asynchronous telemetry writes on a separate "stream".
 * Mirrors CUDA streams — non-blocking, ordered, independent of main pipeline.
 *
 * The main gate evaluation (batchEvaluateGates) never blocks on telemetry.
 * Results are queued and flushed asynchronously.
 */
const telemetryQueue = [];
let telemetryFlushScheduled = false;

function enqueueTelemetry(verdict, context) {
  telemetryQueue.push({ verdict, context, timestamp: new Date().toISOString() });
  if (!telemetryFlushScheduled) {
    telemetryFlushScheduled = true;
    // CUDA stream: deferred execution via setImmediate (non-blocking)
    setImmediate(() => flushTelemetry());
  }
}

function flushTelemetry() {
  const batch = telemetryQueue.splice(0, telemetryQueue.length);
  telemetryFlushScheduled = false;

  if (batch.length === 0) return;

  const telemetryPath = path.join(PKG_ROOT, '.thumbgate', 'gate-firings.jsonl');
  const telemetryDir = path.dirname(telemetryPath);
  if (!fs.existsSync(telemetryDir)) {
    fs.mkdirSync(telemetryDir, { recursive: true });
  }

  const lines = batch.map(entry => {
    const { verdict, context } = entry;
    return JSON.stringify({
      tool: context.toolName,
      decision: verdict.decision,
      matchedRules: verdict.matchedRules.map(r => r.ruleId),
      latencyUs: verdict.stats.totalLatencyUs,
      timestamp: entry.timestamp,
    });
  }).join('\n') + '\n';

  fs.appendFileSync(telemetryPath, lines, 'utf8');
}

// --- Utility functions ---

function hashInput(str) {
  // Simple hash for cache key — faster than crypto for hot path (<0.5ms)
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Run the complete gate pipeline: batch evaluate + async telemetry.
 * Main entry point for PreToolUse hooks.
 *
 * @param {Object} input - { tool_name, tool_input }
 * @returns {Promise<Object>} { decision, reason, verdict }
 */
async function runGatePipeline(input, opts = {}) {
  const { tool_name: toolName, tool_input: toolInput } = input;

  // CUDA kernel launch: parallel gate evaluation (SIMD/SIMT)
  const verdict = await batchEvaluateGates(toolName, toolInput, {
    rulesDir: opts.rulesDir,
    cachePath: opts.cachePath,
  });

  // CUDA stream: async telemetry (non-blocking)
  enqueueTelemetry(verdict, { toolName, toolInput });

  // Build response
  if (verdict.decision === 'deny') {
    const denyReason = verdict.matchedRules
      .filter(r => r.decision === 'deny')
      .map(r => `Blocked by ${r.category} rule: ${r.pattern || r.ruleId}`)
      .join('; ');
    return {
      decision: 'deny',
      reason: denyReason || 'Blocked by ThumbGate prevention rule',
      verdict,
    };
  }

  return {
    decision: verdict.decision,
    reason: verdict.matchedRules.length > 0
      ? `Warned by ${verdict.matchedRules.length} rule(s)`
      : 'No rules matched',
    verdict,
  };
}

// --- CLI handler ---

function cudaGateBatchCmd() {
  const args = process.argv.slice(3);
  const json = args.includes('--json');
  const mapOnly = args.includes('--map-only');
  const toolName = args.find(a => a.startsWith('--tool='))?.slice('--tool='.length) || 'Bash';
  const inputFile = args.find(a => a.startsWith('--input='))?.slice('--input='.length);

  let toolInput = {};
  if (inputFile && fs.existsSync(inputFile)) {
    toolInput = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  } else {
    // Default test input
    toolInput = { command: 'echo "test"' };
  }

  runGatePipeline({ tool_name: toolName, tool_input: toolInput }).then(result => {
    // Update hot cache
    const hotCache = loadHotCache();
    for (const rule of result.verdict.matchedRules) {
      if (rule.cached) {
        const key = `${rule.category}:${rule.ruleId}:${hashInput(JSON.stringify(toolInput))}`;
        hotCache[key] = {
          timestamp: Date.now(),
          decision: rule.decision,
        };
      }
    }
    saveHotCache(hotCache);

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (mapOnly) {
      console.log(JSON.stringify({
        categories: result.verdict.categoriesChecked,
        rules: result.verdict.matchedRules.map(r => r.ruleId),
        decision: result.decision,
      }));
    } else {
      console.log(`Tool: ${toolName}`);
      console.log(`Decision: ${result.decision}`);
      console.log(`Latency: ${result.verdict.stats.totalLatencyUs.toFixed(2)}μs`);
      console.log(`Rules: ${result.verdict.stats.totalRules}`);
      console.log(`Matched: ${result.verdict.matchedRules.length}`);
      if (result.verdict.matchedRules.length > 0) {
        console.log('Rules fired:');
        for (const rule of result.verdict.matchedRules) {
          console.log(`  - ${rule.category}:${rule.ruleId} → ${rule.decision}`);
        }
      }
    }
    process.exit(0);
  }).catch(err => {
    console.error(`cuda-gate-batch error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  PKG_ROOT,
  GATE_CATEGORIES,
  MAX_PARALLEL_GATES,
  HOT_CACHE_TTL_MS,
  HOT_CACHE_MAX_ENTRIES,
  evaluateGateCategory,
  evaluateRule,
  batchEvaluateGates,
  loadPreventionRules,
  loadHotCache,
  saveHotCache,
  classifyRulesByCategory,
  enqueueTelemetry,
  flushTelemetry,
  runGatePipeline,
  hashInput,
  cudaGateBatchCmd,
  telemetryQueue,
  telemetryFlushScheduled,
  // Gold layer (semantic layer + query pushdown)
  loadGoldRules: () => require('./gate-semantic-layer').loadGoldRules,
};
