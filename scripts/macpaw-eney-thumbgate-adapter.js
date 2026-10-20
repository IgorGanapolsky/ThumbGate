#!/usr/bin/env node
'use strict';

/**
 * scripts/macpaw-eney-thumbgate-adapter.js
 *
 * MacPaw Eney × ThumbGate On-Device Pre-Action & Thumbs-Down-to-Firewall Adapter.
 *
 * Solves the exact failure mode captured on macOS (2026-10-18):
 *   1. User asks Eney: "why are my Mac's fans running crazy?"
 *   2. Eney diagnoses 16.1 GB / 17 GB swap and proposes:
 *      "Ollama is the memory culprit — its llama-server is holding 6.4 GB of RAM...
 *       Quitting Ollama frees 6.4 GB... Quit Ollama now?" [👍] [👎]
 *   3. User types blanket delegation: "do everything you need" (or clicks 👎 because
 *      Ollama/llama-server powers Screenpipe Ask on 127.0.0.1:11434).
 *
 * Without ThumbGate:
 *   - Clicking 👎 in Eney only logs passive UI telemetry; Eney proposes/executes
 *     `Quit Ollama` again on the next swap spike.
 *   - Typing "do everything you need" lets an OS agent kill mission-critical local
 *     daemons (`Ollama`, `llama-server`, `postgres`, `orchestrad`, `Screenpipe`).
 *
 * With ThumbGate (<0.2ms on Apple Silicon CPU, zero cloud egress):
 *   - `captureEneyThumbSignal()` compiles a 👎 on any Eney action proposal into a
 *     deterministic local `PreToolUse` block rule + DPO preference pair for Liquid AI LFM.
 *   - `evaluateEneyActionGate()` intercepts every Eney macOS skill (`quit_app`,
 *     `kill_process`, `clear_tabs`, `manage_downloads`, `summarize_emails`) at T=0,
 *     blocking protected daemons and corporate email domains even under blanket
 *     "do everything you need" prompts while allowing safe cache/temp cleanup.
 */

const crypto = require('node:crypto');

const DEFAULT_PROTECTED_MAC_DAEMONS = Object.freeze([
  'ollama',
  'llama-server',
  'screenpipe',
  'postgres',
  'orchestrad',
  'docker',
  'forticlient',
  'tailscaled',
]);

const FORBIDDEN_CORP_DOMAINS = /(?:^|@|\.)(?:ecisolutions|ecinexus|eci)\.com\b/i;

function normalizeProcessTarget(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\.app$/i, '');
}

/**
 * Convert an Eney UI 👍 / 👎 click on a proposed macOS action into:
 *   1. A deterministic local PreToolUse prevention rule (when signal === 'down')
 *   2. A local on-device DPO preference pair (chosen vs rejected action) for Liquid AI LFM
 */
function captureEneyThumbSignal({
  signal = 'down',
  userPrompt = "why are my Mac's fan's running crazy?",
  eneyProposal = 'Quit Ollama now?',
  proposedAction = { skill: 'quit_app', target: 'Ollama', process: 'llama-server' },
  reason = 'Ollama llama-server (127.0.0.1:11434) is required by Screenpipe Ask; never kill it during swap cleanup.',
} = {}) {
  const cleanSignal = String(signal || '').toLowerCase();
  if (cleanSignal !== 'up' && cleanSignal !== 'down') {
    throw new Error(`Invalid Eney thumb signal: ${signal}`);
  }

  const targetNorm = normalizeProcessTarget(proposedAction.target || proposedAction.process);
  const ruleId = `gate:eney:thumb_down:${targetNorm || 'action'}`;

  const preventionRule = cleanSignal === 'down'
    ? {
        id: ruleId,
        layer: 'Execution',
        skill: proposedAction.skill || 'quit_app',
        protectedTargets: [
          normalizeProcessTarget(proposedAction.target),
          normalizeProcessTarget(proposedAction.process),
        ].filter(Boolean),
        action: 'block',
        message: `Blocked by Eney 👎 rule (${ruleId}): ${reason}`,
        createdAt: new Date().toISOString(),
      }
    : null;

  const dpoPair = cleanSignal === 'down'
    ? {
        prompt: userPrompt,
        rejected: `${eneyProposal} -> ${JSON.stringify(proposedAction)}`,
        chosen: `Preserve protected daemon (${proposedAction.target || 'Ollama'} / ${proposedAction.process || 'llama-server'}) and throttle runaway background git/index scans instead.`,
        reason,
      }
    : null;

  return {
    signal: cleanSignal,
    promotedToPreToolUseGate: cleanSignal === 'down',
    preventionRule,
    dpoPair,
  };
}

/**
 * Evaluate a proposed MacPaw Eney macOS skill/action at T=0 before execution.
 * Runs in <0.2ms on Apple Silicon CPU with zero network calls.
 */
