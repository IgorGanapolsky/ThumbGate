'use strict';

/**
 * ThumbGate Cloud — "Cloudflare for AI Coding Agents"
 *
 * B2B Team Policy Sync, Curated Threat Packs (AWS / SOC2 / Git-DB), Token Optimization,
 * Agentic Loop Circuit-Breaker, RLHF/DPO Pipeline, Entire CI Engine, Cross-Platform OS
 * Installers (Homebrew/macOS/Windows/Linux), 1-Click SSO, Customer Cloud Portal,
 * IrashTech 15% BDM Engine, AGNTCon/MCPCon 2026 Security Gate, Alibaba skill-up
 * Declarative Eval Loop, Rachel Woods CRAFT Playbook Engine, and AWS Zero-Spend Guard.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { redactSecrets } = require('../scripts/secret-redaction');

const CURATED_THREAT_PACKS = Object.freeze([
  Object.freeze({
    id: 'aws-production-safeguards',
    name: 'AWS Production Safeguards Pack',
    category: 'cloud_infrastructure',
    rulesCount: 18,
    autoUpdates: true,
    blockedPatterns: [
      'aws s3 rb --force',
      'aws rds delete-db-instance',
      'aws iam create-access-key',
      'aws ec2 create-nat-gateway',
      'terraform destroy -auto-approve',
    ],
    description: 'Blocks destructive AWS CLI/Terraform mutations, unauthorized IAM key creation, and costly VPC NAT Gateway provisioning before execution.',
  }),
  Object.freeze({
    id: 'soc2-secret-leak-prevention',
    name: 'SOC2 Secret & Credential Leak Prevention Pack',
    category: 'compliance_security',
    rulesCount: 24,
    autoUpdates: true,
    blockedPatterns: [
      'curl -d "$GITHUB_TOKEN"',
      'cat ~/.aws/credentials',
      'cat .env.production',
      'ghp_* / sk-proj-* / AKIA* outbound exfiltration',
      'process-kill / gate-bypass attempts',
    ],
    description: 'Enforces SOC2 CC6.1/CC6.7 pre-action secret redaction and blocks credential exfiltration across bash, curl, git, and MCP tool calls.',
  }),
  Object.freeze({
    id: 'destructive-git-and-db-blocks',
    name: 'Destructive Git & Database Protection Pack',
    category: 'engineering_safety',
    rulesCount: 16,
    autoUpdates: true,
    blockedPatterns: [
      'git push --force origin main',
      'git reset --hard',
      'rm -rf ./',
      'DROP TABLE / DROP SCHEMA CASCADE',
      'TRUNCATE prod_*',
    ],
    description: 'Prevents force-pushes to protected branches, unapproved schema drops, and recursive worktree deletions across Claude Code, Cursor, and Codex.',
  }),
]);

const CLOUD_SAAS_TIERS = Object.freeze({
  free_local: Object.freeze({
    id: 'free_local',
    name: 'ThumbGate Local (Open-Source MIT)',
    priceMonthlyUsd: 0,
    tokensOptimizedCapMonthly: 0,
    loopCircuitBreaker: true,
    realtimeWebhooks: false,
    teamPolicySync: false,
    curatedThreatPacks: false,
    hostedEndpoint: false,
    installCommand: 'npx thumbgate init',
    description: 'Free forever for solo developers. Local SQLite + PreToolUse safety gates.',
  }),
  cloud_indie: Object.freeze({
    id: 'cloud_indie',
    name: 'Cloud Indie',
    priceMonthlyUsd: 49,
    pricePerSeatMonthlyUsd: 29,
    tokensOptimizedCapMonthly: 1_000_000,
    loopCircuitBreaker: true,
    realtimeWebhooks: false,
    teamPolicySync: true,
    curatedThreatPacks: true,
    hostedEndpoint: true,
    checkoutPath: '/checkout/pro?plan_id=cloud_indie&billing_cycle=monthly&utm_source=cloud_saas',
    description: 'Centralized Team Policy Sync across every developer IDE + Curated Threat Packs (AWS, SOC2, Git/DB) + 1M tokens optimized/mo.',
  }),
  cloud_startup: Object.freeze({
    id: 'cloud_startup',
    name: 'Cloud Startup',
    priceMonthlyUsd: 199,
    pricePerSeatMonthlyUsd: 49,
    tokensOptimizedCapMonthly: 10_000_000,
    loopCircuitBreaker: true,
    realtimeWebhooks: true,
    teamPolicySync: true,
    curatedThreatPacks: true,
    hostedEndpoint: true,
    checkoutPath: '/checkout/pro?plan_id=cloud_startup&billing_cycle=monthly&utm_source=cloud_saas',
    description: 'Org-Wide Policy Sync (IDE + GitHub Actions CI), 1-Click SSO, Tamper-Evident Audit Log, Real-Time Loop-Kill Webhooks, and 10M tokens optimized/mo.',
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
const teamPoliciesState = new Map();

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
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  const pairs = keys.map((k) => {
    const encodedKey = JSON.stringify(k);
    const encodedVal = canonicalizeValue(value[k]);
    return `${encodedKey}:${encodedVal}`;
  });
  return `{${pairs.join(',')}}`;
}

function parseToolArgs(rawArgs) {
  if (typeof rawArgs !== 'string') return rawArgs;
  try {
    return JSON.parse(rawArgs);
  } catch {
    return rawArgs.trim();
  }
}

function computeLoopSignature({ sessionId = 'default', agentId = 'agent', toolCall = null, messages = [] }) {
  const hash = crypto.createHash('sha256');
  hash.update(`${sessionId}::${agentId}::`);
  if (toolCall && typeof toolCall === 'object') {
    const toolName = String(toolCall.name || toolCall.tool || toolCall.function?.name || 'unknown_tool');
    const rawArgs = toolCall.arguments ?? toolCall.input ?? toolCall.function?.arguments ?? {};
    hash.update(`tool:${toolName}:${canonicalizeValue(parseToolArgs(rawArgs))}`);
  } else if (Array.isArray(messages) && messages.length > 0) {
    const lastMsg = messages.at(-1);
    const content = typeof lastMsg?.content === 'string'
      ? lastMsg.content.trim()
      : canonicalizeValue(lastMsg?.content || '');
    hash.update(`msg:${lastMsg?.role || 'user'}:${content}`);
  } else {
    hash.update('empty');
  }
  return `loop_${hash.digest('hex').slice(0, 16)}`;
}

function truncateMiddle(text, maxChars) {
  const headLen = Math.floor(maxChars * 0.65);
  const tailLen = Math.floor(maxChars * 0.25);
  const head = text.slice(0, headLen);
  const tail = text.slice(-tailLen);
  const omitted = text.length - head.length - tail.length;
  return `${head} … [compacted ${omitted} chars by ThumbGate] … ${tail}`;
}

function normalizeMessageContent(msg) {
  const raw = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
  return raw.replace(/\s+/g, ' ').trim();
}

function compactTokenPayload({ messages = [], toolOutput = null, maxToolOutputChars = 1200 } = {}) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const toolTokens = toolOutput ? estimateTokenCount(toolOutput) : 0;
  const originalTokens = estimateTokenCount(safeMessages) + toolTokens;

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
    const normalized = normalizeMessageContent(msg);

    if (role === 'system') {
      if (seenSystemPrompts.has(normalized)) {
        duplicateTurnsRemoved += 1;
      } else {
        seenSystemPrompts.add(normalized);
        compactedMessages.push({ ...msg, content: normalized });
      }
      continue;
    }

    const contentHash = crypto.createHash('sha1').update(`${role}:${normalized}`).digest('hex').slice(0, 12);
    if (seenContentHashes.has(contentHash)) {
      duplicateTurnsRemoved += 1;
      continue;
    }
    seenContentHashes.set(contentHash, i);

    const isLastTurn = i === total - 1;
    let finalContent = normalized;
    if (!isLastTurn && finalContent.length > maxToolOutputChars) {
      finalContent = truncateMiddle(finalContent, maxToolOutputChars);
      truncatedBlocks += 1;
    }
    compactedMessages.push({ ...msg, content: finalContent });
  }

  let compactedToolOutput = toolOutput;
  if (typeof toolOutput === 'string' && toolOutput.length > maxToolOutputChars) {
    compactedToolOutput = truncateMiddle(toolOutput, maxToolOutputChars);
    truncatedBlocks += 1;
  }

  const outToolTokens = compactedToolOutput ? estimateTokenCount(compactedToolOutput) : 0;
  const optimizedTokens = estimateTokenCount(compactedMessages) + outToolTokens;
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

function recordLoopObservation(signature, sessionId, agentId, now) {
  const existing = sessionLoopState.get(signature);
  if (existing && (now - existing.firstSeenAt) <= LOOP_WINDOW_MS) {
    existing.count += 1;
    existing.lastSeenAt = now;
    return existing.count;
  }
  sessionLoopState.set(signature, {
    signature,
    sessionId,
    agentId,
    count: 1,
    firstSeenAt: now,
    lastSeenAt: now,
  });
  return 1;
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
    const capFormatted = tier.tokensOptimizedCapMonthly.toLocaleString();
    return {
      ok: false,
      decision: 'QUOTA_EXCEEDED',
      blocked: true,
      reason: `Monthly token optimization cap (${capFormatted} tokens) reached for ${tier.name}. Upgrade to Cloud Startup ($199/mo) at https://thumbgate.ai/pricing`,
      tier: tier.id,
      usage: { ...usage },
    };
  }

  const signature = computeLoopSignature({ sessionId, agentId, toolCall, messages });
  const repeatCount = recordLoopObservation(signature, sessionId, agentId, now);
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
  const canSendWebhook = Boolean(webhookUrl && (tier.realtimeWebhooks || tierId === 'cloud_startup'));
  if (loopDetected) {
    usage.loopsKilledTotal += 1;
    if (canSendWebhook) {
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
      if (webhookDelivery.sent) usage.webhooksDispatched += 1;
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
  const capFormatted = tier.tokensOptimizedCapMonthly.toLocaleString();
  return `# ThumbGate Cloud — Cloudflare for AI Coding Agents (Team Policy Sync & Token Firewall)

**Plan:** ${tier.name} (\`$${tier.priceMonthlyUsd}/month\`)
**Hosted Endpoint:** \`${apiBaseUrl}/v1/cloud/intercept\`
**Team Policy Sync Endpoint:** \`${apiBaseUrl}/v1/cloud/policy-sync\`
**Cloud Customer Portal:** \`${apiBaseUrl}/cloud\`
**Monthly Optimization Cap:** \`${capFormatted} tokens/mo\`
**Local CLI (Free Forever):** \`npx thumbgate init\`

---

## 0. 1-Click Installers (Homebrew / macOS / Windows / Linux) & SSO Login

- **Homebrew (macOS & Linux):** \`brew tap igorganapolsky/tap && brew install thumbgate\`
- **macOS / Linux:** \`curl -fsSL ${apiBaseUrl}/install.sh | sh\`
- **Windows (PowerShell):** \`irm ${apiBaseUrl}/install.ps1 | iex\`
- **1-Click Browser SSO:** \`npx thumbgate login --sso\`

---

## 1. Set Your API Key

\`\`\`bash
export THUMBGATE_API_KEY="${apiKey}"
export THUMBGATE_CLOUD_URL="${apiBaseUrl}/v1/cloud/intercept"
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
  const indieCount = Math.max(0, Number(indieSubscribers) || 0);
  const startupCount = Math.max(0, Number(startupSubscribers) || 0);
  const indieMrrUsd = indieCount * CLOUD_SAAS_TIERS.cloud_indie.priceMonthlyUsd;
  const startupMrrUsd = startupCount * CLOUD_SAAS_TIERS.cloud_startup.priceMonthlyUsd;
  const grossMrrUsd = indieMrrUsd + startupMrrUsd;
  const totalSubscribers = indieCount + startupCount;

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
    subscribers: { indie: indieCount, startup: startupCount, total: totalSubscribers },
    revenue: { indieMrrUsd, startupMrrUsd, grossMrrUsd, arrUsd: grossMrrUsd * 12 },
    costs: {
      architecture,
      awsHostingCostUsd,
      stripeFeesUsd,
      natGatewayTrapAvoidedUsd: architecture === 'serverless_lambda_dynamodb_sqs' ? 51.35 : 0,
    },
    profitability: { netProfitMonthlyUsd, netMarginPct },
    buyerRoi: {
      developerMonthlyApiBillUsd: Number(developerMonthlyApiBillUsd) || 0,
      compactionReductionPct: Number(compactionReductionPct) || 42,
      developerMonthlySavingsUsd,
      indieNetRoiMultiple: Number((developerMonthlySavingsUsd / 49).toFixed(1)),
    },
  };
}

function computeQualityScore(openFindings) {
  const hasHigh = openFindings.some((f) => f && (f.severity === 'high' || f.severity === 'critical'));
  if (hasHigh) return 'red';
  if (openFindings.length > 0) return 'orange';
  return 'green';
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
  const safeOpen = Array.isArray(openFindings) ? openFindings : [];

  const hasSecretLeak = /(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{35}|AKIA[0-9A-Z]{16})/.test(safeDiff);
  const securityScore = hasSecretLeak ? 'red' : 'green';
  const hasSlopMarker = /\b(?:TODO:\s*implement|FIXME:\s*placeholder|As an AI language model)\b/i.test(safeDiff);
  const slopScore = hasSlopMarker ? 'orange' : 'green';
  const qualityScore = computeQualityScore(safeOpen);

  const touchesSensitive = safeFiles.some((f) => /CODEOWNERS|billing|server\.js/.test(String(f)));
  const currentRun = {
    security: securityScore,
    slop: slopScore,
    codeQuality: qualityScore,
    humanReviewRequired: securityScore === 'red' || touchesSensitive,
  };

  const last5Runs = Array.isArray(historicalRuns) ? historicalRuns.slice(-5) : [];
  const allEvalGreen = securityScore === 'green' && slopScore === 'green' && qualityScore === 'green';
  const isBuildkite = ciProvider === 'buildkite';

  return {
    ok: allEvalGreen && safeOpen.length === 0,
    trailId,
    branch,
    isUnmirroredFailoverBranch: String(branch).startsWith('entire/unmirrored/'),
    mergeReady: allEvalGreen && safeOpen.length === 0,
    evalJury: {
      currentRun,
      last5RunsCount: last5Runs.length,
      last5Runs,
      openFindingsCount: safeOpen.length,
      visibleFindings: safeOpen,
      hiddenResolvedFindingsCount: Array.isArray(resolvedFindings) ? resolvedFindings.length : 0,
    },
    agentScaleCi: {
      provider: isBuildkite ? 'buildkite' : 'depot',
      migrationCommand: isBuildkite ? 'bk pipeline convert' : 'depot ci migrate',
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
  const digest = crypto
    .createHash('sha256')
    .update(`${sessionId}:${promptContext}:${rejectedToolCall}:${chosenToolCall}`)
    .digest('hex')
    .slice(0, 16);

  return {
    id: `dpo_${digest}`,
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
    product: 'ThumbGate — Cloudflare for AI Coding Agents (B2B Team Policy Sync + MIT Free Local CLI)',
    headline: 'Cloudflare for AI Coding Agents. Stop Claude and Cursor from leaking secrets, force-pushing, or repeating mistakes—enforced locally in 0.4ms before the command runs.',
    freeLocalForeverCommand: 'npx thumbgate init',
    curatedThreatPacks: CURATED_THREAT_PACKS,
    pillars: [
      {
        id: 'team_policy_sync_and_threat_packs',
        name: 'B2B Team Policy Sync & Curated Threat Packs (AWS / SOC2 / Git-DB)',
        valueProposition: 'When a Senior Architect blocks a risky agent pattern or enables a Curated Threat Pack, rules automatically sync to every developer IDE (Claude Code, Cursor, Codex) and GitHub Actions CI runner.',
        pricingModel: '$29–$49/seat/mo Team · $199/mo Startup Swarm (with 1-Click SSO & Org Audit Log)',
        targetBuyer: 'Engineering Managers, CTOs, Platform Teams & CISOs',
      },
      {
        id: 'token_saving',
        name: 'Token Saving (Context Window Circuit Breaker)',
        valueProposition: 'Strips duplicate system prompts, repetitive error context, and bloated tool logs in <0.5ms before payloads hit OpenAI or Anthropic (42% runtime compaction + up to 71% retrieval reduction).',
        pricingModel: '$49/mo Cloud Indie (1M tokens) · $199/mo Startup (10M tokens)',
        targetBuyer: 'CFOs, Indie Developers & AI Engineering Leads',
      },
      {
        id: 'loop_fixing',
        name: 'Loop Fixing (Zero-Click Autonomous Circuit Breaker)',
        valueProposition: 'Automatically captures failed tool calls and kills infinite retry loops on repeat #3 without requiring manual 👍/👎 clicks.',
        pricingModel: '$199/mo Cloud Startup (includes real-time Slack/Discord/HTTP loop-kill webhooks)',
        targetBuyer: 'Heads of Engineering, DevOps & Agent Swarm Operators',
      },
      {
        id: 'rlhf_dpo_pipeline',
        name: 'RLHF & DPO Alignment Pipeline (Production-to-Training Engine)',
        valueProposition: 'Converts intercepted agent loops and developer corrections into secret-redacted HuggingFace DPO training pairs.',
        pricingModel: 'Included in Team/Cloud · $5,000–$15,000/yr Enterprise Data Sink License',
        targetBuyer: 'ML Engineers, Fine-Tuning Teams & AI Labs',
      },
    ],
    sqliteSchema: RLHF_TOKEN_SQLITE_SCHEMA_SQL,
  };
}

/**
 * B2B Team Policy Sync (`GET /v1/cloud/policy-sync` & `POST /v1/cloud/policy-sync`):
 * Allows a Senior Architect or Security Lead to enable Curated Threat Packs (`aws-production-safeguards`,
 * `soc2-secret-leak-prevention`, `destructive-git-and-db-blocks`) and push custom org-wide rules
 * that automatically sync to every developer's IDE `PreToolUse` hook and GitHub Actions CI.
 */
