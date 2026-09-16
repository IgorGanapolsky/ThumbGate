#!/usr/bin/env node
'use strict';

/**
 * CobbleDB FORMAT steal — not a product clone.
 *
 * Source: https://www.perplexity.ai/hub/blog/cobbledb
 *
 * Transfers (process only):
 *   1. Three-plane split — durable document state ≠ batched update delivery
 *      ≠ query-time hot store. Processing must not write the live read path.
 *   2. Batch MultiGet + hedge — given a batch of prepared keys, group by
 *      partition, fetch in parallel, and hedge a slow/failed replica.
 *   3. Policy-defined hot subset + coexisting representation versions —
 *      only promoted/matchable records occupy the expensive hot path;
 *      a new embedding/chunk version must not clobber the previous one.
 *
 * Maps onto existing ThumbGate rails (not a RocksDB / YTsaurus / Dynamo
 * replacement):
 *   durable  → feedback-log.jsonl + memory-log.jsonl + feedback-schema.js
 *   delivery → feedback-to-memory.js + memory-vs-rag dreaming=dynamic
 *   hot      → lesson-retrieval.js + hybrid-feedback-context.js
 *
 * Does NOT clone CobbleDB, Pillar, Lorry, RocksDB clusters, or YTsaurus.
 * ECI: maintenance of existing retrieval rails only — no storage SKU.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URL = 'https://www.perplexity.ai/hub/blog/cobbledb';

const PLANES = Object.freeze(['durable', 'delivery', 'hot']);

const PLANE_RAILS = Object.freeze({
  durable: {
    cobble: 'Pillar — versioned document state on cheap HDD, subset membership',
    rails: [
      'feedback-log.jsonl',
      'memory-log.jsonl',
      'scripts/feedback-schema.js',
    ],
    when: 'Raw thumbs and schema-valid lessons land here first. Never the live PreToolUse read.',
  },
  delivery: {
    cobble: 'Lorry — partition-aligned batches, data plane off the control plane, independent ingest',
    rails: [
      'scripts/feedback-to-memory.js',
      'scripts/memory-vs-rag-route.js (dreaming=dynamic)',
      'scripts/compact-memory-store.js',
    ],
    when: 'Promotion batches prepared records onto the hot path at the hot store\'s pace.',
  },
  hot: {
    cobble: 'CobbleDB — partitioned MultiGet, replica hedge, no transactions',
    rails: [
      'scripts/lesson-retrieval.js',
      'scripts/hybrid-feedback-context.js',
      'config/performance-budgets.json',
    ],
    when: 'Query-time batch fetch of prepared lesson records for ranking / PreToolUse.',
  },
});

const HOT_SUBSET_POLICIES = Object.freeze([
  'promoted_matchable',
  'fresh_high_value',
  'unbounded',
]);

const DEFAULT_GOLD_TRACE = Object.freeze({
  writes: [
    { source: 'processing', plane: 'durable', keys: ['lesson-1', 'lesson-2'] },
    { source: 'export', plane: 'delivery', keys: ['lesson-1'] },
    { source: 'ingest', plane: 'hot', keys: ['lesson-1'] },
  ],
  reads: [
    {
      keys: ['lesson-1', 'lesson-2', 'lesson-3', 'lesson-4', 'lesson-5'],
      mode: 'batched',
      hedgeMs: 15,
    },
  ],
  hotSubset: { policy: 'promoted_matchable', keys: ['lesson-1'] },
  versions: [
    { key: 'lesson-1', representations: ['embed-v1', 'embed-v2'], overwrite: false },
  ],
  transactionsOnHot: false,
});

const CLONE_PATTERNS = Object.freeze([
  { id: 'cobbledb_sku', re: /\b(clone|install|vendor|ship)\b.{0,40}\bcobble[- ]?db\b/i },
  { id: 'rocksdb_cluster', re: /\b(rocksdb cluster|yt-?saurus|ytsaurus)\b/i },
  { id: 'pillar_lorry_product', re: /\b(clone pillar|clone lorry|pillar \+ lorry sku)\b/i },
  { id: 'dynamo_replacement', re: /\breplace dynamo(db)? with cobble/i },
]);

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function detectCloneAttempt(text) {
  const t = String(text || '');
  const hits = [];
  for (const p of CLONE_PATTERNS) {
    if (p.re.test(t)) hits.push(p.id);
  }
  return hits;
}

function hashPartition(key, partitionCount = 8) {
  const n = Math.max(1, Number(partitionCount) || 8);
  const s = String(key);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % n;
}

function normalizeKeyList(keys) {
  if (Array.isArray(keys)) {
    return keys.map((k) => String(k).trim()).filter(Boolean);
  }
  return String(keys || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toStoreMap(store) {
  if (store instanceof Map) return store;
  if (Array.isArray(store)) {
    return new Map(store.map((row) => {
      if (Array.isArray(row) && row.length >= 2) return [String(row[0]), row[1]];
      const key = row && (row.key || row.id);
      return [String(key), row];
    }).filter(([key]) => key && key !== 'undefined'));
  }
  if (store && typeof store === 'object') {
    return new Map(Object.entries(store));
  }
  return new Map();
}

/**
 * Local MultiGet analog: partition keys, read replicas in parallel (simulated),
 * hedge a slow or failed primary. Not a RocksDB binding.
 */
