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
  const pam = evaluatePamDiode(path.resolve(__dirname, '..'));
  assert.equal(pam.enforced, true);
  assert.ok(pam.privilegedPatternsProtected >= 5);
  assert.equal(pam.diodeStatus, 'ACTIVE');

  // Unconfigured directory returns inactive
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-unconfigured-'));
  try {
    const inactivePam = evaluatePamDiode(emptyDir);
    assert.equal(inactivePam.enforced, false);
    assert.equal(inactivePam.diodeStatus, 'INACTIVE');
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('tailscale-p2p: countPreventionRules counts rules from local repo and preserves zero', () => {
  const count = countPreventionRules(path.resolve(__dirname, '..'));
  assert.ok(count >= 1, `expected at least 1 rule, got ${count}`);

  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-empty-rules-'));
  try {
    const zeroCount = countPreventionRules(emptyDir);
    assert.equal(zeroCount, 0);
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
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
  assert.equal(result.status.backendState, 'Running');
  assert.equal(result.status.self.ID, 'node-12345');
  assert.equal(result.status.peerCount, 1);

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

test('tailscale-p2p: parseArgs parses command-line flags', () => {
  const { parseArgs } = require('../scripts/tailscale-p2p-doctor');
  const parsed = parseArgs(['--json', '--check', '--serve-mcp', '--fixture=/tmp/test.json']);
  assert.equal(parsed.json, true);
  assert.equal(parsed.check, true);
  assert.equal(parsed.serveMcp, true);
  assert.equal(parsed.fixture, '/tmp/test.json');
});

test('tailscale-p2p: probeTailscale handles corrupt fixture file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-corrupt-'));
  const fixturePath = path.join(tmpDir, 'corrupt.json');
  fs.writeFileSync(fixturePath, 'invalid-json{{{');

  const result = probeTailscale(fixturePath);
  assert.equal(result.ok, false);
  assert.equal(result.source, 'fixture_error');
  assert.ok(result.error);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('tailscale-p2p: evaluateDiagnostics with valid fixture returns active peer status', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-diag-'));
  const fixturePath = path.join(tmpDir, 'status.json');
  const mockPayload = {
    BackendState: 'Running',
    Self: {
      ID: 'node-abc',
      DNSName: 'agent-1.net.',
      TailscaleIPs: ['100.80.1.99'],
    },
    Peer: {
      'node-peer-1': { HostName: 'peer1' },
      'node-peer-2': { HostName: 'peer2' },
    },
  };
  fs.writeFileSync(fixturePath, JSON.stringify(mockPayload));

  const report = evaluateDiagnostics({ fixture: fixturePath });
  assert.equal(report.status, 'healthy');
  assert.equal(report.network.backendState, 'Running');
  assert.equal(report.network.peerCount, 2);
  assert.equal(report.network.tailscaleAvailable, true);
  assert.ok(report.recommendations[0].includes('Tailscale peer mesh active'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('tailscale-p2p: CLI runs cleanly with --json and --check flags', () => {
  const { execFileSync } = require('node:child_process');
  const doctorScript = path.resolve(__dirname, '../scripts/tailscale-p2p-doctor.js');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-cli-'));
  const fixturePath = path.join(tmpDir, 'status.json');
  fs.writeFileSync(fixturePath, JSON.stringify({ BackendState: 'Running' }));

  const stdout = execFileSync(process.execPath, [doctorScript, '--json', `--fixture=${fixturePath}`, '--check'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.name, 'tailscale-p2p-doctor');
  assert.equal(parsed.status, 'healthy');

  // Also test human-readable output
  const textOut = execFileSync(process.execPath, [doctorScript, `--fixture=${fixturePath}`], {
    encoding: 'utf8',
  });
  assert.ok(textOut.includes('Tailscale P2P Governance & Zero-Trust Diode Doctor'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

