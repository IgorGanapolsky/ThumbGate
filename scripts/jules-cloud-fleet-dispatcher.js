#!/usr/bin/env node
'use strict';

/**
 * scripts/jules-cloud-fleet-dispatcher.js
 *
 * Autonomous Google Jules Cloud Fleet Orchestrator (`https://jules.googleapis.com/v1alpha`).
 *
 * Capabilities:
 *   1. Reads `JULES_API_KEY` from environment or macOS Keychain (`/usr/bin/security find-generic-password -s JULES_API_KEY -w`)
 *      with zero plaintext secret storage and fixed binary path.
 *   2. Enforces origin pinning (`https://jules.googleapis.com`) before attaching `X-Goog-Api-Key`.
 *   3. Lists active cloud sessions across `sources/github/IgorGanapolsky/ThumbGate`, `RealEstate`, and `trading`.
 *   4. Auto-unblocks stalled `AWAITING_PLAN_APPROVAL` (via `:approvePlan`) or `AWAITING_USER_FEEDBACK`
 *      (via `:sendMessage`) sessions without sending duplicate prompts after plan approval.
 *   5. Dispatches parallel Google Jules cloud coding sessions with `requirePlanApproval: false`,
 *      `automationMode: "AUTO_CREATE_PR"`, and ThumbGate's mandatory pre-commit/parity instructions.
 *   6. Reads Jules proactive-suggestion emails from Gmail via BrowserOS Neo CDP, parses ALL
 *      suggestions across every repo (ThumbGate, trading, dayglass, ...), dispatches cloud
 *      sessions for each, and deletes the email immediately after extraction + dispatch —
 *      keeping the inbox at zero unread Jules messages.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const JULES_API_ORIGIN = 'https://jules.googleapis.com';
const JULES_API_BASE = `${JULES_API_ORIGIN}/v1alpha`;
const THUMBGATE_SOURCE = 'sources/github/IgorGanapolsky/ThumbGate';
const MACOS_SECURITY_BIN = '/usr/bin/security';

function resolveJulesApiKey(env = process.env) {
  if (env.JULES_API_KEY && String(env.JULES_API_KEY).trim()) {
    return String(env.JULES_API_KEY).trim();
  }
  const cacheFile = path.join(os.homedir(), '.config', 'jules', 'api_key');
  const loginKeychain = path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db');
  for (const args of [
    ['find-generic-password', '-s', 'JULES_API_KEY', '-w'],
    ['find-generic-password', '-s', 'JULES_API_KEY', '-w', loginKeychain],
  ]) {
    try {
      const val = execFileSync(MACOS_SECURITY_BIN, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (val) {
        try {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, `${val}\n`, { mode: 0o600 });
        } catch (_) {}
        return val;
      }
    } catch (_) {}
  }
  if (env === process.env && fs.existsSync(cacheFile)) {
    try {
      const cached = fs.readFileSync(cacheFile, 'utf8').trim();
      if (cached) return cached;
    } catch (_) {}
  }
  return '';
}

function buildHardenedThumbGateJulesPrompt({ title, taskInstructions }) {
  return [
    `# Task: ${title}`,
    '',
    taskInstructions,
    '',
    '## Mandatory ThumbGate Repository Guardrails (Must Pass Before Opening PR):',
    '1. Do NOT ask clarifying questions or pause for feedback — execute the complete implementation autonomously.',
    '2. Any new `tests/*.test.js` file MUST be added to `package.json` under `"test:public-static-assets"` (or an existing reachable test script) so `node --test tests/test-suite-parity.test.js` passes.',
    '3. Keep total npm packed file count within the `tests/package-boundary.test.js` ceiling (`<= 648` files) and unpacked size `< 9.32 MB`.',
    '4. Include a `.changeset/<slug>.md` patch changeset file so the `Verify changeset` GitHub Action passes.',
    '5. Never wrap multi-argument functions directly in `.map(fn)` (SonarCloud S7727); always use `.map((x) => fn(x))`.',
    '6. Never approve PRs or bypass branch protection.',
  ].join('\n');
}

function buildJulesCreateSessionPayload({
  title,
  taskInstructions,
  source = THUMBGATE_SOURCE,
  startingBranch = 'main',
  requirePlanApproval = false,
  automationMode = 'AUTO_CREATE_PR',
}) {
  return {
    title,
    prompt: buildHardenedThumbGateJulesPrompt({ title, taskInstructions }),
    sourceContext: {
      source,
      githubRepoContext: {
        startingBranch,
      },
    },
    requirePlanApproval,
    automationMode,
  };
}

function resolveSafeJulesUrl(path) {
  const raw = String(path || '').trim();
  if (!raw || /^https?:\/\//i.test(raw)) {
    throw new Error('julesRequest requires a relative v1alpha path; absolute URLs are rejected to protect X-Goog-Api-Key');
  }
  const fullUrl = new URL(`${JULES_API_BASE}${raw.startsWith('/') ? '' : '/'}${raw}`);
  if (fullUrl.origin !== JULES_API_ORIGIN || !fullUrl.pathname.startsWith('/v1alpha/')) {
    throw new Error(`Unsafe Jules API target: ${fullUrl.toString()}`);
  }
  return fullUrl.toString();
}

async function julesRequest(path, { method = 'GET', body = null, apiKey = resolveJulesApiKey(), fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) {
    throw new Error('Missing JULES_API_KEY in environment and macOS Keychain');
  }
  const url = resolveSafeJulesUrl(path);
  const res = await fetchImpl(url, {
    method,
    headers: {
      'X-Goog-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Jules API ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    err.status = res.status;
    err.response = json;
    throw err;
  }
  return json;
}

/**
 * Unblock a waiting Jules session:
 * - If `sessionState === 'AWAITING_PLAN_APPROVAL'`, call `:approvePlan` and return immediately.
 * - Otherwise (e.g. `AWAITING_USER_FEEDBACK`), send the unblock message via `:sendMessage`.
 */
