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
  getActiveMcpProfile,
  getAllowedTools,
  assertToolAllowed,
} = require('../../scripts/mcp-policy');

const SERVER_INFO = {
  name: 'rlhf-feedback-loop-mcp',
  version: '1.0.0',
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
];

function toText(result) {
  if (typeof result === 'string') return result;
  return JSON.stringify(result, null, 2);
}

async function callTool(name, args = {}) {
  assertToolAllowed(name, getActiveMcpProfile());

  if (name === 'capture_feedback') {
    const result = captureFeedback({
      signal: args.signal,
      context: args.context,
      whatWentWrong: args.whatWentWrong,
      whatToChange: args.whatToChange,
      whatWorked: args.whatWorked,
      tags: args.tags || [],
      skill: args.skill,
    });
    return { content: [{ type: 'text', text: toText(result) }] };
  }

  if (name === 'feedback_summary') {
    const recent = Number(args.recent || 20);
    const summary = feedbackSummary(Number.isFinite(recent) ? recent : 20);
    return { content: [{ type: 'text', text: summary }] };
  }

  if (name === 'feedback_stats') {
    return { content: [{ type: 'text', text: toText(analyzeFeedback()) }] };
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
