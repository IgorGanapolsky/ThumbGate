#!/usr/bin/env node
'use strict';

/**
 * Allowlist-bridge honesty doctor (GitLab AI-sandbox FORMAT steal).
 *
 * Source: https://www.infoq.com/news/2026/09/gitlab-ai-sandbox-access/
 * Upstream analysis: https://about.gitlab.com/blog/ai-agent-sandbox/
 *
 * Transfers (FORMAT, not a GitLab Duo sandbox clone):
 *   1. Network allowlists are hops, not trust boundaries. Package registries,
 *      proxies, and Hugging Face hosts remain attack surface even when permitted.
 *   2. Trust handoff: writes consumed by privileged out-of-sandbox processes
 *      (hooks, CI, MCP, git config) are not "contained" by the sandbox.
 *   3. Observe→allowlist must not auto-promote bridge hosts into trusted allowHosts.
 *
 * Does NOT clone GitLab Duo Agent Platform, does not add a sandbox SKU, and
 * does not treat an allowlisted registry as a safe place to send credentials.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URL = 'https://www.infoq.com/news/2026/09/gitlab-ai-sandbox-access/';

const {
  classifyHostRole,
  requestCarriesSecrets,
  draftPolicyFromObservations,
  evaluateEgressStaticOnly,
  BRIDGE_HOST_SUFFIXES,
} = require('./agent-egress-policy');

const HANDOFF_PATH_PATTERNS = [
  /^\.github\/workflows\//i,
  /^\.githooks\//i,
  /^\.git\/hooks\//i,
  /^\.git\/config$/i,
  /^\.mcp\.json$/i,
  /^config\/mcp-allowlists\.json$/i,
  /^config\/gates\//i,
  /^hooks\/hooks\.json$/i,
  /^\.claude\/settings\.json$/i,
];

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function normalizeHost(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0];
}

function classifyTrustHandoffPath(filePath) {
  const rel = String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const hit = HANDOFF_PATH_PATTERNS.some((re) => re.test(rel));
  return {
    path: rel,
    handoff: hit,
    contained: false,
    reason: hit
      ? 'Write is consumed by a privileged process outside the agent sandbox (CSA trust-handoff).'
      : 'Path is not a known privileged consumer.',
  };
}

function extractHostsFromGatePattern(pattern) {
  const text = String(pattern || '');
  const found = new Set();
  for (const host of BRIDGE_HOST_SUFFIXES) {
    if (text.includes(host) || text.includes(host.replace(/\./g, '\\.'))) {
      found.add(host);
    }
  }
  const extra = [
    'github.com',
    'api.github.com',
    'api.anthropic.com',
    'thumbgate.ai',
    'thumbgate-production.up.railway.app',
    'localhost',
    '127.0.0.1',
  ];
  for (const host of extra) {
    if (text.includes(host) || text.includes(host.replace(/\./g, '\\.'))) {
      found.add(host);
    }
  }
  return [...found];
}

function loadDenyNetworkEgressGate(rootDir) {
  const gatePath = path.join(rootDir, 'config', 'gates', 'default.json');
  if (!fs.existsSync(gatePath)) return { path: gatePath, hosts: [], present: false };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  } catch {
    return { path: gatePath, hosts: [], present: false, parseError: true };
  }
  const gates = parsed.gates || parsed.rules || [];
  const gate = gates.find((g) => g && g.id === 'deny-network-egress');
  if (!gate) return { path: gatePath, hosts: [], present: false };
  return {
    path: gatePath,
    present: true,
    hosts: extractHostsFromGatePattern(gate.pattern),
    action: gate.action || null,
  };
}

function auditAllowlist(allowHosts = [], options = {}) {
  const findings = [];
  const classified = [];
  const treatAsTrust = normalizeBoolean(options.treatAllowlistAsTrustBoundary);
  const trustedClaim = normalizeBoolean(options.trusted);

  for (const raw of allowHosts) {
    const host = normalizeHost(raw);
    if (!host) continue;
    const role = classifyHostRole(host);
    classified.push(role);
    if (role.role === 'bridge' && (treatAsTrust || trustedClaim || role.trusted === true)) {
      findings.push({
        id: 'allowlist_treated_as_trust_boundary',
        severity: 'high',
        host,
        role: role.role,
        message: `Allowlisted bridge host '${host}' is being treated as a trust boundary. GitLab's package-proxy escape shows the hop is still attack surface.`,
      });
    }
  }
  return { classified, findings };
}

function auditDraftPromotion(observations = [], options = {}) {
  const drafted = draftPolicyFromObservations(observations, options);
  const findings = [];
  for (const host of drafted.allowHosts || []) {
    const role = classifyHostRole(host);
    if (role.role === 'bridge') {
      findings.push({
        id: 'observe_promoted_bridge_host',
        severity: 'high',
        host,
        message: `Observe-mode traffic to bridge host '${host}' was promoted onto allowHosts. That is the GitLab allowlist-as-bridge failure.`,
      });
    }
  }
  return { drafted, findings };
}

function auditCredentialedBridge(request = {}, policy = {}) {
  const verdict = evaluateEgressStaticOnly(request, policy);
  const host = (verdict.target && verdict.target.host) || normalizeHost(request.url || request.host);
  const role = classifyHostRole(host);
  const findings = [];
  if (role.role === 'bridge' && requestCarriesSecrets(request) && verdict.action === 'allow') {
    findings.push({
      id: 'bridge_host_accepted_credentials',
      severity: 'high',
      host,
      message: `Credentialed request to bridge host '${host}' was allowed. Independent auth is required; allowlist is not enough.`,
    });
  }
  return { verdict, findings };
}

function auditTrustHandoff(writes = [], options = {}) {
  const findings = [];
  const classified = [];
  const claimedContained = normalizeBoolean(options.claimedContained);
  for (const filePath of writes) {
    const row = classifyTrustHandoffPath(filePath);
    classified.push(row);
    if (row.handoff && claimedContained) {
      findings.push({
        id: 'trust_handoff_claimed_contained',
        severity: 'high',
        path: row.path,
        message: `Write to '${row.path}' is a trust handoff. The agent stayed in-sandbox; a privileged consumer outside will execute with higher privilege.`,
      });
    }
  }
  return { classified, findings };
}

function normalizeOptions(raw = {}) {
  const allowHosts = [];
  const rawHosts = raw.allowHosts || raw['allow-hosts'] || raw.hosts || [];
  const hostList = Array.isArray(rawHosts) ? rawHosts : String(rawHosts || '').split(',');
  for (const host of hostList) allowHosts.push(host);
  if (raw.host) allowHosts.push(String(raw.host));

  const writes = [];
  const rawWrites = raw.writes || raw.write || raw['writes'] || [];
  const writeList = Array.isArray(rawWrites) ? rawWrites : String(rawWrites || '').split(',');
  for (const filePath of writeList) writes.push(filePath);

  const observations = Array.isArray(raw.observations) ? raw.observations : [];

  return {
    root: raw.root ? path.resolve(String(raw.root)) : process.cwd(),
    json: normalizeBoolean(raw.json),
    strict: normalizeBoolean(raw.strict),
    treatAllowlistAsTrustBoundary: normalizeBoolean(
      raw.treatAllowlistAsTrustBoundary || raw['treat-allowlist-as-trust']
    ),
    trusted: normalizeBoolean(raw.trusted),
    claimedContained: normalizeBoolean(raw.claimedContained || raw['claimed-contained']),
    cloneGitLabDuo: normalizeBoolean(
      raw.cloneGitLabDuo || raw['clone-gitlab-duo'] || raw.sandboxSku || raw['sandbox-sku']
    ),
    allowHosts: allowHosts.map(normalizeHost).filter(Boolean),
    writes,
    observations,
    evaluateUrl: raw.evaluateUrl || raw['evaluate-url'] || raw.url || null,
    authorization: raw.authorization || raw.Authorization || null,
    independentAuth: normalizeBoolean(raw.independentAuth || raw['independent-auth']),
  };
}

function buildAllowlistBridgeHonestyReport(raw = {}) {
  const options = normalizeOptions(raw);
  const findings = [];
  const nextActions = [];

  if (options.cloneGitLabDuo) {
    findings.push({
      id: 'refuse_sku_clone',
      severity: 'high',
      message: 'Refuse GitLab Duo / execution-sandbox SKU clone. Steal allowlist-as-bridge + trust-handoff honesty onto existing egress/PreToolUse rails.',
    });
  }

  const gate = loadDenyNetworkEgressGate(options.root);
  const gateHosts = gate.present ? gate.hosts : [];
  const combinedHosts = [...new Set([...options.allowHosts, ...gateHosts])];

  const allowAudit = auditAllowlist(combinedHosts, options);
  findings.push(...allowAudit.findings);

  const handoffAudit = auditTrustHandoff(options.writes, options);
  findings.push(...handoffAudit.findings);

  if (options.observations.length) {
    const draftAudit = auditDraftPromotion(options.observations, { agentId: 'doctor' });
    findings.push(...draftAudit.findings);
  }

  let evaluate = null;
  if (options.evaluateUrl) {
    const headers = {};
    if (options.authorization) headers.Authorization = String(options.authorization);
    evaluate = auditCredentialedBridge(
      {
        url: options.evaluateUrl,
        headers,
        independentAuth: options.independentAuth,
      },
      { allowHosts: combinedHosts }
    );
    findings.push(...evaluate.findings);
  }

  const bridgeHosts = allowAudit.classified.filter((row) => row.role === 'bridge');
  if (bridgeHosts.length && !findings.some((f) => f.severity === 'high')) {
    nextActions.push('Keep bridge hosts (registries/proxies/HF) on the hop list; never mark them trusted.');
    nextActions.push('Do not send Authorization / tokens to a package proxy just because it is allowlisted.');
  }
  if (handoffAudit.classified.some((row) => row.handoff)) {
    nextActions.push('Treat hook/CI/MCP writes as trust-handoff, not sandbox-contained execution.');
  }
  if (!nextActions.length) {
    nextActions.push('Allowlists remain hops. Pair with independent auth and least privilege.');
  }

  const high = findings.filter((f) => f.severity === 'high').length;
  let status = 'ready';
  if (high > 0) status = 'fail';
  else if (findings.length > 0) status = 'actionable';

  return {
    name: 'thumbgate-allowlist-bridge-honesty',
    source: SOURCE_URL,
    status,
    ok: status !== 'fail',
    allowlistIsTrustBoundary: false,
    clonedGitLabDuo: false,
    metrics: {
      allowHostCount: combinedHosts.length,
      bridgeHostCount: bridgeHosts.length,
      handoffWriteCount: handoffAudit.classified.filter((row) => row.handoff).length,
      findingCount: findings.length,
      highFindingCount: high,
      denyNetworkEgressGate: Boolean(gate.present),
    },
    classifiedHosts: allowAudit.classified,
    handoffWrites: handoffAudit.classified,
    evaluate: evaluate ? evaluate.verdict : null,
    findings,
    nextActions,
    exampleCommand: 'npx thumbgate allowlist-bridge-honesty --json',
    disclaimer: 'FORMAT steal of GitLab sandbox-network honesty. Not GitLab Duo, not a containment SKU.',
  };
}

function formatAllowlistBridgeHonestyReport(report) {
  const lines = [
    `Allowlist-bridge honesty: ${report.status}`,
    `Allowlist is trust boundary: ${report.allowlistIsTrustBoundary}`,
    `Bridge hosts: ${report.metrics.bridgeHostCount}/${report.metrics.allowHostCount}`,
    `Source   : ${report.source}`,
  ];
  if (report.findings.length) {
    lines.push('', 'Findings:');
    for (const f of report.findings) {
      lines.push(`  - [${f.severity}] ${f.id}`);
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
  const options = { allowHosts: [], writes: [] };
  for (const arg of argv) {
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    const key = m[1];
    const value = m[2] === undefined ? true : m[2];
    if (key === 'allow-hosts' || key === 'host') {
      String(value).split(',').forEach((h) => options.allowHosts.push(h));
      continue;
    }
    if (key === 'write' || key === 'writes') {
      String(value).split(',').forEach((w) => options.writes.push(w));
      continue;
    }
    options[key] = value;
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/allowlist-bridge-honesty.js [flags]

Flags:
  --root=DIR                 Repo root (default: cwd)
  --allow-hosts=h1,h2        Extra allowlisted hosts to classify
  --treat-allowlist-as-trust Fail closed if bridge hosts are treated as trusted
  --write=path               Privileged consumer path to classify as trust-handoff
  --claimed-contained        Fail if a handoff write is claimed sandbox-contained
  --evaluate-url=URL         Probe egress evaluation
  --authorization=VALUE      Fake credential header for the probe (never a live secret)
  --clone-gitlab-duo         Refuse SKU clone
  --strict                   Exit 1 on fail
  --json

Source: ${SOURCE_URL}
`);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const report = buildAllowlistBridgeHonestyReport(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatAllowlistBridgeHonestyReport(report));
  if (args.strict && report.status === 'fail') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  SOURCE_URL,
  HANDOFF_PATH_PATTERNS,
  classifyTrustHandoffPath,
  extractHostsFromGatePattern,
  loadDenyNetworkEgressGate,
  auditAllowlist,
  auditDraftPromotion,
  auditCredentialedBridge,
  auditTrustHandoff,
  buildAllowlistBridgeHonestyReport,
  formatAllowlistBridgeHonestyReport,
  normalizeOptions,
  parseCliArgs,
  runCli,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = runCli(process.argv.slice(2));
}
