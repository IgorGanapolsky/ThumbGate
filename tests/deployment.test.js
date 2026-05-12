/**
 * Deployment tests — Phase 13
 * Verifies: /health endpoint, unauthenticated access, env var wiring
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-deploy-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_BUILD_METADATA_PATH = path.join(tmpFeedbackDir, 'build-metadata.json');
fs.writeFileSync(
  process.env.THUMBGATE_BUILD_METADATA_PATH,
  JSON.stringify({ buildSha: 'deploy-test-build-sha', generatedAt: '2026-03-20T00:00:00.000Z' }, null, 2)
);
process.env.THUMBGATE_BUILD_SHA = 'deploy-test-env-build-sha';
process.env.THUMBGATE_BUILD_GENERATED_AT = '2026-03-21T00:00:00.000Z';
// Use insecure mode so auth doesn't interfere with /health unauthenticated check
process.env.THUMBGATE_ALLOW_INSECURE = 'true';

const { createApiServer, startServer } = require('../src/api/server');
const pkg = require('../package.json');
const PROJECT_ROOT = path.join(__dirname, '..');

let handle;
let deployOrigin = '';

function deployUrl(pathname = '/') {
  return new URL(pathname, deployOrigin).toString();
}

test.before(async () => {
  handle = await startServer({ port: 0 });
  deployOrigin = `http://localhost:${handle.port}`;
});

test.after(async () => {
  await new Promise((resolve) => handle.server.close(resolve));
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  delete process.env.THUMBGATE_BUILD_METADATA_PATH;
  delete process.env.THUMBGATE_BUILD_SHA;
  delete process.env.THUMBGATE_BUILD_GENERATED_AT;
});

test('GET /health returns 200 without authentication', async () => {
  // No Authorization header — health must be publicly accessible for Railway probes
  const res = await fetch(deployUrl('/health'));
  assert.equal(res.status, 200);
});

test('GET /health returns status ok', async () => {
  const res = await fetch(deployUrl('/health'));
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.ok(body.deployment);
  assert.equal(typeof body.deployment.appOrigin, 'string');
  assert.equal(typeof body.deployment.billingApiBaseUrl, 'string');
});

test('GET /health returns package version', async () => {
  const res = await fetch(deployUrl('/health'));
  const body = await res.json();
  assert.equal(body.version, pkg.version);
});

test('GET /health returns stamped build metadata', async () => {
  const res = await fetch(deployUrl('/health'));
  const body = await res.json();
  assert.equal(body.buildSha, 'deploy-test-env-build-sha');
});

test('GET /health returns numeric uptime', async () => {
  const res = await fetch(deployUrl('/health'));
  const body = await res.json();
  assert.equal(typeof body.uptime, 'number');
  assert.ok(body.uptime >= 0, 'uptime must be non-negative');
});

test('GET /health content-type is application/json', async () => {
  const res = await fetch(deployUrl('/health'));
  const ct = res.headers.get('content-type') || '';
  assert.ok(ct.includes('application/json'), `expected application/json, got: ${ct}`);
});

test('POST /v1/telemetry/ping returns 204 without auth', async () => {
  const payload = JSON.stringify({ installId: 'test-install-123', version: '0.7.0', platform: 'darwin', nodeVersion: 'v20.0.0' });
  const res = await fetch(deployUrl('/v1/telemetry/ping'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  assert.strictEqual(res.status, 204, 'Telemetry ping should return 204');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');

  const telemetryPath = path.join(tmpFeedbackDir, 'telemetry-pings.jsonl');
  assert.equal(fs.existsSync(telemetryPath), true);
  const lines = fs.readFileSync(telemetryPath, 'utf8').trim().split('\n').filter(Boolean);
  const entry = JSON.parse(lines[lines.length - 1]);
  assert.equal(entry.clientType, 'cli');
  assert.equal(entry.eventType, 'cli_init');
  assert.equal(entry.installId, 'test-install-123');
});

test('OPTIONS /v1/telemetry/ping returns CORS headers without auth', async () => {
  const res = await fetch(deployUrl('/v1/telemetry/ping'), {
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

test('web telemetry persists acquisition and attribution fields', async () => {
  const res = await fetch(deployUrl('/v1/telemetry/ping'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: 'https://search.example/thumbgate',
    },
    body: JSON.stringify({
      eventType: 'checkout_start',
      clientType: 'web',
      acquisitionId: 'acq_deploy_1',
      visitorId: 'visitor_deploy_1',
      sessionId: 'session_deploy_1',
      source: 'website',
      utmSource: 'website',
      utmMedium: 'cta_button',
      utmCampaign: 'deploy_launch',
      ctaId: 'pricing_pro',
      page: '/',
    }),
  });
  assert.equal(res.status, 204);

  const telemetryPath = path.join(tmpFeedbackDir, 'telemetry-pings.jsonl');
  const lines = fs.readFileSync(telemetryPath, 'utf8').trim().split('\n').filter(Boolean);
  const entry = JSON.parse(lines[lines.length - 1]);
  assert.equal(entry.acquisitionId, 'acq_deploy_1');
  assert.equal(entry.referrerHost, 'search.example');
  assert.equal(entry.utmCampaign, 'deploy_launch');
  assert.equal(entry.ctaId, 'pricing_pro');
});

test('PORT env var controls listen port (server started on custom port)', async () => {
  // Already running on the assigned port — this test confirms it responded there.
  const res = await fetch(deployUrl('/health'));
  assert.equal(res.status, 200);
});

test('THUMBGATE_ALLOW_INSECURE=true bypasses API key requirement', async () => {
  // No Authorization header; if API key bypass is broken, this returns 401
  const res = await fetch(deployUrl('/v1/feedback/stats'));
  assert.equal(res.status, 200);
});

test('createApiServer fails fast when THUMBGATE_API_KEY is missing in secure mode', () => {
  const previousApiKey = process.env.THUMBGATE_API_KEY;
  const previousAllowInsecure = process.env.THUMBGATE_ALLOW_INSECURE;

  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_ALLOW_INSECURE;

  try {
    assert.throws(() => createApiServer(), /THUMBGATE_API_KEY is required unless THUMBGATE_ALLOW_INSECURE=true/);
  } finally {
    if (previousApiKey === undefined) delete process.env.THUMBGATE_API_KEY;
    else process.env.THUMBGATE_API_KEY = previousApiKey;

    if (previousAllowInsecure === undefined) delete process.env.THUMBGATE_ALLOW_INSECURE;
    else process.env.THUMBGATE_ALLOW_INSECURE = previousAllowInsecure;
  }
});

test('feedback endpoint returns valid JSON under insecure mode', async () => {
  const res = await fetch(deployUrl('/v1/feedback/stats'));
  const body = await res.json();
  assert.ok(typeof body === 'object' && body !== null, 'response must be a JSON object');
});

test('CI workflow stays test-only and leaves Railway deploys to the dedicated workflow', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.doesNotMatch(workflow, /Check Railway deployment configuration/);
  assert.doesNotMatch(workflow, /railway up/);
  assert.doesNotMatch(workflow, /RAILWAY_PROJECT_ID/);
  assert.doesNotMatch(workflow, /https:\/\/thumbgate-710216278770\.us-central1\.run\.app\/health/);
});

test('CI workflow writes and uploads a prompt evaluation artifact', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /name:\s*Write prompt evaluation report/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /node scripts\/prompt-eval\.js --min-score=0 --synthetic --synthetic-variants=1 --suite-output proof\/prompt-eval-suite\.generated\.json --output proof\/prompt-eval-report\.json --json > \/dev\/null/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, /proof\/prompt-eval-report\.json/);
  assert.match(workflow, /proof\/prompt-eval-suite\.generated\.json/);
  assert.match(workflow, /Synthetic cases: /);
});

test('runtime Docker image installs git for operational integrity checks', () => {
  const dockerfile = fs.readFileSync(path.join(PROJECT_ROOT, 'Dockerfile'), 'utf8');

  assert.match(dockerfile, /FROM node:20-alpine AS runtime/);
  assert.match(dockerfile, /RUN apk add --no-cache git/);
});

test('Deploy to Railway workflow is the single authoritative Railway deploy lane', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'deploy-railway.yml'), 'utf8');

  assert.match(workflow, /Check Railway deployment configuration/);
  assert.match(workflow, /missing required deploy config/);
  assert.match(workflow, /missing required runtime secrets/);
  assert.match(workflow, /THUMBGATE_API_KEY/);
  assert.match(workflow, /Enforce deploy policy/);
  assert.match(workflow, /node scripts\/deploy-policy\.js --profiles=billing,deploy/);
  assert.match(workflow, /steps\.railway-config\.outputs\.enabled == 'true'/);
  assert.match(workflow, /RAILWAY_PROJECT_ID/);
  assert.match(workflow, /RAILWAY_ENVIRONMENT_ID/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_URL/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_MAX_ATTEMPTS/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_SLEEP_SECONDS/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_CONNECT_TIMEOUT_SECONDS/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_MAX_TIME_SECONDS/);
  assert.match(workflow, /RAILWAY_LOG_LINES/);
  assert.match(workflow, /RAILWAY_HTTP_LOG_LINES/);
  assert.match(workflow, /DEPLOYABLE_PATTERN=.*\\\.github\/workflows\/deploy-railway\\\.yml/);
  assert.match(workflow, /secrets\.THUMBGATE_API_KEY/);
  assert.match(workflow, /RESEND_API_KEY:\s*\$\{\{\s*secrets\.RESEND_API_KEY\s*\}\}/);
  assert.match(workflow, /THUMBGATE_TRIAL_EMAIL_FROM:\s*\$\{\{\s*secrets\.THUMBGATE_TRIAL_EMAIL_FROM\s*\|\|\s*vars\.THUMBGATE_TRIAL_EMAIL_FROM\s*\}\}/);
  assert.match(workflow, /vars\.THUMBGATE_PUBLIC_APP_ORIGIN \|\| 'https:\/\/thumbgate-production\.up\.railway\.app'/);
  assert.match(workflow, /vars\.THUMBGATE_BILLING_API_BASE_URL \|\| vars\.THUMBGATE_PUBLIC_APP_ORIGIN \|\| 'https:\/\/thumbgate-production\.up\.railway\.app'/);
  assert.match(workflow, /THUMBGATE_PUBLIC_APP_ORIGIN/);
  assert.match(workflow, /THUMBGATE_BILLING_API_BASE_URL/);
  assert.match(workflow, /THUMBGATE_CHECKOUT_FALLBACK_URL:\s*\$\{\{\s*vars\.THUMBGATE_CHECKOUT_FALLBACK_URL\s*\}\}/);
  assert.match(workflow, /railway variables set --skip-deploys THUMBGATE_API_KEY=/);
  assert.match(workflow, /railway variables set --skip-deploys THUMBGATE_BUILD_SHA=/);
  assert.match(workflow, /railway variables set --skip-deploys STRIPE_WEBHOOK_SECRET=/);
  assert.match(workflow, /railway variables set --skip-deploys RESEND_API_KEY=/);
  assert.match(workflow, /railway variables set --skip-deploys THUMBGATE_TRIAL_EMAIL_FROM=/);
  assert.match(workflow, /railway variables set --skip-deploys THUMBGATE_CHECKOUT_FALLBACK_URL=/);
  assert.match(workflow, /railway up/);
  assert.match(workflow, /--ci/);
  assert.match(workflow, /--detach/);
  assert.match(workflow, /--project "\$RAILWAY_PROJECT_ID"/);
  assert.match(workflow, /--environment "\$RAILWAY_ENVIRONMENT_ID"/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_MAX_ATTEMPTS:\s*\$\{\{\s*vars\.RAILWAY_HEALTHCHECK_MAX_ATTEMPTS\s*\|\|\s*'120'\s*\}\}/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_CONNECT_TIMEOUT_SECONDS:\s*\$\{\{\s*vars\.RAILWAY_HEALTHCHECK_CONNECT_TIMEOUT_SECONDS\s*\|\|\s*'5'\s*\}\}/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_MAX_TIME_SECONDS:\s*\$\{\{\s*vars\.RAILWAY_HEALTHCHECK_MAX_TIME_SECONDS\s*\|\|\s*'20'\s*\}\}/);
  assert.doesNotMatch(workflow, /secrets\.THUMBGATE_API_KEY\s*\|\|/);
  assert.doesNotMatch(workflow, /vars\.THUMBGATE_PUBLIC_APP_ORIGIN\s*\|\|\s*vars\./);
  assert.doesNotMatch(workflow, /https:\/\/thumbgate-710216278770\.us-central1\.run\.app\/health/);
});

test('Deploy to Railway workflow waits long enough to verify the promoted build SHA', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'deploy-railway.yml'), 'utf8');

  assert.match(workflow, /Stamp immutable build metadata/);
  assert.match(workflow, /node scripts\/build-metadata\.js --sha "\$GITHUB_SHA" --output config\/build-metadata\.json/);
  assert.match(workflow, /railway up --ci --detach --project "\$RAILWAY_PROJECT_ID" --environment "\$RAILWAY_ENVIRONMENT_ID"/);
  assert.match(workflow, /--detach/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_MAX_ATTEMPTS:\s*\$\{\{\s*vars\.RAILWAY_HEALTHCHECK_MAX_ATTEMPTS\s*\|\|\s*'120'\s*\}\}/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_SLEEP_SECONDS:\s*\$\{\{\s*vars\.RAILWAY_HEALTHCHECK_SLEEP_SECONDS\s*\|\|\s*'10'\s*\}\}/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_CONNECT_TIMEOUT_SECONDS:\s*\$\{\{\s*vars\.RAILWAY_HEALTHCHECK_CONNECT_TIMEOUT_SECONDS\s*\|\|\s*'5'\s*\}\}/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_MAX_TIME_SECONDS:\s*\$\{\{\s*vars\.RAILWAY_HEALTHCHECK_MAX_TIME_SECONDS\s*\|\|\s*'20'\s*\}\}/);
  assert.match(workflow, /MAX_ATTEMPTS="\$\{RAILWAY_HEALTHCHECK_MAX_ATTEMPTS:-120\}"/);
  assert.match(workflow, /SLEEP_SECONDS="\$\{RAILWAY_HEALTHCHECK_SLEEP_SECONDS:-10\}"/);
  assert.match(workflow, /CONNECT_TIMEOUT_SECONDS="\$\{RAILWAY_HEALTHCHECK_CONNECT_TIMEOUT_SECONDS:-5\}"/);
  assert.match(workflow, /MAX_TIME_SECONDS="\$\{RAILWAY_HEALTHCHECK_MAX_TIME_SECONDS:-20\}"/);
  assert.match(workflow, /Per-attempt probe budget: connect timeout \$\{CONNECT_TIMEOUT_SECONDS\}s, max time \$\{MAX_TIME_SECONDS\}s\./);
  assert.match(workflow, /curl --connect-timeout "\$CONNECT_TIMEOUT_SECONDS" --max-time "\$MAX_TIME_SECONDS" -sS -o "\$RESPONSE_FILE" -w "%\{http_code\}" "\$RAILWAY_HEALTHCHECK_URL"/);
  assert.match(workflow, /Observed build SHA/);
  assert.match(workflow, /Expected build SHA/);
});

test('Deploy to Railway workflow captures Railway diagnostics when health verification fails', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'deploy-railway.yml'), 'utf8');

  assert.match(workflow, /name: Capture Railway diagnostics/);
  assert.match(workflow, /if: failure\(\) && steps\.railway-config\.outputs\.enabled == 'true'/);
  assert.match(workflow, /bash scripts\/capture-railway-diagnostics\.sh railway-diagnostics/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /railway-diagnostics-\$\{\{\s*github\.run_id\s*\}\}/);
});

test('Railway diagnostics workflow can inspect or bounce the service with the live Railway config', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'railway-diagnostics.yml'), 'utf8');

  assert.match(workflow, /name:\s*Railway Diagnostics/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /action:/);
  assert.match(workflow, /inspect/);
  assert.match(workflow, /restart/);
  assert.match(workflow, /redeploy/);
  assert.match(workflow, /RAILWAY_PROJECT_ID/);
  assert.match(workflow, /RAILWAY_ENVIRONMENT_ID/);
  assert.match(workflow, /RAILWAY_SERVICE/);
  assert.match(workflow, /railway restart --service "\$RAILWAY_SERVICE" --yes --json/);
  assert.match(workflow, /railway redeploy --service "\$RAILWAY_SERVICE" --yes --json/);
  assert.match(workflow, /bash scripts\/capture-railway-diagnostics\.sh railway-diagnostics/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
});

test('Railway diagnostics helper captures service status, latest logs, and a direct health probe', () => {
  const script = fs.readFileSync(path.join(PROJECT_ROOT, 'scripts', 'capture-railway-diagnostics.sh'), 'utf8');

  assert.match(script, /railway link --project "\$RAILWAY_PROJECT_ID"/);
  assert.match(script, /railway service status/);
  assert.match(script, /railway logs .*--latest --deployment --lines "\$LOG_LINES" --json/);
  assert.match(script, /railway logs .*--latest --build --lines "\$LOG_LINES" --json/);
  assert.match(script, /railway logs .*--latest --http --path \/health --status '>=500' --lines "\$HTTP_LOG_LINES" --json/);
  assert.match(script, /railway logs .*--latest --http --status '>=500' --lines "\$HTTP_LOG_LINES" --json/);
  assert.match(script, /curl \\/);
  assert.match(script, /HEALTHCHECK_URL/);
});

test('Deploy to Railway workflow retries transient Railway CLI failures before failing the lane', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'deploy-railway.yml'), 'utf8');

  assert.match(workflow, /retry_railway\(\) \{/);
  assert.match(workflow, /max_attempts=4/);
  assert.match(workflow, /set THUMBGATE_API_KEY/);
  assert.match(workflow, /set THUMBGATE_BUILD_SHA/);
  assert.match(workflow, /set THUMBGATE_BUILD_GENERATED_AT/);
  assert.match(workflow, /set THUMBGATE_PUBLIC_APP_ORIGIN/);
  assert.match(workflow, /set THUMBGATE_BILLING_API_BASE_URL/);
  assert.match(workflow, /set STRIPE_SECRET_KEY/);
  assert.match(workflow, /set STRIPE_WEBHOOK_SECRET/);
  assert.match(workflow, /set RESEND_API_KEY/);
  assert.match(workflow, /set THUMBGATE_TRIAL_EMAIL_FROM/);
  assert.match(workflow, /deploy with railway up/);
  assert.match(workflow, /Railway command failed \(attempt \$attempt\/\$max_attempts\)/);
  assert.match(workflow, /Retrying in \$\{sleep_seconds\}s/);
  assert.match(workflow, /verify_live_build_sha_after_railway_failure\(\) \{/);
  assert.match(workflow, /Railway CLI reported a deploy failure; checking whether Railway already promoted \$GITHUB_SHA/);
  assert.match(workflow, /if ! retry_railway "deploy with railway up" railway up --ci --detach --project "\$RAILWAY_PROJECT_ID"/);
  assert.match(workflow, /Railway CLI failed after upload, but health verification proves \$GITHUB_SHA is live/);
  assert.match(workflow, /Final health status after Railway CLI failure/);
});

test('Deploy to Railway workflow skips non-runtime pushes and only deploys when runtime-serving files changed', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'deploy-railway.yml'), 'utf8');

  assert.match(workflow, /fetch-depth:\s*2/);
  assert.match(workflow, /name: Detect deployable changes/);
  assert.match(workflow, /BEFORE_SHA='\$\{\{\s*github\.event\.before\s*\}\}'/);
  assert.match(workflow, /git diff --name-only "\$BEFORE_SHA" "\$GITHUB_SHA"/);
  assert.match(workflow, /DEPLOYABLE_PATTERN='.*src\/.*public\/.*Dockerfile\$/);
  assert.ok(
    workflow.includes('scripts/.*\\.(js|mjs|cjs)$'),
    'workflow should only treat runtime JS script modules as deployable',
  );
  assert.ok(
    workflow.includes('adapters/.*\\.(js|mjs|cjs|json|ya?ml|toml)$'),
    'workflow should only treat runtime adapter files as deployable',
  );
  assert.ok(
    !workflow.includes("DEPLOYABLE_PATTERN='^(src/|scripts/|"),
    'workflow should not treat every scripts/ path as deployable',
  );
  assert.ok(
    !workflow.includes('|adapters/|'),
    'workflow should not treat adapter Markdown docs as deployable',
  );
  assert.match(workflow, /! printf '%s\\n' "\$CHANGED_FILES" \| grep -Eq "\$DEPLOYABLE_PATTERN"/);
  assert.match(workflow, /should_deploy=\$SHOULD_DEPLOY/);
  assert.match(workflow, /SHOULD_DEPLOY=true/);
  assert.match(workflow, /SHOULD_DEPLOY=false/);
  assert.match(workflow, /Railway deploy skipped: no runtime-serving files changed on this commit\./);
  assert.doesNotMatch(workflow, /Railway deploy skipped: deploy-scope disabled this run\./);
});

test('Deploy to Railway workflow stamps runtime deployment env metadata before health verification', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'deploy-railway.yml'), 'utf8');

  assert.match(workflow, /THUMBGATE_BUILD_SHA="\$GITHUB_SHA"/);
  assert.match(workflow, /THUMBGATE_BUILD_GENERATED_AT="\$\(date -u \+'\%Y-\%m-\%dT\%H:\%M:\%SZ'\)"/);
  assert.match(workflow, /LIVE_SHA=\$\(node -e "const fs = require\('fs'\); const data = JSON\.parse/);
});

test('Publish to NPM workflow uses the tested publish-decision guardrail', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'publish-npm.yml'), 'utf8');

  assert.match(workflow, /name:\s*Publish to NPM/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /group:\s*publish-npm-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.match(workflow, /permissions:\s+contents:\s+write\s+id-token:\s+write/s);
  assert.match(workflow, /node-version:\s*'24\.x'/);
  assert.match(workflow, /timeout-minutes:\s*25/);
  assert.match(workflow, /cache:\s*'npm'/);
  assert.match(workflow, /name: Run release safety checks/);
  assert.match(workflow, /node scripts\/sync-version\.js --check/);
  assert.match(workflow, /npm run test:deployment/);
  assert.match(workflow, /npm run test:postinstall/);
  assert.match(workflow, /npm run prove:runtime/);
  assert.match(workflow, /name: Audit npm package boundary/);
  assert.match(workflow, /npm pack --dry-run/);
  assert.doesNotMatch(workflow, /run:\s*npm test/);
  assert.match(workflow, /name: Plan publish action/);
  assert.match(workflow, /run: node scripts\/publish-decision\.js/);
  assert.match(workflow, /CURRENT_BRANCH:\s*\$\{\{\s*github\.ref_name\s*\}\}/);
  assert.match(workflow, /DEFAULT_BRANCH:\s*main/);
  assert.match(workflow, /steps\.plan\.outputs\.skip_publish == 'true'/);
  assert.match(workflow, /steps\.plan\.outputs\.publish_npm == 'true'/);
  assert.match(workflow, /'package\.json'\s+'package-lock\.json'\s+'server\.json'/);
  assert.match(workflow, /'adapters\/\*\*'\s+'plugins\/\*\*'/);
  assert.match(workflow, /PENDING_CHANGESETS=\$\(git diff --name-only "\$LAST_TAG"\.\.HEAD -- '\.changeset\/\*\.md'/);
  assert.match(workflow, /grep -v '\^\.changeset\/README\.md\$'/);
  assert.match(workflow, /Treating this no-op as release-audited until the next versioned publish lands\./);
  assert.match(workflow, /npm publish --tag "\$\{\{\s*steps\.plan\.outputs\.npm_tag \|\| 'latest'\s*\}\}" --provenance/);
  assert.match(workflow, /--install-attempts 12 --install-delay-ms 10000/);
});

test('CODEOWNERS explicitly covers release-critical governance surfaces', () => {
  const codeowners = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'CODEOWNERS'), 'utf8');

  assert.match(codeowners, /^\/\.github\/workflows\/\* @IgorGanapolsky$/m);
  assert.match(codeowners, /^\/package\.json @IgorGanapolsky$/m);
  assert.match(codeowners, /^\/server\.json @IgorGanapolsky$/m);
  assert.match(codeowners, /^\/adapters\/mcp\/server-stdio\.js @IgorGanapolsky$/m);
  assert.match(codeowners, /^\/src\/api\/server\.js @IgorGanapolsky$/m);
  assert.match(codeowners, /^\/scripts\/gates-engine\.js @IgorGanapolsky$/m);
  assert.match(codeowners, /^\/scripts\/tool-registry\.js @IgorGanapolsky$/m);
  assert.match(codeowners, /^\/scripts\/pr-manager\.js @IgorGanapolsky$/m);
  assert.match(codeowners, /^\/scripts\/publish-decision\.js @IgorGanapolsky$/m);
  assert.match(codeowners, /^\/config\/gates\/\*\* @IgorGanapolsky$/m);
  assert.match(codeowners, /^\/config\/mcp-allowlists\.json @IgorGanapolsky$/m);
});

test('CI workflow runs Tessl proof and uploads Tessl evidence artifacts', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /npm run prove:tessl/);
  assert.match(workflow, /proof\/tessl-report\.json/);
  assert.match(workflow, /proof\/tessl-report\.md/);
});

test('CI workflow runs runtime proof and uploads runtime evidence artifacts', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /npm run prove:runtime/);
  assert.match(workflow, /proof\/runtime-report\.json/);
  assert.match(workflow, /proof\/runtime-report\.md/);
});

test('CI workflow runs evolution proof and uploads evolution evidence artifacts', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /npm run prove:evolution/);
  assert.match(workflow, /proof\/evolution-report\.json/);
  assert.match(workflow, /proof\/evolution-report\.md/);
});

test('CI workflow treats GitHub About sync as best-effort but still verifies the live About state', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /name: Sync GitHub About metadata on main[\s\S]*?continue-on-error:\s*true[\s\S]*?GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GH_PAT\s*\}\}[\s\S]*?THUMBGATE_GITHUB_ABOUT_VERIFY_ATTEMPTS:\s*6[\s\S]*?THUMBGATE_GITHUB_ABOUT_VERIFY_DELAY_MS:\s*5000[\s\S]*?npm run github:about:sync/);
  assert.match(workflow, /name: Verify live GitHub About congruence on main[\s\S]*?GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}[\s\S]*?THUMBGATE_GITHUB_ABOUT_VERIFY_ATTEMPTS:\s*6[\s\S]*?THUMBGATE_GITHUB_ABOUT_VERIFY_DELAY_MS:\s*5000[\s\S]*?run:\s*npm run test:congruence:live/);
  assert.doesNotMatch(workflow, /name: Verify live GitHub About congruence on main[\s\S]*?GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GH_PAT\s*\}\}/);
});

test('CI workflow supports merge queue and cancels stale non-main runs', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /permissions:\s+contents:\s+read\s+pull-requests:\s+read/s);
  assert.match(workflow, /push:\s+#[\s\S]*?branches:\s*\[main\]/);
  assert.doesNotMatch(workflow, /branches:\s*\[main,\s*feat\/\*\*\]/);
  assert.match(workflow, /merge_group:/);
  assert.match(workflow, /types:\s*\[checks_requested\]/);
  assert.match(workflow, /group:\s*ci-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.event\.pull_request\.number \|\| github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*\$\{\{\s*github\.ref != 'refs\/heads\/main'\s*\}\}/);
  assert.match(workflow, /name: Check operational integrity[\s\S]*?GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}[\s\S]*?npm run ops:integrity:ci/);
  assert.match(workflow, /name: Check branch protection congruence[\s\S]*?if:\s*github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.user\.login != 'dependabot\[bot\]'[\s\S]*?GH_TOKEN:\s*\$\{\{\s*secrets\.GH_PAT \|\| github\.token\s*\}\}[\s\S]*?npm run branch-protection:check/);
});

test('CI workflow gives the full suite enough runtime budget', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const timeoutMatch = workflow.match(/timeout-minutes:\s*(\d+)/);

  assert.ok(timeoutMatch, 'CI workflow must declare a timeout budget');
  assert.ok(Number(timeoutMatch[1]) >= 45, 'CI timeout must leave enough room for the full suite');
});

test('CI workflow runs budget status and coverage checks before proof lanes', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /Run budget status gate/);
  assert.match(workflow, /npm run budget:status/);
  assert.match(workflow, /Run coverage/);
  assert.match(workflow, /npm run test:coverage/);
});

test('CodeQL workflow supports merge queue and cancels stale non-main runs', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'codeql.yml'), 'utf8');

  assert.match(workflow, /merge_group:/);
  assert.match(workflow, /types:\s*\[checks_requested\]/);
  assert.match(workflow, /group:\s*codeql-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.event\.pull_request\.number \|\| github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*\$\{\{\s*github\.ref != 'refs\/heads\/main'\s*\}\}/);
});

test('SonarCloud workflow refreshes main and stamps scans with the package version', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'sonarcloud.yml'), 'utf8');

  assert.match(workflow, /^name:\s*SonarCloud/m);
  assert.match(workflow, /push:\s+branches:\s*\[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /merge_group:/);
  assert.match(workflow, /types:\s*\[checks_requested\]/);
  assert.match(workflow, /group:\s*sonarcloud-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.event\.pull_request\.number \|\| github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*\$\{\{\s*github\.ref != 'refs\/heads\/main'\s*\}\}/);
  assert.match(workflow, /name:\s*SonarCloud Code Analysis\s*\n\s*runs-on:/);
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /name:\s*Skip SonarCloud scan for Dependabot PRs/);
  assert.match(workflow, /npm ci --onnxruntime-node-install-cuda=skip/);
  assert.match(workflow, /Generate LCOV coverage report[\s\S]*?NODE_V8_COVERAGE=\.coverage\/raw node scripts\/test-coverage\.js/);
  assert.match(workflow, /npx c8 report[\s\S]*?--reporter=lcov/);
  assert.match(workflow, /Read package version[\s\S]*?require\("\.\/package\.json"\)\.version/);
  assert.match(workflow, /Build Sonar mainline analysis version[\s\S]*?sha\.\$SHORT_SHA/);
  assert.match(workflow, /Run SonarCloud scan \(default branch refresh\)[\s\S]*?github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /-Dsonar\.projectVersion=\$\{\{\s*steps\.sonar-mainline-version\.outputs\.value\s*\}\}/);
});

test('SonarCloud workflow polls quality gates only for PR and merge-queue scans', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'sonarcloud.yml'), 'utf8');
  const pullRequestScanStep = workflow.match(/- name: Run SonarCloud scan \(pull request \/ merge queue\)[\s\S]*?(?=\n\n      - name: Check SonarCloud quality gate)/);
  const qualityGateStep = workflow.match(/- name: Check SonarCloud quality gate[\s\S]*?(?=\n\n      - name: Run SonarCloud scan \(default branch refresh\))/);
  const defaultBranchStep = workflow.match(/- name: Run SonarCloud scan \(default branch refresh\)[\s\S]*$/);

  assert.ok(pullRequestScanStep, 'pull request scan step should exist');
  assert.ok(qualityGateStep, 'quality gate step should exist');
  assert.ok(defaultBranchStep, 'default branch refresh step should exist');
  assert.match(workflow, /github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'/);
  assert.match(workflow, /SONAR_TOKEN:\s*\$\{\{\s*secrets\.SONAR_TOKEN\s*\}\}/);
  assert.match(pullRequestScanStep[0], /github\.event_name == 'pull_request' \|\| github\.event_name == 'merge_group'/);
  assert.match(pullRequestScanStep[0], /!\(github\.event_name == 'pull_request' && github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'\)/);
  assert.match(pullRequestScanStep[0], /uses:\s*SonarSource\/sonarqube-scan-action@v8\.0\.0/);
  assert.match(pullRequestScanStep[0], /-Dsonar\.projectVersion=\$\{\{\s*steps\.package-version\.outputs\.version\s*\}\}/);
  assert.doesNotMatch(pullRequestScanStep[0], /qualitygate\.wait=true/);
  assert.match(qualityGateStep[0], /github\.event_name == 'pull_request' \|\| github\.event_name == 'merge_group'/);
  assert.match(qualityGateStep[0], /!\(github\.event_name == 'pull_request' && github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'\)/);
  assert.match(qualityGateStep[0], /uses:\s*SonarSource\/sonarqube-quality-gate-action@v1\.2\.0/);
  assert.match(qualityGateStep[0], /pollingTimeoutSec:\s*600/);
  assert.doesNotMatch(defaultBranchStep[0], /qualitygate\.wait=true/);
});

test('Claude Code Review workflow only cancels manual issue-comment review reruns', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'claude-code-review.yml'), 'utf8');

  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /group:\s*claude-code-review-\$\{\{\s*github\.event_name\s*\}\}-\$\{\{\s*github\.event\.pull_request\.number \|\| github\.event\.issue\.number \|\| github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*\$\{\{\s*github\.event_name == 'issue_comment'\s*\}\}/);
});

test('Deploy to Railway workflow serializes main deploys and cancels superseded runs', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'deploy-railway.yml'), 'utf8');

  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /group:\s*deploy-railway-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
});

test('Publish Tessl workflow verifies exports and only publishes when a Tessl token exists', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'publish-tessl.yml'), 'utf8');

  assert.match(workflow, /name: Publish Tessl Tiles/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /group:\s*publish-tessl-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.doesNotMatch(workflow, /^permissions:\n\s+contents:\s+read/m);
  assert.match(workflow, /jobs:\s+export:\s+permissions:\s+contents:\s+read/s);
  assert.match(workflow, /jobs:\s+export:.*?plan_publish:\s+needs:\s+export\s+runs-on:/s);
  assert.match(workflow, /publish:\s+needs:\s+\[export, plan_publish\]\s+if:\s+\$\{\{\s*needs\.plan_publish\.outputs\.should_publish == 'true'\s*\}\}\s+permissions:\s+contents:\s+read/s);
  assert.match(workflow, /npm run tessl:verify/);
  assert.match(workflow, /npm run prove:tessl/);
  assert.match(workflow, /npm run tessl:export -- --out-dir=.artifacts\/tessl/);
  assert.match(workflow, /name: Plan Tessl publish action/);
  assert.match(workflow, /TESSL_API_TOKEN: \$\{\{ secrets\.TESSL_API_TOKEN \}\}/);
  assert.match(workflow, /should_publish=true/);
  assert.match(workflow, /should_publish=false/);
  assert.match(workflow, /if: \$\{\{ needs\.plan_publish\.outputs\.should_publish == 'true' \}\}/);
  assert.match(workflow, /uses: tesslio\/publish@main/);
  assert.match(workflow, /token: \$\{\{ env\.TESSL_API_TOKEN \}\}/);
  assert.match(workflow, /matrix:\s+tile:/s);
  assert.match(workflow, /agent-memory/);
  assert.match(workflow, /thumbgate-feedback/);
});

test('Dependabot auto-merge trusts the pull request author instead of the triggering actor', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'dependabot-automerge.yml'), 'utf8');

  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'/);
  assert.doesNotMatch(workflow, /if:\s*github\.actor == 'dependabot\[bot\]'/);
  assert.match(workflow, /issues:\s+write/s);
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{\s*secrets\.GH_PAT \|\| github\.token\s*\}\}/);
  assert.match(workflow, /group:\s*dependabot-automerge-\$\{\{\s*github\.event\.pull_request\.number \|\| github\.run_id\s*\}\}/);
  assert.match(workflow, /jobs:\s+dependabot-automerge:\s+name:\s*dependabot-automerge/s);
  assert.match(workflow, /THUMBGATE_MAIN_MERGE_PROVIDER:\s*trunk/);
  assert.match(workflow, /name:\s*Checkout trusted base workflow tools/);
  assert.match(workflow, /name:\s*Checkout Dependabot head/);
  assert.match(workflow, /name:\s*Add generated changeset for manifest-only dependency bumps/);
  assert.match(workflow, /node scripts\/dependabot-changeset\.js --title "\$PR_TITLE" --output "\$output_path"/);
  assert.match(workflow, /git -C \.dependabot-head push origin "HEAD:\$\{HEAD_REF\}"/);
  assert.match(workflow, /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/issues\/\$\{PR_NUMBER\}\/comments"/);
  assert.match(workflow, /-f body='\/trunk merge'/);
  assert.doesNotMatch(workflow, /gh pr checks "\$PR_URL"/);
});

test('Publish Claude Plugin workflow builds the MCPB and review zip and uploads channel-safe release assets', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'publish-claude-plugin.yml'), 'utf8');

  assert.match(workflow, /name: Publish Claude Plugin/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /group:\s*publish-claude-plugin-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.match(workflow, /npm ci --onnxruntime-node-install-cuda=skip/);
  assert.match(workflow, /npm run build:claude-mcpb/);
  assert.match(workflow, /npm run build:claude-review-zip/);
  assert.match(workflow, /scripts\/distribution-surfaces/);
  assert.match(workflow, /version=\$\(node -p "require\('\.\/package\.json'\)\.version"\)/);
  assert.match(workflow, /versioned_bundle=\$\(node -e "const \{ getClaudePluginVersionedAssetName \} = require\('\.\/scripts\/distribution-surfaces'\); process\.stdout\.write\(getClaudePluginVersionedAssetName\(\)\)"\)/);
  assert.match(workflow, /channel_bundle=\$\(node -e "const \{ getClaudePluginChannelAssetName \} = require\('\.\/scripts\/distribution-surfaces'\); process\.stdout\.write\(getClaudePluginChannelAssetName\(\)\)"\)/);
  assert.match(workflow, /versioned_review=\$\(node -e "const \{ getClaudePluginReviewVersionedAssetName \} = require\('\.\/scripts\/distribution-surfaces'\); process\.stdout\.write\(getClaudePluginReviewVersionedAssetName\(\)\)"\)/);
  assert.match(workflow, /channel_review=\$\(node -e "const \{ getClaudePluginReviewChannelAssetName \} = require\('\.\/scripts\/distribution-surfaces'\); process\.stdout\.write\(getClaudePluginReviewChannelAssetName\(\)\)"\)/);
  assert.match(workflow, /is_prerelease=\$\(node -e "const \{ isPrereleaseVersion \} = require\('\.\/scripts\/distribution-surfaces'\); process\.stdout\.write\(String\(isPrereleaseVersion\(\)\)\)"\)/);
  assert.doesNotMatch(workflow, /require\\+"/);
  assert.match(workflow, /claude-plugin-assets/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /--clobber/);
  assert.match(workflow, /Create release asset aliases/);
  assert.match(workflow, /steps\.assets\.outputs\.channel_bundle/);
  assert.match(workflow, /steps\.assets\.outputs\.channel_review/);
  assert.match(workflow, /--prerelease/);
});

test('Publish Codex Plugin workflow builds the zip bundle and uploads channel-safe release assets', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'publish-codex-plugin.yml'), 'utf8');

  assert.match(workflow, /name: Publish Codex Plugin/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /group:\s*publish-codex-plugin-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.match(workflow, /npm ci --onnxruntime-node-install-cuda=skip/);
  assert.match(workflow, /npm run prove:adapters/);
  assert.match(workflow, /npm run build:codex-plugin/);
  assert.match(workflow, /scripts\/distribution-surfaces/);
  assert.match(workflow, /version=\$\(node -p "require\('\.\/package\.json'\)\.version"\)/);
  assert.match(workflow, /versioned_asset=\$\(node -e "const \{ getCodexPluginVersionedAssetName \} = require\('\.\/scripts\/distribution-surfaces'\); process\.stdout\.write\(getCodexPluginVersionedAssetName\(\)\)"\)/);
  assert.match(workflow, /channel_asset=\$\(node -e "const \{ getCodexPluginChannelAssetName \} = require\('\.\/scripts\/distribution-surfaces'\); process\.stdout\.write\(getCodexPluginChannelAssetName\(\)\)"\)/);
  assert.match(workflow, /is_prerelease=\$\(node -e "const \{ isPrereleaseVersion \} = require\('\.\/scripts\/distribution-surfaces'\); process\.stdout\.write\(String\(isPrereleaseVersion\(\)\)\)"\)/);
  assert.match(workflow, /codex-plugin-zip/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /--clobber/);
  assert.match(workflow, /Create channel asset alias/);
  assert.match(workflow, /steps\.assets\.outputs\.channel_asset/);
  assert.match(workflow, /--prerelease/);
});

test('Agent auto-merge workflow submits queue requests instead of polling its own check state', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'agent-automerge.yml'), 'utf8');

  assert.match(workflow, /issues:\s+write/s);
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{\s*secrets\.GH_PAT \|\| github\.token\s*\}\}/);
  assert.match(workflow, /group:\s*agent-automerge-\$\{\{\s*github\.event\.pull_request\.number \|\| github\.run_id\s*\}\}/);
  assert.match(workflow, /jobs:\s+agent-automerge:\s+name:\s*agent-automerge/s);
  assert.match(workflow, /THUMBGATE_MAIN_MERGE_PROVIDER:\s*trunk/);
  assert.match(workflow, /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/issues\/\$\{PR_NUMBER\}\/comments"/);
  assert.match(workflow, /-f body='\/trunk merge'/);
  assert.doesNotMatch(workflow, /gh pr checks "\$PR_URL"/);
  assert.doesNotMatch(workflow, /timeout_seconds=1800/);
});

test('merge workflows never arm raw GitHub auto-merge before terminal quality checks', () => {
  const workflowsDir = path.join(PROJECT_ROOT, '.github', 'workflows');
  const workflowFiles = [
    'agent-automerge.yml',
    'dependabot-automerge.yml',
    'merge-branch.yml',
  ];

  for (const workflowFile of workflowFiles) {
    const workflow = fs.readFileSync(path.join(workflowsDir, workflowFile), 'utf8');
    assert.doesNotMatch(workflow, /gh\s+pr\s+merge[^\n]*--auto/, `${workflowFile} must not use raw gh pr merge --auto`);
  }

  const agentWorkflow = fs.readFileSync(path.join(workflowsDir, 'agent-automerge.yml'), 'utf8');
  assert.match(agentWorkflow, /name: Request merge automation/);
  assert.match(agentWorkflow, /gh pr merge --squash --delete-branch "\$PR_URL"/);

  const dependabotWorkflow = fs.readFileSync(path.join(workflowsDir, 'dependabot-automerge.yml'), 'utf8');
  assert.match(dependabotWorkflow, /name: Request merge automation/);
  assert.doesNotMatch(dependabotWorkflow, /gh pr checks "\$PR_URL"/);
  assert.doesNotMatch(dependabotWorkflow, /gh pr checks "\$PR_URL" --required/);

  const mergeBranchWorkflow = fs.readFileSync(path.join(workflowsDir, 'merge-branch.yml'), 'utf8');
  assert.match(mergeBranchWorkflow, /node scripts\/pr-manager\.js "\$PR_NUMBER"/);
});

test('Agent auto-merge workflow records merge submission without waiting for the final merge commit', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'agent-automerge.yml'), 'utf8');

  assert.match(workflow, /name: Request merge automation/);
  assert.match(workflow, /### Merge automation/);
  assert.match(workflow, /Queue request: \\`\/trunk merge\\`/);
  assert.doesNotMatch(workflow, /gh pr view "\$PR_URL" --json state,mergeCommit,url,title/);
  assert.doesNotMatch(workflow, /Final merge commit:/);
});

test('Merge branch workflow requests trunk merge for main instead of forcing GitHub auto-merge', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'merge-branch.yml'), 'utf8');

  assert.match(workflow, /issues:\s+write/s);
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{\s*secrets\.GH_PAT \|\| github\.token\s*\}\}/);
  assert.match(workflow, /THUMBGATE_MAIN_MERGE_PROVIDER:\s*trunk/);
  assert.match(workflow, /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/issues\/\$\{PR_NUMBER\}\/comments"/);
  assert.match(workflow, /-f body='\/trunk merge'/);
  assert.match(workflow, /if \[ "\$\{THUMBGATE_MAIN_MERGE_PROVIDER\}" = "trunk" \]/);
});

test('Sentry release workflow serializes main release stamping', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'sentry-release.yml'), 'utf8');

  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /group:\s*sentry-release-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.match(workflow, /uses: getsentry\/action-release@v3/);
});

test('GitHub Actions workflows never use bare npm ci for onnxruntime installs', () => {
  const workflowsDir = path.join(PROJECT_ROOT, '.github', 'workflows');
  const workflowFiles = fs.readdirSync(workflowsDir).filter((name) => name.endsWith('.yml'));

  for (const workflowFile of workflowFiles) {
    const workflow = fs.readFileSync(path.join(workflowsDir, workflowFile), 'utf8');

    assert.doesNotMatch(
      workflow,
      /^\s*run:\s*npm ci\s*$/m,
      `${workflowFile} should not use bare npm ci`
    );
  }

  const gtmWorkflow = fs.readFileSync(path.join(workflowsDir, 'gtm-autonomous-loop.yml'), 'utf8');
  assert.match(gtmWorkflow, /npm ci --onnxruntime-node-install-cuda=skip/);
});

test('.env.example documents the active operator and analytics variables without stale one-time Stripe or xAI keys', () => {
  const envExample = fs.readFileSync(path.join(PROJECT_ROOT, '.env.example'), 'utf8');

  assert.match(envExample, /^# GH_PAT=/m);
  assert.match(envExample, /^# PLAUSIBLE_API_KEY=/m);
  assert.match(envExample, /^# PLAUSIBLE_SITE_ID=/m);
  assert.match(envExample, /^# TESSL_WORKSPACE=/m);
  assert.doesNotMatch(envExample, /^# STRIPE_ONE_TIME_PRICE_ID=/m);
  assert.doesNotMatch(envExample, /^# XAI_API_KEY=/m);
});

test('.gitignore keeps local SQLite sidecars out of git status and removes stale aider exceptions', () => {
  const gitignore = fs.readFileSync(path.join(PROJECT_ROOT, '.gitignore'), 'utf8');

  assert.match(gitignore, /^\.claude\/memory\/\*\.sqlite\*$/m);
  assert.doesNotMatch(gitignore, /^!\.env\.aider\.example$/m);
});
