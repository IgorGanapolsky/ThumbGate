'use strict';

const { spawnSync } = require('node:child_process');

const {
  createExperiment,
  recordResult,
} = require('./experiment-tracker');
const { analyzeFeedback } = require('./feedback-loop');
const {
  applyAcceptedMutation,
  getEffectiveSetting,
  getEvolutionPaths,
  readEvolutionState,
  restoreEvolutionSnapshot,
  withTemporaryEvolutionSettings,
} = require('./evolution-state');

const DEFAULT_TIMEOUT_MS = 120000;

const EVOLUTION_TARGETS = Object.freeze([
  {
    name: 'half_life_days',
    settingKey: 'half_life_days',
    range: [3, 14],
    step: 1,
    type: 'threshold',
    hypothesis: 'Tune recency weighting so reliable patterns stick without overfitting stale feedback.',
  },
  {
    name: 'decay_floor',
    settingKey: 'decay_floor',
    range: [0.001, 0.1],
    step: 0.01,
    type: 'threshold',
    hypothesis: 'Adjust the long-tail feedback floor so old failures still influence gates without dominating them.',
  },
  {
    name: 'prevention_min_occurrences',
    settingKey: 'prevention_min_occurrences',
    range: [1, 5],
    step: 1,
    type: 'config',
    hypothesis: 'Tune prevention rule promotion so gates appear early enough without promoting noise.',
  },
  {
    name: 'verification_max_retries',
    settingKey: 'verification_max_retries',
    range: [1, 5],
    step: 1,
    type: 'threshold',
    hypothesis: 'Adjust verification retries so the runtime self-corrects without masking recurring failures.',
  },
  {
    name: 'dpo_beta',
    settingKey: 'dpo_beta',
    range: [0.01, 0.5],
    step: 0.05,
    type: 'threshold',
    hypothesis: 'Tune DPO preference sharpness so preference updates remain stable under noisy feedback.',
  },
]);

function getApprovalRate() {
  try {
    const stats = analyzeFeedback();
    return typeof stats.approvalRate === 'number' ? stats.approvalRate : 0.5;
  } catch {
    return 0.5;
  }
}

function normalizeCommands(commands, fallback = []) {
  if (typeof commands === 'string') {
    return commands.trim() ? [commands.trim()] : fallback;
  }

  if (Array.isArray(commands)) {
    const normalized = commands
      .map((command) => typeof command === 'string' ? command.trim() : '')
      .filter(Boolean);
    return normalized.length > 0 ? normalized : fallback;
  }

  return fallback;
}

function parseCommandScore(output = '', status = 0, approvalRate = 0.5) {
  const totalMatch = output.match(/ℹ tests (\d+)/);
  const passMatch = output.match(/ℹ pass (\d+)/);
  const failMatch = output.match(/ℹ fail (\d+)/);

  const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
  const pass = passMatch ? parseInt(passMatch[1], 10) : 0;
  const fail = failMatch ? parseInt(failMatch[1], 10) : 0;
  const testPassRate = total > 0 ? pass / total : (status === 0 && output.trim() ? 1 : 0);
  const score = Math.round(testPassRate * (0.8 + 0.2 * approvalRate) * 10000) / 10000;

  return {
    score,
    testPassRate,
    details: {
      total,
      pass,
      fail,
      approvalRate,
    },
  };
}

