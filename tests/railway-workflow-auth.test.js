'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/deploy-railway.yml'), 'utf8');

for (const fixture of [
  { name: 'API only', api: 'api-fixture', project: '', selected: 'RAILWAY_API_TOKEN' },
  { name: 'project only', api: '', project: 'project-fixture', selected: 'RAILWAY_TOKEN' },
  { name: 'API supersedes stale project token', api: 'api-fixture', project: 'stale-fixture', selected: 'RAILWAY_API_TOKEN' },
  { name: 'neither token', api: '', project: '', selected: null },
]) {
  test(`Railway workflow exports exactly one credential: ${fixture.name}`, () => {
    const step = workflow.match(/      - name: Select Railway deployment credential\n([\s\S]*?)(?=\n      - )/);
    assert.ok(step, 'workflow must select the credential before checking deployment configuration');
    assert.match(step[1], /RAILWAY_API_TOKEN_INPUT: \$\{\{ secrets\.RAILWAY_API_TOKEN \}\}/);
    assert.match(step[1], /RAILWAY_PROJECT_TOKEN_INPUT: \$\{\{ secrets\.RAILWAY_TOKEN \}\}/);
    const script = step[1].split('        run: |\n')[1].replace(/^          /gm, '');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'railway-auth-test-'));
    const envFile = path.join(dir, 'github-env');
    try {
      fs.writeFileSync(envFile, '');
      const result = spawnSync('bash', ['-e', '-c', script], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          GITHUB_ENV: envFile,
          RAILWAY_API_TOKEN_INPUT: fixture.api,
          RAILWAY_PROJECT_TOKEN_INPUT: fixture.project,
        },
      });
      const exported = fs.readFileSync(envFile, 'utf8').trim().split('\n').filter(Boolean);
      if (!fixture.selected) {
        assert.notEqual(result.status, 0);
        assert.deepEqual(exported, []);
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(exported, [`${fixture.selected}=${fixture.selected === 'RAILWAY_API_TOKEN' ? fixture.api : fixture.project}`]);
      }
      const jobEnvironment = workflow.split('    env:\n')[1].split('    steps:\n')[0];
      assert.doesNotMatch(jobEnvironment, /^      RAILWAY_(?:API_)?TOKEN:/m,
        'an empty job-level project token overrides API auth in the Railway CLI');
      for (const value of [fixture.api, fixture.project].filter(Boolean)) {
        assert.ok(!`${result.stdout}${result.stderr}`.includes(value), 'credential selection must not log values');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
