#!/usr/bin/env node
'use strict';

/**
 * Cost Router — AIOS FORMAT steal (advisoraipartners.com/aios).
 *
 * Stolen pattern: "Not every task needs the most expensive AI, and not every
 * document should leave your office. Every request goes through a router:
 * routine work runs free on your own computer, quick jobs go to a fast model,
 * and only the hard thinking goes to the most capable one."
 *
 * ThumbGate adaptation:
 *   - Tier 1: Local/first-party (on-device, zero marginal cost, zero network)
 *   - Tier 2: Fast cloud model (cents per request, routine sorting/drafts)
 *   - Tier 3: Capable model (for hard thinking, complex reasoning)
 *   - Budget metering: monthly budget set by user, metered on every request
 *   - Privileged stays local: sensitive tasks never leave the machine
 *
 * Integrates with existing model-tier-router.js by adding:
 *   1. Budget meter (track spend against monthly cap)
 *   2. Privileged-work flag (force local tier)
 *   3. Audit router (score tasks on Time/Money/Buildable before routing)
 *
 * Usage:
 *   node scripts/cost-router.js route --task "classify email" --tokens 1500
 *   node scripts/cost-router.js route --task "draft legal doc" --tokens 8000 --privileged
 *   node scripts/cost-router.js status
 *   node scripts/cost-router.js set-budget --monthly 5000
 *   node scripts/cost-router.js audit-task --title "PR review" --minutes 30 --cost 0 --complexity 8
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PROJECT_ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Tier definitions (stolen from AIOS router lanes)
// ---------------------------------------------------------------------------

/**
 * Three-tier routing — stolen directly from AIOS:
 *   1. local      — runs on your own computer, free, never leaves machine
 *   2. fastCloud  — cents per request, routine sorting and drafts
 *   3. capable    — dollars per request, hard thinking and important writing
 *
 * Privileged work forces tier 1 regardless of complexity.
 */
const TIER_DEFS = {
  local: {
    name: 'local',
    costPerMillionTokens: 0.0,
    latencyProfile: 'low-variability',
    leavesMachine: false,
    description: 'Runs on your own computer. Free. Never leaves the machine.',
    models: ['gemma-3-1b-it-qat-MLX', 'llama-3-3-70b-MLX', 'qwen3-8b-MLX', 'poolside/Laguna-XS-2.1-NVFP4-mlx', 'poolside/Laguna-XS-2.1-DFlash'],
  },
  fastCloud: {
    name: 'fastCloud',
    costPerMillionTokens: 0.15,
    latencyProfile: 'fast',
    leavesMachine: true,
    description: 'Cents per request. Routine sorting, drafting, classification.',
    models: ['gpt-4o-mini', 'claude-3-5-haiku-20241022', 'poolside/laguna-xs-2.1', 'dreamlabs/dream-1-flash'],
  },
  capable: {
    name: 'capable',
    costPerMillionTokens: 15.0,
    latencyProfile: 'slower',
    leavesMachine: true,
    description: 'Dollars per request. Hard thinking, important writing, complex reasoning.',
    models: ['claude-3-7-sonnet-20250219', 'o1-preview', 'poolside/laguna-s-2.1', 'dreamlabs/dream-1'],
  },
};

// ---------------------------------------------------------------------------
// Budget meter
// ---------------------------------------------------------------------------

/**
 * Stolen from AIOS: "A monthly budget you set, metered on every request."
 */
function getBudgetPath() {
  return path.join(os.homedir(), '.thumbgate', 'cost-router-budget.json');
}

function loadBudget() {
  const p = getBudgetPath();
  if (!fs.existsSync(p)) {
    return {
      monthlyBudgetUsd: 0,
      spentThisMonth: 0,
      month: new Date().toISOString().slice(0, 7),
      requests: [],
    };
  }
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  // Reset if month changed
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (data.month !== currentMonth) {
    return {
      monthlyBudgetUsd: data.monthlyBudgetUsd,
      spentThisMonth: 0,
      month: currentMonth,
      requests: [],
    };
  }
  return data;
}

