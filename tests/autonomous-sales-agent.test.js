'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildGitHubOutreachJobs,
  buildPackWriteOptions,
  isCliInvocation,
  main,
  resolveSalesPipelineImportSource,
  syncSalesPipeline,
} = require('../scripts/autonomous-sales-agent');

test('automation emits LinkedIn, Roo, Aiventyx, ChatGPT, Codex, and GitHub outreach assets from the revenue loop outputs', async () => {
  const calls = [];
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => {
    logs.push(String(message));
  };

  try {
    await main(['--write-docs'], {
      parseArgs(argv) {
        calls.push(['parseArgs', argv]);
        return { writeDocs: true, reportDir: 'reports/gtm/test' };
      },
      async runRevenueLoop(options) {
        calls.push(['runRevenueLoop', options]);
        return {
          report: {
            directive: {
              state: 'cold-start',
            },
            targets: [{ id: 'lead-1' }, { id: 'lead-2' }],
          },
          written: {
            docsPath: '/tmp/gtm-revenue-loop.md',
            reportDir: '/tmp/reports/gtm',
          },
        };
      },
      buildClaudeWorkflowHardeningPack(report) {
        calls.push(['buildClaudeWorkflowHardeningPack', report.targets.length]);
        return { channel: 'claude' };
      },
      writeClaudeWorkflowHardeningPack(pack, options) {
        calls.push(['writeClaudeWorkflowHardeningPack', pack.channel, options.writeDocs]);
        return { docsPath: '/tmp/claude.md' };
      },
      buildCursorMarketplaceRevenuePack() {
        calls.push(['buildCursorMarketplaceRevenuePack']);
        return { channel: 'cursor' };
      },
      writeCursorMarketplaceRevenuePack(pack, options) {
        calls.push(['writeCursorMarketplaceRevenuePack', pack.channel, options.writeDocs]);
        return { docsPath: '/tmp/cursor.md' };
      },
      buildAiventyxMarketplacePlan() {
        calls.push(['buildAiventyxMarketplacePlan']);
        return { channel: 'aiventyx' };
      },
      writeAiventyxMarketplaceOutputs(pack, options) {
        calls.push(['writeAiventyxMarketplaceOutputs', pack.channel, options.writeDocs]);
        return { docsPath: '/tmp/aiventyx.md' };
      },
      buildGeminiCliDemandPack(report) {
        calls.push(['buildGeminiCliDemandPack', report.targets.length]);
        return { channel: 'gemini' };
      },
      writeGeminiCliDemandPack(pack, options) {
        calls.push(['writeGeminiCliDemandPack', pack.channel, options.writeDocs]);
        return { docsPath: '/tmp/gemini.md' };
      },
      buildLinkedinWorkflowHardeningPack(report) {
        calls.push(['buildLinkedinWorkflowHardeningPack', report.targets.length]);
        return { channel: 'linkedin' };
      },
      writeLinkedinWorkflowHardeningPack(pack, options) {
        calls.push(['writeLinkedinWorkflowHardeningPack', pack.channel, options.writeDocs]);
        return { docsPath: '/tmp/linkedin.md' };
      },
      buildChatgptGptRevenuePack(report) {
        calls.push(['buildChatgptGptRevenuePack', report.targets.length]);
        return { channel: 'chatgpt' };
      },
      writeChatgptGptRevenuePack(pack, options) {
        calls.push(['writeChatgptGptRevenuePack', pack.channel, options.writeDocs]);
        return { docsPath: '/tmp/chatgpt.md' };
      },
      buildRedditDmWorkflowHardeningPack(report) {
        calls.push(['buildRedditDmWorkflowHardeningPack', report.targets.length]);
        return { channel: 'reddit' };
      },
      writeRedditDmWorkflowHardeningPack(pack, options) {
        calls.push(['writeRedditDmWorkflowHardeningPack', pack.channel, options.writeDocs]);
        return { docsPath: '/tmp/reddit.md' };
      },
      buildRooSunsetDemandPack(report) {
        calls.push(['buildRooSunsetDemandPack', report.targets.length]);
        return { channel: 'roo' };
      },
      writeRooSunsetDemandPack(pack, options) {
        calls.push(['writeRooSunsetDemandPack', pack.channel, options.writeDocs]);
        return { docsPath: '/tmp/roo.md' };
      },
      buildCodexMarketplaceRevenuePack() {
        calls.push(['buildCodexMarketplaceRevenuePack']);
        return { channel: 'codex' };
      },
      writeCodexMarketplaceRevenuePack(pack, options) {
        calls.push(['writeCodexMarketplaceRevenuePack', pack.channel, options.writeDocs]);
        return { docsPath: '/tmp/codex-marketplace.md' };
      },
      buildCodexPluginRevenuePack(report) {
        calls.push(['buildCodexPluginRevenuePack', report.targets.length]);
        return { channel: 'codex-plugin' };
      },
      writeCodexPluginRevenuePack(pack, options) {
        calls.push(['writeCodexPluginRevenuePack', pack.channel, options.writeDocs]);
        return { docsPath: '/tmp/codex-plugin.md' };
      },
      buildMcpDirectoryRevenuePack() {
        calls.push(['buildMcpDirectoryRevenuePack']);
        return { channel: 'mcp-directory' };
      },
      writeMcpDirectoryRevenuePack(pack, options) {
        calls.push(['writeMcpDirectoryRevenuePack', pack.channel, options.writeDocs]);
        return { docsPath: '/tmp/mcp-directory.md' };
      },
      runGitHubOutreach(options) {
        calls.push(['runGitHubOutreach', options]);
        return { docsPath: options.outPath };
      },
      syncSalesPipeline(report, written) {
        calls.push(['syncSalesPipeline', report.targets.length, written.reportDir]);
        return {
          imported: 2,
          skipped: 0,
          statePath: '/tmp/.thumbgate/sales-pipeline.jsonl',
          summary: {
            active: 2,
            contacted: 0,
            replies: 0,
            paid: 0,
          },
        };
      },
    });
  } finally {
    console.log = originalLog;
  }

  const repoRoot = path.resolve(__dirname, '..');
  assert.deepEqual(calls, [
    ['parseArgs', ['--write-docs']],
    ['runRevenueLoop', { writeDocs: true, reportDir: 'reports/gtm/test' }],
    ['buildClaudeWorkflowHardeningPack', 2],
    ['writeClaudeWorkflowHardeningPack', 'claude', true],
    ['buildCursorMarketplaceRevenuePack'],
    ['writeCursorMarketplaceRevenuePack', 'cursor', true],
    ['buildAiventyxMarketplacePlan'],
    ['writeAiventyxMarketplaceOutputs', 'aiventyx', true],
    ['buildGeminiCliDemandPack', 2],
    ['writeGeminiCliDemandPack', 'gemini', true],
    ['buildLinkedinWorkflowHardeningPack', 2],
    ['writeLinkedinWorkflowHardeningPack', 'linkedin', true],
    ['buildChatgptGptRevenuePack', 2],
    ['writeChatgptGptRevenuePack', 'chatgpt', true],
    ['buildRedditDmWorkflowHardeningPack', 2],
    ['writeRedditDmWorkflowHardeningPack', 'reddit', true],
    ['buildRooSunsetDemandPack', 2],
    ['writeRooSunsetDemandPack', 'roo', true],
    ['buildCodexMarketplaceRevenuePack'],
    ['writeCodexMarketplaceRevenuePack', 'codex', true],
    ['buildCodexPluginRevenuePack', 2],
    ['writeCodexPluginRevenuePack', 'codex-plugin', true],
    ['buildMcpDirectoryRevenuePack'],
    ['writeMcpDirectoryRevenuePack', 'mcp-directory', true],
    ['runGitHubOutreach', {
      queuePath: path.resolve('/tmp/reports/gtm', 'gtm-target-queue.jsonl'),
      reportPath: path.resolve('/tmp/reports/gtm', 'gtm-revenue-loop.json'),
      outPath: path.resolve('/tmp/reports/gtm', 'OUTREACH_TARGETS.md'),
    }],
    ['runGitHubOutreach', {
      queuePath: path.resolve(repoRoot, 'docs/marketing/gtm-target-queue.jsonl'),
      reportPath: path.resolve(repoRoot, 'docs/marketing/gtm-revenue-loop.json'),
      outPath: path.resolve(repoRoot, 'docs/OUTREACH_TARGETS.md'),
    }],
    ['syncSalesPipeline', 2, '/tmp/reports/gtm'],
  ]);
  assert.ok(logs.some((line) => line.includes('Aiventyx pack updated: /tmp/aiventyx.md')));
  assert.ok(logs.some((line) => line.includes('LinkedIn pack updated: /tmp/linkedin.md')));
  assert.ok(logs.some((line) => line.includes('ChatGPT pack updated: /tmp/chatgpt.md')));
  assert.ok(logs.some((line) => line.includes('Reddit DM pack updated: /tmp/reddit.md')));
  assert.ok(logs.some((line) => line.includes('Roo sunset pack updated: /tmp/roo.md')));
  assert.ok(logs.some((line) => line.includes('Codex marketplace pack updated: /tmp/codex-marketplace.md')));
  assert.ok(logs.some((line) => line.includes('Codex plugin pack updated: /tmp/codex-plugin.md')));
  assert.ok(logs.some((line) => line.includes('MCP directory pack updated: /tmp/mcp-directory.md')));
  assert.ok(logs.some((line) => line.includes('GitHub outreach asset updated: /tmp/reports/gtm/OUTREACH_TARGETS.md')));
  assert.ok(logs.some((line) => line.includes(`GitHub outreach asset updated: ${path.resolve(repoRoot, 'docs/OUTREACH_TARGETS.md')}`)));
  assert.ok(logs.some((line) => line.includes('Sales pipeline synced: 2 imported, 0 skipped. Active 2, contacted 0, replied 0, paid 0.')));
  assert.ok(logs.some((line) => line.includes('Sales pipeline state: /tmp/.thumbgate/sales-pipeline.jsonl')));
  assert.ok(logs.some((line) => line.includes('State: cold-start | Targets: 2')));
});

