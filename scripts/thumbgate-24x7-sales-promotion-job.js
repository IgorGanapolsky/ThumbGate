#!/usr/bin/env node
'use strict';

/**
 * scripts/thumbgate-24x7-sales-promotion-job.js
 *
 * 24/7 Autonomous Sales, Partner Discovery, Boardy Directive & 7-Channel Promotion Job.
 *
 * Runs every 15 minutes (900s) via LaunchAgent `com.thumbgate.sales-promotion-24x7`
 * (ProcessType: Background, Nice: 10 per `mac-thrash-guard`) and orchestrates:
 *   1. Boardy & Founder Inbox Triage (`scripts/thumbgate-inbox-sentinel.js`)
 *   2. Proactive Global Partner Discovery & Pitch Generation (`scripts/proactive-partner-discovery-engine.js`)
 *   3. 7-Channel Omnichannel Promotion & Engagement (`omnichannel-ml-graphrag-monetizer.js`)
 *   4. Hard Governance Invariants (`AGENTS.md:542` & `COORDINATION.md`)
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  classifyThreads,
  fetchAppleMailGoogleMessages,
  writeLedgerSnapshot,
} = require('./thumbgate-inbox-sentinel');
const {
  runProactivePartnerDiscovery,
} = require('./proactive-partner-discovery-engine');

const REPO_ROOT = path.resolve(__dirname, '..');
const PARTNER_OFFERS_DIR = path.join(REPO_ROOT, 'marketing', 'partner-offers');
const STATUS_RECEIPT_PATH = path.join(REPO_ROOT, '.thumbgate', 'sales-promotion-24x7-status.json');
const BOARDY_DIRECTIVE_PATH = path.join(REPO_ROOT, 'marketing', 'boardy_partner_hunting_directive_2026-10-18.md');

function writePartnerOfferMarkdownFiles(offers = [], outDir = PARTNER_OFFERS_DIR) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const offer of offers) {
    if (!offer?.id || !offer?.draft) continue;
    const filePath = path.join(outDir, `${offer.id}.md`);
    const content = [
      `To: ${offer.draft.recipientLabel} (${offer.company} — ${offer.domain})`,
      'From: Igor Ganapolsky <igor@igorganapolsky.com>',
      `Subject: ${offer.draft.subject}`,
      `Status: ${offer.status}`,
      '',
      offer.draft.body,
      '',
    ].join('\n');
    fs.writeFileSync(filePath, content, 'utf8');
    written.push(filePath);
  }
  return written;
}

async function runSalesPromotion24x7Cycle({
  includeLiveMail = true,
  includeLiveShowHn = true,
  statusPath = STATUS_RECEIPT_PATH,
} = {}) {
  const startedAt = new Date().toISOString();

  // 1. Inbox Sentinel Sweep (Apple Mail Google account)
  let inboxReport = {
    checkedAt: startedAt,
    hardNoSendEnforced: true,
    eciIsolationEnforced: true,
    threadCount: 0,
    actionableCount: 0,
    threads: [],
  };
  if (includeLiveMail) {
    try {
      const fetched = fetchAppleMailGoogleMessages(25);
      if (fetched && fetched.error) {
        throw new Error(fetched.error);
      }
      inboxReport = classifyThreads(fetched.messages || []);
      writeLedgerSnapshot(inboxReport, path.join(REPO_ROOT, '.thumbgate'));
    } catch (err) {
      if (err && err.code === 'THUMBGATE_ECI_ISOLATION_BLOCK') {
        throw err;
      }
      inboxReport.error = err.message;
    }
  }

  // 2. Proactive Global Partner Discovery + Pitch File Generation
  const partnerReport = await runProactivePartnerDiscovery({ includeLiveShowHn });
  const writtenPitchFiles = writePartnerOfferMarkdownFiles(partnerReport.offers);

  // 3. 7-Channel Omnichannel Promotion Cycle
  let omnichannelSummary = null;
  const homeDaemon = path.join(os.homedir(), '.thumbgate', 'daemons', 'omnichannel-ml-graphrag-monetizer.cjs');
  const repoDaemon = path.join(REPO_ROOT, 'omnichannel-ml-graphrag-monetizer.js');
  const omniDaemonPath = fs.existsSync(homeDaemon) ? homeDaemon : repoDaemon;
  if (fs.existsSync(omniDaemonPath)) {
    try {
      const omni = require(omniDaemonPath);
      if (typeof omni.runLiveOmnichannelCycle === 'function') {
        const res = await omni.runLiveOmnichannelCycle();
        omnichannelSummary = {
          newlyRecordedCount: res.newlyRecordedCount,
          totalEntries: res.attestation?.totalEntries || 0,
          byChannel: res.attestation?.byChannel || {},
          totalExpectedPipelineUsd: res.attestation?.totalExpectedPipelineUsd || 0,
        };
      }
    } catch (err) {
      omnichannelSummary = { error: err.message };
    }
  }

  const receipt = {
    ok: true,
    startedAt,
    completedAt: new Date().toISOString(),
    hardNoSendEnforced: true,
    oneTouchEnforced: true,
    boardyDirectivePath: fs.existsSync(BOARDY_DIRECTIVE_PATH) ? BOARDY_DIRECTIVE_PATH : null,
    inbox: {
      threadCount: inboxReport.threadCount,
      actionableCount: inboxReport.actionableCount,
      repliedLockedCount: (inboxReport.threads || []).filter((t) => t.oneTouchLocked).length,
    },
    partnerOutreach: {
      totalTargets: partnerReport.totalTargets,
      curatedCount: partnerReport.curatedCount,
      liveDiscoveredShowHnCount: partnerReport.liveDiscoveredShowHnCount,
      stagedOffersCount: partnerReport.offers.filter((o) => !o.oneTouchLocked).length,
      writtenPitchFilesCount: writtenPitchFiles.length,
      offersDir: PARTNER_OFFERS_DIR,
    },
    omnichannel7Channels: omnichannelSummary,
  };

  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  return receipt;
}

if (require.main === module) {
  runSalesPromotion24x7Cycle()
    .then((receipt) => {
      console.log(JSON.stringify(receipt, null, 2));
    })
    .catch((err) => {
      console.error(JSON.stringify({ ok: false, error: err.message }));
      process.exitCode = 1;
    });
}

module.exports = {
  runSalesPromotion24x7Cycle,
  writePartnerOfferMarkdownFiles,
};
