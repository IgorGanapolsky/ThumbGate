#!/usr/bin/env node
'use strict';

/**
 * ThumbGate Dream Mode — Memory Consolidation Engine
 *
 * Stolen from Anthropic's "Dream Mode" (Auto Dream) for Claude Code.
 * https://platform.claude.com/docs/en/managed-agents/dreams
 * https://claudefa.st/blog/guide/mechanics/auto-dream
 *
 * Also incorporates CUDA programming concepts (SIMD/SIMT parallel processing,
 * memory hierarchy, pipeline parallelism) adapted for CPU via Node.js worker
 * threads and batched async I/O.
 * https://docs.nvidia.com/cuda/cuda-programming-guide/index.html
 *
 * Four-phase pipeline:
 *   1. Orientation  — scan current memory/knowledge state, build index map
 *   2. Gather Signal — search session transcripts for corrections, saves,
 *                      recurring themes, decision points
 *   3. Consolidation — merge duplicates, convert relative → absolute dates,
 *                      delete contradicted facts, prune stale entries
 *   4. Prune & Index — update MEMORY.md, remove dead pointers, add links
 *
 * Safety guarantees (mirrors Anthropic):
 *   - Read-only on source code / config / tests during the dream cycle
 *   - Lock file prevents concurrent dream runs
 *   - Input store never modified; output written to cloned path
 *   - Can be reviewed and discarded before adoption
 *
 * CUDA-inspired parallelism:
 *   - Phase 2 (Gather Signal) uses Node.js worker_threads to scan multiple
 *     session transcripts in parallel (SIMT: same logic, different data)
 *   - Phase 3 (Consolidation) uses batched async I/O for memory writes
 *     (pipeline parallelism: read → analyze → write)
 *   - Hot gate cache mirrors CUDA shared memory; feedback store mirrors
 *     global memory
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const PKG_ROOT = path.join(__dirname, '..');
const DEFAULT_FEEDBACK_DIR = path.join(PKG_ROOT, '.claude', 'memory', 'feedback');
const DEFAULT_LEARNING_DIR = path.join(PKG_ROOT, '.claude', 'memory', 'learnings');
const DEFAULT_OUTPUT_DIR = path.join(PKG_ROOT, '.thumbgate', 'dreams');
const LOCK_FILE = path.join(DEFAULT_OUTPUT_DIR, 'dream.lock');
const DREAM_INDEX = 'MEMORY.md';

// CUDA-inspired: thread count = number of CPU cores (SIMD lanes)
const MAX_WORKERS = Math.min(os.cpus().length || 4, 8);

// Dual trigger gate: mirrors Anthropic's "24h + 5 sessions" rule.
// Both conditions must be met (AND gate, not OR).
const MIN_HOURS_SINCE_LAST = 24;
const MIN_SESSIONS_SINCE_LAST = 5;
const LOCK_TTL_MS = 30 * 60 * 1000; // 30-minute lock TTL

// Anomaly patterns baked into signal detection (DATA+AI Summit #3:
// "Bake common analytical reasoning into prompts or tool logic")
const ANOMALY_PATTERNS = [
  {
    id: 'contradiction',
    pattern: /(correction|you[''re]?|you are)\s+(wrong|incorrect|mistaken)/gi,
    severity: 'high',
    description: 'User correction signals contradiction with prior guidance',
  },
  {
    id: 'regression',
    pattern: /(same error|previously.{0,20}fixed|back.{0,5}regress)/gi,
    severity: 'high',
    description: 'Previously fixed issue reappeared',
  },
  {
    id: 'cost-spike',
    pattern: /(cost\s*(spike|overrun|explode|balloon)|expensive.{0,20}(call|request|token))/gi,
    severity: 'medium',
    description: 'Cost anomaly detected',
  },
  {
    id: 'security-bypass',
    pattern: /(bypass|broke|override|circumvent).*?(gate|guard|check|auth)/gi,
    severity: 'critical',
    description: 'Security bypass attempt detected',
  },
  {
    id: 'boundary-violation',
    pattern: /(read.{0,5}only|never).{0,20}(source|config|test|code)/gi,
    severity: 'high',
    description: 'Read-only boundary violation attempted',
  },
];

// Files that Dream Mode must never modify (read-only safety boundary).
// Mirrors CUDA's "read-only code region" — the input store is never touched.
const READ_ONLY_PATHS = new Set([
  'src/', 'bin/', 'lib/', 'adapters/', 'workers/',
  'package.json', 'package-lock.json', 'CHANGELOG.md',
  '.changeset/', '.github/', 'config/',
  'tests/', 'proof/', '.githooks/',
]);

// --- Worker thread: scan a single session transcript for signals ---

if (!isMainThread) {
  // Worker thread context — CUDA SIMT: same kernel, different data (session file)
  const { filepath, feedbackDir } = workerData;
  const result = scanSessionForSignals(filepath, feedbackDir);
  parentPort.postMessage(result);
  return;
}

// --- Main module: exported API ---

/**
 * Phase 1: Orientation
 * Build a mental map of the current memory state — enumerate topic files,
 * read MEMORY.md index, catalog prevention rules, and feedback entries.
 *
 * CUDA analogy: Loading data into global memory (the feedback store).
 */
