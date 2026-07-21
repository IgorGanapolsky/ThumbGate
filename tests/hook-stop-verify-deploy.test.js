'use strict';

/**
 * Tests for scripts/hook-stop-verify-deploy.sh
 *
 * Contract: a Stop hook that scans CLAUDE_RESPONSE for "deployed/live/shipped/
 * in production" claims and blocks the turn unless the same response contains
 * evidence (curl /health output, a buildSha string, a version literal, an
 * HTTP 200 from the production host, or the verify-deploy-comment workflow
 * sentinel "Deploy verified").
 *
 * Failure mode this guards: the LLM declares "deployed" without showing the
 * curl output that CLAUDE.md hard-block rule #6 requires.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', 'scripts', 'hook-stop-verify-deploy.sh');

function runHook(response) {
  const result = spawnSync('bash', [HOOK], {
    env: { ...process.env, CLAUDE_RESPONSE: response || '' },
    encoding: 'utf-8',
  });
  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    decision: parseDecision(result.stdout || ''),
  };
}

function parseDecision(stdout) {
  // The hook emits JSON only when it blocks. Find the first { ... } object.
  const match = stdout.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

describe('hook-stop-verify-deploy', () => {
  test('passes through silently when there is no claim word', () => {
    const r = runHook('I made some changes to the workflow file and added a test.');
    assert.equal(r.exitCode, 0);
    assert.equal(r.decision, null);
  });

  test('blocks "deployed" without any evidence', () => {
    const r = runHook('ThumbGate is deployed.');
    assert.equal(r.exitCode, 0);
    assert.ok(r.decision, 'expected a JSON decision payload');
    assert.equal(r.decision.decision, 'block');
    assert.match(r.decision.reason, /CLAUDE\.md hard-block rule #6/i);
  });

  test('does not block a "deployed" claim unrelated to ThumbGate production', () => {
    // e.g. summarizing a local Ollama model's deploy state, or a PR merged
    // in a sibling repo — neither has anything to do with ThumbGate prod.
    const r = runHook('No model was deployed on the mac mini; Ollama stays disabled.');
    assert.equal(r.decision, null);
  });

  test('blocks "live in production" without evidence', () => {
    const r = runHook('The new endpoint is live in production now.');
    assert.equal(r.decision?.decision, 'block');
  });

  test('blocks "shipped" without evidence', () => {
    const r = runHook('Shipped the ThumbGate fix to production.');
    assert.equal(r.decision?.decision, 'block');
  });

  test('allows when response contains a curl to the production host', () => {
    const r = runHook(
      'Deployed. Verified via curl https://thumbgate.ai/health which returned the new buildSha.'
    );
    assert.equal(r.decision, null);
  });

  test('allows when response contains a buildSha string', () => {
    const r = runHook('Now live. buildSha=2b72f9c5c99dba2a6b1424b098b0cd7c7ab7e59a matches origin/main.');
    assert.equal(r.decision, null);
  });

  test('allows when response contains a /health JSON-style version field', () => {
    const r = runHook('Shipped. /health returns "version":"1.18.0" and "buildSha":"2b72f9c5".');
    assert.equal(r.decision, null);
  });

  test('allows when response contains HTTP 200 + production host', () => {
    const r = runHook('Now live at https://thumbgate.ai/learn/foo (HTTP 200, 15.4 kB).');
    assert.equal(r.decision, null);
  });

  test('allows when response cites the "Deploy verified" workflow sentinel', () => {
    const r = runHook('Deployed. ✅ Deploy verified — buildSha match and all routes passed.');
    assert.equal(r.decision, null);
  });

  test('allows mere "/health" reference paired with the production host', () => {
    const r = runHook('Deployed and /health on thumbgate.ai returned ok.');
    assert.equal(r.decision, null);
  });

  test('does NOT block "ready" by itself (too generic)', () => {
    // "ready for review" should not be claimed as a deploy claim; the PR-thread
    // hook handles that one separately.
    const r = runHook('PR is ready for review.');
    assert.equal(r.decision, null);
  });

  test('blocks "in prod" shorthand without evidence', () => {
    const r = runHook('The fix is in prod.');
    assert.equal(r.decision?.decision, 'block');
  });

  test('blocks "production-ready" without evidence', () => {
    const r = runHook('The feature is production-ready.');
    assert.equal(r.decision?.decision, 'block');
  });

  test('exits 0 with empty CLAUDE_RESPONSE', () => {
    const r = runHook('');
    assert.equal(r.exitCode, 0);
    assert.equal(r.decision, null);
  });
});
