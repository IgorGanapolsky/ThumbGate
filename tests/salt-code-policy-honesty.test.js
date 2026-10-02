'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  POLICY_CATALOG,
  RAIL_MAP,
  evaluatePolicies,
  buildSaltCodePolicyHonestyReport,
  formatSaltCodePolicyHonestyReport,
} = require('../scripts/salt-code-policy-honesty');

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'salt-code-policy-honesty.js');

test('salt-code-policy-honesty: catalog contains 40 distinct policies across 4 tiers', () => {
  assert.equal(POLICY_CATALOG.length, 40);

  const categories = new Set(POLICY_CATALOG.map((p) => p.category));
  assert.ok(categories.has('OWASP_API_TOP_10'));
  assert.ok(categories.has('OWASP_LLM_TOP_10'));
  assert.ok(categories.has('MCP_SECURITY'));
  assert.ok(categories.has('OPENAPI_HYGIENE'));

  const owaspApi = POLICY_CATALOG.filter((p) => p.category === 'OWASP_API_TOP_10');
  const owaspLlm = POLICY_CATALOG.filter((p) => p.category === 'OWASP_LLM_TOP_10');
  const mcpSec = POLICY_CATALOG.filter((p) => p.category === 'MCP_SECURITY');
  const oasHygiene = POLICY_CATALOG.filter((p) => p.category === 'OPENAPI_HYGIENE');

  assert.equal(owaspApi.length, 10);
  assert.equal(owaspLlm.length, 10);
  assert.equal(mcpSec.length, 10);
  assert.equal(oasHygiene.length, 10);
});

test('salt-code-policy-honesty: rail map defines active PreToolUse vs passive prompt injection', () => {
  assert.ok(RAIL_MAP.length >= 4);
  const enforcement = RAIL_MAP.find((r) => r.pillar === 'Enforcement Plane');
  assert.ok(enforcement);
  assert.match(enforcement.saltCode, /prompt-time/i);
  assert.match(enforcement.thumbgate, /PreToolUse/i);
});

