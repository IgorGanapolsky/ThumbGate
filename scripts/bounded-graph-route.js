'use strict';

/**
 * Bounded graph route for one lesson question.
 *
 * Source playbook: https://music.youtube.com/watch?v=emDutDLIiow
 * Deterministic. No model call. Community summaries use an assigned
 * communityId, or a connected component when none was assigned.
 */

const path = require('path');

const SOURCE = 'https://music.youtube.com/watch?v=emDutDLIiow';

const CLASSES = freezeRecords({
  question: {
    definition: 'A multi-hop operator question this route is allowed to answer.',
    systemOfRecord: 'operator-question',
  },
  lesson: {
    definition: 'A retained lesson from the lesson store.',
    systemOfRecord: 'lesson-store',
  },
  gate: {
    definition: 'A prevention rule that can block a tool call.',
    systemOfRecord: 'prevention-rules',
  },
  tool: {
    definition: 'A tool name recorded in a tool log.',
    systemOfRecord: 'tool-log',
  },
  incident: {
    definition: 'A recorded failure from the feedback log.',
    systemOfRecord: 'feedback-log',
  },
  policy: {
    definition: 'A standing rule from the agent instructions.',
    systemOfRecord: 'agents-md',
  },
  receipt: {
    definition: 'A proof artifact with a recorded outcome.',
    systemOfRecord: 'proof-pack',
  },
  vendor: {
    definition: 'An external supplier named in a lesson.',
    systemOfRecord: 'lesson-store',
  },
  actor: {
    definition: 'A session identity from the checkout lease.',
    systemOfRecord: 'session-lease',
  },
  repo: {
    definition: 'A git repository the lesson is about.',
    systemOfRecord: 'git',
  },
  claim: {
    definition: 'A sentence an answer asserts.',
    systemOfRecord: 'answer',
  },
  source: {
    definition: 'A corpus passage that can support a claim.',
    systemOfRecord: 'corpus',
  },
});

const RELATIONS = freezeRecords({
  asks_about: { from: 'question', to: 'lesson', cardinality: '1..n' },
  cites: { from: 'lesson', to: 'source', cardinality: '1..n' },
  blocked_by: { from: 'incident', to: 'gate', cardinality: 'n..1' },
  caused_by: { from: 'incident', to: 'tool', cardinality: 'n..n' },
  evidenced_by: { from: 'incident', to: 'receipt', cardinality: '1..n' },
  governed_by: { from: 'gate', to: 'policy', cardinality: 'n..1' },
  owned_by: { from: 'repo', to: 'actor', cardinality: 'n..1' },
  supplied_by: { from: 'tool', to: 'vendor', cardinality: 'n..1' },
  supported_by: { from: 'claim', to: 'source', cardinality: '1..n' },
  supersedes: { from: 'lesson', to: 'lesson', cardinality: 'n..1' },
  about: { from: 'lesson', to: 'repo', cardinality: 'n..n' },
});

const CORPORATE_SUFFIXES = Object.freeze([
  'incorporated', 'corporation', 'laboratories', 'laboratory', 'company',
  'limited', 'labs', 'lab', 'ltd', 'llc', 'inc', 'corp', 'co', 'gmbh', 'plc',
]);

const WRITE_KEYWORD = /\b(CREATE|DELETE|SET|MERGE|DROP|REMOVE)\b/i;

function freezeRecords(records) {
  for (const value of Object.values(records)) Object.freeze(value);
  return Object.freeze(records);
}

function ontology() {
  return {
    source: SOURCE,
    classes: Object.entries(CLASSES).map(([name, meta]) => ({ name, ...meta })),
    relations: Object.entries(RELATIONS).map(([name, meta]) => ({
      name,
      from: meta.from,
      to: meta.to,
      cardinality: meta.cardinality,
      direction: `${meta.from}->${meta.to}`,
    })),
    bounds: { minClasses: 10, maxClasses: 40, minRelations: 10, maxRelations: 30 },
  };
}

function createGraph() {
  return {
    nodes: new Map(),
    aliases: new Map(),
    edges: [],
    extractions: 0,
    violations: 0,
  };
}

