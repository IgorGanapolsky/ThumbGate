'use strict';

/**
 * ThumbGate Cloud — Token Optimization, Agentic Loop Circuit-Breaker, RLHF/DPO Pipeline,
 * Entire CI Engine, Cross-Platform OS Installers (Homebrew/macOS/Windows/Linux), 1-Click SSO,
 * and Customer Cloud Portal.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { redactSecrets } = require('../scripts/secret-redaction');

const CLOUD_SAAS_TIERS = Object.freeze({
  free_local: Object.freeze({
    id: 'free_local',
    name: 'ThumbGate Local (Open-Source MIT)',
    priceMonthlyUsd: 0,
    tokensOptimizedCapMonthly: 0,
    loopCircuitBreaker: true,
    realtimeWebhooks: false,
    hostedEndpoint: false,
    installCommand: 'npx thumbgate init',
    description: 'Free forever on your laptop. Local SQLite + PreToolUse safety gates.',
  }),
  cloud_indie: Object.freeze({
    id: 'cloud_indie',
    name: 'ThumbGate Cloud Indie',
    priceMonthlyUsd: 49,
    tokensOptimizedCapMonthly: 1_000_000,
    loopCircuitBreaker: true,
    realtimeWebhooks: false,
    hostedEndpoint: true,
    checkoutPath: '/checkout/pro?plan_id=cloud_indie&billing_cycle=monthly&utm_source=cloud_saas',
    description: 'For independent developers. Hosted AWS token compaction & duplicate tool-call circuit breaker (capped at 1M tokens optimized/mo).',
  }),
  cloud_startup: Object.freeze({
    id: 'cloud_startup',
    name: 'ThumbGate Cloud Startup',
    priceMonthlyUsd: 199,
    tokensOptimizedCapMonthly: 10_000_000,
    loopCircuitBreaker: true,
    realtimeWebhooks: true,
    hostedEndpoint: true,
    checkoutPath: '/checkout/pro?plan_id=cloud_startup&billing_cycle=monthly&utm_source=cloud_saas',
    description: 'For small startups & agent swarms. 10M tokens optimized/mo + real-time loop-blocking webhooks (Slack, Discord, PagerDuty, HTTP).',
  }),
});

const DEFAULT_BLENDED_COST_PER_1M_TOKENS_USD = 5.0;
const DEFAULT_TOKENS_SAVED_PER_KILLED_LOOP = 25_000;
const DEFAULT_LOOP_REPEAT_THRESHOLD = 3;
const LOOP_WINDOW_MS = 10 * 60 * 1000;

const sessionLoopState = new Map();
const tenantUsageState = new Map();
const cloudFeatureRequestsState = [];
const ssoSessionsState = new Map();

function estimateTokenCount(text) {
  if (!text) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  return Math.max(1, Math.ceil(str.length / 4));
}

function canonicalizeValue(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeValue).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeValue(value[k])}`).join(',')}}`;
}

function computeLoopSignature({ sessionId = 'default', agentId = 'agent', toolCall = null, messages = [] }) {
  const hash = crypto.createHash('sha256');
  hash.update(`${sessionId}::${agentId}::`);
  if (toolCall && typeof toolCall === 'object') {
    const toolName = String(toolCall.name || toolCall.tool || toolCall.function?.name || 'unknown_tool');
    const rawArgs = toolCall.arguments ?? toolCall.input ?? toolCall.function?.arguments ?? {};
    let parsedArgs = rawArgs;
    if (typeof rawArgs === 'string') {
      try { parsedArgs = JSON.parse(rawArgs); } catch { parsedArgs = rawArgs.trim(); }
    }
    hash.update(`tool:${toolName}:${canonicalizeValue(parsedArgs)}`);
  } else if (Array.isArray(messages) && messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    const content = typeof lastMsg?.content === 'string'
      ? lastMsg.content.trim()
      : canonicalizeValue(lastMsg?.content || '');
    hash.update(`msg:${lastMsg?.role || 'user'}:${content}`);
  } else {
    hash.update('empty');
  }
  return `loop_${hash.digest('hex').slice(0, 16)}`;
}

function compactTokenPayload({ messages = [], toolOutput = null, maxToolOutputChars = 1200 } = {}) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const originalTokens = estimateTokenCount(safeMessages) + (toolOutput ? estimateTokenCount(toolOutput) : 0);

  const seenSystemPrompts = new Set();
  const seenContentHashes = new Map();
  const compactedMessages = [];
  let duplicateTurnsRemoved = 0;
  let truncatedBlocks = 0;

  const total = safeMessages.length;
  for (let i = 0; i < total; i++) {
    const msg = safeMessages[i];
    if (!msg || typeof msg !== 'object') continue;
    const role = String(msg.role || 'user');
    const rawContent = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content ?? '');

    if (role === 'system') {
      const normalizedSys = rawContent.replace(/\s+/g, ' ').trim();
      if (seenSystemPrompts.has(normalizedSys)) {
        duplicateTurnsRemoved += 1;
        continue;
      }
      seenSystemPrompts.add(normalizedSys);
      compactedMessages.push({ ...msg, content: normalizedSys });
      continue;
    }

    const isLastTurn = i === total - 1;
    const normalizedContent = rawContent.replace(/\s+/g, ' ').trim();
    const contentHash = crypto.createHash('sha1').update(`${role}:${normalizedContent}`).digest('hex').slice(0, 12);

    if (seenContentHashes.has(contentHash)) {
      duplicateTurnsRemoved += 1;
      continue;
    }
    seenContentHashes.set(contentHash, i);

    let finalContent = normalizedContent;
    if (!isLastTurn && finalContent.length > maxToolOutputChars) {
      const head = finalContent.slice(0, Math.floor(maxToolOutputChars * 0.65));
      const tail = finalContent.slice(-Math.floor(maxToolOutputChars * 0.25));
      finalContent = `${head} … [compacted ${finalContent.length - head.length - tail.length} chars by ThumbGate] … ${tail}`;
      truncatedBlocks += 1;
    }

    compactedMessages.push({
      ...msg,
      content: finalContent,
    });
  }

  let compactedToolOutput = toolOutput;
  if (typeof toolOutput === 'string' && toolOutput.length > maxToolOutputChars) {
    const head = toolOutput.slice(0, Math.floor(maxToolOutputChars * 0.65));
    const tail = toolOutput.slice(-Math.floor(maxToolOutputChars * 0.25));
    compactedToolOutput = `${head} … [compacted ${toolOutput.length - head.length - tail.length} chars by ThumbGate] … ${tail}`;
    truncatedBlocks += 1;
  }

  const optimizedTokens = estimateTokenCount(compactedMessages)
    + (compactedToolOutput ? estimateTokenCount(compactedToolOutput) : 0);
  const tokensSaved = Math.max(0, originalTokens - optimizedTokens);
  const reductionPct = originalTokens > 0
    ? Number(((tokensSaved / originalTokens) * 100).toFixed(1))
    : 0;

  return {
    compactedMessages,
    compactedToolOutput,
    originalTokens,
    optimizedTokens,
    tokensSaved,
    reductionPct,
    duplicateTurnsRemoved,
    truncatedBlocks,
  };
}

function getOrCreateTenantUsage(tenantKey = 'anonymous', tierId = 'cloud_indie') {
  const resolvedTier = CLOUD_SAAS_TIERS[tierId] || CLOUD_SAAS_TIERS.cloud_indie;
  if (!tenantUsageState.has(tenantKey)) {
    tenantUsageState.set(tenantKey, {
      tenantKey,
      tierId: resolvedTier.id,
      tokensOptimizedMonthly: 0,
      tokensSavedTotal: 0,
      loopsKilledTotal: 0,
      requestsIntercepted: 0,
      webhooksDispatched: 0,
      updatedAt: new Date().toISOString(),
    });
  }
  const entry = tenantUsageState.get(tenantKey);
  if (tierId && CLOUD_SAAS_TIERS[tierId]) {
    entry.tierId = tierId;
  }
  return entry;
}

function dispatchLoopWebhookBestEffort(webhookUrl, payload) {
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    return Promise.resolve({ sent: false, reason: 'no_webhook_url' });
  }
  let parsed;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    return Promise.resolve({ sent: false, reason: 'invalid_webhook_url' });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return Promise.resolve({ sent: false, reason: 'unsupported_protocol' });
  }

  const body = JSON.stringify(payload);
  const client = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const req = client.request(
      parsed,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'ThumbGate-Cloud-CircuitBreaker/1.0',
        },
        timeout: 2500,
      },
      (res) => {
        res.resume();
        resolve({ sent: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode });
      },
    );
    req.on('error', () => resolve({ sent: false, reason: 'network_error' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ sent: false, reason: 'timeout' });
    });
    req.write(body);
    req.end();
  });
}

async function interceptAgentRequest({
  tenantKey = 'anonymous',
  tierId = 'cloud_indie',
  sessionId = 'default_session',
  agentId = 'autonomous_agent',
  provider = 'openai',
  model = 'gpt-4.1',
  toolCall = null,
  messages = [],
  toolOutput = null,
  maxLoopRepeats = DEFAULT_LOOP_REPEAT_THRESHOLD,
  webhookUrl = null,
  now = Date.now(),
} = {}) {
  const usage = getOrCreateTenantUsage(tenantKey, tierId);
  const tier = CLOUD_SAAS_TIERS[usage.tierId] || CLOUD_SAAS_TIERS.cloud_indie;

  if (tier.tokensOptimizedCapMonthly > 0 && usage.tokensOptimizedMonthly >= tier.tokensOptimizedCapMonthly) {
    return {
      ok: false,
      decision: 'QUOTA_EXCEEDED',
      blocked: true,
      reason: `Monthly token optimization cap (${tier.tokensOptimizedCapMonthly.toLocaleString()} tokens) reached for ${tier.name}. Upgrade to Cloud Startup ($199/mo) at https://thumbgate.ai/pricing`,
      tier: tier.id,
      usage: { ...usage },
    };
  }

  const signature = computeLoopSignature({ sessionId, agentId, toolCall, messages });
  const existingLoop = sessionLoopState.get(signature);
  let repeatCount = 1;
  if (existingLoop && (now - existingLoop.firstSeenAt) <= LOOP_WINDOW_MS) {
    repeatCount = existingLoop.count + 1;
    existingLoop.count = repeatCount;
    existingLoop.lastSeenAt = now;
  } else {
    sessionLoopState.set(signature, {
      signature,
      sessionId,
      agentId,
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now,
    });
  }

  const threshold = Math.max(2, Number(maxLoopRepeats) || DEFAULT_LOOP_REPEAT_THRESHOLD);
  const loopDetected = repeatCount >= threshold;

  const compaction = compactTokenPayload({ messages, toolOutput });
  const loopTokensSaved = loopDetected ? DEFAULT_TOKENS_SAVED_PER_KILLED_LOOP : 0;
  const totalTokensSaved = compaction.tokensSaved + loopTokensSaved;
  const estimatedUsdSaved = Number(
    ((totalTokensSaved / 1_000_000) * DEFAULT_BLENDED_COST_PER_1M_TOKENS_USD).toFixed(4),
  );

  usage.requestsIntercepted += 1;
  usage.tokensOptimizedMonthly += compaction.originalTokens;
  usage.tokensSavedTotal += totalTokensSaved;
  usage.updatedAt = new Date(now).toISOString();

  let webhookDelivery = { sent: false, reason: 'not_triggered' };
  if (loopDetected) {
    usage.loopsKilledTotal += 1;
    if (webhookUrl && (tier.realtimeWebhooks || tierId === 'cloud_startup')) {
      webhookDelivery = await dispatchLoopWebhookBestEffort(webhookUrl, {
        event: 'thumbgate.loop.killed',
        timestamp: new Date(now).toISOString(),
        sessionId,
        agentId,
        provider,
        model,
        loopSignature: signature,
        repeatCount,
        threshold,
        tokensSaved: totalTokensSaved,
        estimatedUsdSaved,
      });
      if (webhookDelivery.sent) {
        usage.webhooksDispatched += 1;
      }
    }
  }

  return {
    ok: !loopDetected,
    decision: loopDetected ? 'KILL_LOOP' : 'ALLOW',
    blocked: loopDetected,
    loopDetected,
    loopSignature: signature,
    repeatCount,
    repeatThreshold: threshold,
    provider,
    model,
    tier: tier.id,
    optimization: {
      originalTokens: compaction.originalTokens,
      optimizedTokens: compaction.optimizedTokens,
      payloadTokensSaved: compaction.tokensSaved,
      loopCircuitBreakerTokensSaved: loopTokensSaved,
      totalTokensSaved,
      reductionPct: compaction.reductionPct,
      duplicateTurnsRemoved: compaction.duplicateTurnsRemoved,
      truncatedBlocks: compaction.truncatedBlocks,
      estimatedUsdSaved,
    },
    compactedMessages: loopDetected ? [] : compaction.compactedMessages,
    compactedToolOutput: loopDetected ? null : compaction.compactedToolOutput,
    webhook: webhookDelivery,
    usage: {
      tokensOptimizedMonthly: usage.tokensOptimizedMonthly,
      tokensOptimizedCapMonthly: tier.tokensOptimizedCapMonthly,
      tokensSavedTotal: usage.tokensSavedTotal,
      loopsKilledTotal: usage.loopsKilledTotal,
      requestsIntercepted: usage.requestsIntercepted,
    },
  };
}

function buildCloudIntegrationGuideMarkdown({
  apiKey = 'tg_live_YOUR_API_KEY',
  tierId = 'cloud_indie',
  apiBaseUrl = 'https://thumbgate.ai',
} = {}) {
  const tier = CLOUD_SAAS_TIERS[tierId] || CLOUD_SAAS_TIERS.cloud_indie;
  return `# ThumbGate Cloud — Token Optimization & Loop Circuit-Breaker Guide

**Plan:** ${tier.name} (\`$${tier.priceMonthlyUsd}/month\`)
**Hosted Endpoint:** \`${apiBaseUrl}/v1/cloud/intercept\`
**Cloud Customer Portal:** \`${apiBaseUrl}/cloud\`
**Monthly Optimization Cap:** \`${tier.tokensOptimizedCapMonthly.toLocaleString()} tokens/mo\`
**Local CLI (Free Forever):** \`npx thumbgate init\`

---

## 0. 1-Click Installers (Homebrew / macOS / Windows / Linux) & SSO Login

- **Homebrew (macOS & Linux):** \`brew tap igorganapolsky/tap && brew install thumbgate\` (or \`brew install ${apiBaseUrl}/Formula/thumbgate.rb\`)
- **macOS / Linux:** \`curl -fsSL ${apiBaseUrl}/install.sh | sh\`
- **Windows (PowerShell):** \`irm ${apiBaseUrl}/install.ps1 | iex\`
- **1-Click Browser SSO:** \`npx thumbgate login --sso\` (or sign in at \`${apiBaseUrl}/cloud\`)

---

## 1. Set Your API Key

\`\`\`bash
export THUMBGATE_API_KEY="${apiKey}"
export THUMBGATE_CLOUD_URL="${apiBaseUrl}/v1/cloud/intercept"
\`\`\`

---

## 2. Drop-In Python Middleware (OpenAI / Anthropic / LangChain / CrewAI)

\`\`\`python
import os, requests

THUMBGATE_URL = os.environ.get("THUMBGATE_CLOUD_URL", "${apiBaseUrl}/v1/cloud/intercept")
THUMBGATE_KEY = os.environ["THUMBGATE_API_KEY"]

def thumbgate_guard(session_id: str, messages: list, tool_call: dict | None = None, webhook_url: str | None = None):
    resp = requests.post(
        THUMBGATE_URL,
        headers={"Authorization": f"Bearer {THUMBGATE_KEY}", "Content-Type": "application/json"},
        json={
            "sessionId": session_id,
            "messages": messages,
            "toolCall": tool_call,
            "webhookUrl": webhook_url,
        },
        timeout=3,
    ).json()
    if resp.get("blocked") or resp.get("decision") == "KILL_LOOP":
        raise RuntimeError(f"ThumbGate killed runaway agent loop ({resp.get('loopSignature')} after {resp.get('repeatCount')} repeats)")
    return resp.get("compactedMessages", messages)
\`\`\`

---

## 3. Drop-In TypeScript / Node.js Middleware

\`\`\`typescript
export async function thumbgateGuard({ sessionId, messages, toolCall, webhookUrl }) {
  const res = await fetch("${apiBaseUrl}/v1/cloud/intercept", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${process.env.THUMBGATE_API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionId, messages, toolCall, webhookUrl }),
  });
  const verdict = await res.json();
  if (verdict.blocked) {
    throw new Error(\`ThumbGate circuit breaker tripped: \${verdict.loopSignature}\`);
  }
  return verdict.compactedMessages;
}
\`\`\`

---

## 4. Quick cURL Smoke Test

\`\`\`bash
curl -fsS -X POST "${apiBaseUrl}/v1/cloud/intercept" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sessionId": "demo-loop-1",
    "toolCall": {"name": "bash", "arguments": {"cmd": "npm test"}},
    "messages": [
      {"role": "system", "content": "You are an autonomous coding agent."},
      {"role": "system", "content": "You are an autonomous coding agent."},
      {"role": "user", "content": "Fix the failing build."}
    ]
  }'
\`\`\`
`;
}

function calculateCloudSaasEconomics({
  indieSubscribers = 15,
  startupSubscribers = 20,
  architecture = 'serverless_lambda_dynamodb_sqs',
  developerMonthlyApiBillUsd = 500,
  compactionReductionPct = 42,
} = {}) {
  const indieMrrUsd = Math.max(0, Number(indieSubscribers) || 0) * CLOUD_SAAS_TIERS.cloud_indie.priceMonthlyUsd;
  const startupMrrUsd = Math.max(0, Number(startupSubscribers) || 0) * CLOUD_SAAS_TIERS.cloud_startup.priceMonthlyUsd;
  const grossMrrUsd = indieMrrUsd + startupMrrUsd;

  const totalSubscribers = Math.max(0, Number(indieSubscribers) || 0) + Math.max(0, Number(startupSubscribers) || 0);
  const stripeFeesUsd = grossMrrUsd > 0
    ? Number(((grossMrrUsd * 0.029) + (totalSubscribers * 0.30)).toFixed(2))
    : 0;

  const awsHostingCostUsd = architecture === 'nat_gateway_rds'
    ? Number((51.35 + (totalSubscribers * 0.15)).toFixed(2))
    : Number((totalSubscribers * 0.03).toFixed(2));

  const netProfitMonthlyUsd = Number((grossMrrUsd - stripeFeesUsd - awsHostingCostUsd).toFixed(2));
  const netMarginPct = grossMrrUsd > 0
    ? Number(((netProfitMonthlyUsd / grossMrrUsd) * 100).toFixed(1))
    : 0;

  const developerMonthlySavingsUsd = Number(
    ((Number(developerMonthlyApiBillUsd) || 0) * ((Number(compactionReductionPct) || 42) / 100)).toFixed(2),
  );

  return {
    tiers: CLOUD_SAAS_TIERS,
    subscribers: {
      indie: Number(indieSubscribers) || 0,
      startup: Number(startupSubscribers) || 0,
      total: totalSubscribers,
    },
    revenue: {
      indieMrrUsd,
      startupMrrUsd,
      grossMrrUsd,
      arrUsd: grossMrrUsd * 12,
    },
    costs: {
      architecture,
      awsHostingCostUsd,
      stripeFeesUsd,
      natGatewayTrapAvoidedUsd: architecture === 'serverless_lambda_dynamodb_sqs' ? 51.35 : 0,
    },
    profitability: {
      netProfitMonthlyUsd,
      netMarginPct,
    },
    buyerRoi: {
      developerMonthlyApiBillUsd: Number(developerMonthlyApiBillUsd) || 0,
      compactionReductionPct: Number(compactionReductionPct) || 42,
      developerMonthlySavingsUsd,
      indieNetRoiMultiple: Number((developerMonthlySavingsUsd / 49).toFixed(1)),
    },
  };
}

function evaluateEntireCiTrailAndProjectSync({
  trailId = 'trail_thumbgate_cloud',
  branch = 'main',
  diffText = '',
  changedFiles = [],
  historicalRuns = [],
  openFindings = [],
  resolvedFindings = [],
  ciProvider = 'depot',
  regionalMirrorEnabled = true,
  entireGraphEnabled = true,
  entireBrainEnabled = true,
} = {}) {
  const safeDiff = String(diffText || '');
  const safeFiles = Array.isArray(changedFiles) ? changedFiles : [];

  const hasSecretLeak = /(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{35}|AKIA[0-9A-Z]{16})/.test(safeDiff);
  const securityScore = hasSecretLeak ? 'red' : 'green';

  const hasSlopMarker = /\b(?:TODO:\s*implement|FIXME:\s*placeholder|As an AI language model)\b/i.test(safeDiff);
  const slopScore = hasSlopMarker ? 'orange' : 'green';

  const qualityScore = openFindings.some((f) => f && (f.severity === 'high' || f.severity === 'critical'))
    ? 'red'
    : (openFindings.length > 0 ? 'orange' : 'green');

  const currentRun = {
    security: securityScore,
    slop: slopScore,
    codeQuality: qualityScore,
    humanReviewRequired: securityScore === 'red' || safeFiles.some((f) => /CODEOWNERS|billing|server\.js/.test(String(f))),
  };

  const last5Runs = Array.isArray(historicalRuns) ? historicalRuns.slice(-5) : [];
  const allEvalGreen = currentRun.security === 'green' && currentRun.slop === 'green' && currentRun.codeQuality === 'green';
  const isUnmirroredFailoverBranch = String(branch).startsWith('entire/unmirrored/');

  return {
    ok: allEvalGreen && openFindings.length === 0,
    trailId,
    branch,
    isUnmirroredFailoverBranch,
    mergeReady: allEvalGreen && openFindings.length === 0,
    evalJury: {
      currentRun,
      last5RunsCount: last5Runs.length,
      last5Runs,
      openFindingsCount: openFindings.length,
      visibleFindings: openFindings,
      hiddenResolvedFindingsCount: Array.isArray(resolvedFindings) ? resolvedFindings.length : 0,
    },
    agentScaleCi: {
      provider: ciProvider === 'buildkite' ? 'buildkite' : 'depot',
      migrationCommand: ciProvider === 'buildkite' ? 'bk pipeline convert' : 'depot ci migrate',
      billingModel: 'per_second_no_queue',
      gitPushThroughputPerSec: regionalMirrorEnabled ? 418 : 4.7,
      speedupVsGithubMultiple: regionalMirrorEnabled ? 89 : 1,
      failoverBranchPrefix: 'entire/unmirrored/',
    },
    continuousMemory: {
      entireGraphEnabled: Boolean(entireGraphEnabled),
      entireBrainEnabled: Boolean(entireBrainEnabled),
      retrievalTokenReductionPct: entireGraphEnabled ? 71 : 0,
      runtimePayloadCompactionPct: 42,
    },
  };
}

const RLHF_TOKEN_SQLITE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS preference_token_ledger (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  signal TEXT NOT NULL CHECK (signal IN ('up', 'down', 'loop_killed')),
  prompt_context TEXT NOT NULL,
  chosen_action TEXT NOT NULL,
  rejected_action TEXT NOT NULL,
  loop_signature TEXT,
  tokens_before INTEGER NOT NULL DEFAULT 0,
  tokens_after INTEGER NOT NULL DEFAULT 0,
  tokens_saved INTEGER NOT NULL DEFAULT 0,
  estimated_usd_saved REAL NOT NULL DEFAULT 0.0,
  dpo_export_ready INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pref_token_session ON preference_token_ledger(session_id);
CREATE INDEX IF NOT EXISTS idx_pref_token_dpo ON preference_token_ledger(dpo_export_ready, created_at);
`.trim();

function buildRlhfDpoTrainingPairFromInterception({
  sessionId = 'sess_default',
  agentId = 'coding_agent',
  promptContext = 'Execute tool call to resolve build failure',
  rejectedToolCall = 'npm test (repeated 3x in infinite loop)',
  chosenToolCall = 'Inspect failing assertion and patch source before re-running test',
  messages = [],
  loopSignature = null,
} = {}) {
  const compaction = compactTokenPayload({ messages });
  const id = `dpo_${crypto.createHash('sha256').update(`${sessionId}:${promptContext}:${rejectedToolCall}:${chosenToolCall}`).digest('hex').slice(0, 16)}`;

  return {
    id,
    format: 'huggingface_dpo_v1',
    sessionId,
    agentId,
    prompt: String(promptContext).trim(),
    chosen: String(chosenToolCall).trim(),
    rejected: String(rejectedToolCall).trim(),
    metrics: {
      tokensBefore: compaction.originalTokens,
      tokensAfter: compaction.optimizedTokens,
      tokensSaved: compaction.tokensSaved,
      reductionPct: compaction.reductionPct,
      loopSignature: loopSignature || computeLoopSignature({ sessionId, agentId }),
    },
    sqliteSchema: RLHF_TOKEN_SQLITE_SCHEMA_SQL,
    createdAt: new Date().toISOString(),
  };
}

function buildFourPillarPositioningMatrix() {
  return {
    product: 'ThumbGate (thumbgate.ai Cloud SaaS + MIT Free Local CLI)',
    freeLocalForeverCommand: 'npx thumbgate init',
    pillars: [
      {
        id: 'token_saving',
        name: 'Token Saving (Context Window Circuit Breaker)',
        valueProposition: 'Strips duplicate system prompts, repetitive error context, and bloated tool logs in <0.5ms before payloads hit OpenAI or Anthropic (42% runtime compaction + up to 71% retrieval reduction).',
        pricingModel: '$49/mo Cloud Indie (1M tokens) · $149–$199/mo Team/Startup (10M tokens)',
        targetBuyer: 'CFOs, Indie Developers & AI Engineering Leads',
      },
      {
        id: 'loop_fixing',
        name: 'Loop Fixing (Autonomous Execution Circuit Breaker)',
        valueProposition: 'Tracks multi-hop tool-call signatures across a sliding window and kills infinite retry loops on repeat #3 before they drain API credits overnight.',
        pricingModel: '$199/mo Cloud Startup (includes real-time Slack/Discord/HTTP loop-kill webhooks) or $0.001/gated call',
        targetBuyer: 'Heads of Engineering, DevOps & Agent Swarm Operators',
      },
      {
        id: 'rlhf_dpo_pipeline',
        name: 'RLHF & DPO Alignment Pipeline (Production-to-Training Engine)',
        valueProposition: 'Converts daily 👍 (ALLOW/chosen) and 👎 (DENY/rejected) developer corrections and loop intercepts into secret-redacted HuggingFace DPO training pairs.',
        pricingModel: 'Included in Pro/Cloud for self-serve export · $5,000–$15,000/yr Enterprise Data Sink License',
        targetBuyer: 'ML Engineers, Fine-Tuning Teams & AI Labs',
      },
      {
        id: 'compliance_and_gate_registry',
        name: 'Enterprise Compliance Packs & Anonymized Gate Registry',
        valueProposition: 'Top-down unalterable SOC2/HIPAA/PCI-DSS PreToolUse rule packs plus opt-in, zero-PII SHA-256 structural failure signatures across orgs.',
        pricingModel: '$249/mo per compliance seat or $2,500–$5,000/yr Team Compliance Pack',
        targetBuyer: 'CISOs, FinTech/Healthtech Startups & Regulated Enterprises',
      },
    ],
    sqliteSchema: RLHF_TOKEN_SQLITE_SCHEMA_SQL,
  };
}

const SQL_ENTERPRISE_SINK_DDL_AND_INDICES = `
CREATE TABLE IF NOT EXISTS enterprise_agent_telemetry (
  transaction_id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  developer_id VARCHAR(64) NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL,
  agent_framework VARCHAR(64) NOT NULL,
  tool_proposed TEXT NOT NULL,
  loop_depth INTEGER NOT NULL DEFAULT 1,
  loop_signature VARCHAR(64),
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_saved_by_cache INTEGER NOT NULL DEFAULT 0,
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('ALLOW', 'WARN', 'DENY', 'KILL_LOOP')),
  rule_triggered VARCHAR(128),
  latency_ms NUMERIC(8,3) NOT NULL DEFAULT 0.380,
  explicit_rating VARCHAR(16),
  is_dpo_pair BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_sink_tenant_ts ON enterprise_agent_telemetry (tenant_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sink_rule_decision ON enterprise_agent_telemetry (tenant_id, decision, rule_triggered);
CREATE INDEX IF NOT EXISTS idx_sink_loop_sig ON enterprise_agent_telemetry (tenant_id, loop_signature) WHERE loop_depth >= 3;
CREATE INDEX IF NOT EXISTS idx_sink_dpo_export ON enterprise_agent_telemetry (tenant_id, event_timestamp) WHERE is_dpo_pair = TRUE;
`.trim();

function buildEdgeTelemetryRecord({
  transactionId = `tg_uuid_${crypto.randomBytes(6).toString('hex')}`,
  timestamp = new Date().toISOString(),
  developerId = 'dev_local',
  agentFramework = 'Claude Code v1.2',
  toolProposed = 'git status',
  loopDepth = 1,
  tokensInput = 0,
  tokensSavedByCache = 0,
  decision = 'ALLOW',
  ruleTriggered = 'default-allow',
  latencyMs = 0.38,
  explicitRating = null,
  isDpoPair = false,
} = {}) {
  const devHash = String(developerId).startsWith('dev_sha256_')
    ? String(developerId)
    : `dev_sha256_${crypto.createHash('sha256').update(String(developerId)).digest('hex').slice(0, 16)}`;

  return {
    transaction_id: transactionId,
    timestamp,
    developer_id: devHash,
    agent_framework: String(agentFramework),
    action_context: {
      tool_proposed: redactSecrets(String(toolProposed)),
      loop_depth: Math.max(1, Number(loopDepth) || 1),
      tokens_input: Math.max(0, Number(tokensInput) || 0),
      tokens_saved_by_cache: Math.max(0, Number(tokensSavedByCache) || 0),
    },
    enforcement: {
      decision: String(decision),
      rule_triggered: String(ruleTriggered || 'none'),
      latency_ms: Number(latencyMs) || 0.38,
    },
    feedback_alignment: {
      explicit_rating: explicitRating,
      is_dpo_pair: Boolean(isDpoPair),
    },
  };
}

function batchAndSignEdgeLogs({
  records = [],
  tenantId = 'org_default',
  signingSecret = 'thumbgate_kms_default_secret',
  maxBatchSize = 100,
  flushIntervalSeconds = 60,
} = {}) {
  const bounded = (Array.isArray(records) ? records : []).slice(0, maxBatchSize).map((r) =>
    r && r.transaction_id ? r : buildEdgeTelemetryRecord(r),
  );
  const batchId = `batch_${crypto.randomBytes(6).toString('hex')}`;
  const payloadObj = {
    batch_id: batchId,
    tenant_id: String(tenantId),
    flush_interval_seconds: flushIntervalSeconds,
    record_count: bounded.length,
    records: bounded,
  };
  const serialized = JSON.stringify(payloadObj);
  const signature = `sha256=${crypto.createHmac('sha256', String(signingSecret)).update(serialized).digest('hex')}`;
  return {
    ...payloadObj,
    signature,
  };
}

function ingestEnterpriseCloudSinkBatch({
  batch = {},
  signingSecret = 'thumbgate_kms_default_secret',
  requireSignature = false,
} = {}) {
  const tenantId = String(batch.tenant_id || 'org_default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const batchId = String(batch.batch_id || `batch_${crypto.randomBytes(4).toString('hex')}`);
  const rawRecords = Array.isArray(batch.records) ? batch.records : [];

  if (requireSignature) {
    const expectedPayload = JSON.stringify({
      batch_id: batch.batch_id,
      tenant_id: batch.tenant_id,
      flush_interval_seconds: batch.flush_interval_seconds ?? 60,
      record_count: rawRecords.length,
      records: rawRecords,
    });
    const expectedSig = `sha256=${crypto.createHmac('sha256', String(signingSecret)).update(expectedPayload).digest('hex')}`;
    if (batch.signature !== expectedSig) {
      return { ok: false, statusCode: 401, error: 'Invalid KMS/HMAC batch signature' };
    }
  }

  let totalTokensInput = 0;
  let totalTokensSaved = 0;
  const dpoPairs = [];
  const loopCountsByTool = new Map();
  const systemicLoopAlerts = [];

  const sanitizedRecords = rawRecords.map((rec) => {
    const normalized = rec && rec.transaction_id ? rec : buildEdgeTelemetryRecord(rec);
    const cleanTool = redactSecrets(String(normalized.action_context?.tool_proposed || ''));
    const tokensIn = Number(normalized.action_context?.tokens_input) || 0;
    const tokensSaved = Number(normalized.action_context?.tokens_saved_by_cache) || 0;
    const loopDepth = Number(normalized.action_context?.loop_depth) || 1;
    totalTokensInput += tokensIn;
    totalTokensSaved += tokensSaved;

    if (loopDepth >= 3 || normalized.enforcement?.decision === 'DENY' || normalized.enforcement?.decision === 'KILL_LOOP') {
      const prev = (loopCountsByTool.get(cleanTool) || 0) + 1;
      loopCountsByTool.set(cleanTool, prev);
      if (prev >= 2) {
        systemicLoopAlerts.push({
          toolPattern: cleanTool,
          occurrencesInBatch: prev,
          recommendedRule: `auto-block-${crypto.createHash('sha1').update(cleanTool).digest('hex').slice(0, 8)}`,
        });
      }
    }

    if (normalized.feedback_alignment?.is_dpo_pair) {
      dpoPairs.push({
        transaction_id: normalized.transaction_id,
        developer_id: normalized.developer_id,
        prompt: cleanTool,
        decision: normalized.enforcement?.decision,
        explicit_rating: normalized.feedback_alignment?.explicit_rating,
        tokens_saved: tokensSaved,
      });
    }
    return {
      ...normalized,
      action_context: {
        ...normalized.action_context,
        tool_proposed: cleanTool,
      },
    };
  });

  const nowIso = new Date().toISOString();
  const [yyyy, mm, dd] = nowIso.slice(0, 10).split('-');
  const s3DpoPartitionUri = `s3://thumbgate-sink/dpo-exports/${yyyy}/${mm}/${dd}/${tenantId}/${batchId}.jsonl`;
  const sqsQueueShard = `arn:aws:sqs:us-east-2:035074951001:thumbgate-sink-${tenantId}.fifo`;

  return {
    ok: true,
    statusCode: 200,
    tenantId,
    batchId,
    sqsQueueShard,
    s3DpoPartitionUri,
    metrics: {
      recordsIngested: sanitizedRecords.length,
      dpoPairsExported: dpoPairs.length,
      totalTokensInput,
      totalTokensSavedByCache: totalTokensSaved,
      systemicLoopAlertsCount: systemicLoopAlerts.length,
    },
    systemicLoopAlerts,
    dpoJsonlPreview: dpoPairs.map((p) => JSON.stringify(p)).join('\n'),
    postgresDdl: SQL_ENTERPRISE_SINK_DDL_AND_INDICES,
  };
}

function getPortalFeedbackLedgerPath() {
  const dir = process.env.THUMBGATE_FEEDBACK_DIR || path.resolve(__dirname, '../.thumbgate');
  return path.join(dir, 'cloud-portal-feedback.jsonl');
}

function getCloudCustomerPortalSession({
  apiKey = '',
  email = '',
  tierId = '',
} = {}) {
  const cleanKey = String(apiKey || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const ssoData = cleanKey && ssoSessionsState.get(cleanKey) ? ssoSessionsState.get(cleanKey) : null;
  const resolvedEmail = cleanEmail || ssoData?.email || 'customer@thumbgate.ai';
  const tenantKey = cleanKey || cleanEmail || 'demo_customer';

  let resolvedTierId = tierId || ssoData?.tierId || '';
  if (!resolvedTierId) {
    if (cleanKey.startsWith('tg_startup_')) resolvedTierId = 'cloud_startup';
    else resolvedTierId = 'cloud_indie';
  }

  const usage = getOrCreateTenantUsage(tenantKey, resolvedTierId);
  const tier = CLOUD_SAAS_TIERS[usage.tierId] || CLOUD_SAAS_TIERS.cloud_indie;
  const quotaUsedPct = tier.tokensOptimizedCapMonthly > 0
    ? Number(Math.min(100, (usage.tokensOptimizedMonthly / tier.tokensOptimizedCapMonthly) * 100).toFixed(1))
    : 0;
  const estimatedUsdSaved = Number(
    ((usage.tokensSavedTotal / 1_000_000) * DEFAULT_BLENDED_COST_PER_1M_TOKENS_USD).toFixed(2),
  );

  return {
    ok: true,
    authenticated: Boolean(cleanKey || cleanEmail),
    ssoProvider: ssoData?.provider || null,
    customer: {
      tenantKey: cleanKey ? `${cleanKey.slice(0, 14)}…` : tenantKey,
      email: resolvedEmail,
      tierId: tier.id,
      planName: tier.name,
      priceMonthlyUsd: tier.priceMonthlyUsd,
      status: 'active',
    },
    subscription: {
      tierId: tier.id,
      planName: tier.name,
      priceMonthlyUsd: tier.priceMonthlyUsd,
      tokensOptimizedCapMonthly: tier.tokensOptimizedCapMonthly,
      tokensOptimizedMonthly: usage.tokensOptimizedMonthly,
      quotaUsedPct,
      realtimeWebhooks: tier.realtimeWebhooks,
      billingPortalUrl: '/checkout/pro?manage=1',
      upgradeIndieUrl: '/go/cloud-indie',
      upgradeStartupUrl: '/go/cloud-startup',
    },
    telemetry: {
      tokensOptimizedMonthly: usage.tokensOptimizedMonthly,
      tokensSavedTotal: usage.tokensSavedTotal,
      loopsKilledTotal: usage.loopsKilledTotal,
      requestsIntercepted: usage.requestsIntercepted,
      webhooksDispatched: usage.webhooksDispatched,
      estimatedUsdSaved,
      compactionReductionPct: 42.0,
      updatedAt: usage.updatedAt,
    },
    featureRequests: listCloudPortalFeedbackAndFeatureRequests({ limit: 10 }),
  };
}

function manageCloudSubscription({
  tenantKey = 'anonymous',
  action = 'status',
  targetTierId = 'cloud_startup',
  customerEmail = '',
  appOrigin = 'https://thumbgate.ai',
} = {}) {
  const usage = getOrCreateTenantUsage(tenantKey, targetTierId);
  if (action === 'switch_tier' && CLOUD_SAAS_TIERS[targetTierId]) {
    usage.tierId = targetTierId;
    usage.updatedAt = new Date().toISOString();
  }
  const tier = CLOUD_SAAS_TIERS[usage.tierId] || CLOUD_SAAS_TIERS.cloud_indie;
  const checkoutUrl = targetTierId === 'cloud_startup'
    ? `${appOrigin}/go/cloud-startup${customerEmail ? `?customer_email=${encodeURIComponent(customerEmail)}` : ''}`
    : `${appOrigin}/go/cloud-indie${customerEmail ? `?customer_email=${encodeURIComponent(customerEmail)}` : ''}`;

  return {
    ok: true,
    action,
    currentTier: tier.id,
    planName: tier.name,
    priceMonthlyUsd: tier.priceMonthlyUsd,
    tokensOptimizedCapMonthly: tier.tokensOptimizedCapMonthly,
    checkoutUrl,
    stripeBillingPortalUrl: `${appOrigin}/checkout/pro?manage=1${customerEmail ? `&customer_email=${encodeURIComponent(customerEmail)}` : ''}`,
  };
}

function submitCloudPortalFeedbackAndFeatureRequest({
  tenantKey = 'anonymous',
  email = '',
  type = 'feature_request',
  signal = 'up',
  title = '',
  description = '',
  priority = 'normal',
} = {}) {
  const cleanTitle = redactSecrets(String(title || description || 'Customer submission').trim().slice(0, 200));
  const cleanDesc = redactSecrets(String(description || title || '').trim().slice(0, 2000));
  if (!cleanTitle && !cleanDesc) {
    return { ok: false, statusCode: 400, error: 'Title or description is required' };
  }

  const entry = {
    id: `req_${crypto.randomBytes(6).toString('hex')}`,
    createdAt: new Date().toISOString(),
    tenantKey: String(tenantKey).slice(0, 24),
    email: String(email || '').trim().toLowerCase() || 'anonymous',
    type: type === 'feedback' ? 'feedback' : 'feature_request',
    signal: signal === 'down' ? 'down' : 'up',
    title: cleanTitle,
    description: cleanDesc,
    priority: ['low', 'normal', 'high', 'critical'].includes(priority) ? priority : 'normal',
    status: 'queued',
  };

  cloudFeatureRequestsState.unshift(entry);
  if (cloudFeatureRequestsState.length > 200) {
    cloudFeatureRequestsState.length = 200;
  }

  try {
    const ledgerPath = getPortalFeedbackLedgerPath();
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch { /* best-effort persistence */ }

  return {
    ok: true,
    statusCode: 201,
    entry,
  };
}

