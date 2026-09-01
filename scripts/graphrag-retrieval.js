'use strict';

/**
 * graphrag-retrieval.js — deterministic multi-hop expansion for lesson retrieval.
 *
 * Pattern source: "Why basic RAG fails at multi-hop reasoning (and how GraphRAG
 * fixes it)" (The New Stack, 2026). Three lessons encoded here:
 *
 *  1. Explicit schema, not vibes: nodes are lessons, edges are typed and
 *     weighted (shared tags, shared domain). The graph is plain JSON — the
 *     article's "just look at the dashboard" observability property: you can
 *     see every edge, so a hallucinated link is impossible.
 *  2. Deterministic traversal: multi-hop questions are answered by BFS over
 *     edges with decaying scores — no embedding cosine guessing which doc is
 *     "near". A relevant doc with ZERO lexical overlap with the query is still
 *     reachable if the graph connects it.
 *  3. Never worse than single-hop: expansion only ADDS reachable neighbors to
 *     the seed ranking; with no edges it degrades to the seed order exactly.
 *
 * Ingestion cost (the article's trade-off #1) is kept near zero: edges come
 * from metadata we already capture (tags, domain), not from LLM entity
 * extraction.
 */

const DEFAULT_MAX_HOPS = 2;
const DEFAULT_DECAY = 0.5;

function normalizeToken(value) {
  return String(value || '').toLowerCase().trim();
}

/**
 * Build the graph from a corpus of lesson-shaped records.
 * Nodes: {id, tags, domain}. Edges: undirected, weight = shared tag count,
 * plus a +1 domain bonus when both docs carry the same metadata.domain.
 *
 * @param {Array<{id:string, tags?:string[], metadata?:{domain?:string}}>} corpus
 * @returns {{nodes: Map<string, Object>, adjacency: Map<string, Array<{to:string, weight:number, via:string[]}>}, edgeCount: number}}
 */
function buildGraph(corpus = []) {
  const nodes = new Map();
  for (const doc of corpus) {
    if (!doc || !doc.id) continue;
    nodes.set(doc.id, {
      id: doc.id,
      tags: new Set((Array.isArray(doc.tags) ? doc.tags : []).map(normalizeToken).filter(Boolean)),
      domain: normalizeToken(doc.metadata?.domain),
    });
  }

  const adjacency = new Map();
  let edgeCount = 0;
  const ids = [...nodes.keys()];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = nodes.get(ids[i]);
      const b = nodes.get(ids[j]);
      const shared = [];
      for (const tag of a.tags) {
        if (b.tags.has(tag)) shared.push(tag);
      }
      let weight = shared.length;
      const via = shared.map((t) => `tag:${t}`);
      if (a.domain && a.domain === b.domain) {
        weight += 1;
        via.push(`domain:${a.domain}`);
      }
      if (weight <= 0) continue;
      edgeCount += 1;
      if (!adjacency.has(a.id)) adjacency.set(a.id, []);
      if (!adjacency.has(b.id)) adjacency.set(b.id, []);
      adjacency.get(a.id).push({ to: b.id, weight, via });
      adjacency.get(b.id).push({ to: a.id, weight, via });
    }
  }
  return { nodes, adjacency, edgeCount };
}

/**
 * Expand a seed ranking along graph edges (BFS, score-decaying).
 *
 * @param {Array<{id:string, relevanceScore?:number}>} seeds ranked seed results
 * @param {ReturnType<typeof buildGraph>} graph
 * @param {Object} [options]
 * @param {number} [options.maxHops=2]
 * @param {number} [options.decay=0.5] score multiplier per hop
 * @returns {Array<{id:string, finalScore:number, hop:number, via:string[], seedId?:string}>}
 *          merged ranking (seeds first, hop-0), each entry carrying provenance
 */
