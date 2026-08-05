'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'prove-vlt-dogfood.js');
const {
  main,
  findVlt,
  run,
  parseCliFlags,
} = require('../scripts/prove-vlt-dogfood');

test('parseCliFlags: reads --json and --allow-missing', () => {
  assert.deepEqual(parseCliFlags(['node', 'x', '--json']), { json: true, allowMissing: false });
  assert.deepEqual(parseCliFlags(['node', 'x', '--allow-missing']), { json: false, allowMissing: true });
});

test('prove-vlt-dogfood: --allow-missing exits 0 when vlt absent from PATH', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--json', '--allow-missing'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '/usr/bin:/bin', VLT_BIN: '/nonexistent/vlt' },
    timeout: 30000,
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.skipped, true);
});

test('prove-vlt-dogfood: missing vlt without --allow-missing exits 2', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '/usr/bin:/bin', VLT_BIN: '/nonexistent/vlt' },
    timeout: 30000,
  });
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.skipped, true);
});

test('in-process: allowMissing skips when findVlt empty', () => {
  let captured;
  const code = main({
    json: true,
    allowMissing: true,
    env: { ...process.env, VLT_BIN: '/no/such/vlt', PATH: '/usr/bin:/bin' },
    spawn: () => ({ status: 1, stdout: '', stderr: 'missing' }),
    onReport: (r) => { captured = r; },
  });
  assert.equal(code, 0);
  assert.equal(captured.ok, true);
  assert.equal(captured.skipped, true);
});

test('in-process: missing vlt fails closed without allowMissing', () => {
  let captured;
  const code = main({
    json: true,
    allowMissing: false,
    env: { ...process.env, VLT_BIN: '/no/such/vlt', PATH: '/usr/bin:/bin' },
    spawn: () => ({ status: 1, stdout: '', stderr: 'missing' }),
    onReport: (r) => { captured = r; },
  });
  assert.equal(code, 2);
  assert.equal(captured.ok, false);
  assert.equal(captured.skipped, true);
});

test('in-process: install+query+vuln success path', () => {
  let captured;
  const spawn = (bin, args = []) => {
    if (args[0] === '--version') {
      return { status: 0, stdout: 'vlt 1.0.1\n', stderr: '' };
    }
    if (args[0] === 'install') {
      // Create node_modules/ms so installOk passes
      const cwd = spawn.lastCwd;
      return { status: 0, stdout: 'ok\n', stderr: '' };
    }
    if (args[0] === 'query' && args[1] === '#ms') {
      return { status: 0, stdout: '1\n', stderr: '' };
    }
    if (args[0] === 'query' && args[1] === ':vuln') {
      return { status: 0, stdout: '0\n', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
  };
  // wrap to capture cwd for install mkdirs
  const wrapped = (bin, args, opts = {}) => {
    if (opts && opts.cwd && args && args[0] === 'install') {
      fs.mkdirSync(path.join(opts.cwd, 'node_modules', 'ms'), { recursive: true });
      fs.writeFileSync(path.join(opts.cwd, 'node_modules', 'ms', 'package.json'), '{}');
    }
    return spawn(bin, args);
  };

  const code = main({
    json: true,
    allowMissing: false,
    spawn: wrapped,
    onReport: (r) => { captured = r; },
  });
  assert.equal(code, 0, JSON.stringify(captured));
  assert.equal(captured.ok, true);
  assert.ok(captured.probes.every((p) => p.ok));
  assert.equal(captured.probes.length, 3);
});

test('in-process: install failure returns exit 1', () => {
  let captured;
  const spawn = (bin, args = []) => {
    if (args[0] === '--version') return { status: 0, stdout: 'vlt 1.0.1\n', stderr: '' };
    if (args[0] === 'install') return { status: 1, stdout: '', stderr: 'network down' };
    if (args[0] === 'query') return { status: 0, stdout: '1\n', stderr: '' };
    return { status: 1, stdout: '', stderr: 'nope' };
  };
  const code = main({
    json: true,
    spawn,
    onReport: (r) => { captured = r; },
  });
  assert.equal(code, 1);
  assert.equal(captured.ok, false);
  assert.equal(captured.probes.find((p) => p.id === 'install').ok, false);
});

test('findVlt returns null for dead VLT_BIN', () => {
  const found = findVlt({
    env: { VLT_BIN: '/nonexistent/vlt-bin-for-test', PATH: '/usr/bin:/bin' },
    spawn: () => ({ status: 1, stdout: '', stderr: '' }),
  });
  assert.equal(found, null);
});

test('findVlt returns version from first healthy candidate', () => {
  const found = findVlt({
    env: { VLT_BIN: '/mock/vlt' },
    spawn: (bin) => {
      if (bin === '/mock/vlt') return { status: 0, stdout: 'vlt 9.9.9\n', stderr: '' };
      return { status: 1, stdout: '', stderr: '' };
    },
  });
  assert.deepEqual(found, { bin: '/mock/vlt', version: '9.9.9' });
});

test('run() surfaces spawn errors as status/error fields', () => {
  const out = run('/nonexistent/vlt-binary-xyz', ['--version'], {
    timeout: 5000,
    spawn: () => ({ status: null, stdout: '', stderr: '', error: new Error('ENOENT') }),
  });
  assert.notEqual(out.status, 0);
  assert.match(String(out.error || ''), /ENOENT/);
});

test('prove-vlt-dogfood: full smoke when vlt is installed', (t) => {
  const which = spawnSync('vlt', ['--version'], { encoding: 'utf8' });
  const npmGlobal = path.join(process.env.HOME || '', '.npm-global', 'bin', 'vlt');
  const hasVlt = which.status === 0
    || fs.existsSync(npmGlobal);
  if (!hasVlt) {
    t.skip('vlt not installed in this environment');
    return;
  }
  const bin = which.status === 0 ? 'vlt' : npmGlobal;
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, VLT_BIN: bin, PATH: `${path.dirname(bin)}:${process.env.PATH || ''}` },
    timeout: 180000,
  });
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  assert.ok(report.probes.some((p) => p.id === 'install' && p.ok));
  assert.ok(report.probes.some((p) => p.id === 'query-ms' && p.ok));
  assert.ok(report.probes.some((p) => p.id === 'query-vuln-selector' && p.ok));
});
