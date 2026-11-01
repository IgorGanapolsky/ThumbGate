#!/usr/bin/env node
'use strict';

/**
 * People-counted job bench.
 *
 * Method source (format only, not a scoreboard to copy):
 * https://www.enterpret.com/guides/the-12-best-personal-ai-agents-in-2026-ranked-by-real-user-sentiment
 *
 * One person counts once per ISO week per job. A thin sample shrinks toward
 * 0.5. A done claim without a receipt is a complaint. A Pay click is not a
 * paid order. This file does not publish another product's scores.
 */

const path = require('node:path');

const JOBS = [
  'said_done_without_receipt',
  'pay_choice_counted_as_paid',
  'setup',
  'always_on',
  'model_choice',
  'control',
  'price',
  'getting_tasks_done',
];

const NORM = 0.5;
const DEFAULT_PRIOR_STRENGTH = 8;

const JOB_RULES = [
  ['pay_choice_counted_as_paid', /\bstripe\s+confirms\b|\bpay\s+clicks\b|\bcheckout\s+intent\s+clicks\b|\bcheckoutInterstitialProConfirms\b/i],
  ['said_done_without_receipt', /\bclaimed done\b|\bfalse completion\b|\bwithout a receipt\b|\bsaid it was done\b/i],
  ['setup', /\bsetup\b|\binstall\b|\bonboarding\b/i],
  ['always_on', /\balways[- ]on\b|\bunattended\b|\brunning on its own\b/i],
  ['model_choice', /\bmodel choice\b|\bwhich model\b/i],
  ['control', /\bapproval\b|\bstaying in control\b|\bpermissions?\b/i],
  ['price', /\bpricing\b|\btoo expensive\b|\bprice\b/i],
  ['getting_tasks_done', /\btask\b|\bfinished\b|\bgot it done\b/i],
];

const PAY_CHOICE_RE = /\bstripe\s+confirms\b|\bpay\s+clicks\b|\bcheckout\s+intent\s+clicks\b|\bcheckoutInterstitialProConfirms\b/i;
const PAID_CLAIM_RE = /\b(?:booked(?:\s+revenue)?|made\s+money|paid\s+orders?|revenue\s+booked)\b/i;
const HOSTED_SOURCE_RE = /hosted-http-api|\bSource:\s*hosted\b/i;
const HONEST_ZERO_ORDERS_RE = /\bpaidOrders?\s*[:=]?\s*0\b/i;
const ZERO_DOLLARS_RE = /\$0\.00\b/;
const PRICE_LABEL_RE = /\$\d+(?:\.\d{2})?\s*\/\s*(?:mo|yr|year|month)\b/gi;
const BOOKED_THEN_DOLLAR_RE = /\b(?:booked(?:Revenue)?|paid)\b[^$\n]{0,48}\$(\d+(?:\.\d{2})?)/gi;
const DOLLAR_THEN_BOOKED_RE = /\$(\d+(?:\.\d{2})?)\s*(?:booked|in\s+booked\s+revenue|revenue\s+booked)/gi;

function isoWeekKey(input) {
  const parsed = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  const date = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function knownJob(value) {
  return JOBS.includes(value) ? value : null;
}

function classifyJob(record) {
  if (record && record.claimedDone === true && !record.receiptId) {
    return 'said_done_without_receipt';
  }
  const explicit = knownJob(record && record.job);
  if (explicit) return explicit;
  const text = String((record && record.text) || '');
  for (const [job, pattern] of JOB_RULES) {
    if (pattern.test(text)) return job;
  }
  return 'getting_tasks_done';
}

function isComplaint(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.claimedDone === true && !record.receiptId) return true;
  if (record.complaint === true) return true;
  const sentiment = String(record.sentiment || record.feedback || '').toLowerCase();
  return sentiment === 'complaint' || sentiment === 'down' || sentiment === 'negative';
}

function isPraise(record) {
  if (!record || typeof record !== 'object' || isComplaint(record)) return false;
  if (record.praise === true) return true;
  const sentiment = String(record.sentiment || record.feedback || '').toLowerCase();
  return sentiment === 'praise' || sentiment === 'up' || sentiment === 'positive';
}

function emptyJob() {
  return {
    people: 0,
    praisePeople: 0,
    complaintPeople: 0,
    rawLove: NORM,
    love: NORM,
    actorWeeks: [],
    receipts: [],
  };
}

function shrinkLove(people, praisePeople, priorStrength) {
  const rawLove = people === 0 ? NORM : praisePeople / people;
  const thin = people < priorStrength;
  const love = thin
    ? (praisePeople + (priorStrength * NORM)) / (people + priorStrength)
    : rawLove;
  return { rawLove, love };
}

function actorIdOf(record) {
  if (!record || record.actorId == null) return '';
  const actorId = String(record.actorId).trim();
  return actorId;
}

