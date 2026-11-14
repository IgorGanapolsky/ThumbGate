'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { resolveLocalProject } = require('../scripts/project-identity');

test('resolveLocalProject memoizes per directory instead of spawning git on every event', () => {
  const first = resolveLocalProject(ROOT);
  const start = process.hrtime.bigint();
  for (let i = 0; i < 200; i += 1) assert.deepEqual(resolveLocalProject(ROOT), first);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  // 200 uncached resolutions would spawn ~800 git processes (seconds); cached is sub-10ms.
  assert.ok(elapsedMs < 500, `200 cached resolutions took ${elapsedMs}ms`);
});

test('cached descriptors are copies, so callers cannot corrupt later resolutions', () => {
  const a = resolveLocalProject(ROOT);
  a.projectKey = 'mutated';
  assert.notEqual(resolveLocalProject(ROOT).projectKey, 'mutated');
});

test('MCP stdio server exits promptly after tool calls and stdin close', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-shutdown-'));
  const child = spawn(process.execPath, ['adapters/mcp/server-stdio.js'], {
    cwd: ROOT,
    stdio: ['pipe', 'ignore', 'ignore'],
    env: { ...process.env, THUMBGATE_FEEDBACK_DIR: feedbackDir },
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'shutdown-test', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'capture_feedback', arguments: { signal: 'up', context: 'shutdown timing probe' } } });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const closedAt = Date.now();
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.stdin.end();
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  await exited;
  clearTimeout(timer);
  const waited = Date.now() - closedAt;
  fs.rmSync(feedbackDir, { recursive: true, force: true });
  assert.ok(waited < 10000, `MCP server took ${waited}ms to exit after stdin closed`);
});
