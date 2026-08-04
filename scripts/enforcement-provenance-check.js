#!/usr/bin/env node
'use strict';

/**
 * Enforcement provenance check.
 *
 * Every registered hook that can DENY a tool call is security control code.
 * This asserts each one resolves to a file tracked in git and reachable from
 * the default branch.
 *
 * Why this exists (2026-08-03):
 *   A guard was installed into the user runtime from a pull request that had
 *   been CLOSED WITHOUT MERGING. It was registered with a match-everything
 *   pattern, so it hard-denied tool calls in every project on the machine. Its
 *   tests never ran in CI, it was absent from the published package, and it was
 *   hand-edited afterwards. Nothing detected any of that for two days.
 *
 * The invariant: enforcement code that is not on the default branch has not
 * been reviewed, and unreviewed enforcement code must not be enforcing.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'Stop', 'SessionStart', 'UserPromptSubmit'];
const SETTINGS_DIR = '.claude';
const SETTINGS_FILES = ['settings.json', 'settings.local.json'];

function settingsCandidates(repoRoot) {
  return [
    path.join(os.homedir(), SETTINGS_DIR, SETTINGS_FILES[0]),
    ...SETTINGS_FILES.map((f) => path.join(repoRoot, SETTINGS_DIR, f)),
  ];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Pull every script path referenced by a hook command string. */
function scriptPathsFrom(command) {
  const out = [];
  // Paths may be bare or wrapped in single/double quotes — a quoted path is the
  // common form and missing it would blind this check to the very case it exists for.
  const re = /(?:^|[\s"'])((?:[\w./~$-]|\\ )+\.(?:js|mjs|cjs|sh))(?=[\s"']|$)/g;
  let m;
  while ((m = re.exec(String(command || '')))) out.push(m[1].replace(/^["']|["']$/g, ''));
  return out;
}

function resolvePath(p, repoRoot) {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  if (path.isAbsolute(p)) return p;
  return path.join(repoRoot, p);
}

function trackedOnDefaultBranch(repoRoot, absolute, defaultBranch) {
  let rel;
  try {
    rel = path.relative(repoRoot, absolute);
  } catch {
    return false;
  }
  if (!rel || rel.startsWith('..')) return false; // lives outside the repository
  try {
    execFileSync('git', ['cat-file', '-e', `${defaultBranch}:${rel}`], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function collectHooks(settings) {
  const found = [];
  const hooks = (settings && settings.hooks) || {};
  for (const event of HOOK_EVENTS) {
    for (const group of hooks[event] || []) {
      for (const hook of group.hooks || []) {
        if (hook && hook.command) {
          found.push({ event, matcher: group.matcher || '(any)', command: hook.command });
        }
      }
    }
  }
  return found;
}

function audit(repoRoot, defaultBranch) {
  const problems = [];
  let checked = 0;
  for (const file of settingsCandidates(repoRoot)) {
    const settings = readJson(file);
    if (!settings) continue;
    for (const hook of collectHooks(settings)) {
      for (const raw of scriptPathsFrom(hook.command)) {
        const absolute = resolvePath(raw, repoRoot);
        checked += 1;
        if (!fs.existsSync(absolute)) {
          problems.push({ ...hook, file, script: raw, why: 'registered hook script does not exist' });
        } else if (!trackedOnDefaultBranch(repoRoot, absolute, defaultBranch)) {
          problems.push({
            ...hook,
            file,
            script: raw,
            why: `not reachable from ${defaultBranch} — unreviewed enforcement code`,
          });
        }
      }
    }
  }
  return { checked, problems };
}

function main() {
  const repoRoot = process.cwd();
  const defaultBranch = process.env.THUMBGATE_DEFAULT_BRANCH || 'origin/main';
  const { checked, problems } = audit(repoRoot, defaultBranch);

  if (problems.length === 0) {
    console.log(`enforcement provenance OK — ${checked} reference(s) verified against ${defaultBranch}`);
    return 0;
  }

  console.error(`enforcement provenance FAILED — ${problems.length} of ${checked} reference(s) unverified\n`);
  for (const p of problems) {
    console.error(`  ${p.event} [${p.matcher}]`);
    console.error(`    script : ${p.script}`);
    console.error(`    from   : ${p.file}`);
    console.error(`    reason : ${p.why}\n`);
  }
  console.error('Enforcement code that is not on the default branch has not been reviewed.');
  return 1;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exit(main());
}

module.exports = { scriptPathsFrom, collectHooks, trackedOnDefaultBranch, resolvePath, audit };
