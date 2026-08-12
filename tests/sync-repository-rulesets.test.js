'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FORBIDDEN_BYPASS_ACTOR_TYPES,
  analyzeBypassActors,
  analyzeRuleset,
  assertSafeGhArgs,
  buildExpectedRulesPayload,
  buildExpectedRulesetBody,
  diffContexts,
  expectedStatusContexts,
  extractStatusCheckParams,
  extractStatusContexts,
  findMainGovernanceRuleset,
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

test('findMainGovernanceRuleset matches only the named governance ruleset', () => {
  const byName = findMainGovernanceRuleset([
    { id: 1, name: 'main governance', target: 'branch' },
  ], POLICY);
  assert.equal(byName.id, 1);

  const otherMain = findMainGovernanceRuleset([
    {
      id: 2,
      name: 'legacy',
      target: 'branch',
      conditions: { ref_name: { include: ['refs/heads/main'] } },
    },
  ], POLICY);
  assert.equal(otherMain, null);
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

test('analyzeRuleset flags strict status-check policy drift', () => {
  const body = buildExpectedRulesetBody(POLICY, MERGE_QUALITY);
  const statusRule = body.rules.find((rule) => rule.type === 'required_status_checks');
  statusRule.parameters.strict_required_status_checks_policy = false;

  const analysis = analyzeRuleset({
    id: 11,
    ...body,
  }, POLICY, MERGE_QUALITY);

  assert.equal(analysis.ok, false);
  assert.ok(analysis.issues.some((issue) => /strict_required_status_checks_policy/i.test(issue)));
});

test('prepareGhEnv promotes GH_PAT to GH_TOKEN', () => {
  const env = prepareGhEnv({ GH_PAT: 'pat-value', PATH: '/usr/bin' });
  assert.equal(env.GH_TOKEN, 'pat-value');
});

test('syncRepositoryRulesets --check reports missing main ruleset', () => {
  const runner = createRunner([
    { status: 0, stdout: '[]', stderr: '' },
  ]);

  const result = syncRepositoryRulesets(
    { check: true, repo: 'IgorGanapolsky/ThumbGate' },
    {
      runner,
      policy: POLICY,
      mergeQuality: MERGE_QUALITY,
      loadClassic: () => ({ present: false, contexts: [] }),
    },
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
    {
      runner,
      policy: POLICY,
      mergeQuality: MERGE_QUALITY,
      loadClassic: () => ({
        present: true,
        contexts: MERGE_QUALITY.requiredStatusCheckContexts,
      }),
    },
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
      {
        runner,
        policy: POLICY,
        mergeQuality: MERGE_QUALITY,
        loadClassic: () => ({ present: false, contexts: [] }),
      },
    );
    assert.equal(exitCode, 1);
  } finally {
    console.log = originalLog;
  }

  assert.match(output.join('\n'), /Repository ruleset drift/);
});

test('assertSafeGhArgs and splitRepo reject unsafe input', () => {
  assert.deepEqual(assertSafeGhArgs(['api', 'graphql']), ['api', 'graphql']);
  assert.throws(() => assertSafeGhArgs([`api${String.fromCharCode(0)}x`]), /Unsafe GH CLI arg/);
  assert.deepEqual(splitRepo('IgorGanapolsky/ThumbGate'), {
    owner: 'IgorGanapolsky',
    name: 'ThumbGate',
  });
  assert.throws(() => splitRepo('not-a-repo'), /Invalid repository/);
  assert.throws(() => splitRepo('bad/name;rm'), /Unsafe repository name/);
});

test('diffContexts and normalizeContexts behave like branch-protection helpers', () => {
  assert.deepEqual(
    normalizeContexts(['test', 'CodeQL', 'test', ' CodeQL ']),
    ['CodeQL', 'test'],
  );
  assert.deepEqual(diffContexts(['test'], ['test', 'CodeQL']), {
    missing: ['CodeQL'],
    unexpected: [],
  });
});

test('resolveGhBinary uses fixed executable paths', () => {
  const accessSync = (candidate) => {
    if (candidate !== '/usr/bin/gh') {
      throw new Error('missing');
    }
  };
  assert.equal(resolveGhBinary({ accessSync }), '/usr/bin/gh');
});

test('prepareGhEnv keeps GH_TOKEN and strips ambient GITHUB_TOKEN outside Actions', () => {
  const withToken = prepareGhEnv({ GH_TOKEN: 'tok', GITHUB_TOKEN: 'ambient', PATH: '/bin' });
  assert.equal(withToken.GH_TOKEN, 'tok');
  assert.equal(withToken.GITHUB_TOKEN, 'ambient');

  const ambientOnly = prepareGhEnv({ GITHUB_TOKEN: 'ambient', PATH: '/bin' });
  assert.equal(ambientOnly.GITHUB_TOKEN, undefined);
});

test('buildExpectedRulesPayload omits optional rule types when disabled', () => {
  const policy = {
    ...POLICY,
    rules: {
      ...POLICY.rules,
      required_linear_history: false,
      deletion: false,
      non_fast_forward: false,
    },
  };
  const rules = buildExpectedRulesPayload(policy, MERGE_QUALITY);
  assert.equal(rules.some((rule) => rule.type === 'required_linear_history'), false);
  assert.equal(rules.some((rule) => rule.type === 'deletion'), false);
  assert.equal(rules.some((rule) => rule.type === 'non_fast_forward'), false);
  assert.ok(rules.some((rule) => rule.type === 'pull_request'));
  assert.ok(rules.some((rule) => rule.type === 'required_status_checks'));
});

test('expectedStatusContexts can use inline contexts when not merge-quality', () => {
  const policy = {
    ...POLICY,
    rules: {
      ...POLICY.rules,
      required_status_checks: {
        contexts: ['only-a', 'only-b'],
      },
    },
  };
  assert.deepEqual(expectedStatusContexts(policy, MERGE_QUALITY), ['only-a', 'only-b']);
});

test('extractStatusCheckParams returns required_status_checks parameters', () => {
  const params = extractStatusCheckParams({
    rules: [{
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
      },
    }],
  });
  assert.equal(params.strict_required_status_checks_policy, true);
  assert.equal(extractStatusCheckParams({ rules: [] }), null);
});

