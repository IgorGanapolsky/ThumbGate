'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { evaluatePolicyRecursively } = require('../scripts/recursive-policy-eval');

test('recursive-policy-eval', async (t) => {
  await t.test('allows clean artifacts', () => {
    const res = evaluatePolicyRecursively('const x = 1;\\nconsole.log(x);');
    assert.strictEqual(res.mode, 'allow');
    assert.strictEqual(res.violations.length, 0);
  });

  await t.test('recursively chunks and blocks distributed secrets', () => {
    // Create an artifact large enough to span multiple chunks
    const safePadding = 'a'.repeat(1500); 
    const maliciousPayload = 'const AWS_ACCESS_KEY_ID = "AKIA...";';
    const artifact = safePadding + maliciousPayload + safePadding;

    const res = evaluatePolicyRecursively(artifact, 1000);
    assert.strictEqual(res.mode, 'block');
    assert.ok(res.violations.includes('secret_exposure'));
    assert.match(res.summary, /Analyzed 4 chunks/);
  });

  await t.test('warns on arbitrary execution', () => {
    const res = evaluatePolicyRecursively('eval("var hack = true;");');
    assert.strictEqual(res.mode, 'warn');
    assert.ok(res.violations.includes('arbitrary_execution'));
  });
});
