const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  addSalesLead,
  advanceSalesLead,
  auditSalesPipeline,
  evaluateLeadStageEvidence,
  findLinkedGitCommonRoot,
  getSalesPipelinePath,
  importRevenueLoopReport,
  isCliInvocation,
  loadSalesLeads,
  loadSalesLeadSnapshots,
  normalizeSalesStage,
  parseArgs,
  renderSalesPipelineMarkdown,
  runCli,
  sanitizeSalesLead,
  summarizeSalesPipeline,
} = require('../scripts/sales-pipeline');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sales-pipeline-'));
}

function makeReport() {
  return {
    generatedAt: '2026-04-14T00:00:00.000Z',
    targets: [
      {
        temperature: 'warm',
        source: 'reddit',
        channel: 'reddit_dm',
        username: 'game-of-kton',
        accountName: 'r/cursor',
        contactUrl: 'https://www.reddit.com/user/game-of-kton/',
        repoName: '',
        repoUrl: '',
        description: 'Discussed ACT-R engrams and stale context failures.',
        motion: 'sprint',
        motionLabel: 'Workflow Hardening Sprint',
        motionReason: 'Warm Reddit engager already named a repeated workflow risk.',
        offer: 'workflow_hardening_sprint',
        cta: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
        message: 'I can harden one AI-agent workflow for you.',
      },
      {
        temperature: 'cold',
        source: 'github',
        channel: 'github',
        username: 'builder',
        repoName: 'production-mcp-server',
        repoUrl: 'https://github.com/builder/production-mcp-server',
        description: 'Production MCP server with agent workflow risk.',
        stars: 42,
        updatedAt: '2026-04-14T00:00:00Z',
        motion: 'sprint',
        motionLabel: 'Workflow Hardening Sprint',
        motionReason: 'Target can be approached with one concrete workflow-hardening offer.',
        cta: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
        message: 'I can harden one AI-agent workflow for you.',
      },
    ],
  };
}

test('imports GTM revenue targets as workflow sprint leads without marking them contacted', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const result = importRevenueLoopReport(makeReport(), {
    statePath,
    sourcePath: path.join(tempDir, 'gtm-revenue-loop.json'),
  });
  const leads = loadSalesLeads({ statePath });

  assert.equal(result.imported.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.equal(leads.length, 2);
  assert.equal(leads[0].stage, 'targeted');
  assert.equal(leads[0].source, 'reddit');
  assert.equal(leads[0].channel, 'reddit_dm');
  assert.equal(leads[0].offer, 'workflow_hardening_sprint');
  assert.match(leads[0].qualification.concreteOffer, /harden one AI-agent workflow/);
  assert.match(leads[0].outbound.draft, /harden one AI-agent workflow/);
  assert.equal(leads[0].outbound.followUpDraft, null);
  assert.equal(leads[1].source, 'github');
  assert.equal(leads[1].offer, 'workflow_hardening_sprint');
});

test('imports follow-up proof drafts from evidence-backed GTM targets', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const report = makeReport();
  report.targets[0].firstTouchDraft = 'I can harden one AI-agent workflow for you.';
  report.targets[0].painConfirmedFollowUpDraft = 'If the workflow pain is real, I can send the proof pack.';
  report.targets[0].proofPackTrigger = 'Use proof pack only after the buyer confirms pain.';

  importRevenueLoopReport(report, {
    statePath,
    sourcePath: path.join(tempDir, 'gtm-revenue-loop.json'),
  });
  const leads = loadSalesLeads({ statePath });

  assert.equal(leads.length, 2);
  assert.match(leads[0].outbound.draft, /harden one AI-agent workflow/);
  assert.match(leads[0].outbound.followUpDraft, /proof pack/);
  assert.match(leads[0].qualification.proofTiming, /buyer confirms pain/);
});

test('deduplicates repeated GTM imports by stable lead id', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');

  importRevenueLoopReport(makeReport(), { statePath });
  const result = importRevenueLoopReport(makeReport(), { statePath });
  const leads = loadSalesLeads({ statePath });

  assert.equal(result.imported.length, 0);
  assert.equal(result.skipped.length, 2);
  assert.equal(leads.length, 2);
});

