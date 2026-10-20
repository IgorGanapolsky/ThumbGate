'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VITALIK_ERR_REWRITER_FAILED,
  compileThumbGateToArmorPlugin,
  evaluateUnauthorizedWalletSpendDiode,
  rewritePromptParanoidMode,
  resolveParanoidSessionCircuit,
  scheduleUnbufferedCoverTraffic,
  evaluateArmorWithThumbGateFallback,
  ZKAPI_CIRCUIT_ID,
  computeZkApiNoteBoundCommitment,
  evaluateZkApiNullifierEscapeGate,
  evaluateZkApiLeaseRetirement,
  resolveTorRouterSelectiveRoute,
  evaluateTorNewIdentityAndAnonymityCheck,
  evaluateHyperframesVideoAgentGate,
  computeMaiSourceScalingLadder,
  computeMaiCoupledHyperparameters,
  routeMaiDroplessMoE,
  clipAndDiagnoseMalformedExamples,
  evaluateLeanProofCompletionGate,
  compareDyadicMajorant,
  calibrateExactReflectionAmplifier,
  evaluateAuxiliaryVerificationTreeBudget,
  evaluateBeePrivateComputeDiode,
  evaluateBeeAmbientActionGate,
  pruneAndPromoteBeeRollingMemory,
  computeCompoundTxQFitness,
  evolveMultiArchitectureIslandArchive,
  evaluateHybridDivstepsUncomputation,
  verifyKickmixBasisTrajectory,
  createDurableGovernanceCell,
  canonicalizePromptForKvCachePrefix,
  routeSmgKvCacheAwareBackend,
  evaluateSystemOneDecisionModelGuard,
  verifyPasskeyStepUpAssertion,
  evaluateMuseSparkLongRunningFence,
  computeSemrushAiVisibilityStrategy,
  evaluateSpaceSandboxPlusThumbGateFirewall,
  evaluateSonableFourAgentVisibilityLoop,
  evaluateServiceNowAiPassportAndBrake,
  evaluateOnCallDotToCodexHandoff,
  evaluateScionAgentScaleVcsGate,
  evaluateSubQSnapCoarseModuleRouter,
  evaluateSanSiLoopedSystem15Gate,
  evaluateBrunoGitNativeCollectionDiode,
  evaluateOuroborosContinuityAndRewardHackGate,
} = require('../scripts/openrouter-armor-partnership-diode');

test('compileThumbGateToArmorPlugin: emits OpenRouter Armor v1 classifier_context with 0.6 deny and 0.7 allow thresholds', () => {
  const plugin = compileThumbGateToArmorPlugin({
    trustedRepo: 'github.com/IgorGanapolsky/ThumbGate',
    currentBranch: 'main',
    isProtectedBranch: true,
  });

  assert.equal(plugin.id, 'armor');
  assert.equal(plugin.output_mode, 'custom_item');
  assert.equal(plugin.classifier_context.v, 1);
  assert.equal(plugin.classifier_context.auto_mode.hard_deny[0].threshold, 0.6);
  assert.equal(plugin.classifier_context.auto_mode.allow[0].threshold, 0.7);
});

test('evaluateArmorWithThumbGateFallback: blocks force-push variants, HTTP 403 ZDR/HIPAA rejections, and unscoped rm -rf', () => {
  const flagged = evaluateArmorWithThumbGateFallback({
    callId: 'call_bPQO3',
    toolName: 'bash',
    toolArguments: { command: 'git push origin main' },
    safeguardResults: [
      {
        type: 'dangerous_tool_use',
        status: {
          type: 'available',
          tool_uses: {
            call_bPQO3: { type: 'evaluated', outcome: 'flagged', explanation: '[Git Push]' },
          },
        },
      },
    ],
  });
  assert.equal(flagged.allowed, false);
  assert.equal(flagged.customItem.type, 'openrouter:armor_blocked');

  for (const cmd of ['git push -f origin main', 'git push --force-with-lease origin main', 'git push origin +main']) {
    const res = evaluateArmorWithThumbGateFallback({
      callId: 'call_zdr',
      toolName: 'bash',
      toolArguments: { command: cmd },
      armorHttpStatus: 403,
      complianceContext: { zeroDataRetention: true, hipaa: true },
    });
    assert.equal(res.allowed, false, `Expected ${cmd} to be blocked`);
    assert.equal(res.tier, 'hard_deny');
  }

  const allowedTestCleanup = evaluateArmorWithThumbGateFallback({
    callId: 'call_test_1',
    toolName: 'bash',
    toolArguments: { command: 'node --test && rm -rf /tmp/mkdtemp-test-123' },
  });
  assert.equal(allowedTestCleanup.allowed, true);

  const blockedCompound = evaluateArmorWithThumbGateFallback({
    callId: 'call_test_2',
    toolName: 'bash',
    toolArguments: { command: 'npm test && rm -rf ~/project' },
  });
  assert.equal(blockedCompound.allowed, false);
  assert.equal(blockedCompound.tier, 'soft_deny');
});

