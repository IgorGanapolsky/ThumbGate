'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildGitHubOutreachJobs,
  isCliInvocation,
  main,
} = require('../scripts/autonomous-sales-agent');

test('automation emits LinkedIn, Aiventyx, ChatGPT, Codex, and GitHub outreach assets from the revenue loop outputs', async () => {
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
      runGitHubOutreach(options) {
        calls.push(['runGitHubOutreach', options]);
        return { docsPath: options.outPath };
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
    ['buildCodexMarketplaceRevenuePack'],
    ['writeCodexMarketplaceRevenuePack', 'codex', true],
    ['buildCodexPluginRevenuePack', 2],
    ['writeCodexPluginRevenuePack', 'codex-plugin', true],
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
  ]);
  assert.ok(logs.some((line) => line.includes('Aiventyx pack updated: /tmp/aiventyx.md')));
  assert.ok(logs.some((line) => line.includes('LinkedIn pack updated: /tmp/linkedin.md')));
  assert.ok(logs.some((line) => line.includes('ChatGPT pack updated: /tmp/chatgpt.md')));
  assert.ok(logs.some((line) => line.includes('Reddit DM pack updated: /tmp/reddit.md')));
  assert.ok(logs.some((line) => line.includes('Codex marketplace pack updated: /tmp/codex-marketplace.md')));
  assert.ok(logs.some((line) => line.includes('Codex plugin pack updated: /tmp/codex-plugin.md')));
  assert.ok(logs.some((line) => line.includes('GitHub outreach asset updated: /tmp/reports/gtm/OUTREACH_TARGETS.md')));
  assert.ok(logs.some((line) => line.includes(`GitHub outreach asset updated: ${path.resolve(repoRoot, 'docs/OUTREACH_TARGETS.md')}`)));
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

test('CLI entrypoint detection is path based', () => {
  const scriptPath = require.resolve('../scripts/autonomous-sales-agent');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', __filename]), false);
});
