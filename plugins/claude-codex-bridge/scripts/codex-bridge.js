'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function getPluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
}

function getDataRoot() {
  return process.env.CLAUDE_PLUGIN_DATA || path.join(getPluginRoot(), '.codex-bridge-data');
}

function getRunsDir() {
  return path.join(getDataRoot(), 'runs');
}

function getCodexBin() {
  return process.env.THUMBGATE_CODEX_BIN || 'codex';
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = {
    _: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
}

function resolveLatestMetadataPath() {
  return path.join(getRunsDir(), 'latest.json');
}

function resolveLatestMessagePath() {
  return path.join(getRunsDir(), 'latest.md');
}

function loadLatestRun() {
  const latestPath = resolveLatestMetadataPath();
  if (!fs.existsSync(latestPath)) {
    return null;
  }
  return readJson(latestPath);
}

function getDefaultPrompt(mode) {
  if (mode === 'adversarial-review') {
    return 'Act as a skeptical adversarial reviewer. Hunt for hidden regressions, rollback risk, security mistakes, broken assumptions, and missing proof. Prefer precise findings over broad summaries.';
  }
  if (mode === 'second-pass') {
    return 'Take a second pass on the current task from this repository. Be independent, concrete, and skeptical. If changes are warranted, explain the minimal patch or next action.';
  }
  return 'Review the current changes for correctness, regressions, missing tests, security issues, and release risk. Keep the output concise and actionable.';
}

function buildCodexArgs(mode, options, lastMessagePath) {
  if (mode === 'second-pass') {
    const args = ['exec', '--json', '--output-last-message', lastMessagePath];
    if (options.model) {
      args.push('--model', options.model);
    }
    args.push(options.prompt || getDefaultPrompt(mode));
    return args;
  }

  const args = ['exec', 'review', '--json', '--output-last-message', lastMessagePath];
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.base) {
    args.push('--base', options.base);
  } else if (options.commit) {
    args.push('--commit', options.commit);
  } else {
    args.push('--uncommitted');
  }
  if (options.title) {
    args.push('--title', options.title);
  }
  args.push(options.prompt || getDefaultPrompt(mode));
  return args;
}

function saveRun(mode, codexArgs, result, lastMessagePath) {
  ensureDir(getRunsDir());

  const timestamp = new Date().toISOString();
  const runId = `${timestamp.replace(/[:.]/g, '-')}-${mode}`;
  const eventsPath = path.join(getRunsDir(), `${runId}.jsonl`);
  const metadataPath = path.join(getRunsDir(), `${runId}.json`);
  const latestMetadataPath = resolveLatestMetadataPath();
  const latestMessagePath = resolveLatestMessagePath();
  const lastMessage = fs.existsSync(lastMessagePath) ? fs.readFileSync(lastMessagePath, 'utf8') : '';

  fs.writeFileSync(eventsPath, result.stdout || '');
  if (lastMessage) {
    fs.writeFileSync(latestMessagePath, lastMessage);
  } else if (!fs.existsSync(latestMessagePath)) {
    fs.writeFileSync(latestMessagePath, '');
  }

  const metadata = {
    ok: result.status === 0,
    mode,
    runId,
    createdAt: timestamp,
    cwd: process.cwd(),
    codexBin: getCodexBin(),
    command: [getCodexBin(), ...codexArgs],
    exitCode: result.status,
    signal: result.signal || null,
    stderr: result.stderr || '',
    eventsPath,
    lastMessagePath: fs.existsSync(lastMessagePath) ? lastMessagePath : null,
    latestMessagePath,
  };

  writeJson(metadataPath, metadata);
  writeJson(latestMetadataPath, metadata);
  return {
    metadata,
    lastMessage,
  };
}

function commandSetup() {
  const pluginRoot = getPluginRoot();
  const dataRoot = getDataRoot();
  const mcpConfigPath = path.join(pluginRoot, '.mcp.json');
  const versionResult = runCommand(getCodexBin(), ['--version']);
  const reviewHelpResult = runCommand(getCodexBin(), ['exec', 'review', '--help']);
  const execHelpResult = runCommand(getCodexBin(), ['exec', '--help']);
  const payload = {
    ok: versionResult.status === 0 && reviewHelpResult.status === 0 && execHelpResult.status === 0,
    codexBin: getCodexBin(),
    codexInstalled: versionResult.status === 0,
    codexVersion: (versionResult.stdout || '').trim(),
    reviewCommand: reviewHelpResult.status === 0,
    execCommand: execHelpResult.status === 0,
    pluginRoot,
    dataDir: dataRoot,
    mcpConfigPath,
    mcpConfigPresent: fs.existsSync(mcpConfigPath),
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) {
    process.exitCode = 1;
  }
}

function commandStatus() {
  const latest = loadLatestRun();
  if (!latest) {
    console.log(JSON.stringify({
      ok: false,
      message: 'No Codex bridge run has been saved yet.',
      dataDir: getDataRoot(),
    }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(latest, null, 2));
}

function commandResult() {
  const latestPath = resolveLatestMessagePath();
  if (!fs.existsSync(latestPath)) {
    console.error('No saved Codex bridge result found.');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(fs.readFileSync(latestPath, 'utf8'));
}

function commandRun(mode, options) {
  ensureDir(getRunsDir());
  const lastMessagePath = path.join(getRunsDir(), `${mode}-working.md`);
  const codexArgs = buildCodexArgs(mode, options, lastMessagePath);
  const result = runCommand(getCodexBin(), codexArgs);
  const saved = saveRun(mode, codexArgs, result, lastMessagePath);

  if (result.status !== 0) {
    const message = [
      `Codex ${mode} failed.`,
      saved.metadata.stderr || 'No stderr captured.',
      `Saved metadata: ${saved.metadata.eventsPath}`,
    ].join('\n');
    console.error(message);
    process.exitCode = result.status || 1;
    return;
  }

  if (saved.lastMessage.trim()) {
    process.stdout.write(saved.lastMessage);
    if (!saved.lastMessage.endsWith('\n')) {
      process.stdout.write('\n');
    }
  }
  process.stdout.write(`\nSaved metadata: ${resolveLatestMetadataPath()}\n`);
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed._[0];
  const prompt = parsed.prompt || parsed._.slice(1).join(' ').trim() || '';

  switch (command) {
    case 'setup':
      commandSetup();
      return;
    case 'status':
      commandStatus();
      return;
    case 'result':
      commandResult();
      return;
    case 'review':
    case 'adversarial-review':
    case 'second-pass':
      commandRun(command, {
        base: parsed.base,
        commit: parsed.commit,
        uncommitted: parsed.uncommitted === true,
        title: parsed.title,
        model: parsed.model,
        prompt,
      });
      return;
    default:
      console.error([
        'Usage:',
        '  node plugins/claude-codex-bridge/scripts/codex-bridge.js setup',
        '  node plugins/claude-codex-bridge/scripts/codex-bridge.js review [--uncommitted|--base main|--commit <sha>] [--prompt "..."]',
        '  node plugins/claude-codex-bridge/scripts/codex-bridge.js adversarial-review [--uncommitted|--base main|--commit <sha>] [--prompt "..."]',
        '  node plugins/claude-codex-bridge/scripts/codex-bridge.js second-pass --prompt "..."',
        '  node plugins/claude-codex-bridge/scripts/codex-bridge.js status',
        '  node plugins/claude-codex-bridge/scripts/codex-bridge.js result',
      ].join('\n'));
      process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildCodexArgs,
  getDataRoot,
  getPluginRoot,
  loadLatestRun,
  parseArgs,
};
