#!/usr/bin/env node
'use strict';

const { listGateTemplates } = require('./gate-templates');

const AI_STACK_CATEGORY = 'AI Engineering Stack Safety';
const AI_STACK_TEMPLATE_IDS = new Set([
  'require-ai-gateway-control-plane',
  'require-progressive-mcp-tool-discovery',
  'require-agent-context-freshness',
  'require-risk-tiered-ai-review',
  'require-sandboxed-background-agent-runtime',
]);

function splitCsv(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (value === undefined || value === null || value === true) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeOptions(options = {}) {
  const mcpToolCount = toNumber(options['mcp-tool-count'] || options.tools || options['tool-count']);
  const gateway = normalizeBoolean(options.gateway || options['ai-gateway'] || options.proxy || options['proxy-worker']);
  const directProviderKeys = normalizeBoolean(options['direct-provider-keys'] || options['keys-on-laptops']);
  const codeMode = normalizeBoolean(options['code-mode'] || options['progressive-discovery']);
  const agentsMd = normalizeBoolean(options['agents-md'] || options['agent-context']);
  const llmWikiPages = toNumber(options['llm-wiki-pages'] || options['wiki-pages']);
  const contextFreshnessDays = toNumber(options['context-freshness-days'] || options['stale-days']);
  const aiReviewer = normalizeBoolean(options['ai-reviewer'] || options.reviewer);
  const codexRules = normalizeBoolean(options['codex-rules'] || options['standards-as-skills'] || options.skills);
  const backgroundAgents = normalizeBoolean(options['background-agents'] || options['durable-agents']);
  const sandbox = normalizeBoolean(options.sandbox || options['sandbox-sdk'] || options['isolated-runtime']);
  const workflows = splitCsv(options.workflows || options.workflow);
  const highRiskWorkflows = splitCsv(options['high-risk-workflows'] || options['risky-workflows']);

  return {
    stackName: String(options.stack || options['stack-name'] || 'internal-ai-engineering-stack').trim() || 'internal-ai-engineering-stack',
    gateway,
    directProviderKeys,
    mcpToolCount,
    codeMode,
    agentsMd,
    llmWikiPages,
    contextFreshnessDays,
    aiReviewer,
    codexRules,
    backgroundAgents,
    sandbox,
    workflows,
    highRiskWorkflows,
  };
}

function templateApplicability(template, options) {
  if (template.id === 'require-ai-gateway-control-plane') {
    return options.directProviderKeys || !options.gateway;
  }
  if (template.id === 'require-progressive-mcp-tool-discovery') {
    return (options.mcpToolCount !== null && options.mcpToolCount >= 20) || !options.codeMode;
  }
  if (template.id === 'require-agent-context-freshness') {
    return !options.agentsMd ||
      (options.llmWikiPages !== null && options.llmWikiPages > 0) ||
      (options.contextFreshnessDays !== null && options.contextFreshnessDays > 14);
  }
  if (template.id === 'require-risk-tiered-ai-review') {
    return !options.aiReviewer || !options.codexRules || options.highRiskWorkflows.length > 0;
  }
  if (template.id === 'require-sandboxed-background-agent-runtime') {
    return options.backgroundAgents && !options.sandbox;
  }
  return false;
}

function buildSignals(options) {
  return [
    gatewaySignal(options),
    mcpContextSignal(options),
    contextFreshnessSignal(options),
    reviewEnforcementSignal(options),
    backgroundRuntimeSignal(options),
  ].filter(Boolean);
}

function gatewaySignal(options) {
  if (options.gateway && !options.directProviderKeys) return null;
  return {
    id: 'gateway_control_plane',
    label: 'Model gateway control plane',
    values: [
      options.gateway ? 'gateway present' : 'gateway missing',
      options.directProviderKeys ? 'direct provider keys detected' : null,
    ].filter(Boolean),
    risk: 'AI usage, keys, cost attribution, and data-retention controls fragment across clients',
  };
}

function mcpContextSignal(options) {
  if (!((options.mcpToolCount !== null && options.mcpToolCount >= 20) || !options.codeMode)) return null;
  return {
    id: 'mcp_context_bloat',
    label: 'MCP tool schema overhead',
    values: [
      options.mcpToolCount !== null ? `${options.mcpToolCount} MCP tools` : null,
      options.codeMode ? 'progressive discovery enabled' : 'code mode missing',
    ].filter(Boolean),
    risk: 'large tool schemas consume prompt budget before the agent starts work',
  };
}

function contextFreshnessSignal(options) {
  if (options.agentsMd && options.llmWikiPages === null && options.contextFreshnessDays === null) return null;
  return {
    id: 'agent_context_freshness',
    label: 'AGENTS.md and LLM wiki freshness',
    values: [
      options.agentsMd ? 'AGENTS.md present' : 'AGENTS.md missing',
      options.llmWikiPages !== null ? `${options.llmWikiPages} LLM wiki pages` : null,
      options.contextFreshnessDays !== null ? `${options.contextFreshnessDays} days since refresh` : null,
    ].filter(Boolean),
    risk: 'agents act on stale repo conventions, ownership, tests, or system dependencies',
  };
}

function reviewEnforcementSignal(options) {
  if (options.aiReviewer && options.codexRules && options.highRiskWorkflows.length === 0) return null;
  return {
    id: 'review_enforcement_gap',
    label: 'Risk-tiered AI review and standards',
    values: [
      options.aiReviewer ? 'AI reviewer present' : 'AI reviewer missing',
      options.codexRules ? 'standards-as-skills present' : 'codex rules missing',
      ...options.highRiskWorkflows,
    ].filter(Boolean),
    risk: 'agent changes ship without repeatable severity, category, and rule-id feedback',
  };
}

function backgroundRuntimeSignal(options) {
  if (!options.backgroundAgents && options.sandbox) return null;
  return {
    id: 'background_agent_runtime',
    label: 'Background agent runtime isolation',
    values: [
      options.backgroundAgents ? 'background agents enabled' : 'background agents not declared',
      options.sandbox ? 'sandbox present' : 'sandbox missing',
    ].filter(Boolean),
    risk: 'long-running agents can clone, build, test, or publish without durable audit and isolation',
  };
}

function buildAiEngineeringStackGuardrailsPlan(rawOptions = {}, templatesPath) {
  const options = normalizeOptions(rawOptions);
  const templates = listGateTemplates(templatesPath)
    .filter((template) => template.category === AI_STACK_CATEGORY && AI_STACK_TEMPLATE_IDS.has(template.id))
    .map((template) => ({
      ...template,
      recommended: templateApplicability(template, options),
    }));
  const signals = buildSignals(options);
  const recommendedTemplates = templates.filter((template) => template.recommended);

  return {
    name: 'thumbgate-ai-engineering-stack-guardrails',
    status: recommendedTemplates.length > 0 ? 'actionable' : 'ready',
    stackName: options.stackName,
    posture: {
      gateway: options.gateway,
      directProviderKeys: options.directProviderKeys,
      mcpToolCount: options.mcpToolCount,
      codeMode: options.codeMode,
      agentsMd: options.agentsMd,
      llmWikiPages: options.llmWikiPages,
      contextFreshnessDays: options.contextFreshnessDays,
      aiReviewer: options.aiReviewer,
      codexRules: options.codexRules,
      backgroundAgents: options.backgroundAgents,
      sandbox: options.sandbox,
      workflows: options.workflows,
      highRiskWorkflows: options.highRiskWorkflows,
    },
    summary: {
      signalCount: signals.length,
      templateCount: templates.length,
      recommendedTemplateCount: recommendedTemplates.length,
    },
    signals,
    templates,
    nextActions: [
      'Put every model request behind one gateway/proxy so keys, cost, provider routing, and retention policy are centralized.',
      'Collapse large MCP surfaces behind progressive discovery or code-mode search/execute tools before schema bloat burns context.',
      'Generate short AGENTS.md and LLM wiki pages from source metadata, then gate stale context when repo structure changes.',
      'Require risk-tiered AI review that cites standards-as-skills before high-risk agent changes merge.',
      'Run background agents in isolated, durable environments with build/test logs and resumable session state.',
    ],
    exampleCommand: 'npx thumbgate ai-engineering-stack-guardrails --mcp-tool-count=182 --direct-provider-keys --llm-wiki-pages=24 --context-freshness-days=30 --background-agents --high-risk-workflows=deploy,billing --json',
  };
}

function formatAiEngineeringStackGuardrailsPlan(report) {
  const lines = [
    '',
    'ThumbGate AI Engineering Stack Guardrails',
    '-'.repeat(43),
    `Status   : ${report.status}`,
    `Stack    : ${report.stackName}`,
    `Signals  : ${report.summary.signalCount}`,
    `Templates: ${report.summary.recommendedTemplateCount}/${report.summary.templateCount} recommended`,
  ];

  if (report.signals.length > 0) {
    lines.push('', 'Detected stack risk signals:');
    for (const signal of report.signals) {
      lines.push(`  - ${signal.label}: ${signal.values.join(', ') || 'needs evidence'}`);
      lines.push(`    Risk: ${signal.risk}`);
    }
  }

  lines.push('', 'Recommended templates:');
  const recommended = report.templates.filter((template) => template.recommended);
  if (recommended.length === 0) {
    lines.push('  - No AI-stack gaps were passed. Keep monitoring gateway, MCP, context, review, and sandbox evidence.');
  } else {
    for (const template of recommended) {
      lines.push(`  - ${template.id} [${template.defaultAction}]`);
      lines.push(`    ${template.roi}`);
    }
  }

  lines.push('', 'Next actions:');
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  lines.push('', `Example: ${report.exampleCommand}`, '');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  AI_STACK_CATEGORY,
  buildAiEngineeringStackGuardrailsPlan,
  formatAiEngineeringStackGuardrailsPlan,
  normalizeOptions,
};
