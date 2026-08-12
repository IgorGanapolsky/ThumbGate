'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeBypassActors,
  analyzeRuleset,
  buildExpectedRulesetBody,
  expectedStatusContexts,
  extractStatusContexts,
  findMainGovernanceRuleset,
  normalizeContexts,
  parseArgs,
  runCli,
  syncRepositoryRulesets,
} = require('../scripts/sync-repository-rulesets');

const MERGE_QUALITY = {
  requiredStatusCheckContexts: [
    'test',
    'CodeQL',
    'Analyze JavaScript (javascript-typescript)',
    'Verify changeset',
    'GitGuardian Security Checks',
    'Socket Security: Project Report',
    'Socket Security: Pull Request Alerts',
  ],
};

const POLICY = {
  name: 'main governance',
  target: 'branch',
  enforcement: 'active',
  conditions: {
    ref_name: {
      include: ['refs/heads/main'],
      exclude: [],
    },
  },
  bypass_actors: [],
  rules: {
    required_linear_history: true,
    deletion: true,
    non_fast_forward: true,
    pull_request: {
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_review_thread_resolution: true,
      allowed_merge_methods: ['squash', 'rebase'],
    },
    required_status_checks: {
      strict_required_status_checks_policy: true,
      do_not_enforce_on_create: false,
      contexts_from: 'merge-quality-checks',
    },
  },
};

function createRunner(results) {
  const queue = [...results];
  return (args) => {
    if (queue.length === 0) {
      throw new Error(`Unexpected GH CLI call: ${args.join(' ')}`);
    }
    return queue.shift();
  };
}

test('parseArgs understands check/json/repo flags', () => {
  assert.deepEqual(parseArgs(['--check', '--json', '--repo', 'IgorGanapolsky/ThumbGate']), {
    check: true,
    json: true,
    repo: 'IgorGanapolsky/ThumbGate',
  });
});

test('expectedStatusContexts pulls merge-quality required checks', () => {
  const contexts = expectedStatusContexts(POLICY, MERGE_QUALITY);
  assert.ok(contexts.includes('GitGuardian Security Checks'));
  assert.ok(contexts.includes('test'));
  assert.deepEqual(contexts, normalizeContexts(MERGE_QUALITY.requiredStatusCheckContexts));
});

test('buildExpectedRulesetBody pins zero bypass and required rules', () => {
  const body = buildExpectedRulesetBody(POLICY, MERGE_QUALITY);
  assert.equal(body.name, 'main governance');
  assert.equal(body.enforcement, 'active');
  assert.deepEqual(body.bypass_actors, []);
  assert.ok(body.rules.some((rule) => rule.type === 'non_fast_forward'));
  assert.ok(body.rules.some((rule) => rule.type === 'required_linear_history'));
  assert.ok(body.rules.some((rule) => rule.type === 'pull_request'));
  const status = body.rules.find((rule) => rule.type === 'required_status_checks');
  assert.equal(status.parameters.strict_required_status_checks_policy, true);
  assert.ok(
    status.parameters.required_status_checks.some((check) => check.context === 'CodeQL'),
  );
});

test('analyzeBypassActors rejects User/OrganizationAdmin bypass', () => {
  const result = analyzeBypassActors([
    { actor_id: 1, actor_type: 'User', bypass_mode: 'always' },
  ], POLICY);
  assert.equal(result.ok, false);
  assert.equal(result.unexpectedHumanBypass, true);
});

test('analyzeBypassActors accepts empty bypass list', () => {
  const result = analyzeBypassActors([], POLICY);
  assert.equal(result.ok, true);
});

test('findMainGovernanceRuleset matches by name or main include', () => {
  const byName = findMainGovernanceRuleset([
    { id: 1, name: 'main governance', target: 'branch' },
  ], POLICY);
  assert.equal(byName.id, 1);

  const byInclude = findMainGovernanceRuleset([
    {
      id: 2,
      name: 'legacy',
      target: 'branch',
      conditions: { ref_name: { include: ['refs/heads/main'] } },
    },
  ], POLICY);
  assert.equal(byInclude.id, 2);
});

test('extractStatusContexts reads required_status_checks rule', () => {
  const contexts = extractStatusContexts({
    rules: [{
      type: 'required_status_checks',
      parameters: {
        required_status_checks: [{ context: 'test' }, { context: 'CodeQL' }],
      },
    }],
  });
  assert.deepEqual(contexts, ['CodeQL', 'test']);
});

