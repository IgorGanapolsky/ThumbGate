'use strict';

/**
 * MCP stdio server for social analytics.
 *
 * Exposes social metrics from SQLite as queryable tools for Claude.
 * Uses a simple JSON-RPC 2.0 over stdio pattern — no external MCP SDK required.
 *
 * Protocol:
 *   - Reads newline-delimited JSON-RPC 2.0 requests from stdin.
 *   - Writes newline-delimited JSON-RPC 2.0 responses to stdout.
 *   - Supported methods: tools/list, tools/call
 */

const readline = require('readline');

const { initDb, queryMetrics, topContent, getFollowerHistory } = require('./store');
const { generateDigest } = require('./digest');

const VALID_PLATFORMS = ['instagram', 'tiktok', 'github', 'all'];

// Tool definitions exposed to Claude.
const TOOLS = [
  {
    name: 'query_social_metrics',
    description:
      'Returns aggregated engagement metrics from the social analytics database for the given platform and time window.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: VALID_PLATFORMS,
          description: 'Platform to query. Use "all" for all platforms combined.',
        },
        days: {
          type: 'number',
          description: 'Number of past days to include in the query.',
          default: 7,
        },
      },
      required: ['platform'],
    },
  },
  {
    name: 'top_social_content',
    description:
      'Returns top content items ranked by total engagement (likes + comments + shares + saves) over the past N days.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of past days to consider.',
          default: 7,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return.',
          default: 10,
        },
      },
      required: [],
    },
  },
  {
    name: 'follower_growth',
    description: 'Returns follower count snapshots for a platform over the past N days.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['instagram', 'tiktok', 'github'],
          description: 'Platform to query follower history for.',
        },
        days: {
          type: 'number',
          description: 'Number of past days to include.',
          default: 7,
        },
      },
      required: ['platform'],
    },
  },
  {
    name: 'social_digest',
    description:
      'Returns a full digest object summarising all social metrics, follower deltas, and top content for the past N days.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of past days to summarise.',
          default: 7,
        },
      },
      required: [],
    },
  },
];

/**
 * Validates that a value is a positive integer (or coerces a numeric string).
 *
 * @param {*} value
 * @param {number} defaultVal
 * @returns {number}
 */
function asPositiveInt(value, defaultVal) {
  const n = value == null ? defaultVal : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Expected a positive number, got: ${value}`);
  }
  return Math.floor(n);
}

/**
 * Dispatches a tools/call request and returns the result payload.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} toolName
 * @param {object} toolArgs
 * @returns {object}
 */
function callTool(db, toolName, toolArgs) {
  const args = toolArgs || {};

  switch (toolName) {
    case 'query_social_metrics': {
      const platform = args.platform;
      if (!VALID_PLATFORMS.includes(platform)) {
        throw new Error(`Invalid platform "${platform}". Must be one of: ${VALID_PLATFORMS.join(', ')}`);
      }
      const days = asPositiveInt(args.days, 7);
      const opts = platform === 'all' ? { days } : { platform, days };
      const rows = queryMetrics(db, opts);
      return { rows };
    }

    case 'top_social_content': {
      const days = asPositiveInt(args.days, 7);
      const limit = asPositiveInt(args.limit, 10);
      const rows = topContent(db, { days, limit });
      return { rows };
    }

    case 'follower_growth': {
      const platform = args.platform;
      if (!platform || !['instagram', 'tiktok', 'github'].includes(platform)) {
        throw new Error(`Invalid platform "${platform}". Must be one of: instagram, tiktok, github`);
      }
      const days = asPositiveInt(args.days, 7);
      const rows = getFollowerHistory(db, { platform, days });
      return { rows };
    }

    case 'social_digest': {
      const days = asPositiveInt(args.days, 7);
      const digest = generateDigest(db, { days });
      return digest;
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * Builds a JSON-RPC 2.0 success response.
 *
 * @param {string|number|null} id
 * @param {*} result
 * @returns {object}
 */
function successResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Builds a JSON-RPC 2.0 error response.
 *
 * @param {string|number|null} id
 * @param {number} code
 * @param {string} message
 * @returns {object}
 */
function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Handles a single parsed JSON-RPC request object and returns a response object.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} request
 * @returns {object}
 */
function handleRequest(db, request) {
  const { id = null, method, params } = request;

  try {
    if (method === 'tools/list') {
      return successResponse(id, { tools: TOOLS });
    }

    if (method === 'tools/call') {
      const { name: toolName, arguments: toolArgs } = params || {};
      if (!toolName) {
        return errorResponse(id, -32602, 'Missing required param: name');
      }
      const result = callTool(db, toolName, toolArgs);
      return successResponse(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      });
    }

    // Method not found.
    return errorResponse(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    return errorResponse(id, -32603, err.message);
  }
}

/**
 * Starts the MCP stdio server. Reads newline-delimited JSON from stdin,
 * writes newline-delimited JSON to stdout.
 */
function startServer() {
  const db = initDb();

  const rl = readline.createInterface({
    input: process.stdin,
    output: null,
    terminal: false,
  });

  process.stderr.write('[social-analytics mcp-server] Listening on stdin...\n');

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch (_) {
      const resp = errorResponse(null, -32700, 'Parse error: invalid JSON');
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    const response = handleRequest(db, request);
    process.stdout.write(JSON.stringify(response) + '\n');
  });

  rl.on('close', () => {
    db.close();
    process.stderr.write('[social-analytics mcp-server] stdin closed, shutting down.\n');
  });

  process.on('SIGINT', () => {
    db.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    db.close();
    process.exit(0);
  });
}

module.exports = {
  TOOLS,
  callTool,
  handleRequest,
  startServer,
};

// Run as main: start the stdio server.
if (require.main === module) {
  startServer();
}
