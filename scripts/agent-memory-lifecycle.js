#!/usr/bin/env node
'use strict';

const MEMORY_TYPES = new Set(['episodic', 'semantic', 'procedural', 'preference', 'working']);
const MEMORY_SCOPES = new Set(['task', 'session', 'user', 'project', 'org']);
const HIGH_RISK_TERMS = new Set([
  'billing',
  'checkout',
  'compliance',
  'credential',
  'data-loss',
  'deploy',
  'deployment',
  'git',
  'payment',
  'production',
  'release',
  'secret',
  'security',
  'stripe',
  'verification',
]);
const KNOWN_ENTITY_PATTERNS = [
  ['Claude Code', /\bclaude\s+code\b/i, 'agent'],
  ['Codex', /\bcodex\b/i, 'agent'],
  ['Cursor', /\bcursor\b/i, 'agent'],
  ['Gemini CLI', /\bgemini\s+cli\b/i, 'agent'],
  ['MCP', /\bmcp\b/i, 'protocol'],
  ['Stripe', /\bstripe\b/i, 'service'],
  ['GitHub', /\bgithub\b|\bgh\s+/i, 'service'],
  ['Railway', /\brailway\b/i, 'service'],
  ['Plausible', /\bplausible\b/i, 'service'],
  ['PostHog', /\bposthog\b/i, 'service'],
  ['SQLite', /\bsqlite\b|\bfts5\b/i, 'storage'],
  ['LanceDB', /\blancedb\b/i, 'storage'],
  ['Docker', /\bdocker\b/i, 'runtime'],
  ['npm', /\bnpm\b|\bnpx\b/i, 'runtime'],
];

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeMemoryType(value) {
  const normalized = normalizeText(value).toLowerCase();
  return MEMORY_TYPES.has(normalized) ? normalized : 'episodic';
}

function tokenize(value) {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9_.:/-]+/)
    .filter(Boolean);
}

