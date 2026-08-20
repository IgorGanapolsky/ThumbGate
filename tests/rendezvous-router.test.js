const { test } = require('node:test');
const assert = require('node:assert');
const {
  computeRendezvousWeight,
  getRendezvousNode,
  getRankedRendezvousNodes,
  routeSessionWorktree,
} = require('../src/rendezvous-router.js');

test('computeRendezvousWeight produces deterministic float in [0, 1)', () => {
  const w1 = computeRendezvousWeight('repo1', 'node-a');
  const w2 = computeRendezvousWeight('repo1', 'node-a');
  assert.strictEqual(w1, w2);
  assert.ok(w1 >= 0);
  assert.ok(w1 < 1);

  const w3 = computeRendezvousWeight('repo1', 'node-b');
  assert.notStrictEqual(w1, w3);
});

test('getRendezvousNode selects the highest-weight node', () => {
  const nodes = ['node-1', 'node-2', 'node-3', 'node-4'];
  const winner = getRendezvousNode('my-repo', nodes);
  assert.ok(nodes.includes(winner));

  // Consistent across repeated calls
  assert.strictEqual(getRendezvousNode('my-repo', nodes), winner);
});

test('getRankedRendezvousNodes ranks all nodes by weight', () => {
  const nodes = ['node-1', 'node-2', 'node-3'];
  const ranked = getRankedRendezvousNodes('task-xyz', nodes);
  assert.strictEqual(ranked.length, 3);
  assert.deepStrictEqual(new Set(ranked), new Set(nodes));

  // First item must match getRendezvousNode
  assert.strictEqual(ranked[0], getRendezvousNode('task-xyz', nodes));
});

test('routeSessionWorktree routes agent session to isolated worktree deterministically', () => {
  const worktrees = ['worktree-alpha', 'worktree-beta', 'worktree-gamma'];
  const chosen1 = routeSessionWorktree('/Users/repo', 'session-123', worktrees);
  const chosen2 = routeSessionWorktree('/Users/repo', 'session-123', worktrees);
  assert.strictEqual(chosen1, chosen2);
  assert.ok(worktrees.includes(chosen1));

  // Null handling
  assert.strictEqual(routeSessionWorktree(null, 'session-123', worktrees), null);
  assert.strictEqual(routeSessionWorktree('/Users/repo', null, worktrees), null);
  assert.strictEqual(routeSessionWorktree('/Users/repo', 'session-123', []), null);
});
