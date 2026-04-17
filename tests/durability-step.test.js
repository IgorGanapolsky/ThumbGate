'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runStep,
  idempotencyKey,
  defaultClassify,
  TRANSIENT_CODES,
} = require('../scripts/durability/step');

// Deterministic sleep replacement: counts calls instead of actually waiting.
function makeFakeSleep() {
  const calls = [];
  const fn = async (ms) => { calls.push(ms); };
  return { fn, calls };
}

test('runStep: succeeds on first attempt without sleeping', async () => {
  const { fn: sleepFn, calls } = makeFakeSleep();
  let invocations = 0;
  const result = await runStep('ok', { sleepFn }, async () => {
    invocations += 1;
    return 'done';
  });
  assert.equal(result, 'done');
  assert.equal(invocations, 1);
  assert.deepEqual(calls, []);
});

test('runStep: retries transient error then succeeds', async () => {
  const { fn: sleepFn, calls } = makeFakeSleep();
  let attempts = 0;
  const result = await runStep('flaky', { sleepFn, retries: 3 }, async () => {
    attempts += 1;
    if (attempts < 3) {
      const err = new Error('connection reset');
      err.code = 'ECONNRESET';
      throw err;
    }
    return 'finally';
  });
  assert.equal(result, 'finally');
  assert.equal(attempts, 3);
  // Two retries → two sleeps at 250 and 1000 (default backoff).
  assert.deepEqual(calls, [250, 1000]);
});

test('runStep: gives up after max retries', async () => {
  const { fn: sleepFn, calls } = makeFakeSleep();
  let attempts = 0;
  await assert.rejects(
    runStep('doomed', { sleepFn, retries: 2 }, async () => {
      attempts += 1;
      const err = new Error('still broken');
      err.code = 'ETIMEDOUT';
      throw err;
    }),
    /still broken/,
  );
  assert.equal(attempts, 3); // retries=2 means attempts 0,1,2
  assert.equal(calls.length, 2); // two retries, two sleeps
});

test('runStep: bails immediately on nonRetryable flag', async () => {
  const { fn: sleepFn, calls } = makeFakeSleep();
  let attempts = 0;
  await assert.rejects(
    runStep('validation', { sleepFn, retries: 5 }, async () => {
      attempts += 1;
      const err = new Error('bad input');
      err.nonRetryable = true;
      throw err;
    }),
    /bad input/,
  );
  assert.equal(attempts, 1);
  assert.deepEqual(calls, []);
});

test('runStep: HTTP 5xx retries, 4xx does not', async () => {
  const { fn: sleepFn } = makeFakeSleep();

  // 503 retry
  let a = 0;
  await assert.rejects(
    runStep('server-err', { sleepFn, retries: 1 }, async () => {
      a += 1;
      throw new Error('Zernio API 503 for POST /posts: gateway');
    }),
    /503/,
  );
  assert.equal(a, 2, '503 should retry once → 2 attempts');

  // 400 no retry
  let b = 0;
  await assert.rejects(
    runStep('client-err', { sleepFn, retries: 5 }, async () => {
      b += 1;
      throw new Error('Zernio API 400 for POST /posts: validation');
    }),
    /400/,
  );
  assert.equal(b, 1, '400 should NOT retry');
});

test('runStep: HTTP 429 (rate limit) retries', async () => {
  const { fn: sleepFn } = makeFakeSleep();
  let a = 0;
  await assert.rejects(
    runStep('rate-limit', { sleepFn, retries: 2 }, async () => {
      a += 1;
      throw new Error('got 429 too many requests');
    }),
    /429/,
  );
  assert.equal(a, 3);
});

test('runStep: err.status wins over message parsing', async () => {
  const { fn: sleepFn } = makeFakeSleep();
  let a = 0;
  await assert.rejects(
    runStep('explicit-status', { sleepFn, retries: 3 }, async () => {
      a += 1;
      const err = new Error('fail');
      err.status = 400; // explicit 4xx → no retry
      throw err;
    }),
    /fail/,
  );
  assert.equal(a, 1);
});

test('runStep: onRetry / onFail hooks fire with expected payloads', async () => {
  const { fn: sleepFn } = makeFakeSleep();
  const retries = [];
  const fails = [];
  await assert.rejects(
    runStep('hooks', {
      sleepFn,
      retries: 2,
      onRetry: (evt) => retries.push(evt),
      onFail: (evt) => fails.push(evt),
    }, async () => {
      throw new Error('persistent 503');
    }),
  );
  assert.equal(retries.length, 2);
  assert.equal(retries[0].attempt, 0);
  assert.equal(retries[0].waitMs, 250);
  assert.equal(retries[1].attempt, 1);
  assert.equal(retries[1].waitMs, 1000);
  assert.equal(fails.length, 1);
  assert.equal(fails[0].attempt, 2);
  assert.equal(fails[0].verdict, 'retry'); // message says 503 → classified retry, but retries exhausted
});

