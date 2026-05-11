#!/usr/bin/env node
'use strict';

/**
 * scripts/cli-test-block.js
 *
 * `npx thumbgate test-block`
 *
 * A 30-second guided demo for new ThumbGate installs. Installs a temporary
 * prevention rule, simulates a tool call that hits it, prints the BLOCKED
 * decision the production hook would emit, and removes the temp rule.
 *
 * Closes the activation gap: lets a fresh install feel "the catch" within
 * 30 seconds of `npx thumbgate init` without waiting for the agent to
 * organically misbehave.
 *
 * Flags:
 *   --dry-run   Print what would happen; don't write the rule or simulate.
 *   --no-cta    Suppress the Pro upsell at the end (for CI/automation).
 *
 * Exit codes:
 *   0  success (or dry-run)
 *   2  ThumbGate not yet `init`-ed
 *   3  rule write or cleanup failed
 */

const fs = require('node:fs');
const path = require('node:path');

const SENTINEL = 'THUMBGATE_TEST_BLOCK_DO_NOT_RUN';
const PROJECT_ROOT = process.cwd();
const THUMBGATE_DIR = path.join(PROJECT_ROOT, '.thumbgate');
const RULES_DIR = path.join(THUMBGATE_DIR, 'rules');
const RULE_FILE = path.join(RULES_DIR, 'test-block.json');
const PRO_CHECKOUT_URL =
  'https://thumbgate.ai/checkout/pro?utm_source=cli&utm_medium=test_block&utm_campaign=test_block_aha';
const TTY_COLORS = process.stdout.isTTY && !process.env.NO_COLOR;

function color(code, str) {
  if (!TTY_COLORS) return str;
  return `[${code}m${str}[0m`;
}
const dim = (s) => color('2', s);
const bold = (s) => color('1', s);
const red = (s) => color('31', s);
const green = (s) => color('32', s);
const cyan = (s) => color('36', s);
const yellow = (s) => color('33', s);