test('adds known engaged leads without requiring a generated GTM report', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');

  const lead = addSalesLead({
    source: 'reddit',
    channel: 'reddit_dm',
    username: 'game-of-kton',
    pain: 'Built serious agent memory systems and discussed ACT-R engrams.',
    draft: 'I can harden one AI-agent workflow for you.',
  }, { statePath });
  const leads = loadSalesLeads({ statePath });

  assert.equal(lead.leadId, 'reddit_game_of_kton');
  assert.equal(leads.length, 1);
  assert.equal(leads[0].contact.username, 'game-of-kton');
  assert.equal(leads[0].stage, 'targeted');
  assert.match(leads[0].qualification.painHypothesis, /ACT-R engrams/);
});

test('manual add rejects duplicate lead ids unless forced', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');

  addSalesLead({ source: 'reddit', username: 'game-of-kton' }, { statePath });
  assert.throws(
    () => addSalesLead({ source: 'reddit', username: 'game-of-kton' }, { statePath }),
    /Sales lead already exists: reddit_game_of_kton/
  );
});

test('manual add can intentionally force a refreshed snapshot', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');

  addSalesLead({ source: 'reddit', username: 'game-of-kton', pain: 'Initial pain.' }, { statePath });
  const refreshed = addSalesLead({
    source: 'reddit',
    username: 'game-of-kton',
    pain: 'Sharper workflow pain.',
    force: true,
  }, { statePath });
  const leads = loadSalesLeads({ statePath });

  assert.equal(refreshed.leadId, 'reddit_game_of_kton');
  assert.equal(loadSalesLeadSnapshots({ statePath }).length, 2);
  assert.equal(leads.length, 1);
  assert.match(leads[0].qualification.painHypothesis, /Sharper workflow pain/);
});

test('advances leads through the required pre-payment funnel stages', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  importRevenueLoopReport(makeReport(), { statePath });
  const leadId = loadSalesLeads({ statePath }).find((lead) => lead.source === 'github').leadId;

  advanceSalesLead({
    leadId,
    stage: 'contacted',
    channel: 'github',
    note: 'Sent founder-led workflow hardening offer.',
    evidenceKind: 'platform_send_receipt',
    evidenceSource: 'github',
    evidenceRef: 'https://github.com/org/repo/issues/1#issuecomment-1',
  }, { statePath });
  advanceSalesLead({
    leadId,
    stage: 'replied',
    note: 'Buyer confirmed pain.',
    evidenceKind: 'buyer_reply',
    evidenceSource: 'github',
    evidenceRef: 'https://github.com/org/repo/issues/1#issuecomment-2',
  }, { statePath });
  advanceSalesLead({
    leadId,
    stage: 'call_booked',
    note: 'Booked workflow diagnosis call.',
    evidenceKind: 'booking_confirmation',
    evidenceSource: 'calendar',
    evidenceRef: 'booking_123',
  }, { statePath });
  advanceSalesLead({
    leadId,
    stage: 'sprint_intake',
    note: 'Converted to sprint intake.',
    evidenceKind: 'intake_submission',
    evidenceSource: 'thumbgate_hosted',
    evidenceRef: 'intake_123',
  }, { statePath });
  const lead = loadSalesLeads({ statePath }).find((entry) => entry.leadId === leadId);
  const summary = summarizeSalesPipeline([lead]);

  assert.equal(lead.stage, 'sprint_intake');
  assert.equal(lead.revenue.amountCents, 0);
  assert.equal(summary.contacted, 1);
  assert.equal(summary.replies, 1);
  assert.equal(summary.callsBooked, 1);
  assert.equal(summary.paid, 0);
  assert.equal(summary.verifiedByStage.paid, 0);
  assert.equal(summary.evidenceGapCount, 0);
  assert.equal(summary.bookedRevenueCents, 0);
});

test('rejects skipped funnel stages unless explicitly forced', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  importRevenueLoopReport(makeReport(), { statePath });
  const leadId = loadSalesLeads({ statePath }).find((lead) => lead.source === 'github').leadId;

  assert.throws(
    () => advanceSalesLead({ leadId, stage: 'paid', amountCents: 4900 }, { statePath }),
    /Invalid sales pipeline transition: targeted -> paid/
  );
});