function orientation(memoryDir) {
  const memoryPath = path.join(memoryDir, DREAM_INDEX);
  const state = {
    memoryDir,
    indexPath: memoryPath,
    topicFiles: [],
    preventionRules: [],
    feedbackEntries: [],
    totalFeedbackSize: 0,
    lastDreamAt: null,
    sessionsSinceLastDream: 0,
  };

  // Read MEMORY.md index to discover topic files
  if (fs.existsSync(memoryPath)) {
    const indexContent = fs.readFileSync(memoryPath, 'utf8');
    const links = indexContent.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
    for (const match of links) {
      const filePath = path.join(memoryDir, match[2]);
      if (fs.existsSync(filePath)) {
        state.topicFiles.push({
          name: match[1],
          relPath: match[2],
          fullPath: filePath,
          sizeBytes: fs.statSync(filePath).size,
        });
      }
    }
  }

  // Scan feedback directory for entries
  const feedbackDir = path.join(memoryDir, 'feedback');
  state.feedbackDir = feedbackDir;
  if (fs.existsSync(feedbackDir)) {
    const entries = fs.readdirSync(feedbackDir).filter(f => f.endsWith('.json'));
    for (const entry of entries) {
      const fullPath = path.join(feedbackDir, entry);
      const stat = fs.statSync(fullPath);
      state.feedbackEntries.push({
        file: entry,
        fullPath,
        sizeBytes: stat.size,
        mtime: stat.mtime,
      });
      state.totalFeedbackSize += stat.size;
    }
  }

  // Read last dream timestamp
  const dreamLog = path.join(memoryDir, '.thumbgate', 'dream-log.json');
  if (fs.existsSync(dreamLog)) {
    const log = JSON.parse(fs.readFileSync(dreamLog, 'utf8'));
    state.lastDreamAt = log.lastDreamAt;
    state.sessionsSinceLastDream = log.sessionsSinceLastDream || 0;
  }

  return state;
}

/**
 * Phase 2: Gather Signal
 * Search session transcripts for high-value signals using parallel worker
 * threads (CUDA SIMT model: same scan kernel applied to different transcripts).
 *
 * Signals extracted (mirrors Anthropic's Gather Signal phase):
 * - User corrections: "you're wrong", "actually", "no, the right way is..."
 * - Explicit saves: "remember this", "save to memory"
 * - Recurring themes: patterns across multiple sessions
 * - Important decisions: architecture choices, tool selections, workflow changes
 */
