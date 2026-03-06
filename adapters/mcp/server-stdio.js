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

  // HBR: "Which cases consume disproportionate time?" — top error domains
  const negEntries = entries.filter(e => e.signal === 'negative');
  const domainCounts = {};
  negEntries.forEach(e => {
    const domain = (e.richContext && e.richContext.domain) || 'general';
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
  });
  const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

  // HBR: "Glass box" — audit trail of recent decisions
  const recent = entries.slice(-5).reverse();
  const auditTrail = recent.map(e => {
    const sig = e.signal === 'positive' ? 'UP' : 'DN';
    const ts = (e.timestamp || '').slice(11, 19);
    const ctx = (e.context || '').slice(0, 60);
    return `  [${sig}] ${ts} ${ctx}`;
  });

  const parts = [
    '## Storage',
    `  Feedback log : ${entries.length} entries`,
    `  Memory log   : ${memCount} memories`,
    `  LanceDB      : ${path.join(SAFE_DATA_DIR, 'lancedb/')}`,
    '',
    '## Stats',
    `  Total     : ${entries.length}`,
    `  Positive  : ${pos}`,
    `  Negative  : ${neg}`,
    `  Promoted  : ${memCount}`,
    `  Ratio     : ${pos > 0 ? (pos / (pos + neg) * 100).toFixed(0) + '% positive' : 'n/a'}`,
  ];

  if (topDomains.length > 0) {
    parts.push('', '## Top Error Domains (where mistakes cluster)');
    topDomains.forEach(([domain, count]) => {
      parts.push(`  ${domain}: ${count} failures`);
    });
  }

  if (auditTrail.length > 0) {
    parts.push('', '## Audit Trail (last 5 decisions)');
    parts.push(...auditTrail);
  }

  return parts.join('\n');
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

    // 1. Vector search for similar past feedback with confidence scores
    try {
      const similar = await searchSimilar(query, limit);
      if (similar.length > 0) {
        parts.push('## Relevant Past Feedback\n');
        for (let i = 0; i < similar.length; i++) {
          const mem = similar[i];
          const signal = mem.signal === 'positive' ? 'GOOD' : 'BAD';
          const confidence = mem._distance != null ? Math.max(0, (1 - mem._distance) * 100).toFixed(0) : '?';
          parts.push(`**[${signal}]** (${confidence}% match) ${mem.context}`);
          if (mem.tags) parts.push(`  Tags: ${mem.tags}`);
          if (mem.timestamp) parts.push(`  When: ${mem.timestamp}`);
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

    // 4. Append stats + audit trail (glass box)
    parts.push('');
    parts.push(formatStats());

    const text = parts.length > 1
      ? parts.join('\n')
      : 'No past feedback found. This appears to be a fresh start.\n\n' + formatStats();

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

function writeMessage(payload, transport = 'framed') {
  const json = JSON.stringify(payload);
  if (transport === 'ndjson') {
    process.stdout.write(`${json}\n`);
    return;
  }
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
}

function parseWithTransport(raw, transport) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    err.transport = transport;
    throw err;
  }
}

let buffer = Buffer.alloc(0);
let stdioStarted = false;

function hasContentLengthPrefix() {
  if (buffer.length === 0) return false;
  const probe = buffer.slice(0, Math.min(buffer.length, 32)).toString('utf8').toLowerCase();
  return 'content-length:'.startsWith(probe) || probe.startsWith('content-length:');
}

function tryReadMessage() {
  const headerEndCrLf = buffer.indexOf('\r\n\r\n');
  const headerEndLf = buffer.indexOf('\n\n');
  const hasFramedHeader = headerEndCrLf !== -1 || headerEndLf !== -1;

  if (hasFramedHeader) {
    const useCrLf = headerEndCrLf !== -1 && (headerEndLf === -1 || headerEndCrLf < headerEndLf);
    const headerEnd = useCrLf ? headerEndCrLf : headerEndLf;
    const separatorLength = useCrLf ? 4 : 2;
    const headerRaw = buffer.slice(0, headerEnd).toString('utf8');
    const match = headerRaw.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + separatorLength);
      return null;
    }

    const length = Number(match[1]);
    const totalSize = headerEnd + separatorLength + length;
    if (buffer.length < totalSize) return null;

    const body = buffer.slice(headerEnd + separatorLength, totalSize).toString('utf8');
    buffer = buffer.slice(totalSize);

    return { message: parseWithTransport(body, 'framed'), transport: 'framed' };
  }

  // Codex MCP client currently sends newline-delimited JSON during startup.
  if (hasContentLengthPrefix()) return null;

  const newlineIndex = buffer.indexOf('\n');
  if (newlineIndex === -1) return null;

  const line = buffer.slice(0, newlineIndex).toString('utf8').trim();
  buffer = buffer.slice(newlineIndex + 1);
  if (!line) return null;

  return { message: parseWithTransport(line, 'ndjson'), transport: 'ndjson' };
}

async function onData(chunk) {
  buffer = Buffer.concat([buffer, chunk]);

  while (true) {
    const message = tryReadMessage();
    if (!message) return;
    const envelope = message;
    const request = envelope.message;
    const transport = envelope.transport;

    if (!Object.prototype.hasOwnProperty.call(request, 'id')) {
      continue;
    }

    try {
      const result = await handleRequest(request);
      writeMessage({ jsonrpc: '2.0', id: request.id, result }, transport);
    } catch (err) {
      writeMessage({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: err.message || 'Internal error',
        },
      }, transport);
    }
  }
}

function startStdioServer() {
  if (stdioStarted) return;
  stdioStarted = true;
  process.stdin.on('data', (chunk) => {
    onData(chunk).catch((err) => {
      const transport = err && err.transport === 'ndjson' ? 'ndjson' : 'framed';
      writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message } }, transport);
    });
  });
}

module.exports = {
  TOOLS,
  handleRequest,
  callTool,
  resolveSafePath,
  SAFE_DATA_DIR,
  startStdioServer,
};

if (require.main === module) {
  startStdioServer();
}
