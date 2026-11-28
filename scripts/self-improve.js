'use strict';

// ---------------------------------------------------------------------------
// self-improve — the closed loop that turns ThumbGate's own evidence into
// changes to its own gates, and records whether the agent is getting better.
//
// Inputs (no new capture): auto-promoted-gates.json, gate-stats.json, audit-trail.jsonl (overrides and
// prior allowed actions for the trigger replay), and lesson-effect.js (repeat misses per 100 injections).
//
// What it does each cycle:
//   1. Tune: a block gate that fires on actions that were safe before, or that
//      people keep overriding, is proposed for warn. A warn gate that keeps
//      firing, was never overridden and has strong trigger evidence is proposed
//      for block.
//   2. Measure: appends one snapshot a day to self-improvement-history.jsonl so
//      the repeat-miss rate has a trend, not just a number.
//
// Law 12 (new gates ship warn-only or opt-in first): proposals are only
// applied with `thumbgate improve --apply` or THUMBGATE_SELF_TUNE=apply.
// Hand-made gates (expiresAt null) are never changed by the tuner.
// ---------------------------------------------------------------------------

const fs = require('node:fs');
const path = require('node:path');

const HISTORY_FILE = 'self-improvement-history.jsonl';
const SNAPSHOT_INTERVAL_MS = 20 * 60 * 60 * 1000; // one snapshot a day, with slack for session timing
const LOOSEN_MIN_OVERRIDES = 2;
const LOOSEN_MIN_FIRES = 6; // below this the override share is noise (3 clean fires bound precision at ~0.47)
const LOOSEN_OVERRIDE_SHARE = 1 / 3; // a third of fires overridden => the gate is in the way more than it helps
const TIGHTEN_MIN_FIRES = 3;

// 'apply' (explicit --apply) changes gates both ways. THUMBGATE_SELF_TUNE=apply, the unattended
// path, only tightens: loosening a guard always waits for a person to run --apply.
function selfTuneMode(env = process.env, argv = []) {
  if (argv.includes('--apply')) return 'apply';
  return String(env.THUMBGATE_SELF_TUNE || '').trim().toLowerCase() === 'apply' ? 'tighten-only' : 'propose';
}

// Overrides a person made. satisfy_gate over MCP is the agent unlocking its own block, so it never
// counts toward loosening a gate.
const HUMAN_OVERRIDE_SOURCES = new Set(['cli', 'break-glass', 'api']);
function humanOverridesByGate(records = []) {
  const byGate = {};
  for (const rec of records) {
    const o = (rec && rec.override) || {};
    if (!o.gateId || !HUMAN_OVERRIDE_SOURCES.has(o.source)) continue;
    byGate[o.gateId] = (byGate[o.gateId] || 0) + 1;
  }
  return byGate;
}

function isHandMade(gate) {
  return !gate || gate.expiresAt === null || gate.expiresAt === undefined || gate.source === 'manual';
}