test('unreconciled provider references cannot be mislabeled as payment evidence', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');

  for (const evidenceRef of [
    'cs_live_checkout_only',
    'plink_123',
    'price_123',
    'prod_123',
    'https://buy.stripe.com/example',
  ]) {
    assert.throws(() => addSalesLead({
      leadId: `invalid_${evidenceRef.replace(/[^a-z0-9]/gi, '_')}`,
      source: 'direct',
      stage: 'paid',
      amountCents: 150000,
      evidenceKind: 'provider_payment',
      evidenceSource: 'stripe',
      evidenceRef,
    }, { statePath }), /provider-payment reconciliation/);
  }

  assert.throws(() => addSalesLead({
    leadId: 'invalid_paypal_checkout_url',
    source: 'direct',
    stage: 'paid',
    amountCents: 150000,
    evidenceKind: 'provider_payment',
    evidenceSource: 'paypal',
    evidenceRef: 'https://www.paypal.com/ncp/payment/example',
  }, { statePath }), /provider-payment reconciliation/);

  for (const [provider, reference] of [
    ['stripe', 'ch_live_paid'],
    ['stripe', 'pi_live_paid'],
    ['stripe', 'in_live_paid'],
    ['paypal', '9AB12345CAPTURE'],
  ]) {
    assert.throws(() => addSalesLead({
      leadId: `unreconciled_${reference}`,
      source: 'direct',
      stage: 'paid',
      amountCents: 150000,
      evidenceKind: 'provider_payment',
      evidenceSource: provider,
      evidenceRef: reference,
    }, { statePath }), /provider-payment reconciliation/);
  }
});

test('same-stage advance is idempotent and force cannot invent a payment', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  importRevenueLoopReport(makeReport(), { statePath });
  const leadId = loadSalesLeads({ statePath }).find((lead) => lead.source === 'github').leadId;

  const unchanged = advanceSalesLead({ leadId, stage: 'targeted' }, { statePath });
  assert.equal(unchanged.unchanged, true);
  assert.throws(() => advanceSalesLead({
    leadId,
    stage: 'paid',
    amountCents: 9900,
    force: true,
    note: 'Manual paid-order correction.',
    evidenceKind: 'provider_payment',
    evidenceSource: 'stripe',
    evidenceRef: 'ch_forced_123',
  }, { statePath }), /provider-payment reconciliation/);
});

test('stage labels cannot be advanced from notes or payment-link sends alone', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const lead = addSalesLead({ source: 'reddit', username: 'buyer' }, { statePath });

  assert.throws(
    () => advanceSalesLead({
      leadId: lead.leadId,
      stage: 'contacted',
      note: 'Operator says the message was sent.',
    }, { statePath }),
    /evidenceKind must be one of/
  );
  assert.throws(
    () => advanceSalesLead({
      leadId: lead.leadId,
      stage: 'contacted',
      evidenceKind: 'platform_send_receipt',
      evidenceSource: 'reddit',
      url: 'https://www.reddit.com/message/messages/not-a-receipt-field',
    }, { statePath }),
    /evidenceRef is required/
  );

  advanceSalesLead({
    leadId: lead.leadId,
    stage: 'contacted',
    evidenceKind: 'platform_send_receipt',
    evidenceSource: 'reddit',
    evidenceRef: 'https://www.reddit.com/message/messages/receipt-1',
  }, { statePath });
  advanceSalesLead({
    leadId: lead.leadId,
    stage: 'replied',
    evidenceKind: 'buyer_reply',
    evidenceSource: 'reddit',
    evidenceRef: 'https://www.reddit.com/comments/thread/comment-1',
  }, { statePath });

  assert.throws(
    () => advanceSalesLead({
      leadId: lead.leadId,
      stage: 'checkout_started',
      evidenceKind: 'platform_send_receipt',
      evidenceSource: 'reddit',
      evidenceRef: 'https://www.reddit.com/comments/thread/comment-2',
    }, { statePath }),
    /stage checkout_started requires evidenceKind: provider_checkout_session or buyer_checkout_confirmation/
  );

  const checkout = advanceSalesLead({
    leadId: lead.leadId,
    stage: 'checkout_started',
    evidenceKind: 'provider_checkout_session',
    evidenceSource: 'stripe',
    evidenceRef: 'cs_live_verified_123',
  }, { statePath });

  assert.equal(checkout.lead.stage, 'checkout_started');
  assert.equal(evaluateLeadStageEvidence(checkout.lead).verified, true);
});

