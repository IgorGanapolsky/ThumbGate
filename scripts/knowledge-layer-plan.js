'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedId(value) {
  return String(value || '').trim();
}

function edgeIsActive(edge = {}, asOf = new Date().toISOString()) {
  const instant = new Date(asOf).getTime();
  if (!Number.isFinite(instant)) return false;
  const validFrom = edge.validFrom ? new Date(edge.validFrom).getTime() : -Infinity;
  const validTo = edge.validTo ? new Date(edge.validTo).getTime() : Infinity;
  return instant >= validFrom && instant < validTo;
}

function edgeSources(edge = {}) {
  return [...new Set([
    ...asArray(edge.sourceIds),
    edge.sourceId,
  ].map(normalizedId).filter(Boolean))];
}

/**
 * Expand every ranked search hit through a bounded, bitemporal graph. The
 * caller cannot choose a search-only mode: when no active edges are present,
 * the traversal simply contributes no paths and the ranked hits pass through.
 */
function traverseKnowledgeGraph(input = {}) {
  const nodes = asArray(input.nodes);
  const edges = asArray(input.edges);
  const searchResults = asArray(input.searchResults);
  const asOf = input.asOf || new Date().toISOString();
  const maxHops = Math.max(1, Math.min(2, Number(input.maxHops) || 2));
  const limit = Math.max(1, Number(input.limit) || 20);
  const allowedTypes = new Set(asArray(input.allowedEdgeTypes).map((type) => String(type).toUpperCase()));
  const byId = new Map(nodes.map((node) => [normalizedId(node.id), node]).filter(([id]) => id));
  const activeEdges = edges.filter((edge) => (
    edgeIsActive(edge, asOf)
    && (!allowedTypes.size || allowedTypes.has(String(edge.type || '').toUpperCase()))
  ));
  const adjacency = new Map();

  for (const edge of activeEdges) {
    const from = normalizedId(edge.from);
    const to = normalizedId(edge.to);
    if (!from || !to || !byId.has(from) || !byId.has(to)) continue;
    if (!adjacency.has(from)) adjacency.set(from, []);
    if (!adjacency.has(to)) adjacency.set(to, []);
    adjacency.get(from).push({ edge, next: to, direction: 'out' });
    adjacency.get(to).push({ edge, next: from, direction: 'in' });
  }

  const scoreById = new Map();
  const anchorIds = [];
  searchResults.forEach((result, index) => {
    const id = normalizedId(result.id);
    if (!id || !byId.has(id)) return;
    const score = Number.isFinite(Number(result.score)) ? Number(result.score) : 1 / (index + 1);
    scoreById.set(id, Math.max(scoreById.get(id) || 0, score));
    anchorIds.push(id);
  });

  const paths = [];
  const pathKeys = new Set();
  const unresolvedContradictions = [];
  const contradictionKeys = new Set();

  for (const anchorId of anchorIds) {
    const queue = [{ id: anchorId, hop: 0, score: scoreById.get(anchorId) || 1 }];
    const visitedAtHop = new Map([[anchorId, 0]]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.hop >= maxHops) continue;
      for (const relation of adjacency.get(current.id) || []) {
        const hop = current.hop + 1;
        const type = String(relation.edge.type || 'RELATED_TO').toUpperCase();
        const pathKey = `${anchorId}:${current.id}:${relation.next}:${type}:${hop}`;
        if (!pathKeys.has(pathKey)) {
          pathKeys.add(pathKey);
          const path = {
            anchorId,
            from: normalizedId(relation.edge.from),
            to: normalizedId(relation.edge.to),
            type,
            direction: relation.direction,
            hop,
            validFrom: relation.edge.validFrom || null,
            validTo: relation.edge.validTo || null,
            recordedAt: relation.edge.recordedAt || null,
            sourceIds: edgeSources(relation.edge),
          };
          paths.push(path);
          if (type === 'CONTRADICTS' && relation.edge.resolved !== true) {
            const contradictionKey = `${path.from}:${path.to}:${type}`;
            if (!contradictionKeys.has(contradictionKey)) {
              contradictionKeys.add(contradictionKey);
              unresolvedContradictions.push(path);
            }
          }
        }

        const expandedScore = current.score * (0.8 ** hop);
        scoreById.set(relation.next, Math.max(scoreById.get(relation.next) || 0, expandedScore));
        if (!visitedAtHop.has(relation.next) || hop < visitedAtHop.get(relation.next)) {
          visitedAtHop.set(relation.next, hop);
          queue.push({ id: relation.next, hop, score: current.score });
        }
      }
    }
  }

  const rankedNodes = [...scoreById.entries()]
    .map(([id, score]) => ({ ...byId.get(id), id, score: Number(score.toFixed(6)) }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);
  const provenanceComplete = paths.every((path) => path.sourceIds.length > 0);

  return {
    schemaVersion: 'thumbgate.knowledge-graph-fusion.v1',
    strategy: 'always_fused_search_and_bitemporal_traversal',
    asOf,
    maxHops,
    anchorIds,
    rankedNodes,
    paths,
    unresolvedContradictions,
    provenanceComplete,
    decision: unresolvedContradictions.length > 0 ? 'deny' : 'allow',
    answerAllowed: unresolvedContradictions.length === 0,
  };
}