// Pure: decide what each learned gate should become.
// gates: auto-promoted gates; statsByGate: gate-stats byGate; overridesByGate: { id: n };
// auditRows: auditGateTriggers() rows.
function classifyGates({ gates = [], statsByGate = {}, overridesByGate = {}, auditRows = [] } = {}) {
  const auditById = new Map(auditRows.map((row) => [row.gateId, row]));
  return gates.map((gate) => {
    const stat = statsByGate[gate.id] || {};
    const fires = (Number(stat.blocked) || 0) + (Number(stat.warned) || 0);
    const overrides = Number(overridesByGate[gate.id]) || 0;
    const audit = auditById.get(gate.id) || { evidence: 'none', falseBlocks: 0, allowSampleSize: 0 };
    const base = {
      gateId: gate.id,
      action: gate.action,
      fires,
      overrides,
      evidence: audit.evidence,
      falseBlocks: audit.falseBlocks || 0,
      allowSampleSize: audit.allowSampleSize || 0,
    };
    if (isHandMade(gate)) return { ...base, verdict: 'keep', reason: 'made by hand; the tuner never changes it' };

    if (gate.action === 'block') {
      if (audit.evidence === 'fires-on-safe-actions') {
        return { ...base, verdict: 'loosen', to: 'warn', reason: `would have blocked ${audit.falseBlocks} of ${audit.allowSampleSize} earlier safe actions` };
      }
      if (fires >= LOOSEN_MIN_FIRES && overrides >= LOOSEN_MIN_OVERRIDES && overrides / fires >= LOOSEN_OVERRIDE_SHARE) {
        return { ...base, verdict: 'loosen', to: 'warn', reason: `overridden by a person ${overrides} times in ${fires} fires` };
      }
    }
    if (gate.action === 'warn' && fires >= TIGHTEN_MIN_FIRES && overrides === 0 && audit.evidence === 'strong') {
      return { ...base, verdict: 'tighten', to: 'block', reason: `fired ${fires} times, never overridden, 0 false fires in ${audit.allowSampleSize} safe actions` };
    }
    return { ...base, verdict: 'keep', reason: fires === 0 ? 'has not fired yet' : 'working as intended' };
  });
}

// Apply loosen/tighten verdicts to a gates file object. Returns { data, applied }.
function applyVerdicts(data, verdicts, now = new Date(), { allowLoosen = true } = {}) {
  const wanted = allowLoosen ? ['loosen', 'tighten'] : ['tighten'];
  const byId = new Map(verdicts.filter((v) => wanted.includes(v.verdict)).map((v) => [v.gateId, v]));
  const applied = [];
  const gates = (data.gates || []).map((gate) => {
    const v = byId.get(gate.id);
    if (!v || isHandMade(gate) || gate.action === v.to) return gate;
    applied.push({ gateId: gate.id, from: gate.action, to: v.to, reason: v.reason });
    // occurrencesAtTune lets auto-promote tell new thumbs-downs from the ones this decision already weighed.
    const next = { ...gate, action: v.to, previousAction: gate.action, tunedBy: 'self-improve', tunedAt: now.toISOString(), tuneReason: v.reason, occurrencesAtTune: Number(gate.occurrences) || 0 };
    if (v.to === 'warn') delete next.hardDeny;
    return next;
  });
  const promotionLog = [
    ...(data.promotionLog || []),
    ...applied.map((a) => ({ type: 'self-tune', gateId: a.gateId, from: a.from, to: a.to, reason: a.reason, timestamp: now.toISOString() })),
  ];
  return { data: { ...data, gates, promotionLog }, applied };
}

function readHistory(feedbackDir) {
  let text = '';
  try { text = fs.readFileSync(path.join(feedbackDir, HISTORY_FILE), 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* torn line */ }
  }
  return rows;
}

function appendSnapshot(feedbackDir, snapshot, { force = false, nowMs = Date.now() } = {}) {
  const history = readHistory(feedbackDir);
  const last = history[history.length - 1];
  const lastAt = last ? Date.parse(last.at) : NaN;
  if (!force && Number.isFinite(lastAt) && nowMs - lastAt < SNAPSHOT_INTERVAL_MS) return { written: false, history };
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.appendFileSync(path.join(feedbackDir, HISTORY_FILE), `${JSON.stringify(snapshot)}\n`);
  return { written: true, history: [...history, snapshot] };
}

// Trend over the history: first vs latest repeat-miss rate where both exist.
function summarizeTrend(history) {
  const rated = history.filter((row) => typeof row.repeatMissesPer100 === 'number');
  if (rated.length < 2) return { points: rated.length, change: null };
  const first = rated[0];
  const latest = rated[rated.length - 1];
  return {
    points: rated.length,
    from: { at: first.at, repeatMissesPer100: first.repeatMissesPer100 },
    to: { at: latest.at, repeatMissesPer100: latest.repeatMissesPer100 },
    change: Math.round((latest.repeatMissesPer100 - first.repeatMissesPer100) * 10) / 10,
  };
}

