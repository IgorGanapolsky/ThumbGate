#!/usr/bin/env node
'use strict';

/**
 * Sync / check the ThumbGate main-branch repository ruleset.
 *
 * High-ROI companion to classic branch protection (scripts/sync-branch-protection.js):
 * - Enforces the same merge-quality status checks via repository rulesets
 * - Pins zero bypass actors (no owner/agent admin soft-bypass)
 * - Keeps classic protection layered; this does not delete classic rules
 *
 * Usage:
 *   node scripts/sync-repository-rulesets.js --check
 *   node scripts/sync-repository-rulesets.js --check --json
 *   node scripts/sync-repository-rulesets.js
 *   node scripts/sync-repository-rulesets.js --json
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MERGE_QUALITY_CHECKS = require('../config/merge-quality-checks.json');
const RULESET_POLICY = require('../config/main-branch-ruleset.json');

const DEFAULT_REPO = process.env.GITHUB_REPOSITORY || 'IgorGanapolsky/ThumbGate';
const FIXED_GH_BINARIES = [
  '/usr/bin/gh',
  '/usr/local/bin/gh',
  '/opt/homebrew/bin/gh',
];

const FORBIDDEN_BYPASS_ACTOR_TYPES = new Set([
  'User',
  'OrganizationAdmin',
  'RepositoryRole',
  'Team',
  'DeployKey',
]);

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

function resolveGhBinary(options = {}) {
  const accessSync = options.accessSync || fs.accessSync;
  const candidates = [];
  const configuredBinary = String(process.env.THUMBGATE_GH_BIN || '').trim();

  if (configuredBinary) {
    if (!path.isAbsolute(configuredBinary)) {
      throw new Error(`Unsafe GH binary path: ${configuredBinary}`);
    }
    candidates.push(configuredBinary);
  }

  candidates.push(...FIXED_GH_BINARIES);

  for (const candidate of candidates) {
    try {
      accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(`Unable to locate GH CLI in fixed paths: ${candidates.join(', ')}`);
}

function prepareGhEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  // Prefer explicit GH_TOKEN; promote documented GH_PAT fallback when needed.
  if (!env.GH_TOKEN && env.GH_PAT) {
    env.GH_TOKEN = env.GH_PAT;
  }
  if (!env.GITHUB_ACTIONS && env.GITHUB_TOKEN && !env.GH_TOKEN) {
    delete env.GITHUB_TOKEN;
  }
  return env;
}

function runGh(args, options = {}) {
  return spawnSync(resolveGhBinary(options), assertSafeGhArgs(args), {
    encoding: 'utf8',
    env: prepareGhEnv(process.env),
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

function normalizeContexts(contexts = []) {
  return [...new Set((Array.isArray(contexts) ? contexts : []).map((value) => {
    const normalized = String(value || '').trim();
    if (!normalized || /[\0\r\n]/.test(normalized)) {
      throw new Error(`Unsafe status check context: ${value}`);
    }
    return normalized;
  }).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function diffContexts(actual, expected) {
  const actualSet = new Set(normalizeContexts(actual));
  const expectedSet = new Set(normalizeContexts(expected));

  return {
    missing: [...expectedSet].filter((value) => !actualSet.has(value)),
    unexpected: [...actualSet].filter((value) => !expectedSet.has(value)),
  };
}

function expectedStatusContexts(policy = RULESET_POLICY, mergeQuality = MERGE_QUALITY_CHECKS) {
  const source = policy?.rules?.required_status_checks?.contexts_from;
  if (source === 'merge-quality-checks') {
    return normalizeContexts(mergeQuality.requiredStatusCheckContexts || []);
  }
  return normalizeContexts(policy?.rules?.required_status_checks?.contexts || []);
}

function buildExpectedRulesPayload(policy = RULESET_POLICY, mergeQuality = MERGE_QUALITY_CHECKS) {
  const contexts = expectedStatusContexts(policy, mergeQuality);
  const pullRequest = policy.rules.pull_request || {};
  const statusPolicy = policy.rules.required_status_checks || {};

  const rules = [];

  if (policy.rules.required_linear_history) {
    rules.push({ type: 'required_linear_history' });
  }
  if (policy.rules.deletion) {
    rules.push({ type: 'deletion' });
  }
  if (policy.rules.non_fast_forward) {
    rules.push({ type: 'non_fast_forward' });
  }

  rules.push({
    type: 'pull_request',
    parameters: {
      required_approving_review_count: Number(pullRequest.required_approving_review_count ?? 0),
      dismiss_stale_reviews_on_push: Boolean(pullRequest.dismiss_stale_reviews_on_push ?? true),
      require_code_owner_review: Boolean(pullRequest.require_code_owner_review ?? false),
      require_last_push_approval: Boolean(pullRequest.require_last_push_approval ?? false),
      required_review_thread_resolution: Boolean(pullRequest.required_review_thread_resolution ?? true),
      allowed_merge_methods: Array.isArray(pullRequest.allowed_merge_methods)
        ? [...pullRequest.allowed_merge_methods]
        : ['squash', 'rebase'],
    },
  });

  rules.push({
    type: 'required_status_checks',
    parameters: {
      strict_required_status_checks_policy: Boolean(
        statusPolicy.strict_required_status_checks_policy ?? true,
      ),
      do_not_enforce_on_create: Boolean(statusPolicy.do_not_enforce_on_create ?? false),
      required_status_checks: contexts.map((context) => ({ context })),
    },
  });

  return rules;
}

function buildExpectedRulesetBody(policy = RULESET_POLICY, mergeQuality = MERGE_QUALITY_CHECKS) {
  return {
    name: String(policy.name || 'main governance'),
    target: policy.target || 'branch',
    enforcement: policy.enforcement || 'active',
    bypass_actors: Array.isArray(policy.bypass_actors) ? policy.bypass_actors : [],
    conditions: policy.conditions || {
      ref_name: {
        include: ['refs/heads/main'],
        exclude: [],
      },
    },
    rules: buildExpectedRulesPayload(policy, mergeQuality),
  };
}

function loadRulesets(repo, runner = runGh) {
  const { owner, name } = splitRepo(repo);
  const result = runner([
    'api',
    `repos/${owner}/${name}/rulesets`,
    '-H',
    'Accept: application/vnd.github+json',
  ]);

  if (result.status !== 0) {
    throw new Error(`Failed to load rulesets: ${formatGhError(result)}`);
  }

  const payload = JSON.parse(result.stdout || '[]');
  if (!Array.isArray(payload)) {
    throw new Error('Rulesets API returned a non-array payload.');
  }
  return payload;
}

function loadRulesetDetail(repo, rulesetId, runner = runGh) {
  const { owner, name } = splitRepo(repo);
  const id = Number(rulesetId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Unsafe ruleset id: ${rulesetId}`);
  }

  const result = runner([
    'api',
    `repos/${owner}/${name}/rulesets/${id}`,
    '-H',
    'Accept: application/vnd.github+json',
  ]);

  if (result.status !== 0) {
    throw new Error(`Failed to load ruleset ${id}: ${formatGhError(result)}`);
  }

  return JSON.parse(result.stdout || '{}');
}

function findMainGovernanceRuleset(rulesets, policy = RULESET_POLICY) {
  // Only match the named governance ruleset. Never treat an arbitrary
  // main-targeting ruleset as ours — a full PUT would rename/overwrite it.
  const expectedName = String(policy.name || 'main governance');
  const list = Array.isArray(rulesets) ? rulesets : [];
  return list.find((ruleset) => {
    if (!ruleset || typeof ruleset !== 'object') {
      return false;
    }
    return ruleset.name === expectedName;
  }) || null;
}

function extractStatusContexts(ruleset) {
  const rules = Array.isArray(ruleset?.rules) ? ruleset.rules : [];
  const statusRule = rules.find((rule) => rule?.type === 'required_status_checks');
  const checks = statusRule?.parameters?.required_status_checks || [];
  return normalizeContexts(checks.map((check) => check?.context || check).filter(Boolean));
}

function hasRuleType(ruleset, type) {
  return (Array.isArray(ruleset?.rules) ? ruleset.rules : []).some((rule) => rule?.type === type);
}

function extractPullRequestParams(ruleset) {
  const rule = (Array.isArray(ruleset?.rules) ? ruleset.rules : [])
    .find((entry) => entry?.type === 'pull_request');
  return rule?.parameters || null;
}

function extractStatusCheckParams(ruleset) {
  const rule = (Array.isArray(ruleset?.rules) ? ruleset.rules : [])
    .find((entry) => entry?.type === 'required_status_checks');
  return rule?.parameters || null;
}

function analyzeBypassActors(bypassActors = [], policy = RULESET_POLICY) {
  const actual = Array.isArray(bypassActors) ? bypassActors : [];
  const expected = Array.isArray(policy.bypass_actors) ? policy.bypass_actors : [];
  const forbidden = actual.filter((actor) => {
    const actorType = String(actor?.actor_type || '');
    return FORBIDDEN_BYPASS_ACTOR_TYPES.has(actorType);
  });

  const unexpectedHumanBypass = forbidden.length > 0;
  const emptyExpected = expected.length === 0;
  const emptyActual = actual.length === 0;
  const ok = emptyExpected
    ? emptyActual && !unexpectedHumanBypass
    : JSON.stringify(actual) === JSON.stringify(expected) && !unexpectedHumanBypass;

  return {
    ok,
    actual,
    expected,
    forbidden,
    unexpectedHumanBypass,
  };
}

function analyzeRuleset(detail, policy = RULESET_POLICY, mergeQuality = MERGE_QUALITY_CHECKS) {
  const expectedContexts = expectedStatusContexts(policy, mergeQuality);
  const actualContexts = extractStatusContexts(detail);
  const contextDiff = diffContexts(actualContexts, expectedContexts);
  const bypass = analyzeBypassActors(detail.bypass_actors, policy);
  const pullRequest = extractPullRequestParams(detail);
  const expectedPull = policy.rules.pull_request || {};

  const issues = [];

  if (detail.enforcement !== (policy.enforcement || 'active')) {
    issues.push(`enforcement is ${detail.enforcement}, expected ${policy.enforcement || 'active'}`);
  }
  if (detail.target !== (policy.target || 'branch')) {
    issues.push(`target is ${detail.target}, expected ${policy.target || 'branch'}`);
  }
  if (contextDiff.missing.length > 0) {
    issues.push(`missing status checks: ${contextDiff.missing.join(', ')}`);
  }
  if (contextDiff.unexpected.length > 0) {
    issues.push(`unexpected status checks: ${contextDiff.unexpected.join(', ')}`);
  }
  if (!hasRuleType(detail, 'required_linear_history') && policy.rules.required_linear_history) {
    issues.push('missing required_linear_history');
  }
  if (!hasRuleType(detail, 'deletion') && policy.rules.deletion) {
    issues.push('missing deletion protection');
  }
  if (!hasRuleType(detail, 'non_fast_forward') && policy.rules.non_fast_forward) {
    issues.push('missing non_fast_forward (force-push block)');
  }
  if (!hasRuleType(detail, 'pull_request')) {
    issues.push('missing pull_request rule');
  } else if (pullRequest) {
    if (Boolean(pullRequest.required_review_thread_resolution)
      !== Boolean(expectedPull.required_review_thread_resolution ?? true)) {
      issues.push('required_review_thread_resolution drift');
    }
    if (Number(pullRequest.required_approving_review_count)
      !== Number(expectedPull.required_approving_review_count ?? 0)) {
      issues.push('required_approving_review_count drift');
    }
  }

  const expectedStatus = policy.rules.required_status_checks || {};
  const statusParams = extractStatusCheckParams(detail);
  if (!statusParams) {
    issues.push('missing required_status_checks rule parameters');
  } else {
    if (Boolean(statusParams.strict_required_status_checks_policy)
      !== Boolean(expectedStatus.strict_required_status_checks_policy ?? true)) {
      issues.push('strict_required_status_checks_policy drift');
    }
    if (Boolean(statusParams.do_not_enforce_on_create)
      !== Boolean(expectedStatus.do_not_enforce_on_create ?? false)) {
      issues.push('do_not_enforce_on_create drift');
    }
  }
  if (!bypass.ok) {
    if (bypass.unexpectedHumanBypass) {
      issues.push(
        `forbidden bypass actors present: ${
          bypass.forbidden.map((actor) => actor.actor_type).join(', ')
        }`,
      );
    } else {
      issues.push('bypass_actors drift from zero-bypass policy');
    }
  }

  const includes = detail.conditions?.ref_name?.include || [];
  if (!Array.isArray(includes) || !includes.includes('refs/heads/main')) {
    issues.push('conditions.ref_name.include must cover refs/heads/main');
  }

  return {
    ok: issues.length === 0,
    issues,
    actualContexts,
    expectedContexts,
    contextDiff,
    bypass,
    rulesetId: detail.id || null,
    name: detail.name || null,
    enforcement: detail.enforcement || null,
  };
}

function runGhWithInput(args, input, options = {}) {
  return spawnSync(resolveGhBinary(options), assertSafeGhArgs(args), {
    encoding: 'utf8',
    env: prepareGhEnv(process.env),
    input: String(input || ''),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function upsertRuleset(repo, body, existingId, runnerWithInput = runGhWithInput) {
  const { owner, name } = splitRepo(repo);
  const payload = JSON.stringify(body);

  if (existingId) {
    const id = Number(existingId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Unsafe ruleset id: ${existingId}`);
    }
    const result = runnerWithInput([
      'api',
      '--method',
      'PUT',
      `repos/${owner}/${name}/rulesets/${id}`,
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      'Content-Type: application/json',
      '--input',
      '-',
    ], payload);

    if (result.status !== 0) {
      throw new Error(`Failed to update ruleset ${id}: ${formatGhError(result)}`);
    }
    return JSON.parse(result.stdout || '{}');
  }

  const result = runnerWithInput([
    'api',
    '--method',
    'POST',
    `repos/${owner}/${name}/rulesets`,
    '-H',
    'Accept: application/vnd.github+json',
    '-H',
    'Content-Type: application/json',
    '--input',
    '-',
  ], payload);

  if (result.status !== 0) {
    throw new Error(`Failed to create ruleset: ${formatGhError(result)}`);
  }
  return JSON.parse(result.stdout || '{}');
}


function loadClassicBranchProtectionContexts(repo, branch = 'main', runner = runGh) {
  const { owner, name } = splitRepo(repo);
  const safeBranch = String(branch || 'main').trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(safeBranch)) {
    throw new Error(`Unsafe branch pattern: ${branch}`);
  }

  const result = runner([
    'api',
    `repos/${owner}/${name}/branches/${safeBranch}/protection`,
    '-H',
    'Accept: application/vnd.github+json',
  ]);

  if (result.status !== 0) {
    return {
      ok: false,
      present: false,
      contexts: [],
      error: formatGhError(result),
    };
  }

  try {
    const payload = JSON.parse(result.stdout || '{}');
    const contexts = normalizeContexts(payload.required_status_checks?.contexts || []);
    return {
      ok: true,
      present: true,
      contexts,
      enforceAdmins: Boolean(payload.enforce_admins?.enabled),
      requiredConversationResolution: Boolean(payload.required_conversation_resolution?.enabled),
      requiredLinearHistory: Boolean(payload.required_linear_history?.enabled),
    };
  } catch (error) {
    return {
      ok: false,
      present: false,
      contexts: [],
      error: error.message,
    };
  }
}

/**
 * High-ROI dual-surface drift: classic branch protection vs repository ruleset.
 * Both may legitimately layer; required status checks must stay congruent.
 */
