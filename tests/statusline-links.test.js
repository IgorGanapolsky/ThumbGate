'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getStatuslineLinks,
  isLoopbackHost,
  readRuntimeState,
  runtimeStatePath,
  shouldReuseBootingState,
  writeRuntimeState,
} = require('../scripts/statusline-links');

test('getStatuslineLinks returns clickable local URLs when the dashboard is live', async () => {
  const result = await getStatuslineLinks({
    origin: 'http://localhost:3456',
    probeLocalServer: async () => true,
    resolveKey: () => ({ key: 'tg_pro_ready' }),
    launchLocalServer: () => {
      throw new Error('should not launch when server is already live');
    },
  });

  assert.equal(result.state, 'ready');
  assert.equal(result.dashboardUrl, 'http://localhost:3456/dashboard');
  assert.equal(result.lessonsUrl, 'http://localhost:3456/lessons');
  assert.equal(result.upUrl, 'http://localhost:3456/feedback/quick?signal=up');
  assert.equal(result.downUrl, 'http://localhost:3456/feedback/quick?signal=down');
});

test('getStatuslineLinks boots a local Pro server when one is not already running', async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-statusline-links-home-'));
  const launches = [];

  try {
    const result = await getStatuslineLinks({
      env: { HOME: homeDir },
      homeDir,
      origin: 'http://localhost:3456',
      cwd: homeDir,
      probeLocalServer: async () => false,
      resolveKey: () => ({ key: 'tg_pro_boot' }),
      launchLocalServer: (options) => {
        launches.push(options.origin);
        writeRuntimeState({
          pid: process.pid,
          origin: options.origin,
          startedAt: new Date().toISOString(),
          projectDir: homeDir,
        }, { home: homeDir, env: { HOME: homeDir } });
      },
    });

    assert.equal(result.state, 'booting');
    assert.deepEqual(launches, ['http://localhost:3456']);
    assert.ok(fs.existsSync(runtimeStatePath({ home: homeDir, env: { HOME: homeDir } })));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('getStatuslineLinks reuses an in-flight boot state instead of relaunching repeatedly', async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-statusline-links-state-'));
  const launches = [];

  try {
    writeRuntimeState({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      origin: 'http://localhost:3456',
      projectDir: homeDir,
    }, { home: homeDir, env: { HOME: homeDir } });

    const result = await getStatuslineLinks({
      env: { HOME: homeDir },
      homeDir,
      probeLocalServer: async () => false,
      resolveKey: () => ({ key: 'tg_pro_existing' }),
      launchLocalServer: () => launches.push('unexpected'),
    });

    assert.equal(result.state, 'booting');
    assert.deepEqual(launches, []);
    assert.ok(readRuntimeState({ home: homeDir, env: { HOME: homeDir } }));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('getStatuslineLinks falls back to command hints when no local Pro bootstrap is available', async () => {
  const result = await getStatuslineLinks({
    probeLocalServer: async () => false,
    resolveKey: () => null,
    launchLocalServer: () => {
      throw new Error('should not attempt to launch without a license');
    },
  });

  assert.equal(result.state, 'unavailable');
  assert.equal(result.dashboardUrl, 'https://thumbgate.ai/dashboard');
  assert.equal(result.lessonsUrl, 'https://thumbgate.ai/lessons');
  assert.match(result.dashboardLabel, /Dashboard/);
});

test('getStatuslineLinks never bootstraps or links to non-local origins', async () => {
  const launches = [];
  const result = await getStatuslineLinks({
    origin: 'https://thumbgate.example.com',
    probeLocalServer: async () => {
      throw new Error('should not probe non-local origins');
    },
    resolveKey: () => ({ key: 'tg_pro_remote' }),
    launchLocalServer: () => launches.push('unexpected'),
  });

  assert.equal(result.state, 'unavailable');
  assert.equal(result.dashboardUrl, 'https://thumbgate.ai/dashboard');
  assert.equal(result.lessonsUrl, 'https://thumbgate.ai/lessons');
  assert.deepEqual(launches, []);
});

test('shouldReuseBootingState only keeps fresh, live state files', () => {
  assert.equal(shouldReuseBootingState(null), false);
  assert.equal(shouldReuseBootingState({ pid: 999999, startedAt: new Date().toISOString() }), false);
  assert.equal(shouldReuseBootingState({ pid: process.pid, startedAt: new Date(Date.now() - 1000).toISOString() }), true);
  assert.equal(shouldReuseBootingState({ pid: process.pid, startedAt: new Date(Date.now() - 60000).toISOString() }), false);
});

test('isLoopbackHost only allows localhost addresses', () => {
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('thumbgate.example.com'), false);
});
