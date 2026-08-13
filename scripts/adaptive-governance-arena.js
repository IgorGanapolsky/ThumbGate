#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildRewardHackingGuardrailsPlan } = require('./reward-hacking-guardrails');

const ROOT = path.join(__dirname, '..');
const DEFAULT_ARENA_PATH = path.join(ROOT, 'bench', 'adaptive-governance-arena.json');
const GENESIS_HASH = '0'.repeat(64);
const ACTIONS = new Set(['allow', 'deny', 'review']);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function loadArena(filePath = DEFAULT_ARENA_PATH) {
  const arena = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assertObject(arena, 'Arena');
  if (!Array.isArray(arena.levels) || arena.levels.length === 0) {
    throw new Error('Arena must define a non-empty levels array');
  }

  const levelIds = new Set();
  const scenarioIds = new Set();
  let previousDifficulty = 0;
  const levels = arena.levels.map((level, levelIndex) => {
    assertObject(level, `Level ${levelIndex + 1}`);
    if (!level.id || levelIds.has(level.id)) throw new Error(`Level ${levelIndex + 1} must have a unique id`);
    levelIds.add(level.id);
    if (!Number.isInteger(level.difficulty) || level.difficulty <= previousDifficulty) {
      throw new Error(`Level ${level.id} difficulty must increase monotonically`);
    }
    previousDifficulty = level.difficulty;
    if (!Array.isArray(level.scenarios) || level.scenarios.length === 0) {
      throw new Error(`Level ${level.id} must define scenarios`);
    }

    return {
      ...level,
      scenarios: level.scenarios.map((scenario, scenarioIndex) => {
        assertObject(scenario, `Scenario ${level.id}/${scenarioIndex + 1}`);
        if (!scenario.id || scenarioIds.has(scenario.id)) {
          throw new Error(`Scenario ${level.id}/${scenarioIndex + 1} must have a globally unique id`);
        }
        scenarioIds.add(scenario.id);
        if (!ACTIONS.has(scenario.expectedAction)) {
          throw new Error(`Scenario ${scenario.id} has invalid expectedAction`);
        }
        assertObject(scenario.context, `Scenario ${scenario.id} context`);
        return scenario;
      }),
    };
  });

  return {
    version: arena.version || 1,
    name: arena.name || 'ThumbGate Adaptive Governance Arena',
    seed: String(arena.seed || 'thumbgate-arena-v1'),
    sourcePath: filePath,
    levels,
  };
}

function evaluatePolicy(scenario) {
  const context = scenario.context;
  const reasons = [];
  let action = 'allow';

  if (context.environment === 'live' && context.marketAction) {
    action = 'deny';
    reasons.push('live_market_boundary');
  }
  if (context.dynamicToolCreation && !context.toolApproved) {
    action = 'deny';
    reasons.push('unapproved_dynamic_tool');
  }
  if (context.sensitiveData && context.hybridRoute === 'cloud') {
    action = 'deny';
    reasons.push('sensitive_cloud_route');
  }
  if (context.agentIdentity && context.credentialOwner
    && context.agentIdentity === context.credentialOwner) {
    action = 'deny';
    reasons.push('identity_separation_required');
  }
  if (Number.isFinite(context.estimatedCostUsd)
    && Number.isFinite(context.budgetLimitUsd)
    && context.estimatedCostUsd > context.budgetLimitUsd) {
    action = 'deny';
    reasons.push('budget_exceeded');
  }
  if (context.irreversible && !context.approvalReceipt) {
    if (action === 'allow') action = 'review';
    reasons.push('approval_receipt_required');
  }

  const rewardPlan = buildRewardHackingGuardrailsPlan({
    workflow: scenario.id,
    text: context.candidateText || '',
    evidence: context.evidence || [],
    metrics: context.metrics || [],
    hasHoldout: context.hasHoldout,
    hasHumanObjective: context.hasHumanObjective,
    optimizedForScore: context.optimizedForScore,
  });
  if (rewardPlan.status === 'blocked') {
    action = 'deny';
    reasons.push(...rewardPlan.signals.map((signal) => signal.id));
  } else if (rewardPlan.status === 'needs_evidence' && action === 'allow') {
    action = 'review';
    reasons.push(...rewardPlan.signals.map((signal) => signal.id));
  }

  return {
    action,
    reasons: [...new Set(reasons)].sort((left, right) => left.localeCompare(right)),
    rewardHackingStatus: rewardPlan.status,
    rewardSignals: rewardPlan.signals.map((signal) => signal.id).sort(),
  };
}

function createReceipt(previousHash, arena, level, scenario, decision) {
  const body = {
    arena: arena.name,
    arenaVersion: arena.version,
    seed: arena.seed,
    levelId: level.id,
    difficulty: level.difficulty,
    scenarioId: scenario.id,
    expectedAction: scenario.expectedAction,
    actualAction: decision.action,
    passed: decision.action === scenario.expectedAction,
    reasons: decision.reasons,
    previousHash,
  };
  return { ...body, hash: sha256(stableStringify(body)) };
}

