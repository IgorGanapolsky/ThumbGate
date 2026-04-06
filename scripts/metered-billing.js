#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const METERED_RATE_PRO = 0.10;
const METERED_RATE_TEAM = 0.08;
const MINUTES_SAVED_PER_BLOCK = 16;
const PRO_FLOOR = 19;
const TEAM_FLOOR_PER_SEAT = 12;
const TEAM_MIN_SEATS = 3;
function getMeteredLedgerPath() { const d = process.env.THUMBGATE_FEEDBACK_DIR || path.join(process.cwd(), '.rlhf'); return path.join(d, 'metered-usage.jsonl'); }
function readJsonl(fp) { if (!fs.existsSync(fp)) return []; const r = fs.readFileSync(fp, 'utf-8').trim(); if (!r) return []; return r.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
function recordMeteredUsage({ agentId, gateId, decision, toolName } = {}) { const lp = getMeteredLedgerPath(); const dir = path.dirname(lp); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); const e = { id: `meter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, timestamp: new Date().toISOString(), agentId: agentId || 'unknown', gateId: gateId || 'unknown', decision: decision || 'deny', toolName: toolName || 'unknown' }; fs.appendFileSync(lp, JSON.stringify(e) + '\n'); return e; }
function getMeteredUsageSummary({ periodDays = 30, seats = 1, plan = 'pro' } = {}) { const entries = readJsonl(getMeteredLedgerPath()); const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000; const pe = entries.filter((e) => new Date(e.timestamp).getTime() > cutoff); const bc = pe.filter((e) => e.decision === 'deny').length; const wc = pe.filter((e) => e.decision === 'warn').length; const rate = plan === 'team' ? METERED_RATE_TEAM : METERED_RATE_PRO; const es = Math.max(TEAM_MIN_SEATS, seats); const floor = plan === 'team' ? TEAM_FLOOR_PER_SEAT * es : PRO_FLOOR; const raw = bc * rate * (plan === 'team' ? seats : 1); const billed = Math.max(floor, raw); const ms = bc * MINUTES_SAVED_PER_BLOCK; return { periodDays, plan, seats, blockedCount: bc, warnedCount: wc, totalEvents: pe.length, rate, floor, rawCost: Math.round(raw * 100) / 100, billedAmount: Math.round(billed * 100) / 100, minutesSaved: ms, hoursSaved: Math.round(ms / 60 * 10) / 10, periodStart: new Date(cutoff).toISOString(), periodEnd: new Date().toISOString() }; }
module.exports = { METERED_RATE_PRO, METERED_RATE_TEAM, MINUTES_SAVED_PER_BLOCK, PRO_FLOOR, TEAM_FLOOR_PER_SEAT, TEAM_MIN_SEATS, recordMeteredUsage, getMeteredUsageSummary, getMeteredLedgerPath };
