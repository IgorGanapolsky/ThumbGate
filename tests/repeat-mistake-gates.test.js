'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAwsAccessKeyId } = require('../scripts/secret-fixture-tokens');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-repeat-gates-'));
process.env.THUMBGATE_STATE_DIR = stateDir;
process.env.THUMBGATE_NO_NUDGE = '1';

const gates = require('../scripts/gates-engine');

const CLAIM = 'python3 scripts/swarm-claim.py --agent grok';
const PUBLISH = 'az repos pr update --id 69 --is-draft false';
const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

function withSession(input, sessionId) {
  return Object.assign({}, input, { session_id: sessionId });
}

function armLoss(sessionId, extra) {
  return gates.observeSwarmClaimResult(Object.assign({
    session_id: sessionId,
    tool_name: 'Bash',
    tool_input: { command: CLAIM },
    exitCode: 3,
    output: '{"schema":"psn.swarm-claim/1","agent":"grok","outcome":"stand-down","exit":3}',
  }, extra || {}));
}

function confirmTeams(input) {
  return gates.observeTeamsSendResult(Object.assign({ hook_event_name: 'PostToolUse' }, input));
}

function resetGates() {
  gates.clearSessionActions();
  gates.setCrossReviewLookup(() => false);
}

function bashInput(command, extra) {
  return {
    tool_name: 'Bash',
    tool_input: Object.assign({ command }, extra || {}),
  };
}

function parsedDeny(output) {
  assert.equal(typeof output, 'string');
  const body = JSON.parse(output);
  assert.equal(body.hookSpecificOutput.permissionDecision, 'deny');
  return body;
}

beforeEach(() => {
  resetGates();
});

test('swarm-claim.py exit 3 ends the turn and denies the next git commit', () => {
  const observed = armLoss(SESSION_A);
  const stop = JSON.parse(gates.formatObserveStop(observed));
  assert.equal(stop.continue, false);
  assert.equal(stop.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.equal(stop.hookSpecificOutput.continue, false);
  assert.match(stop.stopReason, /swarm-claim\.py exited 3/);
  assert.match(stop.stopReason, /Denied swarm-claim\.py/);
  assert.equal(gates.hasAction('swarm_claim_lost_exit_3'), false);

  const body = parsedDeny(gates.runHardFloor(withSession(bashInput('git commit -m "keep writing"'), SESSION_A)));
  assert.equal(body.continue, false);
  assert.equal(body.hookSpecificOutput.continue, false);
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /\[GATE:swarm-claim-exit-3-write-after-loss\]/);
  assert.match(body.stopReason, /Denied git commit: swarm-claim\.py exited 3/);
  assert.doesNotMatch(body.stopReason, /be careful|write better code/i);
});

test('an explicit exit other than 3 does not arm from a quoted exit in stdout', () => {
  const observed = gates.observeSwarmClaimResult({
    command: CLAIM,
    exitCode: 0,
    output: 'example {"exit": 3}',
  });
  assert.equal(observed, null);
  assert.equal(gates.hasAction('swarm_claim_lost_exit_3'), false);
  assert.equal(gates.runHardFloor(bashInput('git commit -m "ok"')), null);
});

test('exit 4 does not arm a write deny', () => {
  assert.equal(gates.observeSwarmClaimResult({
    command: CLAIM,
    exitCode: 4,
    output: '{"exit":4}',
  }), null);
  assert.equal(gates.runHardFloor(bashInput('git push origin feature')), null);
});

test('tool_response exitCode 0 wins over stdout JSON exit 3', () => {
  assert.equal(gates.observeSwarmClaimResult({
    tool_name: 'Bash',
    tool_input: { command: CLAIM },
    tool_response: { stdout: '{"exit":3}', exitCode: 0 },
  }), null);
  assert.equal(gates.hasAction('swarm_claim_lost_exit_3'), false);
});

test('after a loss, the claim script, git status, and a read stay allowed', () => {
  armLoss(SESSION_A);
  assert.equal(gates.runHardFloor(withSession(bashInput(CLAIM), SESSION_A)), null);
  assert.equal(gates.runHardFloor(withSession(bashInput('git status'), SESSION_A)), null);
  assert.equal(gates.runHardFloor(withSession({
    tool_name: 'Read',
    tool_input: { file_path: 'README.md' },
  }, SESSION_A)), null);
});

