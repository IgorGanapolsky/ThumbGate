'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildAgenticDataPipelineSchedule,
  buildManagedScheduleCommand,
  createSchedule,
  escapePlistString,
  evaluateAlwaysOnSchedule,
  generatePlist,
  parseCronSpec,
  resolveScheduleClaimLive,
} = require('../scripts/schedule-manager');
const {
  decideEscalation,
  requestEscalation,
} = require('../scripts/human-escalation');

function createSignedSendSpendApproval(taskId = `send-${Date.now()}`) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-esc-'));
  const key = 'test-human-reviewer-key';
  const options = { feedbackDir: dir, approvalSigningKey: key, approvalVerificationKey: key };
  const requested = requestEscalation({
    taskId,
    reason: 'send vendor payment',
    requester: { id: 'agent-1', kind: 'agent' },
    evidence: ['invoice-42'],
    idempotencyKey: taskId,
  }, options);
  decideEscalation({
    escalationId: requested.escalation.escalationId,
    decision: 'approved',
    reason: 'human approved send',
  }, { ...options, authenticatedActor: { id: 'igor', kind: 'human' } });
  return {
    escalationId: requested.escalation.escalationId,
    options,
    dir,
  };
}

test('escapePlistString encodes XML metacharacters while preserving backslashes', () => {
  const input = String.raw`console.log("C:\temp\<tag>&'")`;
  const escaped = escapePlistString(input);

  assert.equal(
    escaped,
    String.raw`console.log(&quot;C:\temp\&lt;tag&gt;&amp;&#39;&quot;)`
  );
  assert.match(escaped, /C:\\temp\\/);
});

