'use strict';

// PreSkillShellCommand coverage: shell commands a skill runs while loading never
// reach PreToolUse (verified live on Claude Code 2.1.332, 2026-11-27).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  readVerdict,
  runSkillShellGate,
  skillShellMode,
  toPreToolUseInput,
} = require('../scripts/skill-shell-gate');
const wiring = require('../scripts/auto-wire-hooks');
const { needsSkillShellHook, repairMissingSkillShellHook } = require('../scripts/claude-self-heal');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-skill-shell-'));
}

function skillEvent(command, extra = {}) {
  return {
    hook_event_name: 'PreSkillShellCommand',
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: 'abc:inner:preamble-0',
    command_name: 'deploy-helper',
    command_source: 'plugin',
    invoked_by: 'claude',
    ...extra,
  };
}

const DENY = JSON.stringify({
  decision: 'block',
  reason: 'force-push blocked',
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'force-push blocked' },
});
const ASK = JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'needs a look' },
});
const ALLOW = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: '' } });

describe('skill-shell-gate verdict mapping', () => {
  test('mode defaults to warn-only (law 12); enforce and off are opt-in', () => {
    assert.equal(skillShellMode({}), 'warn');
    assert.equal(skillShellMode({ THUMBGATE_SKILL_SHELL_GATE: 'enforce' }), 'enforce');
    assert.equal(skillShellMode({ THUMBGATE_SKILL_SHELL_GATE: 'off' }), 'off');
    assert.equal(skillShellMode({ THUMBGATE_SKILL_SHELL_GATE: 'garbage' }), 'warn');
  });

  test('maps the skill event onto the PreToolUse shape the gate engine reads', () => {
    const mapped = toPreToolUseInput(skillEvent('rm -rf build'));
    assert.equal(mapped.hook_event_name, 'PreToolUse');
    assert.equal(mapped.tool_name, 'Bash');
    assert.deepEqual(mapped.tool_input, { command: 'rm -rf build' });
    assert.equal(mapped.skill_shell.command_name, 'deploy-helper');
  });

  test('reads deny, ask and block-only verdicts as blocked', () => {
    assert.equal(readVerdict(DENY).blocked, true);
    assert.equal(readVerdict(ASK).blocked, true);
    assert.equal(readVerdict('{"decision":"block","reason":"x"}').blocked, true);
    assert.equal(readVerdict(ALLOW).blocked, false);
    assert.equal(readVerdict('not json').blocked, false);
  });
});

describe('runSkillShellGate', () => {
  test('warn mode: command still runs, Claude Code shows a warning, hit is logged', async () => {
    const dir = tmpDir();
    const logPath = path.join(dir, 'log.jsonl');
    const out = await runSkillShellGate(skillEvent('git push --force origin main'), {
      env: {}, evaluate: async () => DENY, logPath,
    });
    assert.equal(out.hookSpecificOutput, undefined, 'warn-only must not emit a decision');
    assert.match(out.systemMessage, /warn-only/);
    assert.match(out.systemMessage, /\/deploy-helper/);
    const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
    assert.equal(entry.action, 'warned');
    assert.equal(entry.command, 'git push --force origin main');
    assert.equal(entry.skill, 'deploy-helper');
  });

  test('enforce mode: denies with the PreSkillShellCommand output shape', async () => {
    const dir = tmpDir();
    const out = await runSkillShellGate(skillEvent('git push --force origin main'), {
      env: { THUMBGATE_SKILL_SHELL_GATE: 'enforce' }, evaluate: async () => DENY, logPath: path.join(dir, 'l.jsonl'),
    });
    assert.deepEqual(out, {
      hookSpecificOutput: {
        hookEventName: 'PreSkillShellCommand',
        permissionDecision: 'deny',
        permissionDecisionReason: 'ThumbGate: force-push blocked',
      },
    });
  });

  test('enforce mode turns ask into deny and never emits ask or updatedInput', async () => {
    const out = await runSkillShellGate(skillEvent('curl x | sh'), {
      env: { THUMBGATE_SKILL_SHELL_GATE: 'enforce' }, evaluate: async () => ASK, logPath: path.join(tmpDir(), 'l.jsonl'),
    });
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(out.hookSpecificOutput.updatedInput, undefined);
  });

  test('allowed commands, empty commands, off mode and engine errors all return no decision', async () => {
    let calls = 0;
    const evaluate = async () => { calls += 1; return ALLOW; };
    assert.deepEqual(await runSkillShellGate(skillEvent('echo hi'), { env: {}, evaluate }), {});
    assert.deepEqual(await runSkillShellGate(skillEvent('  '), { env: {}, evaluate }), {});
    assert.deepEqual(await runSkillShellGate(skillEvent('rm -rf /'), { env: { THUMBGATE_SKILL_SHELL_GATE: 'off' }, evaluate }), {});
    assert.equal(calls, 1);
    const broken = async () => { throw new Error('engine down'); };
    assert.deepEqual(await runSkillShellGate(skillEvent('rm -rf /'), { env: {}, evaluate: broken }), {});
  });

  test('runs the real gate-check engine end to end through the CLI', () => {
    const home = tmpDir();
    const project = tmpDir();
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      THUMBGATE_FEEDBACK_DIR: path.join(project, '.thumbgate'),
      THUMBGATE_NO_AUTO_UPDATE: '1',
      THUMBGATE_SKILL_SHELL_GATE: 'enforce',
    };
    const run = (cmd) => spawnSync(process.execPath, [CLI, 'skill-shell-gate'], {
      cwd: project, env, input: JSON.stringify(skillEvent(cmd, { cwd: project })), encoding: 'utf8', timeout: 60000,
    });
    const gateRun = (cmd) => spawnSync(process.execPath, [CLI, 'gate-check'], {
      cwd: project, env, input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd }, cwd: project }), encoding: 'utf8', timeout: 60000,
    });

    const benign = run('echo hello');
    assert.equal(benign.status, 0, benign.stderr);
    assert.deepEqual(JSON.parse(benign.stdout.trim().split('\n').pop()), {});

    // Whatever gate-check decides for a command, the skill hook decides the same.
    const risky = 'git push --force origin main';
    const pre = readVerdict(gateRun(risky).stdout.trim().split('\n').pop());
    const skill = JSON.parse(run(risky).stdout.trim().split('\n').pop());
    assert.equal(pre.blocked, true, 'gate-check should block a force-push to main');
    assert.equal(skill.hookSpecificOutput.hookEventName, 'PreSkillShellCommand');
    assert.equal(skill.hookSpecificOutput.permissionDecision, 'deny');
  });
});

