'use strict';

// The first thumbs-down in a project explains holds once through the real hook; `thumbgate doctor` lists current holds;
// the guide has the "Stuck? Do this" box.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sg = require('../scripts/send-gate');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function world() {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-htd-fb-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-htd-proj-'));
  const env = {
    ...process.env,
    THUMBGATE_FEEDBACK_DIR: feedbackDir,
    THUMBGATE_NO_RATE_LIMIT: '1',
    THUMBGATE_NO_TELEMETRY: '1',
    THUMBGATE_DISABLE_UPDATE_CHECK: '1',
    HOME: project,
  };
  for (const k of ['CLAUDE_USER_PROMPT', 'THUMBGATE_THUMBS_DOWN_HOLD', 'THUMBGATE_SEND_GATE']) delete env[k];
  return { feedbackDir, project, env };
}

function run(w, args, input) {
  const out = spawnSync(process.execPath, [CLI, ...args], { cwd: w.project, env: w.env, input: input ? JSON.stringify(input) : undefined, encoding: 'utf8', timeout: 90000 });
  return String(out.stdout || '');
}

test('REQ-01: the first thumbs-down in a project explains holds once, later ones do not', () => {
  const w = world();
  const first = run(w, ['hook-auto-capture'], { prompt: 'thumbs down', session_id: 's1', cwd: w.project });
  for (const part of ['hold is a pause', 'go ahead', 'thumbgate holds off']) assert.ok(first.includes(part), `first message has "${part}"`);
  const second = run(w, ['hook-auto-capture'], { prompt: 'thumbs down', session_id: 's1', cwd: w.project });
  assert.ok(!second.includes('hold is a pause'), 'second thumbs-down does not repeat the lesson');
});

test('REQ-02: formatHolds names each hold and the command that clears it', () => {
  assert.match(sg.formatHolds({ holdsOff: false, holds: [] }), /none held right now/);
  const text = sg.formatHolds({ holdsOff: false, holds: [{ kind: 'action', toolName: 'Bash', signature: 'git push origin' }] });
  assert.match(text, /held: `git push origin …`\s+clear it: npx thumbgate holds release/);
  assert.match(sg.formatHolds({ holdsOff: true, holds: [] }), /holds: OFF/);
});

test('REQ-03: `thumbgate doctor` prints the current holds, in text and in --json', () => {
  const w = world();
  const t = Date.now();
  sg.evaluate({ feedbackDir: w.feedbackDir, toolName: 'Bash', toolInput: { command: 'git push origin main' }, sessionId: 's1', now: t });
  sg.placeHold({ feedbackDir: w.feedbackDir, sessionId: 's1', reason: 'no', now: t + 1000 });
  const text = run(w, ['doctor']);
  assert.match(text, /Holds \(pauses after a thumbs-down\)/);
  assert.match(text, /clear it: npx thumbgate holds release/);
  const json = JSON.parse(run(w, ['doctor', '--json']));
  assert.equal(json.holds.holds.length, 1);
});

test('REQ-04: the guide Holds section opens with a three-line "Stuck? Do this" box', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'guide.html'), 'utf8');
  const at = html.indexOf('id="holds"');
  const box = html.slice(at, at + 900);
  assert.match(box, /Stuck\? Do this/);
  for (const part of ['go ahead', 'thumbgate holds release', 'thumbgate holds off']) assert.ok(box.includes(part), `box has ${part}`);
});