function recall(expectedIds = [], actualIds = []) {
  const expected = new Set(asArray(expectedIds).map(normalizedId).filter(Boolean));
  if (expected.size === 0) return 1;
  const actual = new Set(asArray(actualIds).map(normalizedId).filter(Boolean));
  return [...expected].filter((id) => actual.has(id)).length / expected.size;
}

/** Fused-versus-search-only acceptance test. A graph must measurably improve
 * evidence recall or relational-path correctness to earn its operating cost. */
function evaluateGraphAblation(input = {}) {
  const cases = asArray(input.cases);
  const rows = cases.map((testCase) => {
    const expectedPathTypes = asArray(testCase.expectedPathTypes).map((type) => String(type).toUpperCase());
    const fusedPathTypes = new Set(asArray(testCase.fusedPaths).map((path) => (
      String(typeof path === 'string' ? path : path.type || '').toUpperCase()
    )));
    const correctPaths = expectedPathTypes.filter((type) => fusedPathTypes.has(type)).length;
    return {
      id: normalizedId(testCase.id) || `case_${cases.indexOf(testCase) + 1}`,
      searchRecall: recall(testCase.expectedNodeIds, testCase.searchOnlyIds),
      fusedRecall: recall(testCase.expectedNodeIds, testCase.fusedNodeIds),
      expectedPathCount: expectedPathTypes.length,
      correctPathCount: correctPaths,
      pathCorrectness: expectedPathTypes.length ? correctPaths / expectedPathTypes.length : 1,
    };
  });
  const mean = (field) => rows.length
    ? rows.reduce((sum, row) => sum + row[field], 0) / rows.length
    : 0;
  const searchRecall = mean('searchRecall');
  const fusedRecall = mean('fusedRecall');
  const relationalRows = rows.filter((row) => row.expectedPathCount > 0);
  const pathCorrectness = relationalRows.length
    ? relationalRows.reduce((sum, row) => sum + row.pathCorrectness, 0) / relationalRows.length
    : 0;
  const graphEarnsCost = rows.length > 0
    && fusedRecall >= searchRecall
    && (fusedRecall > searchRecall || pathCorrectness > 0);

  return {
    decision: graphEarnsCost ? 'allow' : 'deny',
    graphEarnsCost,
    cases: rows,
    metrics: {
      searchRecall: Number(searchRecall.toFixed(4)),
      fusedRecall: Number(fusedRecall.toFixed(4)),
      recallLift: Number((fusedRecall - searchRecall).toFixed(4)),
      pathCorrectness: Number(pathCorrectness.toFixed(4)),
    },
    issues: graphEarnsCost ? [] : ['graph_not_earning_cost'],
  };
}

function resolveGraphEntity(candidate = {}, canonicals = [], options = {}) {
  const aliases = new Set([
    normalizedId(candidate.id).toLowerCase(),
    normalizedId(candidate.name).toLowerCase(),
    ...asArray(candidate.aliases).map((alias) => normalizedId(alias).toLowerCase()),
  ].filter(Boolean));
  const exact = canonicals.find((item) => [
    normalizedId(item.id),
    normalizedId(item.name),
    ...asArray(item.aliases).map(normalizedId),
  ].some((value) => aliases.has(value.toLowerCase())));
  if (exact) return { decision: 'merge', canonicalId: exact.id, reason: 'exact_alias' };

  const similarity = typeof options.similarity === 'function'
    ? options.similarity
    : () => 0;
  const scored = canonicals
    .map((item) => ({ item, score: Number(similarity(candidate, item)) || 0 }))
    .sort((left, right) => right.score - left.score);
  const best = scored[0] || { item: null, score: 0 };
  const highThreshold = Number(options.highThreshold || 0.92);
  const lowThreshold = Number(options.lowThreshold || 0.75);
  if (best.item && best.score >= highThreshold) {
    return { decision: 'merge', canonicalId: best.item.id, score: best.score, reason: 'high_similarity' };
  }
  if (!best.item || best.score < lowThreshold) {
    return { decision: 'create', canonicalId: null, score: best.score, reason: 'below_similarity_floor' };
  }
  if (typeof options.adjudicate === 'function') {
    const canonicalId = normalizedId(options.adjudicate(candidate, best.item, best.score));
    if (canonicalId) {
      return { decision: 'merge', canonicalId, score: best.score, reason: 'gray_zone_adjudicated' };
    }
  }
  return {
    decision: 'review',
    canonicalId: best.item.id,
    score: best.score,
    reason: 'gray_zone_requires_adjudication',
  };
}

