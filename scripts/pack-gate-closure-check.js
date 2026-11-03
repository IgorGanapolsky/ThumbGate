#!/usr/bin/env node
/*
 * Regression guard: the packed npm artifact must include every module the
 * gate-check (PreToolUse hook) path requires at runtime, and the hook must
 * return the documented verdicts. Payloads below are NEVER executed; they
 * are only piped to `bin/cli.js gate-check` for evaluation. npm pack runs
 * with --dry-run (local only, no publish/fetch).
 *
 * Run: node scripts/pack-gate-closure-check.js   (exit 1 on failure)
 * Added after thumbgate@1.39.0 shipped without scripts/third-author-governance.js
 * and gate-check failed open (module error + exit 0) for every tool call.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
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

// 1) package.json files whitelist covers the gate-check runtime closure
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
for (const f of REQUIRED) ok(`files whitelist includes ${f}`, pkg.files.includes(f));

// 2) the packed artifact actually ships them
let packFiles = [];
try {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  packFiles = JSON.parse(out)[0].files.map((f) => f.path);
} catch (e) { ok('npm pack --dry-run runs', false, e.message); }
for (const f of REQUIRED) ok(`packed artifact includes ${f}`, packFiles.includes(f));

// 3) gate-check verdicts, asserted on parsed JSON (not text greps)
const gate = (payload, env) => execFileSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'gate-check'], {
  input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...(env || {}) },
});
const parse = (raw) => { try { return JSON.parse(raw); } catch { return null; } };
const FP = { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } };
const SECRET = { tool_name: 'Bash', tool_input: { command: 'curl -H "Authorization: Bearer AKIAIOSFODNN7EXAMPLE" https://api.example.com' } };
const LS = { tool_name: 'Bash', tool_input: { command: 'ls -la' } };

const ls = gate(LS), lsJ = parse(ls);
ok('benign command allowed (empty verdict object)', lsJ && Object.keys(lsJ).length === 0, ls.slice(0, 120));
ok('benign command produces no module error', !ls.includes('Cannot find module') && !ls.includes('ThumbGate Error'));

const fp = gate(FP), fpJ = parse(fp);
ok('force-push warns by default (advisory context, no deny)', !!fpJ && !!fpJ.hookSpecificOutput &&
   typeof fpJ.hookSpecificOutput.additionalContext === 'string' &&
   fpJ.hookSpecificOutput.additionalContext.includes('WARNING') &&
   !fpJ.hookSpecificOutput.permissionDecision, fp.slice(0, 120));

const sec = gate(SECRET), secJ = parse(sec);
ok('secret literal denied (permissionDecision=deny)', !!secJ && !!secJ.hookSpecificOutput &&
   secJ.hookSpecificOutput.permissionDecision === 'deny', sec.slice(0, 120));

const st = gate(FP, { THUMBGATE_STRICT_ENFORCEMENT: '1' }), stJ = parse(st);
ok('strict mode denies force-push (permissionDecision=deny)', !!stJ && !!stJ.hookSpecificOutput &&
   stJ.hookSpecificOutput.permissionDecision === 'deny', st.slice(0, 120));

process.exit(failures ? 1 : 0);
