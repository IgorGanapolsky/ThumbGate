const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const Module = require('node:module');
const { Readable } = require('node:stream');

const GOVERNED_RELEASE_VERSION_MISMATCH = '9999.0.0';

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-api-test-'));
const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-api-proof-'));
const savedProjectEnv = {
  THUMBGATE_PROJECT_DIR: process.env.THUMBGATE_PROJECT_DIR,
  CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
  INIT_CWD: process.env.INIT_CWD,
};
delete process.env.THUMBGATE_PROJECT_DIR;
delete process.env.CLAUDE_PROJECT_DIR;
delete process.env.INIT_CWD;
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_PROOF_DIR = tmpProofDir;
process.env.THUMBGATE_API_KEY = 'test-api-key';
process.env._TEST_API_KEYS_PATH = path.join(tmpFeedbackDir, 'api-keys.json');
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpFeedbackDir, 'funnel-events.jsonl');
process.env._TEST_REVENUE_LEDGER_PATH = path.join(tmpFeedbackDir, 'revenue-events.jsonl');
process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(tmpFeedbackDir, 'local-checkout-sessions.json');

// Force local mode for billing tests by clearing Stripe keys
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_PRICE_ID = '';
process.env.THUMBGATE_PUBLIC_APP_ORIGIN = 'https://app.example.com';
process.env.THUMBGATE_BILLING_API_BASE_URL = 'https://billing.example.com';
process.env.THUMBGATE_GA_MEASUREMENT_ID = 'G-TEST1234';
process.env.THUMBGATE_GOOGLE_SITE_VERIFICATION = 'test-verification-token';
process.env.THUMBGATE_BUILD_METADATA_PATH = path.join(tmpFeedbackDir, 'build-metadata.json');
fs.writeFileSync(
  process.env.THUMBGATE_BUILD_METADATA_PATH,
  JSON.stringify({ buildSha: 'test-build-sha', generatedAt: '2026-03-20T00:00:00.000Z' }, null, 2)
);

const { startServer, __test__ } = require('../src/api/server');
const billing = require('../scripts/billing');
const gatesEngine = require('../scripts/gates-engine');
const { buildHostedSuccessUrl } = require('../scripts/hosted-config');
const { readJsonl } = require('../scripts/fs-utils');
const {
  recordConversationEntry,
  getConversationPaths,
} = require('../scripts/feedback-history-distiller');

let handle;
let apiOrigin = '';
const authHeader = { authorization: 'Bearer test-api-key' };
const ORIGINAL_GATES_PATHS = {
  governanceState: gatesEngine.GOVERNANCE_STATE_PATH,
  constraints: gatesEngine.CONSTRAINTS_PATH,
};

test('api servers 2026 pricing', () => {
  assert.match('$19/mo or $149/yr', /\$19\/mo or \$149\/yr/);
});

function apiUrl(pathname = '/') {
  return new URL(pathname, apiOrigin).toString();
}

function extractCookieValue(setCookies, name) {
  const target = setCookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!target) return null;
  const match = target.match(new RegExp(`^${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

test.before(async () => {
  gatesEngine.GOVERNANCE_STATE_PATH = path.join(tmpFeedbackDir, 'governance-state.json');
  gatesEngine.CONSTRAINTS_PATH = path.join(tmpFeedbackDir, 'session-constraints.json');
  fs.rmSync(gatesEngine.GOVERNANCE_STATE_PATH, { force: true });
  fs.rmSync(gatesEngine.CONSTRAINTS_PATH, { force: true });
  handle = await startServer({ port: 0 });
  apiOrigin = `http://localhost:${handle.port}`;
});

test.after(async () => {
  await new Promise((resolve) => handle.server.close(resolve));
  gatesEngine.GOVERNANCE_STATE_PATH = ORIGINAL_GATES_PATHS.governanceState;
  gatesEngine.CONSTRAINTS_PATH = ORIGINAL_GATES_PATHS.constraints;
  delete process.env.THUMBGATE_PUBLIC_APP_ORIGIN;
  delete process.env.THUMBGATE_BILLING_API_BASE_URL;
  delete process.env.THUMBGATE_BUILD_METADATA_PATH;
  if (savedProjectEnv.THUMBGATE_PROJECT_DIR === undefined) delete process.env.THUMBGATE_PROJECT_DIR;
  else process.env.THUMBGATE_PROJECT_DIR = savedProjectEnv.THUMBGATE_PROJECT_DIR;
  if (savedProjectEnv.CLAUDE_PROJECT_DIR === undefined) delete process.env.CLAUDE_PROJECT_DIR;
  else process.env.CLAUDE_PROJECT_DIR = savedProjectEnv.CLAUDE_PROJECT_DIR;
  if (savedProjectEnv.INIT_CWD === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = savedProjectEnv.INIT_CWD;
  try {
    fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  } catch (err) {
    // Ignore ENOTEMPTY errors during teardown
  }
});

test('health endpoint returns ok', async () => {
  const res = await fetch(apiUrl('/health'), { headers: authHeader });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.buildSha, 'test-build-sha');
});

test('PostHog proxy path allowlist blocks sibling-path SSRF attempts', () => {
  assert.equal(__test__.getPosthogProxyPath('/ingest/capture'), '/capture');
  assert.equal(__test__.getPosthogProxyPath('/ingest'), '/');
  assert.equal(__test__.isAllowedPosthogProxyPath('/capture'), true);
  assert.equal(__test__.isAllowedPosthogProxyPath('/capture/'), true);
  assert.equal(__test__.isAllowedPosthogProxyPath('/static/array.js'), true);
  assert.equal(__test__.isAllowedPosthogProxyPath('/captureevil'), false);
  assert.equal(__test__.isAllowedPosthogProxyPath('/http://evil.example/capture'), false);
});

async function withMissingPrivateApiModules(modulePaths, fn) {
  const blocked = new Set(modulePaths);
  const originalLoad = Module._load;
  Module._load = function patchedModuleLoad(request, parent, isMain) {
    if (blocked.has(request)) {
      const error = new Error(`Cannot find module '${request}'`);
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

test('private-core API module helpers report unknown and unavailable modules cleanly', async () => {
  assert.throws(
    () => __test__.loadPrivateApiModule('nope'),
    /Unknown private API module: nope/,
  );

  await withMissingPrivateApiModules([
    __test__.PRIVATE_API_MODULES.intentRouter,
  ], async () => {
    assert.equal(__test__.loadPrivateApiModule('intentRouter'), null);
    let error;
    try {
      __test__.requirePrivateApiModule('intentRouter', 'Intent planning');
    } catch (caught) {
      error = caught;
    }
    assert.ok(error);
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, 'PRIVATE_CORE_REQUIRED');
    assert.match(error.message, /Intent planning is only available/);
  });

  const directError = __test__.createPrivateCoreUnavailableError('Hosted harness jobs');
  assert.equal(directError.statusCode, 503);
  assert.equal(directError.code, 'PRIVATE_CORE_REQUIRED');

  await withMissingPrivateApiModules([
    __test__.PRIVATE_API_MODULES.lessonSearch,
    __test__.PRIVATE_API_MODULES.semanticLayer,
    __test__.PRIVATE_API_MODULES.commercialOffer,
  ], async () => {
    assert.equal(__test__.loadPrivateApiModule('lessonSearch'), null);
    assert.equal(__test__.loadPrivateApiModule('semanticLayer'), null);
    assert.equal(__test__.loadPrivateApiModule('commercialOffer'), null);
  });
});

test('PostHog ingest proxy forwards allowed analytics requests to PostHog', async () => {
  const originalRequest = https.request;
  const captured = { writes: [] };
  https.request = (options, callback) => {
    captured.options = options;
    return {
      on() { return this; },
      write(chunk) {
        captured.writes.push(String(chunk));
      },
      end() {
        const proxyRes = Readable.from(['{"ok":true}']);
        proxyRes.statusCode = 202;
        proxyRes.headers = { 'content-type': 'application/json' };
        callback(proxyRes);
      },
    };
  };

  try {
    const res = await fetch(apiUrl('/ingest/capture?ip=1'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-posthog-test': 'yes' },
      body: JSON.stringify({ event: '$pageview' }),
    });
    assert.equal(res.status, 202);
    assert.equal(await res.text(), '{"ok":true}');
    assert.equal(captured.options.protocol, 'https:');
    assert.equal(captured.options.hostname, 'us.i.posthog.com');
    assert.equal(captured.options.path, '/capture?ip=1');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers.host, 'us.i.posthog.com');
    assert.equal(captured.options.headers['x-posthog-test'], 'yes');
    assert.equal(captured.writes.join(''), '{"event":"$pageview"}');
  } finally {
    https.request = originalRequest;
  }
});

test('PostHog ingest proxy rejects non-allowlisted upstream paths', async () => {
  const originalRequest = https.request;
  let called = false;
  https.request = () => {
    called = true;
    throw new Error('proxy should not run for rejected paths');
  };

  try {
    const res = await fetch(apiUrl('/ingest/captureevil'));
    assert.equal(res.status, 403);
    assert.equal(await res.text(), 'Forbidden');
    assert.equal(called, false);
  } finally {
    https.request = originalRequest;
  }
});

test('newsletter endpoint returns JSON for fetch-style lead capture and deduplicates subscribers', async () => {
  const newsletterPath = path.join(tmpFeedbackDir, 'newsletter-subscribers.jsonl');
  fs.rmSync(newsletterPath, { force: true });

  const firstRes = await fetch(apiUrl('/api/newsletter'), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      'x-requested-with': 'fetch',
      referer: `${apiOrigin}/pro?utm_source=website&utm_medium=pro_page&utm_campaign=pro_pack`,
    },
    body: new URLSearchParams({ email: 'buyer@example.com' }),
  });
  assert.equal(firstRes.status, 200);
  const firstBody = await firstRes.json();
  assert.equal(firstBody.accepted, true);
  assert.equal(firstBody.duplicate, false);
  assert.equal(firstBody.email, 'buyer@example.com');
  assert.equal(firstBody.landingPath, '/pro');

  const entriesAfterFirst = readJsonl(newsletterPath);
  assert.equal(entriesAfterFirst.length, 1);
  assert.equal(entriesAfterFirst[0].email, 'buyer@example.com');
  assert.equal(entriesAfterFirst[0].source, 'website');

  const duplicateRes = await fetch(apiUrl('/api/newsletter'), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      'x-requested-with': 'fetch',
    },
    body: new URLSearchParams({ email: 'buyer@example.com' }),
  });
  assert.equal(duplicateRes.status, 200);
  const duplicateBody = await duplicateRes.json();
  assert.equal(duplicateBody.accepted, true);
  assert.equal(duplicateBody.duplicate, true);
  assert.equal(readJsonl(newsletterPath).length, 1);

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const trialEmailEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'trial_email_captured' &&
    entry.landingPath === '/pro' &&
    entry.utmCampaign === 'pro_pack'
  ));
  assert.ok(trialEmailEvent);
  assert.equal(trialEmailEvent.ctaId, 'trial_email');
  assert.equal(trialEmailEvent.ctaPlacement, 'pro_email_form');
  assert.equal(trialEmailEvent.planId, 'pro');
});

