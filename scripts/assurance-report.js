#!/usr/bin/env node
'use strict';

/**
 * Agent assurance report.
 *
 * One file a team lead or auditor can read: what the agents tried, what
 * ThumbGate stopped or flagged, which rules to fix first, what people decided,
 * and the evidence each line comes from.
 *
 * The split is deliberate: ThumbGate finds risky actions; people decide what
 * to do about them (thumbs up/down, overrides). Both sides are shown.
 *
 * Reads only local logs in the feedback dir (default ~/.thumbgate):
 *   audit-trail.jsonl   every gate decision (allow/deny/warn/override)
 *   feedback-log.jsonl  thumbs-up / thumbs-down from people
 *
 *   npx thumbgate assurance-report [--days 30] [--json] [--out report.md]
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SEVERITY_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1 };
const DAY_MS = 24 * 60 * 60 * 1000;

function readJsonl(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function fileDigest(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

function severityWeight(severity) {
  return SEVERITY_WEIGHT[String(severity || '').toLowerCase()] || 1;
}

function feedbackDirectionOf(entry) {
  const raw = String(entry.signal || entry.feedback || entry.rating || '').toLowerCase();
  if (['up', 'positive', 'thumbs_up', 'thumbsup', '+1', 'good'].includes(raw)) return 'up';
  if (['down', 'negative', 'thumbs_down', 'thumbsdown', '-1', 'bad'].includes(raw)) return 'down';
  return null;
}

/**
 * Build the report data from rows already read. Pure, so tests can feed rows.
 */
