#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createSchedule } = require('./schedule-manager');

const IDLE_THRESHOLD_MINUTES = 30;
const SLOW_LOOP_STATE_FILE = 'slow-loop-state.json';

function getStatePath() {
  const feedbackDir = process.env.THUMBGATE_FEEDBACK_DIR || path.join(process.cwd(), '.rlhf');
  return path.join(feedbackDir, SLOW_LOOP_STATE_FILE);
}

function loadState() {
  const p = getStatePath();
  if (!fs.existsSync(p)) return { lastExportAt: null, exportCount: 0, lastIdleCheckAt: null, totalPairsExported: 0 };
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return { lastExportAt: null, exportCount: 0, lastIdleCheckAt: null, totalPairsExported: 0 }; }
}

function saveState(state) {
  const p = getStatePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
}

function isIdle({ thresholdMinutes = IDLE_THRESHOLD_MINUTES } = {}) {
  const feedbackDir = process.env.THUMBGATE_FEEDBACK_DIR || path.join(process.cwd(), '.rlhf');
  const logPath = path.join(feedbackDir, 'feedback-log.jsonl');
  if (!fs.existsSync(logPath)) return true;
  try {
    const stats = fs.statSync(logPath);
    const minutesSinceModified = (Date.now() - stats.mtimeMs) / (1000 * 60);
    return minutesSinceModified >= thresholdMinutes;
  } catch { return true; }
}

function runSlowLoop({ thresholdMinutes = IDLE_THRESHOLD_MINUTES, force = false } = {}) {
  const state = loadState();
  const idle = force || isIdle({ thresholdMinutes });
  if (!idle) { state.lastIdleCheckAt = new Date().toISOString(); saveState(state); return { action: 'skipped', reason: 'system not idle', idle: false, state }; }

  const feedbackDir = process.env.THUMBGATE_FEEDBACK_DIR || path.join(process.cwd(), '.rlhf');
  const logPath = path.join(feedbackDir, 'feedback-log.jsonl');
  let newEntries = 0;
  if (fs.existsSync(logPath)) {
    const totalEntries = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean).length;
    newEntries = totalEntries - (state.lastFeedbackCount || 0);
    state.lastFeedbackCount = totalEntries;
  }
  if (newEntries <= 0 && !force) { state.lastIdleCheckAt = new Date().toISOString(); saveState(state); return { action: 'skipped', reason: 'no new feedback since last export', idle: true, newEntries: 0, state }; }

  let dpoResult = null;
  try { const { exportDpoPairs } = require('./feedback-loop'); dpoResult = exportDpoPairs(); } catch (err) { dpoResult = { error: err.message, pairsExported: 0 }; }

  const pairsExported = dpoResult && dpoResult.pairs ? dpoResult.pairs.length : (dpoResult && dpoResult.pairsExported) || 0;
  state.lastExportAt = new Date().toISOString();
  state.exportCount = (state.exportCount || 0) + 1;
  state.totalPairsExported = (state.totalPairsExported || 0) + pairsExported;
  state.lastIdleCheckAt = new Date().toISOString();
  saveState(state);
  return { action: 'exported', idle: true, newEntries, pairsExported, totalExports: state.exportCount, totalPairsExported: state.totalPairsExported, exportedAt: state.lastExportAt, state };
}

function createSlowLoopSchedule({ schedule = 'hourly', thresholdMinutes = IDLE_THRESHOLD_MINUTES } = {}) {
  const command = [`const sl = require(${JSON.stringify(__filename)});`, `const result = sl.runSlowLoop(${JSON.stringify({ thresholdMinutes })});`, 'process.stdout.write(JSON.stringify(result, null, 2) + "\\n");'].join(' ');
  return createSchedule({ id: 'thumbgate-slow-loop', name: 'ThumbGate Slow Loop (DPO Export)', description: `Idle-time DPO export, runs ${schedule}`, schedule, command });
}

module.exports = { isIdle, runSlowLoop, createSlowLoopSchedule, loadState, getStatePath };
