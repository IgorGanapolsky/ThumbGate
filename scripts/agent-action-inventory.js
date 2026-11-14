#!/usr/bin/env node
'use strict';

// Read-only rollup + 30-day AI governance system of record over audit-trail, gate-events, tool-kpi, and agent-registry.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AUDIT_LOG_FILENAME, GATE_EVENTS_LOG_FILENAME, REGISTRY_FILENAME, OBSERVED_FILENAME } = require('./audit-trail');
const KPI_LOG_FILENAME = 'tool-kpi.jsonl';

const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 365;
const DEFAULT_WINDOW_DAYS = 30;

const DENY_DECISION = 'deny';

// Only decision==='override' or consumed admin-override ('allow' + ADMIN_OVERRIDE_SOURCE) clears a block; 'approve' is a held block.
const CLEARING_DECISION = 'override';
const ADMIN_OVERRIDE_SOURCE = 'gates-engine-admin-override';
const APPROVAL_REQUIRED_DECISION = 'approve';

/** True only for records that genuinely reversed a block. */
function isClearingRecord(record) {
  if (!record) return false;
  if (record.decision === CLEARING_DECISION) return true;
  return record.decision === 'allow' && record.source === ADMIN_OVERRIDE_SOURCE;
}

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

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
function readJsonlSource(filePath, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : DEFAULT_MAX_BYTES;
  const base = {
    path: filePath,
    records: [],
    lines: 0,
    malformed: 0,
    truncated: false,
    bytesRead: 0,
    fileBytes: 0,
  };

  let size;
  try {
    ({ size } = fs.statSync(filePath));
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

  if (size === 0) return { ...base, status: SOURCE_STATUS.EMPTY };

  const readBytes = Math.min(size, maxBytes);
  const truncated = readBytes < size;
  let text = '';
  let fd;
  try {
    const buf = Buffer.alloc(readBytes);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, readBytes, size - readBytes);
    text = buf.toString('utf8');
    if (truncated) {
      // Drop the partial first record left by the byte-offset seek.
      const nl = text.indexOf('\n');
      text = nl === -1 ? '' : text.slice(nl + 1);
    }
  } catch (err) {
    return {
      ...base,
      fileBytes: size,
      status: SOURCE_STATUS.UNREADABLE,
      error: String(err && err.message ? err.message : err),
    };
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return { ...base, status: SOURCE_STATUS.EMPTY, truncated, bytesRead: readBytes, fileBytes: size };
  }

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
      malformed += 1; // a corrupt line must not abort the scan
    }
  }

  return {
    path: filePath,
    // A file of nothing but unparsable lines is empty of DATA, not missing.
    status: records.length > 0 ? SOURCE_STATUS.OK : SOURCE_STATUS.EMPTY,
    records,
    lines: lines.length,
    malformed,
    truncated,
    bytesRead: readBytes,
    fileBytes: size,
  };
}

// False when truncated and oldest surviving record is newer than sinceMs.
function coversWindow(source, sinceMs) {
  if (source.status !== SOURCE_STATUS.OK) return null;
  if (!source.truncated) return true;
  let oldest = null;
  for (const r of source.records) {
    const ts = timestampMs(r);
    if (ts === null) continue;
    if (oldest === null || ts < oldest) oldest = ts;
  }
  if (oldest === null) return false;
  return oldest <= sinceMs;
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

// 1:1 pairing: each reversal matches the most recent unpaired preceding deny of the same gate.
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
    } else if (isClearingRecord(r) && gateId) {
      clearEvents.push({ ts, gateId, decision: r.decision, source: r.source || null });
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
    if (!byTool[tool]) {
      byTool[tool] = { total: 0, allow: 0, deny: 0, warn: 0, approvalRequired: 0, other: 0 };
    }
    const bucket = byTool[tool];
    bucket.total += 1;
    if (r.decision === APPROVAL_REQUIRED_DECISION) bucket.approvalRequired += 1;
    else if (r.decision === DENY_DECISION) bucket.deny += 1;
    else if (r.decision === 'warn') bucket.warn += 1;
    else if (r.decision === 'allow') bucket.allow += 1;
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
      byGate[r.gateId] = {
        gate: r.gateId,
        denies: 0,
        warns: 0,
        approvalRequired: 0,
        overrides: 0,
        other: 0,
      };
    }
    const bucket = byGate[r.gateId];
    if (r.decision === DENY_DECISION) bucket.denies += 1;
    else if (r.decision === 'warn') bucket.warns += 1;
    else if (r.decision === APPROVAL_REQUIRED_DECISION) bucket.approvalRequired += 1;
    else if (isClearingRecord(r)) bucket.overrides += 1;
    else bucket.other += 1;
  }
  return Object.values(byGate)
    .sort((a, b) => b.denies - a.denies || b.warns - a.warns || a.gate.localeCompare(b.gate))
    .slice(0, limit);
}

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

