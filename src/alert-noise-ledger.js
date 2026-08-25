'use strict';

/**
 * Alert noise ledger — suppression and correlation for the reminder surface.
 *
 * WHY THIS EXISTS
 *
 * `scripts/gates-engine.js` injects behavioural context "on EVERY tool call ...
 * even when no gate blocks" (its own comment near line 4118). That is
 * deliberate, but there is no suppression path anywhere on the reminder text:
 * `buildBehavioralContext`, `buildRecentCorrectiveActionsContext` and
 * `formatNegativeLessonContext` are stateless per-call reads, so an identical
 * bullet re-renders in full on every successive call. Measured from live
 * `gate_stats` on 2026-08-25:
 *
 *   706 gate events   = 87 blocked + 619 warned
 *   278 first firings + 428 repeats  ->  60.6% of all events are repeats
 *   retrieval_entropy_high: 558 events, 0 blocks in its entire history
 *   force-push:             1 first,  26 repeats (96% repeat rate)
 *
 * and from `prevention_rules` root-cause telemetry:
 *
 *   guardrail_triggered: 90 failures  <- #1 root-cause category
 *   tool_output_misread: 28 failures
 *
 * The guardrails are the leading recorded cause of agent failure. A reminder
 * that has fired 44 times without changing behaviour is not guidance; it is
 * noise displacing the context the agent needs to do the work correctly.
 *
 * WHAT THIS DOES NOT DO
 *
 * Suppression here is PRESENTATIONAL ONLY. It decides how loudly a decision is
 * re-rendered, never what the decision is. Enforcement is untouched: a blocked
 * action stays blocked whether its text renders full, collapsed, or not at all.
 * Two invariants follow, and both are tested:
 *
 *   1. The FIRST occurrence of any signature always renders in full.
 *   2. A `block` is never fully suppressed — it collapses to a one-liner at
 *      most, because an agent must always be told its action did not happen.
 *
 * On any internal error the ledger fails OPEN (render everything). Under-
 * rendering a real warning is the dangerous direction; over-rendering is only
 * noisy.
 */

/** Repeats 2..COLLAPSE_UNTIL render as a one-line count. Beyond that, warnings go quiet. */
const COLLAPSE_UNTIL = 3;

/** After this many firings of one signature, say so once, then stop repeating. */
const ESCALATE_AFTER = 5;

/** A gate that has warned this many times having never once blocked is demoted. */
const NEVER_BLOCKED_SAMPLE = 20;

/** Matches the existing session bucket in gates-engine.js (SESSION_ACTION_TTL_MS). */
const SESSION_TTL_MS = 60 * 60 * 1000;

/**
 * Rule bodies that carry no instruction. These occupy a "High-Priority
 * Contract" slot in prevention-rules output while telling the agent nothing —
 * two were live on 2026-08-25 ("Investigate and prevent recurrence").
 */
const PLACEHOLDER_RULE =
  /^\s*(investigate and prevent recurrence|prevent recurrence|investigate|tbd|n\/a|none)\s*\.?\s*$/i;

/** Headers of the reminder blocks emitted by gates-engine.js. */
const REMINDER_HEADERS = [
  '[ThumbGate] Past mistakes relevant to this action',
  '[ThumbGate] Recent mistakes (last 24h)',
  '[ThumbGate] Recurring failure patterns',
  '[ThumbGate] Knowledge conflict warning',
];

/**
 * Collapse the volatile parts of a string so the same underlying operation
 * fingerprints identically across calls.
 *
 * Without this, `cp /tmp/a-1234/x` and `cp /tmp/a-5678/x` look like two
 * different events and neither is ever recognised as a repeat.
 */
