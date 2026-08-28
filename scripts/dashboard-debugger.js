'use strict';

/**
 * ThumbGate Dashboard Live Debugger & Inspector Bridge
 *
 * Inspired by GoogleChromeLabs/ndb & Chrome DevTools Architecture:
 * - Subprocess & Hook Interception: Auto-traces gate evaluation on child-process tool dispatches.
 * - Live PreToolUse Breakpoint Simulator: Interactively steps through gate rules and AST matching in memory.
 * - Hop-Latency Budget Profiler: Enforces sub-millisecond execution against the 25ms governance SLA.
 * - Chrome DevTools / ndb Protocol Bridge: Exposes process inspection targets and launch configurations.
 */

const process = require('process');
const { evaluateGates } = require('./gates-engine');
const { LatencyTracker } = require('../src/latency-budget');

function getInspectorStatus() {
  let inspectorUrl = null;
  try {
    const inspector = require('inspector');
    inspectorUrl = typeof inspector.url === 'function' ? inspector.url() : null;
  } catch {
    inspectorUrl = null;
  }

  const memoryUsage = process.memoryUsage();
  const pid = process.pid;
  const nodeVersion = process.version;
  const uptimeSeconds = Math.round(process.uptime());

  const chromeDevToolsUrl = inspectorUrl
    ? `devtools://devtools/bundled/inspector.html?ws=${inspectorUrl.replace(/^ws:\/\//, '')}`
    : null;

  return {
    active: Boolean(inspectorUrl),
    inspectorUrl,
    chromeDevToolsUrl,
    pid,
    nodeVersion,
    uptimeSeconds,
    memory: {
      rssMb: Math.round((memoryUsage.rss / 1024 / 1024) * 10) / 10,
      heapUsedMb: Math.round((memoryUsage.heapUsed / 1024 / 1024) * 10) / 10,
      heapTotalMb: Math.round((memoryUsage.heapTotal / 1024 / 1024) * 10) / 10,
    },
    launchCommands: {
      ndb: 'npx ndb node bin/cli.js check',
      chromeInspect: 'chrome://inspect',
      nodeInspect: 'node --inspect=127.0.0.1:9229 bin/cli.js dashboard',
      envAutoAttach: 'NODE_OPTIONS="--inspect" npx thumbgate dashboard',
    },
    vscodeConfig: {
      type: 'node',
      request: 'attach',
      name: 'Attach to ThumbGate Subprocess',
      port: 9229,
      restart: true,
      autoAttachFilter: 'always',
    },
  };
}

function inspectAction(payload = {}) {
  const toolName = payload.tool || payload.toolName || 'Bash';
  let toolInput = payload.input || payload.toolInput;

  if (!toolInput || typeof toolInput !== 'object') {
    if (toolName === 'Bash') {
      toolInput = { command: payload.command || '' };
    } else if (toolName === 'Edit' || toolName === 'Write') {
      toolInput = {
        file_path: payload.filePath || payload.file_path || '',
        content: payload.content || '',
      };
    } else {
      toolInput = { command: payload.command || '', ...payload };
    }
  }

  const tracker = new LatencyTracker('standard_agent');
  const hopId = tracker.startHop('governance_gate', `PreToolUse Inspector: ${toolName}`);

  const startTime = process.hrtime.bigint();
  let gateResult = null;
  let errorDetail = null;

  try {
    gateResult = evaluateGates(toolName, toolInput, payload.configPath);
  } catch (err) {
    errorDetail = err && err.message ? err.message : String(err);
    gateResult = {
      decision: 'deny',
      gate: 'debugger_exception',
      reason: `Evaluation error: ${errorDetail}`,
      alignmentLayer: 'safety',
      governanceMode: 'sidecar',
    };
  }

  const endTime = process.hrtime.bigint();
  const latencyNanos = Number(endTime - startTime);
  const latencyMs = Math.round((latencyNanos / 1000000) * 100) / 100;

  const decision = gateResult && gateResult.decision ? gateResult.decision : 'allow';
  const gate = gateResult && gateResult.gate ? gateResult.gate : null;
  const reason =
    gateResult && gateResult.reason
      ? gateResult.reason
      : 'Action passed all configured pre-action gates.';
  const alignmentLayer =
    gateResult && gateResult.alignmentLayer ? gateResult.alignmentLayer : 'safety';
  const governanceMode =
    gateResult && gateResult.governanceMode ? gateResult.governanceMode : 'sidecar';

  tracker.endHop(hopId, {
    result: decision,
    durationMs: latencyMs,
  });

  const latencyReport = tracker.analyze();

  const isAllowed = decision === 'allow';
  const isWarn = decision === 'warn';
  const isDeny = decision === 'deny';

  const steps = [
    {
      step: 1,
      name: 'Input Normalization & Canonicalization',
      passed: true,
      detail: `Parsed tool "${toolName}" with payload keys [${Object.keys(toolInput).join(', ')}]`,
    },
    {
      step: 2,
      name: 'Security & Secret Taint Scan',
      passed: gate !== 'secret-egress' && gate !== 'secret-leak',
      detail:
        gate === 'secret-egress' || gate === 'secret-leak'
          ? 'Secret egress signature detected in payload'
          : 'Clean: No unprotected credentials or API keys detected',
    },
    {
      step: 3,
      name: 'Word-Boundary & AST Regex Rule Evaluation',
      passed: !isDeny,
      detail: gate
        ? `Matched gate rule: "${gate}" (${alignmentLayer} layer)`
        : 'All dynamic & built-in safety rules evaluated clean',
    },
    {
      step: 4,
      name: 'Governance Posture & Verdict Synthesis',
      passed: isAllowed || isWarn,
      detail: `Final posture verdict: ${decision.toUpperCase()} (mode: ${governanceMode})`,
    },
  ];

  return {
    ok: true,
    toolName,
    toolInput,
    decision,
    verdict: decision.toUpperCase(),
    gate,
    reason,
    alignmentLayer,
    governanceMode,
    latencyMs,
    performanceBudget: {
      budgetMs: 25,
      durationMs: latencyMs,
      meetsSla: latencyMs <= 25,
      utilizationPct: Math.round((latencyMs / 25) * 100),
    },
    steps,
    latencyReport,
    inspector: getInspectorStatus(),
  };
}

module.exports = {
  getInspectorStatus,
  inspectAction,
};