function compareClassicAndRulesetContexts(classic, rulesetContexts, expectedContexts) {
  const classicContexts = normalizeContexts(classic?.contexts || []);
  const ruleset = normalizeContexts(rulesetContexts || []);
  const expected = normalizeContexts(expectedContexts || []);

  const classicVsRuleset = diffContexts(classicContexts, ruleset);
  const classicVsExpected = diffContexts(classicContexts, expected);
  const rulesetVsExpected = diffContexts(ruleset, expected);

  const issues = [];
  if (classic?.present && classicVsRuleset.missing.length > 0) {
    issues.push(
      `classic missing checks present on ruleset: ${classicVsRuleset.missing.join(', ')}`,
    );
  }
  if (classic?.present && classicVsRuleset.unexpected.length > 0) {
    issues.push(
      `classic has checks absent from ruleset: ${classicVsRuleset.unexpected.join(', ')}`,
    );
  }
  if (classic?.present && classicVsExpected.missing.length > 0) {
    issues.push(
      `classic missing merge-quality checks: ${classicVsExpected.missing.join(', ')}`,
    );
  }
  if (rulesetVsExpected.missing.length > 0) {
    issues.push(
      `ruleset missing merge-quality checks: ${rulesetVsExpected.missing.join(', ')}`,
    );
  }

  return {
    ok: issues.length === 0,
    issues,
    classicContexts,
    rulesetContexts: ruleset,
    expectedContexts: expected,
    classicVsRuleset,
    classicPresent: Boolean(classic?.present),
  };
}

