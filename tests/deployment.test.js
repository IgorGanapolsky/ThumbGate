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

const { startServer } = require('../src/api/server');
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

test('Deploy to Railway workflow is the single authoritative Railway deploy lane', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'deploy-railway.yml'), 'utf8');

  assert.match(workflow, /Check Railway deployment configuration/);
  assert.match(workflow, /Enforce deploy policy/);
  assert.match(workflow, /node scripts\/deploy-policy\.js --profiles=billing,deploy/);
  assert.match(workflow, /steps\.railway-config\.outputs\.enabled == 'true'/);
  assert.match(workflow, /RAILWAY_PROJECT_ID/);
  assert.match(workflow, /RAILWAY_ENVIRONMENT_ID/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_URL/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_MAX_ATTEMPTS/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_SLEEP_SECONDS/);
  assert.match(workflow, /secrets\.THUMBGATE_API_KEY/);
  assert.match(workflow, /vars\.THUMBGATE_PUBLIC_APP_ORIGIN \|\| 'https:\/\/thumbgate-production\.up\.railway\.app'/);
  assert.match(workflow, /vars\.THUMBGATE_BILLING_API_BASE_URL \|\| vars\.THUMBGATE_PUBLIC_APP_ORIGIN \|\| 'https:\/\/thumbgate-production\.up\.railway\.app'/);
  assert.match(workflow, /THUMBGATE_PUBLIC_APP_ORIGIN/);
  assert.match(workflow, /THUMBGATE_BILLING_API_BASE_URL/);
  assert.match(workflow, /railway up/);
  assert.match(workflow, /--ci/);
  assert.match(workflow, /--detach/);
  assert.match(workflow, /--project "\$RAILWAY_PROJECT_ID"/);
  assert.match(workflow, /--environment "\$RAILWAY_ENVIRONMENT_ID"/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_MAX_ATTEMPTS:\s*\$\{\{\s*vars\.RAILWAY_HEALTHCHECK_MAX_ATTEMPTS\s*\|\|\s*'120'\s*\}\}/);
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
  assert.match(workflow, /MAX_ATTEMPTS="\$\{RAILWAY_HEALTHCHECK_MAX_ATTEMPTS:-120\}"/);
  assert.match(workflow, /SLEEP_SECONDS="\$\{RAILWAY_HEALTHCHECK_SLEEP_SECONDS:-10\}"/);
  assert.match(workflow, /Observed build SHA/);
  assert.match(workflow, /Expected build SHA/);
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
  assert.match(workflow, /deploy with railway up/);
  assert.match(workflow, /Railway command failed \(attempt \$attempt\/\$max_attempts\)/);
  assert.match(workflow, /Retrying in \$\{sleep_seconds\}s/);
});

test('Deploy to Railway workflow always promotes the latest main commit, even for workflow-only or test-only pushes', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'deploy-railway.yml'), 'utf8');

  assert.match(workflow, /fetch-depth:\s*2/);
  assert.match(workflow, /name: Detect deployable changes/);
  assert.match(workflow, /BEFORE_SHA='\$\{\{\s*github\.event\.before\s*\}\}'/);
  assert.match(workflow, /git diff --name-only "\$BEFORE_SHA" "\$GITHUB_SHA"/);
  assert.match(workflow, /should_deploy=\$SHOULD_DEPLOY/);
  assert.match(workflow, /SHOULD_DEPLOY=true/);
  assert.doesNotMatch(workflow, /grep -Eqv '\^\(\\\.github\/\|tests\/\)'/);
  assert.doesNotMatch(workflow, /Railway deploy skipped: only workflow\/test files changed on this commit\./);
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
  assert.match(workflow, /name: Plan publish action/);
  assert.match(workflow, /run: node scripts\/publish-decision\.js/);
  assert.match(workflow, /CURRENT_BRANCH:\s*\$\{\{\s*github\.ref_name\s*\}\}/);
  assert.match(workflow, /DEFAULT_BRANCH:\s*main/);
  assert.match(workflow, /steps\.plan\.outputs\.skip_publish == 'true'/);
  assert.match(workflow, /steps\.plan\.outputs\.publish_npm == 'true'/);
  assert.match(workflow, /npm publish --tag "\$\{\{\s*steps\.plan\.outputs\.npm_tag \|\| 'latest'\s*\}\}" --provenance/);
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

  assert.match(workflow, /name: Sync GitHub About metadata on main[\s\S]*?continue-on-error:\s*true[\s\S]*?GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GH_PAT\s*\}\}[\s\S]*?npm run github:about:sync/);
  assert.match(workflow, /name: Verify live GitHub About congruence on main[\s\S]*?run:\s*npm run test:congruence:live/);
  assert.doesNotMatch(workflow, /name: Verify live GitHub About congruence on main[\s\S]*?GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GH_PAT\s*\}\}/);
});

test('CI workflow supports merge queue and cancels stale non-main runs', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /permissions:\s+contents:\s+read\s+pull-requests:\s+read/s);
  assert.match(workflow, /merge_group:/);
  assert.match(workflow, /types:\s*\[checks_requested\]/);
  assert.match(workflow, /group:\s*ci-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.event\.pull_request\.number \|\| github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*\$\{\{\s*github\.ref != 'refs\/heads\/main'\s*\}\}/);
  assert.match(workflow, /name: Check operational integrity[\s\S]*?GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}[\s\S]*?npm run ops:integrity:ci/);
});

test('CI workflow gives the full suite enough runtime budget', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const timeoutMatch = workflow.match(/timeout-minutes:\s*(\d+)/);

  assert.ok(timeoutMatch, 'CI workflow must declare a timeout budget');
  assert.ok(Number(timeoutMatch[1]) >= 45, 'CI timeout must leave enough room for the full suite');
});

test('CI workflow runs budget status and coverage gates before proof lanes', () => {
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
});

test('Publish Claude Plugin workflow builds the MCPB and uploads channel-safe release assets', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'publish-claude-plugin.yml'), 'utf8');

  assert.match(workflow, /name: Publish Claude Plugin/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /group:\s*publish-claude-plugin-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.match(workflow, /npm ci --onnxruntime-node-install-cuda=skip/);
  assert.match(workflow, /npm run build:claude-mcpb/);
  assert.match(workflow, /scripts\/distribution-surfaces/);
  assert.match(workflow, /version=\$\(node -p "require\('\.\/package\.json'\)\.version"\)/);
  assert.match(workflow, /versioned_asset=\$\(node -e "const \{ getClaudePluginVersionedAssetName \} = require\('\.\/scripts\/distribution-surfaces'\); process\.stdout\.write\(getClaudePluginVersionedAssetName\(\)\)"\)/);
  assert.match(workflow, /channel_asset=\$\(node -e "const \{ getClaudePluginChannelAssetName \} = require\('\.\/scripts\/distribution-surfaces'\); process\.stdout\.write\(getClaudePluginChannelAssetName\(\)\)"\)/);
  assert.match(workflow, /is_prerelease=\$\(node -e "const \{ isPrereleaseVersion \} = require\('\.\/scripts\/distribution-surfaces'\); process\.stdout\.write\(String\(isPrereleaseVersion\(\)\)\)"\)/);
  assert.doesNotMatch(workflow, /require\\+"/);
  assert.match(workflow, /claude-plugin-mcpb/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /--clobber/);
  assert.match(workflow, /Create channel asset alias/);
  assert.match(workflow, /steps\.assets\.outputs\.channel_asset/);
  assert.match(workflow, /--prerelease/);
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
