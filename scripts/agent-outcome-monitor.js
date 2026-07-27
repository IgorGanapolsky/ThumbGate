#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { calculateTaskOutcomeMetrics, readTaskOutcomes } = require('./task-outcomes');

const DEFAULT_THRESHOLDS = path.join(__dirname, '..', 'config', 'agent-outcome-monitor-thresholds.json');
const DEFAULT_HOSTED_ORIGIN = 'https://thumbgate-production.up.railway.app';
const DEFAULT_MONITOR_PATH = '/v1/task-outcomes/monitor';
const DEFAULT_SCHEDULE_ID = 'thumbgate-agent-outcome-monitor';

function monitorTaskOutcomes(outcomes = [], options = {}) {
  const metrics = calculateTaskOutcomeMetrics(outcomes);
  const thresholds = options.thresholds || JSON.parse(fs.readFileSync(
    path.resolve(options.thresholdsPath || DEFAULT_THRESHOLDS),
    'utf8',
  ));
  const minimumSamples = Number(thresholds.minimumSamples || 1);
  if (metrics.sampleSize < minimumSamples) {
    return {
      generatedAt: new Date().toISOString(),
      verdict: 'insufficient_evidence',
      sampleSize: metrics.sampleSize,
      minimumSamples,
      alerts: [{
        id: 'minimum-samples',
        severity: 'block',
        message: `Need ${minimumSamples} task outcomes; observed ${metrics.sampleSize}.`,
      }],
      metrics,
    };
  }

  const values = flattenMetricValues(metrics);
  const alerts = [];
  for (const [id, rule] of Object.entries(thresholds)) {
    if (id === 'minimumSamples') continue;
    const actual = values[id];
    if (actual === null || actual === undefined) {
      alerts.push({
        id: `${id}-missing`,
        severity: rule.severity || 'warn',
        message: `${id} has no measured denominator.`,
      });
      continue;
    }
    if (!passesRule(actual, rule)) {
      alerts.push({
        id: `${id}-threshold`,
        severity: rule.severity || 'warn',
        actual,
        expected: `${rule.operator} ${rule.value}`,
        message: `${id}=${actual} violates ${rule.operator} ${rule.value}.`,
      });
    }
  }
  let verdict = 'healthy';
  if (alerts.some((alert) => alert.severity === 'block')) {
    verdict = 'blocked';
  } else if (alerts.length > 0) {
    verdict = 'watch';
  }
  return {
    generatedAt: new Date().toISOString(),
    verdict,
    sampleSize: metrics.sampleSize,
    minimumSamples,
    alerts,
    metrics,
  };
}

function flattenMetricValues(metrics) {
  return {
    verifiedCompletionRate: metrics.task.verifiedCompletionRate,
    evidenceBackedCompletionRate: metrics.task.evidenceBackedCompletionRate,
    unsupportedClaimRate: metrics.task.unsupportedClaimRate,
    toolContractAccuracy: metrics.tools.contractAccuracy,
    duplicateSideEffectRate: metrics.tools.duplicateSideEffectRate,
    unsafeEscapeRate: metrics.safety.unsafeEscapeRate,
    safeFalseBlockRate: metrics.safety.safeFalseBlockRate,
    correctEscalationRate: metrics.escalation.correctEscalationRate,
    latencyP95Ms: metrics.efficiency.latencyP95Ms,
  };
}

function passesRule(actual, rule) {
  if (rule.operator === 'gte') return actual >= Number(rule.value);
  if (rule.operator === 'lte') return actual <= Number(rule.value);
  if (rule.operator === 'gt') return actual > Number(rule.value);
  if (rule.operator === 'lt') return actual < Number(rule.value);
  if (rule.operator === 'eq') return actual === Number(rule.value);
  throw new Error(`Unsupported threshold operator '${rule.operator}'`);
}

function isCliInvocation() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
}

function parseArgs(argv = []) {
  return {
    hosted: argv.includes('--hosted'),
    installSchedule: argv.includes('--install-schedule'),
    inputPath: valueForArg(argv, '--input='),
    thresholdsPath: valueForArg(argv, '--thresholds='),
    outputPath: valueForArg(argv, '--output='),
    baseUrl: valueForArg(argv, '--base-url='),
    workingDirectory: valueForArg(argv, '--working-directory='),
  };
}

