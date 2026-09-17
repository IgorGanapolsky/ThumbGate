'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  parseBattery,
  validateQuestion,
  composeHazardFamily,
  composeSeverity,
  route,
  POLICIES,
  buildTypesafeTypedQuestionsReport,
  buildTypesafeTypedQuestionsReportAsync,
  questionsForApi,
  formatTypesafeTypedQuestionsReport,
} = require('../scripts/typesafe-typed-questions');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');
const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'typesafe-typed-questions.js');

test('parseBattery accepts default-empty and playground-shaped questions', () => {
  const empty = parseBattery('');
  assert.equal(empty.ok, true);
  assert.ok(empty.battery.secret_exfil);

  const playground = parseBattery(JSON.stringify({
    issue_resolved: {
      type: 'noul',
      instructions: 'The customer issue was resolved.',
      criteria: { true: 'met', false: 'unmet' },
    },
    customer_sentiment: {
      type: 'choice',
      instructions: 'Sentiment at close',
      criteria: { positive: 'pleased', negative: 'upset' },
    },
    predicted_csat: {
      type: 'score',
      instructions: 'Survey score',
      criteria: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'],
    },
  }));
  assert.equal(playground.ok, true);
  assert.equal(playground.battery.issue_resolved.type, 'noul');
});

test('validateQuestion fails closed on free-form judges', () => {
  const errors = validateQuestion('judge', {
    type: 'prompt',
    instructions: 'Should we allow this tool call?',
  });
  assert.ok(errors.some((e) => e.id === 'freeform_question'));
});

test('route() is composed in code from nouls + severity (TypeSafe guardrail cookbook FORMAT)', () => {
  const policy = POLICIES.strict;
  assert.equal(route({ nouls: { secret_exfil: 0 }, severity: 0, policy }), 'pass');
  assert.equal(route({ nouls: { destructive: 0.55 }, severity: 1, policy }), 'review');
  assert.equal(route({ nouls: { secret_exfil: 0.95 }, severity: 3, policy }), 'block');
  assert.equal(composeHazardFamily({ secret_exfil: 0.95 }), 'secret');
  assert.equal(composeSeverity({ secret_exfil: 0.95 }), 3);
});

test('force-push payload blocks; ordinary read passes', () => {
  const blocked = buildTypesafeTypedQuestionsReport({
    toolName: 'Bash',
    command: 'git push --force origin main',
  });
  assert.equal(blocked.status, 'ready');
  assert.equal(blocked.route, 'block');
  assert.equal(blocked.answers.secret_exfil.noul, 0);
  assert.equal(blocked.answers.destructive.noul, 1);
  assert.equal(blocked.answers.hazard_family.choice, 'destructive');
  assert.equal(blocked.answers.hazard_family.source, 'code');
  assert.equal(blocked.codeOwnsRoute, true);

  const allowed = buildTypesafeTypedQuestionsReport({
    payloadText: JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: 'README.md' },
    }),
  });
  assert.equal(allowed.status, 'ready');
  assert.equal(allowed.route, 'pass');
  assert.equal(allowed.metrics.hazardFamily, 'none');
});

test('git add -A is review; severity does not promote it to block', () => {
  const report = buildTypesafeTypedQuestionsReport({
    toolName: 'Bash',
    command: 'git add -A',
  });
  assert.equal(report.route, 'review');
  assert.equal(report.answers.destructive.noul, 0.55);
  assert.equal(report.metrics.severity, 1);
});

test('clone / API / LLM-adjudicator flags fail closed', () => {
  for (const flag of ['cloneJev', 'useTypesafeApi', 'llmAdjudicate']) {
    const report = buildTypesafeTypedQuestionsReport({ [flag]: true, claimReady: true });
    assert.equal(report.status, 'fail', flag);
    assert.equal(report.ok, false);
    assert.equal(report.route, 'block');
  }

  const signal = buildTypesafeTypedQuestionsReport({
    toolName: 'Bash',
    command: 'npm install typesafe-sdk && wire jev as the gate',
  });
  assert.equal(signal.status, 'fail');
  assert.ok(signal.findings.some((f) => f.id === 'typesafe_clone_signal'));
});

