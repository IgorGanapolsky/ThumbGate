#!/usr/bin/env node
'use strict';

/**
 * Always-fused knowledge retrieval: search anchors, then 1–2 hop traversal,
 * then RRF over the union. Time is a filter. Contradictions decline to settle.
 *
 * Process steal from Cekikj, TDS 2026-08-20
 *   https://towardsdatascience.com/making-the-knowledge-layer-a-graph-you-actually-traverse/
 * We are not that Azure/Cosmos Gremlin stack. Complementary to PR #3647
 * scripts/knowledge-layer-plan.js — do not dual-edit that file.
 *
 * Callers cannot pick wiki-first / search-only. Ablation is the acceptance
 * test for whether the graph earned its cost.
 */

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 'thumbgate.knowledge-graph-fuse.v1';
const MAX_HOPS = 2;
const RRF_K = 60;
const RESOLVE_HIGH = 0.92;
const RESOLVE_LOW = 0.75;
const MIN_GOLDEN_CASES = 6;
const MIN_DETERMINISTIC_RECALL = 0.95;
const MIN_PRECISION = 0.15;

function parseTimeBound(value, ifAbsent) {
  if (value == null || value === '') return { ok: true, ms: ifAbsent };
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return { ok: false, ms: NaN };
  return { ok: true, ms };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedId(value) {
  return String(value || '').trim();
}

function edgeIsActive(edge = {}, asOf) {
  if (!asOf) return true;
  const instant = new Date(asOf).getTime();
  if (!Number.isFinite(instant)) return false;
  const from = parseTimeBound(edge.validFrom, Number.NEGATIVE_INFINITY);
  const to = parseTimeBound(edge.validTo, Number.POSITIVE_INFINITY);
  if (!from.ok || !to.ok) return false;
  return instant >= from.ms && instant < to.ms;
}

function reciprocalRankFusion(rankedLists, k = RRF_K) {
  const scores = new Map();
  for (const list of rankedLists) {
    asArray(list).forEach((id, index) => {
      const key = normalizedId(id);
      if (!key) return;
      scores.set(key, (scores.get(key) || 0) + 1 / (k + index + 1));
    });
  }
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id, score]) => ({ id, score: Number(score.toFixed(6)) }));
}

function aliasMatch(mention, node) {
  const needle = String(mention || '').trim().toLowerCase();
  if (!needle) return false;
  const names = [node.id, node.name, ...asArray(node.aliases)].map((value) => String(value || '').trim().toLowerCase());
  return names.includes(needle);
}

function resolveEntities(mentions = [], canonical = [], options = {}) {
  const high = Number(options.highThreshold || RESOLVE_HIGH);
  const low = Number(options.lowThreshold || RESOLVE_LOW);
  const similarity = typeof options.similarity === 'function' ? options.similarity : null;
  return asArray(mentions).map((mention) => {
    const text = typeof mention === 'string' ? mention : mention.text || mention.name || '';
    const aliasHit = asArray(canonical).find((node) => aliasMatch(text, node));
    if (aliasHit) {
      return { mention: text, decision: 'auto_merge', canonicalId: aliasHit.id, score: 1, reversible: true };
    }
    if (!similarity) {
      return { mention: text, decision: 'new_entity', canonicalId: null, score: null, reversible: true };
    }
    let best = { node: null, score: -1 };
    for (const node of canonical) {
      const score = Number(similarity(text, node)) || 0;
      if (score > best.score) best = { node, score };
    }
    if (best.node && best.score >= high) {
      return {
        mention: text,
        decision: 'auto_merge',
        canonicalId: best.node.id,
        score: best.score,
        reversible: true,
      };
    }
    if (!best.node || best.score <= low) {
      return { mention: text, decision: 'new_entity', canonicalId: null, score: best.score, reversible: true };
    }
    return {
      mention: text,
      decision: 'review',
      canonicalId: best.node.id,
      score: best.score,
      reversible: true,
      reason: 'gray_zone_requires_adjudication',
    };
  });
}

