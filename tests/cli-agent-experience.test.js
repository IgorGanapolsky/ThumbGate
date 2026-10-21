'use strict';

/**
 * Tests for the agent-first CLI experience features:
 *   - thumbgate status [--json]
 *   - thumbgate demo [--json]
 *   - thumbgate explore lessons [--json]
 *   - thumbgate explore rules [--json]
 *   - thumbgate explore gates [--json]
 *   - thumbgate explore firings [--json]
 *   - --json flag on capture, summary, rules, compact
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const CLI = path.resolve(__dirname, '../bin/cli.js');
const PKG_ROOT = path.resolve(__dirname, '..');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-agent-test-'));
}

function runCliSync(args, options = {}) {
  const { env: optEnv, ...restOptions } = options;
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 20000,
    killSignal: 'SIGKILL',
    maxBuffer: 10 * 1024 * 1024,
    ...restOptions,
    env: { THUMBGATE_API_URL: 'http://127.0.0.1:1', THUMBGATE_NO_NUDGE: '1', ...process.env, ...optEnv },
  });
}

function setupFeedbackDir(tmpDir) {
  const feedbackDir = path.join(tmpDir, '.thumbgate');
  fs.mkdirSync(feedbackDir, { recursive: true });

  // Write some mock feedback entries
  const feedbackLog = [
    { id: 'fb-001', signal: 'negative', context: 'force-pushed to main', tags: ['git', 'deployment'], timestamp: '2026-04-10T10:00:00.000Z' },
    { id: 'fb-002', signal: 'positive', context: 'tests passed correctly', tags: ['testing'], timestamp: '2026-04-11T10:00:00.000Z' },
    { id: 'fb-003', signal: 'negative', context: 'skipped code review', tags: ['review'], timestamp: '2026-04-12T10:00:00.000Z' },
  ];
  fs.writeFileSync(
    path.join(feedbackDir, 'feedback-log.jsonl'),
    feedbackLog.map(e => JSON.stringify(e)).join('\n') + '\n'
  );

  // Write memory log (lessons)
  const memoryLog = [
    { id: 'mem-001', signal: 'negative', content: 'force-push to main overwrites work', tags: ['git'], domain: 'git-workflow', timestamp: '2026-04-10T10:00:00.000Z', sourceFeedbackId: 'fb-001' },
    { id: 'mem-002', signal: 'positive', content: 'TDD approach worked well', tags: ['testing'], domain: 'testing', timestamp: '2026-04-11T10:00:00.000Z', sourceFeedbackId: 'fb-002' },
  ];
  fs.writeFileSync(
    path.join(feedbackDir, 'memory-log.jsonl'),
    memoryLog.map(e => JSON.stringify(e)).join('\n') + '\n'
  );

  // Write prevention rules
  fs.writeFileSync(
    path.join(feedbackDir, 'prevention-rules.md'),
    '# Prevention Rules\n\n## Never force-push to main\nForce-pushing overwrites others\' work.\n\n## Always run tests\nTests must pass before committing.\n'
  );

  // Write rejection ledger (gate firings)
  const rejections = [
    { id: 'rej-001', signal: 'negative', context: 'tried to force-push', reason: 'auto-gate: force-push', timestamp: '2026-04-13T10:00:00.000Z' },
  ];
  fs.writeFileSync(
    path.join(feedbackDir, 'rejection-ledger.jsonl'),
    rejections.map(e => JSON.stringify(e)).join('\n') + '\n'
  );

  return feedbackDir;
}

describe('agent-first CLI experience', () => {
  let tmpDir;
  let feedbackDir;

  before(() => {
    tmpDir = makeTmpDir();
    feedbackDir = setupFeedbackDir(tmpDir);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // status command
  // -------------------------------------------------------------------------

  test('status exits 0 and shows agent-friendly output', () => {
    const result = runCliSync(['status'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `status failed:\n${result.stderr}`);
    assert.match(result.stdout, /thumbgate status/);
    assert.match(result.stdout, /Enforcement/);
    assert.match(result.stdout, /Lessons/);
    assert.match(result.stdout, /Feedback/);
  });

  test('status --json outputs valid JSON with expected fields', () => {
    const result = runCliSync(['status', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `status --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('version' in data);
    assert.ok('gates' in data);
    assert.ok('lessons' in data);
    assert.ok('feedback' in data);
    assert.ok('enforcementActive' in data);
    assert.ok('lastFeedbackTimestamp' in data);
    assert.equal(typeof data.lessons, 'number');
    assert.equal(typeof data.feedback.total, 'number');
    assert.equal(data.feedback.total, 3);
    assert.equal(data.lessons, 2);
  });

  // -------------------------------------------------------------------------
  // demo command
  // -------------------------------------------------------------------------

  test('demo exits 0 and shows walkthrough', () => {
    const result = runCliSync(['demo'], { cwd: tmpDir });
    assert.equal(result.status, 0, `demo failed:\n${result.stderr}`);
    assert.match(result.stdout, /thumbgate demo/i);
    assert.match(result.stdout, /force/i);
    assert.match(result.stdout, /BLOCKED/i);
  });

  test('demo --json outputs structured steps', () => {
    const result = runCliSync(['demo', '--json'], { cwd: tmpDir });
    assert.equal(result.status, 0, `demo --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.equal(data.demo, true);
    assert.ok(Array.isArray(data.steps));
    assert.ok(data.steps.length >= 4);
    assert.equal(data.steps[0].event, 'bad_action');
    assert.equal(data.steps[data.steps.length - 1].result, 'BLOCKED');
  });

  // -------------------------------------------------------------------------
  // explore subcommands
  // -------------------------------------------------------------------------

  test('explore lessons --json outputs lesson array', () => {
    const result = runCliSync(['explore', 'lessons', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `explore lessons --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('lessons' in data);
    assert.ok(Array.isArray(data.lessons));
    assert.equal(data.lessons.length, 2);
    assert.equal(data.scope, 'local');
    assert.ok(data.lessons[0].id);
    assert.ok(data.lessons[0].scope === 'local');
  });

  test('explore lessons (no --json) shows human-readable output with badges', () => {
    const result = runCliSync(['explore', 'lessons'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `explore lessons failed:\n${result.stderr}`);
    assert.match(result.stdout, /explore lessons/);
  });

  test('explore rules --json outputs rules array', () => {
    const result = runCliSync(['explore', 'rules', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `explore rules --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('rules' in data);
    assert.ok(Array.isArray(data.rules));
    assert.equal(data.rules.length, 2);
    assert.equal(data.scope, 'local');
  });

  test('explore gates --json outputs gates array', () => {
    const result = runCliSync(['explore', 'gates', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `explore gates --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('gates' in data);
    assert.ok(Array.isArray(data.gates));
    assert.equal(data.scope, 'local');
  });

  test('explore firings --json outputs firings array', () => {
    const result = runCliSync(['explore', 'firings', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `explore firings --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('firings' in data);
    assert.ok(Array.isArray(data.firings));
    assert.equal(data.firings.length, 1);
    assert.equal(data.firings[0].result, 'blocked');
  });

  test('explore --json without subcommand defaults to lessons', () => {
    const result = runCliSync(['explore', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `explore --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('lessons' in data);
  });

  // -------------------------------------------------------------------------
  // --json on existing commands
  // -------------------------------------------------------------------------

  test('stats --json outputs JSON with expected fields', () => {
    const result = runCliSync(['stats', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `stats --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('total' in data);
    assert.ok('approvalRate' in data);
  });

  test('summary --json outputs JSON', () => {
    const result = runCliSync(['summary', '--json'], {
      cwd: tmpDir,
      env: { THUMBGATE_FEEDBACK_DIR: feedbackDir },
    });
    assert.equal(result.status, 0, `summary --json failed:\n${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.ok('total' in data);
    assert.ok('approvalRate' in data);
  });

  // -------------------------------------------------------------------------
  // cli-status module
  // -------------------------------------------------------------------------

  test('generateAgentStatus returns expected shape', () => {
    const { generateAgentStatus } = require('../scripts/cli-status');
    // Point to mock feedback dir via env
    const savedDir = process.env.THUMBGATE_FEEDBACK_DIR;
    process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
    try {
      const status = generateAgentStatus({ pkgRoot: PKG_ROOT, projectDir: tmpDir });
      assert.equal(typeof status.version, 'string');
      assert.equal(typeof status.lessons, 'number');
      assert.equal(typeof status.feedback.total, 'number');
      assert.equal(typeof status.enforcementActive, 'boolean');
      assert.ok('gates' in status);
      assert.ok('preventionRules' in status);
    } finally {
      if (savedDir !== undefined) process.env.THUMBGATE_FEEDBACK_DIR = savedDir;
      else delete process.env.THUMBGATE_FEEDBACK_DIR;
    }
  });

  // -------------------------------------------------------------------------
  // explore-subcommands module
  // -------------------------------------------------------------------------

  test('exploreLessons returns JSON payload', () => {
    const { exploreLessons } = require('../scripts/explore-subcommands');
    const result = exploreLessons({ feedbackDir, json: true, limit: 10 });
    assert.ok(Array.isArray(result.lessons));
    assert.equal(result.scope, 'local');
  });

  test('exploreRules returns JSON payload', () => {
    const { exploreRules } = require('../scripts/explore-subcommands');
    const result = exploreRules({ feedbackDir, json: true });
    assert.ok(Array.isArray(result.rules));
    assert.equal(result.rules.length, 2);
  });

  test('exploreGateFirings returns JSON payload', () => {
    const { exploreGateFirings } = require('../scripts/explore-subcommands');
    const result = exploreGateFirings({ feedbackDir, json: true });
    assert.ok(Array.isArray(result.firings));
    assert.equal(result.firings.length, 1);
  });

  // -------------------------------------------------------------------------
  // cli-demo module
  // -------------------------------------------------------------------------

  test('runDemo returns string for human output', () => {
    const { runDemo } = require('../scripts/cli-demo');
    const result = runDemo({ json: false });
    assert.equal(typeof result, 'string');
    assert.match(result, /BLOCKED/);
    assert.match(result, /force/i);
  });

  test('runDemo returns JSON object for --json', () => {
    const { runDemo } = require('../scripts/cli-demo');
    const result = runDemo({ json: true });
    assert.equal(typeof result, 'object');
    assert.equal(result.demo, true);
    assert.ok(Array.isArray(result.steps));
  });

  test('LaunchVideo.io FORMAT steal: brand token extraction, virtual clock seek, check_scene gate, 3h scoped Blob manifest, and MP4 completion gate', () => {
    const {
      extractBrandTokensFromHtml,
      buildVirtualClockTimeline,
      seekVirtualClockFrame,
      checkSceneGate,
      mintScopedBlobUploadManifest,
      verifyMp4ArtifactCompletion,
      buildLaunchVideoHonestyReport,
    } = require('../scripts/cli-demo');

    const tokens = extractBrandTokensFromHtml(`
      <html>
        <head>
          <title>ThumbGate — Infrastructure Firewall</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
          <style>body { color: #0f172a; background: #0f172a; border-color: #22c55e; }</style>
        </head>
        <body><h1>Stop paying for the same AI mistake twice.</h1><h2>Sub-5ms PreToolUse gates</h2></body>
      </html>
    `);
    assert.equal(tokens.title, 'ThumbGate — Infrastructure Firewall');
    assert.deepEqual(tokens.headings, ['Stop paying for the same AI mistake twice.', 'Sub-5ms PreToolUse gates']);
    assert.equal(tokens.topHexColors[0], '#0f172a');
    assert.deepEqual(tokens.googleFonts, ['Inter', 'JetBrains Mono']);

    const timeline = buildVirtualClockTimeline({ durationSeconds: 32, fps: 30 });
    assert.equal(timeline.usesVideoDiffusionModel, false);
    assert.equal(timeline.totalFrames, 960);
    assert.equal(timeline.crf, 18);
    assert.equal(seekVirtualClockFrame(45, 30).virtualTimeMs, 1500);

    const failedScene = checkSceneGate({
      jsErrors: ['ReferenceError: x is not defined'],
      sampleFrames: [{ t: 0, visibleText: 'Title' }],
    });
    assert.equal(failedScene.readyToRender, false);
    assert.equal(failedScene.reason, 'js_runtime_errors_detected');

    const passedScene = checkSceneGate({
      jsErrors: [],
      sampleFrames: [
        { t: 0, visibleText: 'Ship a launch video.' },
        { t: 10, visibleText: 'Sub-5ms PreToolUse Firewall' },
      ],
    });
    assert.equal(passedScene.readyToRender, true);

    const secretLeakManifest = mintScopedBlobUploadManifest({
      jobId: 'job_123',
      agentEnv: { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_secret' },
    });
    assert.equal(secretLeakManifest.ok, false);
    assert.equal(secretLeakManifest.agentHoldsMasterSecret, true);

    const cleanManifest = mintScopedBlobUploadManifest({
      jobId: 'job_123',
      ttlSeconds: 999999,
      agentEnv: {},
    });
    assert.equal(cleanManifest.ok, true);
    assert.equal(cleanManifest.agentHoldsMasterSecret, false);
    assert.equal(cleanManifest.scopedPath, 'jobs/job_123/launch.mp4');
    assert.equal(cleanManifest.ttlSeconds, 10800);

    const prematureDone = verifyMp4ArtifactCompletion({
      events: ['tool.started', 'tool.completed', 'turn.completed'],
      blobArtifact: null,
    });
    assert.equal(prematureDone.done, false);
    assert.equal(prematureDone.status, 'turn_completed_without_mp4_artifact');

    const verifiedDone = verifyMp4ArtifactCompletion({
      events: ['tool.started', 'tool.completed', 'turn.completed'],
      blobArtifact: { url: 'https://blob.example.com/jobs/job_123/launch.mp4', sizeBytes: 4128760 },
    });
    assert.equal(verifiedDone.done, true);
    assert.equal(verifiedDone.status, 'mp4_verified_in_blob');

    const report = buildLaunchVideoHonestyReport();
    assert.equal(report.ok, true);
    assert.equal(report.railMap.length, 4);
  });

  test('Cello (Devil-Hawk/cello) x ThumbGate integration: atomic approve-and-send diode, MCP chokepoint guard, DPO judge bridge, and F-1 MoR escrow ledger', () => {
    const {
      evaluateCelloOutreachGate,
      evaluateCelloMcpAndChokepointGate,
      compileCelloJudgeToDpoPair,
      buildCelloMoRPartnerLedgerEntry,
      buildCelloIntegrationReport,
    } = require('../scripts/cli-demo');

    const blockedUnapproved = evaluateCelloOutreachGate({ status: 'pending_review', humanApproved: false, autoSend: false });
    assert.equal(blockedUnapproved.allowed, false);
    assert.equal(blockedUnapproved.nextStatusOnFailure, 'pending_review');

    const atomicApproved = evaluateCelloOutreachGate({ status: 'pending_review', humanApproved: true, sentToday: 3, dailyCap: 10 });
    assert.equal(atomicApproved.allowed, true);
    assert.equal(atomicApproved.atomicApproveAndSend, true);

    const nanFollowUp = evaluateCelloOutreachGate({ status: 'approved', kind: 'follow_up', parentSentAt: 'invalid-date' });
    assert.equal(nanFollowUp.allowed, false);
    assert.equal(nanFollowUp.reason, 'parent_send_time_unreadable_nan_guard');

    const deniedHeadlessSend = evaluateCelloMcpAndChokepointGate({ toolName: 'send_outreach', hasHumanConfirmChannel: false });
    assert.equal(deniedHeadlessSend.allowed, false);
    assert.equal(deniedHeadlessSend.decision, 'DENY');

    const dpo = compileCelloJudgeToDpoPair({
      jobTitle: 'Staff AI Engineer',
      companyName: 'Stripe',
      rejectedDraft: 'Built Stripe billing engine in Rust for 6 years',
      chosenDraft: 'Built healthcare pricing analytics and LangGraph agent pipelines at Walker Health Services',
    });
    assert.match(dpo.preventionRule, /NEVER claim unverified candidate skills/);

    const f1Escrow = buildCelloMoRPartnerLedgerEntry({ orderId: 'ord_101', grossAmountCents: 1900, partnerShareBps: 5000, workAuthVerified: false });
    assert.equal(f1Escrow.partnerAccruedCents, 950);
    assert.equal(f1Escrow.payoutStatus, 'DEFERRED_ESCROW_UNTIL_WORK_AUTH');

    const optAuthorized = buildCelloMoRPartnerLedgerEntry({ orderId: 'ord_102', grossAmountCents: 49900, partnerShareBps: 5000, workAuthVerified: true, workAuthType: 'OPT' });
    assert.equal(optAuthorized.partnerAccruedCents, 24950);
    assert.equal(optAuthorized.payoutStatus, 'READY_FOR_AUTHORIZED_DISBURSEMENT');
    assert.equal(buildCelloIntegrationReport().ok, true);
  });

  test('AI Agent Trust Score (The New Stack / Vijil FORMAT steal): feral-to-fiduciary credit score, non-escalating autonomy limit, and 4 feral drift modes', () => {
    const {
      evaluateAgentTrustCreditLine,
      detectFeralAgentDrift,
      buildAgentTrustScoreHonestyReport,
    } = require('../scripts/cli-demo');

    const fiduciary = evaluateAgentTrustCreditLine({
      passedEvals: 20,
      totalEvals: 20,
      verifiedOutcomes: 16,
      policyViolations: 0,
      wallBounceRetries: 0,
      approvedCreditLimitUsd: 10,
      requestedActionCostUsd: 4,
    });
    assert.equal(fiduciary.allowed, true);
    assert.equal(fiduciary.behavioralState, 'FIDUCIARY');
    assert.ok(fiduciary.trustScore >= 740);

    const blockedAutoEscalation = evaluateAgentTrustCreditLine({
      passedEvals: 20,
      totalEvals: 20,
      verifiedOutcomes: 20,
      requestedScopeEscalation: true,
      principalApprovedEscalation: false,
    });
    assert.equal(blockedAutoEscalation.allowed, false);
    assert.ok(blockedAutoEscalation.blockers.includes('higher_trust_score_does_not_auto_increase_credit_limit_without_principal'));

    const feralDrift = detectFeralAgentDrift({
      environmentChangedSinceBaseline: true,
      retestedAfterEnvironmentChange: false,
      multiAgentCombinedPolicyBreach: true,
    });
    assert.equal(feralDrift.isFeral, true);
    assert.deepEqual(feralDrift.feralModes, ['environment_drift', 'multi_agent_composition_breach']);
    assert.equal(buildAgentTrustScoreHonestyReport().ok, true);
  });

  // -------------------------------------------------------------------------
  // context signal badges in output
  // -------------------------------------------------------------------------

  test('explore lessons output includes LEARNING badge', () => {
    const { exploreLessons } = require('../scripts/explore-subcommands');
    const result = exploreLessons({ feedbackDir, json: false });
    assert.match(result, /LEARNING/);
  });

  test('explore gates output includes LOCAL badge', () => {
    const { exploreGates } = require('../scripts/explore-subcommands');
    const result = exploreGates({ pkgRoot: PKG_ROOT, json: false });
    assert.match(result, /LOCAL/);
  });

  // -------------------------------------------------------------------------
  // help includes new commands
  // -------------------------------------------------------------------------

  test('help all lists status, demo, feedback self-test, and explore subcommands', () => {
    // These specialist + sub-mode commands live in the full surface now;
    // default `help` is curated to 8 common commands. (Shortened 2026-05-18.)
    const result = runCliSync(['help', 'all'], { cwd: tmpDir });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /status/);
    assert.match(result.stdout, /demo/);
    assert.match(result.stdout, /feedback-self-test/);
    assert.match(result.stdout, /explore lessons/);
    assert.match(result.stdout, /explore gates/);
    assert.match(result.stdout, /explore rules/);
  });

  // -------------------------------------------------------------------------
  // cli-schema includes new commands
  // -------------------------------------------------------------------------

  test('cli-schema includes status, demo, and feedback self-test commands', () => {
    const { findCommand } = require('../scripts/cli-schema');
    const statusCmd = findCommand('status');
    assert.ok(statusCmd, 'status command not in schema');
    assert.ok(statusCmd.flags.some(f => f.name === 'json'), 'status missing --json flag');
    const selfTestCmd = findCommand('feedback-self-test');
    assert.ok(selfTestCmd, 'feedback-self-test command not in schema');
    assert.ok(selfTestCmd.aliases.includes('dogfood'), 'feedback-self-test missing dogfood alias');
    assert.ok(selfTestCmd.flags.some(f => f.name === 'persist'), 'feedback-self-test missing --persist flag');

    const demoCmd = findCommand('demo');
    assert.ok(demoCmd, 'demo command not in schema');
    assert.ok(demoCmd.flags.some(f => f.name === 'json'), 'demo missing --json flag');
  });

  test('cli-schema explore has --json and --limit flags', () => {
    const { findCommand } = require('../scripts/cli-schema');
    const exploreCmd = findCommand('explore');
    assert.ok(exploreCmd, 'explore command not in schema');
    assert.ok(exploreCmd.flags.some(f => f.name === 'json'), 'explore missing --json flag');
    assert.ok(exploreCmd.flags.some(f => f.name === 'limit'), 'explore missing --limit flag');
  });
});