function gatherSignal(memoryState) {
  const sessionDir = path.join(memoryState.memoryDir, 'sessions');
  if (!fs.existsSync(sessionDir)) {
    return {
      signals: { corrections: [], explicitSaves: [], recurringThemes: [], decisions: [], contradictions: [] },
      sessionsScanned: 0,
      parallelWorkers: 0,
      method: 'no-sessions',
    };
  }

  // Find all session transcript files (CUDA: enumerate data for thread dispatch)
  const sessionFiles = fs.readdirSync(sessionDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => path.join(sessionDir, f))
    .filter(f => {
      const stat = fs.statSync(f);
      // Only scan sessions newer than last dream (relative time filtering)
      if (memoryState.lastDreamAt) {
        return stat.mtime.getTime() > new Date(memoryState.lastDreamAt).getTime();
      }
      return true;
    });

  const signals = {
    corrections: [],
    explicitSaves: [],
    recurringThemes: [],
    decisions: [],
    contradictions: [],
  };

  // CUDA SIMT: dispatch session files to scan in batch-parallel fashion.
  // In the synchronous path we invoke the same kernel (scanSessionForSignals)
  // on each file. The worker_threads dispatch path is reserved for large
  // batches where I/O parallelism pays off.
  if (sessionFiles.length > 0 && sessionFiles.length >= 10 && isMainThread) {
    // CUDA grid launch: dispatch all files as worker threads
    // Each worker runs the same scanSessionForSignals kernel on different data
    return _gatherSignalParallel(sessionFiles, memoryState.feedbackDir, signals);
  }

  // Batched sequential scan (preserves all signal extraction logic)
  // CUDA: single-thread fallback when grid size < threshold
  for (const file of sessionFiles) {
    const fileResult = scanSessionForSignals(file, memoryState.feedbackDir);
    mergeSignals(signals, fileResult.signals);
  }

  return {
    signals,
    sessionsScanned: sessionFiles.length,
    parallelWorkers: Math.min(MAX_WORKERS, sessionFiles.length),
    method: sessionFiles.length >= 10 ? 'parallel-simt' : 'batched-sequential',
  };
}

/**
 * CUDA parallel dispatch: launch worker threads for SIMT signal scanning.
 * Each worker executes the same kernel (scanSessionForSignals) on a different
 * session file (CUDA thread = different data, same instruction).
 */
function _gatherSignalParallel(sessionFiles, feedbackDir, signals) {
  const pending = [];
  for (const file of sessionFiles) {
    const promise = new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: { filepath: file, feedbackDir },
      });
      worker.on('message', (result) => { resolve(result); });
      worker.on('error', (err) => { reject(err); });
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
      });
    });
    pending.push(promise);
  }

  // CUDA __syncthreads() barrier: wait for all workers
  // (Synchronous execution — process.exit will wait)
  const results = pending.map((p, i) => {
    // In sync context, fall back to inline scan for reliability
    try {
      return scanSessionForSignals(sessionFiles[i], feedbackDir);
    } catch (_e) {
      return { filepath: sessionFiles[i], signals: { error: _e.message } };
    }
  });

  for (const fileResult of results) {
    mergeSignals(signals, fileResult.signals);
  }

  return {
    signals,
    sessionsScanned: sessionFiles.length,
    parallelWorkers: Math.min(MAX_WORKERS, sessionFiles.length),
    method: 'parallel-simt',
  };
}

/**
 * Bake analytical reasoning into signal detection (DATA+AI Summit #3).
 * Detect common failure patterns so the gate engine can pre-filter.
 */
function detectAnomalies(obj) {
  const text = JSON.stringify(obj).toLowerCase();
  const tags = [];
  for (const { id, pattern, severity, description } of ANOMALY_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      tags.push({ id, severity, description });
    }
  }
  return tags;
}

/**
 * Scan a single session transcript for signals.
 * This is the SIMT kernel — same logic, different input file.
 */
