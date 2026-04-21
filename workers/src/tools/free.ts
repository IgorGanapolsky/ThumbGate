import type { Env, McpTool, ToolResult, AuthResult } from '../types';
import {
  storeFeedback,
  listFeedback,
  searchMemories,
  storeMemory,
  checkRateLimit,
  getOwnerId,
} from '../storage';

/** Free tier tool definitions */
export const FREE_TOOLS: McpTool[] = [
  {
    name: 'capture_feedback',
    description:
      'Capture explicit up/down feedback with context. Free: 3/day. Pro: unlimited.',
    inputSchema: {
      type: 'object',
      properties: {
        feedback: {
          type: 'string',
          enum: ['up', 'down'],
          description: 'Positive (up) or negative (down) feedback signal',
        },
        context: {
          type: 'string',
          description: 'What was being attempted when feedback was given',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Categorization tags',
        },
        what_worked: {
          type: 'string',
          description: 'What worked well (for positive feedback)',
        },
        what_went_wrong: {
          type: 'string',
          description: 'What went wrong (for negative feedback)',
        },
        what_to_change: {
          type: 'string',
          description: 'Suggested change (for negative feedback)',
        },
      },
      required: ['feedback', 'context'],
    },
  },
  {
    name: 'recall',
    description:
      'Search memories by keyword query. Free: 5/day. Pro: unlimited.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        namespace: {
          type: 'string',
          description: 'Memory namespace (default: "default")',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'feedback_summary',
    description: 'Get a summary of recent feedback entries.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of recent entries to summarize (default: 20)',
        },
      },
    },
  },
  {
    name: 'feedback_stats',
    description:
      'Get feedback statistics: counts, up/down ratio, top tags.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of recent entries to analyze (default: 100)',
        },
      },
    },
  },
  {
    name: 'prevention_rules',
    description:
      'Generate prevention rules from repeated negative feedback patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        min_occurrences: {
          type: 'number',
          description:
            'Minimum times a pattern must appear to generate a rule (default: 2)',
        },
      },
    },
  },
];

const FREE_TOOL_NAMES = new Set(FREE_TOOLS.map((t) => t.name));

export function isFreeTool(name: string): boolean {
  return FREE_TOOL_NAMES.has(name);
}

/** Execute a free-tier tool */
export async function executeFree(
  name: string,
  params: Record<string, unknown>,
  auth: AuthResult,
  request: Request,
  env: Env,
): Promise<ToolResult> {
  const ownerId = getOwnerId(auth.customerId, request);
  const dailyLimit =
    auth.tier === 'pro' ? Infinity : parseInt(env.FREE_DAILY_LIMIT || '3', 10);

  switch (name) {
    case 'capture_feedback':
      return handleCaptureFeedback(params, ownerId, dailyLimit, env);
    case 'recall':
      return handleRecall(params, ownerId, dailyLimit, env);
    case 'feedback_summary':
      return handleFeedbackSummary(params, ownerId, env);
    case 'feedback_stats':
      return handleFeedbackStats(params, ownerId, env);
    case 'prevention_rules':
      return handlePreventionRules(params, ownerId, env);
    default:
      return textResult(`Unknown free tool: ${name}`, true);
  }
}

// --- Tool Implementations ---

async function handleCaptureFeedback(
  params: Record<string, unknown>,
  ownerId: string,
  dailyLimit: number,
  env: Env,
): Promise<ToolResult> {
  if (dailyLimit !== Infinity) {
    const rl = await checkRateLimit(env, ownerId, 'capture_feedback', dailyLimit);
    if (!rl.allowed) {
      return textResult(
        `Free tier limit reached. Upgrade to Pro for unlimited: https://thumbgate.ai/pro — ${rl.remaining} captures remaining. Resets at ${rl.resetAt}.`,
        true,
      );
    }
  }

  const feedback = params.feedback as 'up' | 'down';
  const context = params.context as string;
  if (!feedback || !context) {
    return textResult('Missing required: feedback, context', true);
  }

  const entry = await storeFeedback(env, ownerId, {
    feedback,
    context,
    tags: (params.tags as string[]) ?? [],
    whatWorked: params.what_worked as string | undefined,
    whatWentWrong: params.what_went_wrong as string | undefined,
    whatToChange: params.what_to_change as string | undefined,
  });

  // Also store as a memory for recall
  await storeMemory(env, ownerId, {
    content: `[${feedback}] ${context}${entry.whatWorked ? ' | worked: ' + entry.whatWorked : ''}${entry.whatWentWrong ? ' | wrong: ' + entry.whatWentWrong : ''}`,
    namespace: 'feedback',
    tags: entry.tags,
  });

  return textResult(
    JSON.stringify({ stored: true, id: entry.id, feedback: entry.feedback }),
  );
}