test('runStep: custom classify overrides default', async () => {
  const { fn: sleepFn } = makeFakeSleep();
  let a = 0;
  await assert.rejects(
    runStep('custom', {
      sleepFn,
      retries: 5,
      classify: () => 'fail', // everything is a permanent failure
    }, async () => {
      a += 1;
      const err = new Error('normally retryable');
      err.code = 'ECONNRESET';
      throw err;
    }),
  );
  assert.equal(a, 1);
});

test('runStep: attempt counter is passed to fn', async () => {
  const { fn: sleepFn } = makeFakeSleep();
  const attemptsSeen = [];
  await runStep('attempt-count', { sleepFn, retries: 2 }, async ({ attempt }) => {
    attemptsSeen.push(attempt);
    if (attempt < 2) {
      const err = new Error('retry me');
      err.retryable = true;
      throw err;
    }
    return 'ok';
  });
  assert.deepEqual(attemptsSeen, [0, 1, 2]);
});

test('runStep: shorthand form (no options)', async () => {
  const result = await runStep('shorthand', async () => 42);
  assert.equal(result, 42);
});

test('runStep: throws TypeError when fn is missing', async () => {
  await assert.rejects(
    // @ts-expect-error intentional misuse
    runStep('bad', {}),
    /fn must be a function/,
  );
});

// ---------------------------------------------------------------------------
// idempotencyKey
// ---------------------------------------------------------------------------

test('idempotencyKey: stable across identical inputs', () => {
  const a = idempotencyKey('hello', { to: 'world' }, 42);
  const b = idempotencyKey('hello', { to: 'world' }, 42);
  assert.equal(a, b);
  assert.equal(a.length, 32);
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('idempotencyKey: differs for different inputs', () => {
  const a = idempotencyKey('hello', 'world');
  const b = idempotencyKey('hello', 'WORLD');
  assert.notEqual(a, b);
});

test('idempotencyKey: separator prevents field boundary collisions', () => {
  // Without separator, ['ab', 'cd'] and ['abc', 'd'] would hash identically.
  const a = idempotencyKey('ab', 'cd');
  const b = idempotencyKey('abc', 'd');
  assert.notEqual(a, b);
});

test('idempotencyKey: null/undefined treated as empty string', () => {
  const a = idempotencyKey(null, 'x');
  const b = idempotencyKey(undefined, 'x');
  const c = idempotencyKey('', 'x');
  assert.equal(a, b);
  assert.equal(a, c);
});

// ---------------------------------------------------------------------------
// defaultClassify
// ---------------------------------------------------------------------------

test('defaultClassify: transient codes → retry', () => {
  for (const code of TRANSIENT_CODES) {
    const err = new Error('x');
    err.code = code;
    assert.equal(defaultClassify(err), 'retry', `code ${code}`);
  }
});

test('defaultClassify: null/undefined → fail', () => {
  assert.equal(defaultClassify(null), 'fail');
  assert.equal(defaultClassify(undefined), 'fail');
});

test('defaultClassify: retryable/nonRetryable flags win', () => {
  const a = Object.assign(new Error(), { retryable: true, status: 400 });
  assert.equal(defaultClassify(a), 'retry', 'retryable=true overrides 400');

  const b = Object.assign(new Error(), { nonRetryable: true, status: 503 });
  assert.equal(defaultClassify(b), 'fail', 'nonRetryable=true overrides 503');
});

test('defaultClassify: HTTP status precedence', () => {
  assert.equal(defaultClassify(Object.assign(new Error('x'), { status: 429 })), 'retry');
  assert.equal(defaultClassify(Object.assign(new Error('x'), { status: 500 })), 'retry');
  assert.equal(defaultClassify(Object.assign(new Error('x'), { status: 502 })), 'retry');
  assert.equal(defaultClassify(Object.assign(new Error('x'), { status: 400 })), 'fail');
  assert.equal(defaultClassify(Object.assign(new Error('x'), { status: 401 })), 'fail');
  assert.equal(defaultClassify(Object.assign(new Error('x'), { status: 404 })), 'fail');
});

test('defaultClassify: unknown error → retry (bounded by retries)', () => {
  assert.equal(defaultClassify(new Error('mystery')), 'retry');
});