function normalizeMention(raw) {
  if (typeof raw !== 'string') return '';
  let text = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of CORPORATE_SUFFIXES) {
      const tail = ` ${suffix}`;
      if (text.endsWith(tail) && text.length > tail.length) {
        text = text.slice(0, -tail.length).trim();
        changed = true;
      }
    }
  }
  return text;
}

function normalizeQuery(raw) {
  if (typeof raw !== 'string') return '';
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function registerEntity(graph, spec) {
  if (!spec || typeof spec !== 'object') return { ok: false, reason: 'missing_entity' };
  if (!CLASSES[spec.type]) return { ok: false, reason: 'unknown_class' };
  if (typeof spec.id !== 'string' || spec.id.length === 0) return { ok: false, reason: 'missing_id' };

  const label = typeof spec.label === 'string' && spec.label.trim() ? spec.label : spec.id;
  const aliasList = [label, ...(Array.isArray(spec.aliases) ? spec.aliases : [])];
  let id = spec.id;
  for (const alias of aliasList) {
    const key = normalizeMention(alias);
    if (key && graph.aliases.has(key)) {
      id = graph.aliases.get(key);
      break;
    }
  }
  if (graph.nodes.has(spec.id)) id = spec.id;

  let node = graph.nodes.get(id);
  if (!node) {
    node = {
      id,
      type: spec.type,
      label,
      passage: typeof spec.passage === 'string' ? spec.passage : '',
      acl: Array.isArray(spec.acl) ? spec.acl.slice() : [],
      communityId: typeof spec.communityId === 'string' ? spec.communityId : null,
      aliases: [],
    };
    graph.nodes.set(id, node);
  } else {
    if (typeof spec.passage === 'string' && spec.passage) node.passage = spec.passage;
    if (Array.isArray(spec.acl)) node.acl = spec.acl.slice();
    if (typeof spec.communityId === 'string') node.communityId = spec.communityId;
  }

  for (const alias of aliasList) {
    if (typeof alias !== 'string' || !alias.trim()) continue;
    const key = normalizeMention(alias);
    if (key) graph.aliases.set(key, id);
    if (!node.aliases.includes(alias)) node.aliases.push(alias);
  }
  return { ok: true, id };
}

function resolveEntity(graph, mention) {
  if (typeof mention !== 'string' || !mention.trim()) return null;
  if (graph.nodes.has(mention)) return mention;
  const key = normalizeMention(mention);
  if (key && graph.aliases.has(key)) return graph.aliases.get(key);
  return null;
}

function proposeFact(graph, fact) {
  graph.extractions += 1;
  const rule = fact && RELATIONS[fact.relation];
  if (!rule) {
    graph.violations += 1;
    return { ok: false, reason: 'unknown_relation' };
  }
  const fromId = resolveEntity(graph, fact.from);
  const toId = resolveEntity(graph, fact.to);
  const fromNode = fromId ? graph.nodes.get(fromId) : null;
  const toNode = toId ? graph.nodes.get(toId) : null;
  if (!fromNode || !toNode) {
    graph.violations += 1;
    return { ok: false, reason: 'missing_endpoint' };
  }
  if (fromNode.type !== rule.from || toNode.type !== rule.to) {
    graph.violations += 1;
    return { ok: false, reason: 'endpoint_class' };
  }
  if (rule.cardinality.endsWith('..1')) {
    const conflict = graph.edges.find((edge) => (
      edge.relation === fact.relation
      && edge.from === fromId
      && edge.to !== toId
      && edge.validTo == null
    ));
    if (conflict) {
      graph.violations += 1;
      return { ok: false, reason: 'cardinality' };
    }
  }
  const same = graph.edges.find((edge) => (
    edge.relation === fact.relation && edge.from === fromId && edge.to === toId && edge.validTo == null
  ));
  if (same) return { ok: true, edge: same, duplicate: true };
  const edge = {
    relation: fact.relation,
    from: fromId,
    to: toId,
    validFrom: fact.validFrom || null,
    validTo: fact.validTo || null,
  };
  graph.edges.push(edge);
  return { ok: true, edge };
}

function constraintViolationRate(graph) {
  if (!graph || !graph.extractions) return 0;
  return graph.violations / graph.extractions;
}

function mentionedEntities(graph, query) {
  const hay = ` ${normalizeQuery(query)} `;
  const keys = [...graph.aliases.entries()].sort((left, right) => right[0].length - left[0].length);
  const found = [];
  for (const [key, id] of keys) {
    if (key.length < 3 || found.includes(id)) continue;
    if (hay.includes(` ${key} `)) found.push(id);
  }
  return found;
}

function classifyRoute(graph, query) {
  const text = String(query || '');
  if (/\b(across all|overall|summarize|summarise)\b/i.test(text)) return 'global';
  if (/\b(why|caused|because|blocked by|which policy|multi-hop|path)\b/i.test(text)) return 'hybrid';
  const mentioned = mentionedEntities(graph, text);
  if (mentioned.length === 1 && !/\b(and|between)\b/i.test(text)) return 'local';
  return 'vector';
}

function canRead(node, reader) {
  if (!node.acl || node.acl.length === 0) return true;
  return typeof reader === 'string' && node.acl.includes(reader);
}

function edgeActive(edge, asOf) {
  if (!asOf) return edge.validTo == null;
  if (edge.validFrom && edge.validFrom > asOf) return false;
  if (edge.validTo && edge.validTo <= asOf) return false;
  return true;
}

function visibleNodes(graph, reader) {
  return [...graph.nodes.values()].filter((node) => canRead(node, reader));
}

function viewNode(node) {
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    passage: node.passage,
    communityId: node.communityId,
  };
}

