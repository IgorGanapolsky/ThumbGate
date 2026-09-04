#!/usr/bin/env node
'use strict';

/**
 * Package-manager honesty doctor (InfoQ pnpm 12 process steal).
 *
 * Source: https://www.infoq.com/news/2026/09/pnpm-12-rust/
 *
 * Transfers:
 *   - Single lockfile + packageManager pin honesty
 *   - CI install command must match the lockfile manager
 *   - Lifecycle scripts are spicy by default on npm — prefer --ignore-scripts
 *     evidence for agent/untrusted installs
 *   - Fail-closed when an agent proposes switching managers without CI rewrite
 *   - pnpm 12 compat checklist (resolution-only → peers check, etc.) when
 *     switching TO pnpm — without migrating this repo off npm
 *
 * Does NOT migrate ThumbGate from npm → pnpm. CI stays on npm ci.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URL = 'https://www.infoq.com/news/2026/09/pnpm-12-rust/';
const LOCKFILES = [
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'bun.lock', manager: 'bun' },
];

const PNPM12_COMPAT_CHECKS = [
  {
    id: 'resolution-only-removed',
    legacy: 'pnpm install --resolution-only',
    replacement: 'pnpm peers check',
    note: 'pnpm 12 removed --resolution-only; CI that still uses it will break.',
  },
  {
    id: 'workspace-unknown-keys',
    legacy: 'unknown keys silently ignored in pnpm-workspace.yaml',
    replacement: 'unknown keys reported as errors',
    note: 'Audit pnpm-workspace.yaml before upgrading; unknown keys now fail closed.',
  },
  {
    id: 'git-canonical-https',
    legacy: 'git+ssh://github.com/... style git deps',
    replacement: 'canonical HTTPS + Git URL rewrite for private SSH',
    note: 'GitHub/GitLab/Bitbucket git deps resolve via HTTPS; configure URL rewriting for private SSH.',
  },
];

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function detectLockfiles(rootDir) {
  return LOCKFILES
    .filter((entry) => fs.existsSync(path.join(rootDir, entry.file)))
    .map((entry) => ({ ...entry, path: path.join(rootDir, entry.file) }));
}

function readPackageManagerPin(rootDir) {
  const pkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return { path: pkgPath, pin: null, raw: null };
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return { path: pkgPath, pin: null, raw: null, parseError: true };
  }
  const raw = pkg.packageManager ? String(pkg.packageManager) : null;
  if (!raw) return { path: pkgPath, pin: null, raw: null };
  const m = /^(npm|pnpm|yarn|bun)@/.exec(raw);
  return { path: pkgPath, pin: m ? m[1] : raw.split('@')[0], raw };
}

function listWorkflowFiles(workflowsDir) {
  if (!fs.existsSync(workflowsDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(workflowsDir)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    out.push(path.join(workflowsDir, name));
  }
  return out;
}

/**
 * Extract install-ish commands from workflow YAML text (line-oriented, not a YAML parser).
 */
function extractInstallCommands(text, filePath) {
  const lines = String(text).split(/\r?\n/);
  const commands = [];
  const installRe = /\b(npm\s+ci|npm\s+install|npm\s+i\b|pnpm\s+(?:i|install|fetch|import)|yarn\s+(?:install|immutable)|bun\s+install)\b/i;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!installRe.test(line)) continue;
    const trimmed = line.trim();
    // skip comments
    if (trimmed.startsWith('#')) continue;
    let manager = 'npm';
    if (/\bpnpm\b/i.test(line)) manager = 'pnpm';
    else if (/\byarn\b/i.test(line)) manager = 'yarn';
    else if (/\bbun\b/i.test(line)) manager = 'bun';
    commands.push({
      file: filePath,
      line: i + 1,
      text: trimmed.replace(/^-\s*run:\s*/, '').replace(/^run:\s*/, ''),
      manager,
      ignoreScripts: /--ignore-scripts\b/.test(line),
    });
  }
  return commands;
}

function scanWorkflowInstalls(rootDir) {
  const workflowsDir = path.join(rootDir, '.github', 'workflows');
  const files = listWorkflowFiles(workflowsDir);
  const commands = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    commands.push(...extractInstallCommands(text, path.relative(rootDir, file)));
  }
  return commands;
}

function inferCanonicalManager(lockfiles, pin) {
  if (lockfiles.length === 1) return lockfiles[0].manager;
  if (pin && lockfiles.some((l) => l.manager === pin)) return pin;
  if (lockfiles.some((l) => l.manager === 'npm')) return 'npm';
  return lockfiles[0] ? lockfiles[0].manager : null;
}

