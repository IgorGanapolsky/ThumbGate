'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const { publicGateId, trackEventDetached } = require('../scripts/cli-telemetry');

const LEARNED = 'auto-npm-run-deploy-acme-billing-staging-f26d02db';

test('only shipped gate ids are sent as themselves', () => {
  assert.equal(publicGateId('force-push'), 'force-push');
  assert.equal(publicGateId(LEARNED), 'learned');
  assert.equal(publicGateId('no-prod-acme-db'), 'custom');
});

test('a telemetry payload never carries the words of a learned gate id', () => {
  let payload;
  const saved = { a: process.env.THUMBGATE_NO_TELEMETRY, b: process.env.DO_NOT_TRACK };
  delete process.env.THUMBGATE_NO_TELEMETRY;
  delete process.env.DO_NOT_TRACK;
  try {
    trackEventDetached('first_block_upsell_shown', { gateId: LEARNED }, {
      spawnFn: (_cmd, _args, options) => { payload = options.env.THUMBGATE_TELEMETRY_PAYLOAD; return null; },
    });
  } finally {
    if (saved.a !== undefined) process.env.THUMBGATE_NO_TELEMETRY = saved.a;
    if (saved.b !== undefined) process.env.DO_NOT_TRACK = saved.b;
  }
  assert.equal(JSON.parse(payload).gateId, 'learned');
  assert.ok(!payload.includes('acme'));
});

test('init sends no cli_init ping under either opt-out variable', () => {
  for (const optOut of ['DO_NOT_TRACK', 'THUMBGATE_NO_TELEMETRY']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-optout-'));
    const log = path.join(dir, 'sent.log');
    const preload = path.join(dir, 'capture.js');
    fs.writeFileSync(preload, `
      const fs = require('node:fs');
      for (const mod of [require('node:http'), require('node:https')]) {
        mod.request = () => ({ on() {}, write() {}, destroy() {}, setTimeout() {},
          end(body) { fs.appendFileSync(${JSON.stringify(log)}, String(body || '') + '\\n'); } });
      }
    `);
    const project = path.join(dir, 'app');
    fs.mkdirSync(project);
    const run = spawnSync(process.execPath, ['--require', preload, path.join(ROOT, 'bin', 'cli.js'), 'init', '--agent', 'claude-code'], {
      cwd: project,
      env: { PATH: process.env.PATH, HOME: dir, USERPROFILE: dir, THUMBGATE_NO_AUTO_UPDATE: '1', [optOut]: '1' },
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.equal(run.status, 0, run.stderr);
    const sent = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    assert.ok(!sent.includes('cli_init'), `${optOut} still sent: ${sent.slice(0, 200)}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