function batchGetPrepared(keys, options = {}) {
  const list = normalizeKeyList(keys);
  const partitionCount = Math.max(1, Number(options.partitionCount) || 8);
  const hedgeMs = options.hedgeMs == null ? 15 : Number(options.hedgeMs);
  const store = toStoreMap(options.store);
  const replicaLatencies = options.replicaLatencies || {};
  const replicaOk = options.replicaOk || {};

  const groups = new Map();
  for (const key of list) {
    const p = hashPartition(key, partitionCount);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(key);
  }

  const partitions = [];
  const records = [];
  let hedgedPartitions = 0;

  for (const [partition, pkeys] of groups) {
    const primaryLatency = Number(replicaLatencies[`${partition}:0`] ?? 0);
    const backupLatency = Number(replicaLatencies[`${partition}:1`] ?? 0);
    const primaryOk = replicaOk[`${partition}:0`] !== false;
    const shouldHedge = !primaryOk
      || (Number.isFinite(hedgeMs) && hedgeMs >= 0 && primaryLatency > hedgeMs);
    const replica = shouldHedge ? 1 : 0;
    if (shouldHedge) hedgedPartitions += 1;
    const latencyMs = replica === 1 ? backupLatency : primaryLatency;
    const hits = pkeys.map((key) => {
      const found = store.has(key);
      const value = found ? store.get(key) : null;
      records.push({
        key, partition, replica, found, value, hedged: shouldHedge,
      });
      return { key, found };
    });
    partitions.push({
      partition,
      keys: pkeys,
      replica,
      hedged: shouldHedge,
      latencyMs,
      hits,
    });
  }

  return {
    keys: list,
    partitionCount,
    hedgeMs,
    hedgedPartitions,
    found: records.filter((r) => r.found).length,
    missing: records.filter((r) => !r.found).map((r) => r.key),
    partitions,
    records,
  };
}

function selectHotSubset(records, policy = 'promoted_matchable') {
  const list = Array.isArray(records) ? records : [];
  const resolved = HOT_SUBSET_POLICIES.includes(policy) ? policy : 'promoted_matchable';
  let selected = list;
  if (resolved === 'unbounded') {
    selected = list;
  } else if (resolved === 'fresh_high_value') {
    selected = list.filter((row) => (
      row.fresh === true || row.highValue === true || row.importance === 'high'
    ));
  } else {
    selected = list.filter((row) => {
      if (row.promoted === false) return false;
      if (row.matchable === false) return false;
      if (row.transportBlob === true) return false;
      return true;
    });
  }
  return {
    policy: resolved,
    keys: selected.map((row) => String(row.id || row.key || '')).filter(Boolean),
    selected,
    dropped: list.length - selected.length,
  };
}

