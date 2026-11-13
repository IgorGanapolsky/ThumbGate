'use strict';

/**
 * ThumbGate Protocol-Level Load Shedding & Scatter Query Diode
 *
 * Architectural Steal: Maude Lemaire (Scaling Slack, GitHub, Cursor)
 * 1. Simulate protocol-level critical paths directly (WebSocket/HTTP) instead of fragile $150k headless browser fleets.
 * 2. Implement product-aware load shedding: drop non-essential events (emoji reactions, typing indicators)
 *    on the floor under extreme load while prioritizing text messages and approval decisions.
 * 3. Put hard product caps on unbounded fan-out features (cap custom emojis at 23, display '99+' instead of live SQL COUNT).
 * 4. Guard against ORM obscurity and scatter queries: ensure database queries contain explicit primary sharding keys.
 */

// Event priorities for product-aware load shedding
const EVENT_PRIORITIES = {
  // Priority 1 (CRITICAL — NEVER SHED): Core user content, tool approval, gate decisions
  'chat.message': 1,
  'tool.approval': 1,
  'gate.decision': 1,
  'auth.token_refresh': 1,
  'billing.checkout': 1,

  // Priority 2 (DEGRADABLE — SHED UNDER HEAVY LOAD): Live presence, cursor position
  'presence.heartbeat': 2,
  'cursor.position': 2,
  'typing.indicator': 2,

  // Priority 3 (SHED FIRST — DROP UNDER MODERATE LOAD): Emoji reactions, badge counts, telemetry
  'reaction.add': 3,
  'reaction.remove': 3,
  'telemetry.span': 3,
  'analytics.page_view': 3,
};

/**
 * Product-aware load shedder decision function.
 * Evaluates whether an incoming event should be processed or shed based on system pressure.
 */
function evaluateLoadShedding(event, systemMetrics = {}) {
  const {
    eventType = 'chat.message',
    payloadSize = 100,
  } = event;

  const {
    cpuPercent = 20,
    queueDepth = 50,
    activeConnections = 1000,
  } = systemMetrics;

  const priority = EVENT_PRIORITIES[eventType] ?? 2;

  // Normal load (<70% CPU, queue depth < 500)
  if (cpuPercent < 70 && queueDepth < 500) {
    return {
      action: 'process',
      shed: false,
      reason: 'Normal operational capacity',
      priority,
    };
  }

  // High load (70% - 85% CPU, queue depth 500 - 2000)
  if (cpuPercent >= 70 && cpuPercent < 85) {
    if (priority >= 3) {
      return {
        action: 'shed',
        shed: true,
        reason: `Product load shedding: dropped priority ${priority} event (${eventType}) under high load (CPU: ${cpuPercent}%)`,
        priority,
      };
    }
    return { action: 'process', shed: false, reason: 'High load: priority 1 & 2 preserved', priority };
  }

  // Extreme load (>=85% CPU, queue depth >= 2000) — Thundering herd protection
  if (priority > 1) {
    return {
      action: 'shed',
      shed: true,
      reason: `Product load shedding: dropped priority ${priority} event (${eventType}) under extreme load (CPU: ${cpuPercent}%, queue: ${queueDepth})`,
      priority,
    };
  }

  return {
    action: 'process',
    shed: false,
    reason: 'Critical priority 1 event preserved under extreme load',
    priority,
  };
}

/**
 * Hard Product Caps Enforcement:
 * Prevents unbounded fan-out features from saturating database or cache memory.
 */
function enforceProductCaps(feature, data) {
  switch (feature) {
    case 'custom_emoji_reactions': {
      const maxReactions = 23; // Slack-proven hard cap
      const list = Array.isArray(data) ? data : [];
      return {
        capped: list.length > maxReactions,
        count: Math.min(list.length, maxReactions),
        items: list.slice(0, maxReactions),
        exceededBy: Math.max(0, list.length - maxReactions),
      };
    }
    case 'unread_badge_count': {
      const count = Number(data) || 0;
      if (count > 99) {
        return { display: '99+', exact: count, capped: true };
      }
      return { display: String(count), exact: count, capped: false };
    }
    case 'sql_in_clause': {
      const maxElements = 100;
      const list = Array.isArray(data) ? data : [];
      return {
        safe: list.length <= maxElements,
        length: list.length,
        cappedElements: list.slice(0, maxElements),
      };
    }
    default:
      return { capped: false, data };
  }
}

/**
 * Scatter Query Detector:
 * Scans SQL queries in agent-generated code to prevent un-sharded queries
 * that lack a primary sharding key (e.g. channel_id, workspace_id, team_id).
 */
const REQUIRED_SHARDING_KEYS = ['channel_id', 'workspace_id', 'team_id', 'org_id', 'tenant_id'];

function auditSqlForScatterQueries(sqlQuery, knownShardingKeys = REQUIRED_SHARDING_KEYS) {
  const normalized = sqlQuery.trim();

  // Non-SELECT statements or table creation
  if (!/^SELECT\b/i.test(normalized)) {
    return { isScatterQuery: false, reason: 'Non-SELECT statement' };
  }

  // Queries that scan tables without a WHERE clause
  const whereMatch = normalized.match(/\bWHERE\b\s+([\s\S]+?)(?:\bGROUP\b|\bORDER\b|\bLIMIT\b|$)/i);
  if (!whereMatch) {
    return {
      isScatterQuery: true,
      severity: 'CRITICAL',
      reason: 'Scatter query detected: SELECT statement without WHERE clause will scan all database shards',
      query: sqlQuery,
    };
  }

  const whereClause = whereMatch[1];
  const hasShardingKey = knownShardingKeys.some(key => new RegExp(`\\b${key}\\b`, 'i').test(whereClause));

  if (!hasShardingKey) {
    return {
      isScatterQuery: true,
      severity: 'HIGH',
      reason: `Scatter query detected: WHERE clause lacks required primary sharding key (${knownShardingKeys.join(', ')}). Query will hit all shards.`,
      query: sqlQuery,
      missingKeys: knownShardingKeys,
    };
  }

  return {
    isScatterQuery: false,
    severity: 'NONE',
    reason: 'Query contains primary sharding key constraint',
    query: sqlQuery,
  };
}

module.exports = {
  EVENT_PRIORITIES,
  evaluateLoadShedding,
  enforceProductCaps,
  auditSqlForScatterQueries,
  REQUIRED_SHARDING_KEYS,
};
