'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertSafeBranchPattern,
  assertSafeGhArgs,
  assertSafeRuleId,
  assertSafeStatusContext,
  diffContexts,
  normalizeContexts,
  parseRestRuleId,
  runCli,
  resolveGhBinary,
  syncBranchProtection,
} = require('../scripts/sync-branch-protection');

function createRunner(results) {
  const queue = [...results];
  return (args) => {
    if (queue.length === 0) {
      throw new Error(`Unexpected GH CLI call: ${args.join(' ')}`);
    }

    return queue.shift();
  };
}

test('normalizeContexts sorts and deduplicates status check contexts', () => {
  assert.deepEqual(
    normalizeContexts(['test', 'CodeQL', 'test', ' SonarCloud Code Analysis ']),
    ['CodeQL', 'SonarCloud Code Analysis', 'test']
  );
});

test('syncBranchProtection validators reject unsafe CLI and GraphQL input', () => {
  assert.deepEqual(assertSafeGhArgs(['api', 'graphql']), ['api', 'graphql']);
  assert.deepEqual(assertSafeGhArgs(['api', 'query=\n  mutation { viewer { login } }\n']), ['api', 'query=\n  mutation { viewer { login } }\n']);
  assert.equal(assertSafeBranchPattern('main'), 'main');
  assert.equal(assertSafeRuleId('BPR_123='), 'BPR_123=');
  assert.equal(assertSafeStatusContext('SonarCloud Code Analysis'), 'SonarCloud Code Analysis');
  assert.throws(() => assertSafeGhArgs([`api${String.fromCharCode(0)}boom`]), /Unsafe GH CLI arg/);
  assert.throws(() => assertSafeBranchPattern('../main'), /Unsafe branch pattern/);
  assert.throws(() => assertSafeRuleId('BPR 123'), /Unsafe branch protection rule id/);
  assert.throws(() => assertSafeStatusContext('bad\ncontext'), /Unsafe status check context/);
});

test('syncBranchProtection resolves gh from fixed executable paths only', () => {
  const calls = [];
  const accessSync = (candidate, mode) => {
    calls.push([candidate, mode]);
    if (candidate !== '/usr/bin/gh') {
      throw new Error('missing');
    }
  };

  const result = resolveGhBinary({ accessSync });
  assert.equal(result, '/usr/bin/gh');
  assert.equal(calls[0][0], '/usr/bin/gh');
});

test('diffContexts identifies missing and unexpected required contexts', () => {
  const result = diffContexts(
    ['test', 'CodeQL'],
    ['test', 'CodeQL', 'SonarCloud Code Analysis']
  );

  assert.deepEqual(result.missing, ['SonarCloud Code Analysis']);
  assert.deepEqual(result.unexpected, []);
});

test('syncBranchProtection --check reports drift when main is missing SonarCloud Code Analysis', () => {
  const runner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify({
        data: {
          repository: {
            branchProtectionRules: {
              nodes: [
                {
                  id: 'BPR_123',
                  pattern: 'main',
                  requiresStatusChecks: true,
                  requiredStatusCheckContexts: ['test', 'CodeQL']
                }
              ]
            }
          }
        }
      }),
      stderr: ''
    }
  ]);

  const result = syncBranchProtection({ check: true, repo: 'IgorGanapolsky/ThumbGate', branch: 'main' }, runner);
  assert.equal(result.ok, false);
  assert.ok(result.diff.missing.includes('SonarCloud Code Analysis'));
});

test('syncBranchProtection falls back to REST branch protection when GraphQL returns no rules', () => {
  const runner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify({
        data: {
          repository: {
            branchProtectionRules: {
              nodes: []
            }
          }
        }
      }),
      stderr: ''
    },
    {
      status: 0,
      stdout: JSON.stringify({
        required_status_checks: {
          contexts: [
            'test',
            'CodeQL',
            'Analyze JavaScript (javascript-typescript)',
            'Verify changeset',
            'SonarCloud Code Analysis',
            'GitGuardian Security Checks',
            'Socket Security: Project Report'
          ]
        }
      }),
      stderr: ''
    }
  ]);

  const result = syncBranchProtection({ check: true, repo: 'IgorGanapolsky/ThumbGate', branch: 'main' }, runner);
  assert.equal(result.ok, true);
  assert.equal(result.ruleId, 'rest:IgorGanapolsky/ThumbGate#main');
  assert.deepEqual(result.diff, { missing: [], unexpected: [] });
});

