const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  OPENROUTER_BASE_URL,
  buildLauncherEnv,
  loadEnvFiles,
  parseEnvFile,
  resolveAiderCommand,
  resolveTargetConfig,
} = require('../scripts/aider-launch');
const {
  buildChatCompletionsUrl,
  buildSmokeRequest,
} = require('../scripts/aider-smoke');

test('parseEnvFile handles comments, export prefixes, and quotes', () => {
  const parsed = parseEnvFile(`
# comment
export OPENROUTER_API_KEY="sk-test"
AIDER_QWEN3_MODEL='qwen/qwen3-coder'
UNQUOTED=value # trailing comment
`);

  assert.equal(parsed.OPENROUTER_API_KEY, 'sk-test');
  assert.equal(parsed.AIDER_QWEN3_MODEL, 'qwen/qwen3-coder');
  assert.equal(parsed.UNQUOTED, 'value');
});

test('loadEnvFiles merges home then repo env files before explicit env overrides', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-cwd-'));
  const homeConfigDir = path.join(homeDir, '.config', 'mcp-memory-gateway');

  fs.mkdirSync(homeConfigDir, { recursive: true });
  fs.writeFileSync(path.join(homeConfigDir, 'aider.env'), 'SHARED=home\nHOME_ONLY=1\n');
  fs.writeFileSync(path.join(cwd, '.env.aider'), 'SHARED=repo\nREPO_ONLY=1\n');
  fs.writeFileSync(path.join(cwd, '.env.aider.local'), 'SHARED=local\nLOCAL_ONLY=1\n');

  const env = loadEnvFiles({
    cwd,
    homeDir,
    env: {
      SHARED: 'process',
      PROCESS_ONLY: '1',
    },
  });

  assert.equal(env.HOME_ONLY, '1');
  assert.equal(env.REPO_ONLY, '1');
  assert.equal(env.LOCAL_ONLY, '1');
  assert.equal(env.PROCESS_ONLY, '1');
  assert.equal(env.SHARED, 'process');
});

test('resolveTargetConfig defaults qwen3 to direct OpenRouter', () => {
  const config = resolveTargetConfig('qwen3', {
    OPENROUTER_API_KEY: 'sk-test',
  });

  assert.equal(config.mode, 'direct');
  assert.equal(config.apiBase, OPENROUTER_BASE_URL);
  assert.equal(config.apiKey, 'sk-test');
  assert.equal(config.model, 'qwen/qwen3-coder');
});

test('resolveTargetConfig defaults kimi and architect to direct OpenRouter', () => {
  const kimiConfig = resolveTargetConfig('kimi', {
    OPENROUTER_API_KEY: 'sk-test',
  });
  const architectConfig = resolveTargetConfig('architect', {
    OPENROUTER_API_KEY: 'sk-test',
  });

  assert.equal(kimiConfig.model, 'moonshotai/kimi-k2-thinking');
  assert.equal(architectConfig.model, 'moonshotai/kimi-k2-thinking');
});

test('resolveTargetConfig uses gateway aliases when AIDER_API_BASE is set', () => {
  const qwenConfig = resolveTargetConfig('qwen3', {
    AIDER_API_BASE: 'http://127.0.0.1:4000/v1',
    AIDER_API_KEY: 'litellm-master-key',
  });
  const kimiConfig = resolveTargetConfig('kimi', {
    AIDER_API_BASE: 'http://127.0.0.1:4000/v1',
    AIDER_API_KEY: 'litellm-master-key',
  });

  assert.equal(qwenConfig.mode, 'gateway');
  assert.equal(qwenConfig.model, 'qwen3-dev');
  assert.equal(kimiConfig.model, 'kimi-2.5-dev');
});

test('resolveTargetConfig honors target-specific direct provider env vars', () => {
  const config = resolveTargetConfig('qwen3', {
    AIDER_API_BASE: 'http://127.0.0.1:4000/v1',
    AIDER_API_KEY: 'litellm-master-key',
    AIDER_QWEN3_API_BASE: 'https://example.com/v1',
    AIDER_QWEN3_API_KEY: 'direct-key',
    AIDER_QWEN3_MODEL: 'custom-qwen3',
  });

  assert.equal(config.mode, 'direct');
  assert.equal(config.apiBase, 'https://example.com/v1');
  assert.equal(config.apiKey, 'direct-key');
  assert.equal(config.model, 'custom-qwen3');
});

test('buildLauncherEnv maps resolved config to OpenAI-compatible env vars', () => {
  const env = buildLauncherEnv(
    { KEEP_ME: 'yes' },
    {
      apiBase: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
    }
  );

  assert.equal(env.KEEP_ME, 'yes');
  assert.equal(env.OPENAI_BASE_URL, 'https://openrouter.ai/api/v1');
  assert.equal(env.OPENAI_API_KEY, 'sk-test');
});

test('resolveAiderCommand prefers aider on PATH', () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-bin-'));
  const aiderPath = path.join(binDir, 'aider');
  fs.writeFileSync(aiderPath, '#!/bin/sh\n');
  fs.chmodSync(aiderPath, 0o755);

  const command = resolveAiderCommand({
    PATH: binDir,
  });

  assert.equal(command.command, 'aider');
  assert.deepEqual(command.args, []);
});

test('resolveAiderCommand falls back to uvx when aider is unavailable', () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uvx-bin-'));
  const uvxPath = path.join(binDir, 'uvx');
  fs.writeFileSync(uvxPath, '#!/bin/sh\n');
  fs.chmodSync(uvxPath, 0o755);

  const command = resolveAiderCommand({
    PATH: binDir,
  });

  assert.equal(command.command, 'uvx');
  assert.deepEqual(command.args, ['--from', 'aider-chat', 'aider']);
});

test('buildChatCompletionsUrl normalizes base URLs', () => {
  assert.equal(
    buildChatCompletionsUrl('https://openrouter.ai/api/v1'),
    'https://openrouter.ai/api/v1/chat/completions'
  );
  assert.equal(
    buildChatCompletionsUrl('https://openrouter.ai/api'),
    'https://openrouter.ai/api/v1/chat/completions'
  );
});

test('buildSmokeRequest uses the resolved model and ping payload', () => {
  const request = buildSmokeRequest('qwen3', {
    OPENROUTER_API_KEY: 'sk-test',
  });

  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(request.headers.authorization, 'Bearer sk-test');
  assert.equal(request.body.model, 'qwen/qwen3-coder');
  assert.deepEqual(request.body.messages, [{ role: 'user', content: 'Reply with the single word pong.' }]);
  assert.equal(request.body.max_tokens, 16);
  assert.equal(request.body.temperature, 0);
});