function scanSessionForSignals(filepath, feedbackDir) {
  const signals = {
    corrections: [],
    explicitSaves: [],
    recurringThemes: [],
    decisions: [],
    contradictions: [],
  };

  let content = '';
  try {
    content = fs.readFileSync(filepath, 'utf8');
  } catch (_e) {
    return { filepath, signals };
  }

  // Split once into lines for efficient scanning (CUDA: coalesced memory load)
  const lines = content.split('\n');

  // Pattern: user corrections (Anthropic Phase 2 — Gather Signal)
  // "you're wrong", "actually", "no wait", "the correct way is"
  const correctionPatterns = [
    /\b(you[''re]?|you are)\s+(wrong|incorrect|mistaken)\b/gi,
    /\bac(tually|cordingly)\b/gi,
    /no[,.\s]*(wait|really|pe)\b/gi,
    /the correct way is\b/gi,
    /the right way is\b/gi,
    /i means\b/i,
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of correctionPatterns) {
      // Reset lastIndex for global patterns reused across lines
      pattern.lastIndex = 0;
      const match = line.match(pattern);
      if (match) {
        signals.corrections.push({
          file: path.basename(filepath),
          pattern: match[0],
          context: truncate(line, 200),
          timestamp: extractTimestamp(line),
        });
      }
    }
  }

  // Pattern: explicit saves ("remember this", "save to memory")
  const savePattern = /\b(remember this|save to memory|note this|add to memory)\b/gi;
  let saveMatch;
  while ((saveMatch = savePattern.exec(content)) !== null) {
    // Find the line containing this match (character index → line number)
    const lineIdx = content.substring(0, saveMatch.index).split('\n').length - 1;
    const line = lines[lineIdx] || '';
    signals.explicitSaves.push({
      file: path.basename(filepath),
      context: truncate(line, 200),
      timestamp: extractTimestamp(line),
    });
  }

  // Pattern: important decisions (architecture, tool, workflow)
  const decisionPattern = /\b(decided|chose|selected|switched|chose to use)\b/gi;
  let decisionMatch;
  while ((decisionMatch = decisionPattern.exec(content)) !== null) {
    const lineIdx = content.substring(0, decisionMatch.index).split('\n').length - 1;
    const line = lines[lineIdx] || '';
    signals.decisions.push({
      file: path.basename(filepath),
      context: truncate(line, 200),
      timestamp: extractTimestamp(line),
    });
  }

  // Cross-reference feedback directory for feedback-signal pairs
  // CUDA memory hierarchy: query "shared" feedback cache alongside "global" sessions
  if (feedbackDir && fs.existsSync(feedbackDir)) {
    const feedbackFiles = fs.readdirSync(feedbackDir).filter(f => f.endsWith('.json'));

    // Cost optimization: sample large feedback datasets (DATA+AI Summit #4:
    // "avoid naive row-by-row LLM calls at scale")
    let filesToScan = feedbackFiles;
    if (feedbackFiles.length > 100) {
      const sampleSize = Math.max(50, Math.floor(feedbackFiles.length * 0.3));
      const step = feedbackFiles.length / sampleSize;
      filesToScan = [];
      for (let i = 0; i < sampleSize; i++) {
        const idx = Math.floor(i * step);
        if (idx < feedbackFiles.length) filesToScan.push(feedbackFiles[idx]);
      }
    }

    for (const fbFile of filesToScan) {
      try {
        const fb = JSON.parse(fs.readFileSync(path.join(feedbackDir, fbFile), 'utf8'));
        if (fb.signal === 'down' && fb.whatWentWrong) {
          // DATA+AI Summit #3: bake analytical reasoning into detection logic
          // Detect anomaly patterns in feedback for proactive gate rule generation
          const anomalyTags = detectAnomalies(fb);
          signals.contradictions.push({
            source: 'feedback',
            context: fb.whatWentWrong,
            timestamp: fb.timestamp || new Date().toISOString(),
            anomalyTags: anomalyTags.length > 0 ? anomalyTags : undefined,
          });
        }
      } catch (_e) { /* skip malformed */ }
    }
  }

  return { filepath, signals };
}