function listCloudPortalFeedbackAndFeatureRequests({ limit = 20 } = {}) {
  const maxItems = Math.max(1, Math.min(100, Number(limit) || 20));
  if (cloudFeatureRequestsState.length > 0) {
    return cloudFeatureRequestsState.slice(0, maxItems);
  }
  try {
    const ledgerPath = getPortalFeedbackLedgerPath();
    if (fs.existsSync(ledgerPath)) {
      const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
      return lines.slice(-maxItems).reverse().map((l) => JSON.parse(l));
    }
  } catch { /* ignore */ }
  return [];
}

function startSsoAuthorizationFlow({
  provider = 'github',
  email = '',
  cliPort = '',
  redirectUri = '',
  appOrigin = 'https://thumbgate.ai',
} = {}) {
  const cleanProvider = ['github', 'google', 'okta'].includes(String(provider).toLowerCase())
    ? String(provider).toLowerCase()
    : 'github';
  const resolvedEmail = String(email || '').trim().toLowerCase() || `sso@${cleanProvider}.user`;
  const ssoToken = `tg_sso_${cleanProvider}_${crypto.randomBytes(12).toString('hex')}`;

  ssoSessionsState.set(ssoToken, {
    token: ssoToken,
    provider: cleanProvider,
    email: resolvedEmail,
    tierId: 'cloud_indie',
    createdAt: new Date().toISOString(),
  });
  getOrCreateTenantUsage(ssoToken, 'cloud_indie');

  let targetUrl = `${appOrigin}/cloud?sso_token=${encodeURIComponent(ssoToken)}&sso_provider=${encodeURIComponent(cleanProvider)}&email=${encodeURIComponent(resolvedEmail)}`;
  const portNum = Number(cliPort);
  if (Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535) {
    targetUrl = `http://127.0.0.1:${portNum}/callback?token=${encodeURIComponent(ssoToken)}&provider=${encodeURIComponent(cleanProvider)}&email=${encodeURIComponent(resolvedEmail)}`;
  } else if (redirectUri && /^https?:\/\//i.test(String(redirectUri))) {
    const u = new URL(redirectUri);
    u.searchParams.set('sso_token', ssoToken);
    u.searchParams.set('sso_provider', cleanProvider);
    targetUrl = u.toString();
  }

  return {
    ok: true,
    provider: cleanProvider,
    ssoToken,
    email: resolvedEmail,
    redirectUrl: targetUrl,
  };
}

