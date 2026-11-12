'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-prompt-guard-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
process.env.THUMBGATE_SECRET_SCAN_PROVIDER = 'heuristic';
delete process.env.THUMBGATE_PROMPT_SECRET_GUARD;

const REPO_ROOT = path.resolve(__dirname, '..');
const {
  PROMPT_SECRET_BLOCK_REASON,
  PROMPT_SECRET_LEDGER_FILENAME,
  evaluatePromptGuard,
} = require('../scripts/prompt-guard');
const {
  buildAwsAccessKeyId,
  buildGitHubPat,
  buildOpenAiLegacyKey,
  buildOpenAiProjectKey,
  buildPemHeader,
} = require('../scripts/secret-fixture-tokens');
const { generateDashboard } = require('../scripts/dashboard');

function buildAnthropicKey() {
  return ['sk', '-ant-', 'api03-', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('');
}

function buildPemBlock() {
  return [
    buildPemHeader('EC '),
    'MHcCAQEEIFakeTestKeyMaterialNotReal0123456789abcdef==',
    ['-----END ', 'EC ', 'PRIVATE KEY-----'].join(''),
  ].join('\n');
}

function assertSecretAbsentFromDir(dirPath, canary) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      assertSecretAbsentFromDir(fullPath, canary);
    } else if (entry.isFile()) {
      const content = fs.readFileSync(fullPath, 'utf8');
      assert.equal(
        content.includes(canary),
        false,
        `secret canary leaked into runtime file ${entry.name}`
      );
    }
  }
}

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('password phrases ("my new <service> password: X", "password: X", "password is: X", "pw X", punctuation-leading passwords) are blocked and never echoed', () => {
  const isolatedDir = fs.mkdtempSync(path.join(tmpDir, 'pw-phrases-'));
  const canaryA = ['Canary', 'Pass', 'Alpha', '987!&*'].join('');
  const canaryB = ['Canary', 'Pass', 'Beta', '654#'].join('');
  const canaryC = ['Canary', 'Pw', 'Gamma', '321$'].join('');
  const canaryD = ['(9;a', ',b|C', 'Delta', '888!'].join('');

  const resService = evaluatePromptGuard(`my new google password: ${canaryA}`, {
    feedbackDir: isolatedDir,
  });
  assert.ok(resService);
  assert.equal(resService.decision, 'block');
  assert.equal(resService.reason, PROMPT_SECRET_BLOCK_REASON);
  assert.equal(resService.continue, false);
  assert.equal(resService.suppressOutput, true);
  assert.equal(JSON.stringify(resService).includes(canaryA), false);

  const resPlain = evaluatePromptGuard(`password: ${canaryB}`, {
    feedbackDir: isolatedDir,
  });
  assert.ok(resPlain);
  assert.equal(resPlain.decision, 'block');
  assert.equal(JSON.stringify(resPlain).includes(canaryB), false);

  const resShort = evaluatePromptGuard(`github pw ${canaryC}`, {
    feedbackDir: isolatedDir,
  });
  assert.ok(resShort);
  assert.equal(resShort.decision, 'block');
  assert.equal(JSON.stringify(resShort).includes(canaryC), false);

  const resSymbolIsColon = evaluatePromptGuard(`my new apple password is: ${canaryD}`, {
    feedbackDir: isolatedDir,
  });
  assert.ok(resSymbolIsColon);
  assert.equal(resSymbolIsColon.decision, 'block');
  assert.equal(JSON.stringify(resSymbolIsColon).includes(canaryD), false);

  for (const canary of [canaryA, canaryB, canaryC, canaryD]) {
    assertSecretAbsentFromDir(isolatedDir, canary);
  }

  const ledgerLines = fs
    .readFileSync(path.join(isolatedDir, PROMPT_SECRET_LEDGER_FILENAME), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.equal(ledgerLines.length, 4);
  assert.equal(ledgerLines[0].type, 'password_phrase');
  assert.equal(ledgerLines[0].serviceGuess, 'google');
  assert.ok(ledgerLines[0].time);
  assert.equal('value' in ledgerLines[0], false);

  assert.equal(ledgerLines[1].type, 'password_phrase');
  assert.equal(ledgerLines[1].serviceGuess, 'unknown');

  assert.equal(ledgerLines[2].type, 'password_phrase');
  assert.equal(ledgerLines[2].serviceGuess, 'github');

  assert.equal(ledgerLines[3].type, 'password_phrase');
  assert.equal(ledgerLines[3].serviceGuess, 'apple');

  const dashboard = generateDashboard(isolatedDir);
  assert.equal(dashboard.secretGuard.blocked, 4);
  assert.equal(dashboard.secretGuard.preventedLeaks, 4);
  assert.equal(dashboard.secretGuard.promptBlocks, 4);
  assert.equal(dashboard.secretGuard.byService.google, 1);
  assert.equal(dashboard.secretGuard.byService.github, 1);
  assert.equal(dashboard.secretGuard.byService.apple, 1);
});

test('known API keys and private key blocks (sk-, ghp_, AKIA, PEM) are blocked and redacted in ledger', () => {
  const isolatedDir = fs.mkdtempSync(path.join(tmpDir, 'api-keys-'));
  const cases = [
    { label: 'sk- legacy', secret: buildOpenAiLegacyKey(), expectedType: 'openai_api_key', expectedService: 'openai' },
    { label: 'sk-proj-', secret: buildOpenAiProjectKey(), expectedType: 'openai_project_key', expectedService: 'openai' },
    { label: 'sk-ant-', secret: buildAnthropicKey(), expectedType: 'anthropic_api_key', expectedService: 'anthropic' },
    { label: 'ghp_', secret: buildGitHubPat(), expectedType: 'github_pat', expectedService: 'github' },
    { label: 'AKIA', secret: buildAwsAccessKeyId(), expectedType: 'aws_access_key', expectedService: 'aws' },
    { label: 'PEM', secret: buildPemBlock(), expectedType: 'private_key_block', expectedService: 'ssh_or_tls' },
  ];

  for (const item of cases) {
    const result = evaluatePromptGuard(`Here is the credential ${item.secret} for debugging`, {
      feedbackDir: isolatedDir,
    });
    assert.ok(result, `expected ${item.label} to be blocked`);
    assert.equal(result.decision, 'block');
    assert.equal(result.reason, PROMPT_SECRET_BLOCK_REASON);
    assert.equal(JSON.stringify(result).includes(item.secret), false);
    assertSecretAbsentFromDir(isolatedDir, item.secret);
  }

  const ledger = fs
    .readFileSync(path.join(isolatedDir, PROMPT_SECRET_LEDGER_FILENAME), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.equal(ledger.length, cases.length);
  for (let i = 0; i < cases.length; i += 1) {
    assert.equal(ledger[i].type, cases[i].expectedType);
    assert.equal(ledger[i].serviceGuess, cases[i].expectedService);
  }
});

test('benign password discussion prompts pass without false positives', () => {
  const safePrompts = [
    'I need to reset my password',
    'password reset',
    'change your password',
    'Please add a password reset link to the login page.',
    'my google password is expired, how do I rotate OAuth tokens?',
    'Put it in your password manager or macOS Keychain instead.',
    'interface AuthForm { email: string; password: string; }',
    'pw reset flow fails on mobile Safari',
  ];

  for (const prompt of safePrompts) {
    const result = evaluatePromptGuard(prompt);
    assert.equal(result, null, `expected benign prompt to pass: "${prompt}"`);
  }
});

test('THUMBGATE_PROMPT_SECRET_GUARD=off disables prompt secret blocking', () => {
  const prev = process.env.THUMBGATE_PROMPT_SECRET_GUARD;
  process.env.THUMBGATE_PROMPT_SECRET_GUARD = 'off';
  try {
    const canary = ['Disabled', 'Flag', 'Secret', '777!'].join('');
    const result = evaluatePromptGuard(`my new google password: ${canary}`);
    assert.equal(result, null);
    assert.equal(evaluatePromptGuard(`token ${buildGitHubPat()}`), null);
  } finally {
    if (prev === undefined) delete process.env.THUMBGATE_PROMPT_SECRET_GUARD;
    else process.env.THUMBGATE_PROMPT_SECRET_GUARD = prev;
  }
});

test('UserPromptSubmit CLI hook (hook-auto-capture, prompt-guard.js, egm-task-wrapper.js) blocks stdin JSON secret without writing conversation history', () => {
  const hookFeedbackDir = fs.mkdtempSync(path.join(tmpDir, 'cli-hook-'));
  const canary = ['Live', 'Hook', 'Canary', '2026&*'].join('');
  const stdinPayload = JSON.stringify({
    session_id: 'sess_test_1',
    hook_event_name: 'UserPromptSubmit',
    cwd: REPO_ROOT,
    prompt: `pw ${canary}`,
  });

  const cliRun = spawnSync(process.execPath, [path.join(REPO_ROOT, 'bin', 'cli.js'), 'hook-auto-capture'], {
    input: stdinPayload,
    encoding: 'utf8',
    env: {
      ...process.env,
      THUMBGATE_FEEDBACK_DIR: hookFeedbackDir,
      THUMBGATE_PROMPT_SECRET_GUARD: 'on',
    },
  });

  assert.equal(cliRun.status, 0);
  assert.equal(cliRun.stdout.includes(canary), false);
  assert.equal(cliRun.stderr.includes(canary), false);
  const parsed = JSON.parse(cliRun.stdout.trim());
  assert.equal(parsed.decision, 'block');
  assert.equal(parsed.reason, PROMPT_SECRET_BLOCK_REASON);

  assertSecretAbsentFromDir(hookFeedbackDir, canary);
  assert.equal(
    fs.existsSync(path.join(hookFeedbackDir, 'conversation-window.jsonl')),
    false,
    'blocked secret prompt must never be persisted to conversation-window.jsonl'
  );

  const directRun = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'prompt-guard.js')], {
    input: stdinPayload,
    encoding: 'utf8',
    env: {
      ...process.env,
      THUMBGATE_FEEDBACK_DIR: hookFeedbackDir,
      THUMBGATE_PROMPT_SECRET_GUARD: 'on',
    },
  });
  assert.equal(directRun.status, 0);
  const directParsed = JSON.parse(directRun.stdout.trim());
  assert.equal(directParsed.decision, 'block');
  assert.equal(directParsed.reason, PROMPT_SECRET_BLOCK_REASON);
  assertSecretAbsentFromDir(hookFeedbackDir, canary);

  const egmRun = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'egm-task-wrapper.js')], {
    input: stdinPayload,
    encoding: 'utf8',
    env: {
      ...process.env,
      THUMBGATE_FEEDBACK_DIR: hookFeedbackDir,
      THUMBGATE_PROMPT_SECRET_GUARD: 'on',
    },
  });
  assert.equal(egmRun.status, 0);
  assert.deepEqual(JSON.parse(egmRun.stdout.trim()), {});
});