test('Vitalik Paranoid Mode: rewrites user stylometry, preserves code/quotes verbatim, fails closed, rotates Tor circuits, drops saturated cover traffic, and blocks unauthorized ETH wallet spend', () => {
  // 1. Stylometry rewriter strips "I'm kinda lost here lol" while preserving `x != 0 && y < 5`
  const rw = rewritePromptParanoidMode({
    messages: [
      { role: 'user', content: "I'm kinda lost here lol. Explain `x != 0 && y < 5` without changing the code. Don't execute it." },
    ],
  });
  assert.equal(rw.ok, true);
  assert.equal(rw.rewritten, true);
  assert.ok(!rw.messages[0].content.includes('kinda lost'));
  assert.ok(!rw.messages[0].content.includes('lol'));
  assert.ok(rw.messages[0].content.includes('`x != 0 && y < 5`'));

  // Sentinel collision: user text containing placeholder-shaped strings must not corrupt output
  const collisionRw = rewritePromptParanoidMode({
    messages: [
      { role: 'user', content: 'Use __VERBATIM_SPAN_0__ and "quoted text" here' },
    ],
  });
  assert.equal(collisionRw.ok, true);
  assert.ok(collisionRw.messages[0].content.includes('__VERBATIM_SPAN_0__'), 'user sentinel placeholder preserved');
  assert.ok(collisionRw.messages[0].content.includes('"quoted text"'), 'user quote preserved');

  // Fail-closed when rewriter fails
  const failedRw = rewritePromptParanoidMode({
    messages: [{ role: 'user', content: 'secret prompt' }],
    simulateRewriterFailure: true,
  });
  assert.equal(failedRw.ok, false);
  assert.equal(failedRw.error, VITALIK_ERR_REWRITER_FAILED);

  // 2. Prefix-continuation circuit reuse vs branching rotation
  const turn1 = [{ role: 'user', content: 'hello' }];
  const c1 = resolveParanoidSessionCircuit({ messages: turn1 });
  assert.equal(c1.rotated, true);

  const turn2Continuation = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }, { role: 'user', content: 'next' }];
  const c2 = resolveParanoidSessionCircuit({
    messages: turn2Continuation,
    priorPrefixHash: c1.transcriptHash,
    priorMessageCount: c1.messageCount,
    priorCircuitId: c1.circuitId,
    priorZkApiKeyId: c1.zkApiKeyId,
  });
  assert.equal(c2.reused, true);
  assert.equal(c2.circuitId, c1.circuitId);

  const turn2Branched = [{ role: 'user', content: 'different root conversation' }];
  const c3 = resolveParanoidSessionCircuit({
    messages: turn2Branched,
    priorPrefixHash: c1.transcriptHash,
    priorMessageCount: c1.messageCount,
    priorCircuitId: c1.circuitId,
    priorZkApiKeyId: c1.zkApiKeyId,
  });
  assert.equal(c3.rotated, true);
  assert.notEqual(c3.circuitId, c1.circuitId);

  // 3. Unbuffered Poisson cover traffic drops when worker pool is saturated
  const coverOk = scheduleUnbufferedCoverTraffic({
    coverUrls: ['https://thumbgate.ai/cover.txt'],
    ratePerSec: 5,
    maxInFlight: 4,
    currentInFlight: 2,
  });
  assert.equal(coverOk.dispatched, true);

  const coverDropped = scheduleUnbufferedCoverTraffic({
    coverUrls: ['https://thumbgate.ai/cover.txt'],
    ratePerSec: 5,
    maxInFlight: 4,
    currentInFlight: 4,
  });
  assert.equal(coverDropped.dispatched, false);
  assert.equal(coverDropped.dropped, true);

  // Cover URLs pointing at private IPv6 ranges are rejected
  for (const badUrl of ['https://[::1]/cover', 'https://[fc00::1]/cover', 'https://[fd00::1]/cover', 'https://[fe80::1]/cover', 'https://169.254.169.254/cover']) {
    assert.throws(
      () => scheduleUnbufferedCoverTraffic({
        coverUrls: [badUrl],
        ratePerSec: 5,
        maxInFlight: 4,
        currentInFlight: 1,
      }),
      /Rejected unsafe or non-HTTPS-443 cover URL/
    );
  }

  // 4. Blocks unauthorized ETH wallet spend (OpenAI testnet ETH wallet incident)
  const unauthorizedTx = evaluateUnauthorizedWalletSpendDiode({
    toolName: 'bash',
    commandOrPayload: 'cast send 0xdeadbeef00000000000000000000000000000001 --value 1ether',
    authorizedDepositAddress: '0x1111111111111111111111111111111111111111',
  });
  assert.equal(unauthorizedTx.allowed, false);
  assert.equal(unauthorizedTx.gateId, 'gate:vitalik_paranoid:unauthorized_wallet_spend_blocked');

  // 4b. No authorizedDepositAddress configured → fail closed
  const noAuthCheck = evaluateUnauthorizedWalletSpendDiode({
    toolName: 'bash',
    commandOrPayload: 'cast send 0xdeadbeef00000000000000000000000000000001 --value 1ether',
  });
  assert.equal(noAuthCheck.allowed, false);
  assert.equal(noAuthCheck.gateId, 'gate:vitalik_paranoid:unauthorized_wallet_spend_blocked');

  // 4c. Authorized sender (via --account) is allowed; destination differs
  const authorizedTx = evaluateUnauthorizedWalletSpendDiode({
    toolName: 'bash',
    commandOrPayload: 'cast send 0xdeadbeef00000000000000000000000000000001 --value 1ether --account 0x1111111111111111111111111111111111111111',
    authorizedDepositAddress: '0x1111111111111111111111111111111111111111',
  });
  assert.equal(authorizedTx.allowed, true);
  assert.equal(authorizedTx.decision, 'allow');

  // 4d. Unauthorized sender (different --account) is blocked even if destination matches auth
  const unauthorizedSender = evaluateUnauthorizedWalletSpendDiode({
    toolName: 'bash',
    commandOrPayload: 'cast send 0x1111111111111111111111111111111111111111 --value 1ether --account 0xdeadbeef00000000000000000000000000000001',
    authorizedDepositAddress: '0x1111111111111111111111111111111111111111',
  });
  assert.equal(unauthorizedSender.allowed, false);

  // 4e. Transaction hash (0x + 64 hex) in read context is NOT blocked as private key
  const txHashRead = evaluateUnauthorizedWalletSpendDiode({
    toolName: 'bash',
    commandOrPayload: 'cast receipt 0xdeadbeef0000000000000000000000000000000000000000000000000000000001',
    authorizedDepositAddress: '0x1111111111111111111111111111111111111111',
  });
  assert.equal(txHashRead.allowed, true);

  // 4f. PRIVATE_KEY in context is blocked even without 0x{64}
  const envKeyRead = evaluateUnauthorizedWalletSpendDiode({
    toolName: 'bash',
    commandOrPayload: 'cat $PRIVATE_KEY',
    authorizedDepositAddress: '0x1111111111111111111111111111111111111111',
  });
  assert.equal(envKeyRead.allowed, false);
  assert.equal(envKeyRead.gateId, 'gate:vitalik_paranoid:wallet_secret_access_blocked');
});