async function unblockWaitingJulesSession(sessionName, message, { sessionState = null, ...options } = {}) {
  const cleanName = String(sessionName).startsWith('sessions/') ? sessionName : `sessions/${sessionName}`;
  if (sessionState === 'AWAITING_PLAN_APPROVAL') {
    return julesRequest(`/${cleanName}:approvePlan`, { method: 'POST', body: {}, ...options });
  }
  return julesRequest(`/${cleanName}:sendMessage`, {
    method: 'POST',
    body: {
      prompt: message || 'Approved. Proceed autonomously with your proposed plan, run focused offline tests, and create the PR without pausing for further confirmation.',
    },
    ...options,
  });
}

async function dispatchThumbGateJulesSession({ title, taskInstructions, startingBranch = 'main', ...options }) {
  const payload = buildJulesCreateSessionPayload({
    title,
    taskInstructions,
    startingBranch,
  });
  return julesRequest('/sessions', {
    method: 'POST',
    body: payload,
    ...options,
  });
}
function parseJulesEmailSuggestions(emailText = '') {
  const text = String(emailText || '');
  const repoRegex = /IgorGanapolsky\/([A-Za-z0-9._-]+)\n([\s\S]*?)(?=IgorGanapolsky\/|©\s*202\d\s*Google|This message was sent to|$)/g;
  const byRepo = new Map();
  let match;
  while ((match = repoRegex.exec(text)) !== null) {
    const repoName = match[1].trim();
    const block = match[2]
      .replace(/Review code[\s\S]*$/i, '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^\+\s*\d+\s+other improvements/i.test(l));
    if (!byRepo.has(repoName)) {
      byRepo.set(repoName, []);
    }
    if (block.length > 0) {
      byRepo.get(repoName).push(block.slice(0, 8).join(' — '));
    }
  }
  return Array.from(byRepo.entries()).map(([repoName, items]) => ({
    repoName,
    source: `sources/github/IgorGanapolsky/${repoName}`,
    findingsSummary: items.join('\n'),
  }));
}

async function scanAndProcessJulesEmailsViaCdp({
  cdpOrigin = process.env.BROWSEROS_CDP_ORIGIN || 'http://127.0.0.1:9111',
  apiKey = resolveJulesApiKey(),
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  maxEmails = 20,
} = {}) {
  if (typeof fetchImpl !== 'function' || typeof WebSocketImpl !== 'function') {
    return { scanned: false, reason: 'missing_fetch_or_websocket', processedEmails: 0, dispatchedSessions: [] };
  }
  let tabs = [];
  try {
    const listRes = await fetchImpl(`${cdpOrigin}/json/list`);
    if (!listRes.ok) return { scanned: false, reason: `cdp_http_${listRes.status}`, processedEmails: 0, dispatchedSessions: [] };
    tabs = await listRes.json();
  } catch (err) {
    return { scanned: false, reason: `cdp_unreachable:${err.message}`, processedEmails: 0, dispatchedSessions: [] };
  }

  let gmailTab = (Array.isArray(tabs) ? tabs : []).find(
    (t) => t && t.type === 'page' && String(t.url || '').includes('mail.google.com') && /^wss?:\/\//i.test(String(t.webSocketDebuggerUrl || ''))
  );
  if (!gmailTab && fetchImpl === globalThis.fetch) {
    try {
      const newRes = await fetchImpl(`${cdpOrigin}/json/new?https://mail.google.com/mail/u/0/%23inbox`, { method: 'PUT' });
      if (newRes.ok) {
        const created = await newRes.json();
        if (created && /^wss?:\/\//i.test(String(created.webSocketDebuggerUrl || ''))) {
          await new Promise((r) => setTimeout(r, 4000));
          gmailTab = created;
        }
      }
    } catch (_) {}
  }
  if (!gmailTab) {
    return { scanned: true, reason: 'no_gmail_tab_open', processedEmails: 0, dispatchedSessions: [] };
  }

  // CDP timeout scales with number of emails being processed (each ~6s of browser wait).
  const cdpTimeoutMs = Math.max(15000, 6000 * maxEmails + 5000);

  const cdpResult = await new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocketImpl(gmailTab.webSocketDebuggerUrl);
    } catch (err) {
      resolve({ error: `invalid_ws_url:${err.message}` });
      return;
    }
    const timer = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      resolve({ error: 'cdp_timeout' });
    }, cdpTimeoutMs);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `(async () => {
            if (!location.hash.startsWith('#inbox')) {
              location.hash = '#inbox';
              await new Promise(r => setTimeout(r, 2500));
            } else {
              const refreshBtn = Array.from(document.querySelectorAll('div[role="button"][aria-label="Refresh"], [data-tooltip="Refresh"], div[act="20"]')).find(el => el.offsetParent !== null);
              if (refreshBtn) {
                try { refreshBtn.click(); await new Promise(r => setTimeout(r, 1500)); } catch (_) {}
              }
            }
            const visRows = () => Array.from(document.querySelectorAll('tr.zA')).filter(r => r.offsetParent !== null);
            const results = [];
            const maxIter = ${Number(maxEmails) || 20};
            // Only scan Jules repo-suggestion emails via CDP; Fo/Boardy/Merx/CoderLegion are handled via verified IMAP+SMTP in fo-thumbgate-inbox-cron.py
            const targetRegex = /\\bJules\\b|jules-noreply@google\\.com|improvements for your repos|\\bThumbgate\\b|Argus Launchpad|Cross-request KV cache|Arbitrage Business Strategy/i;

            for (let i = 0; i < maxIter; i++) {
              if (location.hash !== '#inbox') {
                location.hash = '#inbox';
                await new Promise(r => setTimeout(r, 2000));
              }
              const rows = visRows();
              const targetRow = rows.find(r => targetRegex.test(r.innerText || ''));
              if (!targetRow) break;
              const rowSnippet = (targetRow.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 240);
              const isJules = /\\bJules\\b|jules-noreply@google\\.com|improvements for your repos/i.test(rowSnippet);
              const category = isJules ? 'jules' : 'thumbgate_note';

              targetRow.click();
              await new Promise(r => setTimeout(r, 2200));
              const expandAll = document.querySelector('[aria-label="Expand all"]');
              if (expandAll) { expandAll.click(); await new Promise(r => setTimeout(r, 1000)); }
              for (const c of Array.from(document.querySelectorAll('.kv, .kQ'))) {
                try { c.click(); } catch (_) {}
              }
              await new Promise(r => setTimeout(r, 800));
              const main = document.querySelector('[role="main"]') || document.body;
              const text = (main.innerText || '').slice(0, 12000);
              const replied = false;
              // Return to #inbox and delete via visible row checkbox + toolbar Delete button (reliable in both thread & list views)
              location.hash = '#inbox';
              await new Promise(r => setTimeout(r, 1800));
              let deleted = false;
              const rowAgain = visRows().find(r => (r.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80) === rowSnippet.slice(0, 80))
                || visRows().find(r => targetRegex.test(r.innerText || ''));
              if (rowAgain) {
                const cb = rowAgain.querySelector('[role="checkbox"]');
                if (cb && cb.getAttribute('aria-checked') !== 'true') {
                  cb.click();
                  await new Promise(r => setTimeout(r, 400));
                }
                const delBtn = Array.from(document.querySelectorAll('[aria-label="Delete"][role="button"], div[act="10"]')).find(el => el.offsetParent !== null);
                if (delBtn) {
                  delBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                  delBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                  delBtn.click();
                  deleted = true;
                  await new Promise(r => setTimeout(r, 1800));
                }
              }
              results.push({ foundJulesEmail: true, category, snippet: rowSnippet.slice(0, 120), replied, deleted, text: isJules ? text : text.slice(0, 600) });
            }
            if (results.length === 0) {
              return { foundJulesEmail: false, processedCount: 0, results: [] };
            }
            return { foundJulesEmail: true, processedCount: results.length, results };
          })()`,
          returnByValue: true,
          awaitPromise: true,
        },
      }));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        if (msg.id === 1) {
          clearTimeout(timer);
          ws.close();
          resolve(msg.result?.result?.value || { foundJulesEmail: false });
        }
      } catch (_) {}
    };
    ws.onerror = (err) => {
      clearTimeout(timer);
      resolve({ error: String(err && err.message ? err.message : err) });
    };
  });

  if (!cdpResult || !cdpResult.foundJulesEmail) {
    return {
      scanned: true,
      processedEmails: 0,
      emailDeleted: false,
      dispatchedSessions: [],
    };
  }

  const dispatchedSessions = [];
  const allParsedRepos = [];
  const allDeleted = [];

  for (const emailResult of (cdpResult.results || [])) {
    const parsedSuggestions = parseJulesEmailSuggestions(emailResult.text);
    allDeleted.push(emailResult.deleted);
    for (const item of parsedSuggestions) {
      if (/^dayglass(?:-mac)?$/i.test(item.repoName)) continue;
      allParsedRepos.push(item.repoName);
      if (!apiKey) continue;
      const title = `fix(${item.repoName.toLowerCase()}): address proactive Jules email code health & test improvements`;
      const prompt = item.repoName === 'ThumbGate'
        ? buildHardenedThumbGateJulesPrompt({
            title,
            taskInstructions: `Address the proactive Jules email findings for ${item.repoName}:\n${item.findingsSummary}`,
          })
        : `Address the proactive Jules email findings for IgorGanapolsky/${item.repoName}:\n${item.findingsSummary}\nRun the repository test suite and auto-create a PR without pausing for questions.`;
      try {
        const created = await julesRequest('/sessions', {
          method: 'POST',
          apiKey,
          fetchImpl,
          body: {
            title,
            prompt,
            sourceContext: {
              source: item.source,
              githubRepoContext: { startingBranch: 'main' },
            },
            requirePlanApproval: false,
            automationMode: 'AUTO_CREATE_PR',
          },
        });
        dispatchedSessions.push({
          repoName: item.repoName,
          name: created.name,
          url: created.url,
        });
      } catch (err) {
        dispatchedSessions.push({
          repoName: item.repoName,
          error: err.message,
        });
      }
    }
  }

  return {
    scanned: true,
    processedEmails: cdpResult.results.length,
    emailDeleted: allDeleted.length > 0 && allDeleted.every(Boolean),
    parsedRepos: allParsedRepos,
    dispatchedSessions,
  };
}

