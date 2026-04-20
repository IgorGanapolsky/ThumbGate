#!/usr/bin/env node
// Hook: PreToolUse (matcher: Bash|Edit|Write)
//
// Replaces the advisory-only hook-verify-before-done.sh with an enforcing
// PreToolUse hook that:
//
//   1. (Always) Preserves the curl-to-prod timestamp tracking used by the
//      Stop hook hook-stop-verify-deploy.sh.
//   2. (Always) Retrieves matching ThumbGate lessons for the about-to-run
//      tool call and injects them as additionalContext so the agent
//      receives them as top-level reminders, not stderr noise.
//   3. (Flag: THUMBGATE_HOOKS_ENFORCE=1) Blocks the tool call with
//      decision:"block" when a matched lesson carries highRiskTags that
//      overlap the command and risk score meets the threshold (default 5).
//   4. (Flag: THUMBGATE_AUTOGATE_PR_COMMITS=1) When the Bash command is a
//      `git commit` on a non-main branch, registers a "thread-resolution-
//      verified" claim_gate before allowing the commit through. Subsequent
//      tool calls must satisfy that gate.
//
// Hook I/O contract (Claude Code):
//   stdin  : JSON { session_id, tool_name, tool_input, hook_event_name, cwd }
//   stdout : JSON { decision?, reason?, hookSpecificOutput? }
//   exit   : 0 always; blocking is signaled via decision:"block" in stdout.
//
// Defensive: every step is wrapped in try/catch. Any uncaught failure falls
// through to allow, so a bug in the hook never deadlocks the agent.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROD_URL = 'thumbgate-production.up.railway.app';
// Use the OS-assigned temp dir (per-user on macOS; /tmp on Linux) so the
// marker is not placed in a world-writable literal path. The companion
// bash hook scripts/hook-stop-verify-deploy.sh reads ${TMPDIR:-/tmp} so
// both resolve to the same location on each platform.
const VERIFICATION_MARKER = path.join(os.tmpdir(), '.thumbgate-last-deploy-verify');
const DEFAULT_RISK_THRESHOLD = 5;
const MAX_LESSONS = 3;
const MAX_LESSON_TEXT_LEN = 300;
const MAX_ACTION_CONTEXT_LEN = 512;
const MAX_WRITE_SNIPPET_LEN = 240;

// Uniform swallow function for best-effort side paths.
// The hook contract (see header) requires fail-open behavior: a bug in any
// sub-step (I/O, DB load, git probe, JSON parse) must never prevent the
// tool call from proceeding. Naming it makes every catch site explicit.
function failOpen(err) {
  // Expose through env flag for local debugging only; silent in production.
  if (process.env.THUMBGATE_HOOKS_DEBUG) {
    try {
      process.stderr.write(`[thumbgate-hook] fail-open: ${err?.message || String(err)}\n`);
    } catch {
      // stderr write itself failed; nothing further to do.
    }
  }
}

function readStdinSync() {
  try {
    const data = fs.readFileSync(0, 'utf8');
    if (!data?.trim()) return null;
    return JSON.parse(data);
  } catch (err) {
    failOpen(err);
    return null;
  }
}

