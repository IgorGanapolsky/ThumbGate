import type { Env, GateState } from './types';

function gateKey(ownerId: string, gateId: string): string {
  return `gate:${ownerId}:${gateId}`;
}

function gateIndexKey(ownerId: string): string {
  return `gate-index:${ownerId}`;
}

/**
 * Satisfy a gate condition. Stores in KV with TTL.
 */
export async function satisfyGate(
  env: Env,
  ownerId: string,
  gateId: string,
  condition: string,
  ttlSeconds = 300, // 5 min default
): Promise<GateState> {
  const state: GateState = {
    gateId,
    condition,
    satisfied: true,
    satisfiedAt: new Date().toISOString(),
    ttlSeconds,
  };

  await env.GATES_KV.put(gateKey(ownerId, gateId), JSON.stringify(state), {
    expirationTtl: ttlSeconds,
  });

  // Track in index
  const indexRaw = await env.GATES_KV.get(gateIndexKey(ownerId));
  const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
  if (!index.includes(gateId)) {
    index.push(gateId);
    await env.GATES_KV.put(gateIndexKey(ownerId), JSON.stringify(index));
  }

  return state;
}

/**
 * Check a gate's current state.
 * Returns null if expired or never set.
 */
export async function checkGate(
  env: Env,
  ownerId: string,
  gateId: string,
): Promise<GateState | null> {
  const raw = await env.GATES_KV.get(gateKey(ownerId, gateId));
  if (!raw) return null;
  return JSON.parse(raw);
}

/**
 * List all known gates for an owner.
 * Note: expired gates will return null from KV but remain in the index.
 */
export async function listGates(
  env: Env,
  ownerId: string,
): Promise<GateState[]> {
  const indexRaw = await env.GATES_KV.get(gateIndexKey(ownerId));
  if (!indexRaw) return [];
  const index: string[] = JSON.parse(indexRaw);

  const gates: GateState[] = [];
  for (const gateId of index) {
    const state = await checkGate(env, ownerId, gateId);
    if (state) gates.push(state);
  }
  return gates;
}
