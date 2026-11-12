'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const d = require('../scripts/mac-dispatch-loop');
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mac-dispatch-'));
}

function baseConfig(overrides = {}) {
  const root = tmpDir();
  const repoDir = path.join(root, 'workspace', 'ThumbGate');
  fs.mkdirSync(repoDir, { recursive: true });
  return {
    ...d.defaultConfig({ HOME: root }),
    repo: 'IgorGanapolsky/ThumbGate',
    defaultWorkdir: repoDir,
    workdirRoots: [path.join(root, 'workspace')],
    allowedAuthors: ['IgorGanapolsky'],
    machineId: 'mac-a',
    stateDir: path.join(root, 'state'),
    settleMs: 0,
    once: true,
    ...overrides,
    _root: root,
  };
}

const FORM_BODY = (workdir = '_No response_') => [
  '### Business outcome', '', 'Ship it', '',
  '### Working directory', '', workdir, '',
  '### Acceptance criteria', '', '- tests pass',
].join('\n');

// Fake gh + claude + git. Keeps issue state so we can assert the label/comment flow.
function fakeWorld({ issues, claudeStdout, claudeStatus = 0, rivalClaimFirst = false }) {
  const calls = [];
  const comments = [];
  let nextId = 100;
  const labels = new Map(issues.map((i) => [i.number, new Set()]));
  const run = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, opts });
    const ok = (stdout = '') => ({ status: 0, stdout, stderr: '', error: null, timedOut: false });
    if (cmd === 'git') return ok(args.includes('--abbrev-ref') ? 'main\n' : args.includes('--short') ? 'abc1234\n' : '');
    if (cmd === 'claude') return { status: claudeStatus, stdout: claudeStdout, stderr: '', error: null, timedOut: false };
    if (cmd !== 'gh') throw new Error(`unexpected ${cmd}`);
    const [a, b] = args;
    if (a === 'label') return ok();
    if (a === 'issue' && b === 'list') {
      return ok(JSON.stringify(issues));
    }
    if (a === 'issue' && b === 'edit') {
      const set = labels.get(Number(args[2]));
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '--add-label') set.add(args[i + 1]);
        if (args[i] === '--remove-label') set.delete(args[i + 1]);
      }
      return ok();
    }
    if (a === 'issue' && b === 'comment') {
      comments.push({ id: nextId++, body: opts.input, created_at: new Date().toISOString(), issue: Number(args[2]) });
      return ok();
    }
    if (a === 'api') {
      const target = args.find((x) => x.startsWith('repos/'));
      if (target.endsWith('/events')) return ok(JSON.stringify([[]]));
      if (args.includes('PATCH')) {
        const num = Number(target.split('/').pop());
        const payload = JSON.parse(opts.input || '{}');
        const found = issues.find((i) => i.number === num);
        if (found && payload.body !== undefined) found.body = payload.body;
        return ok(JSON.stringify(found || {}));
      }
      if (args.includes('POST')) {
        if (rivalClaimFirst) {
          comments.push({ id: nextId++, body: `<!-- ${d.CLAIM_MARKER} id=rival machine=mac-b -->`, created_at: new Date().toISOString() });
        }
        const body = args[args.indexOf('-f') + 1].slice('body='.length);
        const c = { id: nextId++, body, created_at: new Date().toISOString() };
        comments.push(c);
        return ok(JSON.stringify(c));
      }
      if (args.includes('DELETE')) return ok();
      if (target.endsWith('/comments')) return ok(JSON.stringify([comments]));
    }
    throw new Error(`unhandled gh ${args.join(' ')}`);
  };
  return { run, calls, comments, labels, issues };
}

function issue(number, extra = {}) {
  const row = {
    number,
    title: `Task ${number}`,
    body: FORM_BODY(),
    author: { login: 'IgorGanapolsky' },
    createdAt: new Date(Date.now() - 60000).toISOString(),
    url: `https://github.com/IgorGanapolsky/ThumbGate/issues/${number}`,
    ...extra,
  };
  if (!String(row.body || '').includes(d.READY_MARKER)) row.body = `${d.READY_MARKER}\n${row.body || ''}`;
  return row;
}

function ctxFor(config, world) {
  return d.makeContext(config, { run: world.run, sleep: () => {}, log: () => {}, home: config._root });
}

test('refuses permission-bypass flags', () => {
  assert.throws(() => d.parseArgs(['--once', '--claude-arg', '--dangerously-skip-permissions']), /refusing/);
  assert.throws(() => d.parseArgs(['--once', '--claude-arg', '--permission-mode=bypassPermissions']), /refusing/);
  assert.throws(() => d.assertNoPermissionBypass(['--allow-dangerously-skip-permissions']), /refusing/);
  assert.doesNotThrow(() => d.parseArgs(['--once', '--claude-arg', '--max-turns', '--claude-arg', '30']));
});

