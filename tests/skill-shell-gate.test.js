'use strict';

// PreSkillShellCommand coverage: shell commands a skill runs while loading never
// reach PreToolUse (verified live on Claude Code 2.1.332, 2026-11-27).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { readVerdict, runSkillShellGate, skillShellMode, toPreToolUseInput } = require('../scripts/skill-shell-gate');
const wiring = require('../scripts/auto-wire-hooks');
const { needsSkillShellHook, repairMissingSkillShellHook } = require('../scripts/claude-self-heal');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tg-skill-shell-'));
const skillEvent = (command, extra = {}) => ({
  hook_event_name: 'PreSkillShellCommand', tool_name: 'Bash', tool_input: { command },
  command_name: 'deploy-helper', command_source: 'plugin', invoked_by: 'claude', ...extra,
});
const verdict = (permissionDecision, reason) => JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason },
});
const DENY = verdict('deny', 'hard reset blocked');
const ASK = verdict('ask', 'needs a look');
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
    const out = await runSkillShellGate(skillEvent('git reset --hard HEAD~3'), {
      env: {}, evaluate: async () => DENY, logPath,
    });
    assert.equal(out.hookSpecificOutput, undefined, 'warn-only must not emit a decision');
    assert.match(out.systemMessage, /warn-only/);
    assert.match(out.systemMessage, /\/deploy-helper/);
    const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
    assert.equal(entry.action, 'warned');
    assert.equal(entry.command, 'git reset --hard HEAD~3');
    assert.equal(entry.skill, 'deploy-helper');
  });

  test('enforce mode: denies with the PreSkillShellCommand output shape', async () => {
    const dir = tmpDir();
    const out = await runSkillShellGate(skillEvent('git reset --hard HEAD~3'), {
      env: { THUMBGATE_SKILL_SHELL_GATE: 'enforce' }, evaluate: async () => DENY, logPath: path.join(dir, 'l.jsonl'),
    });
    assert.deepEqual(out, {
      hookSpecificOutput: {
        hookEventName: 'PreSkillShellCommand',
        permissionDecision: 'deny',
        permissionDecisionReason: 'ThumbGate: hard reset blocked',
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
    const env = { ...process.env, HOME: home, USERPROFILE: home, THUMBGATE_FEEDBACK_DIR: path.join(project, '.thumbgate'),
      THUMBGATE_NO_AUTO_UPDATE: '1', THUMBGATE_SKILL_SHELL_GATE: 'enforce' };
    const cli = (sub, payload) => {
      const r = spawnSync(process.execPath, [CLI, sub], { cwd: project, env, input: JSON.stringify(payload), encoding: 'utf8', timeout: 60000 });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim().split('\n').pop();
    };
    assert.deepEqual(JSON.parse(cli('skill-shell-gate', skillEvent('echo hello', { cwd: project }))), {});

    // Whatever gate-check decides for a command, the skill hook decides the same.
    const risky = 'git reset --hard HEAD~3';
    const pre = readVerdict(cli('gate-check', { tool_name: 'Bash', tool_input: { command: risky }, cwd: project }));
    const skill = JSON.parse(cli('skill-shell-gate', skillEvent(risky, { cwd: project })));
    assert.equal(pre.blocked, true, 'gate-check should block a hard reset');
    assert.equal(skill.hookSpecificOutput.hookEventName, 'PreSkillShellCommand');
    assert.equal(skill.hookSpecificOutput.permissionDecision, 'deny');
  });
});

function withHookFlag(value, fn) {
  const prev = process.env.THUMBGATE_SKILL_SHELL_HOOK;
  process.env.THUMBGATE_SKILL_SHELL_HOOK = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.THUMBGATE_SKILL_SHELL_HOOK; else process.env.THUMBGATE_SKILL_SHELL_HOOK = prev;
  }
}

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
    const on = withHookFlag('1', () => wiring.claudeHooks());
    assert.match(on.PreSkillShellCommand.hooks[0].command, /\bskill-shell-gate\b/);
    assert.equal(on.PreSkillShellCommand.matcher, '.*');
    assert.equal(withHookFlag('0', () => wiring.claudeHooks()).PreSkillShellCommand, undefined);
  });

  test('init wires the hook once, and auto-repair adds it to an older install', () => withHookFlag('1', () => {
    const dir = tmpDir();
    const settingsPath = path.join(dir, 'settings.json');
    {
      // An older install: ThumbGate's PreToolUse gate, no PreSkillShellCommand.
      fs.writeFileSync(settingsPath, JSON.stringify({
        hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: wiring.preToolHookCommand() }] }] },
      }));
      assert.equal(needsSkillShellHook(settingsPath), true);

      const tooOld = repairMissingSkillShellHook({ homeDir: dir, settingsPath, env: { THUMBGATE_SKILL_SHELL_HOOK: '0' }, projectDir: dir });
      assert.equal(tooOld.reason, 'claude-too-old');

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
    }
  }));

  test('auto-repair leaves settings without a ThumbGate gate alone', () => {
    const dir = tmpDir();
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] } }));
    assert.equal(needsSkillShellHook(settingsPath), false);
    assert.equal(repairMissingSkillShellHook({ homeDir: dir, settingsPath, env: { THUMBGATE_SKILL_SHELL_HOOK: '1' } }).reason, 'nothing-to-add');
  });
});
