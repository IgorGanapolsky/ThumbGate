#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getActiveMcpProfile, getAllowedTools } = require('./mcp-policy');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_BUNDLE_DIR = path.join(PROJECT_ROOT, 'config', 'policy-bundles');
const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

function getDefaultBundleId() {
  return process.env.RLHF_POLICY_BUNDLE || 'default-v1';
}

function getBundlePath(bundleId = getDefaultBundleId()) {
  if (process.env.RLHF_POLICY_BUNDLE_PATH) {
    return process.env.RLHF_POLICY_BUNDLE_PATH;
  }
  return path.join(DEFAULT_BUNDLE_DIR, `${bundleId}.json`);
}

function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Invalid policy bundle: expected object');
  }
  if (!bundle.bundleId || typeof bundle.bundleId !== 'string') {
    throw new Error('Invalid policy bundle: missing bundleId');
  }
  if (!Array.isArray(bundle.intents) || bundle.intents.length === 0) {
    throw new Error('Invalid policy bundle: intents must be a non-empty array');
  }

  bundle.intents.forEach((intent) => {
    if (!intent.id || typeof intent.id !== 'string') {
      throw new Error('Invalid policy bundle: intent id is required');
    }
    if (!RISK_LEVELS.includes(intent.risk)) {
      throw new Error(`Invalid policy bundle: unsupported risk '${intent.risk}' for intent '${intent.id}'`);
    }
    if (!Array.isArray(intent.actions) || intent.actions.length === 0) {
      throw new Error(`Invalid policy bundle: intent '${intent.id}' must define actions`);
    }
  });

  return true;
}

function loadPolicyBundle(bundleId = getDefaultBundleId()) {
  const raw = fs.readFileSync(getBundlePath(bundleId), 'utf-8');
  const parsed = JSON.parse(raw);
  validateBundle(parsed);
  return parsed;
}

function getRequiredApprovalRisks(bundle, mcpProfile) {
  const approval = bundle.approval || {};
  if (approval.profileOverrides && Array.isArray(approval.profileOverrides[mcpProfile])) {
    return approval.profileOverrides[mcpProfile];
  }
  return Array.isArray(approval.requiredRisks) ? approval.requiredRisks : ['high', 'critical'];
}

function assertKnownMcpProfile(profile) {
  getAllowedTools(profile);
  return profile;
}

function listIntents(options = {}) {
  const bundle = loadPolicyBundle(options.bundleId);
  const profile = assertKnownMcpProfile(options.mcpProfile || getActiveMcpProfile());
  const requiredRisks = getRequiredApprovalRisks(bundle, profile);

  return {
    bundleId: bundle.bundleId,
    mcpProfile: profile,
    intents: bundle.intents.map((intent) => ({
      id: intent.id,
      description: intent.description,
      risk: intent.risk,
      actionCount: intent.actions.length,
      requiresApproval: requiredRisks.includes(intent.risk),
    })),
  };
}

function planIntent(options = {}) {
  const bundle = loadPolicyBundle(options.bundleId);
  const profile = assertKnownMcpProfile(options.mcpProfile || getActiveMcpProfile());
  const intentId = String(options.intentId || '').trim();
  const context = String(options.context || '').trim();
  const approved = options.approved === true;

  if (!intentId) {
    throw new Error('intentId is required');
  }

  const intent = bundle.intents.find((item) => item.id === intentId);
  if (!intent) {
    throw new Error(`Unknown intent: ${intentId}`);
  }

  const requiredRisks = getRequiredApprovalRisks(bundle, profile);
  const requiresApproval = requiredRisks.includes(intent.risk);
  const checkpointRequired = requiresApproval && !approved;

  return {
    bundleId: bundle.bundleId,
    mcpProfile: profile,
    generatedAt: new Date().toISOString(),
    status: checkpointRequired ? 'checkpoint_required' : 'ready',
    intent: {
      id: intent.id,
      description: intent.description,
      risk: intent.risk,
    },
    context,
    requiresApproval,
    approved,
    checkpoint: checkpointRequired
      ? {
        type: 'human_approval',
        reason: `Intent '${intent.id}' has risk '${intent.risk}' under profile '${profile}'.`,
        requiredForRiskLevels: requiredRisks,
      }
      : null,
    actions: intent.actions,
  };
}

module.exports = {
  DEFAULT_BUNDLE_DIR,
  RISK_LEVELS,
  getDefaultBundleId,
  getBundlePath,
  validateBundle,
  loadPolicyBundle,
  getRequiredApprovalRisks,
  assertKnownMcpProfile,
  listIntents,
  planIntent,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const intentArg = args.find((arg) => arg.startsWith('--intent='));
  const profileArg = args.find((arg) => arg.startsWith('--profile='));
  const bundleArg = args.find((arg) => arg.startsWith('--bundle='));
  const approved = args.includes('--approved');

  if (!intentArg) {
    console.log(JSON.stringify(listIntents({
      mcpProfile: profileArg ? profileArg.replace('--profile=', '') : undefined,
      bundleId: bundleArg ? bundleArg.replace('--bundle=', '') : undefined,
    }), null, 2));
    process.exit(0);
  }

  const plan = planIntent({
    intentId: intentArg.replace('--intent=', ''),
    mcpProfile: profileArg ? profileArg.replace('--profile=', '') : undefined,
    bundleId: bundleArg ? bundleArg.replace('--bundle=', '') : undefined,
    approved,
  });
  console.log(JSON.stringify(plan, null, 2));
}
