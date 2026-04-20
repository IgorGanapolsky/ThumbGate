const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-swarm-test-'));
const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-swarm-proof-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_PROOF_DIR = tmpProofDir;
process.env.THUMBGATE_NO_RATE_LIMIT = '1';

const { distributeContextToAgents, MAX_AGENTS, DEFAULT_TTL_MS } = require('../scripts/swarm-coordinator');
const { getProvenance } = require('../scripts/contextfs');

test('distributeContextToAgents constructs one pack shared across named agents', () => {
  const result = distributeContextToAgents({
    query: 'checkout flow payment failure',
    agents: ['perplexity-bug-resolver', 'codex-reviewer', 'grok-x-intelligence'],
    maxItems: 4,
    maxChars: 1500,
  });

  assert.ok(result.packId, 'pack id must be returned');
  assert.equal(result.totalAgents, 3);
  assert.equal(result.distributions.length, 3);

  const packIds = new Set(result.distributions.map((d) => d.packId));
  assert.equal(packIds.size, 1, 'all agents must share the same packId');
  assert.equal([...packIds][0], result.packId);

  const agentNames = result.distributions.map((d) => d.agent);
  assert.deepEqual(agentNames.sort(), ['codex-reviewer', 'grok-x-intelligence', 'perplexity-bug-resolver']);

  for (const dist of result.distributions) {
    assert.ok(dist.provenanceId, 'each distribution must get a provenance id');
    assert.ok(dist.expiresAt, 'each distribution must expose expiresAt');
  }
});

test('distributeContextToAgents records a provenance event per agent', () => {
  const agents = ['alpha-worker', 'beta-worker'];
  const before = getProvenance(500).filter((e) => e.type === 'context_pack_distributed').length;
  const result = distributeContextToAgents({ query: 'q', agents });
  const after = getProvenance(500).filter((e) => e.type === 'context_pack_distributed');

  assert.equal(after.length - before, 2);
  const matching = after.filter((e) => e.packId === result.packId);
  assert.equal(matching.length, 2);
  const agentsInProv = matching.map((e) => e.agent).sort();
  assert.deepEqual(agentsInProv, ['alpha-worker', 'beta-worker']);
});

test('distributeContextToAgents dedupes repeated agent names', () => {
  const result = distributeContextToAgents({
    query: 'q',
    agents: ['perplexity-bug-resolver', 'perplexity-bug-resolver', 'codex-reviewer'],
  });
  assert.equal(result.totalAgents, 2);
  const names = result.distributions.map((d) => d.agent).sort();
  assert.deepEqual(names, ['codex-reviewer', 'perplexity-bug-resolver']);
});

test('distributeContextToAgents rejects empty agents array', () => {
  assert.throws(() => distributeContextToAgents({ agents: [] }), /at least one/i);
  assert.throws(() => distributeContextToAgents({ agents: [''] }), /at least one/i);
  assert.throws(() => distributeContextToAgents({}), /non-empty array|at least one/i);
});

test('distributeContextToAgents rejects > MAX_AGENTS', () => {
  const tooMany = Array.from({ length: MAX_AGENTS + 1 }, (_, i) => `agent-${i}`);
  assert.throws(() => distributeContextToAgents({ agents: tooMany }), /MAX_AGENTS/);
});

test('distributeContextToAgents honors custom ttlMs', () => {
  const ttl = 5 * 60 * 1000;
  const start = Date.now();
  const result = distributeContextToAgents({
    query: 'q',
    agents: ['solo-worker'],
    ttlMs: ttl,
  });
  const expiryMs = Date.parse(result.expiresAt);
  assert.ok(expiryMs - start >= ttl - 1000, 'expiresAt must be at least ttlMs in the future');
  assert.ok(expiryMs - start <= ttl + 5000, 'expiresAt must not exceed ttlMs by much');
});

test('DEFAULT_TTL_MS is 15 minutes', () => {
  assert.equal(DEFAULT_TTL_MS, 15 * 60 * 1000);
});