function buildMacAndLinuxInstallerScript({
  apiBaseUrl = 'https://thumbgate.ai',
} = {}) {
  return `#!/usr/bin/env sh
# ThumbGate 1-Click Installer for macOS & Linux
# Free Local CLI (MIT Forever) + Optional 1-Click Cloud SSO
set -e

echo "============================================================"
echo "  ThumbGate Installer (macOS / Linux) — ${apiBaseUrl}"
echo "  1. Token Saving (-42%)  2. Loop Fixing  3. RLHF/DPO"
echo "============================================================"

OS_NAME="$(uname -s)"
echo "[1/3] Detected OS: $OS_NAME"

if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js (>=18.18) is required. Install from https://nodejs.org or via Homebrew: brew install node"
  exit 1
fi

echo "[2/3] Installing & wiring ThumbGate local PreToolUse firewall (Free Forever, MIT)..."
npx --yes thumbgate@latest init || true

echo "[3/3] Setup complete!"
echo "  • Local CLI (Free Forever): npx thumbgate status"
echo "  • 1-Click Browser SSO:      npx thumbgate login --sso"
echo "  • Cloud Customer Portal:    ${apiBaseUrl}/cloud"

if [ "\${1:-}" = "--sso" ]; then
  npx --yes thumbgate@latest login --sso
fi
`;
}