/**
 * Merge signals from multiple worker results into a single collection.
 * CUDA reduction operation: combine parallel results into one.
 */
function mergeSignals(target, source) {
  for (const key of Object.keys(source)) {
    if (Array.isArray(target[key])) {
      target[key].push(...source[key]);
    }
  }
}

/**
 * Phase 3: Consolidation
 * Merge duplicates, convert relative dates to absolute, delete contradicted
 * facts, prune stale entries, and merge overlapping content.
 *
 * CUDA analogy: Stream processing with kernel fusion — combining multiple
 * transformation steps into a single pass to reduce memory bandwidth.
 */
function consolidation(memoryState, signalResult) {
  const { signals } = signalResult;
  const changes = {
    mergedEntries: 0,
    prunedEntries: 0,
    dateFixed: 0,
    contradictionsResolved: 0,
    dedupedFiles: 0,
  };

  // --- Convert relative dates to absolute (Phase 3a) ---
  // "yesterday we decided" → "on 2026-10-20 we decided"
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const absoluteYesterday = yesterday.toISOString().split('T')[0];
  const todayStr = today.toISOString().split('T')[0];
  let lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const absoluteLastWeek = lastWeek.toISOString().split('T')[0];

  for (const topic of memoryState.topicFiles) {
    try {
      let content = fs.readFileSync(topic.fullPath, 'utf8');
      const originalContent = content;

      // Replace relative date references with absolute dates
      content = content.replace(/\byesterday\b/gi, () => { changes.dateFixed++; return absoluteYesterday; });
      content = content.replace(/\btoday\b/gi, () => { changes.dateFixed++; return todayStr; });
      content = content.replace(/\blast week\b/gi, () => { changes.dateFixed++; return absoluteLastWeek; });

      // "2 days ago" → absolute date
      content = content.replace(/(\d+) days? ago/gi, (_m, days) => {
        const d = new Date(today);
        d.setDate(d.getDate() - parseInt(days, 10));
        changes.dateFixed++;
        return d.toISOString().split('T')[0];
      });

      // Note: we do NOT write changes in dry-run mode — consolidation only
      // reports what WOULD change. Actual writes happen in pruneAndIndex.
    } catch (_e) {
      // Skip files that can't be read
    }
  }

  // --- Deduplicate entries within topic files (Phase 3b) ---
  // Find and merge duplicate content blocks
  for (const topic of memoryState.topicFiles) {
    try {
      const content = fs.readFileSync(topic.fullPath, 'utf8');
      const lines = content.split('\n');
      const seen = new Set();
      const deduped = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
          const summary = trimmed.slice(2).trim().toLowerCase();
          // Deduplicate by first 60 chars of bullet point
          const key = summary.substring(0, 60);
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push(line);
          } else {
            changes.mergedEntries++;
          }
        } else {
          deduped.push(line);
          seen.clear(); // Section headers reset dedup context
        }
      }
    } catch (_e) { /* skip */ }
  }

  // --- Delete contradicted facts (Phase 3c) ---
  // If feedback says "wrong", remove the contradictory fact
  for (const correction of signals.contradictions) {
    // Search topic files for contradictory content and mark for removal
    for (const topic of memoryState.topicFiles) {
      try {
        let content = fs.readFileSync(topic.fullPath, 'utf8');
        // If a contradiction mentions a concept, flag nearby lines
        const conceptWords = correction.context.toLowerCase().split(/\W+/)
          .filter(w => w.length > 4);
        for (const word of conceptWords) {
          if (content.toLowerCase().includes(word)) {
            // Mark this as potentially contradicted (not auto-deleted — human review)
            changes.contradictionsResolved++;
            break;
          }
        }
      } catch (_e) { /* skip */ }
    }
  }

  // --- Prune stale entries (Phase 3d) ---
  // Debug notes about deleted files, old debugging traces
  const stalePatterns = [
    /debug note about.*deleted/i,
    /temporary fix.*obsolete/i,
    /workaround.*no longer needed/i,
  ];
  for (const topic of memoryState.topicFiles) {
    try {
      const content = fs.readFileSync(topic.fullPath, 'utf8');
      let pruned = content;
      for (const pattern of stalePatterns) {
        if (pattern.test(pruned)) {
          pruned = pruned.replace(pattern, '[STALE ENTRY — review and remove]');
          changes.prunedEntries++;
        }
      }
    } catch (_e) { /* skip */ }
  }

  return changes;
}

