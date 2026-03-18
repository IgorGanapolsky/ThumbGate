#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODELS = {
  qwen3: 'qwen/qwen3-coder',
  kimi: 'moonshotai/kimi-k2-thinking',
  architect: 'moonshotai/kimi-k2-thinking',
};
const DEFAULT_GATEWAY_MODELS = {
  qwen3: 'qwen3-dev',
  kimi: 'kimi-2.5-dev',
  architect: 'kimi-2.5-dev',
};

function parseEnvFile(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }

    values[key] = value;
  }

  return values;
}

function getEnvFilePaths(homeDir = os.homedir(), cwd = process.cwd()) {
  return [
    path.join(homeDir, '.config', 'mcp-memory-gateway', 'aider.env'),
    path.join(cwd, '.env.aider'),
    path.join(cwd, '.env.aider.local'),
  ];
}

function loadEnvFiles(options = {}) {
  const cwd = options.cwd || process.cwd();
  const homeDir = options.homeDir || os.homedir();
  const explicitEnv = options.env || process.env;
  const merged = {};

  for (const filePath of getEnvFilePaths(homeDir, cwd)) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    Object.assign(merged, parseEnvFile(fs.readFileSync(filePath, 'utf-8')));
  }

  return { ...merged, ...explicitEnv };
}

function isLinkedWorktree(cwd = process.cwd()) {
  const gitPath = path.join(cwd, '.git');
  if (!fs.existsSync(gitPath)) {
    return false;
  }
  return fs.lstatSync(gitPath).isFile();
}

function assertLinkedWorktree(cwd = process.cwd()) {
  if (!isLinkedWorktree(cwd)) {
    throw new Error(
      'Refusing to launch from the repository primary checkout. Use a dedicated linked git worktree.'
    );
  }
}

function findExecutableInPath(executable, envPath = process.env.PATH || '') {
  const candidates = process.platform === 'win32'
    ? [executable, `${executable}.cmd`, `${executable}.exe`]
    : [executable];

  for (const directory of envPath.split(path.delimiter).filter(Boolean)) {
    for (const candidate of candidates) {
      const candidatePath = path.join(directory, candidate);
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}

function splitCommand(command) {
  return command.trim().split(/\s+/).filter(Boolean);
}

function resolveAiderCommand(env = process.env) {
  if (env.AIDER_BIN) {
    const [command, ...args] = splitCommand(env.AIDER_BIN);
    return { command, args };
  }

  if (findExecutableInPath('aider', env.PATH)) {
    return { command: 'aider', args: [] };
  }

  if (findExecutableInPath('uvx', env.PATH)) {
    return { command: 'uvx', args: ['--from', 'aider-chat', 'aider'] };
  }

  throw new Error('Could not find `aider` or `uvx` in PATH. Install Aider or set AIDER_BIN.');
}

function resolveTarget(name) {
  const normalized = (name || 'qwen3').trim().toLowerCase();

  if (normalized === 'qwen3' || normalized === 'kimi' || normalized === 'architect') {
    return normalized;
  }

  throw new Error(`Unsupported Aider target: ${name}`);
}

function hasDirectTargetConfig(target, env) {
  const prefix = `AIDER_${target.toUpperCase()}_`;
  return Boolean(env[`${prefix}API_BASE`] || env[`${prefix}API_KEY`]);
}

function detectGateway(target, env) {
  const apiBase = env.AIDER_API_BASE || env.LITELLM_API_BASE;
  const apiKey = env.AIDER_API_KEY || env.LITELLM_MASTER_KEY;
  return Boolean(apiBase && apiKey && !hasDirectTargetConfig(target, env));
}

function normalizeModelForApiBase(model, apiBase) {
  if (!model) {
    return model;
  }
  if (apiBase && /openrouter\.ai\/api\/v1\/?$/.test(apiBase) && model.startsWith('openrouter/')) {
    return model.slice('openrouter/'.length);
  }
  return model;
}

function resolveTargetConfig(targetName, env = process.env) {
  const target = resolveTarget(targetName);
  const upperTarget = target.toUpperCase();

  if (detectGateway(target, env)) {
    const gatewayBase = env.AIDER_API_BASE || env.LITELLM_API_BASE;
    const gatewayKey = env.AIDER_API_KEY || env.LITELLM_MASTER_KEY;
    const defaultModel = target === 'architect'
      ? (env.AIDER_ARCHITECT_GATEWAY_MODEL || env.AIDER_KIMI_GATEWAY_MODEL || DEFAULT_GATEWAY_MODELS[target])
      : DEFAULT_GATEWAY_MODELS[target];

    return {
      target,
      mode: 'gateway',
      apiBase: gatewayBase,
      apiKey: gatewayKey,
      model: env[`AIDER_${upperTarget}_GATEWAY_MODEL`] || defaultModel,
    };
  }

  const apiBase = env[`AIDER_${upperTarget}_API_BASE`] || OPENROUTER_BASE_URL;
  const apiKey = env[`AIDER_${upperTarget}_API_KEY`] || env.OPENROUTER_API_KEY || env.OPENAI_API_KEY;
  const defaultModel = target === 'architect'
    ? (env.AIDER_ARCHITECT_MODEL || env.AIDER_KIMI_MODEL || DEFAULT_MODELS[target])
    : DEFAULT_MODELS[target];
  const model = env[`AIDER_${upperTarget}_MODEL`] || defaultModel;

  return {
    target,
    mode: 'direct',
    apiBase,
    apiKey,
    model: normalizeModelForApiBase(model, apiBase),
  };
}

function buildLauncherEnv(env = process.env, targetConfig) {
  return {
    ...env,
    OPENAI_BASE_URL: targetConfig.apiBase,
    OPENAI_API_KEY: targetConfig.apiKey,
  };
}

function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  assertLinkedWorktree(cwd);

  const [targetArg, ...extraArgs] = argv;
  const target = resolveTarget(targetArg);
  const loadedEnv = loadEnvFiles({ cwd, env: process.env });
  const targetConfig = resolveTargetConfig(target, loadedEnv);

  if (!targetConfig.apiKey) {
    throw new Error(`No API key configured for Aider target \`${target}\`.`);
  }

  const launcherEnv = buildLauncherEnv(loadedEnv, targetConfig);
  const aiderCommand = resolveAiderCommand(launcherEnv);
  const child = spawn(
    aiderCommand.command,
    [...aiderCommand.args, '--model', targetConfig.model, ...extraArgs],
    {
      cwd,
      env: launcherEnv,
      stdio: 'inherit',
    }
  );

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code || 0);
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_GATEWAY_MODELS,
  DEFAULT_MODELS,
  OPENROUTER_BASE_URL,
  assertLinkedWorktree,
  buildLauncherEnv,
  detectGateway,
  findExecutableInPath,
  getEnvFilePaths,
  isLinkedWorktree,
  loadEnvFiles,
  normalizeModelForApiBase,
  parseEnvFile,
  resolveAiderCommand,
  resolveTarget,
  resolveTargetConfig,
};