function runArenaPass(arena) {
  const receipts = [];
  const levels = [];
  let previousHash = GENESIS_HASH;
  let curriculumOpen = true;

  for (const level of arena.levels) {
    if (!curriculumOpen) {
      levels.push({
        id: level.id,
        difficulty: level.difficulty,
        status: 'locked',
        passed: false,
        scenarios: [],
      });
      continue;
    }

    const scenarios = level.scenarios.map((scenario) => {
      const decision = evaluatePolicy(scenario);
      const receipt = createReceipt(previousHash, arena, level, scenario, decision);
      previousHash = receipt.hash;
      receipts.push(receipt);
      return {
        id: scenario.id,
        intent: scenario.intent,
        expectedAction: scenario.expectedAction,
        actualAction: decision.action,
        reasons: decision.reasons,
        rewardHackingStatus: decision.rewardHackingStatus,
        passed: decision.action === scenario.expectedAction,
        receiptHash: receipt.hash,
      };
    });
    const passed = scenarios.every((scenario) => scenario.passed);
    levels.push({
      id: level.id,
      difficulty: level.difficulty,
      status: passed ? 'passed' : 'failed',
      passed,
      scenarios,
    });
    curriculumOpen = passed;
  }

  return {
    arena: arena.name,
    version: arena.version,
    seed: arena.seed,
    passed: levels.every((level) => level.passed),
    highestPassedDifficulty: Math.max(0, ...levels.filter((level) => level.passed).map((level) => level.difficulty)),
    levels,
    receipts,
    receiptChainHead: previousHash,
  };
}

function verifyReceiptChain(report) {
  const scenarioResults = new Map();
  for (const level of report.levels || []) {
    for (const scenario of level.scenarios || []) {
      scenarioResults.set(scenario.id, scenario);
    }
  }
  let previousHash = GENESIS_HASH;
  for (const receipt of report.receipts || []) {
    const { hash, ...body } = receipt;
    if (body.previousHash !== previousHash) return false;
    if (sha256(stableStringify(body)) !== hash) return false;
    const result = scenarioResults.get(body.scenarioId);
    if (!result
      || result.receiptHash !== hash
      || result.expectedAction !== body.expectedAction
      || result.actualAction !== body.actualAction
      || result.passed !== body.passed
      || stableStringify(result.reasons) !== stableStringify(body.reasons)) {
      return false;
    }
    scenarioResults.delete(body.scenarioId);
    previousHash = hash;
  }
  return scenarioResults.size === 0 && previousHash === report.receiptChainHead;
}

function buildDpoCandidates(report, arena) {
  const scenarios = new Map();
  for (const level of arena.levels) {
    for (const scenario of level.scenarios) scenarios.set(scenario.id, scenario);
  }
  return report.levels.flatMap((level) => level.scenarios)
    .filter((result) => !result.passed)
    .filter((result) => {
      const scenario = scenarios.get(result.id);
      return Boolean(scenario && scenario.preferredResponse && scenario.rejectedResponse);
    })
    .map((result) => {
      const scenario = scenarios.get(result.id);
      return {
        prompt: scenario.context.candidateText || scenario.intent,
        chosen: scenario.preferredResponse,
        rejected: scenario.rejectedResponse,
        metadata: {
          arena: report.arena,
          scenarioId: result.id,
          difficulty: levelDifficulty(report, result.id),
          expectedAction: result.expectedAction,
          actualAction: result.actualAction,
          receiptHash: result.receiptHash,
        },
      };
    });
}

function levelDifficulty(report, scenarioId) {
  const level = report.levels.find((candidate) => candidate.scenarios.some((scenario) => scenario.id === scenarioId));
  return level ? level.difficulty : null;
}

function replayArena(arena) {
  const first = runArenaPass(arena);
  const second = runArenaPass(arena);
  return {
    stable: stableStringify(first) === stableStringify(second),
    first,
    second,
  };
}

function summarize(report) {
  const scenarios = report.levels.flatMap((level) => level.scenarios);
  const passed = scenarios.filter((scenario) => scenario.passed).length;
  return {
    scenarioCount: scenarios.length,
    passedScenarioCount: passed,
    passRate: scenarios.length ? passed / scenarios.length : 0,
    highestPassedDifficulty: report.highestPassedDifficulty,
    receiptChainValid: verifyReceiptChain(report),
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = { arenaPath: DEFAULT_ARENA_PATH, json: false, outPath: null };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg.startsWith('--arena=')) options.arenaPath = path.resolve(arg.slice('--arena='.length));
    else if (arg.startsWith('--out=')) options.outPath = path.resolve(arg.slice('--out='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const arena = loadArena(options.arenaPath);
  const replay = replayArena(arena);
  const report = {
    ...replay.first,
    replayStable: replay.stable,
    metrics: summarize(replay.first),
    dpoCandidates: buildDpoCandidates(replay.first, arena),
  };
  if (options.outPath) {
    fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
    fs.writeFileSync(options.outPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Adaptive Governance Arena: ${report.passed ? 'PASS' : 'FAIL'}`);
    console.log(`Scenarios: ${report.metrics.passedScenarioCount}/${report.metrics.scenarioCount}`);
    console.log(`Highest difficulty: ${report.metrics.highestPassedDifficulty}`);
    console.log(`Replay stable: ${report.replayStable}`);
    console.log(`Receipt chain valid: ${report.metrics.receiptChainValid}`);
  }
  if (!report.passed || !report.replayStable || !report.metrics.receiptChainValid) process.exitCode = 1;
  return report;
}

module.exports = {
  DEFAULT_ARENA_PATH,
  GENESIS_HASH,
  buildDpoCandidates,
  createReceipt,
  evaluatePolicy,
  loadArena,
  replayArena,
  runArenaPass,
  stableStringify,
  summarize,
  verifyReceiptChain,
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main();
