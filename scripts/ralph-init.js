#!/usr/bin/env node
'use strict';

// `thumbgate ralph init`: a Ralph loop starter for any repo, with ThumbGate's gates and a verification Stop hook.
//
// The Ralph loop is Geoffrey Huntley's technique (https://ghuntley.com/ralph/): run the agent again and again with a
// fresh context, keep the state on disk (a task list and a progress log), one task per run. Anthropic also ships an
// in-session version as the `ralph-loop` Claude Code plugin. This starter is the outside-the-session form, with two
// checks added: ThumbGate's PreToolUse gates on every tool call, and `thumbgate verify-stop`, which runs your tests
// when the agent says it is done and sends failures back.
//
// Writes (never overwrites an existing file): PROMPT.md, prd.json, progress.txt, ralph.sh, .thumbgate/verify.json,
// and adds the verify-stop hook to .claude/settings.json (keeping every hook already there).

const fs = require('node:fs');
const path = require('node:path');

function detectVerifyCommand(cwd) {
  const has = (f) => fs.existsSync(path.join(cwd, f));
  if (has('package.json')) {
    try {
      const scripts = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts || {};
      const parts = ['lint', 'typecheck', 'test'].filter((s) => scripts[s] && !/no test specified/.test(scripts[s]));
      if (parts.length) return parts.map((s) => (s === 'test' ? 'npm test' : `npm run ${s}`)).join(' && ');
    } catch { /* fall through */ }
  }
  if (has('pyproject.toml') || has('pytest.ini') || has('setup.cfg')) return 'python -m pytest -q';
  if (has('Cargo.toml')) return 'cargo test';
  if (has('go.mod')) return 'go test ./...';
  if (has('Makefile')) return 'make test';
  return '';
}

const PROMPT = `# Ralph loop prompt

You are one run of a loop. You start with no memory of earlier runs; the files are your memory.

1. Read \`prd.json\` and \`progress.txt\`.
2. Pick the single highest-priority task in \`prd.json\` whose \`passes\` is false. Work on that one task only.
3. Implement it. Then run the verification command in \`.thumbgate/verify.json\` and make it pass.
   Never skip, delete or weaken a test to get green.
4. Commit the change with a message naming the task id.
5. Set that task's \`passes\` to true in \`prd.json\` and add two or three lines to \`progress.txt\`:
   what you did, what you learned, and anything the next run must know.
6. Stop. If every task now passes, end your last message with <promise>COMPLETE</promise>.

ThumbGate checks every tool call against the rules learned from thumbs-downs in this repo. If a call is denied,
do not retry it in another form; note it in progress.txt and pick another approach.
`;

const PRD = {
  project: 'Describe the project in one line',
  tasks: [
    {
      id: 'T1',
      priority: 1,
      title: 'First task, small enough for one run',
      acceptance: ['A check a machine can run, e.g. "npm test passes" or "GET /health returns 200"'],
      passes: false,
    },
  ],
};

const PROGRESS = '# Progress log (one entry per run, newest last)\n';

const RALPH_SH = `#!/usr/bin/env bash
# Ralph loop: fresh agent context per run, state on disk. Stops on <promise>COMPLETE</promise> or MAX_RUNS.
# Credit: Geoffrey Huntley, https://ghuntley.com/ralph/. Gates and the verify Stop hook come from ThumbGate.
set -euo pipefail
MAX_RUNS="\${MAX_RUNS:-20}"
AGENT="\${AGENT:-claude -p --permission-mode acceptEdits}"
mkdir -p .thumbgate/ralph
for i in $(seq 1 "$MAX_RUNS"); do
  echo "=== Ralph run $i of $MAX_RUNS ==="
  out=".thumbgate/ralph/run-$i.log"
  # shellcheck disable=SC2086
  if ! $AGENT < PROMPT.md | tee "$out"; then
    # A failed run never counts as complete, even if it printed the marker.
    echo "Run $i exited with an error; see $out"
    continue
  fi
  if grep -q '<promise>COMPLETE</promise>' "$out"; then
    echo "All tasks pass after $i runs."
    exit 0
  fi
done
echo "Stopped after $MAX_RUNS runs without <promise>COMPLETE</promise>. Read progress.txt."
exit 1
`;

