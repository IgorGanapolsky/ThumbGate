import type { Env, McpTool, ToolResult, AuthResult, ContextPack } from '../types';
import { requirePro } from '../auth';
import {
  getOwnerId,
  storeMemory,
  listMemories,
  searchMemories,
  listFeedback,
} from '../storage';
import { satisfyGate, listGates } from '../gates';

/** Paid (Pro) tier tool definitions */
export const PAID_TOOLS: McpTool[] = [
  {
    name: 'construct_context_pack',
    description:
      '[Pro] Build a bounded context pack from memories for a specific task. Reduces token waste.',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Memory namespace to draw from' },
        query: { type: 'string', description: 'Task description to match relevant memories' },
        max_entries: { type: 'number', description: 'Max entries in pack (default: 20)' },
      },
      required: ['namespace', 'query'],
    },
  },
  {
    name: 'evaluate_context_pack',
    description:
      '[Pro] Record the outcome of a context pack usage (success/failure/partial).',
    inputSchema: {
      type: 'object',
      properties: {
        pack_id: { type: 'string', description: 'Context pack ID to evaluate' },
        outcome: {
          type: 'string',
          enum: ['success', 'failure', 'partial'],
          description: 'Outcome of using this context pack',
        },
        notes: { type: 'string', description: 'Optional evaluation notes' },
      },
      required: ['pack_id', 'outcome'],
    },
  },
  {
    name: 'export_dpo_pairs',
    description:
      '[Pro] Export DPO (Direct Preference Optimization) training pairs from feedback history.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max pairs to export (default: 50)' },
        min_score_diff: {
          type: 'number',
          description: 'Minimum score difference for pair selection (default: 0)',
        },
      },
    },
  },
  {
    name: 'dashboard',
    description:
      '[Pro] Full RLHF dashboard with feedback trends, memory stats, gate status, and health metrics.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'generate_skill',
    description:
      '[Pro] Auto-generate a reusable skill from patterns detected in positive feedback.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Tag/category to generate skill for' },
        min_examples: {
          type: 'number',
          description: 'Minimum positive examples required (default: 3)',
        },
      },
      required: ['tag'],
    },
  },
  {
    name: 'list_intents',
    description: '[Pro] List discovered intents from feedback and memory patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Namespace to scope (default: all)' },
      },
    },
  },
  {
    name: 'plan_intent',
    description:
      '[Pro] Create an execution plan for a specific intent based on historical success patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'string', description: 'Intent to plan for' },
        context: { type: 'string', description: 'Current context/constraints' },
      },
      required: ['intent'],
    },
  },
  {
    name: 'satisfy_gate',
    description:
      '[Pro] Satisfy a gate condition with KV-backed TTL state. 5 free gates, unlimited for Pro.',
    inputSchema: {
      type: 'object',
      properties: {
        gate_id: { type: 'string', description: 'Unique gate identifier' },
        condition: { type: 'string', description: 'Condition that was satisfied' },
        ttl_seconds: { type: 'number', description: 'TTL in seconds (default: 300)' },
      },
      required: ['gate_id', 'condition'],
    },
  },
];

const PAID_TOOL_NAMES = new Set(PAID_TOOLS.map((t) => t.name));

export function isPaidTool(name: string): boolean {
  return PAID_TOOL_NAMES.has(name);
}

/** Execute a paid-tier tool. Returns 402 error if not Pro. */
export async function executePaid(
  name: string,
  params: Record<string, unknown>,
  auth: AuthResult,
  request: Request,
  env: Env,
): Promise<ToolResult> {
  const proError = requirePro(auth);
  if (proError) {
    return {
      content: [{ type: 'text', text: JSON.stringify(proError) }],
      isError: true,
    };
  }

  const ownerId = getOwnerId(auth.customerId, request);

  switch (name) {
    case 'construct_context_pack':
      return handleConstructPack(params, ownerId, env);
    case 'evaluate_context_pack':
      return handleEvaluatePack(params, ownerId, env);
    case 'export_dpo_pairs':
      return handleExportDpo(params, ownerId, env);
    case 'dashboard':
      return handleDashboard(ownerId, env);
    case 'generate_skill':
      return handleGenerateSkill(params, ownerId, env);
    case 'list_intents':
      return handleListIntents(params, ownerId, env);
    case 'plan_intent':
      return handlePlanIntent(params, ownerId, env);
    case 'satisfy_gate':
      return handleSatisfyGate(params, ownerId, env);
    default:
      return textResult(`Unknown paid tool: ${name}`, true);
  }
}