function sourceDetail(source, inWindow, sinceMs) {
  const detail = {
    status: source.status,
    path: source.path,
    recordsTotal: source.records.length,
    recordsInWindow: source.status === SOURCE_STATUS.OK ? inWindow : null,
    malformedLines: source.malformed,
    truncated: Boolean(source.truncated),
    bytesRead: source.bytesRead || 0,
    fileBytes: source.fileBytes || 0,
    coversWindow: coversWindow(source, sinceMs),
  };
  if (source.error) detail.error = source.error;
  return detail;
}

function buildAgentAttribution(kpiSource, agents) {
  const base = {
    identitySource: KPI_LOG_FILENAME,
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

// falseDenyRate = paired reversals / denies observed (null when denominator is 0 or source missing/empty).
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
  const method = `1:1 pairing — each reversal receipt in ${AUDIT_LOG_FILENAME} is matched to the most recent unpaired preceding deny of the SAME gateId. A reversal receipt is decision "${CLEARING_DECISION}", or decision "allow" with source "${ADMIN_OVERRIDE_SOURCE}" (a consumed single-use admin override). Decision "${APPROVAL_REQUIRED_DECISION}" is deliberately NOT counted: gates-engine emits it with requiresApproval:true and renders it to the harness as permissionDecision "deny", so it is itself a block, not a clearance. One receipt clears at most one block, so the numerator is a lower bound on reversals, never an inflated one.`;

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

// Build read-only agent action inventory for dataDir.
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

  const readOpts = { maxBytes: opts.maxBytes };
  const auditSource = readJsonlSource(path.join(dataDir, AUDIT_LOG_FILENAME), readOpts);
  const gateSource = readJsonlSource(path.join(dataDir, GATE_EVENTS_LOG_FILENAME), readOpts);
  const kpiSource = readJsonlSource(path.join(dataDir, KPI_LOG_FILENAME), readOpts);

  const auditInWindow = auditSource.records.filter((r) => withinWindow(r, sinceMs));
  const gateInWindow = gateSource.records.filter((r) => withinWindow(r, sinceMs));
  const kpiInWindow = kpiSource.records.filter((r) => withinWindow(r, sinceMs));

  const { daily, undated } = buildDaily(auditInWindow);

  let allowCount = 0;
  let denyCount = 0;
  let warnCount = 0;
  let approvalRequiredCount = 0;
  let overrideCount = 0;
  let otherDecisionCount = 0;
  for (const r of auditInWindow) {
    if (r.decision === APPROVAL_REQUIRED_DECISION) approvalRequiredCount += 1;
    else if (r.decision === DENY_DECISION) denyCount += 1;
    else if (r.decision === 'warn') warnCount += 1;
    else if (r.decision === 'allow') allowCount += 1;
    else otherDecisionCount += 1;
    if (isClearingRecord(r)) overrideCount += 1;
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
    sourceDetail: {
      auditTrail: sourceDetail(auditSource, auditInWindow.length, sinceMs),
      gateEvents: sourceDetail(gateSource, gateInWindow.length, sinceMs),
      toolKpi: sourceDetail(kpiSource, kpiInWindow.length, sinceMs),
    },
    windowFullyCovered: coversWindow(auditSource, sinceMs),

    agents,
    agentAttribution: buildAgentAttribution(kpiSource, agents),

    toolCalls: buildToolCalls(auditInWindow),
    allowCount,
    denyCount,
    warnCount,
    // Also a block: gates-engine renders 'approve' to the harness as
    // permissionDecision 'deny' with "APPROVAL REQUIRED". Reported on its own
    // rather than folded into denyCount, because the false-deny denominator is
    // defined strictly as decision === 'deny' and must not silently widen.
    approvalRequiredCount,
    overrideCount,
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
    if (detail.truncated) {
      lines.push(`              TRUNCATED: read the last ${detail.bytesRead} of ${detail.fileBytes} bytes; counts above cover only that tail`);
    }
  }
  if (inv.windowFullyCovered === false) {
    lines.push('');
    lines.push('  WARNING: the audit-trail tail window did not reach back to the start of the');
    lines.push('  requested window. Every count below is a PARTIAL view. Raise --days scope or');
    lines.push('  pass a larger maxBytes to cover it fully.');
  }
  lines.push('');

  lines.push('Decisions in window');
  if (inv.sources.auditTrail !== SOURCE_STATUS.OK) {
    lines.push(`  not measured — audit trail is ${inv.sources.auditTrail}`);
  } else {
    lines.push(`  allow ${inv.allowCount}   deny ${inv.denyCount}   warn ${inv.warnCount}   other ${inv.otherDecisionCount}`);
    lines.push(`  approval-required ${inv.approvalRequiredCount} (also blocks; excluded from the false-deny denominator)`);
    lines.push(`  reversals (override / consumed admin override): ${inv.overrideCount}`);
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
      lines.push(`  ${g.gate.padEnd(34)} deny ${g.denies}  warn ${g.warns}  approval ${g.approvalRequired}  reversed ${g.overrides}`);
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

const AGENT_REGISTER_CONFIG_FILENAME = 'agent-register.json';
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const UNREGISTERED_AGENT_FLAG = 'unregistered agent';
const UNATTRIBUTED_IDS = new Set(['unknown', '(no agentId recorded)']);
const BUILTIN_MCP_SERVERS = new Set(['thumbgate', 'mcp', 'mcp-http']);
const alphaCmp = (a, b) => a.localeCompare(b);
const isSafeKey = (k) => typeof k === 'string' && k.trim().length > 0 && k.trim().length <= 128 && !UNSAFE_KEYS.has(k.trim());
const firstStr = (arr) => { for (const v of arr) if (typeof v === 'string' && v.trim()) return v.trim(); return null; };
const resolveDataDir = (d) => path.resolve(d ? String(d) : require('./feedback-paths').resolveFeedbackDir());

function badRequestError(msg) {
  const err = new Error(msg);
  err.statusCode = 400;
  return err;
}

function resolveDefaultOwner(opts = {}) {
  const explicit = firstStr([opts.defaultOwner, process.env.THUMBGATE_DEFAULT_OWNER]);
  if (explicit) return explicit;
  try { const u = os.userInfo().username; if (u?.trim()) return u.trim(); } catch {}
  return firstStr([process.env.USER, process.env.USERNAME]) || 'local-operator';
}

function readJsonObj(p) {
  if (!p || !fs.existsSync(p)) return null;
  try { const x = JSON.parse(fs.readFileSync(p, 'utf8')); return x && typeof x === 'object' && !Array.isArray(x) ? x : null; } catch { return null; }
}

function mergeOwnersObj(owners, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  for (const [k, v] of Object.entries(raw)) {
    if (isSafeKey(k) && typeof v === 'string' && v.trim()) owners.set(k.trim(), v.trim().slice(0, 128));
  }
}

function mergeRegDoc(owners, registered, src) {
  if (!src || typeof src !== 'object') return;
  mergeOwnersObj(owners, src.owners);
  if (!Array.isArray(src.registered)) return;
  for (const x of src.registered) if (isSafeKey(x)) registered.add(x.trim());
}

function loadAgentRegisterConfig(dataDir) {
  const owners = new Map(), registered = new Set();
  for (const f of ['settings.json', 'settings.local.json']) mergeRegDoc(owners, registered, readJsonObj(path.join(dataDir, f))?.agents);
  mergeRegDoc(owners, registered, readJsonObj(path.join(dataDir, AGENT_REGISTER_CONFIG_FILENAME)));
  return { owners, registered };
}

function applyOwnerUpdate(owners, key, owner) {
  if (owner === undefined) return;
  if (owner !== null && typeof owner !== 'string') throw badRequestError('Owner must be a string or null.');
  const clean = owner === null ? '' : owner.trim().slice(0, 128);
  if (!clean) owners.delete(key);
  else owners.set(key, clean);
}

function updateAgentRegisterEntry({ dataDir, id, owner, registered } = {}) {
  if (!isSafeKey(id)) throw badRequestError('Valid agent or surface id is required.');
  const dir = resolveDataDir(dataDir), filePath = path.join(dir, AGENT_REGISTER_CONFIG_FILENAME);
  const owners = new Map(), regSet = new Set(), key = id.trim();
  mergeRegDoc(owners, regSet, readJsonObj(filePath));
  applyOwnerUpdate(owners, key, owner);
  if (registered === true) regSet.add(key);
  else if (registered === false) regSet.delete(key);
  const nextDoc = { owners: Object.fromEntries(owners), registered: [...regSet].sort(alphaCmp), updatedAt: new Date().toISOString() };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(nextDoc, null, 2)}\n`);
  return nextDoc;
}

function parseMcpTool(t) {
  const raw = typeof t === 'string' ? t.trim() : '';
  if (!raw.startsWith('mcp__')) return null;
  const rest = raw.slice(5), d = rest.indexOf('__'), s = rest.indexOf('_');
  if (d > 0) return { server: rest.slice(0, d), tool: rest.slice(d + 2) };
  return s > 0 ? { server: rest.slice(0, s), tool: rest.slice(s + 1) } : null;
}

function loadMcpAllowlistIndex(allowlistsPath) {
  const p = allowlistsPath || process.env.THUMBGATE_MCP_POLICY_PATH || path.join(__dirname, '..', 'config', 'mcp-allowlists.json');
  const parsed = readJsonObj(p) || {}, tools = new Set(), agents = new Set(), mcpServers = new Set(BUILTIN_MCP_SERVERS);
  for (const list of Object.values(parsed.profiles || {})) {
    if (Array.isArray(list)) for (const t of list) if (typeof t === 'string' && t.trim()) tools.add(t.trim());
  }
  for (const a of (parsed.agents || parsed.allowlistedAgents || [])) if (isSafeKey(a)) agents.add(a.trim());
  for (const s of (parsed.mcpServers || parsed.servers || [])) if (isSafeKey(s)) mcpServers.add(s.trim());
  return { path: p, tools, agents, mcpServers };
}

function touchBucket(map, id, kind, tsMs, delta = 1) {
  if (!isSafeKey(id)) return null;
  const key = id.trim();
  let b = map.get(key);
  if (!b) { b = { id: key, kind, callCount: 0, firstSeenMs: null, lastSeenMs: null, tools: new Set() }; map.set(key, b); }
  b.callCount += delta;
  if (tsMs !== null && Number.isFinite(tsMs)) {
    if (b.firstSeenMs === null || tsMs < b.firstSeenMs) b.firstSeenMs = tsMs;
    if (b.lastSeenMs === null || tsMs > b.lastSeenMs) b.lastSeenMs = tsMs;
  }
  return b;
}

function resolveRecordMcpServer(r, tool, allowTools) {
  const pm = parseMcpTool(tool);
  const explicit = pm?.server || firstStr([r.mcpServer, r.metadata?.mcpServer, r.metadata?.serverName, r.serverName]);
  if (explicit && explicit !== 'default') return explicit;
  return tool && allowTools.has(tool) ? 'thumbgate' : null;
}

function ingestSingleRecord(r, maps, allowTools) {
  const ts = timestampMs(r), tool = firstStr([r.toolName]) || '';
  const rawAgent = firstStr([r.agentId]);
  if (rawAgent && !UNATTRIBUTED_IDS.has(rawAgent)) {
    const ab = touchBucket(maps.agents, rawAgent, 'agent', ts, 1);
    if (ab && tool) ab.tools.add(tool);
  } else {
    maps.unattributedCalls += 1;
  }
  const model = firstStr([r.model, r.metadata?.model, r.toolInput?.model]);
  if (model) touchBucket(maps.models, model, 'model', ts, 1);
  const srv = resolveRecordMcpServer(r, tool, allowTools);
  if (srv) { const sb = touchBucket(maps.mcpServers, srv, 'mcp_server', ts, 1); if (sb && tool) sb.tools.add(tool); }
  const hook = firstStr([r.source, r.metadata?.hookSource, r.metadata?.source]);
  if (hook) touchBucket(maps.hookSources, hook, 'hook_source', ts, 1);
}

function ingestRecords(records, maps, allowTools) {
  for (const r of records) if (r && typeof r === 'object') ingestSingleRecord(r, maps, allowTools);
}

function ingestRegistryEntry(reg, sinceMs, maps, state) {
  if (!reg || !isSafeKey(reg.id)) return;
  const id = reg.id.trim(), meta = reg.metadata && typeof reg.metadata === 'object' ? reg.metadata : {};
  if (meta.lifecycleStatus === 'retired') { state.retired.add(id); state.active.delete(id); }
  else { state.retired.delete(id); state.active.add(id); }
  if (typeof meta.owner === 'string' && meta.owner.trim()) state.owners.set(id, meta.owner.trim());
  const lastMs = timestampMs(reg, 'lastSeenAt') ?? timestampMs(reg, 'registeredAt');
  if (lastMs === null || lastMs < sinceMs) return;
  const b = touchBucket(maps.agents, id, 'agent', timestampMs(reg, 'registeredAt') ?? lastMs, 0);
  if (b) { touchBucket(maps.agents, id, 'agent', lastMs, 0); b.callCount = Math.max(b.callCount, Number(reg.toolCalls) || 0); }
  const m = firstStr([meta.model]), s = firstStr([reg.source]);
  if (m) touchBucket(maps.models, m, 'model', lastMs, 0);
  if (s && s !== 'unknown') touchBucket(maps.hookSources, s, 'hook_source', lastMs, 0);
}

function ingestObservedEntry(obs, sinceMs, maps) {
  if (!obs || !isSafeKey(obs.id)) return;
  const lastMs = timestampMs(obs, 'lastSeenAt') ?? timestampMs(obs, 'seenAt');
  if (lastMs === null || lastMs < sinceMs) return;
  const id = obs.id.trim(), cnt = Number(obs.observations) > 0 ? Number(obs.observations) : 1;
  const cur = maps.agents.get(id);
  const b = touchBucket(maps.agents, id, 'agent', timestampMs(obs, 'firstSeenAt') ?? lastMs, cur ? Math.max(0, cnt - cur.callCount) : cnt);
  if (b) touchBucket(maps.agents, id, 'agent', lastMs, 0);
}

function isMcpServerRegistered(b, regCfg, allow) {
  if (regCfg.registered.has(b.id) || allow.mcpServers.has(b.id)) return true;
  return b.tools.size > 0 && [...b.tools].every((t) => allow.tools.has(t));
}

const toRow = (b, owner, registered) => ({
  id: b.id, kind: b.kind,
  firstSeen: b.firstSeenMs !== null ? new Date(b.firstSeenMs).toISOString() : null,
  lastSeen: b.lastSeenMs !== null ? new Date(b.lastSeenMs).toISOString() : null,
  callCount: b.callCount, owner, registered,
  status: registered ? 'registered' : UNREGISTERED_AGENT_FLAG,
  flag: registered ? null : UNREGISTERED_AGENT_FLAG,
  tools: [...b.tools].sort(alphaCmp),
});
const sortRows = (rows) => rows.sort((a, b) => b.callCount - a.callCount || a.id.localeCompare(b.id));

function buildAgentRegister(opts = {}) {
  const windowDays = normalizeWindowDays(opts.windowDays), dataDir = resolveDataDir(opts.dataDir);
  const parsedNow = opts.now ? new Date(opts.now).getTime() : Date.now();
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now(), sinceMs = nowMs - windowDays * 86400000;
  const defaultOwner = resolveDefaultOwner(opts), regCfg = loadAgentRegisterConfig(dataDir), allow = loadMcpAllowlistIndex(opts.allowlistsPath);
  const ro = { maxBytes: opts.maxBytes };
  const maps = { agents: new Map(), models: new Map(), mcpServers: new Map(), hookSources: new Map(), unattributedCalls: 0 };
  ingestRecords(require('./project-catalog').readProjectRows(dataDir, AUDIT_LOG_FILENAME, { ...opts, projectKey: opts.projectKey }).filter((r) => withinWindow(r, sinceMs)), maps, allow.tools);
  ingestRecords(require('./project-catalog').readProjectRows(dataDir, KPI_LOG_FILENAME, { ...opts, projectKey: opts.projectKey }).filter((r) => withinWindow(r, sinceMs)), maps, allow.tools);
  const regState = { active: new Set(), retired: new Set(), owners: new Map() };
  for (const reg of require('./project-catalog').readProjectRows(dataDir, REGISTRY_FILENAME, { ...opts, projectKey: opts.projectKey, dedupe: false })) ingestRegistryEntry(reg, sinceMs, maps, regState);
  for (const obs of require('./project-catalog').readProjectRows(dataDir, OBSERVED_FILENAME, { ...opts, projectKey: opts.projectKey, dedupe: false })) ingestObservedEntry(obs, sinceMs, maps);
  const ownerFor = (id) => regCfg.owners.get(id) || regState.owners.get(id) || defaultOwner;
  const agents = sortRows([...maps.agents.values()].map((b) => {
    const inReg = regCfg.registered.has(b.id) || (regState.active.has(b.id) && !regState.retired.has(b.id));
    return toRow(b, ownerFor(b.id), inReg || allow.agents.has(b.id));
  }));
  const mcpServers = sortRows([...maps.mcpServers.values()].map((b) => toRow(b, ownerFor(b.id), isMcpServerRegistered(b, regCfg, allow))));
  const models = sortRows([...maps.models.values()].map((b) => toRow(b, ownerFor(b.id), true)));
  const hookSources = sortRows([...maps.hookSources.values()].map((b) => toRow(b, ownerFor(b.id), true)));
  const unregisteredAgentsList = agents.filter((a) => !a.registered);
  const unregistered = [...unregisteredAgentsList, ...mcpServers.filter((s) => !s.registered)];
  return {
    generatedAt: new Date(nowMs).toISOString(), dataDir, windowDays, since: new Date(sinceMs).toISOString(), defaultOwner, allowlistsPath: allow.path,
    summary: {
      totalAgents: agents.length, registeredAgents: agents.length - unregisteredAgentsList.length, unregisteredAgents: unregisteredAgentsList.length,
      unregisteredMcpServers: mcpServers.length - mcpServers.filter((s) => s.registered).length, unregisteredTotal: unregistered.length,
      unattributedCalls: maps.unattributedCalls, totalModels: models.length, totalMcpServers: mcpServers.length, totalHookSources: hookSources.length,
    },
    agents, models, mcpServers, hookSources, unregistered,
  };
}

function renderAgentRegisterText(report) {
  const out = [
    `ThumbGate Agent Register (last ${report.windowDays}d, default owner: ${report.defaultOwner})`,
    `  agents: ${report.summary.totalAgents} (${report.summary.registeredAgents} registered, ${report.summary.unregisteredAgents} ${UNREGISTERED_AGENT_FLAG})`,
    `  models: ${report.summary.totalModels} · mcp servers: ${report.summary.totalMcpServers} · hook sources: ${report.summary.totalHookSources}`, '',
  ];
  for (const [label, rows, badge] of [['Agents', report.agents, true], ['Models', report.models, false], ['MCP servers', report.mcpServers, true], ['Hook sources', report.hookSources, false]]) {
    out.push(label);
    if (!rows.length) out.push('  none seen in window');
    for (const r of rows) out.push(`  ${r.id.padEnd(24)} calls=${r.callCount}  owner=${r.owner}  first=${r.firstSeen || 'n/a'}  last=${r.lastSeen || 'n/a'}${badge ? `  [${r.status}]` : ''}`);
    out.push('');
  }
  return out.join('\n');
}
// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  buildInventory,
  renderInventoryText,
  buildAgentRegister,
  renderAgentRegisterText,
  updateAgentRegisterEntry,
  loadAgentRegisterConfig,
  isSafeKey,
  resolveDefaultOwner,
  normalizeWindowDays,
  readJsonlSource,
  pairDeniesWithClears,
  buildAgents,
  buildToolCalls,
  buildDenyReasonsByGate,
  buildTopGates,
  buildDaily,
  coversWindow,
  isClearingRecord,
  SOURCE_STATUS,
  CLEARING_DECISION,
  ADMIN_OVERRIDE_SOURCE,
  APPROVAL_REQUIRED_DECISION,
  DEFAULT_MAX_BYTES,
  KPI_LOG_FILENAME,
  AGENT_REGISTER_CONFIG_FILENAME,
  UNREGISTERED_AGENT_FLAG,
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
  const maxBytes = flag('max-bytes');

  const inventory = buildInventory({
    dataDir: typeof dataDir === 'string' ? dataDir : undefined,
    windowDays: typeof days === 'string' ? days : undefined,
    maxBytes: typeof maxBytes === 'string' ? Number(maxBytes) : undefined,
  });

  if (json) console.log(JSON.stringify(inventory, null, 2));
  else process.stdout.write(renderInventoryText(inventory));
}

// SonarCloud S3403 flags `require.main === module` as an always-false strict
// equality; the path-resolve form is the portable equivalent.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runCli(process.argv);
}
