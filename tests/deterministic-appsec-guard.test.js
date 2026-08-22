'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appsec = require('../scripts/deterministic-appsec-guard');

test('Deterministic AppSec: loads configuration cleanly', () => {
  const config = appsec.loadAppSecConfig();
  assert.equal(config.gateId, 'gate_deterministic_appsec_guard_2026');
  assert.equal(config.enforcementMode, 'fail_closed');
});

test('Deterministic AppSec: Rule 01 catches unauthenticated endpoints', () => {
  const vulnCode = 'app.get("/admin/metrics", (req, res) => { res.json({ secret: true }); });';
  const safeCode = 'app.get("/admin/metrics", requireAuth, (req, res) => { res.json({ secret: true }); });';

  const vulnResult = appsec.evaluateDeterministicAppSec(vulnCode);
  assert.equal(vulnResult.passed, false);
  assert.ok(vulnResult.violations.some((v) => v.ruleId === 'APPSEC_01_UNAUTH_ENDPOINT'));

  const safeResult = appsec.evaluateDeterministicAppSec(safeCode);
  assert.equal(safeResult.passed, true);
});

test('Deterministic AppSec: Rule 02 catches hardcoded secrets and API keys', () => {
  const codeWithAws = 'const awsKey = "AKIAIOSFODNN7EXAMPLE";';
  const codeWithOpenAi = 'const openAiKey = "sk-1234567890abcdef1234567890abcdef12345678";';
  const safeCode = 'const key = process.env.API_KEY;';

  assert.ok(appsec.evaluateDeterministicAppSec(codeWithAws).violations.some((v) => v.ruleId === 'APPSEC_02_HARDCODED_SECRETS'));
  assert.ok(appsec.evaluateDeterministicAppSec(codeWithOpenAi).violations.some((v) => v.ruleId === 'APPSEC_02_HARDCODED_SECRETS'));
  assert.equal(appsec.evaluateDeterministicAppSec(safeCode).passed, true);
});

test('Deterministic AppSec: Rule 03 catches permissive CORS with credentials', () => {
  const vulnCors = 'app.use(cors({ origin: "*", credentials: true }));';
  const safeCors = 'app.use(cors({ origin: "https://thumbgate.ai", credentials: true }));';

  assert.ok(appsec.evaluateDeterministicAppSec(vulnCors).violations.some((v) => v.ruleId === 'APPSEC_03_PERMISSIVE_CORS'));
  assert.equal(appsec.evaluateDeterministicAppSec(safeCors).passed, true);
});

test('Deterministic AppSec: Rule 04 catches SSRF egress to metadata/private IPs', () => {
  const vulnFetch = 'fetch("http://169.254.169.254/latest/meta-data/iam/security-credentials");';
  const safeFetch = 'fetch("https://api.thumbgate.ai/v1/health");';

  assert.ok(appsec.evaluateDeterministicAppSec(vulnFetch).violations.some((v) => v.ruleId === 'APPSEC_04_SSRF_EGRESS'));
  assert.equal(appsec.evaluateDeterministicAppSec(safeFetch).passed, true);
});

test('Deterministic AppSec: Rule 05 catches unparameterized dynamic SQL/command injection', () => {
  const vulnSql = 'db.query(`SELECT * FROM users WHERE id = ${userId}`);';
  const safeSql = 'db.query("SELECT * FROM users WHERE tenant_id = $1 AND id = $2", [tenantId, userId]);';

  assert.ok(appsec.evaluateDeterministicAppSec(vulnSql).violations.some((v) => v.ruleId === 'APPSEC_05_DYNAMIC_INJECTION'));
  assert.equal(appsec.evaluateDeterministicAppSec(safeSql).passed, true);
});

test('Deterministic AppSec: Rule 06 catches path traversal sequences', () => {
  const vulnPath = 'fs.readFile(path.join(baseDir, "../../etc/passwd"));';
  const safePath = 'fs.readFile(path.resolve(baseDir, "data.json"));';

  assert.ok(appsec.evaluateDeterministicAppSec(vulnPath).violations.some((v) => v.ruleId === 'APPSEC_06_PATH_TRAVERSAL'));
  assert.equal(appsec.evaluateDeterministicAppSec(safePath).passed, true);
});

test('Deterministic AppSec: Rule 07 catches logging of authorization/passwords', () => {
  const vulnLog = 'console.log("Incoming request headers:", req.headers);';
  const safeLog = 'console.log("Request processed for method:", req.method);';

  assert.ok(appsec.evaluateDeterministicAppSec(vulnLog).violations.some((v) => v.ruleId === 'APPSEC_07_TELEMETRY_PII_LEAK'));
  assert.equal(appsec.evaluateDeterministicAppSec(safeLog).passed, true);
});

test('Deterministic AppSec: Rule 08 catches multi-tenant queries missing tenant filtering', () => {
  const vulnQuery = 'SELECT * FROM billing_records WHERE status = "active" LIMIT 10;';
  const safeQuery = 'SELECT * FROM billing_records WHERE tenant_id = $1 AND status = "active";';

  assert.ok(appsec.evaluateDeterministicAppSec(vulnQuery).violations.some((v) => v.ruleId === 'APPSEC_08_TENANT_IDOR'));
  assert.equal(appsec.evaluateDeterministicAppSec(safeQuery).passed, true);
});

