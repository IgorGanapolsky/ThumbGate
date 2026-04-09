#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const MERGE_QUALITY_CHECKS = require('../config/merge-quality-checks.json');

const DEFAULT_REPO = process.env.GITHUB_REPOSITORY || 'IgorGanapolsky/ThumbGate';
const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || 'main';

function assertSafeGhArgs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('GH CLI args must be a non-empty array.');
  }

  return args.map((arg) => {
    const normalized = String(arg ?? '');
    if (!normalized || /\0/.test(normalized)) {
      throw new Error(`Unsafe GH CLI arg: ${arg}`);
    }
    return normalized;
  });
}

function runGh(args) {
  const env = { ...process.env };
  if (!env.GITHUB_ACTIONS && env.GITHUB_TOKEN && !env.GH_TOKEN) {
    delete env.GITHUB_TOKEN;
  }

  return spawnSync('gh', assertSafeGhArgs(args), {
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function formatGhError(result) {
  return (result.stderr || result.stdout || 'Unknown GH CLI failure').trim();
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    check: false,
    json: false,
    repo: DEFAULT_REPO,
    branch: DEFAULT_BRANCH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--repo' && argv[index + 1]) {
      options.repo = argv[index + 1];
      index += 1;
    } else if (arg === '--branch' && argv[index + 1]) {
      options.branch = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

function assertSafeRepoSegment(value, label) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new Error(`Unsafe repository ${label}: ${value}`);
  }
  return normalized;
}

function splitRepo(repo) {
  const [owner, name] = String(repo || '').trim().split('/');
  if (!owner || !name) {
    throw new Error(`Invalid repository "${repo}". Expected owner/name.`);
  }
  return {
    owner: assertSafeRepoSegment(owner, 'owner'),
    name: assertSafeRepoSegment(name, 'name'),
  };
}

function assertSafeBranchPattern(branch) {
  const normalized = String(branch || '').trim();
  if (!normalized) {
    throw new Error('Branch pattern is required.');
  }
  if (normalized.startsWith('-') || normalized.includes('..') || normalized.includes('//') || normalized.includes('@{')) {
    throw new Error(`Unsafe branch pattern: ${branch}`);
  }
  if (normalized.endsWith('.') || normalized.endsWith('/')) {
    throw new Error(`Unsafe branch pattern: ${branch}`);
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) {
    throw new Error(`Unsafe branch pattern: ${branch}`);
  }
  return normalized;
}

function assertSafeRuleId(ruleId) {
  const normalized = String(ruleId || '').trim();
  if (!/^[A-Za-z0-9_=-]+$/.test(normalized)) {
    throw new Error(`Unsafe branch protection rule id: ${ruleId}`);
  }
  return normalized;
}

function assertSafeStatusContext(context) {
  const normalized = String(context || '').trim();
  if (!normalized || /[\0\r\n]/.test(normalized)) {
    throw new Error(`Unsafe status check context: ${context}`);
  }
  return normalized;
}

function normalizeContexts(contexts = []) {
  return [...new Set((Array.isArray(contexts) ? contexts : []).map((value) => {
    const normalized = String(value || '').trim();
    return normalized ? assertSafeStatusContext(normalized) : '';
  }).filter(Boolean))].sort();
}

function loadBranchProtectionRule(repo, runner = runGh) {
  const { owner, name } = splitRepo(repo);
  const query = `
    query BranchProtectionRules($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        branchProtectionRules(first: 50) {
          nodes {
            id
            pattern
            requiresStatusChecks
            requiredStatusCheckContexts
            requiresApprovingReviews
            requiresConversationResolution
          }
        }
      }
    }
  `;

  const result = runner([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
  ]);

  if (result.status !== 0) {
    throw new Error(`Failed to load branch protection: ${formatGhError(result)}`);
  }

  const payload = JSON.parse(result.stdout || '{}');
  return payload.data?.repository?.branchProtectionRules?.nodes || [];
}

function findBranchProtectionRule(rules, branch) {
  return (Array.isArray(rules) ? rules : []).find((rule) => rule.pattern === branch) || null;
}

function diffContexts(actual, expected) {
  const actualSet = new Set(normalizeContexts(actual));
  const expectedSet = new Set(normalizeContexts(expected));

  return {
    missing: [...expectedSet].filter((value) => !actualSet.has(value)),
    unexpected: [...actualSet].filter((value) => !expectedSet.has(value)),
  };
}

function updateBranchProtectionRule(ruleId, requiredStatusCheckContexts, runner = runGh) {
  const safeRuleId = assertSafeRuleId(ruleId);
  const contexts = normalizeContexts(requiredStatusCheckContexts);
  const mutation = `
    mutation UpdateBranchProtectionRule($ruleId: ID!, $contexts: [String!]) {
      updateBranchProtectionRule(input: {
        branchProtectionRuleId: $ruleId
        requiresStatusChecks: true
        requiredStatusCheckContexts: $contexts
      }) {
        branchProtectionRule {
          id
          pattern
          requiresStatusChecks
          requiredStatusCheckContexts
        }
      }
    }
  `;

  const args = [
    'api',
    'graphql',
    '-f',
    `query=${mutation}`,
    '-f',
    `ruleId=${safeRuleId}`,
  ];
  for (const context of contexts) {
    args.push('-F', `contexts[]=${context}`);
  }

  const result = runner(args);

  if (result.status !== 0) {
    throw new Error(`Failed to update branch protection: ${formatGhError(result)}`);
  }

  return JSON.parse(result.stdout || '{}').data?.updateBranchProtectionRule?.branchProtectionRule || null;
}

function syncBranchProtection(options = {}, runner = runGh) {
  const repo = options.repo || DEFAULT_REPO;
  const branch = assertSafeBranchPattern(options.branch || DEFAULT_BRANCH);
  const expectedContexts = normalizeContexts(MERGE_QUALITY_CHECKS.requiredStatusCheckContexts);
  const rules = loadBranchProtectionRule(repo, runner);
  const rule = findBranchProtectionRule(rules, branch);

  if (!rule) {
    throw new Error(`No branch protection rule found for ${repo}#${branch}.`);
  }

  const actualContexts = normalizeContexts(rule.requiredStatusCheckContexts);
  const diff = diffContexts(actualContexts, expectedContexts);
  const inSync = diff.missing.length === 0 && diff.unexpected.length === 0 && rule.requiresStatusChecks === true;

  if (options.check) {
    return {
      ok: inSync,
      repo,
      branch,
      ruleId: rule.id,
      actualContexts,
      expectedContexts,
      diff,
    };
  }

  const updatedRule = inSync
    ? rule
    : updateBranchProtectionRule(rule.id, expectedContexts, runner);
  const finalContexts = normalizeContexts(updatedRule.requiredStatusCheckContexts);
  const finalDiff = diffContexts(finalContexts, expectedContexts);

  return {
    ok: true,
    repo,
    branch,
    ruleId: rule.id,
    actualContexts: finalContexts,
    expectedContexts,
    diff: finalDiff,
    updated: !inSync,
  };
}

function runCli(argv = process.argv.slice(2), runner = runGh) {
  const options = parseArgs(argv);
  const result = syncBranchProtection(options, runner);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (options.check) {
    const status = result.ok ? 'ok' : 'drift';
    console.log(`Branch protection ${status}: ${result.repo} ${result.branch}`);
    if (!result.ok) {
      if (result.diff.missing.length > 0) {
        console.log(`Missing contexts: ${result.diff.missing.join(', ')}`);
      }
      if (result.diff.unexpected.length > 0) {
        console.log(`Unexpected contexts: ${result.diff.unexpected.join(', ')}`);
      }
    }
  } else {
    console.log(`Branch protection synced: ${result.repo} ${result.branch}`);
  }

  return options.check && !result.ok ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = runCli();
}

module.exports = {
  assertSafeBranchPattern,
  assertSafeGhArgs,
  assertSafeRuleId,
  assertSafeStatusContext,
  diffContexts,
  findBranchProtectionRule,
  loadBranchProtectionRule,
  normalizeContexts,
  parseArgs,
  runCli,
  splitRepo,
  syncBranchProtection,
  updateBranchProtectionRule,
};
