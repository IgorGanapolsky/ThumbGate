#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { sendEmail } = require('./mailer');
const {
  buildDiagnosticBuyerUrl,
  buildSprintBuyerUrl,
} = require('./buyer-paths');

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
    status: 'hold_unverified_cost',
    blockedReason: 'Aiventyx seller fees and downstream obligations are not verified.',
    to: 'qaisermehdi3@gmail.com',
    subject: 'ThumbGate Aiventyx listings: payment routing remains paused',
    text: [
      'Qaiser, ThumbGate payment routing remains paused while seller fees and downstream obligations are unverified.',
      '',
      'For reference only, the current first-party buyer paths are:',
      '',
      'Free / guide: https://thumbgate.ai/guide?utm_source=aiventyx&utm_medium=marketplace&utm_campaign=aiventyx_free_listing',
      `$499 diagnostic: ${buildDiagnosticBuyerUrl({ source: 'aiventyx', medium: 'marketplace' })}`,
      `$1,500 sprint scope: ${buildSprintBuyerUrl({ source: 'aiventyx', medium: 'marketplace' })}`,
      '',
      'Do not publish or route payment traffic until the zero-cost terms are confirmed in writing.',
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
  const campaignAllowed = campaign.status === 'proceed_zero_cost';
  if (!campaignAllowed && options.confirmSend) {
    throw new Error(`Revenue email blocked: ${campaign.status} — ${campaign.blockedReason}`);
  }
  if (options.dryRun || !options.confirmSend) {
    console.log(JSON.stringify({
      dryRun: true,
      blocked: !campaignAllowed || (!options.confirmSend && !options.dryRun),
      reason: !campaignAllowed
        ? campaign.status
        : (!options.confirmSend && !options.dryRun ? 'missing_confirm_send' : null),
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
  const summary = {
    campaign: options.campaign,
    leadId: message.pipelineLeadId,
    sent: Boolean(result.sent),
    providerId: result?.id || result?.providerId || null,
    reason: result?.reason || null,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!result.sent) {
    const reason = result?.reason ? `: ${result.reason}` : '';
    throw new Error(`Revenue email was not sent${reason}`);
  }
  return result;
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
