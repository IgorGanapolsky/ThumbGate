'use strict';

/**
 * One branch per push, and a fetch answered from packs already stored.
 *
 * Source: https://thenewstack.io/openai-pando-git-backend/
 * OpenAI's Pando handles each branch on its own and serves packs it already
 * stored. The latency and volume figures on that page are theirs. This file
 * does not install Pando, does not run a pack server, and does not push.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EXIT_BLOCK = 77;
const ONE_BRANCH_DEFAULTS = new Set(['simple', 'current', 'upstream']);
const VALUE_FLAGS = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo']);
const EVERY_REF = new Set(['--all', '--mirror', '--tags']);

function positionals(argv) {
  const out = [];
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === '--') {
      out.push(...argv.slice(index + 1));
      break;
    }
    if (VALUE_FLAGS.has(token)) {
      index += 2;
      continue;
    }
    if (token.startsWith('-')) {
      index += 1;
      continue;
    }
    out.push(token);
    index += 1;
  }
  return out;
}

function classifyPush(argv, pushDefault) {
  const args = Array.isArray(argv) ? argv : [];
  const fallback = pushDefault == null ? 'simple' : String(pushDefault);
  if (args.some((flag) => EVERY_REF.has(flag))) {
    return { decision: 'block', rule: 'every-ref' };
  }
  const specs = positionals(args);
  if (specs.length === 0) {
    if (ONE_BRANCH_DEFAULTS.has(fallback)) return { decision: 'allow', rule: 'one-branch' };
    if (fallback === 'matching') return { decision: 'block', rule: 'matching' };
    return { decision: 'block', rule: 'push-default-unknown' };
  }
  const refspecs = specs.length > 1 ? specs.slice(1) : [];
  if (refspecs.some((spec) => spec.includes('*'))) {
    return { decision: 'block', rule: 'wildcard' };
  }
  if (refspecs.length > 1) return { decision: 'block', rule: 'many-refs' };
  return { decision: 'allow', rule: 'one-branch' };
}

function advertisedBase(refs, trunk) {
  const name = `refs/heads/${trunk || 'main'}`;
  const lines = Array.isArray(refs) ? refs : String(refs || '').split('\n');
  const hit = lines.map((line) => String(line).trim()).filter(Boolean).find((line) => {
    const ref = line.split(/\s+/)[1] || line;
    return ref === name;
  });
  return hit ? [hit] : [];
}

function serveFetch(request) {
  const body = request || {};
  if (body.build) {
    return {
      decision: 'block',
      rule: 'no-fresh-pack',
      served: [],
      servedBytes: 0,
      generatedPacks: 0,
    };
  }
  const have = new Set(body.haves || []);
  const trunk = body.trunk || 'main';
  const served = [];
  for (const pack of body.stored || []) {
    if (!pack || have.has(pack.id)) continue;
    if (pack.base !== trunk && !have.has(pack.base)) continue;
    served.push({ id: pack.id, bytes: Number(pack.bytes) || 0 });
  }
  const servedBytes = served.reduce((sum, pack) => sum + pack.bytes, 0);
  return {
    decision: 'allow',
    rule: 'stored-packs',
    served,
    servedBytes,
    generatedPacks: 0,
  };
}

function git(repo, args) {
  return spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

function readPushDefault(repo) {
  const result = git(repo, ['config', '--get', 'push.default']);
  const value = (result.stdout || '').trim();
  return value || 'simple';
}

function diagnoseRepo(repo) {
  const root = path.resolve(repo);
  const show = git(root, ['show-ref']);
  const gitDir = git(root, ['rev-parse', '--git-path', 'packed-refs']);
  let packedBytes = 0;
  if (gitDir.status === 0) {
    const packedPath = path.resolve(root, gitDir.stdout.trim());
    if (fs.existsSync(packedPath)) packedBytes = fs.statSync(packedPath).size;
  }
  const lines = show.status === 0 ? show.stdout.split('\n').filter(Boolean) : [];
  return {
    repo: root,
    ok: show.status === 0,
    refs: lines.length,
    showRefBytes: Buffer.byteLength(show.stdout || ''),
    packedRefsBytes: packedBytes,
    pushDefault: readPushDefault(root),
    advertised: advertisedBase(lines),
    pushed: false,
  };
}

function stripPush(argv) {
  const args = argv.slice();
  if (args[0] === '--') args.shift();
  if (args[0] === 'git' && args[1] === 'push') return args.slice(2);
  return args;
}

function main(argv) {
  const args = argv || process.argv.slice(2);
  if (args[0] === 'check') {
    const rest = args.slice(1);
    const defaultFlag = rest.indexOf('--default');
    const repoFlag = rest.indexOf('--repo');
    let pushDefault = defaultFlag >= 0 ? rest[defaultFlag + 1] : null;
    const repo = repoFlag >= 0 ? rest[repoFlag + 1] : null;
    if (pushDefault == null && repo) pushDefault = readPushDefault(repo);
    const dash = rest.indexOf('--');
    const pushArgs = stripPush(dash >= 0 ? rest.slice(dash + 1) : []);
    const gate = classifyPush(pushArgs, pushDefault || 'simple');
    process.stdout.write(`decision=${gate.decision} rule=${gate.rule}\n`);
    process.exitCode = gate.decision === 'block' ? EXIT_BLOCK : 0;
    return;
  }
  if (args[0] === 'diagnose') {
    const report = diagnoseRepo(args[1] || '.');
    for (const [key, value] of Object.entries(report)) {
      const printed = Array.isArray(value) ? value.join(',') : value;
      process.stdout.write(`${key}=${printed}\n`);
    }
    process.exitCode = report.ok ? 0 : 2;
    return;
  }
  process.stderr.write('Usage: pando-one-branch.js check -- git push ... | diagnose <repo>\n');
  process.exitCode = 2;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = {
  EXIT_BLOCK,
  classifyPush,
  advertisedBase,
  serveFetch,
  diagnoseRepo,
  main,
};
