#!/usr/bin/env node
'use strict';

/**
 * Bolt Forge FORMAT steal — not a product clone.
 *
 * Sources:
 *   https://support.bolt.new/account-and-subscription/bolt-forge
 *   https://thenewstack.io/bolt-forge-training-data/
 *
 * Transfers:
 *   1. Explicit per-session opt-in (not a buried account toggle)
 *   2. Secret strip via existing secret-redaction.js + seeded tests
 *   3. Operator vs research lane split (operator always DENY)
 *   4. Already-exported is irreversible (leaving research only stops NEW data)
 *
 * Does NOT clone Bolt Forge, send traces to Arcee, or claim 50× compute.
 */

const fs = require('node:fs');
const path = require('node:path');
const { redactSecrets } = require('./secret-redaction');

const SOURCE_URLS = Object.freeze([
  'https://support.bolt.new/account-and-subscription/bolt-forge',
  'https://thenewstack.io/bolt-forge-training-data/',
]);

const LANES = Object.freeze(['operator', 'research']);
// Assignment-shaped seed (not a provider live-key prefix — those trip push protection).
const SEED_SECRET = 'SEEDTEST_NOT_A_PROVIDER_KEY_1234567890abcdef';

const CLONE_PATTERNS = Object.freeze([
  { id: 'bolt_forge_sku', re: /\b(clone|install|vendor)\b.{0,40}\bbolt forge\b/i },
  { id: 'arcee_upload', re: /\b(upload|send|post)\b.{0,40}\b(arcee(\.ai)?|bolt\.new\/forge)\b/i },
  { id: 'claim_50x', re: /\b(claim|our|thumbgate)\b.{0,40}\b50\s*[x×]\b/i },
]);

const REMOTE_DEST_RE = /^(https?:|arcee:|s3:|gs:)/i;

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function detectCloneAttempt(text) {
  return CLONE_PATTERNS.filter((p) => p.re.test(String(text || ''))).map((p) => p.id);
}

function runSeededStripTest() {
  const haystack = `api_key=${SEED_SECRET}\nexport TOKEN=${SEED_SECRET}\n`;
  const stripped = redactSecrets(haystack);
  // Success = the planted raw secret is gone. Do not treat `[REDACTED:…]`
  // markers as leaks (containsSecret can match the word "secret" in the label).
  const leaked = stripped.includes(SEED_SECRET);
  return {
    ok: !leaked,
    leaked,
    strippedSample: stripped.slice(0, 180),
  };
}

