#!/usr/bin/env node
'use strict';

/**
 * agent-action-inventory.js — "what did the agents actually do here?"
 *
 * WHY THIS EXISTS
 * ---------------
 * ThumbGate already records gate decisions (`audit-trail.jsonl`), gate firings
 * (`gate-events-log.jsonl`) and per-tool KPIs (`tool-kpi.jsonl`). What it did
 * not have is one read-only rollup an operator can point at a repo and get:
 * which agents ran, which tools they reached for, how much was allowed, how
 * much was blocked, by which gate, on which day — and how often a block was
 * later reversed (the false-deny signal).
 *
 * TWO HONESTY RULES THIS FILE ENFORCES
 * ------------------------------------
 * 1. A missing source and an empty source are DIFFERENT facts and must look
 *    different in the output. `sources.auditTrail === 'missing'` means the file
 *    is not there; `'empty'` means it is there and holds nothing. Reporting
 *    both as `0` would let "we never instrumented this" masquerade as "the
 *    agents did nothing".
 * 2. `falseDenyRate` is null unless a real numerator AND a real denominator
 *    were observed. A rate over zero denies is an invented denominator, so it
 *    stays null and `falseDenyReason` says why. `falseDenyNumerator` and
 *    `falseDenyDenominator` are always present so a reader can redo the math.
 *
 * All functions here are read-only. Nothing in this module writes to the store.
 */

const fs = require('node:fs');
const path = require('node:path');

// Filenames come from the modules that own the writes, so a rename there can
// never silently turn this report into a "source missing" false negative.
const { AUDIT_LOG_FILENAME, GATE_EVENTS_LOG_FILENAME } = require('./audit-trail');

// scripts/tool-kpi-tracker.js writes this; it is the only store in the feedback
// dir that carries an agentId, which is why agent identity comes from here.
const KPI_LOG_FILENAME = 'tool-kpi.jsonl';

const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 365;
const DEFAULT_WINDOW_DAYS = 30;

const DENY_DECISION = 'deny';

/**
 * Decisions in audit-trail.jsonl that REVERSE a block.
 * - 'override' is written by scripts/override-audit.js (satisfy_gate, CLI
 *   satisfyCondition, break-glass) and always carries the gateId it cleared.
 * - 'approve' is written when a protected action is approved rather than blocked.
 * A deny paired with one of these is the closest thing the store has to a
 * "this block should not have fired" receipt.
 */
const CLEARING_DECISIONS = new Set(['override', 'approve']);

const SOURCE_STATUS = Object.freeze({
  OK: 'ok',
  EMPTY: 'empty',
  MISSING: 'missing',
  UNREADABLE: 'unreadable',
});

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

/** Mirrors scripts/session-report.js normalizeWindowHours: clamp, never throw. */
function normalizeWindowDays(input) {
  if (input === null || input === undefined || input === '') return DEFAULT_WINDOW_DAYS;
  const n = Number(input);
  if (!Number.isFinite(n)) return DEFAULT_WINDOW_DAYS;
  if (n < MIN_WINDOW_DAYS) return MIN_WINDOW_DAYS;
  if (n > MAX_WINDOW_DAYS) return MAX_WINDOW_DAYS;
  return Math.floor(n);
}

// ---------------------------------------------------------------------------
// Source reading
// ---------------------------------------------------------------------------

/**
 * Read one JSONL store and report WHY it produced the records it did.
 *
 * @returns {{ status: string, path: string, records: object[], lines: number, malformed: number }}
 */
function readJsonlSource(filePath) {
  const base = { path: filePath, records: [], lines: 0, malformed: 0 };

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    // ENOENT is "never written". Anything else (EACCES, EISDIR) is a real
    // read failure and must not be flattened into "missing" — an operator
    // fixes those two problems differently.
    if (err && err.code === 'ENOENT') return { ...base, status: SOURCE_STATUS.MISSING };
    return {
      ...base,
      status: SOURCE_STATUS.UNREADABLE,
      error: String(err && err.message ? err.message : err),
    };
  }

  const trimmed = raw.trim();
  if (!trimmed) return { ...base, status: SOURCE_STATUS.EMPTY };

  const lines = trimmed.split('\n');
  const records = [];
  let malformed = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') records.push(parsed);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }

  return {
    path: filePath,
    // A file of nothing but unparsable lines is empty of DATA, not missing.
    status: records.length > 0 ? SOURCE_STATUS.OK : SOURCE_STATUS.EMPTY,
    records,
    lines: lines.length,
    malformed,
  };
}