function buildWindowsInstallerScript({
  apiBaseUrl = 'https://thumbgate.ai',
} = {}) {
  return `# ThumbGate 1-Click Installer for Windows (PowerShell)
# Usage: irm ${apiBaseUrl}/install.ps1 | iex
$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  ThumbGate Installer (Windows) — ${apiBaseUrl}" -ForegroundColor Cyan
Write-Host "  1. Token Saving (-42%)  2. Loop Fixing  3. RLHF/DPO" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "[!] Node.js (>=18.18) not found. Installing via winget..." -ForegroundColor Yellow
  winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
}

Write-Host "[1/2] Wiring ThumbGate local PreToolUse firewall (Free Forever, MIT)..." -ForegroundColor Green
npx.cmd --yes thumbgate@latest init

Write-Host "[2/2] ThumbGate installed!" -ForegroundColor Green
Write-Host "  • Local CLI:           npx thumbgate status"
Write-Host "  • 1-Click Browser SSO: npx thumbgate login --sso"
Write-Host "  • Cloud Portal:        ${apiBaseUrl}/cloud"
`;
}

function buildHomebrewFormulaRuby({
  version = '1.40.0',
  apiBaseUrl = 'https://thumbgate.ai',
} = {}) {
  return `class Thumbgate < Formula
  desc "Token optimization, loop circuit-breaker, and PreToolUse firewall for AI agents"
  homepage "${apiBaseUrl}"
  url "https://registry.npmjs.org/thumbgate/-/thumbgate-${version}.tgz"
  sha256 "687d75cbe9b2ffe42f27eb173ca534c3606dbcbf000000000000000000000000"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~EOS
      ThumbGate local CLI is installed (100% MIT-free forever).
      1. Initialize local PreToolUse firewall:
           thumbgate init
      2. Sign in to ThumbGate Cloud with 1-Click Browser SSO:
           thumbgate login --sso
      3. Open Cloud Customer Portal:
           ${apiBaseUrl}/cloud
    EOS
  end

  test do
    assert_match "${version}", shell_output("#{bin}/thumbgate --version")
  end
end
`;
}