function evaluateEneyActionGate({
  skill = 'quit_app',
  target = '',
  processName = '',
  userDelegationText = '',
  emailDomain = '',
  customRules = [],
  protectedDaemons = DEFAULT_PROTECTED_MAC_DAEMONS,
} = {}) {
  const startNs = process.hrtime.bigint();
  const cleanSkill = String(skill || '').trim().toLowerCase();
  const targetNorm = normalizeProcessTarget(target);
  const procNorm = normalizeProcessTarget(processName);
  const candidates = [targetNorm, procNorm].filter(Boolean);

  // 1. Blanket delegation ("do everything you need") NEVER overrides hard daemon protection
  const isBlanketDelegation = /\b(?:do everything you need|fix everything|clean everything|do whatever)\b/i.test(
    String(userDelegationText || ''),
  );

  // 2. Corporate ECI email isolation on Eney's "Summarize emails" skill
  if (FORBIDDEN_CORP_DOMAINS.test(String(emailDomain || '')) || FORBIDDEN_CORP_DOMAINS.test(String(target || ''))) {
    const latencyMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    return {
      decision: 'deny',
      allowed: false,
      gateId: 'gate:eney:eci_corporate_email_isolation',
      reason: 'Eney summarize_emails / mail skill must never access @ecisolutions.com or @ecinexus.com',
      blanketDelegationOverridden: isBlanketDelegation,
      latencyMs: Number(latencyMs.toFixed(4)),
    };
  }

  // 3. Check user-generated 👎 prevention rules first
  for (const rule of Array.isArray(customRules) ? customRules : []) {
    if (rule?.action !== 'block') continue;
    const ruleSkill = String(rule.skill || '').trim().toLowerCase();
    if (ruleSkill && ruleSkill !== cleanSkill) continue;
    const ruleTargets = Array.isArray(rule.protectedTargets) ? rule.protectedTargets : [];
    const targetMatched = ruleTargets.length === 0 || candidates.some((c) => ruleTargets.includes(c));
    if (targetMatched) {
      const latencyMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      return {
        decision: 'deny',
        allowed: false,
        gateId: rule.id || 'gate:eney:custom_thumb_down',
        reason: rule.message || `Target '${target || processName}' is blocked by user 👎 rule`,
        blanketDelegationOverridden: isBlanketDelegation,
        latencyMs: Number(latencyMs.toFixed(4)),
      };
    }
  }
  // 4. Hard Protected Mac Daemons (Ollama, llama-server, Screenpipe, Postgres, Orchestrad, FortiClient)
  if (['quit_app', 'kill_process', 'force_quit', 'stop_service'].includes(cleanSkill)) {
    const protectedSet = new Set(protectedDaemons.map(normalizeProcessTarget));
    const hit = candidates.find((c) => protectedSet.has(c));
    if (hit) {
      const latencyMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      return {
        decision: 'deny',
        allowed: false,
        gateId: `gate:eney:protected_mac_daemon:${hit}`,
        reason: `Refusing to quit protected local daemon '${hit}' (even under "${userDelegationText || 'direct ask'}"). Offer safe swap relief (prune orphan git status workers or clear inactive browser caches) instead.`,
        blanketDelegationOverridden: isBlanketDelegation,
        remediation: 'Renice runaway Xcode/git background processes or purge inactive caches without killing local AI inference.',
        latencyMs: Number(latencyMs.toFixed(4)),
      };
    }
  }

  const latencyMs = Number(process.hrtime.bigint() - startNs) / 1e6;
  const receiptHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ skill: cleanSkill, target: targetNorm, processName: procNorm }))
    .digest('hex');

  return {
    decision: 'allow',
    allowed: true,
    gateId: 'gate:eney:admissible_action',
    blanketDelegationOverridden: false,
    receiptHash,
    latencyMs: Number(latencyMs.toFixed(4)),
  };
}

if (require.main === module) {
  const thumbDown = captureEneyThumbSignal({
    signal: 'down',
    userPrompt: "why are my Mac's fan's running crazy?",
    eneyProposal: 'Quit Ollama now?',
    proposedAction: { skill: 'quit_app', target: 'Ollama', process: 'llama-server' },
  });
  const blockedUnderDoEverything = evaluateEneyActionGate({
    skill: 'quit_app',
    target: 'Ollama',
    processName: 'llama-server',
    userDelegationText: 'do everything you need',
    customRules: [thumbDown.preventionRule],
  });
  console.log(JSON.stringify({ ok: true, thumbDown, blockedUnderDoEverything }, null, 2));
}

module.exports = {
  DEFAULT_PROTECTED_MAC_DAEMONS,
  captureEneyThumbSignal,
  evaluateEneyActionGate,
  normalizeProcessTarget,
};