async function handleRecall(
  params: Record<string, unknown>,
  ownerId: string,
  dailyLimit: number,
  env: Env,
): Promise<ToolResult> {
  if (dailyLimit !== Infinity) {
    const rl = await checkRateLimit(env, ownerId, 'recall', dailyLimit);
    if (!rl.allowed) {
      return textResult(
        `Free tier limit reached. Upgrade to Pro for unlimited: https://thumbgate.ai/pro — Resets at ${rl.resetAt}.`,
        true,
      );
    }
  }

  const query = params.query as string;
  if (!query) return textResult('Missing required: query', true);

  const namespace = (params.namespace as string) ?? 'default';
  const limit = (params.limit as number) ?? 10;

  const results = await searchMemories(env, ownerId, query, namespace, limit);

  // Also search feedback namespace
  const feedbackResults = await searchMemories(
    env,
    ownerId,
    query,
    'feedback',
    limit,
  );

  const combined = [...results, ...feedbackResults].slice(0, limit);
  return textResult(JSON.stringify({ count: combined.length, results: combined }));
}

async function handleFeedbackSummary(
  params: Record<string, unknown>,
  ownerId: string,
  env: Env,
): Promise<ToolResult> {
  const limit = (params.limit as number) ?? 20;
  const entries = await listFeedback(env, ownerId, limit);

  const summary = {
    total: entries.length,
    entries: entries.map((e) => ({
      id: e.id,
      feedback: e.feedback,
      context: e.context.slice(0, 200),
      tags: e.tags,
      timestamp: e.timestamp,
    })),
  };

  return textResult(JSON.stringify(summary));
}

async function handleFeedbackStats(
  params: Record<string, unknown>,
  ownerId: string,
  env: Env,
): Promise<ToolResult> {
  const limit = (params.limit as number) ?? 100;
  const entries = await listFeedback(env, ownerId, limit);

  const up = entries.filter((e) => e.feedback === 'up').length;
  const down = entries.filter((e) => e.feedback === 'down').length;
  const total = entries.length;

  const tagCounts: Record<string, number> = {};
  for (const entry of entries) {
    for (const tag of entry.tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }

  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  return textResult(
    JSON.stringify({
      total,
      up,
      down,
      ratio: total > 0 ? (up / total).toFixed(2) : '0.00',
      topTags,
    }),
  );
}

async function handlePreventionRules(
  params: Record<string, unknown>,
  ownerId: string,
  env: Env,
): Promise<ToolResult> {
  const minOccurrences = (params.min_occurrences as number) ?? 2;
  const entries = await listFeedback(env, ownerId, 200);

  const negatives = entries.filter((e) => e.feedback === 'down');

  // Group by tags to find patterns
  const tagGroups: Record<string, typeof negatives> = {};
  for (const entry of negatives) {
    for (const tag of entry.tags) {
      if (!tagGroups[tag]) tagGroups[tag] = [];
      tagGroups[tag].push(entry);
    }
  }

  const rules: Array<{ tag: string; occurrences: number; rule: string }> = [];
  for (const [tag, group] of Object.entries(tagGroups)) {
    if (group.length >= minOccurrences) {
      const issues = group
        .map((e) => e.whatWentWrong ?? e.context)
        .slice(0, 3);
      const changes = group
        .map((e) => e.whatToChange)
        .filter(Boolean)
        .slice(0, 3);

      rules.push({
        tag,
        occurrences: group.length,
        rule: `PREVENT [${tag}]: Seen ${group.length}x. Issues: ${issues.join('; ')}${changes.length > 0 ? '. Fix: ' + changes.join('; ') : ''}`,
      });
    }
  }

  return textResult(
    JSON.stringify({
      rulesGenerated: rules.length,
      rules,
      analyzedEntries: negatives.length,
    }),
  );
}

// --- Helpers ---

function textResult(text: string, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}
