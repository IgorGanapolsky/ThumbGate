import type { Env, JsonRpcRequest, JsonRpcResponse, ToolResult } from './types';
import { validateAuth } from './auth';
import { handleCheckout, handleWebhook } from './billing';
import { FREE_TOOLS, isFreeTool, executeFree } from './tools/free';
import { PAID_TOOLS, isPaidTool, executePaid } from './tools/paid';
import { problemResponse, PROBLEM_TYPES } from './problem-detail';

const ALL_TOOLS = [...FREE_TOOLS, ...PAID_TOOLS];

/**
 * MCP Memory Gateway — Cloudflare Workers
 *
 * Endpoints:
 *   POST /mcp          — MCP JSON-RPC (tools/list, tools/call)
 *   POST /billing/checkout  — Stripe checkout session
 *   POST /billing/webhook   — Stripe webhook handler
 *   GET  /health            — Health check
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }));
    }

    try {
      let response: Response;

      switch (true) {
        case url.pathname === '/health' && request.method === 'GET':
          response = Response.json({
            status: 'ok',
            service: 'mcp-memory-gateway',
            tier: 'cloudflare-workers',
            tools: ALL_TOOLS.length,
            timestamp: new Date().toISOString(),
          });
          break;

        case url.pathname === '/mcp' && request.method === 'POST':
          response = await handleMcp(request, env);
          break;

        case url.pathname === '/billing/checkout' && request.method === 'POST':
          response = await handleCheckout(request, env);
          break;

        case url.pathname === '/billing/webhook' && request.method === 'POST':
          response = await handleWebhook(request, env);
          break;

        case url.pathname === '/billing/success':
          response = new Response(
            '<html><body><h1>Subscription active!</h1><p>Your API key has been provisioned. Check your email or retrieve it via the API.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } },
          );
          break;

        case url.pathname === '/billing/cancel':
          response = new Response(
            '<html><body><h1>Checkout cancelled</h1><p>No charge was made.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } },
          );
          break;

        default:
          response = problemResponse({
            type: PROBLEM_TYPES.NOT_FOUND,
            title: 'Not Found',
            status: 404,
            detail: `No handler for ${request.method} ${url.pathname}`,
            endpoints: ['/mcp', '/billing/checkout', '/billing/webhook', '/health'],
          });
      }

      return corsResponse(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('Worker error:', message);
      return corsResponse(
        problemResponse({
          type: PROBLEM_TYPES.INTERNAL,
          title: 'Internal Server Error',
          status: 500,
          detail: message,
        }),
      );
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * Handle MCP JSON-RPC requests (streamable-http transport).
 * Supports: tools/list, tools/call, initialize, ping
 */
async function handleMcp(request: Request, env: Env): Promise<Response> {
  const body = await request.json<JsonRpcRequest>();

  if (!body.jsonrpc || body.jsonrpc !== '2.0' || !body.method) {
    return Response.json(
      jsonRpcError(body.id ?? null, -32600, 'Invalid JSON-RPC request'),
    );
  }

  const auth = await validateAuth(request, env);

  switch (body.method) {
    case 'initialize':
      return Response.json(jsonRpcResult(body.id, {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'mcp-memory-gateway',
          version: '1.0.0',
        },
        capabilities: {
          tools: {},
        },
      }));

    case 'notifications/initialized':
      return Response.json(jsonRpcResult(body.id, {}));

    case 'ping':
      return Response.json(jsonRpcResult(body.id, {}));

    case 'tools/list':
      return Response.json(
        jsonRpcResult(body.id, { tools: ALL_TOOLS }),
      );

    case 'tools/call': {
      const params = body.params as { name: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name) {
        return Response.json(
          jsonRpcError(body.id, -32602, 'Missing tool name in params'),
        );
      }

      const toolName = params.name;
      const toolArgs = params.arguments ?? {};

      // Invalid API key
      if (!auth.valid) {
        return Response.json(
          jsonRpcError(body.id, -32001, 'Invalid API key'),
        );
      }

      let result: ToolResult;

      if (isFreeTool(toolName)) {
        result = await executeFree(toolName, toolArgs, auth, request, env);
      } else if (isPaidTool(toolName)) {
        result = await executePaid(toolName, toolArgs, auth, request, env);
      } else {
        return Response.json(
          jsonRpcError(body.id, -32601, `Unknown tool: ${toolName}`),
        );
      }

      return Response.json(jsonRpcResult(body.id, result));
    }

    default:
      return Response.json(
        jsonRpcError(body.id, -32601, `Method not found: ${body.method}`),
      );
  }
}

// --- JSON-RPC helpers ---

function jsonRpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? 0, result };
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? 0, error: { code, message, ...(data ? { data } : {}) } };
}

function corsResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-install-id');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
