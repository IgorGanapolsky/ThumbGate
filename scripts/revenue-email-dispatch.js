#!/usr/bin/env node
'use strict';

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
  const result = await send({
    to: message.to,
    subject: message.subject,
    text: message.text,
    from: process.env.RESEND_FROM_EMAIL || DEFAULT_FROM,
    replyTo: process.env.THUMBGATE_TRIAL_EMAIL_REPLY_TO || DEFAULT_REPLY_TO,
  });
  console.log(JSON.stringify({
    campaign: options.campaign,
    leadId: message.pipelineLeadId,
    sent: result.sent === true,
    providerId: result.id || result.providerId || null,
    reason: result.reason || null,
  }, null, 2));
  return result;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  CAMPAIGNS,
  parseArgs,
  renderMessage,
  main,
};
