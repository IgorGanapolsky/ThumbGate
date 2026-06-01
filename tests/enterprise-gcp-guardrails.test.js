'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const CLI = path.resolve(__dirname, '../bin/cli.js');
const ROOT = path.resolve(__dirname, '..');
const {
  evaluateDialogflowCxWebhook,
  normalizeDialogflowWebhook,
} = require('../scripts/enterprise-gcp-guardrails');
const {
  REQUIRED_APIS,
  buildSetupVertexPlan,
} = require('../scripts/setup-vertex');
const {
  startServer,
} = require('../src/api/server');

function makeTempJson(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-dfcx-test-'));
  const file = path.join(dir, 'webhook.json');
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return { dir, file };
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd || path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      THUMBGATE_NO_NUDGE: '1',
      ...(options.env || {}),
    },
    input: options.input,
  });
}

describe('enterprise GCP Dialogflow CX webhook guardrails', () => {
  test('normalizes Dialogflow CX webhook fulfillment fields', () => {
    const normalized = normalizeDialogflowWebhook({
      sessionInfo: {
        parameters: {
          accountId: 'acct_123',
        },
      },
      fulfillmentInfo: {
        tag: 'lookup-account',
      },
      pageInfo: {
        currentPage: 'projects/p/locations/us-central1/agents/a/flows/f/pages/p',
      },
      languageCode: 'en',
    });

    assert.equal(normalized.source, 'dialogflow-cx-webhook');
    assert.equal(normalized.fulfillmentTag, 'lookup-account');
    assert.equal(normalized.parameters.accountId, 'acct_123');
    assert.equal(normalized.languageCode, 'en');
  });

  test('allows low-risk fulfillment requests', () => {
    const result = evaluateDialogflowCxWebhook({
      sessionInfo: {
        parameters: {
          orderStatus: 'shipped',
        },
      },
      fulfillmentInfo: {
        tag: 'read-order-status',
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.decision, 'allow');
    assert.equal(result.allowed, true);
    assert.equal(result.reasons.length, 0);
    assert.equal(result.response.session_info.parameters.thumbgate_allowed, true);
  });

  test('blocks sensitive high-risk fulfillment before side effects', () => {
    const result = evaluateDialogflowCxWebhook({
      sessionInfo: {
        parameters: {
          cardNumber: '4111 1111 1111 1111',
          amount: 900,
          thumbgatePreviousBlock: true,
        },
      },
      fulfillmentInfo: {
        tag: 'charge-payment-method',
      },
    });

    assert.equal(result.decision, 'block');
    assert.equal(result.allowed, false);
    assert.ok(result.riskScore >= 0.8);
    assert.ok(result.reasons.some((reason) => reason.code === 'sensitive_parameter_name'));
    assert.ok(result.reasons.some((reason) => reason.code === 'high_value_transaction'));
    assert.match(result.response.fulfillment_response.messages[0].text.text[0], /blocked/i);
  });

  test('CLI emits JSON and exits 2 when a webhook should be blocked', () => {
    const { dir, file } = makeTempJson({
      sessionInfo: {
        parameters: {
          ssn: '123-45-6789',
          amount: 1200,
        },
      },
      fulfillmentInfo: {
        tag: 'refund-billing-account',
      },
    });

    try {
      const result = runCli(['enterprise-gcp-webhook', `--input=${file}`, '--json']);
      assert.equal(result.status, 2, result.stderr || result.stdout);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.decision, 'block');
      assert.equal(payload.allowed, false);
      assert.ok(payload.reasons.some((reason) => reason.code === 'sensitive_parameter_name'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('CLI emits Dialogflow CX response envelope for middleware integration', () => {
    const result = runCli(['enterprise-gcp-webhook', '--response'], {
      input: JSON.stringify({
        sessionInfo: {
          parameters: {
            orderStatus: 'pending',
          },
        },
        fulfillmentInfo: {
          tag: 'read-order-status',
        },
      }),
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.session_info.parameters.thumbgate_decision, 'allow');
    assert.equal(payload.session_info.parameters.thumbgate_allowed, true);
    assert.ok(Array.isArray(payload.fulfillment_response.messages));
  });

  test('repository dogfood sample blocks high-risk Dialogflow CX fulfillment', () => {
    const sample = path.join(ROOT, 'docs/examples/dialogflow-cx-high-risk-webhook.json');
    const result = runCli(['enterprise-gcp-webhook', `--input=${sample}`, '--json']);

    assert.equal(result.status, 2, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.decision, 'block');
    assert.equal(payload.allowed, false);
    assert.ok(payload.reasons.some((reason) => reason.code === 'high_risk_fulfillment'));
    assert.ok(payload.reasons.some((reason) => reason.code === 'repeat_attempt'));
  });

  test('setup-vertex command exists and emits a Vertex/Dialogflow setup plan', () => {
    const result = runCli(['setup-vertex', '--project=enterprise-demo', '--billing-account=012345-ABCDEF-012345', '--json'], {
      env: { THUMBGATE_API_KEY: '' },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'setup-vertex');
    assert.equal(payload.mode, 'plan');
    assert.equal(payload.project, 'enterprise-demo');
    assert.equal(payload.budgetUsd, 10);
    assert.deepEqual(payload.requiredApis, Array.from(REQUIRED_APIS));
    assert.match(payload.commands.enableApis, /aiplatform\.googleapis\.com/);
    assert.match(payload.commands.enableApis, /dialogflow\.googleapis\.com/);
    assert.match(payload.commands.budgetCreate, /10USD/);
    assert.match(payload.commands.deploy, /--min-instances=0/);
    assert.match(payload.commands.deploy, /--max-instances=1/);
    assert.match(payload.commands.deploy, /THUMBGATE_API_KEY=<THUMBGATE_API_KEY>/);
    assert.equal(payload.hasApiKey, false);
    assert.equal(payload.webhookPath, '/v1/enterprise/gcp/dialogflow-cx-webhook');
  });

  test('setup-vertex help is discoverable from the CLI', () => {
    const result = runCli(['setup-vertex', '--help']);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Usage: npx thumbgate setup-vertex/);
    assert.match(result.stdout, /Vertex AI \/ Dialogflow CX/);
    assert.match(result.stdout, /THUMBGATE_API_KEY/);
  });

  test('setup-vertex apply refuses missing project before mutating cloud state', () => {
    const calls = [];
    const exitCode = require('../scripts/setup-vertex').runSetupVertex(['--apply', '--json'], {
      print: false,
      runCommand(commandSpec) {
        calls.push(commandSpec);
        return { ok: false, stdout: '', stderr: '', command: commandSpec.cmd, status: 1 };
      },
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(calls.map((call) => call.args.slice(0, 3)), [
      ['config', 'get-value', 'account'],
      ['config', 'get-value', 'project'],
      ['config', 'get-value', 'billing/quota_project'],
    ]);
  });

  test('setup-vertex deploy refuses missing API key before Cloud Run deploy', () => {
    const calls = [];
    const previousApiKey = process.env.THUMBGATE_API_KEY;
    delete process.env.THUMBGATE_API_KEY;
    try {
      const exitCode = require('../scripts/setup-vertex').runSetupVertex(['--project=enterprise-demo', '--deploy', '--json'], {
        print: false,
        runCommand(commandSpec) {
          calls.push(commandSpec);
          return { ok: true, stdout: '', stderr: '', command: commandSpec.cmd, status: 0 };
        },
      });

      assert.equal(exitCode, 1);
      assert.deepEqual(calls.map((call) => call.args.slice(0, 3)), [
        ['config', 'get-value', 'account'],
        ['config', 'get-value', 'project'],
        ['config', 'get-value', 'billing/quota_project'],
      ]);
    } finally {
      if (previousApiKey === undefined) delete process.env.THUMBGATE_API_KEY;
      else process.env.THUMBGATE_API_KEY = previousApiKey;
    }
  });

  test('setup-vertex plan includes required enterprise APIs without executing commands', () => {
    const plan = buildSetupVertexPlan({
      project: 'enterprise-demo',
      billingAccount: '012345-ABCDEF-012345',
      budgetUsd: 10,
    });

    assert.equal(plan.ok, true);
    const requiredApiSet = new Set(plan.requiredApis);
    assert.equal(requiredApiSet.has(REQUIRED_APIS.find((api) => api === 'aiplatform.googleapis.com')), true);
    assert.equal(requiredApiSet.has(REQUIRED_APIS.find((api) => api === 'dialogflow.googleapis.com')), true);
    assert.equal(requiredApiSet.has(REQUIRED_APIS.find((api) => api === 'run.googleapis.com')), true);
    assert.match(plan.commands.dogfood, /enterprise-gcp-webhook/);
  });

  test('hosted Dialogflow CX webhook endpoint returns a CX response envelope', async () => {
    const previousAllowInsecure = process.env.THUMBGATE_ALLOW_INSECURE;
    process.env.THUMBGATE_ALLOW_INSECURE = 'true';
    let started;
    try {
      started = await startServer({ port: 0, host: '127.0.0.1' });
      const response = await fetch(`http://127.0.0.1:${started.port}/v1/enterprise/gcp/dialogflow-cx-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionInfo: {
            parameters: {
              amount: 900,
              cardNumber: '4111 1111 1111 1111',
            },
          },
          fulfillmentInfo: {
            tag: 'charge-payment-method',
          },
        }),
      });
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(payload.session_info.parameters.thumbgate_decision, 'block');
      assert.equal(payload.session_info.parameters.thumbgate_allowed, false);
      assert.ok(Array.isArray(payload.fulfillment_response.messages));
    } finally {
      if (started) {
        await new Promise((resolve, reject) => {
          started.server.close((error) => (error ? reject(error) : resolve()));
        });
      }
      if (previousAllowInsecure === undefined) delete process.env.THUMBGATE_ALLOW_INSECURE;
      else process.env.THUMBGATE_ALLOW_INSECURE = previousAllowInsecure;
    }
  });

  test('README exposes Vertex AI, Dialogflow CX enterprise pilot, and diagrams', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

    assert.match(readme, /Enterprise GCP \/ Vertex AI \/ Dialogflow CX Pilot/);
    assert.match(readme, /Vertex AI Agent Engine/);
    assert.match(readme, /Vertex AI Agent Builder/);
    assert.match(readme, /DFCX/);
    assert.match(readme, /setup-vertex/);
    assert.match(readme, /enterprise-gcp-webhook/);
    assert.match(readme, /dialogflow-cx-webhook-guard\.png/);
    assert.match(readme, /dialogflow-cx-decision-matrix\.png/);

    for (const rel of [
      'docs/diagrams/dialogflow-cx-webhook-guard.png',
      'docs/diagrams/dialogflow-cx-decision-matrix.png',
    ]) {
      assert.equal(fs.existsSync(path.join(ROOT, rel)), true, `${rel} must exist`);
    }
  });
});