test('parseRestRuleId validates REST fallback rule ids', () => {
  assert.deepEqual(parseRestRuleId('rest:IgorGanapolsky/ThumbGate#main'), {
    owner: 'IgorGanapolsky',
    name: 'ThumbGate',
    branch: 'main'
  });
  assert.equal(parseRestRuleId('BPR_123'), null);
  assert.throws(() => parseRestRuleId('rest:IgorGanapolsky/ThumbGate#../main'), /Unsafe branch pattern/);
});

test('syncBranchProtection updates main branch protection to the configured quality checks', () => {
  const runner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify({
        data: {
          repository: {
            branchProtectionRules: {
              nodes: [
                {
                  id: 'BPR_123',
                  pattern: 'main',
                  requiresStatusChecks: true,
                  requiredStatusCheckContexts: ['test', 'CodeQL']
                }
              ]
            }
          }
        }
      }),
      stderr: ''
    },
    {
      status: 0,
      stdout: JSON.stringify({
        data: {
          updateBranchProtectionRule: {
            branchProtectionRule: {
              id: 'BPR_123',
              pattern: 'main',
              requiresStatusChecks: true,
              requiredStatusCheckContexts: [
                'test',
                'CodeQL',
                'Analyze JavaScript (javascript-typescript)',
                'Verify changeset',
                'SonarCloud Code Analysis',
                'GitGuardian Security Checks',
                'Socket Security: Project Report'
              ]
            }
          }
        }
      }),
      stderr: ''
    }
  ]);

  const result = syncBranchProtection({ repo: 'IgorGanapolsky/ThumbGate', branch: 'main' }, runner);
  assert.equal(result.ok, true);
  assert.equal(result.updated, true);
  assert.equal(result.actualContexts.includes('SonarCloud Code Analysis'), true);
  assert.deepEqual(result.diff, { missing: [], unexpected: [] });
});

test('syncBranchProtection rejects invalid repository names before invoking gh', () => {
  assert.throws(() => syncBranchProtection({ check: true, repo: 'IgorGanapolsky/ThumbGate;rm' }), /Unsafe repository name/);
});

test('syncBranchProtection throws when the protected branch rule does not exist', () => {
  const runner = createRunner([
    {
      status: 0,
      stdout: JSON.stringify({
        data: {
          repository: {
            branchProtectionRules: {
              nodes: []
            }
          }
        }
      }),
      stderr: ''
    },
    {
      status: 1,
      stdout: '',
      stderr: 'Not Found'
    }
  ]);

  assert.throws(
    () => syncBranchProtection({ check: true, repo: 'IgorGanapolsky/ThumbGate', branch: 'main' }, runner),
    /No branch protection rule found/
  );
});

test('runCli exits nonzero when branch protection drifts from the configured quality checks', () => {
  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(value);

  try {
    const runner = createRunner([
      {
        status: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              branchProtectionRules: {
                nodes: [
                  {
                    id: 'BPR_123',
                    pattern: 'main',
                    requiresStatusChecks: true,
                    requiredStatusCheckContexts: ['test']
                  }
                ]
              }
            }
          }
        }),
        stderr: ''
      }
    ]);
    const exitCode = runCli(['--check', '--repo', 'IgorGanapolsky/ThumbGate', '--branch', 'main'], runner);
    assert.equal(exitCode, 1);
  } finally {
    console.log = originalLog;
  }

  assert.match(output.join('\n'), /Branch protection drift: IgorGanapolsky\/ThumbGate main/);
});
