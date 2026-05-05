#!/usr/bin/env node
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('node:events');
const pkg = require('../../package.json');
const {
  createUnavailableAsyncOperation,
  loadOptionalModule,
} = require('../../scripts/private-core-boundary');

const POSTHOG_API_PATHS = new Set(['/capture', '/batch', '/decide', '/e', '/engage']);
const POSTHOG_INGEST_HOST = 'us.i.posthog.com';
const POSTHOG_STATIC_PATH_PREFIX = '/static/';

function getPosthogProxyPath(pathname) {
  return pathname.slice('/ingest'.length) || '/';
}

function isExactOrChildPath(pathname, basePath) {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function isAllowedPosthogProxyPath(pathname) {
  if (pathname === '/') return true;
  if (pathname.startsWith(POSTHOG_STATIC_PATH_PREFIX)) return true;
  return Array.from(POSTHOG_API_PATHS).some((basePath) => isExactOrChildPath(pathname, basePath));
}

function buildPosthogProxyRequestOptions(req, posthogPath, search) {
  return {
    protocol: 'https:',
    hostname: POSTHOG_INGEST_HOST,
    path: `${posthogPath}${search || ''}`,
    method: req.method,
    headers: {
      ...req.headers,
      host: POSTHOG_INGEST_HOST,
    },
  };
}

const {
  captureFeedback,
  analyzeFeedback,
  feedbackSummary,
  writePreventionRules,
  getFeedbackPaths,
  appendDiagnosticRecord,
} = require('../../scripts/feedback-loop');
const {
  readActiveProjectState,
  resolveProjectDir,
} = require('../../scripts/feedback-paths');
const {
  readRecentConversationWindow,
} = loadOptionalModule(path.join(__dirname, '../../scripts/feedback-history-distiller'), () => ({
  readRecentConversationWindow: () => [],
}));
const {
  readJSONL,
  exportDpoFromMemories,
  DEFAULT_LOCAL_MEMORY_LOG,
} = require('../../scripts/export-dpo-pairs');
const {
  exportDatabricksBundle,
} = require('../../scripts/export-databricks-bundle');
const {
  ensureContextFs,
  normalizeNamespaces,
  constructContextPack,
  evaluateContextPack,
  getProvenance,
} = require('../../scripts/contextfs');
const {
  buildRubricEvaluation,
} = require('../../scripts/rubric-engine');
const {
  bootstrapInternalAgent,
} = require('../../scripts/internal-agent-bootstrap');
const {
  classifyRequester,
} = require('../../scripts/bot-detection');
const {
  buildCloudflareSandboxPlan,
} = require('../../scripts/cloudflare-dynamic-sandbox');
const {
  listJobStates,
  readJobState,
  requestJobControl,
} = require('../../scripts/async-job-runner');
const {
  loadModel,
  getReliability,
  samplePosteriors,
} = require('../../scripts/thompson-sampling');
const {
  appendFunnelEvent,
  createCheckoutSession,
  getCheckoutSessionStatus,
  provisionApiKey,
  validateApiKey,
  recordUsage,
  rotateApiKey,
  handleWebhook,
  verifyWebhookSignature,
  verifyGithubWebhookSignature,
  handleGithubWebhook,
  getFunnelAnalytics,
  getBillingSummary,
  getBillingSummaryLive,
} = require('../../scripts/billing');
const {
  DEFAULT_PUBLIC_APP_ORIGIN,
  resolveHostedBillingConfig,
  createTraceId,
  buildHostedSuccessUrl,
  buildHostedCancelUrl,
} = require('../../scripts/hosted-config');
const {
  generateSkills,
} = require('../../scripts/skill-generator');
const {
  satisfyCondition,
  loadStats: loadGateStats,
  setConstraint,
  loadConstraints,
  setTaskScope,
  setBranchGovernance,
  getScopeState,
  getBranchGovernanceState,
  approveProtectedAction,
} = require('../../scripts/gates-engine');
const {
  evaluateOperationalIntegrity,
} = require('../../scripts/operational-integrity');
const {
  evaluateWorkflowSentinel,
} = require('../../scripts/workflow-sentinel');
const {
  normalizeProviderAction,
} = require('../../scripts/provider-action-normalizer');
const {
  recordDecisionEvaluation,
  recordDecisionOutcome,
  computeDecisionMetrics,
} = require('../../scripts/decision-journal');
const {
  generateDashboard,
  buildReviewSnapshot,
  readDashboardReviewState,
  writeDashboardReviewState,
} = require('../../scripts/dashboard');
const {
  buildDashboardRenderSpec,
} = require('../../scripts/dashboard-render-spec');
const {
  getSettingsStatus,
} = require('../../scripts/settings-hierarchy');
const {
  searchThumbgate,
} = require('../../scripts/thumbgate-search');
const {
  appendTelemetryPing,
} = require('../../scripts/telemetry-analytics');
const {
  buildProductIssueTitle,
  submitProductIssue,
} = require('../../scripts/product-feedback');
const {
  resolveBuildMetadata,
} = require('../../scripts/build-metadata');
const {
  resolveAnalyticsWindow,
} = require('../../scripts/analytics-window');
const {
  importDocument,
  listImportedDocuments,
  readImportedDocument,
} = require('../../scripts/document-intake');
const {
  checkLimit,
  UPGRADE_MESSAGE: RATE_LIMIT_MESSAGE,
} = require('../../scripts/rate-limiter');
const { sendProblem, PROBLEM_TYPES } = require('../../scripts/problem-detail');
const { TOOLS: MCP_TOOLS } = require('../../scripts/tool-registry');
const resendMailer = require('../../scripts/mailer/resend-mailer');
const {
  buildContextFootprintReport,
} = require('../../scripts/context-footprint');
const {
  findSeoPageByPath,
  renderSeoPageHtml,
  THUMBGATE_SEO_SITEMAP_ENTRIES,
} = require('../../scripts/seo-gsd');

const LANDING_PAGE_PATH = path.resolve(__dirname, '../../public/index.html');
const PRO_PAGE_PATH = path.resolve(__dirname, '../../public/pro.html');
const DASHBOARD_PAGE_PATH = path.resolve(__dirname, '../../public/dashboard.html');
const LESSONS_PAGE_PATH = path.resolve(__dirname, '../../public/lessons.html');
const GUIDE_PAGE_PATH = path.resolve(__dirname, '../../public/guide.html');
const CODEX_PLUGIN_PAGE_PATH = path.resolve(__dirname, '../../public/codex-plugin.html');
const COMPARE_PAGE_PATH = path.resolve(__dirname, '../../public/compare.html');
const LEARN_PAGE_PATH = path.resolve(__dirname, '../../public/learn.html');
const NUMBERS_PAGE_PATH = path.resolve(__dirname, '../../public/numbers.html');
const LEARN_DIR = path.resolve(__dirname, '../../public/learn');
const GUIDES_DIR = path.resolve(__dirname, '../../public/guides');
const COMPARE_DIR = path.resolve(__dirname, '../../public/compare');
const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const PUBLIC_ASSETS_DIR = path.resolve(__dirname, '../../public/assets');
const BUYER_INTENT_SCRIPT_PATH = path.resolve(__dirname, '../../public/js/buyer-intent.js');
const STATIC_MIME_BY_EXT = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
});
const PRIVATE_API_MODULES = Object.freeze({
  intentRouter: path.resolve(__dirname, '../../scripts/intent-router.js'),
  delegationRuntime: path.resolve(__dirname, '../../scripts/delegation-runtime.js'),
  hostedJobLauncher: path.resolve(__dirname, '../../scripts/hosted-job-launcher.js'),
  workflowSprintIntake: path.resolve(__dirname, '../../scripts/workflow-sprint-intake.js'),
  lessonSearch: path.resolve(__dirname, '../../scripts/lesson-search.js'),
  lessonSynthesis: path.resolve(__dirname, '../../scripts/lesson-synthesis.js'),
  semanticLayer: path.resolve(__dirname, '../../scripts/semantic-layer.js'),
  commercialOffer: path.resolve(__dirname, '../../scripts/commercial-offer.js'),
});

function createPrivateCoreUnavailableError(feature) {
  const error = new Error(`${feature} is only available in the ThumbGate private core or hosted runtime.`);
  error.statusCode = 503;
  error.code = 'PRIVATE_CORE_REQUIRED';
  return error;
}

