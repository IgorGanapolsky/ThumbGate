'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AlertNoiseLedger,
  fingerprint,
  normalizeAction,
  isPlaceholderRule,
  filterRules,
} = require('../src/alert-noise-ledger');

// A fixed clock. Tests must never sleep, and a real clock would make the
// session-window assertions flaky.
const FIXED_NOW = 1_700_000_000_000;
const clock = (t = FIXED_NOW) => () => t;

const warn = (gate, action) => ({ gate, decision: 'warn', action, message: `[GATE:${gate}] ${action}` });
const block = (gate, action) => ({ gate, decision: 'block', action, message: `[GATE:${gate}] ${action}` });

// ---------------------------------------------------------------------------
// Safety invariants. These are the tests that matter: suppression is allowed to
// change how loud an alert is, never whether the action was permitted.
// ---------------------------------------------------------------------------

test('INVARIANT: the first occurrence of a signature is never suppressed', () => {
  const ledger = new AlertNoiseLedger({ now: clock() });
  for (const event of [warn('a', 'x'), block('b', 'y'), warn('c', 'z')]) {
    const verdict = ledger.admit(event);
    assert.equal(verdict.render, 'full', `${event.gate} first sighting`);
    assert.equal(verdict.reason, 'first_occurrence');
    assert.equal(ledger.format(event, verdict), event.message, 'full render is verbatim');
  }
});

test('INVARIANT: a block is never fully suppressed, however often it repeats', () => {
  const ledger = new AlertNoiseLedger({ now: clock() });
  const event = block('force-push', 'git push --force origin main');
  // force-push was measured at 1 first + 26 repeats. Every one of those 27
  // must still tell the agent the push did not happen.
  for (let i = 0; i < 30; i++) {
    const verdict = ledger.admit(event);
    assert.notEqual(verdict.render, 'suppressed', `block repeat #${i + 1} went silent`);
    assert.ok(ledger.format(event, verdict), `block repeat #${i + 1} rendered nothing`);
  }
});

test('INVARIANT: escalating warn -> block re-renders in full, not as a repeat', () => {
  const ledger = new AlertNoiseLedger({ now: clock() });
  const action = 'rm -rf build';
  ledger.admit(warn('cleanup', action));
  // Same gate, same action, higher severity: genuinely new information.
  const escalated = ledger.admit(block('cleanup', action));
  assert.equal(escalated.render, 'full');
  assert.equal(escalated.reason, 'first_occurrence');
});

test('INVARIANT: the ledger fails OPEN when handed something it cannot parse', () => {
  const ledger = new AlertNoiseLedger({ now: clock() });
  // A getter that throws simulates an internal fault mid-admit.
  const hostile = { gate: 'x', decision: 'warn', get action() { throw new Error('boom'); } };
  const verdict = ledger.admit(hostile);
  assert.equal(verdict.render, 'full', 'a fault must not silence an alert');
  assert.equal(verdict.reason, 'ledger_error');
});

test('INVARIANT: suppressRepeatedLines fails OPEN, returning input unchanged', () => {
  const ledger = new AlertNoiseLedger({ now: clock() });
  ledger.now = () => { throw new Error('clock failure'); };
  const context = '[ThumbGate] Recurring failure patterns (enforce these):\n  - Avoid: "x"';
  assert.equal(ledger.suppressRepeatedLines(context).text, context);
});

// ---------------------------------------------------------------------------
// Suppression behaviour
// ---------------------------------------------------------------------------

test('a repeated warning collapses to a counted one-liner', () => {
  const ledger = new AlertNoiseLedger({ now: clock() });
  const event = warn('workflow-sentinel', 'Bash: node --test');
  assert.equal(ledger.admit(event).render, 'full');

  const second = ledger.admit(event);
  assert.equal(second.render, 'collapsed');
  assert.equal(second.count, 2);

  const line = ledger.format(event, second);
  assert.match(line, /workflow-sentinel/);
  assert.match(line, /x2/);
  assert.ok(line.length < event.message.length + 60, 'collapsed line should be short');
});

test('a warning that keeps repeating eventually goes quiet', () => {
  const ledger = new AlertNoiseLedger({ now: clock(), collapseUntil: 2, escalateAfter: 99 });
  const event = warn('noisy', 'same action');
  const renders = [];
  for (let i = 0; i < 5; i++) renders.push(ledger.admit(event).render);
  assert.deepEqual(renders, ['full', 'collapsed', 'suppressed', 'suppressed', 'suppressed']);
});

test('an alert that has fired N times without effect says so once, then stops', () => {
  const ledger = new AlertNoiseLedger({ now: clock(), escalateAfter: 4 });
  const event = warn('unhelpful', 'action');
  for (let i = 0; i < 3; i++) ledger.admit(event);

  const escalation = ledger.admit(event);
  assert.equal(escalation.escalate, true);
  const text = ledger.format(event, escalation);
  assert.match(text, /fired 4 times without the outcome changing/);
  assert.match(text, /not be repeated again/);

  // Said once. Subsequent firings must not repeat the escalation notice.
  const after = ledger.admit(event);
  assert.equal(after.escalate, false);
  assert.doesNotMatch(String(ledger.format(event, after) || ''), /without the outcome changing/);
});