// --- Tool Implementations ---

async function handleConstructPack(
  params: Record<string, unknown>,
  ownerId: string,
  env: Env,
): Promise<ToolResult> {
  const namespace = params.namespace as string;
  const query = params.query as string;
  const maxEntries = (params.max_entries as number) ?? 20;

  const entries = await searchMemories(env, ownerId, query, namespace, maxEntries);

  const pack: ContextPack = {
    id: `pack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    namespace,
    entries,
    createdAt: new Date().toISOString(),
  };

  // Store pack for later evaluation
  await env.MEMORY_KV.put(
    `pack:${ownerId}:${pack.id}`,
    JSON.stringify(pack),
    { expirationTtl: 86400 * 7 }, // 7 day TTL
  );

  return textResult(
    JSON.stringify({
      packId: pack.id,
      entryCount: entries.length,
      namespace,
      entries: entries.map((e) => ({
        id: e.id,
        content: e.content.slice(0, 300),
        tags: e.tags,
      })),
    }),
  );
}

async function handleEvaluatePack(
  params: Record<string, unknown>,
  ownerId: string,
  env: Env,
): Promise<ToolResult> {
  const packId = params.pack_id as string;
  const outcome = params.outcome as 'success' | 'failure' | 'partial';
  const notes = params.notes as string | undefined;

  const raw = await env.MEMORY_KV.get(`pack:${ownerId}:${packId}`);
  if (!raw) {
    return textResult(`Context pack not found: ${packId}`, true);
  }

  const pack: ContextPack = JSON.parse(raw);
  pack.evaluatedAt = new Date().toISOString();
  pack.outcome = outcome;

  await env.MEMORY_KV.put(`pack:${ownerId}:${packId}`, JSON.stringify(pack));

  // Store evaluation as memory for future learning
  await storeMemory(env, ownerId, {
    content: `Pack ${packId} (${pack.namespace}): ${outcome}${notes ? ' - ' + notes : ''}`,
    namespace: 'evaluations',
    tags: ['context-pack', outcome, pack.namespace],
  });

  return textResult(
    JSON.stringify({ packId, outcome, evaluatedAt: pack.evaluatedAt }),
  );
}

async function handleExportDpo(
  params: Record<string, unknown>,
  ownerId: string,
  env: Env,
): Promise<ToolResult> {
  const limit = (params.limit as number) ?? 50;
  const entries = await listFeedback(env, ownerId, limit * 2);

  const ups = entries.filter((e) => e.feedback === 'up');
  const downs = entries.filter((e) => e.feedback === 'down');

  // Build DPO pairs: match positive and negative entries by overlapping tags
  const pairs: Array<{
    chosen: string;
    rejected: string;
    context: string;
  }> = [];

  for (const up of ups) {
    if (pairs.length >= limit) break;
    for (const down of downs) {
      if (pairs.length >= limit) break;
      const overlap = up.tags.filter((t) => down.tags.includes(t));
      if (overlap.length > 0) {
        pairs.push({
          chosen: up.context + (up.whatWorked ? ` (${up.whatWorked})` : ''),
          rejected:
            down.context + (down.whatWentWrong ? ` (${down.whatWentWrong})` : ''),
          context: overlap.join(', '),
        });
      }
    }
  }

  return textResult(
    JSON.stringify({ pairCount: pairs.length, pairs }),
  );
}

async function handleDashboard(
  ownerId: string,
  env: Env,
): Promise<ToolResult> {
  const recentFeedback = await listFeedback(env, ownerId, 100);
  const gates = await listGates(env, ownerId);

  const up = recentFeedback.filter((e) => e.feedback === 'up').length;
  const down = recentFeedback.filter((e) => e.feedback === 'down').length;

  const tagCounts: Record<string, number> = {};
  for (const entry of recentFeedback) {
    for (const tag of entry.tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }

  const dashboard = {
    feedback: {
      total: recentFeedback.length,
      up,
      down,
      ratio: recentFeedback.length > 0 ? (up / recentFeedback.length).toFixed(2) : '0.00',
      recent: recentFeedback.slice(0, 5).map((e) => ({
        feedback: e.feedback,
        context: e.context.slice(0, 100),
        timestamp: e.timestamp,
      })),
    },
    topTags: Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count })),
    gates: {
      active: gates.length,
      gates: gates.map((g) => ({
        id: g.gateId,
        condition: g.condition,
        satisfiedAt: g.satisfiedAt,
      })),
    },
    generatedAt: new Date().toISOString(),
  };

  return textResult(JSON.stringify(dashboard));
}

async function handleGenerateSkill(
  params: Record<string, unknown>,
  ownerId: string,
  env: Env,
): Promise<ToolResult> {
  const tag = params.tag as string;
  const minExamples = (params.min_examples as number) ?? 3;

  const entries = await listFeedback(env, ownerId, 200);
  const positives = entries.filter(
    (e) => e.feedback === 'up' && e.tags.includes(tag),
  );

  if (positives.length < minExamples) {
    return textResult(
      JSON.stringify({
        error: `Need at least ${minExamples} positive examples for tag "${tag}", found ${positives.length}`,
      }),
      true,
    );
  }

  const patterns = positives
    .map((e) => e.whatWorked ?? e.context)
    .slice(0, 10);

  const skill = {
    name: `skill_${tag.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
    tag,
    basedOn: positives.length,
    patterns,
    generatedRule: `When working on [${tag}]: ${patterns.slice(0, 3).join('. ')}`,
    generatedAt: new Date().toISOString(),
  };

  // Store skill as memory
  await storeMemory(env, ownerId, {
    content: JSON.stringify(skill),
    namespace: 'skills',
    tags: ['skill', tag],
  });

  return textResult(JSON.stringify(skill));
}

async function handleListIntents(
  params: Record<string, unknown>,
  ownerId: string,
  env: Env,
): Promise<ToolResult> {
  const entries = await listFeedback(env, ownerId, 200);

  // Extract intents from tags and contexts
  const intentCounts: Record<string, { count: number; lastSeen: string }> = {};

  for (const entry of entries) {
    for (const tag of entry.tags) {
      if (!intentCounts[tag]) {
        intentCounts[tag] = { count: 0, lastSeen: entry.timestamp };
      }
      intentCounts[tag].count++;
      if (entry.timestamp > intentCounts[tag].lastSeen) {
        intentCounts[tag].lastSeen = entry.timestamp;
      }
    }
  }

  const intents = Object.entries(intentCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([intent, data]) => ({
      intent,
      occurrences: data.count,
      lastSeen: data.lastSeen,
    }));

  return textResult(JSON.stringify({ count: intents.length, intents }));
}

async function handlePlanIntent(
  params: Record<string, unknown>,
  ownerId: string,
  env: Env,
): Promise<ToolResult> {
  const intent = params.intent as string;
  const context = (params.context as string) ?? '';

  // Find successful patterns for this intent
  const entries = await listFeedback(env, ownerId, 200);
  const successes = entries.filter(
    (e) => e.feedback === 'up' && e.tags.includes(intent),
  );
  const failures = entries.filter(
    (e) => e.feedback === 'down' && e.tags.includes(intent),
  );

  const plan = {
    intent,
    context,
    successPatterns: successes.slice(0, 5).map((e) => ({
      context: e.context.slice(0, 200),
      whatWorked: e.whatWorked,
    })),
    failurePatterns: failures.slice(0, 5).map((e) => ({
      context: e.context.slice(0, 200),
      whatWentWrong: e.whatWentWrong,
      whatToChange: e.whatToChange,
    })),
    recommendation:
      successes.length > 0
        ? `Based on ${successes.length} successes: ${successes[0].whatWorked ?? successes[0].context.slice(0, 100)}`
        : `No success patterns found for "${intent}". Consider starting with small experiments.`,
    avoidances:
      failures.length > 0
        ? failures
            .map((f) => f.whatWentWrong)
            .filter(Boolean)
            .slice(0, 3)
        : [],
  };

  return textResult(JSON.stringify(plan));
}

async function handleSatisfyGate(
  params: Record<string, unknown>,
  ownerId: string,
  env: Env,
): Promise<ToolResult> {
  const gateId = params.gate_id as string;
  const condition = params.condition as string;
  const ttlSeconds = (params.ttl_seconds as number) ?? 300;

  const state = await satisfyGate(env, ownerId, gateId, condition, ttlSeconds);
  return textResult(JSON.stringify(state));
}

// --- Helpers ---

function textResult(text: string, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}