test('after a loss, Edit, git -C commit, and but push are denied by name', () => {
  armLoss(SESSION_A);
  const edit = parsedDeny(gates.runHardFloor(withSession({
    tool_name: 'Edit',
    tool_input: { file_path: 'a.js', old_string: 'a', new_string: 'b' },
  }, SESSION_A)));
  assert.match(edit.stopReason, /Denied Edit: swarm-claim\.py exited 3/);

  resetGates();
  armLoss(SESSION_A);
  const commit = parsedDeny(gates.runHardFloor(withSession(
    bashInput('git -C /tmp/repo commit -m "x"'),
    SESSION_A
  )));
  assert.match(commit.stopReason, /Denied git -C \/tmp\/repo commit: swarm-claim\.py exited 3/);

  resetGates();
  armLoss(SESSION_A, { exit_code: '3' });
  const pushed = parsedDeny(gates.runHardFloor(withSession({ command: 'but push' }, SESSION_A)));
  assert.match(pushed.stopReason, /Denied but push: swarm-claim\.py exited 3/);
});

test('a non-claim command exiting 3 does not arm the write deny', () => {
  assert.equal(gates.observeSwarmClaimResult({ command: 'git status', exitCode: 3, output: '{"exit":3}' }), null);
  assert.equal(gates.runHardFloor(bashInput('git commit -m "no"')), null);
});

test('a second Teams send to Damon on the same point is denied after the first succeeds', () => {
  const first = {
    tool_name: 'teams__teams_send_message',
    tool_input: {
      chat_id: '19:damon',
      recipient: 'Damon',
      text: 'Damon the deploy is ready for review today',
    },
  };
  assert.equal(gates.runHardFloor(first), null);
  assert.equal(Object.keys(gates.listSessionActions()).length, 0);
  assert.equal(confirmTeams(first), null);
  const second = parsedDeny(gates.runHardFloor(first));
  assert.equal(second.continue, undefined);
  assert.match(
    second.hookSpecificOutput.permissionDecisionReason,
    /Denied second Teams send \(teams__teams_send_message\) to Damon on the same point/
  );
  assert.match(second.hookSpecificOutput.permissionDecisionReason, /\[GATE:teams-single-reply-per-message\]/);
});

test('a failed or declined Teams send can be retried', () => {
  const first = {
    tool_name: 'teams__teams_send_message',
    tool_input: {
      chat_id: '19:damon',
      recipient: 'Damon',
      text: 'Damon the deploy is ready for review today',
    },
  };
  assert.equal(gates.runHardFloor(first), null);
  assert.equal(gates.observeTeamsSendResult(Object.assign({
    hook_event_name: 'PostToolUseFailure',
    error: 'Exit code 1\npermission denied',
  }, first)), null);
  assert.equal(gates.runHardFloor(first), null);
  assert.equal(confirmTeams(first), null);
  assert.notEqual(gates.runHardFloor(first), null);
});

test('a different point to the same person is allowed', () => {
  const send = (text) => ({
    tool_name: 'teams__teams_send_message',
    tool_input: { chat_id: '19:damon', recipient: 'Damon', text },
  });
  const first = send('Damon the deploy is ready for review today');
  const other = send('The rollback finished cleanly after the incident');
  assert.equal(gates.runHardFloor(first), null);
  confirmTeams(first);
  assert.equal(gates.runHardFloor(other), null);
});

test('a second reply to the same Teams message id is denied', () => {
  const send = (text) => ({
    tool_name: 'teams__teams_send_message',
    tool_input: { chat_id: '19:damon', text, messageId: 'm-42' },
  });
  const first = send('First note for the thread today');
  assert.equal(gates.runHardFloor(first), null);
  confirmTeams(first);
  const second = parsedDeny(gates.runHardFloor(send('A completely different follow up note')));
  assert.match(second.hookSpecificOutput.permissionDecisionReason, /Denied second Teams send/);
  assert.equal(second.continue, undefined);
});

test('short Teams texts do not collapse into one deny', () => {
  const send = {
    tool_name: 'teams__teams_send_message',
    tool_input: { chat_id: '19:damon', text: 'ok' },
  };
  assert.equal(gates.runHardFloor(send), null);
  confirmTeams(send);
  assert.equal(gates.runHardFloor(send), null);
  assert.equal(Object.keys(gates.listSessionActions()).length, 0);
});

test('gmail send_message is not the Teams gate', () => {
  const send = {
    tool_name: 'mcp__gmail__send_message',
    tool_input: { to: 'Damon', text: 'Damon the deploy is ready for review today' },
  };
  assert.equal(gates.runHardFloor(send), null);
  confirmTeams(send);
  assert.equal(gates.runHardFloor(send), null);
});

test('az repos pr update --is-draft false is denied until another person has commented', () => {
  let lookups = 0;
  gates.setCrossReviewLookup(() => {
    lookups += 1;
    return false;
  });
  const body = parsedDeny(gates.runHardFloor(bashInput(PUBLISH)));
  assert.equal(lookups, 1);
  assert.equal(body.continue, undefined);
  assert.match(
    body.hookSpecificOutput.permissionDecisionReason,
    /Denied `az repos pr update --is-draft false` on PR #69/
  );
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /review comment from the other person does not exist/);
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /\[GATE:az-repos-pr-publish-requires-cross-review\]/);
});

