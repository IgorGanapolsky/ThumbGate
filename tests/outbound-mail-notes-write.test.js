'use strict';

// 27 Nov 2026: a shell command that only appended notes to local files was refused by the outbound mail rule, because
// the note text named the mail tool. Text written to a notes file is not a send; everything else stays refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-mail-notes-'));
process.env.THUMBGATE_FEEDBACK_DIR = sandbox;
process.env.HOME = sandbox;
process.env.THUMBGATE_NO_TELEMETRY = '1';
const { evaluateGates } = require('../scripts/gates-engine');

// Built from parts so this file does not itself read as a send.
const TOOL = `mcp__claude_ai_Gmail__${['send', 'message'].join('_')}`;
const SEND = `gws api users/me/${['messages', 'send'].join('/')}`;
const verdict = (command) => {
  const result = evaluateGates('Bash', { command });
  return result && result.decision === 'deny' && result.gate === 'outbound-email-send' ? 'refused' : 'allowed';
};

test('appending a note that names the mail tool is allowed', () => {
  for (const command of [
    `printf '%s\\n' 'BLOCKED: ${TOOL} is refused by the mail rule' >> .herdr-report.md`,
    `echo "the ${TOOL} call was denied" >> notes.txt`,
    `cd /tmp && echo 'use ${TOOL} later' >> log.md && printf 'ok ${TOOL}\\n' > state.jsonl`,
    `cat >> notes.md <<'EOF'\nthe ${TOOL} tool is blocked\nEOF`,
    `echo 'a | b; ${TOOL}' >> notes.md`,
  ]) assert.equal(verdict(command), 'allowed', command);
});

test('a made-up originalCommand does not excuse a send', () => {
  const result = evaluateGates('Bash', { command: SEND, originalCommand: 'echo hi >> notes.md' });
  assert.equal(result && result.gate, 'outbound-email-send');
});

test('anything that sends, or could run the written text, is still refused', () => {
  for (const command of [
    SEND,
    `echo '${SEND}' >> run.command`,
    `echo '${SEND}' > notes.md && source notes.md`,
    `echo '${TOOL}' >> notes.md; ${SEND}`,
    `echo "$(${SEND})" >> notes.md`,
    `echo ok >> notes.md\n${SEND}`,
    `echo hi # '\n${SEND} # ' >> notes.md`,
    `echo '${SEND}'`,
    `printf '-va[$(${SEND})]' x >> notes.md`,
    `printf -v out '${SEND}' >> notes.md`,
    `cat >> notes.md <<'EOF'\nnote\nEOF\n${SEND}`,
    `cat >> run.command <<'EOF'\n${SEND}\nEOF`,
  ]) assert.equal(verdict(command), 'refused', command);
});
