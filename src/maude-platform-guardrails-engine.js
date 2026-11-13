/**
 * Maude Lemaire Platform Guardrails & Scaling Engine
 * 
 * Battle-tested engineering invariants from Maude Lemaire's work scaling Slack, GitHub, and Cursor:
 * 1. Mutation Testing for AI-Generated Unit Tests (kills sycophantic tests that only test happy paths)
 * 2. Scatter Query & Granular Sharding Guard (prevents shard fanout and giant-tenant hot-spotting)
 * 3. Product-Aware Load Shedding & Unbounded Fan-Out Capping (prioritizes critical text/gate events over emoji/typing)
 * 4. Zero-Downtime Database Migration State Machine (Isolated wrapper -> Double-write -> Backfill -> Shadow-read -> Cutover)
 * 5. Centralized Trace Sampling Guard (blocks distributed trace sampling right before export)
 * 6. Protocol-Level Load Testing Validator (replaces fragile $150k headless Chrome clusters with lightweight Go/WebSocket procs)
 * 7. Usage-Weighted Parallel Optimization Validator (rejects compute-wasting parallelization of rare tail paths)
 */

'use strict';

// 1. Mutation Testing Engine for AI Tests
const MUTATION_TYPES = {
  INVERT_BOOLEAN: 'INVERT_BOOLEAN',
  ZERO_OUT_RETURN: 'ZERO_OUT_RETURN',
  ERROR_SUPPRESS: 'ERROR_SUPPRESS',
  BOUNDARY_SWAP: 'BOUNDARY_SWAP'
};

function generateMutants(sourceCode) {
  const mutants = [];
  
  if (sourceCode.includes('=== true') || sourceCode.includes('=== false')) {
    mutants.push({
      type: MUTATION_TYPES.INVERT_BOOLEAN,
      description: 'Invert boolean comparison',
      mutatedCode: sourceCode.replace(/=== true/g, '=== false').replace(/=== false/g, '=== true')
    });
  }

  if (sourceCode.includes('return true') || sourceCode.includes('return false')) {
    mutants.push({
      type: MUTATION_TYPES.INVERT_BOOLEAN,
      description: 'Invert return boolean',
      mutatedCode: sourceCode.replace(/return true/g, 'return false')
    });
  }

  if (sourceCode.includes('throw new Error') || sourceCode.includes('throw err')) {
    mutants.push({
      type: MUTATION_TYPES.ERROR_SUPPRESS,
      description: 'Suppress thrown error to silent return null',
      mutatedCode: sourceCode.replace(/throw new Error\([^)]*\)/g, 'return null')
    });
  }

  if (sourceCode.includes(' > ') || sourceCode.includes(' < ') || sourceCode.includes(' >= ') || sourceCode.includes(' <= ')) {
    mutants.push({
      type: MUTATION_TYPES.BOUNDARY_SWAP,
      description: 'Invert numerical boundary comparisons',
      mutatedCode: sourceCode.replace(/ > /g, ' < ').replace(/ >= /g, ' <= ')
    });
  }

  if (sourceCode.includes('return ') && !sourceCode.includes('return null')) {
    mutants.push({
      type: MUTATION_TYPES.ZERO_OUT_RETURN,
      description: 'Zero out function return value',
      mutatedCode: sourceCode.replace(/return [^;]+;/g, 'return null;')
    });
  }

  return mutants;
}

function evaluateTestMutationResistance({ sourceCode, testRunnerFn, minKillRate = 0.8 }) {
  const mutants = generateMutants(sourceCode);
  if (mutants.length === 0) {
    return {
      allowed: true,
      verdict: 'PASS',
      totalMutants: 0,
      killedMutants: 0,
      killRate: 1.0,
      message: 'No supported mutation sites found; code passed standard verifier.'
    };
  }

  let killed = 0;
  const survivingMutants = [];

  for (const mutant of mutants) {
    let testFailed = false;
    try {
      const result = testRunnerFn(mutant.mutatedCode);
      if (result === false || (result && result.passed === false)) {
        testFailed = true;
      }
    } catch (_) {
      testFailed = true;
    }

    if (testFailed) {
      killed++;
    } else {
      survivingMutants.push(mutant);
    }
  }

  const killRate = killed / mutants.length;
  const passed = killRate >= minKillRate && survivingMutants.length === 0;

  return {
    allowed: passed,
    verdict: passed ? 'PASS' : 'BLOCK',
    totalMutants: mutants.length,
    killedMutants: killed,
    survivingMutants: survivingMutants.map(m => m.description),
    killRate,
    minKillRate,
    message: passed 
      ? `PASS: Test suite successfully killed ${killed}/${mutants.length} mutants (${(killRate * 100).toFixed(1)}%).`
      : `BLOCK: AI-generated test suite is sycophantic. ${survivingMutants.length} mutants survived without triggering test failures.`
  };
}