function auditTrace(trace = {}) {
  const findings = [];
  const writes = Array.isArray(trace.writes) ? trace.writes : [];
  const reads = Array.isArray(trace.reads) ? trace.reads : [];

  for (const write of writes) {
    if (write.source === 'processing' && write.plane === 'hot') {
      findings.push({
        severity: 'fail',
        id: 'coupled_processing_hot_write',
        message: 'Processing wrote prepared records straight to the hot store. Durable state and Lorry-style delivery must sit in between.',
      });
    }
  }

  const processingDurable = writes.some((w) => w.source === 'processing' && w.plane === 'durable');
  const hasDelivery = writes.some((w) => w.plane === 'delivery' || w.source === 'export');
  const hotWrite = writes.some((w) => w.plane === 'hot');
  const coupled = writes.some((w) => w.source === 'processing' && w.plane === 'hot');
  if (processingDurable && hotWrite && !hasDelivery && !coupled) {
    findings.push({
      severity: 'fail',
      id: 'missing_delivery_plane',
      message: 'Durable writes jump to hot ingest with no batched delivery plane. Map that hop onto feedback-to-memory / dreaming=dynamic.',
    });
  }

  for (const read of reads) {
    const keys = normalizeKeyList(read.keys);
    const mode = String(read.mode || '').toLowerCase();
    if (keys.length >= 3 && mode === 'sequential') {
      findings.push({
        severity: 'fail',
        id: 'sequential_hot_batch',
        message: `Read ${keys.length} hot keys sequentially. Batch MultiGet (partition + parallel) is the serving contract.`,
      });
    }
    if (keys.length >= 5 && mode === 'batched' && !(Number(read.hedgeMs) > 0)) {
      findings.push({
        severity: 'warn',
        id: 'missing_hedge',
        message: 'Batched hot read has no hedge timeout. A slow replica can stall the whole batch.',
      });
    }
  }

  const subset = trace.hotSubset && typeof trace.hotSubset === 'object' ? trace.hotSubset : {};
  if (subset.policy === 'unbounded') {
    findings.push({
      severity: 'fail',
      id: 'unbounded_hot_subset',
      message: 'Hot set has no subset policy. Only promoted/matchable (or fresh/high-value) records belong on the expensive read path.',
    });
  }

  const versions = Array.isArray(trace.versions) ? trace.versions : [];
  for (const version of versions) {
    const reps = Array.isArray(version.representations) ? version.representations : [];
    if (version.overwrite && reps.length >= 1) {
      findings.push({
        severity: 'fail',
        id: 'version_overwrite',
        message: `Key ${version.key || '(unknown)'} overwrote an existing representation. Versions must coexist so embedding/chunk changes can roll forward.`,
      });
    }
  }

  if (trace.transactionsOnHot === true) {
    findings.push({
      severity: 'fail',
      id: 'hot_transactions',
      message: 'Hot store requested transactions/synchronized replicas. Omit them: a short ingest lag is acceptable on this path.',
    });
  }

  return findings;
}

function probeRails(rootDir) {
  const root = rootDir || path.resolve(__dirname, '..');
  const checks = [
    { id: 'feedback_to_memory', rel: 'scripts/feedback-to-memory.js' },
    { id: 'lesson_retrieval', rel: 'scripts/lesson-retrieval.js' },
    { id: 'hybrid_feedback_context', rel: 'scripts/hybrid-feedback-context.js' },
    { id: 'memory_vs_rag', rel: 'scripts/memory-vs-rag-route.js' },
    { id: 'perf_budgets', rel: 'config/performance-budgets.json' },
  ];
  return checks.map((c) => {
    const full = path.join(root, c.rel);
    return { id: c.id, path: c.rel, exists: fs.existsSync(full) };
  });
}

