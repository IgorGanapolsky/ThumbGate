'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  buildIngressRecord,
  resolveMemoryFirewallMode,
  resolveMemoryFirewallProvider,
  evaluateMemoryIngress,
} = require('../scripts/memory-firewall');

describe('memory-firewall', () => {
  it('resolveMemoryFirewallProvider defaults to auto', () => {
    assert.strictEqual(resolveMemoryFirewallProvider(), 'auto');
    assert.strictEqual(resolveMemoryFirewallProvider('invalid'), 'auto');
  });

  it('resolveMemoryFirewallProvider accepts valid providers', () => {
    assert.strictEqual(resolveMemoryFirewallProvider('off'), 'off');
    assert.strictEqual(resolveMemoryFirewallProvider('local'), 'local');
    assert.strictEqual(resolveMemoryFirewallProvider('shieldcortex'), 'shieldcortex');
  });

  it('resolveMemoryFirewallMode defaults to strict', () => {
    assert.strictEqual(resolveMemoryFirewallMode(), 'strict');
    assert.strictEqual(resolveMemoryFirewallMode('bogus'), 'strict');
  });

  it('buildIngressRecord creates proper record from feedback event', () => {
    const record = buildIngressRecord({ signal: 'down', context: 'test context', tags: ['git'] });
    assert.strictEqual(record.title, 'feedback_ingress:down');
    assert.ok(record.content.includes('test context'));
    assert.ok(record.tags.includes('git'));
  });

  it('evaluateMemoryIngress allows when provider is off', () => {
    const result = evaluateMemoryIngress({
      feedbackEvent: { signal: 'up', context: 'safe content' },
      provider: 'off',
    });
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.provider, 'off');
  });
});