function loadPrivateApiModule(key) {
  const modulePath = PRIVATE_API_MODULES[key];
  if (!modulePath) {
    throw new Error(`Unknown private API module: ${key}`);
  }
  try {
    return require(modulePath);
  } catch (error) {
    const message = String(error && error.message || '');
    if ((error && (error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_MODULE_NOT_FOUND'))
      && (message.includes(modulePath) || message.includes(path.basename(modulePath)))) {
      return null;
    }
    throw error;
  }
}

function requirePrivateApiModule(key, feature) {
  const module = loadPrivateApiModule(key);
  if (!module) {
    throw createPrivateCoreUnavailableError(feature);
  }
  return module;
}

function getCommercialOfferModule() {
  return requirePrivateApiModule('commercialOffer', 'Commercial offer planning');
}

function normalizePlanId(value) {
  return getCommercialOfferModule().normalizePlanId(value);
}

function normalizeBillingCycle(value) {
  return getCommercialOfferModule().normalizeBillingCycle(value);
}

function normalizeSeatCount(value, fallback) {
  return getCommercialOfferModule().normalizeSeatCount(value, fallback);
}

function getLessonSynthesisModule() {
  return requirePrivateApiModule('lessonSynthesis', 'Lesson synthesis');
}

function readLessonJsonl(filePath, options) {
  return getLessonSynthesisModule().readJSONLLocal(filePath, options);
}

function updateLessonJsonlRecord(filePath, recordId, record) {
  return getLessonSynthesisModule().updateRecordInJsonl(filePath, recordId, record);
}

function deleteLessonJsonlRecord(filePath, recordId) {
  return getLessonSynthesisModule().deleteRecordFromJsonl(filePath, recordId);
}

function serveStaticFile(res, filePath, { headOnly = false, cacheSeconds = 86400 } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = STATIC_MIME_BY_EXT[ext] || 'application/octet-stream';
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  if (!stat.isFile()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', `public, max-age=${cacheSeconds}, immutable`);
  if (headOnly) {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}
const VISITOR_COOKIE_NAME = 'thumbgate_visitor_id';
const SESSION_COOKIE_NAME = 'thumbgate_session_id';
const ACQUISITION_COOKIE_NAME = 'thumbgate_acquisition_id';
const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;
const BUILD_METADATA = resolveBuildMetadata();
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const IDLE_JOB_STATUSES = new Set(['queued', 'paused', 'resume_requested']);
const JOB_CONTROL_ACTIONS = new Set(['pause', 'cancel', 'resume']);
const TRACKED_LINK_QUERY_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'source',
  'creator',
  'creator_handle',
  'community',
  'subreddit',
  'post_id',
  'comment_id',
  'campaign_variant',
  'offer_code',
  'acquisition_id',
  'visitor_id',
  'session_id',
  'visitor_session_id',
  'install_id',
  'trace_id',
  'cta_id',
  'cta_placement',
  'plan_id',
  'billing_cycle',
  'seat_count',
  'landing_path',
  'referrer_host',
];
const TRACKED_LINK_TARGETS = Object.freeze({
  gpt: {
    href: 'https://chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate',
    external: true,
    ctaId: 'go_gpt',
    ctaPlacement: 'link_router',
    eventType: 'chatgpt_gpt_open',
    defaults: {
      utm_source: 'website',
      utm_medium: 'link_router',
      utm_campaign: 'chatgpt_gpt',
    },
  },
  pro: {
    path: '/checkout/pro',
    ctaId: 'go_pro',
    ctaPlacement: 'link_router',
    eventType: 'cta_click',
    defaults: {
      utm_source: 'website',
      utm_medium: 'link_router',
      utm_campaign: 'pro_upgrade',
      plan_id: 'pro',
      billing_cycle: 'monthly',
    },
    allowCustomerEmail: true,
  },
  install: {
    path: '/guide',
    ctaId: 'go_install',
    ctaPlacement: 'link_router',
    eventType: 'install_guide_click',
    defaults: {
      utm_source: 'website',
      utm_medium: 'link_router',
      utm_campaign: 'install_free',
      plan_id: 'free',
    },
  },
  reddit: {
    path: '/',
    ctaId: 'go_reddit',
    ctaPlacement: 'link_router',
    eventType: 'community_landing_redirect',
    defaults: {
      utm_source: 'reddit',
      utm_medium: 'organic_social',
      utm_campaign: 'first_party_redirect',
      campaign_variant: 'reddit_shortlink',
    },
  },
  linkedin: {
    path: '/',
    ctaId: 'go_linkedin',
    ctaPlacement: 'link_router',
    eventType: 'community_landing_redirect',
    defaults: {
      utm_source: 'linkedin',
      utm_medium: 'organic_social',
      utm_campaign: 'first_party_redirect',
      campaign_variant: 'linkedin_shortlink',
    },
  },
  x: {
    path: '/',
    ctaId: 'go_x',
    ctaPlacement: 'link_router',
    eventType: 'community_landing_redirect',
    defaults: {
      utm_source: 'x',
      utm_medium: 'organic_social',
      utm_campaign: 'first_party_redirect',
      campaign_variant: 'x_shortlink',
    },
  },
  github: {
    href: 'https://github.com/IgorGanapolsky/ThumbGate',
    external: true,
    ctaId: 'go_github',
    ctaPlacement: 'link_router',
    eventType: 'github_repo_click',
    defaults: {
      utm_source: 'website',
      utm_medium: 'link_router',
      utm_campaign: 'github_repo',
    },
  },
});

// ---------------------------------------------------------------------------
// Stripe event tracking helpers
// ---------------------------------------------------------------------------
const STRIPE_EVENTS_PATH = path.resolve(__dirname, '../../.thumbgate/stripe-events.jsonl');
const LEGACY_STRIPE_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

function ensureStripeEventsDir() {
  const dir = path.dirname(STRIPE_EVENTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function appendStripeEvent(record) {
  ensureStripeEventsDir();
  fs.appendFileSync(STRIPE_EVENTS_PATH, JSON.stringify(record) + '\n', 'utf8');
}

function buildLegacyStripeEventRecord(event) {
  const obj = event.data && event.data.object ? event.data.object : {};
  return {
    timestamp: new Date().toISOString(),
    event_type: event.type,
    event_id: event.id || null,
    customer_email:
      obj.customer_email ||
      obj.email ||
      (obj.customer_details && obj.customer_details.email) ||
      null,
    plan:
      obj.plan
        ? (obj.plan.nickname || obj.plan.id || null)
        : (
          obj.items &&
          obj.items.data &&
          obj.items.data[0] &&
          obj.items.data[0].plan
            ? (obj.items.data[0].plan.nickname || obj.items.data[0].plan.id)
            : null
        ),
    amount_cents: obj.amount_total || (obj.plan && obj.plan.amount) || null,
    currency: obj.currency || null,
    subscription_id: obj.subscription || obj.id || null,
  };
}

async function handleLegacyStripeWebhook(req, res) {
  try {
    const rawBody = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

    const sig = req.headers['stripe-signature'] || '';
    if (!verifyWebhookSignature(rawBody, sig)) {
      sendProblem(res, {
        type: PROBLEM_TYPES.WEBHOOK_INVALID,
        title: 'Invalid webhook signature',
        status: 400,
        detail: 'The webhook signature could not be verified.',
      });
      return;
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      sendProblem(res, {
        type: PROBLEM_TYPES.INVALID_JSON,
        title: 'Invalid JSON',
        status: 400,
        detail: 'Invalid JSON in webhook body.',
      });
      return;
    }

    if (LEGACY_STRIPE_EVENT_TYPES.has(event.type)) {
      appendStripeEvent(buildLegacyStripeEventRecord(event));
    }
    sendJson(res, 200, { received: true, event_type: event.type });
  } catch (err) {
    sendProblem(res, {
      type: PROBLEM_TYPES.INTERNAL,
      title: 'Internal Server Error',
      status: 500,
      detail: err.message,
    });
  }
}

function readStripeEvents() {
  ensureStripeEventsDir();
  if (!fs.existsSync(STRIPE_EVENTS_PATH)) return [];
  const lines = fs.readFileSync(STRIPE_EVENTS_PATH, 'utf8').split('\n').filter(Boolean);
  return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function computeConversionStats(events) {
  const active = {};
  const cancelled = new Set();
  for (const ev of events) {
    if (ev.event_type === 'customer.subscription.created' || ev.event_type === 'checkout.session.completed') {
      if (ev.customer_email) active[ev.customer_email] = ev;
    }
    if (ev.event_type === 'customer.subscription.deleted') {
      if (ev.customer_email) cancelled.add(ev.customer_email);
    }
  }
  for (const email of cancelled) delete active[email];
  const subscribers = Object.values(active);
  const mrr = subscribers.reduce((sum, ev) => sum + (ev.amount_cents ? ev.amount_cents / 100 : 0), 0);
  const recent = [...events].reverse().slice(0, 20);
  return { total_subscribers: subscribers.length, mrr_dollars: Math.round(mrr * 100) / 100, recent_events: recent };
}
// ---------------------------------------------------------------------------

function getRequestedProjectSelection(req, parsed) {
  const projectFromQuery = parsed && parsed.searchParams
    ? parsed.searchParams.get('project')
    : null;
  const projectFromHeaders = req && req.headers
    ? req.headers['x-thumbgate-project-dir'] || req.headers['x-thumbgate-project']
    : null;
  return projectFromQuery || projectFromHeaders || null;
}

function getEffectiveRequestedProjectSelection(req, parsed) {
  return isProjectSelectionAllowed(req, parsed)
    ? getRequestedProjectSelection(req, parsed)
    : null;
}

function isProjectSelectionAllowed(req, parsed) {
  const explicitProject = getRequestedProjectSelection(req, parsed);
  if (!explicitProject) return true;
  return isLoopbackHost(getRequestHostHeader(req));
}

function resolveRequestProjectDir(req, parsed) {
  const explicitProject = getEffectiveRequestedProjectSelection(req, parsed);
  return resolveProjectDir({
    projectDir: explicitProject,
    env: process.env,
  });
}

function shouldPreferProjectScopedFeedback(req, parsed) {
  const explicitProject = getEffectiveRequestedProjectSelection(req, parsed);
  if (explicitProject) return true;
  if (process.env.THUMBGATE_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR) return true;
  if (process.env.THUMBGATE_FEEDBACK_DIR) return false;
  return Boolean(readActiveProjectState({ env: process.env }));
}

function getRequestFeedbackPaths(req, parsed) {
  const explicitProject = getEffectiveRequestedProjectSelection(req, parsed);
  return getFeedbackPaths({
    projectDir: resolveRequestProjectDir(req, parsed),
    explicitProjectDir: explicitProject,
    skipExplicitFeedbackDir: shouldPreferProjectScopedFeedback(req, parsed),
  });
}

function getSafeDataDir(req, parsed) {
  const { FEEDBACK_LOG_PATH } = getRequestFeedbackPaths(req, parsed);
  return path.resolve(path.dirname(FEEDBACK_LOG_PATH));
}

function findRecordById(id, feedbackDir) {
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  let memoryRecord = null;
  let feedbackEvent = null;
  const memoryRecords = readLessonJsonl(memoryLogPath, { maxLines: 0 });
  for (const rec of memoryRecords) {
    if (rec.id === id) { memoryRecord = rec; break; }
  }
  const feedbackRecords = readLessonJsonl(feedbackLogPath, { maxLines: 0 });
  for (const rec of feedbackRecords) {
    if (rec.id === id) { feedbackEvent = rec; break; }
  }
  if (!memoryRecord && !feedbackEvent) return null;
  return { feedbackEvent, memoryRecord };
}

function mergeFollowUpDetail(existingDetail, followUpText) {
  const existing = normalizeNullableText(existingDetail);
  const next = normalizeNullableText(followUpText);
  if (!next) return existing;
  if (!existing) return next;
  if (existing.includes(next)) return existing;
  return `${existing}\n\nFollow-up: ${next}`;
}

function updateLessonRecord(feedbackDir, lessonId, updater) {
  const record = findRecordById(lessonId, feedbackDir);
  if (!record) return null;
  const existing = { ...(record.feedbackEvent || {}), ...(record.memoryRecord || {}) };
  const updated = updater({ ...existing });
  if (!updated) return null;
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const updatedMemory = updateLessonJsonlRecord(memoryLogPath, lessonId, updated);
  const updatedFeedback = updateLessonJsonlRecord(feedbackLogPath, lessonId, updated);
  if (!updatedMemory && !updatedFeedback) return null;
  return updated;
}

function getPublicMcpTools() {
  return MCP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

function getServerCardTools() {
  return MCP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

function buildPublicUrl(hostedConfig, pathname) {
  return `${hostedConfig.appOrigin}${pathname}`;
}

const VERIFICATION_EVIDENCE_URL = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md';

function getToolDiscoveryIndex(hostedConfig) {
  return MCP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    annotations: tool.annotations || {},
    schemaUrl: buildPublicUrl(hostedConfig, `/.well-known/mcp/tools/${encodeURIComponent(tool.name)}.json`),
  }));
}

function getContextFootprintReport(hostedConfig) {
  return buildContextFootprintReport({
    tools: MCP_TOOLS,
    schemaUrlTemplate: buildPublicUrl(hostedConfig, '/.well-known/mcp/tools/{name}.json'),
  });
}

function getMcpSkillManifests(hostedConfig) {
  return [
    {
      name: 'thumbgate',
      title: 'ThumbGate Pre-Action Gates',
      description: 'Capture feedback, recall lessons, generate rules, and block repeated agent mistakes before tool execution.',
      triggers: ['thumbgate', 'pre-action gates', 'prevent repeated AI mistakes', 'agent feedback', 'PreToolUse hooks'],
      recommendedFlow: [
        'Recall lessons before risky work.',
        'Plan high-risk actions with checkpoints.',
        'Capture concrete thumbs-down/up feedback.',
        'Inspect prevention_rules after repeats.',
      ],
      installCommand: 'npx thumbgate init',
      contextUrl: buildPublicUrl(hostedConfig, '/public/llm-context.md'),
      proofUrl: VERIFICATION_EVIDENCE_URL,
    },
    {
      name: 'workflow-hardening-sprint',
      title: 'Workflow Hardening Sprint',
      description: 'Turn one repeated agent failure into an enforced gate with proof and rollout evidence.',
      triggers: ['workflow hardening', 'team rollout', 'agent governance', 'approval boundary', 'audit trail'],
      recommendedFlow: [
        'Pick one costly repeated failure.',
        'Import the policy or runbook.',
        'Ship the gate with dashboard proof.',
      ],
      intakeUrl: buildPublicUrl(hostedConfig, '/#workflow-sprint-intake'),
      proofUrl: VERIFICATION_EVIDENCE_URL,
    },
    {
      name: 'visual-proof-retrieval',
      title: 'Visual Proof Retrieval',
      description: 'Use screenshots, PDF pages, dashboard captures, and proof artifacts as searchable evidence for agent-governance claims.',
      triggers: ['visual document retrieval', 'multimodal embeddings', 'screenshots', 'PDF evidence', 'proof artifacts'],
      recommendedFlow: [
        'Plan the corpus and Matryoshka dimension budget.',
        'Baseline text-only retrieval before finetuning.',
        'Evaluate NDCG@10 on visual hard negatives.',
        'Require artifact links before using retrieved evidence in claims.',
      ],
      contextUrl: buildPublicUrl(hostedConfig, '/public/llm-context.md'),
      proofUrl: VERIFICATION_EVIDENCE_URL,
    },
    {
      name: 'context-footprint-optimizer',
      title: 'Context Footprint Optimizer',
      description: 'Measure MCP schema payloads and feedback-context packs before spending model context on them.',
      triggers: ['context compression', 'token savings', 'progressive discovery', 'MCP schema loading', 'context budget'],
      recommendedFlow: [
        'Measure full schema or memory payload footprint.',
        'Load the slim index first, then fetch only selected tool schemas.',
        'Compact feedback context with anchors for proof-critical lessons.',
        'Record estimated token savings next to the workflow evidence.',
      ],
      contextUrl: buildPublicUrl(hostedConfig, '/public/llm-context.md'),
      footprintUrl: buildPublicUrl(hostedConfig, '/.well-known/mcp/footprint.json'),
      proofUrl: VERIFICATION_EVIDENCE_URL,
    },
    {
      name: 'agent-design-governance',
      title: 'Agent Design Governance',
      description: 'Decide when to stay single-agent, when to split into manager or handoff patterns, and which eval/tool safeguards are required first.',
      triggers: ['agent architecture', 'multi-agent', 'tool overload', 'agent evals', 'agent instructions'],
      recommendedFlow: [
        'Start with a single agent plus clear tools and instructions.',
        'Split only when instruction complexity or tool overload is measured.',
        'Require baseline evals before adding autonomy or subagents.',
        'Classify tool risk before allowing writes, money movement, production changes, or outbound actions.',
      ],
      contextUrl: buildPublicUrl(hostedConfig, '/public/llm-context.md'),
      proofUrl: VERIFICATION_EVIDENCE_URL,
    },
    {
      name: 'proactive-agent-eval-guardrails',
      title: 'Proactive Agent Eval Guardrails',
      description: 'Require state-machine modeling, active user simulation, goal inference, intervention timing, and multi-app orchestration proof before proactive agents write or interrupt users.',
      triggers: ['proactive agents', 'PARE', 'active user simulation', 'intervention timing', 'multi-app orchestration'],
      recommendedFlow: [
        'Model each app as states, actions, and valid transitions.',
        'Simulate active users before enabling anticipatory interventions.',
        'Grade goal inference separately from intervention timing.',
        'Block multi-app proactive writes until rollback and orchestration evidence exists.',
      ],
      contextUrl: buildPublicUrl(hostedConfig, '/public/llm-context.md'),
      proofUrl: VERIFICATION_EVIDENCE_URL,
    },
    {
      name: 'reward-hacking-guardrails',
      title: 'Reward Hacking Guardrails',
      description: 'Catch proxy-optimization failures such as unsupported completion claims, sycophancy, verbosity-as-proof, benchmark overfitting, and evaluator manipulation.',
      triggers: ['reward hacking', 'benchmark overfitting', 'unsupported claims', 'sycophancy', 'verifier theater'],
      recommendedFlow: [
        'Inspect candidate claims for completion, safety, test, or deployment language.',
        'Require proof artifacts before accepting done, fixed, safe, or ready-to-merge claims.',
        'Map every proxy metric to the real user objective.',
        'Require holdout or regression proof before treating benchmark gains as product gains.',
      ],
      contextUrl: buildPublicUrl(hostedConfig, '/public/llm-context.md'),
      proofUrl: VERIFICATION_EVIDENCE_URL,
    },
    {
      name: 'oss-pr-opportunity-scout',
      title: 'OSS PR Opportunity Scout',
      description: 'Find upstream GitHub repositories ThumbGate actually depends on, then rank issue, bounty, and proof-backed PR opportunities without spam.',
      triggers: ['GitHub issues', 'bug bounty', 'upstream PR', 'open source promotion', 'maintainer outreach'],
      recommendedFlow: [
        'Map package dependencies to upstream repositories.',
        'Search only maintainer-visible issues, help-wanted labels, regressions, and bounty surfaces.',
        'Reproduce locally before claiming a fix.',
        'Open one focused PR with tests, proof, and transparent ThumbGate context only when relevant.',
      ],
      contextUrl: buildPublicUrl(hostedConfig, '/public/llm-context.md'),
      proofUrl: VERIFICATION_EVIDENCE_URL,
    },
    {
      name: 'chatgpt-ads-readiness-pack',
      title: 'ChatGPT Ads Readiness Pack',
      description: 'Prepare ThumbGate intent clusters, proof-backed copy, landing routes, and measurement before ChatGPT Ads Manager becomes broadly self-serve.',
      triggers: ['ChatGPT ads', 'AI ads', 'paid AI search', 'Ads Manager', 'agent governance advertising'],
      recommendedFlow: [
        'Submit advertiser interest when eligible.',
        'Cluster high-intent conversational queries around agent governance and repeated workflow failures.',
        'Route self-serve intent to the guide and team pain to Workflow Hardening Sprint intake.',
        'Block unsupported ad and landing-page claims before spend scales.',
      ],
      contextUrl: buildPublicUrl(hostedConfig, '/public/llm-context.md'),
      proofUrl: VERIFICATION_EVIDENCE_URL,
    },
  ];
}

function getMcpApplications(hostedConfig) {
  return [
    {
      name: 'dashboard',
      title: 'ThumbGate Dashboard',
      description: 'Review feedback, gates, blocked actions, funnel metrics, and proof.',
      url: buildPublicUrl(hostedConfig, '/dashboard'),
      useWhen: 'Need proof before approving more autonomy.',
    },
    {
      name: 'lessons',
      title: 'Lessons',
      description: 'Browse promoted lessons and corrective actions.',
      url: buildPublicUrl(hostedConfig, '/lessons'),
      useWhen: 'Need human-approved context before risk.',
    },
    {
      name: 'guide',
      title: 'Setup Guide',
      description: 'Install ThumbGate for Claude Code, Cursor, Codex, Gemini CLI, Amp, OpenCode, and MCP agents.',
      url: buildPublicUrl(hostedConfig, '/guide'),
      useWhen: 'Need setup without searching the repo.',
    },
    {
      name: 'workflow-sprint-intake',
      title: 'Workflow Hardening Sprint Intake',
      description: 'Submit a repeated agent failure for a proof-backed sprint.',
      url: buildPublicUrl(hostedConfig, '/#workflow-sprint-intake'),
      useWhen: 'Ready to convert mistakes into gates.',
    },
  ];
}

function getMcpDiscoveryManifest(hostedConfig) {
  return {
    schemaVersion: '2026-04-20',
    name: 'thumbgate',
    title: 'ThumbGate',
    version: pkg.version,
    description: 'Pre-Action Gates for AI coding agents: feedback, recall, prevention rules, and tool-call blocking.',
    homepage: hostedConfig.appOrigin,
    repository: 'https://github.com/IgorGanapolsky/ThumbGate',
    package: {
      registry: 'npm',
      name: 'thumbgate',
      installCommand: 'npx thumbgate init',
    },
    transport: {
      type: 'streamable-http',
      endpoint: buildPublicUrl(hostedConfig, '/mcp'),
      unauthenticatedDiscovery: ['initialize', 'tools/list'],
      authenticatedMethods: ['tools/call'],
    },
    discovery: {
      serverCardUrl: buildPublicUrl(hostedConfig, '/.well-known/mcp/server-card.json'),
      toolIndexUrl: buildPublicUrl(hostedConfig, '/.well-known/mcp/tools.json'),
      toolSchemaUrlTemplate: buildPublicUrl(hostedConfig, '/.well-known/mcp/tools/{name}.json'),
      footprintUrl: buildPublicUrl(hostedConfig, '/.well-known/mcp/footprint.json'),
      skillsUrl: buildPublicUrl(hostedConfig, '/.well-known/mcp/skills.json'),
      applicationsUrl: buildPublicUrl(hostedConfig, '/.well-known/mcp/applications.json'),
      llmsTxtUrl: buildPublicUrl(hostedConfig, '/.well-known/llms.txt'),
      progressive: {
        pattern: 'Load manifest, inspect tools.json, fetch one tool schema only when needed.',
        tokenStrategy: 'Do not preload every inputSchema. Use per-tool schema URLs.',
      },
    },
    primaryFlows: [
      {
        name: 'capture-to-gate',
        description: 'Capture feedback, retrieve lessons, generate rules, enforce a gate.',
        tools: ['capture_feedback', 'search_lessons', 'prevention_rules', 'gate_stats'],
      },
      {
        name: 'safe-autonomous-work',
        description: 'Plan high-risk work, recall lessons, diagnose failures.',
        tools: ['plan_intent', 'recall', 'diagnose_failure', 'feedback_summary'],
      },
      {
        name: 'team-rollout-proof',
        description: 'Show dashboard evidence, metrics, and sprint proof.',
        tools: ['dashboard', 'get_business_metrics', 'construct_context_pack'],
      },
      {
        name: 'metric-autoresearch',
        description: 'Run bounded baseline -> hypothesis -> holdout loops with keep/discard proof.',
        tools: ['get_business_metrics', 'construct_context_pack', 'run_autoresearch', 'require_evidence_for_claim'],
      },
      {
        name: 'visual-proof-retrieval',
        description: 'Plan screenshot/PDF/proof-artifact retrieval before investing in multimodal finetuning.',
        tools: ['plan_multimodal_retrieval', 'search_thumbgate', 'construct_context_pack', 'require_evidence_for_claim'],
      },
      {
        name: 'context-footprint-optimizer',
        description: 'Measure MCP schema and feedback-context footprint before loading large manifests into model context.',
        tools: ['plan_context_footprint', 'construct_context_pack', 'context_provenance'],
      },
      {
        name: 'agent-design-governance',
        description: 'Evaluate agent architecture, instruction quality, tool risk, and baseline eval readiness before adding subagents or autonomy.',
        tools: ['plan_agent_design_governance', 'search_lessons', 'diagnose_failure', 'require_evidence_for_claim'],
      },
      {
        name: 'proactive-agent-eval-guardrails',
        description: 'Evaluate proactive-agent state modeling, active-user simulation, goal inference, timing, and multi-app write readiness.',
        tools: ['plan_proactive_agent_eval_guardrails', 'require_evidence_for_claim', 'workflow_sentinel'],
      },
      {
        name: 'reward-hacking-guardrails',
        description: 'Detect proxy-optimization failures before accepting completion claims, benchmark wins, verifier approvals, or multimodal assertions.',
        tools: ['plan_reward_hacking_guardrails', 'require_evidence_for_claim', 'verify_claim'],
      },
      {
        name: 'oss-pr-opportunity-scout',
        description: 'Rank upstream repositories for proof-backed issue fixes and PR opportunities using ThumbGate dependency evidence.',
        tools: ['plan_oss_pr_opportunity_scout', 'require_evidence_for_claim', 'track_action'],
      },
      {
        name: 'chatgpt-ads-readiness-pack',
        description: 'Prepare AI-ads intent clusters, copy, proof links, and measurement gates for ThumbGate campaigns.',
        tools: ['plan_chatgpt_ads_readiness', 'require_evidence_for_claim', 'get_business_metrics'],
      },
    ],
    skills: getMcpSkillManifests(hostedConfig),
    applications: getMcpApplications(hostedConfig),
    footprint: getContextFootprintReport(hostedConfig),
    proof: {
      verificationEvidenceUrl: VERIFICATION_EVIDENCE_URL,
      llmContextUrl: buildPublicUrl(hostedConfig, '/public/llm-context.md'),
    },
  };
}

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeNullableText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function pickFirstText(...values) {
  for (const value of values) {
    const normalized = normalizeNullableText(value);
    if (normalized) return normalized;
  }
  return null;
}

function parseReferrerHost(referrer) {
  const normalized = normalizeNullableText(referrer);
  if (!normalized) return null;
  try {
    return new URL(normalized).host || null;
  } catch {
    return null;
  }
}

function parseRedditCommunity(referrer) {
  const normalized = normalizeNullableText(referrer);
  if (!normalized) return null;
  try {
    const ref = new URL(normalized);
    const parts = ref.pathname.split('/').filter(Boolean);
    const index = parts.findIndex((part) => part.toLowerCase() === 'r');
    return index !== -1 && parts[index + 1] ? parts[index + 1] : null;
  } catch {
    return null;
  }
}

function inferSearchSurface(referrerHost) {
  const normalizedHost = normalizeNullableText(referrerHost);
  if (!normalizedHost) return null;
  const host = normalizedHost.toLowerCase();
  if (/(^|\.)reddit\.com$/.test(host) || host === 'redd.it') return 'reddit';
  if (/(^|\.)google\.com$/.test(host)) return 'google_search';
  if (/(^|\.)bing\.com$/.test(host)) return 'bing_search';
  if (/(^|\.)duckduckgo\.com$/.test(host)) return 'duckduckgo_search';
  if (/(^|\.)search\.yahoo\.com$/.test(host)) return 'yahoo_search';
  if (/(^|\.)search\.brave\.com$/.test(host)) return 'brave_search';
  if (/(^|\.)ecosia\.org$/.test(host)) return 'ecosia_search';
  if (/(^|\.)perplexity\.ai$/.test(host)) return 'perplexity';
  if (host === 'chat.openai.com' || /(^|\.)chatgpt\.com$/.test(host)) return 'chatgpt';
  if (/(^|\.)claude\.ai$/.test(host)) return 'claude';
  if (/(^|\.)gemini\.google\.com$/.test(host)) return 'gemini';
  return null;
}

function inferSource(referrerHost) {
  const surface = inferSearchSurface(referrerHost);
  if (surface === 'reddit') return 'reddit';
  if (surface && /_search$/.test(surface)) return 'organic_search';
  if (surface) return 'ai_search';
  return 'website';
}

function inferSearchQuery(referrer) {
  const normalized = normalizeNullableText(referrer);
  if (!normalized) return null;
  try {
    const ref = new URL(normalized);
    for (const key of ['q', 'query', 'p']) {
      const value = ref.searchParams.get(key);
      if (value && value.trim()) {
        return value.trim().slice(0, 160);
      }
    }
  } catch {
    return null;
  }
  return null;
}

function getAttributionValue(params, key, fallbackValue) {
  const value = params.get(key);
  return value && value.trim() ? value.trim() : fallbackValue;
}

function parseUrlSearchParams(urlValue) {
  const normalized = normalizeNullableText(urlValue);
  if (!normalized) return new URLSearchParams();
  try {
    return new URL(normalized).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function parseCookies(headerValue) {
  const cookies = {};
  const raw = normalizeNullableText(headerValue);
  if (!raw) return cookies;
  for (const chunk of raw.split(';')) {
    const [name, ...rest] = chunk.split('=');
    const key = normalizeNullableText(name);
    if (!key) continue;
    const value = normalizeNullableText(rest.join('='));
    if (!value) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(String(value))}`];
  parts.push(`Path=${options.path || '/'}`);
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return forwardedProto === 'https' || Boolean(req.socket && req.socket.encrypted);
}

function resolveJourneyState(req, parsed) {
  const params = parsed ? parsed.searchParams : new URLSearchParams();
  const cookies = parseCookies(req.headers.cookie);
  const visitorId = pickFirstText(
    params.get('visitor_id'),
    params.get('install_id'),
    cookies[VISITOR_COOKIE_NAME]
  ) || createJourneyId('visitor');
  const sessionId = pickFirstText(
    params.get('visitor_session_id'),
    params.get('session_id'),
    cookies[SESSION_COOKIE_NAME]
  ) || createJourneyId('session');
  const acquisitionId = pickFirstText(
    params.get('acquisition_id'),
    cookies[ACQUISITION_COOKIE_NAME]
  ) || createJourneyId('acq');
  const secure = isSecureRequest(req);
  const setCookieHeaders = [];

  if (cookies[VISITOR_COOKIE_NAME] !== visitorId) {
    setCookieHeaders.push(serializeCookie(VISITOR_COOKIE_NAME, visitorId, {
      maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
      secure,
    }));
  }
  if (cookies[SESSION_COOKIE_NAME] !== sessionId) {
    setCookieHeaders.push(serializeCookie(SESSION_COOKIE_NAME, sessionId, { secure }));
  }
  if (cookies[ACQUISITION_COOKIE_NAME] !== acquisitionId) {
    setCookieHeaders.push(serializeCookie(ACQUISITION_COOKIE_NAME, acquisitionId, { secure }));
  }

  return {
    visitorId,
    sessionId,
    acquisitionId,
    setCookieHeaders,
  };
}

function buildLandingAttribution(parsed, req) {
  const params = parsed.searchParams;
  const referrer = pickFirstText(req.headers.referer, req.headers.referrer);
  const referrerHost = parseReferrerHost(referrer);
  const seoSurface = getAttributionValue(params, 'seo_surface', inferSearchSurface(referrerHost));
  const source = getAttributionValue(params, 'utm_source', inferSource(referrerHost));
  const community = getAttributionValue(
    params,
    'community',
    getAttributionValue(params, 'subreddit', parseRedditCommunity(referrer))
  );

  return {
    source,
    utmSource: source,
    utmMedium: getAttributionValue(
      params,
      'utm_medium',
      source === 'reddit' ? 'organic_social' : 'landing_page'
    ),
    utmCampaign: getAttributionValue(
      params,
      'utm_campaign',
      source === 'reddit' ? 'reddit_organic' : 'organic'
    ),
    utmContent: getAttributionValue(params, 'utm_content', null),
    utmTerm: getAttributionValue(params, 'utm_term', null),
    creator: getAttributionValue(params, 'creator', getAttributionValue(params, 'creator_handle', null)),
    community,
    postId: getAttributionValue(params, 'post_id', null),
    commentId: getAttributionValue(params, 'comment_id', null),
    campaignVariant: getAttributionValue(params, 'campaign_variant', null),
    offerCode: getAttributionValue(params, 'offer_code', null),
    landingPath: parsed.pathname || '/',
    page: parsed.pathname || '/',
    referrer,
    referrerHost,
    seoSurface,
    seoQuery: getAttributionValue(params, 'seo_query', inferSearchQuery(referrer)),
  };
}

function buildReferrerAttribution(req) {
  const referrer = pickFirstText(req.headers.referer, req.headers.referrer);
  const referrerHost = parseReferrerHost(referrer);
  const params = parseUrlSearchParams(referrer);
  const source = getAttributionValue(params, 'utm_source', inferSource(referrerHost));
  const community = getAttributionValue(
    params,
    'community',
    getAttributionValue(params, 'subreddit', parseRedditCommunity(referrer))
  );
  return {
    source,
    utmSource: source,
    utmMedium: getAttributionValue(
      params,
      'utm_medium',
      source === 'reddit' ? 'organic_social' : 'workflow_sprint_intake'
    ),
    utmCampaign: getAttributionValue(
      params,
      'utm_campaign',
      source === 'reddit' ? 'reddit_organic' : 'workflow_hardening_sprint'
    ),
    utmContent: getAttributionValue(params, 'utm_content', null),
    utmTerm: getAttributionValue(params, 'utm_term', null),
    creator: getAttributionValue(params, 'creator', getAttributionValue(params, 'creator_handle', null)),
    community,
    postId: getAttributionValue(params, 'post_id', null),
    commentId: getAttributionValue(params, 'comment_id', null),
    campaignVariant: getAttributionValue(params, 'campaign_variant', null),
    offerCode: getAttributionValue(params, 'offer_code', null),
    referrer,
    referrerHost,
    seoSurface: getAttributionValue(params, 'seo_surface', inferSearchSurface(referrerHost)),
    seoQuery: getAttributionValue(params, 'seo_query', inferSearchQuery(referrer)),
    landingPath: (() => {
      try {
        return new URL(referrer).pathname || '/';
      } catch {
        return '/';
      }
    })(),
    page: (() => {
      try {
        return new URL(referrer).pathname || '/';
      } catch {
        return '/';
      }
    })(),
  };
}

function buildCheckoutAttributionMetadata(body, req, traceId) {
  const rawMetadata = body && body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  const utmSource = pickFirstText(rawMetadata.utmSource, body.utmSource, rawMetadata.source, body.source);
  const utmMedium = pickFirstText(rawMetadata.utmMedium, body.utmMedium, 'checkout_api');
  const referrer = pickFirstText(rawMetadata.referrer, body.referrer, req.headers.referer, req.headers.referrer);
  const planId = normalizePlanId(pickFirstText(rawMetadata.planId, body.planId, 'pro'));
  const billingCycle = normalizeBillingCycle(
    pickFirstText(rawMetadata.billingCycle, rawMetadata.billing_cycle, body.billingCycle, body.billing_cycle, 'monthly')
  );
  const seatCount = planId === 'team'
    ? normalizeSeatCount(pickFirstText(rawMetadata.seatCount, rawMetadata.seat_count, body.seatCount, body.seat_count))
    : 1;

  return {
    ...rawMetadata,
    traceId,
    acquisitionId: pickFirstText(rawMetadata.acquisitionId, body.acquisitionId),
    visitorId: pickFirstText(rawMetadata.visitorId, body.visitorId),
    sessionId: pickFirstText(rawMetadata.sessionId, body.sessionId),
    source: pickFirstText(rawMetadata.source, body.source, utmSource, 'direct'),
    utmSource,
    utmMedium,
    utmCampaign: pickFirstText(rawMetadata.utmCampaign, body.utmCampaign),
    utmContent: pickFirstText(rawMetadata.utmContent, body.utmContent),
    utmTerm: pickFirstText(rawMetadata.utmTerm, body.utmTerm),
    creator: pickFirstText(rawMetadata.creator, rawMetadata.creatorHandle, rawMetadata.creator_handle, body.creator, body.creatorHandle, body.creator_handle),
    community: pickFirstText(rawMetadata.community, rawMetadata.subreddit, body.community, body.subreddit),
    postId: pickFirstText(rawMetadata.postId, rawMetadata.post_id, body.postId, body.post_id),
    commentId: pickFirstText(rawMetadata.commentId, rawMetadata.comment_id, body.commentId, body.comment_id),
    campaignVariant: pickFirstText(rawMetadata.campaignVariant, rawMetadata.variant, body.campaignVariant, body.variant),
    offerCode: pickFirstText(rawMetadata.offerCode, rawMetadata.offer, rawMetadata.coupon, body.offerCode, body.offer, body.coupon),
    referrer,
    referrerHost: pickFirstText(rawMetadata.referrerHost, body.referrerHost, parseReferrerHost(referrer)),
    landingPath: pickFirstText(rawMetadata.landingPath, body.landingPath, body.page),
    ctaId: pickFirstText(rawMetadata.ctaId, body.ctaId),
    ctaPlacement: pickFirstText(rawMetadata.ctaPlacement, body.ctaPlacement),
    planId,
    billingCycle,
    seatCount,
  };
}

function buildCheckoutPageTelemetryMetadata(parsed, req, journeyState, page) {
  const params = parsed.searchParams;
  const referrer = pickFirstText(
    params.get('referrer'),
    req.headers.referer,
    req.headers.referrer
  );
  const referrerHost = pickFirstText(params.get('referrer_host'), parseReferrerHost(referrer));
  const source = pickFirstText(params.get('source'), params.get('utm_source'), inferSource(referrerHost));
  const planId = normalizePlanId(pickFirstText(params.get('plan_id'), 'pro'));
  const billingCycle = normalizeBillingCycle(pickFirstText(params.get('billing_cycle'), 'monthly'));
  const seatCount = planId === 'team'
    ? normalizeSeatCount(pickFirstText(params.get('seat_count')))
    : 1;

  return {
    clientType: 'web',
    installId: pickFirstText(params.get('install_id')),
    acquisitionId: journeyState.acquisitionId,
    visitorId: journeyState.visitorId,
    sessionId: journeyState.sessionId,
    traceId: pickFirstText(params.get('trace_id')),
    source,
    utmSource: pickFirstText(params.get('utm_source'), source),
    utmMedium: pickFirstText(params.get('utm_medium'), page === '/cancel' ? 'checkout_cancel' : 'checkout_success'),
    utmCampaign: pickFirstText(params.get('utm_campaign')),
    utmContent: pickFirstText(params.get('utm_content')),
    utmTerm: pickFirstText(params.get('utm_term')),
    creator: pickFirstText(params.get('creator'), params.get('creator_handle')),
    community: pickFirstText(params.get('community'), params.get('subreddit')),
    postId: pickFirstText(params.get('post_id')),
    commentId: pickFirstText(params.get('comment_id')),
    campaignVariant: pickFirstText(params.get('campaign_variant')),
    offerCode: pickFirstText(params.get('offer_code')),
    ctaId: pickFirstText(params.get('cta_id')),
    ctaPlacement: pickFirstText(params.get('cta_placement')),
    planId,
    billingCycle,
    seatCount,
    landingPath: pickFirstText(params.get('landing_path'), '/'),
    page,
    referrer,
    referrerHost,
  };
}

function resolveBillingSummaryOptions(parsed) {
  return resolveAnalyticsWindow({
    window: parsed.searchParams.get('window'),
    timeZone: parsed.searchParams.get('timezone'),
    now: parsed.searchParams.get('now'),
  });
}

function sendInvalidAnalyticsWindowProblem(res, title, err) {
  sendProblem(res, {
    type: PROBLEM_TYPES.INVALID_REQUEST,
    title,
    status: 400,
    detail: err && err.message ? err.message : 'Invalid analytics window request.',
  });
}

function resolveBillingSummaryOptionsOrRespondProblem(res, parsed, invalidTitle) {
  try {
    return resolveBillingSummaryOptions(parsed);
  } catch (err) {
    sendInvalidAnalyticsWindowProblem(res, invalidTitle, err);
    return null;
  }
}

async function buildLiveDashboardData(parsed, feedbackDir) {
  const summaryOptions = resolveBillingSummaryOptions(parsed);
  const billingSummary = await getBillingSummaryLive(summaryOptions);
  const data = generateDashboard(feedbackDir, {
    analyticsWindow: summaryOptions,
    billingSummary,
    billingSource: 'live',
    authContext: { tier: 'pro' },
  });
  return { summaryOptions, data };
}

async function loadLiveDashboardDataOrRespondProblem(res, parsed, feedbackDir, invalidTitle) {
  try {
    return await buildLiveDashboardData(parsed, feedbackDir);
  } catch (err) {
    sendInvalidAnalyticsWindowProblem(res, invalidTitle, err);
    return null;
  }
}

function buildLossAnalyticsResponse(data, summaryOptions) {
  return {
    window: data.analytics.window || summaryOptions,
    lossAnalysis: data.analytics.lossAnalysis || null,
    buyerLoss: data.analytics.buyerLoss || null,
    funnel: data.analytics.funnel || null,
    revenue: data.analytics.revenue || null,
    telemetry: {
      conversionFunnel: data.analytics.telemetry && data.analytics.telemetry.conversionFunnel,
      behavior: data.analytics.telemetry && data.analytics.telemetry.behavior,
      ctas: data.analytics.telemetry && data.analytics.telemetry.ctas,
      visitors: data.analytics.telemetry && data.analytics.telemetry.visitors,
    },
  };
}

function createJourneyId(prefix) {
  return createTraceId(prefix).replace(/^trace_/, `${prefix}_`);
}

function appendQueryParam(url, key, value) {
  const normalized = normalizeNullableText(value);
  if (normalized) {
    url.searchParams.set(key, normalized);
  }
}

function appendVisitorSessionQueryParam(url, value) {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return;
  }

  if (url.searchParams.has('session_id')) {
    url.searchParams.set('visitor_session_id', normalized);
    return;
  }

  url.searchParams.set('session_id', normalized);
}

function restoreStripeCheckoutPlaceholder(urlString) {
  return String(urlString).replace(/%7BCHECKOUT_SESSION_ID%7D/g, '{CHECKOUT_SESSION_ID}');
}

function buildCheckoutFallbackUrl(baseUrl, metadata = {}) {
  const url = new URL(baseUrl);
  appendQueryParam(url, 'utm_source', metadata.utmSource || metadata.source);
  appendQueryParam(url, 'utm_medium', metadata.utmMedium);
  appendQueryParam(url, 'utm_campaign', metadata.utmCampaign);
  appendQueryParam(url, 'utm_content', metadata.utmContent);
  appendQueryParam(url, 'utm_term', metadata.utmTerm);
  appendQueryParam(url, 'creator', metadata.creator);
  appendQueryParam(url, 'community', metadata.community);
  appendQueryParam(url, 'post_id', metadata.postId);
  appendQueryParam(url, 'comment_id', metadata.commentId);
  appendQueryParam(url, 'campaign_variant', metadata.campaignVariant);
  appendQueryParam(url, 'offer_code', metadata.offerCode);
  appendQueryParam(url, 'trace_id', metadata.traceId);
  appendQueryParam(url, 'acquisition_id', metadata.acquisitionId);
  appendQueryParam(url, 'visitor_id', metadata.visitorId);
  appendVisitorSessionQueryParam(url, metadata.sessionId);
  appendQueryParam(url, 'cta_id', metadata.ctaId);
  appendQueryParam(url, 'cta_placement', metadata.ctaPlacement);
  appendQueryParam(url, 'plan_id', metadata.planId);
  appendQueryParam(url, 'billing_cycle', metadata.billingCycle);
  appendQueryParam(url, 'seat_count', metadata.seatCount);
  appendQueryParam(url, 'landing_path', metadata.landingPath);
  appendQueryParam(url, 'referrer_host', metadata.referrerHost);
  return restoreStripeCheckoutPlaceholder(url.toString());
}

function buildCheckoutIntentHref(baseUrl, metadata = {}, overrides = {}) {
  return buildCheckoutFallbackUrl(baseUrl, {
    ...metadata,
    ...overrides,
  });
}

function renderCheckoutIntentPage({
  confirmHref,
  workflowIntakeHref,
  teamOptionsHref,
  diagnosticCheckoutHref,
  sprintCheckoutHref,
  sprintDiagnosticPriceDollars = 499,
  workflowSprintPriceDollars = 1500,
}) {
  const safeConfirmHref = escapeHtmlAttribute(confirmHref);
  const safeWorkflowIntakeHref = escapeHtmlAttribute(workflowIntakeHref);
  const safeTeamOptionsHref = escapeHtmlAttribute(teamOptionsHref);
  const safeDiagnosticCheckoutHref = diagnosticCheckoutHref
    ? escapeHtmlAttribute(diagnosticCheckoutHref)
    : '';
  const safeSprintCheckoutHref = sprintCheckoutHref
    ? escapeHtmlAttribute(sprintCheckoutHref)
    : '';
  const diagnosticAction = safeDiagnosticCheckoutHref
    ? `<a data-i="sprint_diagnostic_checkout" href="${safeDiagnosticCheckoutHref}">Book $${sprintDiagnosticPriceDollars} diagnostic</a>`
    : '';
  const sprintAction = safeSprintCheckoutHref
    ? `<a data-i="workflow_sprint_checkout" href="${safeSprintCheckoutHref}">Start $${workflowSprintPriceDollars} sprint</a>`
    : '';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0a0a0a;color:#eee;font-family:system-ui,sans-serif}div{max-width:560px;margin:12vh auto}a{display:block;margin:10px 0;padding:12px;border:1px solid #374151;color:inherit;text-align:center}.primary{background:#22d3ee;color:#000}</style><div><h1>Choose the right paid path.</h1><p>Pick Pro, diagnostic, sprint, or intake.</p><a class="primary" data-i="pro_checkout_confirmed" href="${safeConfirmHref}">Continue to Stripe</a>${diagnosticAction}${sprintAction}<a data-i="workflow_sprint_intake" href="${safeWorkflowIntakeHref}">Send workflow first</a><a data-i="team_paid_path" href="${safeTeamOptionsHref}">See diagnostic and sprint options</a><p>Stripe checkout.</p><a href="/">Back</a></div><script>addEventListener('click',e=>{let a=e.target.closest('[data-i]');if(a&&navigator.sendBeacon)navigator.sendBeacon('/v1/telemetry/ping',new Blob([JSON.stringify({eventType:'checkout_interstitial_cta_clicked',clientType:'web',page:'/checkout/pro',ctaId:a.dataset.i,ctaPlacement:'checkout_interstitial'})],{type:'application/json'}))})</script>`;
}

function buildCheckoutBootstrapBody(parsed, req, journeyState = resolveJourneyState(req, parsed)) {
  const params = parsed.searchParams;
  const traceId = pickFirstText(params.get('trace_id')) || createJourneyId('checkout');
  const planId = normalizePlanId(pickFirstText(params.get('plan_id'), 'pro'));
  const billingCycle = normalizeBillingCycle(pickFirstText(params.get('billing_cycle'), 'monthly'));
  const seatCount = planId === 'team'
    ? normalizeSeatCount(pickFirstText(params.get('seat_count')))
    : 1;
  return {
    traceId,
    installId: pickFirstText(params.get('install_id')),
    acquisitionId: journeyState.acquisitionId,
    visitorId: journeyState.visitorId,
    sessionId: journeyState.sessionId,
    customerEmail: pickFirstText(params.get('customer_email')),
    source: pickFirstText(params.get('source'), params.get('utm_source'), 'website'),
    utmSource: pickFirstText(params.get('utm_source'), params.get('source'), 'website'),
    utmMedium: pickFirstText(params.get('utm_medium'), 'cta_button'),
    utmCampaign: pickFirstText(params.get('utm_campaign'), 'pro_pack'),
    utmContent: pickFirstText(params.get('utm_content')),
    utmTerm: pickFirstText(params.get('utm_term')),
    creator: pickFirstText(params.get('creator'), params.get('creator_handle')),
    community: pickFirstText(params.get('community'), params.get('subreddit')),
    postId: pickFirstText(params.get('post_id')),
    commentId: pickFirstText(params.get('comment_id')),
    campaignVariant: pickFirstText(params.get('campaign_variant')),
    offerCode: pickFirstText(params.get('offer_code')),
    landingPath: pickFirstText(params.get('landing_path'), req.headers.referer ? '/' : '/'),
    referrerHost: pickFirstText(params.get('referrer_host')),
    ctaId: pickFirstText(params.get('cta_id'), 'pricing_pro'),
    ctaPlacement: pickFirstText(params.get('cta_placement'), 'pricing'),
    planId,
    billingCycle,
    seatCount,
    metadata: {
      referrer: pickFirstText(params.get('referrer'), req.headers.referer, req.headers.referrer),
      landingPath: pickFirstText(params.get('landing_path'), '/'),
      referrerHost: pickFirstText(params.get('referrer_host')),
    },
  };
}

function buildCheckoutConfirmHref(parsed) {
  const confirmUrl = new URL('/checkout/pro', 'https://thumbgate.invalid');
  confirmUrl.searchParams.set('confirm', '1');
  for (const [key, value] of parsed.searchParams.entries()) {
    if (key === 'confirm') continue;
    confirmUrl.searchParams.append(key, value);
  }
  return `${confirmUrl.pathname}${confirmUrl.search}`;
}

function normalizeCheckoutCustomerEmail(value) {
  const email = (normalizeNullableText(value) || '').toLowerCase();
  const atIndex = email.indexOf('@');
  const domain = email.slice(atIndex + 1);
  if (!email || email.length > 254 || atIndex <= 0 || atIndex !== email.lastIndexOf('@') || !domain || !domain.includes('.') || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return null;
  for (const ch of email) if (ch <= ' ' || ch === '<' || ch === '>' || ch === '"') return null;
  return email;
}

function renderCheckoutIntentGate(parsed, responseHeaders = {}) {
  let hiddenInputs = '';
  for (const [key, value] of parsed.searchParams.entries()) {
    if (key !== 'confirm' && key !== 'customer_email') hiddenInputs += `<input type=hidden name=${escapeHtmlAttribute(key)} value=${escapeHtmlAttribute(value)}>`;
  }
  return {
    html: `<!doctype html><h1>Email for Stripe receipt</h1><form action=/checkout/pro>${hiddenInputs}<input type=hidden name=confirm value=1><input name=customer_email type=email required><button>Continue</button></form>`,
    headers: responseHeaders,
  };
}

function normalizeTrackedLinkSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function getTrackedLinkTarget(slug) {
  const normalizedSlug = normalizeTrackedLinkSlug(slug);
  return TRACKED_LINK_TARGETS[normalizedSlug]
    ? { slug: normalizedSlug, ...TRACKED_LINK_TARGETS[normalizedSlug] }
    : null;
}

function appendTrackedLinkQueryParams(destinationUrl, parsed, target) {
  const params = parsed.searchParams;
  for (const [key, value] of Object.entries(target.defaults || {})) {
    if (!destinationUrl.searchParams.has(key)) {
      appendQueryParam(destinationUrl, key, value);
    }
  }
  for (const key of TRACKED_LINK_QUERY_KEYS) {
    const value = params.get(key);
    if (value && value.trim()) {
      destinationUrl.searchParams.set(key, value.trim());
    }
  }
  if (target.allowCustomerEmail) {
    appendQueryParam(destinationUrl, 'customer_email', params.get('customer_email'));
  }
  if (!destinationUrl.searchParams.has('cta_id')) {
    appendQueryParam(destinationUrl, 'cta_id', target.ctaId);
  }
  if (!destinationUrl.searchParams.has('cta_placement')) {
    appendQueryParam(destinationUrl, 'cta_placement', target.ctaPlacement);
  }
  if (!destinationUrl.searchParams.has('landing_path')) {
    appendQueryParam(destinationUrl, 'landing_path', `/go/${target.slug}`);
  }
}

function buildTrackedLinkDestination(target, hostedConfig, parsed) {
  const destinationUrl = target.href
    ? new URL(target.href)
    : new URL(target.path || '/', hostedConfig.appOrigin);
  appendTrackedLinkQueryParams(destinationUrl, parsed, target);
  return destinationUrl;
}

function buildTrackedLinkAttribution(target, parsed, req, journeyState, destinationUrl) {
  const params = parsed.searchParams;
  const referrer = pickFirstText(params.get('referrer'), req.headers.referer, req.headers.referrer);
  const referrerHost = pickFirstText(params.get('referrer_host'), parseReferrerHost(referrer));
  const source = pickFirstText(
    params.get('source'),
    params.get('utm_source'),
    target.defaults && target.defaults.utm_source,
    inferSource(referrerHost)
  );

  return {
    eventType: target.eventType || 'cta_click',
    clientType: 'web',
    acquisitionId: journeyState.acquisitionId,
    visitorId: journeyState.visitorId,
    sessionId: journeyState.sessionId,
    installId: pickFirstText(params.get('install_id')),
    traceId: pickFirstText(params.get('trace_id')),
    source,
    utmSource: pickFirstText(params.get('utm_source'), source),
    utmMedium: pickFirstText(params.get('utm_medium'), target.defaults && target.defaults.utm_medium, 'link_router'),
    utmCampaign: pickFirstText(params.get('utm_campaign'), target.defaults && target.defaults.utm_campaign, 'first_party_redirect'),
    utmContent: pickFirstText(params.get('utm_content')),
    utmTerm: pickFirstText(params.get('utm_term')),
    creator: pickFirstText(params.get('creator'), params.get('creator_handle')),
    community: pickFirstText(params.get('community'), params.get('subreddit')),
    postId: pickFirstText(params.get('post_id')),
    commentId: pickFirstText(params.get('comment_id')),
    campaignVariant: pickFirstText(params.get('campaign_variant'), target.defaults && target.defaults.campaign_variant),
    offerCode: pickFirstText(params.get('offer_code')),
    ctaId: pickFirstText(params.get('cta_id'), target.ctaId),
    ctaPlacement: pickFirstText(params.get('cta_placement'), target.ctaPlacement),
    planId: pickFirstText(params.get('plan_id'), target.defaults && target.defaults.plan_id),
    landingPath: pickFirstText(params.get('landing_path'), `/go/${target.slug}`),
    page: `/go/${target.slug}`,
    referrer,
    referrerHost,
    destinationSlug: target.slug,
    destinationPath: target.external ? destinationUrl.host : destinationUrl.pathname,
  };
}

function serveTrackedLinkRedirect({ req, res, parsed, hostedConfig, isHeadRequest, slug }) {
  const target = getTrackedLinkTarget(slug);
  if (!target) {
    sendJson(res, 404, {
      error: 'Tracked link not found',
      allowed: Object.keys(TRACKED_LINK_TARGETS),
    }, {}, {
      headOnly: isHeadRequest,
    });
    return;
  }

  const { FEEDBACK_DIR } = getFeedbackPaths();
  const journeyState = resolveJourneyState(req, parsed);
  const destinationUrl = buildTrackedLinkDestination(target, hostedConfig, parsed);
  if (!isHeadRequest) {
    appendBestEffortTelemetry(
      FEEDBACK_DIR,
      buildTrackedLinkAttribution(target, parsed, req, journeyState, destinationUrl),
      req.headers,
      `tracked_link_redirect:${target.slug}`
    );
  }

  res.writeHead(302, {
    ...(journeyState.setCookieHeaders.length ? { 'Set-Cookie': journeyState.setCookieHeaders } : {}),
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Robots-Tag': 'noindex,nofollow',
    'X-ThumbGate-Link-Slug': target.slug,
    Location: destinationUrl.toString(),
  });
  res.end();
}

function resolveCheckoutOfferSummary(metadata = {}) {
  const commercialOffer = getCommercialOfferModule();
  const planId = normalizePlanId(metadata.planId);
  const billingCycle = normalizeBillingCycle(metadata.billingCycle);

  if (planId === 'team') {
    const seatCount = normalizeSeatCount(metadata.seatCount);
    return {
      planId: 'team',
      billingCycle: 'monthly',
      seatCount,
      type: 'subscription',
      price: commercialOffer.TEAM_MONTHLY_PRICE_DOLLARS * seatCount,
      priceLabel: `$${commercialOffer.TEAM_MONTHLY_PRICE_DOLLARS}/seat/mo`,
    };
  }

  if (billingCycle === 'annual') {
    return {
      planId: 'pro',
      billingCycle: 'annual',
      seatCount: 1,
      type: 'subscription',
      price: commercialOffer.PRO_ANNUAL_PRICE_DOLLARS,
      priceLabel: '$149/yr',
    };
  }

  return {
    planId: 'pro',
    billingCycle: 'monthly',
    seatCount: 1,
    type: 'subscription',
    price: commercialOffer.PRO_MONTHLY_PRICE_DOLLARS,
    priceLabel: '$19/mo',
  };
}

function sendJson(res, statusCode, payload, extraHeaders = {}, options = {}) {
  const { headOnly = false } = options;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(headOnly ? '' : body);
}

function sendText(res, statusCode, text, extraHeaders = {}, options = {}) {
  const { headOnly = false } = options;
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...extraHeaders,
  });
  res.end(headOnly ? '' : text);
}

function sendHtml(res, statusCode, html, extraHeaders = {}, options = {}) {
  const { headOnly = false } = options;
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    ...extraHeaders,
  });
  res.end(headOnly ? '' : html);
}

function getPublicBillingHeaders(traceId = '') {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-ThumbGate-Trace-Id',
    'Access-Control-Expose-Headers': 'X-ThumbGate-Trace-Id',
  };
  if (traceId) {
    headers['X-ThumbGate-Trace-Id'] = traceId;
  }
  return headers;
}

function sendPublicBillingPreflight(res) {
  res.writeHead(204, {
    ...getPublicBillingHeaders(),
    'Access-Control-Max-Age': '86400',
    'Content-Length': '0',
  });
  res.end();
}

function appendBestEffortTelemetry(feedbackDir, payload, headers, context) {
  try {
    appendTelemetryPing(feedbackDir, payload, headers);
    return true;
  } catch (err) {
    try {
      appendDiagnosticRecord({
        source: 'telemetry_emit',
        step: 'telemetry_emit',
        context: `best-effort telemetry write failed during ${context}`,
        metadata: {
          context,
          eventType: payload && (payload.eventType || payload.event) ? payload.eventType || payload.event : 'unknown',
          error: err && err.message ? err.message : 'unknown_error',
        },
        diagnosis: {
          diagnosed: true,
          rootCauseCategory: 'system_failure',
          criticalFailureStep: 'telemetry_emit',
          violations: [{
            constraintId: 'telemetry:emit',
            message: 'Server-side telemetry write failed.',
          }],
          evidence: [err && err.message ? err.message : 'unknown_error'],
        },
      });
    } catch (_) {}
    return false;
  }
}

function getPublicOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim() || 'localhost';
  return `${proto}://${host}`;
}

function renderOpenApiYamlForRequest(yaml, req) {
  return yaml.replace(
    /servers:\n\s+- url: .+/m,
    `servers:\n  - url: ${getPublicOrigin(req)}`
  );
}

function getRequestHostHeader(req) {
  const forwardedHost = req.headers['x-forwarded-host'];
  if (Array.isArray(forwardedHost)) {
    return forwardedHost[0] || req.headers.host || '';
  }
  return forwardedHost || req.headers.host || '';
}

function isLoopbackHost(hostValue) {
  const rawHost = String(hostValue || '').split(',')[0].trim();
  if (!rawHost) {
    return false;
  }

  const hostWithoutPort = rawHost.startsWith('[')
    ? rawHost.slice(1).split(']')[0]
    : rawHost.split(':')[0];
  const normalized = hostWithoutPort.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function wantsJson(req, parsed) {
  if (parsed.searchParams.get('format') === 'json') {
    return true;
  }

  const accept = String(req.headers.accept || '');
  return accept.includes('application/json') && !accept.includes('text/html');
}

function fillTemplate(template, replacements) {
  let output = template;
  for (const [token, value] of Object.entries(replacements)) {
    output = output.split(token).join(String(value));
  }
  return output;
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function stripTrailingSlashes(value) {
  const input = String(value || '');
  let end = input.length;
  while (end > 0 && input[end - 1] === '/') end -= 1;
  return input.slice(0, end);
}

function normalizePublicMarketingHtml(html, runtimeConfig) {
  const appOrigin = runtimeConfig?.appOrigin
    ? stripTrailingSlashes(runtimeConfig.appOrigin)
    : '';
  if (!appOrigin) return html;

  let output = String(html);
  output = output.replaceAll(DEFAULT_PUBLIC_APP_ORIGIN, appOrigin);
  try {
    const host = new URL(appOrigin).host;
    output = output.replaceAll(
      'data-domain="thumbgate-production.up.railway.app"',
      `data-domain="${escapeHtmlAttribute(host)}"`
    );
  } catch {
    // appOrigin is normalized by hosted-config; leave static analytics domains
    // untouched if a future caller deliberately supplies a non-URL value.
  }
  return output;
}

function loadPublicMarketingTemplateHtml(templatePath, runtimeConfig, pageContext = {}) {
  const template = fs.readFileSync(templatePath, 'utf-8');
  const googleSiteVerificationMeta = runtimeConfig.googleSiteVerification
    ? `  <meta name="google-site-verification" content="${escapeHtmlAttribute(runtimeConfig.googleSiteVerification)}" />`
    : '';
  const gaBootstrap = runtimeConfig.gaMeasurementId
    ? [
      `  <script async src="https://www.googletagmanager.com/gtag/js?id=${runtimeConfig.gaMeasurementId}"></script>`,
      '  <script>',
      '    window.dataLayer = window.dataLayer || [];',
      '    function gtag(){dataLayer.push(arguments);}',
      "    gtag('js', new Date());",
      `    gtag('config', '${runtimeConfig.gaMeasurementId}');`,
      '  </script>',
    ].join('\n')
    : '';
  return normalizePublicMarketingHtml(fillTemplate(template, {
    '__PACKAGE_VERSION__': pkg.version,
    '__APP_ORIGIN__': runtimeConfig.appOrigin,
    '__CHECKOUT_ENDPOINT__': runtimeConfig.checkoutEndpoint,
    '__CHECKOUT_FALLBACK_URL__': runtimeConfig.checkoutFallbackUrl,
    '__PRO_PRICE_DOLLARS__': runtimeConfig.proPriceDollars,
    '__PRO_PRICE_LABEL__': runtimeConfig.proPriceLabel,
    '__SPRINT_DIAGNOSTIC_CHECKOUT_URL__': runtimeConfig.sprintDiagnosticCheckoutUrl || '',
    '__WORKFLOW_SPRINT_CHECKOUT_URL__': runtimeConfig.workflowSprintCheckoutUrl || '',
    '__SPRINT_DIAGNOSTIC_PRICE_DOLLARS__': runtimeConfig.sprintDiagnosticPriceDollars || 499,
    '__WORKFLOW_SPRINT_PRICE_DOLLARS__': runtimeConfig.workflowSprintPriceDollars || 1500,
    '__GA_MEASUREMENT_ID__': runtimeConfig.gaMeasurementId || '',
    '__GA_BOOTSTRAP__': gaBootstrap,
    '__GOOGLE_SITE_VERIFICATION_META__': googleSiteVerificationMeta,
    '__SERVER_VISITOR_ID__': pageContext.serverVisitorId || '',
    '__SERVER_SESSION_ID__': pageContext.serverSessionId || '',
    '__SERVER_ACQUISITION_ID__': pageContext.serverAcquisitionId || '',
    '__SERVER_TELEMETRY_CAPTURED__': pageContext.serverTelemetryCaptured ? 'true' : 'false',
    '__VERIFICATION_URL__': 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md',
    '__COMPATIBILITY_REPORT_URL__': 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/proof/compatibility/report.json',
    '__AUTOMATION_REPORT_URL__': 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/proof/automation/report.json',
    '__GTM_PLAN_URL__': 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/GO_TO_MARKET_REVENUE_WEDGE_2026-03.md',
    '__GITHUB_URL__': 'https://github.com/IgorGanapolsky/ThumbGate',
    '__POSTHOG_API_KEY__': runtimeConfig.posthogApiKey || '',
  }), runtimeConfig);
}

function loadLandingPageHtml(runtimeConfig, pageContext = {}) {
  return loadPublicMarketingTemplateHtml(LANDING_PAGE_PATH, runtimeConfig, pageContext);
}

function loadProPageHtml(runtimeConfig, pageContext = {}) {
  return loadPublicMarketingTemplateHtml(PRO_PAGE_PATH, runtimeConfig, pageContext);
}

function readOptionalPublicTemplate(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function resolveLocalPageBootstrap(req, expectedApiKey) {
  const forwardedHost = req.headers['x-forwarded-host'];
  const hostHeader = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || req.headers.host || '';
  const localProBootstrap = process.env.THUMBGATE_PRO_MODE === '1' && Boolean(expectedApiKey) && isLoopbackHost(hostHeader);
  const devOverride = expectedApiKey === null && isLoopbackHost(hostHeader);
  const bootstrapActive = localProBootstrap || devOverride;
  const serializedBootstrapKey = JSON.stringify(localProBootstrap ? expectedApiKey : devOverride ? 'dev-override' : '').replace(/</g, '\\u003c');

  return {
    bootstrapActive,
    serializedBootstrapKey,
  };
}

function renderPackagedDashboardHtml({ bootstrapActive, serializedBootstrapKey }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ThumbGate Dashboard</title>
<style>
:root { color-scheme: light dark; --bg:#0f172a; --panel:#111827; --text:#f8fafc; --muted:#94a3b8; --line:#334155; --accent:#22c55e; }
body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:linear-gradient(135deg,#020617,#111827); color:var(--text); }
main { max-width:920px; margin:0 auto; padding:48px 20px; }
.panel { border:1px solid var(--line); border-radius:20px; background:rgba(15,23,42,.86); padding:28px; box-shadow:0 24px 80px rgba(0,0,0,.32); }
.eyebrow { color:var(--accent); font-size:13px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
h1 { font-size:clamp(32px,5vw,54px); line-height:1; margin:14px 0; }
p { color:var(--muted); font-size:18px; line-height:1.6; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; margin-top:26px; }
a { color:var(--text); text-decoration:none; }
.card { display:block; border:1px solid var(--line); border-radius:16px; padding:18px; background:rgba(30,41,59,.7); }
.card strong { display:block; margin-bottom:8px; }
.card span { color:var(--muted); font-size:14px; line-height:1.5; }
</style>
<script>
window.THUMBGATE_DASHBOARD_BOOTSTRAP = { enabled: ${bootstrapActive ? 'true' : 'false'}, apiKey: ${serializedBootstrapKey} };
</script>
</head>
<body>
<main>
<section class="panel">
<div class="eyebrow">Packaged runtime</div>
<h1>ThumbGate is running locally.</h1>
<p>This lightweight npm dashboard is bundled without marketing assets, so installs stay small while core feedback, lessons, and API routes remain available.</p>
<div class="grid">
<a class="card" href="/v1/dashboard"><strong>Dashboard JSON</strong><span>Inspect feedback totals, lesson counts, and Reliability Gateway health.</span></a>
<a class="card" href="/lessons"><strong>Lessons</strong><span>Review remembered thumbs-up/down lessons and enforcement context.</span></a>
<a class="card" href="/health"><strong>Health</strong><span>Verify the installed package version and runtime status.</span></a>
</div>
</section>
</main>
</body>
</html>`;
}

function renderPackagedLessonsHtml({ bootstrapActive, serializedBootstrapKey }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ThumbGate Lessons</title>
<style>
:root { color-scheme: light dark; --bg:#0f172a; --panel:#111827; --text:#f8fafc; --muted:#94a3b8; --line:#334155; --accent:#38bdf8; }
body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:linear-gradient(135deg,#020617,#0f172a); color:var(--text); }
main { max-width:920px; margin:0 auto; padding:48px 20px; }
.panel { border:1px solid var(--line); border-radius:20px; background:rgba(15,23,42,.86); padding:28px; box-shadow:0 24px 80px rgba(0,0,0,.32); }
.eyebrow { color:var(--accent); font-size:13px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
h1 { font-size:clamp(32px,5vw,54px); line-height:1; margin:14px 0; }
p { color:var(--muted); font-size:18px; line-height:1.6; }
.actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:26px; }
a { color:var(--text); text-decoration:none; border:1px solid var(--line); border-radius:999px; padding:12px 16px; background:rgba(30,41,59,.7); }
</style>
<script>
window.THUMBGATE_LESSONS_BOOTSTRAP = { enabled: ${bootstrapActive ? 'true' : 'false'}, apiKey: ${serializedBootstrapKey} };
</script>
</head>
<body>
<main>
<section class="panel">
<div class="eyebrow">Packaged runtime</div>
<h1>ThumbGate lessons are available.</h1>
<p>The full hosted lessons UI is excluded from the npm tarball, but installed packages still expose the lesson APIs and detail pages needed for local agent feedback loops.</p>
<div class="actions">
<a href="/v1/lessons/search">Search lessons JSON</a>
<a href="/v1/feedback/stats">Feedback stats JSON</a>
<a href="/dashboard">Back to dashboard</a>
</div>
</section>
</main>
</body>
</html>`;
}

function loadDashboardPageHtml(req, expectedApiKey) {
  const bootstrap = resolveLocalPageBootstrap(req, expectedApiKey);
  const template = readOptionalPublicTemplate(DASHBOARD_PAGE_PATH);
  if (!template) return renderPackagedDashboardHtml(bootstrap);

  return fillTemplate(template, {
    '__DASHBOARD_BOOTSTRAP_KEY__': bootstrap.serializedBootstrapKey,
    '__DASHBOARD_BOOTSTRAP_ENABLED__': bootstrap.bootstrapActive ? 'true' : 'false',
  });
}

function loadLessonsPageHtml(req, expectedApiKey) {
  const bootstrap = resolveLocalPageBootstrap(req, expectedApiKey);
  const template = readOptionalPublicTemplate(LESSONS_PAGE_PATH);
  if (!template) return renderPackagedLessonsHtml(bootstrap);

  return fillTemplate(template, {
    '__LESSONS_BOOTSTRAP_KEY__': bootstrap.serializedBootstrapKey,
    '__LESSONS_BOOTSTRAP_ENABLED__': bootstrap.bootstrapActive ? 'true' : 'false',
  });
}

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function normalizeLessonSignal(signal) {
  const value = String(signal || '').toLowerCase();
  if (value === 'up' || value === 'positive' || value === 'thumbs_up') return 'up';
  if (value === 'down' || value === 'negative' || value === 'thumbs_down') return 'down';
  return 'down';
}

function renderLessonDetailHtml(record, lessonId) {
  if (!record) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lesson Not Found</title>
<style>*{box-sizing:border-box}body{background:#0a0a0a;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center;background:#141414;border:1px solid #222;border-radius:16px;padding:48px 40px;max-width:480px}
a{color:#22d3ee;text-decoration:none}</style></head><body>
<div class="card"><div style="font-size:48px;margin-bottom:12px">🔍</div>
<h2 style="margin-bottom:8px">Lesson not found</h2>
<p style="color:#888;font-size:14px;margin-bottom:20px">No record with ID <code style="background:#1a1a1a;padding:2px 6px;border-radius:4px">${esc(lessonId)}</code></p>
<a href="/lessons">← Back to Lessons</a></div></body></html>`;
  }

  const fb = record.feedbackEvent || {};
  const mem = record.memoryRecord || {};
  const merged = { ...fb, ...mem };
  const signal = normalizeLessonSignal(merged.signal);
  const emoji = signal === 'up' ? '👍' : '👎';
  const signalColor = signal === 'up' ? '#4ade80' : '#f87171';
  const title = merged.title || merged.context || 'Untitled Lesson';
  const context = merged.context || '';
  const whatWentWrong = merged.whatWentWrong || '';
  const whatWorked = merged.whatWorked || '';
  const whatToChange = merged.whatToChange || '';
  const tags = Array.isArray(merged.tags) ? merged.tags.join(', ') : (merged.tags || '');
  const timestamp = merged.timestamp ? new Date(merged.timestamp).toLocaleString() : '';
  const isoTimestamp = merged.timestamp || '';

  const failureType = merged.failureType || null;
  const skill = merged.skill || null;
  const source = merged.source || fb.source || null;
  const relatedFeedbackId = merged.relatedFeedbackId || null;
  const promotedToMemory = !!mem.id || !!merged.promotedToMemory;
  const feedbackEventId = fb.id || null;
  const memoryRecordId = mem.id || null;
  const guardrails = merged.guardrails || null;
  const rubricScores = merged.rubricScores || null;

  const rule = merged.structuredRule || merged.rule || null;
  const convoWindow = merged.conversationWindow || merged.chatHistory || [];
  const reflector = merged.reflectorAnalysis || merged.reflector || null;
  const diagnosis = merged.diagnosis || null;
  const rubric = merged.rubricEvaluation || merged.rubric || null;
  const synthesis = merged.synthesis || null;
  const bayesian = merged.bayesianBelief || merged.bayesian || null;

  function sectionCard(titleText, content, id) {
    if (!content) return '';
    return `<div class="detail-card" id="${id || ''}"><h3>${titleText}</h3>${content}</div>`;
  }

  let structuredRuleHtml = '';
  if (rule) {
    structuredRuleHtml = sectionCard('Structured Rule (IF/THEN)', `
      <table class="detail-table">
        ${rule.trigger ? `<tr><td class="label">Trigger (IF)</td><td>${esc(rule.trigger)}</td></tr>` : ''}
        ${rule.action ? `<tr><td class="label">Action (THEN)</td><td>${esc(rule.action)}</td></tr>` : ''}
        ${rule.confidence !== undefined ? `<tr><td class="label">Confidence</td><td>${esc(String(rule.confidence))}</td></tr>` : ''}
        ${rule.scope ? `<tr><td class="label">Scope</td><td>${esc(rule.scope)}</td></tr>` : ''}
      </table>`, 'structuredRule');
  }

  let convoHtml = '';
  if (Array.isArray(convoWindow) && convoWindow.length > 0) {
    const seen = new Set();
    const validMsgs = convoWindow.filter((m) => {
      const text = m.content || m.text || '';
      if (typeof text === 'string' ? text.trim().length === 0 : !text) return false;
      const dedupeKey = (m.role || m.author || '') + '|' + (typeof text === 'string' ? text.trim() : JSON.stringify(text));
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });
    if (validMsgs.length > 0) {
      const msgs = validMsgs.map((m) => {
        const role = esc(m.role || m.author || 'system');
        const content = esc(typeof (m.content || m.text) === 'string' ? (m.content || m.text) : JSON.stringify(m.content || m.text));
        const ts = m.timestamp ? `<span style="color:var(--text-muted);font-size:10px;margin-left:8px">${esc(new Date(m.timestamp).toLocaleString())}</span>` : '';
        const src = m.source ? `<span style="color:var(--text-muted);font-size:10px;margin-left:8px;opacity:0.6">${esc(m.source)}</span>` : '';
        return `<div class="convo-msg"><span class="convo-role">${role}</span>${ts}${src}<div class="convo-content" style="margin-top:4px">${content}</div></div>`;
      }).join('');
      convoHtml = sectionCard('Conversation Window', `<div class="convo-list">${msgs}</div>`, 'convoWindow');
    }
  }

  let reflectorHtml = '';
  if (reflector) {
    const parts = [];
    if (reflector.proposedRule) parts.push(`<tr><td class="label">Proposed Rule</td><td>${esc(reflector.proposedRule)}</td></tr>`);
    if (reflector.recurrence) parts.push(`<tr><td class="label">Recurrence</td><td>${esc(JSON.stringify(reflector.recurrence))}</td></tr>`);
    if (reflector.correctionsDetected) parts.push(`<tr><td class="label">Corrections</td><td>${esc(JSON.stringify(reflector.correctionsDetected))}</td></tr>`);
    if (parts.length) reflectorHtml = sectionCard('Reflector Analysis', `<table class="detail-table">${parts.join('')}</table>`, 'reflector');
  }

  let diagnosisHtml = '';
  if (diagnosis) {
    const parts = [];
    if (diagnosis.rootCause) parts.push(`<tr><td class="label">Root Cause</td><td>${esc(diagnosis.rootCause)}</td></tr>`);
    if (diagnosis.category) parts.push(`<tr><td class="label">Category</td><td>${esc(diagnosis.category)}</td></tr>`);
    if (diagnosis.violations) parts.push(`<tr><td class="label">Violations</td><td>${esc(JSON.stringify(diagnosis.violations))}</td></tr>`);
    if (parts.length) diagnosisHtml = sectionCard('Diagnosis', `<table class="detail-table">${parts.join('')}</table>`, 'diagnosis');
  }

  let rubricHtml = '';
  if (rubric) {
    const parts = [];
    if (rubric.scores) parts.push(`<tr><td class="label">Scores</td><td><pre>${esc(JSON.stringify(rubric.scores, null, 2))}</pre></td></tr>`);
    if (rubric.failingCriteria) parts.push(`<tr><td class="label">Failing Criteria</td><td>${esc(JSON.stringify(rubric.failingCriteria))}</td></tr>`);
    if (rubric.guardrails) parts.push(`<tr><td class="label">Guardrails</td><td>${esc(JSON.stringify(rubric.guardrails))}</td></tr>`);
    if (parts.length) rubricHtml = sectionCard('Rubric Evaluation', `<table class="detail-table">${parts.join('')}</table>`, 'rubric');
  }

  let synthesisHtml = '';
  if (synthesis) {
    const parts = [];
    if (synthesis.mergedCount !== undefined) parts.push(`<tr><td class="label">Merged Count</td><td>${esc(String(synthesis.mergedCount))}</td></tr>`);
    if (synthesis.linkedFeedbackIds) parts.push(`<tr><td class="label">Linked Feedback</td><td>${esc(JSON.stringify(synthesis.linkedFeedbackIds))}</td></tr>`);
    if (parts.length) synthesisHtml = sectionCard('Synthesis', `<table class="detail-table">${parts.join('')}</table>`, 'synthesis');
  }

  let bayesianHtml = '';
  if (bayesian) {
    const parts = [];
    if (bayesian.prior !== undefined) parts.push(`<tr><td class="label">Prior</td><td>${esc(String(bayesian.prior))}</td></tr>`);
    if (bayesian.posterior !== undefined) parts.push(`<tr><td class="label">Posterior</td><td>${esc(String(bayesian.posterior))}</td></tr>`);
    if (bayesian.uncertainty !== undefined) parts.push(`<tr><td class="label">Uncertainty</td><td>${esc(String(bayesian.uncertainty))}</td></tr>`);
    if (parts.length) bayesianHtml = sectionCard('Bayesian Belief', `<table class="detail-table">${parts.join('')}</table>`, 'bayesian');
  }

  // Technical metadata section
  const techParts = [];
  techParts.push(`<tr><td class="label">Feedback Event ID</td><td><code>${esc(feedbackEventId || lessonId)}</code></td></tr>`);
  if (memoryRecordId) techParts.push(`<tr><td class="label">Memory Record ID</td><td><code>${esc(memoryRecordId)}</code></td></tr>`);
  techParts.push(`<tr><td class="label">Promoted to Memory</td><td>${promotedToMemory ? '<span style="color:var(--green)">✓ Yes</span>' : '<span style="color:var(--text-muted)">✗ No</span>'}</td></tr>`);
  if (failureType) techParts.push(`<tr><td class="label">Failure Type</td><td><span style="color:${failureType === 'decision' ? 'var(--yellow)' : 'var(--purple)'};font-weight:600">${esc(failureType)}</span> <span style="color:var(--text-muted);font-size:11px">${failureType === 'decision' ? '(wrong tool/action chosen)' : '(right tool, bad params/output)'}</span></td></tr>`);
  if (skill) techParts.push(`<tr><td class="label">Skill</td><td><code>${esc(skill)}</code></td></tr>`);
  if (source) techParts.push(`<tr><td class="label">Source</td><td>${esc(source)}</td></tr>`);
  if (relatedFeedbackId) techParts.push(`<tr><td class="label">Related Feedback</td><td><a href="/lessons/${esc(relatedFeedbackId)}" style="color:var(--cyan)">${esc(relatedFeedbackId)}</a></td></tr>`);
  if (isoTimestamp) techParts.push(`<tr><td class="label">ISO Timestamp</td><td><code>${esc(isoTimestamp)}</code></td></tr>`);
  const techMetadataHtml = sectionCard('Technical Metadata', `<table class="detail-table">${techParts.join('')}</table>`, 'techMetadata');

  // What to Change section (for negative feedback)
  let whatToChangeHtml = '';
  if (whatToChange) {
    whatToChangeHtml = sectionCard('What to Change', `<div style="padding:12px;background:var(--bg-raised);border-radius:8px;font-size:13px;color:var(--text-muted);white-space:pre-wrap">${esc(whatToChange)}</div>`, 'whatToChange');
  }

  // Guardrails section
  let guardrailsHtml = '';
  if (guardrails && typeof guardrails === 'object') {
    const gParts = [];
    if (guardrails.testsPassed !== undefined) gParts.push(`<tr><td class="label">Tests Passed</td><td>${guardrails.testsPassed ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--red)">✗</span>'}</td></tr>`);
    if (guardrails.pathSafety !== undefined) gParts.push(`<tr><td class="label">Path Safety</td><td>${guardrails.pathSafety ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--red)">✗</span>'}</td></tr>`);
    if (guardrails.budgetCompliant !== undefined) gParts.push(`<tr><td class="label">Budget Compliant</td><td>${guardrails.budgetCompliant ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--red)">✗</span>'}</td></tr>`);
    if (gParts.length) guardrailsHtml = sectionCard('Guardrails', `<table class="detail-table">${gParts.join('')}</table>`, 'guardrails');
  }

  // Rubric Scores section (from capture, distinct from rubric evaluation)
  let rubricScoresHtml = '';
  if (Array.isArray(rubricScores) && rubricScores.length > 0) {
    const rows = rubricScores.map(s => `<tr><td class="label">${esc(s.criterion || '')}</td><td><span style="font-weight:700;color:${(s.score || 0) >= 0.7 ? 'var(--green)' : (s.score || 0) >= 0.4 ? 'var(--yellow)' : 'var(--red)'}">${esc(String(s.score || 0))}</span> <span style="color:var(--text-muted);font-size:11px">${s.judge ? 'by ' + esc(s.judge) : ''}</span>${s.evidence ? `<div style="margin-top:4px;font-size:12px;color:var(--text-muted)">${esc(s.evidence)}</div>` : ''}</td></tr>`).join('');
    rubricScoresHtml = sectionCard('Rubric Scores', `<table class="detail-table">${rows}</table>`, 'rubricScores');
  }

  // Raw JSON (collapsible)
  const rawJson = JSON.stringify(record, null, 2);
  const rawJsonHtml = `<div class="detail-card" id="rawJson">
    <h3 style="cursor:pointer" onclick="var el=document.getElementById('rawJsonContent');el.style.display=el.style.display==='none'?'block':'none';this.textContent=el.style.display==='none'?'Raw JSON ▸':'Raw JSON ▾'">Raw JSON ▸</h3>
    <div id="rawJsonContent" style="display:none">
      <button class="btn btn-secondary" style="margin-bottom:12px;padding:6px 16px;font-size:12px" onclick="navigator.clipboard.writeText(${esc(JSON.stringify(rawJson))}).then(()=>showToast('JSON copied!','success'))">📋 Copy JSON</button>
      <pre style="background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:16px;font-size:11px;font-family:var(--mono);overflow-x:auto;max-height:600px;overflow-y:auto;color:var(--text-muted)">${esc(rawJson)}</pre>
    </div>
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lesson — ${esc(title)}</title>
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: #0a0a0b; --bg-raised: #111113; --bg-card: #141414; --border: #222225;
  --text: #e8e8ec; --text-muted: #8b8b96; --cyan: #22d3ee;
  --cyan-dim: rgba(34,211,238,0.12); --green: #4ade80; --red: #f87171;
  --yellow: #fbbf24; --purple: #a78bfa;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif;
  --mono: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace;
}
body { font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.6; -webkit-font-smoothing: antialiased; }
.container { max-width: 860px; margin: 0 auto; padding: 0 24px; }
nav { position: sticky; top: 0; z-index: 50; background: rgba(10,10,11,0.85); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); padding: 14px 0; }
nav .container { display: flex; justify-content: space-between; align-items: center; }
.nav-logo { font-weight: 700; font-size: 15px; color: var(--text); text-decoration: none; display: inline-flex; align-items: center; gap: 8px; }
.nav-logo .logo-mark { width: 28px; height: 28px; display: block; }
.nav-links { display: flex; gap: 16px; align-items: center; }
.nav-links a { color: var(--text-muted); text-decoration: none; font-size: 13px; }
.nav-links a:hover { color: var(--text); }
.header-card { margin: 32px 0 24px; padding: 28px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; }
.header-top { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
.signal-badge { font-size: 40px; }
.header-title { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
.header-meta { display: flex; gap: 20px; flex-wrap: wrap; font-size: 13px; color: var(--text-muted); }
.header-meta code { background: var(--bg-raised); padding: 2px 8px; border-radius: 4px; font-family: var(--mono); font-size: 12px; cursor: pointer; }
.header-meta code:hover { color: var(--cyan); }
.detail-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 16px; }
.detail-card h3 { font-size: 14px; font-weight: 600; color: var(--cyan); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
.form-group input, .form-group textarea { width: 100%; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 10px 14px; font-size: 14px; font-family: var(--font); }
.form-group input:focus, .form-group textarea:focus { outline: none; border-color: var(--cyan); }
.form-group textarea { resize: vertical; min-height: 80px; }
.detail-table { width: 100%; border-collapse: collapse; }
.detail-table td { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: top; }
.detail-table td.label { color: var(--text-muted); width: 160px; font-weight: 600; white-space: nowrap; }
.detail-table pre { margin: 0; font-size: 12px; font-family: var(--mono); white-space: pre-wrap; color: var(--text-muted); }
.convo-list { max-height: 400px; overflow-y: auto; }
.convo-msg { padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 13px; }
.convo-role { display: inline-block; font-weight: 700; color: var(--cyan); width: 80px; font-size: 11px; text-transform: uppercase; }
.convo-content { color: var(--text-muted); }
.actions-bar { display: flex; gap: 12px; margin: 24px 0 48px; flex-wrap: wrap; }
.btn { padding: 10px 24px; border: none; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; transition: opacity 0.15s; }
.btn:hover { opacity: 0.85; }
.btn-primary { background: var(--cyan); color: #000; }
.btn-secondary { background: var(--bg-card); color: var(--text); border: 1px solid var(--border); }
.btn-danger { background: rgba(248,113,113,0.15); color: var(--red); border: 1px solid rgba(248,113,113,0.3); }
.toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; display: none; z-index: 100; animation: slideUp .3s ease-out; }
@keyframes slideUp{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.toast-success { background: var(--green); color: #000; }
.toast-error { background: var(--red); color: #000; }
@media (max-width: 600px) {
  .header-meta { flex-direction: column; gap: 8px; }
  .actions-bar { flex-direction: column; }
}
</style>
<script defer data-domain="thumbgate-production.up.railway.app" src="https://plausible.io/js/script.js"></script>
</head>
<body>
<nav><div class="container">
  <a href="/dashboard" class="nav-logo"><img src="/assets/brand/thumbgate-mark-inline.svg" alt="ThumbGate" class="logo-mark" width="28" height="28"><span class="logo-text">ThumbGate</span></a>
  <div class="nav-links">
    <a href="/dashboard">Dashboard</a>
    <a href="/lessons">Lessons</a>
    <a href="/">Landing Page</a>
  </div>
</div></nav>

<div class="container">
  <div class="header-card">
    <div class="header-top">
      <div class="signal-badge">${emoji}</div>
      <div class="header-title">Lesson Detail</div>
    </div>
    <div class="header-meta">
      <span>ID: <code onclick="navigator.clipboard.writeText('${esc(lessonId)}').then(()=>showToast('Copied!','success'))" title="Click to copy">${esc(lessonId)}</code></span>
      ${timestamp ? `<span>🕐 ${esc(timestamp)}</span>` : ''}
      <span style="color:${signalColor};font-weight:600">${signal === 'up' ? 'Positive' : 'Negative'} feedback</span>
    </div>
  </div>

  <div class="detail-card">
    <h3>Lesson Content</h3>
    <div class="form-group">
      <label>Title</label>
      <input type="text" id="editTitle" value="${esc(title)}">
    </div>
    <div class="form-group">
      <label>Content / Context</label>
      <textarea id="editContent" rows="4">${esc(context)}</textarea>
    </div>
    <div class="form-group">
      <label>${signal === 'down' ? 'What went wrong' : 'What worked'}</label>
      <textarea id="editDetail" rows="3">${esc(signal === 'down' ? whatWentWrong : whatWorked)}</textarea>
    </div>
    <div class="form-group">
      <label>Tags (comma-separated)</label>
      <input type="text" id="editTags" value="${esc(tags)}">
    </div>
  </div>

  ${techMetadataHtml}
  ${whatToChangeHtml}
  ${guardrailsHtml}
  ${rubricScoresHtml}
  ${structuredRuleHtml}
  ${convoHtml}
  ${reflectorHtml}
  ${diagnosisHtml}
  ${rubricHtml}
  ${synthesisHtml}
  ${bayesianHtml}
  ${rawJsonHtml}

  <div class="actions-bar">
    <button class="btn btn-primary" onclick="saveChanges()">Save Changes</button>
    <a href="/lessons" class="btn btn-secondary">← Back to Lessons</a>
    <button class="btn btn-danger" onclick="deleteLesson()">Delete Lesson</button>
  </div>
</div>

<div class="toast toast-success" id="toastSuccess">✓ Saved</div>
<div class="toast toast-error" id="toastError">✗ Error</div>

<script>
function showToast(msg, type) {
  var el = document.getElementById(type === 'success' ? 'toastSuccess' : 'toastError');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 3000);
}

async function saveChanges() {
  var body = {
    title: document.getElementById('editTitle').value,
    content: document.getElementById('editContent').value,
    tags: document.getElementById('editTags').value,
  };
  var detailVal = document.getElementById('editDetail').value;
  if ('${signal}' === 'down') { body.whatWentWrong = detailVal; } else { body.whatWorked = detailVal; }
  try {
    var resp = await fetch('/lessons/${encodeURIComponent(lessonId)}/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error('Save failed');
    showToast('Changes saved', 'success');
  } catch (e) {
    showToast('Failed to save: ' + e.message, 'error');
  }
}

async function deleteLesson() {
  if (!confirm('Delete this lesson permanently?')) return;
  try {
    var resp = await fetch('/lessons/${encodeURIComponent(lessonId)}/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!resp.ok) throw new Error('Delete failed');
    window.location.href = '/lessons';
  } catch (e) {
    showToast('Failed to delete: ' + e.message, 'error');
  }
}
</script>
</body>
</html>`;
}

function renderRobotsTxt(runtimeConfig) {
  return [
    'User-agent: *',
    'Allow: /',
    '',
    '# AI crawler access — allow all major LLM crawlers',
    'User-agent: GPTBot',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    '',
    'User-agent: Googlebot',
    'Allow: /',
    '',
    'User-agent: Bingbot',
    'Allow: /',
    '',
    'User-agent: anthropic-ai',
    'Allow: /',
    '',
    'User-agent: Google-Extended',
    'Allow: /',
    '',
    '# LLM context document — clean declarative content for AI retrieval',
    `# ${runtimeConfig.appOrigin}/llm-context.md`,
    '',
    `Sitemap: ${runtimeConfig.appOrigin}/sitemap.xml`,
  ].join('\n');
}

function renderSitemapXml(runtimeConfig) {
  const entries = [
    { path: '/', changefreq: 'weekly', priority: '1.0' },
    { path: '/pro', changefreq: 'weekly', priority: '0.9' },
    { path: '/llm-context.md', changefreq: 'weekly', priority: '0.8' },
    { path: '/codex-plugin', changefreq: 'weekly', priority: '0.75' },
    ...THUMBGATE_SEO_SITEMAP_ENTRIES,
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => {
      const loc = entry.path === '/'
        ? `${runtimeConfig.appOrigin}/`
        : `${runtimeConfig.appOrigin}${entry.path}`;
      return [
        '  <url>',
        `    <loc>${loc}</loc>`,
        `    <changefreq>${entry.changefreq}</changefreq>`,
        `    <priority>${entry.priority}</priority>`,
        '  </url>',
      ].join('\n');
    }),
    '</urlset>',
  ].join('\n');
}

function buildHostedRuntimePresence(hostedConfig, { expectedApiKey, expectedOperatorKey } = {}) {
  return {
    THUMBGATE_FEEDBACK_DIR: Boolean(process.env.THUMBGATE_FEEDBACK_DIR),
    THUMBGATE_OPERATOR_KEY: Boolean(expectedOperatorKey),
    THUMBGATE_API_KEY: Boolean(expectedApiKey),
    THUMBGATE_PUBLIC_APP_ORIGIN: Boolean(hostedConfig.appOrigin),
    THUMBGATE_BILLING_API_BASE_URL: Boolean(hostedConfig.billingApiBaseUrl),
    THUMBGATE_GA_MEASUREMENT_ID: Boolean(hostedConfig.gaMeasurementId),
    THUMBGATE_CHECKOUT_FALLBACK_URL: Boolean(hostedConfig.checkoutFallbackUrl),
    THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL: Boolean(hostedConfig.sprintDiagnosticCheckoutUrl),
    THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL: Boolean(hostedConfig.workflowSprintCheckoutUrl),
    STRIPE_SECRET_KEY: Boolean(process.env.STRIPE_SECRET_KEY),
  };
}

function isSeoAttributionSource(source) {
  return source === 'organic_search' || source === 'ai_search';
}

function servePublicMarketingPage({
  req,
  res,
  parsed,
  hostedConfig,
  isHeadRequest,
  renderHtml,
  extraTelemetry = {},
}) {
  if (isHeadRequest) {
    sendHtml(res, 200, renderHtml(hostedConfig), {}, {
      headOnly: true,
    });
    return;
  }

  const { FEEDBACK_DIR } = getFeedbackPaths();
  const journeyState = resolveJourneyState(req, parsed);
  const landingAttribution = buildLandingAttribution(parsed, req);
  const telemetryPayload = {
    eventType: 'landing_page_view',
    clientType: 'web',
    visitorId: journeyState.visitorId,
    sessionId: journeyState.sessionId,
    acquisitionId: journeyState.acquisitionId,
    ...landingAttribution,
    ...extraTelemetry,
  };
  const landingTelemetryCaptured = appendBestEffortTelemetry(
    FEEDBACK_DIR,
    telemetryPayload,
    req.headers,
    'landing_page_view'
  );

  try {
    appendFunnelEvent({
      stage: 'discovery',
      event: 'landing_view',
      installId: journeyState.visitorId || null,
      traceId: journeyState.acquisitionId || null,
      evidence: landingAttribution.landingPath || 'landing_view',
      metadata: {
        page: extraTelemetry.pageType || landingAttribution.page || 'landing',
        utmSource: landingAttribution.utmSource || null,
        utmMedium: landingAttribution.utmMedium || null,
        utmCampaign: landingAttribution.utmCampaign || null,
        utmContent: landingAttribution.utmContent || null,
        utmTerm: landingAttribution.utmTerm || null,
        referrerHost: landingAttribution.referrerHost || null,
        sessionId: journeyState.sessionId || null,
      },
    });
  } catch {
    // Funnel ledger is best-effort on page render; telemetry-pings remains
    // the authoritative observability path if the ledger write fails.
  }

  if (isSeoAttributionSource(landingAttribution.source)) {
    appendBestEffortTelemetry(FEEDBACK_DIR, {
      eventType: 'seo_landing_view',
      clientType: 'web',
      visitorId: journeyState.visitorId,
      sessionId: journeyState.sessionId,
      acquisitionId: journeyState.acquisitionId,
      source: landingAttribution.source,
      utmSource: landingAttribution.utmSource,
      utmMedium: landingAttribution.utmMedium,
      utmCampaign: landingAttribution.utmCampaign,
      utmContent: landingAttribution.utmContent,
      utmTerm: landingAttribution.utmTerm,
      creator: landingAttribution.creator,
      community: landingAttribution.community,
      postId: landingAttribution.postId,
      commentId: landingAttribution.commentId,
      campaignVariant: landingAttribution.campaignVariant,
      offerCode: landingAttribution.offerCode,
      landingPath: landingAttribution.landingPath,
      page: landingAttribution.page,
      referrer: landingAttribution.referrer,
      referrerHost: landingAttribution.referrerHost,
      seoSurface: landingAttribution.seoSurface || landingAttribution.source,
      seoQuery: landingAttribution.seoQuery,
      ...extraTelemetry,
    }, req.headers, 'seo_landing_view');
  }

  const html = renderHtml(hostedConfig, {
    serverVisitorId: journeyState.visitorId,
    serverSessionId: journeyState.sessionId,
    serverAcquisitionId: journeyState.acquisitionId,
    serverTelemetryCaptured: landingTelemetryCaptured,
  });

  sendHtml(
    res,
    200,
    html,
    journeyState.setCookieHeaders.length ? { 'Set-Cookie': journeyState.setCookieHeaders } : {}
  );
}

function renderCheckoutSuccessPage(runtimeConfig) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Context Gateway Activated</title>
  <meta name="robots" content="noindex,nofollow" />
  <style>
    :root {
      --bg: #f6f1e8;
      --ink: #1d1b18;
      --muted: #625a4d;
      --line: #d7cfbf;
      --accent: #b85c2d;
      --accent-dark: #8f451f;
      --card: #fffdf9;
      --success: #2f7d4b;
      --warning: #8f451f;
      --radius: 14px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, 'Times New Roman', serif;
      background: linear-gradient(180deg, #fcfaf5 0%, var(--bg) 100%);
      color: var(--ink);
      line-height: 1.6;
    }
    main {
      max-width: 860px;
      margin: 0 auto;
      padding: 48px 20px 80px;
    }
    .eyebrow {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 999px;
      background: #efe3d5;
      color: var(--accent-dark);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 700;
    }
    h1 {
      margin: 18px 0 12px;
      font-size: clamp(32px, 6vw, 56px);
      line-height: 1.05;
      letter-spacing: -0.04em;
    }
    p.lead {
      max-width: 700px;
      font-size: 19px;
      color: var(--muted);
      margin: 0 0 28px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 24px;
      margin-top: 22px;
      box-shadow: 0 10px 30px rgba(29, 27, 24, 0.08);
    }
    .status {
      color: var(--success);
      font-weight: 700;
      margin-bottom: 8px;
    }
    .email-status {
      color: var(--muted);
      font-size: 14px;
      margin-top: 10px;
    }
    .email-status.warning {
      color: var(--warning);
      font-weight: 700;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      background: #171411;
      color: #f5efe6;
      padding: 16px;
      border-radius: 12px;
      overflow-x: auto;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 13px;
    }
    .actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 18px;
    }
    a.button {
      display: inline-block;
      text-decoration: none;
      background: var(--accent);
      color: white;
      padding: 12px 18px;
      border-radius: 10px;
      font-weight: 700;
    }
    a.button.secondary {
      background: transparent;
      color: var(--ink);
      border: 1px solid var(--line);
    }
    .muted {
      color: var(--muted);
      font-size: 14px;
    }
    .brand-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 28px;
      text-decoration: none;
      color: var(--ink);
      font-weight: 700;
      font-size: 16px;
      letter-spacing: -0.01em;
    }
    .brand-header .logo-mark { width: 32px; height: 32px; display: block; }
  </style>
  <link rel="icon" type="image/png" href="/thumbgate-icon.png">
  <link rel="apple-touch-icon" href="/assets/brand/thumbgate-mark.svg">
<script defer data-domain="thumbgate-production.up.railway.app" src="https://plausible.io/js/script.js"></script>
</head>
<body>
  <main>
    <a href="/" class="brand-header"><img src="/assets/brand/thumbgate-mark-inline.svg" alt="ThumbGate" class="logo-mark" width="32" height="32"><span class="logo-text">ThumbGate</span></a>
    <span class="eyebrow">ThumbGate Pro</span>
    <h1>Your local Pro dashboard is ready.</h1>
    <p class="lead">This page verifies your Stripe session, provisions the key if needed, and gives you the exact command to save your license and launch your personal local dashboard.</p>

    <div class="card">
      <div class="status" id="status">Verifying payment and provisioning your key...</div>
      <p class="muted" id="summary">Do not close this tab until the key appears.</p>
      <p class="email-status" id="email-status">Activation email pending checkout verification.</p>
      <pre id="key-block">Waiting for checkout session...</pre>
    </div>

    <div class="card">
      <h2>Launch your personal dashboard</h2>
      <p>Run this command once to save your license key and open ThumbGate locally on <code>localhost</code>:</p>
      <pre id="activate-block">Waiting for provisioning...</pre>
      <p class="muted">Your key is saved to <code>~/.thumbgate/license.json</code>. After that, rerun <code>npx thumbgate pro</code> any time to reopen your dashboard.</p>
    </div>

    <div class="card">
      <h2>Use ThumbGate from CI, teammates, and remote agents (optional)</h2>
      <p>The Hosted API lets anything that can make an HTTP request &mdash; CI jobs, GitHub Actions, teammates' laptops, scheduled cron, or agents running in Docker or Lambda &mdash; push feedback into the same memory pool your local dashboard already reads from.</p>

      <p><strong>When you need this:</strong></p>
      <ul>
        <li>You run agents in CI/CD, GitHub Actions, or Docker containers and want their failures captured automatically.</li>
        <li>Your team wants shared memory &mdash; every teammate's thumbs-down feeds the same prevention rules.</li>
        <li>You dispatch agents from servers, Lambdas, or scheduled jobs that never touch your laptop.</li>
      </ul>

      <p><strong>When you can skip this:</strong></p>
      <ul>
        <li>You only use ThumbGate from your own laptop &mdash; the local dashboard already handles everything.</li>
      </ul>

      <p><strong>How to set it up:</strong></p>
      <ol>
        <li>Copy the environment block below into your CI or server environment.</li>
        <li>Use the curl example to confirm the hosted API captures an event end-to-end.</li>
        <li>Treat the key like any other API secret &mdash; rotate via your billing portal if it leaks.</li>
      </ol>
      <pre id="env-block">Waiting for provisioning...</pre>
      <pre id="curl-block">Waiting for provisioning...</pre>
      <div class="actions">
        <a class="button" href="/">Back to landing page</a>
        <a class="button secondary" href="https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md" target="_blank" rel="noreferrer">Verification evidence</a>
      </div>
    </div>
  </main>

  <script>
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    const traceId = params.get('trace_id');
    const sessionEndpoint = ${JSON.stringify(runtimeConfig.sessionEndpoint)};
    const telemetryEndpoint = '/v1/telemetry/ping';
    const statusEl = document.getElementById('status');
    const summaryEl = document.getElementById('summary');
    const emailStatusEl = document.getElementById('email-status');
    const keyBlock = document.getElementById('key-block');
    const envBlock = document.getElementById('env-block');
    const curlBlock = document.getElementById('curl-block');
    const activateBlock = document.getElementById('activate-block');
    const acquisitionId = params.get('acquisition_id');
    const visitorId = params.get('visitor_id');
    const visitorSessionId = params.get('visitor_session_id') || sessionId;
    const installId = params.get('install_id');
    const utmSource = params.get('utm_source');
    const utmMedium = params.get('utm_medium');
    const utmCampaign = params.get('utm_campaign');
    const utmContent = params.get('utm_content');
    const utmTerm = params.get('utm_term');
    const creator = params.get('creator') || params.get('creator_handle');
    const community = params.get('community');
    const postId = params.get('post_id');
    const commentId = params.get('comment_id');
    const campaignVariant = params.get('campaign_variant');
    const offerCode = params.get('offer_code');
    const ctaId = params.get('cta_id');
    const ctaPlacement = params.get('cta_placement');
    const planId = params.get('plan_id');
    const landingPath = params.get('landing_path') || '/';
    const referrerHost = params.get('referrer_host');

    function sendTelemetry(eventType, extra = {}) {
      const payload = {
        eventType,
        clientType: 'web',
        page: '/success',
        traceId,
        acquisitionId,
        visitorId,
        sessionId: visitorSessionId,
        installId,
        source: utmSource || 'website',
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm,
        creator,
        community,
        postId,
        commentId,
        campaignVariant,
        offerCode,
        ctaId,
        ctaPlacement,
        planId,
        landingPath,
        referrerHost,
        ...extra,
      };
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(telemetryEndpoint, blob);
        return;
      }
      fetch(telemetryEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    }

    function sendTelemetryOnce(eventType, extra = {}) {
      const marker = ['thumbgate', eventType, sessionId || traceId || 'unknown'].join(':');
      try {
        if (window.sessionStorage && window.sessionStorage.getItem(marker)) {
          return;
        }
        sendTelemetry(eventType, extra);
        if (window.sessionStorage) {
          window.sessionStorage.setItem(marker, '1');
        }
      } catch (_) {
        sendTelemetry(eventType, extra);
      }
    }

    async function run() {
      if (!sessionId) {
        statusEl.textContent = 'Missing checkout session.';
        summaryEl.textContent = 'Open the landing page and start a new checkout.';
        keyBlock.textContent = 'No session_id was provided in the URL.';
        return;
      }

      try {
        sendTelemetryOnce('checkout_session_lookup_started');
        const sessionLookupUrl = sessionEndpoint
          + '?sessionId=' + encodeURIComponent(sessionId)
          + (traceId ? '&traceId=' + encodeURIComponent(traceId) : '');
        const res = await fetch(sessionLookupUrl);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          sendTelemetryOnce('checkout_session_lookup_failed', {
            failureCode: body.error || 'checkout_session_lookup_failed',
            httpStatus: res.status,
          });
          throw new Error(body.error || 'Unable to load checkout session.');
        }

        if (!body.paid) {
          sendTelemetryOnce('checkout_session_pending');
          statusEl.textContent = 'Payment is still processing.';
          summaryEl.textContent = 'Refresh this page in a few seconds if Stripe has already confirmed payment.';
          keyBlock.textContent = JSON.stringify(body, null, 2);
          return;
        }

        sendTelemetryOnce('checkout_paid_confirmed');
        statusEl.textContent = 'ThumbGate Pro activated.';
        const resolvedTraceId = body.traceId || traceId || '';
        const emailStatus = body.trialEmail || {};
        const customerEmail = body.customerEmail || (emailStatus && emailStatus.customerEmail) || '';
        summaryEl.textContent = resolvedTraceId
          ? 'Your Pro key is ready. Save it once, launch your local dashboard, and keep the optional hosted snippet for team workflows. Trace: ' + resolvedTraceId + '.'
          : 'Your Pro key is ready. Save it once, launch your local dashboard, and keep the optional hosted snippet for team workflows.';
        if (emailStatus.status === 'sent' || emailStatus.status === 'already_sent') {
          emailStatusEl.className = 'email-status';
          emailStatusEl.textContent = customerEmail
            ? 'Activation email sent to ' + customerEmail + '.'
            : 'Activation email sent.';
        } else if (emailStatus.status === 'skipped' || emailStatus.status === 'failed') {
          emailStatusEl.className = 'email-status warning';
          emailStatusEl.textContent = 'Email delivery is not confirmed. Copy the key below now; this page is your activation source of truth.';
        } else {
          emailStatusEl.className = 'email-status warning';
          emailStatusEl.textContent = 'Email delivery status is unknown. Copy the key below now.';
        }
        keyBlock.textContent = body.apiKey || 'Provisioned, but no key was returned.';
        activateBlock.textContent = body.apiKey
          ? 'npx thumbgate pro --activate --key=' + body.apiKey
          : 'Key not available yet — refresh this page.';
        envBlock.textContent = body.nextSteps && body.nextSteps.env ? body.nextSteps.env : 'Environment snippet unavailable.';
        curlBlock.textContent = body.nextSteps && body.nextSteps.curl ? body.nextSteps.curl : 'curl snippet unavailable.';
      } catch (err) {
        sendTelemetryOnce('checkout_session_lookup_failed', {
          failureCode: err && err.message ? err.message : 'checkout_session_lookup_failed',
        });
        statusEl.textContent = 'Provisioning lookup failed.';
        summaryEl.textContent = traceId
          ? 'You can retry this page. If it keeps failing, inspect the hosted API logs with trace ' + traceId + '.'
          : 'You can retry this page. If it keeps failing, inspect the hosted API logs.';
        keyBlock.textContent = err && err.message ? err.message : 'Unknown error';
      }
    }

    run();
  </script>
</body>
</html>`;
}

function renderCheckoutCancelledPage(runtimeConfig) {
  const diagnosticCheckoutUrl = runtimeConfig.sprintDiagnosticCheckoutUrl
    ? escapeHtmlAttribute(runtimeConfig.sprintDiagnosticCheckoutUrl)
    : '';
  const workflowSprintCheckoutUrl = runtimeConfig.workflowSprintCheckoutUrl
    ? escapeHtmlAttribute(runtimeConfig.workflowSprintCheckoutUrl)
    : '';
  const sprintDiagnosticPriceDollars = runtimeConfig.sprintDiagnosticPriceDollars || 499;
  const workflowSprintPriceDollars = runtimeConfig.workflowSprintPriceDollars || 1500;
  const workflowSprintIntakeUrl = `${escapeHtmlAttribute(runtimeConfig.appOrigin)}/#workflow-sprint-intake`;
  const recoveryOfferLinks = [
    `<a id="send-workflow-first" href="${workflowSprintIntakeUrl}" data-recovery-offer="workflow_sprint_intake" data-offer-price="0">Send workflow first</a>`,
    diagnosticCheckoutUrl
      ? `<a href="${diagnosticCheckoutUrl}" data-recovery-offer="sprint_diagnostic" data-offer-price="${sprintDiagnosticPriceDollars}">Book $${sprintDiagnosticPriceDollars} diagnostic</a>`
      : '',
    workflowSprintCheckoutUrl
      ? `<a href="${workflowSprintCheckoutUrl}" data-recovery-offer="workflow_sprint" data-offer-price="${workflowSprintPriceDollars}">Start $${workflowSprintPriceDollars} sprint</a>`
      : '',
  ].filter(Boolean).join('\n        ');
  const recoveryOfferCard = recoveryOfferLinks
    ? `<div class="card recovery-card">
      <h2>Need help deciding?</h2>
      <p>If Pro is not the right next step, send the workflow first. We can qualify the blocker, confirm the proof plan, and route you to the diagnostic or sprint only when the scope is real.</p>
      <div class="actions">
        ${recoveryOfferLinks}
      </div>
    </div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Checkout Cancelled</title>
  <meta name="robots" content="noindex,nofollow" />
  <style>
    :root {
      --bg: #f6f1e8;
      --ink: #1d1b18;
      --muted: #625a4d;
      --line: #d7cfbf;
      --accent: #b85c2d;
      --surface: #fffdf9;
    }
    body {
      margin: 0;
      font-family: Georgia, 'Times New Roman', serif;
      background: var(--bg);
      color: var(--ink);
    }
    main {
      max-width: 720px;
      margin: 0 auto;
      padding: 64px 20px 80px;
    }
    h1 {
      font-size: clamp(32px, 6vw, 52px);
      line-height: 1.05;
      margin: 0 0 14px;
    }
    p {
      font-size: 18px;
      color: var(--muted);
      margin: 0 0 20px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 20px;
      margin-top: 18px;
    }
    .reason-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      margin-top: 14px;
    }
    button,
    a {
      display: inline-block;
      text-decoration: none;
      background: var(--accent);
      color: white;
      padding: 12px 18px;
      border-radius: 10px;
      font-weight: 700;
      border: 0;
      cursor: pointer;
      font-family: inherit;
      font-size: 15px;
    }
    button.secondary,
    a.secondary {
      background: transparent;
      color: var(--ink);
      border: 1px solid var(--line);
    }
    textarea {
      width: 100%;
      min-height: 88px;
      border-radius: 12px;
      border: 1px solid var(--line);
      padding: 12px;
      font: inherit;
      resize: vertical;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 18px;
    }
    .recovery-card {
      border-color: rgba(184, 92, 45, 0.38);
    }
    .note {
      font-size: 14px;
      margin-top: 12px;
    }
  </style>
<script defer data-domain="thumbgate-production.up.railway.app" src="https://plausible.io/js/script.js"></script>
</head>
<body>
  <main>
    <h1>Checkout cancelled.</h1>
    <p>No charge was made. You can return to the landing page and restart checkout whenever you are ready.</p>
    <div class="card">
      <h2>What stopped you?</h2>
      <p>Pick the closest reason. This writes directly into the first-party telemetry stream so we can fix the real blocker instead of guessing.</p>
      <div class="reason-grid">
        <button type="button" data-reason="too_expensive">Too expensive</button>
        <button type="button" data-reason="not_ready">Just researching</button>
        <button type="button" data-reason="need_team_features">Need team workflow features</button>
        <button type="button" data-reason="need_more_proof">Need more proof or trust</button>
        <button type="button" data-reason="prefer_oss">Sticking with OSS only</button>
        <button type="button" data-reason="integration_unclear">Integration is unclear</button>
      </div>
      <div style="margin-top:16px;">
        <label for="buyer-note">Anything specific?</label>
        <textarea id="buyer-note" placeholder="Optional detail: team size, workflow, blocker, competitor, or missing feature."></textarea>
      </div>
      <div class="actions">
        <button type="button" id="submit-reason">Send feedback</button>
        <a id="retry-checkout" href="/checkout/pro" class="secondary" data-recovery-offer="pro_trial_retry" data-offer-price="19">Restart $19 Pro trial</a>
        <a href="${runtimeConfig.appOrigin}" class="secondary">Return to Context Gateway</a>
      </div>
      <p class="note" id="status">No feedback sent yet.</p>
    </div>
    ${recoveryOfferCard}
    <script>
      (function () {
        const params = new URLSearchParams(window.location.search);
        const statusEl = document.getElementById('status');
        const noteEl = document.getElementById('buyer-note');
        const retryLink = document.getElementById('retry-checkout');
        const workflowIntakeLink = document.getElementById('send-workflow-first');
        let selectedReason = null;

        function sendTelemetry(eventType, extra) {
          const payload = Object.assign({
            eventType: eventType,
            clientType: 'web',
            traceId: params.get('trace_id'),
            acquisitionId: params.get('acquisition_id'),
            visitorId: params.get('visitor_id'),
            sessionId: params.get('visitor_session_id') || params.get('session_id'),
            installId: params.get('install_id'),
            source: params.get('utm_source') || params.get('source') || 'website',
            utmSource: params.get('utm_source') || params.get('source') || 'website',
            utmMedium: params.get('utm_medium') || 'checkout_cancel',
            utmCampaign: params.get('utm_campaign') || 'pro_pack',
            utmContent: params.get('utm_content'),
            utmTerm: params.get('utm_term'),
            creator: params.get('creator') || params.get('creator_handle'),
            community: params.get('community') || params.get('subreddit'),
            postId: params.get('post_id'),
            commentId: params.get('comment_id'),
            campaignVariant: params.get('campaign_variant'),
            offerCode: params.get('offer_code'),
            ctaId: params.get('cta_id') || 'pricing_pro',
            ctaPlacement: params.get('cta_placement') || 'pricing',
            planId: params.get('plan_id') || 'pro',
            page: window.location.pathname,
            landingPath: params.get('landing_path') || '/',
            referrerHost: params.get('referrer_host'),
            referrer: document.referrer || null
          }, extra || {});

          const body = JSON.stringify(payload);
          if (navigator.sendBeacon) {
            navigator.sendBeacon('/v1/telemetry/ping', new Blob([body], { type: 'application/json' }));
            return;
          }
          fetch('/v1/telemetry/ping', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body,
            keepalive: true
          }).catch(function () {});
        }

        const retryUrl = new URL(retryLink.href, window.location.origin);
        ['trace_id', 'acquisition_id', 'visitor_id', 'session_id', 'visitor_session_id', 'install_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'creator', 'community', 'post_id', 'comment_id', 'campaign_variant', 'offer_code', 'cta_id', 'cta_placement', 'plan_id', 'billing_cycle', 'seat_count', 'landing_path', 'referrer_host'].forEach(function (key) {
          const value = params.get(key);
          if (value) retryUrl.searchParams.set(key, value);
        });
        retryLink.href = retryUrl.toString();

        if (workflowIntakeLink) {
          const intakeUrl = new URL(workflowIntakeLink.href, window.location.origin);
          ['trace_id', 'acquisition_id', 'visitor_id', 'session_id', 'visitor_session_id', 'install_id', 'utm_source', 'utm_campaign', 'utm_content', 'utm_term', 'creator', 'community', 'post_id', 'comment_id', 'campaign_variant', 'offer_code', 'landing_path', 'referrer_host'].forEach(function (key) {
            const value = params.get(key);
            if (value) intakeUrl.searchParams.set(key, value);
          });
          intakeUrl.searchParams.set('utm_medium', 'checkout_cancel_recovery');
          intakeUrl.searchParams.set('cta_id', 'checkout_cancel_workflow_sprint_intake');
          intakeUrl.searchParams.set('cta_placement', 'checkout_cancel_recovery');
          intakeUrl.searchParams.set('plan_id', 'team');
          workflowIntakeLink.href = intakeUrl.toString();
        }

        sendTelemetry('checkout_cancelled');

        document.querySelectorAll('[data-reason]').forEach(function (button) {
          button.addEventListener('click', function () {
            selectedReason = button.getAttribute('data-reason');
            statusEl.textContent = 'Selected reason: ' + selectedReason.replaceAll('_', ' ') + '.';
          });
        });

        document.getElementById('submit-reason').addEventListener('click', function () {
          sendTelemetry('reason_not_buying', {
            reasonCode: selectedReason || 'unspecified',
            reasonText: noteEl.value || null
          });
          statusEl.textContent = selectedReason
            ? 'Feedback saved: ' + selectedReason.replaceAll('_', ' ') + '.'
            : 'Feedback saved.';
        });

        document.querySelectorAll('[data-recovery-offer]').forEach(function (link) {
          link.addEventListener('click', function () {
            if (link.getAttribute('data-recovery-offer') === 'workflow_sprint_intake') {
              sendTelemetry('checkout_cancel_workflow_intake_clicked', {
                ctaId: 'checkout_cancel_workflow_sprint_intake',
                ctaPlacement: 'checkout_cancel_recovery',
                offerCode: 'workflow_sprint_intake',
                planId: 'team',
                reasonCode: selectedReason || null
              });
              return;
            }
            sendTelemetry('checkout_recovery_offer_clicked', {
              ctaId: link.getAttribute('data-recovery-offer'),
              ctaPlacement: 'checkout_cancel_recovery',
              offerCode: link.getAttribute('data-recovery-offer'),
              offerPriceDollars: link.getAttribute('data-offer-price')
            });
          });
        });
      }());
    </script>
  </main>
</body>
</html>`;
}

function renderWorkflowSprintIntakeResultPage(runtimeConfig, { title, detail, leadId = null }) {
  const safeTitle = escapeHtmlAttribute(title || 'Sprint intake received');
  const safeDetail = escapeHtmlAttribute(detail || 'We have your workflow details and will review the proof path next.');
  const proofPackUrl = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md';
  const sprintBriefUrl = 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/WORKFLOW_HARDENING_SPRINT.md';
  const safeLeadId = leadId ? `<p><strong>Lead ID:</strong> ${escapeHtmlAttribute(leadId)}</p>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <meta name="robots" content="noindex,nofollow" />
  <style>
    :root {
      --bg: #f6f1e8;
      --ink: #1d1b18;
      --muted: #625a4d;
      --line: #d7cfbf;
      --accent: #b85c2d;
      --surface: #fffdf9;
    }
    body {
      margin: 0;
      font-family: Georgia, 'Times New Roman', serif;
      background: var(--bg);
      color: var(--ink);
      line-height: 1.6;
    }
    main {
      max-width: 720px;
      margin: 0 auto;
      padding: 64px 20px 80px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 24px;
      margin-top: 18px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 18px;
    }
    a {
      display: inline-block;
      text-decoration: none;
      background: var(--accent);
      color: white;
      padding: 12px 18px;
      border-radius: 10px;
      font-weight: 700;
    }
    a.secondary {
      background: transparent;
      color: var(--ink);
      border: 1px solid var(--line);
    }
  </style>
<script defer data-domain="thumbgate-production.up.railway.app" src="https://plausible.io/js/script.js"></script>
</head>
<body>
  <main>
    <h1>${safeTitle}</h1>
    <p>${safeDetail}</p>
    <div class="card">
      <p>Your workflow intake is now in the sprint queue. Review the proof pack and sprint scope while we assess the rollout blocker.</p>
      ${safeLeadId}
      <div class="actions">
        <a href="${proofPackUrl}">Review Proof Pack</a>
        <a class="secondary" href="${sprintBriefUrl}">Review Sprint Brief</a>
        <a class="secondary" href="${runtimeConfig.appOrigin}/#workflow-sprint-intake">Return to Context Gateway</a>
      </div>
    </div>
  </main>
</body>
</html>`;
}

function readBodyBuffer(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(createHttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(Buffer.alloc(0));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    req.on('error', reject);
  });
}

async function parseJsonBody(req, maxBytes = 1024 * 1024) {
  const body = await readBodyBuffer(req, maxBytes);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString('utf-8'));
  } catch {
    throw createHttpError(400, 'Invalid JSON body');
  }
}

async function parseFormBody(req, maxBytes = 1024 * 1024) {
  const body = await readBodyBuffer(req, maxBytes);
  const decoded = body.toString('utf-8');
  const params = new URLSearchParams(decoded);
  return Object.fromEntries(params.entries());
}

function parseOptionalObject(input, name) {
  if (input == null) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return {};
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw createHttpError(400, `${name} must be an object`);
    }
    return parsed;
  }
  throw createHttpError(400, `${name} must be an object`);
}

