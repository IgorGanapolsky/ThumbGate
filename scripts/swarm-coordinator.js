'use strict';

const { constructContextPack, recordProvenance } = require('./contextfs');

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_AGENTS = 32;

function normalizeAgents(agents) {
  if (!Array.isArray(agents)) {
    throw new Error('agents must be a non-empty array of agent names');
  }
  const normalized = [];
  const seen = new Set();
  for (const raw of agents) {
    const name = typeof raw === 'string' ? raw.trim() : String((raw && raw.name) || '').trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    normalized.push(name);
  }
  if (normalized.length === 0) {
    throw new Error('agents must include at least one named agent');
  }
  if (normalized.length > MAX_AGENTS) {
    throw new Error(`agents list exceeds MAX_AGENTS (${MAX_AGENTS})`);
  }
  return normalized;
}

function distributeContextToAgents({
  query = '',
  agents,
  maxItems,
  maxChars,
  namespaces,
  ttlMs,
} = {}) {
  const agentNames = normalizeAgents(agents);
  const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl).toISOString();

  const pack = constructContextPack({
    query,
    maxItems: Number.isFinite(Number(maxItems)) && Number(maxItems) > 0 ? Number(maxItems) : undefined,
    maxChars: Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 ? Number(maxChars) : undefined,
    namespaces: Array.isArray(namespaces) ? namespaces : [],
  });

  const itemCount = Array.isArray(pack.items) ? pack.items.length : 0;
  const distributions = agentNames.map((agent) => {
    const provenance = recordProvenance({
      type: 'context_pack_distributed',
      packId: pack.packId,
      agent,
      query: pack.query,
      itemCount,
      expiresAt,
    });
    return {
      agent,
      packId: pack.packId,
      provenanceId: provenance.id,
      expiresAt,
    };
  });

  return {
    packId: pack.packId,
    query: pack.query,
    totalAgents: distributions.length,
    itemCount,
    expiresAt,
    distributions,
  };
}

module.exports = {
  distributeContextToAgents,
  DEFAULT_TTL_MS,
  MAX_AGENTS,
};
