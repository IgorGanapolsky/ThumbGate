'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fw = require('../src/cloud-token-firewall');
const { internalizeEmailIdea } = require('../scripts/thumbgate-email-steal-engine');
const { startServer } = require('../src/api/server');

test('Oct 28 & Oct 29 self-sent strategy emails are internalized and enforced in cloud-token-firewall', () => {
  const bundle = fw.evaluateSixOct28EmailStealsBundle();
  assert.equal(bundle.ok, true);
  assert.equal(bundle.internalizedCount, 6);

  const jellyfishDirect = fw.evaluateJellyfishClaudeCodeBillSteal({ developerCount: 10 });
  assert.equal(jellyfishDirect.ok, true);
  assert.equal(bundle.steals.jellyfishClaudeCode252.benchmark.avgClaudeCodeMonthlyBillPerDevUsd, 252);

  assert.equal(fw.evaluateIbmAgentIdentityAndControlSteal({ sessionPassportVerified: false }).ok, false);
  assert.equal(fw.evaluateGrokBotMemoryImportSteal({ containsRawSecrets: true }).ok, false);
  assert.equal(fw.evaluateGenie4WorldModelCounterfactualSteal({ reversibleState: false }).ok, false);
  assert.equal(fw.evaluateFiveFactorEvalDataCurationSteal({ sourcedFromRealWorldCursorBenchUsage: false }).ok, false);
  assert.equal(fw.evaluateSupabaseAgentDatabaseSteal({ isProductionBranchDdl: true, ephemeralBranchCreated: false }).ok, false);

  const glmOk = fw.evaluateGlm53WorkersAiSglangKvCacheIsolationSteal();
  assert.equal(glmOk.ok, true);
  assert.equal(glmOk.sourceEmailUid, '311029');
  assert.equal(fw.evaluateGlm53WorkersAiSglangKvCacheIsolationSteal({ crossRequestKvReuseWithoutSalt: true }).ok, false);

  assert.equal(fw.evaluateHermesGuideLinksAndProKeySteal().ok, true);
  assert.equal(fw.evaluateHermesGuideLinksAndProKeySteal({ boundedMemoryChars: 3000 }).ok, false);

  const batchOk = fw.evaluateOct28InboxSelfStrategyBatchSteal();
  assert.equal(batchOk.ok, true);
  assert.equal(batchOk.sourceEmailUids.length, 13);
  assert.equal(fw.evaluateOct28InboxSelfStrategyBatchSteal({ webMcpBrowserToolSchemaIntrospected: false }).ok, false);
});

test('thumbgate-email-steal-engine enforces on-disk code + test verification before authorizing archive/delete', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-email-steal-wt-'));
  try {
    const res = internalizeEmailIdea({
      messageId: '<test-jellyfish-252@mail.gmail.com>',
      uid: '148673',
      subject: 'Thumbgate marketing -- Jellyfish: Claude Code bills hit $252 a month per developer as software factories automate code production among early adopters',
      body: 'Jellyfish: Claude Code bills hit $252 a month per developer https://share.google/pTnoFF9WxKADyqcMl',
      vaultArchiveDir: path.join(tmpDir, 'vault'),
      stolenLedgerPath: path.join(tmpDir, 'stolen.jsonl'),
      internalizedLedgerPath: path.join(tmpDir, 'internalized.jsonl'),
    });
    assert.equal(res.ok, true);
    assert.equal(res.readyToArchiveOrDelete, true);
    assert.equal(res.codeVerified, true);
    assert.equal(res.stealFn, 'evaluateJellyfishClaudeCodeBillSteal');
    assert.ok(fs.existsSync(path.join(tmpDir, 'internalized.jsonl')));

    const unimplementedLedger = path.join(tmpDir, 'unimplemented-internalized.jsonl');
    const held = internalizeEmailIdea({
      messageId: '<test-unimplemented-future-idea@mail.gmail.com>',
      uid: '999999',
      subject: 'Thumbgate --- Brand New Unimplemented Quantum Agent Router Paper',
      body: 'https://example.com/quantum-agent-router',
      vaultArchiveDir: path.join(tmpDir, 'vault'),
      stolenLedgerPath: path.join(tmpDir, 'stolen.jsonl'),
      internalizedLedgerPath: unimplementedLedger,
    });
    assert.equal(held.ok, false);
    assert.equal(held.readyToArchiveOrDelete, false);
    assert.equal(held.codeVerified, false);
    assert.equal(fs.existsSync(unimplementedLedger), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('/cancel, /checkout/cancel, and /checkout/pro expose $9.99 Playbook, $49 Bundle one-time downsells, and 1-click /go/pro-direct', async () => {
  const prevKey = process.env.THUMBGATE_API_KEY;
  process.env.THUMBGATE_API_KEY = 'tg_test_verify_downsells';
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  try {
    const base = `http://127.0.0.1:${handle.port}`;
    for (const routePath of ['/cancel', '/checkout/cancel', '/checkout/pro']) {
      const res = await fetch(`${base}${routePath}`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('/go/playbook-999'), `${routePath} should include $9.99 playbook downsell`);
      assert.ok(html.includes('/go/bundle-49'), `${routePath} should include $49 bundle downsell`);
      assert.ok(html.includes('/go/pro-direct'), `${routePath} should include 1-click /go/pro-direct`);
    }
  } finally {
    if (prevKey === undefined) delete process.env.THUMBGATE_API_KEY;
    else process.env.THUMBGATE_API_KEY = prevKey;
    handle.server.close();
    handle.server.closeAllConnections?.();
  }
});