function loadJsonFile(filePath) {
  if (!filePath) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function collectCloneHaystack(options = {}) {
  const parts = [
    options.task,
    options.query,
    options.clone,
    options['clone-cobbledb'] ? 'clone cobbledb' : '',
    options.cloneCobbleDb ? 'clone cobbledb' : '',
  ];
  if (Array.isArray(options.argv)) parts.push(...options.argv);
  return parts.filter(Boolean).join(' ');
}

function buildCobbleHotStoreSplitReport(options = {}) {
  const root = options.root
    ? path.resolve(String(options.root))
    : path.resolve(__dirname, '..');
  const findings = [];
  const haystack = collectCloneHaystack(options);
  const cloneHits = [...new Set(detectCloneAttempt(haystack))];
  if (cloneHits.length) {
    findings.push({
      severity: 'fail',
      id: 'cobble_clone_refused',
      message: `Refusing CobbleDB/RocksDB/YTsaurus clone path (${cloneHits.join(', ')}). Map the three-plane FORMAT onto existing lesson rails only.`,
    });
  }

  const mapOnly = normalizeBoolean(options.map || options['map-only']);
  let trace = null;
  if (!mapOnly) {
    if (options.trace && typeof options.trace === 'object' && !Array.isArray(options.trace)) {
      trace = options.trace;
    } else if (options.trace) {
      trace = loadJsonFile(String(options.trace));
    } else {
      trace = DEFAULT_GOLD_TRACE;
    }
    findings.push(...auditTrace(trace));
  }

  const probes = probeRails(root);
  for (const missing of probes.filter((p) => !p.exists)) {
    findings.push({
      severity: 'warn',
      id: `missing_rail_${missing.id}`,
      message: `Expected rail missing: ${missing.path}`,
    });
  }

  let batchGet = null;
  const keyList = normalizeKeyList(options.keys);
  if (keyList.length) {
    let store = options.store;
    if (typeof store === 'string') store = loadJsonFile(store);
    batchGet = batchGetPrepared(keyList, {
      store,
      hedgeMs: options.hedgeMs != null ? options.hedgeMs : options['hedge-ms'],
      partitionCount: options.partitionCount || options['partition-count'],
      replicaLatencies: options.replicaLatencies,
      replicaOk: options.replicaOk,
    });
  }

  let status = 'ready';
  if (findings.some((f) => f.severity === 'fail')) status = 'fail';
  else if (findings.some((f) => f.severity === 'warn')) status = 'ready_with_warnings';

  const report = {
    name: 'thumbgate-cobble-hot-store-split',
    status,
    ok: status !== 'fail',
    planes: PLANES.map((id) => ({ id, ...PLANE_RAILS[id] })),
    hotSubsetPolicies: HOT_SUBSET_POLICIES.filter((p) => p !== 'unbounded'),
    trace: mapOnly ? null : trace,
    batchGet,
    railProbes: probes,
    compareNotClone: true,
    never: [
      'clone CobbleDB / Pillar / Lorry as a ThumbGate SKU',
      'vendor a RocksDB or YTsaurus cluster',
      'write processing output straight onto the PreToolUse hot path',
      'dump the raw feedback log into lesson-retrieval',
      'overwrite embedding/chunk versions',
      'dual-edit DIRTY lesson-graph PR #3650',
      'claim Perplexity 5× / 20% numbers as ThumbGate measurements',
    ],
    source: SOURCE_URL,
    disclaimer: 'FORMAT steal only. Not affiliated with Perplexity or CobbleDB. Maps existing ThumbGate lesson rails; does not ship a key-value database.',
    findings,
  };

  if (mapOnly) {
    report.map = report.planes;
  }

  return report;
}

function formatCobbleHotStoreSplitReport(report) {
  const lines = [
    'ThumbGate Cobble hot-store split (CobbleDB FORMAT steal)',
    `Status   : ${report.status}`,
    `ok       : ${report.ok}`,
    'Planes   :',
  ];
  for (const plane of report.planes || []) {
    lines.push(`  [${plane.id}] ${plane.cobble}`);
    lines.push(`         rails=${(plane.rails || []).join(' · ')}`);
  }
  if (report.batchGet) {
    lines.push(
      `BatchGet : found=${report.batchGet.found}/${report.batchGet.keys.length}`
      + ` hedged=${report.batchGet.hedgedPartitions}`
      + ` hedgeMs=${report.batchGet.hedgeMs}`
    );
  }
  if (report.findings?.length) {
    lines.push('Findings:');
    for (const finding of report.findings) {
      lines.push(`  [${finding.severity}] ${finding.id}: ${finding.message}`);
    }
  }
  lines.push(`Never    : ${(report.never || []).join('; ')}`);
  lines.push(`Source   : ${report.source}`);
  lines.push(report.disclaimer);
  return `${lines.join('\n')}\n`;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/cobble-hot-store-split.js [options]

CobbleDB FORMAT steal — separate durable lesson state, batched promotion,
and query-time MultiGet. Does not clone CobbleDB / RocksDB / YTsaurus.

Options:
  --trace=<file.json>     Audit a write/read/subset/version trace
  --keys=a,b,c            Run partitioned MultiGet (+ hedge)
  --store=<file.json>     Prepared-record map for --keys
  --hedge-ms=N            Hedge timeout (default 15)
  --partition-count=N     Partition count (default 8)
  --map-only              Print three-plane rail map
  --clone-cobbledb        Fail closed (clone refused)
  --json
  --strict                Exit 1 unless status=ready
  --root=<dir>
`);
}

function parseArgv(argv) {
  const options = { argv };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--map' || arg === '--map-only') options.map = true;
    else if (arg === '--clone-cobbledb' || arg === '--clone-cobble') {
      options['clone-cobbledb'] = true;
    } else if (arg.startsWith('--trace=')) options.trace = arg.slice('--trace='.length);
    else if (arg.startsWith('--keys=')) options.keys = arg.slice('--keys='.length);
    else if (arg.startsWith('--store=')) options.store = arg.slice('--store='.length);
    else if (arg.startsWith('--hedge-ms=')) options.hedgeMs = Number(arg.slice('--hedge-ms='.length));
    else if (arg.startsWith('--partition-count=')) {
      options.partitionCount = Number(arg.slice('--partition-count='.length));
    } else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
    else if (arg.startsWith('--task=')) options.task = arg.slice('--task='.length);
    else if (arg.startsWith('--query=')) options.query = arg.slice('--query='.length);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  const options = parseArgv(argv);
  const report = buildCobbleHotStoreSplitReport(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatCobbleHotStoreSplitReport(report));
  }
  if (options.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  PLANES,
  PLANE_RAILS,
  HOT_SUBSET_POLICIES,
  DEFAULT_GOLD_TRACE,
  SOURCE_URL,
  hashPartition,
  batchGetPrepared,
  selectHotSubset,
  auditTrace,
  detectCloneAttempt,
  probeRails,
  buildCobbleHotStoreSplitReport,
  formatCobbleHotStoreSplitReport,
  main,
};

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(__filename)
) {
  process.exitCode = main();
}