function timestampMs(record, field = 'timestamp') {
  const value = record && record[field];
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function withinWindow(record, sinceMs, field = 'timestamp') {
  const ms = timestampMs(record, field);
  if (ms === null) return false;
  return ms >= sinceMs;
}

function dayKey(record, field = 'timestamp') {
  const ms = timestampMs(record, field);
  if (ms === null) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// False-deny pairing
// ---------------------------------------------------------------------------

/**
 * Pair each clearing event (override/approve) with the most recent UNPAIRED
 * preceding deny of the same gate.
 *
 * Why 1:1 and not "any later clear marks every earlier deny of that gate":
 * one break-glass override would then retroactively brand hundreds of
 * force-push denies as false, which is a fabricated numerator. One receipt
 * clears at most one block. The pairing is therefore a LOWER BOUND on
 * reversals, and the method string in the output says so.
 *
 * @returns {{ numerator: number, denominator: number, clearEvents: number, pairs: object[] }}
 */
function pairDeniesWithClears(records) {
  const denyStack = new Map(); // gateId -> ascending [{ ts, record }]
  const clearEvents = [];
  let denominator = 0;

  const sorted = records
    .map((r) => ({ r, ts: timestampMs(r) }))
    .filter((x) => x.ts !== null)
    .sort((a, b) => a.ts - b.ts);

  for (const { r, ts } of sorted) {
    const gateId = r.gateId || null;
    if (r.decision === DENY_DECISION) {
      denominator += 1;
      if (!gateId) continue; // an unattributed deny can never be paired
      if (!denyStack.has(gateId)) denyStack.set(gateId, []);
      denyStack.get(gateId).push({ ts, record: r });
    } else if (CLEARING_DECISIONS.has(r.decision) && gateId) {
      clearEvents.push({ ts, gateId, decision: r.decision });
    }
  }

  const pairs = [];
  for (const { ts, gateId, decision } of clearEvents) {
    const stack = denyStack.get(gateId);
    if (!stack || stack.length === 0) continue;
    // Newest unpaired deny that happened BEFORE this clear.
    let idx = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].ts < ts) { idx = i; break; }
    }
    if (idx === -1) continue;
    const [matched] = stack.splice(idx, 1);
    pairs.push({
      gate: gateId,
      deniedAt: new Date(matched.ts).toISOString(),
      clearedAt: new Date(ts).toISOString(),
      clearedBy: decision,
    });
  }

  return { numerator: pairs.length, denominator, clearEvents: clearEvents.length, pairs };
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function buildToolCalls(records) {
  const byTool = {};
  for (const r of records) {
    const tool = (typeof r.toolName === 'string' && r.toolName) || 'unknown';
    if (!byTool[tool]) byTool[tool] = { total: 0, allow: 0, deny: 0, warn: 0, other: 0 };
    const bucket = byTool[tool];
    bucket.total += 1;
    if (r.decision === 'allow') bucket.allow += 1;
    else if (r.decision === DENY_DECISION) bucket.deny += 1;
    else if (r.decision === 'warn') bucket.warn += 1;
    else bucket.other += 1;
  }
  return byTool;
}

function buildDenyReasonsByGate(records) {
  const byGate = {};
  for (const r of records) {
    if (r.decision !== DENY_DECISION) continue;
    const gate = r.gateId || '(unattributed)';
    if (!byGate[gate]) byGate[gate] = { denies: 0, reasons: {} };
    byGate[gate].denies += 1;
    const reason = (typeof r.message === 'string' && r.message.trim())
      ? r.message.trim()
      : '(no message recorded)';
    byGate[gate].reasons[reason] = (byGate[gate].reasons[reason] || 0) + 1;
  }

  // Reasons as a sorted array so the shape is stable and rankable.
  for (const gate of Object.keys(byGate)) {
    byGate[gate].reasons = Object.entries(byGate[gate].reasons)
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message));
  }
  return byGate;
}