function normalizeAction(action) {
  if (typeof action !== 'string') return '';
  return action
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, '<hex>')
    .replace(/\b[0-9a-f]{7,40}\b/g, '<sha>')
    .replace(/\b\d{4}-\d{2}-\d{2}t[\d:.]+z?\b/g, '<ts>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Identity of an alert: which gate, about what, at what severity.
 *
 * Severity is part of the key on purpose. If the same gate escalates from warn
 * to block on the same action, that is genuinely new information and must
 * re-render in full rather than inherit the old signature's suppression.
 */
function fingerprint(event) {
  const gate = String(event && event.gate ? event.gate : 'unknown');
  const decision = String(event && event.decision ? event.decision : 'warn');
  return `${gate}|${decision}|${normalizeAction(event && event.action)}`;
}

/** True for a rule whose text instructs nothing. */
function isPlaceholderRule(text) {
  if (typeof text !== 'string' || text.trim() === '') return true;
  return PLACEHOLDER_RULE.test(text);
}

/**
 * Drop no-op rules and exact duplicates, preserving order.
 * Returns what was dropped as well, so a caller can report the reduction
 * instead of silently shrinking its own output.
 */
function filterRules(rules) {
  const kept = [];
  const dropped = [];
  const seen = new Set();
  for (const rule of Array.isArray(rules) ? rules : []) {
    const text = typeof rule === 'string' ? rule : rule && rule.text;
    if (isPlaceholderRule(text)) {
      dropped.push({ rule, reason: 'placeholder' });
      continue;
    }
    const key = String(text).trim().toLowerCase();
    if (seen.has(key)) {
      dropped.push({ rule, reason: 'duplicate' });
      continue;
    }
    seen.add(key);
    kept.push(rule);
  }
  return { kept, dropped };
}

/** A line that introduces a reminder block rather than carrying content. */
function isHeaderLine(line) {
  return REMINDER_HEADERS.some((header) => line.startsWith(header));
}

class AlertNoiseLedger {
  /**
   * @param {Object} [options]
   * @param {number} [options.collapseUntil]
   * @param {number} [options.escalateAfter]
   * @param {number} [options.ttlMs]
   * @param {() => number} [options.now] - injectable clock; tests must not sleep.
   * @param {Object} [options.gateHistory] - { [gate]: { blocked, warned } }, e.g. straight
   *   from `gate_stats().byGate`. Used only to demote gates that have never blocked.
   */
  constructor(options = {}) {
    this.collapseUntil = options.collapseUntil ?? COLLAPSE_UNTIL;
    this.escalateAfter = options.escalateAfter ?? ESCALATE_AFTER;
    this.ttlMs = options.ttlMs ?? SESSION_TTL_MS;
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.gateHistory = options.gateHistory || {};
    /** @type {Map<string, number>} signature -> times seen this session */
    this.counts = new Map();
    /** @type {Set<string>} signatures whose escalation notice has been emitted */
    this.escalated = new Set();
    /** @type {Map<string, number>} reminder line -> timestamp last emitted */
    this.lineSeenAt = new Map();
  }

  /**
   * A gate that has warned many times and blocked exactly zero times is not
   * protecting anything; it is narrating. `retrieval_entropy_high` was at
   * 558 warnings / 0 blocks when this was written.
   */
  isNeverBlockingGate(gate) {
    const stats = this.gateHistory[gate];
    if (!stats) return false;
    const blocked = Number(stats.blocked) || 0;
    const warned = Number(stats.warned) || 0;
    return blocked === 0 && warned >= NEVER_BLOCKED_SAMPLE;
  }

  /**
   * Decide how loudly to render one alert.
   *
   * @param {Object} event - { gate, decision: 'block'|'warn', action, message }
   * @returns {{render: 'full'|'collapsed'|'suppressed', count: number,
   *            signature: string, escalate: boolean, reason: string}}
   */
  admit(event) {
    try {
      const signature = fingerprint(event);
      const count = (this.counts.get(signature) || 0) + 1;
      this.counts.set(signature, count);

      const isBlock = String(event && event.decision) === 'block';

      // Invariant 1: the first sighting always renders in full.
      if (count === 1) {
        return { render: 'full', count, signature, escalate: false, reason: 'first_occurrence' };
      }

      // Say once, clearly, that this alert is not working — then stop repeating it.
      if (count >= this.escalateAfter && !this.escalated.has(signature)) {
        this.escalated.add(signature);
        return {
          render: 'collapsed',
          count,
          signature,
          escalate: true,
          reason: 'repeated_without_effect',
        };
      }

      // A gate that never blocks gets one full airing, then stays quiet.
      if (!isBlock && this.isNeverBlockingGate(event && event.gate)) {
        return {
          render: 'suppressed',
          count,
          signature,
          escalate: false,
          reason: 'gate_never_blocks',
        };
      }

      if (count <= this.collapseUntil) {
        return { render: 'collapsed', count, signature, escalate: false, reason: 'repeat' };
      }

      // Invariant 2: a block still has to tell the agent it was blocked.
      if (isBlock) {
        return {
          render: 'collapsed',
          count,
          signature,
          escalate: false,
          reason: 'block_always_visible',
        };
      }

      return {
        render: 'suppressed',
        count,
        signature,
        escalate: false,
        reason: 'repeat_beyond_threshold',
      };
    } catch {
      // Fail open: if anything here misbehaves, show the operator everything.
      return {
        render: 'full',
        count: 1,
        signature: 'error',
        escalate: false,
        reason: 'ledger_error',
      };
    }
  }

  /**
   * Render one admitted alert.
   * `full` returns the original message untouched — this never rewrites the
   * text of a first-sighting alert.
   */
  format(event, verdict) {
    if (verdict.render === 'suppressed') return null;
    const message = String((event && event.message) || '');
    if (verdict.render === 'full') return message;

    const gate = String((event && event.gate) || 'gate');
    const line = `[ThumbGate] ${gate} (x${verdict.count}, unchanged - see first occurrence)`;
    if (!verdict.escalate) return line;
    return (
      `${line}\n` +
      `  This alert has now fired ${verdict.count} times without the outcome changing. ` +
      `Either its guidance is not actionable as written, or the gate is miscalibrated ` +
      `for this workload. It will not be repeated again this session.`
    );
  }

  /**
   * Remove reminder lines already emitted inside the current session window.
   *
   * This is the change that reclaims the bulk of the wasted context: it is the
   * merged reminder block, not the gate decision, that repeats verbatim on
   * every call. A header whose bullets are all suppressed is dropped with them,
   * so no empty section is left behind. Returns null when nothing survives, so
   * the caller can omit `additionalContext` entirely.
   *
   * @param {string} context - merged reminder text
   * @returns {{text: string|null, suppressedLines: number, keptLines: number}}
   */
  suppressRepeatedLines(context) {
    if (typeof context !== 'string' || context === '') {
      return { text: null, suppressedLines: 0, keptLines: 0 };
    }

    try {
      const now = this.now();
      const cutoff = now - this.ttlMs;
      const blocks = [];
      let current = null;
      let suppressedLines = 0;
      let keptLines = 0;

      for (const line of context.split('\n')) {
        if (isHeaderLine(line)) {
          current = { header: line, body: [] };
          blocks.push(current);
          continue;
        }
        if (current === null) {
          current = { header: null, body: [] };
          blocks.push(current);
        }

        // Blank lines carry nothing on their own; they survive only inside a
        // block that still has real content.
        if (line.trim() === '') {
          current.body.push({ line, keep: true, structural: true });
          continue;
        }

        const key = normalizeAction(line);
        const lastSeen = this.lineSeenAt.get(key);
        const isRepeat = typeof lastSeen === 'number' && lastSeen >= cutoff;
        this.lineSeenAt.set(key, now);

        if (isRepeat) {
          suppressedLines += 1;
          current.body.push({ line, keep: false, structural: false });
        } else {
          keptLines += 1;
          current.body.push({ line, keep: true, structural: false });
        }
      }

      const rendered = [];
      for (const block of blocks) {
        const survivors = block.body.filter((entry) => entry.keep && !entry.structural);
        if (survivors.length === 0) continue; // drop the header along with its bullets
        if (block.header) rendered.push(block.header);
        // Structural blank lines ride along with a surviving block so that a
        // first, fully-novel reminder is reproduced byte-for-byte. Suppression
        // must not quietly reformat text it decided to keep.
        for (const entry of block.body) {
          if (entry.keep) rendered.push(entry.line);
        }
      }
      // A separator belonging to the last surviving block has nothing left to
      // separate it from.
      while (rendered.length > 0 && rendered[rendered.length - 1].trim() === '') {
        rendered.pop();
      }

      return {
        text: rendered.length > 0 ? rendered.join('\n') : null,
        suppressedLines,
        keptLines,
      };
    } catch {
      // Fail open: on any parsing trouble, hand back exactly what came in.
      return { text: context, suppressedLines: 0, keptLines: 0 };
    }
  }

  /**
   * Group simultaneous alerts about one action into a single incident.
   *
   * Several gates commonly fire on the same command; rendering three separate
   * walls describes one event three times. Correlating them lets the agent read
   * the action once and see every gate that objected to it.
   */
  correlate(events) {
    const groups = new Map();
    for (const event of Array.isArray(events) ? events : []) {
      const key = normalizeAction(event && event.action);
      if (!groups.has(key)) groups.set(key, { action: key, gates: [], severity: 'warn' });
      const group = groups.get(key);
      group.gates.push(String((event && event.gate) || 'unknown'));
      if (String(event && event.decision) === 'block') group.severity = 'block';
    }
    return [...groups.values()];
  }

  /** Noise reduction achieved so far, for reporting. */
  stats() {
    let total = 0;
    let unique = 0;
    for (const count of this.counts.values()) {
      total += count;
      unique += 1;
    }
    return {
      totalEvents: total,
      uniqueSignatures: unique,
      repeats: total - unique,
      repeatRatio: total > 0 ? (total - unique) / total : 0,
    };
  }
}

module.exports = {
  AlertNoiseLedger,
  fingerprint,
  normalizeAction,
  isPlaceholderRule,
  filterRules,
  COLLAPSE_UNTIL,
  ESCALATE_AFTER,
  NEVER_BLOCKED_SAMPLE,
  SESSION_TTL_MS,
};