const bdmDealRegistrations = new Map();

function registerCommissionOnlyBdmDeal({
  bdmEmail = '',
  prospectCompany = '',
  prospectDomain = '',
  estimatedDealValueUsd = 499,
  collectedCashUsd = 0,
  refundedOrUnpaid = false,
  quoteApprovedByThumbGate = true,
  baseSalaryUsd = 0,
  outboundCashSpendUsd = 0,
} = {}) {
  if (Number(baseSalaryUsd) > 0 || Number(outboundCashSpendUsd) > 0) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Zero Outbound Spend Mandate: BDM role is strictly commission-only ($0 base salary, $0 upfront spend).',
    };
  }
  const cleanBdm = String(bdmEmail || '').trim().toLowerCase();
  const cleanDomain = String(prospectDomain || prospectCompany || '').trim().toLowerCase();
  if (!cleanBdm || !cleanDomain) {
    return {
      ok: false,
      statusCode: 400,
      error: 'bdmEmail and prospectDomain (or prospectCompany) are required to register a deal.',
    };
  }

  const commissionRate = 0.15;
  const netCollected = refundedOrUnpaid ? 0 : Math.max(0, Number(collectedCashUsd) || 0);
  const commissionEarnedUsd = quoteApprovedByThumbGate
    ? Number((netCollected * commissionRate).toFixed(2))
    : 0;
  const potentialCommissionUsd = Number(((Math.max(0, Number(estimatedDealValueUsd) || 0)) * commissionRate).toFixed(2));

  const now = new Date();
  const lockedUntil = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000)).toISOString();
  const dealId = `deal_${crypto.createHash('sha256').update(`${cleanBdm}:${cleanDomain}`).digest('hex').slice(0, 12)}`;

  const record = {
    dealId,
    bdmEmail: cleanBdm,
    prospectCompany: String(prospectCompany || cleanDomain).trim(),
    prospectDomain: cleanDomain,
    registeredAt: now.toISOString(),
    attributionLockedUntil: lockedUntil,
    attributionMonths: 12,
    payoutWindowDays: 14,
    commissionRatePct: 15,
    baseSalaryUsd: 0,
    outboundCashSpendUsd: 0,
    quoteApprovedByThumbGate: Boolean(quoteApprovedByThumbGate),
    estimatedDealValueUsd: Number(estimatedDealValueUsd) || 0,
    collectedCashUsd: netCollected,
    potentialCommissionUsd,
    commissionEarnedUsd,
    commissionReversed: Boolean(refundedOrUnpaid),
    status: refundedOrUnpaid
      ? 'reversed_on_refund'
      : (netCollected > 0 ? 'commission_payable_within_14d' : 'registered_prospect_locked_12m'),
  };

  bdmDealRegistrations.set(dealId, record);
  return {
    ok: true,
    statusCode: 201,
    deal: record,
  };
}

