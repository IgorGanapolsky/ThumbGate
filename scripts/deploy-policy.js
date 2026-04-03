#!/usr/bin/env node
'use strict';

const { normalizeOrigin } = require('./hosted-config');

const SECRET_POLICY = {
  RLHF_API_KEY: { rotatedAtEnv: 'RLHF_API_KEY_ROTATED_AT', maxAgeDays: 30 },
  STRIPE_SECRET_KEY: { rotatedAtEnv: 'STRIPE_SECRET_KEY_ROTATED_AT', maxAgeDays: 30 },
  STRIPE_WEBHOOK_SECRET: { rotatedAtEnv: 'STRIPE_WEBHOOK_SECRET_ROTATED_AT', maxAgeDays: 30 },
  RAILWAY_TOKEN: { rotatedAtEnv: 'RAILWAY_TOKEN_ROTATED_AT', maxAgeDays: 90 },
  GITHUB_MARKETPLACE_WEBHOOK_SECRET: {
    rotatedAtEnv: 'GITHUB_MARKETPLACE_WEBHOOK_SECRET_ROTATED_AT',
    maxAgeDays: 90,
  },
};

const PROFILE_DEFS = {
  runtime: {
    requiredSecrets: ['RLHF_API_KEY'],
    requiredVars: [],
  },
  billing: {
    requiredSecrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    requiredVars: ['RLHF_PUBLIC_APP_ORIGIN', 'RLHF_BILLING_API_BASE_URL'],
  },
  deploy: {
    requiredSecrets: ['RAILWAY_TOKEN'],
    requiredVars: [
      'RAILWAY_PROJECT_ID',
      'RAILWAY_ENVIRONMENT_ID',
      'RAILWAY_HEALTHCHECK_URL',
      'RLHF_PUBLIC_APP_ORIGIN',
      'RLHF_BILLING_API_BASE_URL',
    ],
  },
  github_marketplace: {
    requiredSecrets: ['GITHUB_MARKETPLACE_WEBHOOK_SECRET'],
    requiredVars: [],
  },
};

function parseTimestamp(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function getAgeDays(timestamp, now = new Date()) {
  return Math.floor((now.getTime() - timestamp.getTime()) / 86_400_000);
}

function isAbsoluteHttpUrl(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol);
  } catch {
    return false;
  }
}

function normalizeProfiles(profiles) {
  const unique = new Set();
  for (const profile of profiles || []) {
    const trimmed = String(profile || '').trim();
    if (!trimmed) {
      continue;
    }
    if (!PROFILE_DEFS[trimmed]) {
      throw new Error(`Unknown deploy policy profile: ${trimmed}`);
    }
    unique.add(trimmed);
  }
  return Array.from(unique);
}

function collectRequiredItems(profiles, key) {
  const items = new Set();
  for (const profile of profiles) {
    for (const value of PROFILE_DEFS[profile][key]) {
      items.add(value);
    }
  }
  return Array.from(items);
}

function evaluateDeployPolicy(env = process.env, { profiles = ['runtime'], now = new Date() } = {}) {
  const selectedProfiles = normalizeProfiles(profiles);
  const requiredSecrets = collectRequiredItems(selectedProfiles, 'requiredSecrets');
  const requiredVars = collectRequiredItems(selectedProfiles, 'requiredVars');
  const errors = [];

  for (const name of requiredVars) {
    const value = String(env[name] || '').trim();
    if (!value) {
      errors.push({ type: 'missing_variable', name, message: `${name} is required` });
      continue;
    }

    if ((name.endsWith('_ORIGIN') || name.endsWith('_BASE_URL')) && !normalizeOrigin(value)) {
      errors.push({ type: 'invalid_origin', name, message: `${name} must be an absolute http(s) origin` });
    }

    if (name === 'RAILWAY_HEALTHCHECK_URL' && !isAbsoluteHttpUrl(value)) {
      errors.push({ type: 'invalid_url', name, message: `${name} must be an absolute http(s) URL` });
    }
  }

  for (const name of requiredSecrets) {
    const secretValue = String(env[name] || '');
    if (!secretValue.trim()) {
      errors.push({ type: 'missing_secret', name, message: `${name} is required` });
      continue;
    }

    const policy = SECRET_POLICY[name];
    if (!policy) {
      continue;
    }

    const rotatedAtRaw = String(env[policy.rotatedAtEnv] || '').trim();
    if (!rotatedAtRaw) {
      errors.push({
        type: 'missing_rotation_timestamp',
        name: policy.rotatedAtEnv,
        message: `${policy.rotatedAtEnv} is required for ${name}`,
      });
      continue;
    }

    const rotatedAt = parseTimestamp(rotatedAtRaw);
    if (!rotatedAt) {
      errors.push({
        type: 'invalid_rotation_timestamp',
        name: policy.rotatedAtEnv,
        message: `${policy.rotatedAtEnv} must be a valid ISO timestamp`,
      });
      continue;
    }

    const ageDays = getAgeDays(rotatedAt, now);
    if (ageDays < 0) {
      errors.push({
        type: 'future_rotation_timestamp',
        name: policy.rotatedAtEnv,
        message: `${policy.rotatedAtEnv} cannot be in the future`,
      });
      continue;
    }

    if (ageDays > policy.maxAgeDays) {
      errors.push({
        type: 'stale_secret',
        name,
        message: `${name} is stale (${ageDays}d old, max ${policy.maxAgeDays}d)`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    checkedAt: now.toISOString(),
    profiles: selectedProfiles,
    requiredSecrets,
    requiredVars,
    errors,
  };
}

function formatReport(report) {
  const lines = [];
  lines.push(`Deploy Policy Check @ ${report.checkedAt}`);
  lines.push(`Profiles: ${report.profiles.join(', ') || 'none'}`);
  lines.push(`Result: ${report.ok ? 'PASS' : 'FAIL'}`);
  lines.push(`Secrets checked: ${report.requiredSecrets.length}`);
  lines.push(`Variables checked: ${report.requiredVars.length}`);
  if (report.errors.length) {
    lines.push('');
    for (const error of report.errors) {
      lines.push(`- ${error.message}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = new Set(argv);
  const profileArg = argv.find((value) => value.startsWith('--profiles='));
  const profiles = profileArg
    ? profileArg.slice('--profiles='.length).split(',').map((value) => value.trim()).filter(Boolean)
    : ['runtime', 'billing', 'deploy'];
  return {
    json: args.has('--json'),
    profiles,
  };
}

function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = evaluateDeployPolicy(process.env, { profiles: options.profiles });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatReport(report));
  }

  if (!report.ok) {
    process.exit(1);
  }
}

module.exports = {
  SECRET_POLICY,
  PROFILE_DEFS,
  parseTimestamp,
  getAgeDays,
  evaluateDeployPolicy,
  formatReport,
};

if (require.main === module) {
  runCli();
}