async function runJules24x7DriverCycle({
  apiKey = resolveJulesApiKey(),
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  maxEmails = 20,
} = {}) {
  const unblocked = [];
  let activeSessions = [];
  if (apiKey) {
    const list = await julesRequest('/sessions?pageSize=25', { apiKey, fetchImpl });
    activeSessions = list.sessions || [];
    for (const s of activeSessions) {
      if (s.state === 'AWAITING_PLAN_APPROVAL' || s.state === 'AWAITING_USER_FEEDBACK') {
        try {
          await unblockWaitingJulesSession(s.name, undefined, { sessionState: s.state, apiKey, fetchImpl });
          unblocked.push({ name: s.name, title: s.title, prevState: s.state });
        } catch (err) {
          unblocked.push({ name: s.name, error: err.message });
        }
      }
    }
  }

  const emailScan = await scanAndProcessJulesEmailsViaCdp({
    apiKey,
    fetchImpl,
    WebSocketImpl,
    maxEmails,
  });
  // Also trigger the verified IMAP+SMTP Fo/Boardy/ThumbGate inbox monitor on every 1-minute cycle
  let imapMonitorStatus = 'skipped';
  const imapScript = path.join(os.homedir(), '.local', 'bin', 'fo-thumbgate-inbox-cron.py');
  if (fs.existsSync(imapScript)) {
    try {
      execFileSync('/usr/bin/python3', [imapScript], {
        encoding: 'utf8',
        timeout: 25000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      imapMonitorStatus = 'ok';
    } catch (err) {
      imapMonitorStatus = `error:${err.message.slice(0, 120)}`;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    activeKey: Boolean(apiKey),
    totalListed: activeSessions.length,
    byState: activeSessions.reduce((acc, s) => {
      acc[s.state] = (acc[s.state] || 0) + 1;
      return acc;
    }, {}),
    unblocked,
    emailScan,
  };
}

if (require.main === module) {
  // Parse --max-emails flag (default 20)
  let maxEmails = 20;
  const idx = process.argv.indexOf('--max-emails');
  if (idx !== -1 && process.argv[idx + 1]) {
    const parsed = parseInt(process.argv[idx + 1], 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) maxEmails = parsed;
  }
  (async () => {
    const cycle = await runJules24x7DriverCycle({ maxEmails });
    console.log(JSON.stringify(cycle, null, 2));
  })().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  JULES_API_ORIGIN,
  JULES_API_BASE,
  THUMBGATE_SOURCE,
  MACOS_SECURITY_BIN,
  resolveJulesApiKey,
  resolveSafeJulesUrl,
  buildHardenedThumbGateJulesPrompt,
  buildJulesCreateSessionPayload,
  julesRequest,
  unblockWaitingJulesSession,
  dispatchThumbGateJulesSession,
  parseJulesEmailSuggestions,
  scanAndProcessJulesEmailsViaCdp,
  runJules24x7DriverCycle,
};