test('generatePlist escapes dynamic command, working directory, and schedule identifiers', () => {
  const plist = generatePlist({
    id: `nightly<&'"run">`,
    command: String.raw`console.log("C:\temp\<tag>&'")`,
    workingDirectory: `/tmp/thumbgate<&'"run">`,
    calendarInterval: { Hour: 9, Minute: 30 },
  });

  assert.match(plist, /<string>com\.thumbgate\.schedule\.nightly&lt;&amp;&#39;&quot;run&quot;&gt;<\/string>/);
  assert.match(plist, /<string>console\.log\(&quot;C:\\temp\\&lt;tag&gt;&amp;&#39;&quot;\)<\/string>/);
  assert.match(plist, /<string>\/tmp\/thumbgate&lt;&amp;&#39;&quot;run&quot;&gt;<\/string>/);
  assert.match(plist, /schedule-nightly&lt;&amp;&#39;&quot;run&quot;&gt;\.log/);
  assert.doesNotMatch(plist, /<string>[^<]*<tag>/);
});

test('parseCronSpec parses supported schedule formats', () => {
  assert.deepEqual(parseCronSpec('daily 9:30'), { Hour: 9, Minute: 30 });
  assert.deepEqual(parseCronSpec('weekly monday 8:15'), { Weekday: 1, Hour: 8, Minute: 15 });
  assert.deepEqual(parseCronSpec('hourly'), { Minute: 0 });
  assert.equal(parseCronSpec('nonsense'), null);
});

test('buildManagedScheduleCommand runs the async job runner against a job file with auto-resume enabled', () => {
  const command = buildManagedScheduleCommand({
    jobFile: '/tmp/thumbgate/jobs/gtm-followup.json',
    autoResume: true,
  });

  assert.match(command, /async-job-runner\.js/);
  assert.match(command, /runJobFromFile/);
  assert.match(command, /gtm-followup\.json/);
  assert.match(command, /"autoResume":true/);
  assert.match(command, /process\.exit\(1\)/);
});

test('buildAgenticDataPipelineSchedule emits a managed job file contract for automated materialization', () => {
  const schedule = buildAgenticDataPipelineSchedule({
    id: 'nightly-data-pipeline',
    feedbackDir: '/tmp/thumbgate-feedback',
    outDir: '/tmp/thumbgate-pipeline',
    window: '30d',
    recordWorkflowRun: false,
  });

  assert.match(schedule.jobFile, /nightly-data-pipeline\.job\.json$/);
  assert.equal(schedule.jobSpec.id, 'nightly-data-pipeline');
  assert.equal(schedule.jobSpec.stages[0].name, 'materialize_pipeline');
  assert.match(schedule.jobSpec.stages[0].command, /agentic-data-pipeline\.js/);
  assert.match(schedule.command, /async-job-runner\.js/);
});

test('evaluateAlwaysOnSchedule fails closed for laptop-bound 24/7 work and refuses live claim', () => {
  const denied = evaluateAlwaysOnSchedule({
    runtime: 'laptop',
    schedule: 'hourly',
    alwaysOn: true,
    claimLive: true,
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.failClosed, true);
  assert.equal(denied.claimLive, false);
  assert.equal(denied.reason, 'laptop_bound_schedule');

  const launchd = evaluateAlwaysOnSchedule({
    runtime: 'launchd',
    schedule: 'every 6h',
    claimLive: true,
  });
  assert.equal(launchd.allowed, false);
  assert.equal(launchd.claimLive, false);
  assert.equal(launchd.reason, 'laptop_bound_schedule');

  const hourlyNoClaim = evaluateAlwaysOnSchedule({
    runtime: 'laptop',
    schedule: 'hourly',
  });
  assert.equal(hourlyNoClaim.allowed, true);
  assert.equal(hourlyNoClaim.claimLive, false);
});

test('evaluateAlwaysOnSchedule binds 24/7 work to an always-on VPS', () => {
  const allowed = evaluateAlwaysOnSchedule({
    runtime: 'vps',
    schedule: 'hourly',
    alwaysOn: true,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.claimLive, true);
  assert.equal(allowed.boundTo, 'always-on-vps');
});

test('evaluateAlwaysOnSchedule requires a consumed human approval for send/spend and rejects auto-book', () => {
  const spend = evaluateAlwaysOnSchedule({
    runtime: 'vps',
    schedule: 'daily 9:00',
    action: 'send invoice to vendor',
  });
  assert.equal(spend.allowed, false);
  assert.equal(spend.reason, 'human_gate_required');
  assert.equal(spend.claimLive, false);

  const forged = evaluateAlwaysOnSchedule({
    runtime: 'vps',
    schedule: 'daily 9:00',
    action: 'send invoice to vendor',
    humanApproval: { consumed: true, actor: { kind: 'human', id: 'igor' } },
  });
  assert.equal(forged.allowed, false);
  assert.equal(forged.reason, 'human_gate_required');

  const gate = createSignedSendSpendApproval();
  const approved = evaluateAlwaysOnSchedule({
    runtime: 'vps',
    schedule: 'daily 9:00',
    action: 'send invoice to vendor',
    humanApproval: {
      escalationId: gate.escalationId,
      consumer: { id: 'schedule-manager', kind: 'system' },
    },
  }, gate.options);
  assert.equal(approved.allowed, true);
  fs.rmSync(gate.dir, { recursive: true, force: true });

  const autoBook = evaluateAlwaysOnSchedule({
    runtime: 'vps',
    autoBook: true,
    action: 'auto-book clinic slot',
  });
  assert.equal(autoBook.allowed, false);
  assert.equal(autoBook.reason, 'auto_book_forbidden');
  assert.equal(autoBook.claimLive, false);
});

test('resolveScheduleClaimLive stays false until a scheduler is installed', () => {
  const vps = evaluateAlwaysOnSchedule({
    runtime: 'vps',
    schedule: 'hourly',
    alwaysOn: true,
  });
  assert.equal(vps.claimLive, true);
  const linux = resolveScheduleClaimLive(vps, 'linux');
  assert.equal(linux.claimLive, false);
  assert.equal(linux.schedulerInstallation, 'pending-crontab');
  const darwin = resolveScheduleClaimLive(vps, 'darwin');
  assert.equal(darwin.claimLive, false);
  assert.equal(darwin.schedulerInstallation, 'launchd');
});

test('createSchedule fails closed when laptop work claims live', () => {
  const result = createSchedule({
    id: 'should-not-persist-hourly-laptop',
    schedule: 'hourly',
    command: 'console.log("no")',
    runtime: 'laptop',
    claimLive: true,
  });
  assert.equal(result.success, false);
  assert.equal(result.gate.reason, 'laptop_bound_schedule');
  assert.equal(result.gate.claimLive, false);
});