test('az publish stays denied when a tool field or tracked action claims the review already happened', () => {
  gates.trackAction('cross_review_comment_verified:69');
  const body = parsedDeny(gates.runHardFloor(bashInput(PUBLISH, {
    crossReviewCommentExists: true,
    otherPersonReviewed: true,
  })));
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /PR #69/);
});

test('az repos pr update that does not publish does not ask az', () => {
  gates.setCrossReviewLookup(() => {
    throw new Error('az lookup must not run');
  });
  assert.equal(gates.runHardFloor(bashInput('az repos pr update --id 69 --title docs')), null);
  assert.equal(gates.runHardFloor(bashInput('az repos pr update --id 69 --is-draft true')), null);
  assert.equal(gates.runHardFloor(bashInput('az repos pr update --id 69 --draft yes')), null);
});

test('a real other-person review comment allows the draft to publish', () => {
  gates.setCrossReviewLookup(() => true);
  assert.equal(gates.runHardFloor(bashInput(PUBLISH)), null);
});

test('publishing without a pull request id fails closed', () => {
  const body = parsedDeny(gates.runHardFloor(bashInput('az repos pr update --is-draft false')));
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /pull request id could not be parsed/);
});

test('force-push stays on its own gate when no swarm loss is armed', () => {
  assert.equal(gates.runHardFloor(bashInput('git push --force origin main')), null);
  const result = gates.evaluateGates('Bash', { command: 'git push --force origin main' });
  assert.equal(result && result.gate, 'force-push');
});

test('secret exfiltration still wins when no swarm loss is armed', () => {
  const body = parsedDeny(gates.runHardFloor(bashInput(`echo ${buildAwsAccessKeyId()}`)));
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /\[GATE:secret-exfiltration\]/);
  assert.equal(body.continue, undefined);
});

test('secret exfiltration still wins when a swarm loss is already armed', () => {
  armLoss(SESSION_A);
  const body = parsedDeny(gates.runHardFloor(withSession(
    bashInput(`echo ${buildAwsAccessKeyId()}`),
    SESSION_A
  )));
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /\[GATE:secret-exfiltration\]/);
  assert.equal(body.continue, undefined);
});

