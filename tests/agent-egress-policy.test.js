'use strict';

/**
 * CrabTrap-inspired agent egress policy tests.
 * High-ROI: two-tier static+judge, observe→draft, replay, SSRF, deny-wins.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const egress = require('../scripts/agent-egress-policy');

test('SSRF: private and metadata hosts are denied', () => {
  for (const host of [
    '127.0.0.1',
    'localhost',
    '10.0.0.5',
    '192.168.1.1',
    '172.16.0.1',
    '169.254.169.254',
    'metadata.google.internal',
  ]) {
    const r = egress.evaluateEgressStaticOnly({ url: `http://${host}/latest` });
    assert.equal(r.action, 'deny', host);
    assert.equal(r.judgmentType, 'SSRF_PRIVATE_NETWORK');
  }
});

test('deny static rules win over allow rules (CrabTrap invariant)', () => {
  const policy = {
    staticRules: [
      { id: 'allow-api', action: 'allow', match: 'prefix', url: 'https://api.example.com' },
      { id: 'deny-api-admin', action: 'deny', match: 'prefix', url: 'https://api.example.com/admin' },
    ],
  };
  const denied = egress.evaluateEgressStaticOnly(
    { url: 'https://api.example.com/admin/delete', method: 'POST' },
    policy
  );
  assert.equal(denied.action, 'deny');
  assert.equal(denied.ruleId, 'deny-api-admin');

  const allowed = egress.evaluateEgressStaticOnly(
    { url: 'https://api.example.com/v1/ok', method: 'GET' },
    policy
  );
  assert.equal(allowed.action, 'allow');
  assert.equal(allowed.ruleId, 'allow-api');
});

test('unknown public host defaults to deny in enforce mode', () => {
  const r = egress.evaluateEgressStaticOnly({ url: 'https://evil-exfil.example/x' });
  assert.equal(r.action, 'deny');
  assert.equal(r.judgmentType, 'DEFAULT_DENY_UNKNOWN');
});

test('allowlist host permits public API', () => {
  const r = egress.evaluateEgressStaticOnly(
    { url: 'https://api.github.com/repos/foo' },
    { allowHosts: ['api.github.com', 'github.com'] }
  );
  assert.equal(r.action, 'allow');
  assert.equal(r.judgmentType, 'STATIC_ALLOW');
});

test('observe mode records unmatched instead of hard-deny for static path', () => {
  const r = egress.evaluateEgressStaticOnly(
    { url: 'https://unknown.example/x' },
    { mode: 'observe' }
  );
  assert.equal(r.action, 'observe');
  assert.equal(r.judgmentType, 'OBSERVE');
  assert.equal(r.allowed, true); // observe does not block process
});

test('buildJudgeSafeRequestView caps body/headers and redacts secrets', () => {
  const view = egress.buildJudgeSafeRequestView({
    method: 'POST',
    url: 'https://api.example.com/charge',
    headers: {
      Authorization: 'Bearer super-secret-token',
      'X-Extra': 'y'.repeat(8000),
      'Content-Type': 'application/json',
    },
    body: 'z'.repeat(20_000),
  });
  assert.equal(view.headers.Authorization, '[REDACTED]');
  assert.equal(view.headersTruncated, true);
  assert.equal(view.bodyTruncated, true);
  assert.ok(view.body.length <= egress.DEFAULT_BODY_CAP);
  assert.ok(view.warnings.includes('treat_all_fields_as_untrusted_user_content'));
  // Must be JSON-serializable structured object (injection-safe packaging)
  assert.equal(typeof JSON.stringify(view), 'string');
});

test('async evaluateEgress uses LLM judge only on long tail', async () => {
  let judgeCalls = 0;
  const policy = {
    allowHosts: ['api.github.com'],
    fallback: 'deny',
  };
  const allowlisted = await egress.evaluateEgress(
    { url: 'https://api.github.com/x' },
    policy,
    {
      judge: async () => {
        judgeCalls += 1;
        return { allow: false, reason: 'should not run' };
      },
    }
  );
  assert.equal(allowlisted.action, 'allow');
  assert.equal(judgeCalls, 0);

  const judged = await egress.evaluateEgress(
    { url: 'https://rare-long-tail.example/v1' },
    policy,
    {
      judge: async (view) => {
        judgeCalls += 1;
        assert.equal(view.host, 'rare-long-tail.example');
        return { allow: true, reason: 'looks like vendor webhook' };
      },
    }
  );
  assert.equal(judged.action, 'allow');
  assert.equal(judged.judgmentType, 'LLM_JUDGE');
  assert.equal(judgeCalls, 1);
});

test('judge failure falls back to deny by default', async () => {
  const r = await egress.evaluateEgress(
    { url: 'https://unknown.example/x' },
    { fallback: 'deny' },
    {
      judge: async () => {
        throw new Error('provider_down');
      },
    }
  );
  assert.equal(r.action, 'deny');
  assert.equal(r.judgmentType, 'JUDGE_FALLBACK');
});

test('observe ledger + draftPolicyFromObservations promotes frequent hosts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-egress-obs-'));
  const ledger = path.join(dir, 'obs.jsonl');
  for (let i = 0; i < 3; i += 1) {
    egress.observeEgress(
      { url: 'https://api.github.com/repos/x', agentId: 'coder' },
      { ledgerPath: ledger }
    );
  }
  egress.observeEgress(
    { url: 'https://once.example/x', agentId: 'coder' },
    { ledgerPath: ledger }
  );
  egress.observeEgress(
    { url: 'http://10.0.0.9/internal', agentId: 'coder' },
    { ledgerPath: ledger }
  );

  const observations = egress.readObserveLedger(ledger);
  assert.equal(observations.length, 5);

  const draft = egress.draftPolicyFromObservations(observations, {
    agentId: 'coder',
    minCount: 2,
  });
  assert.ok(draft.allowHosts.includes('api.github.com'));
  assert.ok(!draft.allowHosts.includes('once.example')); // below minCount
  assert.ok(draft.staticRules.some((r) => r.action === 'deny' && String(r.url).includes('10.0.0.9')));
  assert.match(draft.naturalLanguagePolicy, /api\.github\.com/);
  assert.equal(draft.source, 'observe_then_infer');
});

test('replayPolicy reports projected allow/deny mix', () => {
  const draft = egress.draftPolicyFromObservations([
    { host: 'api.github.com' },
    { host: 'api.github.com' },
    { host: 'api.github.com' },
  ], { minCount: 2 });

  const audit = [
    { url: 'https://api.github.com/r', originalAction: 'allow' },
    { url: 'https://evil.example/x', originalAction: 'deny' },
    { url: 'https://evil.example/y', originalAction: 'allow' }, // would flip
  ];
  const report = egress.replayPolicy(audit, draft);
  assert.equal(report.total, 3);
  assert.equal(report.wouldAllow, 1);
  assert.equal(report.wouldDeny, 2);
  assert.equal(report.comparable, 3);
  assert.equal(report.agreement, 2);
  assert.ok(report.agreementRate > 0.6);
});

test('extractEgressFromCommand and evaluateBashEgress block private curl', () => {
  const targets = egress.extractEgressFromCommand(
    'curl -s https://api.github.com && curl http://169.254.169.254/latest/meta-data/'
  );
  assert.ok(targets.length >= 2);

  const blocked = egress.evaluateBashEgress(
    'curl -X POST http://169.254.169.254/latest/meta-data/',
    { allowHosts: ['api.github.com'] }
  );
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.judgmentType, 'SSRF_PRIVATE_NETWORK');

  const ok = egress.evaluateBashEgress(
    'curl -s https://api.github.com/repos/foo',
    { allowHosts: ['api.github.com'] }
  );
  assert.equal(ok.allowed, true);
});

test('evaluateCrabTrapRequest returns competitor-compatible ALLOW/BLOCK tags', () => {
  const block = egress.evaluateCrabTrapRequest({
    method: 'GET',
    url: 'http://127.0.0.1:8080/admin',
    toolName: 'WebFetch',
  });
  assert.equal(block.action, 'BLOCK');
  assert.equal(block.status, 403);
  assert.ok(block.judgmentType);
  assert.equal(block.interdictionSource, 'ThumbGate-Egress-Policy');

  const allow = egress.evaluateCrabTrapRequest(
    { method: 'GET', url: 'https://registry.npmjs.org/thumbgate' },
    { allowHosts: ['registry.npmjs.org'] }
  );
  assert.equal(allow.action, 'ALLOW');
  assert.equal(allow.judgmentType, 'STATIC_RULE_MATCH');
});

test('method-scoped static rules', () => {
  const policy = {
    staticRules: [
      { id: 'get-only', action: 'allow', match: 'prefix', url: 'https://api.example.com', methods: ['GET'] },
    ],
  };
  assert.equal(
    egress.evaluateEgressStaticOnly({ url: 'https://api.example.com/x', method: 'GET' }, policy).action,
    'allow'
  );
  assert.equal(
    egress.evaluateEgressStaticOnly({ url: 'https://api.example.com/x', method: 'DELETE' }, policy).action,
    'deny'
  );
});