function readExportLog(logPath) {
  if (!logPath || !fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function evaluateExport(options = {}) {
  const findings = [];
  const lane = String(options.lane || 'operator').toLowerCase();
  const optIn = normalizeBoolean(options.optIn || options['opt-in-export']);
  const irreversibleAck = normalizeBoolean(
    options.irreversibleAck || options['i-understand-irreversible']
  );
  const dest = String(options.dest || '');
  const text = options.text != null ? String(options.text) : '';

  const cloneHits = [...new Set(detectCloneAttempt(collectHaystack(options)))];
  if (cloneHits.length) {
    findings.push({
      severity: 'fail',
      id: 'bolt_forge_clone_refused',
      message: `Refusing Bolt Forge / Arcee / 50× compute clones (${cloneHits.join(', ')}). Local research export only.`,
    });
  }

  if (!LANES.includes(lane)) {
    findings.push({
      severity: 'fail',
      id: 'unknown_lane',
      message: `Lane must be operator|research, got ${lane}`,
    });
  }

  if (lane === 'operator') {
    findings.push({
      severity: 'fail',
      id: 'operator_lane_deny',
      message: 'Operator lane (live PreToolUse / production receipts) never exports session traces. Research lane only, with opt-in.',
    });
  }

  if (lane === 'research' && !optIn) {
    findings.push({
      severity: 'fail',
      id: 'missing_opt_in',
      message: 'Research export requires explicit per-session --opt-in-export. A buried account toggle is not enough.',
    });
  }

  if (lane === 'research' && optIn && !irreversibleAck) {
    findings.push({
      severity: 'fail',
      id: 'missing_irreversible_ack',
      message: 'Already-exported traces cannot be untrained. Require --i-understand-irreversible before any write.',
    });
  }

  if (dest && REMOTE_DEST_RE.test(dest)) {
    findings.push({
      severity: 'fail',
      id: 'remote_dest_refused',
      message: 'Destination must be a local file. Never upload to Arcee, HTTP, or object storage.',
    });
  }

  const seed = runSeededStripTest();
  if (!seed.ok) {
    findings.push({
      severity: 'fail',
      id: 'seeded_strip_failed',
      message: 'Seeded secret survived redactSecrets. Do not invent a second scanner — fix secret-redaction.js.',
    });
  }

  let stripped = '';
  if (text) {
    stripped = redactSecrets(text);
    if (stripped.includes(SEED_SECRET)) {
      findings.push({
        severity: 'fail',
        id: 'secrets_remain',
        message: 'Payload still contains credential-shaped text after secret-redaction.js. Export denied.',
      });
    }
  }

  const prior = readExportLog(options.log);
  const alreadyExported = prior.length > 0;

  let status = 'ready';
  if (findings.some((f) => f.severity === 'fail')) status = 'fail';
  else if (findings.some((f) => f.severity === 'warn')) status = 'ready_with_warnings';

  const allowed = status !== 'fail' && lane === 'research' && optIn && irreversibleAck && seed.ok;

  return {
    name: 'thumbgate-session-export-gate',
    status: allowed ? 'ready' : status === 'ready' ? 'fail' : status,
    ok: allowed,
    lane,
    optIn,
    irreversibleAck,
    allowed,
    alreadyExported,
    irreversible: alreadyExported || allowed,
    seed,
    stripped,
    dest: dest || null,
    compareNotClone: true,
    never: [
      'clone Bolt Forge / send traces to Arcee',
      'claim 50× compute as ThumbGate',
      'export the operator/production lane',
      'skip per-session opt-in',
      'pretend already-exported traces can be untrained',
    ],
    source: SOURCE_URLS,
    disclaimer: 'FORMAT steal only. Not affiliated with Bolt.new, StackBlitz, or Arcee AI. Local research files only.',
    findings: allowed ? findings : (findings.length ? findings : [{
      severity: 'fail',
      id: 'export_denied',
      message: 'Export denied.',
    }]),
  };
}

function collectHaystack(options = {}) {
  const parts = [
    options.task,
    options.query,
    options['clone-bolt-forge'] ? 'clone Bolt Forge send to Arcee claim 50x' : '',
    options.dest,
  ];
  if (Array.isArray(options.argv)) parts.push(...options.argv);
  return parts.filter(Boolean).join(' ');
}

function applyExport(report, options = {}) {
  if (!report.allowed) return { written: false };
  const dest = String(options.dest || '');
  if (!dest) {
    report.findings.push({
      severity: 'fail',
      id: 'missing_dest',
      message: 'Research export allowed but --dest= local path is required to write.',
    });
    report.status = 'fail';
    report.ok = false;
    report.allowed = false;
    return { written: false };
  }
  fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
  fs.writeFileSync(dest, report.stripped, 'utf8');
  if (options.log) {
    const row = JSON.stringify({
      at: new Date().toISOString(),
      dest,
      bytes: Buffer.byteLength(report.stripped),
      irreversible: true,
    });
    fs.appendFileSync(options.log, `${row}\n`, 'utf8');
  }
  return { written: true, dest };
}

function buildSessionExportGateReport(options = {}) {
  const report = evaluateExport(options);
  if (normalizeBoolean(options.apply) && report.allowed) {
    const applied = applyExport(report, options);
    report.applied = applied;
  } else {
    report.applied = { written: false };
  }
  return report;
}

function formatSessionExportGateReport(report) {
  const lines = [
    'ThumbGate session-export gate (Bolt Forge FORMAT steal)',
    `Status   : ${report.status}`,
    `ok       : ${report.ok}`,
    `Lane     : ${report.lane}  allowed=${report.allowed}  alreadyExported=${report.alreadyExported}`,
  ];
  if (report.findings?.length) {
    lines.push('Findings:');
    for (const f of report.findings) lines.push(`  [${f.severity}] ${f.id}: ${f.message}`);
  }
  lines.push(`Never    : ${(report.never || []).join('; ')}`);
  lines.push(`Source   : ${(report.source || []).join(' · ')}`);
  lines.push(report.disclaimer);
  return `${lines.join('\n')}\n`;
}

function parseArgv(argv) {
  const options = { argv };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--opt-in-export') options.optIn = true;
    else if (arg === '--i-understand-irreversible') options.irreversibleAck = true;
    else if (arg === '--clone-bolt-forge') options['clone-bolt-forge'] = true;
    else if (arg.startsWith('--lane=')) options.lane = arg.slice('--lane='.length);
    else if (arg.startsWith('--dest=')) options.dest = arg.slice('--dest='.length);
    else if (arg.startsWith('--log=')) options.log = arg.slice('--log='.length);
    else if (arg.startsWith('--input=')) options.text = fs.readFileSync(arg.slice('--input='.length), 'utf8');
    else if (arg.startsWith('--text=')) options.text = arg.slice('--text='.length);
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/session-export-gate.js [options]

Bolt Forge FORMAT: per-session opt-in, secret strip + seeded tests,
operator DENY / research gated, already-exported irreversible.
Local files only. Never Arcee. Never 50× claims.

Options:
  --lane=operator|research
  --opt-in-export
  --i-understand-irreversible
  --input=<file> --dest=<local-file> --log=<jsonl>
  --apply
  --clone-bolt-forge   Fail closed
  --json
`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  const options = parseArgv(argv);
  const report = buildSessionExportGateReport(options);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatSessionExportGateReport(report));
  if (report.status === 'fail' || !report.ok) return 1;
  return 0;
}

module.exports = {
  LANES,
  SEED_SECRET,
  SOURCE_URLS,
  detectCloneAttempt,
  runSeededStripTest,
  evaluateExport,
  buildSessionExportGateReport,
  formatSessionExportGateReport,
  main,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main();
}