function buildAssuranceReport({ auditRows = [], feedbackRows = [], now = new Date(), days = 30, evidence = {} } = {}) {
  const end = now instanceof Date ? now : new Date(now);
  const start = new Date(end.getTime() - days * DAY_MS);
  const inWindow = (ts) => {
    const t = Date.parse(ts);
    return Number.isFinite(t) && t >= start.getTime() && t <= end.getTime();
  };

  const rows = auditRows.filter((r) => r && inWindow(r.timestamp));
  const totals = { evaluated: rows.length, allowed: 0, stopped: 0, flagged: 0, overridden: 0 };
  const findings = new Map();
  const catalogHashes = new Set();
  const sessions = new Set();

  for (const r of rows) {
    if (r.catalogHash) catalogHashes.add(r.catalogHash);
    if (r.sessionId) sessions.add(r.sessionId);
    if (r.decision === 'allow') totals.allowed += 1;
    else if (r.decision === 'deny') totals.stopped += 1;
    else if (r.decision === 'warn') totals.flagged += 1;
    else if (r.decision === 'override') totals.overridden += 1;

    if (r.decision !== 'deny' && r.decision !== 'warn') continue;
    const id = r.gateId || 'unnamed-rule';
    if (!findings.has(id)) {
      findings.set(id, {
        gateId: id,
        severity: r.severity || null,
        message: r.message || null,
        stopped: 0,
        flagged: 0,
        tools: new Set(),
        sessions: new Set(),
        firstSeen: r.timestamp,
        lastSeen: r.timestamp,
        evidenceIds: [],
      });
    }
    const f = findings.get(id);
    if (r.decision === 'deny') f.stopped += 1; else f.flagged += 1;
    if (r.toolName) f.tools.add(r.toolName);
    if (r.sessionId) f.sessions.add(r.sessionId);
    if (!f.severity && r.severity) f.severity = r.severity;
    if (!f.message && r.message) f.message = r.message;
    if (r.timestamp < f.firstSeen) f.firstSeen = r.timestamp;
    if (r.timestamp > f.lastSeen) f.lastSeen = r.timestamp;
    if (r.id && f.evidenceIds.length < 3) f.evidenceIds.push(r.id);
  }

  const fixFirst = [...findings.values()]
    .map((f) => {
      const hits = f.stopped + f.flagged;
      return {
        gateId: f.gateId,
        severity: f.severity || 'unrated',
        message: f.message,
        stopped: f.stopped,
        flagged: f.flagged,
        hits,
        score: severityWeight(f.severity) * hits,
        repeated: hits > 1,
        tools: [...f.tools].sort(),
        sessions: f.sessions.size,
        firstSeen: f.firstSeen,
        lastSeen: f.lastSeen,
        evidenceIds: f.evidenceIds,
      };
    })
    .sort((a, b) => b.score - a.score || b.hits - a.hits || a.gateId.localeCompare(b.gateId))
    .map((f, i) => ({ rank: i + 1, ...f }));

  const people = { thumbsUp: 0, thumbsDown: 0, overrides: totals.overridden };
  for (const e of feedbackRows) {
    if (!e || !inWindow(e.timestamp || e.ts || e.createdAt)) continue;
    const dir = feedbackDirectionOf(e);
    if (dir === 'up') people.thumbsUp += 1;
    else if (dir === 'down') people.thumbsDown += 1;
  }

  return {
    title: 'Agent assurance report',
    window: { from: start.toISOString(), to: end.toISOString(), days },
    generatedAt: end.toISOString(),
    totals: { ...totals, sessions: sessions.size },
    fixFirst,
    people,
    evidence: {
      ruleCatalogHashes: [...catalogHashes].sort(),
      ...evidence,
    },
  };
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso || '');
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function mdCell(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function formatAssuranceReport(report) {
  const t = report.totals;
  const lines = [];
  lines.push(`# ${report.title}`);
  lines.push('');
  lines.push(`Window: ${fmtTime(report.window.from)} to ${fmtTime(report.window.to)} (${report.window.days} days)`);
  lines.push('');
  lines.push('ThumbGate finds risky agent actions. People decide what to do about them. This report shows both, with the log lines behind every number.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Agent actions checked: ${t.evaluated}`);
  lines.push(`- Allowed: ${t.allowed}`);
  lines.push(`- Stopped before they ran: ${t.stopped}`);
  lines.push(`- Flagged with a warning: ${t.flagged}`);
  lines.push(`- Overridden by a person: ${t.overridden}`);
  lines.push(`- Agent sessions seen: ${t.sessions}`);
  lines.push('');
  lines.push('## Fix first');
  lines.push('');
  if (report.fixFirst.length === 0) {
    lines.push('Nothing was stopped or flagged in this window.');
  } else {
    lines.push('Ranked by severity times how often it happened. A rule near the top that keeps firing means the agent keeps trying the same thing: fix the prompt, the task setup or the tool access behind it.');
    lines.push('');
    lines.push('| # | Rule | Severity | Stopped | Flagged | Sessions | Last seen | What it guards |');
    lines.push('|---|------|----------|---------|---------|----------|-----------|----------------|');
    for (const f of report.fixFirst) {
      lines.push(`| ${f.rank} | ${mdCell(f.gateId)} | ${mdCell(f.severity)} | ${f.stopped} | ${f.flagged} | ${f.sessions} | ${mdCell(fmtTime(f.lastSeen))} | ${mdCell(f.message || '')} |`);
    }
  }
  lines.push('');
  lines.push('## What people decided');
  lines.push('');
  lines.push(`- Thumbs up (agent did the right thing): ${report.people.thumbsUp}`);
  lines.push(`- Thumbs down (agent made a mistake, turned into a lesson): ${report.people.thumbsDown}`);
  lines.push(`- Overrides (a person let a stopped action through): ${report.people.overrides}`);
  lines.push('');
  lines.push('## Evidence');
  lines.push('');
  const ev = report.evidence;
  if (ev.auditLogPath) lines.push(`- Decision log: \`${ev.auditLogPath}\``);
  if (ev.auditLogSha256) lines.push(`- Decision log SHA-256 at report time: \`${ev.auditLogSha256}\``);
  if (ev.feedbackLogPath) lines.push(`- Feedback log: \`${ev.feedbackLogPath}\``);
  lines.push(`- Rule catalog versions in use: ${ev.ruleCatalogHashes.length ? ev.ruleCatalogHashes.map((h) => `\`${h}\``).join(', ') : 'not recorded'}`);
  if (ev.thumbgateVersion) lines.push(`- ThumbGate version: ${ev.thumbgateVersion}`);
  lines.push(`- Generated: ${fmtTime(report.generatedAt)}`);
  const sampled = report.fixFirst.filter((f) => f.evidenceIds.length);
  if (sampled.length) {
    lines.push('');
    lines.push('Sample log entry ids per rule (each id is one line in the decision log above):');
    lines.push('');
    for (const f of sampled) lines.push(`- ${f.gateId}: ${f.evidenceIds.map((id) => `\`${id}\``).join(', ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 2) { args[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i += 1; } else { args[key] = true; }
  }
  return args;
}

function runAssuranceReport(argv = [], options = {}) {
  const args = parseArgs(argv);
  const days = Math.max(1, Number(args.days) || 30);
  const { resolveFeedbackDir } = require('./feedback-paths');
  const dir = options.feedbackDir || args.dir || resolveFeedbackDir();
  const auditLogPath = path.join(dir, 'audit-trail.jsonl');
  const feedbackLogPath = path.join(dir, 'feedback-log.jsonl');
  let thumbgateVersion = null;
  try { thumbgateVersion = require('../package.json').version; } catch { /* optional */ }

  const report = buildAssuranceReport({
    auditRows: readJsonl(auditLogPath),
    feedbackRows: readJsonl(feedbackLogPath),
    now: options.now || new Date(),
    days,
    evidence: {
      auditLogPath,
      auditLogSha256: fileDigest(auditLogPath),
      feedbackLogPath: fs.existsSync(feedbackLogPath) ? feedbackLogPath : null,
      thumbgateVersion,
    },
  });

  const output = args.json ? JSON.stringify(report, null, 2) : formatAssuranceReport(report);
  if (args.out && typeof args.out === 'string') {
    fs.writeFileSync(args.out, output.endsWith('\n') ? output : `${output}\n`);
    return { report, output, written: path.resolve(args.out) };
  }
  return { report, output, written: null };
}

if (require.main === module) {
  try {
    const { output, written } = runAssuranceReport(process.argv.slice(2));
    if (written) console.log(`Assurance report written to ${written}`);
    else console.log(output);
  } catch (err) {
    console.error('assurance-report error:', err.message);
    process.exit(1);
  }
}

module.exports = {
  buildAssuranceReport,
  formatAssuranceReport,
  runAssuranceReport,
  severityWeight,
  feedbackDirectionOf,
};
