'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MAX_INJECT_CHARS,
  MAX_LESSONS,
  describeOutwardAction,
  estimateTokens,
  findLessons,
  guardCapture,
  handleHookEvent,
  installClaude,
  rescopeLessons,
} = require('../scripts/lesson-inject');
const { resolveFeedbackAction } = require('../scripts/feedback-schema');
const { normalizeScope } = require('../scripts/memory-scope-readiness');

const PSN = 'Eci.Psn.StockService';

// The two captures from 2026-10-28, as stored: no projectId, and the second
// one has neither whatWentWrong nor whatToChange.
const ASKED_PERMISSION = {
  id: 'fb_1793210321374_cfr83y',
  signal: 'negative',
  context: 'Igor said "see what damon wants, reply to him", and I drafted to the Outbox, then asked permission before sending',
  whatWentWrong: 'Too slow: the request itself was the approval to send, but I stopped to ask',
  whatToChange: 'When Igor says reply/tell/send/ping someone, send it in that turn through Teams web in the agent browser, verify delivery, and report; draft only when he hasn\'t asked for it to be sent',
};
const DOUBLE_POST = {
  id: 'fb_1793212277020_92a7ku',
  signal: 'down',
  context: 'Igor\'s 1:1 Teams chat with Damon: the 1:58 PM reply (second build job, one story each) already covered it; at 2:29 PM two more messages went out saying the same thing.',
};
const UNRELATED = [
  ['fb_1_swagger', 'Swagger listed localhost:5107 twice', 'Read the generated servers list before adding a server entry'],
  ['fb_2_jira', 'Created duplicate Jira stories under the epic', 'Search parent=epic before creating stories'],
  ['fb_3_deploy', 'Claimed QA deploy was live from a sibling probe', 'Probe the exact URL after deploy before claiming it is live'],
];

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function storeCapture(storeDir, capture) {
  // Mirrors what capture_feedback writes for a promoted negative.
  const scope = normalizeScope(capture);
  writeJsonl(path.join(storeDir, 'feedback-log.jsonl'), [{ ...capture, scope }]);
  writeJsonl(path.join(storeDir, 'memory-log.jsonl'), [{
    id: `mem_${capture.id}`,
    title: `MISTAKE: ${capture.whatWentWrong}`,
    content: `What went wrong: ${capture.whatWentWrong}\nHow to avoid: ${capture.whatToChange}`,
    category: 'error',
    tags: ['feedback', 'negative'],
    scope,
    sourceFeedbackId: capture.id,
    timestamp: new Date().toISOString(),
  }]);
}

