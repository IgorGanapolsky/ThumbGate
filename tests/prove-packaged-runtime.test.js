const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  installPackageWithRetry,
  isRemotePackageSpec,
  isTransientRegistryMiss,
} = require('../scripts/prove-packaged-runtime');

test('installPackageWithRetry retries transient registry misses for published packages', async () => {
  const prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-publish-retry-'));
  const delays = [];
  let attempts = 0;

  try {
    const runtimeBin = await installPackageWithRetry(prefixDir, 'thumbgate@1.3.0', {
      attempts: 4,
      delayMs: 10,
      installImpl() {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error('npm error code ETARGET\nNo matching version found for thumbgate@1.3.0.');
          error.stderr = 'npm error code ETARGET\nNo matching version found for thumbgate@1.3.0.';
          throw error;
        }
        return '/tmp/thumbgate';
      },
      sleepImpl(ms) {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    assert.equal(runtimeBin, '/tmp/thumbgate');
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [10, 15]);
  } finally {
    fs.rmSync(prefixDir, { recursive: true, force: true });
  }
});

test('installPackageWithRetry gives newly published packages a long propagation window by default', async () => {
  const prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-publish-default-retry-'));
  const delays = [];
  let attempts = 0;

  try {
    await assert.rejects(
      installPackageWithRetry(prefixDir, 'thumbgate@9.9.9-test', {
        installImpl() {
          attempts += 1;
          const error = new Error('npm error code ETARGET');
          error.stderr = 'No matching version found for thumbgate@9.9.9-test.';
          throw error;
        },
        sleepImpl(ms) {
          delays.push(ms);
          return Promise.resolve();
        },
      }),
      /ETARGET/
    );

    // npm can take 9+ minutes to serve a new version, so the default keeps going past
    // 12 attempts until at least 15 minutes of waiting, then gives up.
    const waited = delays.reduce((a, b) => a + b, 0);
    assert.ok(attempts > 12, `expected more than 12 attempts, got ${attempts}`);
    assert.equal(delays.length, attempts - 1);
    assert.equal(delays[0], 10000);
    assert.equal(Math.max(...delays), 45000);
    assert.ok(waited >= 15 * 60 * 1000, `waited ${waited}ms`);
    assert.ok(waited < 15 * 60 * 1000 + 45000, `waited ${waited}ms`);
  } finally {
    fs.rmSync(prefixDir, { recursive: true, force: true });
  }
});

test('installPackageWithRetry honours an explicit attempts cap when minWaitMs is 0', async () => {
  const prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-publish-cap-'));
  let attempts = 0;
  try {
    await assert.rejects(
      installPackageWithRetry(prefixDir, 'thumbgate@9.9.9-test', {
        attempts: 3,
        minWaitMs: 0,
        installImpl() {
          attempts += 1;
          throw new Error('npm error code ETARGET');
        },
        sleepImpl() { return Promise.resolve(); },
      }),
      /ETARGET/
    );
    assert.equal(attempts, 3);
  } finally {
    fs.rmSync(prefixDir, { recursive: true, force: true });
  }
});

test('installPackageWithRetry does not retry non-remote package specs', async () => {
  const prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-publish-local-'));
  let attempts = 0;

  try {
    await assert.rejects(
      installPackageWithRetry(prefixDir, '/tmp/thumbgate-1.3.0.tgz', {
        attempts: 4,
        installImpl() {
          attempts += 1;
          throw new Error('tarball is corrupt');
        },
        sleepImpl() {
          throw new Error('sleep should not be called for local specs');
        },
      }),
      /tarball is corrupt/
    );

    assert.equal(attempts, 1);
  } finally {
    fs.rmSync(prefixDir, { recursive: true, force: true });
  }
});

test('installPackageWithRetry retries transient network failures for local tarballs', async () => {
  const prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-publish-local-transient-'));
  const delays = [];
  let attempts = 0;

  try {
    const runtimeBin = await installPackageWithRetry(prefixDir, '/tmp/thumbgate-1.3.0.tgz', {
      attempts: 3,
      delayMs: 10,
      installImpl() {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('npm error code ETIMEDOUT');
          error.stderr = 'connect ETIMEDOUT 150.171.109.147:443';
          throw error;
        }
        return '/tmp/thumbgate';
      },
      sleepImpl(ms) {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    assert.equal(runtimeBin, '/tmp/thumbgate');
    assert.equal(attempts, 2);
    assert.deepEqual(delays, [10]);
  } finally {
    fs.rmSync(prefixDir, { recursive: true, force: true });
  }
});

test('remote package detection and transient error parsing match publish smoke expectations', () => {
  assert.equal(isRemotePackageSpec('thumbgate@1.3.0'), true);
  assert.equal(isRemotePackageSpec('/tmp/thumbgate-1.3.0.tgz'), false);
  assert.equal(isRemotePackageSpec('file:/tmp/thumbgate-1.3.0.tgz'), false);

  const transient = new Error('npm error code ETARGET');
  transient.stderr = 'No matching version found for thumbgate@1.3.0.';
  assert.equal(isTransientRegistryMiss(transient), true);
  const timeout = new Error('npm error code ETIMEDOUT');
  timeout.stderr = 'connect ETIMEDOUT 150.171.109.147:443';
  assert.equal(isTransientRegistryMiss(timeout), true);
  assert.equal(isTransientRegistryMiss(new Error('permission denied')), false);
});
