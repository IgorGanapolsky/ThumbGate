const test = require('node:test');
const assert = require('node:assert');
const { DisposableAgentLifecycle } = require('../scripts/disposable-agent-lifecycle.js');

test('DisposableAgentLifecycle spawns time-bound least privilege agents and extracts intelligence on retirement', () => {
  const lifecycle = new DisposableAgentLifecycle({ defaultTtlMs: 1000 });
  const agent = lifecycle.spawnAgent('task_001', 'Audit security vulnerabilities', ['Read', 'Bash']);
  
  assert.strictEqual(agent.status, 'ACTIVE');
  assert.deepStrictEqual(agent.scopedTools, ['Read', 'Bash']);
  assert.ok(agent.expiresAt);

  const retired = lifecycle.extractIntelligenceAndRetire(agent, { success: true, evidence: 'No vulns found' });
  assert.strictEqual(retired.status, 'RETIRED');
  assert.strictEqual(retired.credentialsRevoked, true);
  assert.strictEqual(retired.computeReleased, true);
  assert.ok(retired.extractedIntelligence.lesson.includes('SUCCESS'));
});
