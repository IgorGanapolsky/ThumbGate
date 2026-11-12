'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DISPOSITIONS, VENDOR_COLD_PITCH_NO_QUESTION_DISPOSITION, classifyThreads, evaluatePreSendCheck,
  extractUsdAmounts, hasEmailDomain, parseApprovalThresholdUsd, readDispositionLedgerJsonl,
  recordProviderSendConfirmation, writeLedgerSnapshot,
} = require('../scripts/thumbgate-inbox-sentinel');
const brandStandards = require('../config/brand-standards.json');

const msg = (threadId, mailbox, from, subject, body, extra = {}) => ({
  threadId, mailbox, date: '2026-11-12T14:00:00.000Z', from, to: ['igor@igorganapolsky.com'], cc: [], subject, body, ...extra,
});

test('six exhaustive dispositions and domain/threshold helpers prevent spoofing and NaN fail-open', () => {
  assert.deepEqual(DISPOSITIONS, ['REPLIED', 'DRAFTED_FOR_APPROVAL', 'NO_REPLY_NEEDED', 'WAITING_FOR_INFORMATION', 'BLOCKED', 'OPTED_OUT']);
  assert.equal(VENDOR_COLD_PITCH_NO_QUESTION_DISPOSITION, 'NO_REPLY_NEEDED');
  assert.equal(hasEmailDomain('Boardy <boardy@boardy.ai>', 'boardy.ai'), true);
  assert.equal(hasEmailDomain('boardy.ai@attacker.test', 'boardy.ai'), false);
  assert.equal(hasEmailDomain('user@notboardy.ai', 'boardy.ai'), false);
  assert.equal(parseApprovalThresholdUsd('$1,200'), 1200);
  assert.equal(parseApprovalThresholdUsd(null), 500);
  assert.equal(parseApprovalThresholdUsd('not-a-number'), 500);
  assert.deepEqual(extractUsdAmounts('Budget is USD 2,500 or 5k USD or $1.5m'), [2500, 1500000, 5000]);
  assert.equal(evaluatePreSendCheck(null).allowed, false);
});