// 2. Scatter Query & Fine-Grained Sharding Policy
const SHARDED_TABLES = new Set([
  'messages',
  'reactions',
  'events',
  'audit_logs',
  'channel_members',
  'agent_session_events'
]);

const VALID_SHARDING_KEYS = new Set([
  'channel_id',
  'session_id',
  'workspace_id',
  'conversation_id'
]);

const BANNED_HIGH_LEVEL_SHARDING_KEYS = new Set([
  'enterprise_id',
  'team_id',
  'global_tenant_id'
]);

function validateQuerySharding({ sql, targetTable, queryParams = {} }) {
  const normalizedSql = sql.toLowerCase().trim();
  const table = targetTable.toLowerCase();

  if (!SHARDED_TABLES.has(table)) {
    return {
      allowed: true,
      isShardedTable: false,
      isScatterQuery: false,
      message: `Table '${table}' is not dynamically sharded; direct query allowed.`
    };
  }

  // Check if query is a full-table scan or lacks a WHERE clause
  if (!normalizedSql.includes('where')) {
    return {
      allowed: false,
      isShardedTable: true,
      isScatterQuery: true,
      violation: 'SCATTER_QUERY_MISSING_WHERE',
      message: `BLOCK: Scatter query detected on sharded table '${table}'. Queries without a WHERE clause fan out to all database shards.`
    };
  }

  // Check for presence of fine-grained shard key
  const hasGranularKey = Array.from(VALID_SHARDING_KEYS).some(key => 
    normalizedSql.includes(key) || queryParams[key] !== undefined
  );

  const usesBannedHighLevelKey = Array.from(BANNED_HIGH_LEVEL_SHARDING_KEYS).some(key =>
    (normalizedSql.includes(key) || queryParams[key] !== undefined) && !hasGranularKey
  );

  if (usesBannedHighLevelKey) {
    return {
      allowed: false,
      isShardedTable: true,
      isScatterQuery: true,
      violation: 'SHARDED_BY_COARSE_ENTERPRISE_KEY',
      message: `BLOCK: Sharding by coarse key (team_id/enterprise_id) causes giant enterprise hotspots. Shard by the smallest logical unit of access (e.g. channel_id or session_id).`
    };
  }

  if (!hasGranularKey) {
    return {
      allowed: false,
      isShardedTable: true,
      isScatterQuery: true,
      violation: 'SCATTER_QUERY_MISSING_SHARD_KEY',
      message: `BLOCK: Scatter query on table '${table}'. Missing granular sharding key in WHERE clause (${Array.from(VALID_SHARDING_KEYS).join(', ')}).`
    };
  }

  return {
    allowed: true,
    isShardedTable: true,
    isScatterQuery: false,
    message: `PASS: Query includes valid fine-grained shard key. Routed to single shard without scatter.`
  };
}

// 3. Product-Aware Load Shedding & Unbounded Fan-Out Caps
const PRIORITY_LEVELS = {
  CRITICAL: 'CRITICAL',
  STANDARD: 'STANDARD',
  SHEDDABLE: 'SHEDDABLE'
};