/** Mirrors scripts/session-report.js topGates: rank by blocks, then warns. */
function buildTopGates(records, limit = 5) {
  const byGate = {};
  for (const r of records) {
    if (!r.gateId) continue;
    if (!byGate[r.gateId]) {
      byGate[r.gateId] = { gate: r.gateId, denies: 0, warns: 0, overrides: 0, other: 0 };
    }
    const bucket = byGate[r.gateId];
    if (r.decision === DENY_DECISION) bucket.denies += 1;
    else if (r.decision === 'warn') bucket.warns += 1;
    else if (CLEARING_DECISIONS.has(r.decision)) bucket.overrides += 1;
    else bucket.other += 1;
  }
  return Object.values(byGate)
    .sort((a, b) => b.denies - a.denies || b.warns - a.warns || a.gate.localeCompare(b.gate))
    .slice(0, limit);
}

/**
 * Per-day calls/denies. Only days that ACTUALLY APPEAR in the log are listed —
 * a zero-filled calendar would print "0 calls" for days the store may simply
 * predate, which is exactly the measured-vs-absent confusion this report exists
 * to avoid. `undated` counts rows whose timestamp could not be parsed.
 */
function buildDaily(records) {
  const byDay = new Map();
  let undated = 0;
  for (const r of records) {
    const day = dayKey(r);
    if (!day) { undated += 1; continue; }
    if (!byDay.has(day)) byDay.set(day, { date: day, calls: 0, denies: 0, warns: 0 });
    const bucket = byDay.get(day);
    bucket.calls += 1;
    if (r.decision === DENY_DECISION) bucket.denies += 1;
    else if (r.decision === 'warn') bucket.warns += 1;
  }
  const daily = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { daily, undated };
}

/**
 * Agents come from tool-kpi.jsonl — the ONLY store here that records an agentId.
 * audit-trail.jsonl rows carry no agent identity, which is why gate decisions
 * are reported repo-wide and never split per agent.
 */