test('unreplaced evidence placeholders can never advance a stage', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const lead = addSalesLead({ source: 'manual', username: 'buyer' }, { statePath });

  assert.throws(
    () => advanceSalesLead({
      leadId: lead.leadId,
      stage: 'contacted',
      evidenceKind: 'platform_send_receipt',
      evidenceSource: 'REPLACE_WITH_PLATFORM',
      evidenceRef: 'REPLACE_WITH_PLATFORM_RECEIPT',
    }, { statePath }),
    /Replace evidence placeholders/
  );

  const tampered = sanitizeSalesLead({
    leadId: 'tampered_placeholder_reply',
    source: 'direct',
    stage: 'replied',
    history: [{
      fromStage: 'contacted',
      toStage: 'replied',
      at: '2026-07-16T12:00:00.000Z',
      evidence: {
        kind: 'buyer_reply',
        source: 'REPLACE_WITH_ACTUAL_SOURCE',
        reference: 'REPLACE_WITH_ACTUAL_RECEIPT',
      },
    }],
  });
  const audit = auditSalesPipeline([tampered]);

  assert.equal(evaluateLeadStageEvidence(tampered).verified, false);
  assert.equal(audit.ok, false);
  assert.equal(audit.unverified, 1);
});

test('force bypasses sequence but never bypasses reconciled paid evidence or positive amount', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const lead = addSalesLead({ source: 'manual', username: 'buyer' }, { statePath });

  assert.throws(
    () => advanceSalesLead({
      leadId: lead.leadId,
      stage: 'paid',
      amountCents: 49900,
      force: true,
    }, { statePath }),
    /evidenceKind must be one of/
  );
  assert.throws(
    () => advanceSalesLead({
      leadId: lead.leadId,
      stage: 'paid',
      amountCents: 0,
      force: true,
      evidenceKind: 'provider_payment',
      evidenceSource: 'stripe',
      evidenceRef: 'ch_zero',
    }, { statePath }),
    /provider-payment reconciliation/
  );

  assert.throws(() => advanceSalesLead({
    leadId: lead.leadId,
    stage: 'paid',
    amountCents: 49900,
    force: true,
    evidenceKind: 'provider_payment',
    evidenceSource: 'stripe',
    evidenceRef: 'ch_live_verified_123',
  }, { statePath }), /provider-payment reconciliation/);

  assert.throws(() => advanceSalesLead({
    leadId: lead.leadId,
    stage: 'paid',
    amountCents: 49900,
    force: true,
    evidenceKind: 'provider_payment',
    evidenceProvider: 'paypal',
    evidenceSource: 'provider_api_live:forged-direct-call',
    evidenceRef: 'capture_forged_direct_call',
    evidenceVerified: true,
    evidenceDigest: `sha256:${'a'.repeat(64)}`,
    evidenceOfferId: 'workflow_hardening_diagnostic',
  }, { statePath }), /provider-payment reconciliation/);
});

test('manual add requires evidence for any stage beyond targeted', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');

  assert.throws(
    () => addSalesLead({
      leadId: 'claimed_checkout',
      stage: 'checkout_started',
      note: 'A payment link was sent.',
    }, { statePath }),
    /evidenceKind must be one of/
  );

  const verified = addSalesLead({
    leadId: 'verified_checkout',
    stage: 'checkout_started',
    evidenceKind: 'buyer_checkout_confirmation',
    evidenceSource: 'buyer_email',
    evidenceRef: 'gmail:thread-f:123',
  }, { statePath });

  assert.equal(evaluateLeadStageEvidence(verified).verified, true);

  assert.throws(() => addSalesLead({
    leadId: 'unreconciled_paid',
    stage: 'paid',
    amountCents: 49900,
    currency: 'usd',
    evidenceKind: 'provider_payment',
    evidenceSource: 'stripe',
    evidenceRef: 'ch_live_added_123',
  }, { statePath }), /provider-payment reconciliation/);
});