test('zkapi.org v2 protocol steals: note-bound commitments, cross-pool isolation, failed-issuance escape nullifiers, and 4-stage lease retirement', () => {
  const genesis = computeZkApiNoteBoundCommitment({
    circuitId: ZKAPI_CIRCUIT_ID,
    poolId: 'robinhood-chain-mainnet',
    vaultAddress: '0x4386fdbda35d995beb3bf8625118ec5982ec81fe',
    noteId: 'note_42',
    registrationSecret: 'secret_abc',
    depositGwei: 100000,
    balanceGwei: 100000,
    chargeGwei: 15000,
    blinding: 'blind_1',
    expiryEpochSec: 1800000000,
  });
  assert.equal(genesis.balanceGwei, 85000);

  const afterSecondCharge = computeZkApiNoteBoundCommitment({
    circuitId: ZKAPI_CIRCUIT_ID,
    poolId: 'robinhood-chain-mainnet',
    vaultAddress: '0x4386fdbda35d995beb3bf8625118ec5982ec81fe',
    noteId: 'note_42',
    registrationSecret: 'secret_abc',
    depositGwei: 100000,
    balanceGwei: genesis.balanceGwei,
    chargeGwei: 5000,
    blinding: 'blind_2',
    expiryEpochSec: 1800000000,
  });
  assert.equal(afterSecondCharge.noteLeafL, genesis.noteLeafL, 'note leaf L must survive balance updates');
  assert.notEqual(afterSecondCharge.commitmentHash, genesis.commitmentHash);

  const crossPool = evaluateZkApiNullifierEscapeGate({
    requestPoolId: 'robinhood-chain-mainnet',
    expectedPoolId: 'ethereum-mainnet',
    noteLeafL: genesis.noteLeafL,
    commitmentNoteLeafL: genesis.noteLeafL,
    nullifier: genesis.nullifier,
  });
  assert.equal(crossPool.allowed, false);
  assert.equal(crossPool.reasonCode, 'cross_pool_replay_blocked');

  const escapedRetry = evaluateZkApiNullifierEscapeGate({
    requestPoolId: 'robinhood-chain-mainnet',
    expectedPoolId: 'robinhood-chain-mainnet',
    noteLeafL: genesis.noteLeafL,
    commitmentNoteLeafL: genesis.noteLeafL,
    nullifier: genesis.nullifier,
    escapeState: 'escaping',
  });
  assert.equal(escapedRetry.allowed, false);
  assert.equal(escapedRetry.reasonCode, 'nullifier_used');
  assert.equal(escapedRetry.createProviderKey, false);

  const premature = evaluateZkApiLeaseRetirement({
    completedStages: ['disable', 'grace', 'usage_capture'],
    inFlightCalls: 0,
    graceElapsedMs: 6000,
    requiredGraceMs: 5000,
    keyDeletionConfirmed: false,
    reservedGwei: 50000,
    meteredUsageGwei: 12000,
  });
  assert.equal(premature.canSignSettlement, false);
  assert.equal(premature.reasonCode, 'retirement_stages_incomplete');

  const settled = evaluateZkApiLeaseRetirement({
    completedStages: ['disable', 'grace', 'usage_capture', 'revocation'],
    inFlightCalls: 0,
    graceElapsedMs: 6000,
    requiredGraceMs: 5000,
    keyDeletionConfirmed: true,
    reservedGwei: 50000,
    meteredUsageGwei: 12000,
  });
  assert.equal(settled.canSignSettlement, true);
  assert.equal(settled.chargedGwei, 12000);
  assert.equal(settled.refundedGwei, 38000);
});

test('mcpmarket.com/server/tor-router steals: 7-priority selective routing, socks5h DNS-leak diode, 10s NEWNYM cooldown, and credential/plaintext exit blocker', () => {
  assert.throws(
    () => resolveTorRouterSelectiveRoute({ url: 'https://shodan.io', forceTor: true, forceDirect: true }),
    /mutually exclusive/,
  );

  // Priority 1: .onion always routes via Tor socks5h:// and blocks forceDirect
  const onion = resolveTorRouterSelectiveRoute({ url: 'http://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion' });
  assert.equal(onion.allowed, true);
  assert.equal(onion.route, 'tor');
  assert.equal(onion.priorityRule, '1:onion_domain');
  assert.equal(onion.proxyUrl, 'socks5h://127.0.0.1:9050');
  assert.equal(
    resolveTorRouterSelectiveRoute({ url: 'http://example.onion', forceDirect: true }).reasonCode,
    'onion_requires_tor_proxy',
  );

  // Priority 2: localhost / 127.0.0.1 / *.local auto-defaults to http:// and routes direct
  const local = resolveTorRouterSelectiveRoute({ url: 'localhost:8080/health' });
  assert.equal(local.allowed, true);
  assert.equal(local.route, 'direct');
  assert.equal(local.normalizedUrl, 'http://localhost:8080/health');
  assert.equal(
    resolveTorRouterSelectiveRoute({ url: 'http://127.0.0.1:8080', forceTor: true }).reasonCode,
    'loopback_over_tor_blocked',
  );

  // Priority 5 vs 6: OSINT domain (shodan.io) -> tor; Tor-blocking domain (github.com) -> direct
  assert.equal(resolveTorRouterSelectiveRoute({ url: 'api.shodan.io/shodan/host/8.8.8.8', defaultRoute: 'direct' }).route, 'tor');
  assert.equal(resolveTorRouterSelectiveRoute({ url: 'api.github.com/repos', defaultRoute: 'tor' }).route, 'direct');

  // Threat-model diode: blocks Authorization/Cookie headers or plaintext http:// over Tor exits
  const credLeak = resolveTorRouterSelectiveRoute({
    url: 'https://haveibeenpwned.com/api/v3/breachedaccount/test',
    headers: { Authorization: 'Bearer secret_token' },
  });
  assert.equal(credLeak.allowed, false);
  assert.equal(credLeak.reasonCode, 'account_deanonymization_credential_over_tor_blocked');

  const plaintextExit = resolveTorRouterSelectiveRoute({
    url: 'http://shodan.io/search',
  });
  assert.equal(plaintextExit.allowed, false);
  assert.equal(plaintextExit.reasonCode, 'plaintext_http_over_tor_exit_blocked');

  // DNS leak & 10s NEWNYM cooldown checks
  assert.equal(
    evaluateTorNewIdentityAndAnonymityCheck({ commandOrProxyUrl: 'curl --socks5 127.0.0.1:9050 https://check.torproject.org' }).reasonCode,
    'dns_leak_socks5_without_hostname_blocked',
  );
  assert.equal(
    evaluateTorNewIdentityAndAnonymityCheck({ elapsedSinceLastRotationMs: 4000 }).reasonCode,
    'identity_rotation_rate_limited_10s',
  );
  assert.equal(
    evaluateTorNewIdentityAndAnonymityCheck({ torExitIp: '106.213.80.181', directOriginIp: '106.213.80.181' }).reasonCode,
    'exit_ip_matches_origin_leak',
  );
  assert.equal(
    evaluateTorNewIdentityAndAnonymityCheck({
      commandOrProxyUrl: 'curl --socks5-hostname 127.0.0.1:9050 https://check.torproject.org',
      elapsedSinceLastRotationMs: 12000,
      torExitIp: '185.220.101.20',
      directOriginIp: '106.213.80.181',
    }).allowed,
    true,
  );
});

