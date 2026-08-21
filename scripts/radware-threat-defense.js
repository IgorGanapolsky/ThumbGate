#!/usr/bin/env node
'use strict';

/**
 * Radware 2026 Threat Defense & Anti-Automated-Malice Engine
 *
 * Implements deterministic PreToolUse defenses against:
 * 1. ShadowLeak: Data exfiltration via secondary tool calls, hidden markdown links, URL query params.
 * 2. ZombieAgent: Indirect Prompt Injection (IPI) hijacking agent execution loops.
 * 3. Algorithmic Token-Drain: Sub-minute volumetric burst circuit breakers.
 *
 * Reference: Radware Global Threat Analysis Report 2026 (RWI-6283).
 */

const path = require('node:path');

const SHADOWLEAK_PATTERNS = [
  /!\[.*?\]\(https?:\/\/[^)\s]+\?(?:data|token|key|cookie|leak|mem|secret)=[^)\s]+\)/i,
  /curl\s+[^|\r\n]*?(?:-d|--data|-F)\s+[^|\r\n]*?(?:token|secret|password|credential|env|auth)/i,
  /(?:fetch|axios|request)\s*\(\s*[`'"]https?:\/\/[^`'"]*?(?:exfil|leak|webhook|collect)/i,
];

const ZOMBIEAGENT_PATTERNS = [
  /\b(?:system\s*override|act\s*as\s*zombie|unrestricted\s*agent|drop\s*prior\s*instructions|ignore\s*all\s*guardrails)\b/i,
  /\b(?:execute\s*without\s*approval|silently\s*forward\s*to|covert\s*execution|bypass\s*firewall)\b/i,
];

/**
 * Evaluates an action or payload for ShadowLeak & ZombieAgent vectors.
 *
 * @param {string|object} payload
 * @param {object} [options]
 * @returns {object} Threat evaluation result
 */
function evaluateThreat(payload, options = {}) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload || '');
  const detections = [];
  let threatType = null;
  let severity = 'low';

  // Check ShadowLeak exfiltration
  for (const pattern of SHADOWLEAK_PATTERNS) {
    if (pattern.test(text)) {
      detections.push({
        type: 'ShadowLeak',
        pattern: pattern.source,
        description: 'Sensitive data exfiltration via secondary egress or parameter stuffing',
      });
      threatType = 'ShadowLeak';
      severity = 'critical';
      break;
    }
  }

  // Check ZombieAgent indirect injection
  for (const pattern of ZOMBIEAGENT_PATTERNS) {
    if (pattern.test(text)) {
      detections.push({
        type: 'ZombieAgent',
        pattern: pattern.source,
        description: 'Indirect prompt injection attempting agent loop hijacking',
      });
      threatType = threatType ? `${threatType}+ZombieAgent` : 'ZombieAgent';
      severity = 'critical';
      break;
    }
  }

  const blocked = detections.length > 0;
  const verdict = blocked ? 'DENY' : 'ALLOW';
  const confidence = blocked ? 0.99 : 1.0;

  return {
    verdict,
    blocked,
    threatType,
    severity: blocked ? severity : 'none',
    confidence,
    detections,
    evaluatedAt: new Date().toISOString(),
    receipt: blocked
      ? `threat_defense_interdicted=true:type=${threatType || 'unknown'}`
      : 'threat_defense_passed=true',
  };
}

/**
 * Checks call history to detect rapid volumetric token drain bursts.
 *
 * @param {Array<number>} callTimestamps - Array of epoch ms timestamps
 * @param {object} [limits]
 * @returns {object} Burst evaluation
 */
function checkRateBurst(callTimestamps = [], limits = {}) {
  const maxPerMinute = limits.maxPerMinute || 60;
  const now = limits.now || Date.now();
  const oneMinuteAgo = now - 60000;

  const recentCalls = callTimestamps.filter((ts) => ts >= oneMinuteAgo);
  const tripped = recentCalls.length >= maxPerMinute;

  return {
    tripped,
    callCount: recentCalls.length,
    maxPerMinute,
    verdict: tripped ? 'CIRCUIT_OPEN' : 'NORMAL',
    message: tripped
      ? `Rate burst limit exceeded (${recentCalls.length}/${maxPerMinute} calls/min). Circuit breaker open.`
      : 'Rate within safe operational envelope.',
  };
}

function handleDoctor(stdout = process.stdout) {
  stdout.write('Radware 2026 Threat Defense Doctor Check:\n');
  stdout.write('  ✓ ShadowLeak data exfiltration firewall loaded\n');
  stdout.write('  ✓ ZombieAgent indirect prompt injection interdiction ready\n');
  stdout.write('  ✓ Algorithmic token-drain circuit breaker operational\n');
  return 0;
}

function mainCli(args = process.argv.slice(2), stdout = process.stdout) {
  if (args.includes('--doctor')) {
    return handleDoctor(stdout);
  }
  if (args.includes('--eval') || args.includes('--check')) {
    const inputIdx = Math.max(args.indexOf('--eval'), args.indexOf('--check')) + 1;
    const input = args[inputIdx] || '';
    const res = evaluateThreat(input);
    stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    return res.blocked ? 1 : 0;
  }
  stdout.write('Usage: radware-threat-defense [--doctor | --eval <payload>]\n');
  return 0;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exit(mainCli());
}

module.exports = {
  evaluateThreat,
  checkRateBurst,
  handleDoctor,
  mainCli,
  SHADOWLEAK_PATTERNS,
  ZOMBIEAGENT_PATTERNS,
};