function expandWithGraph(seeds = [], graph, options = {}) {
  const maxHops = Number.isFinite(options.maxHops) ? options.maxHops : DEFAULT_MAX_HOPS;
  const decay = Number.isFinite(options.decay) ? options.decay : DEFAULT_DECAY;
  if (!graph || !Array.isArray(seeds) || seeds.length === 0) {
    return (Array.isArray(seeds) ? seeds : []).map((s, i) => ({
      id: s.id,
      finalScore: Number(s.relevanceScore ?? 1),
      hop: 0,
      via: [],
      seedRank: i + 1,
    }));
  }

  // Seed scores are rank-based so heterogeneous score scales (lexical, dense,
  // attribute) never dominate the expansion: rank 1 = 1.0, decaying geometrically.
  const seedScore = new Map();
  seeds.forEach((seed, index) => {
    seedScore.set(seed.id, 1 / (index + 1));
  });

  const best = new Map();
  for (const seed of seeds) {
    best.set(seed.id, {
      id: seed.id,
      finalScore: seedScore.get(seed.id),
      hop: 0,
      via: [],
      seedId: seed.id,
    });
  }

  // BFS frontier: id -> {score, path}; keep the strongest pending entry per node
  let frontier = seeds.map((seed) => ({
    id: seed.id,
    score: seedScore.get(seed.id),
    path: [],
  }));

  const visited = new Set(seeds.map((s) => s.id));
  for (let hop = 1; hop <= maxHops; hop += 1) {
    const nextFrontier = [];
    // Track frontier entries so we keep only the strongest pending state per node
    const queuedInFrontier = new Map();
    for (const node of frontier) {
      const edges = graph.adjacency.get(node.id) || [];
      for (const edge of edges) {
        if (edge.weight <= 0) continue;
        // Weight scales reach: a stronger relationship carries further (cap 3).
        const finalScore = node.score * decay * (Math.min(edge.weight, 3) / 3);
        if (finalScore <= 0) continue;
        const existing = best.get(edge.to);
        if (existing && existing.finalScore >= finalScore) continue;
        best.set(edge.to, {
          id: edge.to,
          finalScore,
          hop,
          via: [...node.path, ...edge.via],
          seedId: node.id && seedScore.has(node.id) ? node.id : (best.get(node.id)?.seedId || node.id),
        });
        const existingFrontier = queuedInFrontier.get(edge.to);
        if (!existingFrontier || existingFrontier.score < finalScore) {
          queuedInFrontier.set(edge.to, { id: edge.to, score: finalScore, path: [...node.path, ...edge.via] });
        }
      }
    }
    // Merge queued entries into nextFrontier, preserving visited tracking
    for (const entry of queuedInFrontier.values()) {
      const alreadyQueued = nextFrontier.find((f) => f.id === entry.id);
      if (!alreadyQueued) {
        nextFrontier.push(entry);
        visited.add(entry.id);
      } else if (entry.score > alreadyQueued.score) {
        // Propagate improved state: update in place
        Object.assign(alreadyQueued, entry);
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  return [...best.values()].sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    return a.hop - b.hop; // deterministic tie-break: closer wins
  });
}

/**
 * Multi-hop search: single-hop hybrid retrieval for seeds, then graph expansion.
 * Keeps the exact seed contract — expansion can only surface additional
 * graph-connected lessons, never reorder or drop a seed above its peers.
 *
 * @param {Object} params
 * @param {Array} params.corpus lesson-shaped records (must include id/tags/metadata)
 * @param {string} params.query
 * @param {string} [params.toolName]
 * @param {Object} [params.options] forwarded to pragmaticHybridSearch + expansion knobs
 * @returns {{results: Array, meta: Object}}
 */
function multiHopSearch(params = {}) {
  const { corpus = [], query = '', toolName = 'Bash', options = {} } = params;
  const { pragmaticHybridSearch } = require('./pragmatic-hybrid-search');

  const topK = options.topK || 5;
  const seedPool = Math.max(options.pool || 10, topK);
  const { results: seeds, meta } = pragmaticHybridSearch({
    corpus,
    query,
    toolName,
    options: { ...options, topK: seedPool, pool: seedPool, diversify: false },
  });

  if (seeds.length === 0) {
    return { results: [], meta: { ...meta, graphExpanded: false, hops: 0, edges: 0 } };
  }

  const graph = buildGraph(corpus);
  const expanded = expandWithGraph(seeds, graph, {
    maxHops: options.maxHops,
    decay: options.decay,
  });

  const byId = new Map(corpus.map((doc) => [doc.id, doc]));

  // Preserve the baseline single-hop top-K seed results before adding
  // graph-only candidates. Expansion can surface additional entries, but
  // graph-only candidates must never displace baseline seeds — this
  // upholds the "never worse than single-hop" contract.
  const seedIds = new Set(seeds.slice(0, topK).map((s) => s.id));
  const seedResults = [];
  for (const entry of expanded) {
    if (seedIds.has(entry.id)) {
      seedResults.push(entry);
    }
  }
  // Sort seed results by their original single-hop rank, then append graph-only entries
  const seedOrder = new Map(seeds.map((s, i) => [s.id, i]));
  seedResults.sort((a, b) => (seedOrder.get(a.id) || 0) - (seedOrder.get(b.id) || 0));
  const graphOnlyEntries = expanded.filter((e) => !seedIds.has(e.id));
  const merged = [...seedResults, ...graphOnlyEntries].slice(0, topK);

  const results = merged.map((entry) => ({
    ...(byId.get(entry.id) || { id: entry.id }),
    graphHop: entry.hop,
    graphVia: entry.via,
    graphScore: Number(entry.finalScore.toFixed(4)),
  }));

  return {
    results,
    meta: {
      ...meta,
      strategy: `${meta.strategy || 'lexical'}+graphrag`,
      graphExpanded: true,
      graphEdges: graph.edgeCount,
      hopsUsed: Math.max(...results.map((r) => r.graphHop || 0), 0),
    },
  };
}

module.exports = {
  buildGraph,
  expandWithGraph,
  multiHopSearch,
  DEFAULT_MAX_HOPS,
  DEFAULT_DECAY,
};
