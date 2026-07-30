#!/usr/bin/env node
'use strict';

/**
 * prove-glama-mcp-start.js
 *
 * Hard pin against the recurring Glama "Build failed for ThumbGate" class:
 * registries must start stdio MCP via `npx -y thumbgate serve`, never guess
 * `npm start` (HTTP API).
 *
 * Exit 0 only when manifests + package files contract holds.
 * Optional: THUMBGATE_GLAMA_SMOKE=1 runs a short initialize handshake.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function fail(msg, details) {
  const err = new Error(msg);
  err.details = details;
  throw err;
}

function checkContract() {
  const checks = [];
  const server = readJson('server.json');
  const pkg = readJson('package.json');
  const glama = readJson('glama.json');
  const smithery = fs.readFileSync(path.join(ROOT, 'smithery.yaml'), 'utf8');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  const pack = server.packages && server.packages[0];
  if (!pack) fail('server.json missing packages[0]');

  const packageArgs = (pack.packageArguments || []).map((a) => a.value);
  const runtimeArgs = (pack.runtimeArguments || []).map((a) => a.value);

  checks.push({
    id: 'server_runtime_hint',
    ok: pack.runtimeHint === 'npx',
    detail: `runtimeHint=${pack.runtimeHint}`,
  });
  checks.push({
    id: 'server_package_args_serve',
    ok: packageArgs.length === 1 && packageArgs[0] === 'serve',
    detail: `packageArguments=${JSON.stringify(packageArgs)}`,
  });
  checks.push({
    id: 'server_runtime_args_y',
    ok: runtimeArgs.includes('-y'),
    detail: `runtimeArguments=${JSON.stringify(runtimeArgs)}`,
  });
  checks.push({
    id: 'server_stdio',
    ok: pack.transport && pack.transport.type === 'stdio',
    detail: `transport=${JSON.stringify(pack.transport)}`,
  });
  const descLower = String(server.description || '').toLowerCase();
  checks.push({
    id: 'server_no_legacy_name',
    ok: !descLower.includes('mcp-memory-gateway')
      && !descLower.includes('mcp memory gateway')
      && !descLower.includes('rlhf-loop'),
    detail: 'server.json description free of retired product names',
  });
  checks.push({
    id: 'glama_maintainers',
    ok: Array.isArray(glama.maintainers) && glama.maintainers.includes('IgorGanapolsky'),
    detail: `maintainers=${JSON.stringify(glama.maintainers)}`,
  });
  checks.push({
    id: 'glama_schema_minimal',
    ok: Object.keys(glama).filter((k) => k !== '$schema').join(',') === 'maintainers',
    detail: 'glama.json only maintainers (official schema)',
  });
  // Scope to commandFunction.args — pure string parse (no regex; Sonar S5852).
  const smitheryArgs = [];
  let inArgs = false;
  for (const line of smithery.split('\n')) {
    if (line.trim() === 'args:') {
      inArgs = true;
      continue;
    }
    if (inArgs) {
      const t = line.trim();
      // YAML list item: - "value"
      if (t.startsWith('- "') && t.endsWith('"') && t.length >= 4) {
        smitheryArgs.push(t.slice(3, -1));
        continue;
      }
      // left the list
      if (t !== '') inArgs = false;
    }
  }
  const smitheryCommand = smithery.includes('command: "npx"') || smithery.includes("command: 'npx'");
  const smitheryArgOk = smitheryArgs.length >= 3
    && smitheryArgs[0] === '-y'
    && smitheryArgs[1] === 'thumbgate'
    && smitheryArgs[2] === 'serve';
  checks.push({
    id: 'smithery_serve',
    ok: smitheryCommand && smitheryArgOk,
    detail: `smithery commandFunction.args=${JSON.stringify(smitheryArgs)}`,
  });
  checks.push({
    id: 'package_ships_manifests',
    ok: ['server.json', 'glama.json', 'smithery.yaml'].every((f) => (pkg.files || []).includes(f)),
    detail: 'package.json files includes MCP registry manifests',
  });
  checks.push({
    id: 'readme_documents_serve',
    ok: readme.includes('npx -y thumbgate serve')
      && readme.includes('Do **not** use `npm start` for MCP'),
    detail: 'README documents Glama/MCP stdio start',
  });

  // Env default must not force expanded profile (factory least-privilege)
  const envDefaults = (pack.environmentVariables || [])
    .filter((e) => e.name === 'THUMBGATE_MCP_PROFILE' && e.default != null);
  checks.push({
    id: 'no_forced_default_profile',
    ok: envDefaults.length === 0 || envDefaults.every((e) => e.default === 'essential'),
    detail: 'THUMBGATE_MCP_PROFILE must not default to expanded "default" profile',
  });

  const failed = checks.filter((c) => !c.ok);
  return { checks, failed, passed: failed.length === 0 };
}

function isSmokeSuccess(out) {
  const s = String(out || '');
  return s.includes('protocolVersion')
    || s.includes('"name":"thumbgate-mcp"')
    || s.includes('"name": "thumbgate-mcp"');
}

function buildInitializeFrame() {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'prove-glama-mcp-start', version: '0' },
    },
  });
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function smokeInitialize(timeoutMs = 4000, options = {}) {
  const spawner = options.spawnFn || spawn;
  return new Promise((resolve) => {
    const cli = path.join(ROOT, 'bin', 'cli.js');
    const env = { ...process.env, THUMBGATE_MCP_PROFILE: 'essential' };
    // Isolate feedback dir so smoke never touches operator state
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tg-glama-smoke-'));
    env.THUMBGATE_FEEDBACK_DIR = tmp;

    const child = spawner(process.execPath, [cli, 'serve'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: ROOT,
    });

    let out = '';
    let err = '';
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve(payload);
    };

    if (child.stdout && child.stdout.on) child.stdout.on('data', (d) => { out += d; });
    if (child.stderr && child.stderr.on) child.stderr.on('data', (d) => { err += d; });

    const framed = buildInitializeFrame();
    const timer = setTimeout(() => {
      try { if (child.kill) child.kill('SIGKILL'); } catch { /* ignore */ }
      finish({
        ok: isSmokeSuccess(out),
        out: out.slice(0, 800),
        err: err.slice(0, 800),
        timedOut: true,
      });
    }, timeoutMs);

    setTimeout(() => {
      try {
        if (child.stdin && child.stdin.write) child.stdin.write(framed);
      } catch { /* ignore */ }
    }, 150);

    if (child.on) {
      child.on('exit', () => {
        clearTimeout(timer);
        finish({
          ok: isSmokeSuccess(out),
          out: out.slice(0, 800),
          err: err.slice(0, 800),
          timedOut: false,
        });
      });
    }
  });
}

