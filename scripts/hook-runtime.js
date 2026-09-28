'use strict';

const fs = require('fs');
const path = require('path');
const {
  isSourceCheckout,
  publishedCliAvailable,
} = require('./mcp-config');
const { publishedCliShellCommand } = require('./published-cli');
const { shimInstalled, shimPath } = require('./install-shim');

const PKG_ROOT = path.join(__dirname, '..');
const featureSupportCache = new Map();

function packageVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

function shellQuote(value) {
  return JSON.stringify(String(value));
}

function publishedHookCommandsAvailable(version) {
  if (!publishedCliAvailable(version)) {
    return false;
  }
  if (featureSupportCache.has(version)) {
    return featureSupportCache.get(version);
  }

  const available = true;
  featureSupportCache.set(version, available);
  return available;
}

function resolveCliCommand(subcommand) {
  // Source checkout: always use direct node command for development
  if (isSourceCheckout(PKG_ROOT)) {
    return `node ${shellQuote(path.join(PKG_ROOT, 'bin', 'cli.js'))} ${subcommand}`;
  }
  // Prefer stable shim — always resolves @latest, survives version bumps
  if (shimInstalled()) {
    return `${shellQuote(shimPath())} ${subcommand}`;
  }
  const version = packageVersion();
  if (publishedHookCommandsAvailable(version)) {
    return publishedCliShellCommand(version, [subcommand]);
  }
  return publishedCliShellCommand(version, [subcommand]);
}

function resolveCodexCliCommand(subcommand) {
  // Codex hooks live in user-global config. Pinning them to a disposable source
  // worktree breaks every hook as soon as normal post-merge cleanup removes it.
  // The stable @latest launcher stays offline at configuration time and survives
  // cleanup. Checkout-pinned hooks remain available as an explicit dev override.
  if (isSourceCheckout(PKG_ROOT) && process.env.THUMBGATE_CODEX_USE_SOURCE_RUNTIME === '1') {
    return `node ${shellQuote(path.join(PKG_ROOT, 'bin', 'cli.js'))} ${subcommand}`;
  }
  if (isSourceCheckout(PKG_ROOT)) {
    return publishedCliShellCommand('latest', [subcommand]);
  }
  const version = packageVersion();
  if (publishedHookCommandsAvailable(version)) {
    return publishedCliShellCommand('latest', [subcommand]);
  }
  return publishedCliShellCommand('latest', [subcommand]);
}

function buildPortableHookCommand(subcommand) {
  return resolveCliCommand(subcommand);
}

function buildCodexPortableHookCommand(subcommand) {
  return resolveCodexCliCommand(subcommand);
}

function preToolHookCommand() {
  return buildPortableHookCommand('gate-check');
}

function userPromptHookCommand() {
  return buildPortableHookCommand('hook-auto-capture');
}

function sessionStartHookCommand() {
  return buildPortableHookCommand('session-start');
}

function cacheUpdateHookCommand() {
  return buildPortableHookCommand('cache-update');
}

function claimStopHookCommand() {
  return buildPortableHookCommand('claim-stop-check');
}

function statuslineCommand() {
  return buildPortableHookCommand('statusline-render');
}

function codexPreToolHookCommand() {
  return buildCodexPortableHookCommand('gate-check');
}

function codexUserPromptHookCommand() {
  return buildCodexPortableHookCommand('hook-auto-capture');
}

function codexSessionStartHookCommand() {
  return buildCodexPortableHookCommand('session-start');
}

function codexCacheUpdateHookCommand() {
  return buildCodexPortableHookCommand('cache-update');
}

function codexStatuslineCommand() {
  return buildCodexPortableHookCommand('statusline-render');
}

// FORMAT steal, not a product clone:
//   Felony Bench — a count needs a timestamp and a source, and a sandbox
//     escape alone is not an incident. Only a third-party effect counts.
//   HALO (https://inference.net/products/halo/) — read local JSONL traces,
//     rank failure modes, cite the row, name one harness fix, re-run.
//     Do not pip install halo-engine or export OTLP to inference.net.
//   Qoder — keep a review point before raising autonomy.
// Does not install Felony Bench, inference.net HALO, or Qoder.
const THIRD_PARTY_EFFECT_GATES = Object.freeze([
  'secret-exfiltration',
  'local-only-remote-side-effect',
]);

function parseGateId(reason) {
  const match = /\[GATE:([a-z0-9][a-z0-9-]*)\]/i.exec(String(reason || ''));
  return match ? match[1].toLowerCase() : null;
}

function isThirdPartyEffect(gateId) {
  return THIRD_PARTY_EFFECT_GATES.includes(String(gateId || '').toLowerCase());
}

function decideCursorHookAction(input = {}) {
  const parsed = parseGateId(input.reason);
  const gateId = String(input.gateId || parsed || '').toLowerCase() || null;
  const blockMode = input.mode === 'block';
  const thirdParty = isThirdPartyEffect(gateId);
  if (!gateId) {
    return {
      action: 'allow',
      gateId: null,
      effectClass: 'none',
      incident: false,
      reason: 'no gate id',
    };
  }
  if (thirdParty) {
    return {
      action: 'deny',
      gateId,
      effectClass: 'third-party',
      incident: true,
      reason: 'third-party effect denies while internal gates stay in warn',
    };
  }
  if (blockMode) {
    return {
      action: 'deny',
      gateId,
      effectClass: 'internal',
      incident: false,
      reason: 'block mode denies every matched gate',
    };
  }
  return {
    action: 'warn',
    gateId,
    effectClass: 'internal',
    incident: false,
    reason: 'internal policy stays warn-only',
  };
}

