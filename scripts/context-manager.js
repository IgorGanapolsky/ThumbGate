#!/usr/bin/env node
'use strict';

/**
 * Context Manager — Unified Context-Augmented Generation (CAG) Orchestrator
 *
 * Single entry point that assembles a normalized context object from:
 *   - Session state (primer / handoff)
 *   - User profile (role, preferences, agent type)
 *   - Relevant lessons (per-action retrieval)
 *   - Prevention rules / pre-tool guards
 *   - Context pack (ContextFS retrieval)
 *   - Code-graph impact (optional, for coding tasks)
 *
 * Implements tiered graceful degradation:
 *   Tier 1 (full)  — session + lessons + rules + context pack + code-graph
 *   Tier 2 (warm)  — lessons + rules + context pack (no session)
 *   Tier 3 (cold)  — prevention rules + global defaults only
 *
 * Role-aware filtering shapes output by agent type and license tier.
 */

const {
  ensureContextFs,
  constructContextPack,
  readSessionHandoff,
  recordProvenance,
} = require('./contextfs');
const { loadOptionalModule } = require('./private-core-boundary');
const { retrieveRelevantLessons } = loadOptionalModule('./lesson-retrieval', () => ({
  retrieveRelevantLessons: () => [],
}));
const { evaluatePretool } = require('./hybrid-feedback-context');
const { loadProfile } = require('./user-profile');
const {
  analyzeCodeGraphImpact,
  formatCodeGraphRecallSection,
} = require('./codegraph-context');

// ---------------------------------------------------------------------------
// Agent capability profiles — shapes what context each agent type receives
// ---------------------------------------------------------------------------

const AGENT_PROFILES = {
  claude: {
    maxLessons: 8,
    includeCodeGraph: true,
    includeStructuredRules: true,
    contextBudget: 10000,
  },
  cursor: {
    maxLessons: 5,
    includeCodeGraph: true,
    includeStructuredRules: true,
    contextBudget: 6000,
  },
  forgecode: {
    maxLessons: 5,
    includeCodeGraph: false,
    includeStructuredRules: true,
    contextBudget: 6000,
  },
  codex: {
    maxLessons: 6,
    includeCodeGraph: true,
    includeStructuredRules: true,
    contextBudget: 8000,
  },
  default: {
    maxLessons: 5,
    includeCodeGraph: false,
    includeStructuredRules: true,
    contextBudget: 6000,
  },
};

function getAgentProfile(agentType) {
  const key = String(agentType || 'default').toLowerCase();
  return AGENT_PROFILES[key] || AGENT_PROFILES.default;
}

// ---------------------------------------------------------------------------
// Tier assembly helpers
// ---------------------------------------------------------------------------

function assembleSession() {
  try {
    return readSessionHandoff();
  } catch {
    return null;
  }
}

function assembleLessons(query, agentProfile, options = {}) {
  try {
    return retrieveRelevantLessons(
      options.toolName || '',
      query,
      { maxResults: agentProfile.maxLessons, feedbackDir: options.feedbackDir },
    );
  } catch {
    return [];
  }
}

function assembleGuards(toolName, toolInput) {
  try {
    return evaluatePretool(toolName || '', toolInput || {});
  } catch {
    return { mode: 'allow', reason: 'guard-unavailable' };
  }
}

function assembleContextPack(query, agentProfile) {
  try {
    ensureContextFs();
    return constructContextPack({
      query,
      maxItems: Math.min(8, Math.ceil(agentProfile.contextBudget / 1000)),
      maxChars: agentProfile.contextBudget,
    });
  } catch {
    return null;
  }
}

function assembleCodeGraph(query, repoPath, agentProfile) {
  if (!agentProfile.includeCodeGraph) return null;
  try {
    const impact = analyzeCodeGraphImpact({
      intentId: null,
      context: query,
      repoPath,
    });
    return formatCodeGraphRecallSection(impact) || null;
  } catch {
    return null;
  }
}

