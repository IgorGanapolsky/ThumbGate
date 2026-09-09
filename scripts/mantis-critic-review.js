#!/usr/bin/env node
'use strict';

/**
 * Google Mantis FORMAT steal (InfoQ 2026-09-06): critic + reviewer +
 * rule-based negative filter on *existing* scanner/gate outputs. Do not
 * auto-FP low-risk findings. Parse the action (method + positional
 * endpoint), not a substring in field values. Ground promotion in
 * sandbox/test reproduction, not LLM judgment.
 *
 * Public source:
 *   https://www.infoq.com/news/2026/09/google-mantis-vulnerability-scan/
 *   https://github.com/google/mantis
 *   https://cloud.google.com/blog/products/identity-security/getting-started-with-the-mantis-harness
 *
 * Steal the FORMAT. Do not clone google/mantis, do not add a
 * vulnerability-scanner SKU, do not dual-edit config/gates/default.json,
 * do not ship untracked scripts/mantis-vulnerability-scanner.js theater.
 *
 * Complementary to scripts/security-scanner.js, scripts/gates-engine.js
 * (#3822 action-not-substring), and tests/actor-critic-process-audit.test.js.
 *
 * ECI: inventory/honesty doctor on pre-existing CodeQL/Socket/GitGuardian
 * + PreToolUse rails, not a net-new agent-governance or vuln-scan SKU.
 */

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 'thumbgate.mantis-critic-review.v1';
const DEFAULT_ROOT = path.join(__dirname, '..');

const SURFACES = Object.freeze({
  gatesEngine: 'scripts/gates-engine.js',
  securityScanner: 'scripts/security-scanner.js',
  issue3702: 'tests/issue-3702-action-not-substring.test.js',
  actorCritic: 'tests/actor-critic-process-audit.test.js',
  codeqlWorkflow: '.github/workflows/codeql.yml',
  sessionLease: 'scripts/session-lease.js',
  defaultGates: 'config/gates/default.json',
});

const WE_ARE_NOT = Object.freeze([
  'Google Mantis',
  'google/mantis clone',
  'vulnerability-scanner SKU',
  'LLM adjudicator for warn-level matches',
]);

const ALLOWED_SOURCES = new Set([
  'codeql',
  'socket',
  'gitguardian',
  'gate',
  'security-scanner',
]);