test('UserPromptSubmit hook is wired alongside PreToolUse in Claude settings and prompt-hook adapters', () => {
  const claudeSettings = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, '.claude', 'settings.json'), 'utf8')
  );
  assert.ok(Array.isArray(claudeSettings.hooks.PreToolUse));
  assert.ok(Array.isArray(claudeSettings.hooks.UserPromptSubmit));
  assert.ok(
    JSON.stringify(claudeSettings.hooks.UserPromptSubmit).includes('hook-auto-capture'),
    '.claude/settings.json must wire hook-auto-capture on UserPromptSubmit'
  );

  const pluginHooks = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8')
  );
  assert.ok(JSON.stringify(pluginHooks.hooks.UserPromptSubmit).includes('hook-auto-capture'));

  const codexHooks = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, '.codex', 'hooks.json'), 'utf8')
  );
  assert.ok(JSON.stringify(codexHooks.hooks.UserPromptSubmit).includes('hook-auto-capture'));

  const codexTomlAdapters = [
    'adapters/codex/config.toml',
    'adapters/claw/config.toml',
    'adapters/hermes/config.toml',
    'adapters/huggingface-context-course/config.toml',
    'adapters/perplexity/config.toml',
    'adapters/vlt/config.toml',
  ];
  for (const relPath of codexTomlAdapters) {
    const toml = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
    assert.match(toml, /\[hooks\.pre_tool_use\]/, `${relPath} has pre_tool_use`);
    assert.match(toml, /\[hooks\.user_prompt_submit\]/, `${relPath} must wire user_prompt_submit`);
    assert.match(toml, /hook-auto-capture/, `${relPath} must invoke hook-auto-capture`);
  }

  const claudeMcpAdapters = [
    'adapters/claude/.mcp.json',
    'adapters/hermes/.mcp.json',
    'adapters/huggingface-context-course/.mcp.json',
    'adapters/perplexity/.mcp.json',
    'adapters/vlt/.mcp.json',
  ];
  for (const relPath of claudeMcpAdapters) {
    const mcpJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8'));
    assert.ok(mcpJson.hooks?.preToolUse, `${relPath} has hooks.preToolUse`);
    assert.ok(mcpJson.hooks?.userPromptSubmit, `${relPath} must wire hooks.userPromptSubmit`);
    assert.ok(
      JSON.stringify(mcpJson.hooks.userPromptSubmit).includes('hook-auto-capture'),
      `${relPath} must invoke hook-auto-capture`
    );
  }

  const forgeYaml = fs.readFileSync(path.join(REPO_ROOT, 'adapters', 'forge', 'forge.yaml'), 'utf8');
  assert.match(forgeYaml, /trigger:\s*user_prompt/);
  assert.match(forgeYaml, /hook-auto-capture/);
});