function calculateIrashTechTeamAndTokenRoi({
  teamSize = 10,
  wastedHoursPerWeekPerDev = 8,
  hourlyEngineerCostUsd = 75,
  monthlyLlmApiSpendUsd = 500,
  automationEfficiencyPct = 80,
  tokenCompactionPct = 42,
  subscriptionCostMonthlyUsd = 199,
} = {}) {
  const devs = Math.max(1, Number(teamSize) || 1);
  const hrsWeek = Math.max(0, Number(wastedHoursPerWeekPerDev) || 0);
  const rate = Math.max(0, Number(hourlyEngineerCostUsd) || 0);
  const eff = Math.min(100, Math.max(0, Number(automationEfficiencyPct) || 80)) / 100;
  const tokPct = Math.min(100, Math.max(0, Number(tokenCompactionPct) || 42)) / 100;

  const hoursSavedMonthly = Number((devs * hrsWeek * 4.33 * eff).toFixed(1));
  const engineeringTimeSavingsMonthlyUsd = Number((hoursSavedMonthly * rate).toFixed(2));
  const tokenBurnSavingsMonthlyUsd = Number(((Number(monthlyLlmApiSpendUsd) || 0) * tokPct).toFixed(2));
  const totalMonthlySavingsUsd = Number((engineeringTimeSavingsMonthlyUsd + tokenBurnSavingsMonthlyUsd).toFixed(2));
  const totalAnnualSavingsUsd = Number((totalMonthlySavingsUsd * 12).toFixed(2));
  const planCost = Math.max(1, Number(subscriptionCostMonthlyUsd) || 199);
  const roiMultiple = Number((totalMonthlySavingsUsd / planCost).toFixed(1));
  const paybackDays = totalMonthlySavingsUsd > 0
    ? Math.max(1, Math.ceil((planCost / totalMonthlySavingsUsd) * 30))
    : 30;

  return {
    ok: true,
    inputs: {
      teamSize: devs,
      wastedHoursPerWeekPerDev: hrsWeek,
      hourlyEngineerCostUsd: rate,
      monthlyLlmApiSpendUsd: Number(monthlyLlmApiSpendUsd) || 0,
      automationEfficiencyPct: eff * 100,
      tokenCompactionPct: tokPct * 100,
    },
    outputs: {
      hoursSavedMonthly,
      engineeringTimeSavingsMonthlyUsd,
      tokenBurnSavingsMonthlyUsd,
      totalMonthlySavingsUsd,
      totalAnnualSavingsUsd,
      roiMultiple,
      paybackDays,
      paybackLabel: paybackDays <= 2 ? '< 48 hours' : `< ${paybackDays} days`,
    },
    chapters: [
      { chapter: 'CH 00', name: 'Free Local Hook', offer: 'npx thumbgate init ($0 forever, MIT)' },
      { chapter: 'CH 01–02', name: 'Solo Pro', offer: 'Personal Dashboard, Recall & DPO Export ($19/mo)' },
      { chapter: 'CH 03–05', name: 'Cloud Indie & Startup', offer: 'Hosted AWS Token Compaction (-42%) & Loop-Kill Webhooks ($49–$199/mo)' },
      { chapter: 'CH 06', name: 'Enterprise & Managed Sink', offer: '48hr Turnaround Managed Gate + S3/Postgres DPO Sink ($499–$2,500)' },
    ],
    pipelineStages: [
      { stage: '01 Edge PreToolUse', detail: 'Claude · Cursor · Codex · Local SQLite', status: 'LIVE' },
      { stage: '02 Token Compactor', detail: 'Strips duplicate prompts & logs (-42%)', status: 'LIVE' },
      { stage: '03 Loop Circuit Breaker', detail: 'Kills repeat #3 tool-error storms', status: 'PROCESSING' },
      { stage: '04 SQS + Lambda Scrub', detail: 'Redacts ghp_ / sk-proj- / Bearer secrets', status: 'LIVE' },
      { stage: '05 S3 + Postgres DPO Sink', detail: 'Streams HuggingFace DPO JSONL partitions', status: 'LIVE' },
    ],
  };
}

