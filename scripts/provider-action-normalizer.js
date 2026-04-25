#!/usr/bin/env node
'use strict';

const DEFAULT_SOFT_TOKEN_LIMIT = 8000;
const DEFAULT_MAX_PARALLEL_BRANCHES = 4;

const EDIT_TOOL_NAMES = new Set(['Edit', 'Write', 'MultiEdit', 'file.write']);
const MCP_PRIMITIVE_BY_METHOD = {
  'tools/call': 'tool',
  'resources/read': 'resource',
  'prompts/get': 'prompt',
};

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function appendDashOnce(output) {
  if (output.endsWith('-')) return output;
  return `${output}-`;
}

function isAsciiAlphanumeric(ch) {
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

function isWhitespace(ch) {
  const code = ch.charCodeAt(0);
  return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32;
}

function trimDashes(value) {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '-') start += 1;
  while (end > start && value[end - 1] === '-') end -= 1;
  return value.slice(start, end);
}

function normalizeToken(value, allowedPunctuation = '._-') {
  const text = String(value || '').trim().toLowerCase();
  let output = '';
  for (const ch of text) {
    if (isAsciiAlphanumeric(ch) || allowedPunctuation.includes(ch)) {
      output += ch;
      continue;
    }
    output = appendDashOnce(output);
  }
  return trimDashes(output);
}

function normalizeCommandText(value) {
  const text = String(value || '').trim().toLowerCase();
  let output = '';
  for (const ch of text) {
    if (isWhitespace(ch)) {
      output = output.endsWith(' ') ? output : `${output} `;
      continue;
    }
    output += ch;
  }
  return output.trim();
}

function containsAny(value, needles) {
  return needles.some((needle) => value.includes(needle));
}

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (!value) return 'unknown';
  if (value.includes('anthropic') || value.includes('claude')) return 'anthropic';
  if (value.includes('openai') || value.includes('chatgpt') || value.includes('gpt')) return 'openai';
  if (value.includes('codex')) return 'codex';
  if (value.includes('gemini')) return 'gemini';
  if (value.includes('cursor')) return 'cursor';
  return normalizeToken(value) || 'unknown';
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return 0;
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return asObject(parsed);
  } catch {
    return {};
  }
}

function extractAnthropicToolCall(input) {
  const direct = firstObject(input.toolCall, input.toolUse, input.providerToolCall);
  if (direct.name || direct.input) return direct;

  const content = asArray(input.content);
  return content.find((entry) => entry && entry.type === 'tool_use') || {};
}

function extractOpenAiToolCall(input) {
  const direct = firstObject(input.toolCall, input.functionCall, input.providerToolCall);
  const fn = firstObject(direct.function, input.function);
  if (fn.name || fn.arguments) {
    return {
      id: direct.id,
      name: fn.name,
      arguments: parseJsonObject(fn.arguments),
    };
  }
  if (direct.name || direct.arguments) {
    return {
      id: direct.id,
      name: direct.name,
      arguments: parseJsonObject(direct.arguments),
    };
  }
  return {};
}

function extractMcpToolCall(input) {
  const direct = firstObject(input.mcp, input.mcpToolCall);
  if (direct.name || direct.arguments || direct.uri) return direct;

  if (MCP_PRIMITIVE_BY_METHOD[input.method]) {
    const params = firstObject(input.params);
    return {
      name: params.name || params.uri,
      arguments: params.arguments,
      server: params.server,
      primitive: MCP_PRIMITIVE_BY_METHOD[input.method],
      uri: params.uri,
    };
  }

  return {};
}

function extractToolInput(input) {
  const anthropic = extractAnthropicToolCall(input);
  const openai = extractOpenAiToolCall(input);
  const mcp = extractMcpToolCall(input);
  return firstObject(
    input.toolInput,
    input.input,
    input.arguments,
    anthropic.input,
    openai.arguments,
    mcp.arguments,
    input.providerToolCall && input.providerToolCall.input,
    mcp.uri ? { uri: mcp.uri } : {}
  );
}