function syncRepositoryRulesets(options = {}, deps = {}) {
  const runner = deps.runner || runGh;
  const runnerWithInput = deps.runnerWithInput || runGhWithInput;
  const policy = deps.policy || RULESET_POLICY;
  const mergeQuality = deps.mergeQuality || MERGE_QUALITY_CHECKS;
  const repo = options.repo || DEFAULT_REPO;

  const rulesets = loadRulesets(repo, runner);
  const summary = findMainGovernanceRuleset(rulesets, policy);
  let detail = null;

  if (summary?.id) {
    detail = loadRulesetDetail(repo, summary.id, runner);
  }

  if (options.check) {
    const classic = typeof deps.loadClassic === 'function'
      ? deps.loadClassic(repo, 'main', runner)
      : loadClassicBranchProtectionContexts(repo, 'main', runner);

    if (!detail) {
      const expected = expectedStatusContexts(policy, mergeQuality);
      const dual = compareClassicAndRulesetContexts(classic, [], expected);
      return {
        ok: false,
        repo,
        missing: true,
        issues: ['main governance ruleset is not present', ...dual.issues],
        expectedContexts: expected,
        actualContexts: [],
        bypass: analyzeBypassActors([], policy),
        classic,
        dual,
      };
    }
    const analysis = analyzeRuleset(detail, policy, mergeQuality);
    const dual = compareClassicAndRulesetContexts(
      classic,
      analysis.actualContexts,
      analysis.expectedContexts,
    );
    const issues = [...analysis.issues, ...dual.issues];
    return {
      repo,
      missing: false,
      ...analysis,
      ok: issues.length === 0,
      issues,
      classic,
      dual,
    };
  }

  const body = buildExpectedRulesetBody(policy, mergeQuality);
  const updated = upsertRuleset(repo, body, detail?.id || null, runnerWithInput);
  const finalDetail = updated?.rules
    ? updated
    : loadRulesetDetail(repo, updated.id || detail?.id, runner);
  const analysis = analyzeRuleset(finalDetail, policy, mergeQuality);

  return {
    ok: analysis.ok,
    repo,
    missing: false,
    updated: true,
    created: !detail,
    ...analysis,
  };
}

