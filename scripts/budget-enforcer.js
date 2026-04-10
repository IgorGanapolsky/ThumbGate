#!/usr/bin/env node
'use strict';

/**
 * Budget Enforcer — action count, token, and time limits for agent sessions.
 *
 * Competitive parity with LaneKeep's budget system. Tracks:
 * - max_actions: total tool calls allowed per session
 * - max_time_minutes: wall-clock session duration cap
 * - action_count: running count of tool calls in current session
 *
 * Budget state persists to ~/.thumbgate/budget-state.json.
 * Config lives in config/budget.json or can be set via env vars.
 */

const fs = require('fs');
const path = require('path');

const BUDGET_STATE_PATH = process.env.THUMBGATE_BUDGET_STATE_PATH || path.join(
  process.env.HOME || '/tmp',
  '.thumbgate',
  'budget-state.json'
);

const DEFAULT_BUDGET_CONFIG_PATH = process.env.THUMBGATE_BUDGET_CONFIG_PATH || path.join(
  __dirname, '..', 'config', 'budget.json'
);

const DEFAULT_BUDGET = {
  max_actions: 2000,
  max_time_minutes: 600, // 10 hours
  profiles: {
    strict: { max_actions: 500, max_time_minutes: 150 },
    guided: { max_actions: 2000, max_time_minutes: 600 },
    autonomous: { max_actions: 5000, max_time_minutes: 1200 },
  },
};

function loadBudgetConfig() {
  // 1. Environment overrides
  const envProfile = process.env.THUMBGATE_BUDGET_PROFILE;
  const envMaxActions = process.env.THUMBGATE_MAX_ACTIONS;
  const envMaxTime = process.env.THUMBGATE_MAX_TIME_MINUTES;

  // 2. Config file
  let fileConfig = {};
  try {
    if (fs.existsSync(DEFAULT_BUDGET_CONFIG_PATH)) {
      fileConfig = JSON.parse(fs.readFileSync(DEFAULT_BUDGET_CONFIG_PATH, 'utf8'));
    }
  } catch { /* use defaults */ }

  const merged = { ...DEFAULT_BUDGET, ...fileConfig };

  // Apply profile if set
  if (envProfile && merged.profiles && merged.profiles[envProfile]) {
    Object.assign(merged, merged.profiles[envProfile]);
  }

  // Env overrides take final precedence
  if (envMaxActions) {
    const parsedMaxActions = parseInt(envMaxActions, 10);
    if (Number.isFinite(parsedMaxActions) && parsedMaxActions > 0) {
      merged.max_actions = parsedMaxActions;
    }
  }
  if (envMaxTime) {
    const parsedMaxTime = parseInt(envMaxTime, 10);
    if (Number.isFinite(parsedMaxTime) && parsedMaxTime > 0) {
      merged.max_time_minutes = parsedMaxTime;
    }
  }

  return merged;
}

function loadBudgetState() {
  try {
    if (fs.existsSync(BUDGET_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(BUDGET_STATE_PATH, 'utf8'));
    }
  } catch { /* corrupted state — reset */ }
  return { action_count: 0, session_start: new Date().toISOString() };
}

function saveBudgetState(state) {
  const dir = path.dirname(BUDGET_STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(BUDGET_STATE_PATH, JSON.stringify(state, null, 2));
}

function resetBudget() {
  const state = { action_count: 0, session_start: new Date().toISOString() };
  saveBudgetState(state);
  return state;
}

/**
 * Evaluate budget limits. Called before every gate evaluation.
 * Returns null if within budget, or a deny result if budget exceeded.
 */
function evaluateBudget(toolName, toolInput) {
  const config = loadBudgetConfig();
  const state = loadBudgetState();

  // Increment action count
  state.action_count = (state.action_count || 0) + 1;
  saveBudgetState(state);

  // Check action limit
  if (config.max_actions && state.action_count > config.max_actions) {
    return {
      decision: 'deny',
      gate: 'budget-action-limit',
      message: `Budget exceeded: ${state.action_count}/${config.max_actions} actions used. Session budget is exhausted.`,
      severity: 'critical',
      reasoning: `Tool call #${state.action_count} exceeds the configured max_actions limit of ${config.max_actions}.`,
    };
  }

  // Check time limit
  if (config.max_time_minutes && state.session_start) {
    const elapsedMs = Date.now() - new Date(state.session_start).getTime();
    const elapsedMinutes = elapsedMs / (60 * 1000);
    if (elapsedMinutes > config.max_time_minutes) {
      return {
        decision: 'deny',
        gate: 'budget-time-limit',
        message: `Budget exceeded: session has run ${Math.round(elapsedMinutes)}min, limit is ${config.max_time_minutes}min.`,
        severity: 'critical',
        reasoning: `Session duration (${Math.round(elapsedMinutes)}min) exceeds max_time_minutes (${config.max_time_minutes}).`,
      };
    }
  }

  return null; // Within budget
}

/**
 * Get current budget status for dashboard/reporting.
 */
function getBudgetStatus() {
  const config = loadBudgetConfig();
  const state = loadBudgetState();
  const elapsedMs = state.session_start
    ? Date.now() - new Date(state.session_start).getTime()
    : 0;
  const elapsedMinutes = Math.round(elapsedMs / (60 * 1000));

  return {
    action_count: state.action_count || 0,
    max_actions: config.max_actions,
    actions_remaining: Math.max(0, (config.max_actions || Infinity) - (state.action_count || 0)),
    actions_pct: config.max_actions ? Math.round(((state.action_count || 0) / config.max_actions) * 100) : 0,
    elapsed_minutes: elapsedMinutes,
    max_time_minutes: config.max_time_minutes,
    time_remaining_minutes: Math.max(0, (config.max_time_minutes || Infinity) - elapsedMinutes),
    time_pct: config.max_time_minutes ? Math.round((elapsedMinutes / config.max_time_minutes) * 100) : 0,
    session_start: state.session_start,
    profile: process.env.THUMBGATE_BUDGET_PROFILE || 'guided',
  };
}

module.exports = {
  evaluateBudget,
  getBudgetStatus,
  loadBudgetConfig,
  loadBudgetState,
  saveBudgetState,
  resetBudget,
  BUDGET_STATE_PATH,
  DEFAULT_BUDGET_CONFIG_PATH,
};