function extractToolName(input) {
  const anthropic = extractAnthropicToolCall(input);
  const openai = extractOpenAiToolCall(input);
  const mcp = extractMcpToolCall(input);
  return firstString(
    input.toolName,
    input.tool_name,
    input.name,
    anthropic.name,
    openai.name,
    mcp.name,
    input.providerToolCall && input.providerToolCall.name
  );
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function collectAffectedFiles(toolInput = {}, fallback = {}) {
  const files = [
    ...asArray(toolInput.changedFiles),
    ...asArray(toolInput.changed_files),
    ...asArray(toolInput.files),
    ...asArray(toolInput.filePaths),
    ...asArray(toolInput.file_paths),
    ...asArray(toolInput.paths),
    ...asArray(fallback.changedFiles),
    ...asArray(fallback.changed_files),
    toolInput.filePath,
    toolInput.file_path,
    toolInput.path,
    fallback.filePath,
    fallback.file_path,
    fallback.path,
  ];
  return uniqueStrings(files);
}

function inferCommand(toolName, toolInput = {}, fallback = {}) {
  return firstString(
    toolInput.command,
    toolInput.cmd,
    toolInput.shell,
    fallback.command,
    fallback.cmd
  );
}

function inferActionType(toolName, toolInput = {}, fallback = {}) {
  const explicit = firstString(fallback.actionType, toolInput.actionType, toolInput.action_type);
  if (explicit) return explicit;
  if (fallback.method === 'resources/read') return 'context.read';
  if (fallback.method === 'prompts/get') return 'prompt.get';
  const normalizedTool = String(toolName || '').trim();
  const lowerTool = normalizedTool.toLowerCase();
  if (normalizedTool === 'Bash' || containsAny(lowerTool, ['bash', 'shell', 'terminal', 'exec', 'run_command'])) {
    return 'shell.exec';
  }
  if (EDIT_TOOL_NAMES.has(normalizedTool) || containsAny(lowerTool, ['edit', 'write', 'patch', 'file'])) {
    return 'file.write';
  }
  if (containsAny(lowerTool, ['fetch', 'request', 'http', 'browser'])) {
    return 'network.request';
  }
  return 'tool.call';
}

function inferIntent({ actionType, command, affectedFiles }) {
  const text = normalizeCommandText(command);
  if (actionType === 'context.read') return 'read-context';
  if (actionType === 'prompt.get') return 'load-prompt-template';
  if (containsAny(text, ['npm publish', 'yarn publish', 'pnpm publish', 'gh release create'])) {
    return 'publish';
  }
  if (containsAny(text, ['gh pr merge', 'git push'])) {
    return 'release-workflow';
  }
  if (containsAny(text, ['npm test', 'npm run test', 'node test', 'node run test', 'yarn test', 'yarn run test', 'pnpm test', 'pnpm run test', 'pytest', 'go test'])) {
    return 'verify';
  }
  if (actionType === 'file.write' && affectedFiles.length > 0) {
    return 'modify-files';
  }
  return actionType === 'shell.exec' ? 'run-command' : 'use-tool';
}

function normalizeUsage(input = {}, toolInput = {}) {
  const usage = firstObject(input.usage, input.tokenUsage, toolInput.usage);
  const inputTokens = firstNumber(
    usage.input_tokens,
    usage.inputTokens,
    usage.prompt_tokens,
    usage.promptTokens,
    input.inputTokens
  );
  const outputTokens = firstNumber(
    usage.output_tokens,
    usage.outputTokens,
    usage.completion_tokens,
    usage.completionTokens,
    input.outputTokens
  );
  const totalTokens = firstNumber(
    input.tokenEstimate,
    input.estimatedTokens,
    usage.total_tokens,
    usage.totalTokens,
    inputTokens + outputTokens
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: firstNumber(input.costUsd, input.estimatedCostUsd, usage.costUsd, usage.estimatedCostUsd),
  };
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return uniqueStrings(value);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeWorkflowPattern(value) {
  const text = normalizeToken(value, '.-');
  if (!text) return '';
  if (['parallel', 'parallelization', 'fanout', 'fan-out'].includes(text)) return 'parallelization';
  if (['chain', 'chaining', 'sequential'].includes(text)) return 'chaining';
  if (['route', 'routing', 'classifier'].includes(text)) return 'routing';
  if (['evaluator', 'optimizer', 'evaluator-optimizer', 'grader'].includes(text)) return 'evaluator-optimizer';
  if (['agent', 'agentic', 'autonomous-agent'].includes(text)) return 'agent';
  if (['workflow', 'single', 'single-action'].includes(text)) return 'single_action';
  return text || '';
}

function inferWorkflowPattern(source = {}, toolInput = {}) {
  const explicit = normalizeWorkflowPattern(firstString(
    source.workflowPattern,
    source.workflow_pattern,
    source.workflow && source.workflow.pattern,
    toolInput.workflowPattern,
    toolInput.workflow_pattern,
    toolInput.workflow && toolInput.workflow.pattern,
    source.pattern,
    toolInput.pattern
  ));
  if (explicit) return explicit;

  const routes = firstArray(source.routes, toolInput.routes, source.workflow && source.workflow.routes, toolInput.workflow && toolInput.workflow.routes);
  const branches = firstArray(
    source.branches,
    source.subTasks,
    source.subtasks,
    source.parallelBranches,
    toolInput.branches,
    toolInput.subTasks,
    toolInput.subtasks,
    toolInput.parallelBranches,
    source.workflow && source.workflow.branches,
    toolInput.workflow && toolInput.workflow.branches
  );
  const steps = firstArray(source.steps, toolInput.steps, source.workflow && source.workflow.steps, toolInput.workflow && toolInput.workflow.steps);

  if (source.agent === true || source.isAgent === true || toolInput.agent === true || toolInput.isAgent === true) return 'agent';
  if (routes.length > 0) return 'routing';
  if (branches.length > 1 || source.parallel === true || toolInput.parallel === true) return 'parallelization';
  if (steps.length > 1) return 'chaining';
  if (source.evaluator || source.grader || source.optimizer || toolInput.evaluator || toolInput.grader || toolInput.optimizer) return 'evaluator-optimizer';
  if ((source.goal || toolInput.goal) && firstArray(source.tools, toolInput.tools).length > 0) return 'agent';
  return 'single_action';
}

function hasInspectionEvidence(source = {}, toolInput = {}) {
  const workflow = firstObject(source.workflow, toolInput.workflow);
  const verification = firstObject(source.verification, toolInput.verification, workflow.verification);
  const inspection = firstObject(source.inspection, toolInput.inspection, workflow.inspection);
  const checks = [
    source.observesAfterAction,
    source.observeAfterAction,
    source.readBeforeWrite,
    source.postActionObservation,
    toolInput.observesAfterAction,
    toolInput.observeAfterAction,
    toolInput.readBeforeWrite,
    toolInput.postActionObservation,
    workflow.observesAfterAction,
    workflow.readBeforeWrite,
    verification.required,
    verification.expectedResult,
    verification.command,
    verification.apiResponse,
    verification.screenshot,
    inspection.required,
    inspection.expectedObservation,
    inspection.screenshot,
    inspection.apiResponse,
  ];
  if (checks.some(Boolean)) return true;
  return normalizeStringArray(source.evidence).length > 0
    || normalizeStringArray(toolInput.evidence).length > 0
    || normalizeStringArray(source.checks).length > 0
    || normalizeStringArray(toolInput.checks).length > 0
    || normalizeStringArray(workflow.checks).length > 0;
}

function normalizeWorkflow(source = {}, toolInput = {}) {
  const workflow = firstObject(source.workflow, toolInput.workflow);
  const branches = firstArray(
    source.branches,
    source.subTasks,
    source.subtasks,
    source.parallelBranches,
    toolInput.branches,
    toolInput.subTasks,
    toolInput.subtasks,
    toolInput.parallelBranches,
    workflow.branches,
    workflow.subTasks,
    workflow.subtasks
  );
  const steps = firstArray(source.steps, toolInput.steps, workflow.steps);
  const routes = firstArray(source.routes, toolInput.routes, workflow.routes);
  const tools = firstArray(source.tools, toolInput.tools, workflow.tools);
  const pattern = inferWorkflowPattern(source, toolInput);
  const branchCount = firstNumber(
    source.branchCount,
    toolInput.branchCount,
    workflow.branchCount,
    branches.length
  );
  const stepCount = firstNumber(
    source.stepCount,
    toolInput.stepCount,
    workflow.stepCount,
    steps.length
  );
  const toolCount = firstNumber(
    source.toolCount,
    toolInput.toolCount,
    workflow.toolCount,
    tools.length
  );
  const routeCount = firstNumber(
    source.routeCount,
    toolInput.routeCount,
    workflow.routeCount,
    routes.length
  );
  const inspectionEvidence = hasInspectionEvidence(source, toolInput);
  const requiresInspection = Boolean(
    pattern === 'agent'
      || pattern === 'parallelization'
      || source.requiresInspection
      || toolInput.requiresInspection
      || workflow.requiresInspection
  );

  return {
    pattern,
    branchCount,
    stepCount,
    toolCount,
    routeCount,
    hasInspectionEvidence: inspectionEvidence,
    requiresInspection,
    isOpenEndedAgent: pattern === 'agent',
    isPredefinedWorkflow: ['single_action', 'chaining', 'routing', 'parallelization', 'evaluator-optimizer'].includes(pattern),
  };
}

function normalizeProviderAction(input = {}) {
  const source = asObject(input);
  const toolInput = extractToolInput(source);
  const toolName = extractToolName(source);
  const command = inferCommand(toolName, toolInput, source);
  const affectedFiles = collectAffectedFiles(toolInput, source);
  const actionType = inferActionType(toolName, toolInput, source);
  const usage = normalizeUsage(source, toolInput);
  const provider = normalizeProvider(firstString(source.provider, source.providerName, source.modelProvider));
  const openai = extractOpenAiToolCall(source);
  const mcp = extractMcpToolCall(source);
  return {
    schemaVersion: 'provider-action-v1',
    provider: mcp.name ? 'mcp' : provider,
    model: firstString(source.model, source.modelName),
    providerCallId: firstString(source.id, source.toolUseId, source.tool_call_id, source.toolCallId, openai.id),
    mcpServer: firstString(source.mcpServer, mcp.server, source.serverName),
    mcpPrimitive: firstString(mcp.primitive, mcp.name ? 'tool' : ''),
    toolName: toolName || (actionType === 'shell.exec' ? 'Bash' : 'Tool'),
    toolInput,
    command,
    actionType,
    intent: inferIntent({ actionType, command, affectedFiles }),
    affectedFiles,
    usage,
    workflow: normalizeWorkflow(source, toolInput),
    rawShape: {
      hasProviderToolCall: Boolean(source.providerToolCall || source.toolCall || source.toolUse),
      hasOpenAiToolCall: Boolean(extractOpenAiToolCall(source).name),
      hasAnthropicToolUse: asArray(source.content).some((entry) => entry && entry.type === 'tool_use'),
      hasMcpToolCall: Boolean(mcp.name || MCP_PRIMITIVE_BY_METHOD[source.method]),
    },
  };
}

function normalizeBudget(input = {}) {
  const budget = asObject(input);
  return {
    maxTokensPerAction: firstNumber(budget.maxTokensPerAction, budget.perActionTokens, budget.tokenLimit),
    remainingTokens: firstNumber(budget.remainingTokens, budget.tokensRemaining),
    maxCostUsdPerAction: firstNumber(budget.maxCostUsdPerAction, budget.perActionCostUsd, budget.costLimitUsd),
    remainingCostUsd: firstNumber(budget.remainingCostUsd, budget.costUsdRemaining),
    maxParallelBranches: firstNumber(budget.maxParallelBranches, budget.parallelBranchLimit, DEFAULT_MAX_PARALLEL_BRANCHES),
  };
}

function buildWorkflowControl(normalizedAction = {}, policyInput = {}) {
  const workflow = asObject(normalizedAction.workflow);
  const policy = asObject(policyInput);
  const reasons = [];
  const warnings = [];
  const maxParallelBranches = firstNumber(
    policy.maxParallelBranches,
    policy.parallelBranchLimit,
    DEFAULT_MAX_PARALLEL_BRANCHES
  );
  const requireInspectionForAgents = policy.requireInspectionForAgents !== false;

  if (workflow.pattern === 'agent' && requireInspectionForAgents && !workflow.hasInspectionEvidence) {
    reasons.push('Open-ended agent actions must declare environment-inspection or verification evidence before execution.');
  }
  if (workflow.requiresInspection && !workflow.hasInspectionEvidence && workflow.pattern !== 'agent') {
    warnings.push('Workflow declares inspection-sensitive behavior but does not include explicit post-action verification evidence.');
  }
  if (maxParallelBranches > 0 && workflow.branchCount > maxParallelBranches) {
    reasons.push(`Parallel workflow branch count ${workflow.branchCount} exceeds limit ${maxParallelBranches}.`);
  }

  return {
    mode: reasons.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'allow',
    workflow,
    reasons: reasons.concat(warnings),
    policy: {
      maxParallelBranches,
      requireInspectionForAgents,
    },
  };
}

function buildCostControl(normalizedAction = {}, budgetInput = {}) {
  const usage = asObject(normalizedAction.usage);
  const budget = normalizeBudget(budgetInput);
  const reasons = [];
  const totalTokens = firstNumber(usage.totalTokens);
  const estimatedCostUsd = firstNumber(usage.estimatedCostUsd);

  if (budget.maxTokensPerAction > 0 && totalTokens > budget.maxTokensPerAction) {
    reasons.push(`Token estimate ${totalTokens} exceeds per-action limit ${budget.maxTokensPerAction}.`);
  }
  if (budget.remainingTokens > 0 && totalTokens > budget.remainingTokens) {
    reasons.push(`Token estimate ${totalTokens} exceeds remaining budget ${budget.remainingTokens}.`);
  }
  if (budget.maxCostUsdPerAction > 0 && estimatedCostUsd > budget.maxCostUsdPerAction) {
    reasons.push(`Estimated cost $${estimatedCostUsd.toFixed(4)} exceeds per-action limit $${budget.maxCostUsdPerAction.toFixed(4)}.`);
  }
  if (budget.remainingCostUsd > 0 && estimatedCostUsd > budget.remainingCostUsd) {
    reasons.push(`Estimated cost $${estimatedCostUsd.toFixed(4)} exceeds remaining budget $${budget.remainingCostUsd.toFixed(4)}.`);
  }
  if (budget.maxParallelBranches > 0 && normalizedAction.workflow?.branchCount > budget.maxParallelBranches) {
    reasons.push(`Parallel workflow branch count ${normalizedAction.workflow.branchCount} exceeds budget limit ${budget.maxParallelBranches}.`);
  }

  const softWarning = reasons.length === 0 && totalTokens >= DEFAULT_SOFT_TOKEN_LIMIT
    ? [`Token estimate ${totalTokens} is above the ${DEFAULT_SOFT_TOKEN_LIMIT} token review threshold.`]
    : [];
  const mode = reasons.length > 0 ? 'block' : softWarning.length > 0 ? 'warn' : 'allow';

  return {
    mode,
    budget,
    usage: {
      totalTokens,
      inputTokens: firstNumber(usage.inputTokens),
      outputTokens: firstNumber(usage.outputTokens),
      estimatedCostUsd,
    },
    reasons: reasons.concat(softWarning),
  };
}

module.exports = {
  DEFAULT_SOFT_TOKEN_LIMIT,
  buildCostControl,
  buildWorkflowControl,
  normalizeBudget,
  normalizeProvider,
  normalizeProviderAction,
  normalizeWorkflow,
};
