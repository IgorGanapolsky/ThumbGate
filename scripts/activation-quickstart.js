'use strict';

// ---------------------------------------------------------------------------
// Activation: guided first prevention rule + a live demonstrated block.
//
// ~98.5% of `init` users never promote their first rule, so they never see
// "ThumbGate just blocked a repeat mistake" — the aha moment that drives
// activation (and, downstream, conversion). `quickstart` walks a new user
// through capturing one real example, promoting it to a block rule, and then
// firing that rule against the exact action so they watch it get blocked.
//
// SAFETY: this is additive and lives in its own module. `init` is untouched.
// The interactive flow ONLY runs in a real TTY. Non-interactive / piped / CI
// invocations print a one-line hint and exit 0 without prompting or hanging.
// ---------------------------------------------------------------------------

const path = require('path');

const PKG_ROOT = path.join(__dirname, '..');
const PRO_URL = 'https://thumbgate.ai';

// Turn a free-text mistake description into a safe, literal gate pattern. We
// escape regex metacharacters so arbitrary user input can never produce an
// invalid or runaway regex inside the gates engine.
function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pkgVersion() {
  try {
    return require(path.join(PKG_ROOT, 'package.json')).version;
  } catch (_) {
    return '0.0.0';
  }
}

// Core, dependency-injected activation flow so it is testable without a real
// TTY. Callers provide ask() (returns a Promise<string>), out() (line writer),
// and isTTY. Returns a structured result describing what was promoted/blocked.
//
// Optional injectables (deps) keep the test hermetic and let the CLI pass the
// real modules:
//   deps.forcePromote(pattern, action) -> { gateId, totalGates }
//   deps.runGate(input) -> Promise<rawJsonString>
//   deps.captureFeedback(params)
//   deps.trackEvent(name, props)
async function runActivationFlow({ ask, out, isTTY, deps = {} }) {
  // Hard safety gate: never prompt or hang in non-interactive contexts.
  if (!isTTY) {
    out('thumbgate quickstart is an interactive walkthrough — run it in a terminal.');
    out('Non-interactive setup: npx thumbgate init   (or: npx thumbgate quick-start)');
    return { interactive: false, promoted: false, blocked: false };
  }

  const forcePromote = deps.forcePromote
    || require(path.join(PKG_ROOT, 'scripts', 'auto-promote-gates')).forcePromote;
  const runGate = deps.runGate
    || ((input) => require(path.join(PKG_ROOT, 'scripts', 'gates-engine')).runAsync(input));
  let captureFeedback = deps.captureFeedback;
  if (captureFeedback === undefined) {
    try {
      ({ captureFeedback } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop')));
    } catch (_) {
      // Feedback capture is a nice-to-have here; the rule + block is the aha.
      captureFeedback = null;
    }
  }
  const trackEvent = deps.trackEvent || (() => {});

  out('');
  out(`thumbgate quickstart v${pkgVersion()}`);
  out('');
  out("Let's set up your first prevention rule and watch it block a repeat mistake.");
  out('');
  out('Think of one thing an AI agent did that you never want it to do again.');
  out('Examples: "git push --force to main", "rm -rf node_modules", "edit .env directly".');
  out('');

  let mistake = String(await ask('The mistake to block: ') || '').trim();
  if (!mistake) {
    mistake = 'git push --force to main';
    out(`(using a starter example: ${mistake})`);
  }

  // 1. Capture it as a real thumbs-down example (best-effort).
  if (typeof captureFeedback === 'function') {
    try {
      captureFeedback({
        signal: 'down',
        context: mistake,
        whatWentWrong: mistake,
        whatToChange: `Block this action: ${mistake}`,
        tags: 'quickstart,activation,first-rule',
        gateAction: 'block',
      });
    } catch (_) {
      // Capture failure should not abort the activation aha.
    }
  }

  // 2. Promote it into a hard block rule using the existing primitive.
  const pattern = escapeRegex(mistake);
  const promotion = forcePromote(pattern, 'block');
  out('');
  out(`  Rule promoted: ${promotion.gateId} [block]`);
  out(`  Active rules now: ${promotion.totalGates}`);

  // 3. Demonstrate the block. Force strict enforcement for the demo so the
  //    user's brand-new rule hard-blocks (default posture is warn-by-default).
  //    We restore the prior value so we never mutate the user's environment.
  const priorStrict = process.env.THUMBGATE_STRICT_ENFORCEMENT;
  process.env.THUMBGATE_STRICT_ENFORCEMENT = '1';
  let verdict;
  try {
    const demoInput = { tool_name: 'Bash', tool_input: { command: mistake } };
    const raw = await runGate(demoInput);
    verdict = JSON.parse(raw);
  } finally {
    if (priorStrict === undefined) delete process.env.THUMBGATE_STRICT_ENFORCEMENT;
    else process.env.THUMBGATE_STRICT_ENFORCEMENT = priorStrict;
  }

  const decision = verdict && (verdict.decision
    || (verdict.hookSpecificOutput && verdict.hookSpecificOutput.permissionDecision));
  const blocked = decision === 'block' || decision === 'deny';

  out('');
  if (blocked) {
    out('  | ThumbGate just blocked it.');
    out(`  | Action attempted: ${mistake}`);
    out('  | Verdict: BLOCKED — the agent cannot repeat this mistake.');
  } else {
    // Even in warn posture the action is flagged + logged. Be honest about it.
    out('  | ThumbGate flagged it.');
    out(`  | Action attempted: ${mistake}`);
    out('  | Verdict: flagged and logged. Set THUMBGATE_STRICT_ENFORCEMENT=1 to hard-block.');
  }

  // 4. Tie the value the user just saw to what Pro keeps working.
  out('');
  out('  That rule lives in this project. Pro keeps your rules — and the mistakes');
  out('  you teach it — synced across every machine and agent runtime you work in,');
  out(`  so the block you just saw follows your whole team. ${PRO_URL}/pricing`);
  out('');

  try { trackEvent('cli_quickstart_activated', { command: 'quickstart', blocked }); } catch (_) { /* telemetry best-effort */ }

  return {
    interactive: true,
    promoted: true,
    blocked,
    gateId: promotion.gateId,
    pattern,
    mistake,
    verdict,
  };
}

// CLI entrypoint: wires runActivationFlow to a real readline prompt + stdout.
function quickstart() {
  const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  const out = (line = '') => console.log(line);

  const trackEvent = (() => {
    try { return require(path.join(PKG_ROOT, 'scripts', 'cli-telemetry')).trackEvent; } catch (_) { return () => {}; }
  })();

  if (!isTTY) {
    // Mirror the non-interactive branch without opening readline (which would
    // otherwise keep the process alive waiting for input that never comes).
    return runActivationFlow({ ask: async () => '', out, isTTY: false, deps: { trackEvent } });
  }

  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  return runActivationFlow({ ask, out, isTTY: true, deps: { trackEvent } })
    .catch((err) => {
      console.error(`quickstart error: ${err && err.message ? err.message : err}`);
      process.exitCode = 1;
    })
    .finally(() => rl.close());
}

module.exports = { runActivationFlow, quickstart, escapeRegex };
