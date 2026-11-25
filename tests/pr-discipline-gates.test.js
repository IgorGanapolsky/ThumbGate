'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gates = require('../scripts/pr-discipline-gates');

function fakeGh(routes) {
  return async (pathname) => {
    for (const [pattern, value] of routes) {
      if (pattern instanceof RegExp ? pattern.test(pathname) : pathname === pattern) {
        return typeof value === 'function' ? value(pathname) : value;
      }
    }
    throw new Error(`unexpected GitHub call ${pathname}`);
  };
}

function files(n, linesEach = 1, prefix = 'src/f') {
  return Array.from({ length: n }, (_, i) => ({ filename: `${prefix}${i}.js`, additions: linesEach, deletions: 0 }));
}

const PR = { owner: 'o', repo: 'r', head: 'claude/x', base: 'main', title: 'feat(connector): hosted MCP keeps sign-in across redeploys' };

test('(c) PR create over 40 files is denied', async () => {
  const gh = fakeGh([[/\/compare\//, { files: files(41) }]]);
  const r = await gates.evaluatePrCreate(PR, { gh });
  assert.equal(r.deny, true);
  assert.equal(r.rule, 'pr-size');
});

test('(c) PR create over 1,000 lines is denied; lockfiles do not count', async () => {
  const big = await gates.evaluatePrCreate(PR, { gh: fakeGh([[/\/compare\//, { files: files(5, 201) }]]) });
  assert.equal(big.rule, 'pr-size');
  const lock = await gates.evaluatePrCreate(PR, {
    gh: fakeGh([
      [/\/compare\//, { files: [...files(2, 10), { filename: 'package-lock.json', additions: 5000, deletions: 0 }] }],
      [/\/pulls\?state=open/, []],
    ]),
  });
  assert.equal(lock.deny, false);
});

test('(b) PR create with the same title as an open PR is denied', async () => {
  const gh = fakeGh([
    [/\/compare\//, { files: files(2) }],
    [/\/pulls\?state=open/, [{ number: 7, title: 'fix(connector): hosted MCP keeps sign in across redeploys', head: { ref: 'claude/other' } }]],
  ]);
  const r = await gates.evaluatePrCreate(PR, { gh });
  assert.equal(r.rule, 'pr-duplicate');
  assert.match(r.reason, /#7/);
});

test('(b) PR create that overlaps the same files as an open PR is denied; changesets ignored', async () => {
  const ours = [{ filename: 'src/api/server.js', additions: 3 }, { filename: 'scripts/mcp-oauth.js', additions: 3 }, { filename: '.changeset/a.md', additions: 1 }];
  const gh = fakeGh([
    [/\/compare\//, { files: ours }],
    [/\/pulls\?state=open/, [{ number: 9, title: 'Unrelated title words here', head: { ref: 'claude/y' } }]],
    [/\/pulls\/9\/files/, [{ filename: 'scripts/mcp-oauth.js' }, { filename: '.changeset/a.md' }]],
  ]);
  const r = await gates.evaluatePrCreate(PR, { gh });
  assert.equal(r.rule, 'pr-duplicate');
  assert.match(r.reason, /#9/);

  const noOverlap = await gates.evaluatePrCreate(PR, {
    gh: fakeGh([
      [/\/compare\//, { files: ours }],
      [/\/pulls\?state=open/, [{ number: 9, title: 'Unrelated title words here', head: { ref: 'claude/y' } }]],
      [/\/pulls\/9\/files/, [{ filename: '.changeset/a.md' }, { filename: 'README.md' }]],
    ]),
  });
  assert.equal(noOverlap.deny, false);
});

test('(b) the PR for the same branch is not its own duplicate', async () => {
  const gh = fakeGh([
    [/\/compare\//, { files: files(2) }],
    [/\/pulls\?state=open/, [{ number: 5, title: PR.title, head: { ref: PR.head } }]],
  ]);
  assert.equal((await gates.evaluatePrCreate(PR, { gh })).deny, false);
});

test('gh pr create is parsed into a PR request', () => {
  const p = gates.parseGhPrCreate('gh pr create --title "feat: x y z" --base main --head claude/x --repo o/r');
  assert.deepEqual(p, { title: 'feat: x y z', base: 'main', head: 'claude/x', repo: 'o/r' });
  assert.equal(gates.parseGhPrCreate('gh pr view 5'), null);
  const mcp = gates.prFromToolInput('mcp__github__create_pull_request', { owner: 'o', repo: 'r', head: 'h', base: 'main', title: 't' });
  assert.equal(mcp.head, 'h');
});

function ledgerEnv() {
  return { THUMBGATE_PR_LEDGER_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ledger-')), HOME: os.tmpdir() };
}

test('(a) Stop is blocked while a PR this session opened is red, then allowed once green', async () => {
  const env = ledgerEnv();
  const recorded = gates.recordOpenedPrs({
    session_id: 's1',
    tool_name: 'mcp__github__create_pull_request',
    tool_input: { owner: 'o', repo: 'r' },
    tool_response: { url: 'https://github.com/o/r/pull/42' },
  }, { env });
  assert.deepEqual(recorded.map((p) => p.number), [42]);

  let conclusion = 'failure';
  const gh = fakeGh([
    [/\/pulls\/42$/, { state: 'open', labels: [], mergeable_state: 'unstable', head: { sha: 'abc' } }],
    [/\/commits\/abc\/check-runs/, () => ({ check_runs: [{ name: 'test', conclusion }] })],
  ]);
  const red = await gates.evaluateStop({ session_id: 's1' }, { env, gh });
  assert.equal(red.block, true);
  assert.match(red.reason, /#42.*red checks: test/);

  conclusion = 'success';
  const green = await gates.evaluateStop({ session_id: 's1' }, { env, gh });
  assert.equal(green.block, false);
});

test('(a) needs-fix, merge conflicts and needs-igor are handled', async () => {
  const env = ledgerEnv();
  gates.recordOpenedPrs({ session_id: 's2', tool_name: 'Bash', tool_input: { command: 'gh pr create --title t' }, tool_response: 'https://github.com/o/r/pull/7\n' }, { env });
  const make = (pr) => fakeGh([[/\/pulls\/7$/, pr], [/check-runs/, { check_runs: [] }]]);
  const fix = await gates.evaluateStop({ session_id: 's2' }, { env, gh: make({ state: 'open', labels: [{ name: 'needs-fix' }], head: { sha: 'x' } }) });
  assert.match(fix.reason, /needs-fix/);
  const dirty = await gates.evaluateStop({ session_id: 's2' }, { env, gh: make({ state: 'open', labels: [], mergeable_state: 'dirty', head: { sha: 'x' } }) });
  assert.match(dirty.reason, /merge conflicts/);
  const igor = await gates.evaluateStop({ session_id: 's2' }, { env, gh: make({ state: 'open', labels: [{ name: 'needs-igor' }], mergeable_state: 'dirty', head: { sha: 'x' } }) });
  assert.equal(igor.block, false, 'waiting on the owner is not the agent stalling');
  const merged = await gates.evaluateStop({ session_id: 's2' }, { env, gh: make({ state: 'closed', merged: true, labels: [] }) });
  assert.equal(merged.block, false);
});

test('(a) Stop gives up blocking after 3 tries so a session cannot loop forever', async () => {
  const env = ledgerEnv();
  gates.recordOpenedPrs({ session_id: 's3', tool_name: 'mcp__github__create_pull_request', tool_response: 'https://github.com/o/r/pull/1' }, { env });
  const gh = fakeGh([[/\/pulls\/1$/, { state: 'open', labels: [{ name: 'needs-fix' }], head: {} }]]);
  const results = [];
  for (let i = 0; i < 4; i += 1) results.push(await gates.evaluateStop({ session_id: 's3' }, { env, gh }));
  assert.deepEqual(results.map((r) => r.block), [true, true, true, false]);
  assert.match(results[3].warning, /after 3 blocks/);
});

test('gates are off by default and on with THUMBGATE_PR_DISCIPLINE=1 or config/pr-discipline.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-prd-cfg-'));
  assert.equal(gates.loadConfig({ cwd: dir, env: {} }).enabled, false);
  assert.equal(gates.loadConfig({ cwd: dir, env: { THUMBGATE_PR_DISCIPLINE: '1' } }).enabled, true);
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'pr-discipline.json'), JSON.stringify({ enabled: true, maxFiles: 10 }));
  const cfg = gates.loadConfig({ cwd: dir, env: {} });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.maxFiles, 10);
});

test('main fails open on an internal error and emits a deny in hook format', async () => {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  try {
    await gates.main('pre', {
      env: { THUMBGATE_PR_DISCIPLINE: '1' },
      stdin: JSON.stringify({ tool_name: 'mcp__github__create_pull_request', tool_input: PR }),
      gh: fakeGh([[/\/compare\//, { files: files(41) }]]),
    });
    await gates.main('pre', {
      env: { THUMBGATE_PR_DISCIPLINE: '1' },
      stdin: JSON.stringify({ tool_name: 'mcp__github__create_pull_request', tool_input: PR }),
      gh: async () => { throw new Error('network down'); },
    });
  } finally {
    process.stdout.write = orig;
  }
  const deny = JSON.parse(chunks[0]);
  assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(JSON.parse(chunks[1]), {}, 'network failure fails open');
});
