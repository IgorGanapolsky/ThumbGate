'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeRevenuePackArtifacts } = require('../scripts/revenue-pack-utils');

test('writeRevenuePackArtifacts writes markdown sidecars alongside docs when writeDocs is enabled', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-revenue-pack-utils-'));
  const docsPath = path.join(repoRoot, 'docs', 'marketing', 'sample-pack.md');

  try {
    const written = writeRevenuePackArtifacts({
      repoRoot,
      writeDocs: true,
      docsPath,
      markdown: '# Sample Pack\n',
      jsonName: 'sample-pack.json',
      jsonValue: { state: 'ok' },
      csvArtifacts: [
        {
          name: 'sample-pack.csv',
          value: 'key,value\nstate,ok\n',
        },
      ],
    });

    assert.equal(written.docsPath, docsPath);
    assert.equal(fs.readFileSync(docsPath, 'utf8'), '# Sample Pack\n');
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs', 'marketing', 'sample-pack.json'), 'utf8')),
      { state: 'ok' },
    );
    assert.equal(
      fs.readFileSync(path.join(repoRoot, 'docs', 'marketing', 'sample-pack.csv'), 'utf8'),
      'key,value\nstate,ok\n',
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('writeRevenuePackArtifacts uses csvName fallback when csvArtifacts are omitted', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-revenue-pack-utils-'));
  const docsPath = path.join(repoRoot, 'docs', 'marketing', 'fallback-pack.md');

  try {
    writeRevenuePackArtifacts({
      repoRoot,
      writeDocs: true,
      docsPath,
      markdown: '# Fallback Pack\n',
      csvName: 'fallback-pack.csv',
      csvValue: 'key,value\nstate,fallback\n',
    });

    assert.equal(
      fs.readFileSync(path.join(repoRoot, 'docs', 'marketing', 'fallback-pack.csv'), 'utf8'),
      'key,value\nstate,fallback\n',
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});


test('revenue packs generate attributed software paths without retired managed-service offers', () => {
  const builders = [
    ['aiventyx-marketplace-plan', 'buildAiventyxMarketplacePlan'],
    ['chatgpt-gpt-revenue-pack', 'buildChatgptGptRevenuePack', {}],
    ['claude-workflow-hardening-pack', 'buildClaudeWorkflowHardeningPack', {}],
    ['codex-marketplace-revenue-pack', 'buildCodexMarketplaceRevenuePack'],
    ['codex-plugin-revenue-pack', 'buildCodexPluginRevenuePack', {}],
    ['gemini-cli-demand-pack', 'buildGeminiCliDemandPack', {}],
    ['linkedin-workflow-hardening-pack', 'buildLinkedinWorkflowHardeningPack', {}],
    ['mcp-directory-revenue-pack', 'buildMcpDirectoryRevenuePack'],
    ['reddit-dm-workflow-hardening-pack', 'buildRedditDmWorkflowHardeningPack', {}],
    ['roo-sunset-demand-pack', 'buildRooSunsetDemandPack', {}],
    ['chatgpt-ads-readiness-pack', 'buildChatgptAdsReadinessPack', {}],
  ];
  for (const [moduleName, builder, ...args] of builders) {
    const pack = require(`../scripts/${moduleName}`)[builder](...args);
    const output = JSON.stringify(pack);
    assert.doesNotMatch(output, /Setup Sprint|Intake-led sprint|\$499|workflow hardening sprint|self-serve Pro intake|#workflow-sprint-intake/i, moduleName);
    assert.match(output, /https:\/\/[^\s"/]+\/(?:pricing|checkout\/pro|go\/pro)/, moduleName);
    assert.match(output, /utm_source=/, moduleName);
    if (['reddit-dm-workflow-hardening-pack', 'linkedin-workflow-hardening-pack'].includes(moduleName)) {
      assert.doesNotMatch(output, /15-minute diagnostic|deeper diagnostic|one honest offer: harden|one offer: workflow hardening/i, moduleName);
      assert.match(output, /free local checks and self-serve Pro software plans/, moduleName);
      assert.match(output, /Operators configure and validate their own workflow boundaries/, moduleName);
    }
  }
});

test('GTM generation preserves historical intake and paid evidence while offering software', () => {
  const gtm = require('../scripts/gtm-revenue-loop');
  const catalog = gtm.buildMotionCatalog();
  assert.equal(new URL(catalog.sprint.cta).pathname, '/pricing');
  const target = { username: 'fixture', repoName: 'fixture', selectedMotion: { key: 'sprint' } };
  const draft = gtm.buildFallbackMessage(target, catalog.sprint, catalog);
  assert.doesNotMatch(draft, /harden.*for you|Setup Sprint|\$499/i);
  assert.match(draft, /configure and validate your own/);
  const commands = gtm.buildTargetSalesCommands(target);
  assert.match(commands.markSprintIntake, /sprint_intake/);
  assert.match(commands.markSprintIntake, /intake_submission/);
  assert.match(commands.markPaid, /sales:reconcile-payment/);
  assert.match(commands.markCheckoutStarted, /provider_checkout_session/);
});
