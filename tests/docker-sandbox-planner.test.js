'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildDockerSandboxPlan,
} = require('../scripts/docker-sandbox-planner');

test('buildDockerSandboxPlan requires Docker Sandboxes for destructive local commands', () => {
  const plan = buildDockerSandboxPlan({
    toolName: 'Bash',
    actionType: 'shell.exec',
    command: 'rm -rf generated-cache',
    repoPath: path.join(process.cwd(), 'fixtures', 'thumbgate-repo'),
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

test('buildDockerSandboxPlan forwards trust flags into networkPolicy findings', () => {
  const plan = buildDockerSandboxPlan({
    toolName: 'Bash',
    actionType: 'shell.exec',
    command: 'npm publish',
    requiresNetwork: true,
    allowedHosts: ['registry.npmjs.org'],
    treatAllowlistAsTrustBoundary: true,
    riskBand: 'high',
    affectedFiles: ['package.json'],
  });

  assert.equal(plan.networkPolicy.mode, 'allow_list');
  assert.ok(
    (plan.networkPolicy.findings || []).some((f) => f.id === 'allowlist_treated_as_trust_boundary'),
  );
});

test('buildDockerSandboxPlan requires Docker Sandboxes for non-rm destructive delete variants', () => {
  for (const command of [
    'find $T -type f -delete',
    'cmd /c rmdir /s /q "D:\\projects\\old"',
    'Remove-Item -Recurse -Force D:\\projects\\old',
  ]) {
    const plan = buildDockerSandboxPlan({
      toolName: 'Bash',
      command,
    });
    assert.equal(plan.shouldSandbox, true, command);
    assert.equal(plan.recommendation, 'required', command);
    assert.ok(plan.why.some((line) => /Recursive delete commands/i.test(line)), command);
  }
});