test('HyperFrames / Kyle Balmer AI Video Editing Guardrail: protects footage/, requires 5s smoke + cut log, and enforces <=15s micro-preview on revisions', () => {
  // 1. Blocks overwriting raw footage/
  const rawOverwrite = evaluateHyperframesVideoAgentGate({
    command: 'ffmpeg -y -i footage/raw_take.mp4 footage/raw_take.mp4',
  });
  assert.equal(rawOverwrite.allowed, false);
  assert.equal(rawOverwrite.gateId, 'gate:video:protect_raw_footage');

  // 2. Blocks full rough-cut render before 5s smoke test + transcript + reversible cut log
  const missingPrereqs = evaluateHyperframesVideoAgentGate({
    command: 'npx remotion render Main exports/rough-cut.mp4',
    phase: 'rough_cut',
    smokeTestPassed: true,
    hasTimestampedTranscript: true,
    hasReversibleCutLog: false,
  });
  assert.equal(missingPrereqs.allowed, false);
  assert.equal(missingPrereqs.gateId, 'gate:video:missing_cut_pipeline_prereqs');

  // 3. Revision QA (13:15): blocks full re-render without micro-preview bounds, compiles mid-sentence feedback (13:02)
  const fullRevisionBlocked = evaluateHyperframesVideoAgentGate({
    command: 'npx remotion render Main exports/full-video.mp4',
    phase: 'revision_qa',
    editorFeedbackText: 'You cut the sentence that explains the example, put it back',
  });
  assert.equal(fullRevisionBlocked.allowed, false);
  assert.equal(fullRevisionBlocked.gateId, 'gate:video:enforce_micro_preview_on_revision');
  assert.equal(fullRevisionBlocked.compiledJoinRule.minJoinHandleMs, 250);

  const microPreviewAllowed = evaluateHyperframesVideoAgentGate({
    command: 'npx remotion render Main exports/preview-cut-4.mp4 --frames=120-270',
    phase: 'revision_qa',
    previewDurationSec: 5,
  });
  assert.equal(microPreviewAllowed.allowed, true);
});

test('Microsoft AI MAI-Base-2 Frontier Pre-Training steals: source scaling, coupled (LR, LR*WD) laws, dropless multi-round MoE, and activation clipping diagnostics', () => {
  const ladder = computeMaiSourceScalingLadder({
    fullHorizonTokens: 50e12,
    fullRunRepetitions: 8,
    rungHorizonTokens: 5e12,
    totalUniqueCorpusTokens: 6.25e12,
  });
  assert.equal(ladder.matchesFullRunRepetition, true);
  assert.equal(ladder.effectiveRepetitions, 8);

  const hparams = computeMaiCoupledHyperparameters({
    steps: 100000,
    tokensPerActiveParam: 20,
    activeParams: 80e9,
  });
  assert.ok(hparams.optimalLr > 0);
  assert.ok(hparams.optimalWd > 0);
  assert.ok(hparams.optimalDropout > 0 && hparams.optimalDropout < 1);

  const moe = routeMaiDroplessMoE({
    expertLoads: [100, 20, 60, 40],
    perExpertCapacity: 64,
  });
  assert.equal(moe.droppedTokens, 0);
  assert.equal(moe.borrowedCapacity, 36);
  assert.equal(moe.roundsRequired, 1);

  const diag = clipAndDiagnoseMalformedExamples({
    examples: [
      { id: 'clean_pr', activationGradNorm: 1.8, snippet: '// SPDX-License-Identifier: MIT' },
      { id: 'truncated_license_pr', activationGradNorm: 14.2, snippet: '// Copyright (c) 2026 Permission is hereby granted, free of' },
    ],
    activationClipThreshold: 5.0,
  });
  assert.equal(diag.batchGlobalScalingApplied, false);
  assert.equal(diag.malformedDiagnostics.length, 1);
  assert.equal(diag.malformedDiagnostics[0].id, 'truncated_license_pr');
});

test('OpenAI Exact Quantum Factoring & Lean 4 audit steals: blocks sorry placeholder claims, locks dyadic integer comparison, prevents 99% reflection overshoot via 25% dilution, and bounds auxiliary tree memory', () => {
  const sorryBlocked = evaluateLeanProofCompletionGate({
    claimText: 'The Lean 4 comparator theorem is formally verified and proof complete.',
    sourceOrProofCode: 'theorem dyadic_majorant_exact : True := by\n  sorry',
  });
  assert.equal(sorryBlocked.allowed, false);
  assert.equal(sorryBlocked.phaseClassification, 'discovery_only_unverified');
  assert.equal(sorryBlocked.placeholderToken, 'sorry');

  const dyadic = compareDyadicMajorant({ value: 0.25, threshold: 0.25, exponentBits: 16 });
  assert.equal(dyadic.denominatorPow2, 65536);
  assert.equal(dyadic.passesReversibleIntegerComparison, true);

  // Without 25% dilution, a 99% starting probability overshoots on 3*theta reflection (~0.0886); diluting to 1/4 locks 1.0
  const amp = calibrateExactReflectionAmplifier({ initialProbability: 0.99 });
  assert.equal(amp.canDiluteToQuarter, true);
  assert.ok(amp.uncalibratedOvershootProb < 0.99, '99% without dilution overshoots and degrades below 99%');
  assert.equal(amp.tunedThetaDeg, 30);
  assert.equal(amp.amplifiedAngleDeg, 90);
  assert.equal(amp.amplifiedProbability, 1.0);

  const memBlocked = evaluateAuxiliaryVerificationTreeBudget({
    discoveredOddPrimesCount: 15,
    avgBranchingFactor: 4,
    bytesPerNode: 4096,
    maxClassicalMemoryMb: 256,
  });
  assert.equal(memBlocked.allowed, false);
  assert.equal(memBlocked.reasonCode, 'auxiliary_tree_classical_memory_exceeded');
});

