#!/usr/bin/env node
'use strict';

/**
 * Issue #3702 leftover: break-glass --gates is a *proposed* config diff,
 * never a live apply. Prints a unified patch of config/gates/default.json
 * with named gates set to warn. Does not write that file. Does not git
 * checkout. Does not open a PR. Does not pack.
 *
 * Complementary to scripts/gates-engine.js breakGlassEmergency (hook
 * settings + PR-create TTL). self-protect-config stays on.
 *
 * Do not ship untracked scripts/break-glass-gates.js theater (writes
 * default.json.tmp and moves it onto the live path).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 'thumbgate.break-glass-gates-propose.v1';
const DEFAULT_ROOT = path.join(__dirname, '..');
const GATES_REL = 'config/gates/default.json';

const SURFACES = Object.freeze({
  gatesEngine: 'scripts/gates-engine.js',
  defaultGates: GATES_REL,
  cli: 'bin/cli.js',
});

const WE_ARE_NOT = Object.freeze([
  'live default.json editor',
  'THUMBGATE_SELF_PROTECT_OVERRIDE rewrite',
  'untracked break-glass-gates.js theater',
]);

function weAreNot() {
  return [...WE_ARE_NOT];
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function unifiedDiff(relPath, before, after) {
  const a = String(before).split('\n');
  const b = String(after).split('\n');
  if (a.length && a[a.length - 1] === '') a.pop();
  if (b.length && b[b.length - 1] === '') b.pop();
  const lines = [
    `--- a/${relPath}`,
    `+++ b/${relPath}`,
    `@@ -1,${a.length} +1,${b.length} @@`,
  ];
  for (const row of a) lines.push(`-${row}`);
  for (const row of b) lines.push(`+${row}`);
  return `${lines.join('\n')}\n`;
}

function surfaceExists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function loadGatesJson(root) {
  const abs = path.join(root, GATES_REL);
  const raw = fs.readFileSync(abs, 'utf8');
  return { abs, raw, parsed: JSON.parse(raw) };
}

function proposeConfig(parsed, disableGateIds) {
  const ids = new Set(asArray(disableGateIds).map((row) => String(row || '').trim()).filter(Boolean));
  const next = JSON.parse(JSON.stringify(parsed));
  const gates = Array.isArray(next.gates) ? next.gates : [];
  const touched = [];
  for (const gate of gates) {
    const id = String(gate.id || '');
    if (!ids.has(id)) continue;
    gate.action = 'warn';
    gate.breakGlassProposed = true;
    touched.push(id);
  }
  next.breakGlassProposal = {
    status: 'PROPOSED',
    disableGateIds: [...ids],
    touchedGateIds: touched,
    liveApply: false,
  };
  return { next, touched };
}

function resolveWritePath(root, writePath) {
  if (!writePath) return null;
  const raw = String(writePath);
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
}

function evaluatePropose(input = {}) {
  const root = path.resolve(input.root || DEFAULT_ROOT);
  const reason = String(input.reason || '').trim();
  const disableGateIds = asArray(input.disableGateIds || input.gates);
  const apply = input.apply === true || input.liveApply === true;
  const writePath = resolveWritePath(root, input.writePath);
  const modelSaidSafe = input.modelSaidSafe === true;

  const issues = [];
  if (!reason) issues.push('missing_reason');
  if (disableGateIds.length === 0) issues.push('missing_gate_ids');
  if (apply) issues.push('live_apply_refused');
  if (modelSaidSafe) issues.push('model_cannot_grant_authority');

  const { abs, raw, parsed } = loadGatesJson(root);
  const beforeHash = sha256(raw);
  const livePath = path.resolve(abs);
  if (writePath && path.resolve(writePath) === livePath) {
    issues.push('live_apply_refused');
    issues.push('refused_write_default_json');
  }

  const { next, touched } = proposeConfig(parsed, disableGateIds);
  if (disableGateIds.length > 0 && touched.length === 0) issues.push('unknown_gate_ids');

  const proposedRaw = `${JSON.stringify(next, null, 2)}\n`;
  const patch = unifiedDiff(GATES_REL, raw.endsWith('\n') ? raw : `${raw}\n`, proposedRaw);

  const afterRaw = fs.readFileSync(abs, 'utf8');
  const afterHash = sha256(afterRaw);
  if (afterHash !== beforeHash) issues.push('default_json_mutated');

  const uniqueIssues = [...new Set(issues)];
  const decision = uniqueIssues.length ? 'deny' : 'allow';
  return {
    schemaVersion: SCHEMA_VERSION,
    decision,
    issues: uniqueIssues,
    reason: reason || null,
    disableGateIds,
    touchedGateIds: touched,
    patch,
    liveApply: false,
    defaultJsonPath: livePath,
    defaultJsonHashBefore: beforeHash,
    defaultJsonHashAfter: afterHash,
    defaultJsonTouched: afterHash !== beforeHash,
    weAreNot: weAreNot(),
    claimBoundary: decision === 'deny'
      ? 'Break-glass --gates refused: missing reason/ids, live apply, or default.json would be written. Local propose-only doctor.'
      : 'Proposed unified diff only. config/gates/default.json was not written. Not a live self-protect bypass.',
  };
}

function item(id, status, detail) {
  return { id, status, detail };
}

function evaluateCheckout(input = {}) {
  const root = path.resolve(input.root || DEFAULT_ROOT);
  const claimLive = input.claimLive === true;
  const items = [];

  items.push(item(
    'break_glass_emergency_surface',
    surfaceExists(root, SURFACES.gatesEngine) ? 'pass' : 'fail',
    surfaceExists(root, SURFACES.gatesEngine)
      ? 'Mapped to gates-engine breakGlassEmergency (hook settings + PR-create TTL). Does not cover self-protect-config writes.'
      : 'gates-engine.js missing',
  ));
  items.push(item(
    'default_gates_inventory',
    surfaceExists(root, SURFACES.defaultGates) ? 'pass' : 'fail',
    surfaceExists(root, SURFACES.defaultGates)
      ? 'config/gates/default.json exists. This doctor may read it and must not write it.'
      : 'default.json missing',
  ));
  items.push(item(
    'cli_break_glass',
    surfaceExists(root, SURFACES.cli) ? 'pass' : 'fail',
    surfaceExists(root, SURFACES.cli)
      ? 'bin/cli.js break-glass exists. --gates propose is this unique doctor, not a packed CLI rewrite.'
      : 'bin/cli.js missing',
  ));
  items.push(item(
    'live_default_json_apply',
    'not_wired',
    'Live apply / git checkout onto default.json is refused. Untracked break-glass-gates.js theater is not this doctor.',
  ));
  items.push(item(
    'self_protect_override',
    'not_wired',
    'THUMBGATE_SELF_PROTECT_OVERRIDE rewrite of default.json is not implemented here.',
  ));

  const liveBlockedReasons = [];
  if (claimLive) {
    liveBlockedReasons.push('claimLive_refused_without_live_gates_apply');
    for (const row of items.filter((entry) => entry.status === 'not_wired')) {
      liveBlockedReasons.push(`not_wired:${row.id}`);
    }
  }
  const fails = items.filter((row) => row.status === 'fail');
  let decision = 'allow';
  if (claimLive || fails.length > 0) decision = 'deny';
  return {
    schemaVersion: `${SCHEMA_VERSION}.checkout`,
    source: 'https://github.com/IgorGanapolsky/ThumbGate/issues/3702',
    affiliation: 'none',
    weAreNot: weAreNot(),
    root,
    decision,
    livePromotionAllowed: false,
    claimLive,
    liveBlockedReasons,
    items,
    claimBoundary: claimLive
      ? 'Refused: this doctor cannot live-apply gate config or bypass self-protect-config.'
      : 'Local propose-only mapping of break-glass --gates. Simulated patch is not a live default.json edit.',
  };
}

function formatText(report) {
  if (report.patch != null && report.issues) {
    const head = `break-glass-gates-propose  decision=${report.decision}  issues=${(report.issues || []).join(',')}  touched=${(report.touchedGateIds || []).join(',') || '-'}\n${report.claimBoundary}\n`;
    if (report.decision === 'allow' && report.patch) return `${head}${report.patch}`;
    return head;
  }
  const lines = [
    `break-glass-gates-propose  decision=${report.decision}  live=${report.livePromotionAllowed}`,
    `affiliation=${report.affiliation}  not: ${report.weAreNot.join(', ')}`,
  ];
  for (const row of report.items || []) {
    lines.push(`  [${row.status}] ${row.id} — ${row.detail}`);
  }
  lines.push(report.claimBoundary);
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    root: DEFAULT_ROOT,
    claimLive: false,
    decide: null,
    decideRequested: false,
    gates: false,
    apply: false,
    reason: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--claim-live') options.claimLive = true;
    else if (arg === '--gates') options.gates = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--root') options.root = argv[++i];
    else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
    else if (arg === '--reason') options.reason = argv[++i];
    else if (arg.startsWith('--reason=')) options.reason = arg.slice('--reason='.length);
    else if (arg === '--decide') {
      options.decideRequested = true;
      options.decide = argv[++i];
    } else if (arg.startsWith('--decide=')) {
      options.decideRequested = true;
      options.decide = arg.slice('--decide='.length);
    }
  }
  return options;
}

function missingDecideReport() {
  return {
    schemaVersion: SCHEMA_VERSION,
    decision: 'deny',
    issues: ['missing_decide_payload'],
    reason: null,
    disableGateIds: [],
    touchedGateIds: [],
    patch: '',
    liveApply: false,
    defaultJsonTouched: false,
    weAreNot: weAreNot(),
    claimBoundary: 'Empty --decide payload is not a checkout. Fail closed.',
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let report;
  if (options.claimLive) {
    report = evaluateCheckout({ root: options.root, claimLive: true });
  } else if (options.apply) {
    report = evaluatePropose({
      root: options.root,
      reason: options.reason || 'apply',
      disableGateIds: ['self-protect-config'],
      apply: true,
    });
  } else if (options.decideRequested) {
    if (!String(options.decide || '').trim()) {
      report = missingDecideReport();
    } else {
      const payload = JSON.parse(options.decide);
      if (options.reason) payload.reason = options.reason;
      if (options.gates && !payload.disableGateIds && !payload.gates) {
        payload.disableGateIds = payload.disableGateIds || [];
      }
      report = evaluatePropose({ root: options.root, ...payload });
    }
  } else if (options.gates && options.reason) {
    report = evaluatePropose({
      root: options.root,
      reason: options.reason,
      disableGateIds: [],
    });
  } else {
    report = evaluateCheckout({ root: options.root, claimLive: false });
  }
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatText(report));
  return report.decision === 'deny' ? 2 : 0;
}

module.exports = {
  SCHEMA_VERSION,
  SURFACES,
  GATES_REL,
  evaluatePropose,
  evaluateCheckout,
  formatText,
  main,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
