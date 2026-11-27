'use strict';

// 27 Nov 2026: the claim gate's Stop message printed as an error, with unrelated lessons attached.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { evaluateDraft } = require('../scripts/claim-gate-stop');

const HOOK = path.join(__dirname, '..', 'scripts', 'claim-gate-stop.js');
const CLAIM = 'Sign-in is refused on the partner portal.';

function stop(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-quiet-'));
  const transcript = path.join(dir, 't.jsonl');
  fs.writeFileSync(transcript, [
    { type: 'user', version, message: { role: 'user', content: 'Check the portal?' } },
    { type: 'assistant', version, message: { role: 'assistant', content: [{ type: 'text', text: CLAIM }] } },
  ].map((line) => JSON.stringify(line)).join('\n'));
  const run = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ transcript_path: transcript, hook_event_name: 'Stop' }),
    env: { ...process.env, HOME: dir, THUMBGATE_FEEDBACK_DIR: dir, THUMBGATE_NO_TELEMETRY: '1' },
    encoding: 'utf8',
  });
  return JSON.parse(run.stdout);
}

test('the message is one line and carries no retrieved lessons', () => {
  const { reason } = evaluateDraft(CLAIM, { toolNames: [], retrieve: () => [{ content: 'UNRELATED LESSON' }] });
  assert.doesNotMatch(reason, /\n|UNRELATED|Lessons/);
  assert.match(reason, /partner portal/);
  assert.match(reason, /"not checked"/);
  assert.ok(reason.length < 320, String(reason.length));
});

test('a current Claude Code gets hook feedback, not a hook error', () => {
  const out = stop('2.1.332');
  assert.equal(out.decision, undefined);
  assert.equal(out.hookSpecificOutput.hookEventName, 'Stop');
  assert.match(out.hookSpecificOutput.additionalContext, /partner portal/);
});

test('older or unknown hosts still get the blocking form', () => {
  for (const version of ['2.1.100', '1.9.999', undefined]) assert.equal(stop(version).decision, 'block', String(version));
});