const EVENT_PRIORITY_MAP = {
  gate_eval: PRIORITY_LEVELS.CRITICAL,
  token_auth: PRIORITY_LEVELS.CRITICAL,
  text_message: PRIORITY_LEVELS.CRITICAL,
  payment_charge: PRIORITY_LEVELS.CRITICAL,
  metrics_ingest: PRIORITY_LEVELS.STANDARD,
  audit_log: PRIORITY_LEVELS.STANDARD,
  user_activity: PRIORITY_LEVELS.STANDARD,
  emoji_reaction: PRIORITY_LEVELS.SHEDDABLE,
  typing_indicator: PRIORITY_LEVELS.SHEDDABLE,
  ambient_presence: PRIORITY_LEVELS.SHEDDABLE,
  read_receipt: PRIORITY_LEVELS.SHEDDABLE
};

const PRODUCT_CAPS = {
  MAX_DISTINCT_CUSTOM_EMOJIS_PER_MSG: 23,
  MAX_DISPLAY_COUNT_BEFORE_99_PLUS: 99
};

function evaluateLoadShedding({ loadLevel = 'NORMAL', eventType, requestedCount = 1 }) {
  const priority = EVENT_PRIORITY_MAP[eventType] || PRIORITY_LEVELS.STANDARD;

  if (loadLevel === 'EMERGENCY') {
    if (priority === PRIORITY_LEVELS.SHEDDABLE || priority === PRIORITY_LEVELS.STANDARD) {
      return {
        action: 'SHED_EVENT',
        allowed: false,
        priority,
        reason: `EMERGENCY load shed: dropping ${priority} payload '${eventType}' to preserve critical text and gate paths.`
      };
    }
  }

  if (loadLevel === 'HIGH') {
    if (priority === PRIORITY_LEVELS.SHEDDABLE) {
      return {
        action: 'SHED_EVENT',
        allowed: false,
        priority,
        reason: `HIGH load shed: dropping non-essential event '${eventType}' on the floor.`
      };
    }
  }

  let adjustedCount = requestedCount;
  let capped = false;

  if (eventType === 'emoji_reaction' && requestedCount > PRODUCT_CAPS.MAX_DISTINCT_CUSTOM_EMOJIS_PER_MSG) {
    adjustedCount = PRODUCT_CAPS.MAX_DISTINCT_CUSTOM_EMOJIS_PER_MSG;
    capped = true;
  }

  const displayString = adjustedCount > PRODUCT_CAPS.MAX_DISPLAY_COUNT_BEFORE_99_PLUS 
    ? '99+' 
    : String(adjustedCount);

  return {
    action: 'DELIVER_EVENT',
    allowed: true,
    priority,
    capped,
    requestedCount,
    adjustedCount,
    displayString,
    reason: capped 
      ? `Product cap enforced: distinct ${eventType} capped at ${adjustedCount} to protect database fan-out.`
      : `Event allowed under ${loadLevel} load.`
  };
}

// 4. Zero-Downtime Migration State Machine
const MIGRATION_PHASES = {
  ISOLATED_WRAPPER: 'ISOLATED_WRAPPER',
  DOUBLE_WRITE: 'DOUBLE_WRITE',
  BACKFILL: 'BACKFILL',
  SHADOW_READ: 'SHADOW_READ',
  READ_CUTOVER: 'READ_CUTOVER',
  CLEANUP: 'CLEANUP'
};

function evaluateMigrationPhase({
  currentPhase,
  nextPhase,
  doubleWriteActive = false,
  backfillComplete = false,
  shadowReadParity = 0.0
}) {
  const phases = Object.values(MIGRATION_PHASES);
  const currIdx = phases.indexOf(currentPhase);
  const nextIdx = phases.indexOf(nextPhase);

  if (currIdx === -1 || nextIdx === -1) {
    return {
      allowed: false,
      reason: `Invalid migration phase transition: ${currentPhase} -> ${nextPhase}`
    };
  }

  if (nextIdx !== currIdx + 1) {
    return {
      allowed: false,
      reason: `Zero-downtime migration phases must advance strictly one step at a time: expected ${phases[currIdx + 1]}, got ${nextPhase}`
    };
  }

  if (nextPhase === MIGRATION_PHASES.SHADOW_READ) {
    if (!doubleWriteActive) {
      return {
        allowed: false,
        reason: 'Cannot enter SHADOW_READ phase without active double-write enabled.'
      };
    }
    if (!backfillComplete) {
      return {
        allowed: false,
        reason: 'Cannot enter SHADOW_READ phase before historical backfill has completed 100%.'
      };
    }
  }

  if (nextPhase === MIGRATION_PHASES.READ_CUTOVER) {
    if (shadowReadParity < 1.0) {
      return {
        allowed: false,
        reason: `Cannot cut over primary reads: shadow read comparison shows discrepancies (${(shadowReadParity * 100).toFixed(2)}% parity, requires 100.0%).`
      };
    }
  }

  return {
    allowed: true,
    previousPhase: currentPhase,
    activePhase: nextPhase,
    reason: `PASS: Phase advanced successfully to ${nextPhase} with all zero-downtime invariants satisfied.`
  };
}

