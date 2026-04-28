'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  isCliInvocation,
  main,
  resolveReportArtifactPath,
} = require('../scripts/autonomous-sales-agent');

test('automation emits LinkedIn, Aiventyx, ChatGPT, and Codex alongside Claude, Cursor, and Gemini packs', async () => {
  const calls = [];
  const logs = [];
  const reportDir = path.resolve('reports/gtm/test');
  const outreachDocsPath = path.resolve('docs/OUTREACH_TARGETS.md');
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
      buildOutreachTargetsReport(options) {
        calls.push(['buildOutreachTargetsReport', options || null]);
        return { warmTargets: [{ id: 'warm-1' }], coldTargets: [{ id: 'cold-1' }], followUpTargets: [] };
      },
      renderOutreachTargetsMarkdown(report) {
        calls.push(['renderOutreachTargetsMarkdown', report.warmTargets.length, report.coldTargets.length]);
        return '# Outreach Targets';
      },
      writeOutreachTargetsDoc(markdown, outPath) {
        calls.push(['writeOutreachTargetsDoc', markdown, outPath]);
        return outPath;
      },
    });
  } finally {
    console.log = originalLog;
  }

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
    ['buildCodexMarketplaceRevenuePack'],
    ['writeCodexMarketplaceRevenuePack', 'codex', true],
    ['buildCodexPluginRevenuePack', 2],
    ['writeCodexPluginRevenuePack', 'codex-plugin', true],
    ['buildOutreachTargetsReport', { reportPath: path.join(reportDir, 'gtm-revenue-loop.json'), queuePath: path.join(reportDir, 'gtm-target-queue.jsonl') }],
    ['renderOutreachTargetsMarkdown', 1, 1],
    ['writeOutreachTargetsDoc', '# Outreach Targets', path.join(reportDir, 'OUTREACH_TARGETS.md')],
    ['buildOutreachTargetsReport', null],
    ['renderOutreachTargetsMarkdown', 1, 1],
    ['writeOutreachTargetsDoc', '# Outreach Targets', outreachDocsPath],
  ]);
  assert.ok(logs.some((line) => line.includes('Aiventyx pack updated: /tmp/aiventyx.md')));
  assert.ok(logs.some((line) => line.includes('LinkedIn pack updated: /tmp/linkedin.md')));
  assert.ok(logs.some((line) => line.includes('ChatGPT pack updated: /tmp/chatgpt.md')));
  assert.ok(logs.some((line) => line.includes('Codex marketplace pack updated: /tmp/codex-marketplace.md')));
  assert.ok(logs.some((line) => line.includes('Codex plugin pack updated: /tmp/codex-plugin.md')));
  assert.ok(logs.some((line) => line.includes(`Outreach targets updated: ${outreachDocsPath}`)));
  assert.ok(logs.some((line) => line.includes('State: cold-start | Targets: 2')));
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = require.resolve('../scripts/autonomous-sales-agent');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', __filename]), false);
});

test('report artifact paths resolve under the requested report directory', () => {
  const reportDir = path.resolve('reports/gtm/test');
  assert.equal(
    resolveReportArtifactPath({ reportDir: 'reports/gtm/test' }, 'OUTREACH_TARGETS.md'),
    path.join(reportDir, 'OUTREACH_TARGETS.md')
  );
  assert.equal(resolveReportArtifactPath({}, 'OUTREACH_TARGETS.md'), '');
});
