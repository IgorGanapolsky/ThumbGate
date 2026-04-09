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

test('remote package detection and transient error parsing match publish smoke expectations', () => {
  assert.equal(isRemotePackageSpec('thumbgate@1.3.0'), true);
  assert.equal(isRemotePackageSpec('/tmp/thumbgate-1.3.0.tgz'), false);
  assert.equal(isRemotePackageSpec('file:/tmp/thumbgate-1.3.0.tgz'), false);

  const transient = new Error('npm error code ETARGET');
  transient.stderr = 'No matching version found for thumbgate@1.3.0.';
  assert.equal(isTransientRegistryMiss(transient), true);
  assert.equal(isTransientRegistryMiss(new Error('permission denied')), false);
});