test('defaults the author allow list to the repo owner', () => {
  const c = d.parseArgs(['--once', '--repo', 'someone/thing'], { ...d.defaultConfig({ HOME: '/tmp' }), allowedAuthors: [] });
  assert.deepEqual(c.allowedAuthors, ['someone']);
});

test('parses GitHub issue-form bodies', () => {
  const form = d.parseIssueForm(FORM_BODY('~/workspace/ThumbGate'));
  assert.equal(form['business outcome'], 'Ship it');
  assert.equal(form['working directory'], '~/workspace/ThumbGate');
  assert.equal(d.parseIssueForm(FORM_BODY())['working directory'], '');
});

test('resolves workdirs only inside allowed roots', () => {
  const config = baseConfig();
  const opts = { home: config._root };
  assert.equal(d.resolveWorkdir('', config, opts), fs.realpathSync(config.defaultWorkdir));
  assert.equal(d.resolveWorkdir('~/workspace/ThumbGate', config, opts), fs.realpathSync(config.defaultWorkdir));
  assert.throws(() => d.resolveWorkdir('~/workspace/../', config, opts), /outside the allowed roots/);
  assert.throws(() => d.resolveWorkdir('/etc', config, opts), /outside the allowed roots/);
  assert.throws(() => d.resolveWorkdir('~/workspace/missing', config, opts), /does not exist/);
});

test('parses STATUS lines and decides outcomes conservatively', () => {
  assert.deepEqual(d.parseStatus('work\nSTATUS: DONE'), { status: 'DONE', reason: '' });
  assert.deepEqual(d.parseStatus('x\n**STATUS: BLOCKED: needs a token**'), { status: 'BLOCKED', reason: 'needs a token' });
  assert.equal(d.parseStatus('no status').status, 'MISSING');
  const parsed = { isError: false };
  assert.equal(d.decideOutcome({ exitCode: 0, timedOut: false, parsed, status: { status: 'DONE' } }).outcome, 'done');
  assert.equal(d.decideOutcome({ exitCode: 0, timedOut: false, parsed, status: { status: 'MISSING', reason: 'r' } }).outcome, 'blocked');
  assert.equal(d.decideOutcome({ exitCode: 1, timedOut: false, parsed, status: { status: 'DONE' } }).outcome, 'blocked');
  assert.equal(d.decideOutcome({ exitCode: null, timedOut: true, parsed, status: { status: 'DONE' } }).outcome, 'blocked');
  assert.equal(d.decideOutcome({ exitCode: 0, timedOut: false, parsed: { isError: true }, status: { status: 'DONE' } }).outcome, 'blocked');
});

test('picks the earliest claim since the issue was last queued', () => {
  const t = (s) => new Date(Date.parse('2026-11-11T12:00:00Z') + s * 1000).toISOString();
  const claim = (id, s, nonce, m) => ({ id, created_at: t(s), body: `<!-- ${d.CLAIM_MARKER} id=${nonce} machine=${m} -->` });
  const comments = [claim(1, 0, 'stale', 'mac-old'), claim(5, 100, 'b', 'mac-b'), claim(3, 100, 'a', 'mac-a')];
  assert.equal(d.pickWinningClaim(comments, t(50)).claimId, 'a');
  assert.equal(d.pickWinningClaim(comments, t(0)).claimId, 'stale');
  assert.equal(d.pickWinningClaim([], t(0)), null);
});

test('happy path: claims, runs claude without bypass flags, comments evidence, labels done', () => {
  const config = baseConfig();
  const stdout = JSON.stringify({
    result: 'Opened https://github.com/IgorGanapolsky/ThumbGate/pull/1.\nnpm test: pass\nSTATUS: DONE',
    is_error: false, session_id: 's1', num_turns: 4, total_cost_usd: 0.12, permission_denials: [],
  });
  const world = fakeWorld({ issues: [issue(7)], claudeStdout: stdout });
  const results = d.tick(ctxFor(config, world));
  assert.deepEqual(results.map((r) => r.action), ['done']);

  const claude = world.calls.find((c) => c.cmd === 'claude');
  assert.deepEqual(claude.args, ['-p', '--output-format', 'json']);
  assert.equal(claude.opts.cwd, fs.realpathSync(config.defaultWorkdir));
  assert.match(claude.opts.input, /STATUS: DONE/);
  for (const bad of d.FORBIDDEN_CLAUDE_ARGS) assert.ok(!claude.args.join(' ').includes(bad));

  const labels = world.labels.get(7);
  const doneBody = world.issues.find((i) => i.number === 7).body;
  assert.ok(doneBody.includes(d.DONE_MARKER));
  assert.ok(!doneBody.includes(d.READY_MARKER));
  assert.ok(!labels.has('agent-done'));
  assert.ok(!labels.has('ready-for-agent'));
  assert.ok(!labels.has('agent-claimed'));
  const ghArgs = world.calls.filter((c) => c.cmd === 'gh').map((c) => c.args.join(' ')).join('\n');
  assert.ok(!ghArgs.includes('ready-for-agent'));
  assert.ok(!ghArgs.includes('agent-done'));

  const evidence = world.comments.find((c) => c.body.includes(d.RESULT_MARKER));
  assert.match(evidence.body, /\*\*DONE\*\*/);
  assert.match(evidence.body, /pull\/1/);
  assert.match(evidence.body, /Exit code: 0/);
  assert.match(evidence.body, /`main` @ `abc1234`/);

  const receipts = fs.readFileSync(path.join(config.stateDir, 'receipts.jsonl'), 'utf8').trim().split('\n');
  assert.equal(JSON.parse(receipts[0]).outcome, 'done');
});

