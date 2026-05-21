#!/usr/bin/env node
'use strict';

/**
 * Silent-Failure Clustering — Unsupervised candidate source for the meta-agent loop
 *
 * Off by default. Enabled with: THUMBGATE_SILENT_FAILURE_CLUSTERING=1
 *
 * Problem: ThumbGate's HITL loop only learns from explicit thumbs-down. Tool calls
 * that fail without user feedback (exit_code != 0, regex-matched error in output,
 * agent silently recovers) are invisible to `auto-promote-gates.js`. This module
 * mines those silent failures from the JSONL conversation logs, clusters them by
 * (tool, normalized-arg-signature), and emits candidate prevention rules that
 * flow through the EXISTING meta-agent-loop fp-rate eval — never bypassed.
 *
 * Pipeline:
 *   1. Reuse `discoverConversationLogs` from `self-distill-agent.js` to find logs
 *   2. Read each JSONL line; extract tool calls (Bash, Edit, Write, …) with their args
 *      and adjacent tool_result entries that carry exit_code / error text
 *   3. Filter to "failed" calls (exit_code != 0 OR matches one of ERROR_PATTERNS,
 *      mirroring `self-distill-agent.js`)
 *   4. Drop any call whose timestamp is within ±5min of a feedback-log entry —
 *      those are already in the HITL loop and would double-count
 *   5. Normalize args: absolute paths → `<HOME>/…`, redact secrets per the
 *      canonical regex set in `~/.claude/hooks/daily-log-append.sh`
 *   6. Cluster by exact tuple `(tool, normalized-arg-signature)`, min size 3
 *   7. Emit each cluster as a candidate with `origin: 'silent-failure-cluster'`
 *      so meta-agent-loop tags it for downstream precision measurement
 *
 * Known limitations (locked in by the spec):
 *   - Only worthwhile on workspaces generating ≥ 50 tool calls/day. Surfaces
 *     "insufficient data, skipped" cleanly rather than emitting noise.
 *   - Cluster ≠ bad; we rely on the exit_code / ERROR_PATTERNS filter to make
 *     a cluster a *failure* cluster.
 *   - No drift detection. If tools change, old clusters pollute. Out of scope for v1.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  discoverConversationLogs,
} = require('./self-distill-agent');

// Mirrors self-distill-agent.js ERROR_PATTERNS exactly. self-distill does NOT
// export this constant; duplicating here is the smallest-surface choice that
// keeps both modules independently testable. If self-distill ever exports it,
// switch to the import.
const ERROR_PATTERNS = [
  /\bError:/i,
  /\bFAIL\b/,
  /\bnot ok\b/,
  /exit code\s*(?:!=\s*0|[1-9]\d*)/i,
  /\bERROR\b/,
  /\bTypeError\b/,
  /\bReferenceError\b/,
  /\bSyntaxError\b/,
  /\bcommand failed\b/i,
  /\bexited with\s+[1-9]/i,
];

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir() || '';

const MIN_CLUSTER_SIZE = 3;
const MIN_DAILY_CALLS_FOR_USEFUL_CLUSTERING = 50;
const FEEDBACK_PROXIMITY_WINDOW_MS = 5 * 60 * 1000; // ±5 min

// ---------------------------------------------------------------------------
// Redaction — keep in sync with ~/.claude/hooks/daily-log-append.sh
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  // Stripe + GitHub + Slack + AWS + Google + npm + Anthropic keys
  {
    re: /(sk_live_|sk_test_|rk_live_|rk_test_|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xoxb-|xoxp-|xapp-|AKIA|AIza|npm_|sk-ant-[A-Za-z0-9]*-?|sk-proj-|sk-svcacct-)[A-Za-z0-9_-]{8,}/g,
    replacement: '[REDACTED]',
  },
  // JWT (3 base64url segments)
  { re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED-JWT]' },
  // Slack webhook
  { re: /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9/]+/g, replacement: '[REDACTED-SLACK-WEBHOOK]' },
  // Private key header
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED-PRIVATE-KEY-HEADER]' },
];

function redactSecrets(text) {
  let out = String(text == null ? '' : text);
  for (const { re, replacement } of SECRET_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

function normalizePaths(text) {
  let out = String(text == null ? '' : text);
  if (HOME) {
    // Replace exact HOME prefix
    out = out.split(HOME).join('<HOME>');
  }
  // Replace generic /Users/<name>/... and /home/<name>/... that don't match this HOME
  out = out.replace(/\/Users\/[^/\s"']+/g, '<HOME>');
  out = out.replace(/\/home\/[^/\s"']+/g, '<HOME>');
  out = out.replace(/\/tmp\/[A-Za-z0-9._-]+/g, '/tmp/<X>'); // NOSONAR — regex on strings, not filesystem
  out = out.replace(/\/private\/tmp\/[A-Za-z0-9._-]+/g, '/tmp/<X>'); // NOSONAR
  return out;
}

function normalizeForSignature(value) {
  // Order matters: redact first (some secrets contain path-ish chars), then paths.
  return normalizePaths(redactSecrets(value));
}

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

function readJsonlSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tool-call + failure extraction
// ---------------------------------------------------------------------------

/**
 * Extract tool-call records from a parsed transcript entry.
 *
 * Supports two shapes:
 *   (A) Claude Code transcript format:
 *       { type:"assistant", message:{ content:[ { type:"tool_use", name, input, id } ] } }
 *       { type:"user", message:{ content:[ { type:"tool_result", tool_use_id, content, is_error } ] }, toolUseResult: {...} }
 *   (B) Simplified test fixture format:
 *       { type:"tool_call", tool, args, timestamp }
 *       { type:"tool_result", tool_use_id, exit_code, output, timestamp }
 *
 * Both shapes are normalized to:
 *   { kind:'call', tool, args, callId, timestamp }
 *   { kind:'result', callId, exitCode, output, isError, timestamp }
 */