function saveBudget(budget) {
  const p = getBudgetPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(budget, null, 2)}\n`);
}

function recordRequest(budget, request) {
  budget.requests.push({
    ...request,
    timestamp: new Date().toISOString(),
  });
  budget.spentThisMonth += request.costUsd;
  saveBudget(budget);
  return budget;
}

// ---------------------------------------------------------------------------
// Task complexity classifier
// ---------------------------------------------------------------------------

/**
 * Stolen from AIOS Five-Step Audit:
 *   "We map what repeats in your week and score every task on time, money
 *    and how buildable it is."
 *
 * ThumbGate adaptation: score a task on complexity to determine tier routing.
 * Uses a simple heuristic model — no external ML dependency.
 */
const COMPLEXITY_KEYWORDS = {
  low: [
    'sort', 'classify', 'list', 'extract', 'summarize', 'flag',
    'draft short', 'reply', 'triage', 'categorize', 'tag',
  ],
  medium: [
    'explain', 'compare', 'analyze', 'review', 'refactor', 'optimize',
    'write doc', 'generate test', 'debug', 'translate', 'security',
  ],
  high: [
    'architect', 'design system', 'design architecture', 'strategic',
    'research plan', 'complex reasoning', 'multi-step', 'integration',
    'protocol design', 'protocol', 'consensus', 'formal verification', 'mathematical',
    'distributed', 'orchestration', 'distributed system',
  ],
};

function classifyComplexity(taskDescription, contextTokens) {
  const desc = (taskDescription || '').toLowerCase();
  const tokenCount = contextTokens || 0;

  let score = 0;
  for (const [level, keywords] of Object.entries(COMPLEXITY_KEYWORDS)) {
    for (const kw of keywords) {
      if (desc.includes(kw)) {
        score += level === 'low' ? -1 : level === 'medium' ? 1 : 2;
      }
    }
  }

  // Token count also factors into complexity
  if (tokenCount > 100000) score += 2;
  else if (tokenCount > 20000) score += 1;
  else if (tokenCount >= 5000) score += 0;
  else score -= 1;

  if (score >= 3) return 'high';
  if (score >= 1) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Privileged work detection
// ---------------------------------------------------------------------------

/**
 * Stolen from AIOS: "For an attorney: client files are searched and summarized
 * by a model running on the firm's own machine. Privileged work never goes to
 * a cloud model."
 *
 * ThumbGate adaptation: detect if a task contains privileged/sensitive content
 * that must stay local.
 */
const PRIVILEGED_PATTERNS = [
  /legal\b/i, /attorney/i, /confidential/i, /privileged/i,
  /client.*\b(file|data|info)\b/i, /medical\b/i, /health.*\b(record|data)\b/i,
  /credential/i, /secret.*\b(key|token)\b/i, /password/i,
  /pii\b/i, /personal.*\binfo\b/i, /soc.*\b(2|3|4)\b.*type/i,
  /financial.*\b(record|statement|account)\b/i,
];

function isPrivileged(taskDescription) {
  const desc = taskDescription || '';
  return PRIVILEGED_PATTERNS.some((re) => re.test(desc));
}

// ---------------------------------------------------------------------------
// Route a task
// ---------------------------------------------------------------------------

/**
 * Route a task through the three-tier cost router.
 *
 * @param {object} input
 * @param {string} input.task          — task description
 * @param {number} input.tokens       — estimated input+output tokens
 * @param {boolean} input.privileged   — force local if true
 * @param {number} input.budgetUsd     — optional override for monthly budget (for testing)
 * @returns {{ tier: string, costUsd: number, exceedsBudget: boolean, reason: string, model: string }}
 */
function routeTask(input) {
  const {
    task = '',
    tokens = 1000,
    privileged = isPrivileged(task),
    budgetUsd: overrideBudget,
  } = input;

  // Load budget (with optional override for testing)
  let budget = loadBudget();
  if (overrideBudget !== undefined) {
    budget.monthlyBudgetUsd = overrideBudget;
  }

  // Determine complexity
  const complexity = classifyComplexity(task, tokens);
  const forcedLocal = privileged;

  let tier;
  let reason;

  if (forcedLocal) {
    tier = 'local';
    reason = 'Privileged work — must stay on local machine (AIOS "privileged stays local" pattern)';
  } else if (complexity === 'low') {
    tier = 'local';
    reason = 'Simple task — route to local model (free, zero latency variability)';
  } else if (complexity === 'medium') {
    tier = 'fastCloud';
    reason = 'Routine task — route to fast cloud model (cents per request)';
  } else {
    tier = 'capable';
    reason = 'Complex task — route to capable model (hard thinking, important writing)';
  }

  // Calculate cost
  const costPerMillion = TIER_DEFS[tier].costPerMillionTokens;
  const costUsd = Number(((tokens / 1000000) * costPerMillion).toFixed(6));

  // Check budget
  const projectedTotal = budget.spentThisMonth + costUsd;
  const exceedsBudget = budget.monthlyBudgetUsd > 0 && projectedTotal > budget.monthlyBudgetUsd;

  // If exceeds budget, downgrade to local
  if (exceedsBudget && tier !== 'local') {
    const prevTier = tier;
    tier = 'local';
    reason += ` | Budget exceeded — downgraded from ${prevTier} to local. Projected $${projectedTotal.toFixed(4)} > $${budget.monthlyBudgetUsd.toFixed(2)} budget.`;
  }

  const model = TIER_DEFS[tier].models[0];

  return {
    tier,
    model,
    costUsd,
    complexity,
    privileged: forcedLocal,
    exceedsBudget,
    budgetRemaining: budget.monthlyBudgetUsd > 0 ? Math.max(0, budget.monthlyBudgetUsd - budget.spentThisMonth) : Infinity,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Five-Step Audit (stolen from AIOS)
// ---------------------------------------------------------------------------

/**
 * Stolen from AIOS: "We map what repeats in your week and score every task
 * on time, money and how buildable it is."
 *
 * Score a task on three axes to decide automation priority:
 *   - Time: how many minutes does the task take per occurrence?
 *   - Money: what's the opportunity cost / direct cost per occurrence?
 *   - Buildable: how easy is it to automate? (1-10, 10 = trivial)
 */
function auditTask(input) {
  const {
    title = '',
    minutes = 0,
    cost = 0,
    complexity = 5, // 1-10
    frequency = 'weekly',
  } = input;

  // Time score: higher = more time wasted
  let timeScore;
  if (minutes >= 60) timeScore = 10;
  else if (minutes >= 30) timeScore = 7;
  else if (minutes >= 15) timeScore = 5;
  else if (minutes >= 5) timeScore = 3;
  else timeScore = 1;

  // Frequency multiplier
  const freqMap = { daily: 7, weekly: 1, monthly: 0.2, quarterly: 0.07 };
  const freqMult = freqMap[frequency] || 1;

  // Money score
  let moneyScore;
  if (cost >= 100) moneyScore = 10;
  else if (cost >= 50) moneyScore = 7;
  else if (cost >= 20) moneyScore = 5;
  else if (cost >= 5) moneyScore = 3;
  else moneyScore = 1;

  // Buildable score: higher = easier to automate (1 = very hard, 10 = trivial)
  const buildableScore = Math.min(10, Math.max(1, complexity));

  // Composite priority score
  const priorityScore = ((timeScore * freqMult * 3) + (moneyScore * 2) + (11 - buildableScore) * 1);
  // Higher = more urgent to automate

  let recommendation;
  if (priorityScore >= 25) recommendation = 'automate_now';
  else if (priorityScore >= 15) recommendation = 'automate_next';
  else if (priorityScore >= 8) recommendation = 'plan_to_automate';
  else recommendation = 'keep_manual';

  return {
    title,
    scores: { time: timeScore, money: moneyScore, buildable: buildableScore, frequency },
    priorityScore: Number(priorityScore.toFixed(2)),
    recommendation,
    annualTimeWasteMinutes: minutes * freqMult * 52,
    annualCost: cost * freqMult * 52,
  };
}

// ---------------------------------------------------------------------------
// "What's Slipping" Dashboard
// ---------------------------------------------------------------------------

/**
 * Stolen from AIOS: "Every AIOS opens on one page.
 *   Who needs you, what happened overnight, what's slipping, and a box to ask anything."
 *
 * ThumbGate adaptation: aggregate operational awareness from local state.
 */
function getSlippingDashboard() {
  const dashboard = {
    timestamp: new Date().toISOString(),
    sections: [],
  };

  // 1. Who needs you — open PRs, pending reviews
  try {
    const { execSync } = require('node:child_process');
    const gitStatus = execSync('cd ' + PROJECT_ROOT + ' && git status --porcelain', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();

    const prOutput = execSync('gh pr list --state open --json number,title,updatedAt --limit 5', {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const needsYou = [];
    if (prOutput) {
      try {
        const prs = JSON.parse(prOutput);
        for (const pr of prs) {
          needsYou.push({
            type: 'pr',
            id: pr.number,
            title: pr.title,
            updatedAt: pr.updatedAt,
          });
        }
      } catch { /* ignore parse errors */ }
    }
    dashboard.sections.push({ name: 'who-needs-you', items: needsYou });
  } catch {
    dashboard.sections.push({ name: 'who-needs-you', items: [], error: 'git/gh unavailable' });
  }

  // 2. What's slipping — CI failures, blocked PRs
  try {
    const { execSync } = require('node:child_process');
    const checks = execSync(
      'gh api repos/{owner}/{repo}/commits/HEAD/check-runs --jq ".check_runs[] | select(.conclusion == \"failure\") | {name, conclusion}"',
      {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    ).trim();
    const slipping = [];
    if (checks) {
      try {
        const items = JSON.parse(checks);
        slipping.push(...items);
      } catch { /* ignore */ }
    }
    dashboard.sections.push({ name: 'what-is-slipping', items: slipping });
  } catch {
    dashboard.sections.push({ name: 'what-is-slipping', items: [], error: 'gh api unavailable' });
  }

  // 3. What ran overnight — budget spend, task outcomes
  const budget = loadBudget();
  dashboard.sections.push({
    name: 'overnight-activity',
    items: [
      { type: 'budget', spent: budget.spentThisMonth, budget: budget.monthlyBudgetUsd },
      { type: 'requests-this-month', count: budget.requests.length },
    ],
  });

  return dashboard;
}

// ---------------------------------------------------------------------------
// Escalation Router (stolen from NVIDIA NeMo Switchyard escalation router)
// ---------------------------------------------------------------------------

/**
 * Escalation router: tries cheaper tier first, escalates on quality failure.
 * Stolen from InfoWorld (Oct 2026) + NVIDIA NeMo Switchyard.
 */
async function routeWithEscalation(input) {
  const initial = routeTask(input);
  const chain = ['local', 'fastCloud', 'capable'];
  const idx = chain.indexOf(initial.tier);

  function escalate(reason) {
    if (initial.tier === 'local' || idx < 0 || idx + 1 >= chain.length) {
      return {
        tier: initial.tier, model: initial.model, costUsd: initial.costUsd,
        complexity: initial.complexity, escalated: false, escalationReason: null,
        reason: initial.reason,
      };
    }
    const nextTier = chain[idx + 1];
    const r = routeTask({ ...input, task: input.task, tokens: input.tokens });
    recordRoutingFailure({ task: input.task, failedTier: initial.tier, escalatedTo: nextTier, reason });
    return {
      tier: nextTier, model: r.model, costUsd: r.costUsd, complexity: r.complexity,
      escalated: true, escalationReason: `Escalated from ${initial.tier} to ${nextTier} (${reason})`,
      reason: r.reason,
    };
  }

  if (!input.qualityCheck || initial.tier === 'local' || idx < 0) {
    return {
      tier: initial.tier, model: initial.model, costUsd: initial.costUsd,
      complexity: initial.complexity, escalated: false, escalationReason: null,
      reason: initial.reason,
    };
  }

  try {
    const passed = await input.qualityCheck(initial.tier);
    if (!passed) return escalate('quality_check_failed');
  } catch (e) {
    return escalate(`quality_check_error: ${e.message}`);
  }

  return {
    tier: initial.tier, model: initial.model, costUsd: initial.costUsd,
    complexity: initial.complexity, escalated: false, escalationReason: null,
    reason: initial.reason,
  };
}

// ---------------------------------------------------------------------------
// Pareto Trap Monitoring (stolen from InfoWorld: "the Pareto trap")
// ---------------------------------------------------------------------------

/**
 * Pareto trap monitor: tracks routing failures to detect when cheaper models
 * are failing above threshold. Stolen from InfoWorld "the Pareto trap".
 */
const DEFAULT_FAILURE_LOG = path.join(os.homedir(), '.thumbgate', 'routing-failures.json');

function getFailureLogPath() {
  return DEFAULT_FAILURE_LOG;
}

function loadFailureLog() {
  const p = getFailureLogPath();
  if (!fs.existsSync(p)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function saveFailureLog(failures) {
  const p = getFailureLogPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(failures, null, 2));
}

function recordRoutingFailure(record) {
  const failures = loadFailureLog();
  failures.push({
    ...record,
    timestamp: new Date().toISOString(),
  });
  // Keep only last 1000 failures
  if (failures.length > 1000) {
    failures.splice(0, failures.length - 1000);
  }
  saveFailureLog(failures);
  return failures;
}

/**
 * Compute failure rate per tier over a time window.
 * @param {object} opts - { window: '24h'|'7d'|'30d'|'all' }
 * @returns {object} Failure rates and Pareto trap detection
 */
function getParetoTrapMetrics(opts = {}) {
  const window = opts.window || '7d';
  const failures = loadFailureLog();

  const now = Date.now();
  const windowMs = {
    '24h': 24 * 3600 * 1000,
    '7d': 7 * 24 * 3600 * 1000,
    '30d': 30 * 24 * 3600 * 1000,
    'all': Infinity,
  }[window] || Infinity;

  const recent = failures.filter((f) => now - new Date(f.timestamp).getTime() <= windowMs);

  // Count failures per tier by total attempts (from budget log)
  const budget = loadBudget();
  const tierAttempts = { local: 0, fastCloud: 0, capable: 0 };
  for (const req of budget.requests) {
    if (req.tier && tierAttempts.hasOwnProperty(req.tier)) {
      tierAttempts[req.tier]++;
    }
  }

  const tierFailures = { local: 0, fastCloud: 0, capable: 0 };
  for (const f of recent) {
    if (f.failedTier && tierFailures.hasOwnProperty(f.failedTier)) {
      tierFailures[f.failedTier]++;
    }
  }

  const tierFailureRates = {};
  let paretoTrapDetected = false;
  for (const tier of Object.keys(tierAttempts)) {
    const attempts = tierAttempts[tier] || 1; // avoid div by zero
    const failures = tierFailures[tier] || 0;
    const rate = (failures / attempts) * 100;
    tierFailureRates[tier] = Number(rate.toFixed(2));
    // Pareto trap: cheaper tiers failing more than 15%
    if (tier !== 'capable' && rate > 15) {
      paretoTrapDetected = true;
    }
  }

  return {
    window,
    totalFailures: recent.length,
    tierAttempts,
    tierFailures,
    tierFailureRates,
    paretoTrapDetected,
    recommendation: paretoTrapDetected
      ? 'Increase routing complexity threshold — cheaper models failing above 15%'
      : 'Routing thresholds appear healthy',
  };
}

// ---------------------------------------------------------------------------
// Session-Level Cost Tracking (stolen from Not Diamond Code session optimization)
// ---------------------------------------------------------------------------

/**
 * Session-level cost tracking with cache awareness.
 * Stolen from Not Diamond Code session optimization (InfoWorld Oct 2026).
 */
function getSessionCostPath() {
  return path.join(os.homedir(), '.thumbgate', 'session-cost-tracker.json');
}

function loadSessionCosts() {
  const p = getSessionCostPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function saveSessionCosts(sessions) {
  const p = getSessionCostPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(sessions, null, 2));
}

/**
 * Start/update a session tracker.
 * @param {string} sessionId
 * @param {object} opts - { cacheHits, cacheMisses, toolCalls, expectedDownstreamCost }
 */
function trackSessionCost(sessionId, opts = {}) {
  const sessions = loadSessionCosts();
  const now = Date.now();

  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      sessionId,
      startedAt: new Date(now).toISOString(),
      lastUpdated: new Date(now).toISOString(),
      totalCostUsd: 0,
      totalTokens: 0,
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      toolCalls: 0,
      expectedDownstreamCostUsd: 0,
      tierUsage: { local: 0, fastCloud: 0, capable: 0 },
    };
  }

  const session = sessions[sessionId];
  session.lastUpdated = new Date(now).toISOString();
  session.cacheHits = (session.cacheHits || 0) + (opts.cacheHits || 0);
  session.cacheMisses = (session.cacheMisses || 0) + (opts.cacheMisses || 0);
  session.toolCalls = (session.toolCalls || 0) + (opts.toolCalls || 0);
  session.expectedDownstreamCostUsd = (session.expectedDownstreamCostUsd || 0) + (opts.expectedDownstreamCost || 0);

  sessions[sessionId] = session;
  saveSessionCosts(sessions);
  return session;
}

/**
 * Record a routed request against a session.
 * @param {string} sessionId
 * @param {object} routingResult — output of routeTask()
 * @param {number} tokens
 */
function recordSessionRequest(sessionId, routingResult, tokens) {
  const sessions = loadSessionCosts();
  if (!sessions[sessionId]) {
    trackSessionCost(sessionId, {});
  }
  const session = sessions[sessionId];
  session.totalCostUsd = Number((session.totalCostUsd + (routingResult.costUsd || 0)).toFixed(6));
  session.totalTokens += tokens || 0;
  session.requests++;
  if (routingResult.tier && session.tierUsage.hasOwnProperty(routingResult.tier)) {
    session.tierUsage[routingResult.tier]++;
  }
  session.lastUpdated = new Date().toISOString();
  saveSessionCosts(sessions);
  return session;
}

/**
 * Get cache state summary for routing decisions.
 * High cache hit ratio → cheaper tiers viable.
 * Low cache hit ratio → consider capable tier for cache-warming.
 */
function getSessionCacheState(sessionId) {
  const sessions = loadSessionCosts();
  const session = sessions[sessionId];
  if (!session) return null;

  const totalAccesses = session.cacheHits + session.cacheMisses;
  const cacheHitRatio = totalAccesses > 0 ? session.cacheHits / totalAccesses : 0;

  return {
    cacheHitRatio: Number((cacheHitRatio * 100).toFixed(1)),
    cacheHits: session.cacheHits,
    cacheMisses: session.cacheMisses,
    costSaved: Number((session.cacheHits * 0.00015).toFixed(4)), // estimated at fastCloud rate
    recommendation:
      cacheHitRatio > 0.7
        ? 'Cache healthy — cheaper tiers are cost-effective for similar tasks'
        : cacheHitRatio > 0.4
        ? 'Moderate cache — monitor for efficiency improvements'
        : 'Low cache hit ratio — consider warming context or simplifying tasks',
  };
}

// ---------------------------------------------------------------------------
// Stage-Aware Routing (stolen from NVIDIA NeMo Switchyard stage router)
// ---------------------------------------------------------------------------

/**
 * Stage router: examines recent tool activity to decide capability needs.
 * Stolen from NVIDIA NeMo Switchyard stage router.
 */
function stageAwareRoute(input, sessionContext = {}) {
  const base = routeTask(input);

  if (sessionContext.recentToolCalls && sessionContext.recentToolCalls.length > 0) {
    const tools = sessionContext.recentToolCalls;
    const complexityScore = analyzeToolActivity(tools);

    // Escalate if tool activity is complex
    if (complexityScore >= 15 && base.tier !== 'capable') {
      const escalated = routeTask({ ...input, budgetUsd: input.budgetUsd });
      const escalationChain = ['local', 'fastCloud', 'capable'];
      const nextIdx = escalationChain.indexOf(base.tier) + 1;
      if (nextIdx < escalationChain.length) {
        const nextTier = escalationChain[nextIdx];
        const forcedResult = { ...escalated, tier: nextTier, escalated: true, escalationReason: `Stage-aware: tool activity score ${complexityScore} >= 15, escalated from ${base.tier} to ${nextTier}` };
        return {
          ...forcedResult,
          reason: base.reason + ` | Stage-aware: tool activity score ${complexityScore} > 15, escalated from ${base.tier} to ${nextTier}`,
        };
      }
    }

    // Downgrade if tool activity is simple
    if (complexityScore < 5 && base.tier === 'capable') {
      return {
        ...base,
        tier: 'fastCloud',
        reason: base.reason + ` | Stage-aware: tool activity simple (score ${complexityScore}), downgraded from capable to fastCloud`,
      };
    }

    // Inject cache state awareness
    if (sessionContext.sessionId) {
      const cacheState = getSessionCacheState(sessionContext.sessionId);
      if (cacheState && cacheState.cacheHitRatio > 70) {
        return {
          ...base,
          reason: base.reason + ` | Cache hit ratio ${cacheState.cacheHitRatio}% — cheaper tier viable`,
        };
      }
    }
  }

  return base;
}

/**
 * Analyze recent tool activity to compute a complexity score.
 * @param {Array} toolCalls — array of {name, args, result}
 * @returns {number} complexity score (0-50, higher = more complex)
 */
function analyzeToolActivity(toolCalls) {
  let score = 0;
  for (const call of toolCalls) {
    const name = (call.name || call.tool || '').toLowerCase();
    const args = call.args || call.arguments || {};

    // File system operations
    if (name.includes('shell') || name.includes('exec') || name.includes('bash')) {
      score += 2;
      const cmd = JSON.stringify(args || '').toLowerCase();
      if (cmd.includes('install') || cmd.includes('deploy') || cmd.includes('build')) {
        score += 5;
      }
    }
    if (name.includes('read') || name.includes('grep')) {
      score += 1;
    }
    if (name.includes('write') || name.includes('edit')) {
      score += 3;
      if (args.path && JSON.stringify(args).length > 500) {
        score += 3;
      }
    }

    // Network/API calls
    if (name.includes('curl') || name.includes('fetch') || name.includes('request')) {
      score += 2;
    }

    // Model calls
    if (name.includes('model') || name.includes('llm') || name.includes('ask')) {
      score += 4;
    }

    // Tool calls with large arguments
    const argStr = JSON.stringify(args || '').length;
    if (argStr > 10000) score += 5;
    if (argStr > 50000) score += 10;
  }

  // Factor in number of tool calls (more = more complex session)
  if (toolCalls.length > 10) score += 5;
  if (toolCalls.length > 20) score += 10;

  return Math.min(50, score);
}

// ---------------------------------------------------------------------------
// Quality Evaluation (stolen from InfoWorld: "quality evaluation overhead")
// ---------------------------------------------------------------------------

/**
 * Quality evaluation: tracks routing effectiveness and Pareto trap risk.
 * Stolen from InfoWorld: "quality evaluation overhead and human review are
 * indirect costs to track."
 */
function evaluateRoutingQuality(opts = {}) {
  const failures = loadFailureLog();
  const window = opts.window || '7d';
  const now = Date.now();
  const windowMs = {
    '24h': 24 * 3600 * 1000,
    '7d': 7 * 24 * 3600 * 1000,
    '30d': 30 * 24 * 3600 * 1000,
    'all': Infinity,
  }[window] || Infinity;

  const recent = failures.filter((f) => now - new Date(f.timestamp).getTime() <= windowMs);

  const byTierAndReason = {};
  for (const f of recent) {
    const key = `${f.failedTier || 'unknown'}:${f.reason || 'unknown'}`;
    if (!byTierAndReason[key]) byTierAndReason[key] = 0;
    byTierAndReason[key]++;
  }

  return {
    window,
    totalRoutingFailures: recent.length,
    failuresByTierAndReason: byTierAndReason,
    paretoTrap: getParetoTrapMetrics({ window }),
    qualityScore: recent.length === 0 ? 100 : Math.max(0, 100 - (recent.length / 10)),
    recommendation: recent.length === 0
      ? 'No routing failures detected — routing model is well-calibrated'
      : `Review routing decisions: ${recent.length} failures in ${window} window`,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  switch (command) {
    case 'route': {
      const input = {
        task: args.task || '',
        tokens: parseInt(args.tokens || '1000', 10),
        privileged: args.privileged === true,
      };
      const budget = loadBudget();
      if (budget.monthlyBudgetUsd > 0 && args['budget-override']) {
        input.budgetUsd = parseFloat(args['budget-override']);
      }
      console.log(JSON.stringify(routeTask(input), null, 2));
      break;
    }

    case 'audit-task': {
      const result = auditTask({
        title: args.title || '',
        minutes: parseInt(args.minutes || '0', 10),
        cost: parseFloat(args.cost || '0'),
        complexity: parseInt(args.complexity || '5', 10),
        frequency: args.frequency || 'weekly',
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'status': {
      const budget = loadBudget();
      console.log(JSON.stringify({
        monthlyBudgetUsd: budget.monthlyBudgetUsd,
        spentThisMonth: Number(budget.spentThisMonth.toFixed(4)),
        remaining: budget.monthlyBudgetUsd > 0
          ? Number((budget.monthlyBudgetUsd - budget.spentThisMonth).toFixed(4))
          : Infinity,
        requestCount: budget.requests.length,
        month: budget.month,
        tiers: TIER_DEFS,
      }, null, 2));
      break;
    }

    case 'set-budget': {
      const budget = loadBudget();
      budget.monthlyBudgetUsd = parseFloat(args.monthly || '5000');
      saveBudget(budget);
      console.log(JSON.stringify({ ok: true, monthlyBudgetUsd: budget.monthlyBudgetUsd }, null, 2));
      break;
    }

    case 'dashboard': {
      console.log(JSON.stringify(getSlippingDashboard(), null, 2));
      break;
    }

    case 'log-request': {
      const budget = loadBudget();
      const costUsd = parseFloat(args.cost || '0');
      recordRequest(budget, {
        task: args.task || '',
        tier: args.tier || 'local',
        costUsd,
        tokens: parseInt(args.tokens || '0', 10),
      });
      console.log(JSON.stringify({ ok: true, spentThisMonth: budget.spentThisMonth }, null, 2));
      break;
    }

    case 'route-with-escalation': {
      const input = {
        task: args.task || '',
        tokens: parseInt(args.tokens || '1000', 10),
        privileged: args.privileged === true,
      };
      routeWithEscalation(input).then((result) => {
        console.log(JSON.stringify(result, null, 2));
      }).catch((err) => {
        console.error('Error:', err.message);
        process.exitCode = 1;
      });
      break;
    }

    case 'pareto-trap': {
      console.log(JSON.stringify(getParetoTrapMetrics({ window: args.window || '7d' }), null, 2));
      break;
    }

    case 'session-cost': {
      const sessionId = args['session-id'] || 'default';
      const session = trackSessionCost(sessionId, {
        cacheHits: parseInt(args['cache-hits'] || '0', 10),
        cacheMisses: parseInt(args['cache-misses'] || '0', 10),
        toolCalls: parseInt(args['tool-calls'] || '0', 10),
        expectedDownstreamCost: parseFloat(args['expected-cost'] || '0'),
      });
      console.log(JSON.stringify(session, null, 2));
      break;
    }

    case 'session-cache': {
      const sessionId = args['session-id'] || 'default';
      const cache = getSessionCacheState(sessionId);
      console.log(JSON.stringify(cache, null, 2));
      break;
    }

    case 'routing-quality': {
      console.log(JSON.stringify(
        evaluateRoutingQuality({ window: args.window || '7d' }), null, 2
      ));
      break;
    }

    case 'record-failure': {
      recordRoutingFailure({
        task: args.task || '',
        failedTier: args['failed-tier'] || 'fastCloud',
        escalatedTo: args['escalated-to'] || 'capable',
        reason: args.reason || 'quality_check_failed',
      });
      console.log(JSON.stringify({ ok: true, message: 'Failure recorded for Pareto trap monitoring' }, null, 2));
      break;
    }

    default:
      console.error([
        'Usage:',
        '  node scripts/cost-router.js route --task "..." [--tokens 1500] [--privileged]',
        '  node scripts/cost-router.js route-with-escalation --task "..." [--tokens 1500] [--privileged]',
        '  node scripts/cost-router.js audit-task --title "..." --minutes 30 --cost 0 --complexity 5 --frequency weekly',
        '  node scripts/cost-router.js status',
        '  node scripts/cost-router.js set-budget --monthly 5000',
        '  node scripts/cost-router.js dashboard',
        '  node scripts/cost-router.js log-request --task "..." --tier local --cost 0.01 --tokens 1000',
        '  node scripts/cost-router.js pareto-trap [--window 7d]',
        '  node scripts/cost-router.js session-cost --session-id <id> [--cache-hits 10] [--cache-misses 5] [--tool-calls 3] [--expected-cost 0.5]',
        '  node scripts/cost-router.js session-cache --session-id <id>',
        '  node scripts/cost-router.js routing-quality [--window 7d]',
        '  node scripts/cost-router.js record-failure --task "..." --failed-tier fastCloud --escalated-to capable --reason quality_check_failed',
      ].join('\n'));
      process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  routeTask,
  routeWithEscalation,
  auditTask,
  getSlippingDashboard,
  loadBudget,
  saveBudget,
  recordRequest,
  classifyComplexity,
  isPrivileged,
  TIER_DEFS,
  // Escalation + Pareto trap
  recordRoutingFailure,
  getParetoTrapMetrics,
  // Session-level cost tracking
  trackSessionCost,
  recordSessionRequest,
  getSessionCacheState,
  loadSessionCosts,
  saveSessionCosts,
  // Stage-aware routing
  stageAwareRoute,
  analyzeToolActivity,
  // Quality evaluation
  evaluateRoutingQuality,
};