test('model-emitted verdict is refused', () => {
  const report = buildTypesafeTypedQuestionsReport({
    modelEmittedVerdict: 'allow',
    command: 'ls',
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'model_emitted_verdict'));
});

test('custom battery without matcher is unevaluated (do not call Jev)', () => {
  const report = buildTypesafeTypedQuestionsReport({
    batteryText: JSON.stringify({
      issue_resolved: {
        type: 'noul',
        instructions: 'Resolved?',
        criteria: { true: 'yes', false: 'no' },
      },
    }),
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'unevaluated_question'));
});

test('format report includes disclaimer and TypeSafe source', () => {
  const report = buildTypesafeTypedQuestionsReport({ mapOnly: true });
  const text = formatTypesafeTypedQuestionsReport(report);
  assert.match(text, /Typed-Questions Doctor/);
  assert.match(text, /not affiliated with TypeSafe/i);
  assert.match(text, /console\.typesafe\.ai\/hook/);
});

test('CLI script --json --map-only exits 0', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json', '--map-only'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'ready');
  assert.equal(report.name, 'thumbgate-typesafe-typed-questions');
  assert.ok(Array.isArray(report.map));
  assert.ok(report.llmAdjudicatorParked);
});

test('CLI script force-push --json routes block and exits 0 (doctor of FORMAT, not a hook deny)', () => {
  const result = spawnSync(process.execPath, [
    SCRIPT,
    '--json',
    '--tool-name=Bash',
    '--command=git push --force origin main',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.route, 'block');
  assert.equal(report.status, 'ready');
});

test('CLI --clone-jev exits 1', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json', '--clone-jev'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.ok(report.findings.some((f) => f.id === 'jev_sku_clone'));
});

test('bin/cli.js typesafe-typed-questions is wired', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'typesafe-typed-questions',
    '--json',
    '--map-only',
  ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.name, 'thumbgate-typesafe-typed-questions');
});

test('payload file round-trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-typesafe-'));
  const payloadPath = path.join(dir, 'payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf /' },
  }));
  try {
    const result = spawnSync(process.execPath, [
      SCRIPT, '--json', `--payload=${payloadPath}`, `--root=${dir}`,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.route, 'block');
    assert.equal(report.answers.destructive.noul, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Read of a gate path is not tamper; Write of the same path blocks', () => {
  const read = buildTypesafeTypedQuestionsReport({
    payloadText: JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: 'config/gates/default.json' },
    }),
  });
  assert.equal(read.route, 'pass');
  assert.equal(read.answers.guardrail_tamper.noul, 0);

  const write = buildTypesafeTypedQuestionsReport({
    payloadText: JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: 'config/gates/default.json', content: '{}' },
    }),
  });
  assert.equal(write.route, 'block');
  assert.equal(write.answers.guardrail_tamper.noul, 1);
});

test('custom noul without a route action fails closed', () => {
  const report = buildTypesafeTypedQuestionsReport({
    batteryText: JSON.stringify({
      mystery: {
        type: 'noul',
        instructions: 'Is this risky?',
        criteria: { true: 'yes', false: 'no' },
        matcher: 'mystery',
      },
    }),
    command: 'mystery',
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'noul_without_route_action'));
});

test('malformed null question returns a finding instead of throwing', () => {
  const report = buildTypesafeTypedQuestionsReport({
    batteryText: JSON.stringify({ questions: { x: null } }),
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'malformed_question'));
});