test('buildGitHubOutreachJobs writes report-dir and repo docs assets from the current revenue loop outputs', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const jobs = buildGitHubOutreachJobs({
    reportDir: '/tmp/reports/gtm',
    docsPath: path.join(repoRoot, 'docs', 'marketing', 'gtm-revenue-loop.md'),
  }, repoRoot);

  assert.deepEqual(jobs, [
    {
      queuePath: path.resolve('/tmp/reports/gtm', 'gtm-target-queue.jsonl'),
      reportPath: path.resolve('/tmp/reports/gtm', 'gtm-revenue-loop.json'),
      outPath: path.resolve('/tmp/reports/gtm', 'OUTREACH_TARGETS.md'),
    },
    {
      queuePath: path.resolve(repoRoot, 'docs/marketing/gtm-target-queue.jsonl'),
      reportPath: path.resolve(repoRoot, 'docs/marketing/gtm-revenue-loop.json'),
      outPath: path.resolve(repoRoot, 'docs/OUTREACH_TARGETS.md'),
    },
  ]);
});

test('buildPackWriteOptions mirrors revenue-loop doc behavior for channel packs', () => {
  assert.deepEqual(
    buildPackWriteOptions({}),
    { writeDocs: true },
  );
  assert.deepEqual(
    buildPackWriteOptions({ reportDir: 'reports/gtm/test' }),
    { reportDir: 'reports/gtm/test', writeDocs: false },
  );
  assert.deepEqual(
    buildPackWriteOptions({ writeDocs: true, reportDir: 'reports/gtm/test' }),
    { writeDocs: true, reportDir: 'reports/gtm/test' },
  );
});