function positiveBookedDollar(text) {
  const stripped = String(text || '').replace(PRICE_LABEL_RE, ' ');
  const patterns = [BOOKED_THEN_DOLLAR_RE, DOLLAR_THEN_BOOKED_RE];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(stripped);
    while (match) {
      const amount = Number(match[1]);
      if (Number.isFinite(amount) && amount > 0) return match[0];
      match = pattern.exec(stripped);
    }
  }
  return null;
}

function evaluateMoneySpeech(text) {
  const raw = String(text || '');
  const hostedSource = HOSTED_SOURCE_RE.test(raw);
  const honestZero = HONEST_ZERO_ORDERS_RE.test(raw) && ZERO_DOLLARS_RE.test(raw) && hostedSource;
  const issues = [];
  if (PAY_CHOICE_RE.test(raw) && PAID_CLAIM_RE.test(raw) && !honestZero) {
    issues.push({
      job: 'pay_choice_counted_as_paid',
      reason: 'A Pay click, Stripe confirm count, or checkout-intent click was stated as booked money without paid orders at 0, $0.00, and a hosted source line.',
    });
  }
  if (positiveBookedDollar(raw) && !hostedSource) {
    issues.push({
      job: 'pay_choice_counted_as_paid',
      reason: 'A positive booked dollar has no hosted source line.',
    });
  }
  return {
    verdict: issues.length > 0 ? 'hold' : 'allow',
    job: issues.length > 0 ? issues[0].job : null,
    issues,
    honestZero,
  };
}

function evaluateUserWeekJobBench(records, options = {}) {
  const priorStrength = Number.isFinite(options.priorStrength)
    ? options.priorStrength
    : DEFAULT_PRIOR_STRENGTH;
  const jobs = {};
  for (const job of JOBS) jobs[job] = emptyJob();
  const groups = new Map();
  const list = Array.isArray(records) ? records : [];

  for (const record of list) {
    const actorId = actorIdOf(record);
    const week = isoWeekKey(record && record.at);
    if (!actorId || !week) continue;
    const job = classifyJob(record);
    const key = `${actorId}|${week}|${job}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        actorId,
        week,
        job,
        complaint: false,
        praise: false,
        receipts: [],
      };
      groups.set(key, group);
    }
    if (isComplaint(record)) group.complaint = true;
    else if (isPraise(record)) group.praise = true;
    if (record.receiptId) group.receipts.push(String(record.receiptId));
  }

  const issues = [];
  for (const group of groups.values()) {
    const bucket = jobs[group.job];
    const actorWeek = `${group.actorId}|${group.week}`;
    bucket.people += 1;
    bucket.actorWeeks.push(actorWeek);
    if (group.complaint) bucket.complaintPeople += 1;
    else if (group.praise) bucket.praisePeople += 1;
    for (const receiptId of group.receipts) {
      if (!bucket.receipts.includes(receiptId)) bucket.receipts.push(receiptId);
    }
    if (group.job === 'said_done_without_receipt' && group.complaint) {
      issues.push({
        job: group.job,
        actorWeek,
        reason: 'A done claim has no receipt.',
      });
    }
  }

  for (const job of JOBS) {
    const bucket = jobs[job];
    const scored = shrinkLove(bucket.people, bucket.praisePeople, priorStrength);
    bucket.rawLove = scored.rawLove;
    bucket.love = scored.love;
  }

  const countedActorWeeks = [];
  for (const job of JOBS) {
    for (const actorWeek of jobs[job].actorWeeks) {
      if (!countedActorWeeks.includes(`${actorWeek}|${job}`)) {
        countedActorWeeks.push(`${actorWeek}|${job}`);
      }
    }
  }

  return {
    verdict: issues.length > 0 ? 'hold' : 'allow',
    priorStrength,
    norm: NORM,
    jobs,
    issues,
    countedActorWeeks,
  };
}

function readStdinSync() {
  const fs = require('node:fs');
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const raw = readStdinSync();
  if (!raw.trim()) {
    process.stdout.write(`${JSON.stringify(evaluateUserWeekJobBench([]))}\n`);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ verdict: 'hold', issues: [{ reason: error.message }] })}\n`);
    process.exitCode = 1;
    return;
  }
  if (parsed && typeof parsed.text === 'string' && !Array.isArray(parsed) && !parsed.records) {
    process.stdout.write(`${JSON.stringify(evaluateMoneySpeech(parsed.text))}\n`);
    return;
  }
  const records = Array.isArray(parsed) ? parsed : parsed.records;
  const options = parsed && parsed.options ? parsed.options : {};
  process.stdout.write(`${JSON.stringify(evaluateUserWeekJobBench(records, options))}\n`);
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = {
  JOBS,
  NORM,
  DEFAULT_PRIOR_STRENGTH,
  isoWeekKey,
  classifyJob,
  evaluateMoneySpeech,
  evaluateUserWeekJobBench,
};
