'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  probeTailscale,
  countPreventionRules,
  evaluatePamDiode,
  evaluateDiagnostics,
} = require('../scripts/tailscale-p2p-doctor');

test('tailscale-p2p: evaluatePamDiode protects privileged patterns', () => {
  const pam = evaluatePamDiode();
  assert.equal(pam.enforced, true);
  assert.ok(pam.privilegedPatternsProtected >= 5);
  assert.equal(pam.diodeStatus, 'ACTIVE');
});

test('tailscale-p2p: countPreventionRules counts rules from local repo', () => {
  const count = countPreventionRules(path.resolve(__dirname, '..'));
  assert.ok(count >= 1, `expected at least 1 rule, got ${count}`);
});

test('tailscale-p2p: probeTailscale handles missing CLI gracefully with standby state', () => {
  const result = probeTailscale();
  assert.ok(result.status);
  assert.ok(result.status.self);
  assert.ok(Array.isArray(result.status.self.tailscaleIPs));
});

test('tailscale-p2p: probeTailscale reads fixture when provided', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-fixture-'));
  const fixturePath = path.join(tmpDir, 'status.json');
  const mockPayload = {
    BackendState: 'Running',
    Self: {
      ID: 'node-12345',
      DNSName: 'macbook.my-tailnet.ts.net.',
      TailscaleIPs: ['100.80.1.5'],
    },
    Peer: {
      'node-67890': {
        HostName: 'ci-runner',
        TailscaleIPs: ['100.80.1.10'],
      },
    },
  };
  fs.writeFileSync(fixturePath, JSON.stringify(mockPayload));

  const result = probeTailscale(fixturePath);
  assert.equal(result.ok, true);
  assert.equal(result.source, 'fixture');
  assert.equal(result.status.BackendState, 'Running');
  assert.equal(result.status.Self.ID, 'node-12345');
  assert.equal(Object.keys(result.status.Peer).length, 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('tailscale-p2p: evaluateDiagnostics returns healthy report structure', () => {
  const report = evaluateDiagnostics();
  assert.equal(report.name, 'tailscale-p2p-doctor');
  assert.equal(report.status, 'healthy');
  assert.equal(report.crdtMesh.journalType, 'g-set-append-only');
  assert.equal(report.crdtMesh.conflictFree, true);
  assert.equal(report.pamDiode.zeroTrustAccessEnforced, true);
  assert.ok(report.recommendations.length >= 1);
});
