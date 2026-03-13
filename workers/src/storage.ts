import type { Env, FeedbackEntry, MemoryEntry, RateLimitResult } from './types';

/** Key prefix helpers — all data is namespaced by customer/install ID */
function feedbackKey(ownerId: string, id: string): string {
  return `feedback:${ownerId}:${id}`;
}

function feedbackIndexKey(ownerId: string): string {
  return `feedback-index:${ownerId}`;
}

function memoryKey(ownerId: string, namespace: string, id: string): string {
  return `memory:${ownerId}:${namespace}:${id}`;
}

function memoryIndexKey(ownerId: string, namespace: string): string {
  return `memory-index:${ownerId}:${namespace}`;
}

function rateLimitKey(ownerId: string, action: string, date: string): string {
  return `ratelimit:${ownerId}:${action}:${date}`;
}

/** Get today's date string in UTC */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Generate a short unique ID */
function uid(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Derive an owner ID from auth or request (IP/install-id for free tier) */
export function getOwnerId(
  customerId: string | null,
  request: Request,
): string {
  if (customerId) return customerId;
  const installId = request.headers.get('x-install-id');
  if (installId) return `anon:${installId}`;
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  return `anon:${ip}`;
}

// --- Rate Limiting ---

export async function checkRateLimit(
  env: Env,
  ownerId: string,
  action: string,
  limit: number,
): Promise<RateLimitResult> {
  const today = todayUTC();
  const key = rateLimitKey(ownerId, action, today);
  const current = parseInt((await env.MEMORY_KV.get(key)) ?? '0', 10);

  if (current >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: `${today}T23:59:59Z`,
    };
  }

  await env.MEMORY_KV.put(key, String(current + 1), {
    expirationTtl: 86400, // 24h TTL for auto-cleanup
  });

  return {
    allowed: true,
    remaining: limit - current - 1,
    resetAt: `${today}T23:59:59Z`,
  };
}

// --- Feedback Storage ---

export async function storeFeedback(
  env: Env,
  ownerId: string,
  entry: Omit<FeedbackEntry, 'id' | 'timestamp'>,
): Promise<FeedbackEntry> {
  const id = uid();
  const full: FeedbackEntry = {
    ...entry,
    id,
    timestamp: new Date().toISOString(),
  };

  await env.MEMORY_KV.put(feedbackKey(ownerId, id), JSON.stringify(full));

  // Append to index (list of IDs, most recent first, capped at 1000)
  const indexRaw = await env.MEMORY_KV.get(feedbackIndexKey(ownerId));
  const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
  index.unshift(id);
  if (index.length > 1000) index.length = 1000;
  await env.MEMORY_KV.put(feedbackIndexKey(ownerId), JSON.stringify(index));

  return full;
}

export async function listFeedback(
  env: Env,
  ownerId: string,
  limit = 50,
): Promise<FeedbackEntry[]> {
  const indexRaw = await env.MEMORY_KV.get(feedbackIndexKey(ownerId));
  if (!indexRaw) return [];
  const index: string[] = JSON.parse(indexRaw);
  const ids = index.slice(0, limit);

  const entries: FeedbackEntry[] = [];
  for (const id of ids) {
    const raw = await env.MEMORY_KV.get(feedbackKey(ownerId, id));
    if (raw) entries.push(JSON.parse(raw));
  }
  return entries;
}

// --- Memory Storage ---

export async function storeMemory(
  env: Env,
  ownerId: string,
  entry: Omit<MemoryEntry, 'id' | 'timestamp'>,
): Promise<MemoryEntry> {
  const id = uid();
  const ns = entry.namespace || 'default';
  const full: MemoryEntry = {
    ...entry,
    id,
    namespace: ns,
    timestamp: new Date().toISOString(),
  };

  await env.MEMORY_KV.put(memoryKey(ownerId, ns, id), JSON.stringify(full));

  const indexRaw = await env.MEMORY_KV.get(memoryIndexKey(ownerId, ns));
  const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
  index.unshift(id);
  if (index.length > 5000) index.length = 5000;
  await env.MEMORY_KV.put(
    memoryIndexKey(ownerId, ns),
    JSON.stringify(index),
  );

  return full;
}

export async function searchMemories(
  env: Env,
  ownerId: string,
  query: string,
  namespace = 'default',
  limit = 20,
): Promise<MemoryEntry[]> {
  const indexRaw = await env.MEMORY_KV.get(memoryIndexKey(ownerId, namespace));
  if (!indexRaw) return [];
  const index: string[] = JSON.parse(indexRaw);

  const queryLower = query.toLowerCase();
  const results: MemoryEntry[] = [];

  // Simple keyword search across stored memories
  for (const id of index) {
    if (results.length >= limit) break;
    const raw = await env.MEMORY_KV.get(memoryKey(ownerId, namespace, id));
    if (!raw) continue;
    const entry: MemoryEntry = JSON.parse(raw);
    if (
      entry.content.toLowerCase().includes(queryLower) ||
      entry.tags.some((t) => t.toLowerCase().includes(queryLower))
    ) {
      results.push(entry);
    }
  }

  return results;
}

export async function listMemories(
  env: Env,
  ownerId: string,
  namespace = 'default',
  limit = 50,
): Promise<MemoryEntry[]> {
  const indexRaw = await env.MEMORY_KV.get(memoryIndexKey(ownerId, namespace));
  if (!indexRaw) return [];
  const index: string[] = JSON.parse(indexRaw);
  const ids = index.slice(0, limit);

  const entries: MemoryEntry[] = [];
  for (const id of ids) {
    const raw = await env.MEMORY_KV.get(memoryKey(ownerId, namespace, id));
    if (raw) entries.push(JSON.parse(raw));
  }
  return entries;
}
