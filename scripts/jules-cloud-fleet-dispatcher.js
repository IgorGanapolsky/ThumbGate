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
 */

const { execFileSync } = require('node:child_process');

const JULES_API_ORIGIN = 'https://jules.googleapis.com';
const JULES_API_BASE = `${JULES_API_ORIGIN}/v1alpha`;
const THUMBGATE_SOURCE = 'sources/github/IgorGanapolsky/ThumbGate';
const MACOS_SECURITY_BIN = '/usr/bin/security';

function resolveJulesApiKey(env = process.env) {
  if (env.JULES_API_KEY && String(env.JULES_API_KEY).trim()) {
    return String(env.JULES_API_KEY).trim();
  }
  try {
    return execFileSync(MACOS_SECURITY_BIN, ['find-generic-password', '-s', 'JULES_API_KEY', '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return '';
  }
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

if (require.main === module) {
  (async () => {
    const apiKey = resolveJulesApiKey();
    const list = await julesRequest('/sessions?pageSize=15', { apiKey });
    const sessions = list.sessions || [];
    console.log(JSON.stringify({
      activeKey: Boolean(apiKey),
      totalListed: sessions.length,
      byState: sessions.reduce((acc, s) => {
        acc[s.state] = (acc[s.state] || 0) + 1;
        return acc;
      }, {}),
      thumbGateSessions: sessions.filter((s) => s.sourceContext?.source === THUMBGATE_SOURCE).map((s) => ({
        name: s.name,
        title: s.title,
        state: s.state,
        url: s.url,
      })),
    }, null, 2));
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
};