function assembleUserProfile() {
  try {
    const profile = loadProfile();
    if (!profile || !profile.entries || profile.entries.length === 0) return null;
    return {
      entries: profile.entries,
      charCount: profile.charCount || 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tier classification
// ---------------------------------------------------------------------------

function classifyTier(components) {
  const hasSession = !!components.session;
  const hasLessons = components.lessons && components.lessons.length > 0;
  const hasPack = !!components.contextPack;

  if (hasSession && (hasLessons || hasPack)) return 'full';
  if (hasLessons || hasPack) return 'warm';
  return 'cold';
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Assemble a unified context object for a given query.
 *
 * @param {Object} params
 * @param {string} params.query - Task description / context query
 * @param {string} [params.toolName] - Current tool being invoked (for lesson retrieval)
 * @param {Object} [params.toolInput] - Current tool input (for guard evaluation)
 * @param {string} [params.agentType] - Agent type: claude, cursor, forgecode, codex
 * @param {string} [params.repoPath] - Repo path for code-graph analysis
 * @param {string} [params.feedbackDir] - Override feedback directory
 * @returns {Object} Normalized context object
 */
function assembleUnifiedContext(params = {}) {
  const {
    query = '',
    toolName,
    toolInput,
    agentType,
    repoPath,
    feedbackDir,
  } = params;

  const agentProfile = getAgentProfile(agentType);

  // Assemble all components — each is fault-tolerant
  const session = assembleSession();
  const userProfile = assembleUserProfile();
  const lessons = assembleLessons(query, agentProfile, { toolName, feedbackDir });
  const guards = assembleGuards(toolName, toolInput);
  const contextPack = assembleContextPack(query, agentProfile);
  const codeGraph = assembleCodeGraph(query, repoPath, agentProfile);

  const components = { session, userProfile, lessons, guards, contextPack, codeGraph };
  const tier = classifyTier(components);

  const result = {
    tier,
    agentType: agentType || 'default',
    agentProfile: {
      maxLessons: agentProfile.maxLessons,
      contextBudget: agentProfile.contextBudget,
      includeCodeGraph: agentProfile.includeCodeGraph,
    },
    session: session || null,
    userProfile: userProfile || null,
    lessons,
    guards,
    contextPack: contextPack ? {
      packId: contextPack.packId,
      itemCount: Array.isArray(contextPack.items) ? contextPack.items.length : 0,
      items: (contextPack.items || []).slice(0, 5).map((item) => ({
        id: item.id,
        namespace: item.namespace,
        title: item.title,
        tags: item.tags || [],
        score: item.score,
      })),
      visibility: contextPack.visibility || null,
      cached: !!(contextPack.cache && contextPack.cache.hit),
    } : null,
    codeGraph: codeGraph || null,
    assembledAt: new Date().toISOString(),
  };

  // Record provenance for audit trail
  try {
    recordProvenance({
      type: 'unified_context_assembled',
      tier,
      agentType: result.agentType,
      lessonCount: lessons.length,
      guardDecision: guards.mode || 'allow',
      hasSession: !!session,
      hasUserProfile: !!userProfile,
      hasCodeGraph: !!codeGraph,
      packId: result.contextPack ? result.contextPack.packId : null,
    });
  } catch {
    // Provenance write failure must never break context assembly
  }

  return result;
}

// ---------------------------------------------------------------------------
// Formatting for MCP tool response
// ---------------------------------------------------------------------------

function formatUnifiedContext(ctx) {
  const lines = [];

  lines.push(`## Unified Context (Tier: ${ctx.tier})`);
  lines.push(`Agent: ${ctx.agentType} | Assembled: ${ctx.assembledAt}`);
  lines.push('');

  // Session
  if (ctx.session) {
    lines.push('### Session');
    if (ctx.session.lastTask) lines.push(`Last task: ${ctx.session.lastTask}`);
    if (ctx.session.nextStep) lines.push(`Next step: ${ctx.session.nextStep}`);
    if (ctx.session.blockers && ctx.session.blockers.length > 0) {
      lines.push(`Blockers: ${ctx.session.blockers.join(', ')}`);
    }
    lines.push('');
  }

  // User profile
  if (ctx.userProfile) {
    lines.push('### User Profile');
    ctx.userProfile.entries.slice(0, 3).forEach((entry) => {
      lines.push(`- ${entry.slice(0, 120)}`);
    });
    lines.push('');
  }

  // Guards
  if (ctx.guards && ctx.guards.mode !== 'allow') {
    lines.push(`### Guard: ${ctx.guards.mode.toUpperCase()}`);
    lines.push(ctx.guards.reason || 'No reason provided');
    lines.push('');
  }

  // Lessons
  if (ctx.lessons && ctx.lessons.length > 0) {
    lines.push(`### Lessons (${ctx.lessons.length})`);
    ctx.lessons.forEach((lesson) => {
      const signal = lesson.signal === 'negative' ? '[-]' : '[+]';
      lines.push(`${signal} ${lesson.title || lesson.id} (score: ${lesson.relevanceScore})`);
      if (lesson.rule) {
        lines.push(`  Rule: IF ${lesson.rule.condition || '?'} THEN ${lesson.rule.action || '?'}`);
      }
    });
    lines.push('');
  }

  // Context pack
  if (ctx.contextPack) {
    lines.push(`### Context Pack (${ctx.contextPack.itemCount} items)`);
    ctx.contextPack.items.forEach((item) => {
      lines.push(`- [${item.namespace}] ${item.title} (score: ${item.score})`);
    });
    if (ctx.contextPack.cached) lines.push('(cached)');
    lines.push('');
  }

  // Code graph
  if (ctx.codeGraph) {
    lines.push('### Code Graph Impact');
    lines.push(ctx.codeGraph);
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  assembleUnifiedContext,
  formatUnifiedContext,
  getAgentProfile,
  AGENT_PROFILES,
  classifyTier,
};
