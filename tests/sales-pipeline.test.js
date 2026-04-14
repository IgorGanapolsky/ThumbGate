const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  addSalesLead,
  advanceSalesLead,
  importRevenueLoopReport,
  loadSalesLeads,
  renderSalesPipelineMarkdown,
  runCli,
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