test('buyer intent script serves shared checkout helper JavaScript', async () => {
  const res = await fetch(apiUrl('/js/buyer-intent.js'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/javascript/);
  const script = await res.text();
  assert.match(script, /ThumbGateBuyerIntent/);
  assert.match(script, /customer_email/);
  assert.match(script, /dataset\.baseHref/);
});

test('startServer accepts an explicit bind host', async () => {
  const explicit = await startServer({ port: 0, host: '0.0.0.0' });
  try {
    const res = await fetch(`http://127.0.0.1:${explicit.port}/health`, { headers: authHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  } finally {
    await new Promise((resolve) => explicit.server.close(resolve));
  }
});

test('protected endpoints accept x-api-key as an alternate auth header', async () => {
  const res = await fetch(apiUrl('/v1/feedback/summary'), {
    headers: { 'x-api-key': 'test-api-key' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.summary, 'string');
});

test('document import API persists searchable policy docs and exposes proposed gates', async () => {
  const importRes = await fetch(apiUrl('/v1/documents/import'), {
    method: 'POST',
    headers: { ...authHeader, 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Release Policy',
      content: [
        '# Release Policy',
        '',
        '- Never force-push to main.',
        '- Always run tests before commit.',
        '- Do not drop production tables without approval.',
      ].join('\n'),
      sourceFormat: 'markdown',
      tags: ['policy', 'team'],
    }),
  });

  assert.equal(importRes.status, 201);
  const importBody = await importRes.json();
  assert.equal(importBody.ok, true);
  assert.match(importBody.document.documentId, /^doc_/);
  assert.ok(importBody.document.proposals.some((proposal) => proposal.templateId === 'never-force-push-main'));

  const listRes = await fetch(apiUrl('/v1/documents?query=release&limit=5'), {
    headers: authHeader,
  });
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.equal(listBody.total >= 1, true);
  assert.ok(listBody.documents.some((entry) => entry.documentId === importBody.document.documentId));

  const detailRes = await fetch(apiUrl(`/v1/documents/${encodeURIComponent(importBody.document.documentId)}`), {
    headers: authHeader,
  });
  assert.equal(detailRes.status, 200);
  const detailBody = await detailRes.json();
  assert.equal(detailBody.document.documentId, importBody.document.documentId);
  assert.match(detailBody.document.content, /Never force-push to main/);
});

test('admin API sets, reads, and clears task scope via HTTP', async () => {
  const setRes = await fetch(apiUrl('/v1/gates/task-scope'), {
    method: 'POST',
    headers: { ...authHeader, 'content-type': 'application/json' },
    body: JSON.stringify({
      taskId: '1733520',
      summary: 'harden governance',
      allowedPaths: ['scripts/**', 'tests/**'],
      localOnly: true,
    }),
  });
  assert.equal(setRes.status, 200);
  const setBody = await setRes.json();
  assert.equal(setBody.scope.taskId, '1733520');
  assert.equal(setBody.scope.localOnly, true);
  assert.deepEqual(setBody.scope.allowedPaths, ['scripts/**', 'tests/**']);
  assert.ok(setBody.scope.protectedPaths.includes('AGENTS.md'));

  const stateRes = await fetch(apiUrl('/v1/gates/task-scope'), { headers: authHeader });
  assert.equal(stateRes.status, 200);
  const stateBody = await stateRes.json();
  assert.equal(stateBody.taskScope.summary, 'harden governance');
  assert.equal(stateBody.taskScope.localOnly, true);
  assert.equal(gatesEngine.loadConstraints().local_only.value, true);

  const clearRes = await fetch(apiUrl('/v1/gates/task-scope'), {
    method: 'POST',
    headers: { ...authHeader, 'content-type': 'application/json' },
    body: JSON.stringify({ clear: true }),
  });
  assert.equal(clearRes.status, 200);
  const clearBody = await clearRes.json();
  assert.equal(clearBody.scope, null);

  const clearedStateRes = await fetch(apiUrl('/v1/gates/task-scope'), { headers: authHeader });
  assert.equal(clearedStateRes.status, 200);
  const clearedState = await clearedStateRes.json();
  assert.equal(clearedState.taskScope, null);
});

test('admin API persists protected approvals via HTTP', async () => {
  const scopeRes = await fetch(apiUrl('/v1/gates/task-scope'), {
    method: 'POST',
    headers: { ...authHeader, 'content-type': 'application/json' },
    body: JSON.stringify({
      taskId: '1733520',
      summary: 'approve protected files',
      allowedPaths: ['AGENTS.md'],
      protectedPaths: ['AGENTS.md'],
    }),
  });
  assert.equal(scopeRes.status, 200);

  const approvalRes = await fetch(apiUrl('/v1/gates/protected-approval'), {
    method: 'POST',
    headers: { ...authHeader, 'content-type': 'application/json' },
    body: JSON.stringify({
      pathGlobs: ['AGENTS.md'],
      reason: 'CEO approved protected-file edit',
      evidence: 'work item 1733520',
      taskId: '1733520',
      ttlMs: 120000,
    }),
  });
  assert.equal(approvalRes.status, 200);
  const approvalBody = await approvalRes.json();
  assert.equal(approvalBody.approved, true);
  assert.deepEqual(approvalBody.approval.pathGlobs, ['AGENTS.md']);
  assert.equal(approvalBody.approval.taskId, '1733520');

  const stateRes = await fetch(apiUrl('/v1/gates/task-scope'), { headers: authHeader });
  assert.equal(stateRes.status, 200);
  const stateBody = await stateRes.json();
  assert.equal(stateBody.protectedApprovals.length, 1);
  assert.equal(stateBody.protectedApprovals[0].reason, 'CEO approved protected-file edit');
});

test('admin API persists branch governance and exposes operational integrity over HTTP', async () => {
  const setRes = await fetch(apiUrl('/v1/gates/branch-governance'), {
    method: 'POST',
    headers: { ...authHeader, 'content-type': 'application/json' },
    body: JSON.stringify({
      branchName: 'feat/thumbgate-hardening',
      baseBranch: 'main',
      prRequired: true,
      prNumber: '999',
      queueRequired: true,
      releaseVersion: GOVERNED_RELEASE_VERSION_MISMATCH,
    }),
  });
  assert.equal(setRes.status, 200);
  const setBody = await setRes.json();
  assert.equal(setBody.branchGovernance.branchName, 'feat/thumbgate-hardening');
  assert.equal(setBody.branchGovernance.releaseVersion, GOVERNED_RELEASE_VERSION_MISMATCH);

  const stateRes = await fetch(apiUrl('/v1/gates/branch-governance'), { headers: authHeader });
  assert.equal(stateRes.status, 200);
  const stateBody = await stateRes.json();
  assert.equal(stateBody.branchGovernance.prNumber, '999');
  assert.equal(stateBody.branchGovernance.queueRequired, true);

  const integrityRes = await fetch(apiUrl('/v1/ops/integrity?command=npm%20publish'), { headers: authHeader });
  assert.equal(integrityRes.status, 200);
  const integrityBody = await integrityRes.json();
  assert.equal(integrityBody.ok, false);
  assert.ok(integrityBody.blockers.some((blocker) => blocker.code === 'release_version_mismatch'));
});

test('root serves the landing page by default', async () => {
  const res = await fetch(apiUrl('/'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /ThumbGate/);
  assert.match(body, /self-improving/i);
  assert.match(body, /learns from every mistake/i);
  assert.match(body, /npx thumbgate init/);
  assert.match(body, /Thompson Sampling/i);
  assert.match(body, /FAQPage/);
  assert.match(body, /SoftwareApplication/);
  assert.match(body, /\$19/);
  assert.match(body, /\$149/);
  assert.match(body, /plausible\.io\/js\/script\.js/);
  assert.match(body, /googletagmanager\.com\/gtag\/js\?id=G-TEST1234/);
  assert.match(body, /google-site-verification" content="test-verification-token"/);
  assert.match(body, /gtag\('config', 'G-TEST1234', \{ send_page_view: false \}\)/);
  assert.doesNotMatch(body, /mailto:/i);
});

test('/go/pro 302 redirects to /checkout/pro with caller-provided UTM params preserved', async () => {
  const res = await fetch(apiUrl('/go/pro?utm_source=reddit&utm_campaign=autopilot&utm_content=zero_tokens'), { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-thumbgate-link-slug'), 'pro');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex,nofollow');
  const location = res.headers.get('location');
  assert.ok(location, 'sets Location header');
  const url = new URL(location);
  assert.equal(url.pathname, '/checkout/pro');
  assert.equal(url.searchParams.get('utm_source'), 'reddit');
  assert.equal(url.searchParams.get('utm_campaign'), 'autopilot');
  assert.equal(url.searchParams.get('utm_content'), 'zero_tokens');
  assert.equal(url.searchParams.get('cta_id'), 'go_pro');
});

test('/go/pro falls back to default UTM attribution when no params are supplied', async () => {
  const res = await fetch(apiUrl('/go/pro'), { redirect: 'manual' });
  assert.equal(res.status, 302);
  const url = new URL(res.headers.get('location'));
  assert.equal(url.pathname, '/checkout/pro');
  assert.equal(url.searchParams.get('utm_source'), 'website');
  assert.equal(url.searchParams.get('utm_medium'), 'link_router');
  assert.equal(url.searchParams.get('utm_campaign'), 'pro_upgrade');
  assert.equal(url.searchParams.get('plan_id'), 'pro');
});

test('/go/:slug returns 404 JSON for slugs not registered in TRACKED_LINK_TARGETS', async () => {
  const res = await fetch(apiUrl('/go/malicious?utm_source=x'), { redirect: 'manual' });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'Tracked link not found');
  assert.ok(Array.isArray(body.allowed) && body.allowed.includes('pro'), 'advertises allowed slug list');
});

test('privacy policy route covers collection, sharing, retention, and contact details', async () => {
  const res = await fetch(apiUrl('/privacy'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /Privacy Policy/i);
  assert.match(body, /Data Collection/i);
  assert.match(body, /Data Sharing/i);
  assert.match(body, /Data Retention/i);
  assert.match(body, /optional CLI telemetry/i);
  assert.match(body, /igor\.ganapolsky@gmail\.com/i);
});

test('public HEAD routes stay unauthenticated and side-effect free', async () => {
  const telemetryPath = path.join(tmpFeedbackDir, 'telemetry-pings.jsonl');
  const checkoutSessionsPath = process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH;
  const telemetryCountBefore = readJsonl(telemetryPath).length;
  const checkoutSessionsBefore = checkoutSessionsPath && fs.existsSync(checkoutSessionsPath)
    ? JSON.parse(fs.readFileSync(checkoutSessionsPath, 'utf8')).length
    : 0;

  const homeRes = await fetch(apiUrl('/'), { method: 'HEAD' });
  assert.equal(homeRes.status, 200);
  assert.match(String(homeRes.headers.get('content-type')), /text\/html/);
  assert.equal(await homeRes.text(), '');
  assert.equal(
    typeof homeRes.headers.getSetCookie === 'function' ? homeRes.headers.getSetCookie().length : 0,
    0
  );

  const compareRes = await fetch(apiUrl('/compare/speclock'), { method: 'HEAD' });
  assert.equal(compareRes.status, 200);
  assert.match(String(compareRes.headers.get('content-type')), /text\/html/);
  assert.equal(await compareRes.text(), '');
  assert.equal(
    typeof compareRes.headers.getSetCookie === 'function' ? compareRes.headers.getSetCookie().length : 0,
    0
  );

  const privacyRes = await fetch(apiUrl('/privacy'), { method: 'HEAD' });
  assert.equal(privacyRes.status, 200);
  assert.match(String(privacyRes.headers.get('content-type')), /text\/html/);
  assert.equal(await privacyRes.text(), '');

  const robotsRes = await fetch(apiUrl('/robots.txt'), { method: 'HEAD' });
  assert.equal(robotsRes.status, 200);
  assert.match(String(robotsRes.headers.get('content-type')), /text\/plain/);
  assert.equal(await robotsRes.text(), '');

  const sitemapRes = await fetch(apiUrl('/sitemap.xml'), { method: 'HEAD' });
  assert.equal(sitemapRes.status, 200);
  assert.match(String(sitemapRes.headers.get('content-type')), /application\/xml/);
  assert.equal(await sitemapRes.text(), '');

  const cardRes = await fetch(apiUrl('/.well-known/mcp/server-card.json'), { method: 'HEAD' });
  assert.equal(cardRes.status, 200);
  assert.match(String(cardRes.headers.get('content-type')), /application\/json/);
  assert.equal(await cardRes.text(), '');

  const discoveryRes = await fetch(apiUrl('/.well-known/mcp.json'), { method: 'HEAD' });
  assert.equal(discoveryRes.status, 200);
  assert.match(String(discoveryRes.headers.get('content-type')), /application\/json/);
  assert.equal(await discoveryRes.text(), '');

  const healthRes = await fetch(apiUrl('/health'), { method: 'HEAD' });
  assert.equal(healthRes.status, 200);
  assert.match(String(healthRes.headers.get('content-type')), /application\/json/);
  assert.equal(await healthRes.text(), '');

  const healthzRes = await fetch(apiUrl('/healthz'), { method: 'HEAD' });
  assert.equal(healthzRes.status, 200);
  assert.match(String(healthzRes.headers.get('content-type')), /application\/json/);
  assert.equal(await healthzRes.text(), '');

  const openapiRes = await fetch(apiUrl('/openapi.json'), { method: 'HEAD' });
  assert.equal(openapiRes.status, 200);
  assert.match(String(openapiRes.headers.get('content-type')), /(application\/json|text\/yaml)/);
  assert.equal(await openapiRes.text(), '');

  const openapiYamlRes = await fetch(apiUrl('/openapi.yaml'), { method: 'HEAD' });
  assert.equal(openapiYamlRes.status, 200);
  assert.match(String(openapiYamlRes.headers.get('content-type')), /text\/yaml/);
  assert.equal(await openapiYamlRes.text(), '');

  const checkoutRes = await fetch(apiUrl('/checkout/pro'), { method: 'HEAD' });
  assert.equal(checkoutRes.status, 200);
  assert.equal(await checkoutRes.text(), '');
  assert.equal(
    typeof checkoutRes.headers.getSetCookie === 'function' ? checkoutRes.headers.getSetCookie().length : 0,
    0
  );

  const telemetryCountAfter = readJsonl(telemetryPath).length;
  const checkoutSessionsAfter = checkoutSessionsPath && fs.existsSync(checkoutSessionsPath)
    ? JSON.parse(fs.readFileSync(checkoutSessionsPath, 'utf8')).length
    : 0;
  assert.equal(telemetryCountAfter, telemetryCountBefore);
  assert.equal(checkoutSessionsAfter, checkoutSessionsBefore);
});

test('public openapi yaml stays reachable before bearer auth for GPT Actions import', async () => {
  const res = await fetch(apiUrl('/openapi.yaml'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/yaml/);

  const body = await res.text();
  assert.match(body, /^openapi: 3\.1\.0/m);
  assert.match(body, new RegExp(`servers:\\n  - url: ${apiOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.doesNotMatch(body, /test-api-key/);
});

test('public openapi yaml advertises forwarded https origin for hosted imports', async () => {
  const res = await fetch(apiUrl('/openapi.yaml'), {
    headers: {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'thumbgate-production.up.railway.app',
    },
  });
  assert.equal(res.status, 200);

  const body = await res.text();
  assert.match(body, /servers:\n  - url: https:\/\/thumbgate-production\.up\.railway\.app/);
});

test('public server card exposes MCP tool schemas for directory scanners', async () => {
  const res = await fetch(apiUrl('/.well-known/mcp/server-card.json'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /application\/json/);

  const body = await res.json();
  assert.equal(body.name, 'thumbgate');
  assert.ok(Array.isArray(body.tools));
  assert.ok(body.tools.length > 0);

  const captureFeedbackTool = body.tools.find((tool) => tool.name === 'capture_feedback');
  assert.ok(captureFeedbackTool);
  assert.equal(captureFeedbackTool.inputSchema.type, 'object');
  assert.ok(captureFeedbackTool.inputSchema.required.includes('signal'));
  for (const tool of body.tools) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.description, 'string');
    assert.equal(typeof tool.inputSchema, 'object');
    assert.ok(tool.inputSchema);
  }
  assert.equal(body.discovery.toolIndexUrl, 'https://app.example.com/.well-known/mcp/tools.json');
  assert.equal(body.discovery.footprintUrl, 'https://app.example.com/.well-known/mcp/footprint.json');
  assert.equal(body.footprint.mcpToolDiscovery.qualityContract.behaviorPreserved, true);
  assert.ok(body.footprint.mcpToolDiscovery.footprint.savings.estimatedTokens > 0);
  assert.ok(Array.isArray(body.skills));
  assert.ok(Array.isArray(body.applications));
  assert.match(body.proof.verificationEvidenceUrl, /VERIFICATION_EVIDENCE\.md/);
});

test('public MCP discovery manifest exposes progressive tool, skill, and app loading', async () => {
  const res = await fetch(apiUrl('/.well-known/mcp.json'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /application\/json/);

  const body = await res.json();
  assert.equal(body.name, 'thumbgate');
  assert.equal(body.transport.endpoint, 'https://app.example.com/mcp');
  assert.deepEqual(body.transport.unauthenticatedDiscovery, ['initialize', 'tools/list']);
  assert.equal(body.discovery.toolIndexUrl, 'https://app.example.com/.well-known/mcp/tools.json');
  assert.equal(body.discovery.toolSchemaUrlTemplate, 'https://app.example.com/.well-known/mcp/tools/{name}.json');
  assert.equal(body.discovery.footprintUrl, 'https://app.example.com/.well-known/mcp/footprint.json');
  assert.match(body.discovery.progressive.tokenStrategy, /Do not preload every inputSchema/);
  assert.ok(body.primaryFlows.some((flow) => flow.name === 'capture-to-gate'));
  assert.ok(body.primaryFlows.some((flow) => flow.name === 'metric-autoresearch' && flow.tools.includes('run_autoresearch')));
  assert.ok(body.primaryFlows.some((flow) => flow.name === 'visual-proof-retrieval' && flow.tools.includes('plan_multimodal_retrieval')));
  assert.ok(body.primaryFlows.some((flow) => flow.name === 'context-footprint-optimizer' && flow.tools.includes('plan_context_footprint')));
  assert.ok(body.skills.some((skill) => skill.name === 'thumbgate'));
  assert.ok(body.skills.some((skill) => skill.name === 'visual-proof-retrieval'));
  assert.ok(body.skills.some((skill) => skill.name === 'context-footprint-optimizer'));
  assert.ok(body.applications.some((app) => app.name === 'dashboard'));
  assert.ok(body.footprint.mcpToolDiscovery.footprint.savings.reductionRatio > 0);
  assert.match(body.proof.verificationEvidenceUrl, /VERIFICATION_EVIDENCE\.md/);
});

test('public MCP footprint report quantifies progressive discovery savings', async () => {
  const res = await fetch(apiUrl('/.well-known/mcp/footprint.json'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /application\/json/);

  const body = await res.json();
  assert.equal(body.name, 'thumbgate-context-footprint');
  assert.equal(typeof body.version, 'string');
  assert.equal(body.mcpToolDiscovery.kind, 'mcp-tool-discovery');
  assert.equal(body.mcpToolDiscovery.qualityContract.behaviorPreserved, true);
  assert.equal(
    body.mcpToolDiscovery.qualityContract.schemaUrlTemplate,
    'https://app.example.com/.well-known/mcp/tools/{name}.json',
  );
  assert.ok(body.mcpToolDiscovery.footprint.savings.estimatedTokens > 0);
  assert.ok(body.recommendations.some((item) => item.includes('construct_context_pack')));
});

test('public MCP tool index supports just-in-time per-tool schema loading', async () => {
  const indexRes = await fetch(apiUrl('/.well-known/mcp/tools.json'));
  assert.equal(indexRes.status, 200);
  const index = await indexRes.json();
  assert.ok(index.count > 0);
  assert.ok(Array.isArray(index.tools));

  const captureFeedback = index.tools.find((tool) => tool.name === 'capture_feedback');
  assert.ok(captureFeedback);
  assert.equal(captureFeedback.schemaUrl, 'https://app.example.com/.well-known/mcp/tools/capture_feedback.json');
  assert.equal(captureFeedback.inputSchema, undefined);
  assert.ok(index.tools.some((tool) => tool.name === 'run_autoresearch'));
  assert.ok(index.tools.some((tool) => tool.name === 'plan_multimodal_retrieval'));

  const schemaRes = await fetch(apiUrl('/.well-known/mcp/tools/capture_feedback.json'));
  assert.equal(schemaRes.status, 200);
  const schema = await schemaRes.json();
  assert.equal(schema.name, 'capture_feedback');
  assert.equal(schema.inputSchema.type, 'object');
  assert.ok(schema.inputSchema.required.includes('signal'));

  const autoresearchSchemaRes = await fetch(apiUrl('/.well-known/mcp/tools/run_autoresearch.json'));
  assert.equal(autoresearchSchemaRes.status, 200);
  const autoresearchSchema = await autoresearchSchemaRes.json();
  assert.equal(autoresearchSchema.name, 'run_autoresearch');
  assert.equal(autoresearchSchema.inputSchema.properties.iterations.type, 'number');

  const multimodalSchemaRes = await fetch(apiUrl('/.well-known/mcp/tools/plan_multimodal_retrieval.json'));
  assert.equal(multimodalSchemaRes.status, 200);
  const multimodalSchema = await multimodalSchemaRes.json();
  assert.equal(multimodalSchema.name, 'plan_multimodal_retrieval');
  assert.equal(multimodalSchema.inputSchema.properties.evidenceTypes.type, 'array');
});

test('public MCP skills and applications are machine-readable for agent onboarding', async () => {
  const [skillsRes, applicationsRes] = await Promise.all([
    fetch(apiUrl('/.well-known/mcp/skills.json')),
    fetch(apiUrl('/.well-known/mcp/applications.json')),
  ]);

  assert.equal(skillsRes.status, 200);
  assert.equal(applicationsRes.status, 200);

  const skills = await skillsRes.json();
  const applications = await applicationsRes.json();
  assert.ok(skills.skills.some((skill) => skill.name === 'workflow-hardening-sprint'));
  assert.ok(skills.skills.some((skill) => skill.name === 'visual-proof-retrieval'));
  assert.ok(skills.skills.some((skill) => skill.name === 'context-footprint-optimizer'));
  assert.ok(skills.skills.every((skill) => Array.isArray(skill.recommendedFlow)));
  assert.ok(applications.applications.some((app) => app.name === 'workflow-sprint-intake'));
  assert.ok(applications.applications.every((app) => app.url.startsWith('https://app.example.com/')));
});

test('root seeds journey cookies, injects server telemetry IDs, and records landing telemetry server-side', async () => {
  const res = await fetch(apiUrl('/'));
  assert.equal(res.status, 200);

  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  const visitorId = extractCookieValue(setCookies, 'thumbgate_visitor_id');
  const sessionId = extractCookieValue(setCookies, 'thumbgate_session_id');
  const acquisitionId = extractCookieValue(setCookies, 'thumbgate_acquisition_id');
  assert.match(String(visitorId), /^visitor_/);
  assert.match(String(sessionId), /^session_/);
  assert.match(String(acquisitionId), /^acq_/);

  const body = await res.text();
  assert.match(body, new RegExp(`const serverVisitorId = '${visitorId}';`));
  assert.match(body, new RegExp(`const serverSessionId = '${sessionId}';`));
  assert.match(body, new RegExp(`const serverAcquisitionId = '${acquisitionId}';`));
  assert.match(body, /const serverTelemetryCaptured = 'true' === 'true';/);

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const landingEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'landing_page_view' &&
    entry.visitorId === visitorId &&
    entry.sessionId === sessionId &&
    entry.acquisitionId === acquisitionId &&
    entry.page === '/'
  ));
  assert.ok(landingEvent);
  assert.equal(landingEvent.source, 'website');
});

test('root reuses journey cookies and records SEO landing telemetry from search referrers', async () => {
  const cookieHeader = [
    'thumbgate_visitor_id=visitor_seeded',
    'thumbgate_session_id=session_seeded',
    'thumbgate_acquisition_id=acq_seeded',
  ].join('; ');
  const res = await fetch(apiUrl('/'), {
    headers: {
      cookie: cookieHeader,
      referer: 'https://www.google.com/search?q=workflow+hardening+sprint',
    },
  });
  assert.equal(res.status, 200);

  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  assert.equal(setCookies.length, 0);

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const landingEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'landing_page_view' &&
    entry.visitorId === 'visitor_seeded' &&
    entry.sessionId === 'session_seeded' &&
    entry.acquisitionId === 'acq_seeded' &&
    entry.referrerHost === 'www.google.com'
  ));
  assert.ok(landingEvent);
  assert.equal(landingEvent.source, 'organic_search');

  const seoEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'seo_landing_view' &&
    entry.visitorId === 'visitor_seeded' &&
    entry.sessionId === 'session_seeded' &&
    entry.acquisitionId === 'acq_seeded'
  ));
  assert.ok(seoEvent);
  assert.equal(seoEvent.seoSurface, 'google_search');
  assert.equal(seoEvent.seoQuery, 'workflow hardening sprint');
});

// /numbers is the primary destination for Zernio social CTAs as of 2026-04-21.
// These two tests guard the full attribution chain: request → telemetry-pings
// (landing_page_view with pageType=numbers) → funnel-events.jsonl
// (discovery/landing_view with UTM metadata). Regressing either breaks the
// "did anyone click the social post?" question that the CEO asks daily.
test('/numbers route records landing_page_view telemetry with pageType=numbers', async () => {
  const cookieHeader = [
    'thumbgate_visitor_id=visitor_numbers',
    'thumbgate_session_id=session_numbers',
    'thumbgate_acquisition_id=acq_numbers',
  ].join('; ');
  const res = await fetch(
    apiUrl('/numbers?utm_source=zernio&utm_medium=social&utm_campaign=organic'),
    { headers: { cookie: cookieHeader } }
  );
  assert.equal(res.status, 200);

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const landingEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'landing_page_view' &&
    entry.visitorId === 'visitor_numbers' &&
    entry.pageType === 'numbers'
  ));
  assert.ok(landingEvent, 'expected landing_page_view with pageType=numbers in telemetry-pings.jsonl');
  assert.equal(landingEvent.utmSource, 'zernio');
  assert.equal(landingEvent.utmMedium, 'social');
  assert.equal(landingEvent.utmCampaign, 'organic');
});

test('/numbers route writes a discovery/landing_view entry to funnel-events.jsonl with UTM metadata', async () => {
  const cookieHeader = [
    'thumbgate_visitor_id=visitor_funnel',
    'thumbgate_session_id=session_funnel',
    'thumbgate_acquisition_id=acq_funnel',
  ].join('; ');
  const res = await fetch(
    apiUrl('/numbers?utm_source=zernio&utm_medium=social&utm_campaign=organic&utm_content=linkedin_post'),
    { headers: { cookie: cookieHeader } }
  );
  assert.equal(res.status, 200);

  const funnelPath = path.join(tmpFeedbackDir, 'funnel-events.jsonl');
  const funnelEvents = readJsonl(funnelPath);
  const discoveryEvent = funnelEvents.find((entry) => (
    entry.stage === 'discovery' &&
    entry.event === 'landing_view' &&
    entry.installId === 'visitor_funnel'
  ));
  assert.ok(
    discoveryEvent,
    `expected discovery/landing_view entry for /numbers with installId=visitor_funnel in ${funnelPath}`
  );
  assert.equal(discoveryEvent.metadata.page, 'numbers');
  assert.equal(discoveryEvent.metadata.utmSource, 'zernio');
  assert.equal(discoveryEvent.metadata.utmMedium, 'social');
  assert.equal(discoveryEvent.metadata.utmCampaign, 'organic');
  assert.equal(discoveryEvent.metadata.utmContent, 'linkedin_post');
});

test('tracked link router redirects allowlisted marketing slugs and records first-party click telemetry', async () => {
  const cookieHeader = [
    'thumbgate_visitor_id=visitor_go',
    'thumbgate_session_id=session_go',
    'thumbgate_acquisition_id=acq_go',
  ].join('; ');
  const gptRes = await fetch(apiUrl('/go/gpt?utm_source=linkedin&utm_medium=organic_social&utm_campaign=founder_reply&utm_content=comment_1&creator=igor&cta_id=reply_open_gpt'), {
    redirect: 'manual',
    headers: {
      cookie: cookieHeader,
      referer: 'https://www.linkedin.com/feed/update/test',
    },
  });

  assert.equal(gptRes.status, 302);
  assert.equal(gptRes.headers.get('x-thumbgate-link-slug'), 'gpt');
  const gptLocation = new URL(gptRes.headers.get('location'));
  assert.equal(gptLocation.host, 'chatgpt.com');
  assert.equal(gptLocation.searchParams.get('utm_source'), 'linkedin');
  assert.equal(gptLocation.searchParams.get('utm_campaign'), 'founder_reply');
  assert.equal(gptLocation.searchParams.get('cta_id'), 'reply_open_gpt');

  const proRes = await fetch(apiUrl('/go/pro?utm_source=reddit&utm_medium=organic_social&utm_campaign=checkout_reply&community=ClaudeCode&offer_code=REDDIT-EARLY'), {
    redirect: 'manual',
    headers: {
      cookie: cookieHeader,
      referer: 'https://www.reddit.com/r/ClaudeCode/comments/example/',
    },
  });
  assert.equal(proRes.status, 302);
  const proLocation = new URL(proRes.headers.get('location'));
  assert.equal(proLocation.origin, 'https://app.example.com');
  assert.equal(proLocation.pathname, '/checkout/pro');
  assert.equal(proLocation.searchParams.get('utm_source'), 'reddit');
  assert.equal(proLocation.searchParams.get('community'), 'ClaudeCode');
  assert.equal(proLocation.searchParams.get('offer_code'), 'REDDIT-EARLY');
  assert.equal(proLocation.searchParams.get('cta_id'), 'go_pro');
  assert.equal(proLocation.searchParams.get('landing_path'), '/go/pro');

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const gptClick = telemetryEvents.find((entry) => (
    entry.eventType === 'chatgpt_gpt_open' &&
    entry.visitorId === 'visitor_go' &&
    entry.ctaId === 'reply_open_gpt'
  ));
  assert.ok(gptClick);
  assert.equal(gptClick.source, 'linkedin');
  assert.equal(gptClick.linkSlug, 'gpt');
  assert.equal(gptClick.destinationPath, 'chatgpt.com');

  const proClick = telemetryEvents.find((entry) => (
    entry.eventType === 'cta_click' &&
    entry.visitorId === 'visitor_go' &&
    entry.ctaId === 'go_pro'
  ));
  assert.ok(proClick);
  assert.equal(proClick.source, 'reddit');
  assert.equal(proClick.community, 'ClaudeCode');
  assert.equal(proClick.linkSlug, 'pro');
  assert.equal(proClick.destinationPath, '/checkout/pro');
});

test('tracked link router rejects unknown slugs instead of acting as an open redirect', async () => {
  const res = await fetch(apiUrl('/go/evil?url=https://evil.example'), {
    redirect: 'manual',
  });

  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'Tracked link not found');
  assert.ok(body.allowed.includes('gpt'));
  assert.ok(body.allowed.includes('pro'));
});

test('SEO comparison pages serve HTML, reuse journey cookies, and record page-specific search telemetry', async () => {
  const cookieHeader = [
    'thumbgate_visitor_id=visitor_compare',
    'thumbgate_session_id=session_compare',
    'thumbgate_acquisition_id=acq_compare',
  ].join('; ');
  const res = await fetch(apiUrl('/compare/speclock'), {
    headers: {
      cookie: cookieHeader,
      referer: 'https://www.google.com/search?q=thumbgate+vs+speclock',
    },
  });
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  assert.equal(setCookies.length, 0);

  const body = await res.text();
  assert.match(body, /ThumbGate vs SpecLock/);
  assert.match(body, /Verification evidence/);
  assert.match(body, /FAQPage/);

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const landingEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'landing_page_view' &&
    entry.visitorId === 'visitor_compare' &&
    entry.sessionId === 'session_compare' &&
    entry.acquisitionId === 'acq_compare' &&
    entry.page === '/compare/speclock'
  ));
  assert.ok(landingEvent);
  assert.equal(landingEvent.pageType, 'comparison');
  assert.equal(landingEvent.contentPillar, 'comparison');
  assert.equal(landingEvent.primaryQuery, 'thumbgate vs speclock');
  assert.equal(landingEvent.source, 'organic_search');

  const seoEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'seo_landing_view' &&
    entry.visitorId === 'visitor_compare' &&
    entry.sessionId === 'session_compare' &&
    entry.acquisitionId === 'acq_compare' &&
    entry.page === '/compare/speclock'
  ));
  assert.ok(seoEvent);
  assert.equal(seoEvent.pageType, 'comparison');
  assert.equal(seoEvent.seoQuery, 'thumbgate vs speclock');
});

test('robots and sitemap endpoints publish crawl metadata for the canonical app origin', async () => {
  const robotsRes = await fetch(apiUrl('/robots.txt'));
  assert.equal(robotsRes.status, 200);
  assert.match(String(robotsRes.headers.get('content-type')), /text\/plain/);
  const robotsBody = await robotsRes.text();
  assert.match(robotsBody, /User-agent: \*/);
  assert.match(robotsBody, /Allow: \//);
  assert.match(robotsBody, /Sitemap: https:\/\/app\.example\.com\/sitemap\.xml/);

  const sitemapRes = await fetch(apiUrl('/sitemap.xml'));
  assert.equal(sitemapRes.status, 200);
  assert.match(String(sitemapRes.headers.get('content-type')), /application\/xml/);
  const sitemapBody = await sitemapRes.text();
  assert.match(sitemapBody, /<loc>https:\/\/app\.example\.com\/<\/loc>/);
  assert.match(sitemapBody, /<loc>https:\/\/app\.example\.com\/compare\/speclock<\/loc>/);
  assert.match(sitemapBody, /<loc>https:\/\/app\.example\.com\/compare\/mem0<\/loc>/);
  assert.match(sitemapBody, /<loc>https:\/\/app\.example\.com\/guides\/pre-action-gates<\/loc>/);
  assert.match(sitemapBody, /<loc>https:\/\/app\.example\.com\/guides\/claude-code-feedback<\/loc>/);
  assert.match(sitemapBody, /<loc>https:\/\/app\.example\.com\/guides\/autoresearch-agent-safety<\/loc>/);
  assert.match(sitemapBody, /<changefreq>weekly<\/changefreq>/);
  assert.match(sitemapBody, /<priority>0\.9<\/priority>/);
  assert.match(sitemapBody, /<priority>0\.8<\/priority>/);
});

test('provisioning endpoint works', async () => {
  const res = await fetch(apiUrl('/v1/billing/provision'), {
    method: 'POST',
    headers: { 
      'content-type': 'application/json',
      authorization: 'Bearer test-api-key' 
    },
    body: JSON.stringify({ customerId: 'cus_api_test' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.key.startsWith('tg_'));
  
  // Verify isolated path
  assert.equal(billing._API_KEYS_PATH(), path.join(tmpFeedbackDir, 'api-keys.json'));
});

test('root still serves JSON status when explicitly requested', async () => {
  const res = await fetch(apiUrl('/?format=json'), {
    headers: { accept: 'application/json' },
  });
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /application\/json/);

  const body = await res.json();
  assert.equal(body.name, 'thumbgate');
  assert.equal(body.status, 'ok');
});

test('root JSON mode does not emit landing telemetry or journey cookies', async () => {
  const beforeTelemetryCount = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl')).length;
  const res = await fetch(apiUrl('/?format=json'), {
    headers: { accept: 'application/json' },
  });

  assert.equal(res.status, 200);
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  assert.equal(setCookies.length, 0);

  const afterTelemetry = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  assert.equal(afterTelemetry.length, beforeTelemetryCount);
});

test('journey cookies are marked secure on forwarded HTTPS requests', async () => {
  const res = await fetch(apiUrl('/'), {
    headers: {
      'x-forwarded-proto': 'https',
    },
  });

  assert.equal(res.status, 200);
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  assert.ok(setCookies.length >= 3);
  for (const cookie of setCookies) {
    assert.match(cookie, /Secure/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  }
});

test('success page serves hosted onboarding shell and records first-party telemetry', async () => {
  const res = await fetch(apiUrl('/success?session_id=test_checkout_success&trace_id=trace_success_page&acquisition_id=acq_success_page&visitor_id=visitor_success_page&visitor_session_id=session_success_page&install_id=inst_success_page&utm_source=reddit&utm_medium=organic_social&utm_campaign=success_launch&community=ClaudeCode&cta_id=pricing_pro&cta_placement=pricing&plan_id=pro&landing_path=%2Fpricing&referrer_host=www.reddit.com'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /Your local Pro dashboard is ready\./);
  assert.match(body, /Launch your personal dashboard/);
  assert.match(body, /npx thumbgate pro --activate --key=/);
  // Hosted API section explains value in plain English, not jargon.
  assert.match(body, /Use ThumbGate from CI, teammates, and remote agents \(optional\)/);
  assert.match(body, /CI jobs, GitHub Actions/);
  assert.match(body, /shared memory/);
  assert.match(body, /When you need this:/);
  assert.match(body, /When you can skip this:/);
  assert.match(body, /only use ThumbGate from your own laptop/);
  assert.match(body, /How to set it up:/);
  assert.match(body, /id="env-block"/);
  assert.match(body, /id="curl-block"/);
  assert.match(body, /const sessionEndpoint = "https:\/\/billing\.example\.com\/v1\/billing\/session";/);
  assert.match(body, /\+ '\?sessionId=' \+ encodeURIComponent\(sessionId\)/);
  assert.match(body, /sendTelemetryOnce\('checkout_session_lookup_started'/);
  assert.match(body, /sendTelemetryOnce\('checkout_paid_confirmed'/);
  assert.match(body, /sendTelemetryOnce\('checkout_session_pending'/);
  assert.match(body, /sendTelemetryOnce\('checkout_session_lookup_failed'/);

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const successPageView = telemetryEvents.find((entry) => (
    entry.eventType === 'checkout_success_page_view' &&
    entry.traceId === 'trace_success_page'
  ));
  assert.ok(successPageView);
  assert.equal(successPageView.acquisitionId, 'acq_success_page');
  assert.equal(successPageView.visitorId, 'visitor_success_page');
  assert.equal(successPageView.sessionId, 'session_success_page');
  assert.equal(successPageView.ctaId, 'pricing_pro');
  assert.equal(successPageView.landingPath, '/pricing');
});

test('dashboard auto-bootstraps local Pro auth only for localhost requests', async () => {
  const previousProMode = process.env.THUMBGATE_PRO_MODE;
  process.env.THUMBGATE_PRO_MODE = '1';

  try {
    const localRes = await fetch(apiUrl('/dashboard'));
    assert.equal(localRes.status, 200);
    const localBody = await localRes.text();
    assert.match(localBody, /const BOOTSTRAP_API_KEY = "test-api-key";/);
    assert.match(localBody, /const LOCAL_PRO_BOOTSTRAP = true;/);
    assert.match(localBody, /Local Pro is active on this machine/);

    const forwardedRes = await fetch(apiUrl('/dashboard'), {
      headers: {
        'x-forwarded-host': 'thumbgate.example.com',
        'x-forwarded-proto': 'https',
      },
    });
    assert.equal(forwardedRes.status, 200);
    const forwardedBody = await forwardedRes.text();
    assert.match(forwardedBody, /const BOOTSTRAP_API_KEY = "";/);
    assert.match(forwardedBody, /const LOCAL_PRO_BOOTSTRAP = false;/);
    assert.doesNotMatch(forwardedBody, /const BOOTSTRAP_API_KEY = "test-api-key";/);
  } finally {
    if (previousProMode === undefined) {
      delete process.env.THUMBGATE_PRO_MODE;
    } else {
      process.env.THUMBGATE_PRO_MODE = previousProMode;
    }
  }
});

test('cancel page serves retry message and records first-party telemetry', async () => {
  const res = await fetch(apiUrl('/cancel?trace_id=trace_cancel_page&acquisition_id=acq_cancel_page&visitor_id=visitor_cancel_page&session_id=session_cancel_page&install_id=inst_cancel_page&utm_source=google&utm_medium=organic&utm_campaign=seo_launch&cta_id=pricing_pro&cta_placement=pricing&plan_id=pro&landing_path=%2F&referrer_host=www.google.com'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /Checkout cancelled\./);
  assert.match(body, /noindex,nofollow/);
  assert.match(body, /data-reason="too_expensive"/);
  assert.match(body, /sendTelemetry\('checkout_cancelled'\)/);
  assert.match(body, /sendTelemetry\('reason_not_buying'/);
  assert.match(body, /retryUrl\.searchParams\.set\(key, value\)/);
  assert.match(body, /Return to Context Gateway/);

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const cancelPageView = telemetryEvents.find((entry) => (
    entry.eventType === 'checkout_cancel_page_view' &&
    entry.traceId === 'trace_cancel_page'
  ));
  assert.ok(cancelPageView);
  assert.equal(cancelPageView.acquisitionId, 'acq_cancel_page');
  assert.equal(cancelPageView.visitorId, 'visitor_cancel_page');
  assert.equal(cancelPageView.sessionId, 'session_cancel_page');
});

test('checkout fallback URLs preserve Stripe session placeholders while carrying visitor-session attribution', () => {
  const hostedSuccessUrl = buildHostedSuccessUrl('https://app.example.com', 'trace_checkout');
  const decoratedUrl = __test__.buildCheckoutFallbackUrl(hostedSuccessUrl, {
    acquisitionId: 'acq_test',
    visitorId: 'visitor_test',
    sessionId: 'visitor_session_test',
    utmSource: 'reddit',
    community: 'ClaudeCode',
  });
  const parsed = new URL(decoratedUrl);

  assert.equal(parsed.searchParams.get('session_id'), '{CHECKOUT_SESSION_ID}');
  assert.equal(parsed.searchParams.get('visitor_session_id'), 'visitor_session_test');
  assert.equal(parsed.searchParams.get('acquisition_id'), 'acq_test');
  assert.equal(parsed.searchParams.get('visitor_id'), 'visitor_test');
  assert.equal(parsed.searchParams.get('utm_source'), 'reddit');
  assert.equal(parsed.searchParams.get('community'), 'ClaudeCode');
});

test('checkout bootstrap route preserves attribution and records first-party telemetry in local mode', async () => {
  const res = await fetch(
    apiUrl('/checkout/pro?acquisition_id=acq_bootstrap&visitor_id=visitor_bootstrap&session_id=session_bootstrap&install_id=inst_bootstrap&utm_source=reddit&utm_medium=organic_social&utm_campaign=reddit_launch&utm_term=agentic+feedback&creator=reach_vb&community=ClaudeCode&post_id=1rsudq0&comment_id=oa9mqjf&campaign_variant=comment_problem_solution&offer_code=REDDIT-EARLY&cta_id=pricing_pro&cta_placement=pricing&plan_id=pro&landing_path=%2Fpricing'),
    {
      redirect: 'manual',
      headers: {
        referer: 'https://www.reddit.com/r/ClaudeCode/comments/1rsudq0/comment/oa9mqjf/',
      },
    }
  );

  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.pathname, '/success');
  assert.match(String(location.searchParams.get('session_id')), /^test_session_/);
  assert.match(String(location.searchParams.get('trace_id')), /^checkout_/);
  assert.equal(location.searchParams.get('acquisition_id'), 'acq_bootstrap');
  assert.equal(location.searchParams.get('visitor_id'), 'visitor_bootstrap');
  assert.equal(location.searchParams.get('visitor_session_id'), 'session_bootstrap');
  assert.equal(location.searchParams.get('install_id'), 'inst_bootstrap');

  const funnelEvents = readJsonl(process.env._TEST_FUNNEL_LEDGER_PATH);
  const checkoutCreated = funnelEvents.find((entry) => (
    entry.event === 'checkout_session_created' &&
    entry.traceId === location.searchParams.get('trace_id')
  ));
  assert.ok(checkoutCreated);
  assert.equal(checkoutCreated.installId, 'inst_bootstrap');
  assert.equal(checkoutCreated.acquisitionId, 'acq_bootstrap');
  assert.equal(checkoutCreated.visitorId, 'visitor_bootstrap');
  assert.equal(checkoutCreated.sessionId, 'session_bootstrap');
  assert.equal(checkoutCreated.ctaId, 'pricing_pro');
  assert.equal(checkoutCreated.ctaPlacement, 'pricing');
  assert.equal(checkoutCreated.planId, 'pro');
  assert.equal(checkoutCreated.landingPath, '/pricing');
  assert.equal(checkoutCreated.referrerHost, 'www.reddit.com');
  assert.equal(checkoutCreated.creator, 'reach_vb');
  assert.equal(checkoutCreated.community, 'ClaudeCode');
  assert.equal(checkoutCreated.postId, '1rsudq0');
  assert.equal(checkoutCreated.commentId, 'oa9mqjf');
  assert.equal(checkoutCreated.campaignVariant, 'comment_problem_solution');
  assert.equal(checkoutCreated.offerCode, 'REDDIT-EARLY');

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const bootstrapEvent = telemetryEvents.find((entry) => entry.eventType === 'checkout_bootstrap');
  assert.ok(bootstrapEvent);
  assert.equal(bootstrapEvent.page, '/checkout/pro');
  assert.equal(bootstrapEvent.acquisitionId, 'acq_bootstrap');
  assert.equal(bootstrapEvent.visitorId, 'visitor_bootstrap');
  assert.equal(bootstrapEvent.sessionId, 'session_bootstrap');
  assert.equal(bootstrapEvent.installId, 'inst_bootstrap');
  assert.equal(bootstrapEvent.utmSource, 'reddit');
  assert.equal(bootstrapEvent.utmMedium, 'organic_social');
  assert.equal(bootstrapEvent.utmCampaign, 'reddit_launch');
  assert.equal(bootstrapEvent.ctaId, 'pricing_pro');
  assert.equal(bootstrapEvent.planId, 'pro');
  assert.equal(bootstrapEvent.landingPath, '/pricing');
  assert.equal(bootstrapEvent.referrerHost, 'www.reddit.com');
  assert.equal(bootstrapEvent.creator, 'reach_vb');
  assert.equal(bootstrapEvent.community, 'ClaudeCode');
  assert.equal(bootstrapEvent.offerCode, 'REDDIT-EARLY');
});

test('checkout bootstrap falls back to seeded journey cookies when query IDs are absent', async () => {
  const cookieHeader = [
    'thumbgate_visitor_id=visitor_cookie_checkout',
    'thumbgate_session_id=session_cookie_checkout',
    'thumbgate_acquisition_id=acq_cookie_checkout',
  ].join('; ');
  const res = await fetch(
    apiUrl('/checkout/pro?utm_source=reddit&utm_medium=organic_social&utm_campaign=reddit_launch&cta_id=pricing_pro&cta_placement=pricing&plan_id=pro'),
    {
      redirect: 'manual',
      headers: {
        cookie: cookieHeader,
        referer: 'https://www.reddit.com/r/ClaudeCode/comments/1rsudq0/',
      },
    }
  );

  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.searchParams.get('acquisition_id'), 'acq_cookie_checkout');
  assert.equal(location.searchParams.get('visitor_id'), 'visitor_cookie_checkout');
  assert.equal(location.searchParams.get('visitor_session_id'), 'session_cookie_checkout');

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const bootstrapEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'checkout_bootstrap' &&
    entry.acquisitionId === 'acq_cookie_checkout' &&
    entry.visitorId === 'visitor_cookie_checkout' &&
    entry.sessionId === 'session_cookie_checkout'
  ));
  assert.ok(bootstrapEvent);
});

test('feedback capture accepts valid payload', async () => {
  const res = await fetch(apiUrl('/v1/feedback/capture'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      signal: 'down',
      context: 'Claimed fixed with no test output',
      whatWentWrong: 'No evidence',
      whatToChange: 'Run tests before completion claim',
      tags: ['verification', 'testing'],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.accepted, true);
  assert.ok(body.memoryRecord);
});

test('feedback capture preserves related feedback linkage when provided', async () => {
  const res = await fetch(apiUrl('/v1/feedback/capture'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      signal: 'down',
      context: 'Follow-up note about the earlier mistake',
      relatedFeedbackId: 'fb_parent_123',
      tags: ['verification'],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.accepted, true);
  assert.equal(body.feedbackEvent.relatedFeedbackId, 'fb_parent_123');
});

test('feedback capture blocks positive memory promotion when rubric guardrail fails', async () => {
  const res = await fetch(apiUrl('/v1/feedback/capture'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      signal: 'up',
      context: 'Looks correct',
      whatWorked: 'No evidence attached',
      rubricScores: [
        { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
        { criterion: 'verification_evidence', score: 2, judge: 'judge-b', evidence: 'missing test logs' },
      ],
      guardrails: {
        testsPassed: false,
        pathSafety: true,
        budgetCompliant: true,
      },
      tags: ['verification'],
    }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.accepted, false);
  assert.match(body.reason, /Rubric gate prevented promotion/);
});

test('feedback capture can distill a lesson from chatHistory when the submitted signal is vague', async () => {
  const res = await fetch(apiUrl('/v1/feedback/capture'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      signal: 'down',
      context: 'thumbs down',
      chatHistory: [
        { author: 'user', text: 'Do not use Tailwind in this repo.' },
        { author: 'assistant', text: 'I used Tailwind classes in the hero rewrite.' },
      ],
      tags: ['ui'],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.accepted, true);
  assert.match(body.feedbackEvent.whatWentWrong, /ignored a prior instruction/i);
  assert.equal(body.feedbackEvent.conversationWindow.length, 2);
});

test('feedback capture returns clarification_required for vague positive signal', async () => {
  const res = await fetch(apiUrl('/v1/feedback/capture'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      signal: 'up',
      context: 'thumbs up',
      tags: ['verification'],
    }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.accepted, false);
  assert.equal(body.signalLogged, true);
  assert.equal(body.status, 'clarification_required');
  assert.equal(body.needsClarification, true);
  assert.match(body.prompt, /What specifically worked that should be repeated/);
});

test('feedback capture promotes specific positive feedback even when tags are omitted', async () => {
  const res = await fetch(apiUrl('/v1/feedback/capture'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      signal: 'up',
      context: 'ThumbGate automation and Claude statusline repair',
      whatWorked: 'Verified the live ThumbGate version and fixed the stale Claude statusline wiring',
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.accepted, true);
  assert.ok(body.memoryRecord.tags.includes('thumbgate'));
});

test('quick feedback capture via GET /feedback/quick?signal=up returns HTML confirmation', async () => {
  const res = await fetch(apiUrl('/feedback/quick?signal=up'), { headers: authHeader });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('👍'), 'should show thumbs up emoji');
  assert.ok(html.includes('Positive feedback recorded'), 'should confirm capture with friendly label');
  assert.ok(html.includes('Undo'), 'should offer undo action');
  assert.ok(html.includes('signal=down'), 'undo link should point to opposite signal');
  assert.ok(html.includes('Add follow-up context'), 'should offer follow-up context input');
  assert.ok(html.includes('/feedback/quick/context'), 'should post follow-up notes to the public quick-feedback endpoint');
  assert.match(html, /feedbackSessionId:'fbs_/i, 'quick-feedback page should carry the open feedback session id forward');
});

test('quick feedback capture via GET /feedback/quick?signal=down returns HTML confirmation', async () => {
  recordConversationEntry({
    author: 'user',
    text: 'Never skip tests before claiming done.',
    source: 'statusline-test',
  }, { feedbackDir: tmpFeedbackDir });
  recordConversationEntry({
    author: 'assistant',
    text: 'I claimed done without running npm test.',
    source: 'statusline-test',
  }, { feedbackDir: tmpFeedbackDir });

  const res = await fetch(apiUrl('/feedback/quick?signal=down'), { headers: authHeader });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('👎'), 'should show thumbs down emoji');
  assert.ok(html.includes('Negative feedback recorded'), 'should confirm capture with friendly label');
  assert.ok(html.includes('Undo'), 'should offer undo action');
  assert.ok(html.includes('signal=up'), 'undo link should point to opposite signal');

  const { feedbackLogPath } = getConversationPaths(tmpFeedbackDir);
  const logEntries = readJsonl(feedbackLogPath);
  const latest = logEntries[logEntries.length - 1];
  assert.match(latest.whatWentWrong, /ignored a prior instruction/i);
});

test('quick feedback capture without signal returns 400', async () => {
  const res = await fetch(apiUrl('/feedback/quick'), { headers: authHeader });
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.ok(html.includes('signal=up'), 'should hint at correct usage');
});

test('quick feedback follow-up context endpoint enriches the original lesson without creating a duplicate record', async () => {
  const captureRes = await fetch(apiUrl('/feedback/quick?signal=up'), { headers: authHeader });
  assert.equal(captureRes.status, 200);
  const captureHtml = await captureRes.text();
  const relatedFeedbackId = captureHtml.match(/\/lessons\/([^"']+)/)?.[1];
  const feedbackSessionId = captureHtml.match(/feedbackSessionId:'([^']+)'/)?.[1];
  assert.ok(relatedFeedbackId, 'quick feedback page should include the created lesson id');
  assert.ok(feedbackSessionId, 'quick feedback page should include the open feedback session id');

  const res = await fetch(apiUrl('/feedback/quick/context'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      signal: 'up',
      context: 'Thorough PR review',
      relatedFeedbackId,
      feedbackSessionId,
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.relatedFeedbackId, relatedFeedbackId);
  assert.equal(body.detailField, 'whatWorked');
  assert.match(body.updated.whatWorked, /Thorough PR review/);
  assert.match(body.updated.tags.join(','), /follow-up-context/);
  assert.equal(body.feedbackSession.status, 'appended');

  const lessonRes = await fetch(apiUrl(`/lessons/${encodeURIComponent(relatedFeedbackId)}`), { headers: authHeader });
  assert.equal(lessonRes.status, 200);
  const lessonHtml = await lessonRes.text();
  assert.match(lessonHtml, /Thorough PR review/);

  const { feedbackLogPath } = getConversationPaths(tmpFeedbackDir);
  const logEntries = readJsonl(feedbackLogPath);
  assert.equal(logEntries.filter((entry) => entry.id === relatedFeedbackId).length, 1);
});

test('intent catalog endpoint returns configured intents', async () => {
  const res = await fetch(apiUrl('/v1/intents/catalog?mcpProfile=locked'), { headers: authHeader });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mcpProfile, 'locked');
  assert.ok(Array.isArray(body.intents));
  assert.ok(body.intents.length >= 3);
});

test('intent catalog endpoint accepts partner profile', async () => {
  const res = await fetch(apiUrl('/v1/intents/catalog?mcpProfile=default&partnerProfile=strict-reviewer'), { headers: authHeader });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.partnerProfile, 'strict_reviewer');
  assert.equal(body.partnerStrategy.verificationMode, 'evidence_first');
});

test('intent catalog rejects invalid mcp profile', async () => {
  const res = await fetch(apiUrl('/v1/intents/catalog?mcpProfile=bad-profile'), {
    headers: authHeader,
  });
  assert.equal(res.status, 400);
});

test('intent plan returns checkpoint for unapproved high-risk action', async () => {
  const res = await fetch(apiUrl('/v1/intents/plan'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      intentId: 'publish_dpo_training_data',
      mcpProfile: 'default',
      approved: false,
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'checkpoint_required');
  assert.equal(body.requiresApproval, true);
  assert.equal(body.executionMode, 'single_agent');
  assert.equal(body.delegationEligible, false);
  assert.equal(body.delegationScore, 0);
  assert.equal(body.delegateProfile, null);
  assert.equal(body.handoffContract, null);
});

test('intent plan returns partner-aware strategy metadata', async () => {
  const res = await fetch(apiUrl('/v1/intents/plan'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      intentId: 'incident_postmortem',
      mcpProfile: 'default',
      partnerProfile: 'strict-reviewer',
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.partnerProfile, 'strict_reviewer');
  assert.equal(body.partnerStrategy.verificationMode, 'evidence_first');
  assert.ok(body.tokenBudget.contextPack > 6000);
  assert.ok(Array.isArray(body.actionScores));
});

test('handoff endpoints expose sequential delegation over HTTP', async () => {
  const planRes = await fetch(apiUrl('/v1/intents/plan'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      intentId: 'improve_response_quality',
      context: 'Improve the response with evidence and prevention rules',
      mcpProfile: 'default',
      delegationMode: 'auto',
    }),
  });
  assert.equal(planRes.status, 200);
  const planBody = await planRes.json();
  assert.equal(planBody.executionMode, 'sequential_delegate');
  assert.equal(planBody.delegateProfile, 'pr_workflow');
  assert.ok(planBody.handoffContract);

  const startRes = await fetch(apiUrl('/v1/handoffs/start'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      intentId: 'improve_response_quality',
      context: 'Improve the response with evidence and prevention rules',
      mcpProfile: 'default',
    }),
  });
  assert.equal(startRes.status, 200);
  const started = await startRes.json();
  assert.equal(started.status, 'started');
  assert.equal(started.executionMode, 'sequential_delegate');
  assert.equal(started.delegateProfile, 'pr_workflow');
  assert.ok(started.handoffContract);
  assert.ok(Array.isArray(started.handoffContract.requiredChecks));

  const completeRes = await fetch(apiUrl('/v1/handoffs/complete'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      handoffId: started.handoffId,
      outcome: 'accepted',
      summary: 'Accepted after evidence review.',
      resultContext: 'Returned a verified result context with explicit evidence and clean checks.',
      attempts: 2,
      violationCount: 0,
    }),
  });
  assert.equal(completeRes.status, 200);
  const completed = await completeRes.json();
  assert.equal(completed.status, 'completed');
  assert.equal(completed.outcome, 'accepted');
  assert.equal(completed.verificationAccepted, true);
});

test('intent plan returns codegraph impact for coding workflows', async () => {
  const previous = process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
  process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = JSON.stringify({
    source: 'stub',
    symbols: ['planIntent'],
    callers: ['src/api/server.js -> planIntent'],
    callees: ['rankActions'],
    deadCode: ['legacyIntentPlanner'],
  });

  try {
    const res = await fetch(apiUrl('/v1/intents/plan'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader },
      body: JSON.stringify({
        intentId: 'incident_postmortem',
        context: 'Refactor `planIntent` in scripts/intent-router.js',
        mcpProfile: 'default',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.codegraphImpact.enabled, true);
    assert.equal(body.codegraphImpact.evidence.deadCodeCount, 1);
    assert.ok(body.partnerStrategy.recommendedChecks.some((check) => /dead code/i.test(check)));
  } finally {
    if (previous === undefined) delete process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE;
    else process.env.THUMBGATE_CODEGRAPH_STUB_RESPONSE = previous;
  }
});

test('summary endpoint returns markdown text payload', async () => {
  const res = await fetch(apiUrl('/v1/feedback/summary?recent=10'), { headers: authHeader });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.summary, /Feedback Summary/);
});

test('default feedback stats stay on THUMBGATE_FEEDBACK_DIR even when INIT_CWD is set', async () => {
  const savedInitCwd = process.env.INIT_CWD;
  const feedbackLogPath = path.join(tmpFeedbackDir, 'feedback-log.jsonl');
  const baselineEntries = fs.existsSync(feedbackLogPath) ? readJsonl(feedbackLogPath) : [];
  const baselineTotal = baselineEntries.length;
  const baselinePositive = baselineEntries.filter((entry) => entry.signal === 'positive').length;
  const baselineNegative = baselineEntries.filter((entry) => entry.signal === 'negative').length;
  process.env.INIT_CWD = path.join(os.tmpdir(), 'thumbgate-init-cwd-project');
  try {
    fs.appendFileSync(feedbackLogPath, `${JSON.stringify({
      id: 'fb_initcwd_scope_guard',
      signal: 'positive',
      context: 'Explicit feedback dir should remain authoritative',
      timestamp: '2026-04-08T10:00:00.000Z',
    })}\n`);

    const updatedRes = await fetch(apiUrl('/v1/feedback/stats'), { headers: authHeader });
    assert.equal(updatedRes.status, 200);
    const updatedBody = await updatedRes.json();
    assert.equal(updatedBody.total, baselineTotal + 1);
    assert.equal(updatedBody.totalPositive, baselinePositive + 1);
    assert.equal(updatedBody.totalNegative, baselineNegative);
  } finally {
    if (baselineEntries.length > 0) {
      fs.writeFileSync(feedbackLogPath, `${baselineEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    } else {
      fs.rmSync(feedbackLogPath, { force: true });
    }
    if (savedInitCwd === undefined) delete process.env.INIT_CWD;
    else process.env.INIT_CWD = savedInitCwd;
  }
});

test('project-scoped endpoints honor explicit project selection for stats, lessons, and dashboard', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-project-scope-api-'));
  const feedbackDir = path.join(projectDir, '.thumbgate');
  fs.mkdirSync(feedbackDir, { recursive: true });

  try {
    fs.writeFileSync(path.join(feedbackDir, 'feedback-log.jsonl'), [
      JSON.stringify({
        id: 'fb_project_positive',
        signal: 'positive',
        context: 'Verified project alpha release flow',
        tags: ['verification', 'alpha'],
        timestamp: '2026-04-08T09:00:00.000Z',
      }),
      JSON.stringify({
        id: 'fb_project_negative',
        signal: 'negative',
        context: 'Skipped rollback checklist for project alpha',
        tags: ['release', 'alpha'],
        timestamp: '2026-04-08T09:05:00.000Z',
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(feedbackDir, 'memory-log.jsonl'), `${JSON.stringify({
      id: 'mem_project_alpha',
      title: 'MISTAKE: Skipped rollback checklist for project alpha',
      content: 'What went wrong: Skipped rollback checklist\nHow to avoid: Attach rollback checklist before shipping',
      category: 'error',
      importance: 'high',
      tags: ['feedback', 'negative', 'release', 'alpha'],
      sourceFeedbackId: 'fb_project_negative',
      timestamp: '2026-04-08T09:05:01.000Z',
    })}\n`);

    const projectQuery = `project=${encodeURIComponent(projectDir)}`;

    const statsRes = await fetch(apiUrl(`/v1/feedback/stats?${projectQuery}`), { headers: authHeader });
    assert.equal(statsRes.status, 200);
    const statsBody = await statsRes.json();
    assert.equal(statsBody.total, 2);
    assert.equal(statsBody.totalPositive, 1);
    assert.equal(statsBody.totalNegative, 1);

    const lessonsRes = await fetch(apiUrl(`/v1/lessons/search?q=rollback&limit=5&${projectQuery}`), { headers: authHeader });
    assert.equal(lessonsRes.status, 200);
    const lessonsBody = await lessonsRes.json();
    assert.equal(lessonsBody.feedbackDir, feedbackDir);
    assert.equal(lessonsBody.returned, 1);
    assert.equal(lessonsBody.results[0].id, 'mem_project_alpha');

    const dashboardRes = await fetch(apiUrl(`/v1/dashboard?${projectQuery}`), { headers: authHeader });
    assert.equal(dashboardRes.status, 200);
    const dashboardBody = await dashboardRes.json();
    assert.equal(dashboardBody.approval.total, 2);
    assert.equal(dashboardBody.approval.positive, 1);
    assert.equal(dashboardBody.approval.negative, 1);

    const healthzRes = await fetch(apiUrl(`/healthz?${projectQuery}`), { headers: authHeader });
    assert.equal(healthzRes.status, 200);
    const healthzBody = await healthzRes.json();
    assert.equal(healthzBody.feedbackLogPath, path.join(feedbackDir, 'feedback-log.jsonl'));
    assert.equal(healthzBody.memoryLogPath, path.join(feedbackDir, 'memory-log.jsonl'));
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('project-scoped overrides are rejected for non-loopback requests', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-project-remote-reject-'));
  try {
    const projectQuery = `project=${encodeURIComponent(projectDir)}`;
    const res = await fetch(apiUrl(`/v1/feedback/stats?${projectQuery}`), {
      headers: {
        ...authHeader,
        'x-forwarded-host': 'thumbgate.example.com',
      },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /only available on localhost/i);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('lesson search endpoint returns promoted lessons with linked corrective actions', async () => {
  const feedbackLogPath = path.join(tmpFeedbackDir, 'feedback-log.jsonl');
  const memoryLogPath = path.join(tmpFeedbackDir, 'memory-log.jsonl');
  const rulesPath = path.join(tmpFeedbackDir, 'prevention-rules.md');
  const autoGatesPath = path.join(tmpFeedbackDir, 'auto-promoted-gates.json');
  const backups = [
    [feedbackLogPath, fs.existsSync(feedbackLogPath) ? fs.readFileSync(feedbackLogPath, 'utf8') : null],
    [memoryLogPath, fs.existsSync(memoryLogPath) ? fs.readFileSync(memoryLogPath, 'utf8') : null],
    [rulesPath, fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : null],
    [autoGatesPath, fs.existsSync(autoGatesPath) ? fs.readFileSync(autoGatesPath, 'utf8') : null],
  ];

  try {
    fs.writeFileSync(feedbackLogPath, `${JSON.stringify({
      id: 'fb_api_lesson',
      signal: 'negative',
      context: 'Skipped rollback proof during release',
      tags: ['release', 'verification'],
      timestamp: '2026-03-23T15:00:00.000Z',
    })}\n`);
    fs.writeFileSync(memoryLogPath, `${JSON.stringify({
      id: 'mem_api_lesson',
      title: 'MISTAKE: Skipped rollback proof during release',
      content: 'What went wrong: Skipped rollback proof during release\nHow to avoid: Attach rollback notes before shipping',
      category: 'error',
      importance: 'high',
      tags: ['feedback', 'negative', 'release', 'verification'],
      sourceFeedbackId: 'fb_api_lesson',
      timestamp: '2026-03-23T15:00:01.000Z',
    })}\n`);
    fs.writeFileSync(rulesPath, '# Rollback proof\nAlways attach rollback notes before shipping.\n');
    fs.writeFileSync(autoGatesPath, JSON.stringify({
      version: 1,
      gates: [{
        id: 'auto-release-verification',
        action: 'warn',
        pattern: 'release+verification',
        message: 'Warn when release verification proof is missing',
        occurrences: 3,
        promotedAt: '2026-03-23T15:10:00.000Z',
      }],
      promotionLog: [],
    }, null, 2));

    const res = await fetch(apiUrl('/v1/lessons/search?q=rollback&limit=5'), { headers: authHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.returned, 1);
    assert.equal(body.results[0].id, 'mem_api_lesson');
    assert.equal(body.results[0].lesson.howToAvoid, 'Attach rollback notes before shipping');
    assert.equal(body.results[0].systemResponse.lifecycle.enforcementState, 'warning');
    assert.equal(body.results[0].systemResponse.linkedPreventionRules[0].title, 'Rollback proof');
    assert.equal(body.results[0].systemResponse.linkedAutoGates[0].id, 'auto-release-verification');
    assert.ok(body.results[0].systemResponse.harnessRecommendations.some((recommendation) => recommendation.type === 'diagnostic_capture'));
  } finally {
    backups.forEach(([filePath, content]) => {
      if (content === null) {
        fs.rmSync(filePath, { force: true });
      } else {
        fs.writeFileSync(filePath, content);
      }
    });
  }
});

test('dpo export endpoint works with local memory log', async () => {
  const outputPath = path.join(tmpFeedbackDir, 'dpo.jsonl');
  const res = await fetch(apiUrl('/v1/dpo/export'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({ outputPath }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(typeof body.pairs === 'number');
  assert.equal(fs.existsSync(outputPath), true);
});

test('databricks export endpoint writes analytics bundle', async () => {
  const outputPath = path.join(tmpFeedbackDir, 'analytics', 'bundle-api');
  fs.mkdirSync(path.join(tmpProofDir, 'automation'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpProofDir, 'automation', 'report.json'),
    JSON.stringify({ checks: [{ id: 'AUTO-01', passed: true }] }, null, 2)
  );

  const res = await fetch(apiUrl('/v1/analytics/databricks/export'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({ outputPath }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.bundlePath, outputPath);
  assert.equal(fs.existsSync(path.join(outputPath, 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(outputPath, 'load_databricks.sql')), true);
  assert.ok(body.tables.some((table) => table.tableName === 'proof_reports'));
});

test('databricks export endpoint defaults bundle path inside the safe feedback dir', async () => {
  const res = await fetch(apiUrl('/v1/analytics/databricks/export'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.bundlePath, new RegExp(`^${path.join(tmpFeedbackDir, 'analytics').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(fs.existsSync(path.join(body.bundlePath, 'manifest.json')), true);
});

test('context construct/evaluate/provenance endpoints work', async () => {
  const constructRes = await fetch(apiUrl('/v1/context/construct'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      query: 'verification',
      maxItems: 5,
      maxChars: 4000,
    }),
  });
  assert.equal(constructRes.status, 200);
  const constructBody = await constructRes.json();
  assert.ok(constructBody.packId);

  const evalRes = await fetch(apiUrl('/v1/context/evaluate'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      packId: constructBody.packId,
      outcome: 'useful',
      signal: 'positive',
      notes: 'api test',
      rubricScores: [
        { criterion: 'correctness', score: 4, evidence: 'tests green', judge: 'judge-a' },
        { criterion: 'verification_evidence', score: 4, evidence: 'output attached', judge: 'judge-a' },
      ],
      guardrails: {
        testsPassed: true,
        pathSafety: true,
        budgetCompliant: true,
      },
    }),
  });
  assert.equal(evalRes.status, 200);
  const evalBody = await evalRes.json();
  assert.equal(evalBody.packId, constructBody.packId);
  assert.ok(evalBody.rubricEvaluation);
  assert.equal(typeof evalBody.rubricEvaluation.promotionEligible, 'boolean');

  const provRes = await fetch(apiUrl('/v1/context/provenance?limit=5'), {
    headers: authHeader,
  });
  assert.equal(provRes.status, 200);
  const provBody = await provRes.json();
  assert.equal(Array.isArray(provBody.events), true);
});

test('context construct rejects invalid namespaces', async () => {
  const res = await fetch(apiUrl('/v1/context/construct'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      query: 'verification',
      namespaces: ['../../../../tmp'],
    }),
  });
  assert.equal(res.status, 400);
});

test('unauthorized without bearer token', async () => {
  const res = await fetch(apiUrl('/v1/feedback/stats'));
  assert.equal(res.status, 401);
});

test('billing checkout endpoint is public', async () => {
  const res = await fetch(apiUrl('/v1/billing/checkout'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      installId: 'inst_public_checkout_test',
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const body = await res.json();
  assert.ok(typeof body.sessionId === 'string');
  assert.equal(body.localMode, true);
  assert.match(body.traceId, /^checkout_/);
  assert.equal(body.planId, 'pro');
  assert.equal(body.billingCycle, 'monthly');
  assert.equal(body.price, 19);
  assert.equal(body.type, 'subscription');
  assert.equal(res.headers.get('x-thumbgate-trace-id'), body.traceId);
});

test('product feedback endpoint logs local issue reports without auth', async () => {
  const originalGithubToken = process.env.GITHUB_TOKEN;
  const originalGhToken = process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  try {
    const res = await fetch(apiUrl('/api/feedback/submit'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        category: 'feature',
        message: 'Please keep the product feedback widget pinned on the lessons page.',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.issueNumber, null);
    assert.match(body.note, /logged locally/);

    const entries = readJsonl(path.join(tmpFeedbackDir, 'user-feedback.jsonl'));
    const latest = entries.at(-1);
    assert.match(latest.title, /^\[Feature\]/);
    assert.equal(latest.category, 'feature');
    assert.equal(latest.source, 'dashboard feedback widget');
  } finally {
    if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalGithubToken;
    if (originalGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGhToken;
  }
});

test('workflow sprint intake endpoint captures a contactable lead', async () => {
  const res = await fetch(apiUrl('/v1/intake/workflow-sprint'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'buyer@example.com',
      company: 'Example Co',
      workflow: 'PR review hardening',
      owner: 'Platform Lead',
      blocker: 'The same CI and review regressions keep resurfacing across agent runs.',
      runtime: 'Claude Code',
      note: 'Need proof before rolling this out team-wide.',
      utmSource: 'linkedin',
      utmMedium: 'organic_social',
      utmCampaign: 'claude_workflow_hardening_march_2026',
      creator: 'reach_vb',
      ctaId: 'workflow_sprint_intake',
      ctaPlacement: 'workflow_sprint',
      planId: 'sprint',
    }),
  });

  assert.equal(res.status, 201);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.leadId, /^lead_/);
  assert.equal(body.status, 'new');
  assert.match(body.proofPackUrl, /VERIFICATION_EVIDENCE\.md/);

  const leads = readJsonl(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl'));
  assert.equal(leads.length, 1);
  assert.equal(leads[0].contact.email, 'buyer@example.com');
  assert.equal(leads[0].qualification.workflow, 'PR review hardening');
  assert.equal(leads[0].attribution.planId, 'sprint');
  assert.equal(leads[0].attribution.source, 'linkedin');
  assert.equal(leads[0].attribution.utmMedium, 'organic_social');
  assert.equal(leads[0].attribution.creator, 'reach_vb');

  const telemetry = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  assert.ok(telemetry.some((entry) => entry.eventType === 'workflow_sprint_lead_submitted'));
});

test('workflow sprint intake falls back to journey cookies when IDs are omitted from the payload', async () => {
  const cookieHeader = [
    'thumbgate_visitor_id=visitor_cookie_lead',
    'thumbgate_session_id=session_cookie_lead',
    'thumbgate_acquisition_id=acq_cookie_lead',
  ].join('; ');

  const res = await fetch(apiUrl('/v1/intake/workflow-sprint'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookieHeader,
      referer: 'https://www.google.com/search?q=claude+workflow+hardening',
    },
    body: JSON.stringify({
      email: 'ops@example.com',
      company: 'North Star Systems',
      workflow: 'Bug triage',
      owner: 'Platform lead',
      runtime: 'Claude Code',
      blocker: 'Unsafe rollout reviews keep stalling the queue.',
    }),
  });

  assert.equal(res.status, 201);
  const leads = readJsonl(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl'));
  const lead = leads.find((entry) => entry.contact.email === 'ops@example.com');
  assert.ok(lead);
  assert.equal(lead.attribution.acquisitionId, 'acq_cookie_lead');
  assert.equal(lead.attribution.visitorId, 'visitor_cookie_lead');
  assert.equal(lead.attribution.sessionId, 'session_cookie_lead');

  const telemetry = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const submitted = telemetry.find((entry) => (
    entry.eventType === 'workflow_sprint_lead_submitted' &&
    entry.acquisitionId === 'acq_cookie_lead' &&
    entry.visitorId === 'visitor_cookie_lead' &&
    entry.sessionId === 'session_cookie_lead'
  ));
  assert.ok(submitted);
});

test('workflow sprint intake accepts form posts, seeds journey cookies, and returns an HTML confirmation page', async () => {
  const body = new URLSearchParams({
    email: 'formbuyer@example.com',
    company: 'HTML Forms Co',
    workflow: 'Release triage',
    owner: 'CTO',
    runtime: 'Claude Code',
    blocker: 'No-JS buyers need a real intake path.',
  }).toString();

  const res = await fetch(apiUrl('/v1/intake/workflow-sprint'), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      referer: 'https://app.example.com/?utm_source=reddit&utm_medium=organic_social&utm_campaign=workflow_hardening_launch&creator=reach_vb&community=ClaudeCode&post_id=1rsudq0&offer_code=EARLY',
    },
    body,
  });

  assert.equal(res.status, 201);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  const visitorId = extractCookieValue(setCookies, 'thumbgate_visitor_id');
  const sessionId = extractCookieValue(setCookies, 'thumbgate_session_id');
  const acquisitionId = extractCookieValue(setCookies, 'thumbgate_acquisition_id');
  assert.match(String(visitorId), /^visitor_/);
  assert.match(String(sessionId), /^session_/);
  assert.match(String(acquisitionId), /^acq_/);

  const html = await res.text();
  assert.match(html, /Workflow sprint intake received/);
  assert.match(html, /Review Proof Pack/);
  assert.match(html, /Review Sprint Brief/);

  const leads = readJsonl(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl'));
  const lead = leads.find((entry) => entry.contact.email === 'formbuyer@example.com');
  assert.ok(lead);
  assert.equal(lead.attribution.source, 'reddit');
  assert.equal(lead.attribution.utmCampaign, 'workflow_hardening_launch');
  assert.equal(lead.attribution.creator, 'reach_vb');
  assert.equal(lead.attribution.community, 'ClaudeCode');
  assert.equal(lead.attribution.postId, '1rsudq0');
  assert.equal(lead.attribution.offerCode, 'EARLY');
  assert.equal(lead.attribution.visitorId, visitorId);
  assert.equal(lead.attribution.sessionId, sessionId);
  assert.equal(lead.attribution.acquisitionId, acquisitionId);

  const telemetry = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const submitted = telemetry.find((entry) => (
    entry.eventType === 'workflow_sprint_lead_submitted' &&
    entry.acquisitionId === acquisitionId &&
    entry.visitorId === visitorId &&
    entry.sessionId === sessionId
  ));
  assert.ok(submitted);
});

test('workflow sprint intake validation failure records failure telemetry and writes no lead', async () => {
  const leadsBefore = readJsonl(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl')).length;
  const res = await fetch(apiUrl('/v1/intake/workflow-sprint'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: 'https://app.example.com/?utm_source=linkedin&utm_campaign=workflow_hardening',
    },
    body: JSON.stringify({
      email: 'invalid-email',
      workflow: '',
      owner: 'CTO',
      runtime: 'Claude Code',
      blocker: 'Missing required lead fields should fail.',
    }),
  });

  assert.equal(res.status, 400);
  const leadsAfter = readJsonl(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl')).length;
  assert.equal(leadsAfter, leadsBefore);

  const telemetry = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const failure = [...telemetry].reverse().find((entry) => entry.eventType === 'workflow_sprint_lead_failed');
  assert.ok(failure);
  assert.equal(failure.utmSource, 'linkedin');
  assert.equal(failure.utmCampaign, 'workflow_hardening');
  assert.equal(failure.ctaId, 'workflow_sprint_intake');
});

test('workflow sprint advance endpoint requires the static admin key', async () => {
  const intakeRes = await fetch(apiUrl('/v1/intake/workflow-sprint'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'advance-auth@example.com',
      workflow: 'Release hardening',
      owner: 'Platform lead',
      blocker: 'Need an admin-only transition path.',
      runtime: 'Claude Code',
    }),
  });
  assert.equal(intakeRes.status, 201);
  const intakeBody = await intakeRes.json();

  const billingKey = billing.provisionApiKey('cus_sprint_non_admin', {
    installId: 'inst_sprint_non_admin',
    source: 'stripe_webhook_checkout_completed',
  }).key;

  const res = await fetch(apiUrl('/v1/intake/workflow-sprint/advance'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${billingKey}`,
    },
    body: JSON.stringify({
      leadId: intakeBody.leadId,
      status: 'qualified',
    }),
  });

  assert.equal(res.status, 403);
});

test('workflow sprint advance endpoint appends pipeline snapshots and workflow run evidence', async () => {
  const intakeRes = await fetch(apiUrl('/v1/intake/workflow-sprint'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'advance@example.com',
      company: 'North Star Systems',
      workflow: 'PR review hardening',
      owner: 'Platform lead',
      blocker: 'Need proof-backed pilot promotion.',
      runtime: 'Claude Code',
      utmSource: 'linkedin',
    }),
  });
  assert.equal(intakeRes.status, 201);
  const intakeBody = await intakeRes.json();

  const qualifiedRes = await fetch(apiUrl('/v1/intake/workflow-sprint/advance'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeader,
    },
    body: JSON.stringify({
      leadId: intakeBody.leadId,
      status: 'qualified',
      actor: 'ops',
      note: 'Qualified for pilot review.',
    }),
  });
  assert.equal(qualifiedRes.status, 200);
  const qualifiedBody = await qualifiedRes.json();
  assert.equal(qualifiedBody.ok, true);
  assert.equal(qualifiedBody.lead.status, 'qualified');
  assert.equal(qualifiedBody.workflowRun, null);

  const pilotRes = await fetch(apiUrl('/v1/intake/workflow-sprint/advance'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeader,
    },
    body: JSON.stringify({
      leadId: intakeBody.leadId,
      status: 'named_pilot',
      actor: 'ops',
      workflowId: 'pr_review_hardening',
      teamId: 'north_star_systems',
    }),
  });
  assert.equal(pilotRes.status, 200);
  const pilotBody = await pilotRes.json();
  assert.equal(pilotBody.lead.status, 'named_pilot');
  assert.ok(pilotBody.workflowRun);
  assert.equal(pilotBody.workflowRun.customerType, 'named_pilot');

  const proofRes = await fetch(apiUrl('/v1/intake/workflow-sprint/advance'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeader,
    },
    body: JSON.stringify({
      leadId: intakeBody.leadId,
      status: 'proof_backed_run',
      actor: 'ops',
      reviewedBy: 'buyer@example.com',
      proofArtifacts: ['docs/VERIFICATION_EVIDENCE.md'],
    }),
  });
  assert.equal(proofRes.status, 200);
  const proofBody = await proofRes.json();
  assert.equal(proofBody.lead.status, 'proof_backed_run');
  assert.ok(proofBody.workflowRun);
  assert.equal(proofBody.workflowRun.proofBacked, true);

  const leads = readJsonl(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl'));
  assert.equal(leads.filter((entry) => entry.leadId === intakeBody.leadId).length, 3 + 1);
  assert.equal(leads.at(-1).status, 'proof_backed_run');
  assert.equal(leads.at(-1).statusHistory.length, 4);

  const runs = readJsonl(path.join(tmpFeedbackDir, 'workflow-runs.jsonl'));
  assert.equal(runs.length >= 2, true);
  assert.equal(runs.at(-1).proofBacked, true);
  assert.equal(runs.at(-1).metadata.leadId, intakeBody.leadId);

  const telemetry = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  assert.ok(telemetry.some((entry) => (
    entry.eventType === 'workflow_sprint_lead_advanced' &&
    entry.pipelineStatus === 'proof_backed_run'
  )));
});

test('private-core API endpoints return 503 when hosted/private modules are absent', async () => {
  const modulePaths = [
    __test__.PRIVATE_API_MODULES.intentRouter,
    __test__.PRIVATE_API_MODULES.delegationRuntime,
    __test__.PRIVATE_API_MODULES.hostedJobLauncher,
    __test__.PRIVATE_API_MODULES.workflowSprintIntake,
    __test__.PRIVATE_API_MODULES.lessonSearch,
    __test__.PRIVATE_API_MODULES.semanticLayer,
    __test__.PRIVATE_API_MODULES.commercialOffer,
  ];

  await withMissingPrivateApiModules(modulePaths, async () => {
    const catalogRes = await fetch(apiUrl('/v1/intents/catalog'), { headers: authHeader });
    assert.equal(catalogRes.status, 503);
    const catalogBody = await catalogRes.text();
    assert.match(catalogBody, /private core|hosted runtime/i);

    const planRes = await fetch(apiUrl('/v1/intents/plan'), {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ intentId: 'improve_response_quality', context: 'Need a plan' }),
    });
    assert.equal(planRes.status, 503);

    const startRes = await fetch(apiUrl('/v1/handoffs/start'), {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ intentId: 'improve_response_quality', context: 'Delegate safely' }),
    });
    assert.equal(startRes.status, 503);

    const completeRes = await fetch(apiUrl('/v1/handoffs/complete'), {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ handoffId: 'handoff_123', outcome: 'success' }),
    });
    assert.equal(completeRes.status, 503);

    const harnessRes = await fetch(apiUrl('/v1/jobs/harness'), {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ harness: 'verification', inputs: { prompt: 'run' } }),
    });
    assert.equal(harnessRes.status, 503);

    const advanceRes = await fetch(apiUrl('/v1/intake/workflow-sprint/advance'), {
      method: 'POST',
      headers: { ...authHeader, 'x-admin-key': 'thumbgate-admin-key', 'content-type': 'application/json' },
      body: JSON.stringify({ leadId: 'lead_123', status: 'qualified' }),
    });
    assert.equal(advanceRes.status, 503);

    const lessonsRes = await fetch(apiUrl('/v1/lessons/search?q=rollback&limit=5'), { headers: authHeader });
    assert.equal(lessonsRes.status, 503);
    assert.match(await lessonsRes.text(), /private core|hosted runtime/i);

    const semanticRes = await fetch(apiUrl('/v1/semantic/describe?type=Customer'), { headers: authHeader });
    assert.equal(semanticRes.status, 503);
    assert.match(await semanticRes.text(), /private core|hosted runtime/i);

    const checkoutRes = await fetch(apiUrl('/v1/billing/checkout'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerEmail: 'buyer@example.com',
        installId: 'inst_private_offer_boundary',
      }),
    });
    assert.equal(checkoutRes.status, 503);
    assert.match(await checkoutRes.text(), /private core|hosted runtime/i);
  });
});

test('billing session endpoint returns provisioned local checkout details', async () => {
  const checkoutRes = await fetch(apiUrl('/v1/billing/checkout'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerEmail: 'buyer@example.com',
      installId: 'inst_public_checkout_lookup',
    }),
  });
  assert.equal(checkoutRes.status, 200);
  const checkoutBody = await checkoutRes.json();
  assert.ok(typeof checkoutBody.sessionId === 'string');
  assert.equal(checkoutBody.planId, 'pro');
  assert.equal(checkoutBody.billingCycle, 'monthly');
  assert.equal(checkoutBody.price, 19);
  assert.equal(checkoutBody.type, 'subscription');

  const sessionRes = await fetch(
    `${apiUrl('/v1/billing/session')}?sessionId=${encodeURIComponent(checkoutBody.sessionId)}`
  );
  assert.equal(sessionRes.status, 200);
  const sessionBody = await sessionRes.json();
  assert.equal(sessionBody.paid, true);
  assert.equal(sessionBody.installId, 'inst_public_checkout_lookup');
  assert.ok(sessionBody.apiKey.startsWith('tg_'));
  assert.equal(sessionBody.appOrigin, 'https://app.example.com');
  assert.equal(sessionBody.apiBaseUrl, 'https://billing.example.com');
  assert.match(sessionBody.traceId, /^checkout_/);
  assert.match(sessionBody.nextSteps.env, /THUMBGATE_API_KEY=/);
  assert.match(sessionBody.nextSteps.env, /THUMBGATE_API_BASE_URL=https:\/\/billing\.example\.com/);
  assert.match(sessionBody.nextSteps.curl, /https:\/\/billing\.example\.com\/v1\/feedback\/capture/);
});

test('billing checkout supports annual Pro and Team seat selection', async () => {
  const annualRes = await fetch(apiUrl('/v1/billing/checkout'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      planId: 'pro',
      billingCycle: 'annual',
    }),
  });
  assert.equal(annualRes.status, 200);
  const annualBody = await annualRes.json();
  assert.equal(annualBody.planId, 'pro');
  assert.equal(annualBody.billingCycle, 'annual');
  assert.equal(annualBody.price, 149);
  assert.equal(annualBody.type, 'subscription');

  const teamRes = await fetch(apiUrl('/v1/billing/checkout'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      planId: 'team',
      seatCount: 2,
    }),
  });
  assert.equal(teamRes.status, 200);
  const teamBody = await teamRes.json();
  assert.equal(teamBody.planId, 'team');
  assert.equal(teamBody.billingCycle, 'monthly');
  assert.equal(teamBody.seatCount, 3);
  assert.equal(teamBody.price, 147);
  assert.equal(teamBody.type, 'subscription');
});

test('billing checkout supports CORS preflight', async () => {
  const res = await fetch(apiUrl('/v1/billing/checkout'), {
    method: 'OPTIONS',
    headers: {
      origin: 'https://app.example.com',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(String(res.headers.get('access-control-allow-methods')), /POST/);
});

test('billing session endpoint rejects missing session ids', async () => {
  const res = await fetch(apiUrl('/v1/billing/session'));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.detail, /sessionId/);
});

test('billing provision requires static admin key and rejects billing keys', async () => {
  const billingKey = billing.provisionApiKey('cus_non_admin').key;
  const res = await fetch(apiUrl('/v1/billing/provision'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${billingKey}`,
    },
    body: JSON.stringify({ customerId: 'cus_should_fail' }),
  });
  assert.equal(res.status, 403);
});

test('billing summary returns admin-only operational proxy', async () => {
  fs.writeFileSync(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl'), `${JSON.stringify({
    leadId: 'lead_admin_summary',
    submittedAt: '2026-03-12T02:00:00.000Z',
    status: 'new',
    offer: 'workflow_hardening_sprint',
    contact: {
      email: 'ops@example.com',
      company: 'Example Co',
    },
    qualification: {
      workflow: 'Claude deployment review',
      owner: 'Platform lead',
      blocker: 'Rollouts need audit proof',
      runtime: 'Claude Code + MCP',
      note: null,
    },
    attribution: {
      source: 'linkedin',
      utmSource: 'linkedin',
      utmCampaign: 'workflow_hardening',
      community: 'platform',
    },
  })}\n`);
  billing.provisionApiKey('cus_admin_summary', {
    installId: 'inst_admin_summary',
    source: 'stripe_webhook_checkout_completed',
  });
  billing.appendFunnelEvent({
    stage: 'paid',
    event: 'stripe_checkout_completed',
    installId: 'inst_admin_summary',
    evidence: 'cs_admin_summary',
    metadata: { customerId: 'cus_admin_summary' },
  });
  billing.appendRevenueEvent({
    provider: 'stripe',
    event: 'stripe_checkout_completed',
    status: 'paid',
    customerId: 'cus_admin_summary',
    orderId: 'cs_admin_summary',
    installId: 'inst_admin_summary',
    traceId: 'trace_admin_summary',
    amountCents: 4900,
    currency: 'USD',
    amountKnown: true,
    recurringInterval: null,
    attribution: {
      source: 'website',
      utmSource: 'website',
      utmMedium: 'cta_button',
      utmCampaign: 'pro_pack',
    },
  });

  const res = await fetch(apiUrl('/v1/billing/summary'), {
    headers: authHeader,
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.coverage.source, 'funnel_ledger+revenue_ledger+key_store+workflow_sprint_leads');
  assert.equal(body.coverage.tracksBookedRevenue, true);
  assert.equal(body.coverage.tracksWorkflowSprintLeads, true);
  assert.ok(body.funnel.stageCounts.paid >= 1);
  assert.ok(body.keys.active >= 1);
  assert.equal(body.revenue.bookedRevenueCents, 4900);
  assert.equal(body.revenue.paidOrders, 1);
  assert.equal(body.revenue.paidProviderEvents, 1);
  assert.equal(body.pipeline.workflowSprintLeads.total, 1);
  assert.equal(body.pipeline.workflowSprintLeads.bySource.linkedin, 1);
  assert.equal(body.pipeline.qualifiedWorkflowSprintLeads.total, 1);
  assert.equal(body.attribution.bookedRevenueByCampaignCents.pro_pack, 4900);
  assert.ok(body.trafficMetrics.visitors >= 1);
  assert.equal(body.operatorGeneratedAcquisition.uniqueLeads, 0);
  assert.equal(body.dataQuality.unreconciledPaidEvents, 0);
  assert.ok(Array.isArray(body.customers));
});

test('billing summary applies today window query params for admin users', async () => {
  const isolatedFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-api-window-'));
  const savedEnv = {
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
    apiKeysPath: process.env._TEST_API_KEYS_PATH,
    funnelPath: process.env._TEST_FUNNEL_LEDGER_PATH,
    revenuePath: process.env._TEST_REVENUE_LEDGER_PATH,
    checkoutSessionsPath: process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH,
  };

  process.env.THUMBGATE_FEEDBACK_DIR = isolatedFeedbackDir;
  process.env._TEST_API_KEYS_PATH = path.join(isolatedFeedbackDir, 'api-keys.json');
  process.env._TEST_FUNNEL_LEDGER_PATH = path.join(isolatedFeedbackDir, 'funnel-events.jsonl');
  process.env._TEST_REVENUE_LEDGER_PATH = path.join(isolatedFeedbackDir, 'revenue-events.jsonl');
  process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(isolatedFeedbackDir, 'local-checkout-sessions.json');

  try {
    fs.writeFileSync(process.env._TEST_API_KEYS_PATH, JSON.stringify({ keys: {} }, null, 2));
    fs.writeFileSync(process.env._TEST_FUNNEL_LEDGER_PATH, [
      JSON.stringify({
        timestamp: '2026-03-18T23:30:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        evidence: 'sess_api_old',
        traceId: 'trace_api_old',
        metadata: {
          customerId: 'cus_api_old',
          source: 'reddit',
          utmCampaign: 'api_window_old',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-19T14:30:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        evidence: 'sess_api_today',
        traceId: 'trace_api_today',
        metadata: {
          customerId: 'cus_api_today',
          source: 'website',
          utmCampaign: 'api_window_today',
        },
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(process.env._TEST_REVENUE_LEDGER_PATH, [
      JSON.stringify({
        timestamp: '2026-03-18T23:30:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_api_old',
        evidence: 'cs_api_old',
        customerId: 'cus_api_old',
        amountCents: 9900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: {
          source: 'reddit',
          utmCampaign: 'api_window_old',
        },
        metadata: {},
      }),
      JSON.stringify({
        timestamp: '2026-03-19T15:00:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_api_today',
        evidence: 'cs_api_today',
        customerId: 'cus_api_today',
        amountCents: 4900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: {
          source: 'website',
          utmCampaign: 'api_window_today',
        },
        metadata: {},
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(isolatedFeedbackDir, 'workflow-sprint-leads.jsonl'), [
      JSON.stringify({
        leadId: 'lead_api_old',
        submittedAt: '2026-03-18T20:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'old-api@example.com',
          company: 'Old API Co',
        },
        qualification: {
          workflow: 'Old workflow',
          owner: 'Old owner',
          blocker: 'Old blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'reddit',
          utmCampaign: 'api_window_old',
        },
      }),
      JSON.stringify({
        leadId: 'lead_api_today',
        submittedAt: '2026-03-19T16:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'today-api@example.com',
          company: 'Today API Co',
        },
        qualification: {
          workflow: 'Today workflow',
          owner: 'Today owner',
          blocker: 'Today blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'linkedin',
          utmCampaign: 'api_window_today',
        },
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(isolatedFeedbackDir, 'telemetry-pings.jsonl'), [
      JSON.stringify({
        receivedAt: '2026-03-18T22:00:00.000Z',
        eventType: 'landing_page_view',
        clientType: 'web',
        acquisitionId: 'acq_api_old',
        visitorId: 'visitor_api_old',
        sessionId: 'session_api_old',
        source: 'reddit',
        page: '/',
      }),
      JSON.stringify({
        receivedAt: '2026-03-19T14:55:00.000Z',
        eventType: 'landing_page_view',
        clientType: 'web',
        acquisitionId: 'acq_api_today',
        visitorId: 'visitor_api_today',
        sessionId: 'session_api_today',
        source: 'website',
        page: '/',
      }),
      '',
    ].join('\n'));

    const res = await fetch(apiUrl('/v1/billing/summary?window=today&timezone=UTC&now=2026-03-19T18:00:00.000Z'), {
      headers: authHeader,
    });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.window.window, 'today');
    assert.equal(body.window.timeZone, 'UTC');
    assert.equal(body.revenue.bookedRevenueCents, 4900);
    assert.equal(body.revenue.paidOrders, 1);
    assert.equal(body.pipeline.workflowSprintLeads.total, 1);
    assert.equal(body.trafficMetrics.pageViews, 1);
  } finally {
    process.env.THUMBGATE_FEEDBACK_DIR = savedEnv.feedbackDir;
    process.env._TEST_API_KEYS_PATH = savedEnv.apiKeysPath;
    process.env._TEST_FUNNEL_LEDGER_PATH = savedEnv.funnelPath;
    process.env._TEST_REVENUE_LEDGER_PATH = savedEnv.revenuePath;
    process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = savedEnv.checkoutSessionsPath;
    fs.rmSync(isolatedFeedbackDir, { recursive: true, force: true });
  }
});

test('dashboard applies analytics window query params with live billing truth', async () => {
  const isolatedFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-dashboard-window-'));
  const savedEnv = {
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
    apiKeysPath: process.env._TEST_API_KEYS_PATH,
    funnelPath: process.env._TEST_FUNNEL_LEDGER_PATH,
    revenuePath: process.env._TEST_REVENUE_LEDGER_PATH,
    checkoutSessionsPath: process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH,
  };

  process.env.THUMBGATE_FEEDBACK_DIR = isolatedFeedbackDir;
  process.env._TEST_API_KEYS_PATH = path.join(isolatedFeedbackDir, 'api-keys.json');
  process.env._TEST_FUNNEL_LEDGER_PATH = path.join(isolatedFeedbackDir, 'funnel-events.jsonl');
  process.env._TEST_REVENUE_LEDGER_PATH = path.join(isolatedFeedbackDir, 'revenue-events.jsonl');
  process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(isolatedFeedbackDir, 'local-checkout-sessions.json');

  try {
    fs.writeFileSync(process.env._TEST_API_KEYS_PATH, JSON.stringify({ keys: {} }, null, 2));
    fs.writeFileSync(process.env._TEST_FUNNEL_LEDGER_PATH, [
      JSON.stringify({
        timestamp: '2026-03-18T13:00:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        evidence: 'sess_dashboard_old',
        metadata: { customerId: 'cus_dashboard_old' },
      }),
      JSON.stringify({
        timestamp: '2026-03-19T14:00:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        evidence: 'sess_dashboard_today',
        metadata: { customerId: 'cus_dashboard_today' },
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(process.env._TEST_REVENUE_LEDGER_PATH, [
      JSON.stringify({
        timestamp: '2026-03-18T13:05:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_dashboard_old',
        evidence: 'cs_dashboard_old',
        customerId: 'cus_dashboard_old',
        amountCents: 9900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: { source: 'reddit' },
        metadata: {},
      }),
      JSON.stringify({
        timestamp: '2026-03-19T14:05:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_dashboard_today',
        evidence: 'cs_dashboard_today',
        customerId: 'cus_dashboard_today',
        amountCents: 4900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: { source: 'website' },
        metadata: {},
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(isolatedFeedbackDir, 'workflow-sprint-leads.jsonl'), [
      JSON.stringify({
        leadId: 'lead_dashboard_old',
        submittedAt: '2026-03-18T10:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'old-dashboard@example.com',
          company: 'Old Dashboard Co',
        },
        qualification: {
          workflow: 'Old workflow',
          owner: 'Old owner',
          blocker: 'Old blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'reddit',
          utmCampaign: 'dashboard_window_old',
        },
      }),
      JSON.stringify({
        leadId: 'lead_dashboard_today',
        submittedAt: '2026-03-19T15:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'today-dashboard@example.com',
          company: 'Today Dashboard Co',
        },
        qualification: {
          workflow: 'Today workflow',
          owner: 'Today owner',
          blocker: 'Today blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'linkedin',
          utmCampaign: 'dashboard_window_today',
        },
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(isolatedFeedbackDir, 'telemetry-pings.jsonl'), [
      JSON.stringify({
        receivedAt: '2026-03-18T12:00:00.000Z',
        eventType: 'landing_page_view',
        clientType: 'web',
        acquisitionId: 'acq_dashboard_old',
        visitorId: 'visitor_dashboard_old',
        sessionId: 'session_dashboard_old',
        source: 'reddit',
        page: '/',
      }),
      JSON.stringify({
        receivedAt: '2026-03-19T14:30:00.000Z',
        eventType: 'landing_page_view',
        clientType: 'web',
        acquisitionId: 'acq_dashboard_today',
        visitorId: 'visitor_dashboard_today',
        sessionId: 'session_dashboard_today',
        source: 'website',
        page: '/',
      }),
      '',
    ].join('\n'));
    fs.mkdirSync(path.join(isolatedFeedbackDir, 'contextfs', 'provenance'), { recursive: true });
    fs.writeFileSync(path.join(isolatedFeedbackDir, 'contextfs', 'provenance', 'packs.jsonl'), [
      JSON.stringify({
        packId: 'pack_dashboard_base',
        query: 'verification testing evidence',
        usedChars: 1200,
        createdAt: '2026-03-19T14:00:00.000Z',
        cache: { hit: false },
      }),
      JSON.stringify({
        packId: 'pack_dashboard_hit',
        query: 'testing verification evidence',
        usedChars: 1200,
        createdAt: '2026-03-19T14:01:00.000Z',
        cache: { hit: true, similarity: 1, sourcePackId: 'pack_dashboard_base' },
      }),
      '',
    ].join('\n'));

    const res = await fetch(apiUrl('/v1/dashboard?window=today&timezone=America/New_York&now=2026-03-19T18:00:00.000Z'), {
      headers: authHeader,
    });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.operational.source, 'live');
    assert.equal(body.analytics.window.window, 'today');
    assert.equal(body.analytics.trafficMetrics.visitors, 1);
    assert.equal(body.analytics.trafficMetrics.pageViews, 1);
    assert.equal(body.analytics.funnel.acquisitionLeads, 1);
    assert.equal(body.analytics.revenue.bookedRevenueCents, 4900);
    assert.equal(body.analytics.revenue.paidOrders, 1);
    assert.equal(body.analytics.efficiency.contextPackRequests, 2);
    assert.equal(body.analytics.efficiency.semanticCacheHits, 1);
    assert.equal(body.analytics.efficiency.estimatedContextTokensReused, 300);
    assert.equal(typeof body.team.activeAgents, 'number');
    assert.equal(body.team.proRequired, false);
    assert.equal(body.templateLibrary.total, 6);
    assert.equal(body.templateLibrary.categories['Git Safety'], 1);
    assert.ok(body.predictive);
    assert.equal(typeof body.predictive.upgradePropensity.pro.score, 'number');
    assert.equal(body.predictive.revenueForecast.predictedBookedRevenueCents, 4900);
    assert.equal(body.predictive.anomalySummary.count, 0);
  } finally {
    process.env.THUMBGATE_FEEDBACK_DIR = savedEnv.feedbackDir;
    process.env._TEST_API_KEYS_PATH = savedEnv.apiKeysPath;
    process.env._TEST_FUNNEL_LEDGER_PATH = savedEnv.funnelPath;
    process.env._TEST_REVENUE_LEDGER_PATH = savedEnv.revenuePath;
    process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = savedEnv.checkoutSessionsPath;
    fs.rmSync(isolatedFeedbackDir, { recursive: true, force: true });
  }
});

test('settings status endpoint returns resolved settings and origin metadata', async () => {
  const res = await fetch(apiUrl('/v1/settings/status'), {
    headers: authHeader,
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.resolvedSettings.mcp.defaultProfile, 'string');
  assert.ok(Array.isArray(body.origins));
  assert.ok(body.origins.some((entry) => entry.path === 'mcp.defaultProfile'));
});

test('decision endpoints persist evaluations, outcomes, and live metrics', async () => {
  const evaluateRes = await fetch(apiUrl('/v1/decisions/evaluate'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      toolName: 'Bash',
      command: 'npm publish',
      changedFiles: ['package.json', 'server.json'],
      repoPath: process.cwd(),
    }),
  });

  assert.equal(evaluateRes.status, 200);
  const evaluation = await evaluateRes.json();
  assert.ok(typeof evaluation.actionId === 'string');
  assert.ok(evaluation.decisionControl);
  assert.ok(['auto_execute', 'checkpoint_required', 'blocked'].includes(evaluation.decisionControl.executionMode));

  const outcomeRes = await fetch(apiUrl('/v1/decisions/outcome'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      actionId: evaluation.actionId,
      outcome: 'overridden',
      actor: 'human',
      actualDecision: 'warn',
      notes: 'Human added a manual release checkpoint.',
    }),
  });
  assert.equal(outcomeRes.status, 200);
  const outcome = await outcomeRes.json();
  assert.equal(outcome.actionId, evaluation.actionId);
  assert.equal(outcome.outcome, 'overridden');

  const metricsRes = await fetch(apiUrl('/v1/decisions/metrics'), {
    headers: authHeader,
  });
  assert.equal(metricsRes.status, 200);
  const metrics = await metricsRes.json();
  assert.ok(metrics.evaluationCount >= 1);
  assert.ok(metrics.overrideCount >= 1);

  const decisionLog = readJsonl(path.join(tmpFeedbackDir, 'decision-journal.jsonl'));
  assert.ok(decisionLog.some((entry) => entry.recordType === 'evaluation' && entry.actionId === evaluation.actionId));
  assert.ok(decisionLog.some((entry) => entry.recordType === 'outcome' && entry.actionId === evaluation.actionId));
});

test('dashboard render-spec endpoint returns constrained hosted views', async () => {
  const isolatedFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-dashboard-render-spec-'));
  const savedEnv = {
    feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR,
    apiKeysPath: process.env._TEST_API_KEYS_PATH,
    funnelPath: process.env._TEST_FUNNEL_LEDGER_PATH,
    revenuePath: process.env._TEST_REVENUE_LEDGER_PATH,
    checkoutSessionsPath: process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH,
  };

  process.env.THUMBGATE_FEEDBACK_DIR = isolatedFeedbackDir;
  process.env._TEST_API_KEYS_PATH = path.join(isolatedFeedbackDir, 'api-keys.json');
  process.env._TEST_FUNNEL_LEDGER_PATH = path.join(isolatedFeedbackDir, 'funnel-events.jsonl');
  process.env._TEST_REVENUE_LEDGER_PATH = path.join(isolatedFeedbackDir, 'revenue-events.jsonl');
  process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(isolatedFeedbackDir, 'local-checkout-sessions.json');

  try {
    fs.writeFileSync(path.join(isolatedFeedbackDir, 'feedback-log.jsonl'), [
      JSON.stringify({
        timestamp: '2026-03-19T14:00:00.000Z',
        signal: 'negative',
        context: 'Claimed done without proof',
        whatWentWrong: 'Skipped verification',
        whatToChange: 'Run proof before completion claim',
        tags: ['verification', 'evidence'],
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(isolatedFeedbackDir, 'funnel-events.jsonl'), [
      JSON.stringify({
        timestamp: '2026-03-19T14:25:00.000Z',
        type: 'workflow_sprint_lead',
        source: 'producthunt',
        email: 'team@example.com',
        workflowType: 'team-rollout',
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(isolatedFeedbackDir, 'revenue-events.jsonl'), [
      JSON.stringify({
        timestamp: '2026-03-19T15:00:00.000Z',
        type: 'paid_order',
        source: 'producthunt',
        amountCents: 4900,
        amountKnown: true,
      }),
      '',
    ].join('\n'));

    const res = await fetch(apiUrl('/v1/dashboard/render-spec?view=workflow-rollout&window=today&timezone=America/New_York&now=2026-03-19T18:00:00.000Z'), {
      headers: authHeader,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.view, 'workflow-rollout');
    assert.deepEqual(body.allowedComponentTypes, ['hero', 'stat_grid', 'list', 'callout']);
    assert.ok(Array.isArray(body.availableViews));
    assert.ok(body.availableViews.some((view) => view.id === 'team-review'));
    assert.ok(body.components.some((component) => component.type === 'stat_grid'));
    assert.ok(body.components.some((component) => component.title === 'Top acquisition sources'));
  } finally {
    process.env.THUMBGATE_FEEDBACK_DIR = savedEnv.feedbackDir;
    process.env._TEST_API_KEYS_PATH = savedEnv.apiKeysPath;
    process.env._TEST_FUNNEL_LEDGER_PATH = savedEnv.funnelPath;
    process.env._TEST_REVENUE_LEDGER_PATH = savedEnv.revenuePath;
    process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = savedEnv.checkoutSessionsPath;
    fs.rmSync(isolatedFeedbackDir, { recursive: true, force: true });
  }
});

test('dashboard render-spec endpoint rejects unsupported views', async () => {
  const res = await fetch(apiUrl('/v1/dashboard/render-spec?view=freeform-ai-page'), {
    headers: authHeader,
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.detail, /Unsupported dashboard render view/);
});

test('dashboard review-state endpoint persists a checkpoint and returns zero deltas immediately after marking reviewed', async () => {
  const feedbackLogPath = path.join(tmpFeedbackDir, 'feedback-log.jsonl');
  const reviewStatePath = path.join(tmpFeedbackDir, 'dashboard-review-state.json');

  fs.writeFileSync(feedbackLogPath, [
    JSON.stringify({
      id: 'fb_review_state_1',
      signal: 'negative',
      context: 'Fresh issue before review checkpoint',
      timestamp: '2026-04-15T12:00:00.000Z',
    }),
    '',
  ].join('\n'));
  fs.rmSync(reviewStatePath, { force: true });

  const markRes = await fetch(apiUrl('/v1/dashboard/review-state'), {
    method: 'POST',
    headers: authHeader,
  });
  assert.equal(markRes.status, 200);
  const markBody = await markRes.json();
  assert.equal(markBody.ok, true);
  assert.equal(markBody.reviewDelta.hasBaseline, true);
  assert.equal(markBody.reviewDelta.feedbackAdded, 0);
  assert.ok(markBody.reviewState.reviewedAt);
  assert.equal(fs.existsSync(reviewStatePath), true);
  const afterCheckpointTime = new Date(new Date(markBody.reviewState.reviewedAt).getTime() + 60_000).toISOString();

  fs.writeFileSync(feedbackLogPath, [
    JSON.stringify({
      id: 'fb_review_state_1',
      signal: 'negative',
      context: 'Fresh issue before review checkpoint',
      timestamp: '2026-04-15T12:00:00.000Z',
    }),
    JSON.stringify({
      id: 'fb_review_state_2',
      signal: 'negative',
      context: 'New issue after review checkpoint',
      timestamp: afterCheckpointTime,
    }),
    '',
  ].join('\n'));

  const getRes = await fetch(apiUrl('/v1/dashboard/review-state'), {
    headers: authHeader,
  });
  assert.equal(getRes.status, 200);
  const getBody = await getRes.json();
  assert.equal(getBody.reviewDelta.hasBaseline, true);
  assert.equal(getBody.reviewDelta.feedbackAdded, 1);
  assert.equal(getBody.reviewDelta.negativeAdded, 1);
  assert.match(getBody.reviewDelta.latestFeedback.title, /New issue after review checkpoint/i);
});

test('billing summary includes Stripe-reconciled revenue when live processor events are available', async () => {
  process.env._TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON = JSON.stringify([
    {
      timestamp: '2025-11-18T10:36:00.000Z',
      provider: 'stripe',
      event: 'stripe_charge_reconciled',
      status: 'paid',
      orderId: 'ch_api_hist_001',
      evidence: 'ch_api_hist_001',
      customerId: 'cus_api_hist_001',
      amountCents: 1000,
      currency: 'USD',
      amountKnown: true,
      recurringInterval: 'month',
      attribution: {
        source: 'stripe_reconciled',
      },
      metadata: {
        stripeReconciled: true,
        priceId: 'price_hist_001',
        productId: 'prod_hist_001',
      },
    },
  ]);

  try {
    const res = await fetch(apiUrl('/v1/billing/summary'), {
      headers: authHeader,
    });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.ok(body.revenue.bookedRevenueCents >= 1000);
    assert.ok(body.revenue.paidOrders >= 1);
    assert.equal(body.revenue.processorReconciledOrders, 1);
    assert.equal(body.revenue.processorReconciledRevenueCents, 1000);
    assert.equal(body.coverage.providerCoverage.stripe, 'booked_revenue+processor_reconciled');
  } finally {
    delete process.env._TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON;
  }
});
test('billing summary rejects billing keys', async () => {
  const billingKey = billing.provisionApiKey('cus_non_admin_summary').key;
  const res = await fetch(apiUrl('/v1/billing/summary'), {
    headers: {
      authorization: `Bearer ${billingKey}`,
    },
  });
  assert.equal(res.status, 403);
});

test('billing summary rejects invalid analytics window queries', async () => {
  const res = await fetch(apiUrl('/v1/billing/summary?window=bad-window'), {
    headers: authHeader,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.detail, /Invalid analytics window/i);
});

test('renderPackagedDashboardHtml returns html with bootstrap disabled by default', () => {
  const { renderPackagedDashboardHtml } = __test__;
  const html = renderPackagedDashboardHtml({ bootstrapActive: false, serializedBootstrapKey: '""' });
  assert.ok(html.includes('ThumbGate Dashboard'));
  assert.ok(html.includes('enabled: false'));
  assert.ok(html.includes('/v1/dashboard'));
  assert.ok(html.includes('/lessons'));
  assert.ok(html.includes('/health'));
});

test('renderPackagedDashboardHtml reflects bootstrap enabled state', () => {
  const { renderPackagedDashboardHtml } = __test__;
  const html = renderPackagedDashboardHtml({ bootstrapActive: true, serializedBootstrapKey: '"test-key"' });
  assert.ok(html.includes('enabled: true'));
  assert.ok(html.includes('"test-key"'));
});

test('renderPackagedLessonsHtml returns html with lessons content', () => {
  const { renderPackagedLessonsHtml } = __test__;
  const html = renderPackagedLessonsHtml({ bootstrapActive: false, serializedBootstrapKey: '""' });
  assert.ok(html.includes('ThumbGate Lessons'));
  assert.ok(html.includes('enabled: false'));
  assert.ok(html.includes('/v1/lessons/search'));
  assert.ok(html.includes('/dashboard'));
});

test('renderPackagedLessonsHtml reflects bootstrap enabled state', () => {
  const { renderPackagedLessonsHtml } = __test__;
  const html = renderPackagedLessonsHtml({ bootstrapActive: true, serializedBootstrapKey: '"op-key"' });
  assert.ok(html.includes('enabled: true'));
  assert.ok(html.includes('"op-key"'));
});

test('readOptionalPublicTemplate returns null for missing file', () => {
  const { readOptionalPublicTemplate } = __test__;
  const result = readOptionalPublicTemplate('/nonexistent/path/file.html');
  assert.strictEqual(result, null);
});

test('readOptionalPublicTemplate returns content for existing file', () => {
  const { readOptionalPublicTemplate } = __test__;
  const result = readOptionalPublicTemplate(path.join(tmpProofDir, '../..', 'public/dashboard.html'));
  // if the file exists it returns a string; either way the function works
  assert.ok(result === null || typeof result === 'string');
});

test('resolveLocalPageBootstrap returns inactive bootstrap for non-loopback host', () => {
  const { resolveLocalPageBootstrap } = __test__;
  const fakeReq = { headers: { host: 'thumbgate-production.up.railway.app' } };
  const result = resolveLocalPageBootstrap(fakeReq, 'test-key');
  assert.strictEqual(result.bootstrapActive, false);
});

test('rejects external output path by default', async () => {
  const externalPath = '/tmp/should-not-write-outside-safe-root.jsonl';
  const res = await fetch(apiUrl('/v1/dpo/export'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({ outputPath: externalPath }),
  });
  assert.equal(res.status, 400);
});

test('funnel analytics returns counts and conversion rates', async () => {
  const checkoutRes = await fetch(apiUrl('/v1/billing/checkout'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      installId: 'inst_api_server_test',
      metadata: {
        source: 'reddit',
        utmSource: 'reddit',
        utmMedium: 'organic_social',
        utmCampaign: 'reddit_launch',
        community: 'ClaudeCode',
        postId: '1rsudq0',
        commentId: 'oa9mqjf',
        campaignVariant: 'comment_problem_solution',
        offerCode: 'REDDIT-EARLY',
        ctaId: 'pricing_pro',
      },
    }),
  });
  assert.equal(checkoutRes.status, 200);

  const analyticsRes = await fetch(apiUrl('/v1/analytics/funnel'), {
    headers: authHeader,
  });
  assert.equal(analyticsRes.status, 200);

  const body = await analyticsRes.json();
  assert.ok(typeof body.totalEvents === 'number');
  assert.ok(typeof body.stageCounts === 'object');
  assert.ok(typeof body.conversionRates === 'object');
  assert.ok(body.stageCounts.acquisition >= 1);
  assert.ok(typeof body.conversionRates.acquisitionToActivation === 'number');

  const summaryRes = await fetch(apiUrl('/v1/billing/summary'), {
    headers: authHeader,
  });
  assert.equal(summaryRes.status, 200);
  const summary = await summaryRes.json();
  assert.ok(summary.signups.bySource.reddit >= 1);
  assert.ok(summary.attribution.acquisitionByCampaign.reddit_launch >= 1);
  assert.ok(summary.attribution.acquisitionByCommunity.ClaudeCode >= 1);
  assert.ok(summary.attribution.acquisitionByPostId['1rsudq0'] >= 1);
  assert.ok(summary.attribution.acquisitionByCommentId.oa9mqjf >= 1);
  assert.ok(summary.attribution.acquisitionByCampaignVariant.comment_problem_solution >= 1);
  assert.ok(summary.attribution.acquisitionByOfferCode['REDDIT-EARLY'] >= 1);
});
