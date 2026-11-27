'use strict';

// 27 Nov 2026: after a thumbs-down, a Gmail get_message and a read-only `gh api` loop were refused, and "fix it" and
// "fix all problems" did not release the hold. Reads are never held; a plain instruction to fix releases.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sg = require('../scripts/send-gate');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tg-hold-read-'));
const call = (dir, toolName, toolInput, now) => sg.evaluate({ feedbackDir: dir, toolName, toolInput, sessionId: 's', now });
const down = (dir, now) => sg.placeHold({ feedbackDir: dir, sessionId: 's', reason: 'thumbs down', now });
const bash = (command) => ['Bash', { command }];

const GH_LOOP = 'for pr in 1 2 3; do gh api repos/o/r/pulls/$pr --jq \'.state + " " + .title\'; done';

test('the two refused calls from 27 Nov run while a hold is active', () => {
  for (const [toolName, input] of [['mcp__claude_ai_Gmail__get_message', { messageId: 'm1' }], bash(GH_LOOP)]) {
    const dir = fresh();
    const t = Date.now();
    call(dir, toolName, input, t);
    down(dir, t + 1000);
    assert.equal(call(dir, toolName, input, t + 2000), null, `${toolName} is a read`);
  }
});

test('a read after the marked action does not move the hold off that action', () => {
  const dir = fresh();
  const t = Date.now();
  call(dir, ...bash('git push origin main'), t);
  call(dir, ...bash('git status'), t + 500);
  call(dir, 'Read', { file_path: '/x' }, t + 600);
  down(dir, t + 1000);
  const r = call(dir, ...bash('git push origin main'), t + 2000);
  assert.equal(r && r.gate, 'thumbs-down-hold');
});

test('read-only classification is strict', () => {
  for (const [toolName, input] of [
    ['Read', {}], ['Grep', {}], ['mcp__x__list_threads', {}], bash(GH_LOOP),
    bash('git log --oneline -3 | head -2'), bash('ls -la 2>/dev/null && grep -n "a;b > c" f.txt'),
  ]) assert.equal(sg.isReadOnlyCall(toolName, input), true, `${toolName} ${input.command || ''}`);
  for (const [toolName, input] of [
    ['Write', {}], ['mcp__x__get_or_create_label', {}], ['mcp__x__send_message', {}], ['mcp__x__reply', {}],
    bash('rm -rf tests'), bash('git push origin main'), bash('ls; rm a'), bash('ls | sh'), bash('echo hi > f'),
    bash('echo $(rm a)'), bash('echo "`rm a`"'), bash('find . -delete'), bash('find . -exec rm {} +'),
    bash('gh api repos/o/r/issues -f title=x'), bash('gh api -X DELETE repos/o/r'), bash('gh api -XPOST repos/o/r'),
    bash('gh pr merge 1'), bash('sort -o out in'), bash('git diff --output=f'), bash('git -c core.pager=sh log'),
    bash('rg --pre ./run x'), bash('FOO=1 ls'), bash('cat <<EOF\nx\nEOF'), bash("echo $'a\\'' ; rm a #'"), bash(''),
    bash("ls # it's\nrm -rf x # '"), bash('for a in -delete; do find . $a; done'), bash('gh api repos/o/r $m'),
    bash('gh api -iXDELETE repos/o/r'), bash('printf -v PATH x; ls'), ['mcp__x__read_and_archive', {}],
  ]) assert.equal(sg.isReadOnlyCall(toolName, input), false, `${toolName} ${input.command || ''}`);
});

test('plain instructions to fix release the hold; other talk does not', () => {
  for (const prompt of ['fix it', 'fix all problems', 'Please fix this', 'ok, now fix them', 'repair it', 'go ahead']) {
    assert.equal(sg.isReleasePrompt(prompt), true, prompt);
  }
  for (const prompt of ['do not fix it', 'why did you fix that?', 'what is the fix', 'fixing it was wrong', 'no']) {
    assert.equal(sg.isReleasePrompt(prompt), false, prompt);
  }
});

test('replay: thumbs down, then "fix all problems" through the real prompt hook releases the hold', () => {
  const dir = fresh();
  const env = { ...process.env, THUMBGATE_FEEDBACK_DIR: dir, THUMBGATE_NO_TELEMETRY: '1', HOME: dir };
  const prompt = (text) => spawnSync(process.execPath, [CLI, 'hook-auto-capture'], {
    cwd: dir, env: { ...env, CLAUDE_USER_PROMPT: text }, input: JSON.stringify({ prompt: text, session_id: 's' }), encoding: 'utf8', timeout: 60000,
  });
  const t = Date.now();
  call(dir, ...bash('git push origin main'), t);
  prompt('thumbs down');
  assert.equal(sg.listHolds({ feedbackDir: dir }).holds.length, 1, 'the thumbs-down placed a hold');
  prompt('fix all problems');
  assert.equal(sg.listHolds({ feedbackDir: dir }).holds.length, 0, 'released');
});