function predictionPairs(predictions = [], observations = [], personaIds = null) {
  const allowed = personaIds ? new Set(personaIds) : null;
  const predictionMap = new Map(predictions.map((row) => [`${row.personaId}:${row.variantId}`, Number(row.score)]));
  const observationMap = new Map(observations.map((row) => [`${row.personaId}:${row.variantId}`, Number(row.outcome)]));
  const personas = [...new Set(predictions.map((row) => row.personaId))]
    .filter((id) => !allowed || allowed.has(id));
  let total = 0;
  let correct = 0;
  for (const personaId of personas) {
    const variants = predictions.filter((row) => row.personaId === personaId).map((row) => row.variantId);
    for (let left = 0; left < variants.length; left += 1) {
      for (let right = left + 1; right < variants.length; right += 1) {
        const leftKey = `${personaId}:${variants[left]}`;
        const rightKey = `${personaId}:${variants[right]}`;
        if (!predictionMap.has(leftKey) || !predictionMap.has(rightKey)) continue;
        if (!observationMap.has(leftKey) || !observationMap.has(rightKey)) continue;
        const predictedDirection = Math.sign(predictionMap.get(leftKey) - predictionMap.get(rightKey));
        const observedDirection = Math.sign(observationMap.get(leftKey) - observationMap.get(rightKey));
        if (predictedDirection === 0 || observedDirection === 0) continue;
        total += 1;
        if (predictedDirection === observedDirection) correct += 1;
      }
    }
  }
  return { total, correct, accuracy: total ? correct / total : null };
}

/** Validate a narrow behavioral simulation against observed holdout outcomes.
 * Predicted winners remain hypotheses until the live promotion gate passes. */
function evaluateBehavioralSimulation(input = {}, options = {}) {
  const personas = asArray(input.personas);
  const variants = asArray(input.variants);
  const predictions = asArray(input.predictions);
  const observations = asArray(input.observations);
  const mode = ['simulation', 'sidecar', 'live'].includes(input.mode) ? input.mode : 'simulation';
  const issues = [];
  const decision = input.decision || {};
  const minimumPersonas = Math.max(1, Number(options.minimumPersonas || 5));
  if (!decision.intervention) issues.push('missing_intervention');
  if (!decision.population) issues.push('missing_population');
  if (!decision.outcomeMetric) issues.push('missing_outcome_metric');
  if (personas.length < minimumPersonas) issues.push('insufficient_personas');
  if (variants.length < 2) issues.push('insufficient_variants');

  const evidenceGaps = personas.filter((persona) => !asArray(persona.evidence).some((evidence) => (
    evidence.kind === 'observed'
    && normalizedId(evidence.sourceId)
    && normalizedId(evidence.observedAt || evidence.timestamp)
  ))).map((persona) => persona.id);
  if (evidenceGaps.length > 0) issues.push('personas_missing_observed_evidence');

  const personaIds = new Set(personas.map((persona) => persona.id));
  const variantIds = new Set(variants.map((variant) => variant.id));
  const expectedPredictionCount = personaIds.size * variantIds.size;
  const validPredictions = predictions.filter((row) => (
    personaIds.has(row.personaId)
    && variantIds.has(row.variantId)
    && Number.isFinite(Number(row.score))
  ));
  const predictionKeys = new Set(validPredictions.map((row) => `${row.personaId}:${row.variantId}`));
  if (
    validPredictions.length !== expectedPredictionCount
    || predictionKeys.size !== expectedPredictionCount
  ) {
    issues.push('incomplete_prediction_matrix');
  }

  const overall = predictionPairs(validPredictions, observations);
  const holdoutPersonaIds = asArray(input.holdoutPersonaIds).filter((id) => personaIds.has(id));
  const holdout = predictionPairs(validPredictions, observations, holdoutPersonaIds);
  const minimumHoldoutPairs = Math.max(1, Number(options.minimumHoldoutPairs || 5));
  const minimumAccuracy = Number(options.minimumAccuracy || 0.7);
  const validated = holdout.total >= minimumHoldoutPairs
    && holdout.accuracy !== null
    && holdout.accuracy >= minimumAccuracy;
  const livePromotionAllowed = issues.length === 0 && mode === 'live' && validated;

  return {
    schemaVersion: 'thumbgate.behavioral-simulation.v1',
    mode,
    runDecision: issues.length > 0 ? 'deny' : 'allow',
    deploymentDecision: livePromotionAllowed ? 'allow' : 'deny',
    livePromotionAllowed,
    issues,
    evidenceGaps,
    evaluation: {
      predictionCount: validPredictions.length,
      observationCount: observations.length,
      overallPairwiseAccuracy: overall.accuracy === null ? null : Number(overall.accuracy.toFixed(4)),
      holdoutPairs: holdout.total,
      holdoutPairwiseAccuracy: holdout.accuracy === null ? null : Number(holdout.accuracy.toFixed(4)),
      minimumHoldoutPairs,
      minimumAccuracy,
    },
    claimBoundary: livePromotionAllowed
      ? 'The simulated ranking matched the configured holdout threshold; deployment still requires monitored rollout evidence.'
      : 'Simulation output is a hypothesis, not observed conversion lift or a production winner.',
  };
}

