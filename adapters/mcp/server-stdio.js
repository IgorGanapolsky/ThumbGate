#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  captureFeedback,
  feedbackSummary,
  analyzeFeedback,
  writePreventionRules,
  FEEDBACK_LOG_PATH,
} = require('../../scripts/feedback-loop');
const {
  exportDpoFromMemories,
  readJSONL,
  DEFAULT_LOCAL_MEMORY_LOG,
} = require('../../scripts/export-dpo-pairs');
const {
  ensureContextFs,
  constructContextPack,
  evaluateContextPack,
  getProvenance,
} = require('../../scripts/contextfs');
const {
  buildRubricEvaluation,
} = require('../../scripts/rubric-engine');
const {
  listIntents,
  planIntent,
} = require('../../scripts/intent-router');
const {
  getActiveMcpProfile,
  getAllowedTools,
  assertToolAllowed,
} = require('../../scripts/mcp-policy');
const {
  searchSimilar,
} = require('../../scripts/vector-store');

const SERVER_INFO = {
  name: 'rlhf-feedback-loop-mcp',
  version: '1.1.0',
};
const SAFE_DATA_DIR = path.resolve(path.dirname(FEEDBACK_LOG_PATH));

function resolveSafePath(inputPath, { mustExist = false } = {}) {
  const allowExternal = process.env.RLHF_ALLOW_EXTERNAL_PATHS === 'true';
  const resolved = path.resolve(String(inputPath || ''));
  const inSafeRoot = resolved === SAFE_DATA_DIR || resolved.startsWith(`${SAFE_DATA_DIR}${path.sep}`);

  if (!allowExternal && !inSafeRoot) {
    throw new Error(`Path must stay within ${SAFE_DATA_DIR}`);
  }
  if (mustExist && !fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }
  return resolved;
}

const TOOLS = [
  {
    name: 'capture_feedback',
    description: 'Capture thumbs up/down feedback and promote actionable memory',
    inputSchema: {
      type: 'object',
      required: ['signal', 'context'],
      properties: {
        signal: { type: 'string', enum: ['up', 'down'] },
        context: { type: 'string' },
        whatWentWrong: { type: 'string' },
        whatToChange: { type: 'string' },
        whatWorked: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        skill: { type: 'string' },
        rubricScores: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criterion: { type: 'string' },
              score: { type: 'number' },
              evidence: { type: 'string' },
              judge: { type: 'string' },
            },
          },
        },
        guardrails: {
          type: 'object',
          properties: {
            testsPassed: { type: 'boolean' },
            pathSafety: { type: 'boolean' },
            budgetCompliant: { type: 'boolean' },
          },
        },
      },
    },
  },
  {
    name: 'feedback_summary',
    description: 'Get summary of recent feedback',
    inputSchema: {
      type: 'object',
      properties: {
        recent: { type: 'number' },
      },
    },
  },
  {
    name: 'feedback_stats',
    description: 'Get feedback stats and recommendations',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_intents',
    description: 'List available intent plans and whether each requires human approval in the active profile',
    inputSchema: {
      type: 'object',
      properties: {
        mcpProfile: { type: 'string' },
        bundleId: { type: 'string' },
      },
    },
  },
  {
    name: 'plan_intent',
    description: 'Generate an intent execution plan with policy checkpoints',
    inputSchema: {
      type: 'object',
      required: ['intentId'],
      properties: {
        intentId: { type: 'string' },
        context: { type: 'string' },
        mcpProfile: { type: 'string' },
        bundleId: { type: 'string' },
        approved: { type: 'boolean' },
      },
    },
  },
  {
    name: 'prevention_rules',
    description: 'Generate prevention rules from repeated mistake patterns',
    inputSchema: {
      type: 'object',
      properties: {
        minOccurrences: { type: 'number' },
        outputPath: { type: 'string' },
      },
    },
  },
  {
    name: 'export_dpo_pairs',
    description: 'Export DPO preference pairs from local memory log',
    inputSchema: {
      type: 'object',
      properties: {
        memoryLogPath: { type: 'string' },
      },
    },
  },
  {
    name: 'construct_context_pack',
    description: 'Construct a bounded context pack from contextfs',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        maxItems: { type: 'number' },
        maxChars: { type: 'number' },
        namespaces: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'evaluate_context_pack',
    description: 'Record evaluation outcome for a context pack',
    inputSchema: {
      type: 'object',
      required: ['packId', 'outcome'],
      properties: {
        packId: { type: 'string' },
        outcome: { type: 'string' },
        signal: { type: 'string' },
        notes: { type: 'string' },
        rubricScores: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criterion: { type: 'string' },
              score: { type: 'number' },
              evidence: { type: 'string' },
              judge: { type: 'string' },
            },
          },
        },
        guardrails: {
          type: 'object',
          properties: {
            testsPassed: { type: 'boolean' },
            pathSafety: { type: 'boolean' },
            budgetCompliant: { type: 'boolean' },
          },
        },
      },
    },
  },
  {
    name: 'context_provenance',
    description: 'Get recent context/provenance events',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'recall',
    description: 'Recall relevant past feedback, memories, and prevention rules for the current task. Call this at the start of any task to inject past learnings into the conversation.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Describe the current task or context to find relevant past feedback' },
        limit: { type: 'number', description: 'Max memories to return (default 5)' },
      },
    },
  },
];

