'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  isoWeekKey,
  evaluateUserWeekJobBench,
  evaluateMoneySpeech,
} = require('../scripts/user-week-job-bench');

const ROOT = path.join(__dirname, '..');
const WEEK = '2026-10-27T15:00:00.000Z';

function writeTranscript(message) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-user-week-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', message })}\n`);
  return file;
}

function runHook(transcript, env = {}) {
  const result = spawnSync(process.execPath, ['scripts/hook-stop-anti-claim.js'], {
    cwd: ROOT,
    input: JSON.stringify({ transcript_path: transcript, stop_hook_active: false }),
    encoding: 'utf8',
    env: { ...process.env, ...env, CLAUDE_RESPONSE: '' },
  });
  fs.rmSync(transcript, { force: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout || '';
}

test('one ISO week covers Sunday and the Monday before it', () => {
  assert.equal(isoWeekKey('2026-11-01T23:00:00.000Z'), isoWeekKey('2026-10-26T00:00:00.000Z'));
  assert.notEqual(isoWeekKey('2026-11-01T23:00:00.000Z'), isoWeekKey('2026-11-02T00:00:00.000Z'));
});

test('twenty complaints from one person in one week count as one person', () => {
  const records = [];
  for (let i = 0; i < 20; i += 1) {
    records.push({
      actorId: 'ada',
      at: WEEK,
      job: 'getting_tasks_done',
      complaint: true,
      text: `again ${i}`,
    });
  }
  records.push({
    actorId: 'bea',
    at: WEEK,
    job: 'getting_tasks_done',
    praise: true,
    text: 'one note',
  });
  const result = evaluateUserWeekJobBench(records);
  const job = result.jobs.getting_tasks_done;
  assert.equal(job.people, 2);
  assert.equal(job.complaintPeople, 1);
  assert.equal(job.praisePeople, 1);
  assert.equal(job.actorWeeks.length, 2);
});

test('three praises from one person shrink toward the category norm', () => {
  const records = [1, 2, 3].map((hour) => ({
    actorId: 'ada',
    at: `2026-10-27T0${hour}:00:00.000Z`,
    job: 'getting_tasks_done',
    praise: true,
  }));
  const result = evaluateUserWeekJobBench(records);
  const job = result.jobs.getting_tasks_done;
  assert.equal(job.people, 1);
  assert.equal(job.praisePeople, 1);
  assert.equal(job.rawLove, 1);
  assert.ok(job.love < 0.7);
  assert.ok(job.love > 0.5);
  assert.equal(result.verdict, 'allow');
});

test('a done claim without a receipt holds', () => {
  const result = evaluateUserWeekJobBench([
    { actorId: 'ada', at: WEEK, claimedDone: true, text: 'shipped' },
  ]);
  assert.equal(result.verdict, 'hold');
  assert.equal(result.jobs.said_done_without_receipt.people, 1);
  assert.equal(result.jobs.said_done_without_receipt.complaintPeople, 1);
  assert.equal(result.issues[0].reason, 'A done claim has no receipt.');
  assert.equal(result.jobs.said_done_without_receipt.receipts.length, 0);
});

test('a done claim with a receipt is counted and allowed', () => {
  const result = evaluateUserWeekJobBench([
    {
      actorId: 'ada',
      at: WEEK,
      claimedDone: true,
      receiptId: 'rcpt-1',
      job: 'getting_tasks_done',
      praise: true,
    },
  ]);
  assert.equal(result.verdict, 'allow');
  assert.equal(result.jobs.getting_tasks_done.receipts[0], 'rcpt-1');
  assert.equal(result.jobs.said_done_without_receipt.people, 0);
});

test('a record with no actor is dropped', () => {
  const result = evaluateUserWeekJobBench([
    { at: WEEK, praise: true, text: 'anonymous' },
  ]);
  assert.equal(result.jobs.getting_tasks_done.people, 0);
  assert.equal(result.jobs.getting_tasks_done.love, 0.5);
});

test('pay-choice words stated as booked money hold', () => {
  const speech = evaluateMoneySpeech('stripe confirms mean we booked revenue');
  assert.equal(speech.verdict, 'hold');
  assert.equal(speech.job, 'pay_choice_counted_as_paid');
});

test('an honest hosted zero is allowed', () => {
  const speech = evaluateMoneySpeech('paidOrders 0, bookedRevenue $0.00, Source: hosted-http-api');
  assert.equal(speech.verdict, 'allow');
  assert.equal(speech.honestZero, true);
});

test('a positive booked dollar without a hosted source holds', () => {
  const speech = evaluateMoneySpeech('we booked $19.00 today');
  assert.equal(speech.verdict, 'hold');
});

test('the annual price label is not a booked dollar', () => {
  const speech = evaluateMoneySpeech('Pro is $19/mo or $149/yr, and the diagnostic is $499.');
  assert.equal(speech.verdict, 'allow');
});

test('a stripe retrieve command is not a pay-choice claim', () => {
  const speech = evaluateMoneySpeech('stripe checkout sessions retrieve cs_test_123');
  assert.equal(speech.verdict, 'allow');
});

test('the bench does not emit another product score', () => {
  const result = evaluateUserWeekJobBench([
    { actorId: 'ada', at: WEEK, praise: true, job: 'setup' },
  ]);
  const encoded = JSON.stringify(result);
  assert.equal(encoded.includes('73.0'), false);
  assert.equal(encoded.includes('62.6'), false);
  assert.equal(encoded.includes('Feedback Score'), false);
  const source = fs.readFileSync(path.join(ROOT, 'scripts/user-week-job-bench.js'), 'utf8');
  assert.doesNotMatch(source, /50\s*\+\s*10/);
});

test('the stop hook reminds when pay clicks are called revenue', () => {
  const transcript = writeTranscript({
    content: [{ type: 'text', text: 'stripe confirms mean we booked revenue' }],
  });
  const stdout = runHook(transcript);
  assert.match(stdout, /user-week bench/i);
  assert.match(stdout, /Pay click/i);
});

test('the stop hook stays silent for an honest hosted zero', () => {
  const transcript = writeTranscript({
    content: [{
      type: 'text',
      text: 'paidOrders 0, bookedRevenue $0.00, Source: hosted-http-api',
    }],
  });
  const stdout = runHook(transcript);
  assert.equal(stdout.trim(), '');
});

test('strict mode blocks an unreceipted booked dollar as JSON', () => {
  const transcript = writeTranscript({
    content: [{ type: 'text', text: 'we booked $19.00 today' }],
  });
  const stdout = runHook(transcript, { THUMBGATE_STRICT_ENFORCEMENT: '1' });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.decision, 'block');
  assert.match(parsed.reason, /hosted source/i);
});
