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

function renderSymbolicTaskCanvas(options = {}) {
  const activeTask = options.activeTask || 'Execute Task';
  const milestones = Array.isArray(options.milestones) ? options.milestones : [];
  const blockers = Array.isArray(options.blockers) ? options.blockers : [];

  let mermaidDiagram = 'graph TD\n';
  mermaidDiagram += `  Start["Task Goal: ${activeTask}"]\n`;

  if (milestones.length === 0) {
    mermaidDiagram += '  Start --> Step1["In Progress"]\n';
  } else {
    let prevId = 'Start';
    milestones.forEach((m, idx) => {
      const stepId = `Step${idx + 1}`;
      const status = m.status === 'completed' ? ' [DONE]' : m.status === 'blocked' ? ' [BLOCKED]' : ' [IN_PROGRESS]';
      const label = `${m.name || m.title || `Milestone ${idx + 1}`}${status}`;
      mermaidDiagram += `  ${prevId} --> ${stepId}["${label.replace(/"/g, "'")}"]\n`;
      prevId = stepId;
    });
  }

  if (blockers.length > 0) {
    blockers.forEach((b, idx) => {
      mermaidDiagram += `  Blocker${idx + 1}["BLOCKED: ${String(b).replace(/"/g, "'")}"] -.-> Start\n`;
    });
  }

  const canvasText = [
    `# Symbolic Task Canvas: ${activeTask}`,
    `**Milestones:** ${milestones.length}`,
    `**Blockers:** ${blockers.length}`,
    '```mermaid',
    mermaidDiagram.trim(),
    '```',
  ].join('\n');

  return {
    canvasText,
    mermaidDiagram,
    activeTask,
    milestoneCount: milestones.length,
    blockerCount: blockers.length,
  };
}

function compactSymbolicTaskCanvas(entries = [], options = {}) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const activeTask = options.activeTask || 'Active Session Task';
  const milestones = [];
  const blockers = [];

  for (const entry of safeEntries) {
    if (!entry) continue;
    const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
    if (/block|fail|error/i.test(text)) {
      blockers.push(text.slice(0, 80));
    } else {
      milestones.push({ name: text.slice(0, 60), status: /done|pass|success/i.test(text) ? 'completed' : 'in_progress' });
    }
  }

  const canvas = renderSymbolicTaskCanvas({ activeTask, milestones: milestones.slice(0, 5), blockers: blockers.slice(0, 3) });
  const footprint = measureFootprint(safeEntries, canvas.canvasText, {
    targetReduction: options.targetReduction || 0.5,
    charsPerToken: options.charsPerToken,
  });

  return {
    kind: 'symbolic-task-canvas',
    strategy: 'symbolic-state-offloading',
    canvas,
    footprint,
  };
}

function isPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

function buildMatryoshkaEmbeddingReport(options = {}) {
  const defaults = {
    fullDimension: 1536,
    targetDimensions: [768, 512, 256, 128],
    itemCount: 1000,
  };

  const fullDimensionRaw = options.fullDimension == null ? defaults.fullDimension : options.fullDimension;
  if (!isPositiveInt(fullDimensionRaw)) {
    throw new Error('matryoshkaOptions.fullDimension must be a positive integer');
  }
  const fullDimension = Number(fullDimensionRaw);

  const itemsRaw = options.itemCount == null ? defaults.itemCount : options.itemCount;
  if (!isPositiveInt(itemsRaw)) {
    throw new Error('matryoshkaOptions.itemCount must be a positive integer');
  }
  const items = Number(itemsRaw);

  let targetDimensions;
  if (Array.isArray(options.targetDimensions) && options.targetDimensions.length > 0) {
    targetDimensions = options.targetDimensions.map(Number);
    for (const dim of targetDimensions) {
      if (!isPositiveInt(dim)) {
        throw new Error('matryoshkaOptions.targetDimensions must be positive integers');
      }
      if (dim > fullDimension) {
        throw new Error('matryoshkaOptions.targetDimensions must be <= fullDimension');
      }
    }
  } else {
    targetDimensions = defaults.targetDimensions.filter((dim) => dim <= fullDimension);
  }

  if (targetDimensions.length === 0) {
    throw new Error('matryoshkaOptions.targetDimensions must include at least one valid dimension');
  }

  const baselineBytes = items * fullDimension * 4;
  const qualityVerified = options.qualityVerified === true
    && options.behaviorPreserved === true
    && Number.isFinite(Number(options.accuracyLossEstimatePct));

  const tiers = targetDimensions.map((dim) => {
    const dimBytes = items * dim * 4;
    const reductionRatio = baselineBytes > 0 ? (baselineBytes - dimBytes) / baselineBytes : 0;
    return {
      dimension: dim,
      bytesPerItem: dim * 4,
      totalBytes: dimBytes,
      reductionPercent: Number((reductionRatio * 100).toFixed(1)),
      estimatedMemorySavingsBytes: Math.max(0, baselineBytes - dimBytes),
      recommendedUsage:
        dim <= 256
          ? 'Fast coarse vector filtering & initial top-K candidate pooling'
          : 'High-precision re-ranking & final gate evaluation',
    };
  });

  return {
    kind: 'matryoshka-embedding-compaction',
    strategy: 'matryoshka-representation-learning-mrl',
    fullDimension,
    itemCount: items,
    baselineTotalBytes: baselineBytes,
    qualityContract: qualityVerified
      ? {
        behaviorPreserved: true,
        accuracyLossEstimatePct: `${Number(options.accuracyLossEstimatePct)}%`,
        verified: true,
        reason: 'Provider-specific golden evaluation met required recall/precision thresholds.',
      }
      : {
        behaviorPreserved: false,
        accuracyLossEstimatePct: 'unverified',
        verified: false,
        reason: 'Quality unverified: no provider-specific Matryoshka golden evaluation evidence was supplied. Do not treat truncation as behavior-preserving until deterministic RAG eval meets required thresholds.',
      },
    tiers,
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
      'Offload verbose raw logs into a Symbolic Task Canvas (Mermaid state graph) to save ~60% tokens.',
      'Truncate Matryoshka vector embeddings (1536d -> 256d) for fast coarse filtering, reserving full dimensions for final re-ranking.',
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

  if (options.symbolicCanvas || Array.isArray(options.symbolicEntries)) {
    report.symbolicTaskCanvas = compactSymbolicTaskCanvas(
      options.symbolicEntries || options.entries || [],
      {
        activeTask: options.activeTask,
        targetReduction,
        charsPerToken: options.charsPerToken,
      },
    );
  }

  if (options.matryoshkaEmbedding || options.matryoshkaOptions) {
    report.matryoshkaEmbedding = buildMatryoshkaEmbeddingReport(
      typeof options.matryoshkaOptions === 'object' ? options.matryoshkaOptions : {},
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
  renderSymbolicTaskCanvas,
  compactSymbolicTaskCanvas,
  buildMatryoshkaEmbeddingReport,
  buildContextFootprintReport,
};