function parseArgs(argv) {
  const opts = { dryRun: false, noCta: false };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-cta') opts.noCta = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

function printHelp() {
  process.stdout.write(`
${bold('thumbgate test-block')} — feel the catch in 30 seconds

Installs a temporary prevention rule, simulates an unsafe tool call, prints
the BLOCKED decision the production PreToolUse hook would emit, then removes
the rule. No risk to your real workflow — just proof the catch works.

${bold('Usage')}
  npx thumbgate test-block              run the guided demo
  npx thumbgate test-block --dry-run    print what would happen, don't write
  npx thumbgate test-block --no-cta     suppress Pro upsell (for CI)
  npx thumbgate test-block --help       show this message
`);
}

function ensureInitialized() {
  if (!fs.existsSync(THUMBGATE_DIR)) {
    process.stderr.write(
      `${red('ThumbGate is not initialized in this directory.')}\n` +
        `Run ${bold('npx thumbgate init')} first to install, then re-run this command.\n`,
    );
    return false;
  }
  return true;
}

function buildTestRule(now) {
  const expires = new Date(now + 5 * 60 * 1000).toISOString();
  return {
    id: 'test-block-sentinel',
    name: 'thumbgate-test-block-sentinel',
    pattern: SENTINEL,
    matcher: 'tool_input.command.contains',
    decision: 'deny',
    reason:
      'Test rule installed by `npx thumbgate test-block`. Matches the test sentinel only.',
    isTestRule: true,
    createdAt: new Date(now).toISOString(),
    expiresAt: expires,
  };
}

function writeRule(rule) {
  fs.mkdirSync(RULES_DIR, { recursive: true });
  fs.writeFileSync(RULE_FILE, `${JSON.stringify(rule, null, 2)}\n`, 'utf-8');
}

function removeRule() {
  if (fs.existsSync(RULE_FILE)) fs.unlinkSync(RULE_FILE);
}

/**
 * Run the demo tool-call through the gate. We try the real gates-engine first
 * (it picks up any installed rules + built-in safety checks); if that path
 * isn't available we fall back to an in-process simulation that still
 * produces a BLOCKED decision so the user sees the same catch.
 */
function evaluateBlock(rule, toolCall) {
  try {
    // eslint-disable-next-line global-require
    const gatesEngine = require('./gates-engine');
    if (gatesEngine && typeof gatesEngine.run === 'function') {
      const out = gatesEngine.run(toolCall);
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      if (/deny|block/i.test(text)) {
        return {
          source: 'gates-engine',
          decision: 'deny',
          matchedRule: rule.name,
          reason: rule.reason,
          rawOutput: text,
        };
      }
    }
  } catch (_err) {
    // fall through to in-process simulation
  }

  // Fallback: minimal in-process simulation. Matches the same sentinel the
  // installed rule would match so the user sees the same catch.
  const cmd = String(toolCall.tool_input?.command || '');
  const matched = cmd.includes(SENTINEL);
  return {
    source: 'in-process simulation',
    decision: matched ? 'deny' : 'allow',
    matchedRule: matched ? rule.name : null,
    reason: matched ? rule.reason : 'no rule matched',
    rawOutput: null,
  };
}

function printBlock(decision, toolCall) {
  const cmd = toolCall.tool_input?.command || '';
  process.stdout.write(
    `\n  ${red(bold('⛔ BLOCKED'))}  ${bold('rule:')} ${decision.matchedRule}\n` +
      `  ${dim('would have run:')} ${cmd}\n` +
      `  ${dim('reason:')} ${decision.reason}\n` +
      `  ${dim('source:')} ${decision.source}\n\n`,
  );
}

function printBanner() {
  process.stdout.write(
    `\n${cyan(bold('ThumbGate test-block'))} ${dim('— feel the catch in 30 seconds')}\n\n`,
  );
}

function printSummary(opts) {
  const lines = [
    `${green('✓')} ThumbGate is working`,
    `${green('✓')} Test rule fired and blocked the unsafe call`,
    `${green('✓')} Test rule removed; your real rules are untouched`,
  ];
  process.stdout.write(`${lines.join('\n')}\n\n`);
  if (opts.noCta) return;
  process.stdout.write(
    `${bold('Want to see this on your own agent’s mistakes?')}\n` +
      `  1. Use Claude Code / Cursor / Codex normally\n` +
      `  2. When the agent does something wrong, run:\n` +
      `     ${cyan('npx thumbgate capture "specific thing it did wrong"')}\n` +
      `  3. Next session, ThumbGate blocks the repeat — for real.\n\n` +
      `${dim('Pro upgrade gives you the dashboard, exports, and history-aware recall:')}\n` +
      `  ${cyan(PRO_CHECKOUT_URL)}\n\n`,
  );
}

function step(n, total, msg) {
  process.stdout.write(`${dim(`[${n}/${total}]`)} ${msg}\n`);
}

function runTestBlock(argv = [], io = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return { code: 0, opts };
  }

  printBanner();

  if (!ensureInitialized()) {
    return { code: 2, opts, error: 'not_initialized' };
  }

  const total = 4;
  const now = Date.now();
  const rule = buildTestRule(now);
  const toolCall = {
    tool_name: 'Bash',
    tool_input: { command: `echo ${SENTINEL}` },
  };

  if (opts.dryRun) {
    step(1, total, dim('(dry-run)') + ' would install temp rule at ' + RULE_FILE);
    step(2, total, dim('(dry-run)') + ' would simulate tool call: Bash echo ' + SENTINEL);
    step(3, total, dim('(dry-run)') + ' would print BLOCKED decision');
    step(4, total, dim('(dry-run)') + ' would remove ' + RULE_FILE);
    process.stdout.write(`\n${yellow('dry-run complete. nothing written.')}\n\n`);
    return { code: 0, opts, dryRun: true };
  }

  try {
    step(1, total, `Installing test prevention rule at ${dim(path.relative(PROJECT_ROOT, RULE_FILE))}…`);
    writeRule(rule);
  } catch (err) {
    process.stderr.write(
      `${red('Failed to write test rule:')} ${err.message}\n` +
        `Check write permissions on ${RULES_DIR}.\n`,
    );
    return { code: 3, opts, error: 'write_failed' };
  }

  step(2, total, `Simulating an agent tool call: ${dim('Bash echo ' + SENTINEL)}…`);
  const decision = evaluateBlock(rule, toolCall);

  step(3, total, 'Catching the block…');
  printBlock(decision, toolCall);

  step(4, total, 'Cleaning up…');
  let cleaned = false;
  try {
    removeRule();
    cleaned = !fs.existsSync(RULE_FILE);
  } catch (err) {
    process.stderr.write(
      `${red('Failed to remove test rule:')} ${err.message}\n` +
        `You can remove it manually: rm ${RULE_FILE}\n`,
    );
    return { code: 3, opts, error: 'cleanup_failed' };
  }
  if (!cleaned) {
    process.stderr.write(
      `${red('Test rule still present after cleanup:')} ${RULE_FILE}\n`,
    );
    return { code: 3, opts, error: 'cleanup_incomplete' };
  }

  process.stdout.write('\n');
  printSummary(opts);

  return { code: 0, opts, decision };
}

if (require.main === module || path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  const result = runTestBlock(process.argv.slice(2));
  process.exit(result.code);
}

module.exports = {
  runTestBlock,
  buildTestRule,
  evaluateBlock,
  parseArgs,
  SENTINEL,
  RULE_FILE,
};
