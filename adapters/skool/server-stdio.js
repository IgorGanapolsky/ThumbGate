'use strict';

const readline = require('node:readline');

const {
  buildSkoolDigest,
  readSkoolCommunity,
} = require('../../scripts/skool-reader');

const TOOLS = [
  {
    name: 'skool_read_community',
    description:
      'Read a Skool community page headlessly and return normalized categories, posts, and engagement metadata. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full Skool community URL. Use this or community.',
        },
        community: {
          type: 'string',
          description: 'Skool community slug, for example ai-automation-society.',
        },
        category: {
          type: 'string',
          description: 'Optional category name or Skool category id.',
        },
        limit: {
          type: 'number',
          description: 'Maximum posts to return.',
          default: 20,
        },
        page: {
          type: 'number',
          description: 'Optional page number.',
          default: 1,
        },
        sortType: {
          type: 'string',
          description: 'Optional Skool sort parameter.',
        },
      },
      required: [],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'skool_revenue_signals',
    description:
      'Rank Skool posts for ThumbGate acquisition opportunities, pain points, and high-intent outreach angles. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full Skool community URL. Use this or community.',
        },
        community: {
          type: 'string',
          description: 'Skool community slug, for example ai-automation-society.',
        },
        category: {
          type: 'string',
          description: 'Optional category name or Skool category id.',
        },
        limit: {
          type: 'number',
          description: 'Maximum revenue signals to return.',
          default: 20,
        },
        postLimit: {
          type: 'number',
          description: 'Maximum posts to read before ranking signals.',
          default: 50,
        },
        signalLimit: {
          type: 'number',
          description: 'Maximum revenue signals to return. Overrides limit.',
        },
        focus: {
          type: 'string',
          description: 'Optional extra keyword or phrase to boost.',
        },
      },
      required: [],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'skool_post_detail',
    description:
      'Read a single Skool post URL headlessly and return normalized post metadata and content when available. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full Skool post URL.',
        },
      },
      required: ['url'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
];

function successResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function callTool(toolName, toolArgs, deps = {}) {
  const args = toolArgs || {};

  switch (toolName) {
    case 'skool_read_community': {
      return readSkoolCommunity(args, deps);
    }
    case 'skool_revenue_signals': {
      const signalLimit = Number(args.signalLimit || args.limit || 10);
      const postLimit = Number(args.postLimit || Math.max(signalLimit, 50));
      const parsed = await readSkoolCommunity({ ...args, limit: postLimit }, deps);
      const digest = buildSkoolDigest(parsed, { ...args, signalLimit });
      return {
        community: digest.community,
        sourceUrl: digest.sourceUrl,
        fetchedAt: digest.fetchedAt,
        total: digest.total,
        labels: digest.labels,
        signals: digest.signals,
      };
    }
    case 'skool_post_detail': {
      if (!args.url) throw new Error('skool_post_detail requires url.');
      const parsed = await readSkoolCommunity({ ...args, limit: 1 }, deps);
      return {
        community: parsed.community,
        sourceUrl: parsed.sourceUrl,
        fetchedAt: parsed.fetchedAt,
        post: parsed.posts[0] || null,
      };
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

async function handleRequest(request, deps = {}) {
  const { id = null, method, params } = request || {};

  try {
    if (method === 'initialize') {
      return successResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'thumbgate-skool-headless-reader',
          version: '1.0.0',
        },
      });
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (method === 'tools/list') {
      return successResponse(id, { tools: TOOLS });
    }

    if (method === 'tools/call') {
      const { name: toolName, arguments: toolArgs } = params || {};
      if (!toolName) {
        return errorResponse(id, -32602, 'Missing required param: name');
      }
      const result = await callTool(toolName, toolArgs, deps);
      return successResponse(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      });
    }

    return errorResponse(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    return errorResponse(id, -32603, error.message);
  }
}

function startServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: null,
    terminal: false,
  });

  process.stderr.write('[skool-headless-reader mcp-server] Listening on stdin...\n');

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch (_) {
      const response = errorResponse(null, -32700, 'Parse error: invalid JSON');
      process.stdout.write(`${JSON.stringify(response)}\n`);
      return;
    }

    const response = await handleRequest(request);
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  });

  rl.on('close', () => {
    process.stderr.write('[skool-headless-reader mcp-server] stdin closed, shutting down.\n');
  });

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

module.exports = {
  TOOLS,
  callTool,
  handleRequest,
  startServer,
};

if (require.main === module) {
  startServer();
}
