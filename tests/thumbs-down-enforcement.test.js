'use strict';

// End to end, through the real hook commands (no mocks): a thumbs-down, then a new gate, then the next action blocked.
// Covers Claude Code (gate-check, hook-auto-capture, claim-stop-check) and Cursor (cursor-prompt, cursor-mcp-gate,
// cursor-record, cursor-stop) with each host's own payload shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function world() {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-td-fb-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-td-proj-'));
  const env = {
    ...process.env,
    THUMBGATE_FEEDBACK_DIR: feedbackDir,
    THUMBGATE_NO_RATE_LIMIT: '1',
    THUMBGATE_TELEMETRY: '0',
    THUMBGATE_NO_TELEMETRY: '1',
    THUMBGATE_DISABLE_UPDATE_CHECK: '1',
    HOME: project,
  };
  delete env.CLAUDE_USER_PROMPT;
  delete env.THUMBGATE_STRICT_ENFORCEMENT;
  delete env.THUMBGATE_SEND_GATE;
  delete env.THUMBGATE_CLAIM_GATE;
  return { feedbackDir, project, env };
}

function cli(w, sub, payload) {
  const out = spawnSync(process.execPath, [CLI, sub], { cwd: w.project, env: w.env, input: JSON.stringify(payload), encoding: 'utf8', timeout: 60000 });
  return { status: out.status, stdout: String(out.stdout || '') };
}

function claudeDecision(w, toolName, toolInput) {
  const { stdout } = cli(w, 'gate-check', { tool_name: toolName, tool_input: toolInput, cwd: w.project, session_id: 's1' });
  const last = stdout.trim().split('\n').filter(Boolean).pop() || '{}';
  const hso = (JSON.parse(last).hookSpecificOutput) || {};
  return { decision: hso.permissionDecision || 'allow', reason: hso.permissionDecisionReason || '' };
}

test('Claude Code: one thumbs-down holds the next chat post until the last bubble is edited in place', () => {
  const w = world();
  const send = (chat, text) => claudeDecision(w, 'mcp__teams__send_chat_message', { chat_id: chat, text });
  assert.equal(send('chat-a', 'First update.').decision, 'allow');

  cli(w, 'hook-auto-capture', { prompt: 'thumbs down', session_id: 's1', cwd: w.project });

  const again = send('chat-a', 'Sorry, one more thing.');
  assert.equal(again.decision, 'deny', 'the post right after the thumbs-down is refused');
  assert.match(again.reason, /thumbs-down-hold/);
  assert.equal(send('chat-b', 'Trying another chat.').decision, 'deny', 'switching chats does not get around the hold');

  const edit = claudeDecision(w, 'mcp__teams__update_chat_message', { chat_id: 'chat-a', message_id: 'm1', text: 'First update, corrected.' });
  assert.equal(edit.decision, 'allow', 'editing the last bubble in place is allowed');

  const second = send('chat-a', 'A brand new bubble.');
  assert.equal(second.decision, 'deny', 'the hold is gone, but a second new bubble in the same chat is still refused');
  assert.match(second.reason, /send-second-bubble/);
  assert.equal(send('chat-c', 'A first message in another chat.').decision, 'allow', 'after the edit, a first post elsewhere goes through');
});

test('Claude Code: a thumbs-down on a shell command holds that command until the person says go ahead', () => {
  const w = world();
  const run = (command) => claudeDecision(w, 'Bash', { command }).decision;
  assert.equal(run('node scripts/notify-all.js --send'), 'allow');
  cli(w, 'hook-auto-capture', { prompt: 'thumbs down', session_id: 's1', cwd: w.project });
  assert.equal(run('node scripts/notify-all.js --send --force'), 'deny', 'the same command is held');
  assert.equal(run('ls -la'), 'allow', 'other commands are not held');
  cli(w, 'hook-auto-capture', { prompt: 'go ahead', session_id: 's1', cwd: w.project });
  assert.equal(run('node scripts/notify-all.js --send'), 'allow', 'released by the person');
});

test('send rules: a raw URL and "I do not know" are refused before the post; a labelled link is fine', () => {
  const w = world();
  const send = (chat, text) => claudeDecision(w, 'mcp__teams__send_chat_message', { chat_id: chat, text });
  assert.match(send('c1', 'Here it is: https://example.test/a').reason, /send-raw-url/);
  assert.match(send('c2', 'I do not know why it failed.').reason, /send-i-do-not-know/);
  assert.equal(send('c3', 'Here it is: [the report](https://example.test/a)').decision, 'allow');
});