function extractToolEvents(entry) {
  if (!entry || typeof entry !== 'object') return [];
  const events = [];
  const ts = entry.timestamp || entry.ts || null;

  // Shape (B) — test fixture / simplified
  if (entry.type === 'tool_call' && entry.tool) {
    events.push({
      kind: 'call',
      tool: String(entry.tool),
      args: entry.args || entry.input || {},
      callId: entry.callId || entry.id || null,
      timestamp: ts,
    });
    return events;
  }
  if (entry.type === 'tool_result' && (entry.tool_use_id || entry.callId)) {
    events.push({
      kind: 'result',
      callId: entry.tool_use_id || entry.callId,
      exitCode: typeof entry.exit_code === 'number' ? entry.exit_code : (typeof entry.exitCode === 'number' ? entry.exitCode : null),
      output: String(entry.output || entry.content || ''),
      isError: Boolean(entry.is_error || entry.isError),
      timestamp: ts,
    });
    return events;
  }

  // Shape (A) — Claude Code transcript
  const msg = entry.message;
  if (entry.type === 'assistant' && msg && Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part && part.type === 'tool_use' && part.name) {
        events.push({
          kind: 'call',
          tool: String(part.name),
          args: part.input || {},
          callId: part.id || null,
          timestamp: ts,
        });
      }
    }
  }
  if (entry.type === 'user' && msg && Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part && part.type === 'tool_result') {
        const tur = entry.toolUseResult || {};
        const exitCode = typeof tur.stderr === 'string' && tur.stderr.length > 0 && typeof tur.interrupted === 'undefined'
          ? null
          : (typeof tur.exit_code === 'number' ? tur.exit_code : (typeof tur.exitCode === 'number' ? tur.exitCode : null));
        const outputText = typeof part.content === 'string'
          ? part.content
          : (Array.isArray(part.content)
            ? part.content.map((c) => (typeof c === 'string' ? c : (c && c.text) || '')).join('\n')
            : '');
        events.push({
          kind: 'result',
          callId: part.tool_use_id || null,
          exitCode,
          output: outputText,
          isError: Boolean(part.is_error),
          timestamp: ts,
        });
      }
    }
  }
  return events;
}

/**
 * Pair tool calls with their results by callId; for calls without a matching
 * result, treat them as having no failure signal (skipped).
 */
function pairCallsWithResults(events) {
  const calls = new Map(); // callId → call
  const orphanCalls = [];
  for (const e of events) {
    if (e.kind === 'call') {
      if (e.callId) calls.set(e.callId, e);
      else orphanCalls.push(e);
    }
  }
  const paired = [];
  for (const e of events) {
    if (e.kind !== 'result') continue;
    const call = e.callId ? calls.get(e.callId) : null;
    if (!call) continue;
    paired.push({ call, result: e });
  }
  return paired;
}