function getExpectedApiKey() {
  if (process.env.THUMBGATE_ALLOW_INSECURE === 'true') return null;
  const configured = process.env.THUMBGATE_API_KEY;
  // Developer override: ~/.config/thumbgate/dev.json bypass skips API key requirement
  // Only applies when no THUMBGATE_API_KEY is explicitly configured (avoids test interference)
  if (!configured) {
    try {
      const { hasDevOverride } = require('../../scripts/pro-local-dashboard');
      if (hasDevOverride()) return null;
    } catch { /* pro-local-dashboard not available */ }
  }
  if (!configured) {
    throw new Error('THUMBGATE_API_KEY is required unless THUMBGATE_ALLOW_INSECURE=true');
  }
  return configured;
}

function getExpectedOperatorKey() {
  const key = String(process.env.THUMBGATE_OPERATOR_KEY || '').trim();
  return key || null;
}

function isAuthorized(req, expected) {
  if (!expected) return true;
  const token = extractApiKey(req);

  if (token === expected) return true;

  if (token) {
    const result = validateApiKey(token);
    return result.valid === true;
  }

  return false;
}

function extractBearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

function extractApiKey(req) {
  const bearerToken = extractBearerToken(req);
  if (bearerToken) {
    return bearerToken;
  }

  const alternateHeader = req.headers['x-api-key'];
  if (Array.isArray(alternateHeader)) {
    return String(alternateHeader[0] || '').trim();
  }

  if (typeof alternateHeader === 'string') {
    return alternateHeader.trim();
  }

  return '';
}