test('analyzeRuleset flags do_not_enforce_on_create drift and forbidden bypass', () => {
  const body = buildExpectedRulesetBody(POLICY, MERGE_QUALITY);
  const statusRule = body.rules.find((rule) => rule.type === 'required_status_checks');
  statusRule.parameters.do_not_enforce_on_create = true;

  const analysis = analyzeRuleset({
    id: 12,
    ...body,
    bypass_actors: [{ actor_id: 9, actor_type: 'OrganizationAdmin', bypass_mode: 'always' }],
  }, POLICY, MERGE_QUALITY);

  assert.equal(analysis.ok, false);
  assert.ok(analysis.issues.some((issue) => /do_not_enforce_on_create/i.test(issue)));
  assert.ok(analysis.issues.some((issue) => /forbidden bypass/i.test(issue)));
  assert.ok(FORBIDDEN_BYPASS_ACTOR_TYPES.has('OrganizationAdmin'));
});

test('analyzeRuleset flags pull_request and ref include drift', () => {
  const body = buildExpectedRulesetBody(POLICY, MERGE_QUALITY);
  const prRule = body.rules.find((rule) => rule.type === 'pull_request');
  prRule.parameters.required_review_thread_resolution = false;
  prRule.parameters.required_approving_review_count = 2;

  const analysis = analyzeRuleset({
    id: 13,
    ...body,
    conditions: { ref_name: { include: ['refs/heads/develop'] } },
    enforcement: 'disabled',
    target: 'tag',
  }, POLICY, MERGE_QUALITY);

  assert.equal(analysis.ok, false);
  assert.ok(analysis.issues.some((issue) => /required_review_thread_resolution/i.test(issue)));
  assert.ok(analysis.issues.some((issue) => /required_approving_review_count/i.test(issue)));
  assert.ok(analysis.issues.some((issue) => /refs\/heads\/main/i.test(issue)));
  assert.ok(analysis.issues.some((issue) => /enforcement/i.test(issue)));
  assert.ok(analysis.issues.some((issue) => /target/i.test(issue)));
});

test('loadRulesets and loadRulesetDetail parse successful responses and throw on failure', () => {
  const okRunner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify([{ id: 1, name: 'main governance' }]),
      stderr: '',
    },
  ]);
  assert.equal(loadRulesets('IgorGanapolsky/ThumbGate', okRunner)[0].id, 1);

  const failRunner = createRunner([
    { status: 1, stdout: '', stderr: 'boom' },
  ]);
  assert.throws(
    () => loadRulesets('IgorGanapolsky/ThumbGate', failRunner),
    /Failed to load rulesets/,
  );

  const detailRunner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify({ id: 5, name: 'main governance' }),
      stderr: '',
    },
  ]);
  assert.equal(loadRulesetDetail('IgorGanapolsky/ThumbGate', 5, detailRunner).id, 5);
  assert.throws(
    () => loadRulesetDetail('IgorGanapolsky/ThumbGate', 'not-a-number', createRunner([])),
    /Unsafe ruleset id/,
  );
});

test('upsertRuleset posts create and puts update payloads', () => {
  const body = buildExpectedRulesetBody(POLICY, MERGE_QUALITY);
  const createCalls = [];
  const createRunner = (args, input) => {
    createCalls.push({ args, input });
    return { status: 0, stdout: JSON.stringify({ id: 9, ...JSON.parse(input) }), stderr: '' };
  };
  const created = upsertRuleset('IgorGanapolsky/ThumbGate', body, null, createRunner);
  assert.equal(created.id, 9);
  assert.ok(createCalls[0].args.includes('POST'));

  const updateCalls = [];
  const updateRunner = (args, input) => {
    updateCalls.push({ args, input });
    return { status: 0, stdout: JSON.stringify({ id: 9, ...JSON.parse(input) }), stderr: '' };
  };
  const updated = upsertRuleset('IgorGanapolsky/ThumbGate', body, 9, updateRunner);
  assert.equal(updated.id, 9);
  assert.ok(updateCalls[0].args.includes('PUT'));
  assert.ok(updateCalls[0].args.some((arg) => String(arg).endsWith('/rulesets/9')));

  assert.throws(
    () => upsertRuleset(
      'IgorGanapolsky/ThumbGate',
      body,
      null,
      () => ({ status: 1, stdout: '', stderr: 'create failed' }),
    ),
    /Failed to create ruleset/,
  );
  assert.throws(
    () => upsertRuleset(
      'IgorGanapolsky/ThumbGate',
      body,
      9,
      () => ({ status: 1, stdout: '', stderr: 'update failed' }),
    ),
    /Failed to update ruleset/,
  );
});