test('missing STATUS line or non-zero exit labels the issue blocked', () => {
  const config = baseConfig();
  const world = fakeWorld({ issues: [issue(8)], claudeStdout: JSON.stringify({ result: 'did stuff', is_error: false }) });
  assert.equal(d.tick(ctxFor(config, world))[0].action, 'blocked');
  assert.ok(world.labels.get(8).has('agent-blocked'));
});

test('loses the race cleanly when another machine claimed first', () => {
  const config = baseConfig();
  const world = fakeWorld({ issues: [issue(9)], claudeStdout: '', rivalClaimFirst: true });
  assert.equal(d.tick(ctxFor(config, world))[0].action, 'lost-claim');
  assert.ok(!world.calls.some((c) => c.cmd === 'claude'));
  assert.ok(world.calls.some((c) => c.cmd === 'gh' && c.args.includes('DELETE')));
  assert.ok(!world.labels.get(9).has('agent-claimed'));
});

test('ignores issues from authors outside the allow list', () => {
  const config = baseConfig();
  const world = fakeWorld({ issues: [issue(10, { author: { login: 'stranger' } })], claudeStdout: '' });
  assert.equal(d.tick(ctxFor(config, world))[0].action, 'skipped-author');
  assert.ok(!world.calls.some((c) => c.cmd === 'claude'));
  assert.ok(world.issues.find((i) => i.number === 10).body.includes(d.READY_MARKER));
  assert.ok(!world.labels.get(10).has('ready-for-agent'));
});

test('ignores an open issue that has no ready marker', () => {
  const config = baseConfig({ dryRun: true });
  const plain = issue(13);
  plain.body = 'no marker here';
  const world = fakeWorld({ issues: [plain, issue(14)], claudeStdout: '' });
  const results = d.tick(ctxFor(config, world));
  assert.deepEqual(results.map((r) => r.issue), [14]);
  assert.equal(results[0].action, 'would-run');
});

test('blocks without running claude when the workdir is outside the allowed roots', () => {
  const config = baseConfig();
  const world = fakeWorld({ issues: [issue(11, { body: FORM_BODY('/etc') })], claudeStdout: '' });
  const [r] = d.tick(ctxFor(config, world));
  assert.equal(r.action, 'blocked');
  assert.ok(!world.calls.some((c) => c.cmd === 'claude'));
  assert.ok(world.labels.get(11).has('agent-blocked'));
});

test('dry run touches nothing', () => {
  const config = baseConfig({ dryRun: true });
  const world = fakeWorld({ issues: [issue(12)], claudeStdout: '' });
  assert.equal(d.tick(ctxFor(config, world))[0].action, 'would-run');
  assert.ok(world.calls.every((c) => c.cmd === 'gh' && c.args[0] === 'issue' && c.args[1] === 'list'));
});

test('evidence comments redact secrets and stay under the GitHub limit', () => {
  const body = d.buildEvidenceComment({
    claimId: 'x', outcome: 'blocked', reason: 'r', machineId: 'm', workdir: '/w', command: 'claude -p',
    startedAt: 'now', durationMs: 1000, exitCode: 1, timedOut: false,
    parsed: { sessionId: null, numTurns: null, costUsd: null, permissionDenials: null },
    gitBefore: null, gitAfter: null, links: [],
    outputText: `${'y'.repeat(200000)}\ntoken ghp_${'a'.repeat(36)}`, stderr: '',
  });
  assert.ok(body.length <= 60100);
  assert.ok(!body.includes(`ghp_${'a'.repeat(36)}`));
  assert.match(body, /UNKNOWN/);
});

test('local lock stops overlapping runs on one Mac', () => {
  const config = baseConfig();
  const ctx = d.makeContext(config, { log: () => {} });
  const release = d.acquireLock(ctx);
  assert.equal(typeof release, 'function');
  assert.equal(d.acquireLock(ctx), null);
  release();
  const again = d.acquireLock(ctx);
  assert.equal(typeof again, 'function');
  again();
});
