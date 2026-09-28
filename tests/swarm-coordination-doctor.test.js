'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  auditSwarmCoordination,
  collectLiveSnapshot,
  notebookIsClaimStore,
  parseClaimFile,
} = require('../scripts/swarm-coordination-doctor');

function readySnapshot(overrides = {}) {
  return {
    sessionAgent: 'grok-session',
    lease: { foreignLive: false, detail: 'lease free' },
    vaults: [{
      role: 'live',
      path: '/Users/example/Documents/Igor',
      exists: true,
      claims: [],
    }, {
      role: 'named',
      path: '/Users/example/Documents/AI-Agent-Sync',
      exists: false,
      claims: [],
    }],
    linear: { authenticated: false, detail: 'no api key' },
    github: { available: true, issues: [{ number: 3693, title: 'Gulli gap map' }] },
    geminiNotebook: { exists: true, path: '/Users/example/Documents/Igor/NotebookLM', claimStore: false },
    gitbutler: { available: true, conflicted: false, detail: 'no conflicted stack' },
    typesafe: {},
    swarm: {},
    ...overrides,
  };
}

test('a healthy census stays ready when Linear is only absent', () => {
  const report = auditSwarmCoordination(readySnapshot(), { sessionAgent: 'grok-session' });
  assert.equal(report.status, 'ready');
  assert.equal(report.ok, true);
  assert.equal(report.absences[0].name, 'linear');
  assert.equal(report.surfaces.find((surface) => surface.name === 'typesafe_jev').state, 'ready');
  assert.equal(report.surfaces.find((surface) => surface.name === 'obsidian_vault').state, 'ready');
});

test('a foreign live lease is a collision', () => {
  const report = auditSwarmCoordination(readySnapshot({
    lease: { foreignLive: true, detail: 'held by other' },
  }), { sessionAgent: 'grok-session' });
  assert.equal(report.status, 'collision');
  assert.equal(report.ok, false);
});

test('a live ThumbGate vault claim by another agent is a collision', () => {
  const report = auditSwarmCoordination(readySnapshot({
    vaults: [{
      role: 'live',
      path: '/vault',
      exists: true,
      claims: [{ live: true, owner: 'codex', topic: 'thumbgate gates', path: 'claim.md' }],
    }],
  }), { sessionAgent: 'grok-session' });
  assert.equal(report.status, 'collision');
  assert.match(report.collisions[0].detail, /codex/);
});

test('duplicate open GitHub issue titles collide', () => {
  const report = auditSwarmCoordination(readySnapshot({
    github: {
      available: true,
      issues: [
        { number: 1, title: 'Same gap' },
        { number: 2, title: 'same   gap' },
      ],
    },
  }), { sessionAgent: 'grok-session' });
  assert.equal(report.surfaces.find((surface) => surface.name === 'github_issues').state, 'collision');
});

test('Jev cannot own coordination', () => {
  const report = auditSwarmCoordination(readySnapshot({
    typesafe: { jevOwnsCoordination: true },
  }), { sessionAgent: 'grok-session' });
  assert.equal(report.surfaces.find((surface) => surface.name === 'typesafe_jev').state, 'collision');
});

test('NotebookLM as a claim store collides', () => {
  const report = auditSwarmCoordination(readySnapshot({
    geminiNotebook: { exists: true, path: '/notebook', claimStore: true },
  }), { sessionAgent: 'grok-session' });
  assert.equal(report.surfaces.find((surface) => surface.name === 'gemini_notebook').state, 'collision');
});

test('a conflicted GitButler stack collides', () => {
  const report = auditSwarmCoordination(readySnapshot({
    gitbutler: { available: true, conflicted: true },
  }), { sessionAgent: 'grok-session' });
  assert.equal(report.surfaces.find((surface) => surface.name === 'gitbutler').state, 'collision');
});

test('a finished ThumbGate claim is not live', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-'));
  const file = path.join(dir, 'thumbgate-old.md');
  fs.writeFileSync(file, '---\ntopic: thumbgate-old\nagent_session: other\nstatus: done\n---\n');
  const claim = parseClaimFile(file, Date.now());
  assert.equal(claim.live, false);
  assert.equal(claim.owner, 'other');
});

test('an unset session is degraded', () => {
  const report = auditSwarmCoordination(readySnapshot({ sessionAgent: '' }), { sessionAgent: '' });
  assert.equal(report.status, 'degraded');
  assert.equal(report.ok, false);
  assert.equal(report.surfaces.find((surface) => surface.name === 'session_identity').state, 'degraded');
});

test('duplicate open pull request titles collide', () => {
  const report = auditSwarmCoordination(readySnapshot({
    github: {
      available: true,
      issues: [{ number: 3693, title: 'Gulli gap map' }],
      pulls: {
        available: true,
        items: [
          { number: 10, title: 'Same branch work' },
          { number: 11, title: 'same   branch work' },
        ],
      },
    },
  }), { sessionAgent: 'grok-session' });
  assert.equal(report.surfaces.find((surface) => surface.name === 'github_pulls').state, 'collision');
  assert.equal(report.surfaces.find((surface) => surface.name === 'github_issues').state, 'ready');
});

test('a failed Linear query is degraded and does not invent issues', () => {
  const report = auditSwarmCoordination(readySnapshot({
    linear: {
      authenticated: true,
      queryFailed: true,
      detail: 'Linear query failed; the API key was not printed',
      issues: [],
    },
  }), { sessionAgent: 'grok-session' });
  assert.equal(report.surfaces.find((surface) => surface.name === 'linear').state, 'degraded');
  assert.equal(report.status, 'degraded');
});

