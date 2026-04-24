#!/usr/bin/env node
'use strict';

const DEFAULT_SOFT_TOKEN_LIMIT = 8000;

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

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (!value) return 'unknown';
  if (value.includes('anthropic') || value.includes('claude')) return 'anthropic';
  if (value.includes('openai') || value.includes('chatgpt') || value.includes('gpt')) return 'openai';
  if (value.includes('codex')) return 'codex';
  if (value.includes('gemini')) return 'gemini';
  if (value.includes('cursor')) return 'cursor';
  return value.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
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
  if (normalizedTool === 'Bash' || /bash|shell|terminal|exec|run_command/i.test(normalizedTool)) {
    return 'shell.exec';
  }
  if (EDIT_TOOL_NAMES.has(normalizedTool) || /edit|write|patch|file/i.test(normalizedTool)) {
    return 'file.write';
  }
  if (/fetch|request|http|browser/i.test(normalizedTool)) {
    return 'network.request';
  }
  return 'tool.call';
}

function inferIntent({ actionType, command, affectedFiles }) {
  const text = String(command || '').toLowerCase();
  if (actionType === 'context.read') return 'read-context';
  if (actionType === 'prompt.get') return 'load-prompt-template';
  if (/\b(?:npm|yarn|pnpm)\s+publish\b/.test(text) || /\bgh\s+release\s+create\b/.test(text)) {
    return 'publish';
  }
  if (/\bgh\s+pr\s+merge\b/.test(text) || /\bgit\s+push\b/.test(text)) {
    return 'release-workflow';
  }
  if (/\b(?:npm|node|yarn|pnpm)\s+(?:test|run test)|\bpytest\b|\bgo test\b/.test(text)) {
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
  normalizeBudget,
  normalizeProvider,
  normalizeProviderAction,
};
