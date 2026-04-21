const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  addSalesLead,
  advanceSalesLead,
  getSalesPipelinePath,
  importRevenueLoopReport,
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
        username: 'builder',
        repoName: 'production-mcp-server',
        repoUrl: 'https://github.com/builder/production-mcp-server',
        description: 'Production MCP server with agent workflow risk.',
        stars: 42,
        updatedAt: '2026-04-14T00:00:00Z',
        motion: 'sprint',
        motionLabel: 'Workflow Hardening Sprint',
        motionReason: 'Target can be approached with one concrete workflow-hardening offer.',
        cta: 'https://thumbgate.ai/#workflow-sprint-intake',
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

  assert.equal(result.imported.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].stage, 'targeted');
  assert.equal(leads[0].offer, 'workflow_hardening_sprint');
  assert.match(leads[0].qualification.concreteOffer, /harden one AI-agent workflow/);
  assert.match(leads[0].outbound.draft, /harden one AI-agent workflow/);
});

test('deduplicates repeated GTM imports by stable lead id', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');

  importRevenueLoopReport(makeReport(), { statePath });
  const result = importRevenueLoopReport(makeReport(), { statePath });
  const leads = loadSalesLeads({ statePath });

  assert.equal(result.imported.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(leads.length, 1);
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

test('advances leads through the required first-dollar funnel stages', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  importRevenueLoopReport(makeReport(), { statePath });
  const leadId = loadSalesLeads({ statePath })[0].leadId;

  advanceSalesLead({
    leadId,
    stage: 'contacted',
    channel: 'github',
    note: 'Sent founder-led workflow hardening offer.',
  }, { statePath });
  advanceSalesLead({ leadId, stage: 'replied', note: 'Buyer confirmed pain.' }, { statePath });
  advanceSalesLead({ leadId, stage: 'call_booked', note: 'Booked workflow diagnosis call.' }, { statePath });
  advanceSalesLead({ leadId, stage: 'sprint_intake', note: 'Converted to sprint intake.' }, { statePath });
  advanceSalesLead({ leadId, stage: 'paid', amountCents: 4900, note: 'Paid sprint deposit.' }, { statePath });

  const [lead] = loadSalesLeads({ statePath });
  const summary = summarizeSalesPipeline([lead]);

  assert.equal(lead.stage, 'paid');
  assert.equal(lead.revenue.amountCents, 4900);
  assert.equal(summary.contacted, 1);
  assert.equal(summary.replies, 1);
  assert.equal(summary.callsBooked, 1);
  assert.equal(summary.bookedRevenueCents, 4900);
});

test('rejects skipped funnel stages unless explicitly forced', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  importRevenueLoopReport(makeReport(), { statePath });
  const leadId = loadSalesLeads({ statePath })[0].leadId;

  assert.throws(
    () => advanceSalesLead({ leadId, stage: 'paid', amountCents: 4900 }, { statePath }),
    /Invalid sales pipeline transition: targeted -> paid/
  );
});

test('same-stage advance is idempotent and forced jumps are explicit', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  importRevenueLoopReport(makeReport(), { statePath });
  const leadId = loadSalesLeads({ statePath })[0].leadId;

  const unchanged = advanceSalesLead({ leadId, stage: 'targeted' }, { statePath });
  const forced = advanceSalesLead({
    leadId,
    stage: 'paid',
    amountCents: 9900,
    force: true,
    note: 'Manual paid-order correction.',
  }, { statePath });

  assert.equal(unchanged.unchanged, true);
  assert.equal(forced.unchanged, false);
  assert.equal(forced.lead.stage, 'paid');
  assert.equal(forced.lead.revenue.amountCents, 9900);
});

test('renders an operator report that separates targeting from actual sales progress', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  importRevenueLoopReport(makeReport(), { statePath });
  const markdown = renderSalesPipelineMarkdown({ leads: loadSalesLeads({ statePath }) });

  assert.match(markdown, /Posts are not sales/);
  assert.match(markdown, /targeted: 1/);
  assert.match(markdown, /Contacted: 0/);
  assert.match(markdown, /Proof rule: Use proof pack only after the buyer confirms pain/);
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
  ]);
  const report = runCli(['report', '--state', statePath, '--out', outPath]);

  assert.equal(added.stage, 'targeted');
  assert.equal(advanced.stage, 'contacted');
  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.contacted, 1);
  assert.match(fs.readFileSync(outPath, 'utf8'), /linkedin_founder/);
});

test('CLI imports a report and writes a markdown pipeline report', () => {
  const tempDir = makeTempDir();
  const sourcePath = path.join(tempDir, 'gtm-revenue-loop.json');
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const outPath = path.join(tempDir, 'sales-pipeline.md');
  fs.writeFileSync(sourcePath, JSON.stringify(makeReport(), null, 2), 'utf8');

  const result = runCli(['import', '--source', sourcePath, '--state', statePath, '--out', outPath]);

  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.reportPath, outPath);
  assert.match(fs.readFileSync(outPath, 'utf8'), /Sales Pipeline/);
});
