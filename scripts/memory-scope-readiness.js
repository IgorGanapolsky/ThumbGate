#!/usr/bin/env node
'use strict';

const REQUIRED_SCOPE_FIELDS = ['entityId', 'projectId', 'processId', 'sessionId'];
const MEMORY_OS_LAYERS = Object.freeze([
  {
    id: 'file_layer',
    name: 'File Layer',
    purpose: 'Raw feedback, tool receipts, sessions, and memory rows are durably stored before interpretation.',
  },
  {
    id: 'vector_db_layer',
    name: 'Vector DB Layer',
    purpose: 'Semantic retrieval can find related lessons without stuffing every raw memory into context.',
  },
  {
    id: 'structured_facts_layer',
    name: 'Structured Facts Layer',
    purpose: 'Confirmed account, project, policy, and budget facts are typed separately from fuzzy memories.',
  },
  {
    id: 'auto_curation_layer',
    name: 'Auto Curation Layer',
    purpose: 'Duplicate, stale, contradictory, and unscoped memories are consolidated before retrieval quality decays.',
  },
  {
    id: 'context_layer',
    name: 'Context Layer',
    purpose: 'Only relevant scoped memories enter a given tool call, PR, deployment, or support session.',
  },
  {
    id: 'interface_layer',
    name: 'Interface Layer',
    purpose: 'The memory contract is exposed through CLI, MCP, hooks, dashboards, and agent adapters without model lock-in.',
  },
]);

const FIELD_ALIASES = {
  entityId: [
    'entityId',
    'userId',
    'user_id',
    'accountId',
    'tenantId',
    'actorId',
    'scope.entityId',
    'scope.userId',
    'scope.user_id',
    'metadata.entityId',
    'metadata.userId',
    'metadata.user_id',
    'metadata.tenantId',
    'richContext.entityId',
    'richContext.userId',
    'context.entityId',
    'context.userId',
  ],
  projectId: [
    'projectId',
    'project_id',
    'project',
    'repoId',
    'workspaceId',
    'scope.projectId',
    'scope.project_id',
    'scope.project',
    'metadata.projectId',
    'metadata.project_id',
    'metadata.project',
    'metadata.repoId',
    'metadata.workspaceId',
    'richContext.projectId',
    'richContext.project',
    'context.projectId',
    'context.project',
  ],
  processId: [
    'processId',
    'process_id',
    'agentId',
    'agent_id',
    'role',
    'scope.processId',
    'scope.process_id',
    'scope.agentId',
    'scope.agent_id',
    'metadata.processId',
    'metadata.process_id',
    'metadata.agentId',
    'metadata.agent_id',
    'metadata.role',
    'richContext.processId',
    'richContext.agentId',
    'context.processId',
    'context.agentId',
  ],
  sessionId: [
    'sessionId',
    'session_id',
    'conversationId',
    'threadId',
    'runId',
    'scope.sessionId',
    'scope.session_id',
    'metadata.sessionId',
    'metadata.session_id',
    'metadata.conversationId',
    'metadata.threadId',
    'metadata.runId',
    'richContext.sessionId',
    'richContext.conversationId',
    'context.sessionId',
    'context.conversationId',
  ],
};