test('salt-code-policy-honesty: rejects substitute claims', () => {
  const findings = evaluatePolicies({
    claimText: 'Salt Code replaces ThumbGate for all agent workflows',
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'substitute_claim_refused');
  assert.equal(findings[0].severity, 'fail');
});

test('salt-code-policy-honesty: refuses remote cloud dependency on mcp.getsaltcode.com', () => {
  const mcpText = JSON.stringify({
    mcpServers: {
      saltcode: {
        url: 'https://mcp.getsaltcode.com/mcp',
        transport: 'streamableHttp',
      },
    },
  });
  const findings = evaluatePolicies({ mcpText });
  const depFinding = findings.find((f) => f.id === 'salt_cloud_dependency_refused');
  assert.ok(depFinding);
  assert.equal(depFinding.severity, 'fail');
});

test('salt-code-policy-honesty: flags unredacted plaintext credentials in MCP config', () => {
  const mcpText = JSON.stringify({
    mcpServers: {
      myServer: {
        command: 'node',
        args: ['server.js'],
        env: {
          token: 'ghp_secret_credential_1234567890abcdefghijklmn',
        },
      },
    },
  });
  const findings = evaluatePolicies({ mcpText });
  const secretFinding = findings.find((f) => f.id === 'unredacted_mcp_credentials');
  assert.ok(secretFinding);
  assert.equal(secretFinding.severity, 'fail');
});

test('salt-code-policy-honesty: flags insecure HTTP remote MCP transport', () => {
  const mcpText = JSON.stringify({
    mcpServers: {
      insecureRemote: {
        url: 'http://api.internal.org/mcp',
      },
    },
  });
  const findings = evaluatePolicies({ mcpText });
  const transportFinding = findings.find((f) => f.id === 'insecure_mcp_http_transport');
  assert.ok(transportFinding);
  assert.equal(transportFinding.severity, 'fail');
});

test('salt-code-policy-honesty: flags context-only security instructions lacking PreToolUse', () => {
  const contextText = 'You are an agent. Never delete production databases and do not push to main.';
  const findingsWithoutHook = evaluatePolicies({
    contextText,
    hasPretoolConfig: false,
  });
  const contextFinding = findingsWithoutHook.find(
    (f) => f.id === 'context_injection_without_pretool_enforcement'
  );
  assert.ok(contextFinding);
  assert.equal(contextFinding.severity, 'fail');

  const findingsWithHook = evaluatePolicies({
    contextText,
    hasPretoolConfig: true,
  });
  assert.equal(
    findingsWithHook.some((f) => f.id === 'context_injection_without_pretool_enforcement'),
    false
  );
});

test('salt-code-policy-honesty: flags query-string secret authentication in OpenAPI spec and code', () => {
  const apiSpec = `
    paths:
      /v1/metrics:
        get:
          summary: Fetch metrics
          parameters:
            - name: apiKey
              in: query
              required: true
              example: secret_token_xyz
  `;
  const apiFindings = evaluatePolicies({ apiText: apiSpec });
  const apiSecret = apiFindings.find((f) => f.id === 'query_string_secret_auth');
  assert.ok(apiSecret);
  assert.equal(apiSecret.severity, 'fail');

  const codeSnippet = 'const res = await fetch(`https://api.example.com/data?token=${authToken}`);';
  const codeFindings = evaluatePolicies({ codeText: codeSnippet });
  const codeSecret = codeFindings.find((f) => f.id === 'query_string_secret_auth_code');
  assert.ok(codeSecret);
  assert.equal(codeSecret.severity, 'fail');
});

test('salt-code-policy-honesty: flags BOLA, SSRF, and insecure output execution in code', () => {
  const codeSnippet = `
    app.get('/item/:id', async (req, res) => {
      const item = await db.items.findOne({ id: req.params.id });
      res.json(item);
    });

    app.post('/proxy', async (req, res) => {
      const data = await axios.get(req.body.targetUrl);
      res.send(data);
    });

    app.post('/run-agent', async (req, res) => {
      const result = eval(response.output);
      res.json({ result });
    });
  `;

  const findings = evaluatePolicies({ codeText: codeSnippet });
  assert.ok(findings.some((f) => f.id === 'bola_unscoped_resource'));
  assert.ok(findings.some((f) => f.id === 'ssrf_unvalidated_destination'));
  assert.ok(findings.some((f) => f.id === 'insecure_output_execution'));

  // Preceding or trailing userId scope avoids BOLA false positive
  const scopedCode = `
    app.get('/item/:id', async (req, res) => {
      const item = await db.items.findOne({ userId: req.user.id, id: req.params.id });
      res.json(item);
    });
  `;
  const scopedFindings = evaluatePolicies({ codeText: scopedCode });
  assert.ok(!scopedFindings.some((f) => f.id === 'bola_unscoped_resource'));
});

test('salt-code-policy-honesty: clean code and config produce ready report with zero findings', () => {
  const report = buildSaltCodePolicyHonestyReport({
    codeText: 'function add(a, b) { return a + b; }',
    apiText: 'paths: /health: { get: { responses: { "200": {} } } }',
    mcpText: JSON.stringify({ mcpServers: { local: { command: "node", args: ["server.js"] } } }),
    hasPretoolConfig: true,
  });

  assert.equal(report.status, 'ready');
  assert.equal(report.findings.length, 0);
  assert.equal(report.summary.failCount, 0);
  assert.equal(report.summary.warnCount, 0);
});

test('salt-code-policy-honesty: --map-only returns full taxonomy and rail map', () => {
  const report = buildSaltCodePolicyHonestyReport({ 'map-only': true });
  assert.equal(report.status, 'ready');
  assert.equal(report.policyCount, 40);
  assert.ok(report.railMap.length >= 4);
});

test('salt-code-policy-honesty: formatReport produces expected text sections', () => {
  const report = buildSaltCodePolicyHonestyReport({
    claim: 'Salt Code replaces ThumbGate',
  });
  const formatted = formatSaltCodePolicyHonestyReport(report);
  assert.match(formatted, /=== ThumbGate Salt Code Security Policy Honesty Doctor ===/);
  assert.match(formatted, /Rail Map/);
  assert.match(formatted, /substitute_claim_refused/);
  assert.match(formatted, /Next actions:/);
});

test('salt-code-policy-honesty: CLI execution works via child_process', () => {
  const mapOut = execFileSync(process.execPath, [SCRIPT_PATH, '--map-only', '--json'], {
    encoding: 'utf8',
  });
  const parsedMap = JSON.parse(mapOut);
  assert.equal(parsedMap.policyCount, 40);

  // Strict mode with failure exits 1
  assert.throws(() => {
    execFileSync(
      process.execPath,
      [SCRIPT_PATH, '--claim=Salt Code replaces ThumbGate', '--strict', '--json'],
      { encoding: 'utf8' }
    );
  });
});
