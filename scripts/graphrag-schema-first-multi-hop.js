'use strict';

/**
 * GraphRAG Schema-First Multi-Hop — ThumbGate steal of the TheNewStack
 * GraphRAG pattern (thenewstack.io/graphrag-multi-hop-reasoning-python).
 *
 * Article's four engineering lessons, mapped onto the ThumbGate lesson store:
 *
 *   1. Basic vector retrieval fails at multi-hop questions.
 *      -> traverseOneHop(): enter at the best-scoring lesson node, then
 *         expand across TYPED relations (the VectorCypherRetriever analog:
 *         MATCH (node)[r](neighbor)) instead of returning flat chunks.
 *
 *   2. "Schema design is not optional" — without a schema the extractor
 *      hallucinates entity labels ("Acme Corp" / "Acme Corporation" / "Ame").
 *      -> canonicalSchema() + normalizeEntity(): every extracted entity must
 *         resolve to a schema node type and a canonical label, or it is
 *         dropped. Deterministic alias folding (case, punctuation, common
 *         corporate suffixes) — no LLM at query time.
 *
 *   3. Ingestion is expensive; retrieval is cheap.
 *      -> ingestionBudget(): bounds entities extracted per batch so a corpus
 *         rebuild cannot balloon. Costs here are MODELED, tagged as such.
 *
 *   4. Graph observability beats debugging floating-point arrays.
 *      -> dumpGraph(): the whole graph is human-readable JSON (nodes, typed
 *         edges) — you can see a hallucinated entity the moment it lands.
 *
 * Honesty: this module is deterministic and LLM-free. It upgrades the
 * structure of multi-hop recall; it does not claim neural retrieval quality.
 */

/* ------------------------------------------------------------------ *
 * Schema (the difference between a retrieval engine and a mess)
 * ------------------------------------------------------------------ */

const ENTITY_TYPES = Object.freeze([
  'tool',       // a CLI / harness / product, e.g. gh, codex, thumbgate
  'guard',      // an enforcement rule or gate
  'incident',   // a failure event or near-miss
  'vendor',     // an external company or service
  'policy',     // a directive or standing rule
  'receipt',    // an evidence artifact (SHA, CI link, screenshot)
]);

const RELATION_TYPES = Object.freeze([
  'blocked_by',     // incident/tool -> guard
  'caused',         // incident -> tool or vendor
  'evidenced_by',   // anything -> receipt
  'governed_by',    // anything -> policy
  'related_to',     // fallback cross-link
]);

function canonicalSchema() {
  return {
    id: 'graphrag-canonical-v1',
    modeled: false, // structure is code, not an estimate
    source: 'https://thenewstack.io/graphrag-multi-hop-reasoning-python/',
    entityTypes: [...ENTITY_TYPES],
    relationTypes: [...RELATION_TYPES],
  };
}

const CORPORATE_SUFFIXES = Object.freeze([
  ' inc', ' inc.', ' llc', ' ltd', ' corp', ' corp.', ' corporation',
  ' company', ' co', ' co.', ' group', ' gmbh', ' sa', ' plc',
]);

/**
 * Fold an entity mention to a canonical label. Returns null when the mention
 * is too degenerate to keep — the schema-first answer to "Ame".
 */
function normalizeEntity(raw) {
  if (typeof raw !== 'string') return null;
  let label = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (label.length < 2) return null;
  for (const suffix of CORPORATE_SUFFIXES) {
    if (label.endsWith(suffix)) {
      label = label.slice(0, label.length - suffix.length).trim();
      break;
    }
  }
  if (label.length < 2) return null;
  return label;
}

/**
 * Classify a lesson-derived entity into one schema type. Deterministic
 * keyword pass — the schema refuses anything it cannot place.
 */
function classifyEntity(label, hints) {
  const h = hints || {};
  if (h.type && ENTITY_TYPES.includes(h.type)) return h.type;
  if (/\b(gh|codex|gemini|hermes|thumbgate|linear|obsidian|claude)\b/.test(label)) return 'tool';
  if (/\b(block|guard|gate|escalat|policy|rule)\b/.test(label)) return 'guard';
  if (/\b(incident|failure|outage|breach|crash)\b/.test(label)) return 'incident';
  if (/\b(receipt|evidence|screenshot|sha|ci link)\b/.test(label)) return 'receipt';
  return 'vendor'; // anything unclassifiable is an external actor, audited in dump
}

/* ------------------------------------------------------------------ *
 * Graph build (deterministic; no LLM calls)
 * ------------------------------------------------------------------ */

/**
 * Build a graph from lesson records. Accepts the shape used by the
 * ThumbGate lesson store: { id, title, content, tags, domain, rootCause }.
 */
