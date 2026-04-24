'use strict';

const DEFAULT_CHECKS = [
  {
    id: 'robots_ai_rules',
    category: 'discoverability',
    artifact: 'public/robots.txt',
    requirement: 'Declare sitemap and AI bot access policy.',
  },
  {
    id: 'sitemap',
    category: 'discoverability',
    artifact: 'public/sitemap.xml',
    requirement: 'Expose canonical public pages for crawlers and AI agents.',
  },
  {
    id: 'markdown_negotiation',
    category: 'content_accessibility',
    artifact: 'public/llm-context.md',
    requirement: 'Offer dense Markdown context for agents that prefer text-first retrieval.',
  },
  {
    id: 'mcp_server_card',
    category: 'protocol_discovery',
    artifact: 'public/.well-known/mcp-server.json',
    requirement: 'Publish MCP discovery metadata for agent tools.',
  },
  {
    id: 'agent_skills',
    category: 'protocol_discovery',
    artifact: 'public/.well-known/agent-skills.json',
    requirement: 'Describe callable skills and evidence requirements.',
  },
  {
    id: 'oauth_protected_resource',
    category: 'api_auth',
    artifact: 'public/.well-known/oauth-protected-resource',
    requirement: 'Advertise protected API resource metadata when authenticated tools exist.',
  },
  {
    id: 'agentic_commerce',
    category: 'commerce',
    artifact: 'public/.well-known/agentic-commerce.json',
    requirement: 'Expose paid plan, checkout, refund, and support metadata for commerce agents.',
  },
];

function normalizeExisting(existing = []) {
  if (Array.isArray(existing)) return new Set(existing);
  return new Set(Object.entries(existing).filter(([, present]) => present).map(([id]) => id));
}

function buildAgentReadinessPlan(options = {}) {
  const baseUrl = options.baseUrl || 'https://thumbgate-production.up.railway.app';
  const existing = normalizeExisting(options.existing);
  const checks = (options.checks || DEFAULT_CHECKS).map((check) => {
    const present = existing.has(check.id) || existing.has(check.artifact);
    return {
      ...check,
      status: present ? 'present' : 'missing',
      url: check.artifact.startsWith('public/')
        ? `${baseUrl}/${check.artifact.replace(/^public\//, '')}`
        : `${baseUrl}/${check.artifact}`,
    };
  });
  const missing = checks.filter((check) => check.status === 'missing');

  return {
    baseUrl,
    score: Math.round(((checks.length - missing.length) / checks.length) * 100),
    checks,
    quickWins: missing
      .filter((check) => ['discoverability', 'content_accessibility', 'protocol_discovery'].includes(check.category))
      .slice(0, 5)
      .map((check) => ({
        id: check.id,
        action: `publish ${check.artifact}`,
        reason: check.requirement,
      })),
    promotionAngles: [
      'agent-ready pre-action gates',
      'MCP-discoverable reliability gateway',
      'machine-readable evidence before agent actions',
      'commerce metadata for paid operator lanes',
    ],
  };
}

function evaluateAgentReadinessPlan(plan) {
  const issues = [];
  const required = [
    'robots_ai_rules',
    'sitemap',
    'markdown_negotiation',
    'mcp_server_card',
  ];
  const byId = new Map((plan.checks || []).map((check) => [check.id, check]));

  for (const id of required) {
    if (byId.get(id)?.status !== 'present') issues.push(`missing_${id}`);
  }

  if (!plan.baseUrl || !plan.baseUrl.startsWith('https://')) {
    issues.push('https_base_url_required');
  }

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
    score: plan.score || 0,
  };
}

module.exports = {
  DEFAULT_CHECKS,
  buildAgentReadinessPlan,
  evaluateAgentReadinessPlan,
};
