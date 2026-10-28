#!/usr/bin/env node
'use strict';

/**
 * Broadcast swarm statements of work.
 *
 * One normalized prompt is shared by every seat. The doctor derives three
 * statement ids, lets the fast proposer read first, and grants write.lease
 * only to the unique weighted winner. The judge seat does not write.
 *
 * Does not install a harness, call a judge, spend on a model, or open a network.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'Broadcast swarm SOW, Herdr plus Gemini and Antigravity, 2026-10-28';

const ROLES = Object.freeze([
  'fast_proposer',
  'deep_architect',
  'adversarial_verifier',
  'llm_judge',
]);

const HARNESSES = Object.freeze(['herdr', 'gemini', 'antigravity']);

const READ_SCOPES = Object.freeze(['scout', 'capsule', 'full']);

const ACTION_POINTS = Object.freeze([
  'sow.open',
  'seat.claim',
  'capsule.publish',
  'context.read',
  'judge.score',
  'write.lease',
]);

const WEIGHTS = Object.freeze({
  correctness: 40,
  tokenEfficiency: 25,
  speed: 20,
  minimalism: 15,
});

const AUDIT_CLASS = Object.freeze({
  'sow.open': 'admin',
  'seat.claim': 'user',
  'capsule.publish': 'user',
  'context.read': 'user',
  'judge.score': 'admin',
  'write.lease': 'admin',
});

const REFUSES = Object.freeze([
  'Install Herdr from this doctor',
  'Curl an installer',
  'Call an external judge API',
  'Let every seat write',
  'Spend on a second model',
]);

const RAIL_MAP = Object.freeze([
  {
    broadcast: 'The same prompt reaches every seat',
    thumbgate: 'sha256 of the normalized prompt is the shared id.',
  },
  {
    broadcast: 'Mixture of experts across Herdr, Gemini, and Antigravity',
    thumbgate: 'Four roles, three harnesses, one capsule from the fast proposer.',
  },
  {
    broadcast: 'An LLM judge picks the patch',
    thumbgate: 'Integer weights 40/25/20/15. The judge seat does not write.',
  },
  {
    broadcast: 'Stop a second full read of the repo',
    thumbgate: 'After the capsule exists, only a capsule read is allowed.',
  },
]);

function normalizePrompt(prompt) {
  return String(prompt || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function promptHash(prompt) {
  const normalized = normalizePrompt(prompt);
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function sowId(kind, hash) {
  if (!hash) return '';
  return `SOW-${crypto.createHash('sha256').update(`${kind}:${hash}`).digest('hex').slice(0, 8).toUpperCase()}`;
}

function sowFrom(prompt) {
  const hash = promptHash(prompt);
  return {
    promptHash: hash,
    broadcast: sowId('broadcast', hash),
    experts: sowId('experts', hash),
    judge: sowId('judge', hash),
    roles: ROLES,
    harnesses: HARNESSES,
    weights: WEIGHTS,
  };
}

function auditOf(point, decision, reason) {
  return {
    class: AUDIT_CLASS[point] || 'admin',
    exportable: true,
    trainingUse: false,
    point: point || '',
    decision,
    reason,
  };
}

function decide(point, reason, extra = {}) {
  const decision = reason ? 'deny' : 'allow';
  return {
    decision,
    reason: reason || '',
    winner: extra.winner || '',
    weighted: extra.weighted || {},
    audit: auditOf(point, decision, reason || ''),
  };
}

function sideEffectReason(action) {
  if (action.install === true) return 'no-install';
  if (action.fetch === true) return 'no-fetch';
  if (action.spend === true) return 'no-spend';
  if (action.allWrite === true) return 'one-writer';
  return '';
}

function weightsReason(policy) {
  if (!Object.prototype.hasOwnProperty.call(policy, 'weights')) return '';
  const weights = policy.weights;
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) return 'weights-are-fixed';
  const expected = Object.keys(WEIGHTS);
  const got = Object.keys(weights);
  if (got.length !== expected.length) return 'weights-are-fixed';
  for (const key of expected) {
    if (weights[key] !== WEIGHTS[key]) return 'weights-are-fixed';
  }
  return '';
}

function readSeats(policy) {
  if (!Object.prototype.hasOwnProperty.call(policy, 'seats') || policy.seats == null) {
    return { present: false, seats: [], roles: new Map() };
  }
  if (!Array.isArray(policy.seats)) return { present: true, reason: 'bad-seats', seats: [], roles: new Map() };
  const seats = [];
  const roles = new Map();
  const ids = new Set();
  for (const raw of policy.seats) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { present: true, reason: 'bad-seats', seats: [], roles: new Map() };
    }
    const id = String(raw.id || '').trim();
    const role = String(raw.role || '').trim();
    const harness = String(raw.harness || '').trim();
    if (!id) return { present: true, reason: 'missing-seat', seats: [], roles: new Map() };
    if (!ROLES.includes(role)) return { present: true, reason: 'unknown-role', seats: [], roles: new Map() };
    if (!HARNESSES.includes(harness)) return { present: true, reason: 'unknown-harness', seats: [], roles: new Map() };
    if (ids.has(id)) return { present: true, reason: 'duplicate-seat', seats: [], roles: new Map() };
    if (roles.has(role)) return { present: true, reason: 'duplicate-role', seats: [], roles: new Map() };
    ids.add(id);
    roles.set(role, id);
    seats.push({ id, role, harness });
  }
  return { present: true, seats, roles };
}

function rosterReason(roster) {
  if (roster.reason) return roster.reason;
  if (!roster.present) return 'missing-role';
  for (const role of ROLES) {
    if (!roster.roles.has(role)) return 'missing-role';
  }
  return '';
}

function findSeat(roster, action) {
  const id = String((action && action.seat) || '').trim();
  if (!id) return { reason: 'missing-seat' };
  if (roster.reason) return { reason: roster.reason };
  const seat = roster.seats.find((item) => item.id === id);
  if (!seat) return { reason: 'unknown-seat' };
  return { seat };
}

function scorePart(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) return null;
  return value;
}

function scoreBoard(policy, roster) {
  const candidates = policy.candidates;
  if (!Array.isArray(candidates)) return { reason: 'unscored', winner: '', weighted: {} };
  const writers = roster.seats.filter((seat) => seat.role !== 'llm_judge');
  const bySeat = new Map();
  for (const row of candidates) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { reason: 'bad-score', winner: '', weighted: {} };
    }
    const seat = String(row.seat || '').trim();
    if (!writers.some((item) => item.id === seat)) {
      return { reason: 'unknown-candidate', winner: '', weighted: {} };
    }
    if (bySeat.has(seat)) return { reason: 'duplicate-candidate', winner: '', weighted: {} };
    const correctness = scorePart(row.correctness);
    const tokenEfficiency = scorePart(row.tokenEfficiency);
    const speed = scorePart(row.speed);
    const minimalism = scorePart(row.minimalism);
    if (correctness == null || tokenEfficiency == null || speed == null || minimalism == null) {
      return { reason: 'bad-score', winner: '', weighted: {} };
    }
    const total = (correctness * WEIGHTS.correctness)
      + (tokenEfficiency * WEIGHTS.tokenEfficiency)
      + (speed * WEIGHTS.speed)
      + (minimalism * WEIGHTS.minimalism);
    bySeat.set(seat, total);
  }
  for (const seat of writers) {
    if (!bySeat.has(seat.id)) return { reason: 'unscored', winner: '', weighted: {} };
  }
  let best = -1;
  const winners = [];
  const weighted = {};
  for (const [seat, total] of bySeat) {
    weighted[seat] = total;
    if (total > best) {
      best = total;
      winners.length = 0;
      winners.push(seat);
    } else if (total === best) winners.push(seat);
  }
  if (winners.length !== 1) return { reason: 'tie', winner: '', weighted };
  return { reason: '', winner: winners[0], weighted };
}

function evaluateRead(policy, roster, action) {
  const found = findSeat(roster, action);
  if (found.reason) return found.reason;
  const scope = String(action.readScope || '').trim();
  if (!READ_SCOPES.includes(scope)) return 'unknown-scope';
  const capsule = policy.capsule === true;
  if (capsule && scope === 'full') return 'duplicate-read';
  if (capsule && scope !== 'capsule') return 'capsule-only';
  if (!capsule && scope === 'capsule') return 'missing-capsule';
  if (capsule) return '';
  if (found.seat.role !== 'fast_proposer') return 'wait-for-capsule';
  return '';
}

function evaluateBroadcastSwarmSow(policy, action) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return decide(action && action.point, 'missing-policy');
  if (!action || typeof action !== 'object' || Array.isArray(action)) return decide('', 'missing-action');
  const point = String(action.point || '');
  if (!ACTION_POINTS.includes(point)) return decide(point, 'unknown-action');
  const side = sideEffectReason(action);
  if (side) return decide(point, side);
  if (!normalizePrompt(policy.prompt)) return decide(point, 'missing-prompt');
  const weights = weightsReason(policy);
  if (weights) return decide(point, weights);
  const roster = readSeats(policy);

  if (point === 'sow.open') return decide(point, roster.reason || '');

  if (point === 'seat.claim') {
    const found = findSeat(roster, action);
    return decide(point, found.reason || '');
  }

  if (point === 'capsule.publish') {
    const found = findSeat(roster, action);
    if (found.reason) return decide(point, found.reason);
    if (found.seat.role !== 'fast_proposer') return decide(point, 'not-the-proposer');
    if (policy.capsule === true) return decide(point, 'capsule-exists');
    return decide(point, '');
  }

  if (point === 'context.read') return decide(point, evaluateRead(policy, roster, action));

  const rosterGap = rosterReason(roster);
  if (rosterGap) return decide(point, rosterGap);
  const board = scoreBoard(policy, roster);
  if (point === 'judge.score') return decide(point, board.reason, board);

  if (board.reason) return decide(point, board.reason, board);
  if (Object.prototype.hasOwnProperty.call(action, 'winner') && action.winner !== board.winner) {
    return decide(point, 'winner-mismatch', board);
  }
  const found = findSeat(roster, action);
  if (found.reason) return decide(point, found.reason, board);
  if (found.seat.role === 'llm_judge') return decide(point, 'judge-writes', board);
  if (found.seat.id !== board.winner) return decide(point, 'not-the-winner', board);
  return decide(point, '', board);
}

function negated(body, verb) {
  return new RegExp(`\\b(?:do not|don't|dont) ${verb}\\b`, 'i').test(body);
}

function triggeredRefusals(text) {
  const body = String(text || '');
  const hits = [];
  if (/\binstall herdr\b/i.test(body) && !negated(body, 'install')) hits.push(REFUSES[0]);
  if (/\bcurl\b/i.test(body) && /\binstaller\b/i.test(body) && !negated(body, 'curl')) hits.push(REFUSES[1]);
  if (/\bjudge api\b/i.test(body) && !negated(body, 'call') && !/\b(?:do not|don't|dont) use\b/i.test(body)) {
    hits.push(REFUSES[2]);
  }
  if (/\b(?:every|all) seats? writ/i.test(body) && !negated(body, 'let') && !/\b(?:do not|don't|dont) have\b/i.test(body)) {
    hits.push(REFUSES[3]);
  }
  if (/\bspend(?:ing)? on a second model\b/i.test(body) && !negated(body, 'spend')) hits.push(REFUSES[4]);
  return [...new Set(hits)];
}

function parseJson(value, label, findings) {
  if (value == null || value === '') return { present: false, value: null };
  try {
    return { present: true, value: JSON.parse(value) };
  } catch {
    findings.push({ gateId: 'broadcast-swarm-sow', severity: 'fail', message: `${label} is not JSON` });
    return { present: true, value: null };
  }
}

function readJsonFile(filePath, label, findings) {
  if (!filePath) return { present: false, value: null };
  try {
    return { present: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch {
    findings.push({
      gateId: 'broadcast-swarm-sow',
      severity: 'fail',
      message: `${label} is not readable JSON`,
    });
    return { present: true, value: null };
  }
}

function pickSide(direct, parsed, fromFile) {
  if (direct !== undefined) return { present: true, value: direct };
  if (parsed.present) return parsed;
  return fromFile;
}

function buildBroadcastSwarmSowReport(options = {}) {
  const mapOnly = options.mapOnly === true || options.mapOnly === 'true';
  const findings = [];
  const text = [options.claim, options.command, options.text].filter(Boolean).join('\n');
  if (!mapOnly && text) {
    for (const hit of triggeredRefusals(text)) {
      findings.push({ gateId: 'broadcast-swarm-sow', severity: 'fail', message: hit });
    }
  }

  let evaluation = null;
  let prompt = '';
  if (!mapOnly) {
    const policyPick = pickSide(
      options.policy,
      parseJson(options.policyJson, 'policy', findings),
      readJsonFile(options.policyPath, 'policy', findings),
    );
    const actionPick = pickSide(
      options.action,
      parseJson(options.actionJson, 'action', findings),
      readJsonFile(options.actionPath, 'action', findings),
    );
    if (policyPick.present || actionPick.present) {
      prompt = policyPick.value && policyPick.value.prompt;
      evaluation = evaluateBroadcastSwarmSow(policyPick.value, actionPick.value);
      if (evaluation.decision !== 'allow') {
        findings.push({
          gateId: 'broadcast-swarm-sow',
          severity: 'fail',
          message: evaluation.reason,
        });
      }
    }
  }

  const failCount = findings.filter((item) => item.severity === 'fail').length;
  return {
    name: 'thumbgate-broadcast-swarm-sow',
    doctor: 'broadcast-swarm-sow',
    ok: failCount === 0,
    status: failCount ? 'fail' : 'ready',
    source: SOURCE,
    refuses: REFUSES,
    actionPoints: ACTION_POINTS,
    sow: sowFrom(prompt),
    map: RAIL_MAP,
    evaluation,
    findings,
    summary: { findingCount: findings.length, failCount },
    exampleCommand: 'npx thumbgate broadcast-swarm-sow --json --map-only',
    disclaimer: 'Local contract for one broadcast prompt. Does not install a harness, call a judge, or open a network.',
  };
}

function formatBroadcastSwarmSowReport(report) {
  const lines = [
    'Broadcast swarm SOW',
    `Status : ${report.status}`,
    `Source : ${report.source}`,
    `Hash   : ${report.sow.promptHash}`,
    `Broadcast: ${report.sow.broadcast}`,
    `Experts  : ${report.sow.experts}`,
    `Judge    : ${report.sow.judge}`,
    `Findings: ${report.summary.findingCount} (fail=${report.summary.failCount})`,
    '',
    'Rail map:',
  ];
  for (const row of report.map) {
    lines.push(`- ${row.broadcast}`);
    lines.push(`  ThumbGate: ${row.thumbgate}`);
  }
  if (report.evaluation) {
    lines.push('', `Decision: ${report.evaluation.decision} ${report.evaluation.reason}`.trim());
    if (report.evaluation.winner) lines.push(`Winner: ${report.evaluation.winner}`);
  }
  for (const finding of report.findings) {
    lines.push(`- [${finding.severity}] ${finding.gateId}: ${finding.message}`);
  }
  lines.push('', report.disclaimer, '');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const [rawKey, inline] = arg.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inline !== undefined) args[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[key] = argv[index + 1];
      index += 1;
    } else args[key] = true;
  }
  const report = buildBroadcastSwarmSowReport({
    mapOnly: args.mapOnly === true,
    claim: args.claim || '',
    command: args.command || '',
    policyJson: args.policyJson || '',
    actionJson: args.actionJson || '',
    policyPath: args.policy || '',
    actionPath: args.action || '',
  });
  if (args.json === true) console.log(JSON.stringify(report, null, 2));
  else process.stdout.write(formatBroadcastSwarmSowReport(report));
  if (report.status === 'fail') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

module.exports = {
  ACTION_POINTS,
  HARNESSES,
  RAIL_MAP,
  REFUSES,
  ROLES,
  WEIGHTS,
  buildBroadcastSwarmSowReport,
  evaluateBroadcastSwarmSow,
  formatBroadcastSwarmSowReport,
  promptHash,
  sowId,
  triggeredRefusals,
};