test('legacy advanced labels remain readable but audit as unverified', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  fs.writeFileSync(statePath, `${JSON.stringify({
    leadId: 'legacy_checkout',
    stage: 'checkout_started',
    source: 'reddit',
    history: [{
      fromStage: 'replied',
      toStage: 'checkout_started',
      at: '2026-07-02T20:47:52.811Z',
      note: 'Sent a payment link; no provider checkout event exists.',
      url: 'https://www.reddit.com/chat/',
    }],
  })}\n`, 'utf8');

  const leads = loadSalesLeads({ statePath });
  const audit = auditSalesPipeline(leads);
  const summary = summarizeSalesPipeline(leads);

  assert.equal(leads[0].stage, 'checkout_started');
  assert.equal(audit.ok, false);
  assert.equal(audit.unverified, 1);
  assert.equal(audit.issues[0].code, 'unverified_stage_evidence');
  assert.equal(summary.byStage.checkout_started, 1);
  assert.equal(summary.verifiedByStage.checkout_started, 0);
  assert.equal(summary.unverifiedByStage.checkout_started, 1);
  assert.equal(summary.evidenceGapCount, 1);
});

test('same-stage send receipts do not validate checkout, while provider evidence does', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  fs.writeFileSync(statePath, `${JSON.stringify({
    leadId: 'legacy_checkout',
    stage: 'checkout_started',
    source: 'reddit',
    channel: 'reddit_chat',
  })}\n`, 'utf8');

  const send = advanceSalesLead({
    leadId: 'legacy_checkout',
    stage: 'checkout_started',
    evidenceKind: 'platform_send_receipt',
    evidenceSource: 'reddit',
    evidenceRef: 'https://www.reddit.com/chat/receipt-2',
    timestamp: '2026-07-15T12:00:00.000Z',
  }, { statePath });
  assert.equal(send.unchanged, false);
  assert.equal(send.lead.outbound.lastSentAt, '2026-07-15T12:00:00.000Z');
  assert.equal(evaluateLeadStageEvidence(send.lead).verified, false);

  const checkout = advanceSalesLead({
    leadId: 'legacy_checkout',
    stage: 'checkout_started',
    evidenceKind: 'provider_checkout_session',
    evidenceSource: 'stripe',
    evidenceRef: 'cs_live_legacy_verified',
    timestamp: '2026-07-15T12:05:00.000Z',
  }, { statePath });
  assert.equal(checkout.lead.outbound.lastSentAt, '2026-07-15T12:00:00.000Z');
  assert.equal(evaluateLeadStageEvidence(checkout.lead).verified, true);
});

test('same-stage notes cannot be converted into evidence implicitly', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const lead = addSalesLead({ source: 'manual', username: 'buyer' }, { statePath });

  assert.throws(
    () => advanceSalesLead({
      leadId: lead.leadId,
      stage: 'targeted',
      note: 'Operator-only note with no receipt.',
    }, { statePath }),
    /same-stage updates require evidenceKind/
  );
});

test('loading persisted leads preserves history timestamps and evidence', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  fs.writeFileSync(statePath, `${JSON.stringify({
    leadId: 'persisted_evidence',
    stage: 'contacted',
    source: 'email',
    history: [{
      fromStage: 'targeted',
      toStage: 'contacted',
      at: '2026-06-01T12:34:56.000Z',
      evidence: {
        kind: 'platform_send_receipt',
        source: 'gmail',
        reference: 'gmail:thread-f:123',
      },
    }],
  })}\n`, 'utf8');

  const lead = loadSalesLeads({ statePath })[0];

  assert.equal(lead.history[0].at, '2026-06-01T12:34:56.000Z');
  assert.equal(lead.history[0].evidence.kind, 'platform_send_receipt');
  assert.equal(evaluateLeadStageEvidence(lead).verified, true);
});

