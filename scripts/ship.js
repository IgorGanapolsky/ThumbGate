#!/usr/bin/env node
'use strict';

/**
 * /ship: branch -> PR -> wait for the ship gate -> merged, in one command.
 *
 *   npm run ship -- [--title "..."] [--body-file f.md] [--no-wait] [--timeout-min 30]
 *
 * Run it with your work committed. From main it moves your unpushed commits
 * onto a ship/<slug> branch (local main goes back to origin/main; nothing is
 * lost). It opens or reuses the PR (never a draft), then waits for
 * .github/workflows/ship-gate.yml to test, review and merge it.
 *
 * Exit codes (an agent loops on 1 and 4: fix, commit, run again):
 *   0 merged          1 checks red or review threads open
 *   2 nothing to ship / uncommitted work      3 waiting on Igor (needs-igor / do-not-merge)
 *   4 conflict with main                      5 timed out waiting
 *
 * Direct push to main is still allowed (Igor, 2026-11-24). /ship is the default.
 */

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { loadPolicy, summarizeChecks } = require('./ship-policy');

const EXIT = { merged: 0, red: 1, nothing: 2, human: 3, conflict: 4, timeout: 5 };

function run(cmd, args, { allowFail = false } = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (res.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${(res.stderr || res.stdout || '').trim()}`);
  }
  return { ok: res.status === 0, out: (res.stdout || '').trim(), err: (res.stderr || '').trim() };
}

function slugify(text = '') {
  const slug = String(text).toLowerCase()
    .replace(/^[a-z]+(\([^)]*\))?!?:\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'change';
}

function branchNameFor(subject, now = new Date()) {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `ship/${slugify(subject)}-${stamp}`;
}

/** Decide what the PR's current state means for the shipper. Pure. */
function classifyPrState(view = {}, policy = loadPolicy()) {
  const labels = new Set((view.labels || []).map((l) => (typeof l === 'string' ? l : l.name)));
  const state = String(view.state || '').toUpperCase();
  if (state === 'MERGED') {
    return { done: true, code: EXIT.merged, message: `Merged as ${view.mergeCommit && view.mergeCommit.oid}.` };
  }
  if (state === 'CLOSED') {
    return { done: true, code: EXIT.red, message: 'PR was closed without merging.' };
  }
  if (labels.has(policy.labels.hold)) {
    return { done: true, code: EXIT.human, message: `On hold (\`${policy.labels.hold}\`). Igor decides.` };
  }
  if (labels.has(policy.labels.needsHuman)) {
    return { done: true, code: EXIT.human, message: 'Ship gate says this needs Igor (see the ship-gate comment). Nothing for the agent to fix; tell Igor.' };
  }
  const mergeState = String(view.mergeStateStatus || '').toUpperCase();
  if (mergeState === 'DIRTY') {
    return { done: true, code: EXIT.conflict, message: 'Conflicts with main. Merge origin/main, resolve, commit, and run ship again.' };
  }
  const checks = summarizeChecks(view.statusCheckRollup || [], policy);
  if (checks.state === 'red') {
    return { done: true, code: EXIT.red, message: `Failing: ${checks.failing.join(', ')}. Fix, commit, and run ship again.`, failing: checks.failing };
  }
  if (labels.has(policy.labels.needsFix) && checks.state === 'green') {
    return { done: true, code: EXIT.red, message: 'Checks are green but review threads are open. Answer or fix each one, resolve it, and run ship again.' };
  }
  return { done: false, message: checks.state === 'pending' ? `Waiting on: ${checks.pending.join(', ')}` : 'Waiting for the ship gate to merge.' };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function ship(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const policy = loadPolicy();
  const log = (m) => console.log(`[ship] ${m}`);

  if (run('git', ['status', '--porcelain']).out) {
    log('Uncommitted changes. Commit them first (one topic per PR).');
    return EXIT.nothing;
  }
  run('git', ['fetch', 'origin', policy.base]);
  const base = `origin/${policy.base}`;
  const ahead = Number(run('git', ['rev-list', '--count', `${base}..HEAD`]).out);
  if (!ahead) {
    log(`Nothing to ship: HEAD has no commits beyond ${base}.`);
    return EXIT.nothing;
  }

  let branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out;
  if (branch === policy.base || branch === 'HEAD') {
    const subject = run('git', ['log', '-1', '--format=%s']).out;
    const fromMain = branch === policy.base;
    branch = branchNameFor(subject);
    run('git', ['checkout', '-b', branch]);
    if (fromMain) run('git', ['branch', '-f', policy.base, base]);
    log(`Moved ${ahead} commit(s) to ${branch}.`);
  }

  const onRemote = run('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch], { allowFail: true }).ok;
  const behind = Number(run('git', ['rev-list', '--count', `HEAD..${base}`]).out);
  if (behind) {
    // Rebase a new branch; merge into one already pushed so no force-push is needed.
    const step = onRemote ? ['merge', '--no-edit', base] : ['rebase', base];
    if (!run('git', step, { allowFail: true }).ok) {
      run('git', [onRemote ? 'merge' : 'rebase', '--abort'], { allowFail: true });
      log(`Conflict with ${base}. Resolve it by hand (git ${step.join(' ')}), commit, and run ship again.`);
      return EXIT.conflict;
    }
  }

  run('git', ['push', '-u', 'origin', branch]);

  let pr = JSON.parse(run('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,isDraft']).out || '[]')[0];
  if (!pr) {
    const title = args.title || run('git', ['log', '-1', '--format=%s']).out;
    const body = args['body-file']
      ? fs.readFileSync(args['body-file'], 'utf8')
      : `## What Changed\n\n${run('git', ['log', '--format=- %s', `${base}..HEAD`]).out}\n\n## Verification\n\nSee commit messages. Shipped with \`npm run ship\`; the ship gate runs the matching tests.\n`;
    const url = run('gh', ['pr', 'create', '--base', policy.base, '--head', branch, '--title', title, '--body', body]).out.split('\n').pop();
    pr = { url, number: Number(url.split('/').pop()), isDraft: false };
    log(`Opened ${url}`);
  } else {
    if (pr.isDraft) run('gh', ['pr', 'ready', String(pr.number)]);
    // New commits: the old needs-fix verdict no longer applies.
    run('gh', ['pr', 'edit', String(pr.number), '--remove-label', policy.labels.needsFix], { allowFail: true });
    log(`Updated ${pr.url}`);
  }

  if (args['no-wait']) return EXIT.merged;

  const timeoutMs = Number(args['timeout-min'] || 30) * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    sleep(20000);
    const view = JSON.parse(run('gh', ['pr', 'view', String(pr.number), '--json', 'state,mergeCommit,labels,statusCheckRollup,mergeStateStatus']).out);
    const verdict = classifyPrState(view, policy);
    if (verdict.message !== last) { log(verdict.message); last = verdict.message; }
    if (verdict.done) {
      if (verdict.code === EXIT.merged) {
        run('git', ['fetch', 'origin', policy.base]);
        run('git', ['checkout', policy.base], { allowFail: true });
        run('git', ['merge', '--ff-only', base], { allowFail: true });
      } else if (verdict.failing) {
        const checks = run('gh', ['pr', 'checks', String(pr.number)], { allowFail: true });
        console.log(checks.out);
      }
      return verdict.code;
    }
  }
  log(`Still not merged after ${timeoutMs / 60000} min: ${pr.url}`);
  return EXIT.timeout;
}

if (require.main === module) {
  try {
    process.exit(ship());
  } catch (err) {
    console.error(`[ship] ${err.message}`);
    process.exit(1);
  }
}

module.exports = { EXIT, branchNameFor, classifyPrState, slugify };
