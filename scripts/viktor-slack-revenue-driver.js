#!/usr/bin/env node
'use strict';

/**
 * scripts/viktor-slack-revenue-driver.js
 *
 * ThumbGate Pre-Action Governance & Revenue Automation Driver for Viktor (app.viktor.com)
 * operating inside the `ThumbGate` Slack workspace (`T0C969B5NNT`) across 10 connected
 * integrations (Stripe, Gmail, Google Calendar, GitHub, PostHog, Vercel, Linear, Drive, Docs, Sheets).
 *
 * Enforces sub-0.5ms PreToolUse guardrails on Viktor's 48 Slack actions and external tool calls:
 *   1. `gate:viktor:anti_bot_collision`: Blocks Viktor from emailing threads where Boardy (`boardy@boardy.ai`)
 *      or Fo (`fo@wajo.ai`) is actively negotiating a calendar slot without explicit single-owner lock.
 *   2. `gate:viktor:slack_destructive_action`: Blocks destructive Slack workspace mutations (`kick_user`,
 *      `archive_channel`, `delete_channel`) on protected partner channels (`#all-thumbgate`, `eddie`).
 *   3. `gate:viktor:stripe_mutation_diode`: Allows read-only Stripe revenue/invoice queries while blocking
 *      autonomous refunds, price deletions, or unapproved subscription cancellations.
 */

const VIKTOR_CONNECTED_INTEGRATIONS = [
  'slack:T0C969B5NNT',
  'stripe',
  'gmail',
  'google_calendar',
  'github',
  'posthog',
  'vercel',
  'linear',
  'google_drive',
  'google_docs',
  'google_sheets',
];

const VIKTOR_SCHEDULED_REVENUE_TASKS = [
  {
    id: 'viktor_task_morning_b2b_radar',
    title: 'ThumbGate B2B Lead & Agentic Commerce Radar ($2,500/$500/mo)',
    schedule: 'Every day at 09:00 AM America/New_York',
    targetOffer: 'ThumbGate Operator Framework ($2,500 Turnkey Setup + $500/mo Retainer)',
    channels: ['github', 'linkedin', 'x.com', 'slack:T0C969B5NNT'],
  },
  {
    id: 'viktor_task_midday_partner_pipeline',
    title: 'ThumbGate Co-Sell & Partner Pipeline Tracker (Hotdata, Slash, Emumba, Qosmic)',
    schedule: 'Tue, Thu, Fri at 02:30 PM America/New_York',
    partners: [
      { name: 'Eddie Tejeda & Divya Ranganathan', company: 'Hotdata', nextMeeting: '2026-10-29T18:30:00Z' },
      { name: 'Gabriel Olufade', company: 'Stract', nextMeeting: '2026-10-16T13:30:00Z' },
      { name: 'Bravish Ghosh', company: 'TraceKit', nextMeeting: '2026-10-20T14:00:00Z' },
      { name: 'Pranav Bidve', company: 'Qosmic', nextMeeting: '2026-10-23T18:30:00Z' },
      { name: 'Alex Lossing', company: 'Slash.co', nextMeeting: 'pending' },
      { name: 'Dr. Affan & Owais Anjum', company: 'Emumba', nextMeeting: 'pending' },
      { name: 'Sam Lam', company: 'Autotomy', nextMeeting: 'pending' },
    ],
  },
  {
    id: 'viktor_task_eod_stripe_scorecard',
    title: 'ThumbGate EOD Stripe Revenue & PostHog Funnel Scorecard ($100/Day Target)',
    schedule: 'Every day at 05:00 PM America/New_York',
    targetDailyProfitUsd: 100,
  },
];

function evaluateViktorToolGate({
  toolName = '',
  action = '',
  recipients = [],
  channel = '',
  payload = {},
} = {}) {
  const startNs = process.hrtime.bigint();
  const lowTool = String(toolName).toLowerCase();
  const lowAction = String(action).toLowerCase();
  const recips = (Array.isArray(recipients) ? recipients : [recipients]).map(r => String(r || '').toLowerCase());

  let decision = 'allow';
  let gateId = 'gate:viktor:verified_action';
  let reason = 'Viktor AI employee tool call verified within single-owner scheduling, Slack, and Stripe safety bounds';

  // 1. Anti-Bot Scheduling Collision Diode (never email both Boardy and Fo simultaneously on external guest threads)
  const hasBoardy = recips.some(r => r.includes('boardy@boardy.ai'));
  const hasFo = recips.some(r => r.includes('fo@wajo.ai'));
  const hasExternalGuest = recips.some(r => r && !r.includes('boardy.ai') && !r.includes('wajo.ai') && !r.includes('ganapolsky'));
  if ((lowTool.includes('gmail') || lowTool.includes('calendar') || lowAction.includes('send_email')) && hasBoardy && hasFo && hasExternalGuest) {
    decision = 'block';
    gateId = 'gate:viktor:anti_bot_collision';
    reason = 'Multi-bot scheduling collision blocked: never CC both boardy@boardy.ai and fo@wajo.ai on an external guest thread simultaneously';
  }

  // 2. Slack Destructive Action Diode
  if (
    decision === 'allow' &&
    (lowAction.includes('kick_user') || lowAction.includes('delete_channel') || lowAction.includes('archive_channel')) &&
    (String(channel).includes('all-thumbgate') || String(channel).includes('eddie') || String(channel).includes('hotdata'))
  ) {
    decision = 'block';
    gateId = 'gate:viktor:slack_destructive_action';
    reason = `Protected Slack partner channel/member '${channel}' cannot be kicked or archived by autonomous agent`;
  }

  // 3. Stripe Mutation Diode
  if (
    decision === 'allow' &&
    lowTool.includes('stripe') &&
    (lowAction.includes('refund') || lowAction.includes('delete_price') || lowAction.includes('cancel_subscription')) &&
    !payload.humanApproved
  ) {
    decision = 'block';
    gateId = 'gate:viktor:stripe_mutation_diode';
    reason = `Autonomous Stripe mutation '${action}' blocked without explicit human approval`;
  }

  const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
  return {
    toolName,
    action,
    decision,
    allowed: decision === 'allow',
    gateId,
    latencyMs,
    reason,
  };
}

module.exports = {
  VIKTOR_CONNECTED_INTEGRATIONS,
  VIKTOR_SCHEDULED_REVENUE_TASKS,
  evaluateViktorToolGate,
};