function runCommand(command, {
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, [], {
    shell: true,
    cwd,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const status = typeof result.status === 'number'
    ? result.status
    : result.error ? 1 : 0;

  return {
    command,
    status,
    stdout,
    stderr,
    passed: status === 0,
    durationMs: Date.now() - startedAt,
    error: result.error ? result.error.message : null,
  };
}

function evaluateCommandSet(commands, options = {}) {
  const approvalRate = getApprovalRate();
  const results = commands.map((command) => {
    const execution = runCommand(command, options);
    const scored = parseCommandScore(`${execution.stdout}\n${execution.stderr}`.trim(), execution.status, approvalRate);

    return {
      ...execution,
      score: scored.score,
      testPassRate: scored.testPassRate,
      details: scored.details,
    };
  });

  const passed = results.every((result) => result.passed);
  const averageScore = results.length > 0
    ? Math.round((results.reduce((sum, result) => sum + result.score, 0) / results.length) * 10000) / 10000
    : 0;

  return {
    passed,
    averageScore,
    approvalRate,
    results,
  };
}

function evaluateWorkspace({
  primaryCommands,
  holdoutCommands = [],
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const primary = evaluateCommandSet(primaryCommands, { cwd, env, timeoutMs });
  const holdout = evaluateCommandSet(holdoutCommands, { cwd, env, timeoutMs });
  const holdoutWeight = holdoutCommands.length > 0 ? 0.3 : 0;
  const primaryWeight = holdoutCommands.length > 0 ? 0.7 : 1;
  const score = Math.round(((primary.averageScore * primaryWeight) + (holdout.averageScore * holdoutWeight)) * 10000) / 10000;

  return {
    score,
    passed: primary.passed && holdout.passed,
    primary,
    holdout,
  };
}

function chooseNextValue(target, currentValue, requestedValue = undefined) {
  if (Number.isFinite(requestedValue)) {
    return Math.max(target.range[0], Math.min(target.range[1], requestedValue));
  }

  const direction = Math.random() >= 0.5 ? 1 : -1;
  const candidate = currentValue + (direction * target.step);
  const bounded = Math.max(target.range[0], Math.min(target.range[1], candidate));
  return typeof target.step === 'number' && Number.isInteger(target.step)
    ? Math.round(bounded)
    : Math.round(bounded * 1000) / 1000;
}

function recommendEvolutionTarget({ failureType, tags = [] } = {}) {
  if (failureType === 'verification') {
    return tags.includes('security') || tags.includes('billing')
      ? 'prevention_min_occurrences'
      : 'verification_max_retries';
  }

  if (failureType === 'execution') {
    return tags.includes('testing') ? 'verification_max_retries' : 'half_life_days';
  }

  return 'half_life_days';
}

function runWorkspaceEvolution(opts = {}) {
  const target = opts.targetName
    ? EVOLUTION_TARGETS.find((entry) => entry.name === opts.targetName)
    : EVOLUTION_TARGETS[Math.floor(Math.random() * EVOLUTION_TARGETS.length)];

  if (!target) {
    throw new Error(`Unknown evolution target: ${opts.targetName}`);
  }

  const primaryCommands = normalizeCommands(opts.primaryCommands || opts.testCommand, ['npm test']);
  const holdoutCommands = normalizeCommands(opts.holdoutCommands, []);
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const feedbackDir = opts.feedbackDir;
  const currentValue = getEffectiveSetting(target.settingKey, target.range[0], feedbackDir);
  const nextValue = chooseNextValue(target, currentValue, opts.nextValue);

  if (nextValue === currentValue) {
    return {
      skipped: true,
      reason: `Evolution target ${target.name} produced a no-op mutation`,
      target,
      currentValue,
      nextValue,
    };
  }

  const experiment = createExperiment({
    name: `${target.name}: ${currentValue} → ${nextValue}`,
    hypothesis: [
      target.hypothesis,
      `Primary: ${primaryCommands.join(' && ')}`,
      holdoutCommands.length > 0 ? `Holdout: ${holdoutCommands.join(' && ')}` : null,
      typeof opts.hypothesisSuffix === 'string' && opts.hypothesisSuffix.trim() ? opts.hypothesisSuffix.trim() : null,
    ].filter(Boolean).join(' '),
    mutationType: target.type,
    mutation: {
      target: target.name,
      settingKey: target.settingKey,
      from: currentValue,
      to: nextValue,
      primaryCommands,
      holdoutCommands,
    },
  });

  const evaluationOptions = {
    primaryCommands,
    holdoutCommands,
    cwd: opts.cwd || process.cwd(),
    env: opts.env || process.env,
    timeoutMs,
  };
  const baselineEvaluation = evaluateWorkspace(evaluationOptions);
  const candidateEvaluation = withTemporaryEvolutionSettings({
    [target.settingKey]: nextValue,
  }, () => evaluateWorkspace(evaluationOptions), feedbackDir);

  const kept = candidateEvaluation.passed && candidateEvaluation.score > baselineEvaluation.score;
  const acceptedMutation = kept
    ? applyAcceptedMutation({
      targetKey: target.settingKey,
      nextValue,
      experimentId: experiment.id,
      summary: target.hypothesis,
      metrics: {
        baselineScore: baselineEvaluation.score,
        candidateScore: candidateEvaluation.score,
        primaryCommands,
        holdoutCommands,
      },
    }, feedbackDir)
    : null;

  const result = recordResult({
    experimentId: experiment.id,
    score: candidateEvaluation.score,
    baseline: baselineEvaluation.score,
    testsPassed: candidateEvaluation.passed,
    metrics: {
      target: target.name,
      settingKey: target.settingKey,
      from: currentValue,
      to: nextValue,
      primaryCommands,
      holdoutCommands,
      baselineEvaluation,
      candidateEvaluation,
      evolutionStatePath: getEvolutionPaths(feedbackDir).statePath,
      rollbackSnapshotId: acceptedMutation ? acceptedMutation.rollbackSnapshot.snapshotId : null,
      ...(opts.additionalMetrics || {}),
    },
  });

  return {
    ...result,
    target,
    currentValue,
    nextValue,
    kept,
    baselineEvaluation,
    candidateEvaluation,
    acceptedMutation,
    evolutionState: readEvolutionState(feedbackDir),
  };
}

function restoreWorkspaceEvolution(snapshotId, feedbackDir) {
  return restoreEvolutionSnapshot(snapshotId, feedbackDir);
}

if (require.main === module) {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length > 0 ? rest.join('=') : true;
  });

  try {
    if (args.restore) {
      console.log(JSON.stringify(restoreWorkspaceEvolution(args.restore), null, 2));
      process.exit(0);
    }

    if (args.run) {
      const result = runWorkspaceEvolution({
        targetName: typeof args.target === 'string' ? args.target : undefined,
        nextValue: args.value !== true ? Number(args.value) : undefined,
        testCommand: typeof args.primary === 'string' ? args.primary : undefined,
        holdoutCommands: typeof args.holdout === 'string' ? [args.holdout] : [],
        timeoutMs: args.timeout !== true ? Number(args.timeout) : undefined,
      });
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    console.log(`Usage:
  node scripts/workspace-evolver.js --run [--target=half_life_days] [--primary="npm test"] [--holdout="npm run self-heal:check"]
  node scripts/workspace-evolver.js --restore=<snapshotId>`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  EVOLUTION_TARGETS,
  evaluateWorkspace,
  getApprovalRate,
  normalizeCommands,
  parseCommandScore,
  recommendEvolutionTarget,
  restoreWorkspaceEvolution,
  runCommand,
  runWorkspaceEvolution,
};