test('ordinary reply -> REPLIED-eligible, counts as sent only on provider confirmation, and locks next cycle', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-inbox-ordinary-'));
  try {
    const messages = [
      msg('th_ordinary_1', 'INBOX', 'Dana Founder <dana@devagent.io>', 'ThumbGate MCP PreToolUse hook setup question', 'Note: does ThumbGate Pro ($19/mo or $149/yr) work with Claude Code and Cursor on macOS?'),
    ];

    const unconfirmed = classifyThreads(messages, { stateDir: tmpDir });
    const thread = unconfirmed.threads[0];
    assert.equal(thread.disposition, 'REPLIED');
    assert.equal(thread.sendEligible, true);
    assert.equal(thread.sentConfirmed, false);
    assert.equal(unconfirmed.cycleReport.sentCount, 0);
    assert.equal(unconfirmed.cycleReport.readyToSendCount, 1);
    assert.equal(unconfirmed.cycleReport.qualifiedOpportunitiesCount, 1);

    assert.equal(evaluatePreSendCheck(thread, {
      threadId: 'th_ordinary_1',
      to: ['dana@devagent.io'],
      body: 'Yes — ThumbGate runs locally across Claude Code and Cursor via PreToolUse hooks. Learn more at https://thumbgate.ai.',
    }).allowed, true);
    assert.equal(evaluatePreSendCheck(thread, { to: [], body: 'Hello' }).allowed, false);
    assert.equal(evaluatePreSendCheck(thread, { to: ['dana@devagent.io'], bcc: ['leak@ecisolutions.com'], body: 'Hello' }).allowed, false);
    assert.equal(evaluatePreSendCheck(thread, { to: ['dana@devagent.io'], body: 'We are ISO 27001 and SOC 2 Type II certified with 25% off [TODO].' }).allowed, false);

    writeLedgerSnapshot(unconfirmed, tmpDir);
    const rows = readDispositionLedgerJsonl(tmpDir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sentConfirmed, false);

    const failed = classifyThreads(messages, { stateDir: tmpDir, providerConfirmations: new Map([['th_ordinary_1', { confirmed: false, error: 'SMTP 451' }]]) });
    assert.equal(failed.cycleReport.sentCount, 0);
    assert.equal(failed.cycleReport.failuresCount, 1);

    recordProviderSendConfirmation({
      threadId: 'th_ordinary_1',
      recipient: 'dana@devagent.io',
      subject: 'Re: ThumbGate MCP PreToolUse hook setup question',
      confirmed: true,
      providerMessageId: '<sent-uid-9001@mail.gmail.com>',
      confirmedAt: '2026-11-12T14:05:00.000Z',
    }, tmpDir);

    const confirmed = classifyThreads(messages, { providerConfirmations: { th_ordinary_1: { confirmed: true, providerMessageId: '<sent-uid-9001@mail.gmail.com>' } } });
    assert.equal(confirmed.threads[0].sentConfirmed, true);
    assert.equal(confirmed.cycleReport.sentCount, 1);

    const nextCycle = classifyThreads(messages, { stateDir: tmpDir });
    assert.equal(nextCycle.threads[0].disposition, 'NO_REPLY_NEEDED');
    assert.equal(nextCycle.threads[0].status, 'REPLIED_IN_SENT');
    assert.equal(nextCycle.threads[0].oneTouchLocked, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('discount ask and all six approval-exception categories -> DRAFTED_FOR_APPROVAL', () => {
  const report = classifyThreads([
    msg('th_discount', 'INBOX', 'Sam <sam@startup.ai>', 'Team seats discount', 'Can we get a 100% off promo trial or 25% off discount for 8 engineers?'),
    msg('th_legal', 'INBOX', 'Counsel <counsel@enterprise.io>', 'Mutual NDA and MSA', 'Can you sign our mutual NDA and review the indemnification clause?'),
    msg('th_scope', 'INBOX', 'VP Eng <vp@platform.dev>', 'Custom roadmap', 'We need a bespoke integration and custom feature commitment as a scope change.'),
    msg('th_sensitive', 'INBOX', 'AP Desk <ap@customer.co>', 'Vendor W-9', 'Please send your W-9, EIN, and bank routing number for wire transfer setup.'),
    msg('th_unverified_price', 'INBOX', 'SecOps <sec@fincorp.io>', 'Pricing & SSO', 'Is your $49/mo plan SOC 2 Type II certified?'),
    msg('th_high_usd', 'INBOX', 'Procurement <procure@scaleup.ai>', 'Annual rollout', 'We have USD 2,500 budgeted for an annual team rollout — how do we proceed?'),
  ], { approvalThresholdUsd: 500 });

  assert.equal(report.cycleReport.draftsAwaitingApprovalCount, 6);
  const byId = new Map(report.threads.map((t) => [t.threadId, t]));
  assert.ok(byId.get('th_discount').approvalReasons.includes('discount_refund_or_price_change'));
  assert.ok(byId.get('th_legal').approvalReasons.includes('contract_or_legal_commitment'));
  assert.ok(byId.get('th_scope').approvalReasons.includes('scope_change'));
  assert.ok(byId.get('th_sensitive').approvalReasons.includes('sensitive_personal_or_financial_info'));
  assert.ok(byId.get('th_unverified_price').approvalReasons.includes('unverified_claims_or_pricing'));
  assert.ok(byId.get('th_high_usd').approvalReasons.includes('deal_over_usd_threshold'));
});

test('unsubscribe -> OPTED_OUT across distinct senders with identical subject and persists in ledger', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-inbox-optout-'));
  try {
    const report = classifyThreads([
      msg(null, 'INBOX', 'Pat <pat@example.org>', 'Unsubscribe', 'Please unsubscribe me and remove me from your list.'),
      msg(null, 'INBOX', 'Jordan <jordan@example.net>', 'Unsubscribe', 'unsubscribe'),
    ], { stateDir: tmpDir });
    assert.equal(report.threadCount, 2);
    assert.equal(report.cycleReport.optedOutCount, 2);
    writeLedgerSnapshot(report, tmpDir);

    const later = classifyThreads([msg(null, 'INBOX', 'Pat <pat@example.org>', '', 'Checking back', { date: '2026-11-12T15:00:00.000Z' })], { stateDir: tmpDir });
    assert.equal(later.threadCount, 1);
    assert.equal(later.threads[0].disposition, 'OPTED_OUT');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('already answered in Sent or All Mail -> NO_REPLY_NEEDED (REPLIED_IN_SENT)', () => {
  const report = classifyThreads([
    msg('1a1d0258b5d6c87f', 'INBOX', 'Michel Perez <michel@breezyassist.com>', 'AI agent governance intro', 'Hi Igor, would love to connect on agent tooling.', { date: '2026-11-12T15:10:00.000Z' }),
    msg('1a1d0258b5d6c87f', 'All Mail', 'Igor Ganapolsky <igor@igorganapolsky.com>', 'Re: AI agent governance intro', 'Hi Michel, great to connect — here is how ThumbGate gates tool calls locally.', {
      messageId: '1a1d065d021c12db',
      date: '2026-11-12T15:34:00.000Z',
      to: ['michel@breezyassist.com'],
    }),
  ]);
  assert.equal(report.threads[0].disposition, 'NO_REPLY_NEEDED');
  assert.equal(report.threads[0].status, 'REPLIED_IN_SENT');
  assert.equal(report.threads[0].oneTouchLocked, true);
  assert.equal(report.threads[0].sendEligible, false);
});

test('corporate ECI addresses, DNC list, off-brand content, and wrong-recipient drafts -> BLOCKED', () => {
  const sampleOffBrand = brandStandards.rules.find((r) => r.id.startsWith('no-') && !r.id.includes('refund')).phrases[0];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-inbox-dnc-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'do-not-contact.json'), JSON.stringify(['@blocked-domain.test']));
    const report = classifyThreads([
      msg('th_corp', 'INBOX', 'Colleague <colleague@ecisolutions.com>', 'Internal sync', 'Checking sprint status.'),
      msg('th_dnc', 'INBOX', 'Blocked <person@blocked-domain.test>', 'Hello Igor', 'Can we chat about ThumbGate?'),
      msg('th_offbrand', 'Drafts', 'Igor Ganapolsky <igor@igorganapolsky.com>', 'Re: Intro', `Check out our ${sampleOffBrand} workflow.`, { to: ['lead@partner.io'] }),
      msg('th_wrong_recipient', 'INBOX', 'Alice <alice@founder.io>', 'ThumbGate CLI question', 'How fast is gate_check?'),
      msg('th_wrong_recipient', 'Drafts', 'Igor Ganapolsky <igor@igorganapolsky.com>', 'Re: ThumbGate CLI question', 'Under 0.5ms locally.', { date: '2026-11-12T14:35:00.000Z', to: ['mallory@unrelated.io'] }),
    ], { stateDir: tmpDir });

    assert.equal(report.cycleReport.blockedCount, 4);
    const byId = new Map(report.threads.map((t) => [t.threadId, t]));
    assert.equal(byId.get('th_corp').reason, 'eci_corporate_address_isolation');
    assert.equal(byId.get('th_dnc').reason, 'do_not_contact_list');
    assert.equal(byId.get('th_offbrand').reason, 'off_brand_prohibited_content');
    assert.equal(byId.get('th_wrong_recipient').reason, 'recipient_or_thread_mismatch');
    assert.throws(() => recordProviderSendConfirmation({ threadId: 'th_corp', recipient: 'colleague@eci.com' }), { code: 'THUMBGATE_ECI_ISOLATION_BLOCK' });
    assert.throws(() => classifyThreads([msg('th_corp', 'INBOX', 'a@eci.com', 's', 'b')], { throwOnCorporateLeak: true }), { code: 'THUMBGATE_ECI_ISOLATION_BLOCK' });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('vendor cold pitch with no question -> NO_REPLY_NEEDED and missing account context -> WAITING_FOR_INFORMATION', () => {
  const report = classifyThreads([
    msg('th_vendor_pitch', 'INBOX', 'Growth SDR <sales@leadagency.io>', 'Scale your outbound pipeline', 'Hi Igor, our lead-gen agency helps devtool companies book 25 qualified demos every month.\n\nClick here to unsubscribe from future emails.'),
    msg('th_auto', 'INBOX', 'No Reply <noreply@service.io>', 'Automatic reply: Out of Office', 'I am OOO this week.'),
    msg('th_missing_key', 'INBOX', 'Dev User <user@company.dev>', 'License issue', "Hi, my license key isn't working after upgrading Node."),
    msg('th_followup', 'Sent Mail', 'Igor <igor@igorganapolsky.com>', 'Re: DNS check', 'Give it the 10 minutes and I will let you know once it resolves.', { to: ['dev@zyvop.io'] }),
  ]);

  const byId = new Map(report.threads.map((t) => [t.threadId, t]));
  assert.equal(byId.get('th_vendor_pitch').disposition, 'NO_REPLY_NEEDED');
  assert.equal(byId.get('th_vendor_pitch').reason, 'vendor_cold_pitch_no_question');
  assert.equal(byId.get('th_auto').disposition, 'NO_REPLY_NEEDED');
  assert.equal(byId.get('th_auto').reason, 'automated_no_reply_sender');
  assert.equal(byId.get('th_missing_key').disposition, 'WAITING_FOR_INFORMATION');
  assert.equal(byId.get('th_followup').disposition, 'WAITING_FOR_INFORMATION');
  assert.equal(report.cycleReport.followUpsCount, 2);
});
