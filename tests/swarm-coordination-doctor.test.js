'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { auditSwarmCoordination, parseClaimFile } = require('../scripts/swarm-coordination-doctor');

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
