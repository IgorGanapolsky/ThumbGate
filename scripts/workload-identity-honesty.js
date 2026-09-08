#!/usr/bin/env node
'use strict';

/**
 * Workload-identity honesty doctor (InfoQ 2026-09-08 FORMAT).
 *
 * GCP Workload Identity Federation: long-lived keys vs federated trust.
 * GitHub analog for this repo: workflows must not default a long-lived PAT
 * without a github.token fallback, and must not inject cloud SA JSON keys
 * when OIDC / workload_identity_provider is the honest path.
 *
 * Does NOT enable GCP WIF. Does not mint OIDC providers. Does not clone
 * Google Cloud IAM.
 *
 * Usage:
 *   node scripts/workload-identity-honesty.js --json
 *   node scripts/workload-identity-honesty.js --root=DIR --fail-pat-only --json
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const SOURCE = 'InfoQ 2026-09-08 Workload Identity Federation FORMAT (keys vs federated trust)';
const PAT_LINE = /secrets\.GH_PAT\b/;
const TOKEN_FALLBACK = /\|\|\s*github\.token/;
const CREDENTIALS_JSON = /\bcredentials_json\s*:/;
const GAC = /GOOGLE_APPLICATION_CREDENTIALS\s*:/;
const AWS_SECRET_LITERAL = /AWS_SECRET_ACCESS_KEY\s*:\s*['"]?(?!\$\{\{)[A-Za-z0-9\/+=]{8,}/;
const WIF = /\bworkload_identity_provider\s*:/;
const ID_TOKEN_WRITE = /id-token\s*:\s*write/;

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function normalizeOptions(options = {}) {
  return {
    root: path.resolve(String(options.root || options.cwd || process.cwd())),
    failPatOnly: normalizeBoolean(options.failPatOnly || options['fail-pat-only']),
    json: Boolean(options.json),
    strict: Boolean(options.strict),
    help: Boolean(options.help),
  };
}

function listWorkflowFiles(workflowsDir) {
  if (!fs.existsSync(workflowsDir)) return [];
  return fs.readdirSync(workflowsDir)
    .filter((name) => /\.ya?ml$/i.test(name))
    .map((name) => path.join(workflowsDir, name));
}

function walkStrings(node, visit) {
  if (typeof node === 'string') {
    visit(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) walkStrings(item, visit);
    return;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) walkStrings(value, visit);
  }
}

function grantsIdTokenWrite(permissions) {
  if (permissions === 'write-all') return true;
  if (!permissions || typeof permissions !== 'object') return false;
  return String(permissions['id-token'] || '').toLowerCase() === 'write';
}

function jobContainsWif(job) {
  return JSON.stringify(job).includes('workload_identity_provider');
}

function scanWorkflowText(text, filePath) {
  const findings = [];
  const lines = String(text).split(/\r?\n/);
  let hasWif = false;
  let hasIdToken = false;
  let hasCredentialsJson = false;

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    if (CREDENTIALS_JSON.test(line) || GAC.test(line)) {
      hasCredentialsJson = true;
      findings.push({
        id: 'long_lived_cloud_key',
        severity: 'fail',
        file: filePath,
        line: lineNo,
        detail: 'workflow injects credentials_json / GOOGLE_APPLICATION_CREDENTIALS; prefer workload_identity_provider',
      });
    }
    if (AWS_SECRET_LITERAL.test(line)) {
      findings.push({
        id: 'aws_secret_literal',
        severity: 'fail',
        file: filePath,
        line: lineNo,
        detail: 'AWS_SECRET_ACCESS_KEY appears as a non-secret literal',
      });
    }
  });

  let doc;
  try {
    doc = yaml.load(text) || {};
  } catch (error) {
    findings.push({
      id: 'workflow_yaml_unreadable',
      severity: 'actionable',
      file: filePath,
      detail: `workflow YAML did not parse (${error.message}); PAT/WIF checks used line scan only`,
    });
    lines.forEach((line, idx) => {
      if (PAT_LINE.test(line) && !TOKEN_FALLBACK.test(line)) {
        findings.push({
          id: 'pat_without_token_fallback',
          severity: 'actionable',
          file: filePath,
          line: idx + 1,
          detail: 'secrets.GH_PAT without github.token fallback (EMU GraphQL writes may still need PAT)',
        });
      }
    });
    hasWif = WIF.test(text);
    hasIdToken = ID_TOKEN_WRITE.test(text);
    if (hasWif && !hasIdToken) {
      findings.push({
        id: 'wif_without_id_token',
        severity: 'fail',
        file: filePath,
        detail: 'workload_identity_provider present but permissions.id-token is not write',
      });
    }
    return {
      file: filePath,
      hasWif,
      hasIdToken,
      hasCredentialsJson,
      findings,
    };
  }

  walkStrings(doc, (value) => {
    if (PAT_LINE.test(value) && !TOKEN_FALLBACK.test(value)) {
      findings.push({
        id: 'pat_without_token_fallback',
        severity: 'actionable',
        file: filePath,
        detail: 'secrets.GH_PAT without github.token fallback (EMU GraphQL writes may still need PAT)',
      });
    }
  });

  const topPerms = doc.permissions;
  if (grantsIdTokenWrite(topPerms)) hasIdToken = true;
  const jobs = doc.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};
  for (const [jobName, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object') continue;
    if (!jobContainsWif(job)) continue;
    hasWif = true;
    const perms = job.permissions !== undefined ? job.permissions : topPerms;
    if (grantsIdTokenWrite(perms)) {
      hasIdToken = true;
      continue;
    }
    findings.push({
      id: 'wif_without_id_token',
      severity: 'fail',
      file: filePath,
      job: jobName,
      detail: `job ${jobName} uses workload_identity_provider but its effective permissions.id-token is not write`,
    });
  }

  return {
    file: filePath,
    hasWif,
    hasIdToken,
    hasCredentialsJson,
    findings,
  };
}

function buildWorkloadIdentityHonestyReport(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const workflowsDir = path.join(options.root, '.github', 'workflows');
  const files = listWorkflowFiles(workflowsDir);
  const scans = [];
  const findings = [];

  if (!files.length) {
    findings.push({
      id: 'workflows_missing',
      severity: 'fail',
      detail: 'no .github/workflows/*.yml to audit',
    });
  }

  for (const abs of files) {
    const rel = path.relative(options.root, abs);
    const text = fs.readFileSync(abs, 'utf8');
    const scan = scanWorkflowText(text, rel);
    scans.push(scan);
    findings.push(...scan.findings);
  }

  if (options.failPatOnly) {
    for (const finding of findings) {
      if (finding.id === 'pat_without_token_fallback') finding.severity = 'fail';
    }
  }

  const failed = findings.some((f) => f.severity === 'fail');
  const actionable = findings.some((f) => f.severity === 'actionable');
  let status = 'ready';
  if (failed) status = 'fail';
  else if (actionable) status = 'actionable';

  return {
    source: SOURCE,
    status,
    metrics: {
      workflows: files.length,
      wif: scans.filter((s) => s.hasWif).length,
      patWithoutFallback: findings.filter((f) => f.id === 'pat_without_token_fallback').length,
      longLivedKeys: findings.filter((f) => f.id === 'long_lived_cloud_key' || f.id === 'aws_secret_literal').length,
    },
    scans: scans.map((s) => ({
      file: s.file,
      hasWif: s.hasWif,
      hasIdToken: s.hasIdToken,
      hasCredentialsJson: s.hasCredentialsJson,
    })),
    findings,
  };
}

function formatWorkloadIdentityHonestyReport(report) {
  const lines = [
    `Workload identity honesty: ${report.status}`,
    `Source: ${report.source}`,
    `Workflows: ${report.metrics.workflows}; WIF: ${report.metrics.wif}; PAT-only: ${report.metrics.patWithoutFallback}; long-lived keys: ${report.metrics.longLivedKeys}`,
  ];
  for (const finding of report.findings) {
    const loc = finding.line ? `${finding.file}:${finding.line}` : (finding.file || '');
    lines.push(`  [${finding.severity}] ${finding.id}${loc ? ` ${loc}` : ''}: ${finding.detail}`);
  }
  return `${lines.join('\n')}\n`;
}

function parseCliArgs(argv = []) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--fail-pat-only') { options.failPatOnly = true; continue; }
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    options[m[1]] = m[2] === undefined ? true : m[2];
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/workload-identity-honesty.js [flags]

Flags:
  --root=DIR
  --fail-pat-only    promote PAT-without-github.token to fail
  --strict           exit 1 unless status=ready
  --json
`);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const report = buildWorkloadIdentityHonestyReport(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatWorkloadIdentityHonestyReport(report));
  if (args.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  SOURCE,
  normalizeOptions,
  scanWorkflowText,
  buildWorkloadIdentityHonestyReport,
  formatWorkloadIdentityHonestyReport,
  parseCliArgs,
  runCli,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = runCli(process.argv.slice(2));
}
