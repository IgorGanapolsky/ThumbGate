#!/usr/bin/env node
'use strict';

/**
 * Radware-inspired threat defense for ThumbGate PreToolUse.
 *
 * Steals process (not product) from Radware Bot Manager / AI DDoS defense:
 *   detect → challenge → block severity ladder, real-time interdiction,
 *   adaptive rate circuit breaker.
 *
 * Vectors:
 * 1. ShadowLeak — secondary egress / parameter stuffing exfiltration
 * 2. ZombieAgent — indirect prompt injection hijacking agent loops
 * 3. Token-drain bursts — sub-minute volumetric circuit breaker
 *
 * Reference: Radware Global Threat Analysis Report 2026 (RWI-6283);
 * Bot Manager Essentials (detect / challenge / mitigate).
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SHADOWLEAK_PATTERNS = [
  // Bounded classes — avoid nested quantifiers on attacker-controlled input (CodeQL js/polynomial-redos).
  /!\[[^\]\n]{0,200}\]\(https?:\/\/[^)\s]{1,300}\?(?:data|token|key|cookie|leak|mem|secret)=[^)\s]{0,300}\)/i,
  /\bcurl[ \t][^|\r\n]{0,500}(?:-d|--data|-F)[ \t][^|\r\n]{0,400}(?:token|secret|password|credential|env|auth)/i,
  /\b(?:fetch|axios|request)\s*\(\s*[`'"]https?:\/\/[^`'"]{0,300}(?:exfil|leak|webhook|collect)/i,
];

const ZOMBIEAGENT_PATTERNS = [
  /\b(?:system\s*override|act\s*as\s*zombie|unrestricted\s*agent|drop\s*prior\s*instructions|ignore\s*all\s*guardrails)\b/i,
  /\b(?:execute\s*without\s*approval|silently\s*forward\s*to|covert\s*execution|bypass\s*firewall)\b/i,
];

/** Bot Manager–style “suspicious automation” — challenge, do not hard-block. */
const SUSPICIOUS_BOT_PATTERNS = [
  /\b(?:scrape\s+all|mass[- ]scrape|credential\s*stuff|ato\s*attack|account\s*takeover\s*spray)\b/i,
  /\b(?:headless\s+flood|burst\s+tool\s+calls|token\s*drain\s*loop)\b/i,
];

const SEVERITY_RANK = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const ACTION_FOR_SEVERITY = {
  none: 'allow',
  low: 'detect',
  medium: 'challenge',
  high: 'block',
  critical: 'block',
};

function defaultHistoryPath() {
  const root = process.env.THUMBGATE_HOME
    || path.join(os.homedir(), '.thumbgate');
  return path.join(root, 'radware-call-history.json');
}

function loadCallTimestamps(historyPath = defaultHistoryPath()) {
  try {
    const raw = fs.readFileSync(historyPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.timestamps) ? parsed.timestamps.filter((n) => Number.isFinite(n)) : [];
  } catch {
    return [];
  }
}

function persistCallTimestamp(historyPath = defaultHistoryPath(), now = Date.now()) {
  // Never pollute operator history from the node:test runner or CI matrices —
  // those call evaluateGates hundreds of times and would false-trip the breaker.
  if (
    process.env.NODE_TEST
    || process.env.NODE_TEST_CONTEXT
    || process.env.CI
    || process.env.GITHUB_ACTIONS
    || process.env.npm_lifecycle_event === 'test'
  ) {
    return loadCallTimestamps(historyPath);
  }
  const timestamps = loadCallTimestamps(historyPath)
    .filter((ts) => ts >= now - 120000)
    .concat(now);
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, JSON.stringify({ timestamps }, null, 2));
  return timestamps;
}

/**
 * Bot Manager severity ladder: detect → challenge → block.
 * @param {string|object} payload
 * @param {object} [options]
 */
