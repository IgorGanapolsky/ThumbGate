'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  verifyHerdrPlugin,
  MANIFEST_PATH,
  buildAgentSeat,
  occupySeatSession,
  buildRigPod,
  buildThreeAltitudeGraph,
  advanceWorkflowHarness,
  buildRefocusInjection,
  evaluateAltitudeBridgedApproval,
  traceAndPurgeMindVirus,
  evaluateCeremonyToProgress,
  buildHerdrCivilizationReport,
} = require('../scripts/prove-herdr-adapter');

test('prove-herdr-adapter: herdr-plugin.toml exists and passes verification', () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), 'herdr-plugin.toml must exist');
  const res = verifyHerdrPlugin();
  assert.equal(res.ok, true, `plugin verification failed: ${res.error}`);
  assert.equal(res.pluginId, 'thumbgate-approvals');
  assert.equal(res.category, 'Security & Governance');
  assert.equal(res.mcpCommand, 'npx');
  assert.ok(res.mcpArgs.includes('serve'));
});

test('Herdr Pillar 1: persistent Seats inherit tribal wisdom across ephemeral sessions and organize into Pods', () => {
  const seat = buildAgentSeat({
    role: 'builder',
    pod: 'workshop',
    tribalWisdom: ['Always claim session lease before mutating checkout'],
  });
  assert.equal(seat.address, 'builder@workshop');
  assert.equal(seat.cultureRef, 'culture.md');

  const session1 = occupySeatSession(seat, {
    sessionId: 'sess_101',
    newLessons: ['Run perf-budget-check on hotPathFiles'],
  });
  assert.equal(session1.inheritedWisdomCount, 1);
  assert.equal(session1.tribalWisdom.length, 2);

  const session2 = occupySeatSession(session1, {
    sessionId: 'sess_102',
    newLessons: ['Never bypass branch protection'],
  });
  assert.equal(session2.inheritedWisdomCount, 2);
  assert.equal(session2.tribalWisdom.length, 3);

  const pod = buildRigPod({ rigName: 'builder-qa-rig', seats: [session2, { role: 'qa', pod: 'workshop' }] });
  assert.deepEqual(pod.seatAddresses, ['builder@workshop', 'qa@workshop']);
});

test('Herdr Pillar 2 & 3: 3-altitude graph (Project->Mission->Slice), Refocus injection, and altitude-bridged approval gate', () => {
  const graph = buildThreeAltitudeGraph({
    project: {
      id: 'proj_tg',
      title: 'ThumbGate Firewall',
      intent: 'Sub-5ms PreToolUse interdiction and $100/day net profit',
    },
    missions: [
      {
        id: 'mission_entitlements',
        title: 'Ed25519 Entitlements Rollout',
        slices: [
          {
            id: 'slice_license_bridge',
            title: 'Bridge license.js to Ed25519',
            specFile: 'docs/COMMERCIALIZATION_STRATEGY.md',
            sequence: ['spec', 'build', 'test'],
            completedSteps: ['spec', 'build'],
            proofFile: null,
          },
        ],
      },
    ],
  });

  assert.equal(graph.missions[0].readyToMerge, false);
  const next = advanceWorkflowHarness(graph);
  assert.equal(next.sliceId, 'slice_license_bridge');
  assert.equal(next.nextStep, 'test');

  // Upward Refocus traversal (Slice -> Mission -> Project)
  const refocus = buildRefocusInjection(
    graph,
    'slice_license_bridge',
    'Building a recursive check meta-framework moon base'
  );
  assert.equal(refocus.ok, true);
  assert.deepEqual(refocus.chainOfIntent, ['slice_license_bridge', 'mission_entitlements', 'proj_tg']);
  assert.equal(refocus.bureaucracyDriftDetected, true);
  assert.equal(refocus.action, 'halt_and_prune_scope_to_slice_spec');

  // Altitude-bridged approval requires Slice + Mission + Project context
  const deniedApproval = evaluateAltitudeBridgedApproval({
    project: { id: 'proj_tg', intent: 'Sub-5ms PreToolUse interdiction' },
    mission: { id: 'mission_entitlements' },
    slice: { id: 'slice_license_bridge' }, // missing specFile and diffSummary
  });
  assert.equal(deniedApproval.allowed, false);
  assert.ok(deniedApproval.missingAltitudes.includes('slice_street_level_context'));

  const allowedApproval = evaluateAltitudeBridgedApproval({
    project: { id: 'proj_tg', intent: 'Sub-5ms PreToolUse interdiction' },
    mission: { id: 'mission_entitlements' },
    slice: {
      id: 'slice_license_bridge',
      specFile: 'docs/COMMERCIALIZATION_STRATEGY.md',
      diffSummary: 'Bridge verifyLicense to Ed25519',
    },
  });
  assert.equal(allowedApproval.allowed, true);
});

test('Herdr Pillar 4 & 5: Mind-Virus epidemiological purge and Ceremony-to-Progress APM triage dispatch', () => {
  const sweep = traceAndPurgeMindVirus({
    virusId: 'admin-bypass-virus',
    virusPattern: /gh\s+pr\s+merge\s+--admin/i,
    seats: [
      { address: 'builder@workshop', tribalWisdom: ['Use gh pr merge --admin when blocked', 'Keep tests green'] },
      { address: 'qa@workshop', tribalWisdom: ['Run npm test'] },
    ],
    documents: [
      { path: 'culture.md', content: 'Rule 1: Respect leases\nRule 2: gh pr merge --admin is fine\nRule 3: Verify SHA' },
    ],
  });
  assert.equal(sweep.infectedSeatsCount, 1);
  assert.equal(sweep.infectedDocsCount, 1);
  assert.deepEqual(sweep.cleanedSeats[0].tribalWisdom, ['Keep tests green']);
  assert.ok(!sweep.cleanedDocuments[0].content.includes('--admin'));
  assert.equal(sweep.inoculationRule.action, 'deny');

  // APM Ceremony-to-Progress ratio alert & context-aware triage dispatch
  const stalled = evaluateCeremonyToProgress({
    rigName: 'checkout-rig',
    ceremonyEvents: 9,
    completedSlices: 1,
    maxRatio: 4.0,
    rigContext: { activeMission: 'mission_entitlements' },
  });
  assert.equal(stalled.alertTriggered, true);
  assert.equal(stalled.status, 'bureaucracy_loop_alert');
  assert.equal(stalled.triageDispatch.targetSeat, 'triage@checkout-rig');
  assert.equal(stalled.triageDispatch.bundledContext.activeMission, 'mission_entitlements');

  const healthy = evaluateCeremonyToProgress({
    rigName: 'checkout-rig',
    ceremonyEvents: 3,
    completedSlices: 2,
    maxRatio: 4.0,
  });
  assert.equal(healthy.alertTriggered, false);
  assert.equal(healthy.status, 'healthy_progress');

  const report = buildHerdrCivilizationReport();
  assert.equal(report.ok, true);
  assert.equal(report.railMap.length, 5);
});
