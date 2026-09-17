#!/usr/bin/env node
'use strict';

/**
 * Colab signup FORMAT steal — not a Colab clone, not a GPU SKU.
 *
 * Live source 2026-09-17 (BrowserOS, iganapolsky@gmail.com):
 *   https://colab.research.google.com/signup
 *   Pay As You Go $9.99/100 CU and $49.99/500 CU (buttons disabled on this account)
 *   Colab Pro $9.99/mo and Pro+ $49.99/mo still show Subscribe
 *   "See current plan" is Google AI Plans — not proof of Pro+
 *
 * Transfers:
 *   1. Free exists; paid buys Compute Units, not a dedicated GPU
 *   2. Subscribe-button visible ≠ already subscribed
 *   3. Background / 24h execution is a Pro+ receipt, not a default
 *
 * Does not buy Colab Pro/Pro+/PAYG. Does not install colab-cli.
 * ThumbGate evals stay on GitHub Actions.
 */

const path = require('node:path');

const SOURCE_URL = 'https://colab.research.google.com/signup';

const PLANS = Object.freeze({
  free: { monthlyUsd: 0, includedCu: 0, backgroundHours: 0 },
  payg: { monthlyUsd: 0, includedCu: 0, backgroundHours: 0, packs: [[9.99, 100], [49.99, 500]] },
  pro: { monthlyUsd: 9.99, includedCu: 100, backgroundHours: 0 },
  proplus: { monthlyUsd: 49.99, includedCu: 600, backgroundHours: 24 },
  enterprise: { monthlyUsd: null, includedCu: null, backgroundHours: null },
  unknown: { monthlyUsd: null, includedCu: null, backgroundHours: 0 },
});

const CLONE_RE = /\b(colab-cli|google-colab-pro-runner|ngrok.*colab|colab.*ssh|zero-cost a100|free a100)\b/i;
const PAID_FEATURE_RE = /\b(pro\+|proplus|a100|v100|background execution|24\s*hours?|high-?ram|premium gpu|compute units?)\b/i;
const BUY_RE = /\b(buy|subscribe|purchase).{0,40}(colab pro|pro\+|compute units?)\b/i;

const RAIL_MAP = Object.freeze([
  { colab: 'Free always exists; paid is extra CU', thumbgate: 'Do not claim hosted GPU/A100 as the product' },
  { colab: 'Subscribe button visible ≠ already subscribed', thumbgate: 'Require --plan-proof before Pro/Pro+ claims' },
  { colab: 'CU packs ($9.99/100, $49.99/500) expire; CU ≠ dedicated GPU', thumbgate: 'Hours remaining need hardware class + CU rate; else fail closed' },
  { colab: 'Background 24h is Pro+', thumbgate: 'GitHub Actions remains the eval runner; no Colab offload SKU' },
]);

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function parseSnapshot(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return { parseError: true };
  }
}

function normalizeOptions(raw = {}) {
  const plan = String(raw.plan || 'unknown').toLowerCase().replace('pro+', 'proplus');
  return {
    claim: String(raw.claim || ''),
    plan: Object.prototype.hasOwnProperty.call(PLANS, plan) ? plan : 'unknown',
    planProof: raw['plan-proof'] || raw.planProof || null,
    snapshot: parseSnapshot(raw.snapshot || raw['signup-snapshot']),
    cloneColab: normalizeBoolean(raw['clone-colab'] || raw.cloneColab),
    buyPro: normalizeBoolean(raw['buy-pro'] || raw.buyPro),
    mapOnly: normalizeBoolean(raw['map-only'] || raw.mapOnly),
    claimReady: normalizeBoolean(raw['claim-ready'] || raw.claimReady),
    json: normalizeBoolean(raw.json),
    strict: normalizeBoolean(raw.strict),
  };
}