test('a failed shell exit 3 arms only the losing session', () => {
  const observed = gates.observeSwarmClaimResult({
    hook_event_name: 'PostToolUseFailure',
    session_id: SESSION_A,
    cwd: '/repo-a',
    tool_name: 'Bash',
    tool_input: { command: CLAIM },
    error: 'Exit code 3\n{"schema":"psn.swarm-claim/1","agent":"grok","outcome":"stand-down","exit":3}',
  });
  const stop = JSON.parse(gates.formatObserveStop(observed));
  assert.equal(stop.continue, false);
  assert.equal(stop.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
  assert.match(stop.stopReason, /swarm-claim\.py exited 3/);
  assert.equal(gates.hasAction('swarm_claim_lost_exit_3'), false);
  const actions = gates.listSessionActions();
  const stored = Object.values(actions).find((entry) => entry.metadata && entry.metadata.agent === 'grok');
  assert.ok(stored, 'the claim agent is stored on the losing session marker');

  const edit = parsedDeny(gates.runHardFloor(withSession({
    cwd: '/repo-b',
    tool_name: 'Edit',
    tool_input: { file_path: 'a.js', old_string: 'a', new_string: 'b' },
  }, SESSION_A)));
  assert.match(edit.stopReason, /Denied Edit: swarm-claim\.py exited 3/);
  assert.equal(gates.runHardFloor(withSession({
    cwd: '/repo-a',
    tool_name: 'Edit',
    tool_input: { file_path: 'a.js', old_string: 'a', new_string: 'b' },
  }, SESSION_B)), null);
  assert.equal(gates.runHardFloor({
    cwd: '/repo-a',
    tool_name: 'Edit',
    tool_input: { file_path: 'a.js', old_string: 'a', new_string: 'b' },
  }), null);
});

test('a swarm loss without a session id does not deny every later write', () => {
  const observed = gates.observeSwarmClaimResult({
    hook_event_name: 'PostToolUseFailure',
    cwd: '/repo-a',
    tool_name: 'Bash',
    tool_input: { command: CLAIM },
    error: 'Exit code 3\n{"agent":"grok","exit":3}',
  });
  assert.equal(JSON.parse(gates.formatObserveStop(observed)).continue, false);
  assert.equal(gates.hasAction('swarm_claim_lost_exit_3'), false);
  assert.equal(gates.runHardFloor(bashInput('git commit -m "no session"')), null);
  assert.equal(gates.runHardFloor(withSession(bashInput('git commit -m "other"'), SESSION_B)), null);
});

test('an interrupt or a non-3 failure exit does not arm from stdout', () => {
  assert.equal(gates.observeSwarmClaimResult({
    hook_event_name: 'PostToolUseFailure',
    session_id: SESSION_A,
    tool_name: 'Bash',
    tool_input: { command: CLAIM },
    is_interrupt: true,
    error: 'Exit code 3\n{"exit":3}',
  }), null);
  assert.equal(gates.observeSwarmClaimResult({
    hook_event_name: 'PostToolUseFailure',
    session_id: SESSION_A,
    tool_name: 'Bash',
    tool_input: { command: CLAIM },
    error: 'Exit code 0\n{"exit":3}',
  }), null);
  assert.equal(gates.observeSwarmClaimResult({
    session_id: SESSION_A,
    command: CLAIM,
    exitCode: 0,
    error: 'Exit code 3\n{"exit":3}',
  }), null);
  assert.equal(gates.runHardFloor(withSession(bashInput('git commit -m "ok"'), SESSION_A)), null);
});

test('agent id scopes a loss when the event has no session id', () => {
  gates.observeSwarmClaimResult({
    agent_id: 'agent-loser',
    tool_name: 'Bash',
    tool_input: { command: CLAIM },
    exitCode: 3,
  });
  const denied = parsedDeny(gates.runHardFloor({
    agent_id: 'agent-loser',
    tool_name: 'Edit',
    tool_input: { file_path: 'a.js', old_string: 'a', new_string: 'b' },
  }));
  assert.match(denied.stopReason, /Denied Edit/);
  assert.equal(gates.runHardFloor({
    agent_id: 'agent-winner',
    tool_name: 'Edit',
    tool_input: { file_path: 'a.js', old_string: 'a', new_string: 'b' },
  }), null);
});

test('observe-tool-result prints an empty object unless swarm-claim.py exited 3', () => {
  const cli = path.join(__dirname, '..', 'bin', 'cli.js');
  const quiet = spawnSync(process.execPath, [cli, 'observe-tool-result'], {
    input: JSON.stringify({ command: 'git status', exitCode: 3 }),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      THUMBGATE_STATE_DIR: stateDir,
      THUMBGATE_NO_NUDGE: '1',
    }),
  });
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout.trim(), '{}');

  const stopped = spawnSync(process.execPath, [cli, 'observe-tool-result'], {
    input: JSON.stringify({ command: CLAIM, exitCode: 3, output: '{"exit":3}' }),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      THUMBGATE_STATE_DIR: stateDir,
      THUMBGATE_NO_NUDGE: '1',
    }),
  });
  assert.equal(stopped.status, 0);
  const body = JSON.parse(stopped.stdout);
  assert.equal(body.continue, false);
  assert.equal(body.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(body.stopReason, /Denied swarm-claim\.py: swarm-claim\.py exited 3/);

  const failed = spawnSync(process.execPath, [cli, 'observe-tool-result'], {
    input: JSON.stringify({
      hook_event_name: 'PostToolUseFailure',
      session_id: SESSION_A,
      tool_name: 'Bash',
      tool_input: { command: CLAIM },
      error: 'Exit code 3\n{"agent":"grok","exit":3}',
    }),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      THUMBGATE_STATE_DIR: stateDir,
      THUMBGATE_NO_NUDGE: '1',
    }),
  });
  assert.equal(failed.status, 0);
  const failureBody = JSON.parse(failed.stdout);
  assert.equal(failureBody.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
  assert.equal(failureBody.continue, false);
  const armedEdit = parsedDeny(gates.runHardFloor(withSession({
    tool_name: 'Edit',
    tool_input: { file_path: 'a.js', old_string: 'a', new_string: 'b' },
  }, SESSION_A)));
  assert.match(armedEdit.stopReason, /Denied Edit/);

  const teams = {
    hook_event_name: 'PostToolUse',
    tool_name: 'teams__teams_send_message',
    tool_input: {
      chat_id: '19:damon',
      recipient: 'Damon',
      text: 'Damon the deploy is ready for review today',
    },
  };
  const recorded = spawnSync(process.execPath, [cli, 'observe-tool-result'], {
    input: JSON.stringify(teams),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      THUMBGATE_STATE_DIR: stateDir,
      THUMBGATE_NO_NUDGE: '1',
    }),
  });
  assert.equal(recorded.status, 0);
  assert.equal(recorded.stdout.trim(), '{}');
  const secondTeams = parsedDeny(gates.runHardFloor(teams));
  assert.match(secondTeams.hookSpecificOutput.permissionDecisionReason, /Denied second Teams send/);
  assert.equal(secondTeams.continue, undefined);
});