test('runCli prints ok and json outputs', () => {
  const body = buildExpectedRulesetBody(POLICY, MERGE_QUALITY);
  const detail = { id: 42, ...body };
  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(String(value));

  try {
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

    const matchingClassic = () => ({
      present: true,
      contexts: MERGE_QUALITY.requiredStatusCheckContexts,
    });

    const checkCode = runCli(
      ['--check', '--json', '--repo', 'IgorGanapolsky/ThumbGate'],
      {
        runner,
        policy: POLICY,
        mergeQuality: MERGE_QUALITY,
        loadClassic: matchingClassic,
      },
    );
    assert.equal(checkCode, 0);
    assert.match(output.join('\n'), /"ok": true/);

    const textCode = runCli(
      ['--check', '--repo', 'IgorGanapolsky/ThumbGate'],
      {
        runner,
        policy: POLICY,
        mergeQuality: MERGE_QUALITY,
        loadClassic: matchingClassic,
      },
    );
    assert.equal(textCode, 0);
    assert.match(output.join('\n'), /Repository ruleset ok/);
  } finally {
    console.log = originalLog;
  }
});

test('syncRepositoryRulesets reloads detail when upsert omits rules array', () => {
  const body = buildExpectedRulesetBody(POLICY, MERGE_QUALITY);
  const detail = { id: 88, ...body };
  const runner = createRunner([
    { status: 0, stdout: '[]', stderr: '' },
    { status: 0, stdout: JSON.stringify(detail), stderr: '' },
  ]);
  const runnerWithInput = () => ({
    status: 0,
    stdout: JSON.stringify({ id: 88, name: 'main governance' }),
    stderr: '',
  });

  const result = syncRepositoryRulesets(
    { repo: 'IgorGanapolsky/ThumbGate' },
    { runner, runnerWithInput, policy: POLICY, mergeQuality: MERGE_QUALITY },
  );
  assert.equal(result.ok, true);
  assert.equal(result.rulesetId, 88);
  assert.equal(result.created, true);
});

test('compareClassicAndRulesetContexts detects dual-surface status check drift', () => {
  const { compareClassicAndRulesetContexts } = require('../scripts/sync-repository-rulesets');
  const classic = {
    present: true,
    contexts: ['test', 'CodeQL'],
  };
  const ruleset = ['test', 'CodeQL', 'Verify changeset'];
  const expected = ['test', 'CodeQL', 'Verify changeset', 'GitGuardian Security Checks'];
  const result = compareClassicAndRulesetContexts(classic, ruleset, expected);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('classic missing checks present on ruleset')));
  assert.ok(result.issues.some((issue) => issue.includes('merge-quality')));
});

test('compareClassicAndRulesetContexts is ok when classic and ruleset match merge-quality', () => {
  const { compareClassicAndRulesetContexts } = require('../scripts/sync-repository-rulesets');
  const contexts = [
    'Analyze JavaScript (javascript-typescript)',
    'CodeQL',
    'GitGuardian Security Checks',
    'Socket Security: Project Report',
    'Socket Security: Pull Request Alerts',
    'Verify changeset',
    'test',
  ];
  const result = compareClassicAndRulesetContexts(
    { present: true, contexts },
    contexts,
    contexts,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test('syncRepositoryRulesets --check folds classic/ruleset dual drift into issues', () => {
  const detail = {
    id: 42,
    name: 'main governance',
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: ['refs/heads/main'] } },
    rules: [
      { type: 'required_linear_history' },
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: MERGE_QUALITY.requiredStatusCheckContexts.map((context) => ({ context })),
        },
      },
    ],
  };

  const runner = createRunner([
    { status: 0, stdout: JSON.stringify([{ id: 42, name: 'main governance', target: 'branch' }]), stderr: '' },
    { status: 0, stdout: JSON.stringify(detail), stderr: '' },
  ]);

  const loadClassic = () => ({
    present: true,
    contexts: ['test', 'CodeQL'],
  });

  const result = syncRepositoryRulesets(
    { check: true, repo: 'IgorGanapolsky/ThumbGate' },
    { runner, policy: POLICY, mergeQuality: MERGE_QUALITY, loadClassic },
  );
  assert.equal(result.ok, false);
  assert.ok(result.dual);
  assert.equal(result.dual.classicPresent, true);
  assert.ok(result.issues.some((issue) => /classic/i.test(issue)));
});