function valueForArg(argv, prefix) {
  const value = argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}

async function fetchHostedMonitor(options = {}) {
  const env = options.env || process.env;
  const { loadObservabilityEnv } = require('./observability-env');
  loadObservabilityEnv({
    env,
    operatorPath: options.operatorPath,
    observabilityPath: options.observabilityPath,
    applyStripeManagedFiles: false,
  });

  const apiKey = String(env.THUMBGATE_OPERATOR_KEY || env.THUMBGATE_API_KEY || '').trim();
  if (!apiKey) {
    return {
      generatedAt: new Date().toISOString(),
      verdict: 'not_configured',
      source: 'hosted',
      reason: 'operator_authentication_unavailable',
    };
  }

  const baseUrl = options.baseUrl
    || env.THUMBGATE_BILLING_API_BASE_URL
    || DEFAULT_HOSTED_ORIGIN;
  const url = new URL(DEFAULT_MONITOR_PATH, baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 15000));
  try {
    const response = await (options.fetchImpl || globalThis.fetch)(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        generatedAt: new Date().toISOString(),
        verdict: 'unavailable',
        source: 'hosted',
        httpStatus: response.status,
        reason: 'hosted_monitor_http_error',
      };
    }
    const report = await response.json();
    return {
      ...report,
      source: 'hosted',
    };
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      verdict: 'unavailable',
      source: 'hosted',
      reason: error?.name === 'AbortError' ? 'hosted_monitor_timeout' : 'hosted_monitor_request_failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildAgentOutcomeMonitorSchedule(options = {}) {
  const workingDirectory = path.resolve(options.workingDirectory || process.cwd());
  const outputPath = path.resolve(
    options.outputPath
      || path.join(os.homedir(), '.thumbgate', 'reports', 'agent-outcome-monitor.json'),
  );
  const args = [
    __filename,
    '--hosted',
    `--output=${outputPath}`,
  ];
  if (options.baseUrl) args.push(`--base-url=${options.baseUrl}`);
  const command = [
    'const { spawnSync } = require(\'node:child_process\');',
    `const result = spawnSync(process.execPath, ${JSON.stringify(args)}, {`,
    `  cwd: ${JSON.stringify(workingDirectory)},`,
    '  env: process.env,',
    '  stdio: \'inherit\',',
    '});',
    'if (result.error) throw result.error;',
    'process.exit(typeof result.status === \'number\' ? result.status : 1);',
  ].join(' ');
  return {
    id: DEFAULT_SCHEDULE_ID,
    name: 'ThumbGate Agent Outcome Monitor',
    description: 'Checks hosted task outcomes daily against fail-closed production thresholds.',
    schedule: options.schedule || 'daily 10:17',
    command,
    workingDirectory,
  };
}

function installAgentOutcomeMonitorSchedule(options, manager) {
  const scheduleManager = manager || require('./schedule-manager');
  return scheduleManager.createSchedule(buildAgentOutcomeMonitorSchedule(options || {}));
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.installSchedule) {
    const result = installAgentOutcomeMonitorSchedule(options);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.success ? 0 : 1;
    return result;
  }

  const report = options.hosted
    ? await fetchHostedMonitor(options)
    : monitorTaskOutcomes(
      readTaskOutcomes({ inputPath: options.inputPath }),
      { thresholdsPath: options.thresholdsPath },
    );
  if (options.outputPath) {
    const outputPath = path.resolve(options.outputPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verdict === 'healthy' ? 0 : 1;
  return report;
}

if (isCliInvocation()) {
  main().catch((error) => {
    console.error(`Agent outcome monitor failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildAgentOutcomeMonitorSchedule,
  fetchHostedMonitor,
  flattenMetricValues,
  installAgentOutcomeMonitorSchedule,
  main,
  monitorTaskOutcomes,
  parseArgs,
  passesRule,
};