async function proveGlamaMcpStart(options = {}) {
  const contract = checkContract();
  const report = {
    phase: 'glama-mcp-start-contract',
    generatedAt: new Date().toISOString(),
    passed: contract.passed,
    contract,
    smoke: null,
  };

  if (contract.passed && (options.smoke || process.env.THUMBGATE_GLAMA_SMOKE === '1')) {
    report.smoke = await smokeInitialize(Number(options.timeoutMs) || 4000);
    if (!report.smoke.ok) report.passed = false;
  }

  return report;
}

function writeReport(report, outDir) {
  const dir = outDir
    || process.env.THUMBGATE_PROOF_DIR
    || path.join(ROOT, 'proof');
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, 'glama-mcp-start-proof.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const md = [
    '# Glama / MCP start proof',
    '',
    `**Status:** ${report.passed ? 'PASS' : 'FAIL'}`,
    `**Generated:** ${report.generatedAt}`,
    '',
    '## Contract checks',
    '',
    ...report.contract.checks.map((c) => `- [${c.ok ? 'x' : ' '}] **${c.id}** — ${c.detail}`),
    '',
  ];
  if (report.smoke) {
    md.push('## Optional initialize smoke', '', report.smoke.ok ? 'PASS' : 'FAIL', '');
  }
  const mdPath = path.join(dir, 'glama-mcp-start-proof.md');
  fs.writeFileSync(mdPath, md.join('\n'));
  return { jsonPath, mdPath };
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
}

if (isMain()) {
  proveGlamaMcpStart({
    smoke: process.argv.includes('--smoke') || process.env.THUMBGATE_GLAMA_SMOKE === '1',
  }).then((report) => {
    const paths = writeReport(report);
    console.log(fs.readFileSync(paths.mdPath, 'utf8'));
    console.log(`Wrote ${paths.jsonPath}`);
    process.exit(report.passed ? 0 : 1);
  }).catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  checkContract,
  proveGlamaMcpStart,
  writeReport,
  smokeInitialize,
  isSmokeSuccess,
  buildInitializeFrame,
};
