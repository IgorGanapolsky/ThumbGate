'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-consolidator-'));
const thumbgateDir = path.join(projectDir, '.thumbgate');
const rlhfDir = path.join(projectDir, '.rlhf');
const legacyDir = path.join(projectDir, '.claude', 'memory', 'feedback');

const savedFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
const savedLegacyDir = process.env.THUMBGATE_LEGACY_FEEDBACK_DIR;
const savedRlhfDir = process.env.THUMBGATE_RLHF_FEEDBACK_DIR;
const savedTestApiKeysPath = process.env._TEST_API_KEYS_PATH;
const savedTestFunnelPath = process.env._TEST_FUNNEL_LEDGER_PATH;
const savedTestRevenuePath = process.env._TEST_REVENUE_LEDGER_PATH;
const savedTestCheckoutPath = process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH;

test.before(() => {
  fs.mkdirSync(thumbgateDir, { recursive: true });
  fs.mkdirSync(rlhfDir, { recursive: true });
  fs.mkdirSync(legacyDir, { recursive: true });

  fs.writeFileSync(path.join(legacyDir, 'api-keys.json'), `${JSON.stringify({
    keys: {
      rlhf_test_key: {
        customerId: 'cus_consolidated',
        active: true,
        source: 'provision',
        usageCount: 2,
        createdAt: '2026-04-01T10:00:00.000Z',
      },
    },
  }, null, 2)}\n`);

  fs.writeFileSync(path.join(rlhfDir, 'funnel-events.jsonl'), `${JSON.stringify({
    timestamp: '2026-04-01T10:00:00.000Z',
    stage: 'acquisition',
    event: 'checkout_session_created',
    evidence: 'sess_consolidated',
    acquisitionId: 'acq_consolidated',
    visitorId: 'visitor_consolidated',
    sessionId: 'session_consolidated',
    metadata: {
      source: 'website',
    },
  })}\n`);

  fs.writeFileSync(path.join(rlhfDir, 'telemetry-pings.jsonl'), `${JSON.stringify({
    receivedAt: '2026-04-01T10:01:00.000Z',
    eventType: 'landing_page_view',
    clientType: 'web',
    visitorId: 'visitor_consolidated',
    sessionId: 'session_consolidated',
    source: 'website',
    page: '/',
  })}\n`);
});

test.after(() => {
  if (savedFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
  else process.env.THUMBGATE_FEEDBACK_DIR = savedFeedbackDir;
  if (savedLegacyDir === undefined) delete process.env.THUMBGATE_LEGACY_FEEDBACK_DIR;
  else process.env.THUMBGATE_LEGACY_FEEDBACK_DIR = savedLegacyDir;
  if (savedRlhfDir === undefined) delete process.env.THUMBGATE_RLHF_FEEDBACK_DIR;
  else process.env.THUMBGATE_RLHF_FEEDBACK_DIR = savedRlhfDir;
  if (savedTestApiKeysPath === undefined) delete process.env._TEST_API_KEYS_PATH;
  else process.env._TEST_API_KEYS_PATH = savedTestApiKeysPath;
  if (savedTestFunnelPath === undefined) delete process.env._TEST_FUNNEL_LEDGER_PATH;
  else process.env._TEST_FUNNEL_LEDGER_PATH = savedTestFunnelPath;
  if (savedTestRevenuePath === undefined) delete process.env._TEST_REVENUE_LEDGER_PATH;
  else process.env._TEST_REVENUE_LEDGER_PATH = savedTestRevenuePath;
  if (savedTestCheckoutPath === undefined) delete process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH;
  else process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = savedTestCheckoutPath;
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('consolidateFeedbackRoot migrates business-critical artifacts into .thumbgate', () => {
  const { consolidateFeedbackRoot } = require('../scripts/feedback-root-consolidator');
  const summary = consolidateFeedbackRoot({ cwd: projectDir, write: true });

  assert.equal(summary.feedbackDir, thumbgateDir);
  assert.equal(fs.existsSync(path.join(thumbgateDir, 'api-keys.json')), true);
  assert.equal(fs.existsSync(path.join(thumbgateDir, 'funnel-events.jsonl')), true);
  assert.equal(fs.existsSync(path.join(thumbgateDir, 'telemetry-pings.jsonl')), true);
  assert.equal(fs.existsSync(path.join(thumbgateDir, 'revenue-events.jsonl')), true);
  assert.equal(fs.existsSync(path.join(thumbgateDir, 'local-checkout-sessions.json')), true);

  const keyStore = JSON.parse(fs.readFileSync(path.join(thumbgateDir, 'api-keys.json'), 'utf8'));
  assert.equal(Object.keys(keyStore.keys).length, 1);

  const checkoutSessions = JSON.parse(fs.readFileSync(path.join(thumbgateDir, 'local-checkout-sessions.json'), 'utf8'));
  assert.deepEqual(checkoutSessions, { sessions: {} });
});

test('billing summary is clean after consolidation even when legacy roots still exist', () => {
  const { consolidateFeedbackRoot } = require('../scripts/feedback-root-consolidator');
  consolidateFeedbackRoot({ cwd: projectDir, write: true });

  process.env.THUMBGATE_FEEDBACK_DIR = thumbgateDir;
  process.env.THUMBGATE_RLHF_FEEDBACK_DIR = rlhfDir;
  process.env.THUMBGATE_LEGACY_FEEDBACK_DIR = legacyDir;
  delete process.env._TEST_API_KEYS_PATH;
  delete process.env._TEST_FUNNEL_LEDGER_PATH;
  delete process.env._TEST_REVENUE_LEDGER_PATH;
  delete process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH;

  delete require.cache[require.resolve('../scripts/billing')];
  const billing = require('../scripts/billing');
  const summary = billing.getBillingSummary();

  assert.equal(summary.sourceDiagnostics.mixedRoots, false);
  assert.equal(summary.sourceDiagnostics.files.keyStore.activeMode, 'primary');
  assert.equal(summary.sourceDiagnostics.files.funnelLedger.activeMode, 'primary');
  assert.equal(summary.sourceDiagnostics.files.revenueLedger.activeMode, 'primary');
  assert.equal(summary.sourceDiagnostics.files.telemetry.activeMode, 'primary');
  assert.deepEqual(summary.sourceDiagnostics.warnings, []);
  assert.equal(summary.trafficMetrics.pageViews, 1);
});
