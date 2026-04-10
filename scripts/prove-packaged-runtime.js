#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_PUBLISH_INSTALL_RETRIES = 6;
const DEFAULT_PUBLISH_INSTALL_DELAY_MS = 5000;
const MAX_PUBLISH_INSTALL_DELAY_MS = 30000;
const STATUSLINE_INPUT = JSON.stringify({ context_window: { used_percentage: 12 } });

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=');
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = inlineValue !== undefined ? inlineValue : argv[index + 1];
    parsed[key] = value;
    if (inlineValue === undefined) index += 1;
  }
  return parsed;
}

function pkgVersion() {
  return require(path.join(ROOT, 'package.json')).version;
}

function packCurrentRepo(packDir) {
  fs.mkdirSync(packDir, { recursive: true });
  const output = execFileSync('npm', ['pack', '--json', '--pack-destination', packDir], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(output);
  const fileName = parsed && parsed[0] && parsed[0].filename;
  if (!fileName) {
    throw new Error('npm pack did not return a tarball filename');
  }
  return path.join(packDir, fileName);
}

function installPackage(prefixDir, packageSpec) {
  fs.mkdirSync(prefixDir, { recursive: true });
  execFileSync('npm', ['install', '--prefix', prefixDir, '--no-fund', '--no-audit', packageSpec], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return path.join(prefixDir, 'node_modules', '.bin', 'thumbgate');
}

function isRemotePackageSpec(packageSpec) {
  if (!packageSpec) return false;
  return !/^(?:\.{0,2}\/|\/|file:)/.test(packageSpec) && !packageSpec.endsWith('.tgz');
}

function isTransientRegistryMiss(error) {
  const text = [
    error && error.message,
    error && error.stdout,
    error && error.stderr,
  ]
    .filter(Boolean)
    .join('\n');
  return /ETARGET|No matching version found|npm error code E404|404 Not Found/i.test(text);
}

async function installPackageWithRetry(prefixDir, packageSpec, options = {}) {
  const installImpl = options.installImpl || installPackage;
  const sleepImpl = options.sleepImpl || sleep;
  const remotePackage = options.remotePackage !== undefined ? options.remotePackage : isRemotePackageSpec(packageSpec);
  const attempts = remotePackage ? Number(options.attempts || DEFAULT_PUBLISH_INSTALL_RETRIES) : 1;
  let delayMs = Number(options.delayMs || DEFAULT_PUBLISH_INSTALL_DELAY_MS);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      fs.rmSync(prefixDir, { recursive: true, force: true });
    }
    try {
      return installImpl(prefixDir, packageSpec);
    } catch (error) {
      lastError = error;
      const retryable = remotePackage && isTransientRegistryMiss(error) && attempt < attempts;
      if (!retryable) {
        throw error;
      }
      process.stderr.write(
        `Retrying published package install for ${packageSpec} after transient registry miss (${attempt}/${attempts - 1})\n`
      );
      await sleepImpl(delayMs);
      delayMs = Math.min(Math.round(delayMs * 1.5), MAX_PUBLISH_INSTALL_DELAY_MS);
    }
  }

  throw lastError || new Error(`Failed to install package ${packageSpec}`);
}

function request(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timed out requesting ${url}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function waitForHealthy(origin, expectedVersion, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await request(`${origin}/health`);
      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        if (body.version === expectedVersion) {
          return body;
        }
      }
    } catch {
      // Keep polling until the detached API server comes online.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for packaged runtime health at ${origin}`);
}

function renderStatusline(runtimeBin, projectDir, env) {
  return execFileSync(runtimeBin, ['statusline-render'], {
    cwd: projectDir,
    env,
    encoding: 'utf8',
    input: STATUSLINE_INPUT,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  });
}

function runtimeStatePath(homeDir) {
  return path.join(homeDir, '.thumbgate', 'runtime', 'statusline-api.json');
}

async function stopDetachedRuntime(homeDir) {
  try {
    const state = JSON.parse(fs.readFileSync(runtimeStatePath(homeDir), 'utf8'));
    const pid = Number(state && state.pid);
    if (!Number.isInteger(pid) || pid <= 0) return;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await sleep(100);
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Ignore cleanup races.
    }
  } catch {
    // No runtime state means nothing to clean up.
  }
}

