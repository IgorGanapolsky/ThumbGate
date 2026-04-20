'use strict';

const DEFAULT_CHARS_PER_TOKEN = 4;
const DEFAULT_TARGET_REDUCTION = 0.22;

function normalizeRatio(value, fallback = DEFAULT_TARGET_REDUCTION) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n > 1) return n / 100;
  return n;
}

function stablePayload(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value == null ? '' : value, null, 2);
}

function estimateTokens(value, charsPerToken = DEFAULT_CHARS_PER_TOKEN) {
  const payload = stablePayload(value);
  const divisor = Math.max(1, Number(charsPerToken) || DEFAULT_CHARS_PER_TOKEN);
  return Math.ceil(payload.length / divisor);
}

function measureFootprint(baseline, optimized, options = {}) {
  const baselinePayload = stablePayload(baseline);
  const optimizedPayload = stablePayload(optimized);
  const baselineBytes = Buffer.byteLength(baselinePayload, 'utf8');
  const optimizedBytes = Buffer.byteLength(optimizedPayload, 'utf8');
  const baselineTokens = estimateTokens(baselinePayload, options.charsPerToken);
  const optimizedTokens = estimateTokens(optimizedPayload, options.charsPerToken);
  const bytesSaved = Math.max(0, baselineBytes - optimizedBytes);
  const tokensSaved = Math.max(0, baselineTokens - optimizedTokens);
  const reductionRatio = baselineBytes > 0 ? bytesSaved / baselineBytes : 0;

  return {
    baseline: {
      bytes: baselineBytes,
      estimatedTokens: baselineTokens,
    },
    optimized: {
      bytes: optimizedBytes,
      estimatedTokens: optimizedTokens,
    },
    savings: {
      bytes: bytesSaved,
      estimatedTokens: tokensSaved,
      reductionRatio,
      reductionPercent: Number((reductionRatio * 100).toFixed(1)),
      targetMet: reductionRatio >= normalizeRatio(options.targetReduction),
    },
  };
}

function toolSchemaUrl(schemaUrlTemplate, toolName) {
  const encodedName = encodeURIComponent(String(toolName || ''));
  const template = String(schemaUrlTemplate || '/.well-known/mcp/tools/{name}.json');
  return template.includes('{name}')
    ? template.replace('{name}', encodedName)
    : `${template.replace(/\/$/, '')}/${encodedName}.json`;
}

function normalizeToolForFullManifest(tool) {
  return {
    name: tool.name,
    description: tool.description,
    annotations: tool.annotations || {},
    inputSchema: tool.inputSchema || {},
  };
}

function normalizeToolForProgressiveManifest(tool, schemaUrlTemplate) {
  return {
    name: tool.name,
    description: tool.description,
    annotations: tool.annotations || {},
    schemaUrl: toolSchemaUrl(schemaUrlTemplate, tool.name),
  };
}

function buildMcpToolFootprintReport(tools = [], options = {}) {
  const toolList = Array.isArray(tools) ? tools : [];
  const schemaUrlTemplate = options.schemaUrlTemplate || '/.well-known/mcp/tools/{name}.json';
  const baseline = {
    pattern: 'preload-all-tool-schemas',
    tools: toolList.map(normalizeToolForFullManifest),
  };
  const optimized = {
    pattern: 'progressive-tool-discovery',
    tools: toolList.map((tool) => normalizeToolForProgressiveManifest(tool, schemaUrlTemplate)),
  };

  return {
    kind: 'mcp-tool-discovery',
    strategy: 'lossless-progressive-disclosure',
    toolCount: toolList.length,
    qualityContract: {
      behaviorPreserved: true,
      reason: 'Each omitted inputSchema is still available through the tool schema URL.',
      schemaUrlTemplate,
    },
    footprint: measureFootprint(baseline, optimized, {
      targetReduction: options.targetReduction,
      charsPerToken: options.charsPerToken,
    }),
  };
}

function buildFeedbackContextFootprintReport(entries = [], anchors = [], options = {}) {
  const { compactContext } = require('./context-engine');
  const safeEntries = Array.isArray(entries) ? entries : [];
  const safeAnchors = Array.isArray(anchors) ? anchors : [];
  const compaction = compactContext(safeEntries, safeAnchors, {
    windowSize: options.windowSize,
    perEntryMaxChars: options.perEntryMaxChars,
    totalMaxChars: options.totalMaxChars,
  });

  const anchorIds = new Set(safeAnchors.map((entry) => entry && entry.id).filter(Boolean));
  const optimizedAnchorIds = new Set(compaction.entries.map((entry) => entry && entry.id).filter(Boolean));
  const anchorsPreserved = Array.from(anchorIds).every((id) => optimizedAnchorIds.has(id));

  return {
    kind: 'feedback-context-compaction',
    strategy: 'bounded-context-compaction',
    qualityContract: {
      behaviorPreserved: false,
      anchorsPreserved,
      reason: 'Feedback context is intentionally bounded; anchor entries are preserved while stale or duplicate entries are removed.',
    },
    compaction: {
      stage: compaction.stage,
      removedCount: compaction.removedCount,
      compacted: compaction.compacted,
      baselineItems: safeEntries.length,
      optimizedItems: compaction.entries.length,
    },
    footprint: measureFootprint(safeEntries, compaction.entries, {
      targetReduction: options.targetReduction,
      charsPerToken: options.charsPerToken,
    }),
  };
}

function buildContextFootprintReport(options = {}) {
  const targetReduction = normalizeRatio(options.targetReduction);
  const report = {
    name: 'thumbgate-context-footprint',
    targetReduction,
    sourcePattern: 'Compress the bottleneck without changing the behavior agents rely on.',
    recommendations: [
      'Load the MCP tool index first; fetch one tool schema only when the agent selects that tool.',
      'Use construct_context_pack with maxChars before injecting lessons into a model prompt.',
      'Keep gate ids, proof URLs, and anchor lessons stable so compaction does not hide evidence.',
      'Track estimated token savings beside every optimized context path.',
    ],
  };

  if (Array.isArray(options.tools)) {
    report.mcpToolDiscovery = buildMcpToolFootprintReport(options.tools, {
      schemaUrlTemplate: options.schemaUrlTemplate,
      targetReduction,
      charsPerToken: options.charsPerToken,
    });
  }

  if (Array.isArray(options.entries)) {
    report.feedbackContext = buildFeedbackContextFootprintReport(
      options.entries,
      options.anchors,
      {
        windowSize: options.windowSize,
        perEntryMaxChars: options.perEntryMaxChars,
        totalMaxChars: options.totalMaxChars,
        targetReduction,
        charsPerToken: options.charsPerToken,
      },
    );
  }

  return report;
}

module.exports = {
  DEFAULT_CHARS_PER_TOKEN,
  DEFAULT_TARGET_REDUCTION,
  estimateTokens,
  measureFootprint,
  buildMcpToolFootprintReport,
  buildFeedbackContextFootprintReport,
  buildContextFootprintReport,
};