function buildFindings({
  lockfiles,
  pinInfo,
  installs,
  canonical,
  proposeSwitch,
  allowIgnoreScriptsGaps,
}) {
  const findings = [];

  if (lockfiles.length === 0) {
    findings.push({
      id: 'no_lockfile',
      severity: 'fail',
      gateId: 'require-package-manager-lockfile-ci-parity',
      message: 'No package-lock.json / pnpm-lock.yaml / yarn.lock / bun.lock found. Installs are not reproducible.',
    });
  }

  if (lockfiles.length > 1) {
    findings.push({
      id: 'multiple_lockfiles',
      severity: 'fail',
      gateId: 'require-package-manager-lockfile-ci-parity',
      message: `Multiple lockfiles present (${lockfiles.map((l) => l.file).join(', ')}). Keep exactly one manager+lockfile pair.`,
    });
  }

  if (pinInfo.pin && canonical && pinInfo.pin !== canonical) {
    findings.push({
      id: 'package_manager_pin_mismatch',
      severity: 'fail',
      gateId: 'require-package-manager-lockfile-ci-parity',
      message: `package.json packageManager=${pinInfo.raw} disagrees with lockfile manager=${canonical}.`,
    });
  }

  if (!pinInfo.pin && canonical) {
    findings.push({
      id: 'package_manager_pin_missing',
      severity: 'info',
      gateId: null,
      message: `No packageManager pin in package.json. Canonical lockfile manager is ${canonical}. Pinning is optional for npm-default repos but required before switching managers.`,
    });
  }

  const mismatchedCi = installs.filter((c) => canonical && c.manager !== canonical);
  if (mismatchedCi.length > 0) {
    const sample = mismatchedCi.slice(0, 3)
      .map((c) => `${c.file}:${c.line} (${c.manager})`)
      .join('; ');
    findings.push({
      id: 'ci_install_manager_mismatch',
      severity: 'fail',
      gateId: 'require-package-manager-lockfile-ci-parity',
      message: `${mismatchedCi.length} CI install command(s) use a different manager than lockfile ${canonical}. Examples: ${sample}`,
    });
  }

  const withoutIgnore = installs.filter((c) => !c.ignoreScripts);
  if (withoutIgnore.length > 0 && !allowIgnoreScriptsGaps) {
    findings.push({
      id: 'ci_install_without_ignore_scripts',
      severity: 'warn',
      gateId: 'block-package-lifecycle-secret-harvest',
      message: `${withoutIgnore.length}/${installs.length} CI install lines lack --ignore-scripts. npm runs lifecycle scripts by default (spicy); prefer --ignore-scripts unless prepare/build scripts are required and reviewed.`,
    });
  }

  if (proposeSwitch) {
    const target = String(proposeSwitch).trim().toLowerCase();
    if (!['npm', 'pnpm', 'yarn', 'bun'].includes(target)) {
      findings.push({
        id: 'unknown_switch_target',
        severity: 'fail',
        gateId: 'checkpoint-package-manager-switch',
        message: `Unknown --propose-switch=${proposeSwitch}. Expected npm|pnpm|yarn|bun.`,
      });
    } else if (canonical && target === canonical) {
      findings.push({
        id: 'switch_noop',
        severity: 'info',
        gateId: null,
        message: `Proposed switch target ${target} already matches canonical manager.`,
      });
    } else {
      findings.push({
        id: 'switch_without_migration_plan',
        severity: 'fail',
        gateId: 'checkpoint-package-manager-switch',
        message: `Refuse silent switch ${canonical || 'unknown'} → ${target}. Require: single new lockfile, packageManager pin, rewrite every CI install, delete the old lockfile, and re-run npm pack/CI green. ThumbGate stays on npm unless that plan is complete.`,
      });
      if (target === 'pnpm') {
        for (const check of PNPM12_COMPAT_CHECKS) {
          findings.push({
            id: `pnpm12_${check.id}`,
            severity: 'warn',
            gateId: 'checkpoint-package-manager-switch',
            message: `pnpm 12 compat: replace "${check.legacy}" with "${check.replacement}". ${check.note}`,
          });
        }
      }
    }
  }

  return findings;
}

function normalizeOptions(options = {}) {
  const rootDir = path.resolve(
    String(options.root || options.cwd || options['root-dir'] || process.cwd())
  );
  return {
    rootDir,
    proposeSwitch: options['propose-switch'] || options.switch || options.propose || null,
    allowIgnoreScriptsGaps: normalizeBoolean(options['allow-ignore-scripts-gaps']),
    strict: normalizeBoolean(options.strict),
    json: normalizeBoolean(options.json),
  };
}