test('Amazon Bee Frontier & Bee Eclipse steals: enforces Bee Private Compute ephemeral audio + silence shutoff, blocks ambient auto-purchase/send, requires Alexa Voice ID, and promotes recurring themes across 14-day memory', () => {
  assert.equal(
    evaluateBeePrivateComputeDiode({ rawAudioStoredToDisk: true }).reasonCode,
    'raw_audio_persistence_forbidden',
  );
  assert.equal(
    evaluateBeePrivateComputeDiode({ isPhoneCallAttachment: true, callParticipantConsentPrompted: false }).reasonCode,
    'call_participant_consent_required',
  );
  assert.equal(
    evaluateBeePrivateComputeDiode({ silenceElapsedMs: 16 * 60 * 1000, silenceAutoOffThresholdMs: 15 * 60 * 1000 }).reasonCode,
    'silence_timeout_auto_shutoff',
  );

  assert.equal(
    evaluateBeeAmbientActionGate({ actionType: 'auto_purchase_item', targetConnector: 'amazon' }).gateId,
    'gate:bee_ambient:overheard_speech_cannot_commit_mutation',
  );
  assert.equal(
    evaluateBeeAmbientActionGate({ actionType: 'draft_followup_email', targetConnector: 'outlook' }).gateId,
    'gate:bee_ambient:corporate_outlook_eci_isolated',
  );
  assert.equal(
    evaluateBeeAmbientActionGate({ actionType: 'alexa_readout_summary', voiceIdVerified: false }).gateId,
    'gate:bee_ambient:voice_id_required_for_alexa_readout',
  );
  assert.equal(
    evaluateBeeAmbientActionGate({ actionType: 'surface_shopping_recommendation', targetConnector: 'amazon' }).allowed,
    true,
  );

  const nowMs = Date.parse('2026-10-18T18:00:00Z');
  const dayMs = 24 * 60 * 60 * 1000;
  const mem = pruneAndPromoteBeeRollingMemory({
    nowMs,
    retentionDays: 14,
    minRecurrenceForPromotion: 3,
    memories: [
      { id: 1, theme: 'one-off-coffee', timestampMs: nowMs - 20 * dayMs },
      { id: 2, theme: 'buy-dish-soap', timestampMs: nowMs - 18 * dayMs },
      { id: 3, theme: 'buy-dish-soap', timestampMs: nowMs - 10 * dayMs },
      { id: 4, theme: 'buy-dish-soap', timestampMs: nowMs - 2 * dayMs },
    ],
  });
  assert.equal(mem.prunedExpiredCount, 1);
  assert.equal(mem.promotedRecurringGoals.length, 1);
  assert.equal(mem.promotedRecurringGoals[0].theme, 'buy-dish-soap');
});

test('Claude Quantum Circuits / OpenEvolve Divsteps & Ryan Dahl celld/workerd steals: 17x T*Q compound fitness, multi-architecture islands, hybrid 60-branch cutoff, Kickmix verifier, and 300KB Durable Object governance cells', () => {
  const fitness = computeCompoundTxQFitness({
    gateCountT: 1000,
    peakLogicalQubitsQ: 19,
    baselineTxQ: 323000,
    correctnessVerified: true,
  });
  assert.equal(fitness.valid, true);
  assert.equal(fitness.reductionFactorVsBaseline, 17);

  const islands = evolveMultiArchitectureIslandArchive({
    crossPollinate: true,
    candidates: [
      { id: 'c1', family: 'divsteps_parity', gateCountT: 1000, peakLogicalQubitsQ: 20, correctnessVerified: true },
      { id: 'c2', family: 'berlekamp_massey_rescaled', gateCountT: 1500, peakLogicalQubitsQ: 19, correctnessVerified: true },
      { id: 'c3', family: 'broken_circuit', gateCountT: 10, peakLogicalQubitsQ: 2, correctnessVerified: false },
    ],
  });
  assert.equal(islands.preservedFamilyCount, 2);
  assert.equal(islands.crossPollinatedPairs.length, 1);

  const hybridOk = evaluateHybridDivstepsUncomputation({
    totalBranches: 200,
    parityDeducedShallowBranches: 150,
    maxAmbiguousStorageCap: 60,
    primitiveFailureRate: 4 / 100000,
    downstreamErrorTolerance: 1e-4,
    adversarialInputExposed: false,
  });
  assert.equal(hybridOk.allowed, true);
  assert.equal(hybridOk.ambiguousBranchesStored, 50);

  const kickmix = verifyKickmixBasisTrajectory({
    trajectories: [
      { id: 'basis_1', residualDirtyAncillas: 0, outputMatchesExpected: true, phaseVerified: true },
      { id: 'basis_2', residualDirtyAncillas: 1, outputMatchesExpected: true, phaseVerified: true },
    ],
  });
  assert.equal(kickmix.ok, false);
  assert.deepEqual(kickmix.dirtyAncillaRuns, ['basis_2']);

  const cell = createDurableGovernanceCell({
    entity: 'igor',
    project: 'thumbgate',
    processName: 'pretooluse',
    session: 'sess_42',
    statePayloadBytes: 64 * 1024,
    maxIsolateMemoryBytes: 300 * 1024,
  });
  assert.equal(cell.withinIsolateBudget, true);
  assert.equal(cell.singleThreadedActor, true);
  assert.match(cell.colocatedSqliteDb, /^cell_[a-f0-9]{24}\.sqlite$/);
});

