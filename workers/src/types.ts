/** Cloudflare Workers environment bindings */
export interface Env {
  MEMORY_KV: KVNamespace;
  KEYS_KV: KVNamespace;
  GATES_KV: KVNamespace;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string;
  FREE_DAILY_LIMIT: string;
}

/** Subscription tier */
export type Tier = 'free' | 'pro';

/** Auth validation result */
export interface AuthResult {
  valid: boolean;
  tier: Tier;
  customerId: string | null;
}

/** Stored API key metadata in KEYS_KV */
export interface ApiKeyRecord {
  customerId: string;
  billingReferenceId: string;
  tier: Tier;
  active: boolean;
  createdAt: string;
}

/** MCP JSON-RPC request */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** MCP JSON-RPC response */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** MCP tool definition */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** MCP tool call result */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Feedback entry stored in KV */
export interface FeedbackEntry {
  id: string;
  feedback: 'up' | 'down';
  context: string;
  tags: string[];
  whatWorked?: string;
  whatWentWrong?: string;
  whatToChange?: string;
  timestamp: string;
}

/** Memory entry stored in KV */
export interface MemoryEntry {
  id: string;
  content: string;
  namespace: string;
  tags: string[];
  score?: number;
  timestamp: string;
}

/** Gate state in KV */
export interface GateState {
  gateId: string;
  condition: string;
  satisfied: boolean;
  satisfiedAt?: string;
  ttlSeconds: number;
}

/** Context pack */
export interface ContextPack {
  id: string;
  namespace: string;
  entries: MemoryEntry[];
  createdAt: string;
  evaluatedAt?: string;
  outcome?: 'success' | 'failure' | 'partial';
}

/** Rate limit check result */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: string;
}