test('a gate that has never blocked is demoted after one full airing', () => {
  // retrieval_entropy_high, as measured: 558 warnings, 0 blocks, ever.
  const ledger = new AlertNoiseLedger({
    now: clock(),
    gateHistory: { retrieval_entropy_high: { blocked: 0, warned: 558 } },
  });
  const event = warn('retrieval_entropy_high', 'lessons disagree');
  assert.equal(ledger.admit(event).render, 'full', 'still gets one hearing');

  const second = ledger.admit(event);
  assert.equal(second.render, 'suppressed');
  assert.equal(second.reason, 'gate_never_blocks');
  assert.equal(ledger.format(event, second), null);
});

test('a gate that HAS blocked is never demoted by the never-blocks rule', () => {
  const ledger = new AlertNoiseLedger({
    now: clock(),
    gateHistory: { 'secret-exfiltration': { blocked: 7, warned: 0 } },
  });
  const event = warn('secret-exfiltration', 'action');
  ledger.admit(event);
  assert.notEqual(ledger.admit(event).reason, 'gate_never_blocks');
});

test('a gate with few samples is not demoted on thin evidence', () => {
  const ledger = new AlertNoiseLedger({ now: clock(), gateHistory: { fresh: { blocked: 0, warned: 3 } } });
  assert.equal(ledger.isNeverBlockingGate('fresh'), false);
  assert.equal(ledger.isNeverBlockingGate('never-seen'), false);
});

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

test('volatile ids do not defeat repeat detection', () => {
  // The real failure mode: two runs of one operation under different temp dirs
  // fingerprint apart, so neither is ever recognised as a repeat.
  assert.equal(
    fingerprint(warn('g', 'cp /tmp/bg-verify-e22f885/x')),
    fingerprint(warn('g', 'cp /tmp/bg-verify-d110a87/x')),
  );
  assert.equal(
    normalizeAction('run at 2026-08-25T16:04:11.492Z'),
    normalizeAction('run at 2026-08-24T09:00:00.000Z'),
  );
});

test('genuinely different actions keep different fingerprints', () => {
  assert.notEqual(fingerprint(warn('g', 'git push')), fingerprint(warn('g', 'git pull')));
  assert.notEqual(fingerprint(warn('a', 'x')), fingerprint(warn('b', 'x')));
});

test('fingerprinting does not throw on malformed input', () => {
  for (const bad of [null, undefined, {}, { gate: 5 }, { action: {} }]) {
    assert.equal(typeof fingerprint(bad), 'string');
  }
});

// ---------------------------------------------------------------------------
// Reminder-line suppression — the bulk of the reclaimed context
// ---------------------------------------------------------------------------

// Reproduced verbatim from a live PreToolUse injection on 2026-08-25.
const REAL_REMINDER = [
  '[ThumbGate] Past mistakes relevant to this action — read before proceeding:',
  '  • 2026-08-24 PR #2036: `gh pr merge --squash --delete-branch` completed the provider merge but returned a local git...',
  '  • 2026-08-24 worktree cleanup: cleanup ran while the shell cwd was inside the worktree being removed...',
  '',
  '[ThumbGate] Recurring failure patterns (enforce these):',
  '  - Avoid: "thumbs down claude-history-sync auto-capture-fallback" (seen 44x)',
  '  - Avoid: "doctor feedback loop probe: prove thumbs feedback persists to durable logs" (seen 9x)',
].join('\n');

test('the first injection of a reminder block passes through untouched', () => {
  const ledger = new AlertNoiseLedger({ now: clock() });
  const result = ledger.suppressRepeatedLines(REAL_REMINDER);
  assert.equal(result.text, REAL_REMINDER);
  assert.equal(result.suppressedLines, 0);
});

test('an identical second injection is suppressed entirely, headers included', () => {
  const ledger = new AlertNoiseLedger({ now: clock() });
  ledger.suppressRepeatedLines(REAL_REMINDER);
  const second = ledger.suppressRepeatedLines(REAL_REMINDER);
  assert.equal(second.text, null, 'nothing new to say means no additionalContext at all');
  assert.equal(second.keptLines, 0);
  assert.equal(second.suppressedLines, 4);
});

test('a newly-added bullet still gets through, under its own header', () => {
  const ledger = new AlertNoiseLedger({ now: clock() });
  ledger.suppressRepeatedLines(REAL_REMINDER);

  const withNew = REAL_REMINDER + '\n  - Avoid: "a brand new mistake" (seen 2x)';
  const result = ledger.suppressRepeatedLines(withNew);

  assert.ok(result.text, 'new information must not be swallowed');
  assert.match(result.text, /a brand new mistake/);
  assert.match(result.text, /Recurring failure patterns/, 'its header comes with it');
  assert.doesNotMatch(result.text, /claude-history-sync/, 'the stale bullet stays suppressed');
  assert.equal(result.keptLines, 1);
});