test('legacy rows without timestamps remain deterministic and cannot outrank appended evidence', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  fs.writeFileSync(statePath, `${JSON.stringify({
    leadId: 'legacy_without_time',
    stage: 'contacted',
    source: 'manual',
  })}\n`, 'utf8');

  const firstRead = loadSalesLeads({ statePath })[0];
  const secondRead = loadSalesLeads({ statePath })[0];
  assert.equal(firstRead.updatedAt, '1970-01-01T00:00:00.000Z');
  assert.equal(secondRead.updatedAt, firstRead.updatedAt);

  advanceSalesLead({
    leadId: firstRead.leadId,
    stage: 'contacted',
    evidenceKind: 'platform_send_receipt',
    evidenceSource: 'manual_import',
    evidenceRef: 'receipt_legacy_1',
    timestamp: '2026-07-15T12:00:00.000Z',
  }, { statePath });

  const current = loadSalesLeads({ statePath })[0];
  assert.equal(current.outbound.lastSentAt, '2026-07-15T12:00:00.000Z');
  assert.equal(evaluateLeadStageEvidence(current).verified, true);
});

test('renders an operator report that separates targeting from actual sales progress', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  importRevenueLoopReport(makeReport(), { statePath });
  const markdown = renderSalesPipelineMarkdown({ leads: loadSalesLeads({ statePath }) });

  assert.match(markdown, /Posts are not sales/);
  assert.match(markdown, /targeted: 2/);
  assert.match(markdown, /Verified contacted: 0 \(raw stage-derived: 0\)/);
  assert.match(markdown, /Verified Stage Counts/);
  assert.match(markdown, /Evidence gaps: 0/);
  assert.match(markdown, /Proof rule: Use proof pack only after the buyer confirms pain/);
});

test('report aliases status and summary to the operator funnel view', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  importRevenueLoopReport(makeReport(), { statePath });

  const fromStatus = runCli(['status', '--state', statePath]);
  const fromSummary = runCli(['summary', '--state', statePath]);

  assert.equal(fromStatus.command, 'report');
  assert.equal(fromSummary.command, 'report');
  assert.equal(fromStatus.summary.total, 2);
  assert.equal(fromSummary.summary.total, 2);
});

test('helpers sanitize invalid input without losing operator-safe defaults', () => {
  const sanitized = sanitizeSalesLead({
    source: '  ',
    stage: 'not-real',
    contact: {
      username: ' Ada ',
      url: 'not a url',
    },
    account: {
      stars: '12px',
    },
    revenue: {
      amountCents: -100,
    },
    history: [{
      toStage: 'paid',
      url: 'https://example.com/path',
    }],
  });

  assert.equal(normalizeSalesStage('paid'), 'paid');
  assert.equal(normalizeSalesStage('wat'), null);
  assert.equal(sanitized.stage, 'targeted');
  assert.equal(sanitized.source, 'manual');
  assert.equal(sanitized.contact.username, 'Ada');
  assert.equal(sanitized.contact.url, 'not a url');
  assert.equal(sanitized.account.stars, 12);
  assert.equal(sanitized.revenue.amountCents, 0);
  assert.equal(sanitized.history[0].toStage, 'paid');
});

test('CLI argument parsing, default state path, and error paths are explicit', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');

  assert.deepEqual(parseArgs(['advance', '--lead', 'abc', '--stage=paid', '--force']), {
    command: 'advance',
    lead: 'abc',
    stage: 'paid',
    force: true,
  });
  assert.equal(getSalesPipelinePath({ feedbackDir: tempDir }), statePath);
  assert.throws(() => runCli(['import', '--state', statePath]), /--source is required/);
  assert.throws(() => runCli(['advance', '--state', statePath, '--stage', 'paid']), /leadId is required/);
  assert.throws(() => runCli(['wat', '--state', statePath]), /Unknown sales pipeline command/);
});

test('linked Git worktrees resolve the canonical repository sales pipeline', () => {
  const tempDir = makeTempDir();
  const primaryRoot = path.join(tempDir, 'primary');
  const linkedRoot = path.join(tempDir, 'linked');
  const gitDir = path.join(primaryRoot, '.git');
  const linkedGitDir = path.join(gitDir, 'worktrees', 'linked');
  fs.mkdirSync(linkedGitDir, { recursive: true });
  fs.mkdirSync(linkedRoot, { recursive: true });
  fs.writeFileSync(path.join(linkedRoot, '.git'), `gitdir: ${linkedGitDir}\n`, 'utf8');
  fs.writeFileSync(path.join(linkedGitDir, 'commondir'), '../..\n', 'utf8');

  assert.equal(findLinkedGitCommonRoot({ cwd: linkedRoot }), primaryRoot);
  assert.equal(
    getSalesPipelinePath({ cwd: linkedRoot, env: {} }),
    path.join(primaryRoot, '.thumbgate', 'sales-pipeline.jsonl')
  );
});

