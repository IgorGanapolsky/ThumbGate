'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDockerSandboxPlan,
} = require('../scripts/docker-sandbox-planner');

test('buildDockerSandboxPlan requires Docker Sandboxes for destructive local commands', () => {
  const plan = buildDockerSandboxPlan({
    toolName: 'Bash',
    actionType: 'shell.exec',
    command: 'rm -rf generated-cache',
    repoPath: '/tmp/thumbgate-repo',
    riskBand: 'very_high',
    affectedFiles: ['scripts/tool-registry.js', 'src/api/server.js'],
  });

  assert.equal(plan.shouldSandbox, true);
  assert.equal(plan.recommendation, 'required');
  assert.equal(plan.sandboxKind, 'docker_microvm');
  assert.match(plan.launchers.standalone, /^sbx run shell /);
  assert.match(plan.launchers.dockerDesktop, /^docker sandbox run shell /);
  assert.match(plan.summary, /Docker Sandboxes/i);
});

test('buildDockerSandboxPlan recommends Docker Sandboxes for high-risk file deletion', () => {
  const plan = buildDockerSandboxPlan({
    toolName: 'Write',
    actionType: 'file.delete',
    affectedFiles: ['config/gates/custom.json'],
    riskBand: 'high',
  });

  assert.equal(plan.shouldSandbox, true);
  assert.equal(plan.recommendation, 'recommended');
  assert.equal(plan.networkPolicy.mode, 'deny_all');
});

test('buildDockerSandboxPlan keeps low-risk actions on the host path', () => {
  const plan = buildDockerSandboxPlan({
    toolName: 'Write',
    actionType: 'file.write',
    affectedFiles: ['README.md'],
    riskBand: 'low',
  });

  assert.equal(plan.shouldSandbox, false);
  assert.equal(plan.recommendation, 'not_needed');
  assert.equal(plan.claims, null);
});