function makeWorld() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-inject-'));
  const psn = path.join(home, 'workspace', 'projects', PSN);
  const sharedProject = path.join(home, 'workspace', 'projects', 'secure-yolo');
  const otherProject = path.join(home, 'workspace', 'projects', 'trading');
  for (const dir of [psn, sharedProject, otherProject]) fs.mkdirSync(path.join(dir, '.git'), { recursive: true });

  // A git worktree of PSN: `.git` is a file pointing into the main repo.
  const worktree = path.join(home, 'workspace', 'psn-worktree');
  const gitDir = path.join(psn, '.git', 'worktrees', 'psn-worktree');
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'commondir'), '../..\n');
  fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${gitDir}\n`);

  // Launcher-started MCP servers write into this shared store for every project.
  const sharedStore = path.join(sharedProject, '.thumbgate');
  const runtime = path.join(home, '.thumbgate', 'runtime');
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, 'local-feedback-profile.json'), JSON.stringify({
    projectDir: sharedProject,
    feedbackDir: sharedStore,
  }));
  for (const [id, wrong, change] of UNRELATED) {
    storeCapture(path.join(psn, '.thumbgate'), { id, signal: 'negative', context: wrong, whatWentWrong: wrong, whatToChange: change });
  }
  return { home, psn, worktree, sharedStore, otherProject };
}

function prompt(world, text, cwd = world.psn, sessionId = `s-${Math.random()}`) {
  return handleHookEvent('prompt', { prompt: text, cwd, session_id: sessionId }, { home: world.home });
}

test('replay 2026-10-28: unscoped capture in the shared store never reaches PSN', () => {
  const world = makeWorld();
  storeCapture(world.sharedStore, ASKED_PERMISSION);
  assert.equal(prompt(world, 'reply to Damon'), null);
});

test('replay 2026-10-28: stamped lesson surfaces on "reply to Damon" and stays silent otherwise', () => {
  const world = makeWorld();

  const guard = guardCapture(ASKED_PERMISSION, { cwd: world.psn, home: world.home });
  const stamped = guard.hookSpecificOutput.updatedInput;
  assert.equal(stamped.projectId, PSN);
  assert.equal(stamped.projectDir, world.psn);
  storeCapture(world.sharedStore, stamped);

  const output = prompt(world, 'reply to Damon');
  assert.ok(output, 'expected an injection for "reply to Damon"');
  const text = output.hookSpecificOutput.additionalContext;
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(text, /send it in that turn through Teams web/);
  assert.match(text, new RegExp(`ThumbGate lessons for ${PSN.replace(/\./g, '\\.')}`));
  assert.ok(text.length <= MAX_INJECT_CHARS);
  assert.ok(estimateTokens(text) <= 300, `injection costs ${estimateTokens(text)} tokens`);

  assert.equal(prompt(world, 'summarize the quarterly AWS cost report'), null, 'unrelated prompt must stay silent');
  assert.equal(prompt(world, 'reply to Damon', world.otherProject), null, 'another project must not see PSN lessons');
  assert.ok(prompt(world, 'reply to Damon', path.join(world.worktree, 'src')), 'a PSN worktree shares the PSN lessons');
});

test('replay 2026-10-28: the rule-less double-post capture is refused', () => {
  const world = makeWorld();
  const guard = guardCapture(DOUBLE_POST, { cwd: world.psn, home: world.home });
  assert.equal(guard.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(guard.hookSpecificOutput.permissionDecisionReason, /whatToChange/);

  const action = resolveFeedbackAction({ signal: 'negative', context: DOUBLE_POST.context, whatWentWrong: 'Sent the same reply to Damon three times' });
  assert.equal(action.type, 'no-action');
  assert.match(action.reason, /whatToChange/);

  const withRule = resolveFeedbackAction({
    signal: 'negative',
    context: DOUBLE_POST.context,
    whatWentWrong: 'Sent the same reply to Damon three times',
    whatToChange: 'Read the chat for an existing reply before sending another one',
  });
  assert.equal(withRule.type, 'store-mistake');

  const repaired = resolveFeedbackAction({
    signal: 'negative',
    context: 'Sent the same reply to Damon three times; check the chat for an existing reply before sending',
  });
  assert.equal(repaired.type, 'store-mistake');
  assert.match(repaired.memory.content, /How to avoid: check the chat for an existing reply before sending/);
});

test('a lesson is injected once per session within the seen window', () => {
  const world = makeWorld();
  storeCapture(path.join(world.psn, '.thumbgate'), ASKED_PERMISSION);
  assert.ok(prompt(world, 'reply to Damon', world.psn, 'same'));
  assert.equal(prompt(world, 'reply to Damon again', world.psn, 'same'), null);
  assert.ok(prompt(world, 'reply to Damon', world.psn, 'other'));
});

test('injection keeps to the top lessons and the character budget', () => {
  const world = makeWorld();
  for (let i = 0; i < 6; i += 1) {
    storeCapture(path.join(world.psn, '.thumbgate'), {
      ...ASKED_PERMISSION,
      id: `fb_damon_${i}`,
      whatToChange: `${ASKED_PERMISSION.whatToChange} (variant ${i}) ${'and keep the reply short '.repeat(4)}`,
    });
  }
  const result = findLessons('reply to Damon', { cwd: world.psn, home: world.home });
  assert.ok(result.lessons.length >= 1 && result.lessons.length <= MAX_LESSONS);
  assert.ok(result.chars <= MAX_INJECT_CHARS);
});

test('global tier lessons reach every project; pruned and rule-less lessons never do', () => {
  const world = makeWorld();
  storeCapture(path.join(world.home, '.thumbgate', 'global'), {
    id: 'fb_global_push', signal: 'negative', context: 'Pushed to master directly',
    whatWentWrong: 'Pushed to master directly', whatToChange: 'Branch first, then push the branch and open a pull request',
  });
  writeJsonl(path.join(world.psn, '.thumbgate', 'memory-log.jsonl'), [
    { id: 'mem_pruned', content: 'How to avoid: push the branch to master carefully', pruned: true, sourceFeedbackId: 'x' },
    { id: 'mem_norule', content: 'Context: push branch master\nAction needed: investigate and prevent recurrence', sourceFeedbackId: 'y' },
  ]);
  const ids = (cwd) => findLessons('push the branch to master', { cwd, home: world.home }).lessons.map((l) => l.id);
  assert.deepEqual(ids(world.psn), ['mem_fb_global_push']);
  assert.deepEqual(ids(world.otherProject), ['mem_fb_global_push']);
});

test('PreToolUse injects only for outward actions', () => {
  const world = makeWorld();
  storeCapture(path.join(world.psn, '.thumbgate'), ASKED_PERMISSION);
  const pretool = (tool_name, tool_input) => handleHookEvent('pretool', { tool_name, tool_input, cwd: world.psn, session_id: `p-${Math.random()}` }, { home: world.home });

  const send = pretool('mcp__Claude_Browser__browser_batch', { actions: [
    { name: 'computer', input: { action: 'type', text: 'Done, both jobs are green', action_summary: 'Types the reply to Damon' } },
    { name: 'computer', input: { action: 'key', text: 'Return', action_summary: 'Sends the reply to Damon in Teams' } },
  ] });
  assert.equal(send.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(send.hookSpecificOutput.additionalContext, /Teams web/);

  assert.equal(pretool('Bash', { command: 'ls -la' }), null);
  assert.equal(pretool('mcp__Claude_Browser__computer', { action: 'screenshot' }), null);
  assert.equal(describeOutwardAction('Bash', { command: 'git status' }), null);
  assert.ok(describeOutwardAction('Bash', { command: 'git push origin feat/x' }));
  assert.ok(describeOutwardAction('mcp__abc__addOrEditJiraIssueComment', { issueIdOrKey: 'DIST03-1', commentBody: 'done' }));
});

test('rescope appends stamped copies to the project store and leaves the source alone', () => {
  const world = makeWorld();
  storeCapture(world.sharedStore, ASKED_PERMISSION);
  const before = fs.readFileSync(path.join(world.sharedStore, 'memory-log.jsonl'), 'utf8');

  const first = rescopeLessons({ fromDir: world.sharedStore, ids: ['fb_1793210321374'], projectDir: world.worktree, home: world.home });
  assert.equal(first.projectId, PSN);
  assert.deepEqual(first.copied, { feedback: [ASKED_PERMISSION.id], memory: [`mem_${ASKED_PERMISSION.id}`] });
  const second = rescopeLessons({ fromDir: world.sharedStore, ids: ['fb_1793210321374'], projectDir: world.psn, home: world.home });
  assert.deepEqual(second.copied, { feedback: [], memory: [] });

  assert.equal(fs.readFileSync(path.join(world.sharedStore, 'memory-log.jsonl'), 'utf8'), before);
  assert.ok(prompt(world, 'reply to Damon'));
});

test('installClaude keeps existing hooks, backs up settings, and is idempotent', () => {
  const world = makeWorld();
  const settingsPath = path.join(world.home, 'settings.json');
  const existing = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'psn-claim-gate prompt' }] }] }, model: 'opus' };
  fs.writeFileSync(settingsPath, JSON.stringify(existing));
  const targetDir = path.join(world.home, '.thumbgate', 'hooks', 'lesson-inject');

  const first = installClaude({ settingsPath, targetDir });
  installClaude({ settingsPath, targetDir });
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

  assert.equal(JSON.parse(fs.readFileSync(first.backupPath, 'utf8')).model, 'opus');
  assert.equal(settings.model, 'opus');
  assert.equal(settings.hooks.UserPromptSubmit.length, 2);
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, 'psn-claim-gate prompt');
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.ok(fs.existsSync(path.join(targetDir, 'feedback-paths.js')));

  // The installed copy must run as a hook even under a `"type": "module"` parent.
  fs.writeFileSync(path.join(world.home, 'package.json'), '{ "type": "module" }');
  storeCapture(path.join(world.psn, '.thumbgate'), ASKED_PERMISSION);
  const run = require('child_process').spawnSync(process.execPath, [first.scriptPath, 'prompt-hook'], {
    input: JSON.stringify({ prompt: 'reply to Damon', cwd: world.psn, session_id: 'installed' }),
    env: { ...process.env, HOME: world.home },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(JSON.parse(run.stdout).hookSpecificOutput.additionalContext, /Teams web/);
});
