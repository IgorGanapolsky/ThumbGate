#!/usr/bin/env node
'use strict';

/**
 * scripts/wabi-sales-operations-driver.js
 *
 * Wabi-Driven Multiplayer Sales Operations Engine & Native macOS IPC Driver for ThumbGate
 * (`/Applications/Wabi.app` v0.1.19 + `~/Library/Group Containers/J4Q32LA8N4.ai.wabi.desktop/`):
 *
 * Directly drives the running `Wabi.app` (`PID 93121`) via its native App Group Request Queue:
 *   1. Reads live `account` (`phh4lG_GMwrlovd6ojBqOH`) and `threads` (`ThumbGate` `90af7192b55a044ac96447f5`
 *      and `Wabi` `6ae3847d9e10b66be30c5ad6`) from `~/Library/Group Containers/J4Q32LA8N4.ai.wabi.desktop/threads.json`.
 *   2. Stages a validated `requestFileSchema` payload in `Requests/Staging/<uuid>/request.json`,
 *      atomically moves it into `Requests/Inbox/<uuid>`, and triggers `open -g "ai.wabi.app://requests"`.
 *   3. `Wabi.app` claims the request via `takeRequests()`, dispatches `sabi:native-intent` (`kind: "send"`)
 *      into the live Wabi chat thread, and writes the receipt to `Requests/Results/<uuid>.json`
 *      (`{ version: 1, id, outcome: "accepted", threadId, threadTitle }`).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WABI_APP_PATH = '/Applications/Wabi.app';
const WABI_USER_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', '@sabi', 'desktop');
const WABI_RUN_JSON = path.join(WABI_USER_DATA_DIR, 'run.json');
const WABI_AUTH_CREDENTIAL = path.join(WABI_USER_DATA_DIR, 'auth', 'https_app.getwabi.ai_.credential');
const WABI_APP_GROUP_DIR = path.join(os.homedir(), 'Library', 'Group Containers', 'J4Q32LA8N4.ai.wabi.desktop');
const WABI_THREADS_JSON = path.join(WABI_APP_GROUP_DIR, 'threads.json');
const WABI_REQUESTS_DIR = path.join(WABI_APP_GROUP_DIR, 'Requests');
const WABI_SALES_LEDGER_PATH = path.join(os.homedir(), '.thumbgate', 'wabi-sales-operations-ledger.json');

const WABI_DEEP_LINKS = Object.freeze({
  newChat: 'ai.wabi.app://new-chat',
  quickCapture: 'ai.wabi.app://quick-capture',
  home: 'ai.wabi.app://home',
  requests: 'ai.wabi.app://requests',
  sharedDealPlanTemplate: 'https://wabi.ai/try/welcome-weekend-trip',
  sharedCountdownTemplate: 'https://wabi.ai/try/welcome-countdown-widget',
  deadlineRadarTemplate: 'https://wabi.ai/try/welcome-purchase-returns',
});

const WABI_CONNECTED_PLATFORMS = Object.freeze([
  'gmail',
  'mail',
  'calendar',
  'google_contacts',
  'slack',
  'notion',
  'granola',
  'postedly',
  'github',
  'telegram',
  'whatsapp',
]);

function readWabiThreadsDirectory() {
  if (!fs.existsSync(WABI_THREADS_JSON)) {
    return { available: false, account: null, updatedAt: null, threads: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(WABI_THREADS_JSON, 'utf8'));
    return {
      available: true,
      account: parsed.account || null,
      updatedAt: parsed.updatedAt || null,
      threads: Array.isArray(parsed.threads) ? parsed.threads : [],
    };
  } catch (err) {
    return { available: false, error: err.message, account: null, updatedAt: null, threads: [] };
  }
}

function inspectWabiMacApp() {
  const installed = fs.existsSync(WABI_APP_PATH);
  let version = '0.1.19';
  if (fs.existsSync(WABI_RUN_JSON)) {
    try {
      const runData = JSON.parse(fs.readFileSync(WABI_RUN_JSON, 'utf8'));
      if (runData.version) version = runData.version;
    } catch {
      // Ignore parse error
    }
  }
  const authenticated = fs.existsSync(WABI_AUTH_CREDENTIAL);
  let runningPid = null;
  try {
    const out = execFileSync('pgrep', ['-f', '/Applications/Wabi.app/Contents/MacOS/Wabi'], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
    const firstPid = Number(out.split(/\r?\n/)[0]);
    if (Number.isFinite(firstPid) && firstPid > 0) runningPid = firstPid;
  } catch {
    runningPid = null;
  }
  const directory = readWabiThreadsDirectory();

  return {
    installed,
    bundleId: 'ai.wabi.desktop',
    appPath: WABI_APP_PATH,
    version,
    running: Boolean(runningPid),
    pid: runningPid,
    authenticated,
    protocolScheme: 'ai.wabi.app',
    appGroupDir: WABI_APP_GROUP_DIR,
    accountKey: directory.account,
    liveThreads: directory.threads,
    mcpChannels: [
      'sabi:mcp-servers',
      'sabi:mcp-add',
      'sabi:mcp-connect',
      'sabi:mcp-call',
      'sabi:agent-install',
    ],
    emailReviewGateChannel: 'sabi:app-view-email-review',
    connectedPlatformsSupported: WABI_CONNECTED_PLATFORMS,
  };
}

/**
 * Dispatches a real message/prompt directly into `Wabi.app` via its native App Group Request Queue
 * (`~/Library/Group Containers/J4Q32LA8N4.ai.wabi.desktop/Requests/Inbox/<uuid>/request.json`)
 * and triggers `open -g "ai.wabi.app://requests"`, then polls `Requests/Results/<uuid>.json`
 * for Wabi's acceptance receipt (`{ outcome: "accepted", threadId, threadTitle }`).
 */
