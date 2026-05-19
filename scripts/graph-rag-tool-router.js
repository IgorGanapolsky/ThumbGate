'use strict';

/**
 * Graph-Based Tool Routing & Safety Policy (Graph-Enhanced RAG)
 * 
 * Validates agent tool invocations against a static Knowledge Graph of allowed
 * actions and environments before execution. Implements "multi-hop" agentic retrieval.
 */

const TOOL_GRAPH = {
  nodes: [
    { id: 'bash', type: 'tool', risk: 'high' },
    { id: 'read_file', type: 'tool', risk: 'low' },
    { id: 'prod', type: 'environment' },
    { id: 'dev', type: 'environment' },
    { id: 'sysadmin', type: 'permission' }
  ],
  edges: [
    { source: 'bash', target: 'dev', relation: 'ALLOWED_IN_ENV' },
    { source: 'bash', target: 'sysadmin', relation: 'REQUIRES_PERMISSION' },
    { source: 'read_file', target: 'prod', relation: 'ALLOWED_IN_ENV' },
    { source: 'read_file', target: 'dev', relation: 'ALLOWED_IN_ENV' }
  ]
};

function filterAllowedTools(proposedTools, envName, userPerms = []) {
  const allowed = [];
  const blocked = [];

  for (const tool of proposedTools) {
    const isAllowedEnv = TOOL_GRAPH.edges.some(e => e.source === tool && e.relation === 'ALLOWED_IN_ENV' && e.target === envName);
    const requiredPerms = TOOL_GRAPH.edges
      .filter(e => e.source === tool && e.relation === 'REQUIRES_PERMISSION')
      .map(e => e.target);

    const hasPerms = requiredPerms.every(p => userPerms.includes(p));

    if (isAllowedEnv && hasPerms) {
      allowed.push(tool);
    } else {
      blocked.push({ tool, reason: !isAllowedEnv ? `Not allowed in ${envName}` : 'Missing permissions' });
    }
  }

  return { allowed, blocked };
}

module.exports = {
  filterAllowedTools,
  TOOL_GRAPH
};