test('resolveSalesPipelineImportSource prefers report-dir JSON and falls back to docs JSON', () => {
  const repoRoot = path.resolve(__dirname, '..');

  assert.equal(
    resolveSalesPipelineImportSource({ reportDir: '/tmp/reports/gtm' }, repoRoot),
    path.resolve('/tmp/reports/gtm', 'gtm-revenue-loop.json'),
  );
  assert.equal(
    resolveSalesPipelineImportSource({ docsPath: path.join(repoRoot, 'docs', 'marketing', 'gtm-revenue-loop.md') }, repoRoot),
    path.resolve(repoRoot, 'docs', 'marketing', 'gtm-revenue-loop.json'),
  );
  assert.equal(resolveSalesPipelineImportSource({}, repoRoot), null);
});

test('syncSalesPipeline imports GTM targets and summarizes the local pipeline', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const statePath = path.resolve(__dirname, 'fixtures', 'sales-pipeline-sync.jsonl');
  const report = {
    targets: [
      {
        source: 'github',
        channel: 'github',
        username: 'builder',
        repoName: 'approval-workflow',
        repoUrl: 'https://github.com/builder/approval-workflow',
        description: 'Approval workflow with repeated handoff failures.',
        motionReason: 'One repeated approval failure is already visible.',
        offer: 'workflow_hardening_sprint',
        cta: 'https://thumbgate-production.up.railway.app/#workflow-sprint-intake',
        firstTouchDraft: 'I can harden one AI-agent workflow for you.',
      },
    ],
  };
  const sync = syncSalesPipeline(report, {
    reportDir: '/tmp/reports/gtm',
  }, repoRoot, {
    importRevenueLoopReport: (payload, options) => {
      assert.equal(payload.targets.length, 1);
      assert.equal(options.sourcePath, path.resolve('/tmp/reports/gtm', 'gtm-revenue-loop.json'));
      return {
        imported: [{ leadId: 'github_builder_approval_workflow' }],
        skipped: [],
      };
    },
    loadSalesLeads: () => [{
      leadId: 'github_builder_approval_workflow',
      stage: 'targeted',
      revenue: { amountCents: 0 },
    }],
    summarizeSalesPipeline: () => ({
      active: 1,
      contacted: 0,
      replies: 0,
      paid: 0,
    }),
    getSalesPipelinePath: () => statePath,
  });

  assert.deepEqual(sync, {
    imported: 1,
    skipped: 0,
    sourcePath: path.resolve('/tmp/reports/gtm', 'gtm-revenue-loop.json'),
    statePath,
    summary: {
      active: 1,
      contacted: 0,
      replies: 0,
      paid: 0,
    },
  });
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = require.resolve('../scripts/autonomous-sales-agent');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', __filename]), false);
});
