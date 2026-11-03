#!/usr/bin/env node
/*
 * Regression guard: the PACKED npm artifact must run `bin/cli.js gate-check`
 * with the documented verdicts, using ONLY files inside the tarball.
 *
 * Unlike the static require-graph test, this packs, extracts to a fresh
 * directory, runs `init` in an isolated HOME + empty project dir, and then
 * executes the hook — so a missing runtime dependency (however it is
 * require()d) fails here the way thumbgate@1.39.0 failed open in production
 * (missing scripts/third-author-governance.js). Pre-init, gate-check is
 * self-disabled by design (README), so verdicts are asserted post-init.
 *
 * Payloads below are NEVER executed; they are only piped to `gate-check`
 * for evaluation. npm pack writes a tarball locally; no publish, no network
 * fetch, telemetry disabled (THUMBGATE_NO_TELEMETRY=1).
 *
 * Run: node scripts/pack-gate-closure-check.js   (exit 1 on failure)
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Targeted pins for the exact files missing from the published 1.39.0 tarball.
// The extracted-pack execution below is the generic recurrence guard for any
// future gate dependency, not only these four.
const REQUIRED = [
  'scripts/third-author-governance.js',
  'scripts/reflector-agent.js',
  'scripts/sequence-guard.js',
  'scripts/slopsquat-guard.js',
];

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ' -> ' + detail : ''}`); }
};

// 1) package.json files whitelist covers the gate-check runtime pins
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
for (const f of REQUIRED) ok(`files whitelist includes ${f}`, pkg.files.includes(f));

// 2) build a real tarball and extract it to a fresh directory
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-pack-check-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-pack-home-'));
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-pack-proj-'));
let pkgDir = null;
try {
  const out = execFileSync('npm', ['pack', '--pack-destination', tmp], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  execFileSync('tar', ['xzf', path.join(tmp, out.trim().split('\n').pop()), '-C', tmp], { stdio: ['ignore', 'pipe', 'ignore'] });
  pkgDir = path.join(tmp, 'package');
} catch (e) { ok('npm pack + extract runs', false, e.message); }

if (pkgDir) {
  for (const f of REQUIRED) ok(`packed artifact includes ${f}`, fs.existsSync(path.join(pkgDir, f)));

  const ENV = { PATH: process.env.PATH, HOME: home, THUMBGATE_NO_TELEMETRY: '1' };
  const run = (args, payload, env) => {
    try {
      const res = execFileSync(process.execPath, [path.join(pkgDir, 'bin', 'cli.js'), ...args], {
        input: payload ? JSON.stringify(payload) : '', encoding: 'utf8', cwd: proj,
        env: { ...ENV, ...(env || {}) }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { out: res, err: '' };
    } catch (e) {
      return { out: (e.stdout || '').toString(), err: ((e.stderr || '') + '').toString() + e.message };
    }
  };
  const parse = (raw) => { try { return JSON.parse(raw); } catch { return null; } };
  const clean = (r) => !r.err.includes('Cannot find module') && !r.out.includes('Cannot find module') && !r.out.includes('ThumbGate Error');

  // 3) initialize in the isolated project (production flow), then assert verdicts
  const init = run(['init']);
  ok('packed init runs without module error', clean(init), (init.err + init.out).slice(0, 160));

  const FP = { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } };
  const SECRET = { tool_name: 'Bash', tool_input: { command: 'curl -H "Authorization: Bearer AKIAIOSFODNN7EXAMPLE" https://api.example.com' } };
  const LS = { tool_name: 'Bash', tool_input: { command: 'ls -la' } };

  const ls = run(['gate-check'], LS), lsJ = parse(ls.out);
  ok('packed gate-check allows benign command (empty verdict object)', lsJ && Object.keys(lsJ).length === 0, (ls.err + ls.out).slice(0, 160));
  ok('packed gate-check has no module error', clean(ls), (ls.err + ls.out).slice(0, 160));

  const fp = run(['gate-check'], FP), fpJ = parse(fp.out);
  ok('packed gate-check warns on force-push by default (advisory, no deny)', !!fpJ && !!fpJ.hookSpecificOutput &&
     typeof fpJ.hookSpecificOutput.additionalContext === 'string' &&
     fpJ.hookSpecificOutput.additionalContext.includes('WARNING') &&
     !fpJ.hookSpecificOutput.permissionDecision, (fp.err + fp.out).slice(0, 160));
  ok('force-push verdict has no module error', clean(fp), (fp.err + fp.out).slice(0, 160));

  const sec = run(['gate-check'], SECRET), secJ = parse(sec.out);
  ok('packed gate-check denies secret literal (permissionDecision=deny)', !!secJ && !!secJ.hookSpecificOutput &&
     secJ.hookSpecificOutput.permissionDecision === 'deny', (sec.err + sec.out).slice(0, 160));

  const st = run(['gate-check'], FP, { THUMBGATE_STRICT_ENFORCEMENT: '1' }), stJ = parse(st.out);
  ok('packed gate-check strict mode denies force-push (permissionDecision=deny)', !!stJ && !!stJ.hookSpecificOutput &&
     stJ.hookSpecificOutput.permissionDecision === 'deny', (st.err + st.out).slice(0, 160));
}

process.exit(failures ? 1 : 0);
