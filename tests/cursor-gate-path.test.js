'use strict';

// AGENT-3667 item M: Cursor reported ThumbGate did not stop aws s3 rm, terraform destroy or kubectl delete, and that its
// thumbs-downs added no gate. Causes found: the Cursor plugin hooks file only ran the hook for a few keywords, the
// plugin script piped Cursor's {"command"} payload into the Claude-shaped gate-check (which answers {} = allow), and the
// Cursor adapter was not in the npm package. These tests run the Cursor path itself, in a clean home folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const PLUGIN = path.join(ROOT, 'plugins', 'cursor-marketplace');

function world() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cursor-path-')));
  const project = path.join(home, 'proj');
  fs.mkdirSync(project);
  cp.execFileSync('git', ['init', '-q'], { cwd: project });
  const env = { ...process.env, HOME: home, THUMBGATE_FEEDBACK_DIR: path.join(project, '.thumbgate'), THUMBGATE_NO_RATE_LIMIT: '1', PWD: project };
  for (const n of ['THUMBGATE_STRICT_ENFORCEMENT', 'THUMBGATE_GOVERNANCE_MODE', 'THUMBGATE_CLI']) delete env[n];
  return { home, project, env, done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

// Exactly what Cursor sends on beforeShellExecution, through the plugin's own hook script.
function viaPluginScript(w, command) {
  const input = JSON.stringify({ command, cwd: w.project, hook_event_name: 'beforeShellExecution' });
  const res = cp.spawnSync('bash', [path.join(PLUGIN, 'scripts', 'gate-check.sh')], { cwd: w.project, env: { ...w.env, THUMBGATE_CLI: `${process.execPath} ${CLI}` }, input, encoding: 'utf8', timeout: 90000 });
  const verdict = JSON.parse(String(res.stdout).trim().split('\n').pop() || '{}');
  return { status: res.status, permission: verdict.permission, message: verdict.user_message || '' };
}

test('the Cursor plugin runs the hook on every shell command, not only on a few keywords', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const before = hooks.beforeShellExecution;
  assert.ok(before.length >= 1);
  for (const entry of before) assert.equal(entry.matcher, undefined, `beforeShellExecution must not filter by keyword: ${JSON.stringify(entry)}`);
  assert.ok(hooks.beforeSubmitPrompt.length >= 1, 'the prompt hook is wired so a typed thumbs-down reaches ThumbGate');
  for (const group of Object.values(hooks)) for (const entry of group) assert.ok(fs.existsSync(path.join(PLUGIN, entry.command)), `hook script exists: ${entry.command}`);
});

test('(b) through the Cursor plugin script: aws s3 rm, terraform destroy and kubectl delete are denied, ls is allowed', () => {
  const w = world();
  try {
    const expectations = [
      ['aws s3 rm s3://prod-bucket --recursive', 'cloud-bulk-delete'],
      ['terraform destroy -auto-approve', 'terraform-destroy'],
      ['kubectl delete namespace prod', 'kubectl-bulk-delete'],
    ];
    for (const [command, gate] of expectations) {
      const out = viaPluginScript(w, command);
      assert.equal(out.permission, 'deny', `expected deny: ${command}`);
      assert.equal(out.status, 2, 'Cursor blocks on exit code 2');
      assert.match(out.message, new RegExp(`\\[GATE:${gate}\\]`));
    }
    const ls = viaPluginScript(w, 'ls -la');
    assert.equal(ls.permission, 'allow');
    assert.equal(ls.status, 0);
  } finally {
    w.done();
  }
});

// What Cursor sends on beforeSubmitPrompt, through the plugin's own prompt hook script.
function typePrompt(w, prompt) {
  const input = JSON.stringify({ prompt, conversation_id: 'cursor-conv-1', hook_event_name: 'beforeSubmitPrompt', workspace_roots: [w.project] });
  const res = cp.spawnSync('bash', [path.join(PLUGIN, 'scripts', 'prompt-capture.sh')], { cwd: w.project, env: { ...w.env, THUMBGATE_CLI: `${process.execPath} ${CLI}` }, input, encoding: 'utf8', timeout: 90000 });
  return { status: res.status, out: String(res.stdout).trim() };
}

test('(c) two thumbs-downs typed in Cursor on one command deny that command through the Cursor path; one does not', () => {
  const w = world();
  const command = 'node ./scripts/notify-all-customers.js --send';
  try {
    assert.equal(viaPluginScript(w, command).permission, 'allow', 'before any thumbs-down it runs');
    const first = typePrompt(w, 'thumbs down: that was wrong, it mailed every single customer without asking me first');
    assert.deepEqual([first.status, first.out], [0, '{"continue":true}'], 'the prompt is let through');
    assert.equal(viaPluginScript(w, command).permission, 'allow', 'one thumbs-down is not enough to deny');
    typePrompt(w, 'thumbs down again: you did it a second time and mailed all customers with no approval');
    const gates = JSON.parse(fs.readFileSync(path.join(w.project, '.thumbgate', 'auto-promoted-gates.json'), 'utf8')).gates;
    assert.equal(gates.length, 1, 'a gate was written without anyone editing a file');
    assert.equal(gates[0].action, 'block');
    assert.equal(gates[0].hardDeny, true);
    const after = viaPluginScript(w, command);
    assert.equal(after.permission, 'deny', `second thumbs-down denies the identical command: ${after.message}`);
    assert.equal(after.status, 2);
  } finally {
    w.done();
  }
});

test('the npm package ships the Cursor adapter that the plugin script calls', () => {
  const out = cp.execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const packed = new Set(JSON.parse(out)[0].files.map((f) => f.path));
  assert.ok(packed.has('scripts/cursor-shell-gate.js'), 'scripts/cursor-shell-gate.js is in npm pack');
  assert.ok(packed.has('scripts/gates-engine.js'));
});