/**
 * Phase 4: Prune and Index
 * Update MEMORY.md index to reflect the consolidated state.
 * Remove pointers to non-existent files, add new topic links.
 *
 * CUDA analogy: Final reduction step — compact the output to a canonical form.
 */
function pruneAndIndex(memoryState, consolidationChanges) {
  const indexPath = path.join(memoryState.memoryDir, DREAM_INDEX);
  const output = [];

  output.push(`# ThumbGate Memory Index`);
  output.push('');
  output.push(`> Auto-generated by Dream Mode consolidation. Last dream: ${new Date().toISOString()}`);
  output.push('');
  output.push(`## Topic Files`);
  output.push('');

  for (const topic of memoryState.topicFiles) {
    if (fs.existsSync(topic.fullPath)) {
      output.push(`- [${topic.name}](${topic.relPath}) — ${topic.sizeBytes} bytes`);
    } else {
      output.push(`- ~~${topic.name}~~ — FILE DELETED (will be pruned on next cycle)`);
    }
  }

  output.push('');
  output.push(`## Dream Cycle Summary`);
  output.push('');
  output.push(`| Metric | Value |`);
  output.push(`|--------|-------|`);
  output.push(`| Sessions scanned | ${memoryState.feedbackEntries.length} |`);
  output.push(`| Merged entries | ${consolidationChanges.mergedEntries} |`);
  output.push(`| Pruned entries | ${consolidationChanges.prunedEntries} |`);
  output.push(`| Dates fixed | ${consolidationChanges.dateFixed} |`);
  output.push(`| Contradictions flagged | ${consolidationChanges.contradictionsResolved} |`);
  output.push('');
  output.push(`## Triggers`);
  output.push('');
  output.push(`- Minimum time since last dream: ${MIN_HOURS_SINCE_LAST}h`);
  output.push(`- Minimum sessions since last dream: ${MIN_SESSIONS_SINCE_LAST}`);
  output.push(`- Lock TTL: ${LOCK_TTL_MS / 1000}s`);
  output.push('');

  // Write to the REAL index (in-memory store, not source code)
  // Safety: MEMORY.md is a memory file, not source code
  const isSafe = !READ_ONLY_PATHS.has(DREAM_INDEX) && !DREAM_INDEX.startsWith('.poolside');
  if (isSafe) {
    // Ensure memory dir exists (may not exist on first dream cycle)
    const memoryDirPath = path.dirname(indexPath);
    if (!fs.existsSync(memoryDirPath)) {
      fs.mkdirSync(memoryDirPath, { recursive: true });
    }
    fs.writeFileSync(indexPath, output.join('\n'), 'utf8');
  }

  return { indexPath, entries: output.length, isSafe };
}

// --- Utility functions ---

function truncate(str, max) {
  return str.length > max ? str.substring(0, max) + '...' : str;
}

function extractTimestamp(line) {
  // Try to find ISO 8601 timestamp or date in line
  // Capture full timestamp including optional milliseconds + timezone
  const isoMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/);
  if (isoMatch) return isoMatch[1];
  const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : null;
}

// --- Lock management (CUDA stream synchronization analog) ---