// Session hooks call this first so the audit-trail replay runs at most once a day.
function isCycleDue(feedbackDir, nowMs = Date.now()) {
  const history = readHistory(feedbackDir);
  const last = history[history.length - 1];
  const lastAt = last ? Date.parse(last.at) : NaN;
  return !Number.isFinite(lastAt) || nowMs - lastAt >= SNAPSHOT_INTERVAL_MS;
}

// One line for the agent's session context from a snapshot (the latest history row), or null.
function sessionReminder(snapshot) {
  if (!snapshot) return null;
  const changes = Array.isArray(snapshot.changes) ? snapshot.changes : [];
  const parts = [];
  if (snapshot.repeatMissesPer100 != null) parts.push(`repeat misses ${snapshot.repeatMissesPer100} per 100 lesson injections`);
  if (changes.length) {
    parts.push(`${changes.length} gate change(s): ${changes.slice(0, 3).map((c) => `${c.gateId} ${c.from}->${c.to}${c.applied ? '' : ' (proposed)'}`).join(', ')}`);
  }
  return parts.length ? `ThumbGate daily self-review: ${parts.join('; ')}. Details: thumbgate improve` : null;
}

// Session hooks must stay fast: the cycle replays the audit trail, so it runs in a
// detached child, and the hook reports the previous cycle's snapshot.
function startCycleInBackground(cliPath, env = process.env) {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [cliPath, 'improve', '--quiet'], { stdio: 'ignore', detached: true, env });
  child.unref();
  return child.pid;
}

// Dashboard panel data: the latest cycle, the trend, and up to 30 daily repeat-miss points.
function dashboardPanel(feedbackDir) {
  const history = feedbackDir ? readHistory(feedbackDir) : [];
  const latest = history[history.length - 1] || null;
  return {
    latest,
    trend: summarizeTrend(history),
    points: history.slice(-30).map((row) => ({ at: row.at, repeatMissesPer100: typeof row.repeatMissesPer100 === 'number' ? row.repeatMissesPer100 : null })),
  };
}

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

// Gather live inputs, classify, optionally apply, snapshot. Every source is best-effort:
// a missing store means "no evidence", never a crash in a session hook.
function runSelfImprovement(options = {}) {
  const env = options.env || process.env;
  const mode = options.mode || selfTuneMode(env, options.argv || []);
  const autoGates = require('./auto-promote-gates');
  const gatesEngine = require('./gates-engine');
  const { summarizeOverrides } = require('./override-audit');
  const { getFeedbackPaths } = require('./feedback-loop');

  const feedbackDir = options.feedbackDir || safe(() => getFeedbackPaths().FEEDBACK_DIR, null);
  const gateOpts = options.feedbackDir ? { feedbackDir: options.feedbackDir } : {};
  const data = safe(() => autoGates.loadAutoGates(gateOpts), { version: 1, gates: [], promotionLog: [] });
  const stats = safe(() => gatesEngine.loadStats(), { byGate: {} });
  const overrides = safe(() => summarizeOverrides({ limit: 5000 }), { byGate: {}, total: 0, records: [] });
  const auditRows = safe(() => autoGates.auditGateTriggers({ ...gateOpts, data }), []);
  const human = safe(() => require('./statusline-human-counts').computeHumanCounts({ env }), null);

  const verdicts = classifyGates({ gates: data.gates || [], statsByGate: stats.byGate || {}, overridesByGate: humanOverridesByGate(overrides.records), auditRows });
  let applied = [];
  if (mode === 'apply' || mode === 'tighten-only') {
    const result = applyVerdicts(data, verdicts, new Date(), { allowLoosen: mode === 'apply' });
    applied = result.applied;
    if (applied.length) autoGates.saveAutoGates(result.data, gateOpts);
  }

  const count = (verdict) => verdicts.filter((v) => v.verdict === verdict).length;
  const effect = (human && human.lessonEffect) || {};
  const snapshot = {
    at: new Date(options.nowMs || Date.now()).toISOString(),
    mode,
    learnedGates: verdicts.length,
    blockGates: verdicts.filter((v) => v.action === 'block').length,
    warnGates: verdicts.filter((v) => v.action === 'warn').length,
    proposedLoosen: count('loosen'),
    proposedTighten: count('tighten'),
    applied: applied.length,
    overrides: overrides.total || 0,
    recurringBlocks: Number(stats.recurringBlocks) || 0,
    thumbsUp: human ? human.up : null,
    thumbsDown: human ? human.down : null,
    lessonInjections: typeof effect.injections === 'number' ? effect.injections : null,
    repeatMisses: typeof effect.repeatMisses === 'number' ? effect.repeatMisses : null,
    repeatMissesPer100: typeof effect.repeatMissesPer100 === 'number' ? effect.repeatMissesPer100 : null,
    changes: verdicts.filter((v) => v.verdict !== 'keep').slice(0, 20)
      .map((v) => ({ gateId: v.gateId, from: v.action, to: v.to, applied: applied.some((a) => a.gateId === v.gateId) })),
  };
  const { history, written } = feedbackDir
    ? safe(() => appendSnapshot(feedbackDir, snapshot, { force: options.forceSnapshot, nowMs: options.nowMs }), { history: [snapshot], written: false })
    : { history: [snapshot], written: false };

  return { mode, verdicts, applied, snapshot, snapshotWritten: written, trend: summarizeTrend(history), feedbackDir };
}

