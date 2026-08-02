const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  collectBootstrapFiles,
  summarizePermissionTier,
  summarizeClaimVerification,
  generateAgentReadinessReport,
  reportToText,
} = require('../scripts/agent-readiness');

test('collectBootstrapFiles reports missing required context files', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bootstrap-missing-'));
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Agents\n');

  const readiness = collectBootstrapFiles(projectRoot);

  assert.equal(readiness.ready, false);
  assert.equal(readiness.requiredPresent, 1);
  assert.deepEqual(readiness.missingRequired.sort(), ['.mcp.json', 'CLAUDE.md', 'GEMINI.md']);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test('summarizePermissionTier exposes write-capable default profile', () => {
  const summary = summarizePermissionTier('default');

  assert.equal(summary.profile, 'default');
  assert.equal(summary.tier, 'builder');
  assert.equal(summary.writeCapable, true);
  assert.ok(summary.writeCapableTools.includes('construct_context_pack'));
});

test('summarizePermissionTier warns when locked profile is too restrictive', () => {
  const summary = summarizePermissionTier('locked');

  assert.equal(summary.profile, 'locked');
  assert.equal(summary.ready, false);
  assert.equal(summary.writeCapable, false);
});

test('summarizePermissionTier exposes dispatch as a safe remote ops tier', () => {
  const summary = summarizePermissionTier('dispatch');

  assert.equal(summary.profile, 'dispatch');
  assert.equal(summary.tier, 'dispatch');
  assert.equal(summary.ready, true);
  assert.equal(summary.writeCapable, false);
  assert.ok(summary.allowedTools.includes('dashboard'));
  assert.ok(summary.allowedTools.includes('get_business_metrics'));
  assert.ok(!summary.allowedTools.includes('start_handoff'));
});

test('generateAgentReadinessReport aligns bootstrap and permission findings', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bootstrap-ready-'));
  for (const fileName of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    fs.writeFileSync(path.join(projectRoot, fileName), `# ${fileName}\n`);
  }
  fs.writeFileSync(path.join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2));
  fs.mkdirSync(path.join(projectRoot, '.thumbgate'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.thumbgate', 'config.json'), JSON.stringify({ version: 1 }, null, 2));

  const previousContainer = process.env.container;
  process.env.container = '1';
  const report = generateAgentReadinessReport({
    projectRoot,
    mcpProfile: 'default',
  });
  if (previousContainer === undefined) delete process.env.container;
  else process.env.container = previousContainer;

  assert.equal(report.bootstrap.ready, true);
  assert.equal(report.permissions.profile, 'default');
  assert.equal(report.articleAlignment.contextConditioning, true);
  assert.equal(report.articleAlignment.permissionEnvelope, true);
  assert.equal(report.articleAlignment.runtimeIsolation, true);
  assert.equal(report.claimVerification.evaluatorReady, true);
  assert.equal(report.overallStatus, 'ready');

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test('summarizeClaimVerification reports shipped default verifiers in this repo', () => {
  const summary = summarizeClaimVerification(path.join(__dirname, '..'));
  assert.equal(summary.evaluatorReady, true);
  assert.ok(summary.verifierCount >= 1);
  assert.equal(summary.stopHookRegistered, true);
  assert.equal(summary.ready, true);
  assert.match(summary.recommendation, /ready/i);
});

test('summarizeClaimVerification reports missing evaluator module', () => {
  const summary = summarizeClaimVerification(path.join(__dirname, '..'), {
    resolveEvaluator: () => {
      throw new Error('missing module');
    },
    loadVerifierConfig: () => () => ({ verifiers: [], source: 'none' }),
  });
  assert.equal(summary.evaluatorReady, false);
  assert.equal(summary.ready, false);
  assert.match(summary.recommendation, /missing/i);
});

test('summarizeClaimVerification reports zero verifiers and missing stop hook', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-claim-readiness-'));
  try {
    const noVerifiers = summarizeClaimVerification(projectRoot, {
      resolveEvaluator: () => 'ok',
      loadVerifierConfig: () => () => ({ verifiers: [], source: 'none' }),
    });
    assert.equal(noVerifiers.evaluatorReady, true);
    assert.equal(noVerifiers.verifierCount, 0);
    assert.equal(noVerifiers.stopHookRegistered, false);
    assert.equal(noVerifiers.ready, false);
    assert.match(noVerifiers.recommendation, /No claim verifiers configured/i);

    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo noop' }] }],
      },
    }));
    const noStopHook = summarizeClaimVerification(projectRoot, {
      resolveEvaluator: () => 'ok',
      loadVerifierConfig: () => () => ({ verifiers: [{ id: 'x' }], source: 'test' }),
    });
    assert.equal(noStopHook.verifierCount, 1);
    assert.equal(noStopHook.stopHookRegistered, false);
    assert.match(noStopHook.recommendation, /Stop anti-claim hook is not registered/i);

    fs.writeFileSync(path.join(projectRoot, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'node scripts/hook-stop-anti-claim.js' }] }],
      },
    }));
    const ready = summarizeClaimVerification(projectRoot, {
      resolveEvaluator: () => 'ok',
      loadVerifierConfig: () => () => ({ verifiers: [{ id: 'x' }, { id: 'y' }], source: 'injected' }),
    });
    assert.equal(ready.ready, true);
    assert.equal(ready.stopHookRegistered, true);
    assert.match(ready.recommendation, /2 verifier/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('summarizeClaimVerification fails closed on config load errors and corrupt settings', () => {
  const configError = summarizeClaimVerification(path.join(__dirname, '..'), {
    resolveEvaluator: () => 'ok',
    loadVerifierConfig: () => () => {
      throw new Error('bad config');
    },
  });
  assert.match(configError.recommendation, /failed to load: bad config/);

  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-claim-bad-settings-'));
  try {
    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.claude', 'settings.json'), '{not-json');
    const badSettings = summarizeClaimVerification(projectRoot, {
      resolveEvaluator: () => 'ok',
      loadVerifierConfig: () => () => ({ verifiers: [{ id: 'x' }], source: 'test' }),
    });
    assert.equal(badSettings.stopHookRegistered, false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('reportToText includes claim verification status', () => {
  const report = generateAgentReadinessReport({
    projectRoot: path.join(__dirname, '..'),
    mcpProfile: 'default',
  });
  const text = reportToText(report);
  assert.match(text, /Claim verification:/i);
  assert.match(text, /Evaluator:/i);
  assert.match(text, /Stop hook:/i);
});

test('generateAgentReadinessReport warns when claim verifier config fails to load', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-claim-ready-warn-'));
  try {
    for (const fileName of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
      fs.writeFileSync(path.join(projectRoot, fileName), `# ${fileName}\n`);
    }
    fs.writeFileSync(path.join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    fs.mkdirSync(path.join(projectRoot, '.thumbgate'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.thumbgate', 'config.json'), JSON.stringify({ version: 1 }));

    // Force a load failure through summarizeClaimVerification deps by writing
    // a malformed project config that is discovered first.
    fs.writeFileSync(path.join(projectRoot, '.thumbgate', 'claim-verifiers.json'), '{not-json');

    const previousContainer = process.env.container;
    process.env.container = '1';
    const report = generateAgentReadinessReport({
      projectRoot,
      mcpProfile: 'default',
    });
    if (previousContainer === undefined) delete process.env.container;
    else process.env.container = previousContainer;

    assert.equal(report.claimVerification.configLoadFailed, true);
    assert.equal(report.overallStatus, 'needs_attention');
    assert.ok(report.warnings.some((w) => /failed to load/i.test(w)));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