test('linked-worktree discovery rejects a forged gitdir outside the common worktrees directory', () => {
  const tempDir = makeTempDir();
  const linkedRoot = path.join(tempDir, 'linked');
  const unrelatedGitDir = path.join(tempDir, 'unrelated', 'nested');
  const unrelatedCommonDir = path.join(tempDir, 'unrelated', '.git');
  fs.mkdirSync(linkedRoot, { recursive: true });
  fs.mkdirSync(unrelatedGitDir, { recursive: true });
  fs.mkdirSync(unrelatedCommonDir, { recursive: true });
  fs.writeFileSync(path.join(linkedRoot, '.git'), `gitdir: ${unrelatedGitDir}\n`, 'utf8');
  fs.writeFileSync(path.join(unrelatedGitDir, 'commondir'), '../.git\n', 'utf8');

  assert.equal(findLinkedGitCommonRoot({ cwd: linkedRoot }), null);
});

test('explicit sales pipeline storage overrides linked-worktree discovery', () => {
  const tempDir = makeTempDir();
  const primaryRoot = path.join(tempDir, 'primary');
  const linkedRoot = path.join(tempDir, 'linked');
  const gitDir = path.join(primaryRoot, '.git');
  const linkedGitDir = path.join(gitDir, 'worktrees', 'linked');
  const explicitState = path.join(tempDir, 'operator', 'pipeline.jsonl');
  const explicitFeedback = path.join(tempDir, 'feedback');
  const explicitProject = path.join(tempDir, 'project');
  fs.mkdirSync(linkedGitDir, { recursive: true });
  fs.mkdirSync(linkedRoot, { recursive: true });
  fs.mkdirSync(path.join(explicitProject, '.thumbgate'), { recursive: true });
  fs.writeFileSync(path.join(linkedRoot, '.git'), `gitdir: ${linkedGitDir}\n`, 'utf8');
  fs.writeFileSync(path.join(linkedGitDir, 'commondir'), '../..\n', 'utf8');

  assert.equal(getSalesPipelinePath({ statePath: explicitState, cwd: linkedRoot }), explicitState);
  assert.equal(
    getSalesPipelinePath({ feedbackDir: explicitFeedback, cwd: linkedRoot }),
    path.join(explicitFeedback, 'sales-pipeline.jsonl')
  );
  assert.equal(
    getSalesPipelinePath({ cwd: linkedRoot, env: { THUMBGATE_SALES_PIPELINE_PATH: explicitState } }),
    explicitState
  );
  assert.equal(
    getSalesPipelinePath({ cwd: linkedRoot, env: { THUMBGATE_FEEDBACK_DIR: explicitFeedback } }),
    path.join(explicitFeedback, 'sales-pipeline.jsonl')
  );
  assert.equal(
    getSalesPipelinePath({ cwd: linkedRoot, env: { THUMBGATE_PROJECT_DIR: explicitProject } }),
    path.join(explicitProject, '.thumbgate', 'sales-pipeline.jsonl')
  );
  assert.equal(
    getSalesPipelinePath({ cwd: linkedRoot, env: { RAILWAY_VOLUME_MOUNT_PATH: '/data' } }),
    path.join('/data', 'feedback', 'sales-pipeline.jsonl')
  );
});

test('CLI invocation detection resolves symlinked paths', () => {
  const tempDir = makeTempDir();
  const symlinkPath = path.join(tempDir, 'sales-pipeline-link.js');
  fs.symlinkSync(require.resolve('../scripts/sales-pipeline'), symlinkPath);

  assert.equal(isCliInvocation(['node', symlinkPath]), true);
  assert.equal(isCliInvocation(['node', __filename]), false);
});