async function runPackagedRuntimeSmoke(options = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-packaged-runtime-'));
  const homeDir = path.join(tempRoot, 'home');
  const projectDir = path.join(tempRoot, 'project');
  const packDir = path.join(tempRoot, 'pack');
  const runtimeDir = path.join(tempRoot, 'runtime');
  const expectedVersion = options.expectedVersion || pkgVersion();
  const feedbackDir = path.join(projectDir, '.thumbgate');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.writeFileSync(
    path.join(feedbackDir, 'feedback-log.jsonl'),
    [
      JSON.stringify({ signal: 'positive', timestamp: '2026-04-08T20:00:00.000Z', context: 'packaged runtime smoke pass' }),
      JSON.stringify({ signal: 'negative', timestamp: '2026-04-08T20:01:00.000Z', context: 'packaged runtime smoke fail path' }),
    ].join('\n') + '\n'
  );

  try {
    const packageSpec = options.packageSpec || packCurrentRepo(packDir);
    const runtimeBin = await installPackageWithRetry(runtimeDir, packageSpec, {
      attempts: options.installAttempts,
      delayMs: options.installDelayMs,
    });
    if (!fs.existsSync(runtimeBin)) {
      throw new Error(`Installed runtime binary is missing: ${runtimeBin}`);
    }

    const port = await getAvailablePort();
    const origin = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      HOME: homeDir,
      THUMBGATE_PROJECT_DIR: projectDir,
      THUMBGATE_LOCAL_API_ORIGIN: origin,
      THUMBGATE_API_KEY: 'tg_packaged_runtime_smoke',
      NO_COLOR: '1',
    };

    const initialStatusline = renderStatusline(runtimeBin, projectDir, env);
    if (!initialStatusline.includes(`ThumbGate v${expectedVersion}`)) {
      throw new Error(`Statusline version mismatch before boot: ${initialStatusline.trim()}`);
    }
    if (!/(Dashboard|Dashboard…)/.test(initialStatusline) || !/(Lessons|Lessons…)/.test(initialStatusline)) {
      throw new Error(`Statusline missing dashboard affordances before boot: ${initialStatusline.trim()}`);
    }

    const health = await waitForHealthy(origin, expectedVersion, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
    const dashboard = await request(`${origin}/dashboard`);
    const lessons = await request(`${origin}/lessons`);
    if (dashboard.statusCode !== 200) {
      throw new Error(`Packaged dashboard returned ${dashboard.statusCode}`);
    }
    if (lessons.statusCode !== 200) {
      throw new Error(`Packaged lessons returned ${lessons.statusCode}`);
    }

    const readyStatusline = renderStatusline(runtimeBin, projectDir, env);
    if (!/(Dashboard|Dashboard…)/.test(readyStatusline)) {
      throw new Error(`Ready statusline missing dashboard label: ${readyStatusline.trim()}`);
    }
    if (!/(Lessons|Lessons…)/.test(readyStatusline)) {
      throw new Error(`Ready statusline missing lessons label: ${readyStatusline.trim()}`);
    }
    if (readyStatusline.includes(`${origin}/dashboard`)) {
      throw new Error(`Ready statusline leaked dashboard URL: ${readyStatusline.trim()}`);
    }
    if (readyStatusline.includes(`${origin}/lessons`)) {
      throw new Error(`Ready statusline leaked lessons URL: ${readyStatusline.trim()}`);
    }
    // Thumbs-up/down icons stay inline while dashboard + lessons remain compact
    // labels, even after the local API is up.
    if (!readyStatusline.includes('👍')) {
      throw new Error(`Ready statusline missing thumbs-up icon: ${readyStatusline.trim()}`);
    }
    if (!readyStatusline.includes('👎')) {
      throw new Error(`Ready statusline missing thumbs-down icon: ${readyStatusline.trim()}`);
    }

    return {
      packageSpec,
      expectedVersion,
      origin,
      health,
    };
  } finally {
    await stopDetachedRuntime(homeDir);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs();
  const result = await runPackagedRuntimeSmoke({
    packageSpec: args.packageSpec,
    expectedVersion: args.expectedVersion,
    timeoutMs: args.timeoutMs,
    installAttempts: args.installAttempts,
    installDelayMs: args.installDelayMs,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exit(1);
  });
}

module.exports = {
  getAvailablePort,
  installPackageWithRetry,
  isRemotePackageSpec,
  isTransientRegistryMiss,
  packCurrentRepo,
  runPackagedRuntimeSmoke,
  waitForHealthy,
};