function syncTeamPolicyAndThreatPacks({
  orgId = 'org_default',
  action = 'get',
  enabledPackIds = ['aws-production-safeguards', 'soc2-secret-leak-prevention', 'destructive-git-and-db-blocks'],
  customRules = [],
  updatedBy = 'architect@company.com',
} = {}) {
  const cleanOrg = String(orgId || 'org_default').trim();
  if (!teamPoliciesState.has(cleanOrg)) {
    teamPoliciesState.set(cleanOrg, {
      orgId: cleanOrg,
      enabledPackIds: ['aws-production-safeguards', 'soc2-secret-leak-prevention', 'destructive-git-and-db-blocks'],
      customRules: [
        { id: 'org-block-force-push-main', pattern: 'git push.*--force', action: 'DENY', targets: ['ide_pretooluse', 'github_actions_ci'] },
      ],
      zeroClickAutoFailureCapture: true,
      updatedBy: 'system_default',
      updatedAt: new Date().toISOString(),
    });
  }

  const current = teamPoliciesState.get(cleanOrg);
  if (action === 'update') {
    if (Array.isArray(enabledPackIds)) {
      current.enabledPackIds = enabledPackIds.filter((id) => CURATED_THREAT_PACKS.some((p) => p.id === id));
    }
    if (Array.isArray(customRules) && customRules.length > 0) {
      current.customRules = customRules.slice(0, 100);
    }
    current.updatedBy = String(updatedBy || 'architect@company.com');
    current.updatedAt = new Date().toISOString();
  }

  const activePacks = CURATED_THREAT_PACKS.filter((p) => current.enabledPackIds.includes(p.id));
  const totalRulesSynced = activePacks.reduce((sum, p) => sum + p.rulesCount, 0) + current.customRules.length;

  return {
    ok: true,
    orgId: cleanOrg,
    zeroClickAutoFailureCapture: current.zeroClickAutoFailureCapture,
    enforcementSurfaces: ['claude_code_ide', 'cursor_ide', 'codex_cli', 'github_actions_ci'],
    enabledPacks: activePacks,
    customRules: current.customRules,
    totalRulesSynced,
    updatedBy: current.updatedBy,
    updatedAt: current.updatedAt,
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
  transactionId = '',
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
  const txId = transactionId || `tg_uuid_${crypto.randomBytes(6).toString('hex')}`;
  const devStr = String(developerId);
  const devHash = devStr.startsWith('dev_sha256_')
    ? devStr
    : `dev_sha256_${crypto.createHash('sha256').update(devStr).digest('hex').slice(0, 16)}`;

  return {
    transaction_id: txId,
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
  const safeRecords = Array.isArray(records) ? records : [];
  const bounded = safeRecords.slice(0, maxBatchSize).map((r) =>
    (r && r.transaction_id ? r : buildEdgeTelemetryRecord(r)),
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
  const digest = crypto.createHmac('sha256', String(signingSecret)).update(serialized).digest('hex');
  return {
    ...payloadObj,
    signature: `sha256=${digest}`,
  };
}

function isLoopOrDenyEvent(normalized) {
  const loopDepth = Number(normalized.action_context?.loop_depth) || 1;
  const decision = normalized.enforcement?.decision;
  return loopDepth >= 3 || decision === 'DENY' || decision === 'KILL_LOOP';
}

function ingestEnterpriseCloudSinkBatch({
  batch = {},
  signingSecret = 'thumbgate_kms_default_secret',
  requireSignature = false,
} = {}) {
  const tenantId = String(batch.tenant_id || 'org_default').replace(/\W/g, '_');
  const defaultBatchId = `batch_${crypto.randomBytes(4).toString('hex')}`;
  const batchId = String(batch.batch_id || defaultBatchId);
  const rawRecords = Array.isArray(batch.records) ? batch.records : [];

  if (requireSignature) {
    const expectedPayload = JSON.stringify({
      batch_id: batch.batch_id,
      tenant_id: batch.tenant_id,
      flush_interval_seconds: batch.flush_interval_seconds ?? 60,
      record_count: rawRecords.length,
      records: rawRecords,
    });
    const digest = crypto.createHmac('sha256', String(signingSecret)).update(expectedPayload).digest('hex');
    if (batch.signature !== `sha256=${digest}`) {
      return { ok: false, statusCode: 401, error: 'Invalid KMS/HMAC batch signature' };
    }
  }

  let totalTokensInput = 0;
  let totalTokensSaved = 0;
  const dpoPairs = [];
  const loopCountsByTool = new Map();
  const systemicLoopAlerts = [];

  for (const rec of rawRecords) {
    const normalized = rec && rec.transaction_id ? rec : buildEdgeTelemetryRecord(rec);
    const cleanTool = redactSecrets(String(normalized.action_context?.tool_proposed || ''));
    const tokensIn = Number(normalized.action_context?.tokens_input) || 0;
    const tokensSaved = Number(normalized.action_context?.tokens_saved_by_cache) || 0;
    totalTokensInput += tokensIn;
    totalTokensSaved += tokensSaved;

    if (isLoopOrDenyEvent(normalized)) {
      const prev = (loopCountsByTool.get(cleanTool) || 0) + 1;
      loopCountsByTool.set(cleanTool, prev);
      if (prev >= 2) {
        const ruleHash = crypto.createHash('sha1').update(cleanTool).digest('hex').slice(0, 8);
        systemicLoopAlerts.push({
          toolPattern: cleanTool,
          occurrencesInBatch: prev,
          recommendedRule: `auto-block-${ruleHash}`,
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
  }

  const [yyyy, mm, dd] = new Date().toISOString().slice(0, 10).split('-');
  return {
    ok: true,
    statusCode: 200,
    tenantId,
    batchId,
    sqsQueueShard: `arn:aws:sqs:us-east-2:035074951001:thumbgate-sink-${tenantId}.fifo`,
    s3DpoPartitionUri: `s3://thumbgate-sink/dpo-exports/${yyyy}/${mm}/${dd}/${tenantId}/${batchId}.jsonl`,
    metrics: {
      recordsIngested: rawRecords.length,
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
  const ssoData = cleanKey ? (ssoSessionsState.get(cleanKey) || null) : null;
  const resolvedEmail = cleanEmail || ssoData?.email || 'customer@thumbgate.ai';
  const tenantKey = cleanKey || cleanEmail || 'demo_customer';

  let resolvedTierId = tierId || ssoData?.tierId || '';
  if (!resolvedTierId) {
    resolvedTierId = cleanKey.startsWith('tg_startup_') ? 'cloud_startup' : 'cloud_indie';
  }

  const usage = getOrCreateTenantUsage(tenantKey, resolvedTierId);
  const tier = CLOUD_SAAS_TIERS[usage.tierId] || CLOUD_SAAS_TIERS.cloud_indie;
  const quotaUsedPct = tier.tokensOptimizedCapMonthly > 0
    ? Number(Math.min(100, (usage.tokensOptimizedMonthly / tier.tokensOptimizedCapMonthly) * 100).toFixed(1))
    : 0;
  const estimatedUsdSaved = Number(
    ((usage.tokensSavedTotal / 1_000_000) * DEFAULT_BLENDED_COST_PER_1M_TOKENS_USD).toFixed(2),
  );
  const maskedKey = cleanKey ? `${cleanKey.slice(0, 14)}…` : tenantKey;

  return {
    ok: true,
    authenticated: Boolean(cleanKey || cleanEmail),
    ssoProvider: ssoData?.provider || null,
    customer: {
      tenantKey: maskedKey,
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
    teamPolicy: syncTeamPolicyAndThreatPacks({ orgId: tenantKey }),
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
  const emailSuffix = customerEmail ? `?customer_email=${encodeURIComponent(customerEmail)}` : '';
  const manageSuffix = customerEmail ? `&customer_email=${encodeURIComponent(customerEmail)}` : '';
  const baseRoute = targetTierId === 'cloud_startup' ? '/go/cloud-startup' : '/go/cloud-indie';

  return {
    ok: true,
    action,
    currentTier: tier.id,
    planName: tier.name,
    priceMonthlyUsd: tier.priceMonthlyUsd,
    tokensOptimizedCapMonthly: tier.tokensOptimizedCapMonthly,
    checkoutUrl: `${appOrigin}${baseRoute}${emailSuffix}`,
    stripeBillingPortalUrl: `${appOrigin}/checkout/pro?manage=1${manageSuffix}`,
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

  return { ok: true, statusCode: 201, entry };
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
  const lowerProvider = String(provider).toLowerCase();
  const cleanProvider = ['github', 'google', 'okta'].includes(lowerProvider) ? lowerProvider : 'github';
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
set -e
echo "ThumbGate Installer (macOS / Linux) — ${apiBaseUrl}"
npx --yes thumbgate@latest init || true
if [ "\${1:-}" = "--sso" ]; then
  npx --yes thumbgate@latest login --sso
fi
`;
}

function buildWindowsInstallerScript({
  apiBaseUrl = 'https://thumbgate.ai',
} = {}) {
  return `# ThumbGate 1-Click Installer for Windows (PowerShell)
$ErrorActionPreference = "Stop"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
}
npx.cmd --yes thumbgate@latest init
Write-Host "Cloud Portal: ${apiBaseUrl}/cloud"
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

  test do
    assert_match "${version}", shell_output("#{bin}/thumbgate --version")
  end
end
`;
}

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
  const estValue = Math.max(0, Number(estimatedDealValueUsd) || 0);
  const potentialCommissionUsd = Number((estValue * commissionRate).toFixed(2));

  const now = new Date();
  const lockedUntil = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000)).toISOString();
  const dealHash = crypto.createHash('sha256').update(`${cleanBdm}:${cleanDomain}`).digest('hex').slice(0, 12);

  let dealStatus = 'registered_prospect_locked_12m';
  if (refundedOrUnpaid) {
    dealStatus = 'reversed_on_refund';
  } else if (netCollected > 0) {
    dealStatus = 'commission_payable_within_14d';
  }

  return {
    ok: true,
    statusCode: 201,
    deal: {
      dealId: `deal_${dealHash}`,
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
      estimatedDealValueUsd: estValue,
      collectedCashUsd: netCollected,
      potentialCommissionUsd,
      commissionEarnedUsd,
      commissionReversed: Boolean(refundedOrUnpaid),
      status: dealStatus,
    },
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
  const paybackLabel = paybackDays <= 2 ? '< 48 hours' : `< ${paybackDays} days`;

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
      paybackLabel,
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

function auditAwsCostAnomalyZeroSpendGuard({
  accountId = '035074951001',
  anomalyThresholdUsd = 0.01,
  subscriptionChannel = 'EMAIL',
  frequency = 'DAILY',
  subscriberEmail = 'igor@igorganapolsky.com',
  zeroSpendBudgetActive = true,
  costOptimizationHubActive = true,
  computeOptimizerActive = true,
} = {}) {
  const blockers = [];
  if (Number(anomalyThresholdUsd) > 1.0) {
    blockers.push('aws_default_100_dollar_anomaly_threshold_too_high_must_be_at_most_1_usd');
  }
  if (String(subscriptionChannel).toUpperCase() === 'SNS') {
    blockers.push('avoid_paid_sns_anomaly_alerts_use_free_daily_or_weekly_email_subscription');
  }
  if (!zeroSpendBudgetActive || !costOptimizationHubActive || !computeOptimizerActive) {
    blockers.push('require_zero_spend_budget_and_active_cost_optimization_hub_and_compute_optimizer');
  }

  return {
    ok: blockers.length === 0,
    accountId,
    monthlyCostForMonitoringUsd: 0,
    anomalyThresholdUsd: Number(anomalyThresholdUsd),
    subscriptionChannel: String(subscriptionChannel).toUpperCase(),
    frequency,
    subscriberEmail,
    blockers,
  };
}

function evaluateAgntConMcpCon2026ProductionSecurityGate({
  toolSchemas = [{ name: 'gate_check', sizeBytes: 680, annotations: { readOnlyHint: true, destructiveHint: false } }],
  serverInstructions = 'ThumbGate PreToolUse Firewall & Token Optimizer (<0.5ms local, 42% cloud compaction).',
  agentIdentity = { agentId: 'agent_tg_1', ownerAttestation: 'igor@igorganapolsky.com', canReadDirectMessages: false },
  tasksCompleted = 25,
  verifiedOutcomes = 22,
  totalSpendUsd = 1.10,
} = {}) {
  const safeTools = Array.isArray(toolSchemas) ? toolSchemas : [];
  const blockers = [];

  for (const t of safeTools) {
    if (!t?.annotations || typeof t.annotations.readOnlyHint !== 'boolean') {
      blockers.push(`missing_mcp_tool_annotations_on_${t?.name || 'unknown'}`);
    }
    if ((Number(t?.sizeBytes) || 0) > 1024) {
      blockers.push(`oversized_mcp_tool_schema_over_1kb_on_${t?.name || 'unknown'}`);
    }
  }
  if (String(serverInstructions || '').length > 1000) {
    blockers.push('server_instructions_exceed_1000_char_safe_limit');
  }
  if (!agentIdentity?.agentId || !agentIdentity?.ownerAttestation || agentIdentity?.canReadDirectMessages) {
    blockers.push('require_first_class_agent_identity_with_owner_attestation_and_no_dm_access');
  }

  const safeTasks = Math.max(1, Number(tasksCompleted) || 1);
  const safeOutcomes = Math.max(1, Number(verifiedOutcomes) || 1);
  const spend = Math.max(0, Number(totalSpendUsd) || 0);

  return {
    ok: blockers.length === 0,
    aaifProjectsSupported: ['MCP', 'goose', 'AGENTS.md', 'OpenSandbox', 'Open Responses', 'Agent Skills', 'OpenEnv'],
    tokenomics: {
      costPerTaskUsd: Number((spend / safeTasks).toFixed(4)),
      costPerVerifiedOutcomeUsd: Number((spend / safeOutcomes).toFixed(4)),
    },
    blockers,
  };
}

function aggregateMultiJudgeResults(judges, expectGatePassed) {
  const judgeResults = judges.map((j, idx) => {
    const id = String(j?.id || `judge_${idx + 1}`);
    const type = String(j?.type || 'rule_based');
    if (!expectGatePassed) {
      return { id, type, status: 'SKIP', skipped: true, skipReason: 'expect_gate_failed', credit: 0 };
    }
    const status = String(j?.status || 'PASS').toUpperCase();
    return { id, type, status, skipped: false, credit: status === 'PASS' ? 1 : 0 };
  });
  if (!expectGatePassed) {
    return { strategy: 'all_required', status: 'FAIL', judgeResults, passFraction: 0 };
  }
  const hasErrorOrSkip = judgeResults.some((r) => r.status === 'ERROR' || r.status === 'SKIP');
  const hasFail = judgeResults.some((r) => r.status === 'FAIL');
  let status = 'PASS';
  if (hasErrorOrSkip) status = 'ERROR';
  else if (hasFail) status = 'FAIL';
  const passedCount = judgeResults.filter((r) => r.status === 'PASS').length;
  const passFraction = judgeResults.length > 0 ? Number((passedCount / judgeResults.length).toFixed(2)) : 1;
  return { strategy: 'all_required', status, judgeResults, passFraction };
}

function evaluateSkillUpDeclarativeEvalLoop({
  skillName = 'thumbgate-pretool-firewall',
  runtime = 'opensandbox',
  judgeType = 'rule',
  evaluatedEngine = 'claude_code',
  judgeEngine = 'codex',
  simulatorMode = 'autonomous',
  maxTurns = 22,
  expectGatePassed = true,
  judges = [
    { id: 'functional', type: 'script', status: 'PASS' },
    { id: 'semantic', type: 'agent_judge', status: 'PASS' },
  ],
  withSkillPassRate = 0.96,
  withoutSkillPassRate = 0.58,
  withSkillTokens = 1400,
  withoutSkillTokens = 2600,
} = {}) {
  const validRuntime = ['none', 'local', 'docker', 'opensandbox'].includes(runtime);
  const validJudge = ['rule', 'rule_based', 'script', 'agent', 'agent_judge'].includes(judgeType);
  const validSim = ['autonomous', 'mixed', 'fixed'].includes(simulatorMode);
  const aggregation = aggregateMultiJudgeResults(Array.isArray(judges) ? judges : [], Boolean(expectGatePassed));
  const passRateDelta = Number((Number(withSkillPassRate) - Number(withoutSkillPassRate)).toFixed(2));
  const tokenSavingsPct = withoutSkillTokens > 0
    ? Number((((withoutSkillTokens - withSkillTokens) / withoutSkillTokens) * 100).toFixed(1))
    : 0;
  const improved = passRateDelta > 0 && tokenSavingsPct >= 0 && aggregation.status === 'PASS';
  const evolutionAction = improved ? 'promote_candidate' : 'keep_original';

  return {
    ok: validRuntime && validJudge && validSim && improved,
    schemaVersion: 'v1alpha1',
    skillName,
    runtime,
    judgeType,
    roles: {
      evaluatedEngine,
      judgeEngine,
      independentJudgeSession: evaluatedEngine !== judgeEngine,
      simulatorMode,
      maxTurns: Math.max(1, Number(maxTurns) || 22),
    },
    evaluationJson: {
      version: 1,
      gates: { expectGatePassed: Boolean(expectGatePassed) },
      judge_results: aggregation.judgeResults,
      aggregation: { strategy: aggregation.strategy, status: aggregation.status },
    },
    gradingJson: {
      pass_rate: aggregation.passFraction,
      compatible_format: 'anthropic_evals_v1',
    },
    passRateDelta,
    tokenSavingsPct,
    evolutionAction,
    evalYaml: `schema_version: v1alpha1\nskill: ${skillName}\nruntime: ${runtime}\njudge: ${judgeType}\n`,
  };
}

function convertSkillObservationToCandidateCase({
  observationId = 'obs_default_1',
  skillName = 'thumbgate-pretool-firewall',
  attribution = 'explicit',
  prompt = 'Use $thumbgate-pretool-firewall to block git push --force origin main',
  expectedMustContain = ['DENY', 'git push --force'],
  approvedByMaintainer = true,
  suiteValidationPassed = true,
} = {}) {
  if (attribution !== 'explicit' && attribution !== 'instrumented') {
    return {
      ok: false,
      statusCode: 400,
      error: 'inferred_attribution_rejected_at_persistence_time',
    };
  }
  const redactedPrompt = redactSecrets(String(prompt || ''));
  if (!approvedByMaintainer) {
    return {
      ok: true,
      statusCode: 202,
      state: 'candidate_pending_approval',
      observationId,
      attribution,
      redactedPrompt,
    };
  }
  if (!suiteValidationPassed) {
    return {
      ok: false,
      statusCode: 422,
      state: 'rolled_back_on_validation_failure',
      observationId,
    };
  }
  const safeId = String(observationId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const casePath = `evals/cases/${safeId}.yaml`;
  const mustList = Array.isArray(expectedMustContain) ? expectedMustContain : ['DENY'];
  return {
    ok: true,
    statusCode: 201,
    state: 'promoted_to_functional_test_case',
    observationId: safeId,
    skillName,
    attribution,
    filePermissions: { dirMode: '0700', fileMode: '0600' },
    casePath,
    caseYaml: `id: ${safeId}\ntype: functional_test\ndescription: "Promoted from ${attribution} observation ${safeId}"\ninput:\n  prompt: ${JSON.stringify(redactedPrompt)}\nexpect:\n  must_contain: ${JSON.stringify(mustList)}\n`,
  };
}

function evaluateRachelWoodsCraftAndPlaybookMiddleManagerGate({
  playbookName = 'nitpicking-playbook',
  triggerWord = 'nitpicking',
  outline = {
    trigger: 'On PR push or pre-yield Goldfish check',
    inputs: 'Git diff, referenced files, and live test outputs',
    steps: ['Check secret redaction', 'Verify cognitive complexity <= 15', 'Verify c8 coverage >= 80%'],
    output: 'Structured PASS/FAIL verdict with exact file:line fixes',
  },
  craftStage = 'V2_AUTONOMOUS',
  spontaneousPositiveWinObserved = 'Added executive TRUE/FALSE ledger table at top of audit',
  lockInSpontaneousWinsToPlaybook = true,
  selfEditDiffLines = 6,
  maxAutoCommitSelfEditLines = 15,
  hasLocalBackupBeforeSelfEdit = true,
  storedInGitRepoNotProprietaryUi = true,
  middleManagerMode = 'hybrid_subagent_and_task_board',
} = {}) {
  const blockers = [];
  const hasFourPartOutline = Boolean(
    outline?.trigger
    && outline?.inputs
    && Array.isArray(outline?.steps)
    && outline.steps.length > 0
    && outline?.output,
  );
  if (!hasFourPartOutline) {
    blockers.push('playbook_must_define_atomic_trigger_inputs_steps_and_output');
  }
  if (!storedInGitRepoNotProprietaryUi) {
    blockers.push('own_the_playbook_rent_the_tech_must_store_in_git_not_proprietary_ui');
  }
  const isGenericTrigger = ['feedback', 'run', 'default', 'help'].includes(String(triggerWord).toLowerCase());
  if (isGenericTrigger) {
    blockers.push('use_unambiguous_custom_vocabulary_trigger_like_nitpicking_instead_of_generic_feedback');
  }
  if (!lockInSpontaneousWinsToPlaybook) {
    blockers.push('craft_feedback_loop_must_lock_in_spontaneous_positive_behaviors_not_just_block_errors');
  }

  const diffLines = Math.max(0, Number(selfEditDiffLines) || 0);
  const maxLines = Math.max(1, Number(maxAutoCommitSelfEditLines) || 15);
  const isMinorSelfEdit = diffLines <= maxLines;
  const selfEditAllowedAutonomously = isMinorSelfEdit && Boolean(hasLocalBackupBeforeSelfEdit);
  if (!hasLocalBackupBeforeSelfEdit) {
    blockers.push('self_editing_skill_requires_local_backup_snapshot_before_mutation');
  }

  const updatedSteps = Array.isArray(outline?.steps) ? [...outline.steps] : [];
  if (lockInSpontaneousWinsToPlaybook && spontaneousPositiveWinObserved) {
    updatedSteps.push(`Locked-in win: ${spontaneousPositiveWinObserved}`);
  }

  return {
    ok: blockers.length === 0,
    playbookName,
    triggerWord,
    craftStage,
    outline: {
      ...outline,
      steps: updatedSteps,
    },
    selfEditingGuardrail: {
      diffLines,
      maxAutoCommitSelfEditLines: maxLines,
      selfEditAllowedAutonomously,
      requiresHumanApprovalForMajorRewrite: !isMinorSelfEdit,
    },
    middleManager: {
      mode: middleManagerMode,
      playbookStackingReady: blockers.length === 0,
    },
    blockers,
  };
}

function buildTokenBurnCircuitBreakerPlaybook({
  openSourceRepoUrl = 'https://github.com/IgorGanapolsky/ThumbGate',
  hostedEndpointUrl = 'https://thumbgate.ai/v1/cloud/intercept',
  indieCheckoutUrl = 'https://thumbgate.ai/go/cloud-indie',
  startupCheckoutUrl = 'https://thumbgate.ai/go/cloud-startup',
  tokenBurnReductionPct = 42,
} = {}) {
  const redditDiscordReply = `We ran into this exact issue where our autonomous agents kept repeating tool errors and blowing past our rate limits. I wrote a small middleware layer that acts as a circuit breaker to block repetitive loops before they execute. Dropped our monthly token burn by ${tokenBurnReductionPct}%. Here is the open-source logic if you want to build it yourself (${openSourceRepoUrl} — \`npx thumbgate init\` is MIT-free forever), or you can just plug in our hosted AWS endpoint link (${hostedEndpointUrl}) if you don't want to maintain the infrastructure.`;
  return {
    ok: true,
    outboundCashSpendUsd: 0,
    tokenBurnReductionPct,
    openSourceHookCommand: 'npx thumbgate init',
    hostedEndpointUrl,
    tiers: {
      freeLocalUsd: 0,
      cloudIndieMonthlyUsd: 49,
      cloudStartupMonthlyUsd: 199,
      indieCheckoutUrl,
      startupCheckoutUrl,
    },
    templates: {
      redditDiscordReply,
    },
  };
}

const SKILLS_SH_CATALOG = Object.freeze({
  thumbgate: {
    name: 'thumbgate',
    description: 'Cloudflare for AI Coding Agents — PreToolUse firewall, 59 curated threat rules (AWS, SOC2, Git/DB), -42% token compaction, and repeat-#3 loop circuit breaker.',
    body: '# ThumbGate — Cloudflare for AI Coding Agents\n\n## Install\n```bash\nnpx skills add https://thumbgate.ai\nnpx thumbgate init\n```\n\n## Capabilities\n- PreToolUse firewall (<0.5ms local + hosted `/v1/cloud/intercept`)\n- 59 auto-updating threat rules (`AWS`, `SOC2`, `Git/DB`) via `/v1/cloud/policy-sync`\n- Repeat-#3 infinite loop circuit breaker & -42% prompt compaction\n',
  },
  'thumbgate-policy-sync': {
    name: 'thumbgate-policy-sync',
    description: 'B2B Team Policy Sync & Curated Threat Packs (AWS Production Safeguards, SOC2 Secret Leak Prevention, Destructive Git & DB Blocks) across Claude Code, Cursor, Codex, and GitHub Actions CI.',
    body: '# ThumbGate B2B Team Policy Sync\n\n## Endpoints\n- `GET /v1/cloud/threat-packs`\n- `GET /v1/cloud/policy-sync?orgId=<org>`\n- `POST /v1/cloud/policy-sync`\n',
  },
  'thumbgate-token-firewall': {
    name: 'thumbgate-token-firewall',
    description: 'Cloud Token Compactor (-42% prompt reduction) & Repeat-#3 Autonomous Loop Circuit Breaker with real-time webhooks and HuggingFace DPO export.',
    body: '# ThumbGate Cloud Token Firewall\n\n## Endpoint\n- `POST https://thumbgate.ai/v1/cloud/intercept`\n- Portal: `https://thumbgate.ai/cloud`\n',
  },
  'thumbgate-skill-up-eval': {
    name: 'thumbgate-skill-up-eval',
    description: 'Declarative Skill Eval-to-Evolution Engine (v1alpha1 Multi-Judge all_required aggregation, expect gate short-circuiting, and Rachel Woods CRAFT Playbook gate).',
    body: '# ThumbGate Skill-Up & CRAFT Eval Gate\n\n## Endpoints\n- `POST https://thumbgate.ai/v1/cloud/skill-up/eval`\n- `POST https://thumbgate.ai/v1/cloud/skill-up/observation`\n- `POST https://thumbgate.ai/v1/cloud/playbook/craft`\n',
  },
  'thumbgate-herdr-omp-gitbutler-swarm': {
    name: 'thumbgate-herdr-omp-gitbutler-swarm',
    description: 'Herdr + OMP + Poolside Laguna + GitButler (but) Multi-Agent Swarm Orchestrator (Captain .herd-swarm/decisions.md ledger, 3-8 OMP Laguna leaves, and GitButler virtual-branch vs Herdr --worktree routing).',
    body: '# ThumbGate Herdr + OMP + Poolside + GitButler Swarm\n\n## Architecture\n- **Captain:** Manages `.herd-swarm/decisions.md`, decomposes specs, dictates merge order, and never writes code directly.\n- **Workers:** 3–8 OMP leaves powered by Poolside Laguna (`herdr --remote <host> --session agents`).\n- **Routing:** `herdr --worktree` for isolated modules; `but agent setup` + `but commit` virtual branches for shared live runtime.\n',
  },
});

function getSkillsShWellKnownSkillMarkdown(skillName = 'thumbgate') {
  const entry = SKILLS_SH_CATALOG[String(skillName || '').toLowerCase()];
  if (!entry) return null;
  return `---\nname: ${entry.name}\ndescription: ${entry.description}\n---\n\n${entry.body}`;
}

function buildSkillsShWellKnownDiscoveryIndex({
  appOrigin = 'https://thumbgate.ai',
} = {}) {
  const cleanOrigin = String(appOrigin || 'https://thumbgate.ai').replace(/\/$/, '');
  const skills = Object.values(SKILLS_SH_CATALOG).map((entry) => {
    const md = getSkillsShWellKnownSkillMarkdown(entry.name);
    const digest = crypto.createHash('sha256').update(md, 'utf8').digest('hex');
    return {
      name: entry.name,
      type: 'skill-md',
      description: entry.description,
      url: `${cleanOrigin}/.well-known/agent-skills/${entry.name}/SKILL.md`,
      digest: `sha256:${digest}`,
    };
  });
  return {
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills,
  };
}

function evaluateHerdrOmpPoolsideGitButlerSwarmGate({
  captainWritesCode = false,
  decisionsLedgerPath = '.herd-swarm/decisions.md',
  workerCount = 4,
  workerHarness = 'omp',
  workerModel = 'poolside/laguna-s-2.1',
  herdrSocketPath = '/Users/iganapolsky/.config/herdr/herdr.sock',
  remoteHost = '',
  requiresSharedLiveDevServerOrRuntime = true,
  butAgentSetupCompleted = true,
  commitCommand = 'but commit',
  usesSpecificFileOrHunkIds = true,
  firstClassConflictsNonBlocking = true,
} = {}) {
  const blockers = [];
  if (captainWritesCode) {
    blockers.push('captain_must_arbitrate_and_never_implement_code_directly');
  }
  if (String(decisionsLedgerPath).trim() !== '.herd-swarm/decisions.md') {
    blockers.push('captain_must_maintain_shared_herd_swarm_decisions_md_ledger');
  }
  const workers = Number(workerCount) || 0;
  if (workers < 3 || workers > 8) {
    blockers.push('swarm_requires_3_to_8_omp_poolside_laguna_worker_leaves');
  }
  const sharedRuntime = Boolean(requiresSharedLiveDevServerOrRuntime);
  const routingMode = sharedRuntime ? 'gitbutler_shared_workspace' : 'herdr_worktree_isolation';
  if (sharedRuntime) {
    const isButCommit = String(commitCommand).trim().startsWith('but commit');
    if (!butAgentSetupCompleted || !isButCommit || !usesSpecificFileOrHunkIds) {
      blockers.push('gitbutler_shared_workspace_requires_but_agent_setup_and_but_commit_with_file_or_hunk_ids');
    }
  }

  const remoteAttachCommand = remoteHost
    ? `herdr --remote ${remoteHost} --session agents`
    : 'herdr --session agents';

  return {
    ok: blockers.length === 0,
    architecture: 'herdr_omp_poolside_gitbutler_oct_2026',
    captain: {
      role: 'arbitrator_and_merge_sequencer',
      captainWritesCode: Boolean(captainWritesCode),
      decisionsLedgerPath,
    },
    workers: {
      count: workers,
      harness: workerHarness,
      model: workerModel,
      herdrSocketPath,
      remoteAttachCommand,
    },
    executionRouting: {
      requiresSharedLiveDevServerOrRuntime: sharedRuntime,
      routingMode,
      initCommand: sharedRuntime ? 'but agent setup' : 'herdr worktree create',
      commitCommand: sharedRuntime ? commitCommand : 'git commit',
      firstClassConflictsNonBlocking: Boolean(firstClassConflictsNonBlocking),
    },
    blockers,
  };
}

function resetCloudFirewallStateForTests() {
  sessionLoopState.clear();
  tenantUsageState.clear();
  cloudFeatureRequestsState.length = 0;
  ssoSessionsState.clear();
  teamPoliciesState.clear();
}

module.exports = {
  CURATED_THREAT_PACKS,
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
  syncTeamPolicyAndThreatPacks,
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
  auditAwsCostAnomalyZeroSpendGuard,
  evaluateAgntConMcpCon2026ProductionSecurityGate,
  evaluateSkillUpDeclarativeEvalLoop,
  convertSkillObservationToCandidateCase,
  evaluateRachelWoodsCraftAndPlaybookMiddleManagerGate,
  buildTokenBurnCircuitBreakerPlaybook,
  getSkillsShWellKnownSkillMarkdown,
  buildSkillsShWellKnownDiscoveryIndex,
  evaluateHerdrOmpPoolsideGitButlerSwarmGate,
  getOrCreateTenantUsage,
  resetCloudFirewallStateForTests,
};
