'use strict';

// AGENT-3667 items E1/E2/F2/F3/F5: real `gate-check` hook runs for bulk-destroy commands,
// decode-then-match for base64 pipelines, action-based (not word-based) matching, and the
// two-thumbs-down gate that actually denies.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');

function makeProject() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-bulk-'));
  cp.execFileSync('git', ['init', '-q'], { cwd: proj });
  const env = {
    ...process.env,
    THUMBGATE_FEEDBACK_DIR: path.join(proj, '.thumbgate'),
    THUMBGATE_NO_RATE_LIMIT: '1',
    PWD: proj,
    CLAUDE_PROJECT_DIR: proj,
  };
  delete env.THUMBGATE_STRICT_ENFORCEMENT;
  delete env.THUMBGATE_GOVERNANCE_MODE;
  return { proj, env };
}

function gateCheck({ proj, env }, command) {
  const input = JSON.stringify({
    session_id: 'bulk-test', cwd: proj, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command },
  });
  const res = cp.spawnSync(process.execPath, [CLI, 'gate-check'], { cwd: proj, env, input, encoding: 'utf8', timeout: 60000 });
  const line = String(res.stdout).split('\n').filter((l) => l.startsWith('{')).pop() || '{}';
  const parsed = JSON.parse(line);
  const decision = (parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecision) || parsed.decision || 'allow';
  return decision === 'block' ? 'deny' : decision;
}

const b64 = (s) => Buffer.from(s).toString('base64');

test('bulk-destroy commands are denied on a default install, read-only siblings are allowed', () => {
  const ctx = makeProject();
  try {
    const deny = [
      'aws s3 rm s3://bucket --recursive',
      'aws s3 rb s3://bucket --force',
      'terraform destroy -auto-approve',
      'terraform apply -destroy',
      'sudo terraform destroy',
      'kubectl delete namespace prod',
      'kubectl delete pods --all-namespaces --all',
      'bash -c "kubectl delete ns staging"',
      'docker system prune -a',
      'gcloud projects delete my-proj',
      'find . -delete',
      `echo ${b64('rm -rf ~')} | base64 -d | sh`,
      `echo ${b64('rm -rf ~')} | base64 --decode | bash`,
      `echo ${b64('terraform destroy')} | base64 -d | sh`,
    ];
    const allow = [
      'terraform plan -destroy',
      'terraform apply',
      'kubectl get pods --all-namespaces',
      'kubectl delete pod web-1',
      'docker system prune',
      'docker ps -a',
      'aws s3 ls s3://bucket --recursive',
      'aws s3 rm s3://bucket/file.txt',
      "find . -name '*.pyc' -delete",
      'grep -rn "terraform destroy" docs/',
      'echo "aws s3 rm --recursive is dangerous"',
      `echo ${b64('ls -la')} | base64 -d`,
    ];
    for (const command of deny) assert.equal(gateCheck(ctx, command), 'deny', `expected deny: ${command}`);
    for (const command of allow) assert.equal(gateCheck(ctx, command), 'allow', `expected allow: ${command}`);
  } finally {
    fs.rmSync(ctx.proj, { recursive: true, force: true });
  }
});

test('matching is on the action: reads that mention billing or policy pass, real IAM changes are denied', () => {
  const ctx = makeProject();
  try {
    const allow = [
      'grep -rn billing src/',
      'grep -rn "policy" docs/',
      'git log --grep="billing policy" --oneline',
      'echo "we should update the billing policy and the role grant docs"',
      'rg -n "iam policy|revoke role" .',
      'aws iam get-policy --policy-arn arn:aws:iam::123456789012:policy/x',
      'aws iam list-policies',
      'gcloud billing accounts list',
    ];
    const deny = [
      'aws iam put-role-policy --role-name r --policy-name p --policy-document file://p.json',
      'aws iam attach-user-policy --user-name u --policy-arn arn:aws:iam::aws:policy/AdministratorAccess',
      'gcloud projects add-iam-policy-binding my-proj --member=user:a@b.c --role=roles/owner',
      'gcloud billing projects unlink my-proj',
    ];
    for (const command of allow) assert.equal(gateCheck(ctx, command), 'allow', `expected allow: ${command}`);
    for (const command of deny) assert.equal(gateCheck(ctx, command), 'deny', `expected deny: ${command}`);
  } finally {
    fs.rmSync(ctx.proj, { recursive: true, force: true });
  }
});

function thumbsDown(ctx, command, n) {
  // Run the command through the hook (so it is remembered), then type a thumbs-down in a distinct prompt.
  gateCheck(ctx, command);
  const payload = JSON.stringify({
    session_id: 'bulk-test',
    cwd: ctx.proj,
    hook_event_name: 'UserPromptSubmit',
    prompt: `thumbs down, that deletion was wrong, attempt ${n}`,
    prompt_id: `bulk-prompt-${n}`,
    timestamp: new Date(Date.now() + n * 1000).toISOString(),
  });
  cp.spawnSync(process.execPath, [CLI, 'hook-auto-capture'], { cwd: ctx.proj, env: ctx.env, input: payload, encoding: 'utf8', timeout: 60000 });
}

test('two identical thumbs-downs from a person on one command create a gate that denies it; one does not', () => {
  const ctx = makeProject();
  try {
    const command = 'rm -rf tests/';
    assert.equal(gateCheck(ctx, command), 'allow', 'allowed before any thumbs-down');
    thumbsDown(ctx, command, 1);
    assert.equal(gateCheck(ctx, command), 'allow', 'one thumbs-down is not enough');
    thumbsDown(ctx, command, 2);
    assert.equal(gateCheck(ctx, command), 'deny', 'second identical thumbs-down creates a denying gate');
    assert.equal(gateCheck(ctx, 'rm -rf build/'), 'allow', 'a different command is untouched');
  } finally {
    fs.rmSync(ctx.proj, { recursive: true, force: true });
  }
});
