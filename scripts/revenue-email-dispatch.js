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

function qsrN8nCampaign({ to, company, leadId }) {
  return {
    to,
    subject: 'n8n workflow templates for QSR ops',
    text: [
      `Hi ${company},`,
      '',
      'I built a private n8n workflow vault for QSR teams and restaurant-tech consultants.',
      '',
      'The starter package covers five practical workflows:',
      '',
      '- order intake cleanup',
      '- inventory reorder alerts',
      '- loyalty winback segments',
      '- review triage',
      '- daily store ops digests',
      '',
      'It is designed for self-hosting, so operators keep POS/customer/store data inside their own n8n instance. This may fit your team as a lightweight automation add-on for QSR clients who already ask for POS, SMS, email, reporting, or inventory help.',
      '',
      'Sales page: https://igorganapolsky.github.io/qsr-n8n-workflow-vault-site/',
      '',
      'There is a $99 starter vault and a $499 setup diagnostic for teams that want their POS/SMS/email/inventory stack mapped before implementation.',
      '',
      'Worth sending you the starter package outline?',
      '',
      'Igor',
      '',
      'If this is not relevant, reply no and I will not follow up.',
    ].join('\n'),
    pipelineLeadId: leadId,
  };
}

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
  qsr_n8n_northwestern_pos: qsrN8nCampaign({
    to: 'info@nwcrpos.com',
    company: 'Northwestern POS',
    leadId: 'qsr_n8n_northwestern_pos',
  }),
  qsr_n8n_postron: qsrN8nCampaign({
    to: 'hello@postron.com',
    company: 'POSTRON',
    leadId: 'qsr_n8n_postron',
  }),
  qsr_n8n_southwest_food_solutions: qsrN8nCampaign({
    to: 'rick@southwestfoodsolutions.com',
    company: 'Southwest Food Solutions',
    leadId: 'qsr_n8n_southwest_food_solutions',
  }),
  qsr_n8n_qsr_solutions: qsrN8nCampaign({
    to: 'admin@qsrsolutions.com',
    company: 'QSR Solutions',
    leadId: 'qsr_n8n_qsr_solutions',
  }),
  qsr_n8n_anbe_tech_solutions: qsrN8nCampaign({
    to: 'sales@anbetechsolutions.com',
    company: 'Anbe Tech Solutions',
    leadId: 'qsr_n8n_anbe_tech_solutions',
  }),
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
    sent: Boolean(result.sent),
    providerId: result?.id || result?.providerId || null,
    reason: result?.reason || null,
  }, null, 2));
  if (!result.sent) {
    throw new Error(`Revenue email was not sent: ${result?.reason || 'unknown_error'}`);
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
