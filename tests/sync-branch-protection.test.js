'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  diffContexts,
  normalizeContexts,
  runCli,
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
                'Socket Security: Project Report',
                'Socket Security: Pull Request Alerts'
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