test('Deterministic AppSec: Rule 09 catches executable uploads to public roots', () => {
  const vulnUpload = 'destination: "public/uploads/backdoor.sh"';
  const safeUpload = 'destination: "private/storage/report.pdf"';

  assert.ok(appsec.evaluateDeterministicAppSec(vulnUpload).violations.some((v) => v.ruleId === 'APPSEC_09_EXECUTABLE_UPLOAD'));
  assert.equal(appsec.evaluateDeterministicAppSec(safeUpload).passed, true);
});

test('Deterministic AppSec: Rule 10 catches dynamic eval and unsafe deserialization', () => {
  const vulnEval = 'const res = eval(untrustedString);';
  const safeJson = 'const res = JSON.parse(safeString);';

  assert.ok(appsec.evaluateDeterministicAppSec(vulnEval).violations.some((v) => v.ruleId === 'APPSEC_10_INSECURE_DESERIALIZATION'));
  assert.equal(appsec.evaluateDeterministicAppSec(safeJson).passed, true);
});

test('Deterministic AppSec: explainAppSecViolation returns actionable fix for each rule', () => {
  for (let i = 1; i <= 10; i++) {
    const code = `APPSEC_${String(i).padStart(2, '0')}`;
    const explanation = appsec.explainAppSecViolation(code);
    assert.ok(explanation.title);
    assert.ok(explanation.rootCause);
    assert.ok(explanation.fix);
  }
});

// ---------------------------------------------------------------------------
// Rule 01 is bound PER ROUTE, not to the whole file
// ---------------------------------------------------------------------------

test('Deterministic AppSec: Rule 01 does not let one guarded route vouch for an unguarded one', () => {
  // The defect: the auth probe searched the ENTIRE payload. A file holding one
  // protected route plus one unprotected privileged route passed the whole
  // rule, leaving the exact endpoint this guard exists to catch undetected.
  const mixedFile = [
    'app.get("/admin/reports", requireAuth, (req, res) => { res.json(reports); });',
    'app.get("/admin/danger", (req, res) => { res.json(secrets); });',
  ].join('\n');

  const result = appsec.evaluateDeterministicAppSec(mixedFile);
  const unauth = result.violations.filter((v) => v.ruleId === 'APPSEC_01_UNAUTH_ENDPOINT');
  assert.equal(unauth.length, 1, 'exactly the unguarded route is reported');
  assert.match(unauth[0].message, /\/danger/);
  assert.doesNotMatch(unauth[0].message, /\/reports/);
  assert.equal(result.passed, false);
});

test('Deterministic AppSec: Rule 01 reports every unguarded privileged route, not just the first', () => {
  const twoBad = [
    'app.get("/admin/one", (req, res) => { res.end(); });',
    'router.post("/billing/two", (req, res) => { res.end(); });',
  ].join('\n');

  const unauth = appsec.evaluateDeterministicAppSec(twoBad)
    .violations.filter((v) => v.ruleId === 'APPSEC_01_UNAUTH_ENDPOINT');
  assert.equal(unauth.length, 2);
});

test('findPrivilegedRoutes captures only each route own middleware window', () => {
  const routes = appsec.findPrivilegedRoutes([
    'app.get("/admin/a", requireAuth, (req, res) => {});',
    'app.get("/admin/b", (req, res) => {});',
  ].join('\n'));

  assert.equal(routes.length, 2);
  assert.equal(routes[0].path, '/admin/a');
  assert.match(routes[0].middleware, /requireAuth/);
  assert.equal(routes[1].path, '/admin/b');
  assert.doesNotMatch(routes[1].middleware, /requireAuth/, 'the previous route guard must not leak into this window');
});

test('Deterministic AppSec: a guarded privileged route alone stays clean', () => {
  const safe = 'app.get("/admin/reports", ensureAuthenticated, (req, res) => { res.json(reports); });';
  assert.equal(appsec.evaluateDeterministicAppSec(safe).passed, true);
});

// ---------------------------------------------------------------------------
// The CLI must fail the build it is guarding
// ---------------------------------------------------------------------------

test('Deterministic AppSec: --scan-file returns a NONZERO exit code when it blocks', () => {
  // A guard that prints BLOCKED and exits 0 lets a CI preflight continue the
  // deploy on vulnerable input unless the caller separately parses stdout.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-appsec-cli-'));
  const vulnFile = path.join(dir, 'vuln.js');
  const safeFile = path.join(dir, 'safe.js');
  fs.writeFileSync(vulnFile, 'app.get("/admin/x", (req, res) => { res.end(); });\n', 'utf8');
  fs.writeFileSync(safeFile, 'function ok() { return 1; }\n', 'utf8');

  try {
    assert.equal(appsec.mainCli([`--scan-file=${vulnFile}`, '--json']), 1, 'BLOCKED must exit nonzero');
    assert.equal(appsec.mainCli([`--scan-file=${safeFile}`, '--json']), 0, 'PASSED must exit zero');
    assert.equal(appsec.mainCli([`--scan-file=${path.join(dir, 'missing.js')}`]), 1, 'a missing file is a failure');
    assert.equal(appsec.mainCli(['--help']), 0);
    assert.equal(appsec.mainCli(['--test-sample', '--json']), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