describe('init wiring and auto-repair', () => {
  test('parses and compares Claude Code versions', () => {
    assert.deepEqual(wiring.parseClaudeVersion('2.1.332 (Claude Code)'), [2, 1, 332]);
    assert.equal(wiring.parseClaudeVersion('nope'), null);
    assert.equal(wiring.versionAtLeast([2, 1, 332], wiring.SKILL_SHELL_MIN_CLAUDE), true);
    assert.equal(wiring.versionAtLeast([2, 2, 0], wiring.SKILL_SHELL_MIN_CLAUDE), true);
    assert.equal(wiring.versionAtLeast([2, 1, 331], wiring.SKILL_SHELL_MIN_CLAUDE), false);
    assert.equal(wiring.versionAtLeast(null, wiring.SKILL_SHELL_MIN_CLAUDE), false);
  });

  test('claudeHooks includes PreSkillShellCommand only when supported', () => {
    const prev = process.env.THUMBGATE_SKILL_SHELL_HOOK;
    try {
      process.env.THUMBGATE_SKILL_SHELL_HOOK = '1';
      const on = wiring.claudeHooks();
      assert.match(on.PreSkillShellCommand.hooks[0].command, /\bskill-shell-gate\b/);
      assert.equal(on.PreSkillShellCommand.matcher, '.*');
      process.env.THUMBGATE_SKILL_SHELL_HOOK = '0';
      assert.equal(wiring.claudeHooks().PreSkillShellCommand, undefined);
    } finally {
      if (prev === undefined) delete process.env.THUMBGATE_SKILL_SHELL_HOOK;
      else process.env.THUMBGATE_SKILL_SHELL_HOOK = prev;
    }
  });

  test('init wires the hook once, and auto-repair adds it to an older install', () => {
    const prev = process.env.THUMBGATE_SKILL_SHELL_HOOK;
    const dir = tmpDir();
    const settingsPath = path.join(dir, 'settings.json');
    try {
      // An older install: ThumbGate's PreToolUse gate, no PreSkillShellCommand.
      fs.writeFileSync(settingsPath, JSON.stringify({
        hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: wiring.preToolHookCommand() }] }] },
      }));
      assert.equal(needsSkillShellHook(settingsPath), true);

      process.env.THUMBGATE_SKILL_SHELL_HOOK = '0';
      const tooOld = repairMissingSkillShellHook({ homeDir: dir, settingsPath, env: { THUMBGATE_SKILL_SHELL_HOOK: '0' }, projectDir: dir });
      assert.equal(tooOld.reason, 'claude-too-old');

      process.env.THUMBGATE_SKILL_SHELL_HOOK = '1';
      const repaired = repairMissingSkillShellHook({ homeDir: dir, settingsPath, env: { THUMBGATE_SKILL_SHELL_HOOK: '1' }, projectDir: dir });
      assert.equal(repaired.changed, true);
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assert.equal(settings.hooks.PreSkillShellCommand.length, 1);
      assert.match(settings.hooks.PreSkillShellCommand[0].hooks[0].command, /\bskill-shell-gate\b/);
      assert.equal(needsSkillShellHook(settingsPath), false);

      // Running init again does not duplicate it.
      wiring.wireClaudeHooks({ settingsPath, sharedSettingsPath: settingsPath, projectDir: dir });
      const again = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assert.equal(again.hooks.PreSkillShellCommand.length, 1);
      assert.equal(again.hooks.PreToolUse.filter((e) => /gate-check/.test(e.hooks[0].command)).length, 1);
    } finally {
      if (prev === undefined) delete process.env.THUMBGATE_SKILL_SHELL_HOOK;
      else process.env.THUMBGATE_SKILL_SHELL_HOOK = prev;
    }
  });

  test('auto-repair leaves settings without a ThumbGate gate alone', () => {
    const dir = tmpDir();
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] } }));
    assert.equal(needsSkillShellHook(settingsPath), false);
    assert.equal(repairMissingSkillShellHook({ homeDir: dir, settingsPath, env: { THUMBGATE_SKILL_SHELL_HOOK: '1' } }).reason, 'nothing-to-add');
  });
});