const LOW_RISK = new Set(['note', 'warning', 'low', 'info', 'style']);
const HIGH_RISK = new Set(['error', 'high', 'critical']);
const FLAGS_WITH_VALUE = new Set([
  '-x', '--method', '-f', '--field', '-F', '--raw-field',
  '-h', '--header', '--hostname', '--jq', '--input', '--cache',
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function commandWords(command) {
  return String(command || '').trim().split(/\s+/).filter(Boolean);
}

function ghApiHttpMethod(words) {
  const list = Array.isArray(words) ? words : [];
  for (let i = 0; i < list.length; i += 1) {
    const word = list[i];
    const lower = String(word).toLowerCase();
    if ((lower === '-x' || lower === '--method') && list[i + 1]) {
      return String(list[i + 1]).toLowerCase();
    }
    if (lower.startsWith('--method=')) return lower.slice('--method='.length);
    if (lower.startsWith('-x') && lower.length > 2 && !lower.startsWith('-x=')) {
      return lower.slice(2);
    }
  }
  return null;
}

function ghApiEndpoint(words) {
  const list = Array.isArray(words) ? words : [];
  const apiIndex = list.findIndex((word, i) => (
    String(word).toLowerCase() === 'api' && String(list[i - 1] || '').toLowerCase() === 'gh'
  ));
  if (apiIndex < 0) return null;
  for (let i = apiIndex + 1; i < list.length; i += 1) {
    const word = list[i];
    if (String(word).startsWith('-')) {
      if (String(word).includes('=')) continue;
      if (FLAGS_WITH_VALUE.has(word) || FLAGS_WITH_VALUE.has(String(word).toLowerCase())) i += 1;
      continue;
    }
    return word;
  }
  return null;
}

/**
 * Parse the gh api *action* from the positional path + method.
 * Field values (`-f title=/pulls/3702`) are not the endpoint.
 */
function parseGhApiAction(command) {
  const words = commandWords(command);
  const method = ghApiHttpMethod(words);
  const endpoint = ghApiEndpoint(words);
  if (!endpoint) {
    return { method, endpoint: null, isPrCreate: false, parsed: false };
  }
  const pathOnly = String(endpoint);
  const isExistingPull = /\/pulls\/\d+/.test(pathOnly);
  const isCollectionPulls = pathOnly === '/pulls' || /\/pulls$/.test(pathOnly);
  const isPost = !method || method === 'post';
  return {
    method: method || 'get',
    endpoint: pathOnly,
    isPrCreate: Boolean(isPost && isCollectionPulls && !isExistingPull),
    parsed: true,
  };
}

function findingSignature(finding) {
  return [
    normalized(finding.source),
    String(finding.ruleId || '').trim(),
    String(finding.file || '').trim(),
  ].join('|');
}

function isLowRisk(severity) {
  return LOW_RISK.has(normalized(severity));
}

function isHighRisk(severity) {
  return HIGH_RISK.has(normalized(severity));
}

function weAreNot() {
  return [...WE_ARE_NOT];
}

function evaluateFindings(input = {}) {
  const issues = [];
  const verdicts = [];
  const seen = new Set();
  const findings = input.findings;

  if (!Array.isArray(findings)) {
    issues.push('findings_inventory_unavailable');
  }
  if (input.bruteForceScan === true) issues.push('brute_force_scan');
  if (input.rawFileDump === true && asArray(input.summaries).length === 0) {
    issues.push('missing_hierarchical_summary');
  }
  if (input.matchBySubstring === true) issues.push('substring_not_action');
  if (input.autoFpLowRisk === true) issues.push('auto_fp_low_risk');
  if (input.modelSaidFalsePositive === true) issues.push('llm_judgment_not_grounding');
  if (input.modelSaidSafe === true) issues.push('model_cannot_grant_authority');
  if (input.promoteToRule === true) {
    const highUnreproduced = asArray(findings).some((row) => (
      isHighRisk(row && row.severity) && row.reproduced !== true && row.sandboxEvidence !== true
    ));
    if (highUnreproduced) issues.push('promote_without_reproduction');
  }

  for (const row of asArray(findings)) {
    const source = normalized(row.source);
    const ruleId = String(row.ruleId || '').trim();
    const file = String(row.file || '').trim();
    const findingIssues = [];

    if (!source || !ruleId || !file) findingIssues.push('missing_finding_context');
    if (source && !ALLOWED_SOURCES.has(source)) findingIssues.push('unknown_scanner_source');
    if (row.matchedOnFieldValue === true) findingIssues.push('substring_not_action');
    if (row.autoFp === true && isLowRisk(row.severity)) findingIssues.push('auto_fp_low_risk');

    if (row.command) {
      const action = parseGhApiAction(row.command);
      if (action.parsed && !action.isPrCreate && /\/pulls\//.test(String(row.command)) && row.matchedOnFieldValue === true) {
        findingIssues.push('substring_not_action');
      }
    }

    const signature = findingSignature(row);
    let verdict = 'needs_review';
    if (seen.has(signature) && source && ruleId && file) {
      verdict = 'duplicate';
    } else {
      seen.add(signature);
      if (isHighRisk(row.severity) && (row.reproduced === true || row.sandboxEvidence === true)) {
        verdict = 'confirmed';
      } else if (isLowRisk(row.severity)) {
        verdict = 'needs_review';
      } else if (isHighRisk(row.severity)) {
        verdict = 'needs_reproduction';
      }
    }

    if (verdict === 'needs_review' && isLowRisk(row.severity) && row.autoFp === true) {
      verdict = 'needs_review';
    }

    issues.push(...findingIssues);
    verdicts.push({
      signature,
      source: source || null,
      ruleId: ruleId || null,
      file: file || null,
      severity: row.severity || null,
      verdict,
      dropped: verdict === 'duplicate',
      autoFp: false,
    });
  }

  const uniqueIssues = [...new Set(issues)];
  const decision = uniqueIssues.length ? 'deny' : 'allow';
  const kept = verdicts.filter((row) => !row.dropped);
  return {
    schemaVersion: SCHEMA_VERSION,
    decision,
    issues: uniqueIssues,
    verdicts,
    keptCount: kept.length,
    duplicateCount: verdicts.filter((row) => row.verdict === 'duplicate').length,
    needsReviewCount: kept.filter((row) => row.verdict === 'needs_review').length,
    weAreNot: weAreNot(),
    claimBoundary: decision === 'deny'
      ? 'Critic/reviewer policy failed: auto-FP, substring match, brute-force scan, missing context, or LLM judgment used as grounding. Local ThumbGate doctor, not Google Mantis.'
      : 'Findings reviewed with a rule-based negative filter. Low-risk kept as needs_review. Not a live Mantis harness.',
  };
}

function item(id, status, detail) {
  return { id, status, detail };
}

function surfaceExists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function evaluateCheckout(input = {}) {
  const root = path.resolve(input.root || DEFAULT_ROOT);
  const claimLive = input.claimLive === true;
  const items = [];

  items.push(item(
    'existing_security_scanner',
    surfaceExists(root, SURFACES.securityScanner) ? 'pass' : 'fail',
    surfaceExists(root, SURFACES.securityScanner)
      ? 'Mapped to scripts/security-scanner.js. This doctor reviews outputs; it does not replace the scanner.'
      : 'security-scanner.js missing',
  ));

  items.push(item(
    'required_codeql_workflow',
    surfaceExists(root, SURFACES.codeqlWorkflow) ? 'pass' : 'fail',
    surfaceExists(root, SURFACES.codeqlWorkflow)
      ? 'Mapped to .github/workflows/codeql.yml (required check). Not a Mantis scan loop.'
      : 'codeql.yml missing',
  ));

  items.push(item(
    'action_not_substring',
    surfaceExists(root, SURFACES.issue3702) && surfaceExists(root, SURFACES.gatesEngine) ? 'pass' : 'fail',
    surfaceExists(root, SURFACES.issue3702)
      ? 'Mapped to #3822 tests/issue-3702-action-not-substring.test.js (parse positional gh api path).'
      : 'issue-3702 action-not-substring tests missing',
  ));

  items.push(item(
    'actor_critic_surface',
    surfaceExists(root, SURFACES.actorCritic) ? 'pass' : 'fail',
    surfaceExists(root, SURFACES.actorCritic)
      ? 'Mapped to tests/actor-critic-process-audit.test.js. Critic FORMAT already exists; do not dual-edit that gate JSON.'
      : 'actor-critic process audit tests missing',
  ));

  items.push(item(
    'shared_on_disk_stage',
    surfaceExists(root, SURFACES.sessionLease) ? 'pass' : 'fail',
    surfaceExists(root, SURFACES.sessionLease)
      ? 'Mapped to scripts/session-lease.js / session-actions as the local shared-stage analog.'
      : 'session-lease.js missing',
  ));

  items.push(item(
    'google_mantis_harness',
    'not_wired',
    'google/mantis agent skills (summarize/review/critic/dedupe/reproduce/patch) are not implemented.',
  ));
  items.push(item(
    'llm_adjudicator_sku',
    'not_wired',
    'LLM adjudication over lexical matches stays parked (#3690/#3687, ECI). Deterministic critic only.',
  ));
  items.push(item(
    'hierarchical_85pct_token_cut',
    'not_wired',
    'Mantis 85% token-cut claim is theirs. We only fail closed on raw dumps without summaries.',
  ));

  const liveBlockedReasons = [];
  if (claimLive) {
    liveBlockedReasons.push('claimLive_refused_without_mantis_runtime');
    for (const row of items.filter((entry) => entry.status === 'not_wired')) {
      liveBlockedReasons.push(`not_wired:${row.id}`);
    }
  }

  const fails = items.filter((row) => row.status === 'fail');
  let decision = 'allow';
  if (claimLive || fails.length > 0) decision = 'deny';

  return {
    schemaVersion: `${SCHEMA_VERSION}.checkout`,
    source: 'https://www.infoq.com/news/2026/09/google-mantis-vulnerability-scan/',
    affiliation: 'none',
    weAreNot: weAreNot(),
    root,
    decision,
    livePromotionAllowed: false,
    claimLive,
    liveBlockedReasons,
    items,
    claimBoundary: claimLive
      ? 'Refused: this doctor cannot become Google Mantis or a vulnerability-scanner product.'
      : 'Local critic/reviewer mapping onto CodeQL/Socket/GitGuardian + #3822 action parse. Simulated controls are not google/mantis.',
  };
}

function formatText(report) {
  if (report.issues) {
    return `mantis-critic-review  decision=${report.decision}  issues=${(report.issues || []).join(',')}\n${report.claimBoundary}\n`;
  }
  const lines = [
    `mantis-critic-review  decision=${report.decision}  live=${report.livePromotionAllowed}`,
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
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--claim-live') options.claimLive = true;
    else if (arg === '--root') options.root = argv[++i];
    else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
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
    verdicts: [],
    keptCount: 0,
    duplicateCount: 0,
    needsReviewCount: 0,
    weAreNot: weAreNot(),
    claimBoundary: 'Empty --decide payload is not a checkout. Fail closed.',
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let report;
  if (options.claimLive) {
    report = evaluateCheckout({ root: options.root, claimLive: true });
  } else if (options.decideRequested) {
    if (!String(options.decide || '').trim()) {
      report = missingDecideReport();
    } else {
      report = evaluateFindings(JSON.parse(options.decide));
    }
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
  parseGhApiAction,
  ghApiEndpoint,
  evaluateFindings,
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