function walkNeighborhood({ nodes, edges, anchorIds, asOf, maxHops }) {
  const hops = Math.max(1, Math.min(MAX_HOPS, Number(maxHops) || MAX_HOPS));
  const byId = new Map(asArray(nodes).map((node) => [normalizedId(node.id), node]).filter(([id]) => id));
  const adjacency = new Map();
  const active = asArray(edges).filter((edge) => edgeIsActive(edge, asOf));
  for (const edge of active) {
    const from = normalizedId(edge.from);
    const to = normalizedId(edge.to);
    if (!from || !to) continue;
    if (!adjacency.has(from)) adjacency.set(from, []);
    if (!adjacency.has(to)) adjacency.set(to, []);
    adjacency.get(from).push({ edge, next: to });
    adjacency.get(to).push({ edge, next: from });
  }

  const visited = new Set(anchorIds.map(normalizedId).filter(Boolean));
  const frontier = [...visited];
  const paths = [];
  const contradictions = [];

  for (let hop = 0; hop < hops; hop += 1) {
    const nextFrontier = [];
    for (const current of frontier) {
      for (const step of adjacency.get(current) || []) {
        const type = String(step.edge.type || 'RELATED_TO').toUpperCase();
        const path = {
          from: current,
          to: step.next,
          type,
          hop: hop + 1,
          validFrom: step.edge.validFrom || null,
          validTo: step.edge.validTo || null,
        };
        paths.push(path);
        if (type === 'CONTRADICTS') {
          contradictions.push({
            from: current,
            to: step.next,
            sourceIds: asArray(step.edge.sourceIds || step.edge.sourceId),
          });
        }
        if (!visited.has(step.next) && byId.has(step.next)) {
          visited.add(step.next);
          nextFrontier.push(step.next);
        }
      }
    }
    frontier.splice(0, frontier.length, ...nextFrontier);
  }

  return {
    nodeIds: [...visited],
    paths,
    contradictions,
  };
}

function fuseKnowledgeGraph(input = {}) {
  if (input.mode && input.mode !== 'fused') {
    return {
      schemaVersion: SCHEMA_VERSION,
      decision: 'deny',
      issues: ['caller_mode_rejected'],
      claimBoundary: 'Retrieval quality is a system property. wiki-first / search-only caller modes are retired.',
    };
  }

  const searchHits = asArray(input.searchHits || input.searchResults);
  const searchIds = searchHits.map((hit) => normalizedId(hit.id)).filter(Boolean);
  const asOf = input.asOf || null;
  const neighborhood = walkNeighborhood({
    nodes: input.nodes,
    edges: input.edges,
    anchorIds: searchIds,
    asOf,
    maxHops: input.maxHops,
  });
  const fusedRanking = reciprocalRankFusion([searchIds, neighborhood.nodeIds]);
  const searchOnlyRanking = reciprocalRankFusion([searchIds]);
  const answerAllowed = neighborhood.contradictions.length === 0;
  const edgesHaveTime = asArray(input.edges).some((edge) => edge.validFrom || edge.validTo);

  return {
    schemaVersion: SCHEMA_VERSION,
    pipeline: 'always_fused',
    decision: 'allow',
    modeRejected: false,
    timeIsFilter: true,
    temporalModel: edgesHaveTime ? 'bitemporal_when_present' : 'unspecified_graphify_ast_has_no_validity_window',
    searchHitCount: searchIds.length,
    fusedIds: fusedRanking.map((row) => row.id),
    fusedRanking,
    searchOnlyIds: searchOnlyRanking.map((row) => row.id),
    paths: neighborhood.paths,
    contradictions: neighborhood.contradictions,
    answerAllowed,
    weAreNot: ['Cosmos DB for Apache Gremlin', 'Azure AI Search', 'Ostermere Mutual'],
    claimBoundary: answerAllowed
      ? 'Fused ranking is retrieval, not a settled world-state. Ablate against search-only before claiming the graph earned its cost.'
      : 'Contradiction gate: both positions are in the bundle; the system declines to settle.',
  };
}

function evaluateFusionAblation(input = {}) {
  const cases = asArray(input.cases);
  const issues = [];
  if (cases.length < MIN_GOLDEN_CASES) issues.push('insufficient_golden_cases');

  let expected = 0;
  let fusedHits = 0;
  let searchHits = 0;
  let retrieved = 0;
  let casesFullRecall = 0;
  let pathTotal = 0;
  let pathCorrect = 0;

  for (const testCase of cases) {
    const fused = fuseKnowledgeGraph({
      searchHits: asArray(testCase.searchHits).map((id) => (typeof id === 'string' ? { id } : id)),
      nodes: testCase.nodes || input.nodes,
      edges: testCase.edges || input.edges,
      asOf: testCase.asOf,
    });
    const wanted = asArray(testCase.expectedNodeIds).map(normalizedId).filter(Boolean);
    const retrievedIds = asArray(fused.fusedIds);
    const expectedPaths = asArray(testCase.expectedPathTypes).map((type) => String(type).toUpperCase());
    const hitCount = wanted.filter((id) => retrievedIds.includes(id)).length;
    expected += wanted.length;
    retrieved += retrievedIds.length;
    fusedHits += hitCount;
    searchHits += wanted.filter((id) => fused.searchOnlyIds.includes(id)).length;
    if (wanted.length > 0 && hitCount === wanted.length) casesFullRecall += 1;
    pathTotal += expectedPaths.length;
    const fusedTypes = new Set(fused.paths.map((row) => row.type));
    pathCorrect += expectedPaths.filter((type) => fusedTypes.has(type)).length;
  }

  const fusedRecall = expected ? fusedHits / expected : 0;
  const searchRecall = expected ? searchHits / expected : 0;
  const precision = retrieved ? fusedHits / retrieved : 0;
  const perCaseRecall = cases.length ? casesFullRecall / cases.length : 0;
  const recallLift = fusedRecall - searchRecall;
  const pathCorrectness = pathTotal ? pathCorrect / pathTotal : 0;

  if (cases.length >= MIN_GOLDEN_CASES) {
    if (fusedRecall < MIN_DETERMINISTIC_RECALL) issues.push('recall_below_0.95');
    if (precision < MIN_PRECISION) issues.push('precision_below_0.15');
    if (perCaseRecall < 1) issues.push('per_case_recall_not_100');
  }

  const graphEarnsCost = issues.length === 0;

  return {
    schemaVersion: `${SCHEMA_VERSION}.ablation`,
    decision: graphEarnsCost ? 'allow' : 'deny',
    issues,
    metrics: {
      caseCount: cases.length,
      fusedRecall: Number(fusedRecall.toFixed(4)),
      searchOnlyRecall: Number(searchRecall.toFixed(4)),
      precision: Number(precision.toFixed(4)),
      perCaseRecall: Number(perCaseRecall.toFixed(4)),
      recallLift: Number(recallLift.toFixed(4)),
      pathCorrectness: Number(pathCorrectness.toFixed(4)),
    },
    claimBoundary: graphEarnsCost
      ? 'Ablation passed fail-closed RAG gates (6 cases, 95% recall, 15% precision, 100% per-case). Still a local fuse CLI, not lesson-retrieval, not Cosmos Gremlin.'
      : 'Graph did not earn its cost under fail-closed RAG gates. Fix extraction/resolution before expanding traversal.',
  };
}

