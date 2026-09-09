#!/usr/bin/env node
'use strict';

/**
 * KYAML FORMAT analog: fail-closed JSON required-keys on existing config/.
 *
 * InfoQ 2026-09-08 — Kubernetes KYAML is a stricter YAML dialect. We do not
 * adopt that dialect. The transferable mechanic is: parse fail-closed and
 * require declared keys on the configs this repo already ships as JSON.
 *
 * Does NOT add a YAML dialect, a kyaml CLI, or config/thumbgate-config.yaml.
 *
 * Usage:
 *   node scripts/config-strict-parse.js --json
 *   node scripts/config-strict-parse.js --root=DIR --strict --json
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'InfoQ 2026-09-08 KYAML FORMAT (strict required-keys, not a YAML dialect)';

const DEFAULT_SPECS = Object.freeze([
  {
    file: 'config/mcp-allowlists.json',
    required: ['version', 'profiles'],
    types: { version: 'number', profiles: 'object' },
    nested: { profiles: { requiredKeys: ['default'] } },
  },
  {
    file: 'config/gates/default.json',
    required: ['version', 'gates'],
    types: { version: 'number', gates: 'array' },
  },
  {
    file: 'config/merge-quality-checks.json',
    required: ['requiredStatusCheckContexts'],
    types: { requiredStatusCheckContexts: 'array' },
  },
  {
    file: 'config/gate-templates.json',
    required: ['version', 'templates'],
    types: { version: 'number', templates: 'array' },
  },
]);

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function normalizeOptions(options = {}) {
  let specs = DEFAULT_SPECS;
  if (Array.isArray(options.specs) && options.specs.length) specs = options.specs;
  return {
    root: path.resolve(String(options.root || options.cwd || process.cwd())),
    specs,
    json: Boolean(options.json),
    strict: Boolean(options.strict),
    help: Boolean(options.help),
  };
}

function validateSpec(root, spec) {
  const findings = [];
  const rel = spec.file;
  const abs = path.resolve(root, rel);

  if (/\.ya?ml$/i.test(rel)) {
    findings.push({
      id: 'kyaml_dialect_refused',
      severity: 'fail',
      file: rel,
      detail: 'this doctor audits JSON required-keys; do not add a KYAML/YAML dialect',
    });
    return { file: rel, ok: false, findings };
  }

  if (!fs.existsSync(abs)) {
    findings.push({
      id: 'config_missing',
      severity: 'fail',
      file: rel,
      detail: `required config missing: ${rel}`,
    });
    return { file: rel, ok: false, findings };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    findings.push({
      id: 'config_parse_error',
      severity: 'fail',
      file: rel,
      detail: `JSON.parse failed: ${err.message}`,
    });
    return { file: rel, ok: false, findings };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    findings.push({
      id: 'config_not_object',
      severity: 'fail',
      file: rel,
      detail: 'top-level JSON must be an object',
    });
    return { file: rel, ok: false, findings };
  }

  for (const key of spec.required || []) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
      findings.push({
        id: 'required_key_missing',
        severity: 'fail',
        file: rel,
        key,
        detail: `missing required key ${key}`,
      });
    }
  }

  for (const [key, expected] of Object.entries(spec.types || {})) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
    const actual = typeName(parsed[key]);
    if (actual !== expected) {
      findings.push({
        id: 'required_key_wrong_type',
        severity: 'fail',
        file: rel,
        key,
        detail: `${key} type ${actual} !== ${expected}`,
      });
    }
  }

  if (spec.nested && spec.nested.profiles && parsed.profiles && typeName(parsed.profiles) === 'object') {
    for (const nestedKey of spec.nested.profiles.requiredKeys || []) {
      if (!Object.prototype.hasOwnProperty.call(parsed.profiles, nestedKey)) {
        findings.push({
          id: 'required_nested_key_missing',
          severity: 'fail',
          file: rel,
          key: `profiles.${nestedKey}`,
          detail: `missing profiles.${nestedKey}`,
        });
      }
    }
  }

  return { file: rel, ok: findings.length === 0, findings };
}

function buildConfigStrictParseReport(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const results = options.specs.map((spec) => validateSpec(options.root, spec));
  const findings = results.flatMap((r) => r.findings);
  const failed = findings.some((f) => f.severity === 'fail');
  return {
    source: SOURCE,
    dialect: 'json-required-keys',
    kyaml: false,
    status: failed ? 'fail' : 'ready',
    metrics: {
      specs: options.specs.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    },
    results,
    findings,
  };
}

function formatConfigStrictParseReport(report) {
  const lines = [
    `Config strict parse: ${report.status}`,
    `Source: ${report.source}`,
    `Dialect: ${report.dialect} (kyaml=${report.kyaml})`,
    `Specs: ${report.metrics.ok}/${report.metrics.specs} ok`,
  ];
  for (const finding of report.findings) {
    lines.push(`  [${finding.severity}] ${finding.id} ${finding.file}: ${finding.detail}`);
  }
  return `${lines.join('\n')}\n`;
}

function parseCliArgs(argv = []) {
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
  process.stdout.write(`Usage: node scripts/config-strict-parse.js [flags]

KYAML FORMAT analog: fail-closed JSON required-keys. Not a YAML dialect.

Flags:
  --root=DIR
  --strict
  --json
`);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const report = buildConfigStrictParseReport(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatConfigStrictParseReport(report));
  if (args.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  SOURCE,
  DEFAULT_SPECS,
  normalizeOptions,
  validateSpec,
  buildConfigStrictParseReport,
  formatConfigStrictParseReport,
  parseCliArgs,
  runCli,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = runCli(process.argv.slice(2));
}
