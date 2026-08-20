'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentIdentityBoundary } = require('../src/agent-identity-boundary.js');

test('AgentIdentityBoundary - least privilege capability enforcement', async (t) => {
  await t.test('allows researcher to perform read operations but blocks write', () => {
    const boundary = new AgentIdentityBoundary();
    boundary.registerAgent({ agentId: 'agent-researcher-1', role: 'researcher' });

    const readCheck = boundary.verifyAction('agent-researcher-1', 'view_file', 'fs:read');
    assert.equal(readCheck.allowed, true);
    assert.equal(readCheck.decision, 'ALLOW');

    const writeCheck = boundary.verifyAction('agent-researcher-1', 'replace_file_content', 'fs:write');
    assert.equal(writeCheck.allowed, false);
    assert.equal(writeCheck.decision, 'DENY_PRIVILEGE_VIOLATION');
  });

  await t.test('allows developer to commit and run tests but blocks deployment', () => {
    const boundary = new AgentIdentityBoundary();
    boundary.registerAgent({ agentId: 'agent-dev-1', role: 'developer' });

    assert.equal(boundary.isAuthorized('agent-dev-1', 'fs:write'), true);
    assert.equal(boundary.isAuthorized('agent-dev-1', 'git:commit'), true);
    assert.equal(boundary.isAuthorized('agent-dev-1', 'ci:deploy'), false);
  });

  await t.test('supports wildcard capability delegation for admin role', () => {
    const boundary = new AgentIdentityBoundary();
    boundary.registerAgent({ agentId: 'agent-admin-1', role: 'admin' });

    assert.equal(boundary.isAuthorized('agent-admin-1', 'any:custom:capability'), true);
  });
});