test('analyzeRuleset reports missing ruleset pieces as drift', () => {
  const analysis = analyzeRuleset({
    id: 9,
    name: 'main governance',
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: ['refs/heads/main'] } },
    rules: [{ type: 'deletion' }],
  }, POLICY, MERGE_QUALITY);

  assert.equal(analysis.ok, false);
  assert.ok(analysis.issues.some((issue) => /missing status checks/i.test(issue)));
  assert.ok(analysis.issues.some((issue) => /non_fast_forward/i.test(issue)));
});

test('syncRepositoryRulesets --check reports missing main ruleset', () => {
  const runner = createRunner([
    { status: 0, stdout: '[]', stderr: '' },
  ]);

  const result = syncRepositoryRulesets(
    { check: true, repo: 'IgorGanapolsky/ThumbGate' },
    { runner, policy: POLICY, mergeQuality: MERGE_QUALITY },
  );

  assert.equal(result.ok, false);
  assert.equal(result.missing, true);
});

test('syncRepositoryRulesets --check is ok when live ruleset matches policy', () => {
  const body = buildExpectedRulesetBody(POLICY, MERGE_QUALITY);
  const detail = {
    id: 42,
    ...body,
  };

  const runner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify([{ id: 42, name: 'main governance', target: 'branch' }]),
      stderr: '',
    },
    {
      status: 0,
      stdout: JSON.stringify(detail),
      stderr: '',
    },
  ]);

  const result = syncRepositoryRulesets(
    { check: true, repo: 'IgorGanapolsky/ThumbGate' },
    { runner, policy: POLICY, mergeQuality: MERGE_QUALITY },
  );

  assert.equal(result.ok, true);
  assert.equal(result.rulesetId, 42);
  assert.deepEqual(result.contextDiff, { missing: [], unexpected: [] });
});

test('syncRepositoryRulesets creates a ruleset when absent', () => {
  const body = buildExpectedRulesetBody(POLICY, MERGE_QUALITY);
  const created = { id: 77, ...body };
  const calls = [];

  const runner = createRunner([
    { status: 0, stdout: '[]', stderr: '' },
  ]);
  const runnerWithInput = (args, input) => {
    calls.push({ args, input: JSON.parse(input) });
    return { status: 0, stdout: JSON.stringify(created), stderr: '' };
  };

  const result = syncRepositoryRulesets(
    { repo: 'IgorGanapolsky/ThumbGate' },
    { runner, runnerWithInput, policy: POLICY, mergeQuality: MERGE_QUALITY },
  );

  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.rulesetId, 77);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('POST'));
  assert.deepEqual(calls[0].input.bypass_actors, []);
  assert.equal(calls[0].input.enforcement, 'active');
});

test('syncRepositoryRulesets updates an existing drifted ruleset', () => {
  const body = buildExpectedRulesetBody(POLICY, MERGE_QUALITY);
  const detail = {
    id: 55,
    name: 'main governance',
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [{ actor_id: 1, actor_type: 'User', bypass_mode: 'always' }],
    conditions: { ref_name: { include: ['refs/heads/main'] } },
    rules: [{ type: 'deletion' }],
  };
  const updated = { id: 55, ...body };
  const calls = [];

  const runner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify([{ id: 55, name: 'main governance', target: 'branch' }]),
      stderr: '',
    },
    {
      status: 0,
      stdout: JSON.stringify(detail),
      stderr: '',
    },
  ]);
  const runnerWithInput = (args, input) => {
    calls.push({ args, input: JSON.parse(input) });
    return { status: 0, stdout: JSON.stringify(updated), stderr: '' };
  };

  const result = syncRepositoryRulesets(
    { repo: 'IgorGanapolsky/ThumbGate' },
    { runner, runnerWithInput, policy: POLICY, mergeQuality: MERGE_QUALITY },
  );

  assert.equal(result.ok, true);
  assert.equal(result.created, false);
  assert.equal(result.updated, true);
  assert.ok(calls[0].args.includes('PUT'));
  assert.ok(calls[0].args.some((arg) => String(arg).endsWith('/rulesets/55')));
  assert.deepEqual(calls[0].input.bypass_actors, []);
});

test('runCli exits nonzero on ruleset drift', () => {
  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(value);

  try {
    const runner = createRunner([
      { status: 0, stdout: '[]', stderr: '' },
    ]);
    const exitCode = runCli(
      ['--check', '--repo', 'IgorGanapolsky/ThumbGate'],
      { runner, policy: POLICY, mergeQuality: MERGE_QUALITY },
    );
    assert.equal(exitCode, 1);
  } finally {
    console.log = originalLog;
  }

  assert.match(output.join('\n'), /Repository ruleset drift/);
});