function toText(result) {
  if (typeof result === 'string') return result;
  return JSON.stringify(result, null, 2);
}

function parseOptionalObject(input, name) {
  if (input == null) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return {};
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${name} must be an object`);
    }
    return parsed;
  }
  throw new Error(`${name} must be an object`);
}

function detectFeedbackSignal(text) {
  const lower = String(text || '').toLowerCase();
  const UP = /\b(thumbs?\s*up|that worked|looks good|nice work|perfect|good job)\b/;
  const DOWN = /\b(thumbs?\s*down|that failed|that was wrong|fix this)\b/;
  if (UP.test(lower)) return 'up';
  if (DOWN.test(lower)) return 'down';
  return null;
}

function formatStats() {
  const logPath = path.join(SAFE_DATA_DIR, 'feedback-log.jsonl');
  const memPath = path.join(SAFE_DATA_DIR, 'memory-log.jsonl');
  if (!fs.existsSync(logPath)) return 'No feedback captured yet.';
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
  const entries = lines.map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  const pos = entries.filter(e => e.signal === 'positive').length;
  const neg = entries.filter(e => e.signal === 'negative').length;
  const memCount = fs.existsSync(memPath) ? fs.readFileSync(memPath, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  return [
    '## Storage Proof',
    `  Feedback log : ${logPath} (${entries.length} entries)`,
    `  Memory log   : ${memPath} (${memCount} entries)`,
    `  LanceDB      : ${path.join(SAFE_DATA_DIR, 'lancedb/')}`,
    '',
    '## Cumulative Stats',
    `  Total feedback  : ${entries.length}`,
    `  Positive (up)   : ${pos}`,
    `  Negative (down) : ${neg}`,
    `  Promoted to mem : ${memCount}`,
    `  Ratio           : ${pos > 0 ? (pos / (pos + neg) * 100).toFixed(0) + '% positive' : 'n/a'}`,
  ].join('\n');
}

async function callTool(name, args = {}) {
  assertToolAllowed(name, getActiveMcpProfile());

  // Platform-agnostic auto-capture: detect feedback signals in any tool call
  const textToCheck = args.query || args.context || '';
  const autoSignal = detectFeedbackSignal(textToCheck);
  if (autoSignal && name !== 'capture_feedback') {
    const autoResult = captureFeedback({
      signal: autoSignal,
      context: textToCheck,
      tags: ['auto-capture', 'mcp'],
    });
    const ev = autoResult.feedbackEvent || {};
    const autoReport = [
      '',
      `## Auto-Captured Feedback [${autoSignal.toUpperCase()}]`,
      `  Feedback ID : ${ev.id || 'n/a'}`,
      `  Signal      : ${ev.signal || autoSignal} (${ev.actionType || 'unknown'})`,
      `  Context     : ${(ev.context || textToCheck).slice(0, 80)}`,
      `  Timestamp   : ${ev.timestamp || new Date().toISOString()}`,
      `  Promoted    : ${autoResult.accepted ? 'yes (Memory ID: ' + (autoResult.memoryRecord || {}).id + ')' : 'no — ' + (autoResult.reason || '')}`,
      '',
      formatStats(),
    ].join('\n');
    // Prepend the auto-capture report to whatever the tool was going to return
    const toolResult = await callToolInner(name, args);
    toolResult.content[0].text = autoReport + '\n\n---\n\n' + toolResult.content[0].text;
    return toolResult;
  }

  return callToolInner(name, args);
}

