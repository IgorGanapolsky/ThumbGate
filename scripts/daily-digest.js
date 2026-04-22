#!/usr/bin/env node
'use strict';
const { generateOrgDashboard } = require('./org-dashboard');
const { deliver } = require('./webhook-delivery');
const { getMeteredUsageSummary, MINUTES_SAVED_PER_BLOCK } = require('./metered-billing');
const { createSchedule } = require('./schedule-manager');
function formatDailyDigest(d) { const title = `ThumbGate Daily Digest — ${new Date().toISOString().slice(0, 10)}`; const lines = [`Agents: ${d.activeAgents} active / ${d.totalAgents} total`, `Tool calls: ${d.totalToolCalls}`, `Blocked: ${d.totalBlocked} | Warned: ${d.totalWarned} | Allowed: ${d.totalAllowed}`, `Adherence: ${d.orgAdherenceRate}%`]; if (d.totalBlocked > 0) { lines.push(`Hours saved: ~${Math.round(d.totalBlocked * MINUTES_SAVED_PER_BLOCK / 60 * 10) / 10}h (${d.totalBlocked} mistakes blocked)`); } if (d.topBlockedGates && d.topBlockedGates.length > 0) { lines.push('', 'Top blocked gates:'); for (const g of d.topBlockedGates.slice(0, 3)) lines.push(`  - ${g.gateId}: ${g.blocked} blocked, ${g.warned} warned`); } if (d.riskAgents && d.riskAgents.length > 0) { lines.push('', 'Risk agents (low adherence):'); for (const a of d.riskAgents.slice(0, 3)) lines.push(`  - ${a.id}: ${a.adherenceRate}% adherence (${a.toolCalls} calls)`); } return { title, message: lines.join('\n') }; }
async function sendDailyDigest({ platform, webhookUrl, windowHours = 24 }) { const db = generateOrgDashboard({ windowHours, proOverride: true }); const { title, message } = formatDailyDigest(db); const delivery = await deliver(platform, webhookUrl, title, message); return { title, message, delivery }; }
function createDailyDigestSchedule({ platform, webhookUrl, time = '9:00' }) { const cmd = [`const d = require(${JSON.stringify(__filename)});`, `d.sendDailyDigest(${JSON.stringify({ platform, webhookUrl })})`, '.then(r => { process.stdout.write(JSON.stringify(r, null, 2) + "\\n"); })', '.catch(e => { process.stderr.write(e.message + "\\n"); process.exit(1); });'].join(' '); return createSchedule({ id: 'thumbgate-daily-digest', name: 'ThumbGate Daily Digest', description: `Daily ${platform} digest at ${time}`, schedule: `daily ${time}`, command: cmd }); }
// Build-in-public stats post generator.
//
// SUPPRESSION CONTRACT (added 2026-04-21 after a zero-stats Bluesky incident
// where "This week ThumbGate blocked 0 mistakes, saving ~0 hours" shipped
// publicly — the CEO flagged it as a disaster). When the window has zero
// blocks AND zero warnings AND zero active agents, we refuse to produce a
// publishable post. Callers MUST check `suppressed` before publishing.
// The `post` field is still returned for logging/observability, but must
// not be posted to any public channel when suppressed is true.
function generateWeeklyStatsPost({ periodDays = 7 } = {}) {
  const u = getMeteredUsageSummary({ periodDays });
  const db = generateOrgDashboard({ windowHours: periodDays * 24, proOverride: true });
  const stats = {
    blockedCount: u.blockedCount,
    warnedCount: u.warnedCount,
    hoursSaved: u.hoursSaved,
    activeAgents: db.activeAgents,
    adherenceRate: db.orgAdherenceRate,
    topGate: db.topBlockedGates.length > 0 ? db.topBlockedGates[0].gateId : null,
  };

  const hasSignal =
    stats.blockedCount > 0 || stats.warnedCount > 0 || stats.activeAgents > 0;

  const lines = [
    `This week ThumbGate blocked ${stats.blockedCount} mistakes, saving ~${stats.hoursSaved} hours.`,
  ];
  if (stats.activeAgents > 0) {
    lines.push(`${stats.activeAgents} agents running at ${stats.adherenceRate}% adherence.`);
  }
  if (stats.warnedCount > 0) {
    lines.push(`${stats.warnedCount} additional warnings surfaced before they became errors.`);
  }
  if (stats.topGate) lines.push(`Most active gate: ${stats.topGate}`);
  lines.push('', 'Pre-action gates > post-mortem fixes.');

  if (!hasSignal) {
    return {
      post: lines.join('\n'),
      stats,
      suppressed: true,
      suppressedReason:
        `no activity in ${periodDays}-day window (blocked=0, warned=0, activeAgents=0) — refusing to publish zero-stats post`,
    };
  }

  return { post: lines.join('\n'), stats, suppressed: false };
}
module.exports = { formatDailyDigest, sendDailyDigest, createDailyDigestSchedule, generateWeeklyStatsPost };
