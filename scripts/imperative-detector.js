'use strict';

/**
 * imperative-detector.js — detect an explicit NEVER / ALWAYS directive in a
 * feedback message so the CLI can OFFER immediate enforcement (force-gate) when
 * the user clearly asked for it.
 *
 * Why this exists: auto-promotion is deliberately occurrence-gated (a rule
 * blocks only after a pattern repeats) — that accumulate-evidence-before-you-
 * enforce default is what makes ThumbGate trustworthy rather than a one-signal
 * lockout. But when a user types "never do X again", that is an explicit intent
 * to guard NOW. This module recognizes that intent and lets the CLI SURFACE the
 * one-shot path (force-gate) as an offer. It never blocks on its own — the user
 * still confirms. Detecting intent ≠ acting on it.
 *
 * Pure and deterministic: no state, no I/O.
 */

// A leading (or clause-initial) negative imperative → intent to forbid.
const NEVER_RE = /(?:^|[.;:,]\s*)(never|do\s*not|don'?t|stop\s+\w|must\s*not|no\s+longer|quit\s+\w|avoid\s+\w)/i;
// A leading (or clause-initial) positive imperative → intent to always do.
const ALWAYS_RE = /(?:^|[.;:,]\s*)(always|make\s+sure|ensure\s+\w|be\s+sure\s+to)/i;

function firstMeaningfulText(text) {
  // Strip common feedback prefixes/quote marks so "❯ never …" still matches.
  return String(text || '').trim().replace(/^[\s>❯"'`*-]+/, '');
}

/**
 * @param {string} text
 * @returns {{isImperative:boolean, polarity:('never'|'always'|null), directive:string}}
 */
function detectImperative(text) {
  const t = firstMeaningfulText(text);
  if (!t) return { isImperative: false, polarity: null, directive: '' };
  // Negative wins if both appear — a forbid directive is the actionable one.
  if (NEVER_RE.test(t)) return { isImperative: true, polarity: 'never', directive: t };
  if (ALWAYS_RE.test(t)) return { isImperative: true, polarity: 'always', directive: t };
  return { isImperative: false, polarity: null, directive: '' };
}

function shellQuote(text) {
  return String(text).trim().slice(0, 140).replace(/"/g, "'").replace(/\s+/g, ' ');
}

/**
 * Build a suggestion for the capture confirmation. Returns null when there's no
 * explicit directive to act on.
 * - down + "never …"  → OFFER immediate force-gate (the user asked to forbid it).
 * - up   + "always …" → clarify it's stored as guidance, not a hard block.
 * @param {{signal?:string, text?:string}} opts
 * @returns {{kind:string, message:string}|null}
 */
function suggestForceGate({ signal, text } = {}) {
  const isDown = signal === 'down' || signal === 'negative' || signal === 'thumbs_down';
  const det = detectImperative(text);
  if (!det.isImperative) return null;

  if (isDown && det.polarity === 'never') {
    const ctx = shellQuote(text);
    return {
      kind: 'force-gate-offer',
      message: 'You said "never" — block this immediately instead of waiting for it to recur:\n'
        + `    npx thumbgate force-gate --context="${ctx}" --action=block\n`
        + '  (or run /thumbgate-guard). Left alone, it auto-promotes to a gate after the pattern repeats.',
    };
  }

  if (!isDown && det.polarity === 'always') {
    return {
      kind: 'always-note',
      message: 'You said "always" — stored as an ALWAYS guidance principle. '
        + 'It is surfaced as context on future actions (guidance, not a hard block; positive patterns are not gate-enforced).',
    };
  }

  return null;
}

module.exports = {
  detectImperative,
  suggestForceGate,
  NEVER_RE,
  ALWAYS_RE,
};