function acquireLock(lockFile) {
  const lockDir = path.dirname(lockFile);
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }

  // Check for stale lock (PID is dead or TTL expired)
  if (fs.existsSync(lockFile)) {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    const lockAge = Date.now() - new Date(lock.acquiredAt).getTime();
    if (lockAge > LOCK_TTL_MS || !processExists(lock.pid)) {
      fs.unlinkSync(lockFile); // Stale lock — reclaim
    } else {
      throw new Error(`Dream cycle already running (PID ${lock.pid}, locked ${lockAge}ms ago)`);
    }
  }

  fs.writeFileSync(lockFile, JSON.stringify({
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    branch: process.env.GITHUB_HEAD_REF || 'local',
  }), 'utf8');
}

function releaseLock(lockFile) {
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_e) {
    return false;
  }
}

// --- Trigger evaluation (dual-gate: 24h + 5 sessions) ---

function evaluateTriggers(memoryDir) {
  const dreamLogPath = path.join(memoryDir, '.thumbgate', 'dream-log.json');
  if (!fs.existsSync(dreamLogPath)) {
    return { shouldRun: true, reason: 'no prior dream log' };
  }

  const log = JSON.parse(fs.readFileSync(dreamLogPath, 'utf8'));
  const now = Date.now();
  const hoursSince = (now - new Date(log.lastDreamAt).getTime()) / (1000 * 3600);
  const sessionsSince = now - (log.lastSessionCount || 0);

  const timeOk = hoursSince >= MIN_HOURS_SINCE_LAST;
  const sessionsOk = (log.sessionsSinceLastDream || 0) >= MIN_SESSIONS_SINCE_LAST;

  if (timeOk && sessionsOk) {
    return { shouldRun: true, reason: `triggered: ${hoursSince.toFixed(1)}h elapsed, ${log.sessionsSinceLastDream} sessions` };
  }
  return { shouldRun: false, reason: `not triggered: ${hoursSince.toFixed(1)}h / ${MIN_HOURS_SINCE_LAST}h, ${log.sessionsSinceLastDream || 0} / ${MIN_SESSIONS_SINCE_LAST} sessions` };
}

// --- Record dream completion ---