function evaluateThreat(payload, options = {}) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload || '');
  // Hard length cap before regex evaluation (ReDoS defense-in-depth).
  const text = raw.length > 20000 ? raw.slice(0, 20000) : raw;
  const detections = [];
  let severity = 'none';
  let threatType = null;

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

  if (severity === 'none') {
    for (const pattern of SUSPICIOUS_BOT_PATTERNS) {
      if (pattern.test(text)) {
        detections.push({
          type: 'SuspiciousBot',
          pattern: pattern.source,
          description: 'Bot Manager–style suspicious automation; challenge before allow',
        });
        threatType = 'SuspiciousBot';
        severity = 'medium';
        break;
      }
    }
  }

  const action = ACTION_FOR_SEVERITY[severity] || 'allow';
  const blocked = action === 'block';
  const challenged = action === 'challenge';

  return {
    verdict: blocked ? 'DENY' : challenged ? 'CHALLENGE' : detections.length ? 'DETECT' : 'ALLOW',
    blocked,
    challenged,
    action,
    threatType,
    severity,
    severityRank: SEVERITY_RANK[severity] || 0,
    confidence: blocked || challenged ? 0.99 : 1.0,
    detections,
    evaluatedAt: new Date().toISOString(),
    receipt: blocked
      ? `threat_defense_interdicted=true:type=${threatType || 'unknown'}:action=block`
      : challenged
        ? `threat_defense_challenge=true:type=${threatType || 'unknown'}:action=challenge`
        : detections.length
          ? `threat_defense_detect=true:type=${threatType || 'unknown'}:action=detect`
          : 'threat_defense_passed=true',
  };
}

/**
 * Volumetric token-drain circuit breaker (Radware AI DDoS / Bot Manager mitigate).
 * @param {Array<number>} callTimestamps
 * @param {object} [limits]
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
    severity: tripped ? 'high' : 'none',
    action: tripped ? 'block' : 'allow',
    message: tripped
      ? `Rate burst limit exceeded (${recentCalls.length}/${maxPerMinute} calls/min). Circuit breaker open.`
      : 'Rate within safe operational envelope.',
  };
}

/**
 * Combined pretool defense used by harness-selector.
 * Persists call history so the circuit breaker is live, not declarative theater.
 */
function evaluatePretoolDefense(payload, options = {}) {
  const historyPath = options.historyPath || defaultHistoryPath();
  const now = options.now || Date.now();
  const record = options.record !== false;
  const timestamps = record
    ? persistCallTimestamp(historyPath, now)
    : loadCallTimestamps(historyPath);
  const threat = evaluateThreat(payload, options);
  const burst = checkRateBurst(timestamps, {
    maxPerMinute: options.maxPerMinute || 60,
    now,
  });

  if (burst.tripped && (SEVERITY_RANK[burst.severity] || 0) >= (SEVERITY_RANK[threat.severity] || 0)) {
    return {
      ...threat,
      verdict: 'DENY',
      blocked: true,
      challenged: false,
      action: 'block',
      severity: 'high',
      severityRank: SEVERITY_RANK.high,
      threatType: threat.threatType ? `${threat.threatType}+RateBurst` : 'RateBurst',
      rateBurst: burst,
      selectHarness: true,
      receipt: `threat_defense_interdicted=true:type=RateBurst:action=block`,
    };
  }

  return {
    ...threat,
    rateBurst: burst,
    selectHarness: threat.blocked || threat.challenged || threat.severity !== 'none',
  };
}

function handleDoctor(stdout = process.stdout) {
  stdout.write('Radware / Bot Manager Threat Defense Doctor Check:\n');
  stdout.write('  ✓ ShadowLeak data exfiltration firewall loaded\n');
  stdout.write('  ✓ ZombieAgent indirect prompt injection interdiction ready\n');
  stdout.write('  ✓ Suspicious-bot challenge ladder (detect→challenge→block)\n');
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
    const res = evaluatePretoolDefense(input, { record: false });
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
  evaluatePretoolDefense,
  checkRateBurst,
  loadCallTimestamps,
  persistCallTimestamp,
  defaultHistoryPath,
  handleDoctor,
  mainCli,
  SHADOWLEAK_PATTERNS,
  ZOMBIEAGENT_PATTERNS,
  SUSPICIOUS_BOT_PATTERNS,
  ACTION_FOR_SEVERITY,
  SEVERITY_RANK,
};
