#!/usr/bin/env node
'use strict';

const path = require('path');

const { classifyCommand } = require('./operational-integrity');

const HIGH_RISK_ACTION_TYPES = new Set([
  'shell.exec',
  'file.delete',
  'upload',
  'message.send',
]);

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeStringArray(values = []) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values
      .map((value) => normalizeText(value))
      .filter(Boolean),
  ));
}

function normalizeRiskBand(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (['very_high', 'high', 'medium', 'low'].includes(normalized)) {
    return normalized;
  }
  if (normalized === 'critical') return 'very_high';
  return 'low';
}

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildNetworkPolicy(input = {}) {
  const allowedHosts = normalizeStringArray(input.allowedHosts || input.egressAllowlist);
  if (input.requiresNetwork !== true) {
    return {
      mode: 'deny_all',
      allowedHosts: [],
    };
  }
  return {
    mode: allowedHosts.length > 0 ? 'allow_list' : 'egress_enabled',
    allowedHosts,
  };
}

function buildLaunchers(workspacePath) {
  const suffix = workspacePath ? ` shell ${quoteShellArg(workspacePath)}` : ' shell';
  return {
    standalone: `sbx run${suffix}`,
    dockerDesktop: `docker sandbox run${suffix}`,
    followUp: workspacePath
      ? [
        'sbx list',
        'docker sandbox ls',
      ]
      : [],
  };
}

function buildWhy({
  recommendation,
  command,
  riskBand,
  actionType,
  affectedFiles,
}) {
  const lines = [];
  if (recommendation === 'required') {
    lines.push('The predicted action is destructive or release-sensitive enough to justify host isolation.');
  } else if (recommendation === 'recommended') {
    lines.push('The predicted action is high-risk enough that isolated execution meaningfully reduces host blast radius.');
  } else {
    lines.push('The current action does not need a dedicated Docker sandbox boundary.');
  }

  if (command && /\brm\s+-rf\b/i.test(command)) {
    lines.push('Recursive delete commands are safer when the filesystem boundary lives inside a disposable microVM.');
  }
  if (command && /\bgit\s+push\b.*(?:--force|-f)\b/i.test(command)) {
    lines.push('Force-push flows should run in an isolated lane so host credentials and unrelated state stay out of scope.');
  }
  if (command && /\b(?:gh\s+pr\s+(?:create|merge)|npm\s+publish|yarn\s+publish|pnpm\s+publish)\b/i.test(command)) {
    lines.push('PR, merge, and publish flows are governance-sensitive and benefit from a disposable execution boundary.');
  }
  if (HIGH_RISK_ACTION_TYPES.has(actionType)) {
    lines.push(`Action type ${actionType} is in the high-risk set for local execution.`);
  }
  if (riskBand === 'very_high' || riskBand === 'high') {
    lines.push(`Risk band ${riskBand} predicts elevated blast radius on the local host.`);
  }
  if (affectedFiles.length >= 4) {
    lines.push(`The change touches ${affectedFiles.length} files, so host isolation improves recovery if the run goes sideways.`);
  }
  return lines;
}

function buildDockerSandboxPlan(input = {}) {
  const toolName = normalizeText(input.toolName);
  const actionType = normalizeText(input.actionType)
    || (toolName === 'Bash' ? 'shell.exec' : '');
  const command = normalizeText(input.command);
  const repoPath = normalizeText(input.repoPath);
  const workspacePath = repoPath ? path.resolve(repoPath) : null;
  const affectedFiles = normalizeStringArray(input.affectedFiles || input.changedFiles || input.files);
  const riskBand = normalizeRiskBand(input.riskBand || input.band);
  const riskScore = Number.isFinite(Number(input.riskScore))
    ? Number(Number(input.riskScore).toFixed(4))
    : null;
  const commandInfo = classifyCommand(command);
  const destructiveCommand = /\brm\s+-rf\b/i.test(command)
    || /\bgit\s+push\b.*(?:--force|-f)\b/i.test(command)
    || /\bgh\s+pr\s+merge\b.*--admin\b/i.test(command);
  const governedCommand = Boolean(
    commandInfo.isPrCreate
      || commandInfo.isPrMerge
      || commandInfo.isPublish
      || commandInfo.isReleaseCreate
      || commandInfo.isTagCreate
  );
  const highRiskAction = HIGH_RISK_ACTION_TYPES.has(actionType)
    || destructiveCommand
    || governedCommand
    || riskBand === 'high'
    || riskBand === 'very_high';

  let recommendation = 'not_needed';
  if (destructiveCommand || commandInfo.isPublish || commandInfo.isReleaseCreate || actionType === 'upload' || actionType === 'message.send') {
    recommendation = 'required';
  } else if (highRiskAction || affectedFiles.length >= 4) {
    recommendation = 'recommended';
  }

  const shouldSandbox = recommendation !== 'not_needed';
  const networkPolicy = buildNetworkPolicy({
    requiresNetwork: input.requiresNetwork === true || governedCommand || commandInfo.isPublish || actionType === 'upload' || actionType === 'message.send',
    allowedHosts: input.allowedHosts,
    egressAllowlist: input.egressAllowlist,
  });
  const launchers = buildLaunchers(workspacePath);
  const summary = shouldSandbox
    ? recommendation === 'required'
      ? 'Route this action into Docker Sandboxes before retrying so the run happens inside a disposable microVM instead of on the host.'
      : 'Prefer Docker Sandboxes for this action to reduce host blast radius while keeping local autonomy.'
    : 'Current action can stay on the normal local execution path.';

  return {
    plannerVersion: 'docker-sandbox-plan-v1',
    shouldSandbox,
    recommendation,
    summary,
    sandboxKind: shouldSandbox ? 'docker_microvm' : 'host',
    workspacePath,
    actionType: actionType || null,
    riskBand,
    riskScore,
    command: command || null,
    affectedFiles,
    networkPolicy,
    launchers,
    claims: shouldSandbox ? {
      isolationBoundary: 'microvm',
      hostAccess: 'bounded_outside_host',
      dockerDaemon: 'private_inside_sandbox',
      workspaceStrategy: workspacePath ? 'directory_sync' : 'ephemeral',
    } : null,
    why: buildWhy({
      recommendation,
      command,
      riskBand,
      actionType,
      affectedFiles,
    }),
  };
}

module.exports = {
  HIGH_RISK_ACTION_TYPES,
  buildDockerSandboxPlan,
  buildLaunchers,
  buildNetworkPolicy,
  normalizeRiskBand,
};

if (require.main === module) {
  const plan = buildDockerSandboxPlan({
    toolName: process.argv[2] || 'Bash',
    command: process.argv.slice(3).join(' '),
    repoPath: process.cwd(),
  });
  console.log(JSON.stringify(plan, null, 2));
}