test('deny list: aws s3 rm, terraform destroy and kubectl delete are refused in every form', () => {
  const w = world();
  for (const command of ['aws s3 rm s3://bucket/one-key.txt', 'aws s3 rm s3://bucket --recursive', 'terraform destroy', 'kubectl delete pod web-1', 'kubectl delete namespace prod']) {
    assert.equal(claudeDecision(w, 'Bash', { command }).decision, 'deny', command);
  }
  assert.equal(claudeDecision(w, 'Bash', { command: 'kubectl get pods' }).decision, 'allow');
});

test('Claude Code: one thumbs-down on an unchecked status claim writes the rule, and the next stop with that claim is held', () => {
  const w = world();
  const complaint = 'thumbs down. Do not say sign-in is refused, a host is down, or a ticket is blocked unless this turn opened the page or ran the check and the output is attached. A /health 200 is not a signed-in session. A log from yesterday is not the current state.';
  cli(w, 'hook-auto-capture', { prompt: complaint, session_id: 's1', cwd: w.project });
  const rules = JSON.parse(fs.readFileSync(path.join(w.feedbackDir, 'claim-gate-rules.json'), 'utf8')).rules.map((r) => r.key);
  assert.ok(rules.includes('class:sign-in') && rules.includes('class:host') && rules.includes('class:blocked'), `rules written from one thumbs-down: ${rules}`);

  const transcript = path.join(w.project, 't.jsonl');
  const turn = (text, command) => {
    const lines = [
      { type: 'user', message: { role: 'user', content: 'Can you check the portal?' }, timestamp: '2026-11-25T18:00:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: [
        ...(command ? [{ type: 'tool_use', name: 'Bash', input: { command } }] : []),
        { type: 'text', text },
      ] } },
    ];
    fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n'));
    return cli(w, 'claim-stop-check', { transcript_path: transcript, cwd: w.project, session_id: 's1' }).stdout;
  };
  assert.match(turn('Sign-in is refused on the partner portal.', null), /"decision":"block"/, 'no check at all');
  assert.match(turn('Sign-in is refused on the partner portal.', 'curl -s https://portal.test/health'), /"decision":"block"/, 'a /health call is not a sign-in check');
  assert.match(turn('Sign-in is refused on the partner portal.', 'curl -s -b cookies.txt https://portal.test/account'), /"decision":"block"/, 'the check ran but its output is not in the reply');
  assert.doesNotMatch(turn('Sign-in is refused on the partner portal: `curl -b cookies.txt /account` returned 401.', 'curl -s -b cookies.txt https://portal.test/account'), /"decision":"block"/, 'check ran and output attached');
});

test('Cursor: a typed thumbs-down holds the next MCP chat post, and an unchecked claim gets one follow-up at stop', () => {
  const w = world();
  const base = { conversation_id: 'conv-1', generation_id: 'gen-1', workspace_roots: [w.project] };
  const mcpSend = (text) => {
    const out = cli(w, 'cursor-mcp-gate', { ...base, hook_event_name: 'beforeMCPExecution', mcp_server_name: 'teams', tool_name: 'send_chat_message', tool_input: JSON.stringify({ chat_id: 'chat-a', text }) });
    return { status: out.status, answer: JSON.parse(out.stdout.trim().split('\n').pop()) };
  };
  assert.equal(mcpSend('Update one.').answer.permission, 'allow');
  const prompt = cli(w, 'cursor-prompt', { ...base, hook_event_name: 'beforeSubmitPrompt', prompt: 'thumbs down' });
  assert.match(prompt.stdout, /"continue":true/);
  const held = mcpSend('Update two.');
  assert.equal(held.answer.permission, 'deny', 'the next post after a Cursor thumbs-down is refused');
  assert.equal(held.status, 2);

  cli(w, 'cursor-record', { ...base, hook_event_name: 'afterShellExecution', command: 'curl -s https://portal.test/health', output: '{"ok":true}' });
  cli(w, 'cursor-record', { ...base, hook_event_name: 'afterAgentResponse', text: 'The partner portal is down right now.' });
  const stop = JSON.parse(cli(w, 'cursor-stop', { ...base, hook_event_name: 'stop', status: 'completed', loop_count: 0 }).stdout.trim());
  assert.match(stop.followup_message || '', /claim gate/i, 'the unchecked claim sends the agent back to check');
  const again = JSON.parse(cli(w, 'cursor-stop', { ...base, hook_event_name: 'stop', status: 'completed', loop_count: 1 }).stdout.trim());
  assert.deepEqual(again, {}, 'never loops: one follow-up only');
});

