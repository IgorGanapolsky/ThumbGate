'use strict';

// `npx thumbgate control`: a read-only view of where ThumbGate keeps data and what the usage ping sends.
// Idea from the 2026 AI infrastructure trends report (Crusoe/MetaLab): buyers rank control and transparency
// alongside performance, so the product shows both in one command.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const cliPath = path.join(root, 'bin', 'cli.js');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('usage ping field list matches what cli-telemetry actually posts', () => {
  const home = tmpDir('tg-control-home-');
  const script = `
    const t = require(${JSON.stringify(path.join(root, 'scripts', 'cli-telemetry.js'))});
    process.stdout.write(JSON.stringify(Object.keys(JSON.parse(t.buildPayload('probe')))));
  `;
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.THUMBGATE_INSTALL_SOURCE;
  const out = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const { USAGE_PING_FIELDS, USAGE_PING_OPTIONAL_FIELDS } = require('../scripts/data-control-report');
  const keys = JSON.parse(out.stdout);
  // With no THUMBGATE_INSTALL_SOURCE, a git checkout still reports source=git-clone (see installChannel).
  const inferred = fs.existsSync(path.join(root, '.git')) ? USAGE_PING_OPTIONAL_FIELDS : [];
  assert.deepEqual(keys.sort(), [...USAGE_PING_FIELDS, ...inferred].sort());
});

test('report lists the store, the ping state and the off switch, and writes nothing', () => {
  const home = tmpDir('tg-control-home-');
  const dataDir = tmpDir('tg-control-data-');
  fs.writeFileSync(path.join(dataDir, 'feedback-log.jsonl'), '{"signal":"down"}\n');
  fs.writeFileSync(path.join(dataDir, 'prevention-rules.md'), '## rule\n');
  const { buildControlReport, renderControlReportText } = require('../scripts/data-control-report');

  const on = buildControlReport({ env: { HOME: home }, dataDir });
  assert.equal(on.usagePing.enabled, true);
  assert.equal(on.stores[0].path, dataDir);
  assert.equal(on.stores[0].fileCount, 2);
  assert.equal(on.hostedKeySet, false);
  const text = renderControlReportText(on);
  assert.match(text, /feedback-log\.jsonl/);
  assert.match(text, /Usage ping: ON/);
  assert.match(text, /^    Turn it off:  export THUMBGATE_NO_TELEMETRY=1$/m);

  const off = buildControlReport({ env: { HOME: home, DO_NOT_TRACK: '1', THUMBGATE_API_KEY: 'tg_x' }, dataDir });
  assert.equal(off.usagePing.enabled, false);
  assert.equal(off.hostedKeySet, true);
  assert.match(renderControlReportText(off), /Usage ping: OFF/);

  // Read-only: no install id was created by building the report.
  assert.equal(fs.existsSync(path.join(home, '.thumbgate')), false);
});

test('CLI control command prints JSON, is packaged and listed in help', () => {
  const home = tmpDir('tg-control-home-');
  const dataDir = tmpDir('tg-control-data-');
  const env = { ...process.env, HOME: home, USERPROFILE: home, THUMBGATE_NO_TELEMETRY: '1' };
  const out = spawnSync(process.execPath, [cliPath, 'control', '--json', `--data-dir=${dataDir}`], { env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const report = JSON.parse(out.stdout);
  assert.equal(report.stores[0].path, dataDir);
  assert.equal(report.usagePing.enabled, false);
  assert.equal(fs.existsSync(path.join(home, '.thumbgate', 'install-id')), false);

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('scripts/data-control-report.js'));
  const help = spawnSync(process.execPath, [cliPath, 'help', '--all'], { env, encoding: 'utf8' });
  assert.match(help.stdout, /control\s+Where your data lives/);
});