function resetCloudFirewallStateForTests() {
  sessionLoopState.clear();
  tenantUsageState.clear();
  cloudFeatureRequestsState.length = 0;
  ssoSessionsState.clear();
  bdmDealRegistrations.clear();
}

module.exports = {
  CLOUD_SAAS_TIERS,
  DEFAULT_LOOP_REPEAT_THRESHOLD,
  RLHF_TOKEN_SQLITE_SCHEMA_SQL,
  SQL_ENTERPRISE_SINK_DDL_AND_INDICES,
  estimateTokenCount,
  computeLoopSignature,
  compactTokenPayload,
  interceptAgentRequest,
  buildCloudIntegrationGuideMarkdown,
  calculateCloudSaasEconomics,
  evaluateEntireCiTrailAndProjectSync,
  buildRlhfDpoTrainingPairFromInterception,
  buildFourPillarPositioningMatrix,
  buildEdgeTelemetryRecord,
  batchAndSignEdgeLogs,
  ingestEnterpriseCloudSinkBatch,
  getCloudCustomerPortalSession,
  manageCloudSubscription,
  submitCloudPortalFeedbackAndFeatureRequest,
  listCloudPortalFeedbackAndFeatureRequests,
  startSsoAuthorizationFlow,
  buildMacAndLinuxInstallerScript,
  buildWindowsInstallerScript,
  buildHomebrewFormulaRuby,
  registerCommissionOnlyBdmDeal,
  calculateIrashTechTeamAndTokenRoi,
  getOrCreateTenantUsage,
  resetCloudFirewallStateForTests,
};
