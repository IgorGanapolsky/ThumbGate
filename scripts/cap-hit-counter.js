'use strict';
// Local, opt-in counter for the moment a free install hits the learned-rule cap.
// - Off unless THUMBGATE_LOCAL_COUNTERS=1.
// - Writes one JSON line to <feedbackDir>/local-counters.jsonl: event, ts, cap, activeGates.
//   No rule text, command, path or id. Nothing is sent anywhere; this module has no network code.
// - Never throws: a counter must not break feedback capture.

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

const COUNTER_FILE = 'local-counters.jsonl';
const EVENT = 'rule_cap_hit';

function countersEnabled() {
  return process.env.THUMBGATE_LOCAL_COUNTERS === '1';
}

function counterPath(options = {}) {
  return path.join(options.feedbackDir || resolveFeedbackDir(options), COUNTER_FILE);
}

function recordCapHit({ feedbackDir, cap, activeGates, enabled = countersEnabled() } = {}) {
  if (!enabled) return false;
  try {
    const file = counterPath({ feedbackDir });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ event: EVENT, ts: new Date().toISOString(), cap, activeGates })}\n`);
    return true;
  } catch (_) {
    return false;
  }
}

function readCapHitCount(options = {}) {
  try {
    return fs.readFileSync(counterPath(options), 'utf8')
      .split('\n')
      .filter((line) => {
        try { return JSON.parse(line).event === EVENT; } catch (_) { return false; }
      }).length;
  } catch (_) {
    return 0;
  }
}

module.exports = { COUNTER_FILE, EVENT, countersEnabled, recordCapHit, readCapHitCount };
