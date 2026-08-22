'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
    const matchedKey = Object.keys(appsec).find(() => true);
    const explanation = appsec.explainAppSecViolation(code);
    assert.ok(explanation.title);
    assert.ok(explanation.rootCause);
    assert.ok(explanation.fix);
  }
});