function queryTokens(query) {
  return normalizeQuery(query).split(' ').filter((token) => token.length >= 4);
}

function passageMatches(node, query) {
  const hay = `${node.label} ${node.passage}`.toLowerCase();
  return queryTokens(query).some((token) => hay.includes(token));
}

function findRoot(parent, id) {
  let current = id;
  while (parent.get(current) !== current) current = parent.get(current);
  return current;
}

function buildCommunities(nodes, edges) {
  const parent = new Map(nodes.map((node) => [node.id, node.id]));
  for (const edge of edges) {
    if (!parent.has(edge.from) || !parent.has(edge.to)) continue;
    const left = findRoot(parent, edge.from);
    const right = findRoot(parent, edge.to);
    if (left !== right) parent.set(right, left);
  }
  const groups = new Map();
  for (const node of nodes) {
    const key = node.communityId || `component:${findRoot(parent, node.id)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }
  return [...groups.entries()].map(([communityId, members]) => {
    const labels = members.map((node) => node.label).sort((left, right) => left.localeCompare(right));
    return {
      communityId,
      memberIds: members.map((node) => node.id),
      summary: labels.join('; '),
    };
  }).sort((left, right) => left.communityId.localeCompare(right.communityId));
}

function reachable(seeds, edges, hops) {
  const seen = new Set(seeds);
  let frontier = [...seeds];
  for (let hop = 0; hop < hops; hop += 1) {
    const next = [];
    for (const edge of edges) {
      if (frontier.includes(edge.from) && !seen.has(edge.to)) {
        seen.add(edge.to);
        next.push(edge.to);
      } else if (frontier.includes(edge.to) && !seen.has(edge.from)) {
        seen.add(edge.from);
        next.push(edge.from);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return seen;
}

function retrieve(graph, options = {}) {
  const query = options.query || '';
  const mode = options.mode || classifyRoute(graph, query);
  const nodes = visibleNodes(graph, options.reader);
  const visible = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => (
    edgeActive(edge, options.asOf || null)
    && visible.has(edge.from)
    && visible.has(edge.to)
  ));

  if (mode === 'vector') {
    const hits = nodes.filter((node) => passageMatches(node, query)).slice(0, 1);
    return {
      mode,
      nodes: hits.map(viewNode),
      edges: [],
      passages: hits.map((node) => node.passage || node.label),
      communities: [],
    };
  }

  if (mode === 'local') {
    const seed = mentionedEntities(graph, query).find((id) => visible.has(id)) || null;
    const neighborIds = new Set(seed ? [seed] : []);
    const localEdges = seed ? edges.filter((edge) => edge.from === seed || edge.to === seed) : [];
    for (const edge of localEdges) {
      neighborIds.add(edge.from);
      neighborIds.add(edge.to);
    }
    const picked = nodes.filter((node) => neighborIds.has(node.id));
    return {
      mode,
      nodes: picked.map(viewNode),
      edges: localEdges.map(copyEdge),
      passages: picked.map((node) => node.passage || node.label),
      communities: [],
    };
  }

  if (mode === 'hybrid') {
    const seeds = mentionedEntities(graph, query).filter((id) => visible.has(id));
    const reached = reachable(seeds, edges, 2);
    const picked = nodes.filter((node) => reached.has(node.id));
    const used = edges.filter((edge) => reached.has(edge.from) && reached.has(edge.to));
    return {
      mode,
      nodes: picked.map(viewNode),
      edges: used.map(copyEdge),
      passages: picked.map((node) => node.passage || node.label),
      communities: [],
    };
  }

  const communities = buildCommunities(nodes, edges);
  return {
    mode: 'global',
    nodes: nodes.map(viewNode),
    edges: edges.map(copyEdge),
    passages: communities.map((community) => community.summary),
    communities,
  };
}

function copyEdge(edge) {
  return {
    relation: edge.relation,
    from: edge.from,
    to: edge.to,
    validFrom: edge.validFrom,
    validTo: edge.validTo,
  };
}

function answerQuestion(graph, query, options = {}) {
  return retrieve(graph, { ...options, query });
}

function validateReadQuery(query) {
  if (!query || typeof query !== 'object') return { ok: false, reason: 'query_must_be_object' };
  if (query.op !== 'read') return { ok: false, reason: 'read_only' };
  const text = [query.cypher, query.sparql, query.text].filter((part) => typeof part === 'string').join('\n');
  if (WRITE_KEYWORD.test(text)) return { ok: false, reason: 'write_forbidden' };
  if (query.relation && !RELATIONS[query.relation]) return { ok: false, reason: 'unknown_relation' };
  if (query.fromClass && !CLASSES[query.fromClass]) return { ok: false, reason: 'unknown_class' };
  if (query.toClass && !CLASSES[query.toClass]) return { ok: false, reason: 'unknown_class' };
  const rule = query.relation ? RELATIONS[query.relation] : null;
  if (rule && query.fromClass && rule.from !== query.fromClass) return { ok: false, reason: 'schema_path' };
  if (rule && query.toClass && rule.to !== query.toClass) return { ok: false, reason: 'schema_path' };
  return { ok: true };
}

function applyChanges(graph, changes) {
  const before = new Set(graph.nodes.keys());
  for (const change of changes || []) {
    if (!change || typeof change !== 'object') continue;
    if (change.op === 'upsert_node') {
      registerEntity(graph, change);
    } else if (change.op === 'upsert_edge') {
      proposeFact(graph, change);
    } else if (change.op === 'retire_edge') {
      const fromId = resolveEntity(graph, change.from);
      const toId = resolveEntity(graph, change.to);
      for (const edge of graph.edges) {
        if (edge.relation === change.relation && edge.from === fromId && edge.to === toId && edge.validTo == null) {
          edge.validTo = change.validTo || null;
        }
      }
    }
  }
  const dropped = [...before].filter((id) => !graph.nodes.has(id));
  return { ok: dropped.length === 0, dropped };
}

function scoreGrounding(retrieval, claims, graph) {
  const nodes = (retrieval && retrieval.nodes) || [];
  const byId = new Map(nodes.map((node) => [node.id, String(node.passage || '')]));
  const passages = [...byId.values()];
  const list = Array.isArray(claims) ? claims : [];
  let faithful = 0;
  let cited = 0;
  for (const claim of list) {
    const text = String(claim.text || '');
    if (text && passages.some((passage) => passage.includes(text))) faithful += 1;
    const source = byId.get(claim.sourceId);
    if (text && source && source.includes(text)) cited += 1;
  }
  const denom = list.length || 1;
  return {
    faithfulness: list.length ? faithful / denom : 1,
    citationAccuracy: list.length ? cited / denom : 1,
    constraintViolationRate: graph ? constraintViolationRate(graph) : null,
  };
}

function main() {
  if (!process.argv.includes('--ontology')) return;
  process.stdout.write(`${JSON.stringify(ontology())}\n`);
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = {
  SOURCE,
  CLASSES,
  RELATIONS,
  ontology,
  createGraph,
  normalizeMention,
  registerEntity,
  resolveEntity,
  proposeFact,
  constraintViolationRate,
  classifyRoute,
  retrieve,
  answerQuestion,
  validateReadQuery,
  applyChanges,
  scoreGrounding,
};