function buildPackageManagerHonestyReport(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const lockfiles = detectLockfiles(options.rootDir);
  const pinInfo = readPackageManagerPin(options.rootDir);
  const installs = scanWorkflowInstalls(options.rootDir);
  const canonical = inferCanonicalManager(lockfiles, pinInfo.pin);
  const findings = buildFindings({
    lockfiles,
    pinInfo,
    installs,
    canonical,
    proposeSwitch: options.proposeSwitch,
    allowIgnoreScriptsGaps: options.allowIgnoreScriptsGaps,
  });

  const failCount = findings.filter((f) => f.severity === 'fail').length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length;
  let status = 'ready';
  if (failCount > 0) status = 'fail';
  else if (warnCount > 0) status = 'actionable';

  const ignoreScriptsCount = installs.filter((c) => c.ignoreScripts).length;

  return {
    name: 'thumbgate-package-manager-honesty-doctor',
    status,
    source: SOURCE_URL,
    disclaimer:
      'Process steal from InfoQ pnpm 12 coverage (Rust rewrite, lockfile honesty, lifecycle defaults). Does not migrate this repo to pnpm and is not affiliated with pnpm.',
    rootDir: options.rootDir,
    metrics: {
      lockfileCount: lockfiles.length,
      lockfiles: lockfiles.map((l) => l.file),
      canonicalManager: canonical,
      packageManagerPin: pinInfo.raw,
      ciInstallCount: installs.length,
      ciIgnoreScriptsCount: ignoreScriptsCount,
      ciIgnoreScriptsRatio: installs.length
        ? Number((ignoreScriptsCount / installs.length).toFixed(4))
        : null,
      proposeSwitch: options.proposeSwitch || null,
    },
    findings,
    summary: {
      failCount,
      warnCount,
      findingCount: findings.length,
      recommendedGateCount: [...new Set(findings.map((f) => f.gateId).filter(Boolean))].length,
    },
    recommendedGates: [...new Set(findings.map((f) => f.gateId).filter(Boolean))],
    nextActions: [
      'Keep exactly one lockfile; do not add pnpm-lock.yaml beside package-lock.json.',
      'CI install manager must match the lockfile (ThumbGate: npm ci).',
      'Prefer --ignore-scripts on agent/untrusted installs; npm runs lifecycle scripts by default.',
      'Refuse package-manager switches without pin + CI rewrite + old lockfile deletion.',
      'If evaluating pnpm 12: use peers check (not --resolution-only) and audit workspace unknown keys — do not rewrite this public npm package casually.',
    ],
    exampleCommand:
      'npx thumbgate package-manager-honesty-doctor --propose-switch=pnpm --json',
  };
}

function formatPackageManagerHonestyReport(report) {
  const lines = [
    '',
    'ThumbGate Package-Manager Honesty Doctor',
    '-'.repeat(40),
    `Status   : ${report.status}`,
    `Root     : ${report.rootDir}`,
    `Canonical: ${report.metrics.canonicalManager || 'none'}`,
    `Lockfiles: ${report.metrics.lockfiles.join(', ') || 'none'}`,
    `Pin      : ${report.metrics.packageManagerPin || '(unset)'}`,
    `CI installs: ${report.metrics.ciInstallCount} (ignore-scripts ${report.metrics.ciIgnoreScriptsCount})`,
    `Findings : ${report.summary.findingCount} (fail=${report.summary.failCount}, warn=${report.summary.warnCount})`,
    `Source   : ${report.source}`,
  ];
  if (report.findings.length) {
    lines.push('', 'Findings:');
    for (const f of report.findings) {
      const gate = f.gateId ? ` [${f.gateId}]` : '';
      lines.push(`  - [${f.severity}] ${f.id}${gate}`);
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
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    options[m[1]] = m[2] === undefined ? true : m[2];
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/package-manager-honesty-doctor.js [flags]

Flags:
  --root=DIR                 Repo root to scan (default: cwd)
  --propose-switch=pnpm|yarn|bun|npm
                             Fail-closed checklist for a manager switch
  --allow-ignore-scripts-gaps
                             Downgrade missing --ignore-scripts to silence
  --strict                   Exit 1 on fail/actionable
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
  const report = buildPackageManagerHonestyReport(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatPackageManagerHonestyReport(report));
  if (args.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  SOURCE_URL,
  LOCKFILES,
  PNPM12_COMPAT_CHECKS,
  detectLockfiles,
  readPackageManagerPin,
  extractInstallCommands,
  scanWorkflowInstalls,
  inferCanonicalManager,
  buildPackageManagerHonestyReport,
  formatPackageManagerHonestyReport,
  normalizeOptions,
  parseCliArgs,
  runCli,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = runCli(process.argv.slice(2));
}
