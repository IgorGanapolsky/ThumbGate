'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const boundaryPath = require.resolve('../scripts/private-core-boundary');
const boundary = require('../scripts/private-core-boundary');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const PRIVATE_CORE_MODULES = [
  'scripts/cross-encoder-reranker.js',
  'scripts/feedback-history-distiller.js',
  'scripts/history-distiller.js',
  'scripts/hosted-job-launcher.js',
  'scripts/lesson-reranker.js',
  'scripts/lesson-retrieval.js',
  'scripts/managed-lesson-agent.js',
  'scripts/org-dashboard.js',
  'scripts/partner-orchestration.js',
  'scripts/predictive-insights.js',
  'scripts/reflector-agent.js',
];

function createMissingModuleError(request) {
  const error = new Error(`Cannot find module '${request}'`);
  error.code = 'MODULE_NOT_FOUND';
  return error;
}

async function withBoundaryFallbackModule(moduleRelativePath, callback) {
  const modulePath = require.resolve(moduleRelativePath);
  const previousBoundary = require.cache[boundaryPath];
  const previousModule = require.cache[modulePath];

  delete require.cache[boundaryPath];
  delete require.cache[modulePath];

  require.cache[boundaryPath] = {
    id: boundaryPath,
    filename: boundaryPath,
    loaded: true,
    exports: {
      ...boundary,
      loadOptionalModule(request, fallbackFactory) {
        return typeof fallbackFactory === 'function'
          ? fallbackFactory(createMissingModuleError(request))
          : (fallbackFactory || {});
      },
    },
  };

  try {
    return await callback(require(moduleRelativePath));
  } finally {
    delete require.cache[modulePath];
    delete require.cache[boundaryPath];
    if (previousModule) {
      require.cache[modulePath] = previousModule;
    }
    if (previousBoundary) {
      require.cache[boundaryPath] = previousBoundary;
    }
  }
}