test('Dan Kornas SMG KV-cache prefix router & MarkTechPost 20-Jev-Alternatives guard: canonicalizes volatile prefixes, routes by cached prefix minus queue work, and quarantines high-ASR/flipping decision models', () => {
  const p1 = canonicalizePromptForKvCachePrefix('You are a PreToolUse gate. request_id=req_111 timestamp=2026-10-18T18:00:00Z');
  const p2 = canonicalizePromptForKvCachePrefix('You are a PreToolUse gate. request_id=req_999 timestamp=2026-10-18T19:00:00Z');
  assert.equal(p1.staticPrefixHash, p2.staticPrefixHash, 'stripping volatile front-matter must preserve exact KV prefix hash');

  const routed = routeSmgKvCacheAwareBackend({
    staticPrefixHash: p1.staticPrefixHash,
    prefixTokenLength: 4000,
    workers: [
      { workerId: 'w_cold', cachedPrefixHashes: [], queuedTokens: 100 },
      { workerId: 'w_warm_cache', cachedPrefixHashes: [p1.staticPrefixHash], queuedTokens: 500 },
    ],
  });
  assert.equal(routed.selectedWorker.workerId, 'w_warm_cache');
  assert.equal(routed.selectedWorker.cacheHit, true);

  // Laya (0.396 injection ASR in Respan table) is blocked
  const layaBlocked = evaluateSystemOneDecisionModelGuard({ modelId: 'laya-421m' });
  assert.equal(layaBlocked.codeVerdict, 'block');
  assert.equal(layaBlocked.reasonCode, 'decision_model_injection_asr_too_high');

  // Kev-4B option-order flip is escalated to review
  const kevFlipped = evaluateSystemOneDecisionModelGuard({
    modelId: 'kev-4b',
    options: ['deny', 'allow'],
    forwardWinner: 'allow',
    reversedOrderWinner: 'deny',
  });
  assert.equal(kevFlipped.codeVerdict, 'review');
  assert.equal(kevFlipped.reasonCode, 'paired_option_order_flip_detected');

  // Tev1-4B (0.031 ECE, 0.042 injection ASR) with consistent option order passes
  const tev1Pass = evaluateSystemOneDecisionModelGuard({
    modelId: 'tev1-4b',
    options: ['deny', 'allow'],
    forwardWinner: 'deny',
    reversedOrderWinner: 'deny',
  });
  assert.equal(tev1Pass.codeVerdict, 'pass');
  assert.equal(tev1Pass.codeOwnsFinalGate, true);
});

test('Auth0 Passkeys, Meta Muse Spark Open, Semrush 126M AI Visibility Index, and Perplexity SPACE sandbox steals', () => {
  // 1. Auth0 Passkeys: blocks phishing origin mismatch and cloned signCount regression
  assert.equal(
    verifyPasskeyStepUpAssertion({
      expectedOrigin: 'https://thumbgate.ai',
      clientDataOrigin: 'https://evil-phish.example',
      expectedChallenge: 'c1',
      clientDataChallenge: 'c1',
      expectedActionDigest: 'd1',
      boundActionDigest: 'd1',
    }).reasonCode,
    'phishing_cross_origin_rp_mismatch',
  );
  assert.equal(
    verifyPasskeyStepUpAssertion({
      expectedChallenge: 'c1',
      clientDataChallenge: 'c1',
      expectedActionDigest: 'd1',
      boundActionDigest: 'd1',
      previousSignCount: 10,
      currentSignCount: 10,
    }).reasonCode,
    'cloned_authenticator_sign_count_regression',
  );
  assert.equal(
    verifyPasskeyStepUpAssertion({
      expectedChallenge: 'c1',
      clientDataChallenge: 'c1',
      expectedActionDigest: 'd1',
      boundActionDigest: 'd1',
      previousSignCount: 10,
      currentSignCount: 11,
    }).allowed,
    true,
  );

  // 2. Meta Muse Spark Open (816B-A42B, 1M context, 2x512GB M5 Ultra, "Built with Muse Spark Open" label, $20M license)
  assert.equal(
    evaluateMuseSparkLongRunningFence({ unverifiedTurnsSinceCheckpoint: 8, maxUnverifiedTurns: 5 }).allowed,
    false,
  );
  assert.equal(
    evaluateMuseSparkLongRunningFence({ hasBuiltWithAttribution: false }).reasonCode,
    'missing_built_with_muse_spark_open_attribution',
  );
  assert.equal(
    evaluateMuseSparkLongRunningFence({ isCommercialApiReseller: true, annualProviderRevenueUsd: 25000000, hasMetaCommercialAgreement: false }).reasonCode,
    'meta_20m_revenue_commercial_license_required',
  );
  assert.equal(
    evaluateMuseSparkLongRunningFence({ deploymentMode: 'local_m5_ultra_cluster', localUnifiedMemoryGb: 512 }).reasonCode,
    'insufficient_m5_ultra_unified_memory_requires_2x512gb',
  );
  assert.equal(
    evaluateMuseSparkLongRunningFence({ unverifiedTurnsSinceCheckpoint: 3, maxUnverifiedTurns: 5 }).allowed,
    true,
  );

  // 3. Semrush 2026 AI Visibility Index (15 citations ChatGPT vs 3 Gemini, 1.60x conv, 1.53x rev)
  const chatgptVis = computeSemrushAiVisibilityStrategy({ targetPlatform: 'chatgpt', market: 'US', baselineConversionRate: 0.02, baselineRevenuePerVisitUsd: 100 });
  const geminiUkVis = computeSemrushAiVisibilityStrategy({ targetPlatform: 'gemini', market: 'UK', baselineConversionRate: 0.02, baselineRevenuePerVisitUsd: 100 });
  assert.equal(chatgptVis.avgCitationsPerResponse, 15);
  assert.equal(geminiUkVis.avgCitationsPerResponse, 3);
  assert.equal(chatgptVis.aiReferredConversionRate, 0.032);
  assert.equal(chatgptVis.aiReferredRevenuePerVisitUsd, 153);

  // 4. Perplexity SPACE sandbox + ThumbGate PreToolUse in-sandbox firewall
  const inSandboxAbuse = evaluateSpaceSandboxPlusThumbGateFirewall({
    spaceContainerContained: true,
    attemptedContainerBreakout: false,
    inSandboxToolCall: 'git push --force origin main',
  });
  assert.equal(inSandboxAbuse.allowed, false);
  assert.equal(inSandboxAbuse.enforcedBy, 'thumbgate_pretooluse_in_sandbox_firewall');
});