function buildKnowledgeLayerPlan(options = {}) {
  const domain = options.domain || 'agent_reliability';
  const graph = options.graph || 'neo4j';

  return {
    domain,
    graph,
    memoryTiers: [
      {
        id: 'short_term',
        purpose: 'Current session context so the agent does not re-ask answered questions.',
        ttl: 'session',
      },
      {
        id: 'long_term',
        purpose: 'Durable user, product, workflow, and feedback profile facts.',
        ttl: 'durable',
      },
      {
        id: 'reasoning_memory',
        purpose: 'Reusable decision paths that avoid recomputing expensive traversals.',
        ttl: 'versioned',
      },
    ],
    nodeTypes: [
      'User',
      'Agent',
      'Workflow',
      'Feedback',
      'Gate',
      'Decision',
      'Evidence',
      'Recommendation',
      'Outcome',
    ],
    relationshipTypes: [
      'GAVE_FEEDBACK',
      'TRIGGERED_GATE',
      'USED_EVIDENCE',
      'RECOMMENDED_ACTION',
      'PRODUCED_OUTCOME',
      'SIMILAR_TO',
      'REUSES_REASONING',
    ],
    highRoiUseCases: [
      'conversion recommendations with explainable evidence paths',
      'compute savings from reasoning-memory cache hits',
      'compliance audit trail for why an agent recommended or blocked an action',
      'closed-loop profile updates from every feedback, purchase, or outcome event',
    ],
    gates: [
      'do not recommend without an evidence path',
      'do not reuse reasoning memory when source facts changed',
      'write audit node for every recommendation and blocked action',
      'record outcome feedback to update profile and graph edges',
    ],
  };
}

function buildRecommendationEvidencePath(input = {}) {
  const userId = input.userId || 'unknown_user';
  const recommendationId = input.recommendationId || 'rec_pending';
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const similarProfiles = Array.isArray(input.similarProfiles) ? input.similarProfiles : [];

  return {
    recommendationId,
    path: [
      { type: 'User', id: userId },
      ...similarProfiles.map((id) => ({ type: 'SimilarProfile', id })),
      ...evidence.map((item, index) => ({
        type: item.type || 'Evidence',
        id: item.id || `evidence_${index + 1}`,
        quote: item.quote || null,
      })),
      { type: 'Recommendation', id: recommendationId },
    ],
    explainable: evidence.length > 0,
  };
}

function evaluateKnowledgeLayerRun(run = {}) {
  const issues = [];
  if (!run.userId) issues.push('missing_user_id');
  if (!run.recommendationId) issues.push('missing_recommendation_id');
  if (!run.evidencePath?.explainable) issues.push('missing_explainable_evidence_path');
  if (!run.auditNodeId) issues.push('missing_audit_node_id');
  if (run.reusedReasoning && !run.reasoningVersion) issues.push('missing_reasoning_version');
  if (run.profileUpdate && !run.outcomeEventId) issues.push('missing_outcome_event_id');

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
    roiSignals: [
      run.reusedReasoning ? 'lower_graph_query_and_token_cost' : null,
      run.profileUpdate ? 'closed_loop_personalization' : null,
      run.auditNodeId ? 'compliance_trace_available' : null,
    ].filter(Boolean),
  };
}

module.exports = {
  buildKnowledgeLayerPlan,
  buildRecommendationEvidencePath,
  edgeIsActive,
  evaluateBehavioralSimulation,
  evaluateGraphAblation,
  evaluateKnowledgeLayerRun,
  resolveGraphEntity,
  traverseKnowledgeGraph,
};