function writeIfMissing(file, content, written, skipped) {
  if (fs.existsSync(file)) { skipped.push(file); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  written.push(file);
}

function wireStopHook(cwd, command) {
  const file = path.join(cwd, '.claude', 'settings.json');
  let settings = {};
  if (fs.existsSync(file)) {
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { file, wired: false, reason: 'settings.json is not valid JSON; left unchanged' }; }
  }
  settings.hooks = settings.hooks || {};
  const stop = Array.isArray(settings.hooks.Stop) ? settings.hooks.Stop : [];
  const present = stop.some((entry) => (entry.hooks || []).some((h) => /\bverify-stop\b/.test(String(h.command || ''))));
  if (present) return { file, wired: false, reason: 'already wired' };
  stop.push({ hooks: [{ type: 'command', command, timeout: 900 }] });
  settings.hooks.Stop = stop;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return { file, wired: true };
}

function ralphInit(options = {}) {
  const cwd = options.cwd || process.cwd();
  const written = [];
  const skipped = [];
  const verifyCommand = options.verifyCommand || detectVerifyCommand(cwd);
  writeIfMissing(path.join(cwd, 'PROMPT.md'), PROMPT, written, skipped);
  writeIfMissing(path.join(cwd, 'prd.json'), `${JSON.stringify(PRD, null, 2)}\n`, written, skipped);
  writeIfMissing(path.join(cwd, 'progress.txt'), PROGRESS, written, skipped);
  writeIfMissing(path.join(cwd, 'ralph.sh'), RALPH_SH, written, skipped);
  try { fs.chmodSync(path.join(cwd, 'ralph.sh'), 0o755); } catch { /* not fatal */ }
  writeIfMissing(path.join(cwd, '.thumbgate', 'verify.json'), `${JSON.stringify({ command: verifyCommand, timeoutSec: 600, maxRounds: 3 }, null, 2)}\n`, written, skipped);
  const hookCommand = options.hookCommand || require('./hook-runtime').buildPortableHookCommand('verify-stop');
  const hook = options.wire === false ? { wired: false, reason: 'skipped (--no-wire)' } : wireStopHook(cwd, hookCommand);
  return { cwd, verifyCommand, written, skipped, hook };
}

function runCli(argv = process.argv.slice(2)) {
  const sub = argv[0];
  if (sub !== 'init') {
    process.stdout.write('Usage: thumbgate ralph init [--verify "npm test"] [--no-wire] [--json]\n');
    return sub ? 2 : 0;
  }
  const verifyIdx = argv.indexOf('--verify');
  const result = ralphInit({ verifyCommand: verifyIdx >= 0 ? argv[verifyIdx + 1] : undefined, wire: !argv.includes('--no-wire') });
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  const rel = (f) => path.relative(result.cwd, f);
  const lines = ['Ralph loop starter'];
  if (result.written.length) lines.push(`  wrote: ${result.written.map(rel).join(', ')}`);
  if (result.skipped.length) lines.push(`  kept (already there): ${result.skipped.map(rel).join(', ')}`);
  lines.push(result.verifyCommand
    ? `  verify command: ${result.verifyCommand}`
    : '  verify command: none found. Put one in .thumbgate/verify.json, e.g. {"command": "npm test"}.');
  lines.push(`  Stop hook: ${result.hook.wired ? `added to ${rel(result.hook.file)}` : result.hook.reason}`);
  lines.push('', 'Next: list your tasks in prd.json, then run ./ralph.sh');
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

module.exports = { ralphInit, detectVerifyCommand, wireStopHook, runCli, PROMPT, RALPH_SH };

if (require.main === module) process.exitCode = runCli();