test('a header whose bullets are all stale is dropped, not left empty', () => {
  const ledger = new AlertNoiseLedger({ now: clock() });
  ledger.suppressRepeatedLines(REAL_REMINDER);
  const withNew = REAL_REMINDER + '\n  - Avoid: "fresh" (seen 2x)';
  const text = ledger.suppressRepeatedLines(withNew).text;
  assert.doesNotMatch(text, /Past mistakes relevant/, 'that whole section was stale');
});

test('once the session window lapses, reminders speak up again', () => {
  let now = FIXED_NOW;
  const ledger = new AlertNoiseLedger({ now: () => now, ttlMs: 60_000 });
  ledger.suppressRepeatedLines(REAL_REMINDER);
  assert.equal(ledger.suppressRepeatedLines(REAL_REMINDER).text, null);

  now += 60_001; // window elapsed
  assert.equal(ledger.suppressRepeatedLines(REAL_REMINDER).text, REAL_REMINDER);
});

test('empty and non-string context is handled without throwing', () => {
  const ledger = new AlertNoiseLedger({ now: clock() });
  for (const bad of ['', null, undefined, 42]) {
    assert.equal(ledger.suppressRepeatedLines(bad).text, null);
  }
});

// ---------------------------------------------------------------------------
// Rule hygiene
// ---------------------------------------------------------------------------

test('placeholder rules that instruct nothing are recognised', () => {
  // Both of these were live in prevention_rules on 2026-08-25, occupying
  // High-Priority Contract slots.
  assert.equal(isPlaceholderRule('Investigate and prevent recurrence'), true);
  assert.equal(isPlaceholderRule('investigate and prevent recurrence.'), true);
  assert.equal(isPlaceholderRule('   '), true);
  assert.equal(isPlaceholderRule(null), true);
});

test('a rule with real instruction is kept', () => {
  assert.equal(
    isPlaceholderRule('Use gh issue create --body-file - with a here-document, and read back the URL.'),
    false,
  );
});

test('filterRules drops placeholders and duplicates but preserves order', () => {
  const { kept, dropped } = filterRules([
    'Never force-push to a protected branch.',
    'Investigate and prevent recurrence',
    'never force-push to a PROTECTED branch.', // same rule, different casing
    'Run the existing suite, not only the new test.',
  ]);
  assert.deepEqual(kept, [
    'Never force-push to a protected branch.',
    'Run the existing suite, not only the new test.',
  ]);
  assert.deepEqual(dropped.map((d) => d.reason), ['placeholder', 'duplicate']);
});

test('filterRules tolerates junk input', () => {
  assert.deepEqual(filterRules(null).kept, []);
  assert.deepEqual(filterRules([null, undefined, {}]).kept, []);
});

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

test('several gates firing on one action become a single incident', () => {
  const ledger = new AlertNoiseLedger({ now: clock() });
  const action = 'git push --force origin main';
  const groups = ledger.correlate([
    warn('workflow-sentinel', action),
    block('force-push', action),
    warn('push-without-thread-check', action),
  ]);
  assert.equal(groups.length, 1, 'one action, one incident');
  assert.equal(groups[0].gates.length, 3);
  assert.equal(groups[0].severity, 'block', 'the incident inherits the harshest verdict');
});

test('distinct actions stay distinct incidents', () => {
  const ledger = new AlertNoiseLedger({ now: clock() });
  assert.equal(ledger.correlate([warn('a', 'git push'), warn('a', 'git pull')]).length, 2);
});

// ---------------------------------------------------------------------------
// Measured reduction against the real distribution
// ---------------------------------------------------------------------------

test('replaying the measured 706-event distribution cuts the surfaced volume', () => {
  // Shape taken from live gate_stats on 2026-08-25: 278 unique signatures,
  // 428 repeats, 706 total.
  const ledger = new AlertNoiseLedger({
    now: clock(),
    gateHistory: { retrieval_entropy_high: { blocked: 0, warned: 558 } },
  });

  let rendered = 0;
  const surface = (event) => {
    const verdict = ledger.admit(event);
    if (ledger.format(event, verdict) !== null) rendered += 1;
  };

  // 202 unique entropy signatures, 356 repeats of them (the 558 total).
  for (let i = 0; i < 202; i++) surface(warn('retrieval_entropy_high', `lesson conflict ${i}`));
  for (let i = 0; i < 356; i++) surface(warn('retrieval_entropy_high', `lesson conflict ${i % 202}`));
  // force-push: 1 signature, 27 firings.
  for (let i = 0; i < 27; i++) surface(block('force-push', 'git push --force'));
  // The remaining 121 events across 75 other signatures.
  for (let i = 0; i < 121; i++) surface(warn(`gate${i % 75}`, `action ${i % 75}`));

  const stats = ledger.stats();
  assert.equal(stats.totalEvents, 706, 'replayed the full measured volume');
  assert.ok(stats.repeatRatio > 0.55, `expected the measured ~60% repeat rate, got ${stats.repeatRatio}`);

  // The point of the exercise: far fewer walls of text reach the agent, and
  // every one of the 27 force-push blocks is still among them.
  assert.ok(rendered < 706 * 0.6, `expected a material reduction, rendered ${rendered} of 706`);
});
