#!/usr/bin/env node
'use strict';

/**
 * InfoQ Software Architects' Newsletter, September 2026 — FORMAT steal.
 *
 * Transfers:
 *   1. Code as truth + one provenance line (Cassie Shum). A done claim names
 *      the file that owns the behavior.
 *   2. Typed host. bash, javascript, typescript, csharp, python, or sql.
 *      No new DSL.
 *   3. Durable work stays on the session lease and scripts/durability/step.js.
 *      No Temporal, Step Functions, or Inngest.
 *   4. Time-in-queue. Age of the oldest stamped item. Queue depth is not the verdict.
 *
 * Does not register for InfoQ or QCon, install Vortex, or ship a knowledge-graph product.
 * Does not treat LinkedIn's twenty percent or Vortex's sixty gigabits as ThumbGate results.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'InfoQ Software Architects Newsletter, September 2026';

const HOSTS = Object.freeze([
  'bash',
  'javascript',
  'typescript',
  'csharp',
  'python',
  'sql',
]);

const REFUSES = Object.freeze([
  'InfoQ certification registration',
  'Vortex install',
  'Second workflow engine',
  'Knowledge-graph product',
  'Unmeasured vendor number',
]);

const RAIL_MAP = Object.freeze([
  {
    infoq: 'Code as truth, one provenance line, context stays the file plus the skill',
    thumbgate: 'A done claim names Code as truth: <path> and Provenance: <id>',
  },
  {
    infoq: 'Typed domain grounding inside a language the compiler already checks',
    thumbgate: 'Host is bash, javascript, typescript, csharp, python, or sql',
  },
  {
    infoq: 'Durable workflows on the database you already run',
    thumbgate: 'Session lease plus scripts/durability/step.js. No second orchestrator',
  },
  {
    infoq: 'Time-in-queue, not offset lag or queue depth',
    thumbgate: 'Oldest stamped enqueuedAt. Missing stamps are review, not a guessed age',
  },
]);

const DONE_RE = /\b(done|shipped|live|fixed|deployed)\b/i;
const CODE_RE = /Code as truth:\s*(\S+)/;
const PROVENANCE_RE = /Provenance:\s*(\S+)/;
const HOST_RE = /\bHost:\s*([A-Za-z0-9_+#.-]+)/;

function textOf(options) {
  return [options.claim, options.command, options.text].filter(Boolean).join('\n');
}

function triggeredRefusals(text) {
  const hits = [];
  if (/\b(infoq|qcon)\b/i.test(text) && /\b(register|signup|sign up|enroll|certification|rsvp)\b/i.test(text)) {
    hits.push('InfoQ certification registration');
  }
  if (/\bvortex\b/i.test(text) && /\b(install|npm|npx|pip|brew|adopt|loader)\b/i.test(text)) {
    hits.push('Vortex install');
  }
  if (/\b(temporal|step functions|inngest)\b/i.test(text) && /\b(install|adopt|replace|orchestrat|migrate)\b/i.test(text)) {
    hits.push('Second workflow engine');
  }
  if (/\b(neo4j|knowledge[- ]graph (product|sku|database))\b/i.test(text) && /\b(install|adopt|clone|ship|our product)\b/i.test(text)) {
    hits.push('Knowledge-graph product');
  }
  if (/\b(20\s*%|twenty percent|60\s*gigabit|sixty gigabit)\b/i.test(text) && /\b(thumbgate|our|we)\b/i.test(text)) {
    hits.push('Unmeasured vendor number');
  }
  return [...new Set(hits)];
}

function parseTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function timeInQueue(items, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const list = Array.isArray(items) ? items : [];
  const missingTimestamps = [];
  const aged = [];
  for (const item of list) {
    const id = item && (item.id || item.name || item.subject) || null;
    const at = parseTime(item && (item.enqueuedAt || item.claimedAt || item.queuedAt));
    if (at == null) {
      if (id) missingTimestamps.push(id);
      else missingTimestamps.push('(unnamed)');
      continue;
    }
    aged.push({ id, enqueuedAt: new Date(at).toISOString(), ageMs: now - at });
  }
  aged.sort((a, b) => b.ageMs - a.ageMs);
  return {
    count: list.length,
    timedCount: aged.length,
    missingTimestamps,
    oldest: aged[0] || null,
    depthIsNotTheVerdict: true,
  };
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function loadQueue(options) {
  if (options.queueJson) {
    const parsed = JSON.parse(options.queueJson);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  const items = [];
  if (options.queue) {
    const parsed = readJson(options.queue);
    if (Array.isArray(parsed)) items.push(...parsed);
    else items.push(parsed);
  }
  if (options.lease) {
    const lease = readJson(options.lease);
    items.push({
      id: 'session-lease',
      claimedAt: lease.claimedAt || lease.since || lease.createdAt || null,
    });
  }
  return items;
}

function hostOf(options, text) {
  if (options.host) return String(options.host).trim().toLowerCase();
  const match = text.match(HOST_RE);
  return match ? match[1].toLowerCase() : '';
}

function codeAsTruth(text, cwd) {
  const required = DONE_RE.test(text);
  const codeMatch = text.match(CODE_RE);
  const provenanceMatch = text.match(PROVENANCE_RE);
  const cited = codeMatch ? codeMatch[1] : '';
  const provenance = provenanceMatch ? provenanceMatch[1] : '';
  if (!required) {
    return { required: false, cited, provenance, exists: null, ok: true, reason: '' };
  }
  if (!cited || !provenance) {
    return {
      required: true,
      cited,
      provenance,
      exists: false,
      ok: false,
      reason: 'done claim needs Code as truth: <path> and Provenance: <id>',
    };
  }
  const absolute = path.resolve(cwd || process.cwd(), cited);
  const exists = fs.existsSync(absolute);
  return {
    required: true,
    cited,
    provenance,
    exists,
    ok: exists,
    reason: exists ? '' : `Code as truth path is missing: ${cited}`,
  };
}

function buildInfoqArchitectHonestyReport(options = {}) {
  const mapOnly = options.mapOnly === true || options['map-only'] === true || options.mapOnly === 'true';
  const nowMs = parseTime(options.now) || Date.now();
  const maxAgeMs = options.maxAgeMs != null && options.maxAgeMs !== ''
    ? Number(options.maxAgeMs)
    : (options['max-age-ms'] != null ? Number(options['max-age-ms']) : null);
  const text = textOf(options);
  const findings = [];

  if (!mapOnly && text) {
    for (const hit of triggeredRefusals(text)) {
      findings.push({ gateId: 'infoq-refuse', severity: 'fail', message: hit });
    }
    const host = hostOf(options, text);
    if (host && !HOSTS.includes(host)) {
      findings.push({
        gateId: 'typed-host',
        severity: 'fail',
        message: `Host ${host} is not a typed host. Use ${HOSTS.join(', ')}.`,
      });
    }
    const truth = codeAsTruth(text, options.cwd);
    if (!truth.ok) {
      findings.push({ gateId: 'code-as-truth', severity: 'fail', message: truth.reason });
    }
  }

  let queue = null;
  if (!mapOnly && (options.queue || options.queueJson || options.lease)) {
    queue = timeInQueue(loadQueue(options), nowMs);
    if (queue.missingTimestamps.length) {
      findings.push({
        gateId: 'time-in-queue',
        severity: 'review',
        message: `Missing enqueuedAt on ${queue.missingTimestamps.length} item(s). Age is not guessed.`,
      });
    }
    if (queue.oldest && Number.isFinite(maxAgeMs) && queue.oldest.ageMs > maxAgeMs) {
      findings.push({
        gateId: 'time-in-queue',
        severity: 'fail',
        message: `Oldest item ${queue.oldest.id || '(unnamed)'} is ${queue.oldest.ageMs}ms, over ${maxAgeMs}ms.`,
      });
    }
  }

  const failCount = findings.filter((item) => item.severity === 'fail').length;
  const reviewCount = findings.filter((item) => item.severity === 'review').length;
  let status = 'ready';
  if (failCount) status = 'fail';
  else if (reviewCount) status = 'review';

  return {
    name: 'thumbgate-infoq-architect-honesty',
    ok: status === 'ready',
    status,
    source: SOURCE,
    refuses: REFUSES,
    hosts: HOSTS,
    map: RAIL_MAP,
    queue,
    findings,
    summary: { findingCount: findings.length, failCount, reviewCount },
    exampleCommand: 'npx thumbgate infoq-architect-honesty --json --map-only',
    disclaimer: 'FORMAT steal from the September 2026 InfoQ architects newsletter. Not affiliated. Does not register for InfoQ, install Vortex, or add a second workflow engine.',
  };
}

function formatInfoqArchitectHonestyReport(report) {
  const lines = [
    'InfoQ Architect Honesty',
    `Status : ${report.status}`,
    `Source : ${report.source}`,
    `Findings: ${report.summary.findingCount} (fail=${report.summary.failCount})`,
    '',
    'Rail map:',
  ];
  for (const row of report.map) {
    lines.push(`- ${row.infoq}`);
    lines.push(`  ThumbGate: ${row.thumbgate}`);
  }
  if (report.queue && report.queue.oldest) {
    lines.push('', `Oldest queue age: ${report.queue.oldest.ageMs}ms (${report.queue.oldest.id})`);
    lines.push(`Queue depth: ${report.queue.count} (not the verdict)`);
  }
  for (const finding of report.findings) {
    lines.push(`- [${finding.severity}] ${finding.gateId}: ${finding.message}`);
  }
  lines.push('', report.disclaimer, '');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const [rawKey, inline] = arg.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inline !== undefined) args[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[key] = argv[index + 1];
      index += 1;
    } else args[key] = true;
  }
  const report = buildInfoqArchitectHonestyReport({
    mapOnly: args.mapOnly === true,
    claim: args.claim || '',
    command: args.command || '',
    host: args.host || '',
    queue: args.queue || '',
    queueJson: args.queueJson || '',
    lease: args.lease || '',
    maxAgeMs: args.maxAgeMs,
    now: args.now,
    cwd: args.cwd || process.cwd(),
  });
  if (args.json === true) console.log(JSON.stringify(report, null, 2));
  else process.stdout.write(formatInfoqArchitectHonestyReport(report));
  if (report.status === 'fail') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

module.exports = {
  HOSTS,
  RAIL_MAP,
  REFUSES,
  buildInfoqArchitectHonestyReport,
  formatInfoqArchitectHonestyReport,
  timeInQueue,
  triggeredRefusals,
};
