'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const {
  auditAaifSixPillarInterop,
  validateInFlightEngineSwap,
  runDreadnodeOffensiveGauntlet,
  evaluateFalconObserveAndKillSwitch,
  runDoctor,
} = require('../scripts/aaif-crowdstrike-fiddler-dreadnode-honesty');

test('1. AAIF 6-Standard Interoperability verifies MCP, AGENTS.md, goose, Agent Skills, Open Responses, and OpenEnv', () => {
  const full = auditAaifSixPillarInterop();
  assert.equal(full.ok, true);
  assert.equal(full.supportedCount, 6);
  assert.equal(full.scorePct, 100);

  const partial = auditAaifSixPillarInterop(['mcp', 'agents_md']);
  assert.equal(partial.ok, false);
  assert.equal(partial.verdict, 'FAIL_AAIF_GAP');
});

test('2. Mazin Gilbert In-Flight Engine Swap preserves lease and AGENTS.md hash across model switches', () => {
  const valid = validateInFlightEngineSwap({
    fromEngine: 'opus-5.5',
    toEngine: 'gemini-4-carbon',
    leaseTokenBefore: 'lease_123',
    leaseTokenAfter: 'lease_123',
    agentsMdHashBefore: 'sha256:abc',
    agentsMdHashAfter: 'sha256:abc',
    preToolUseGateActive: true,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.verdict, 'PASS_IN_FLIGHT_ENGINE_SWAP');

  const brokenLease = validateInFlightEngineSwap({
    leaseTokenBefore: 'lease_123',
    leaseTokenAfter: 'lease_999',
  });
  assert.equal(brokenLease.ok, false);
});

test('3. Dreadnode ($95M) Pre-Deployment Offensive Gauntlet blocks 100% of multi-turn and obfuscated exploits', () => {
  const report = runDreadnodeOffensiveGauntlet();
  assert.equal(report.ok, true);
  assert.equal(report.verdict, 'PASS_DREADNODE_100PCT_BLOCKED');
  assert.equal(report.blockRatePct, 100);
});

test('4. Fiddler AI ($400M Falcon Observe) Flight Recorder and Falcon Guardian Kill Switch trip before destructive execution', () => {
  const safe = evaluateFalconObserveAndKillSwitch({
    command: 'node --test tests/isolated-verifier.test.js',
    driftScore: 0.15,
    tokenBurnUsd: 0.50,
  });
  assert.equal(safe.ok, true);
  assert.equal(safe.killSwitchTripped, false);
  assert.equal(safe.verdict, 'ALLOW_WITH_FLIGHT_RECORD');
  assert.equal(safe.flightRecordSha256.length, 64);

  const tripped = evaluateFalconObserveAndKillSwitch({
    command: 'git push --force origin main',
    driftScore: 0.91,
    tokenBurnUsd: 40.0,
    budgetCeilingUsd: 25.0,
  });
  assert.equal(tripped.ok, false);
  assert.equal(tripped.killSwitchTripped, true);
  assert.equal(tripped.verdict, 'KILL_SWITCH_TRIPPED_PRE_EXECUTION');
  assert.equal(tripped.reasons.length, 3);
});

test('5. CLI --json doctor exits 0 with all checks passing', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/aaif-crowdstrike-fiddler-dreadnode-honesty.js');
  const raw = execFileSync(process.execPath, [scriptPath, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.verdict, 'PASS');
  assert.equal(runDoctor().ok, true);
});