function buildAgents(kpiRecords) {
  const byAgent = new Map();
  for (const r of kpiRecords) {
    const agentId = (typeof r.agentId === 'string' && r.agentId.trim())
      ? r.agentId.trim()
      : '(no agentId recorded)';
    if (!byAgent.has(agentId)) {
      byAgent.set(agentId, {
        agentId,
        calls: 0,
        successes: 0,
        failures: 0,
        tools: {},
        firstSeen: null,
        lastSeen: null,
      });
    }
    const bucket = byAgent.get(agentId);
    bucket.calls += 1;
    if (r.success === true) bucket.successes += 1;
    else if (r.success === false) bucket.failures += 1;
    const tool = (typeof r.toolName === 'string' && r.toolName) || 'unknown';
    bucket.tools[tool] = (bucket.tools[tool] || 0) + 1;
    const ts = timestampMs(r);
    if (ts !== null) {
      const iso = new Date(ts).toISOString();
      if (!bucket.firstSeen || iso < bucket.firstSeen) bucket.firstSeen = iso;
      if (!bucket.lastSeen || iso > bucket.lastSeen) bucket.lastSeen = iso;
    }
  }

  return [...byAgent.values()]
    .map((a) => ({
      ...a,
      tools: Object.entries(a.tools)
        .map(([tool, calls]) => ({ tool, calls }))
        .sort((x, y) => y.calls - x.calls || x.tool.localeCompare(y.tool)),
    }))
    .sort((a, b) => b.calls - a.calls || a.agentId.localeCompare(b.agentId));
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

function sourceDetail(source, inWindow) {
  const detail = {
    status: source.status,
    path: source.path,
    recordsTotal: source.records.length,
    recordsInWindow: source.status === SOURCE_STATUS.OK ? inWindow : null,
    malformedLines: source.malformed,
  };
  if (source.error) detail.error = source.error;
  return detail;
}

function buildAgentAttribution(kpiSource, agents) {
  const base = {
    identitySource: KPI_LOG_FILENAME,
    // Stated explicitly because it is the single biggest limitation of this
    // report: allow/deny counts are repo-wide, NOT per-agent.
    gateDecisionsPerAgent: 'unavailable',
    reason: `${AUDIT_LOG_FILENAME} records carry no agentId, so allow/deny/warn counts cannot be split per agent. Agent rows come from ${KPI_LOG_FILENAME} and cover tool calls only.`,
  };

  if (kpiSource.status === SOURCE_STATUS.MISSING) {
    return {
      ...base,
      status: 'missing-source',
      reason: `${KPI_LOG_FILENAME} is not present at ${kpiSource.path}; no agent identity is recorded anywhere in this store.`,
    };
  }
  if (kpiSource.status === SOURCE_STATUS.UNREADABLE) {
    return {
      ...base,
      status: 'unreadable-source',
      reason: `${KPI_LOG_FILENAME} could not be read: ${kpiSource.error}`,
    };
  }
  if (kpiSource.status === SOURCE_STATUS.EMPTY) {
    return {
      ...base,
      status: 'empty-source',
      reason: `${KPI_LOG_FILENAME} exists at ${kpiSource.path} but holds no parsable records.`,
    };
  }
  if (agents.length === 0) {
    return { ...base, status: 'no-agents-in-window' };
  }

  const unknown = agents.find(
    (a) => a.agentId === 'unknown' || a.agentId === '(no agentId recorded)'
  );
  return {
    ...base,
    status: 'partial',
    distinctAgents: agents.length,
    unattributedCalls: unknown ? unknown.calls : 0,
  };
}

/**
 * falseDenyRate = paired reversals / denies observed.
 *
 * Returns null (with a reason) whenever a real denominator was not observed.
 * The numerator and denominator are ALWAYS returned raw so the caller can see
 * exactly what the rate was — or was not — computed from.
 */
function computeFalseDeny(auditSource, auditInWindow, windowDays) {
  const unmeasurable = (reason) => ({
    falseDenyRate: null,
    falseDenyReason: reason,
    falseDenyNumerator: null,
    falseDenyDenominator: null,
    falseDenyClearEvents: null,
    falseDenyMethod: null,
  });

  if (auditSource.status === SOURCE_STATUS.MISSING) {
    return unmeasurable(`${AUDIT_LOG_FILENAME} is missing at ${auditSource.path}. Deny and reversal records both live there, so no numerator and no denominator exist.`);
  }
  if (auditSource.status === SOURCE_STATUS.UNREADABLE) {
    return unmeasurable(`${AUDIT_LOG_FILENAME} at ${auditSource.path} could not be read (${auditSource.error}). Nothing was measured.`);
  }
  if (auditSource.status === SOURCE_STATUS.EMPTY) {
    return unmeasurable(`${AUDIT_LOG_FILENAME} exists at ${auditSource.path} but holds no parsable records. There were no denies to measure — this is an absent measurement, not a rate of zero.`);
  }

  const { numerator, denominator, clearEvents } = pairDeniesWithClears(auditInWindow);
  const method = `1:1 pairing — each ${[...CLEARING_DECISIONS].join('/')} record in ${AUDIT_LOG_FILENAME} is matched to the most recent unpaired preceding deny of the SAME gateId. One receipt clears at most one block, so this is a lower bound on reversals, never an inflated one.`;

  if (denominator === 0) {
    return {
      falseDenyRate: null,
      falseDenyReason: `No deny records in the last ${windowDays} day(s) (${auditSource.records.length} audit record(s) on file overall). A rate over zero denies would require an invented denominator.`,
      falseDenyNumerator: numerator,
      falseDenyDenominator: 0,
      falseDenyClearEvents: clearEvents,
      falseDenyMethod: method,
    };
  }

  return {
    falseDenyRate: Math.round((numerator / denominator) * 10000) / 10000,
    falseDenyReason: null,
    falseDenyNumerator: numerator,
    falseDenyDenominator: denominator,
    falseDenyClearEvents: clearEvents,
    falseDenyMethod: method,
  };
}

/**
 * Build the agent action inventory for one ThumbGate data directory.
 *
 * Read-only: opens files, writes nothing.
 *
 * @param {object} [opts]
 * @param {string} [opts.dataDir] — a ThumbGate store dir (e.g. `<repo>/.thumbgate`).
 *                                  Defaults to the resolved feedback dir.
 * @param {number|string} [opts.windowDays] — lookback in days (clamped 1..365, default 30).
 * @param {number} [opts.topGateLimit=5]
 * @returns {object} the inventory
 */
function buildInventory(opts = {}) {
  const windowDays = normalizeWindowDays(opts.windowDays);
  const topGateLimit = Number.isFinite(opts.topGateLimit) && opts.topGateLimit > 0
    ? Math.floor(opts.topGateLimit)
    : 5;

  let dataDir = opts.dataDir;
  if (!dataDir) {
    // Only reached by callers that did not scope themselves; the CLI always passes one.
    const { resolveFeedbackDir } = require('./feedback-paths');
    dataDir = resolveFeedbackDir();
  }
  dataDir = path.resolve(String(dataDir));

  const nowMs = Date.now();
  const sinceMs = nowMs - windowDays * 24 * 60 * 60 * 1000;

  const auditSource = readJsonlSource(path.join(dataDir, AUDIT_LOG_FILENAME));
  const gateSource = readJsonlSource(path.join(dataDir, GATE_EVENTS_LOG_FILENAME));
  const kpiSource = readJsonlSource(path.join(dataDir, KPI_LOG_FILENAME));

  const auditInWindow = auditSource.records.filter((r) => withinWindow(r, sinceMs));
  const gateInWindow = gateSource.records.filter((r) => withinWindow(r, sinceMs));
  const kpiInWindow = kpiSource.records.filter((r) => withinWindow(r, sinceMs));

  const { daily, undated } = buildDaily(auditInWindow);

  let allowCount = 0;
  let denyCount = 0;
  let warnCount = 0;
  let otherDecisionCount = 0;
  for (const r of auditInWindow) {
    if (r.decision === 'allow') allowCount += 1;
    else if (r.decision === DENY_DECISION) denyCount += 1;
    else if (r.decision === 'warn') warnCount += 1;
    else otherDecisionCount += 1;
  }

  const agents = buildAgents(kpiInWindow);

  const inventory = {
    generatedAt: new Date(nowMs).toISOString(),
    dataDir,
    windowDays,
    since: new Date(sinceMs).toISOString(),

    sources: {
      auditTrail: auditSource.status,
      gateEvents: gateSource.status,
      toolKpi: kpiSource.status,
    },
    // Per-source detail so "0 calls" is always traceable to a file that exists,
    // parsed, and simply had nothing inside the window.
    sourceDetail: {
      auditTrail: sourceDetail(auditSource, auditInWindow.length),
      gateEvents: sourceDetail(gateSource, gateInWindow.length),
      toolKpi: sourceDetail(kpiSource, kpiInWindow.length),
    },

    agents,
    agentAttribution: buildAgentAttribution(kpiSource, agents),

    toolCalls: buildToolCalls(auditInWindow),
    allowCount,
    denyCount,
    warnCount,
    otherDecisionCount,

    denyReasonsByGate: buildDenyReasonsByGate(auditInWindow),
    topGates: buildTopGates(auditInWindow, topGateLimit),

    daily,
    undatedAuditRecords: undated,

    // Independent second view of blocks. gate-events-log.jsonl is written by
    // auditToFeedback() for every non-allow decision; if these two disagree,
    // one of the two writers is broken and the operator should know.
    gateEventDenies: gateSource.status === SOURCE_STATUS.OK
      ? gateInWindow.filter((r) => r.decision === DENY_DECISION).length
      : null,
  };

  Object.assign(inventory, computeFalseDeny(auditSource, auditInWindow, windowDays));

  return inventory;
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

const STATUS_LABEL = {
  [SOURCE_STATUS.OK]: 'ok',
  [SOURCE_STATUS.EMPTY]: 'EMPTY (file present, no records)',
  [SOURCE_STATUS.MISSING]: 'MISSING (file not found)',
  [SOURCE_STATUS.UNREADABLE]: 'UNREADABLE',
};

function renderInventoryText(inv) {
  const lines = [];
  lines.push('ThumbGate agent action inventory');
  lines.push(`  data dir : ${inv.dataDir}`);
  lines.push(`  window   : last ${inv.windowDays} day(s), since ${inv.since}`);
  lines.push('');

  lines.push('Sources');
  for (const [name, status] of Object.entries(inv.sources)) {
    const detail = inv.sourceDetail[name];
    const suffix = status === SOURCE_STATUS.OK
      ? `${detail.recordsInWindow} of ${detail.recordsTotal} record(s) in window`
      : detail.path;
    lines.push(`  ${name.padEnd(11)} ${STATUS_LABEL[status] || status} — ${suffix}`);
  }
  lines.push('');

  lines.push('Decisions in window');
  if (inv.sources.auditTrail !== SOURCE_STATUS.OK) {
    lines.push(`  not measured — audit trail is ${inv.sources.auditTrail}`);
  } else {
    lines.push(`  allow ${inv.allowCount}   deny ${inv.denyCount}   warn ${inv.warnCount}   other ${inv.otherDecisionCount}`);
    const corroborating = inv.gateEventDenies === null
      ? `not measured (gate-events source: ${inv.sources.gateEvents})`
      : inv.gateEventDenies;
    lines.push(`  gate-events-log corroborating denies: ${corroborating}`);
  }
  lines.push('');

  lines.push('Agents');
  if (inv.agents.length === 0) {
    lines.push(`  none — ${inv.agentAttribution.status}: ${inv.agentAttribution.reason}`);
  } else {
    for (const a of inv.agents.slice(0, 10)) {
      const top = a.tools.slice(0, 3).map((t) => `${t.tool}x${t.calls}`).join(', ');
      lines.push(`  ${a.agentId}  ${a.calls} call(s)${top ? `  [${top}]` : ''}`);
    }
    if (inv.agents.length > 10) lines.push(`  ... and ${inv.agents.length - 10} more`);
    lines.push(`  note: ${inv.agentAttribution.reason}`);
  }
  lines.push('');

  lines.push('Tool calls (from audit trail)');
  const tools = Object.entries(inv.toolCalls)
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
  if (tools.length === 0) {
    lines.push(`  none in window (audit trail: ${inv.sources.auditTrail})`);
  } else {
    for (const [tool, c] of tools.slice(0, 10)) {
      lines.push(`  ${tool.padEnd(22)} total ${c.total}  allow ${c.allow}  deny ${c.deny}  warn ${c.warn}`);
    }
    if (tools.length > 10) lines.push(`  ... and ${tools.length - 10} more tool(s)`);
  }
  lines.push('');

  lines.push('Top gates by denies');
  if (inv.topGates.length === 0) {
    lines.push(`  none in window (audit trail: ${inv.sources.auditTrail})`);
  } else {
    for (const g of inv.topGates) {
      lines.push(`  ${g.gate.padEnd(34)} deny ${g.denies}  warn ${g.warns}  override ${g.overrides}`);
    }
  }
  lines.push('');

  lines.push('Daily');
  if (inv.daily.length === 0) {
    lines.push(`  no dated records in window (audit trail: ${inv.sources.auditTrail})`);
  } else {
    for (const d of inv.daily) {
      lines.push(`  ${d.date}  calls ${d.calls}  denies ${d.denies}  warns ${d.warns}`);
    }
    if (inv.undatedAuditRecords > 0) {
      lines.push(`  (${inv.undatedAuditRecords} record(s) had an unparsable timestamp and are excluded)`);
    }
  }
  lines.push('');

  lines.push('False-deny rate');
  if (inv.falseDenyRate === null) {
    lines.push('  null — NOT MEASURED');
    lines.push(`  reason: ${inv.falseDenyReason}`);
  } else {
    lines.push(`  ${(inv.falseDenyRate * 100).toFixed(2)}%`);
  }
  lines.push(`  numerator   : ${inv.falseDenyNumerator === null ? 'n/a' : inv.falseDenyNumerator}`);
  lines.push(`  denominator : ${inv.falseDenyDenominator === null ? 'n/a' : inv.falseDenyDenominator}`);
  lines.push(`  clear events: ${inv.falseDenyClearEvents === null ? 'n/a' : inv.falseDenyClearEvents}`);
  if (inv.falseDenyMethod) lines.push(`  method      : ${inv.falseDenyMethod}`);

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  buildInventory,
  renderInventoryText,
  normalizeWindowDays,
  readJsonlSource,
  pairDeniesWithClears,
  buildAgents,
  buildToolCalls,
  buildDenyReasonsByGate,
  buildTopGates,
  buildDaily,
  SOURCE_STATUS,
  CLEARING_DECISIONS,
  KPI_LOG_FILENAME,
  MIN_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  DEFAULT_WINDOW_DAYS,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function runCli(argv) {
  const args = argv.slice(2);
  const flag = (name) => {
    const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    if (hit === `--${name}`) return true;
    return hit.slice(`--${name}=`.length);
  };

  const json = flag('json') !== undefined;
  const days = flag('days');
  const dataDir = flag('data-dir');

  const inventory = buildInventory({
    dataDir: typeof dataDir === 'string' ? dataDir : undefined,
    windowDays: typeof days === 'string' ? days : undefined,
  });

  if (json) console.log(JSON.stringify(inventory, null, 2));
  else process.stdout.write(renderInventoryText(inventory));
}

// SonarCloud S3403 flags `require.main === module` as an always-false strict
// equality; the path-resolve form is the portable equivalent.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runCli(process.argv);
}