function citeAuditRow(event, gateId) {
  return {
    gateId,
    timestamp: event.timestamp,
    source: event.source,
    recordedGateId: event.gateId ? String(event.gateId).toLowerCase() : null,
  };
}

function resolvedAuditGateId(event) {
  if (event.gateId && event.gateId !== 'hard-floor' && event.gateId !== 'custom-gate') {
    return String(event.gateId).toLowerCase();
  }
  return parseGateId(event.reason);
}

function rankHarnessIncidents({ stats, audit } = {}) {
  const byGate = stats && stats.byGate && typeof stats.byGate === 'object' ? stats.byGate : {};
  const ranked = Object.entries(byGate).map(([gateId, counts]) => ({
    gateId,
    blocked: Number(counts && counts.blocked) || 0,
    warned: Number(counts && counts.warned) || 0,
    effectClass: isThirdPartyEffect(gateId) ? 'third-party' : 'internal',
  })).sort((a, b) => (b.blocked + b.warned) - (a.blocked + a.warned) || a.gateId.localeCompare(b.gateId));

  const evidenced = (Array.isArray(audit) ? audit : []).filter((event) => event && event.timestamp && event.source);
  const incidents = [];
  const missed = [];
  const aliases = [];
  const bySessionGate = new Map();

  for (const event of evidenced) {
    const gateId = resolvedAuditGateId(event);
    const recorded = event.gateId ? String(event.gateId).toLowerCase() : null;
    const parsed = parseGateId(event.reason);
    if (parsed && recorded && recorded !== parsed && (recorded === 'hard-floor' || recorded === 'custom-gate')) {
      aliases.push({ ...citeAuditRow(event, parsed), recordedGateId: recorded });
    }
    if (gateId) {
      const sessionKey = `${event.sessionId || event.source}|${gateId}`;
      const bucket = bySessionGate.get(sessionKey) || [];
      bucket.push(citeAuditRow(event, gateId));
      bySessionGate.set(sessionKey, bucket);
    }
    if (!isThirdPartyEffect(gateId)) continue;
    const shadowAllowed = event.mode === 'warn'
      && (event.shadowDecision === 'block' || event.decision === 'warn');
    const row = citeAuditRow(event, gateId);
    if (shadowAllowed) missed.push(row);
    else if (event.decision === 'deny' || event.mode === 'block') incidents.push(row);
  }

  const rework = [];
  for (const rows of bySessionGate.values()) {
    if (rows.length >= 2) rework.push({ gateId: rows[0].gateId, citations: rows });
  }

  const findings = [];
  if (missed.length > 0) {
    findings.push({
      id: 'third-party-shadow',
      severity: 'fail',
      citations: missed,
      fix: `Deny ${missed[0].gateId} in the Cursor hook. Warn mode let it through at ${missed[0].timestamp}.`,
    });
  }
  if (aliases.length > 0) {
    findings.push({
      id: 'telemetry-alias',
      severity: 'warn',
      citations: aliases,
      fix: `Record ${aliases[0].gateId} on the audit row. ${aliases[0].timestamp} stored ${aliases[0].recordedGateId} while the reason names ${aliases[0].gateId}.`,
    });
  }
  if (rework.length > 0) {
    findings.push({
      id: 'rework-loop',
      severity: 'warn',
      citations: rework[0].citations,
      fix: `Same gate ${rework[0].gateId} fired ${rework[0].citations.length} times in one session. One decision should end the retry.`,
    });
  }

  const topInternal = ranked
    .filter((row) => row.effectClass === 'internal')
    .sort((a, b) => b.blocked - a.blocked)[0] || null;
  const thirdPartyBlocked = ranked
    .filter((row) => row.effectClass === 'third-party')
    .reduce((sum, row) => sum + row.blocked, 0);

  let nextFix;
  if (findings.length > 0) {
    nextFix = findings[0].fix;
  } else if (topInternal) {
    nextFix = `Leave ${topInternal.gateId} (${topInternal.blocked} blocks) in warn. Deny only secret-exfiltration and local-only-remote-side-effect (${thirdPartyBlocked} historical blocks).`;
  } else {
    nextFix = 'No gate counters to rank.';
  }

  return {
    ok: missed.length === 0,
    loop: [
      'collect ~/.thumbgate/audit-trail.jsonl',
      'rank failure modes in code',
      'cite timestamp and source on the top finding',
      'apply that one harness fix',
      're-run gate-stats --rank',
    ],
    refuses: [
      'pip install halo-engine',
      'OTLP export to inference.net',
      'felonybench.com clone',
      'Qoder install',
    ],
    reviewPoint: 'Internal policy stays warn until a person reviews it. Third-party effect denies on the hook.',
    ranked,
    findings,
    incidents,
    missed,
    nextFix,
  };
}

module.exports = {
  buildPortableHookCommand,
  buildCodexPortableHookCommand,
  cacheUpdateHookCommand,
  claimStopHookCommand,
  codexCacheUpdateHookCommand,
  codexPreToolHookCommand,
  codexSessionStartHookCommand,
  codexStatuslineCommand,
  codexUserPromptHookCommand,
  packageVersion,
  publishedHookCommandsAvailable,
  decideCursorHookAction,
  isThirdPartyEffect,
  parseGateId,
  preToolHookCommand,
  rankHarnessIncidents,
  resolveCodexCliCommand,
  resolveCliCommand,
  sessionStartHookCommand,
  statuslineCommand,
  userPromptHookCommand,
};