test('two herdr agents in this checkout collide; a down gateway is an absence', () => {
  const crowded = auditSwarmCoordination(readySnapshot({
    herdr: { available: true, sameCwd: 2, detail: '2 herdr agents share this checkout' },
  }), { sessionAgent: 'grok-session' });
  assert.equal(crowded.surfaces.find((surface) => surface.name === 'herdr').state, 'collision');

  const alone = auditSwarmCoordination(readySnapshot({
    herdr: { available: true, sameCwd: 1, detail: 'herdr gateway up; 1 agent(s) in this checkout' },
  }), { sessionAgent: 'grok-session' });
  assert.equal(alone.surfaces.find((surface) => surface.name === 'herdr').state, 'ready');

  const down = auditSwarmCoordination(readySnapshot({
    herdr: { available: false, gatewayDown: true, detail: 'herdr gateway not running' },
  }), { sessionAgent: 'grok-session' });
  assert.equal(down.surfaces.find((surface) => surface.name === 'herdr').state, 'absence');
  assert.equal(down.status, 'ready');
});

test('NotebookLM Packs are not a claim store', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-notebook-'));
  fs.mkdirSync(path.join(root, 'Packs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Packs', 'thumbgate.txt'), 'owner: other\nstatus: running\nthumbgate\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'ThumbGate notes for the mirror.\n');
  assert.equal(notebookIsClaimStore(root), false);

  const claims = path.join(root, 'Agents', 'Claims');
  fs.mkdirSync(claims, { recursive: true });
  fs.writeFileSync(path.join(claims, 'thumbgate.md'), 'topic: thumbgate\nowner: other\nstatus: running\n');
  assert.equal(notebookIsClaimStore(root), true);
});

test('the live collector scans the notebook, pulls, and herdr without putting a Linear key on the command line', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-swarm-home-'));
  const notebook = path.join(home, 'Documents', 'Igor', 'NotebookLM');
  fs.mkdirSync(path.join(notebook, 'Packs'), { recursive: true });
  fs.writeFileSync(path.join(notebook, 'Packs', 'thumbgate.txt'), 'thumbgate owner: other\n');
  fs.mkdirSync(path.join(home, '.config', 'linear'), { recursive: true });
  const secret = 'lin_api_secret_value';
  fs.writeFileSync(path.join(home, '.config', 'linear', 'api_key'), `${secret}\n`);
  const calls = [];
  const previousVault = process.env.THUMBGATE_VAULT;
  delete process.env.THUMBGATE_VAULT;
  const runCommand = (bin, args, cwdOrOptions) => {
    calls.push({ bin, args, cwdOrOptions });
    if (bin === 'node') return { status: 0, stdout: 'lease free\n', stderr: '' };
    if (args && args[0] === '-e') {
      return {
        status: 0,
        stdout: JSON.stringify({
          data: {
            issues: {
              nodes: [{
                identifier: 'THU-1',
                title: 'ThumbGate swarm',
                state: { name: 'In Progress' },
                assignee: { name: 'other-agent' },
              }],
            },
          },
        }),
        stderr: '',
      };
    }
    if (bin === 'gh' && args[0] === 'issue') {
      return { status: 0, stdout: '[{"number":3693,"title":"Gulli"}]', stderr: '' };
    }
    if (bin === 'gh' && args[0] === 'pr') {
      return { status: 0, stdout: '[{"number":1,"title":"Alpha"},{"number":2,"title":"alpha"}]', stderr: '' };
    }
    if (bin === 'but') return { status: 0, stdout: 'please run but teardown\n', stderr: '' };
    if (bin === 'herdr' && args[0] === 'status') return { status: 0, stdout: 'status: stopped\n', stderr: '' };
    return { status: 1, stdout: '', stderr: 'unused' };
  };
  try {
    const snapshot = collectLiveSnapshot({
      home,
      repoRoot: '/repo',
      notebookPath: notebook,
      sessionAgent: 'grok-session',
      runCommand,
    });
    assert.equal(snapshot.geminiNotebook.claimStore, false);
    assert.equal(snapshot.linear.authenticated, true);
    assert.equal(snapshot.linear.queryFailed, false);
    assert.equal(snapshot.linear.issues[0].owner, 'other-agent');
    assert.equal(snapshot.gitbutler.conflicted, true);
    assert.equal(snapshot.herdr.gatewayDown, true);
    const report = auditSwarmCoordination(snapshot, { sessionAgent: 'grok-session' });
    assert.equal(report.surfaces.find((surface) => surface.name === 'github_pulls').state, 'collision');
    assert.equal(report.surfaces.find((surface) => surface.name === 'linear').state, 'collision');
    assert.equal(report.surfaces.find((surface) => surface.name === 'herdr').state, 'absence');
    const serializedArgs = JSON.stringify(calls.map((call) => ({ bin: call.bin, args: call.args })));
    assert.equal(serializedArgs.includes(secret), false);
    const linearCall = calls.find((call) => call.args && call.args[0] === '-e');
    assert.equal(linearCall.cwdOrOptions.env.THUMBGATE_LINEAR_KEY, secret);
    assert.equal(String(linearCall.args[1]).includes(secret), false);
  } finally {
    if (previousVault === undefined) delete process.env.THUMBGATE_VAULT;
    else process.env.THUMBGATE_VAULT = previousVault;
  }
});
