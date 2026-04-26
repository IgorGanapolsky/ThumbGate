'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isCliInvocation, main } = require('../scripts/autonomous-sales-agent');

test('automation emits ChatGPT and Codex alongside Claude, Cursor, and Gemini packs', async () => {
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
      buildGeminiCliDemandPack(report) {
        calls.push(['buildGeminiCliDemandPack', report.targets.length]);
        return { channel: 'gemini' };
      },
      writeGeminiCliDemandPack(pack, options) {
        calls.push(['writeGeminiCliDemandPack', pack.channel, options.writeDocs]);
        return { docsPath: '/tmp/gemini.md' };
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
    ['buildGeminiCliDemandPack', 2],
    ['writeGeminiCliDemandPack', 'gemini', true],
    ['buildChatgptGptRevenuePack', 2],
    ['writeChatgptGptRevenuePack', 'chatgpt', true],
    ['buildCodexMarketplaceRevenuePack'],
    ['writeCodexMarketplaceRevenuePack', 'codex', true],
    ['buildCodexPluginRevenuePack', 2],
    ['writeCodexPluginRevenuePack', 'codex-plugin', true],
  ]);
  assert.ok(logs.some((line) => line.includes('ChatGPT pack updated: /tmp/chatgpt.md')));
  assert.ok(logs.some((line) => line.includes('Codex marketplace pack updated: /tmp/codex-marketplace.md')));
  assert.ok(logs.some((line) => line.includes('Codex plugin pack updated: /tmp/codex-plugin.md')));
  assert.ok(logs.some((line) => line.includes('State: cold-start | Targets: 2')));
});

test('CLI entrypoint detection is path based', () => {
  const scriptPath = require.resolve('../scripts/autonomous-sales-agent');

  assert.equal(isCliInvocation(['node', scriptPath]), true);
  assert.equal(isCliInvocation(['node', __filename]), false);
});