function uniqueByName(entities) {
  const seen = new Set();
  return entities.filter((entity) => {
    const key = normalizeText(entity.name).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectMemoryText(memory = {}) {
  return [
    memory.title,
    memory.content,
    memory.context,
    memory.whatWentWrong,
    memory.whatToChange,
    memory.whatWorked,
    memory.domain,
    memory.skill,
    Array.isArray(memory.tags) ? memory.tags.join(' ') : memory.tags,
  ].filter(Boolean).join(' ');
}

function extractMemoryEntities(memory = {}) {
  const text = collectMemoryText(memory);
  const entities = [];

  for (const [name, pattern, type] of KNOWN_ENTITY_PATTERNS) {
    if (pattern.test(text)) entities.push({ name, type });
  }

  const commandMatches = text.match(/`([^`]+)`/g) || [];
  for (const match of commandMatches) {
    const command = match.slice(1, -1).trim();
    if (/^(git|npm|npx|node|gh|curl|docker|python|pytest|stripe)\b/i.test(command)) {
      entities.push({ name: command, type: 'command' });
    } else if (/[./-]/.test(command)) {
      entities.push({ name: command, type: 'path' });
    }
  }

  const pathMatches = text.match(/\b(?:[a-z0-9_-]+\/)+[a-z0-9_.-]+\b/gi) || [];
  for (const filePath of pathMatches.slice(0, 8)) {
    entities.push({ name: filePath, type: 'path' });
  }

  return uniqueByName(entities).slice(0, 16);
}

function inferMemoryScope(memory = {}) {
  const explicit = normalizeText(memory.scope || memory.memoryScope).toLowerCase();
  if (MEMORY_SCOPES.has(explicit)) return explicit;

  const text = collectMemoryText(memory).toLowerCase();
  const tags = new Set(Array.isArray(memory.tags) ? memory.tags.map((tag) => normalizeText(tag).toLowerCase()) : []);

  if (tags.has('preference') || /\b(prefer|style|tone|my preference|user preference)\b/.test(text)) return 'user';
  if (tags.has('org') || tags.has('team') || /\b(enterprise|seat|team|shared|org|compliance|policy|approval)\b/.test(text)) return 'org';
  if (tags.has('repo') || tags.has('project') || tags.has('release') || tags.has('deployment')
    || /\b(repo|repository|branch|ci|pull request|github|deploy|production|release|publish)\b/.test(text)) return 'project';
  if (tags.has('session') || /\b(this session|current session|today|right now)\b/.test(text)) return 'session';
  return 'task';
}

function scoreMemoryDecay(memory = {}, options = {}) {
  const nowMs = options.now ? new Date(options.now).getTime() : Date.now();
  const timestampMs = memory.timestamp ? new Date(memory.timestamp).getTime() : NaN;
  const ageDays = Number.isFinite(timestampMs)
    ? Math.max(0, (nowMs - timestampMs) / (1000 * 60 * 60 * 24))
    : null;
  const textTokens = new Set(tokenize(collectMemoryText(memory)));
  const tags = Array.isArray(memory.tags) ? memory.tags.map((tag) => normalizeText(tag).toLowerCase()) : [];
  const highRisk = tags.some((tag) => HIGH_RISK_TERMS.has(tag))
    || [...textTokens].some((token) => HIGH_RISK_TERMS.has(token))
    || ['critical', 'high'].includes(normalizeText(memory.importance).toLowerCase());

  if (highRisk) {
    return {
      state: 'sticky',
      ageDays,
      score: 1,
      reason: 'high-risk memories stay retrievable until explicitly retired',
    };
  }
  if (ageDays === null) {
    return {
      state: 'review',
      ageDays,
      score: 0.6,
      reason: 'memory has no timestamp, so it needs review before durable promotion',
    };
  }
  if (ageDays > 180) {
    return {
      state: 'archive_candidate',
      ageDays,
      score: 0.2,
      reason: 'old low-risk memory should be consolidated or archived',
    };
  }
  if (ageDays > 60) {
    return {
      state: 'review',
      ageDays,
      score: 0.55,
      reason: 'older low-risk memory should be refreshed before it dominates recall',
    };
  }
  return {
    state: 'active',
    ageDays,
    score: 0.85,
    reason: 'recent memory remains eligible for recall',
  };
}

function scoreHybridMemoryMatch(query, memory = {}, options = {}) {
  const queryTokens = new Set(tokenize(query));
  const memoryTokens = new Set(tokenize(collectMemoryText(memory)));
  const queryText = normalizeText(query).toLowerCase();
  const memoryText = collectMemoryText(memory).toLowerCase();
  const memoryEntities = extractMemoryEntities(memory);
  const queryEntityNames = extractMemoryEntities({ content: query }).map((entity) => entity.name.toLowerCase());

  let lexicalMatches = 0;
  for (const token of queryTokens) {
    if (memoryTokens.has(token)) lexicalMatches++;
  }
  const lexicalScore = queryTokens.size > 0 ? lexicalMatches / queryTokens.size : 0;
  const phraseScore = queryText && memoryText.includes(queryText) ? 0.35 : 0;
  const entityMatches = memoryEntities.filter((entity) => queryEntityNames.includes(entity.name.toLowerCase()));
  const entityScore = queryEntityNames.length > 0 ? entityMatches.length / queryEntityNames.length : 0;
  const decay = scoreMemoryDecay(memory, options);
  const lifecycleScore = decay.state === 'archive_candidate' ? -0.15 : decay.state === 'sticky' ? 0.12 : 0;
  const score = lexicalScore + phraseScore + (entityScore * 0.45) + lifecycleScore;

  return {
    score: Number(Math.max(0, score).toFixed(4)),
    lexicalScore: Number(lexicalScore.toFixed(4)),
    entityScore: Number(entityScore.toFixed(4)),
    matchedEntities: entityMatches,
    decayState: decay.state,
  };
}

function buildMemoryLifecycleView(memory = {}, options = {}) {
  const scope = inferMemoryScope(memory);
  const entities = extractMemoryEntities(memory);
  const decay = scoreMemoryDecay(memory, options);
  const retrieval = scoreHybridMemoryMatch(options.query || '', memory, options);

  return {
    scope,
    entities,
    decay,
    retrievalHints: {
      hybridScore: retrieval.score,
      lexicalScore: retrieval.lexicalScore,
      entityScore: retrieval.entityScore,
      matchedEntities: retrieval.matchedEntities,
    },
  };
}

function buildMemoryLifecyclePolicy(input = {}) {
  return {
    generatedAt: normalizeText(input.generatedAt) || new Date().toISOString(),
    memoryTypes: [
      {
        type: 'working',
        purpose: 'Short-lived task context.',
        retention: 'session',
        promotionGate: 'discard unless referenced by outcome evidence',
      },
      {
        type: 'episodic',
        purpose: 'Specific agent actions, feedback, and outcomes.',
        retention: 'bounded_history',
        promotionGate: 'requires actionable context and source trace',
      },
      {
        type: 'semantic',
        purpose: 'Consolidated facts, standards, and reusable lessons.',
        retention: 'durable',
        promotionGate: 'requires deduplication and contradiction check',
      },
      {
        type: 'procedural',
        purpose: 'Reusable workflows, prompt programs, and gates.',
        retention: 'durable',
        promotionGate: 'requires test or replay evidence',
      },
      {
        type: 'preference',
        purpose: 'Operator style and decision preferences.',
        retention: 'durable_redactable',
        promotionGate: 'requires explicit user signal',
      },
    ],
    retrieval: {
      defaultTopK: 8,
      recencyWeight: 0.25,
      semanticWeight: 0.5,
      outcomeWeight: 0.25,
      requireSourceAnchors: true,
    },
    privacy: {
      piiScanRequired: true,
      secretScanRequired: true,
      exportRequiresRedaction: true,
    },
  };
}

function evaluateMemoryPromotion(memory = {}, policy = buildMemoryLifecyclePolicy()) {
  const type = normalizeMemoryType(memory.type);
  const content = normalizeText(memory.content);
  const source = normalizeText(memory.source);
  const outcome = normalizeText(memory.outcome);
  const issues = [];

  if (!content) issues.push('missing_content');
  if (!source) issues.push('missing_source_anchor');
  if (type !== 'preference' && !outcome) issues.push('missing_outcome');
  if (/api[_-]?key|secret|password|token|bearer\s+[a-z0-9._-]+/i.test(content)) {
    issues.push('secret_like_content');
  }
  if (type === 'preference' && memory.explicitUserSignal !== true) {
    issues.push('preference_without_explicit_signal');
  }

  return {
    type,
    decision: issues.length === 0 ? 'promote' : 'hold',
    issues,
    retrievalEligible: issues.length === 0 || !issues.includes('secret_like_content'),
    policyVersion: policy.generatedAt,
  };
}

const PYRAMID_LAYERS = {
  L0_CONVERSATION: 'L0_CONVERSATION',
  L1_ATOM: 'L1_ATOM',
  L2_SCENARIO: 'L2_SCENARIO',
  L3_PERSONA_SOP: 'L3_PERSONA_SOP',
};

function classifyPyramidLayer(memory = {}) {
  const explicit = normalizeText(memory.pyramidLayer || memory.layer).toUpperCase();
  if (PYRAMID_LAYERS[explicit]) return PYRAMID_LAYERS[explicit];

  const type = normalizeMemoryType(memory.type);
  const text = collectMemoryText(memory).toLowerCase();
  const tags = new Set(Array.isArray(memory.tags) ? memory.tags.map((t) => normalizeText(t).toLowerCase()) : []);

  if (
    type === 'preference' ||
    tags.has('sop') ||
    tags.has('rule') ||
    tags.has('policy') ||
    tags.has('guardrail') ||
    /\b(sop|policy|prevention rule|guardrail|rule|directive|mandate|never allow|always require)\b/.test(text)
  ) {
    return PYRAMID_LAYERS.L3_PERSONA_SOP;
  }

  if (
    type === 'procedural' ||
    tags.has('workflow') ||
    tags.has('scenario') ||
    tags.has('pattern') ||
    /\b(workflow|scenario|pipeline|multi-step|sequence|playbook|recipe|lifecycle)\b/.test(text)
  ) {
    return PYRAMID_LAYERS.L2_SCENARIO;
  }

  if (
    type === 'semantic' ||
    tags.has('fact') ||
    tags.has('lesson') ||
    tags.has('atom') ||
    memory.whatWentWrong ||
    memory.whatWorked ||
    /\b(fact|lesson|observation|result|fix|patch|metric|verified)\b/.test(text)
  ) {
    return PYRAMID_LAYERS.L1_ATOM;
  }

  return PYRAMID_LAYERS.L0_CONVERSATION;
}

function distillMemoryPyramid(memories = [], options = {}) {
  const safeMemories = Array.isArray(memories) ? memories : [];
  const layers = {
    [PYRAMID_LAYERS.L3_PERSONA_SOP]: [],
    [PYRAMID_LAYERS.L2_SCENARIO]: [],
    [PYRAMID_LAYERS.L1_ATOM]: [],
    [PYRAMID_LAYERS.L0_CONVERSATION]: [],
  };

  for (const item of safeMemories) {
    const layer = classifyPyramidLayer(item);
    layers[layer].push({
      ...item,
      pyramidLayer: layer,
    });
  }

  const totalCount = safeMemories.length;
  const charsPerToken = Math.max(1, Number(options.charsPerToken) || 4);

  const layerStats = {};
  for (const [layerKey, items] of Object.entries(layers)) {
    const rawContent = items.map((m) => collectMemoryText(m)).join('\n');
    const estimatedTokens = Math.ceil(rawContent.length / charsPerToken);
    layerStats[layerKey] = {
      count: items.length,
      estimatedTokens,
      sharePercent: totalCount > 0 ? Number(((items.length / totalCount) * 100).toFixed(1)) : 0,
    };
  }

  return {
    kind: 'semantic-memory-pyramid',
    totalMemories: totalCount,
    layers: layerStats,
    pyramidItems: layers,
  };
}

module.exports = {
  PYRAMID_LAYERS,
  buildMemoryLifecyclePolicy,
  buildMemoryLifecycleView,
  classifyPyramidLayer,
  distillMemoryPyramid,
  evaluateMemoryPromotion,
  extractMemoryEntities,
  inferMemoryScope,
  normalizeMemoryType,
  scoreHybridMemoryMatch,
  scoreMemoryDecay,
};