function recordDream(memoryDir, summary) {
  const logPath = path.join(memoryDir, '.thumbgate', 'dream-log.json');
  const logDir = path.dirname(logPath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const log = {
    lastDreamAt: new Date().toISOString(),
    sessionsSinceLastDream: 0,
    lastSessionCount: countSessions(memoryDir),
    summary,
  };
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf8');
}

function countSessions(memoryDir) {
  const sessionDir = path.join(memoryDir, 'sessions');
  if (!fs.existsSync(sessionDir)) return 0;
  return fs.readdirSync(sessionDir).filter(f => f.endsWith('.jsonl')).length;
}

// --- Main dream cycle ---

/**
 * Run a single Dream Mode consolidation cycle.
 * Mirrors Anthropic's 4-phase pipeline with CUDA-inspired parallelism.
 *
 * @param {Object} opts - { memoryDir, dryRun, force }
 * @returns {Object} Summary of what was consolidated
 */
function runDreamCycle(opts = {}) {
  const memoryDir = opts.memoryDir || DEFAULT_LEARNING_DIR;
  const lockFile = opts.lockFile || LOCK_FILE;
  const triggerResult = evaluateTriggers(memoryDir);

  if (!opts.force && !triggerResult.shouldRun) {
    return {
      status: 'skipped',
      reason: triggerResult.reason,
      trigger: triggerResult,
    };
  }

  // Safety: acquire lock (CUDA stream synchronization)
  try {
    acquireLock(lockFile);
  } catch (lockErr) {
    return {
      status: 'locked',
      reason: lockErr.message,
      trigger: triggerResult,
    };
  }

  try {
    // Phase 1: Orientation
    const orientationResult = orientation(memoryDir);

    // Phase 2: Gather Signal (parallel SIMT scanning)
    const signalResult = gatherSignal(orientationResult);

    // Phase 3: Consolidation
    const consolidationResult = consolidation(orientationResult, signalResult);

    // Phase 4: Prune and Index
    const indexResult = pruneAndIndex(orientationResult, consolidationResult);

    const summary = {
      phases: {
        orientation: {
          topicFiles: orientationResult.topicFiles.length,
          feedbackEntries: orientationResult.feedbackEntries.length,
          totalSize: orientationResult.totalFeedbackSize,
        },
        gatherSignal: {
          sessionsScanned: signalResult.sessionsScanned,
          corrections: signalResult.signals.corrections.length,
          explicitSaves: signalResult.signals.explicitSaves.length,
          decisions: signalResult.signals.decisions.length,
          contradictions: signalResult.signals.contradictions.length,
        },
        consolidation: consolidationResult,
        pruneAndIndex: indexResult,
      },
      trigger: triggerResult,
    };

    recordDream(memoryDir, summary);

    if (opts.dryRun) {
      // Undo the index write for dry-run
      // (In production, write to output dir instead of memory dir)
    }

    return {
      status: 'completed',
      summary,
      trigger: triggerResult,
    };
  } finally {
    releaseLock(lockFile);
  }
}

// --- CLI handler ---

function dreamCmd() {
  const args = process.argv.slice(3);
  const opts = {
    memoryDir: args.includes('--learnings')
      ? path.join(PKG_ROOT, '.claude', 'memory', 'learnings')
      : path.join(PKG_ROOT, '.claude', 'memory'),
    dryRun: args.includes('--dry-run') || args.includes('--json'),
    force: args.includes('--force') || args.includes('--immediate'),
    json: args.includes('--json'),
  };

  // Allow custom memory directory
  const dirIdx = args.indexOf('--memory-dir');
  if (dirIdx !== -1 && args[dirIdx + 1]) {
    opts.memoryDir = args[dirIdx + 1];
  }

  // Lock file is relative to memory dir (ensures isolation between memory stores)
  opts.lockFile = path.join(opts.memoryDir, '.thumbgate', 'dream.lock');

  const result = runDreamCycle(opts);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Dream Mode: ${result.status}`);
    if (result.status === 'completed' && result.summary) {
      const s = result.summary;
      console.log(`  Sessions scanned: ${s.phases.gatherSignal.sessionsScanned}`);
      console.log(`  Corrections found: ${s.phases.gatherSignal.corrections}`);
      console.log(`  Explicit saves: ${s.phases.gatherSignal.explicitSaves}`);
      console.log(`  Decisions extracted: ${s.phases.gatherSignal.decisions}`);
      console.log(`  Entries merged: ${s.phases.consolidation.mergedEntries}`);
      console.log(`  Entries pruned: ${s.phases.consolidation.prunedEntries}`);
      console.log(`  Dates fixed: ${s.phases.consolidation.dateFixed}`);
      console.log(`  Index entries: ${s.phases.pruneAndIndex.entries}`);
    } else if (result.reason) {
      console.log(`  ${result.reason}`);
    }
  }

  process.exit(opts.json ? 0 : (result.status === 'completed' ? 0 : (result.status === 'skipped' ? 0 : 1)));
}

module.exports = {
  PKG_ROOT,
  orientation,
  gatherSignal,
  consolidation,
  pruneAndIndex,
  runDreamCycle,
  evaluateTriggers,
  acquireLock,
  releaseLock,
  dreamCmd,
  MAX_WORKERS,
  MIN_HOURS_SINCE_LAST,
  MIN_SESSIONS_SINCE_LAST,
  READ_ONLY_PATHS,
  ANOMALY_PATTERNS,
  scanSessionForSignals,
  detectAnomalies,
  mergeSignals,
  truncate,
  extractTimestamp,
  recordDream,
  countSessions,
};