function formatReport(report) {
  const s = report.snapshot;
  const lines = [];
  lines.push('ThumbGate self-improvement cycle');
  lines.push(`  mode: ${report.mode}${report.mode === 'propose' ? ' (proposals only; run `thumbgate improve --apply` to change gates)' : ''}`);
  lines.push(`  learned gates: ${s.learnedGates} (${s.blockGates} block, ${s.warnGates} warn), overrides seen: ${s.overrides}`);
  const rate = s.repeatMissesPer100 == null ? 'no lesson injections yet' : `${s.repeatMissesPer100} per 100 lesson injections (${s.repeatMisses} of ${s.lessonInjections})`;
  lines.push(`  repeat misses: ${rate}`);
  if (report.trend.change != null) {
    const dir = report.trend.change < 0 ? 'down' : report.trend.change > 0 ? 'up' : 'flat';
    lines.push(`  trend: ${dir} ${Math.abs(report.trend.change)} since ${report.trend.from.at.slice(0, 10)} (${report.trend.points} daily points)`);
  }
  const changes = report.verdicts.filter((v) => v.verdict !== 'keep');
  if (!changes.length) lines.push('  gate changes: none needed');
  for (const v of changes) {
    const done = report.applied.some((a) => a.gateId === v.gateId);
    lines.push(`  ${done ? 'changed' : 'proposed'}: ${v.gateId} ${v.action} -> ${v.to} (${v.reason})`);
  }
  return lines.join('\n');
}

function improveCmd(argv = process.argv.slice(3)) {
  const report = runSelfImprovement({ argv, forceSnapshot: argv.includes('--snapshot') });
  if (argv.includes('--quiet')) return report;
  process.stdout.write(argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : `${formatReport(report)}\n`);
  return report;
}

module.exports = {
  HISTORY_FILE,
  SNAPSHOT_INTERVAL_MS,
  selfTuneMode,
  humanOverridesByGate,
  classifyGates,
  applyVerdicts,
  readHistory,
  appendSnapshot,
  summarizeTrend,
  isCycleDue,
  dashboardPanel,
  sessionReminder,
  startCycleInBackground,
  runSelfImprovement,
  formatReport,
  improveCmd,
};

if (require.main === module) improveCmd(process.argv.slice(2));
