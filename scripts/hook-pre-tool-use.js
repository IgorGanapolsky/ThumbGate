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

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROD_URL = 'thumbgate-production.up.railway.app';
const VERIFICATION_MARKER = '/tmp/.thumbgate-last-deploy-verify';
const DEFAULT_RISK_THRESHOLD = 5;
const MAX_LESSONS = 3;

function readStdinSync() {
  try {
    const data = fs.readFileSync(0, 'utf8');
    if (!data || !data.trim()) return null;
    return JSON.parse(data);
  } catch (_) {
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
  } catch (_) { /* ignore serialization failure */ }
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
  const command = (toolInput && (toolInput.command || toolInput.cmd)) || '';
  if (/curl\b[^\n]*\b/i.test(command) && command.includes(PROD_URL)) {
    try {
      fs.writeFileSync(VERIFICATION_MARKER, new Date().toISOString());
    } catch (_) { /* non-critical */ }
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
    return [toolInput.file_path, String(toolInput.content || '').slice(0, 240)]
      .filter(Boolean)
      .join(' | ');
  }
  return JSON.stringify(toolInput).slice(0, 512);
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
  } catch (_) {
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
  } catch (_) {
    return [];
  }
}

function tagsForLesson(lesson) {
  if (!lesson) return [];
  const raw = lesson.tags || (lesson.memory && lesson.memory.tags) || [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) { /* fall through */ }
  }
  return [];
}

function findBlockingRisk(lessons, threshold) {
  const riskTagBuckets = getHighRiskTags();
  if (riskTagBuckets.length === 0) return null;
  const riskByTag = new Map();
  for (const bucket of riskTagBuckets) {
    const key = bucket && (bucket.key || bucket.tag);
    if (!key) continue;
    const score = Number(bucket.risk || bucket.score || bucket.riskScore || 0);
    if (Number.isFinite(score)) riskByTag.set(String(key), score);
  }
  for (const lesson of lessons) {
    const tags = tagsForLesson(lesson);
    for (const tag of tags) {
      const score = riskByTag.get(tag);
      if (typeof score === 'number' && score >= threshold) {
        return { tag, score, lesson };
      }
    }
  }
  return null;
}

function currentGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return '';
  }
}

function maybeRegisterPrCommitGate(toolName, toolInput) {
  if (toolName !== 'Bash') return null;
  if (!isTrueEnv(process.env.THUMBGATE_AUTOGATE_PR_COMMITS)) return null;
  const command = (toolInput && (toolInput.command || toolInput.cmd)) || '';
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
  } catch (_) {
    return null;
  }
}

function formatLessonsAsReminder(lessons, extras) {
  const lines = ['<system-reminder>'];
  lines.push('ThumbGate retrieved prior lessons relevant to this tool call.');
  lines.push('REVIEW BEFORE PROCEEDING:');
  lessons.forEach((lesson, idx) => {
    const text = lesson.whatToChange || lesson.howToAvoid || lesson.content || lesson.title || '';
    if (!text) return;
    const tags = tagsForLesson(lesson);
    const tagSuffix = tags.length ? ` [${tags.slice(0, 4).join(', ')}]` : '';
    lines.push(`${idx + 1}. ${String(text).trim().slice(0, 300)}${tagSuffix}`);
  });
  if (extras && extras.autogate) {
    lines.push('');
    lines.push(`ThumbGate auto-registered claim gate "${extras.autogate.gate}" on branch ${extras.autogate.branch}.`);
    lines.push('You MUST satisfy this gate (show gh pr view output with 0 unresolved threads) before merging.');
  }
  lines.push('</system-reminder>');
  return lines.join('\n');
}

function main() {
  const input = readStdinSync() || {};
  const toolName = input.tool_name || process.env.CLAUDE_TOOL_NAME || '';
  const toolInput = input.tool_input || null;

  // Backward-compat: older hook convention used CLAUDE_TOOL_INPUT env string.
  let legacyToolInput = null;
  if (!toolInput && process.env.CLAUDE_TOOL_INPUT) {
    legacyToolInput = { command: process.env.CLAUDE_TOOL_INPUT };
  }
  const effectiveInput = toolInput || legacyToolInput || {};

  try {
    trackCurlToProd(toolName, effectiveInput);
  } catch (_) { /* non-critical */ }

  const actionContext = extractActionContext(toolName, effectiveInput);
  const lessons = retrieveLessons(toolName, actionContext);

  if (isTrueEnv(process.env.THUMBGATE_HOOKS_ENFORCE)) {
    const threshold = Number(process.env.THUMBGATE_HOOKS_ENFORCE_THRESHOLD || DEFAULT_RISK_THRESHOLD);
    const risk = findBlockingRisk(lessons, Number.isFinite(threshold) ? threshold : DEFAULT_RISK_THRESHOLD);
    if (risk) {
      return block(
        `ThumbGate blocked: this action matches high-risk tag "${risk.tag}" (risk=${risk.score}). `
        + `Prior lesson: ${(risk.lesson.whatToChange || risk.lesson.title || '').toString().slice(0, 240)}. `
        + `Set THUMBGATE_HOOKS_ENFORCE=0 to override after you have addressed the lesson.`
      );
    }
  }

  const autogate = maybeRegisterPrCommitGate(toolName, effectiveInput);

  if (lessons.length > 0 || autogate) {
    const context = formatLessonsAsReminder(lessons, { autogate });
    return allowWithContext(context);
  }

  return allow();
}

try {
  main();
} catch (_) {
  // Hook must never deadlock the agent. Fail open.
  allow();
}