test('Cursor via `thumbgate init --agent cursor`: the wired hooks.json commands carry a thumbs-down to the next MCP post', () => {
  const w = world();
  fs.mkdirSync(path.join(w.project, '.cursor'), { recursive: true });
  spawnSync(process.execPath, [CLI, 'init', '--agent', 'cursor'], { cwd: w.project, env: w.env, encoding: 'utf8', timeout: 60000 });
  const hooks = JSON.parse(fs.readFileSync(path.join(w.project, '.cursor', 'hooks.json'), 'utf8')).hooks;
  for (const lifecycle of ['beforeShellExecution', 'beforeSubmitPrompt', 'beforeMCPExecution', 'afterAgentResponse', 'stop']) {
    assert.ok(Array.isArray(hooks[lifecycle]) && hooks[lifecycle].length > 0, `init wires ${lifecycle}`);
  }
  const run = (lifecycle, payload) => {
    const out = spawnSync('sh', ['-c', hooks[lifecycle][0].command], { cwd: w.project, env: w.env, input: JSON.stringify(payload), encoding: 'utf8', timeout: 60000 });
    return { status: out.status, last: String(out.stdout || '').trim().split('\n').pop() || '{}' };
  };
  const base = { conversation_id: 'conv-i', generation_id: 'gen-1', workspace_roots: [w.project] };
  const post = (chat) => run('beforeMCPExecution', { ...base, hook_event_name: 'beforeMCPExecution', mcp_server_name: 'teams', tool_name: 'send_chat_message', tool_input: JSON.stringify({ chat_id: chat, text: 'Update.' }) });
  assert.equal(JSON.parse(post('chat-a').last).permission, 'allow');
  run('beforeSubmitPrompt', { ...base, hook_event_name: 'beforeSubmitPrompt', prompt: 'thumbs down' });
  const held = post('chat-b');
  assert.equal(JSON.parse(held.last).permission, 'deny', 'the thumbs-down typed in Cursor holds the next post');
  assert.equal(held.status, 2);
});

test('Cursor self-heal: an install from the old init (shell gate only) gets the loop hooks on the next shell command, once', () => {
  const w = world();
  const hooksFile = path.join(w.project, '.cursor', 'hooks.json');
  fs.mkdirSync(path.dirname(hooksFile), { recursive: true });
  const shellGate = `node ${JSON.stringify(path.join(__dirname, '..', 'scripts', 'cursor-shell-gate.js'))}`;
  fs.writeFileSync(hooksFile, JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: shellGate, timeout: 10, failClosed: true }] } }));
  const shell = () => spawnSync('sh', ['-c', shellGate], { cwd: w.project, env: w.env, encoding: 'utf8', timeout: 60000, input: JSON.stringify({ command: 'ls', cwd: w.project, conversation_id: 'c', workspace_roots: [w.project] }) });
  const first = shell();
  assert.equal(JSON.parse(first.stdout.trim().split('\n').pop()).permission, 'allow', 'the decision is unchanged and stdout stays one JSON line');
  const healed = JSON.parse(fs.readFileSync(hooksFile, 'utf8')).hooks;
  for (const lifecycle of ['beforeSubmitPrompt', 'beforeMCPExecution', 'afterShellExecution', 'afterMCPExecution', 'afterAgentResponse', 'stop']) {
    assert.equal((healed[lifecycle] || []).length, 1, `self-heal adds ${lifecycle}`);
  }
  shell();
  assert.deepEqual(JSON.parse(fs.readFileSync(hooksFile, 'utf8')).hooks, healed, 'the second run changes nothing');

  const other = world();
  const otherFile = path.join(other.project, '.cursor', 'hooks.json');
  fs.mkdirSync(path.dirname(otherFile), { recursive: true });
  fs.writeFileSync(otherFile, JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: 'echo mine' }] } }));
  const { repairCursorHooks } = require('../scripts/cursor-self-heal');
  assert.equal(repairCursorHooks({ homeDir: other.project, env: {} }).reason, 'not-a-thumbgate-cursor-install', 'a hooks.json without ThumbGate is left alone');
});