function isFailedCall(pair) {
  const { result } = pair;
  if (!result) return false;
  if (result.isError === true) return true;
  if (typeof result.exitCode === 'number' && result.exitCode !== 0) return true;
  const output = String(result.output || '');
  for (const re of ERROR_PATTERNS) {
    if (re.test(output)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Feedback-log proximity filter
// ---------------------------------------------------------------------------

function loadFeedbackTimestamps(feedbackLogPath) {
  const entries = readJsonlSafe(feedbackLogPath);
  const timestamps = [];
  for (const e of entries) {
    const ts = e && (e.timestamp || e.ts);
    if (!ts) continue;
    const t = Date.parse(ts);
    if (Number.isFinite(t)) timestamps.push(t);
  }
  return timestamps.sort((a, b) => a - b);
}

function hasAdjacentFeedback(timestampIso, feedbackTimestamps, windowMs = FEEDBACK_PROXIMITY_WINDOW_MS) {
  if (!timestampIso || !feedbackTimestamps || feedbackTimestamps.length === 0) return false;
  const t = Date.parse(timestampIso);
  if (!Number.isFinite(t)) return false;
  // Linear scan — feedback log is small (HITL = sparse). If it gets large,
  // switch to binary search; not worth the complexity at v1.
  for (const f of feedbackTimestamps) {
    if (Math.abs(f - t) <= windowMs) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Signature + clustering
// ---------------------------------------------------------------------------

function argsToSignature(tool, args) {
  // Stable string signature over args. For Bash we use the command (first ~120
  // chars after normalization); for file-tools we use the file_path; otherwise
  // a sorted-key shallow JSON.
  const norm = (v) => normalizeForSignature(String(v == null ? '' : v));
  if (tool === 'Bash' && args && typeof args.command === 'string') {
    return `Bash:${norm(args.command).slice(0, 160)}`;
  }
  if ((tool === 'Read' || tool === 'Edit' || tool === 'Write') && args && typeof args.file_path === 'string') {
    return `${tool}:${norm(args.file_path)}`;
  }
  // Generic fallback — sorted keys, normalized values
  try {
    const keys = Object.keys(args || {}).sort();
    const parts = keys.map((k) => {
      const v = args[k];
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}=${norm(s).slice(0, 80)}`;
    });
    return `${tool}:${parts.join('|')}`;
  } catch {
    return `${tool}:<unserializable>`;
  }
}

function clusterFailures(failures, { minClusterSize = MIN_CLUSTER_SIZE } = {}) {
  const buckets = new Map();
  for (const f of failures) {
    const sig = argsToSignature(f.tool, f.args);
    if (!buckets.has(sig)) buckets.set(sig, []);
    buckets.get(sig).push(f);
  }
  const clusters = [];
  for (const [signature, members] of buckets.entries()) {
    if (members.length < minClusterSize) continue;
    // Sample excerpt from the first member's output for the rule message.
    const sample = members[0];
    clusters.push({
      signature,
      tool: sample.tool,
      size: members.length,
      // Keep redacted+normalized excerpts only.
      sampleArgs: normalizeForSignature(JSON.stringify(sample.args || {})).slice(0, 200),
      sampleOutput: normalizeForSignature(String(sample.output || '')).slice(0, 200),
    });
  }
  return clusters.sort((a, b) => b.size - a.size);
}

// ---------------------------------------------------------------------------
// Candidate emission — same shape as meta-agent-loop.js candidates
// ---------------------------------------------------------------------------

function candidateFromCluster(cluster) {
  // Build a regex that targets this normalized signature. We escape regex
  // metacharacters and cap the pattern length — meta-agent-loop's matchesEntry
  // will compile this with `new RegExp(pattern, 'i')`.
  const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Use a few keywords from the signature to form a flexible pattern.
  const sigBody = cluster.signature.replace(/^[^:]+:/, '');
  const words = sigBody
    .split(/[\s/|=]+/)
    .map((w) => w.replace(/[<>]/g, '').trim())
    .filter((w) => w.length >= 4 && !/^[0-9]+$/.test(w))
    .slice(0, 3);
  const pattern = words.length >= 2
    ? words.map(escape).join('.*')
    : escape(sigBody.slice(0, 60));

  return {
    pattern,
    action: 'warn',
    message: `Silent-failure cluster (${cluster.size}× ${cluster.tool}): ${cluster.sampleOutput.slice(0, 100) || cluster.sampleArgs.slice(0, 100)}`,
    severity: 'medium',
    rationale: `Observed ${cluster.size} silent failures matching ${cluster.tool} signature; never thumbed-down by user.`,
    source: 'silent-failure-cluster',
    origin: 'silent-failure-cluster',
    clusterSize: cluster.size,
    clusterSignature: cluster.signature,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate candidate rules from clustered silent failures.
 *
 * @param {object} opts
 * @param {string[]} [opts.logPaths] — override conversation-log discovery (tests)
 * @param {string} [opts.feedbackLogPath] — feedback-log.jsonl to exclude HITL'd calls
 * @param {number} [opts.minClusterSize]
 * @param {number} [opts.minDailyCalls]
 * @returns {{
 *   candidates: object[],
 *   stats: {
 *     totalToolCalls: number,
 *     failedCalls: number,
 *     filteredByFeedback: number,
 *     clusters: number,
 *     skippedReason: string|null
 *   }
 * }}
 */
function generateSilentFailureCandidates(opts = {}) {
  const {
    logPaths = discoverConversationLogs({ limit: 50 }),
    feedbackLogPath = null,
    minClusterSize = MIN_CLUSTER_SIZE,
    minDailyCalls = MIN_DAILY_CALLS_FOR_USEFUL_CLUSTERING,
  } = opts;

  const stats = {
    totalToolCalls: 0,
    failedCalls: 0,
    filteredByFeedback: 0,
    clusters: 0,
    skippedReason: null,
  };

  const feedbackTimestamps = feedbackLogPath ? loadFeedbackTimestamps(feedbackLogPath) : [];

  const allFailures = [];

  for (const logPath of logPaths) {
    const entries = readJsonlSafe(logPath);
    const allEvents = entries.flatMap(extractToolEvents);
    const pairs = pairCallsWithResults(allEvents);
    stats.totalToolCalls += pairs.length;

    for (const pair of pairs) {
      if (!isFailedCall(pair)) continue;
      stats.failedCalls += 1;
      const ts = pair.call.timestamp || pair.result.timestamp;
      if (hasAdjacentFeedback(ts, feedbackTimestamps)) {
        stats.filteredByFeedback += 1;
        continue;
      }
      allFailures.push({
        tool: pair.call.tool,
        args: pair.call.args,
        output: pair.result.output,
        timestamp: ts,
      });
    }
  }

  // Insufficient-data path — emit empty cluster set cleanly.
  if (stats.totalToolCalls < minDailyCalls) {
    stats.skippedReason = `insufficient-data: ${stats.totalToolCalls} tool calls < ${minDailyCalls} threshold`;
    return { candidates: [], stats };
  }

  const clusters = clusterFailures(allFailures, { minClusterSize });
  stats.clusters = clusters.length;

  const candidates = clusters.map(candidateFromCluster);
  return { candidates, stats };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  if (process.env.THUMBGATE_SILENT_FAILURE_CLUSTERING !== '1') {
    process.stdout.write('silent-failure-cluster: disabled (set THUMBGATE_SILENT_FAILURE_CLUSTERING=1 to enable)\n');
    return;
  }

  const { resolveFeedbackDir } = require('./feedback-paths');
  let feedbackLogPath = null;
  try {
    feedbackLogPath = path.join(resolveFeedbackDir(), 'feedback-log.jsonl');
  } catch {
    // running outside a configured feedback dir — fine, just skip the proximity filter
  }

  const result = generateSilentFailureCandidates({ feedbackLogPath });
  process.stdout.write(JSON.stringify({
    enabled: true,
    candidateCount: result.candidates.length,
    stats: result.stats,
    candidates: result.candidates,
  }, null, 2) + '\n');
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`silent-failure-cluster failed: ${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  generateSilentFailureCandidates,
  // exported for testing
  redactSecrets,
  normalizePaths,
  normalizeForSignature,
  extractToolEvents,
  pairCallsWithResults,
  isFailedCall,
  hasAdjacentFeedback,
  loadFeedbackTimestamps,
  argsToSignature,
  clusterFailures,
  candidateFromCluster,
  readJsonlSafe,
  ERROR_PATTERNS,
  MIN_CLUSTER_SIZE,
  MIN_DAILY_CALLS_FOR_USEFUL_CLUSTERING,
  FEEDBACK_PROXIMITY_WINDOW_MS,
};