test('Sonable 4-agent AI visibility loop: enforces no-go topics, separates Autopilot (content/technical) from Copilot review queue (outreach/community), and emits reversible undo receipts', () => {
  const blockedNoGo = evaluateSonableFourAgentVisibilityLoop({
    mode: 'autopilot',
    agentRole: 'content_agent',
    proposedFixText: 'Reference internal ecisolutions.com deployment',
  });
  assert.equal(blockedNoGo.executionState, 'blocked_no_go_topic');
  assert.equal(blockedNoGo.allowedToExecuteAutonomously, false);

  const techAutopilot = evaluateSonableFourAgentVisibilityLoop({
    mode: 'autopilot',
    agentRole: 'technical_agent',
    proposedFixText: 'Add current $499 Sprint Diagnostic JSON-LD price to public/pricing.html',
    expectedRevenueImpactUsd: 1497,
    previousStateSnapshot: 'old_json_ld',
  });
  assert.equal(techAutopilot.executionState, 'executed_on_autopilot');
  assert.equal(techAutopilot.allowedToExecuteAutonomously, true);
  assert.match(techAutopilot.reversibleUndoReceipt, /^undo_[a-f0-9]{16}$/);

  const outreachCopilot = evaluateSonableFourAgentVisibilityLoop({
    mode: 'autopilot',
    agentRole: 'outreach_agent',
    proposedFixText: 'Ask review site to update outdated price',
    expectedRevenueImpactUsd: 998,
  });
  assert.equal(outreachCopilot.executionState, 'queued_in_copilot_review');
  assert.equal(outreachCopilot.queuedForHumanReview, true);
});

test('ServiceNow AI Passport & Runtime Brake steal: enforces signed permissions+manager+budget, CMDB freshness, standing PO sign-off on background routines, and graduated alert/throttle/block brake', () => {
  const nowMs = Date.parse('2026-10-18T18:00:00Z');
  const basePassport = {
    signatureVerified: true,
    namedManagerId: 'mgr_igor',
    hardBudgetCapUsd: 100,
    currentSpendUsd: 20,
    cmdbAttestedAtMs: nowMs - 1000,
    authorizedScopes: ['jira:read', 'github:pr'],
    managerSignedStandingPo: false,
  };

  // Stale CMDB attestation is blocked
  assert.equal(
    evaluateServiceNowAiPassportAndBrake({
      passport: { ...basePassport, cmdbAttestedAtMs: nowMs - 48 * 3600 * 1000 },
      nowMs,
    }).reasonCode,
    'stale_cmdb_grc_passport_attestation',
  );

  // Background Productivity Routine without signed standing PO is blocked
  assert.equal(
    evaluateServiceNowAiPassportAndBrake({
      passport: basePassport,
      isBackgroundRoutine: true,
      nowMs,
    }).reasonCode,
    'background_routine_requires_signed_standing_po',
  );

  // Graduated brake: 95% spend -> throttle; 100% spend -> block
  assert.equal(
    evaluateServiceNowAiPassportAndBrake({
      passport: { ...basePassport, currentSpendUsd: 95 },
      requestedScope: 'jira:read',
      nowMs,
    }).brakeAction,
    'throttle',
  );
  assert.equal(
    evaluateServiceNowAiPassportAndBrake({
      passport: { ...basePassport, currentSpendUsd: 100 },
      requestedScope: 'jira:read',
      nowMs,
    }).brakeAction,
    'block',
  );
});

test('OpenAI On-Call Dot -> Codex 3am Triage & GPT-6 Maintenance steals: blocks unattended 3am prod mutations, enforces mobile steer epoch fence, and blocks deleting code with live telemetry', () => {
  const unattendedProdDeploy = evaluateOnCallDotToCodexHandoff({
    phase: 'unattended_3am_triage',
    proposedCommand: 'kubectl apply -f prod-hotfix.yaml',
    mobileSteerAuthenticated: false,
  });
  assert.equal(unattendedProdDeploy.allowed, false);
  assert.equal(
    unattendedProdDeploy.reasonCode,
    'unattended_3am_dot_limited_to_readonly_and_codex_thread_spawn',
  );

  const deadCodeWithLiveTraffic = evaluateOnCallDotToCodexHandoff({
    phase: 'mobile_steered_codex',
    mobileSteerAuthenticated: true,
    isDeadCodeRemoval: true,
    observedCallsLast30d: 42,
  });
  assert.equal(deadCodeWithLiveTraffic.allowed, false);
  assert.equal(deadCodeWithLiveTraffic.reasonCode, 'telemetry_shows_live_usage_dead_code_delete_blocked');

  const validTriage = evaluateOnCallDotToCodexHandoff({
    phase: 'unattended_3am_triage',
    proposedCommand: 'git log -n 10 --oneline',
  });
  assert.equal(validTriage.allowed, true);
});

test('Anthropic Scion & Antique agent-scale VCS steal: blocks full git clone for history/CI queries (200x smaller footprint), rate-limits agent merge bursts, and requires simulation+fuzzing on core infra', () => {
  const fullCloneBlocked = evaluateScionAgentScaleVcsGate({
    commandOrOperation: 'git clone https://github.com/IgorGanapolsky/ThumbGate.git',
    operationIntent: 'history_query',
  });
  assert.equal(fullCloneBlocked.allowed, false);
  assert.equal(fullCloneBlocked.reasonCode, 'full_git_clone_blocked_use_api_or_blobless_sparse_checkout');
  assert.equal(fullCloneBlocked.footprintReductionFactor, 200);

  const bloblessAllowed = evaluateScionAgentScaleVcsGate({
    commandOrOperation: 'git clone --filter=blob:none --sparse https://github.com/IgorGanapolsky/ThumbGate.git',
    operationIntent: 'ci_single_path',
  });
  assert.equal(bloblessAllowed.allowed, true);

  const missingFuzzing = evaluateScionAgentScaleVcsGate({
    commandOrOperation: 'gh pr merge',
    touchesCoreInfra: true,
    simulationAndFuzzingPassed: false,
  });
  assert.equal(missingFuzzing.allowed, false);
  assert.equal(missingFuzzing.reasonCode, 'antique_core_infra_requires_simulation_and_fuzzing');
});

