#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(process.argv[2] || process.cwd());
const THUMBGATE_ENTRY = {
  command: 'npx',
  args: ['-y', 'thumbgate@latest', 'serve'],
};
const MCP_SERVER_KEY = 'thumbgate';
const LEGACY_SERVER_NAMES = ['rlhf', 'mcp-memory-gateway', 'rlhf_feedback_loop'];
const INFO_EXCLUDE_ENTRIES = ['.thumbgate/', '.mcp.json'];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonIfChanged(filePath, value) {
  const next = JSON.stringify(value, null, 2) + '\n';
  let current = null;
  try {
    current = fs.readFileSync(filePath, 'utf8');
  } catch {
    current = null;
  }
  if (current === next) {
    return false;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next);
  return true;
}

function mergeThumbgateEntry(entry = {}) {
  return {
    ...entry,
    command: THUMBGATE_ENTRY.command,
    args: THUMBGATE_ENTRY.args.slice(),
  };
}

function ensureMcpJson(repoRoot) {
  const filePath = path.join(repoRoot, '.mcp.json');
  const existing = readJson(filePath);
  const config = existing && typeof existing === 'object' ? existing : {};
  config.mcpServers = config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {};
  config.mcpServers[MCP_SERVER_KEY] = mergeThumbgateEntry(config.mcpServers[MCP_SERVER_KEY]);
  for (const legacyName of LEGACY_SERVER_NAMES) {
    delete config.mcpServers[legacyName];
  }
  return writeJsonIfChanged(filePath, config);
}

function ensureClaudeSettings(repoRoot) {
  const filePath = path.join(repoRoot, '.claude', 'settings.json');
  const existing = readJson(filePath);
  if (!existing || typeof existing !== 'object') {
    return false;
  }
  const hasRelevantServer =
    Boolean(existing.mcpServers && existing.mcpServers[MCP_SERVER_KEY]) ||
    LEGACY_SERVER_NAMES.some((name) => Boolean(existing.mcpServers && existing.mcpServers[name]));
  if (!hasRelevantServer) {
    return false;
  }
  existing.mcpServers = existing.mcpServers && typeof existing.mcpServers === 'object' ? existing.mcpServers : {};
  existing.mcpServers[MCP_SERVER_KEY] = mergeThumbgateEntry(existing.mcpServers[MCP_SERVER_KEY]);
  for (const legacyName of LEGACY_SERVER_NAMES) {
    delete existing.mcpServers[legacyName];
  }
  return writeJsonIfChanged(filePath, existing);
}

function ensureInfoExclude(repoRoot) {
  const excludePath = path.join(repoRoot, '.git', 'info', 'exclude');
  let current = '';
  try {
    current = fs.readFileSync(excludePath, 'utf8');
  } catch {
    current = '';
  }
  const lines = new Set(
    current
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
  let changed = false;
  for (const entry of INFO_EXCLUDE_ENTRIES) {
    if (!lines.has(entry)) {
      lines.add(entry);
      changed = true;
    }
  }
  if (!changed) {
    return false;
  }
  const next = `${Array.from(lines).sort().join('\n')}\n`;
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  fs.writeFileSync(excludePath, next);
  return true;
}

function ensureThumbgateDir(repoRoot) {
  const thumbgateDir = path.join(repoRoot, '.thumbgate');
  if (fs.existsSync(thumbgateDir)) {
    return false;
  }
  fs.mkdirSync(thumbgateDir, { recursive: true });
  return true;
}

function main() {
  const results = {
    repoRoot: REPO_ROOT,
    createdThumbgateDir: ensureThumbgateDir(REPO_ROOT),
    updatedMcpJson: ensureMcpJson(REPO_ROOT),
    updatedClaudeSettings: ensureClaudeSettings(REPO_ROOT),
    updatedInfoExclude: ensureInfoExclude(REPO_ROOT),
  };
  process.stdout.write(`${JSON.stringify(results)}\n`);
}

main();
