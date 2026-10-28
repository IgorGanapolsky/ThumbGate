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
  const observed = gates.observeSwarmClaimResult({
    tool_name: 'Bash',
    tool_input: { command: CLAIM },
    tool_response: '{"outcome":"stand-down","exit":3}\n',
  });
  const stop = JSON.parse(gates.formatObserveStop(observed));
  assert.equal(stop.continue, false);
  assert.equal(stop.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.equal(stop.hookSpecificOutput.continue, false);
  assert.match(stop.stopReason, /swarm-claim\.py exited 3/);
  assert.match(stop.stopReason, /Denied swarm-claim\.py/);

  const body = parsedDeny(gates.runHardFloor(bashInput('git commit -m "keep writing"')));
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
  gates.observeSwarmClaimResult({ command: CLAIM, exitCode: 3 });
  assert.equal(gates.runHardFloor(bashInput(CLAIM)), null);
  assert.equal(gates.runHardFloor(bashInput('git status')), null);
  assert.equal(gates.runHardFloor({ tool_name: 'Read', tool_input: { file_path: 'README.md' } }), null);
});

test('after a loss, Edit, git -C commit, and but push are denied by name', () => {
  gates.observeSwarmClaimResult({ command: CLAIM, exitCode: 3 });
  const edit = parsedDeny(gates.runHardFloor({
    tool_name: 'Edit',
    tool_input: { file_path: 'a.js', old_string: 'a', new_string: 'b' },
  }));
  assert.match(edit.stopReason, /Denied Edit: swarm-claim\.py exited 3/);

  resetGates();
  gates.observeSwarmClaimResult({ command: CLAIM, exitCode: 3 });
  const commit = parsedDeny(gates.runHardFloor(bashInput('git -C /tmp/repo commit -m "x"')));
  assert.match(commit.stopReason, /Denied git -C \/tmp\/repo commit: swarm-claim\.py exited 3/);

  resetGates();
  gates.observeSwarmClaimResult({ command: CLAIM, exit_code: '3' });
  const pushed = parsedDeny(gates.runHardFloor({ command: 'but push' }));
  assert.match(pushed.stopReason, /Denied but push: swarm-claim\.py exited 3/);
});

test('a non-claim command exiting 3 does not arm the write deny', () => {
  assert.equal(gates.observeSwarmClaimResult({ command: 'git status', exitCode: 3, output: '{"exit":3}' }), null);
  assert.equal(gates.runHardFloor(bashInput('git commit -m "no"')), null);
});

test('a second Teams send to Damon on the same point is denied', () => {
  const first = {
    tool_name: 'teams__teams_send_message',
    tool_input: {
      chat_id: '19:damon',
      recipient: 'Damon',
      text: 'Damon the deploy is ready for review today',
    },
  };
  assert.equal(gates.runHardFloor(first), null);
  const second = parsedDeny(gates.runHardFloor(first));
  assert.equal(second.continue, undefined);
  assert.match(
    second.hookSpecificOutput.permissionDecisionReason,
    /Denied second Teams send \(teams__teams_send_message\) to Damon on the same point/
  );
  assert.match(second.hookSpecificOutput.permissionDecisionReason, /\[GATE:teams-single-reply-per-message\]/);
});

test('a different point to the same person is allowed', () => {
  const send = (text) => gates.runHardFloor({
    tool_name: 'teams__teams_send_message',
    tool_input: { chat_id: '19:damon', recipient: 'Damon', text },
  });
  assert.equal(send('Damon the deploy is ready for review today'), null);
  assert.equal(send('The rollback finished cleanly after the incident'), null);
});

test('a second reply to the same Teams message id is denied', () => {
  const send = (text) => ({
    tool_name: 'teams__teams_send_message',
    tool_input: { chat_id: '19:damon', text, messageId: 'm-42' },
  });
  assert.equal(gates.runHardFloor(send('First note for the thread today')), null);
  const second = parsedDeny(gates.runHardFloor(send('A completely different follow up note')));
  assert.match(second.hookSpecificOutput.permissionDecisionReason, /Denied second Teams send/);
});

test('short Teams texts do not collapse into one deny', () => {
  const send = {
    tool_name: 'teams__teams_send_message',
    tool_input: { chat_id: '19:damon', text: 'ok' },
  };
  assert.equal(gates.runHardFloor(send), null);
  assert.equal(gates.runHardFloor(send), null);
});

test('gmail send_message is not the Teams gate', () => {
  const send = {
    tool_name: 'mcp__gmail__send_message',
    tool_input: { to: 'Damon', text: 'Damon the deploy is ready for review today' },
  };
  assert.equal(gates.runHardFloor(send), null);
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
  gates.observeSwarmClaimResult({ command: CLAIM, exitCode: 3 });
  const body = parsedDeny(gates.runHardFloor(bashInput(`echo ${buildAwsAccessKeyId()}`)));
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /\[GATE:secret-exfiltration\]/);
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
});