test('Subquadratic SubQ Snap 384K router, SanSi (arXiv:2610.07730) System 1.5 looped decisions, and Bruno .bru Git-native API diode', () => {
  const snap = evaluateSubQSnapCoarseModuleRouter({
    modules: [
      { name: 'scripts/gates-engine.js', tokens: 65000 },
      { name: 'scripts/financial-control-plane.js', tokens: 35000 },
    ],
    taskType: 'cross_module_bug_triage',
  });
  assert.equal(snap.selectedEngine, 'subq_snap_384k_ssa');
  assert.equal(snap.fragileSnippetChunkingEliminated, true);
  assert.equal(snap.estimatedInputCostUsd, 0.005);
  assert.equal(snap.outputCostUsd, 0);

  const when2call = evaluateSubQSnapCoarseModuleRouter({
    modules: [{ name: 'tool.js', tokens: 2000 }],
    taskType: 'when2call',
  });
  assert.equal(when2call.selectedEngine, 'thumbgate_deterministic_pretooluse_plus_jev');

  const sansi = evaluateSanSiLoopedSystem15Gate({
    loopProbabilities: [0.52, 0.61, 0.74, 0.91, 0.92, 0.93, 0.93, 0.94],
    earlyStopConfidenceThreshold: 0.85,
  });
  assert.equal(sansi.allowed, true);
  assert.equal(sansi.loopsExecuted, 4);
  assert.equal(sansi.earlyStopped, true);
  assert.equal(sansi.finalConfidence, 0.91);

  const bruLeak = evaluateBrunoGitNativeCollectionDiode({
    bruContent: 'headers {\n  Authorization: Bearer sk-live1234567890abcdef123456\n}',
  });
  assert.equal(bruLeak.allowed, false);
  assert.equal(bruLeak.reasonCode, 'inline_secret_in_bru_file_use_vars_secret');

  const bruSafe = evaluateBrunoGitNativeCollectionDiode({
    bruContent: 'vars:secret [\n  apiKey\n]\nheaders {\n  Authorization: Bearer {{apiKey}}\n}',
  });
  assert.equal(bruSafe.allowed, true);
});

test('Ouroboros continuity & reward-hack audit steal: blocks unchecked self-rewrite of firewall, enforces forked subagent memory isolation, and zeroes reward-hacked benchmark trials', () => {
  const selfRewriteBlocked = evaluateOuroborosContinuityAndRewardHackGate({
    targetFile: 'config/gates/default.json',
    hasIndependentHumanApproval: false,
  });
  assert.equal(selfRewriteBlocked.allowed, false);
  assert.equal(selfRewriteBlocked.reasonCode, 'self_rewrite_is_a_gated_tool_call_requires_human_approval');
  assert.equal(selfRewriteBlocked.offerPath, '/continuity.html');

  const forkedWriteBlocked = evaluateOuroborosContinuityAndRewardHackGate({
    targetFile: 'src/app.js',
    memoryMode: 'forked',
    subagentAttemptsParentMemoryWrite: true,
  });
  assert.equal(forkedWriteBlocked.allowed, false);
  assert.equal(forkedWriteBlocked.reasonCode, 'forked_memory_mode_subagent_cannot_mutate_parent_memory');

  const audited = evaluateOuroborosContinuityAndRewardHackGate({
    targetFile: 'src/app.js',
    totalTrials: 445,
    passedRawTrials: 387,
    rewardHackTrialsCount: 1,
  });
  assert.equal(audited.allowed, true);
  assert.equal(audited.rawScorePct, 86.97);
  assert.equal(audited.auditedScorePct, 86.74);
  assert.equal(audited.zeroedRewardHackTrials, 1);
});

const {
  evaluateWorktreeNotesIsolationAndCliEnvelope,
} = require('../scripts/proactive-partner-discovery-engine');

test('097-personal-notes-worktrees & 129-agent-cli steals: refuses notes inside any worktree, enforces --expect SHA-256 CAS exit 4, and emits argv next_actions', () => {
  const insideWorktree = evaluateWorktreeNotesIsolationAndCliEnvelope({
    notesDir: '/repo/.claude/worktrees/feat-a/notes',
    worktreePaths: ['/repo', '/repo/.claude/worktrees/feat-a'],
  });
  assert.equal(insideWorktree.ok, false);
  assert.equal(insideWorktree.exit, 1);
  assert.equal(insideWorktree.diagnostics[0].name, 'notes_inside_repository');
  assert.deepEqual(insideWorktree.diagnostics[0].next_actions[0].argv, ['node', 'bin/cli.js', 'doctor', '--json']);

  const casConflict = evaluateWorktreeNotesIsolationAndCliEnvelope({
    notesDir: '/Users/iganapolsky/Documents/AI-Agent-Sync',
    worktreePaths: ['/repo'],
    apply: true,
    expectedSha256: 'aaa',
    actualSha256: 'bbb',
  });
  assert.equal(casConflict.ok, false);
  assert.equal(casConflict.exit, 4);
  assert.equal(casConflict.diagnostics[0].name, 'concurrent_edit_hash_mismatch');

  const previewOk = evaluateWorktreeNotesIsolationAndCliEnvelope({
    notesDir: '/Users/iganapolsky/Documents/AI-Agent-Sync',
    worktreePaths: ['/repo'],
    apply: false,
  });
  assert.equal(previewOk.ok, true);
  assert.equal(previewOk.outcome, 'preview');
  assert.equal(previewOk.exit, 0);
});