// 5. Centralized Trace Sampling Guard
function validateTraceSamplingArchitecture({ instrumentationSites = [] }) {
  if (instrumentationSites.length > 1) {
    const isCentralized = instrumentationSites.every(site => site.includes('central-sampler') || site.includes('telemetry-hub'));
    if (!isCentralized) {
      return {
        allowed: false,
        violation: 'SCATTERED_TRACE_SAMPLING',
        sites: instrumentationSites,
        message: 'BLOCK: Scattered trace sampling detected right before exporter. Centralize all trace sampling decisions into a single policy diode.'
      };
    }
  }

  return {
    allowed: true,
    message: 'PASS: Trace sampling is centralized.'
  };
}

// 6. Protocol-Level Load Testing Validator
function validateLoadTestArchitecture({ engineType, virtualUsers = 1000, headlessBrowserInstances = 0 }) {
  if (headlessBrowserInstances > 100) {
    return {
      allowed: false,
      violation: 'EXCESSIVE_HEADLESS_BROWSER_LOAD_TEST',
      estimatedCostUsd: (headlessBrowserInstances / 1000) * 3000,
      message: `BLOCK: Running ${headlessBrowserInstances} headless Chrome pods for load testing is fragile and cost-prohibitive. Simulate protocol-level paths (Go/HTTP/WebSocket processes) directly against API and edge caches.`
    };
  }

  const isProtocolRunner = ['go', 'k6', 'autocannon', 'ws-protocol', 'hey'].includes(engineType.toLowerCase());

  return {
    allowed: true,
    isProtocolRunner,
    virtualUsers,
    message: `PASS: Protocol-level load testing architecture approved for ${virtualUsers} virtual users.`
  };
}

// 7. Usage-Weighted Parallel Optimization Validator
function validateParallelOptimization({ longestTaskLatencyMs, parallelizedTasks = [] }) {
  // If the longest task latency dominates and other tasks represent < 5% of usage, parallelization is fake optimization
  let totalOverheadMs = 0;
  let lowFrequencyCount = 0;

  for (const task of parallelizedTasks) {
    totalOverheadMs += task.threadSpawnOverheadMs || 5;
    if (task.trafficWeight !== undefined && task.trafficWeight < 0.05) {
      lowFrequencyCount++;
    }
  }

  if (lowFrequencyCount === parallelizedTasks.length && parallelizedTasks.length > 0) {
    return {
      allowed: false,
      recommendation: 'KEEP_SEQUENTIAL',
      reason: 'BLOCK: Parallelized tasks account for < 5% of user traffic and do not reduce the critical path bottleneck. Parallelization wastes compute and increases system load.'
    };
  }

  return {
    allowed: true,
    recommendation: 'PARALLELIZE',
    reason: 'PASS: Parallelization yields meaningful wall-clock latency reduction along the critical path.'
  };
}

module.exports = {
  MUTATION_TYPES,
  SHARDED_TABLES,
  VALID_SHARDING_KEYS,
  BANNED_HIGH_LEVEL_SHARDING_KEYS,
  PRIORITY_LEVELS,
  EVENT_PRIORITY_MAP,
  PRODUCT_CAPS,
  MIGRATION_PHASES,
  generateMutants,
  evaluateTestMutationResistance,
  validateQuerySharding,
  evaluateLoadShedding,
  evaluateMigrationPhase,
  validateTraceSamplingArchitecture,
  validateLoadTestArchitecture,
  validateParallelOptimization
};
