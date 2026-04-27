'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  classifyHostedExecution,
  buildCloudflareSandboxPlan,
  verifyDispatchEnvelope,
} = require('../scripts/cloudflare-dynamic-sandbox');

test('classifyHostedExecution routes team isolation workloads to Cloudflare dynamic workers', () => {
  const result = classifyHostedExecution({
    workloadType: 'history_distillation',
    tier: 'team',
    tenantId: 'team_thumbgate',
    untrustedCode: true,
  });

  assert.equal(result.provider, 'cloudflare_dynamic_worker');
  assert.match(result.reason, /edge sandbox execution/i);
});

test('classifyHostedExecution keeps repo-bound tasks on Railway', () => {
  const result = classifyHostedExecution({
    workloadType: 'history_distillation',
    tier: 'team',
    repoPath: '/tmp/repo',
  });

  assert.equal(result.provider, 'railway_control_plane');
  assert.match(result.reason, /repo or local filesystem access/i);
});

test('buildCloudflareSandboxPlan signs and bootstraps hosted workloads', () => {
  const plan = buildCloudflareSandboxPlan({
    workloadType: 'workflow_triage',
    tier: 'team',
    tenantId: 'team_thumbgate',
    requiresNetwork: true,
    allowedHosts: ['api.anthropic.com'],
    context: 'The hosted automation should triage workflow failures.',
    messages: [
      { author: 'user', text: 'Why did the workflow stall?' },
      { author: 'assistant', text: 'I need to inspect the failing automation path.' },
    ],
    task: {
      title: 'Investigate workflow stall',
      body: 'Dispatch to the hosted sandbox and summarize findings.',
    },
  }, {
    sharedSecret: 'sandbox-secret',
    now: '2026-04-03T12:00:00.000Z',
  });

  assert.equal(plan.provider, 'cloudflare_dynamic_worker');
  assert.equal(plan.shouldDispatch, true);
  assert.equal(plan.signatureReady, true);
  assert.equal(plan.route, '/sandbox/execute');
  assert.deepEqual(plan.envelope.networkPolicy.allowedHosts, ['api.anthropic.com']);
  assert.equal(plan.envelope.bootstrap.reviewerLane.enabled, true);
  assert.match(plan.envelope.bootstrap.startupContext.text, /Investigate workflow stall/);
  assert.equal(
    verifyDispatchEnvelope({
      body: plan.envelope,
      secret: 'sandbox-secret',
      timestamp: plan.headers['x-thumbgate-sandbox-timestamp'],
      signature: plan.headers['x-thumbgate-sandbox-signature'],
      now: Date.parse('2026-04-03T12:00:00.000Z'),
    }),
    true,
  );
});

test('buildCloudflareSandboxPlan returns a non-dispatch Railway plan when Cloudflare is not a fit', () => {
  const plan = buildCloudflareSandboxPlan({
    workloadType: 'generic_automation',
    tier: 'pro',
    repoPath: '/tmp/project',
  });

  assert.equal(plan.provider, 'railway_control_plane');
  assert.equal(plan.shouldDispatch, false);
  assert.equal(plan.route, null);
});

test('worker package test script uses shell-expanded test paths so CI does not pass a literal test path', () => {
  const workerPackage = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'workers', 'package.json'), 'utf8'),
  );

  assert.equal(
    workerPackage.scripts.test,
    'npm run typecheck && node ./node_modules/tsx/dist/cli.mjs --test src/*.test.ts',
  );
  assert.doesNotMatch(workerPackage.scripts.test, /\*\*/);
});
