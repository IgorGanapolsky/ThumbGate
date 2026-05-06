#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { sendEmail } = require('./mailer');

const DEFAULT_FROM = 'ThumbGate <onboarding@resend.dev>';
const DEFAULT_REPLY_TO = 'igor.ganapolsky@gmail.com';
const BUSINESS_FOOTER = [
  '',
  '--',
  'Max Smith KDP LLC',
  '2261 Market Street #4242, San Francisco, CA 94114',
  'Unsubscribe: mailto:igor.ganapolsky@gmail.com?subject=unsubscribe',
].join('\n');

const CAMPAIGNS = {
  aiventyx_marketplace_followup: {
    to: 'qaisermehdi3@gmail.com',
    subject: 'ThumbGate Aiventyx listings: ready to submit today',
    text: [
      'Qaiser, quick follow-up on ThumbGate Free, Pro, and Teams for Aiventyx.',
      '',
      'The paid paths are live now. Please remove any stale proxy Free listing if it is still present, then use these final tracked CTAs for the listings:',
      '',
      'Free / guide: https://thumbgate.ai/guide?utm_source=aiventyx&utm_medium=marketplace&utm_campaign=aiventyx_free_listing',
      '$19 quick read: https://buy.stripe.com/aFa8wPgH29Lo4lH35V3sI0w',
      '$99 teardown: https://buy.stripe.com/7sYfZhgH29LodWhdKz3sI0v',
      '$499 diagnostic: https://buy.stripe.com/00w14neyUcXA5pL5e33sI0e',
      '',
      "If click tracking on Aiventyx is not live yet, ThumbGate UTMs are the source of truth until your side is ready. Send me the live listing URLs once they are up and I will route today's traffic there.",
    ].join('\n'),
    pipelineLeadId: 'aiventyx_qaiser_marketplace_listings',
  },
  contractor_bid_radar_nj_founder_pilot: {
    to: [
      'ignazio@201electric.com',
      'geronimo@geronimoelectric.com',
      'office@oceancoastelectric.com',
      'info@flashelectriccontractors.com',
      'nick@tafsolar.com',
      'info@landair.net',
      'higherpowerec@outlook.com',
      'info@clearsolar.us',
    ],
    subject: 'NJ bid/permit radar for electrical and solar contractors',
    text: [
      'Hi,',
      '',
      'I found a few New Jersey public-source signals today that look relevant to electrical and solar contractors:',
      '',
      '- East Orange school solar PPA',
      '- Edison PSE&G electrical substation zoning item',
      '- Wall Township zoning/planning agendas',
      '- NJDCA construction permit and big-permit feeds',
      '',
      'I am testing Contractor Bid Radar: one short daily email with public RFPs, permits, zoning/planning items, source links, confidence labels, and the recommended next action.',
      '',
      'Founder pilot is $199/month for one trade and one metro. One useful bid or early project signal should more than cover it.',
      '',
      'Checkout: https://buy.stripe.com/3cI3cvcqMg9M5pL35V3sI1c',
      '',
      'If this is not relevant, reply "no" and I will not follow up.',
      '',
      'Igor',
    ].join('\n'),
    pipelineLeadId: 'contractor_bid_radar_nj_founder_pilot',
  },
};

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    campaign: '',
    dryRun: false,
    confirmSend: false,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    if (arg === '--confirm-send') options.confirmSend = true;
    if (arg.startsWith('--campaign=')) options.campaign = arg.slice('--campaign='.length).trim();
  }
  return options;
}

function renderMessage(campaign) {
  return {
    ...campaign,
    text: `${campaign.text}${BUSINESS_FOOTER}`,
  };
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const campaign = CAMPAIGNS[options.campaign];
  if (!campaign) {
    throw new Error(`Unknown campaign. Expected one of: ${Object.keys(CAMPAIGNS).join(', ')}`);
  }
  const message = renderMessage(campaign);
  if (options.dryRun || !options.confirmSend) {
    console.log(JSON.stringify({
      dryRun: true,
      blocked: !options.confirmSend && !options.dryRun,
      reason: !options.confirmSend && !options.dryRun ? 'missing_confirm_send' : null,
      message,
    }, null, 2));
    return { sent: false, dryRun: true, message };
  }

  const send = deps.sendEmail || sendEmail;
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  const results = [];
  for (const recipient of recipients) {
    const result = await send({
      to: recipient,
      subject: message.subject,
      text: message.text,
      from: process.env.RESEND_FROM_EMAIL || DEFAULT_FROM,
      replyTo: process.env.THUMBGATE_TRIAL_EMAIL_REPLY_TO || DEFAULT_REPLY_TO,
    });
    results.push({
      to: recipient,
      sent: Boolean(result.sent),
      providerId: result?.id || result?.providerId || null,
      reason: result?.reason || null,
    });
  }
  console.log(JSON.stringify({
    campaign: options.campaign,
    leadId: message.pipelineLeadId,
    sent: results.every((result) => result.sent),
    sentCount: results.filter((result) => result.sent).length,
    results,
  }, null, 2));
  return { sent: results.every((result) => result.sent), results };
}

function isCliEntrypoint(entry = process.argv[1]) {
  return typeof entry === 'string' && path.resolve(entry) === __filename;
}

if (isCliEntrypoint()) {
  main().catch((err) => {
    console.error(err?.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  CAMPAIGNS,
  parseArgs,
  renderMessage,
  main,
  isCliEntrypoint,
};