function isTrueEnv(value) {
  if (!value) return false;
  const v = String(value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function respond(output) {
  try {
    process.stdout.write(JSON.stringify(output || {}));
  } catch (err) {
    failOpen(err);
  }
  process.exit(0);
}

function allow() {
  respond({});
}

function block(reason) {
  respond({
    decision: 'block',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function allowWithContext(additionalContext) {
  respond({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext,
    },
  });
}

function trackCurlToProd(toolName, toolInput) {
  if (toolName !== 'Bash') return;
  const command = toolInput?.command || toolInput?.cmd || '';
  if (/curl\b[^\n]*\b/i.test(command) && command.includes(PROD_URL)) {
    try {
      fs.writeFileSync(VERIFICATION_MARKER, new Date().toISOString());
    } catch (err) {
      failOpen(err);
    }
  }
}

function extractActionContext(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  if (toolName === 'Bash') return String(toolInput.command || toolInput.cmd || '');
  if (toolName === 'Edit') {
    return [toolInput.file_path, toolInput.old_string, toolInput.new_string]
      .filter(Boolean)
      .join(' | ');
  }
  if (toolName === 'Write') {
    return [toolInput.file_path, String(toolInput.content || '').slice(0, MAX_WRITE_SNIPPET_LEN)]
      .filter(Boolean)
      .join(' | ');
  }
  return JSON.stringify(toolInput).slice(0, MAX_ACTION_CONTEXT_LEN);
}

function retrieveLessons(toolName, actionContext) {
  try {
    const pkgRoot = path.resolve(__dirname, '..');
    const { retrieveWithRerankingSync } = require(path.join(pkgRoot, 'scripts', 'cross-encoder-reranker'));
    const results = retrieveWithRerankingSync(toolName, actionContext, {
      candidateCount: 20,
      maxResults: MAX_LESSONS,
    });
    return Array.isArray(results) ? results : [];
  } catch (err) {
    failOpen(err);
    return [];
  }
}

function getHighRiskTags() {
  try {
    const pkgRoot = path.resolve(__dirname, '..');
    const { getRiskSummary } = require(path.join(pkgRoot, 'scripts', 'risk-scorer'));
    const summary = getRiskSummary();
    if (!summary || !Array.isArray(summary.highRiskTags)) return [];
    return summary.highRiskTags;
  } catch (err) {
    failOpen(err);
    return [];
  }
}

function tagsForLesson(lesson) {
  if (!lesson) return [];
  const raw = lesson.tags || lesson.memory?.tags || [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (err) {
      failOpen(err);
    }
  }
  return [];
}

function buildRiskByTagMap(riskTagBuckets) {
  const riskByTag = new Map();
  for (const bucket of riskTagBuckets) {
    const key = bucket?.key || bucket?.tag;
    if (!key) continue;
    const score = Number(bucket.risk || bucket.score || bucket.riskScore || 0);
    if (Number.isFinite(score)) riskByTag.set(String(key), score);
  }
  return riskByTag;
}

function findBlockingRisk(lessons, threshold) {
  const riskTagBuckets = getHighRiskTags();
  if (riskTagBuckets.length === 0) return null;
  const riskByTag = buildRiskByTagMap(riskTagBuckets);
  for (const lesson of lessons) {
    for (const tag of tagsForLesson(lesson)) {
      const score = riskByTag.get(tag);
      if (typeof score === 'number' && score >= threshold) {
        return { tag, score, lesson };
      }
    }
  }
  return null;
}

// Resolve git to a vetted absolute path instead of relying on $PATH lookup.
// Falls back to bare 'git' only when none of the standard locations exist,
// so users with custom installs still work. Result is cached.
let cachedGitPath = null;
function resolveGitBinary() {
  if (cachedGitPath !== null) return cachedGitPath;
  const override = process.env.THUMBGATE_GIT_BIN;
  if (override) {
    cachedGitPath = override;
    return cachedGitPath;
  }
  const candidates = [
    '/usr/bin/git',
    '/usr/local/bin/git',
    '/opt/homebrew/bin/git',
    '/bin/git',
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cachedGitPath = candidate;
        return cachedGitPath;
      }
    } catch (err) {
      failOpen(err);
    }
  }
  cachedGitPath = 'git';
  return cachedGitPath;
}

function currentGitBranch() {
  try {
    // Safe: absolute binary path (no PATH lookup), fixed argv, no shell
    // interpolation, no user input. Only used to decide whether to
    // register a claim gate before allowing the commit through.
    return execFileSync(resolveGitBinary(), ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (err) {
    failOpen(err);
    return '';
  }
}

function maybeRegisterPrCommitGate(toolName, toolInput) {
  if (toolName !== 'Bash') return null;
  if (!isTrueEnv(process.env.THUMBGATE_AUTOGATE_PR_COMMITS)) return null;
  const command = toolInput?.command || toolInput?.cmd || '';
  if (!/\bgit\s+commit\b/.test(command)) return null;
  const branch = currentGitBranch();
  if (!branch || branch === 'main' || branch === 'master') return null;
  try {
    const pkgRoot = path.resolve(__dirname, '..');
    const { registerClaimGate } = require(path.join(pkgRoot, 'scripts', 'gates-engine'));
    registerClaimGate(
      'thread-resolution-verified',
      ['gh_pr_view_threads'],
      `Before merging ${branch}, run 'gh pr view --json reviewThreads' and confirm 0 unresolved threads.`
    );
    return { branch, gate: 'thread-resolution-verified' };
  } catch (err) {
    failOpen(err);
    return null;
  }
}

function formatLessonsAsReminder(lessons, extras) {
  const lines = [
    '<system-reminder>',
    'ThumbGate retrieved prior lessons relevant to this tool call.',
    'REVIEW BEFORE PROCEEDING:',
  ];
  lessons.forEach((lesson, idx) => {
    const text = lesson.whatToChange || lesson.howToAvoid || lesson.content || lesson.title || '';
    if (!text) return;
    const tags = tagsForLesson(lesson);
    const tagSuffix = tags.length ? ` [${tags.slice(0, 4).join(', ')}]` : '';
    lines.push(`${idx + 1}. ${String(text).trim().slice(0, MAX_LESSON_TEXT_LEN)}${tagSuffix}`);
  });
  if (extras?.autogate) {
    lines.push(
      '',
      `ThumbGate auto-registered claim gate "${extras.autogate.gate}" on branch ${extras.autogate.branch}.`,
      'You MUST satisfy this gate (show gh pr view output with 0 unresolved threads) before merging.'
    );
  }
  lines.push('</system-reminder>');
  return lines.join('\n');
}

function resolveEffectiveInput(rawToolInput) {
  if (rawToolInput) return rawToolInput;
  if (process.env.CLAUDE_TOOL_INPUT) {
    // Backward-compat: older hook convention used CLAUDE_TOOL_INPUT env string.
    return { command: process.env.CLAUDE_TOOL_INPUT };
  }
  return {};
}

function maybeBlockOnRisk(lessons) {
  if (!isTrueEnv(process.env.THUMBGATE_HOOKS_ENFORCE)) return null;

  // Bayes-optimal path: cost-weighted argmax over {block, allow} using a
  // loss matrix that can make a single `deploy-prod`-tagged lesson veto
  // the call on its own. Falls back transparently to the legacy threshold
  // rule when disabled or when the scorer has no signal yet.
  const bayesReason = maybeBlockViaBayesOptimal(lessons);
  if (bayesReason) return bayesReason;

  const rawThreshold = Number(process.env.THUMBGATE_HOOKS_ENFORCE_THRESHOLD || DEFAULT_RISK_THRESHOLD);
  const threshold = Number.isFinite(rawThreshold) ? rawThreshold : DEFAULT_RISK_THRESHOLD;
  const risk = findBlockingRisk(lessons, threshold);
  if (!risk) return null;
  return (
    `ThumbGate blocked: this action matches high-risk tag "${risk.tag}" (risk=${risk.score}). `
    + `Prior lesson: ${(risk.lesson.whatToChange || risk.lesson.title || '').toString().slice(0, MAX_WRITE_SNIPPET_LEN)}. `
    + `Set THUMBGATE_HOOKS_ENFORCE=0 to override after you have addressed the lesson.`
  );
}

// Bayes-optimal enforcement is opt-in today: set
// `THUMBGATE_HOOKS_BAYES_OPTIMAL=1` (or `bayesOptimalEnabled: true` in
// `config/enforcement.json`) to flip the decision rule from threshold-on-
// heuristic to cost-weighted argmax. The path is defensively fail-open: any
// exception inside the Bayes layer returns null and lets the legacy rule run.
function maybeBlockViaBayesOptimal(lessons) {
  try {
    if (!isBayesOptimalEnabled()) return null;

    const pkgRoot = path.resolve(__dirname, '..');
    const riskScorer = require(path.join(pkgRoot, 'scripts', 'risk-scorer'));
    const bayes = require(path.join(pkgRoot, 'scripts', 'bayes-optimal-gate'));

    const summary = riskScorer.getRiskSummary();
    if (!summary) return null;

    const rateMap = bayes.buildRiskRateMap(summary.highRiskTags);
    if (rateMap.size === 0) return null;

    const lossMatrix = bayes.loadLossMatrix();
    let worst = null;
    for (const lesson of lessons || []) {
      const tags = tagsForLesson(lesson);
      if (tags.length === 0) continue;
      const posterior = bayes.computeBayesPosterior({
        tags,
        riskByTag: rateMap,
        baseRate: summary.baseRate,
      });
      const decision = bayes.bayesOptimalDecision(posterior, tags, lossMatrix);
      if (decision.decision !== 'block') continue;
      const dominantTag = findDominantTag(tags, lossMatrix);
      const candidate = { lesson, tags, posterior, decision, dominantTag };
      if (!worst || decision.expectedLoss.allow > worst.decision.expectedLoss.allow) {
        worst = candidate;
      }
    }
    if (!worst) return null;

    const { lesson, dominantTag, posterior, decision } = worst;
    const lessonText = (lesson.whatToChange || lesson.title || '').toString().slice(0, MAX_WRITE_SNIPPET_LEN);
    return (
      `ThumbGate blocked (Bayes-optimal): P(harmful|tags) = ${posterior.pHarmful}; `
      + `dominant tag "${dominantTag}" — E[loss|allow]=${decision.expectedLoss.allow} vs E[loss|block]=${decision.expectedLoss.block}. `
      + `Prior lesson: ${lessonText}. `
      + `Override via THUMBGATE_HOOKS_BAYES_OPTIMAL=0 or adjust config/enforcement.json.`
    );
  } catch (err) {
    failOpen(err);
    return null;
  }
}

function isBayesOptimalEnabled() {
  if (process.env.THUMBGATE_HOOKS_BAYES_OPTIMAL !== undefined) {
    return isTrueEnv(process.env.THUMBGATE_HOOKS_BAYES_OPTIMAL);
  }
  try {
    const pkgRoot = path.resolve(__dirname, '..');
    const configPath = path.join(pkgRoot, 'config', 'enforcement.json');
    if (!fs.existsSync(configPath)) return false;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return Boolean(raw?.bayesOptimalEnabled);
  } catch (err) {
    failOpen(err);
    return false;
  }
}

// Pick the tag whose false-allow cost dominates the decision, for the
// operator-facing block message. When nothing overrides `default`, we
// just return the first normalized tag so the reason stays explainable.
function findDominantTag(tags, lossMatrix) {
  let best = { tag: null, cost: -Infinity };
  for (const tag of tags || []) {
    const key = String(tag || '').trim().toLowerCase();
    if (!key) continue;
    const cost = Number(lossMatrix?.falseAllow?.[key]);
    if (Number.isFinite(cost) && cost > best.cost) {
      best = { tag: key, cost };
    }
  }
  if (best.tag) return best.tag;
  for (const tag of tags || []) {
    const key = String(tag || '').trim().toLowerCase();
    if (key) return key;
  }
  return '(unknown)';
}

function main() {
  const input = readStdinSync() || {};
  const toolName = input.tool_name || process.env.CLAUDE_TOOL_NAME || '';
  const effectiveInput = resolveEffectiveInput(input.tool_input || null);

  try {
    trackCurlToProd(toolName, effectiveInput);
  } catch (err) {
    failOpen(err);
  }

  const actionContext = extractActionContext(toolName, effectiveInput);
  const lessons = retrieveLessons(toolName, actionContext);

  const blockReason = maybeBlockOnRisk(lessons);
  if (blockReason) return block(blockReason);

  const autogate = maybeRegisterPrCommitGate(toolName, effectiveInput);

  if (lessons.length > 0 || autogate) {
    return allowWithContext(formatLessonsAsReminder(lessons, { autogate }));
  }

  return allow();
}

// Only auto-invoke main() when the file is executed directly as a hook.
// When required from a test, we skip this so exported helpers can be
// unit-tested without the module calling process.exit(0).
function isEntryPoint() {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return fs.realpathSync(argv1) === fs.realpathSync(__filename);
  } catch (err) {
    failOpen(err);
    return false;
  }
}

if (isEntryPoint()) {
  try {
    main();
  } catch (err) {
    // Hook must never deadlock the agent. Fail open.
    failOpen(err);
    allow();
  }
}

// Exported for unit tests. Not part of the hook stdin/stdout contract.
module.exports = {
  failOpen,
  readStdinSync,
  isTrueEnv,
  respond,
  allow,
  block,
  allowWithContext,
  trackCurlToProd,
  extractActionContext,
  tagsForLesson,
  buildRiskByTagMap,
  findBlockingRisk,
  currentGitBranch,
  maybeRegisterPrCommitGate,
  formatLessonsAsReminder,
  resolveEffectiveInput,
  maybeBlockOnRisk,
  maybeBlockViaBayesOptimal,
  isBayesOptimalEnabled,
  findDominantTag,
  resolveGitBinary,
  isEntryPoint,
  main,
  VERIFICATION_MARKER,
};