function buildColabComputeHonestyReport(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const findings = [];
  const claim = options.claim;
  const snapshot = options.snapshot && !options.snapshot.parseError ? options.snapshot : null;

  if (options.snapshot && options.snapshot.parseError) {
    findings.push({
      id: 'snapshot_parse_error',
      severity: 'fail',
      gateId: 'require-compute-unit-proof',
      message: 'Signup snapshot JSON did not parse.',
    });
  }

  if (options.cloneColab || CLONE_RE.test(claim)) {
    findings.push({
      id: 'colab_sku_clone',
      severity: 'fail',
      gateId: 'refuse-colab-sku-clone',
      message: 'Refused Colab clone (colab-cli, ngrok/SSH, zero-cost A100, or a Colab-runner SKU).',
    });
  }

  if (options.buyPro || BUY_RE.test(claim)) {
    findings.push({
      id: 'colab_spend_refused',
      severity: 'fail',
      gateId: 'refuse-colab-sku-clone',
      message: 'Refused buying Colab Pro/Pro+/Compute Units from this doctor. No surprise spend.',
    });
  }

  const wantsPaid = PAID_FEATURE_RE.test(claim);
  const proof = options.planProof ? String(options.planProof).toLowerCase().replace('pro+', 'proplus') : null;
  if (wantsPaid && !options.mapOnly) {
    if (!proof || proof === 'unknown' || proof === 'free') {
      findings.push({
        id: 'paid_feature_without_plan_proof',
        severity: 'fail',
        gateId: 'require-compute-unit-proof',
        message: 'Paid Colab features (Pro/Pro+/A100/CU/24h background) need --plan-proof from a live Current-plan receipt, not a Subscribe button.',
      });
    }
  }

  if (snapshot && snapshot.proSubscribeVisible && (proof === 'pro' || proof === 'proplus' || /pro\+|proplus/i.test(claim))) {
    findings.push({
      id: 'subscribe_button_is_not_receipt',
      severity: 'fail',
      gateId: 'require-compute-unit-proof',
      message: 'Live signup still shows Subscribe on Pro/Pro+. That is not proof the account is subscribed.',
    });
  }

  if (/24\s*hour|background execution/i.test(claim) && proof !== 'proplus') {
    findings.push({
      id: 'background_requires_proplus',
      severity: 'fail',
      gateId: 'require-compute-unit-proof',
      message: '24h background execution is a Pro+ receipt on the signup page, not Free/Pro/PAYG.',
    });
  }

  if (options.claimReady && findings.some((f) => f.severity === 'fail')) {
    findings.push({
      id: 'claim_without_compute_proof',
      severity: 'fail',
      gateId: 'require-compute-unit-proof',
      message: 'Claimed Colab compute ready without plan proof.',
    });
  }

  const seen = new Set();
  const deduped = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    deduped.push(f);
  }

  const failCount = deduped.filter((f) => f.severity === 'fail').length;
  let status = 'ready';
  if (failCount > 0) status = 'fail';

  return {
    name: 'thumbgate-colab-compute-honesty',
    ok: status !== 'fail',
    status,
    source: SOURCE_URL,
    disclaimer:
      'FORMAT steal from Colab paid signup (CU packs, subscribe≠receipt, 24h background is Pro+). Not affiliated with Google Colab. Does not buy a plan or clone a notebook GPU SKU.',
    observed: {
      account: snapshot && snapshot.account,
      paygDisabled: snapshot ? Boolean(snapshot.paygDisabled) : null,
      proSubscribeVisible: snapshot ? Boolean(snapshot.proSubscribeVisible) : null,
      proPlusSubscribeVisible: snapshot ? Boolean(snapshot.proPlusSubscribeVisible) : null,
    },
    plans: PLANS,
    plan: options.plan,
    planProof: proof,
    map: options.mapOnly ? RAIL_MAP : undefined,
    findings: deduped,
    summary: { failCount, findingCount: deduped.length },
    recommendedGates: [...new Set(deduped.map((f) => f.gateId).filter(Boolean))],
    nextActions: [
      'Keep ThumbGate evals on GitHub Actions. Do not offload PreToolUse to Colab.',
      'Treat Subscribe on /signup as not-subscribed until a Current-plan receipt exists.',
      'Do not buy Pro/Pro+/CU from an agent session.',
      'Pair with gates require-compute-unit-proof and refuse-colab-sku-clone.',
    ],
    exampleCommand: 'npx thumbgate colab-compute-honesty --json --map-only',
  };
}

function formatColabComputeHonestyReport(report) {
  const lines = [
    '',
    'ThumbGate Colab Compute-Honesty Doctor',
    '-'.repeat(48),
    `Status : ${report.status}`,
    `Plan   : ${report.plan}  proof=${report.planProof || '(none)'}`,
    `Source : ${report.source}`,
    `Findings: ${report.summary.findingCount} (fail=${report.summary.failCount})`,
  ];
  if (report.map) {
    lines.push('', 'Rail map:');
    for (const row of report.map) lines.push(`  - ${row.colab} → ${row.thumbgate}`);
  }
  if (report.findings.length) {
    lines.push('', 'Findings:');
    for (const f of report.findings) {
      lines.push(`  - [${f.severity}] ${f.id}${f.gateId ? ` [${f.gateId}]` : ''}`);
      lines.push(`    ${f.message}`);
    }
  }
  lines.push('', 'Next actions:');
  for (const a of report.nextActions) lines.push(`  - ${a}`);
  lines.push('', `Example: ${report.exampleCommand}`);
  lines.push(`Note: ${report.disclaimer}`, '');
  return `${lines.join('\n')}\n`;
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--map-only') { options['map-only'] = true; continue; }
    if (arg === '--claim-ready') { options['claim-ready'] = true; continue; }
    if (arg === '--clone-colab') { options['clone-colab'] = true; continue; }
    if (arg === '--buy-pro') { options['buy-pro'] = true; continue; }
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    options[m[1]] = m[2] === undefined ? true : m[2];
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/colab-compute-honesty.js [flags]

Flags:
  --claim=TEXT             Claim to audit
  --plan=free|payg|pro|proplus|unknown
  --plan-proof=PLAN        Live Current-plan receipt (not a Subscribe button)
  --snapshot=JSON          Live /signup snapshot
  --map-only
  --claim-ready
  --clone-colab            Always fail
  --buy-pro                Always fail (no surprise spend)
  --json --strict

Source: ${SOURCE_URL}
`);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const report = buildColabComputeHonestyReport(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatColabComputeHonestyReport(report));
  if (args.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  SOURCE_URL,
  PLANS,
  RAIL_MAP,
  buildColabComputeHonestyReport,
  formatColabComputeHonestyReport,
  runCli,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exitCode = runCli();
}
