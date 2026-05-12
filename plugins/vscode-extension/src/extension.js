'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const vscode = require('vscode');

const SERVER_NAME = 'thumbgate';
const DASHBOARD_URL = 'https://thumbgate-production.up.railway.app/dashboard?utm_source=vscode&utm_medium=extension&utm_campaign=dashboard';
const PRO_URL = 'https://thumbgate.ai/checkout/pro?utm_source=vscode&utm_medium=extension&utm_campaign=pro_follow_on&plan_id=pro';
const GUIDE_URL = 'https://thumbgate-production.up.railway.app/guide?utm_source=vscode&utm_medium=extension&utm_campaign=setup';

function thumbgateMcpServerConfig() {
  return {
    command: 'npx',
    args: ['--yes', '--package', 'thumbgate@latest', 'thumbgate', 'serve'],
  };
}

function vscodeMcpServerDefinition() {
  if (typeof vscode.McpStdioServerDefinition !== 'function') {
    return null;
  }
  return new vscode.McpStdioServerDefinition({
    label: 'ThumbGate',
    command: 'npx',
    args: ['--yes', '--package', 'thumbgate@latest', 'thumbgate', 'serve'],
    version: '1.16.22',
  });
}

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
}

function workspaceMcpPath(root = workspaceRoot()) {
  if (!root) return '';
  return path.join(root, '.vscode', 'mcp.json');
}

function readJsonIfPresent(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeWorkspaceMcpConfig(filePath = workspaceMcpPath()) {
  if (!filePath) {
    throw new Error('Open a workspace folder before installing ThumbGate MCP.');
  }
  const config = readJsonIfPresent(filePath);
  config.servers = config.servers || {};
  config.servers[SERVER_NAME] = thumbgateMcpServerConfig();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return filePath;
}

function runThumbgate(args, cwd = workspaceRoot()) {
  return new Promise((resolve) => {
    cp.execFile('npx', ['--yes', '--package', 'thumbgate@latest', 'thumbgate', ...args], {
      cwd: cwd || process.cwd(),
      timeout: 60000,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout || '',
        stderr: stderr || '',
        message: error?.message || '',
      });
    });
  });
}

async function promptFeedback(kind) {
  const label = kind === 'up' ? 'positive feedback' : 'negative feedback';
  const context = await vscode.window.showInputBox({
    title: `ThumbGate: Capture ${label}`,
    prompt: 'Describe the concrete agent action and what should be reinforced or blocked next time.',
    ignoreFocusOut: true,
  });
  if (!context) return;
  const result = await runThumbgate(['capture', `--feedback=${kind}`, `--context=${context}`]);
  const output = (result.stdout || result.stderr || result.message).trim();
  if (result.ok) {
    vscode.window.showInformationMessage(`ThumbGate captured ${label}.`);
  } else {
    vscode.window.showErrorMessage(`ThumbGate capture failed: ${output || 'unknown error'}`);
  }
}

async function showStats() {
  const result = await runThumbgate(['stats']);
  const output = (result.stdout || result.stderr || result.message || 'No ThumbGate stats available.').trim();
  const channel = vscode.window.createOutputChannel('ThumbGate');
  channel.clear();
  channel.appendLine(output);
  channel.show(true);
}

async function initWorkspace() {
  const filePath = writeWorkspaceMcpConfig();
  await runThumbgate(['init']);
  const relative = vscode.workspace.asRelativePath(filePath);
  vscode.window.showInformationMessage(`ThumbGate MCP installed in ${relative}. Start it from MCP: List Servers.`);
}

function registerMcpProvider(context) {
  if (!vscode.lm?.registerMcpServerDefinitionProvider) return;
  context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider(SERVER_NAME, {
    provideMcpServerDefinitions() {
      const definition = vscodeMcpServerDefinition();
      return definition ? [definition] : [];
    },
    resolveMcpServerDefinition(server) {
      return server;
    },
  }));
}

function activate(context) {
  registerMcpProvider(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('thumbgate.initWorkspace', initWorkspace),
    vscode.commands.registerCommand('thumbgate.openDashboard', () => vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL))),
    vscode.commands.registerCommand('thumbgate.capturePositive', () => promptFeedback('up')),
    vscode.commands.registerCommand('thumbgate.captureNegative', () => promptFeedback('down')),
    vscode.commands.registerCommand('thumbgate.showStats', showStats),
    vscode.commands.registerCommand('thumbgate.upgradePro', () => vscode.env.openExternal(vscode.Uri.parse(PRO_URL))),
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  thumbgateMcpServerConfig,
  workspaceMcpPath,
  writeWorkspaceMcpConfig,
  GUIDE_URL,
  PRO_URL,
};