test('CLI add, report, and advance commands share the same JSONL state', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const outPath = path.join(tempDir, 'sales-pipeline.md');

  const added = runCli([
    'add',
    '--state', statePath,
    '--out', outPath,
    '--source', 'linkedin',
    '--username', 'founder',
    '--pain', 'Agent keeps repeating a deployment mistake.',
  ]);
  const advanced = runCli([
    'advance',
    '--state', statePath,
    '--lead', added.leadId,
    '--stage', 'contacted',
    '--url', 'https://linkedin.com/in/founder',
    '--note', 'Sent one-workflow hardening offer.',
    '--evidence-kind', 'platform_send_receipt',
    '--evidence-source', 'linkedin',
    '--evidence-ref', 'https://linkedin.com/in/founder/recent-activity/receipt-1',
  ]);
  const report = runCli(['report', '--state', statePath, '--out', outPath]);

  assert.equal(added.stage, 'targeted');
  assert.equal(advanced.stage, 'contacted');
  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.contacted, 1);
  assert.equal(report.summary.verifiedByStage.contacted, 1);
  assert.equal(report.summary.evidenceGapCount, 0);
  assert.match(fs.readFileSync(outPath, 'utf8'), /linkedin_founder/);
});

test('CLI audit exposes legacy stage gaps without rewriting state', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  fs.writeFileSync(statePath, `${JSON.stringify({
    leadId: 'legacy_paid',
    stage: 'paid',
    source: 'manual',
    revenue: { amountCents: 49900, currency: 'usd' },
  })}\n`, 'utf8');
  const before = fs.readFileSync(statePath, 'utf8');

  const result = runCli(['audit', '--state', statePath]);

  assert.equal(result.command, 'audit');
  assert.equal(result.audit.ok, false);
  assert.equal(result.audit.unverified, 1);
  assert.deepEqual(result.audit.issues[0].allowedEvidenceKinds, ['provider_payment']);
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
});

test('headline funnel metrics exclude legacy stage labels without structured evidence', () => {
  const summary = summarizeSalesPipeline([
    sanitizeSalesLead({
      leadId: 'legacy_contacted',
      stage: 'contacted',
      source: 'manual',
      history: [{ stage: 'contacted', at: '2026-07-01T00:00:00.000Z', note: 'Sent.' }],
    }),
    sanitizeSalesLead({
      leadId: 'legacy_checkout',
      stage: 'checkout_started',
      source: 'manual',
      history: [{ stage: 'checkout_started', at: '2026-07-01T00:00:00.000Z', note: 'Link sent.' }],
    }),
  ]);

  assert.equal(summary.contacted, 0);
  assert.equal(summary.replies, 0);
  assert.equal(summary.callsBooked, 0);
  assert.equal(summary.rawContacted, 2);
  assert.equal(summary.rawReplies, 1);
  assert.equal(summary.rawCallsBooked, 1);
  assert.equal(summary.evidenceGapCount, 2);
});

test('a forced provider-shaped reference cannot invent payment or upstream engagement', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const added = addSalesLead({ leadId: 'direct_buyer', source: 'manual' }, { statePath });
  assert.throws(() => advanceSalesLead({
    leadId: added.leadId,
    stage: 'paid',
    amountCents: 49900,
    evidenceKind: 'provider_payment',
    evidenceSource: 'stripe_live_api',
    evidenceRef: 'pi_direct_123',
    force: true,
  }, { statePath }), /provider-payment reconciliation/);

  const summary = summarizeSalesPipeline(loadSalesLeads({ statePath }));
  assert.equal(summary.contacted, 0);
  assert.equal(summary.replies, 0);
  assert.equal(summary.callsBooked, 0);
  assert.equal(summary.paid, 0);
  assert.equal(summary.bookedRevenueCents, 0);
});

test('CLI imports a report and writes a markdown pipeline report', () => {
  const tempDir = makeTempDir();
  const sourcePath = path.join(tempDir, 'gtm-revenue-loop.json');
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const outPath = path.join(tempDir, 'sales-pipeline.md');
  fs.writeFileSync(sourcePath, JSON.stringify(makeReport(), null, 2), 'utf8');

  const result = runCli(['import', '--source', sourcePath, '--state', statePath, '--out', outPath]);

  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.reportPath, outPath);
  assert.match(fs.readFileSync(outPath, 'utf8'), /Sales Pipeline/);
});
