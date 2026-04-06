'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_STATE_PATH = path.join(PROJECT_ROOT, '.rlhf', 'reminder-state.json');

const REMINDER_TEMPLATES = {
  guardrail_spike: 'Safety guardrails triggered {{count}} times. Re-apply rule: {{rule}}',
  iteration_limit: 'Approaching max iterations ({{count}}/{{limit}}). Prioritize essential actions only.',
  tool_misuse: 'Tool misuse detected {{count}} times for: {{tools}}. Verify tool schemas before calling.',
  error_cascade: 'Repeated errors ({{count}}). Switch strategy: {{suggestion}}',
};

const DEFAULT_THRESHOLDS = {
  guardrail_spike: 3,
  iteration_limit: 1,
  tool_misuse: 2,
  error_cascade: 3,
};

function getStatePath(stateFile) {
  return stateFile || DEFAULT_STATE_PATH;
}

function loadState(stateFile) {
  const p = getStatePath(stateFile);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    // corrupted — start fresh
  }
  return { counts: {} };
}

function saveState(state, stateFile) {
  const p = getStatePath(stateFile);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

/**
 * Increment the event counter for a given event type.
 * @param {string} eventType - One of the keys in REMINDER_TEMPLATES
 * @param {string} [stateFile] - Path to state JSON (default: .thumbgate/reminder-state.json)
 * @returns {number} New count after incrementing
 */
function trackEvent(eventType, stateFile) {
  const state = loadState(stateFile);
  state.counts[eventType] = (state.counts[eventType] || 0) + 1;
  saveState(state, stateFile);
  return state.counts[eventType];
}

/**
 * Get the current event count without modifying state.
 * @param {string} eventType
 * @param {string} [stateFile]
 * @returns {number}
 */
function getEventCount(eventType, stateFile) {
  return loadState(stateFile).counts[eventType] || 0;
}

/**
 * Return true if the event count meets or exceeds its threshold.
 * @param {string} eventType
 * @param {number} [threshold] - Defaults to DEFAULT_THRESHOLDS[eventType] or 3
 * @param {string} [stateFile]
 * @returns {boolean}
 */
function shouldInjectReminder(eventType, threshold, stateFile) {
  const t = typeof threshold === 'number' ? threshold : (DEFAULT_THRESHOLDS[eventType] || 3);
  return getEventCount(eventType, stateFile) >= t;
}

/**
 * Render a reminder template with context variable substitution.
 * @param {string} eventType
 * @param {object} ctx - Variables to substitute into {{var}} placeholders
 * @returns {string}
 */
function renderTemplate(eventType, ctx) {
  const template = REMINDER_TEMPLATES[eventType];
  if (!template) return `[Reminder] Event: ${eventType}`;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (ctx && ctx[key] !== undefined ? ctx[key] : `{${key}}`));
}

/**
 * Append a system reminder to a turns array without modifying state.
 * Callers are responsible for calling trackEvent before/after as needed.
 * @param {object[]} turns - Existing turns array
 * @param {string} eventType
 * @param {object} ctx - Template variables (count will be added automatically)
 * @param {string} [stateFile]
 * @returns {object[]} New turns array with reminder appended
 */
function injectReminder(turns, eventType, ctx, stateFile) {
  const count = getEventCount(eventType, stateFile);
  const message = renderTemplate(eventType, { ...ctx, count });
  const reminder = {
    role: 'user',
    content: `[System Reminder] ${message}`,
    injectedAt: new Date().toISOString(),
    eventType,
  };
  return [...turns, reminder];
}

/**
 * Reset the event counter for a given event type (e.g., after a reminder is acted on).
 * @param {string} eventType
 * @param {string} [stateFile]
 */
function resetEvent(eventType, stateFile) {
  const state = loadState(stateFile);
  state.counts[eventType] = 0;
  saveState(state, stateFile);
}

module.exports = {
  REMINDER_TEMPLATES,
  DEFAULT_THRESHOLDS,
  DEFAULT_STATE_PATH,
  trackEvent,
  getEventCount,
  shouldInjectReminder,
  renderTemplate,
  injectReminder,
  resetEvent,
};