function readPath(value, dottedPath) {
  const segments = dottedPath.split('.');
  let current = value;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeScope(input = {}) {
  // Supermemory-style containerTag is an opaque namespace. If present and
  // parseable as our four-field encoding, prefer it; otherwise fall through
  // to field aliases. (Steal: https://supermemory.ai/docs/concepts/container-tags)
  const fromTag = decodeContainerTag(
    input.containerTag || input.container_tag || input.metadata?.containerTag
  );
  if (fromTag && missingScopeFields(fromTag).length === 0) {
    return fromTag;
  }

  const scope = {};
  for (const field of REQUIRED_SCOPE_FIELDS) {
    let resolved = null;
    for (const alias of FIELD_ALIASES[field]) {
      resolved = normalizeId(readPath(input, alias));
      if (resolved) break;
    }
    scope[field] = resolved;
  }
  return scope;
}

function missingScopeFields(scope) {
  const normalized = normalizeScope(scope);
  return REQUIRED_SCOPE_FIELDS.filter((field) => !normalized[field]);
}

function memoryScopeKey(scope) {
  const normalized = normalizeScope(scope);
  if (missingScopeFields(normalized).length > 0) return null;
  return REQUIRED_SCOPE_FIELDS.map((field) => `${field}:${normalized[field]}`).join('|');
}

function isSharedMemory(record = {}) {
  const visibility = normalizeId(
    record.visibility
    || record.scope?.visibility
    || record.metadata?.visibility
    || record.metadata?.scope
  );
  return record.shared === true
    || record.scope?.shared === true
    || record.metadata?.shared === true
    || ['shared', 'global', 'public', 'team'].includes(String(visibility || '').toLowerCase());
}

function recordFingerprint(record = {}) {
  const text = [
    record.title,
    record.content,
    record.context,
    record.whatWentWrong,
    record.whatToChange,
    record.whatWorked,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function buildMemoryScopeReadinessReport(records = []) {
  const byScope = new Map();
  const byFingerprint = new Map();
  const missingFieldsByRecord = [];
  let sharedRecords = 0;
  let readyRecords = 0;

  records.forEach((record, index) => {
    const scope = normalizeScope(record);
    const missingFields = missingScopeFields(scope);
    const shared = isSharedMemory(record);
    const scopeKey = memoryScopeKey(scope);
    const id = record.id || `record-${index}`;

    if (shared) sharedRecords += 1;
    if (missingFields.length === 0) readyRecords += 1;
    else missingFieldsByRecord.push({ id, index, missingFields });

    if (scopeKey) {
      if (!byScope.has(scopeKey)) byScope.set(scopeKey, []);
      byScope.get(scopeKey).push(id);
    }

    const fingerprint = recordFingerprint(record);
    if (fingerprint && scopeKey && !shared) {
      if (!byFingerprint.has(fingerprint)) byFingerprint.set(fingerprint, new Set());
      byFingerprint.get(fingerprint).add(scopeKey);
    }
  });

  const duplicateScopeKeys = [...byScope.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([scopeKey, ids]) => ({ scopeKey, ids }));

  const crossScopeDuplicates = [...byFingerprint.entries()]
    .filter(([, scopeKeys]) => scopeKeys.size > 1)
    .map(([fingerprint, scopeKeys]) => ({
      fingerprint,
      scopeKeys: [...scopeKeys].sort((a, b) => a.localeCompare(b)),
    }));

  const unscopedRecords = missingFieldsByRecord.length;
  const riskLevel = unscopedRecords > 0 || crossScopeDuplicates.length > 0 ? 'high' : 'low';

  return {
    totalRecords: records.length,
    readyRecords,
    unscopedRecords,
    sharedRecords,
    isolatedScopeCount: byScope.size,
    duplicateScopeKeys,
    crossScopeDuplicates,
    missingFieldsByRecord,
    requiredFields: [...REQUIRED_SCOPE_FIELDS],
    riskLevel,
    ready: riskLevel === 'low',
    recommendations: buildRecommendations({ unscopedRecords, crossScopeDuplicates }),
  };
}

function buildRecommendations({ unscopedRecords, crossScopeDuplicates }) {
  const recommendations = [];
  if (unscopedRecords > 0) {
    recommendations.push('Attach entityId, projectId, processId, and sessionId before writing memories.');
  }
  if (crossScopeDuplicates.length > 0) {
    recommendations.push('Mark intentional shared memories explicitly; otherwise dedupe within the same scope only.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Scope posture is ready for multi-user and multi-session memory retrieval.');
  }
  return recommendations;
}

function hasEmbeddingEvidence(record = {}) {
  return Boolean(
    record.embedding
    || record.vector
    || record.embeddingId
    || record.metadata?.embedding
    || record.metadata?.embeddingId
    || record.metadata?.vectorId
    || record.semanticKey
    || record.metadata?.semanticKey
  );
}

function hasStructuredFactEvidence(record = {}) {
  const type = String(record.type || record.kind || record.memoryType || record.metadata?.type || '').toLowerCase();
  return type === 'fact'
    || type === 'structured_fact'
    || Boolean(record.factKey || record.fact || record.metadata?.factKey || record.metadata?.fact);
}

function hasContextEvidence(record = {}) {
  return Boolean(
    record.contextPackId
    || record.contextPack
    || record.metadata?.contextPackId
    || record.metadata?.contextPack
    || record.retrievalQuery
    || record.metadata?.retrievalQuery
  );
}

function boolCapability(capabilities = {}, ...keys) {
  return keys.some((key) => capabilities[key] === true);
}

function buildMemoryOsLayerReport(records = [], capabilities = {}) {
  const scopeReport = buildMemoryScopeReadinessReport(records);
  const semanticRecords = records.filter(hasEmbeddingEvidence);
  const structuredFactRecords = records.filter(hasStructuredFactEvidence);
  const contextRecords = records.filter(hasContextEvidence);
  const curationReady = scopeReport.unscopedRecords === 0 && scopeReport.crossScopeDuplicates.length === 0;

  const checks = [
    {
      id: 'file_layer',
      ok: records.length > 0 || boolCapability(capabilities, 'rawStorage', 'fileLayer'),
      evidence: {
        records: records.length,
        durableStore: Boolean(records.length > 0 || capabilities.rawStorage || capabilities.fileLayer),
      },
      recommendation: 'Capture raw feedback, action receipts, and tool outcomes before promoting memories.',
    },
    {
      id: 'vector_db_layer',
      ok: semanticRecords.length > 0 || boolCapability(capabilities, 'semanticSearch', 'vectorDbLayer'),
      evidence: {
        semanticRecords: semanticRecords.length,
        semanticSearch: Boolean(capabilities.semanticSearch || capabilities.vectorDbLayer),
      },
      recommendation: 'Index lessons with semantic keys or embeddings so related failures are retrieved before action.',
    },
    {
      id: 'structured_facts_layer',
      ok: structuredFactRecords.length > 0 || boolCapability(capabilities, 'structuredFacts', 'structuredFactsLayer'),
      evidence: {
        structuredFactRecords: structuredFactRecords.length,
        structuredFacts: Boolean(capabilities.structuredFacts || capabilities.structuredFactsLayer),
      },
      recommendation: 'Store confirmed customer, project, policy, and budget facts as typed records, not just prose.',
    },
    {
      id: 'auto_curation_layer',
      ok: curationReady && boolCapability(capabilities, 'autoCuration', 'dedupe', 'autoCurationLayer'),
      evidence: {
        unscopedRecords: scopeReport.unscopedRecords,
        crossScopeDuplicates: scopeReport.crossScopeDuplicates.length,
        autoCuration: Boolean(capabilities.autoCuration || capabilities.dedupe || capabilities.autoCurationLayer),
      },
      recommendation: 'Run dedupe, contradiction, stale-memory, and scope-isolation checks before memories can become gates.',
    },
    {
      id: 'context_layer',
      ok: contextRecords.length > 0 || boolCapability(capabilities, 'contextPacks', 'contextLayer', 'scopedRetrieval'),
      evidence: {
        contextRecords: contextRecords.length,
        scopedRetrieval: Boolean(capabilities.contextPacks || capabilities.contextLayer || capabilities.scopedRetrieval),
      },
      recommendation: 'Inject scoped context packs per task instead of loading every memory into the model window.',
    },
    {
      id: 'interface_layer',
      ok: boolCapability(capabilities, 'mcp', 'cli', 'hooks', 'dashboard', 'interfaceLayer'),
      evidence: {
        cli: Boolean(capabilities.cli),
        mcp: Boolean(capabilities.mcp),
        hooks: Boolean(capabilities.hooks),
        dashboard: Boolean(capabilities.dashboard),
      },
      recommendation: 'Expose the same memory contract through CLI, MCP, hooks, dashboard, and agent adapters.',
    },
  ].map((check) => {
    const layer = MEMORY_OS_LAYERS.find((candidate) => candidate.id === check.id);
    return {
      ...layer,
      ...check,
    };
  });

  const missingLayers = checks.filter((check) => !check.ok).map((check) => check.id);

  return {
    ready: missingLayers.length === 0,
    riskLevel: missingLayers.length === 0 ? 'low' : missingLayers.length <= 2 ? 'medium' : 'high',
    layers: checks,
    missingLayers,
    scopeReport,
    recommendations: checks
      .filter((check) => !check.ok)
      .map((check) => check.recommendation),
  };
}

function selectRecordsForScope(records = [], requestedScope = {}, options = {}) {
  const requested = normalizeScope(requestedScope);
  const requestedKey = memoryScopeKey(requested);
  if (!requestedKey) {
    throw new Error(`requested scope missing fields: ${missingScopeFields(requested).join(', ')}`);
  }

  const includeShared = options.includeShared !== false;
  const allowed = [];
  const blocked = [];

  for (const record of records) {
    const shared = isSharedMemory(record);
    const recordKey = memoryScopeKey(record);
    if (recordKey === requestedKey || (includeShared && shared)) {
      allowed.push(record);
    } else {
      blocked.push(record);
    }
  }

  return {
    requestedScope: requested,
    requestedKey,
    allowed,
    blocked,
  };
}

function buildMemoriStyleBenchmarkRecords() {
  return [
    {
      id: 'alice-agent-a-session-1',
      entityId: 'alice',
      projectId: 'thumbgate',
      processId: 'agent-a',
      sessionId: 'session-1',
      metadata: { semanticKey: 'checkout-readiness', contextPackId: 'checkout-pro' },
      content: 'Use the paid sprint checklist before changing checkout code.',
    },
    {
      id: 'bob-agent-a-session-1',
      entityId: 'bob',
      projectId: 'thumbgate',
      processId: 'agent-a',
      sessionId: 'session-1',
      content: 'Bob private onboarding note.',
    },
    {
      id: 'alice-agent-b-session-1',
      entityId: 'alice',
      projectId: 'thumbgate',
      processId: 'agent-b',
      sessionId: 'session-1',
      content: 'Agent B should use docs-only mode.',
    },
    {
      id: 'alice-agent-a-session-2',
      entityId: 'alice',
      projectId: 'thumbgate',
      processId: 'agent-a',
      sessionId: 'session-2',
      content: 'Session 2 has a different migration plan.',
    },
    {
      id: 'team-shared-checkout-rule',
      entityId: 'alice',
      projectId: 'thumbgate',
      processId: 'agent-a',
      sessionId: 'session-1',
      visibility: 'shared',
      type: 'fact',
      factKey: 'checkout.mutation_policy',
      content: 'Shared rule: checkout mutations require audit evidence.',
    },
  ];
}


// ---------------------------------------------------------------------------
// Supermemory process steal (NOT a product clone)
// Docs: Memory vs RAG, container tags, profiles, dreaming modes.
// ---------------------------------------------------------------------------

const CONTAINER_TAG_PATTERN = /^[a-zA-Z0-9_:-]+$/;
const DREAMING_MODES = Object.freeze(['dynamic', 'instant']);

/**
 * Encode four-field ThumbGate scope as a Supermemory-valid containerTag.
 * Format: entity:<id>:project:<id>:process:<id>:session:<id>
 */
function encodeContainerTag(scopeInput = {}) {
  const scope = normalizeScope(scopeInput);
  const missing = missingScopeFields(scope);
  if (missing.length > 0) {
    return {
      ok: false,
      containerTag: null,
      missingFields: missing,
      reason: `incomplete scope: ${missing.join(', ')}`,
    };
  }
  const values = [scope.entityId, scope.projectId, scope.processId, scope.sessionId];
  if (values.some((value) => String(value).includes(':'))) {
    return {
      ok: false,
      containerTag: null,
      missingFields: [],
      reason: 'scope field values must not contain ":" (reserved for containerTag encoding)',
    };
  }
  const tag = [
    `entity:${scope.entityId}`,
    `project:${scope.projectId}`,
    `process:${scope.processId}`,
    `session:${scope.sessionId}`,
  ].join(':');
  if (!CONTAINER_TAG_PATTERN.test(tag) || tag.length > 100) {
    return {
      ok: false,
      containerTag: null,
      missingFields: [],
      reason: 'encoded tag fails supermemory charset/length rules',
    };
  }
  return { ok: true, containerTag: tag, missingFields: [], scope };
}

/**
 * Decode containerTag produced by encodeContainerTag (or null if opaque).
 */
function decodeContainerTag(tag) {
  const text = normalizeId(tag);
  if (!text) return null;
  const parts = text.split(':');
  if (parts.length !== 8) return null;
  const scope = {};
  for (let i = 0; i < 8; i += 2) {
    const key = parts[i];
    const value = parts[i + 1];
    if (key === 'entity') scope.entityId = value;
    else if (key === 'project') scope.projectId = value;
    else if (key === 'process') scope.processId = value;
    else if (key === 'session') scope.sessionId = value;
    else return null;
  }
  if (missingScopeFields(scope).length > 0) return null;
  return scope;
}

/**
 * Route a question to RAG (stateless knowledge) vs MEMORY (scoped temporal).
 * Steal: https://supermemory.ai/docs/concepts/memory-vs-rag
 * RAG answers "what do I know?"; Memory answers "what do I remember about you?"
 */
function routeMemoryVsRag(query = '', options = {}) {
  const text = String(query || '').trim();
  const scope = normalizeScope(options.scope || options);
  const missing = missingScopeFields(scope);
  const lower = text.toLowerCase();

  const memoryCues = [
    'i prefer', 'my preference', 'last time', 'we decided', 'remember that',
    'what did we', 'what do i usually', 'my usual', 'for this user', 'for this project',
    'previous mistake', 'lesson about', 'prevention rule', 'thumbs down', 'what went wrong',
    'session', 'our agent', 'ceo said', 'standing order',
  ];
  const ragCues = [
    'how does', 'where is', 'which file', 'architecture', 'implements',
    'api endpoint', 'readme', 'documentation', 'source of', 'call graph',
    'pretooluse', 'gate-check', 'package.json', 'what connects',
  ];

  let memoryHits = memoryCues.filter((c) => lower.includes(c)).length;
  let ragHits = ragCues.filter((c) => lower.includes(c)).length;

  // Explicit override
  if (options.forceRail === 'memory' || options.forceRail === 'rag' || options.forceRail === 'hybrid') {
    return finalizeRoute(options.forceRail, text, scope, missing, {
      memoryHits,
      ragHits,
      reason: `forced:${options.forceRail}`,
    });
  }

  let rail = 'hybrid';
  let reason = 'default hybrid: prefer graphify/docs for code, lesson-store only with complete scope';
  if (memoryHits > ragHits && memoryHits > 0) {
    rail = 'memory';
    reason = 'memory cues dominate (preferences, prior decisions, lessons)';
  } else if (ragHits > memoryHits && ragHits > 0) {
    rail = 'rag';
    reason = 'rag cues dominate (code/docs/architecture)';
  } else if (!text) {
    rail = 'rag';
    reason = 'empty query defaults to rag/code-map';
  }

  return finalizeRoute(rail, text, scope, missing, { memoryHits, ragHits, reason });
}

function finalizeRoute(rail, text, scope, missing, meta) {
  const ok = rail !== 'memory' || missing.length === 0;
  const container = encodeContainerTag(scope);
  return {
    ok,
    rail,
    query: text,
    scope,
    missingFields: missing,
    containerTag: container.ok ? container.containerTag : null,
    rails: {
      rag: {
        tools: [
          'graphify query/path/explain (when graphify-out/graph.json exists)',
          'grepai / codebase search',
          'docs/ and public/ HTML',
        ],
        note: 'Stateless knowledge — same answer for every user',
      },
      memory: {
        tools: [
          'lesson-retrieval.js (requires complete four-field scope)',
          'memory-scope-readiness.selectRecordsForScope',
          'temporal-decay-weighting.js',
        ],
        note: 'Stateful scoped memory — fails closed without entity/project/process/session',
      },
    },
    recommended: rail === 'rag'
      ? ['graphify', 'docs']
      : rail === 'memory'
        ? ['lesson-retrieval', 'profile']
        : ['graphify', 'lesson-retrieval+scope', 'profile'],
    reason: meta.reason,
    memoryHits: meta.memoryHits,
    ragHits: meta.ragHits,
    error: ok ? null : `memory rail requires complete scope; missing: ${missing.join(', ')}`,
  };
}

/**
 * Dreaming mode for feedback→memory promotion (Supermemory process steal).
 * dynamic = batch related feedback into coherent units (default, cheaper/higher quality)
 * instant = promote this signal alone immediately (demo / crisis)
 */
function resolveDreamingMode(input = {}) {
  const raw = String(input.dreaming || input.mode || 'dynamic').toLowerCase().trim();
  const mode = DREAMING_MODES.includes(raw) ? raw : 'dynamic';
  return {
    mode,
    promoteImmediately: mode === 'instant',
    batchRelated: mode === 'dynamic',
    reason: mode === 'instant'
      ? 'instant dreaming: promote this document/feedback alone now'
      : 'dynamic dreaming: group related feedback before promotion (default)',
  };
}

/**
 * Build a static+dynamic profile from lesson-like records for one container/scope.
 * Steal: https://supermemory.ai/docs/concepts/user-profiles
 * Profile rides along every turn; search stays for query-specific recall.
 */
function buildLessonProfile(records = [], scopeInput = {}, options = {}) {
  const scope = normalizeScope(scopeInput);
  const missing = missingScopeFields(scope);
  if (missing.length > 0) {
    return {
      ok: false,
      missingFields: missing,
      profile: { static: [], dynamic: [] },
      reason: `incomplete scope: ${missing.join(', ')}`,
    };
  }

  const selected = selectRecordsForScope(records, scope, options);
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const dynamicWindowMs = Number.isFinite(options.dynamicWindowMs)
    ? options.dynamicWindowMs
    : 14 * 24 * 60 * 60 * 1000;

  const staticFacts = [];
  const dynamicFacts = [];

  for (const record of selected.allowed) {
    const content = String(
      record.content || record.title || record.whatWorked || record.whatToChange || ''
    ).trim();
    if (!content) continue;

    const ts = Date.parse(record.updatedAt || record.createdAt || record.timestamp || '');
    const ageOk = Number.isFinite(ts) ? (now - ts) <= dynamicWindowMs : false;
    const isPreference = /prefer|always|never|standing|ceo|mandate|policy/i.test(content)
      || record.type === 'fact'
      || record.visibility === 'shared'
      || record.importance === 'high';

    const entry = {
      id: record.id || null,
      content: content.slice(0, 280),
      type: record.type || null,
    };

    if (isPreference && !ageOk) {
      staticFacts.push(entry);
    } else if (ageOk) {
      dynamicFacts.push(entry);
    } else if (isPreference) {
      staticFacts.push(entry);
    } else {
      // Older non-preference lessons stay out of always-on profile
      // (search/lesson-retrieval still covers them).
    }
  }

  const encoded = encodeContainerTag(scope);
  return {
    ok: true,
    missingFields: [],
    containerTag: encoded.containerTag,
    scope,
    profile: {
      static: staticFacts.slice(0, options.staticLimit || 12),
      dynamic: dynamicFacts.slice(0, options.dynamicLimit || 12),
    },
    counts: {
      allowed: selected.allowed.length,
      blocked: selected.blocked.length,
      static: Math.min(staticFacts.length, options.staticLimit || 12),
      dynamic: Math.min(dynamicFacts.length, options.dynamicLimit || 12),
    },
    reason: 'profile synthesizes always-on facts; use search/lesson-retrieval for query-specific recall',
  };
}


module.exports = {
  MEMORY_OS_LAYERS,
  REQUIRED_SCOPE_FIELDS,
  DREAMING_MODES,
  CONTAINER_TAG_PATTERN,
  buildLessonProfile,
  buildMemoriStyleBenchmarkRecords,
  buildMemoryOsLayerReport,
  buildMemoryScopeReadinessReport,
  decodeContainerTag,
  encodeContainerTag,
  isSharedMemory,
  memoryScopeKey,
  missingScopeFields,
  normalizeScope,
  resolveDreamingMode,
  routeMemoryVsRag,
  selectRecordsForScope,
};
