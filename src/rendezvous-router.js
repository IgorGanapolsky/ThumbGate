/**
 * Rendezvous (Highest Random Weight) Hashing Router
 *
 * Inspired by Cursor Continuity's stateless repository routing (https://cursor.com/blog/git-at-any-scale).
 * Enables deterministic, zero-lock multi-agent worktree and task assignment across
 * distributed agent fleets without central routing tables or relational databases.
 *
 * @module rendezvous-router
 */

const crypto = require('crypto');

/**
 * Computes a 64-bit deterministic hash weight for a (key, node) pair.
 *
 * @param {string} key - The repository path, task ID, or session key
 * @param {string} node - The worker node, worktree path, or agent identity
 * @returns {number} Float weight in range [0, 1)
 */
function computeRendezvousWeight(key, node) {
  const hash = crypto.createHash('sha256').update(`${key}:${node}`).digest();
  const intVal = hash.readUInt32BE(0);
  return intVal / 0xffffffff;
}

/**
 * Selects the top-ranked node for a given key using Rendezvous (HRW) hashing.
 *
 * @param {string} key - Key to route (e.g. repo path, task id)
 * @param {string[]} nodes - Available candidate nodes/worktrees
 * @returns {string|null} The selected node, or null if nodes is empty
 */
function getRendezvousNode(key, nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  if (nodes.length === 1) return nodes[0];

  let bestNode = null;
  let maxWeight = -1;

  for (const node of nodes) {
    const weight = computeRendezvousWeight(key, node);
    if (weight > maxWeight) {
      maxWeight = weight;
      bestNode = node;
    }
  }

  return bestNode;
}

/**
 * Returns a ranked list of all nodes for a given key, ordered from highest to lowest weight.
 * Used for graceful fallback when the primary node is degraded/unhealthy.
 *
 * @param {string} key - Key to route
 * @param {string[]} nodes - Available candidate nodes
 * @returns {string[]} Ordered list of nodes
 */
function getRankedRendezvousNodes(key, nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  if (nodes.length === 1) return [...nodes];

  return [...nodes]
    .map((node) => ({ node, weight: computeRendezvousWeight(key, node) }))
    .sort((a, b) => b.weight - a.weight)
    .map((item) => item.node);
}

/**
 * Routes an agent session to an isolated worktree deterministically.
 *
 * @param {string} repoPath - Base repository path
 * @param {string} sessionId - Active agent session ID
 * @param {string[]} availableWorktrees - List of worktree directory names or paths
 * @returns {string|null} Assigned worktree path
 */
function routeSessionWorktree(repoPath, sessionId, availableWorktrees) {
  if (!repoPath || !sessionId || !Array.isArray(availableWorktrees) || availableWorktrees.length === 0) {
    return null;
  }
  const key = `${repoPath}#${sessionId}`;
  return getRendezvousNode(key, availableWorktrees);
}

module.exports = {
  computeRendezvousWeight,
  getRendezvousNode,
  getRankedRendezvousNodes,
  routeSessionWorktree,
};