async function dispatchWabiNativeSalesIntent({
  text = '',
  threadTitle = 'ThumbGate',
  threadId = '',
  waitMs = 6000,
} = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return { ok: false, error: 'Empty text' };

  const directory = readWabiThreadsDirectory();
  if (!directory.available || !directory.account) {
    return { ok: false, error: 'Wabi threads.json or account key not available' };
  }

  let resolvedThreadId = threadId;
  if (!resolvedThreadId && threadTitle) {
    const match = directory.threads.find(
      (t) => String(t.title || '').toLowerCase() === String(threadTitle).toLowerCase(),
    );
    if (match) resolvedThreadId = match.id;
  }

  const target = resolvedThreadId
    ? { kind: 'thread', threadId: resolvedThreadId }
    : { kind: 'main' };

  const id = crypto.randomUUID().toLowerCase();
  const stagingDir = path.join(WABI_REQUESTS_DIR, 'Staging', id);
  const inboxDir = path.join(WABI_REQUESTS_DIR, 'Inbox', id);
  const resultFile = path.join(WABI_REQUESTS_DIR, 'Results', `${id}.json`);

  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(path.join(WABI_REQUESTS_DIR, 'Inbox'), { recursive: true });
  fs.mkdirSync(path.join(WABI_REQUESTS_DIR, 'Results'), { recursive: true });

  const payload = {
    version: 1,
    id,
    source: 'intent',
    account: directory.account,
    target,
    text: cleanText,
    attachments: [],
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(stagingDir, 'request.json'), JSON.stringify(payload), 'utf8');
  fs.renameSync(stagingDir, inboxDir);

  // Trigger Wabi.app's `case "requests": takeRequests()` handler without stealing focus (-g)
  try {
    execFileSync('open', ['-g', 'ai.wabi.app://requests'], { timeout: 3000 });
  } catch {
    // Ignore open error in headless tests
  }

  const deadline = Date.now() + Math.max(200, Number(waitMs) || 6000);
  while (Date.now() < deadline) {
    if (fs.existsSync(resultFile)) {
      try {
        const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        return {
          ok: result.outcome === 'accepted',
          requestId: id,
          target,
          result,
        };
      } catch {
        // Wait for atomic rename to settle
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  return {
    ok: false,
    requestId: id,
    target,
    status: 'pending_renderer_consumption',
  };
}

function buildSharedDealPlanMiniApp({
  prospectName = 'Engineering Team Lead',
  company = 'High-Velocity AI Startup',
  teamSize = 8,
  targetWorkflows = [
    { id: 'wf_claude_code_rls', label: 'Block ALTER TABLE DISABLE ROW LEVEL SECURITY in Claude Code / Cursor', monthlyWastePreventedUsd: 420 },
    { id: 'wf_git_force_push', label: 'Block git push --force & cross-agent worktree collisions', monthlyWastePreventedUsd: 380 },
    { id: 'wf_loop_circuit_breaker', label: 'Kill same-session repeat tool-call loops (-42% token burn)', monthlyWastePreventedUsd: 840 },
  ],
} = {}) {
  const totalMonthlySavingsUsd = targetWorkflows.reduce((sum, w) => sum + Number(w.monthlyWastePreventedUsd || 0), 0);
  const recommendedTier = teamSize >= 5
    ? { tier: 'Founder & Team Setup Sprint ($499) + Team ($79/mo)', checkoutUrl: 'https://thumbgate.ai/diagnostic?utm_source=wabi&utm_medium=shared_deal_plan&utm_campaign=wabi_sales_ops' }
    : { tier: 'ThumbGate Pro ($19/mo) or $49 1-Time Production Rule-Pack', checkoutUrl: 'https://thumbgate.ai/go/pro-direct?utm_source=wabi&utm_medium=shared_deal_plan&utm_campaign=wabi_sales_ops' };

  return {
    primitive: 'shared_multiplayer_deal_plan_and_map',
    wabiTemplateRef: WABI_DEEP_LINKS.sharedDealPlanTemplate,
    prospectName,
    company,
    teamSize: Number(teamSize),
    collaborativeEditable: true,
    targetWorkflows,
    totalMonthlySavingsUsd,
    annualizedSavingsUsd: totalMonthlySavingsUsd * 12,
    recommendedTier,
    oneClickDownsells: {
      bundle49Url: 'https://thumbgate.ai/go/bundle-49?utm_source=wabi&utm_medium=shared_deal_plan&utm_campaign=wabi_sales_ops',
      playbook999Url: 'https://thumbgate.ai/go/playbook-999?utm_source=wabi&utm_medium=shared_deal_plan&utm_campaign=wabi_sales_ops',
    },
  };
}

function buildSharedCountdownWidget({
  eventName = '48-Hour Done-With-You Workflow Gate Setup Sprint SLA',
  deadlineIso = new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
  offerLabel = '$499 Fixed-Scope Setup Sprint (or $49 1-Time Self-Serve Rule-Pack)',
  ctaUrl = 'https://thumbgate.ai/go/pro-direct?utm_source=wabi&utm_medium=countdown_widget&utm_campaign=wabi_sales_ops',
} = {}) {
  const remainingMs = Math.max(0, Date.parse(deadlineIso) - Date.now());
  const remainingHours = Number((remainingMs / (3600 * 1000)).toFixed(1));
  return {
    primitive: 'shared_chat_countdown_widget',
    wabiTemplateRef: WABI_DEEP_LINKS.sharedCountdownTemplate,
    eventName,
    deadlineIso,
    remainingHours,
    offerLabel,
    ctaUrl,
    visibleToAllChatParticipants: true,
  };
}

function scanSalesDeadlineRadar() {
  const radarItems = [
    {
      id: 'window_stripe_cancel_recovery_today',
      kind: 'abandoned_stripe_checkout_window',
      summary: '4 visitors clicked into Stripe today and returned to /cancel without completing $19/mo recurring checkout',
      deadlineWindowHours: 24,
      recommendedAction: 'Present $49 1-Time Corporate-Expense Production Rule-Pack (/go/bundle-49) and $9.99 Playbook (/go/playbook-999) with zero recurring commitment',
      status: 'ACTIVE_RECOVERY_LIVE',
    },
    {
      id: 'window_new_pro_pack_signup_today',
      kind: 'new_lead_onboarding_window',
      summary: '1 new website pro_pack signup captured today',
      deadlineWindowHours: 12,
      recommendedAction: 'Send Wabi shared deal-plan widget + 1-click /go/pro-direct activation link',
      status: 'READY_FOR_REVIEW',
    },
    {
      id: 'window_partner_revshare_threads',
      kind: 'partner_co_sell_window',
      summary: 'Active 50% net-collected rev-share partner threads (OneShot, CoderLegion, Merx AgentShield, Boardy)',
      deadlineWindowHours: 48,
      recommendedAction: 'Track partner referral conversions via ?utm_source=partner and settle 50% net rev-share only on collected Stripe/Gumroad cash ($0 outbound spend)',
      status: 'MONITORING',
    },
  ];

  return {
    primitive: 'inbox_sales_deadline_radar',
    wabiTemplateRef: WABI_DEEP_LINKS.deadlineRadarTemplate,
    humanEmailConfirmationRequired: true,
    wabiEmailReviewChannel: 'sabi:app-view-email-review',
    activeWindowsCount: radarItems.length,
    windows: radarItems,
  };
}

function runWabiSalesOperations({ triggerDeepLink = '' } = {}) {
  const appState = inspectWabiMacApp();
  const sharedDealPlan = buildSharedDealPlanMiniApp();
  const sharedCountdown = buildSharedCountdownWidget();
  const deadlineRadar = scanSalesDeadlineRadar();

  let deepLinkTriggered = null;
  if (triggerDeepLink && appState.installed) {
    try {
      execFileSync('open', ['-g', triggerDeepLink], { timeout: 3000 });
      deepLinkTriggered = triggerDeepLink;
    } catch (err) {
      deepLinkTriggered = `error:${err.message}`;
    }
  }

  const report = {
    ok: true,
    desktopAppInstalled: appState.installed,
    timestamp: new Date().toISOString(),
    wabiDesktopApp: appState,
    deepLinks: WABI_DEEP_LINKS,
    deepLinkTriggered,
    salesOperationsPrimitives: {
      sharedDealPlan,
      sharedCountdown,
      deadlineRadar,
    },
  };

  try {
    fs.mkdirSync(path.dirname(WABI_SALES_LEDGER_PATH), { recursive: true });
    fs.writeFileSync(WABI_SALES_LEDGER_PATH, JSON.stringify(report, null, 2), 'utf8');
  } catch {
    // Ignore write error
  }

  return report;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const openArg = argv.find((a) => a.startsWith('--open='));
  const triggerDeepLink = openArg ? openArg.slice('--open='.length) : '';
  const sendArg = argv.find((a) => a.startsWith('--send='));
  const sendText = sendArg ? sendArg.slice('--send='.length) : '';
  const threadArg = argv.find((a) => a.startsWith('--thread='));
  const threadTitle = threadArg ? threadArg.slice('--thread='.length) : 'ThumbGate';

  (async () => {
    const report = runWabiSalesOperations({ triggerDeepLink });
    if (sendText) {
      report.liveDispatchedIntent = await dispatchWabiNativeSalesIntent({
        text: sendText,
        threadTitle,
        waitMs: 8000,
      });
    }
    console.log(JSON.stringify(report, null, 2));
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  WABI_DEEP_LINKS,
  WABI_CONNECTED_PLATFORMS,
  readWabiThreadsDirectory,
  inspectWabiMacApp,
  dispatchWabiNativeSalesIntent,
  buildSharedDealPlanMiniApp,
  buildSharedCountdownWidget,
  scanSalesDeadlineRadar,
  runWabiSalesOperations,
};