async function withTempFeedbackDir(callback) {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-boundary-'));
  const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const previousLegacyFeedbackDir = process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR;
  const previousApiKeysPath = process.env._TEST_API_KEYS_PATH;
  const previousFunnelLedgerPath = process.env._TEST_FUNNEL_LEDGER_PATH;
  const previousRevenueLedgerPath = process.env._TEST_REVENUE_LEDGER_PATH;

  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR = feedbackDir;
  process.env._TEST_API_KEYS_PATH = path.join(feedbackDir, 'api-keys.json');
  process.env._TEST_FUNNEL_LEDGER_PATH = path.join(feedbackDir, 'funnel-events.jsonl');
  process.env._TEST_REVENUE_LEDGER_PATH = path.join(feedbackDir, 'revenue-events.jsonl');

  try {
    return await callback(feedbackDir);
  } finally {
    if (previousFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
    if (previousLegacyFeedbackDir === undefined) delete process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR;
    else process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR = previousLegacyFeedbackDir;
    if (previousApiKeysPath === undefined) delete process.env._TEST_API_KEYS_PATH;
    else process.env._TEST_API_KEYS_PATH = previousApiKeysPath;
    if (previousFunnelLedgerPath === undefined) delete process.env._TEST_FUNNEL_LEDGER_PATH;
    else process.env._TEST_FUNNEL_LEDGER_PATH = previousFunnelLedgerPath;
    if (previousRevenueLedgerPath === undefined) delete process.env._TEST_REVENUE_LEDGER_PATH;
    else process.env._TEST_REVENUE_LEDGER_PATH = previousRevenueLedgerPath;
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
}

test('public npm package excludes private-core implementation modules', () => {
  const whitelist = new Set(pkg.files);
  for (const modulePath of PRIVATE_CORE_MODULES) {
    assert.equal(
      whitelist.has(modulePath),
      false,
      `${modulePath} should stay out of the public npm tarball`,
    );
  }
});

test('public npm package ships the private-core boundary helper', () => {
  const whitelist = new Set(pkg.files);
  assert.equal(whitelist.has('scripts/private-core-boundary.js'), true);
});

test('private-core boundary helper falls back only for the requested missing module', async () => {
  assert.equal(
    boundary.isOptionalModuleMissing(
      { code: 'MODULE_NOT_FOUND', message: 'Cannot find module \'./lesson-retrieval\'' },
      './lesson-retrieval',
    ),
    true,
  );
  assert.equal(
    boundary.isOptionalModuleMissing(
      { code: 'MODULE_NOT_FOUND', message: 'Cannot find module \'./different-module\'' },
      './lesson-retrieval',
    ),
    false,
  );
  assert.equal(
    boundary.isOptionalModuleMissing(
      { code: 'ERR_ASSERTION', message: 'boom' },
      './lesson-retrieval',
    ),
    false,
  );

  const fallbackValue = boundary.loadOptionalModule('./definitely-missing-private-core-module', () => ({ ok: true }));
  assert.deepEqual(fallbackValue, { ok: true });

  const report = boundary.createUnavailableReport('Predictive insights', { featureFlag: 'core-only' });
  assert.deepEqual(report, {
    available: false,
    source: 'ThumbGate-Core',
    message: 'Predictive insights requires ThumbGate-Core.',
    featureFlag: 'core-only',
  });

  const unavailable = boundary.createUnavailableOperation('Hosted harness jobs');
  assert.throws(() => unavailable(), (error) => {
    assert.equal(error.code, 'THUMBGATE_CORE_REQUIRED');
    assert.equal(error.statusCode, 503);
    assert.equal(error.feature, 'Hosted harness jobs');
    return true;
  });

  const unavailableAsync = boundary.createUnavailableAsyncOperation('Hosted DPO export', { statusCode: 504 });
  await assert.rejects(unavailableAsync(), (error) => {
    assert.equal(error.code, 'THUMBGATE_CORE_REQUIRED');
    assert.equal(error.statusCode, 504);
    assert.equal(error.feature, 'Hosted DPO export');
    return true;
  });
});

test('private-core boundary helper rethrows non-module-load failures', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-boundary-nested-'));
  const tempModulePath = path.join(tempDir, 'nested-miss.js');
  fs.writeFileSync(tempModulePath, 'throw new Error("explode-on-load");\n');

  try {
    assert.throws(
      () => boundary.loadOptionalModule(tempModulePath, () => ({ masked: true })),
      /explode-on-load/,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('public shell loads private-core fallback helpers when proprietary modules are absent', async () => {
  const { resolveAnalyticsWindow } = require('../scripts/analytics-window');

  await withBoundaryFallbackModule('../scripts/agentic-data-pipeline', async (pipeline) => {
    const snapshot = pipeline.buildSemanticSnapshot({
      window: resolveAnalyticsWindow('lifetime'),
      snapshotId: 'snap_public_shell',
      telemetryAnalytics: {
        visitors: { uniqueVisitors: 12, attributionCoverageRate: 0.5 },
        ctas: { checkoutStarts: 2 },
      },
      billingSummary: {
        signups: { uniqueLeads: 1 },
        revenue: { paidCustomers: 0, bookedRevenueCents: 0 },
        keys: { active: 0, totalUsage: 0 },
        dataQuality: { unreconciledPaidEvents: 0 },
        attribution: {},
      },
      stagingModel: {
        reconciliation: { status: 'healthy', warningCount: 0 },
        sourceHashes: { telemetry: 'telemetry', billing: 'billing' },
        dims: {
          sources: [],
          campaigns: [],
          trafficChannels: [],
          creators: [],
          communities: [],
          offerCodes: [],
        },
        facts: { funnel: [], revenue: [], quality: [] },
      },
      gateStats: {},
      team: {},
    });

    assert.equal(snapshot.predictive.available, false);
    assert.equal(snapshot.predictive.source, 'ThumbGate-Core');
    assert.equal(snapshot.metrics.predictedBookedRevenueCents, 0);
    assert.equal(snapshot.status.predictiveStatus, 'none');
  });

  await withTempFeedbackDir(async (feedbackDir) => {
    await withBoundaryFallbackModule('../scripts/dashboard', async (dashboard) => {
      const report = dashboard.generateDashboard(feedbackDir, {
        analyticsWindow: 'lifetime',
        billingSummary: {
          coverage: {},
          attribution: {},
          revenue: {},
          signups: {},
          pipeline: {},
          keys: {},
        },
      });

      assert.equal(report.team.available, false);
      assert.match(report.team.upgradeMessage, /ThumbGate-Core/);
      assert.equal(report.predictive.available, false);
      assert.equal(report.predictive.anomalySummary.severity, 'none');
    });
  });
});

test('public shell keeps routing, recall, and verification operational without ThumbGate-Core', async () => {
  await withBoundaryFallbackModule('../scripts/intent-router', async (router) => {
    const listed = router.listIntents({
      mcpProfile: 'default',
      partnerProfile: 'field-test',
    });
    assert.equal(listed.partnerProfile, 'field-test');
    assert.equal(listed.partnerStrategy.verificationMode, 'local-only');

    const ranked = router.rankActions([{ name: 'capture_feedback' }], {
      partnerProfile: 'field-test',
      modelPath: path.join(os.tmpdir(), 'thumbgate-public-shell-router-model.json'),
    });
    assert.equal(ranked.scores[0].partnerBias, 0);
  });

  await withTempFeedbackDir(async (feedbackDir) => {
    await withBoundaryFallbackModule('../scripts/verification-loop', async (verificationLoop) => {
      const result = verificationLoop.runVerificationLoop({
        context: 'Attach proof before shipping',
        tags: ['shipping'],
        maxRetries: 1,
        modelPath: path.join(feedbackDir, 'verification-model.json'),
        partnerProfile: 'field-test',
      });

      assert.equal(result.accepted, true);
      assert.equal(result.maxRetries, 1);
      assert.equal(result.partnerStrategy.verificationMode, 'local-only');
      assert.equal(result.partnerReward, 0);
    });
  });

  await withTempFeedbackDir(async (feedbackDir) => {
    fs.writeFileSync(path.join(feedbackDir, 'memory-log.jsonl'), [
      JSON.stringify({
        id: 'mem_1',
        category: 'error',
        title: 'Avoid deleting production deployments',
        content: 'Do not delete production deployments without proof.',
        tags: ['deploy'],
        timestamp: '2026-04-22T00:00:00.000Z',
      }),
      JSON.stringify({
        id: 'mem_2',
        category: 'error',
        title: 'Avoid deleting production databases',
        content: 'Do not delete production databases without proof.',
        tags: ['deploy'],
        timestamp: '2026-04-21T00:00:00.000Z',
      }),
      '',
    ].join('\n'));

    await withBoundaryFallbackModule('../scripts/lesson-search', async (lessonSearch) => {
      const result = lessonSearch.searchLessons('production', {
        feedbackDir,
        limit: 5,
      });

      assert.equal(result.results.length >= 2, true);
      assert.equal(result.results[0].title.includes('production'), true);
    });
  });

  await withTempFeedbackDir(async (feedbackDir) => {
    await withBoundaryFallbackModule('../scripts/context-manager', async (contextManager) => {
      const context = contextManager.assembleUnifiedContext({
        query: 'production deploy',
        feedbackDir,
      });
      assert.deepEqual(context.lessons, []);
    });
  });
});

test('public shell feedback and API server degrade safely when private-core modules are unavailable', async () => {
  await withTempFeedbackDir(async (feedbackDir) => {
    await withBoundaryFallbackModule('../scripts/feedback-loop', async (feedbackLoop) => {
      const result = feedbackLoop.captureFeedback({
        signal: 'down',
        context: 'Regression escaped to production',
        conversationWindow: [
          { role: 'user', content: 'Attach proof before shipping.' },
          { role: 'assistant', content: 'I shipped without proof.' },
        ],
        tags: ['shipping'],
      });

      assert.equal(result.accepted || result.signalLogged || result.status === 'rejected', true);
    });
  });

  const previousApiKey = process.env.THUMBGATE_API_KEY;
  process.env.THUMBGATE_API_KEY = 'tg_test_api_key';
  try {
    await withBoundaryFallbackModule('../src/api/server', async (apiServer) => {
      assert.equal(typeof apiServer.createApiServer, 'function');
      const server = apiServer.createApiServer();
      server.close();
    });
  } finally {
    if (previousApiKey === undefined) delete process.env.THUMBGATE_API_KEY;
    else process.env.THUMBGATE_API_KEY = previousApiKey;
  }
});