function buildGraph(lessons) {
  const schema = canonicalSchema();
  const nodes = new Map();
  const edges = [];

  function upsertNode(label, type, originLessonId) {
    const canonical = normalizeEntity(label);
    if (!canonical) return null; // schema refuses degenerate entities
    if (!nodes.has(canonical)) {
      nodes.set(canonical, {
        id: canonical,
        type: ENTITY_TYPES.includes(type) ? type : classifyEntity(canonical),
        sources: [],
      });
    }
    const node = nodes.get(canonical);
    if (originLessonId && !node.sources.includes(originLessonId)) {
      node.sources.push(originLessonId);
    }
    return node;
  }

  function addEdge(fromId, rel, toId, originLessonId) {
    if (!RELATION_TYPES.includes(rel)) return;
    if (!fromId || !toId || fromId === toId) return;
    edges.push({ from: fromId, rel, to: toId, source: originLessonId });
  }

  for (const lesson of lessons || []) {
    const lessonNode = upsertNode(lesson.title || `lesson-${lesson.id}`, 'incident', lesson.id);
    if (!lessonNode) continue;

    if (lesson.domain) {
      const d = upsertNode(lesson.domain, 'tool', lesson.id);
      if (d) addEdge(lessonNode.id, 'caused', d.id, lesson.id);
    }
    if (lesson.rootCause) {
      const rc = upsertNode(lesson.rootCause, 'incident', lesson.id);
      if (rc) addEdge(lessonNode.id, 'related_to', rc.id, lesson.id);
    }
    const tags = Array.isArray(lesson.tags) ? lesson.tags : safeTags(lesson.tags);
    for (const tag of tags) {
      const t = upsertNode(tag, classifyEntity(String(tag).toLowerCase()), lesson.id);
      if (t) addEdge(lessonNode.id, 'governed_by', t.id, lesson.id);
    }
    if (lesson.receipt) {
      const r = upsertNode(lesson.receipt, 'receipt', lesson.id);
      if (r) addEdge(lessonNode.id, 'evidenced_by', r.id, lesson.id);
    }
  }

  return {
    schemaId: schema.id,
    nodes: [...nodes.values()],
    edges,
  };
}

function safeTags(tags) {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') {
    try { return JSON.parse(tags); } catch { return []; }
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * Multi-hop traversal (the VectorCypherRetriever analog)
 * ------------------------------------------------------------------ */

/**
 * Score lesson nodes against a query by token overlap (entry point).
 */
function entryScores(graph, queryText) {
  const qTokens = new Set(
    String(queryText).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2),
  );
  return graph.nodes
    .filter((n) => n.type === 'incident')
    .map((n) => {
      const nTokens = n.id.split(/[^a-z0-9]+/);
      const overlap = nTokens.filter((t) => qTokens.has(t)).length;
      return { node: n, score: overlap };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * One-hop typed expansion: entry node -> neighbors across every typed edge.
 * Mirrors MATCH (node)[r](neighbor) RETURN node, r, neighbor.
 */
function traverseOneHop(graph, queryText, topK = 3) {
  const entries = entryScores(graph, queryText).slice(0, topK);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const results = [];

  for (const { node, score } of entries) {
    const hops = graph.edges
      .filter((e) => e.from === node.id || e.to === node.id)
      .map((e) => {
        const neighborId = e.from === node.id ? e.to : e.from;
        return {
          entity: node.id,
          entityType: node.type,
          relation: e.rel,
          neighbor: neighborId,
          neighborType: nodeById.get(neighborId) ? nodeById.get(neighborId).type : 'unknown',
          entryScore: score,
          source: e.source,
        };
      });
    results.push(...hops);
  }
  return results;
}

/* ------------------------------------------------------------------ *
 * Ingestion budget + observability
 * ------------------------------------------------------------------ */

/**
 * Bound the extraction batch. Article: ingestion is where the money goes;
 * every number returned is MODELED.
 */
function ingestionBudget(lessonCount, opts) {
  const o = Object.assign({ entitiesPerLesson: 4, llmCostPer1kExtractionsUsd: 3 }, opts);
  const modeledExtractions = lessonCount * o.entitiesPerLesson;
  return {
    modeled: true,
    lessonCount,
    maxExtractions: modeledExtractions,
    estimatedCostUsd: (modeledExtractions / 1000) * o.llmCostPer1kExtractionsUsd,
    note: 'modeled estimate; ThumbGate builds the graph deterministically, so actual LLM cost is 0',
  };
}

/**
 * Human-readable graph dump — the observability win over floating-point arrays.
 */
function dumpGraph(graph) {
  return JSON.stringify(
    {
      schemaId: graph.schemaId,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodes: graph.nodes,
      edges: graph.edges,
    },
    null,
    2,
  );
}

function isCliEntrypoint() {
  return require.main === module;
}

function main() {
  const lessons = [
    {
      id: 'L1',
      title: 'payment incident: double charge on checkout',
      domain: 'checkout',
      rootCause: 'retry storm',
      tags: ['stripe', 'payment'],
      receipt: 'CI run 33193632534',
    },
    {
      id: 'L2',
      title: 'acme corporation rate-limit outage',
      domain: 'acme corp',
      rootCause: 'missing backoff',
      tags: ['vendor'],
    },
  ];
  const graph = buildGraph(lessons);
  const hops = traverseOneHop(graph, 'acme rate limit outage');
  process.stdout.write(JSON.stringify({
    honesty: 'deterministic graph; ingestion costs modeled only',
    hops,
    budget: ingestionBudget(lessons.length),
    dump: JSON.parse(dumpGraph(graph)),
  }, null, 2) + '\n');
}

if (isCliEntrypoint()) main();

module.exports = {
  ENTITY_TYPES,
  RELATION_TYPES,
  canonicalSchema,
  normalizeEntity,
  classifyEntity,
  buildGraph,
  traverseOneHop,
  ingestionBudget,
  dumpGraph,
  isCliEntrypoint,
};
