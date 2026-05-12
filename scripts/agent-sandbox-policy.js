#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SANDBOX_PROVIDERS = new Set(['local', 'e2b', 'daytona', 'modal', 'cloudflare', 'runloop', 'vercel', 'blaxel']);

function normalizeMount(entry = {}) {
  return {
    name: entry.name,
    source: entry.source || entry.src || '',
    target: entry.target || entry.name || '',
    mode: entry.mode || 'readonly',
  };
}

function buildSandboxManifest(params = {}) {
  const provider = SANDBOX_PROVIDERS.has(params.provider) ? params.provider : 'local';
  const mounts = (params.mounts || []).map(normalizeMount);
  const outputDir = params.outputDir || 'outputs';
  const issues = [];
  for (const mount of mounts) {
    if (!mount.name) issues.push('Every sandbox mount requires a stable name.');
    if (!mount.source) issues.push(`Mount ${mount.name || '(unknown)'} requires a source.`);
    if (!['readonly', 'readwrite', 'output'].includes(mount.mode)) {
      issues.push(`Mount ${mount.name || '(unknown)'} has unsupported mode ${mount.mode}.`);
    }
  }
  if (mounts.some((mount) => mount.mode === 'readwrite' && /credential|secret|keychain|\.env/i.test(mount.source))) {
    issues.push('Read-write secret or credential mounts are blocked.');
  }
  return {
    provider,
    manifestVersion: 1,
    workspace: params.workspace || 'workspace',
    mounts,
    outputDir,
    network: params.network || 'off',
    shell: params.shell || 'restricted',
    checkpointing: params.checkpointing !== false,
    issues,
    ok: issues.length === 0,
  };
}

function evaluateHarnessComputeSeparation(params = {}) {
  const issues = [];
  if (params.credentialsInSandbox) {
    issues.push('Credentials must stay in the harness, not inside model-generated code execution.');
  }
  if (!params.externalizedState) {
    issues.push('Agent state should be externalized so sandbox loss does not lose the run.');
  }
  if (!params.snapshotting) {
    issues.push('Long-running runs need snapshotting or checkpoint rehydration.');
  }
  if ((params.subagentCount || 0) > 1 && !params.isolatedSubagentSandboxes) {
    issues.push('Parallel subagents require isolated sandboxes or disjoint mounted workspaces.');
  }
  return {
    ok: issues.length === 0,
    issues,
    recommendations: [
      'mount only task-specific input directories',
      'write artifacts under a declared output directory',
      'route secret-backed APIs through the harness with explicit action checks',
      'checkpoint after each externally visible or expensive step',
    ],
  };
}

function buildSmitheryUplinkPlan(params = {}) {
  const localServers = params.localServers || [];
  const servers = localServers.map((server) => {
    const url = server.url || '';
    const command = server.command || '';
    const remoteExposure = Boolean(server.remoteExposure);
    const sensitive = /browser|chrome|files|filesystem|computer|network/i.test(`${server.id || ''} ${url} ${command}`);
    return {
      id: server.id || 'mcp-server',
      kind: url ? 'http' : 'stdio',
      addCommand: url
        ? `smithery mcp add ${url} --id ${server.id || 'server'}`
        : `smithery mcp add --id ${server.id || 'server'} -- ${command}`,
      remoteExposure,
      requiredGuards: [
        'short-lived auth',
        'per-tool allowlist',
        'audit log every remote tool call',
        sensitive ? 'human approval for browser/filesystem/computer-use actions' : 'standard MCP payload validation',
      ],
    };
  });
  return {
    servers,
    policy: 'Remote MCP uplinks are useful for cloud agents reaching local tools, but ThumbGate should gate them like production tools.',
    blockedByDefault: servers.some((server) => server.remoteExposure && server.requiredGuards.length === 0),
  };
}

function runPolicy(input = {}) {
  return {
    sandboxManifest: buildSandboxManifest(input.sandbox || {}),
    separation: evaluateHarnessComputeSeparation(input.separation || {}),
    smitheryUplink: input.smithery ? buildSmitheryUplinkPlan(input.smithery) : null,
  };
}

function main() {
  const raw = fs.readFileSync(0, 'utf8');
  const input = raw.trim() ? JSON.parse(raw) : {};
  const result = runPolicy(input);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.sandboxManifest.ok && result.separation.ok ? 0 : 1);
}

module.exports = {
  buildSandboxManifest,
  evaluateHarnessComputeSeparation,
  buildSmitheryUplinkPlan,
  runPolicy,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