async function callToolInner(name, args = {}) {
  if (name === 'recall') {
    const query = args.query || '';
    const limit = Number(args.limit || 5);
    const parts = [];

    // 1. Vector search for similar past feedback
    try {
      const similar = await searchSimilar(query, limit);
      if (similar.length > 0) {
        parts.push('## Relevant Past Feedback\n');
        for (const mem of similar) {
          const signal = mem.signal === 'positive' ? 'GOOD' : 'BAD';
          parts.push(`**[${signal}]** ${mem.context}`);
          if (mem.tags) parts.push(`  Tags: ${mem.tags}`);
          parts.push('');
        }
      }
    } catch (_) {
      // Vector store may not be initialized yet — fall back to JSONL
    }

    // 2. Load prevention rules
    try {
      const rulesPath = path.join(SAFE_DATA_DIR, 'prevention-rules.md');
      if (fs.existsSync(rulesPath)) {
        const rules = fs.readFileSync(rulesPath, 'utf8').trim();
        if (rules.length > 50) {
          parts.push('## Active Prevention Rules\n');
          parts.push(rules);
          parts.push('');
        }
      }
    } catch (_) {}

    // 3. Recent feedback summary
    try {
      const summary = feedbackSummary(10);
      if (summary) {
        parts.push('## Recent Feedback Summary\n');
        parts.push(summary);
      }
    } catch (_) {}

    const text = parts.length > 0
      ? parts.join('\n')
      : 'No past feedback found. This appears to be a fresh start.';

    return { content: [{ type: 'text', text }] };
  }

  if (name === 'capture_feedback') {
    const result = captureFeedback({
      signal: args.signal,
      context: args.context,
      whatWentWrong: args.whatWentWrong,
      whatToChange: args.whatToChange,
      whatWorked: args.whatWorked,
      rubricScores: args.rubricScores,
      guardrails: parseOptionalObject(args.guardrails, 'guardrails'),
      tags: args.tags || [],
      skill: args.skill,
    });

    // Auto-recall: after capturing, return relevant context so the agent
    // can immediately adjust behavior based on past learnings
    let recallText = '';
    try {
      const similar = await searchSimilar(args.context || '', 3);
      if (similar.length > 0) {
        recallText = '\n\n---\n## Related Past Feedback (auto-recall)\n';
        for (const mem of similar) {
          const signal = mem.signal === 'positive' ? 'GOOD' : 'BAD';
          recallText += `- **[${signal}]** ${mem.context}\n`;
        }
      }
    } catch (_) {}

    return { content: [{ type: 'text', text: toText(result) + recallText }] };
  }

  if (name === 'feedback_summary') {
    const recent = Number(args.recent || 20);
    const summary = feedbackSummary(Number.isFinite(recent) ? recent : 20);
    return { content: [{ type: 'text', text: summary }] };
  }

  if (name === 'feedback_stats') {
    return { content: [{ type: 'text', text: toText(analyzeFeedback()) }] };
  }

  if (name === 'list_intents') {
    const result = listIntents({
      mcpProfile: args.mcpProfile,
      bundleId: args.bundleId,
    });
    return { content: [{ type: 'text', text: toText(result) }] };
  }

  if (name === 'plan_intent') {
    const result = planIntent({
      intentId: args.intentId,
      context: args.context || '',
      mcpProfile: args.mcpProfile,
      bundleId: args.bundleId,
      approved: args.approved === true,
    });
    return { content: [{ type: 'text', text: toText(result) }] };
  }

  if (name === 'prevention_rules') {
    const minOccurrences = Number(args.minOccurrences || 2);
    const outputPath = args.outputPath ? resolveSafePath(args.outputPath) : undefined;
    const result = writePreventionRules(outputPath, Number.isFinite(minOccurrences) ? minOccurrences : 2);
    return { content: [{ type: 'text', text: toText(result) }] };
  }

  if (name === 'export_dpo_pairs') {
    const memoryLogPath = args.memoryLogPath
      ? resolveSafePath(args.memoryLogPath, { mustExist: true })
      : DEFAULT_LOCAL_MEMORY_LOG;
    const memories = readJSONL(memoryLogPath);
    const result = exportDpoFromMemories(memories);
    return {
      content: [{
        type: 'text',
        text: toText({
          pairs: result.pairs.length,
          errors: result.errors.length,
          learnings: result.learnings.length,
        }),
      }],
    };
  }

  if (name === 'construct_context_pack') {
    ensureContextFs();
    const result = constructContextPack({
      query: args.query || '',
      maxItems: Number(args.maxItems || 8),
      maxChars: Number(args.maxChars || 6000),
      namespaces: Array.isArray(args.namespaces) ? args.namespaces : [],
    });
    return { content: [{ type: 'text', text: toText(result) }] };
  }

  if (name === 'evaluate_context_pack') {
    if (!args.packId || !args.outcome) {
      throw new Error('packId and outcome are required');
    }
    const result = evaluateContextPack({
      packId: args.packId,
      outcome: args.outcome,
      signal: args.signal || null,
      notes: args.notes || '',
      rubricEvaluation: args.rubricScores || args.guardrails
        ? buildRubricEvaluation({
          rubricScores: args.rubricScores,
          guardrails: parseOptionalObject(args.guardrails, 'guardrails'),
        })
        : null,
    });
    return { content: [{ type: 'text', text: toText(result) }] };
  }

  if (name === 'context_provenance') {
    const limit = Number(args.limit || 50);
    const result = getProvenance(Number.isFinite(limit) ? limit : 50);
    return { content: [{ type: 'text', text: toText(result) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleRequest(message) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: SERVER_INFO,
    };
  }

  if (message.method === 'tools/list') {
    const profile = getActiveMcpProfile();
    const allowed = new Set(getAllowedTools(profile));
    const tools = TOOLS.filter((tool) => allowed.has(tool.name));
    return { tools };
  }

  if (message.method === 'tools/call') {
    const name = message.params && message.params.name;
    const args = (message.params && message.params.arguments) || {};
    return callTool(name, args);
  }

  throw new Error(`Unsupported method: ${message.method}`);
}

function writeMessage(payload) {
  const json = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
}

let buffer = Buffer.alloc(0);

function tryReadMessage() {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;

  const headerRaw = buffer.slice(0, headerEnd).toString('utf8');
  const match = headerRaw.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    buffer = buffer.slice(headerEnd + 4);
    return null;
  }

  const length = Number(match[1]);
  const totalSize = headerEnd + 4 + length;
  if (buffer.length < totalSize) return null;

  const body = buffer.slice(headerEnd + 4, totalSize).toString('utf8');
  buffer = buffer.slice(totalSize);

  return JSON.parse(body);
}

async function onData(chunk) {
  buffer = Buffer.concat([buffer, chunk]);

  while (true) {
    const message = tryReadMessage();
    if (!message) return;

    if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
      continue;
    }

    try {
      const result = await handleRequest(message);
      writeMessage({ jsonrpc: '2.0', id: message.id, result });
    } catch (err) {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: err.message || 'Internal error',
        },
      });
    }
  }
}

module.exports = {
  TOOLS,
  handleRequest,
  callTool,
  resolveSafePath,
  SAFE_DATA_DIR,
};

if (require.main === module) {
  process.stdin.on('data', (chunk) => {
    onData(chunk).catch((err) => {
      writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message } });
    });
  });
}