/**
 * Admin-only guard for static THUMBGATE_API_KEY.
 * Billing keys are intentionally excluded from admin actions.
 */
function isStaticAdminAuthorized(req, expected) {
  if (!expected) return true;
  return extractApiKey(req) === expected;
}

/**
 * Billing summary guard: accepts either the static admin key OR the operator key.
 * The operator key (THUMBGATE_OPERATOR_KEY) allows read-only billing data access
 * without exposing the full admin key to CLI clients.
 */
function isBillingSummaryAuthorized(req, expectedAdminKey, expectedOperatorKey) {
  if (!expectedAdminKey && !expectedOperatorKey) return true;
  const token = extractApiKey(req);
  if (expectedAdminKey && token === expectedAdminKey) return true;
  if (expectedOperatorKey && token === expectedOperatorKey) return true;
  return false;
}

function extractTags(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function resolveSafePath(inputPath, { mustExist = false, safeDataDir } = {}) {
  const allowExternal = process.env.THUMBGATE_ALLOW_EXTERNAL_PATHS === 'true';
  const resolved = path.resolve(String(inputPath || ''));
  const SAFE_DATA_DIR = safeDataDir || getSafeDataDir();
  const inSafeRoot = resolved === SAFE_DATA_DIR || resolved.startsWith(`${SAFE_DATA_DIR}${path.sep}`);

  if (!allowExternal && !inSafeRoot) {
    throw createHttpError(400, `Path must stay within ${SAFE_DATA_DIR}`);
  }

  if (mustExist && !fs.existsSync(resolved)) {
    throw createHttpError(400, `Path does not exist: ${resolved}`);
  }

  return resolved;
}

function resolveDpoExportPaths(body = {}, options = {}) {
  const { safeDataDir, fallbackMemoryLogPath = null } = options;
  return {
    inputPath: body.inputPath
      ? resolveSafePath(body.inputPath, { mustExist: true, safeDataDir })
      : null,
    memoryLogPath: body.memoryLogPath
      ? resolveSafePath(body.memoryLogPath, { mustExist: true, safeDataDir })
      : null,
    outputPath: body.outputPath
      ? resolveSafePath(body.outputPath, { safeDataDir })
      : null,
    fallbackMemoryLogPath,
  };
}

function loadDpoExportMemories({ inputPath, memoryLogPath, fallbackMemoryLogPath = null }) {
  if (inputPath) {
    const raw = fs.readFileSync(inputPath, 'utf-8');
    const parsedMemories = JSON.parse(raw);
    return Array.isArray(parsedMemories) ? parsedMemories : parsedMemories.memories || [];
  }

  return readJSONL(memoryLogPath || fallbackMemoryLogPath || DEFAULT_LOCAL_MEMORY_LOG);
}

function parseJobStatuses(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readHostedJobOrThrow(jobId) {
  const state = readJobState(jobId);
  if (!state) {
    throw createHttpError(404, `Job not found: ${jobId}`);
  }
  return state;
}

function normalizeJobIdFromPath(pathname, suffix = '') {
  const pattern = suffix
    ? new RegExp(`^/v1/jobs/([^/]+)${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
    : /^\/v1\/jobs\/([^/]+)$/;
  const match = pathname.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}

function normalizeDocumentIdFromPath(pathname) {
  const match = pathname.match(/^\/v1\/documents\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function isWithinDir(targetPath, baseDir) {
  if (!baseDir) return false;
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveDocumentImportFilePath(inputPath, options = {}) {
  const normalized = normalizeNullableText(inputPath);
  if (!normalized) return null;

  const { req, parsed, safeDataDir } = options;
  if (!isLoopbackHost(getRequestHostHeader(req))) {
    throw createHttpError(400, 'filePath import is only available on localhost requests; use content for hosted imports');
  }

  const projectDir = resolveRequestProjectDir(req, parsed) || process.cwd();
  const resolved = path.resolve(projectDir, normalized);
  const allowed = isWithinDir(resolved, projectDir) || isWithinDir(resolved, safeDataDir);
  if (!allowed) {
    throw createHttpError(400, `Path must stay within ${projectDir} or ${safeDataDir}`);
  }
  if (!fs.existsSync(resolved)) {
    throw createHttpError(400, `Path does not exist: ${resolved}`);
  }
  return resolved;
}

function createApiServer() {
  const expectedApiKey = getExpectedApiKey();
  const expectedOperatorKey = getExpectedOperatorKey();

  const eventBus = new EventEmitter();
  eventBus.setMaxListeners(200);

  return http.createServer(async (req, res) => {
    const parsed = new URL(req.url, 'http://localhost');
    const pathname = parsed.pathname;
    const isHeadRequest = req.method === 'HEAD';
    const isGetLikeRequest = req.method === 'GET' || isHeadRequest;
    const publicOrigin = getPublicOrigin(req);
    const hostedConfig = resolveHostedBillingConfig({ requestOrigin: publicOrigin });
    if (!isProjectSelectionAllowed(req, parsed)) {
      sendJson(res, 403, { error: 'project selection is only available on localhost requests' });
      return;
    }
    const requestFeedbackPaths = getRequestFeedbackPaths(req, parsed);
    const requestFeedbackDir = requestFeedbackPaths.FEEDBACK_DIR;
    const requestSafeDataDir = getSafeDataDir(req, parsed);

    // PostHog reverse proxy -- bypasses ad blockers.
    // Only allow known PostHog API paths to prevent SSRF (CodeQL js/request-forgery).
    if (pathname.startsWith('/ingest')) {
      const posthogPath = getPosthogProxyPath(pathname);
      if (!isAllowedPosthogProxyPath(posthogPath)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const proxyReq = https.request(buildPosthogProxyRequestOptions(req, posthogPath, parsed.search), (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });
        proxyReq.on('error', () => { res.writeHead(502); res.end(); });
        if (body) proxyReq.write(body);
        proxyReq.end();
      });
      return;
    }

    // Public MCP endpoint — responds to Smithery registry scanning and MCP initialize
    // The initialize handshake is unauthenticated; subsequent tool calls require Bearer auth
    if (pathname === '/mcp') {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const msg = JSON.parse(body);
            if (msg.method === 'initialize') {
              sendJson(res, 200, {
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                  protocolVersion: '2024-11-05',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'thumbgate', version: pkg.version },
                },
              });
            } else if (msg.method === 'notifications/initialized') {
              res.writeHead(204);
              res.end();
            } else if (msg.method === 'tools/list') {
              sendJson(res, 200, {
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                  tools: getPublicMcpTools(),
                },
              });
            } else {
              // All other tool calls require auth — return method not found for unauthenticated
              sendJson(res, 200, {
                jsonrpc: '2.0',
                id: msg.id,
                error: { code: -32601, message: 'Method requires authentication. Provide Bearer token.' },
              });
            }
          } catch (_e) {
            sendProblem(res, {
              type: PROBLEM_TYPES.INVALID_JSON,
              title: 'Invalid JSON',
              status: 400,
              detail: 'The request body could not be parsed as valid JSON.',
            });
          }
        });
        return;
      }
      if (req.method === 'GET') {
        // SSE upgrade or capability probe
        sendJson(res, 200, {
          name: 'thumbgate',
          version: pkg.version,
          transport: ['streamable-http', 'stdio'],
        });
        return;
      }
    }

    // Plausible analytics proxy — bypasses ad blockers for accurate tracking
    if (isGetLikeRequest && pathname === '/js/analytics.js') {
      const proxyReq = https.get('https://plausible.io/js/script.js', (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', (chunk) => chunks.push(chunk));
        proxyRes.on('end', () => {
          let body = Buffer.concat(chunks).toString();
          // Rewrite the API endpoint to go through our proxy
          body = body.replace(
            'new URL(i.src).origin+"/api/event"',
            '"/api/event"'
          );
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(body);
        });
      });
      proxyReq.on('error', () => sendJson(res, 502, { error: 'Analytics proxy failed' }));
      return;
    }

    if (isGetLikeRequest && pathname === '/js/buyer-intent.js') {
      try {
        const script = fs.readFileSync(BUYER_INTENT_SCRIPT_PATH, 'utf-8');
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
        });
        if (!isHeadRequest) {
          res.end(script);
        } else {
          res.end();
        }
      } catch {
        sendJson(res, 404, { error: 'Buyer intent script not found' });
      }
      return;
    }


    // User feedback → GitHub Issues
    if (req.method === 'POST' && pathname === '/api/feedback/submit') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          const { category, message } = body;
          if (!message || message.length < 5) {
            sendJson(res, 400, { error: 'message too short' });
            return;
          }
          const result = await submitProductIssue({
            title: buildProductIssueTitle(message, category),
            body: message,
            category: category || 'bug',
            source: 'dashboard feedback widget',
          });
          sendJson(res, 200, result);
        } catch (e) {
          sendJson(res, 500, { error: 'feedback submission failed' });
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/newsletter') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const accepts = String(req.headers.accept || '').toLowerCase();
          const requestedWith = String(req.headers['x-requested-with'] || '').toLowerCase();
          const wantsJson = accepts.includes('application/json') || requestedWith === 'fetch';
          const body = Buffer.concat(chunks).toString();
          const params = new URLSearchParams(body);
          const email = (params.get('email') || '').trim().toLowerCase();
          if (!email || !email.includes('@')) {
            sendJson(res, 400, { error: 'valid email required' });
            return;
          }
          const newsletterPath = path.join(getFeedbackPaths().FEEDBACK_DIR, 'newsletter-subscribers.jsonl');
          const dir = path.dirname(newsletterPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const existingEntries = fs.existsSync(newsletterPath)
            ? fs.readFileSync(newsletterPath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean)
            : [];
          const duplicate = existingEntries.some((line) => {
            try {
              const entry = JSON.parse(line);
              return String(entry.email || '').trim().toLowerCase() === email;
            } catch {
              return false;
            }
          });
          const referrer = String(req.headers.referer || req.headers.referrer || '').trim();
          let attribution = {};
          let referrerHost = null;
          let landingPath = '/';
          if (referrer) {
            try {
              const referrerUrl = new URL(referrer);
              referrerHost = referrerUrl.host || null;
              landingPath = referrerUrl.pathname || '/';
              attribution = {
                source: referrerUrl.searchParams.get('utm_source') || null,
                medium: referrerUrl.searchParams.get('utm_medium') || null,
                campaign: referrerUrl.searchParams.get('utm_campaign') || null,
                content: referrerUrl.searchParams.get('utm_content') || null,
                term: referrerUrl.searchParams.get('utm_term') || null,
                creator: referrerUrl.searchParams.get('creator') || null,
                community: referrerUrl.searchParams.get('community') || referrerUrl.searchParams.get('subreddit') || null,
                postId: referrerUrl.searchParams.get('post_id') || referrerUrl.searchParams.get('postId') || null,
                commentId: referrerUrl.searchParams.get('comment_id') || referrerUrl.searchParams.get('commentId') || null,
                campaignVariant: referrerUrl.searchParams.get('campaign_variant') || referrerUrl.searchParams.get('variant') || null,
                offerCode: referrerUrl.searchParams.get('offer_code') || referrerUrl.searchParams.get('offer') || null,
                landingPath,
              };
            } catch {
              // Ignore invalid referrer values.
            }
          }
          if (!duplicate) {
            fs.appendFileSync(newsletterPath, JSON.stringify({
              email,
              subscribedAt: new Date().toISOString(),
              source: attribution.source || 'landing-page',
              referrer: referrer || null,
              referrerHost,
              landingPath,
              attribution,
            }) + '\n');
            // Fire-and-forget welcome email. Never blocks the 200 response, never
            // throws — the mailer returns a structured result even on failure, so
            // the signup still succeeds if Resend is down or RESEND_API_KEY is unset.
            Promise.resolve()
              .then(() => resendMailer.sendNewsletterWelcomeEmail({ to: email }))
              .then((result) => {
                if (!result || result.sent !== true) {
                  console.warn('[newsletter] welcome email not sent:', email, result && result.reason);
                }
              })
              .catch((err) => {
                console.warn('[newsletter] welcome email threw:', email, err && err.message);
              });
          }
          const journeyState = resolveJourneyState(req, parsed);
          appendBestEffortTelemetry(getFeedbackPaths().FEEDBACK_DIR, {
            eventType: 'trial_email_captured',
            clientType: 'web',
            acquisitionId: journeyState.acquisitionId,
            visitorId: journeyState.visitorId,
            sessionId: journeyState.sessionId,
            source: attribution.source || 'landing-page',
            utmSource: attribution.source || null,
            utmMedium: attribution.medium || 'newsletter',
            utmCampaign: attribution.campaign || 'trial_email_capture',
            utmContent: attribution.content || null,
            utmTerm: attribution.term || null,
            creator: attribution.creator || null,
            community: attribution.community || null,
            postId: attribution.postId || null,
            commentId: attribution.commentId || null,
            campaignVariant: attribution.campaignVariant || null,
            offerCode: attribution.offerCode || null,
            ctaId: 'trial_email',
            ctaPlacement: landingPath === '/pro' ? 'pro_email_form' : 'homepage_email_form',
            planId: 'pro',
            pipelineStatus: duplicate ? 'duplicate' : 'accepted',
            page: landingPath,
            landingPath,
            referrer: referrer || null,
            referrerHost,
          }, req.headers, 'trial_email_captured');
          if (wantsJson) {
            sendJson(res, 200, {
              accepted: true,
              duplicate,
              email,
              landingPath,
              source: attribution.source || 'landing-page',
            });
            return;
          }
          res.writeHead(302, { Location: '/?subscribed=1' });
          res.end();
        } catch {
          sendJson(res, 500, { error: 'subscription failed' });
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/event') {
      // Filter bots from analytics to keep Plausible data clean
      let _botDetector;
      try { _botDetector = require('../../scripts/bot-detector'); } catch (_e) { _botDetector = null; }
      if (_botDetector && _botDetector.shouldExcludeFromAnalytics(req)) {
        sendJson(res, 202, { status: 'filtered', reason: 'bot' });
        return;
      }
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const proxyReq = https.request('https://plausible.io/api/event', {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'User-Agent': req.headers['user-agent'] || '',
            'X-Forwarded-For': req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
          },
        }, (proxyRes) => {
          const rChunks = [];
          proxyRes.on('data', (c) => rChunks.push(c));
          proxyRes.on('end', () => {
            res.writeHead(proxyRes.statusCode, { 'Access-Control-Allow-Origin': '*' });
            res.end(Buffer.concat(rChunks));
          });
        });
        proxyReq.on('error', () => sendJson(res, 502, { error: 'Event proxy failed' }));
        proxyReq.end(body);
      });
      return;
    }

    // Public endpoints — no auth required
    const trackedLinkMatch = pathname.match(/^\/go\/([^/]+)$/);
    if (isGetLikeRequest && trackedLinkMatch) {
      serveTrackedLinkRedirect({
        req,
        res,
        parsed,
        hostedConfig,
        isHeadRequest,
        slug: trackedLinkMatch[1],
      });
      return;
    }

    if (isGetLikeRequest && pathname === '/robots.txt') {
      sendText(res, 200, renderRobotsTxt(hostedConfig), {
        'Content-Type': 'text/plain; charset=utf-8',
      }, {
        headOnly: isHeadRequest,
      });
      return;
    }

    if (isGetLikeRequest && pathname === '/.well-known/llms.txt') {
      const llmsTxtPath = path.join(__dirname, '..', '..', '.well-known', 'llms.txt');
      try {
        const content = fs.readFileSync(llmsTxtPath, 'utf8');
        sendText(res, 200, content, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }, { headOnly: isHeadRequest });
      } catch {
        sendJson(res, 404, { error: 'llms.txt not found' });
      }
      return;
    }

    if (isGetLikeRequest && pathname === '/sitemap.xml') {
      sendText(res, 200, renderSitemapXml(hostedConfig), {
        'Content-Type': 'application/xml; charset=utf-8',
      }, {
        headOnly: isHeadRequest,
      });
      return;
    }

    if (isGetLikeRequest && pathname === '/llm-context.md') {
      const llmContextPath = path.resolve(__dirname, '../../public/llm-context.md');
      try {
        const content = fs.readFileSync(llmContextPath, 'utf8');
        sendText(res, 200, content, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'X-Robots-Tag': 'all',
        }, {
          headOnly: isHeadRequest,
        });
      } catch (_err) {
        sendJson(res, 404, { error: 'Not found' });
      }
      return;
    }

    // Quick feedback capture via GET — for statusline clickable links
    if (isGetLikeRequest && pathname === '/feedback/quick') {
      const signal = parsed.searchParams.get('signal');
      if (signal === 'up' || signal === 'down') {
        const chatHistory = readRecentConversationWindow({
          feedbackDir: requestSafeDataDir,
          limit: 10,
        });
        const result = captureFeedback({
          signal,
          context: 'Quick capture from Claude Code statusline',
          chatHistory,
          tags: ['statusline', 'quick-capture'],
        });
        const emoji = signal === 'up' ? '👍' : '👎';
        const color = signal === 'up' ? '#22c55e' : '#ef4444';
        const label = signal === 'up' ? 'Positive' : 'Negative';
        const opposite = signal === 'up' ? 'down' : 'up';
        const oppEmoji = signal === 'up' ? '👎' : '👍';
        const feedbackId = result.feedbackEvent?.id || 'saved';
        const promoted = result.accepted ? 'Promoted to memory' : 'Stored';
        sendHtml(res, 200, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ThumbGate — ${label} feedback</title>
<style>
*{box-sizing:border-box}
body{background:#0a0a0a;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center;background:#141414;border:1px solid #222;border-radius:16px;padding:48px 40px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.5)}
.emoji{font-size:80px;margin-bottom:12px;animation:pop .4s ease-out}
@keyframes pop{0%{transform:scale(0)}50%{transform:scale(1.2)}100%{transform:scale(1)}}
.msg{font-size:22px;color:${color};font-weight:700;margin-bottom:4px}
.sub{font-size:13px;color:#666;margin-top:6px;font-family:ui-monospace,monospace}
.context-form{margin-top:20px;text-align:left}
.context-form label{font-size:12px;color:#888;display:block;margin-bottom:6px}
.context-form textarea{width:100%;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#ccc;padding:10px;font-size:13px;resize:vertical;min-height:60px;font-family:system-ui}
.context-form textarea:focus{outline:none;border-color:${color}}
.context-form button{margin-top:8px;background:${color};color:#000;border:none;border-radius:8px;padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer}
.context-form button:hover{opacity:.85}
.actions{margin-top:24px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.actions a{color:#22d3ee;text-decoration:none;font-size:13px;padding:8px 16px;border:1px solid #333;border-radius:8px;transition:all .15s}
.actions a:hover{background:#1a2a2e;border-color:#22d3ee}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#22c55e;color:#000;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600;display:none;animation:slideUp .3s ease-out}
@keyframes slideUp{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:4px;background:#1a1a1a;border:1px solid #333;color:#888;margin-top:8px}
</style></head><body>
<div class="card">
  <div class="emoji">${emoji}</div>
  <div class="msg">${label} feedback recorded</div>
  <div class="sub">${promoted} · <a href="/lessons/${feedbackId}" class="badge" style="color:#22d3ee;text-decoration:none;cursor:pointer" title="View full lesson">${feedbackId}</a></div>
  <div class="context-form" id="contextForm">
    <label>Add follow-up context <span style="color:#555">(what worked or went wrong?)</span></label>
    <textarea id="contextInput" placeholder="e.g. you forgot to check the API schema first..."></textarea>
    <button onclick="addContext()">Save follow-up note</button>
  </div>
  <div class="actions">
    <a href="/lessons/${feedbackId}" title="View the full lesson and edit it">📋 View Lesson</a>
    <a href="/feedback/quick?signal=${opposite}" title="Meant to click ${oppEmoji}?">Undo → send ${oppEmoji} instead</a>
    <a href="/dashboard">Dashboard →</a>
  </div>
</div>
<div class="toast" id="toast">✓ Follow-up note saved</div>
<script>
async function addContext(){
  const ctx=document.getElementById('contextInput').value.trim();
  if(!ctx)return;
  try{
    await fetch('/feedback/quick/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signal:'${signal}',context:ctx,relatedFeedbackId:'${feedbackId}',feedbackSessionId:'${result.feedbackSession?.sessionId || ''}'})});
    document.getElementById('toast').style.display='block';
    document.getElementById('contextForm').style.display='none';
    setTimeout(()=>document.getElementById('toast').style.display='none',3000);
  }catch(e){alert('Failed: '+e.message)}
}
</script></body></html>`);
      } else {
        sendHtml(res, 400, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ThumbGate</title></head><body style="background:#0a0a0a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><div style="font-size:48px">⚠️</div><div style="font-size:18px;margin-top:12px">Missing ?signal=up or ?signal=down</div></div></body></html>`);
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/feedback/quick/context') {
      const body = await parseJsonBody(req);
      const signal = body.signal;
      const context = typeof body.context === 'string' ? body.context.trim() : '';
      const relatedFeedbackId = typeof body.relatedFeedbackId === 'string' ? body.relatedFeedbackId.trim() : '';
      const feedbackSessionId = typeof body.feedbackSessionId === 'string' ? body.feedbackSessionId.trim() : '';
      if (signal !== 'up' && signal !== 'down') {
        sendJson(res, 400, { error: 'signal must be up or down' });
        return;
      }
      if (!context) {
        sendJson(res, 400, { error: 'context is required' });
        return;
      }
      if (!relatedFeedbackId) {
        sendJson(res, 400, { error: 'relatedFeedbackId is required' });
        return;
      }
      const feedbackDir = requestSafeDataDir;
      const detailField = signal === 'down' ? 'whatWentWrong' : 'whatWorked';
      const updated = updateLessonRecord(feedbackDir, relatedFeedbackId, (existing) => {
        const nextTags = Array.from(new Set([
          ...((Array.isArray(existing.tags) ? existing.tags : []).filter(Boolean)),
          'statusline',
          'quick-capture',
          'follow-up-context',
        ]));
        return {
          ...existing,
          tags: nextTags,
          [detailField]: mergeFollowUpDetail(existing[detailField], context),
        };
      });
      if (!updated) {
        sendJson(res, 404, { error: 'Related lesson not found' });
        return;
      }
      let feedbackSession = null;
      if (feedbackSessionId) {
        try {
          const { appendToSession } = require('../../scripts/feedback-session');
          feedbackSession = appendToSession(feedbackSessionId, context, 'user');
        } catch (_err) {
          feedbackSession = { status: 'error' };
        }
      }
      sendJson(res, 200, {
        ok: true,
        relatedFeedbackId,
        detailField,
        updated,
        feedbackSession,
      });
      return;
    }

    if (isGetLikeRequest && pathname === '/dashboard') {
      try {
        const html = loadDashboardPageHtml(req, expectedApiKey);
        sendHtml(res, 200, html, {}, { headOnly: isHeadRequest });
      } catch {
        sendJson(res, 404, { error: 'Dashboard page not found' });
      }
      return;
    }

    // --- Lesson detail: POST /lessons/:id/update ---
    const lessonUpdateMatch = pathname.match(/^\/lessons\/([^/]+)\/update$/);
    if (req.method === 'POST' && lessonUpdateMatch) {
      const lessonId = decodeURIComponent(lessonUpdateMatch[1]);
      const feedbackDir = requestSafeDataDir;
      const body = await parseJsonBody(req);
      const record = findRecordById(lessonId, feedbackDir);
      if (!record) {
        sendJson(res, 404, { error: 'Record not found' });
        return;
      }
      const updated = updateLessonRecord(feedbackDir, lessonId, (existing) => {
        const next = { ...existing };
        if (body.title !== undefined) next.title = body.title;
        if (body.content !== undefined) next.context = body.content;
        if (body.tags !== undefined) {
          next.tags = typeof body.tags === 'string'
            ? body.tags.split(',').map((t) => t.trim()).filter(Boolean)
            : body.tags;
        }
        if (body.whatWentWrong !== undefined) next.whatWentWrong = body.whatWentWrong;
        if (body.whatWorked !== undefined) next.whatWorked = body.whatWorked;
        return next;
      });
      if (!updated) {
        sendJson(res, 404, { error: 'Record not found' });
        return;
      }
      sendJson(res, 200, { ok: true, updated });
      return;
    }

    // --- Lesson detail: POST /lessons/:id/delete ---
    const lessonDeleteMatch = pathname.match(/^\/lessons\/([^/]+)\/delete$/);
    if (req.method === 'POST' && lessonDeleteMatch) {
      const lessonId = decodeURIComponent(lessonDeleteMatch[1]);
      const feedbackDir = requestSafeDataDir;
      const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');
      const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
      const deletedMemory = deleteLessonJsonlRecord(memoryLogPath, lessonId);
      const deletedFeedback = deleteLessonJsonlRecord(feedbackLogPath, lessonId);
      if (!deletedMemory && !deletedFeedback) {
        sendJson(res, 404, { error: 'Record not found' });
        return;
      }
      sendJson(res, 200, { ok: true, deleted: lessonId });
      return;
    }

    // --- Lesson detail page: GET /lessons/:id ---
    const lessonDetailMatch = pathname.match(/^\/lessons\/([^/]+)$/);
    if (isGetLikeRequest && lessonDetailMatch && lessonDetailMatch[1] !== '') {
      const lessonId = decodeURIComponent(lessonDetailMatch[1]);
      const feedbackDir = requestSafeDataDir;
      const record = findRecordById(lessonId, feedbackDir);
      if (!record) {
        sendHtml(res, 404, renderLessonDetailHtml(null, lessonId));
        return;
      }
      sendHtml(res, 200, renderLessonDetailHtml(record, lessonId), {}, { headOnly: isHeadRequest });
      return;
    }

    if (isGetLikeRequest && pathname === '/lessons') {
      try {
        const html = loadLessonsPageHtml(req, expectedApiKey);
        sendHtml(res, 200, html, {}, { headOnly: isHeadRequest });
      } catch {
        sendJson(res, 404, { error: 'Lessons page not found' });
      }
      return;
    }

    const seoPage = findSeoPageByPath(pathname);
    if (isGetLikeRequest && seoPage) {
      try {
        servePublicMarketingPage({
          req,
          res,
          parsed,
          hostedConfig,
          isHeadRequest,
          renderHtml: (runtimeConfig) => renderSeoPageHtml(seoPage, runtimeConfig),
          extraTelemetry: {
            pageType: seoPage.pageType,
            contentPillar: seoPage.pillar,
            primaryQuery: seoPage.query,
          },
        });
      } catch (err) {
        sendText(res, 500, err.message || 'SEO page unavailable');
      }
      return;
    }

    if (isGetLikeRequest && pathname === '/pro') {
      try {
        servePublicMarketingPage({
          req,
          res,
          parsed,
          hostedConfig,
          isHeadRequest,
          renderHtml: loadProPageHtml,
          extraTelemetry: {
            pageType: 'pro',
            planId: 'pro',
          },
        });
      } catch (err) {
        sendText(res, 500, err.message || 'Pro page unavailable');
      }
      return;
    }

    if (isGetLikeRequest && pathname === '/guide') {
      try {
        const html = fs.readFileSync(GUIDE_PAGE_PATH, 'utf-8');
        sendHtml(res, 200, html, {}, { headOnly: isHeadRequest });
      } catch {
        sendJson(res, 404, { error: 'Guide page not found' });
      }
      return;
    }

    if (isGetLikeRequest && pathname === '/codex-plugin') {
      try {
        const html = fs.readFileSync(CODEX_PLUGIN_PAGE_PATH, 'utf-8');
        sendHtml(res, 200, html, {}, { headOnly: isHeadRequest });
      } catch {
        sendJson(res, 404, { error: 'Codex plugin page not found' });
      }
      return;
    }

    if (isGetLikeRequest && pathname === '/compare') {
      try {
        const html = fs.readFileSync(COMPARE_PAGE_PATH, 'utf-8');
        sendHtml(res, 200, html, {}, { headOnly: isHeadRequest });
      } catch {
        sendJson(res, 404, { error: 'Compare page not found' });
      }
      return;
    }

    if (isGetLikeRequest && pathname === '/blog') {
      try {
        const blogPath = path.resolve(__dirname, '../../public/blog.html');
        const html = fs.readFileSync(blogPath, 'utf-8');
        sendHtml(res, 200, html, {}, { headOnly: isHeadRequest });
      } catch {
        sendJson(res, 404, { error: 'Blog page not found' });
      }
      return;
    }

    if (isGetLikeRequest && pathname === '/learn') {
      try {
        const html = fs.readFileSync(LEARN_PAGE_PATH, 'utf-8');
        sendHtml(res, 200, html, {}, { headOnly: isHeadRequest });
      } catch {
        sendJson(res, 404, { error: 'Learn page not found' });
      }
      return;
    }

    if (isGetLikeRequest && (pathname === '/numbers' || pathname === '/numbers.html')) {
      // Route through servePublicMarketingPage so landing_page_view telemetry
      // + funnel-events.jsonl `discovery/landing_view` get captured with UTM
      // attribution — critical for Zernio social CTAs that target /numbers.
      try {
        servePublicMarketingPage({
          req,
          res,
          parsed,
          hostedConfig,
          isHeadRequest,
          renderHtml: () => fs.readFileSync(NUMBERS_PAGE_PATH, 'utf-8'),
          extraTelemetry: { pageType: 'numbers' },
        });
      } catch {
        sendJson(res, 404, { error: 'Numbers page not found' });
      }
      return;
    }

    if (isGetLikeRequest && pathname === '/learn/learn.css') {
      try {
        const cssPath = path.join(LEARN_DIR, 'learn.css');
        const css = fs.readFileSync(cssPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
        if (!isHeadRequest) res.end(css);
        else res.end();
      } catch {
        sendJson(res, 404, { error: 'Stylesheet not found' });
      }
      return;
    }

    if (isGetLikeRequest && pathname.startsWith('/learn/')) {
      try {
        const slug = pathname.replace('/learn/', '').replace(/[^a-z0-9-]/g, '');
        const articlePath = path.join(LEARN_DIR, `${slug}.html`);
        if (!articlePath.startsWith(LEARN_DIR)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        const html = fs.readFileSync(articlePath, 'utf-8');
        sendHtml(res, 200, html, {}, { headOnly: isHeadRequest });
      } catch {
        sendJson(res, 404, { error: 'Article not found' });
      }
      return;
    }

    if (isGetLikeRequest && pathname.startsWith('/guides/')) {
      try {
        const slug = pathname.replace('/guides/', '').replace(/[^a-z0-9-]/g, '');
        const guidePath = path.join(GUIDES_DIR, `${slug}.html`);
        if (!guidePath.startsWith(GUIDES_DIR)) { sendJson(res, 403, { error: 'Forbidden' }); return; }
        const html = fs.readFileSync(guidePath, 'utf-8');
        sendHtml(res, 200, html, {}, { headOnly: isHeadRequest });
      } catch { sendJson(res, 404, { error: 'Guide not found' }); }
      return;
    }

    if (isGetLikeRequest && pathname.startsWith('/compare/') && pathname !== '/compare') {
      try {
        const slug = pathname.replace('/compare/', '').replace(/[^a-z0-9-]/g, '');
        const comparePath = path.join(COMPARE_DIR, `${slug}.html`);
        if (!comparePath.startsWith(COMPARE_DIR)) { sendJson(res, 403, { error: 'Forbidden' }); return; }
        const html = fs.readFileSync(comparePath, 'utf-8');
        sendHtml(res, 200, html, {}, { headOnly: isHeadRequest });
      } catch { sendJson(res, 404, { error: 'Comparison not found' }); }
      return;
    }

    if (isGetLikeRequest && pathname.startsWith('/assets/')) {
      const rel = pathname.slice('/assets/'.length);
      const resolved = path.resolve(PUBLIC_ASSETS_DIR, rel);
      if (!resolved.startsWith(PUBLIC_ASSETS_DIR + path.sep) && resolved !== PUBLIC_ASSETS_DIR) {
        sendJson(res, 403, { error: 'Forbidden' });
        return;
      }
      serveStaticFile(res, resolved, { headOnly: isHeadRequest });
      return;
    }

    if (isGetLikeRequest && (
      pathname === '/favicon.ico'
      || pathname === '/thumbgate-logo.png'
      || pathname === '/thumbgate-icon.png'
      || pathname === '/og.png'
      || pathname === '/apple-touch-icon.png'
    )) {
      serveStaticFile(res, path.join(PUBLIC_DIR, pathname.slice(1)), { headOnly: isHeadRequest });
      return;
    }

    if (isGetLikeRequest && pathname === '/') {
      if (wantsJson(req, parsed)) {
        sendJson(res, 200, {
          name: 'thumbgate',
          version: pkg.version,
          status: 'ok',
          docs: 'https://github.com/IgorGanapolsky/ThumbGate',
          endpoints: ['/health', '/dashboard', '/guide', '/codex-plugin', '/compare', '/learn', '/v1/feedback/capture', '/v1/feedback/stats', '/v1/feedback/summary', '/v1/lessons/search', '/v1/search', '/v1/documents', '/v1/documents/import', '/v1/documents/{documentId}', '/v1/dashboard', '/v1/dashboard/render-spec', '/v1/decisions/evaluate', '/v1/decisions/outcome', '/v1/decisions/metrics', '/v1/settings/status', '/v1/dpo/export', '/v1/jobs', '/v1/jobs/harness', '/v1/analytics/databricks/export'],
        }, {}, {
          headOnly: isHeadRequest,
        });
        return;
      }

      try {
        servePublicMarketingPage({
          req,
          res,
          parsed,
          hostedConfig,
          isHeadRequest,
          renderHtml: loadLandingPageHtml,
          extraTelemetry: {
            pageType: 'homepage',
          },
        });
      } catch (err) {
        sendText(res, 500, err.message || 'Landing page unavailable');
      }
      return;
    }

    if (isGetLikeRequest && pathname === '/checkout/pro') {
      if (isHeadRequest) {
        sendText(res, 200, '', {}, {
          headOnly: true,
        });
        return;
      }

      const { FEEDBACK_DIR } = getFeedbackPaths();
      const journeyState = resolveJourneyState(req, parsed);
      const bootstrapBody = buildCheckoutBootstrapBody(parsed, req, journeyState);
      const traceId = bootstrapBody.traceId || createJourneyId('checkout');
      const analyticsMetadata = buildCheckoutAttributionMetadata(bootstrapBody, req, traceId);
      const responseHeaders = journeyState.setCookieHeaders.length
        ? { 'Set-Cookie': journeyState.setCookieHeaders }
        : {};

      const botClassification = classifyRequester(req.headers);
      const confirmParam = parsed?.searchParams?.get('confirm') ?? null;
      const isConfirmedCheckout = confirmParam === '1'
        || confirmParam === 'true'
        || req.method === 'POST';
      if (!isConfirmedCheckout && botClassification.isBot) {
        const eventType = 'checkout_bot_deflected';
        appendBestEffortTelemetry(FEEDBACK_DIR, {
          eventType,
          clientType: 'web',
          traceId,
          acquisitionId: analyticsMetadata.acquisitionId,
          visitorId: analyticsMetadata.visitorId,
          sessionId: analyticsMetadata.sessionId,
          utmSource: analyticsMetadata.utmSource,
          utmMedium: analyticsMetadata.utmMedium,
          utmCampaign: analyticsMetadata.utmCampaign,
          utmContent: analyticsMetadata.utmContent,
          utmTerm: analyticsMetadata.utmTerm,
          referrer: analyticsMetadata.referrer,
          referrerHost: analyticsMetadata.referrerHost,
          page: '/checkout/pro',
          ctaId: analyticsMetadata.ctaId,
          ctaPlacement: analyticsMetadata.ctaPlacement,
          planId: analyticsMetadata.planId,
          reason: botClassification.reason,
        }, req.headers, eventType);
        const workflowIntakeHref = buildCheckoutIntentHref(`${hostedConfig.appOrigin}/#workflow-sprint-intake`, analyticsMetadata, {
          utmMedium: 'checkout_interstitial_recovery',
          utmCampaign: analyticsMetadata.utmCampaign || 'checkout_interstitial_workflow_sprint',
          ctaId: 'checkout_interstitial_workflow_sprint_intake',
          ctaPlacement: 'checkout_interstitial',
          planId: 'team',
        });
        const teamOptionsHref = buildCheckoutIntentHref(`${hostedConfig.appOrigin}/guides/ai-agent-governance-sprint`, analyticsMetadata, {
          utmMedium: 'checkout_interstitial_paid_path',
          utmCampaign: analyticsMetadata.utmCampaign || 'checkout_interstitial_team_paid_path',
          ctaId: 'checkout_interstitial_team_paid_path',
          ctaPlacement: 'checkout_interstitial',
          planId: 'team',
        });
        const diagnosticCheckoutHref = hostedConfig.sprintDiagnosticCheckoutUrl
          ? buildCheckoutIntentHref(hostedConfig.sprintDiagnosticCheckoutUrl, analyticsMetadata, {
            utmMedium: 'checkout_interstitial_paid_path',
            utmCampaign: analyticsMetadata.utmCampaign || 'checkout_interstitial_diagnostic',
            ctaId: 'checkout_interstitial_sprint_diagnostic_checkout',
            ctaPlacement: 'checkout_interstitial',
            planId: 'sprint_diagnostic',
          })
          : '';
        const sprintCheckoutHref = hostedConfig.workflowSprintCheckoutUrl
          ? buildCheckoutIntentHref(hostedConfig.workflowSprintCheckoutUrl, analyticsMetadata, {
            utmMedium: 'checkout_interstitial_paid_path',
            utmCampaign: analyticsMetadata.utmCampaign || 'checkout_interstitial_workflow_sprint',
            ctaId: 'checkout_interstitial_workflow_sprint_checkout',
            ctaPlacement: 'checkout_interstitial',
            planId: 'workflow_sprint',
          })
          : '';
        const html = renderCheckoutIntentPage({
          confirmHref: buildCheckoutConfirmHref(parsed),
          workflowIntakeHref,
          teamOptionsHref,
          diagnosticCheckoutHref,
          sprintCheckoutHref,
          sprintDiagnosticPriceDollars: hostedConfig.sprintDiagnosticPriceDollars || 499,
          workflowSprintPriceDollars: hostedConfig.workflowSprintPriceDollars || 1500,
          botClassification,
        });
        sendHtml(res, 200, html, responseHeaders);
        return;
      }

      const normalizedCheckoutEmail = normalizeCheckoutCustomerEmail(bootstrapBody.customerEmail);
      if (!normalizedCheckoutEmail) {
        appendBestEffortTelemetry(FEEDBACK_DIR, {
          eventType: 'checkout_email_deferred_to_stripe',
          clientType: 'web',
          traceId,
          page: '/checkout/pro',
          planId: analyticsMetadata.planId,
        }, req.headers, 'checkout_email_deferred_to_stripe');
      }
      bootstrapBody.customerEmail = normalizedCheckoutEmail || undefined;

      appendBestEffortTelemetry(FEEDBACK_DIR, {
        eventType: 'checkout_bootstrap',
        clientType: 'web',
        installId: bootstrapBody.installId,
        acquisitionId: analyticsMetadata.acquisitionId,
        visitorId: analyticsMetadata.visitorId,
        sessionId: analyticsMetadata.sessionId,
        traceId,
        source: analyticsMetadata.source,
        utmSource: analyticsMetadata.utmSource,
        utmMedium: analyticsMetadata.utmMedium,
        utmCampaign: analyticsMetadata.utmCampaign,
        utmContent: analyticsMetadata.utmContent,
        utmTerm: analyticsMetadata.utmTerm,
        creator: analyticsMetadata.creator,
        community: analyticsMetadata.community,
        postId: analyticsMetadata.postId,
        commentId: analyticsMetadata.commentId,
        campaignVariant: analyticsMetadata.campaignVariant,
        offerCode: analyticsMetadata.offerCode,
        landingPath: analyticsMetadata.landingPath,
        page: '/checkout/pro',
        ctaId: analyticsMetadata.ctaId,
        ctaPlacement: analyticsMetadata.ctaPlacement,
        planId: analyticsMetadata.planId,
        billingCycle: analyticsMetadata.billingCycle,
        seatCount: analyticsMetadata.seatCount,
        referrer: analyticsMetadata.referrer,
        referrerHost: analyticsMetadata.referrerHost,
      }, req.headers, 'checkout_bootstrap');

      try {
        const result = await createCheckoutSession({
          successUrl: buildCheckoutFallbackUrl(
            buildHostedSuccessUrl(hostedConfig.appOrigin, traceId),
            analyticsMetadata,
          ),
          cancelUrl: buildCheckoutFallbackUrl(
            buildHostedCancelUrl(hostedConfig.appOrigin, traceId),
            analyticsMetadata,
          ),
          customerEmail: bootstrapBody.customerEmail,
          installId: bootstrapBody.installId,
          traceId,
          metadata: analyticsMetadata,
          appOrigin: hostedConfig.appOrigin,
        });

        if (result.url) {
          res.writeHead(302, {
            ...responseHeaders,
            Location: result.url,
          });
          res.end();
          return;
        }

        const successUrl = new URL('/success', hostedConfig.appOrigin);
        successUrl.searchParams.set('session_id', result.sessionId);
        successUrl.searchParams.set('trace_id', traceId);
        appendQueryParam(successUrl, 'acquisition_id', analyticsMetadata.acquisitionId);
        appendQueryParam(successUrl, 'visitor_id', analyticsMetadata.visitorId);
        appendVisitorSessionQueryParam(successUrl, analyticsMetadata.sessionId);
        appendQueryParam(successUrl, 'install_id', bootstrapBody.installId);
        appendQueryParam(successUrl, 'utm_source', analyticsMetadata.utmSource);
        appendQueryParam(successUrl, 'utm_medium', analyticsMetadata.utmMedium);
        appendQueryParam(successUrl, 'utm_campaign', analyticsMetadata.utmCampaign);
        appendQueryParam(successUrl, 'utm_content', analyticsMetadata.utmContent);
        appendQueryParam(successUrl, 'utm_term', analyticsMetadata.utmTerm);
        appendQueryParam(successUrl, 'creator', analyticsMetadata.creator);
        appendQueryParam(successUrl, 'community', analyticsMetadata.community);
        appendQueryParam(successUrl, 'post_id', analyticsMetadata.postId);
        appendQueryParam(successUrl, 'comment_id', analyticsMetadata.commentId);
        appendQueryParam(successUrl, 'campaign_variant', analyticsMetadata.campaignVariant);
        appendQueryParam(successUrl, 'offer_code', analyticsMetadata.offerCode);
        appendQueryParam(successUrl, 'cta_id', analyticsMetadata.ctaId);
        appendQueryParam(successUrl, 'cta_placement', analyticsMetadata.ctaPlacement);
        appendQueryParam(successUrl, 'plan_id', analyticsMetadata.planId);
        appendQueryParam(successUrl, 'billing_cycle', analyticsMetadata.billingCycle);
        appendQueryParam(successUrl, 'seat_count', analyticsMetadata.seatCount);
        appendQueryParam(successUrl, 'landing_path', analyticsMetadata.landingPath);
        appendQueryParam(successUrl, 'referrer_host', analyticsMetadata.referrerHost);
        res.writeHead(302, {
          ...responseHeaders,
          Location: successUrl.toString(),
        });
        res.end();
      } catch (err) {
        appendBestEffortTelemetry(FEEDBACK_DIR, {
          eventType: 'checkout_api_failed',
          clientType: 'web',
          installId: bootstrapBody.installId,
          acquisitionId: analyticsMetadata.acquisitionId,
          visitorId: analyticsMetadata.visitorId,
          sessionId: analyticsMetadata.sessionId,
          traceId,
          source: analyticsMetadata.source,
          utmSource: analyticsMetadata.utmSource,
          utmMedium: analyticsMetadata.utmMedium,
          utmCampaign: analyticsMetadata.utmCampaign,
          utmContent: analyticsMetadata.utmContent,
          utmTerm: analyticsMetadata.utmTerm,
          creator: analyticsMetadata.creator,
          landingPath: analyticsMetadata.landingPath,
          page: '/checkout/pro',
          ctaId: analyticsMetadata.ctaId,
          ctaPlacement: analyticsMetadata.ctaPlacement,
          planId: analyticsMetadata.planId,
          billingCycle: analyticsMetadata.billingCycle,
          seatCount: analyticsMetadata.seatCount,
          referrer: analyticsMetadata.referrer,
          referrerHost: analyticsMetadata.referrerHost,
          failureCode: err && err.message ? err.message : 'checkout_bootstrap_failed',
          httpStatus: err && err.statusCode ? err.statusCode : null,
        }, req.headers, 'checkout_api_failed');
        res.writeHead(302, {
          ...responseHeaders,
          Location: buildCheckoutFallbackUrl(hostedConfig.checkoutFallbackUrl, analyticsMetadata),
        });
        res.end();
      }
      return;
    }

    if (isGetLikeRequest && pathname === '/success') {
      if (isHeadRequest) {
        sendHtml(res, 200, renderCheckoutSuccessPage(hostedConfig), {}, {
          headOnly: true,
        });
        return;
      }

      const { FEEDBACK_DIR } = getFeedbackPaths();
      const journeyState = resolveJourneyState(req, parsed);
      appendBestEffortTelemetry(FEEDBACK_DIR, {
        eventType: 'checkout_success_page_view',
        ...buildCheckoutPageTelemetryMetadata(parsed, req, journeyState, '/success'),
      }, req.headers, 'checkout_success_page_view');
      sendHtml(
        res,
        200,
        renderCheckoutSuccessPage(hostedConfig),
        journeyState.setCookieHeaders.length ? { 'Set-Cookie': journeyState.setCookieHeaders } : {}
      );
      return;
    }

    if (isGetLikeRequest && pathname === '/cancel') {
      if (isHeadRequest) {
        sendHtml(res, 200, renderCheckoutCancelledPage(hostedConfig), {}, {
          headOnly: true,
        });
        return;
      }

      const { FEEDBACK_DIR } = getFeedbackPaths();
      const journeyState = resolveJourneyState(req, parsed);
      appendBestEffortTelemetry(FEEDBACK_DIR, {
        eventType: 'checkout_cancel_page_view',
        ...buildCheckoutPageTelemetryMetadata(parsed, req, journeyState, '/cancel'),
      }, req.headers, 'checkout_cancel_page_view');
      sendHtml(
        res,
        200,
        renderCheckoutCancelledPage(hostedConfig),
        journeyState.setCookieHeaders.length ? { 'Set-Cookie': journeyState.setCookieHeaders } : {}
      );
      return;
    }

    if (isGetLikeRequest && pathname === '/.well-known/mcp.json') {
      sendJson(res, 200, getMcpDiscoveryManifest(hostedConfig), {}, {
        headOnly: isHeadRequest,
      });
      return;
    }

    if (isGetLikeRequest && pathname === '/.well-known/mcp/tools.json') {
      sendJson(res, 200, {
        name: 'thumbgate',
        version: pkg.version,
        count: MCP_TOOLS.length,
        tools: getToolDiscoveryIndex(hostedConfig),
      }, {}, {
        headOnly: isHeadRequest,
      });
      return;
    }

    if (isGetLikeRequest && pathname === '/.well-known/mcp/footprint.json') {
      sendJson(res, 200, {
        name: 'thumbgate',
        version: pkg.version,
        ...getContextFootprintReport(hostedConfig),
      }, {}, {
        headOnly: isHeadRequest,
      });
      return;
    }

    if (isGetLikeRequest && pathname.startsWith('/.well-known/mcp/tools/') && pathname.endsWith('.json')) {
      const encodedToolName = pathname.slice('/.well-known/mcp/tools/'.length, -'.json'.length);
      let toolName = encodedToolName;
      try {
        toolName = decodeURIComponent(encodedToolName);
      } catch (_err) {
        sendJson(res, 400, {
          error: 'invalid_tool_name',
          toolIndexUrl: buildPublicUrl(hostedConfig, '/.well-known/mcp/tools.json'),
        }, {}, {
          headOnly: isHeadRequest,
        });
        return;
      }
      const tool = MCP_TOOLS.find((candidate) => candidate.name === toolName);
      if (!tool) {
        sendJson(res, 404, {
          error: 'tool_not_found',
          toolName,
          toolIndexUrl: buildPublicUrl(hostedConfig, '/.well-known/mcp/tools.json'),
        }, {}, {
          headOnly: isHeadRequest,
        });
        return;
      }
      sendJson(res, 200, {
        name: tool.name,
        description: tool.description,
        annotations: tool.annotations || {},
        inputSchema: tool.inputSchema,
      }, {}, {
        headOnly: isHeadRequest,
      });
      return;
    }

    if (isGetLikeRequest && pathname === '/.well-known/mcp/skills.json') {
      sendJson(res, 200, {
        name: 'thumbgate',
        version: pkg.version,
        skills: getMcpSkillManifests(hostedConfig),
      }, {}, {
        headOnly: isHeadRequest,
      });
      return;
    }

    if (isGetLikeRequest && pathname === '/.well-known/mcp/applications.json') {
      sendJson(res, 200, {
        name: 'thumbgate',
        version: pkg.version,
        applications: getMcpApplications(hostedConfig),
      }, {}, {
        headOnly: isHeadRequest,
      });
      return;
    }

    if (isGetLikeRequest && pathname === '/.well-known/mcp/server-card.json') {
      const discoveryManifest = getMcpDiscoveryManifest(hostedConfig);
      sendJson(res, 200, {
        serverInfo: {
          name: 'thumbgate',
          version: pkg.version,
        },
        name: 'thumbgate',
        description: 'Pre-action gates that physically block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks. Works with Claude Code, Codex, Gemini, Amp, Cursor, OpenCode, and any MCP-compatible agent.',
        version: pkg.version,
        transport: discoveryManifest.transport,
        discovery: discoveryManifest.discovery,
        footprint: discoveryManifest.footprint,
        tools: getServerCardTools(),
        skills: getMcpSkillManifests(hostedConfig),
        applications: getMcpApplications(hostedConfig),
        proof: discoveryManifest.proof,
        repository: 'https://github.com/IgorGanapolsky/ThumbGate',
        homepage: hostedConfig.appOrigin,
      }, {}, {
        headOnly: isHeadRequest,
      });
      return;
    }

    if (isGetLikeRequest && pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        version: pkg.version,
        buildSha: BUILD_METADATA.buildSha,
        uptime: process.uptime(),
        deployment: {
          appOrigin: hostedConfig.appOrigin,
          billingApiBaseUrl: hostedConfig.billingApiBaseUrl,
        },
      }, {}, {
        headOnly: isHeadRequest,
      });
      return;
    }

    if (isGetLikeRequest && pathname === '/healthz') {
      const { FEEDBACK_LOG_PATH, MEMORY_LOG_PATH } = requestFeedbackPaths;
      sendJson(res, 200, {
        status: 'ok',
        feedbackLogPath: FEEDBACK_LOG_PATH,
        memoryLogPath: MEMORY_LOG_PATH,
      }, {}, {
        headOnly: isHeadRequest,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/telemetry/ping') {
      const { FEEDBACK_DIR } = getFeedbackPaths();
      try {
        const payload = await parseJsonBody(req, 16 * 1024);
        appendTelemetryPing(FEEDBACK_DIR, payload, req.headers);
      } catch (err) {
        try {
          appendDiagnosticRecord({
            source: 'telemetry_ingest',
            step: 'telemetry_ingest',
            context: 'best-effort telemetry ingest failed',
            metadata: {
              path: pathname,
              method: req.method,
              reason: err && err.statusCode && err.statusCode < 500 ? 'invalid_payload' : 'write_failed',
              error: err && err.message ? err.message : 'unknown_error',
            },
            diagnosis: {
              diagnosed: true,
              rootCauseCategory: err && err.statusCode && err.statusCode < 500 ? 'invalid_invocation' : 'system_failure',
              criticalFailureStep: 'telemetry_ingest',
              violations: [{
                constraintId: 'telemetry:ingest',
                message: 'Telemetry ping could not be processed.',
              }],
              evidence: [err && err.message ? err.message : 'unknown_error'],
            },
          });
        } catch (_) {
          // Telemetry is best-effort and must never fail the caller.
        }
      }
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Length': '0',
      });
      res.end();
      return;
    }

    if (req.method === 'OPTIONS' && pathname === '/v1/telemetry/ping') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/metrics/real') {
      const bd = require('../../scripts/bot-detector');
      const { FEEDBACK_DIR: metricsDir } = getFeedbackPaths();
      const telemetryPath = path.join(metricsDir, 'telemetry-pings.jsonl');
      let entries = [];
      try {
        if (fs.existsSync(telemetryPath)) {
          entries = fs.readFileSync(telemetryPath, 'utf8')
            .split('\n').filter(Boolean)
            .map(l => { try { return JSON.parse(l); } catch(_e) { return null; } })
            .filter(Boolean);
        }
      } catch { entries = []; }

      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

      const classified = entries.map(e => {
        const cls = bd.classifyVisitor({ headers: { 'user-agent': e.userAgent || '' }, email: e.email || '' });
        return { ...e, visitorType: e.visitorType || cls.type };
      });

      const recent = classified.filter(e => {
        const ts = e.timestamp || e.receivedAt;
        return ts && new Date(ts).getTime() > sevenDaysAgo;
      });

      const uniqueInstallIds = new Set(classified.filter(e => e.installId).map(e => e.installId));
      const recentInstallIds = new Set(recent.filter(e => e.installId).map(e => e.installId));

      const byEventType = {};
      classified.forEach(e => {
        const et = e.eventType || 'unknown';
        byEventType[et] = (byEventType[et] || 0) + 1;
      });

      const byVisitorType = {};
      classified.forEach(e => {
        byVisitorType[e.visitorType] = (byVisitorType[e.visitorType] || 0) + 1;
      });

      sendJson(res, 200, {
        allTime: {
          total: classified.length,
          real_users: classified.filter(e => e.visitorType === 'real_user').length,
          bots: classified.filter(e => e.visitorType === 'bot').length,
          owner: classified.filter(e => e.visitorType === 'owner').length,
          ci: classified.filter(e => e.visitorType === 'ci').length,
          uniqueInstalls: uniqueInstallIds.size,
        },
        last7Days: {
          total: recent.length,
          real_users: recent.filter(e => e.visitorType === 'real_user').length,
          bots: recent.filter(e => e.visitorType === 'bot').length,
          owner: recent.filter(e => e.visitorType === 'owner').length,
          ci: recent.filter(e => e.visitorType === 'ci').length,
          uniqueInstalls: recentInstallIds.size,
        },
        byEventType,
        byVisitorType,
      });
      return;
    }

    if (req.method === 'OPTIONS' && pathname === '/v1/intake/workflow-sprint') {
      sendPublicBillingPreflight(res);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/intake/workflow-sprint') {
      const { FEEDBACK_DIR } = getFeedbackPaths();
      const traceId = createTraceId('sprint_intake');
      const journeyState = resolveJourneyState(req, parsed);
      const referrerAttribution = buildReferrerAttribution(req);
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      const isJsonRequest = contentType.includes('application/json');
      const isFormSubmission = contentType.includes('application/x-www-form-urlencoded');
      try {
        const body = isFormSubmission
          ? await parseFormBody(req, 24 * 1024)
          : await parseJsonBody(req, 24 * 1024);
        const workflowSprintIntake = requirePrivateApiModule('workflowSprintIntake', 'Workflow sprint intake');
        const lead = workflowSprintIntake.appendWorkflowSprintLead({
          ...body,
          traceId: body.traceId || traceId,
          acquisitionId: body.acquisitionId || journeyState.acquisitionId,
          visitorId: body.visitorId || journeyState.visitorId,
          sessionId: body.sessionId || journeyState.sessionId,
          page: body.page || referrerAttribution.page || '/#workflow-sprint-intake',
          landingPath: body.landingPath || referrerAttribution.landingPath || '/',
          ctaId: body.ctaId || 'workflow_sprint_intake',
          ctaPlacement: body.ctaPlacement || 'workflow_sprint',
          planId: body.planId || 'sprint',
          source: body.source || body.utmSource || referrerAttribution.source || 'website',
          utmSource: body.utmSource || body.source || referrerAttribution.utmSource || 'website',
          utmMedium: body.utmMedium || referrerAttribution.utmMedium || 'workflow_sprint_intake',
          utmCampaign: body.utmCampaign || referrerAttribution.utmCampaign || 'workflow_hardening_sprint',
          utmContent: body.utmContent || referrerAttribution.utmContent || null,
          utmTerm: body.utmTerm || referrerAttribution.utmTerm || null,
          creator: body.creator || referrerAttribution.creator || null,
          community: body.community || referrerAttribution.community || null,
          postId: body.postId || referrerAttribution.postId || null,
          commentId: body.commentId || referrerAttribution.commentId || null,
          campaignVariant: body.campaignVariant || referrerAttribution.campaignVariant || null,
          offerCode: body.offerCode || referrerAttribution.offerCode || null,
          referrerHost: body.referrerHost || referrerAttribution.referrerHost || null,
          referrer: body.referrer || referrerAttribution.referrer || null,
        }, { feedbackDir: FEEDBACK_DIR });

        appendBestEffortTelemetry(FEEDBACK_DIR, {
          eventType: 'workflow_sprint_lead_submitted',
          clientType: 'web',
          traceId: lead.attribution.traceId,
          acquisitionId: lead.attribution.acquisitionId,
          visitorId: lead.attribution.visitorId,
          sessionId: lead.attribution.sessionId,
          installId: lead.attribution.installId,
          source: lead.attribution.source,
          utmSource: lead.attribution.utmSource,
          utmMedium: lead.attribution.utmMedium,
          utmCampaign: lead.attribution.utmCampaign,
          utmContent: lead.attribution.utmContent,
          utmTerm: lead.attribution.utmTerm,
          creator: lead.attribution.creator,
          community: lead.attribution.community,
          postId: lead.attribution.postId,
          commentId: lead.attribution.commentId,
          campaignVariant: lead.attribution.campaignVariant,
          offerCode: lead.attribution.offerCode,
          ctaId: lead.attribution.ctaId,
          ctaPlacement: lead.attribution.ctaPlacement,
          planId: lead.attribution.planId,
          page: lead.attribution.page,
          landingPath: lead.attribution.landingPath,
          referrerHost: lead.attribution.referrerHost,
          referrer: lead.attribution.referrer,
        }, req.headers, 'workflow_sprint_lead_submitted');

        if (isFormSubmission && !wantsJson(req, parsed)) {
          sendHtml(
            res,
            201,
            renderWorkflowSprintIntakeResultPage(hostedConfig, {
              title: 'Workflow sprint intake received',
              detail: 'The workflow is now queued for review. Check the proof pack and sprint brief while we qualify the rollout blocker.',
              leadId: lead.leadId,
            }),
            journeyState.setCookieHeaders.length ? { 'Set-Cookie': journeyState.setCookieHeaders } : {}
          );
          return;
        }

        sendJson(res, 201, {
          ok: true,
          leadId: lead.leadId,
          status: lead.status,
          offer: lead.offer,
          nextStep: 'review_proof_pack',
          proofPackUrl: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md',
          sprintBriefUrl: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/WORKFLOW_HARDENING_SPRINT.md',
        }, {
          ...getPublicBillingHeaders(lead.attribution.traceId),
          ...(journeyState.setCookieHeaders.length ? { 'Set-Cookie': journeyState.setCookieHeaders } : {}),
        });
      } catch (err) {
        appendBestEffortTelemetry(FEEDBACK_DIR, {
          eventType: 'workflow_sprint_lead_failed',
          clientType: 'web',
          traceId,
          acquisitionId: journeyState.acquisitionId,
          visitorId: journeyState.visitorId,
          sessionId: journeyState.sessionId,
          source: referrerAttribution.source || 'website',
          utmSource: referrerAttribution.utmSource || 'website',
          utmMedium: referrerAttribution.utmMedium || 'workflow_sprint_intake',
          utmCampaign: referrerAttribution.utmCampaign || 'workflow_hardening_sprint',
          creator: referrerAttribution.creator,
          community: referrerAttribution.community,
          postId: referrerAttribution.postId,
          commentId: referrerAttribution.commentId,
          campaignVariant: referrerAttribution.campaignVariant,
          offerCode: referrerAttribution.offerCode,
          ctaId: 'workflow_sprint_intake',
          ctaPlacement: 'workflow_sprint',
          planId: 'sprint',
          page: referrerAttribution.page || '/#workflow-sprint-intake',
          landingPath: referrerAttribution.landingPath || '/',
          referrerHost: referrerAttribution.referrerHost,
          referrer: referrerAttribution.referrer,
          failureCode: err && err.message ? err.message : 'workflow_sprint_lead_failed',
          httpStatus: err && err.statusCode ? err.statusCode : null,
        }, req.headers, 'workflow_sprint_lead_failed');
        if (isFormSubmission && !wantsJson(req, parsed)) {
          sendHtml(
            res,
            err.statusCode || 500,
            renderWorkflowSprintIntakeResultPage(hostedConfig, {
              title: 'Workflow sprint intake failed',
              detail: err.message || 'Unable to capture workflow sprint intake.',
            }),
            journeyState.setCookieHeaders.length ? { 'Set-Cookie': journeyState.setCookieHeaders } : {}
          );
          return;
        }
        sendProblem(res, {
          type: !err.statusCode || err.statusCode >= 500 ? PROBLEM_TYPES.INTERNAL : PROBLEM_TYPES.BAD_REQUEST,
          title: !err.statusCode || err.statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
          status: err.statusCode || 500,
          detail: err.message || 'Unable to capture workflow sprint intake.',
        }, getPublicBillingHeaders(traceId));
      }
      return;
    }

    // Public OpenAPI spec — no auth required (needed for ChatGPT GPT Store import)
    if (isGetLikeRequest && (pathname === '/openapi.json' || pathname === '/openapi.yaml')) {
      const specPath = path.join(__dirname, '../../adapters/chatgpt/openapi.yaml');
      try {
        const yaml = renderOpenApiYamlForRequest(fs.readFileSync(specPath, 'utf8'), req);
        if (pathname === '/openapi.yaml') {
          sendText(res, 200, yaml, {
            'Content-Type': 'text/yaml; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          }, {
            headOnly: isHeadRequest,
          });
          return;
        }
        // Convert YAML to JSON inline (simple key:value conversion via js-yaml if available, else serve as-is)
        try {
          const jsYaml = require('js-yaml');
          const spec = jsYaml.load(yaml);
          sendJson(res, 200, spec, {
            'Access-Control-Allow-Origin': '*',
          }, {
            headOnly: isHeadRequest,
          });
        } catch {
          sendText(res, 200, yaml, {
            'Content-Type': 'text/yaml; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          }, {
            headOnly: isHeadRequest,
          });
        }
      } catch {
        sendProblem(res, {
          type: PROBLEM_TYPES.NOT_FOUND,
          title: 'Not Found',
          status: 404,
          detail: 'OpenAPI spec not found.',
        });
      }
      return;
    }

    // Public privacy policy — required for GPT Store and marketplace listings
    if (isGetLikeRequest && pathname === '/privacy') {
      sendHtml(res, 200, `<!DOCTYPE html><html><head><title>Privacy Policy — ThumbGate</title></head><body>
<h1>Privacy Policy</h1>
<p><strong>ThumbGate</strong> (npm: thumbgate)</p>
<p>Last updated: 2026-03-11</p>
<h2>Data Collection</h2>
<p>The self-hosted version stores workflow data locally on your machine. Local feedback, memory entries, proof artifacts, and context packs stay in your project files unless you explicitly point the system at a hosted endpoint.</p>
<p>The hosted tier (thumbgate-production.up.railway.app) stores feedback signals, memory entries, and related workflow metadata associated with your API key.</p>
<p>Optional CLI telemetry is best-effort and covers install or usage metadata needed to understand adoption and failures. You can disable it with <code>THUMBGATE_NO_TELEMETRY=1</code>.</p>
<h2>Data Stored</h2><ul>
<li>Feedback signals (thumbs up/down) with context you provide</li>
<li>Promoted memory entries</li>
<li>Prevention rules generated from your feedback</li>
</ul>
<h2>Data Sharing</h2>
<p>We do not sell customer data. Hosted data is used to operate the service and is not shared with third parties except for infrastructure providers needed to run the product.</p>
<h2>Data Retention</h2>
<p>Local data is retained until you delete the files. Hosted data is retained while your account or API key remains active, or until you request deletion, subject to operational or legal retention requirements.</p>
<h2>Data Deletion</h2>
<p>Contact igor.ganapolsky@gmail.com to request deletion of hosted data.</p>
<h2>Contact</h2><p>igor.ganapolsky@gmail.com</p>
<p><a href="https://github.com/IgorGanapolsky/ThumbGate">GitHub</a></p>
</body></html>`, {}, {
        headOnly: isHeadRequest,
      });
      return;
    }

    // Stripe webhook is unauthenticated — uses HMAC signature verification instead
    if (req.method === 'POST' && pathname === '/v1/billing/webhook') {
      try {
        const rawBody = await new Promise((resolve, reject) => {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', reject);
        });

        const sig = req.headers['stripe-signature'] || '';
        if (!verifyWebhookSignature(rawBody, sig)) {
          sendProblem(res, {
            type: PROBLEM_TYPES.WEBHOOK_INVALID,
            title: 'Invalid webhook signature',
            status: 400,
            detail: 'The webhook signature could not be verified.',
          });
          return;
        }

        const result = await handleWebhook(rawBody, sig);
        if (result && result.reason === 'invalid_signature') {
          sendProblem(res, {
            type: PROBLEM_TYPES.WEBHOOK_INVALID,
            title: 'Invalid webhook signature',
            status: 400,
            detail: result.error || 'The webhook signature could not be verified.',
          });
          return;
        }
        sendJson(res, 200, result);

      } catch (err) {
        sendProblem(res, {
          type: !err.statusCode || err.statusCode >= 500 ? PROBLEM_TYPES.INTERNAL : PROBLEM_TYPES.BAD_REQUEST,
          title: !err.statusCode || err.statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
          status: err.statusCode || 500,
          detail: err.message,
        });
      }
      return;
    }

    // POST /webhook/stripe — legacy Stripe event log bridge kept for backward compatibility.
    // This must remain unauthenticated like /v1/billing/webhook; Stripe auth is the HMAC signature.
    if (req.method === 'POST' && pathname === '/webhook/stripe') {
      await handleLegacyStripeWebhook(req, res);
      return;
    }

    // GitHub Marketplace webhook
    if (req.method === 'POST' && pathname === '/v1/billing/github-webhook') {
      try {
        const rawBody = await new Promise((resolve, reject) => {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', reject);
        });

        const sig = req.headers['x-hub-signature-256'] || '';
        if (!verifyGithubWebhookSignature(rawBody, sig)) {
          sendProblem(res, {
            type: PROBLEM_TYPES.WEBHOOK_INVALID,
            title: 'Invalid webhook signature',
            status: 400,
            detail: 'The webhook signature could not be verified.',
          });
          return;
        }

        let event;
        try {
          event = JSON.parse(rawBody.toString('utf-8'));
        } catch {
          sendProblem(res, {
            type: PROBLEM_TYPES.INVALID_JSON,
            title: 'Invalid JSON',
            status: 400,
            detail: 'Invalid JSON in webhook body.',
          });
          return;
        }

        const result = handleGithubWebhook(event);
        sendJson(res, 200, result);
      } catch (err) {
        sendProblem(res, {
          type: !err.statusCode || err.statusCode >= 500 ? PROBLEM_TYPES.INTERNAL : PROBLEM_TYPES.BAD_REQUEST,
          title: !err.statusCode || err.statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
          status: err.statusCode || 500,
          detail: err.message,
        });
      }
      return;
    }

    if (req.method === 'OPTIONS' && (pathname === '/v1/billing/checkout' || pathname === '/v1/billing/session')) {
      sendPublicBillingPreflight(res);
      return;
    }

    // Public checkout session creation for top-of-funnel acquisition.
    if (req.method === 'POST' && pathname === '/v1/billing/checkout') {
      try {
        const body = await parseJsonBody(req);
        const traceId = body.traceId || createTraceId('checkout');
        const responseHeaders = getPublicBillingHeaders(traceId);
        const analyticsMetadata = buildCheckoutAttributionMetadata(body, req, traceId);
        const offerSummary = resolveCheckoutOfferSummary(analyticsMetadata);
        
        const result = await createCheckoutSession({
          successUrl: body.successUrl || buildCheckoutFallbackUrl(
            buildHostedSuccessUrl(hostedConfig.appOrigin, traceId),
            analyticsMetadata,
          ),
          cancelUrl: body.cancelUrl || buildCheckoutFallbackUrl(
            buildHostedCancelUrl(hostedConfig.appOrigin, traceId),
            analyticsMetadata,
          ),
          customerEmail: body.customerEmail,
          installId: body.installId,
          traceId,
          metadata: analyticsMetadata,
          appOrigin: hostedConfig.appOrigin,
        });
        sendJson(res, 200, {
          ...result,
          traceId: result.traceId || traceId,
          planId: offerSummary.planId,
          billingCycle: offerSummary.billingCycle,
          seatCount: offerSummary.seatCount,
          price: offerSummary.price,
          priceLabel: offerSummary.priceLabel,
          type: offerSummary.type,
        }, responseHeaders);
      } catch (err) {
        const fallbackTraceId = createTraceId('checkout_error');
        sendProblem(res, {
          type: !err.statusCode || err.statusCode >= 500 ? PROBLEM_TYPES.INTERNAL : PROBLEM_TYPES.BAD_REQUEST,
          title: !err.statusCode || err.statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
          status: err.statusCode || 500,
          detail: err.message || 'An unexpected error occurred.',
        }, getPublicBillingHeaders(fallbackTraceId));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/billing/session') {
      try {
        const sessionId = parsed.searchParams.get('sessionId');
        const requestedTraceId = parsed.searchParams.get('traceId') || '';
        if (!sessionId) {
          throw createHttpError(400, 'sessionId is required');
        }

        const result = await getCheckoutSessionStatus(sessionId);
        if (!result.found) {
          throw createHttpError(404, 'Checkout session not found');
        }

        const resolvedTraceId = result.traceId || requestedTraceId;

        sendJson(res, 200, {
          ...result,
          traceId: resolvedTraceId || null,
          appOrigin: hostedConfig.appOrigin,
          apiBaseUrl: hostedConfig.billingApiBaseUrl,
          nextSteps: {
            env: `THUMBGATE_API_KEY=${result.apiKey || ''}\nTHUMBGATE_API_BASE_URL=${hostedConfig.billingApiBaseUrl}`,
            curl: `curl -X POST ${hostedConfig.billingApiBaseUrl}/v1/feedback/capture \\\n  -H 'Authorization: Bearer ${result.apiKey || ''}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"signal":"down","context":"example","whatWentWrong":"example","whatToChange":"example"}'`,
          },
        }, getPublicBillingHeaders(resolvedTraceId));
      } catch (err) {
        const requestedTraceId = parsed.searchParams.get('traceId') || '';
        sendProblem(res, {
          type: !err.statusCode || err.statusCode >= 500 ? PROBLEM_TYPES.INTERNAL : PROBLEM_TYPES.BAD_REQUEST,
          title: !err.statusCode || err.statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
          status: err.statusCode || 500,
          detail: err.message || 'An unexpected error occurred.',
        }, getPublicBillingHeaders(requestedTraceId));
      }
      return;
    }

    // Operator key is allowed to bypass the general admin gate for its dedicated endpoint
    const _reqToken = extractApiKey(req);
    const isOperatorBillingRequest = Boolean(expectedOperatorKey)
      && _reqToken === expectedOperatorKey
      && req.method === 'GET'
      && pathname === '/v1/billing/summary';

    if (!isOperatorBillingRequest && !isAuthorized(req, expectedApiKey)) {
      sendProblem(res, {
        type: PROBLEM_TYPES.UNAUTHORIZED,
        title: 'Unauthorized',
        status: 401,
        detail: 'A valid API key is required to access this endpoint.',
      });
      return;
    }

    // Usage metering — record request for billing keys (not static THUMBGATE_API_KEY)
    const _token = extractBearerToken(req);
    if (_token && _token !== expectedApiKey) {
      recordUsage(_token);
    }

    try {
      if (req.method === 'GET' && pathname === '/v1/feedback/stats') {
        sendJson(res, 200, analyzeFeedback(requestFeedbackPaths.FEEDBACK_LOG_PATH));
        return;
      }

      // Server-Sent Events stream of live feedback / rule-regen / gate events.
      // Dashboard clients subscribe once (with the same Bearer auth already
      // required for /v1/feedback/stats) and receive pushed events as they
      // happen — no polling, no per-event HTTP round trip. Replaces the
      // implicit "refresh the page" loop that used to be the only way to see
      // new feedback land.
      if (req.method === 'GET' && pathname === '/v1/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no', // disable nginx buffering if any proxy is in front
        });
        // Initial handshake so the client knows the stream is live. Carries
        // the server version so clients can detect mid-session upgrades.
        res.write(`event: connected\ndata: ${JSON.stringify({ version: pkg.version, ts: Date.now() })}\n\n`);

        // Both writes below can fail once the client has disconnected (the
        // socket is destroyed but our subscriber hasn't been removed yet).
        // We intentionally swallow the error and rely on the 'close'/'aborted'
        // handlers below to unsubscribe and clear the heartbeat — there is no
        // useful recovery action to take inline for a closed stream.
        const safeWrite = (chunk) => {
          try {
            res.write(chunk);
          } catch (writeErr) {
            // Connection closed between the emit and the flush; cleanup runs
            // via the 'close' listener so we don't need to act here. Keep the
            // exception binding so Sonar's "handle or don't catch" rule is
            // satisfied without adding log noise on every disconnect.
            void writeErr;
          }
        };

        const onEvent = (payload) => {
          safeWrite(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`);
        };
        eventBus.on('broadcast', onEvent);

        // Heartbeat every 25s keeps proxies (Railway, CDNs) from idle-closing
        // the connection. Clients ignore comment frames per the SSE spec.
        const heartbeat = setInterval(() => {
          safeWrite(':ping\n\n');
        }, 25_000);

        const cleanup = () => {
          clearInterval(heartbeat);
          eventBus.removeListener('broadcast', onEvent);
        };
        req.on('close', cleanup);
        req.on('aborted', cleanup);
        res.on('close', cleanup);
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/intents/catalog') {
        const mcpProfile = parsed.searchParams.get('mcpProfile') || undefined;
        const bundleId = parsed.searchParams.get('bundleId') || undefined;
        const partnerProfile = parsed.searchParams.get('partnerProfile') || undefined;
        try {
          const intentRouter = requirePrivateApiModule('intentRouter', 'Intent catalog');
          const catalog = intentRouter.listIntents({ mcpProfile, bundleId, partnerProfile });
          sendJson(res, 200, catalog);
        } catch (err) {
          throw createHttpError(err.statusCode || 400, err.message || 'Invalid intent catalog request');
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/intents/plan') {
        const body = await parseJsonBody(req);
        try {
          const intentRouter = requirePrivateApiModule('intentRouter', 'Intent planning');
          const plan = intentRouter.planIntent({
            intentId: body.intentId,
            context: body.context || '',
            mcpProfile: body.mcpProfile,
            bundleId: body.bundleId,
            partnerProfile: body.partnerProfile,
            delegationMode: body.delegationMode,
            approved: body.approved === true,
            repoPath: body.repoPath,
          });
          sendJson(res, 200, plan);
        } catch (err) {
          throw createHttpError(err.statusCode || 400, err.message || 'Invalid intent plan request');
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/handoffs/start') {
        const body = await parseJsonBody(req);
        try {
          const intentRouter = requirePrivateApiModule('intentRouter', 'Handoff planning');
          const delegationRuntime = requirePrivateApiModule('delegationRuntime', 'Sequential handoffs');
          const plan = intentRouter.planIntent({
            intentId: body.intentId,
            context: body.context || '',
            mcpProfile: body.mcpProfile,
            bundleId: body.bundleId,
            partnerProfile: body.partnerProfile,
            delegationMode: 'sequential',
            approved: body.approved === true,
            repoPath: body.repoPath,
          });
          const result = delegationRuntime.startHandoff({
            plan,
            context: body.context || '',
            mcpProfile: body.mcpProfile || plan.mcpProfile,
            partnerProfile: body.partnerProfile || plan.partnerProfile,
            repoPath: body.repoPath,
            delegateProfile: body.delegateProfile || null,
            plannedChecks: Array.isArray(body.plannedChecks) ? body.plannedChecks : [],
          });
          sendJson(res, 200, result);
        } catch (err) {
          throw createHttpError(err.statusCode || 400, err.message || 'Invalid handoff start request');
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/handoffs/complete') {
        const body = await parseJsonBody(req);
        try {
          const delegationRuntime = requirePrivateApiModule('delegationRuntime', 'Sequential handoffs');
          const result = delegationRuntime.completeHandoff({
            handoffId: body.handoffId,
            outcome: body.outcome,
            resultContext: body.resultContext || '',
            attempts: body.attempts,
            violationCount: body.violationCount,
            tokenEstimate: body.tokenEstimate,
            latencyMs: body.latencyMs,
            summary: body.summary || '',
          });
          sendJson(res, 200, result);
        } catch (err) {
          throw createHttpError(err.statusCode || 400, err.message || 'Invalid handoff completion request');
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/internal-agent/bootstrap') {
        const body = await parseJsonBody(req);
        try {
          const result = bootstrapInternalAgent({
            source: body.source,
            repoPath: body.repoPath,
            prepareSandbox: body.prepareSandbox,
            sandboxRoot: body.sandboxRoot,
            intentId: body.intentId,
            context: body.context,
            mcpProfile: body.mcpProfile,
            partnerProfile: body.partnerProfile,
            delegationMode: body.delegationMode,
            approved: body.approved === true,
            trigger: body.trigger,
            thread: body.thread,
            task: body.task,
            comments: body.comments,
            messages: body.messages,
          });
          sendJson(res, 200, result);
        } catch (err) {
          throw createHttpError(err.statusCode || 400, err.message || 'Invalid internal agent bootstrap request');
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/hosted/sandbox/dispatch') {
        const body = await parseJsonBody(req);
        try {
          const result = buildCloudflareSandboxPlan({
            source: body.source,
            workloadType: body.workloadType || body.taskType,
            tier: body.tier,
            tenantId: body.tenantId || body.teamId,
            repoPath: body.repoPath,
            requiresRepoAccess: body.requiresRepoAccess,
            requiresIsolation: body.requiresIsolation,
            requiresNetwork: body.requiresNetwork,
            untrustedCode: body.untrustedCode,
            allowedHosts: body.allowedHosts,
            contextTokens: body.contextTokens,
            traceId: body.traceId,
            context: body.context,
            intentId: body.intentId,
            mcpProfile: body.mcpProfile,
            partnerProfile: body.partnerProfile,
            delegationMode: body.delegationMode,
            approved: body.approved === true,
            trigger: body.trigger,
            thread: body.thread,
            task: body.task,
            comments: body.comments,
            messages: body.messages,
            providerPreference: body.providerPreference,
          }, {
            sharedSecret: process.env.CLOUDFLARE_SANDBOX_SHARED_SECRET,
            includeBootstrap: body.includeBootstrap !== false,
          });
          sendJson(res, 200, result);
        } catch (err) {
          throw createHttpError(err.statusCode || 400, err.message || 'Invalid hosted sandbox dispatch request');
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/jobs/harness') {
        const body = await parseJsonBody(req);
        const identifier = body.harness || body.harnessId;
        if (!identifier) {
          throw createHttpError(400, 'harness is required');
        }
        const inputs = parseOptionalObject(body.inputs, 'inputs') || {};
        try {
          const hostedJobLauncher = requirePrivateApiModule('hostedJobLauncher', 'Hosted harness jobs');
          const launched = hostedJobLauncher.launchHarnessJob(identifier, inputs, {
            jobId: normalizeNullableText(body.jobId) || undefined,
            skill: normalizeNullableText(body.skill) || undefined,
            partnerProfile: normalizeNullableText(body.partnerProfile) || undefined,
            autoImprove: body.autoImprove !== false,
          });
          sendJson(res, 202, {
            accepted: true,
            jobId: launched.jobId,
            status: launched.state.status,
            launchMode: launched.launchMode,
            pid: launched.pid,
            statusUrl: `/v1/jobs/${encodeURIComponent(launched.jobId)}`,
            job: launched.state,
          });
        } catch (err) {
          throw createHttpError(err.statusCode || 400, err.message || 'Invalid hosted harness request');
        }
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/jobs') {
        const limit = Number(parsed.searchParams.get('limit') || 20);
        const statuses = parseJobStatuses(parsed.searchParams.get('status'));
        const jobs = listJobStates({
          limit: Number.isFinite(limit) ? limit : 20,
          statuses,
        });
        sendJson(res, 200, {
          total: jobs.length,
          jobs,
        });
        return;
      }

      {
        const jobId = normalizeJobIdFromPath(pathname);
        if (req.method === 'GET' && jobId) {
          sendJson(res, 200, {
            job: readHostedJobOrThrow(jobId),
          });
          return;
        }
      }

      {
        const jobId = normalizeJobIdFromPath(pathname, '/control');
        if (req.method === 'POST' && jobId) {
          const state = readHostedJobOrThrow(jobId);
          const body = await parseJsonBody(req);
          const action = normalizeNullableText(body.action);
          if (!action || !JOB_CONTROL_ACTIONS.has(action)) {
            throw createHttpError(400, 'action must be one of pause, cancel, or resume');
          }

          if (TERMINAL_JOB_STATUSES.has(state.status)) {
            throw createHttpError(409, `Job ${jobId} is already ${state.status}`);
          }

          const hostedJobLauncher = requirePrivateApiModule('hostedJobLauncher', 'Hosted job control');
          if (action === 'resume') {
            const launched = hostedJobLauncher.resumeHostedJob(jobId);
            sendJson(res, 202, {
              accepted: true,
              action,
              jobId,
              launchMode: launched.launchMode,
              pid: launched.pid,
              job: launched.state,
            });
            return;
          }

          if (IDLE_JOB_STATUSES.has(state.status)) {
            const job = action === 'pause'
              ? hostedJobLauncher.pauseQueuedJob(jobId, parseOptionalObject(body.metadata, 'metadata') || {})
              : hostedJobLauncher.cancelQueuedJob(jobId, parseOptionalObject(body.metadata, 'metadata') || {});
            sendJson(res, 202, {
              accepted: true,
              action,
              jobId,
              job,
            });
            return;
          }

          const metadata = parseOptionalObject(body.metadata, 'metadata') || {};
          const control = requestJobControl(jobId, action, metadata);
          sendJson(res, 202, {
            accepted: true,
            action,
            jobId,
            control,
            job: readHostedJobOrThrow(jobId),
          });
          return;
        }
      }

      if (req.method === 'POST' && pathname === '/v1/gates/constraint') {
        const body = await parseJsonBody(req);
        if (!body.key || body.value === undefined) {
          throw createHttpError(400, 'Missing key or value');
        }
        const result = setConstraint(body.key, body.value);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/gates/constraints') {
        sendJson(res, 200, loadConstraints());
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/gates/task-scope') {
        const body = await parseJsonBody(req);
        const scope = setTaskScope({
          taskId: body.taskId,
          summary: body.summary,
          allowedPaths: body.allowedPaths,
          protectedPaths: body.protectedPaths,
          repoPath: body.repoPath,
          localOnly: body.localOnly === true,
          clear: body.clear === true,
        });
        sendJson(res, 200, { scope });
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/gates/task-scope') {
        sendJson(res, 200, getScopeState());
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/gates/branch-governance') {
        const body = await parseJsonBody(req);
        const branchGovernance = setBranchGovernance({
          branchName: body.branchName,
          baseBranch: body.baseBranch,
          prRequired: body.prRequired,
          prNumber: body.prNumber,
          prUrl: body.prUrl,
          queueRequired: body.queueRequired,
          localOnly: body.localOnly === true,
          releaseVersion: body.releaseVersion,
          releaseEvidence: body.releaseEvidence,
          releaseSensitiveGlobs: body.releaseSensitiveGlobs,
          clear: body.clear === true,
        });
        sendJson(res, 200, { branchGovernance });
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/gates/branch-governance') {
        sendJson(res, 200, { branchGovernance: getBranchGovernanceState() });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/gates/protected-approval') {
        const body = await parseJsonBody(req);
        const approval = approveProtectedAction({
          pathGlobs: body.pathGlobs,
          reason: body.reason,
          evidence: body.evidence,
          taskId: body.taskId,
          ttlMs: body.ttlMs,
        });
        sendJson(res, 200, { approved: true, approval });
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/ops/integrity') {
        const command = parsed.searchParams.get('command') || undefined;
        const baseBranch = parsed.searchParams.get('baseBranch') || undefined;
        const requirePrForReleaseSensitive = parsed.searchParams.get('requirePrForReleaseSensitive') === 'true';
        const requireVersionNotBehindBase = parsed.searchParams.get('requireVersionNotBehindBase') === 'true';
        const report = evaluateOperationalIntegrity({
          repoPath: process.cwd(),
          baseBranch,
          command,
          requirePrForReleaseSensitive,
          requireVersionNotBehindBase,
          branchGovernance: getBranchGovernanceState(),
        });
        sendJson(res, 200, report);
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/feedback/summary') {
        const recent = Number(parsed.searchParams.get('recent') || 20);
        const summary = feedbackSummary(Number.isFinite(recent) ? recent : 20, {
          feedbackDir: requestFeedbackDir,
        });
        sendJson(res, 200, { summary });
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/lessons/search') {
        const query = parsed.searchParams.get('q') || parsed.searchParams.get('query') || '';
        const limit = Number(parsed.searchParams.get('limit') || 10);
        const category = parsed.searchParams.get('category') || '';
        const tags = (parsed.searchParams.get('tags') || '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean);
        const lessonSearch = requirePrivateApiModule('lessonSearch', 'Lesson search');
        const results = lessonSearch.searchLessons(query, {
          limit: Number.isFinite(limit) ? limit : 10,
          category,
          tags,
          feedbackDir: requestFeedbackDir,
        });
        sendJson(res, 200, results);
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/search') {
        const query = parsed.searchParams.get('q') || parsed.searchParams.get('query') || '';
        const limit = Number(parsed.searchParams.get('limit') || 10);
        const source = parsed.searchParams.get('source') || 'all';
        const signal = parsed.searchParams.get('signal') || null;
        let results;
        try {
          results = searchThumbgate({
            query,
            limit: Number.isFinite(limit) ? limit : 10,
            source,
            signal,
          });
        } catch (err) {
          throw createHttpError(400, err.message || 'Invalid ThumbGate search request');
        }
        sendJson(res, 200, results);
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/search') {
        const body = await parseJsonBody(req);
        let results;
        try {
          results = searchThumbgate({
            query: body.query || body.q || '',
            limit: body.limit,
            source: body.source,
            signal: body.signal,
          });
        } catch (err) {
          throw createHttpError(400, err.message || 'Invalid ThumbGate search request');
        }
        sendJson(res, 200, results);
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/documents') {
        const limit = Number(parsed.searchParams.get('limit') || 20);
        const query = parsed.searchParams.get('q') || parsed.searchParams.get('query') || '';
        const tag = parsed.searchParams.get('tag') || '';
        const results = listImportedDocuments({
          feedbackDir: requestFeedbackDir,
          limit: Number.isFinite(limit) ? limit : 20,
          query,
          tag,
        });
        sendJson(res, 200, results);
        return;
      }

      {
        const documentId = normalizeDocumentIdFromPath(pathname);
        if (req.method === 'GET' && documentId) {
          const document = readImportedDocument(documentId, {
            feedbackDir: requestFeedbackDir,
          });
          if (!document) {
            throw createHttpError(404, `Imported document not found: ${documentId}`);
          }
          sendJson(res, 200, { document });
          return;
        }
      }

      if (req.method === 'POST' && pathname === '/v1/feedback/capture') {
        const captureLimit = checkLimit('capture_feedback');
        if (!captureLimit.allowed) {
          sendProblem(res, {
            type: PROBLEM_TYPES.RATE_LIMIT,
            title: 'Free tier limit reached',
            status: 429,
            detail: RATE_LIMIT_MESSAGE,
          });
          return;
        }
        const body = await parseJsonBody(req);
        // Auto-include conversation window when caller doesn't provide one
        let chatHistory = Array.isArray(body.chatHistory) ? body.chatHistory : body.messages;
        if (!chatHistory || chatHistory.length === 0) {
          try {
            chatHistory = readRecentConversationWindow({
              feedbackDir: getSafeDataDir(),
              limit: 10,
            });
          } catch (_) { /* best-effort — conversation window is optional */ }
        }
        const result = captureFeedback({
          signal: body.signal,
          context: body.context || '',
          relatedFeedbackId: body.relatedFeedbackId,
          chatHistory,
          whatWentWrong: body.whatWentWrong,
          whatToChange: body.whatToChange,
          whatWorked: body.whatWorked,
          reasoning: body.reasoning,
          visualEvidence: body.visualEvidence,
          packId: body.packId,
          utilityScore: body.utilityScore,
          rubricScores: body.rubricScores,
          guardrails: body.guardrails,
          tags: extractTags(body.tags),
          skill: body.skill,
        });
        if (result?.accepted) {
          // Fan out to any connected dashboard clients so they re-render
          // without polling. Non-sensitive summary only (no chat history,
          // no evidence blobs).
          eventBus.emit('broadcast', {
            type: 'feedback',
            signal: body.signal,
            tags: Array.isArray(body.tags) ? body.tags.slice(0, 8) : [],
            feedbackId: result.feedbackId,
            promoted: Boolean(result.promoted),
            ts: Date.now(),
          });
        }
        const code = result.accepted ? 200 : 422;
        sendJson(res, code, result);
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/feedback/rules') {
        const body = await parseJsonBody(req);
        const minOccurrences = Number(body.minOccurrences || 2);
        const outputPath = body.outputPath
          ? resolveSafePath(body.outputPath, { safeDataDir: requestSafeDataDir })
          : undefined;
        const result = writePreventionRules(outputPath, Number.isFinite(minOccurrences) ? minOccurrences : 2);
        // Tell live dashboard clients the rules file just changed so they can
        // re-fetch the summary without waiting on a poll tick.
        eventBus.emit('broadcast', {
          type: 'rules-updated',
          path: result.path,
          ts: Date.now(),
        });
        sendJson(res, 200, {
          path: result.path,
          markdown: result.markdown,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/skills/generate') {
        const body = await parseJsonBody(req);
        const minOccurrences = Number(body.minOccurrences || 3);
        const tags = Array.isArray(body.tags) ? body.tags : [];
        let skills = generateSkills({
          minClusterSize: Number.isFinite(minOccurrences) ? minOccurrences : 3,
        });
        if (tags.length > 0) {
          const tagSet = new Set(tags.map(t => t.toLowerCase()));
          skills = skills.filter(s => (s.tags || []).some(t => tagSet.has(t.toLowerCase())));
        }
        sendJson(res, 200, { skills });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/documents/import') {
        const body = await parseJsonBody(req, 2 * 1024 * 1024);
        const document = importDocument({
          filePath: body.filePath
            ? resolveDocumentImportFilePath(body.filePath, {
              req,
              parsed,
              safeDataDir: requestSafeDataDir,
            })
            : null,
          content: normalizeNullableText(body.content),
          title: normalizeNullableText(body.title),
          sourceFormat: normalizeNullableText(body.sourceFormat),
          sourceUrl: normalizeNullableText(body.sourceUrl),
          tags: extractTags(body.tags),
          proposeGates: body.proposeGates !== false,
          feedbackDir: requestFeedbackDir,
        });
        sendJson(res, 201, {
          ok: true,
          document,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/dpo/export') {
        const body = await parseJsonBody(req);
        const paths = resolveDpoExportPaths(body, {
          safeDataDir: requestSafeDataDir,
          fallbackMemoryLogPath: requestFeedbackPaths.MEMORY_LOG_PATH,
        });
        const wantsAsync = body.async === true || normalizeNullableText(body.mode) === 'async';

        if (wantsAsync) {
          try {
            const hostedJobLauncher = requirePrivateApiModule('hostedJobLauncher', 'Hosted DPO export jobs');
            const launched = hostedJobLauncher.launchDpoExportJob(paths, {
              jobId: normalizeNullableText(body.jobId) || undefined,
            });
            sendJson(res, 202, {
              accepted: true,
              async: true,
              jobId: launched.jobId,
              status: launched.state.status,
              outputPath: paths.outputPath,
              statusUrl: `/v1/jobs/${encodeURIComponent(launched.jobId)}`,
              launchMode: launched.launchMode,
              job: launched.state,
            });
          } catch (err) {
            throw createHttpError(err.statusCode || 400, err.message || 'Invalid DPO export request');
          }
          return;
        }

        const memories = loadDpoExportMemories(paths);
        const result = exportDpoFromMemories(memories);
        if (paths.outputPath) {
          fs.mkdirSync(path.dirname(paths.outputPath), { recursive: true });
          fs.writeFileSync(paths.outputPath, result.jsonl);
        }

        sendJson(res, 200, {
          pairs: result.pairs.length,
          errors: result.errors.length,
          learnings: result.learnings.length,
          unpairedErrors: result.unpairedErrors.length,
          unpairedLearnings: result.unpairedLearnings.length,
          outputPath: paths.outputPath,
        });
        return;
      }

      // --- Team Lesson Export: POST /v1/lessons/export ---
      if (req.method === 'POST' && pathname === '/v1/lessons/export') {
        const body = await parseJsonBody(req);
        const feedbackDir = requestSafeDataDir;
        const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');
        const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
        const memories = readLessonJsonl(memoryLogPath, { maxLines: 0 });
        const feedbacks = readLessonJsonl(feedbackLogPath, { maxLines: 0 });

        // Merge into unified lesson records
        const lessonMap = new Map();
        for (const rec of feedbacks) {
          if (rec.id) lessonMap.set(rec.id, { feedbackEvent: rec, memoryRecord: null });
        }
        for (const rec of memories) {
          if (rec.id) {
            const existing = lessonMap.get(rec.id);
            if (existing) { existing.memoryRecord = rec; }
            else { lessonMap.set(rec.id, { feedbackEvent: null, memoryRecord: rec }); }
          }
        }

        // Filter by tags/signal if requested
        const filterTags = Array.isArray(body.tags) ? body.tags : [];
        const filterSignal = body.signal || null; // 'up' | 'down' | null
        let lessons = Array.from(lessonMap.values());
        if (filterTags.length > 0) {
          lessons = lessons.filter((l) => {
            const merged = { ...(l.feedbackEvent || {}), ...(l.memoryRecord || {}) };
            const tags = Array.isArray(merged.tags) ? merged.tags : [];
            return filterTags.some((t) => tags.includes(t));
          });
        }
        if (filterSignal) {
          lessons = lessons.filter((l) => {
            const merged = { ...(l.feedbackEvent || {}), ...(l.memoryRecord || {}) };
            return normalizeLessonSignal(merged.signal) === filterSignal;
          });
        }

        const bundle = {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          source: {
            project: path.basename(feedbackDir),
            hostname: require('os').hostname(),
          },
          lessonCount: lessons.length,
          lessons: lessons.map((l) => {
            const merged = { ...(l.feedbackEvent || {}), ...(l.memoryRecord || {}) };
            return {
              id: merged.id,
              signal: normalizeLessonSignal(merged.signal),
              title: merged.title || merged.context || '',
              context: merged.context || '',
              whatWentWrong: merged.whatWentWrong || '',
              whatWorked: merged.whatWorked || '',
              whatToChange: merged.whatToChange || '',
              tags: Array.isArray(merged.tags) ? merged.tags : [],
              timestamp: merged.timestamp || null,
              failureType: merged.failureType || null,
              skill: merged.skill || null,
              structuredRule: merged.structuredRule || merged.rule || null,
              diagnosis: merged.diagnosis || null,
            };
          }),
        };

        if (body.outputPath) {
          const safePath = resolveSafePath(body.outputPath, { safeDataDir: requestSafeDataDir });
          fs.mkdirSync(path.dirname(safePath), { recursive: true });
          fs.writeFileSync(safePath, JSON.stringify(bundle, null, 2));
        }

        sendJson(res, 200, {
          exported: bundle.lessonCount,
          exportedAt: bundle.exportedAt,
          source: bundle.source,
          outputPath: body.outputPath || null,
          bundle: body.inline !== false ? bundle : undefined,
        });
        return;
      }

      // --- Team Lesson Import: POST /v1/lessons/import ---
      if (req.method === 'POST' && pathname === '/v1/lessons/import') {
        const body = await parseJsonBody(req);
        const bundle = body.bundle || body;
        if (!bundle.lessons || !Array.isArray(bundle.lessons)) {
          sendJson(res, 400, { error: 'Invalid bundle: missing lessons array' });
          return;
        }

        const feedbackDir = requestSafeDataDir;
        const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');

        // Load existing IDs for dedup
        const existing = readLessonJsonl(feedbackLogPath, { maxLines: 0 });
        const existingIds = new Set(existing.map((r) => r.id).filter(Boolean));
        // Also dedup by title+signal content hash
        const existingHashes = new Set(existing.map((r) => {
          const t = (r.title || r.context || '').trim().toLowerCase();
          const s = normalizeLessonSignal(r.signal);
          return `${s}|${t}`;
        }).filter((h) => h !== '|'));

        let imported = 0;
        let skippedDuplicate = 0;
        const importedIds = [];

        for (const lesson of bundle.lessons) {
          // Skip if exact ID exists
          if (lesson.id && existingIds.has(lesson.id)) {
            skippedDuplicate++;
            continue;
          }
          // Skip if same title+signal already exists (content dedup)
          const contentHash = `${normalizeLessonSignal(lesson.signal)}|${(lesson.title || lesson.context || '').trim().toLowerCase()}`;
          if (contentHash !== '|' && existingHashes.has(contentHash)) {
            skippedDuplicate++;
            continue;
          }

          // Create imported record with provenance
          const importedRecord = {
            id: `imported_${Date.now()}_${require("crypto").randomBytes(4).toString("hex")}`,
            signal: lesson.signal || 'down',
            title: lesson.title || '',
            context: lesson.context || '',
            whatWentWrong: lesson.whatWentWrong || '',
            whatWorked: lesson.whatWorked || '',
            whatToChange: lesson.whatToChange || '',
            tags: [...(Array.isArray(lesson.tags) ? lesson.tags : []), 'team-import'],
            timestamp: new Date().toISOString(),
            failureType: lesson.failureType || null,
            skill: lesson.skill || null,
            structuredRule: lesson.structuredRule || null,
            diagnosis: lesson.diagnosis || null,
            provenance: {
              importedAt: new Date().toISOString(),
              originalId: lesson.id || null,
              source: bundle.source || null,
              exportedAt: bundle.exportedAt || null,
            },
          };

          fs.appendFileSync(feedbackLogPath, JSON.stringify(importedRecord) + '\n', 'utf8');
          existingIds.add(importedRecord.id);
          existingHashes.add(contentHash);
          importedIds.push(importedRecord.id);
          imported++;
        }

        sendJson(res, 200, {
          imported,
          skippedDuplicate,
          total: bundle.lessons.length,
          importedIds,
          source: bundle.source || null,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/analytics/databricks/export') {
        const body = await parseJsonBody(req);
        const outputPath = body.outputPath
          ? resolveSafePath(body.outputPath, { safeDataDir: requestSafeDataDir })
          : undefined;
        const result = exportDatabricksBundle(undefined, outputPath);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/context/construct') {
        const body = await parseJsonBody(req);
        ensureContextFs();
        let namespaces = [];
        try {
          namespaces = normalizeNamespaces(Array.isArray(body.namespaces) ? body.namespaces : []);
        } catch (err) {
          throw createHttpError(400, err.message || 'Invalid namespaces');
        }
        const pack = constructContextPack({
          query: body.query || '',
          maxItems: Number(body.maxItems || 8),
          maxChars: Number(body.maxChars || 6000),
          namespaces,
        });
        sendJson(res, 200, pack);
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/context/evaluate') {
        const body = await parseJsonBody(req);
        if (!body.packId || !body.outcome) {
          throw createHttpError(400, 'packId and outcome are required');
        }
        let rubricEvaluation = null;
        if (body.rubricScores != null || body.guardrails != null) {
          try {
            rubricEvaluation = buildRubricEvaluation({
              rubricScores: body.rubricScores,
              guardrails: parseOptionalObject(body.guardrails, 'guardrails'),
            });
          } catch (err) {
            throw createHttpError(400, `Invalid rubric payload: ${err.message}`);
          }
        }
        const evaluation = evaluateContextPack({
          packId: body.packId,
          outcome: body.outcome,
          signal: body.signal || null,
          notes: body.notes || '',
          rubricEvaluation,
        });
        sendJson(res, 200, evaluation);
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/context/provenance') {
        const limit = Number(parsed.searchParams.get('limit') || 50);
        const events = getProvenance(Number.isFinite(limit) ? limit : 50);
        sendJson(res, 200, { events });
        return;
      }


      // ----------------------------------------------------------------
      // Quality / ACO routes
      // ----------------------------------------------------------------

      if (req.method === 'GET' && pathname === '/v1/quality/scores') {
        const modelPath = path.join(requestSafeDataDir, 'feedback_model.json');
        const model = loadModel(modelPath);
        const reliability = getReliability(model);
        const category = parsed.searchParams.get('category');
        if (category) {
          if (!reliability[category]) {
            throw createHttpError(404, `Category '${category}' not found`);
          }
          sendJson(res, 200, { category, ...reliability[category] });
          return;
        }
        sendJson(res, 200, {
          categories: reliability,
          totalEntries: model.total_entries || 0,
          updated: model.updated || null,
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/quality/rules') {
        const rulesPath = path.join(requestSafeDataDir, 'prevention-rules.md');
        let markdown = '';
        if (fs.existsSync(rulesPath)) {
          markdown = fs.readFileSync(rulesPath, 'utf8').trim();
        }
        const rules = [];
        for (const line of markdown.split('\n')) {
          const match = line.match(/^-\s+\*\*(\w+)\*\*.*?:\s*(.+)/);
          if (match) {
            rules.push({ severity: match[1].toLowerCase(), rule: match[2].trim() });
          }
        }
        sendJson(res, 200, { count: rules.length, rules, markdown });
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/quality/posteriors') {
        const modelPath = path.join(requestSafeDataDir, 'feedback_model.json');
        const model = loadModel(modelPath);
        const posteriors = samplePosteriors(model);
        sendJson(res, 200, { posteriors });
        return;
      }

      // ----------------------------------------------------------------
      // Semantic routes
      // ----------------------------------------------------------------

      // GET /v1/semantic/describe — get canonical definition of a business entity
      if (req.method === 'GET' && pathname === '/v1/semantic/describe') {
        const semanticLayer = requirePrivateApiModule('semanticLayer', 'Semantic schema');
        const type = parsed.query.type;
        if (!type) {
          throw createHttpError(400, 'type query parameter is required');
        }
        const schema = semanticLayer.describeSemanticSchema();
        const entity = schema.entities[type] || schema.metrics[type];
        if (!entity) {
          sendProblem(res, {
            type: PROBLEM_TYPES.NOT_FOUND,
            title: 'Entity Not Found',
            status: 404,
            detail: `Semantic entity or metric "${type}" not found in schema.`,
          });
          return;
        }
        sendJson(res, 200, entity);
        return;
      }

      // ----------------------------------------------------------------
      // Billing routes
      // ----------------------------------------------------------------

      // GET /v1/billing/usage — usage for the authenticated key
      if (req.method === 'GET' && pathname === '/v1/billing/usage') {
        const token = extractBearerToken(req);
        const validation = validateApiKey(token);
        if (!validation.valid) {
          sendProblem(res, {
            type: PROBLEM_TYPES.UNAUTHORIZED,
            title: 'Unauthorized',
            status: 401,
            detail: 'A valid API key is required to access this endpoint.',
          });
          return;
        }
        sendJson(res, 200, {
          key: token,
          customerId: validation.customerId,
          usageCount: validation.usageCount,
        });
        return;
      }

      // POST /v1/billing/provision — manually provision key (admin)
      if (req.method === 'POST' && pathname === '/v1/billing/provision') {
        if (!isStaticAdminAuthorized(req, expectedApiKey)) {
          sendProblem(res, {
            type: PROBLEM_TYPES.FORBIDDEN,
            title: 'Forbidden',
            status: 403,
            detail: 'Admin API key required for this endpoint.',
          });
          return;
        }

        const body = await parseJsonBody(req);
        if (!body.customerId) {
          throw createHttpError(400, 'customerId is required');
        }
        const result = provisionApiKey(body.customerId, {
          installId: body.installId,
          source: 'admin_provision',
        });
        sendJson(res, 200, result);
        return;
      }

      // GET /v1/billing/summary — operator billing summary (admin key or operator key)
      if (req.method === 'GET' && pathname === '/v1/billing/summary') {
        if (!isBillingSummaryAuthorized(req, expectedApiKey, expectedOperatorKey)) {
          sendProblem(res, {
            type: PROBLEM_TYPES.FORBIDDEN,
            title: 'Forbidden',
            status: 403,
            detail: 'Admin or operator API key required for this endpoint.',
          });
          return;
        }

        const summaryOptions = resolveBillingSummaryOptionsOrRespondProblem(
          res,
          parsed,
          'Invalid billing summary query',
        );
        if (!summaryOptions) {
          return;
        }

        const summary = await getBillingSummaryLive(summaryOptions);
        sendJson(res, 200, {
          ...summary,
          runtimePresence: buildHostedRuntimePresence(hostedConfig, {
            expectedApiKey,
            expectedOperatorKey,
          }),
        });
        return;
      }

      // POST /v1/intake/workflow-sprint/advance — admin-only workflow sprint progression
      if (req.method === 'POST' && pathname === '/v1/intake/workflow-sprint/advance') {
        if (!isStaticAdminAuthorized(req, expectedApiKey)) {
          sendProblem(res, {
            type: PROBLEM_TYPES.FORBIDDEN,
            title: 'Forbidden',
            status: 403,
            detail: 'Admin API key required for this endpoint.',
          });
          return;
        }

        const { FEEDBACK_DIR } = getFeedbackPaths();
        try {
          const body = await parseJsonBody(req, 24 * 1024);
          const workflowSprintIntake = requirePrivateApiModule('workflowSprintIntake', 'Workflow sprint intake');
          const result = workflowSprintIntake.advanceWorkflowSprintLead(body, { feedbackDir: FEEDBACK_DIR });

          appendBestEffortTelemetry(FEEDBACK_DIR, {
            eventType: 'workflow_sprint_lead_advanced',
            clientType: 'server',
            traceId: result.lead.attribution.traceId,
            acquisitionId: result.lead.attribution.acquisitionId,
            visitorId: result.lead.attribution.visitorId,
            sessionId: result.lead.attribution.sessionId,
            installId: result.lead.attribution.installId,
            source: result.lead.attribution.source,
            utmSource: result.lead.attribution.utmSource,
            utmMedium: result.lead.attribution.utmMedium,
            utmCampaign: result.lead.attribution.utmCampaign,
            creator: result.lead.attribution.creator,
            community: result.lead.attribution.community,
            ctaId: result.lead.attribution.ctaId,
            ctaPlacement: result.lead.attribution.ctaPlacement,
            planId: result.lead.attribution.planId,
            page: result.lead.attribution.page,
            landingPath: result.lead.attribution.landingPath,
            pipelineStatus: result.lead.status,
            workflowRunKey: result.workflowRun ? result.workflowRun.workflowRunKey : null,
          }, req.headers, 'workflow_sprint_lead_advanced');

          sendJson(res, 200, {
            ok: true,
            unchanged: result.unchanged,
            lead: result.lead,
            workflowRun: result.workflowRun,
          });
        } catch (err) {
          sendProblem(res, {
            type: err && err.statusCode === 404 ? PROBLEM_TYPES.NOT_FOUND : PROBLEM_TYPES.BAD_REQUEST,
            title: err && err.statusCode === 404 ? 'Lead Not Found' : 'Request Error',
            status: err && err.statusCode ? err.statusCode : 400,
            detail: err && err.message ? err.message : 'Unable to advance workflow sprint lead.',
          });
        }
        return;
      }

      // POST /v1/billing/rotate-key — rotate the authenticated key, preserving customer access
      if (req.method === 'POST' && pathname === '/v1/billing/rotate-key') {
        const currentKey = extractBearerToken(req);
        if (!currentKey) {
          sendProblem(res, {
            type: PROBLEM_TYPES.UNAUTHORIZED,
            title: 'Unauthorized',
            status: 401,
            detail: 'A valid API key is required to access this endpoint.',
          });
          return;
        }
        const validation = validateApiKey(currentKey);
        if (!validation.valid) {
          sendProblem(res, {
            type: PROBLEM_TYPES.BAD_REQUEST,
            title: 'Bad Request',
            status: 400,
            detail: 'Key not found or already disabled.',
          });
          return;
        }
        try {
          const result = rotateApiKey(currentKey);
          if (!result.rotated) {
            sendProblem(res, {
              type: PROBLEM_TYPES.BAD_REQUEST,
              title: 'Key Rotation Failed',
              status: 400,
              detail: result.reason || 'Key rotation failed.',
            });
            return;
          }
          sendJson(res, 200, {
            newKey: result.key,
            message: 'Key rotated. Update your configuration.',
          });
        } catch (err) {
          sendProblem(res, {
            type: PROBLEM_TYPES.INTERNAL,
            title: 'Internal Server Error',
            status: 500,
            detail: err.message || 'An unexpected error occurred.',
          });
        }
        return;
      }

      // GET /v1/analytics/funnel — aggregate acquisition/activation/paid funnel metrics
      if (req.method === 'GET' && pathname === '/v1/analytics/funnel') {
        const summary = getFunnelAnalytics();
        sendJson(res, 200, summary);
        return;
      }

      // GET /v1/analytics/losses -- explain where buyer dollars are falling out of the funnel
      if (req.method === 'GET' && pathname === '/v1/analytics/losses') {
        const dashboardResult = await loadLiveDashboardDataOrRespondProblem(
          res,
          parsed,
          requestFeedbackDir,
          'Invalid loss analytics query',
        );
        if (!dashboardResult) {
          return;
        }
        const { summaryOptions, data } = dashboardResult;

        sendJson(res, 200, buildLossAnalyticsResponse(data, summaryOptions));
        return;
      }

      // GET /v1/dashboard -- Full ThumbGate dashboard JSON
      if (req.method === 'GET' && pathname === '/v1/dashboard') {
        const dashboardResult = await loadLiveDashboardDataOrRespondProblem(
          res,
          parsed,
          requestFeedbackDir,
          'Invalid dashboard query',
        );
        if (!dashboardResult) {
          return;
        }
        const { data } = dashboardResult;

        sendJson(res, 200, data);
        return;
      }

      // GET /v1/dashboard/review-state -- incremental review baseline and deltas
      if (req.method === 'GET' && pathname === '/v1/dashboard/review-state') {
        const reviewState = readDashboardReviewState(requestFeedbackDir);
        const data = generateDashboard(requestFeedbackDir, {
          reviewBaseline: reviewState,
          authContext: { tier: 'pro' },
        });
        sendJson(res, 200, {
          reviewState,
          reviewDelta: data.reviewDelta,
        });
        return;
      }

      // POST /v1/dashboard/review-state -- mark current dashboard state as reviewed
      if (req.method === 'POST' && pathname === '/v1/dashboard/review-state') {
        const snapshot = buildReviewSnapshot(requestFeedbackDir);
        writeDashboardReviewState(requestFeedbackDir, snapshot);
        const data = generateDashboard(requestFeedbackDir, {
          reviewBaseline: snapshot,
          authContext: { tier: 'pro' },
        });
        sendJson(res, 200, {
          ok: true,
          reviewState: snapshot,
          reviewDelta: data.reviewDelta,
        });
        return;
      }

      // GET /v1/dashboard/render-spec -- Constrained hosted dashboard JSON spec
      if (req.method === 'GET' && pathname === '/v1/dashboard/render-spec') {
        const dashboardResult = await loadLiveDashboardDataOrRespondProblem(
          res,
          parsed,
          requestFeedbackDir,
          'Invalid render-spec query',
        );
        if (!dashboardResult) {
          return;
        }
        const { summaryOptions, data } = dashboardResult;

        try {
          const renderSpec = buildDashboardRenderSpec(data, {
            view: parsed.searchParams.get('view') || undefined,
            now: summaryOptions.now,
          });
          sendJson(res, 200, renderSpec);
        } catch (err) {
          sendProblem(res, {
            type: PROBLEM_TYPES.INVALID_REQUEST,
            title: 'Invalid render spec request',
            status: 400,
            detail: err && err.message ? err.message : 'Unable to build dashboard render spec.',
          });
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/decisions/evaluate') {
        const body = await parseJsonBody(req);
        const normalizedRequestAction = normalizeProviderAction(body);
        const hasProviderNativeAction = Boolean(
          body.providerToolCall
            || body.toolCall
            || body.toolUse
            || body.content
            || body.mcp
            || body.mcpToolCall
            || body.method === 'tools/call'
        );
        if (!body.toolName && !hasProviderNativeAction) {
          sendProblem(res, {
            type: PROBLEM_TYPES.BAD_REQUEST,
            title: 'Bad Request',
            status: 400,
            detail: 'toolName or provider tool call is required.',
          });
          return;
        }

        const changedFiles = Array.isArray(body.changedFiles)
          ? body.changedFiles
          : normalizedRequestAction.affectedFiles;
        const scopeState = getScopeState();
        const toolInput = {
          command: body.command,
          path: body.filePath,
          changed_files: changedFiles,
          repoPath: body.repoPath,
          baseBranch: body.baseBranch,
          providerToolCall: body.providerToolCall,
          toolCall: body.toolCall,
          toolUse: body.toolUse,
          content: body.content,
          input: body.input,
          arguments: body.arguments,
          method: body.method,
          params: body.params,
          mcp: body.mcp,
          mcpToolCall: body.mcpToolCall,
          budget: body.budget,
          usage: body.usage,
        };

        const report = evaluateWorkflowSentinel(normalizedRequestAction.toolName || body.toolName, toolInput, {
          provider: body.provider,
          model: body.model,
          normalizedAction: normalizedRequestAction,
          usage: body.usage,
          tokenEstimate: body.tokenEstimate,
          costUsd: body.costUsd,
          budget: body.budget,
          repoPath: body.repoPath,
          baseBranch: body.baseBranch,
          affectedFiles: changedFiles.length > 0 ? changedFiles : undefined,
          requirePrForReleaseSensitive: body.requirePrForReleaseSensitive === true,
          requireVersionNotBehindBase: body.requireVersionNotBehindBase === true,
          governanceState: {
            ...scopeState,
            branchGovernance: body.workflowDispatch && typeof body.workflowDispatch === 'object'
              ? {
                ...(scopeState.branchGovernance || {}),
                workflowDispatch: body.workflowDispatch,
              }
              : scopeState.branchGovernance,
          },
          feedbackDir: requestFeedbackDir,
        });
        const evaluation = recordDecisionEvaluation(report, {
          source: 'api',
          toolName: report.toolName,
          toolInput: {
            command: body.command,
            filePath: body.filePath,
            changedFiles,
            repoPath: body.repoPath,
            baseBranch: body.baseBranch,
            normalizedAction: report.normalizedAction,
            costControl: report.costControl,
          },
          changedFiles,
        }, {
          feedbackDir: requestFeedbackDir,
        });
        report.actionId = evaluation.actionId;
        if (report.decisionControl) report.decisionControl.actionId = evaluation.actionId;
        sendJson(res, 200, report);
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/decisions/outcome') {
        const body = await parseJsonBody(req);
        if (!body.actionId || !body.outcome) {
          sendProblem(res, {
            type: PROBLEM_TYPES.BAD_REQUEST,
            title: 'Bad Request',
            status: 400,
            detail: 'actionId and outcome are required.',
          });
          return;
        }
        const outcome = recordDecisionOutcome({
          actionId: body.actionId,
          outcome: body.outcome,
          actualDecision: body.actualDecision,
          actor: body.actor,
          notes: body.notes,
          metadata: body.metadata,
          latencyMs: body.latencyMs,
          source: 'api',
        }, {
          feedbackDir: requestFeedbackDir,
        });
        sendJson(res, 200, outcome);
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/decisions/metrics') {
        sendJson(res, 200, computeDecisionMetrics(requestFeedbackDir));
        return;
      }

      // GET /v1/settings/status -- Resolved settings hierarchy with origin metadata
      if (req.method === 'GET' && pathname === '/v1/settings/status') {
        sendJson(res, 200, getSettingsStatus());
        return;
      }

      // GET /v1/gates/stats -- Gate enforcement statistics
      if (req.method === 'GET' && pathname === '/v1/gates/stats') {
        const stats = loadGateStats();
        sendJson(res, 200, stats);
        return;
      }

      // POST /v1/gates/satisfy -- Record evidence that a gate condition is satisfied
      if (req.method === 'POST' && pathname === '/v1/gates/satisfy') {
        const body = await parseJsonBody(req);
        if (!body.gateId || !body.evidence) {
          sendProblem(res, {
            type: PROBLEM_TYPES.BAD_REQUEST,
            title: 'Bad Request',
            status: 400,
            detail: 'gateId and evidence are required.',
          });
          return;
        }
        const entry = satisfyCondition(body.gateId, body.evidence);
        sendJson(res, 200, { satisfied: true, gateId: body.gateId, ...entry });
        return;
      }

      // GET /api/conversions — Conversion stats derived from the Stripe event log
      if (req.method === 'GET' && pathname === '/api/conversions') {
        try {
          const events = readStripeEvents();
          const stats = computeConversionStats(events);
          sendJson(res, 200, stats);
        } catch (err) {
          sendProblem(res, {
            type: PROBLEM_TYPES.INTERNAL,
            title: 'Internal Server Error',
            status: 500,
            detail: err.message,
          });
        }
        return;
      }

      sendProblem(res, {
        type: PROBLEM_TYPES.NOT_FOUND,
        title: 'Not Found',
        status: 404,
        detail: `No handler for ${req.method} ${pathname}`,
      });
    } catch (err) {
      sendProblem(res, {
        type: !err.statusCode || err.statusCode >= 500 ? PROBLEM_TYPES.INTERNAL : PROBLEM_TYPES.BAD_REQUEST,
        title: !err.statusCode || err.statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
        status: err.statusCode || 500,
        detail: err.message || 'An unexpected error occurred.',
      });
    }
  });
}

function startServer({ port, host } = {}) {
  const listenPort = Number(port ?? process.env.PORT ?? 8787);
  const listenHost = String(host ?? process.env.HOST ?? '0.0.0.0').trim() || '0.0.0.0';
  const server = createApiServer();
  return new Promise((resolve) => {
    server.listen(listenPort, listenHost, () => {
      const address = server.address();
      const actualPort = (address && typeof address === 'object' && address.port)
        ? address.port
        : listenPort;
      resolve({
        server,
        host: listenHost,
        port: actualPort,
      });
    });
  });
}

module.exports = {
  createApiServer,
  startServer,
  __test__: {
    buildCheckoutFallbackUrl,
    createPrivateCoreUnavailableError,
    buildPosthogProxyRequestOptions,
    getPosthogProxyPath,
    isAllowedPosthogProxyPath,
    PRIVATE_API_MODULES,
    loadPrivateApiModule,
    requirePrivateApiModule,
    renderSitemapXml,
    renderPackagedDashboardHtml,
    renderPackagedLessonsHtml,
    readOptionalPublicTemplate,
    resolveLocalPageBootstrap,
  },
};

if (require.main === module) {
  startServer().then(({ host, port }) => {
    console.log(`ThumbGate API listening on http://${host}:${port}`);
  });
}
