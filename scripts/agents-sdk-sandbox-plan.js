'use strict';

function buildAgentsSdkSandboxPlan(options = {}) {
  const provider = options.provider || 'unix_local';
  const mounts = options.mounts || [{ name: 'data', mode: 'read_only' }];
  const outputDir = options.outputDir || 'outputs';

  return {
    harness: 'openai_agents_sdk_sandbox',
    provider,
    manifest: {
      mounts,
      outputDir,
      network: options.network || 'disabled_by_default',
      allowedCommands: options.allowedCommands || ['npm test', 'npm run test:coverage'],
    },
    separation: {
      credentialsInSandbox: false,
      toolBrokerOwnsSecrets: true,
      sandboxGetsScopedFilesOnly: true,
    },
    durability: {
      externalState: true,
      checkpoints: ['manifest_loaded', 'tools_completed', 'patch_written', 'tests_run'],
      rehydrateOnSandboxLoss: true,
    },
    gates: [
      'read manifest before file access',
      'write only under declared output or scoped repo path',
      'cite source filenames for data-room answers',
      'run configured verification before completion claim',
      'persist decision journal outside sandbox',
    ],
  };
}

function evaluateSandboxPlan(plan = {}) {
  const issues = [];
  if (!plan.manifest?.mounts?.length) issues.push('missing_manifest_mounts');
  if (!plan.manifest?.outputDir) issues.push('missing_output_dir');
  if (plan.separation?.credentialsInSandbox !== false) issues.push('credentials_must_stay_outside_sandbox');
  if (!plan.durability?.externalState) issues.push('external_state_required');
  if (!plan.durability?.rehydrateOnSandboxLoss) issues.push('rehydration_required');
  if (!Array.isArray(plan.gates) || !plan.gates.some((gate) => /verification/i.test(gate))) {
    issues.push('verification_gate_required');
  }

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
  };
}

module.exports = {
  buildAgentsSdkSandboxPlan,
  evaluateSandboxPlan,
};