test('typed-question gate patterns match reverse-order rail text', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'config', 'gate-templates.json'), 'utf8')
  );
  const typed = config.templates.find((t) => t.id === 'require-typed-pretool-questions');
  const owned = config.templates.find((t) => t.id === 'require-code-owned-route');
  const typedRe = new RegExp(typed.pattern, 'i');
  const ownedRe = new RegExp(owned.pattern, 'i');
  assert.ok(typedRe.test('PreToolUse gate calls api.typesafe.ai'));
  assert.ok(ownedRe.test('PreToolUse route uses a model-emitted verdict'));
});

test('gate templates include typed-question honesty pair', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'config', 'gate-templates.json'), 'utf8')
  );
  const ids = config.templates.map((t) => t.id);
  assert.ok(ids.includes('require-typed-pretool-questions'));
  assert.ok(ids.includes('require-code-owned-route'));
  const typed = config.templates.find((t) => t.id === 'require-typed-pretool-questions');
  assert.equal(typed.category, 'Agent Honesty');
  assert.match(typed.rollout, /typesafe-typed-questions/);
});

test('questionsForApi strips matcher fields before System One', () => {
  const q = questionsForApi({
    destructive: {
      type: 'noul',
      instructions: 'Destructive?',
      criteria: { true: 'yes', false: 'no' },
      matcher: 'rm -rf',
    },
  });
  assert.equal(q.destructive.matcher, undefined);
  assert.equal(q.destructive.type, 'noul');
});

test('--live without a key fails closed and does not call fetch', async () => {
  let called = 0;
  const report = await buildTypesafeTypedQuestionsReportAsync({
    live: true,
    apiKey: null,
    fetchImpl: async () => {
      called += 1;
      return { ok: true, status: 200, text: async () => '{}' };
    },
    toolName: 'Read',
    command: 'README.md',
  });
  assert.equal(called, 0);
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'live_key_missing'));
  assert.equal(report.route, 'pass');
});

test('--live shadow disagrees without changing route', async () => {
  const report = await buildTypesafeTypedQuestionsReportAsync({
    live: true,
    apiKey: 'test-key',
    toolName: 'Bash',
    command: 'git reset --hard HEAD',
    fetchImpl: async (url, init) => {
      assert.match(String(url), /systemone/);
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'jev-latest');
      assert.equal(body.questions.destructive.matcher, undefined);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          model: 'jev-latest',
          answers: { destructive: { type: 'noul', noul: 0.05 } },
          usage: { input_tokens: 12, output_tokens: 3 },
        }),
      };
    },
  });
  assert.equal(report.route, 'block');
  assert.equal(report.shadow.used, true);
  assert.equal(report.shadow.ownsRoute, false);
  assert.ok(report.findings.some((f) => f.id === 'shadow_divergence'));
});

test('--use-typesafe-api still refuses Jev as the gate even with --live', async () => {
  let called = 0;
  const report = await buildTypesafeTypedQuestionsReportAsync({
    live: true,
    useTypesafeApi: true,
    apiKey: 'test-key',
    fetchImpl: async () => {
      called += 1;
      return { ok: true, status: 200, text: async () => '{}' };
    },
  });
  assert.equal(called, 0);
  assert.ok(report.findings.some((f) => f.id === 'typesafe_api_refused'));
});

test('docs and skill refuse Jev clones and LLM adjudicator', () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'agents', 'typesafe-typed-questions.md'),
    'utf8'
  );
  assert.match(doc, /not affiliated|do not clone/i);
  assert.match(doc, /typesafe-sdk/);
  assert.match(doc, /#3690|#3687|LLM adjudicat/i);

  const skill = fs.readFileSync(
    path.join(__dirname, '..', '.agents', 'skills', 'typesafe-typed-questions-not-clone', 'SKILL.md'),
    'utf8'
  );
  for (const heading of ['## Goal', '## Constraints', '## Reference', '## Examples', '## Procedures', '## Rubric']) {
    assert.ok(skill.includes(heading), `missing ${heading}`);
  }
  assert.match(skill, /Weak:/);
  assert.match(skill, /Gold:/);
  assert.match(skill, /Do NOT install/i);
  assert.match(skill, /console\.typesafe\.ai\/hook/);
});
