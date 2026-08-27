#!/usr/bin/env node
/**
 * test-all — run every `test:*` npm script and AGGREGATE the results.
 *
 * WHY THIS EXISTS
 * ---------------
 * `npm test` is 360 sub-commands joined with `&&`. Two consequences, both bad:
 *
 *   1. `&&` short-circuits. The first failing suite hides the other 359, so CI
 *      can report "something failed" but never "these 12 failed". Every red run
 *      costs a full re-run per fix.
 *   2. Membership in that chain is hand-maintained, so suites drift out of it.
 *      Measured 2026-08-27 on d0bb3768: 405 `test:*` scripts defined, 359 in the
 *      chain, **46 never executed** — including test:redteam,
 *      test:stealth-memory-injection, test:mcp-policy,
 *      test:reward-hacking-guardrails and test:proactive-agent-eval-guardrails.
 *      All six were run by hand and PASS (33 assertions). They were green and
 *      guarding nothing.
 *
 * This runner discovers suites instead of listing them, so a new `test:*` script
 * is covered the moment it exists. It runs everything, then reports.
 *
 * USAGE
 *   node scripts/test-all.js              run all, aggregate, exit 1 if any fail
 *   node scripts/test-all.js --list       print the discovered suites, run none
 *   node scripts/test-all.js --orphans    print suites missing from `npm test`
 *   node scripts/test-all.js --jobs=4     concurrency (default: cpus-1, min 1)
 *   node scripts/test-all.js --filter=re  only suites whose name matches
 */
'use strict';

const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const ALL = Object.keys(pkg.scripts)
  .filter((n) => n.startsWith('test:'))
  // `test:coverage` shells out to the whole suite; running it here would recurse.
  .filter((n) => n !== 'test:coverage')
  .sort();

const chained = new Set(
  String(pkg.scripts.test || '')
    .split('&&')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('npm run '))
    .map((s) => s.replace('npm run ', '').trim())
);
const ORPHANS = ALL.filter((n) => !chained.has(n));

const filter = value('filter', null);
// `--filter` is a literal substring, never a regex. Building a RegExp from a
// command-line argument is a regex-injection sink (CodeQL js/regex-injection)
// and buys nothing: suite names are plain `test:foo-bar` identifiers.
const suites = filter ? ALL.filter((n) => n.includes(filter)) : ALL;

if (flag('list')) {
  suites.forEach((s) => console.log(s));
  process.exit(0);
}
if (flag('orphans')) {
  console.log(`${ORPHANS.length} test:* scripts are NOT in the \`npm test\` chain:\n`);
  ORPHANS.forEach((s) => console.log('  ' + s));
  process.exit(ORPHANS.length ? 1 : 0);
}

const JOBS = Math.max(1, parseInt(value('jobs', String(Math.max(1, os.cpus().length - 1))), 10) || 1);

function run(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('npm', ['run', '--silent', name], {
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (err) =>
      resolve({ name, code: -1, ms: Date.now() - started, out: String(err && err.message) })
    );
    child.on('close', (code) => resolve({ name, code, ms: Date.now() - started, out }));
  });
}

const num = (text, re) => {
  const m = text.match(re);
  return m ? Number(m[1]) : 0;
};

(async () => {
  const started = Date.now();
  const results = [];
  let cursor = 0;

  console.log(
    `test-all: ${suites.length} suites, ${JOBS} parallel` +
      (ORPHANS.length ? `  (${ORPHANS.length} of these are absent from \`npm test\`)` : '')
  );

  const worker = async () => {
    while (cursor < suites.length) {
      const name = suites[cursor++];
      const r = await run(name);
      results.push(r);
      const mark = r.code === 0 ? 'ok  ' : 'FAIL';
      const tag = chained.has(name) ? '   ' : '[+]'; // [+] = previously never run
      process.stdout.write(
        `  ${mark} ${tag} ${name.padEnd(48)} ${String(Math.round(r.ms / 100) / 10).padStart(6)}s\n`
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, suites.length) }, worker));

  const failed = results.filter((r) => r.code !== 0);
  const assertPass = results.reduce((a, r) => a + num(r.out, /^# pass (\d+)/m), 0);
  const assertFail = results.reduce((a, r) => a + num(r.out, /^# fail (\d+)/m), 0);

  console.log('\n' + '='.repeat(62));
  console.log(`suites   : ${results.length - failed.length}/${results.length} passed`);
  console.log(`asserts  : ${assertPass} passed, ${assertFail} failed`);
  console.log(`wall     : ${Math.round((Date.now() - started) / 1000)}s`);

  if (failed.length) {
    // The whole point: report EVERY failure, not just the first.
    console.log(`\n${failed.length} FAILING SUITE(S):`);
    for (const f of failed) {
      const first =
        f.out
          .split('\n')
          .find((l) => /^not ok |Error|AssertionError|failed/i.test(l)) || '(no summary line)';
      console.log(`  ${f.name}  exit=${f.code}\n      ${first.trim().slice(0, 140)}`);
    }
  }
  process.exit(failed.length ? 1 : 0);
})();