function formatText(fused, ablation) {
  if (fused.decision === 'deny') {
    return `knowledge-graph-fuse  decision=deny  issues=${(fused.issues || []).join(',')}\n${fused.claimBoundary}\n`;
  }
  const lines = [
    `knowledge-graph-fuse  pipeline=${fused.pipeline}  decision=${fused.decision}`,
    `search=${fused.searchHitCount} fused=${fused.fusedIds.length} paths=${fused.paths.length} answerAllowed=${fused.answerAllowed}`,
    `time=${fused.temporalModel}`,
  ];
  if (ablation) {
    lines.push(`ablation ${ablation.decision} lift=${ablation.metrics.recallLift} paths=${ablation.metrics.pathCorrectness}`);
  }
  lines.push(fused.claimBoundary);
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = { json: false, ablate: false, graphPath: null, hitsPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--ablate') options.ablate = true;
    else if (arg === '--graph') options.graphPath = argv[++i];
    else if (arg.startsWith('--graph=')) options.graphPath = arg.slice('--graph='.length);
    else if (arg === '--hits') options.hitsPath = argv[++i];
    else if (arg.startsWith('--hits=')) options.hitsPath = arg.slice('--hits='.length);
  }
  return options;
}

function demoGraph() {
  return {
    nodes: [
      { id: 'claim', name: 'CLM-1042' },
      { id: 'triage', name: 'Level 1 triage', aliases: ['claim-triage-level'] },
      { id: 'policy', name: 'water-damage clause' },
      { id: 'endorsement', name: 'optional paid endorsement' },
    ],
    edges: [
      { from: 'claim', to: 'triage', type: 'APPLIES_TO', validFrom: '2026-02-15' },
      { from: 'triage', to: 'policy', type: 'EXPLAINED_BY', validFrom: '2026-02-15' },
      { from: 'triage', to: 'endorsement', type: 'CONTRADICTS', validFrom: '2026-01-01' },
    ],
    searchHits: [{ id: 'claim', score: 1 }],
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const graph = options.graphPath
    ? JSON.parse(fs.readFileSync(options.graphPath, 'utf8'))
    : demoGraph();
  if (options.hitsPath) {
    graph.searchHits = JSON.parse(fs.readFileSync(options.hitsPath, 'utf8'));
  }
  const fused = fuseKnowledgeGraph(graph);
  const isDemo = !options.graphPath;
  const ablation = options.ablate
    ? evaluateFusionAblation({
      nodes: graph.nodes,
      edges: graph.edges,
      cases: asArray(graph.cases).length
        ? graph.cases
        : (isDemo ? Array.from({ length: 6 }, () => ({
          searchHits: graph.searchHits,
          expectedNodeIds: ['claim', 'triage'],
          expectedPathTypes: ['APPLIES_TO'],
        })) : []),
    })
    : null;
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ fused, ablation }, null, 2)}\n`);
  } else {
    process.stdout.write(formatText(fused, ablation));
  }
  return fused.decision === 'deny' || (ablation && ablation.decision === 'deny') ? 2 : 0;
}

module.exports = {
  MAX_HOPS,
  MIN_DETERMINISTIC_RECALL,
  MIN_GOLDEN_CASES,
  MIN_PRECISION,
  SCHEMA_VERSION,
  edgeIsActive,
  evaluateFusionAblation,
  fuseKnowledgeGraph,
  main,
  reciprocalRankFusion,
  resolveEntities,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