function runCli(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const result = syncRepositoryRulesets(options, deps);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (options.check) {
    const status = result.ok ? 'ok' : 'drift';
    console.log(`Repository ruleset ${status}: ${result.repo}`);
    if (!result.ok) {
      for (const issue of result.issues || []) {
        console.log(`- ${issue}`);
      }
    }
  } else {
    const action = result.created ? 'created' : 'synced';
    console.log(`Repository ruleset ${action}: ${result.repo}`);
    if (!result.ok) {
      for (const issue of result.issues || []) {
        console.log(`- ${issue}`);
      }
    }
  }

  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = runCli();
}

module.exports = {
  FORBIDDEN_BYPASS_ACTOR_TYPES,
  analyzeBypassActors,
  analyzeRuleset,
  assertSafeGhArgs,
  buildExpectedRulesetBody,
  buildExpectedRulesPayload,
  compareClassicAndRulesetContexts,
  diffContexts,
  expectedStatusContexts,
  extractStatusCheckParams,
  extractStatusContexts,
  findMainGovernanceRuleset,
  loadClassicBranchProtectionContexts,
  loadRulesetDetail,
  loadRulesets,
  normalizeContexts,
  parseArgs,
  prepareGhEnv,
  resolveGhBinary,
  runCli,
  splitRepo,
  syncRepositoryRulesets,
  upsertRuleset,
};
