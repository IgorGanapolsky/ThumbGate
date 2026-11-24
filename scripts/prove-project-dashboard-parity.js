#!/usr/bin/env node
'use strict';

// Proof: for each project folder, the dashboard's per-project feedback numbers equal the
// status line's "this project" numbers taken at the same moment.
//   node scripts/prove-project-dashboard-parity.js <projectDir> [<projectDir> ...]
// Starts its own loopback server (random port, throwaway key); prints counts only, never a key.
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const { resolveLocalProject } = require('./project-identity');

const ROOT = path.join(__dirname, '..');
const KEY = `parity-${process.pid}-${Date.now()}`;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
    server.on('error', reject);
  });
}

function statuslineCounts(dir, env) {
  const cleanEnv = { ...env };
  delete cleanEnv.THUMBGATE_FEEDBACK_DIR;
  delete cleanEnv.THUMBGATE_PROJECT_DIR;
  const out = execFileSync(process.execPath, [path.join(__dirname, 'statusline-human-counts.js')], { cwd: dir, env: cleanEnv, encoding: 'utf8' });
  const { up, down } = JSON.parse(out);
  return { up, down };
}

async function waitHealthy(origin) {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${origin}/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not become healthy');
}

async function main() {
  const dirs = process.argv.slice(2).map((d) => path.resolve(d));
  if (dirs.length === 0) throw new Error('usage: prove-project-dashboard-parity.js <projectDir> ...');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'api', 'server.js')], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), THUMBGATE_API_KEY: KEY, THUMBGATE_PROJECT_DIR: dirs[0] },
  });
  let failed = 0;
  try {
    await waitHealthy(origin);
    for (const dir of dirs) {
      const { projectKey } = resolveLocalProject(dir);
      const url = `${origin}/v1/dashboard?project=${encodeURIComponent(projectKey)}&projectDir=${encodeURIComponent(dir)}`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
      if (!response.ok) throw new Error(`dashboard ${path.basename(dir)} -> HTTP ${response.status}`);
      const analysis = (await response.json()).feedbackAnalysis;
      const dash = { up: analysis.totalPositive, down: analysis.totalNegative };
      const line = statuslineCounts(dir, process.env);
      const ok = dash.up === line.up && dash.down === line.down;
      if (!ok) failed += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${path.basename(dir)} dashboard ${dash.up} up/${dash.down} down | status line ${line.up} up/${line.down} down`);
    }
  } finally {
    child.kill();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(`FAIL ${error.message}`); process.exit(2); });
