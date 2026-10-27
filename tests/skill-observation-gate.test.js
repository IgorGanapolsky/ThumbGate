'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const gate = require('../scripts/skill-observation-gate');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'skill-observation-gate.js');

function approvedObservation(overrides = {}) {
  const base = {
    approved: true,
    attribution: 'explicit',
    approvedBy: 'Igor Ganapolsky',
    runtime: 'local',
    judgeType: 'rule_based',
    case: {
      id: 'names-approval',
      title: 'Skill names the approval gate',
      input: { prompt: 'record this failure' },
      judge: {
        failure: [{ skill_contains: 'curl install.sh' }],
        success: [{ skill_contains: 'approved' }],
      },
    },
  };
  return { ...base, ...overrides, case: overrides.case || base.case };
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: options.cwd || path.dirname(SCRIPT),
    input: options.input == null ? '' : options.input,
    encoding: 'utf8',
  });
}

test('string true, numeric 1, and Explicit attribution are not approval', () => {
  for (const approved of ['true', 1, false, null]) {
    const result = gate.admitObservation(approvedObservation({ approved }));
    assert.equal(result.admitted, false);
    assert.equal(result.code, 'approval_required');
    assert.equal(result.case, null);
  }
  const attribution = gate.admitObservation(approvedObservation({ attribution: 'Explicit' }));
  assert.equal(attribution.admitted, false);
  assert.equal(attribution.code, 'explicit_attribution_required');
  assert.equal(attribution.case, null);
});

test('an explicitly approved local observation becomes a regression case', () => {
  const result = gate.admitObservation(approvedObservation());
  assert.equal(result.admitted, true);
  assert.equal(result.case.id, 'names-approval');
  assert.equal(result.case.source, 'approved-observation');
  assert.equal(result.case.approvedBy, 'Igor Ganapolsky');
  assert.equal(result.case.attribution, 'explicit');
  assert.deepEqual(result.case.judge.failure, [{ skill_contains: 'curl install.sh' }]);
});

test('docker, opensandbox, agent judges, and shell rules are refused with a null case', () => {
  const docker = gate.admitObservation(approvedObservation({ runtime: 'docker' }));
  const sandbox = gate.admitObservation(approvedObservation({ runtime: 'opensandbox' }));
  const dashed = gate.admitObservation(approvedObservation({ runtime: 'open-sandbox' }));
  const agent = gate.admitObservation(approvedObservation({ judgeType: 'agent_judge' }));
  const simulator = gate.admitObservation(approvedObservation({ judgeType: 'user_simulator' }));
  const command = gate.admitObservation(approvedObservation({
    case: {
      id: 'shell',
      judge: { failure: [{ command: 'rm -rf /' }], success: [] },
    },
  }));
  for (const result of [docker, sandbox, dashed, agent, simulator, command]) {
    assert.equal(result.admitted, false);
    assert.equal(result.case, null);
  }
  assert.equal(docker.code, 'runtime_refused');
  assert.equal(agent.code, 'judge_refused');
  assert.equal(command.code, 'rule_refused');
});

test('two keys, an empty needle, a missing id, and an empty judge are refused', () => {
  const twoKeys = gate.admitObservation(approvedObservation({
    case: {
      id: 'two',
      judge: { success: [{ skill_contains: 'a', file_exists: 'b' }] },
    },
  }));
  const emptyNeedle = gate.admitObservation(approvedObservation({
    case: { id: 'empty', judge: { success: [{ skill_contains: '   ' }] } },
  }));
  const emptyJudge = gate.admitObservation(approvedObservation({
    case: { id: 'vacuous', judge: { failure: [], success: [] } },
  }));
  const missingId = gate.admitObservation(approvedObservation({
    case: { id: '  ', judge: { success: [{ skill_contains: 'approved' }] } },
  }));
  assert.equal(twoKeys.code, 'rule_shape');
  assert.equal(emptyNeedle.code, 'rule_shape');
  assert.equal(emptyJudge.code, 'vacuous_judge');
  assert.equal(missingId.code, 'case_id_required');
  assert.equal(twoKeys.case, null);
});

test('absolute paths and parent traversal are refused for file_exists', () => {
  const absolute = gate.admitObservation(approvedObservation({
    case: { id: 'abs', judge: { success: [{ file_exists: '/etc/passwd' }] } },
  }));
  const parent = gate.admitObservation(approvedObservation({
    case: { id: 'up', judge: { success: [{ file_exists: '../secret.txt' }] } },
  }));
  assert.equal(absolute.code, 'rule_shape');
  assert.equal(parent.code, 'rule_shape');
  assert.equal(absolute.case, null);
  assert.equal(parent.case, null);
});

test('a failure rule fails the case before a matching success rule can pass it', () => {
  const testCase = approvedObservation().case;
  const result = gate.judgeCase(testCase, {
    skillText: 'curl install.sh\napproved by the maintainer',
  });
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.code, 'failure_rule');
  assert.equal(result.failureCheckedFirst, true);
});

test('skill_not_contains fails when the needle is absent and passes when it is present', () => {
  const failureCase = {
    id: 'avoid-install',
    judge: { failure: [{ skill_not_contains: 'npx thumbgate' }], success: [] },
  };
  const missing = gate.judgeCase(failureCase, { skillText: 'install skill-up' });
  const present = gate.judgeCase(failureCase, { skillText: 'npx thumbgate stays local' });
  assert.equal(missing.verdict, 'FAIL');
  assert.equal(missing.code, 'failure_rule');
  assert.equal(present.verdict, 'PASS');

  const successCase = {
    id: 'must-omit-install',
    judge: { failure: [], success: [{ skill_not_contains: 'curl install.sh' }] },
  };
  const clean = gate.judgeCase(successCase, { skillText: 'local gate only' });
  const dirty = gate.judgeCase(successCase, { skillText: 'curl install.sh' });
  assert.equal(clean.verdict, 'PASS');
  assert.equal(dirty.verdict, 'FAIL');
  assert.equal(dirty.code, 'success_rule');
});

test('file_exists reads the declared map, then a real file, and ignores directories and outside links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-observation-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-observation-out-'));
  fs.writeFileSync(path.join(root, 'SKILL.md'), 'approved\n');
  fs.mkdirSync(path.join(root, 'notes'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'leak'));
  fs.symlinkSync(outside, path.join(root, 'via'));
  fs.symlinkSync('SKILL.md', path.join(root, 'skill-link.md'));

  const declared = gate.judgeCase(
    { id: 'map', judge: { success: [{ file_exists: 'notes/case.json' }] } },
    { files: { 'notes/case.json': true }, root },
  );
  const onDisk = gate.judgeCase(
    { id: 'disk', judge: { success: [{ file_exists: 'SKILL.md' }] } },
    { root },
  );
  const directory = gate.judgeCase(
    { id: 'dir', judge: { success: [{ file_exists: 'notes' }] } },
    { root },
  );
  const leak = gate.judgeCase(
    { id: 'leak', judge: { success: [{ file_exists: 'leak' }] } },
    { root },
  );
  const via = gate.judgeCase(
    { id: 'via', judge: { success: [{ file_exists: 'via/secret.txt' }] } },
    { root },
  );
  const link = gate.judgeCase(
    { id: 'link', judge: { success: [{ file_exists: 'skill-link.md' }] } },
    { root },
  );
  const missing = gate.judgeCase(
    { id: 'missing', judge: { success: [{ file_exists: 'missing.md' }] } },
    { root },
  );

  assert.equal(declared.verdict, 'PASS');
  assert.equal(onDisk.verdict, 'PASS');
  assert.equal(link.verdict, 'PASS');
  assert.equal(directory.verdict, 'FAIL');
  assert.equal(leak.verdict, 'FAIL');
  assert.equal(via.verdict, 'FAIL');
  assert.equal(missing.verdict, 'FAIL');
});

test('null inputs do not throw and a missing report keeps the original', () => {
  assert.equal(gate.judgeCase(null).verdict, 'FAIL');
  assert.equal(gate.admitObservation(null).case, null);
  const compared = gate.compareRuns(null, null);
  assert.equal(compared.decision, 'keep_original');
  assert.equal(compared.code, 'invalid_report');
});

test('compare keeps the original when a pass flips or a case disappears', () => {
  const baseline = {
    cases: [
      { id: 'a', verdict: 'PASS' },
      { id: 'b', verdict: 'FAIL' },
    ],
  };
  const flipped = gate.compareRuns(baseline, {
    cases: [
      { id: 'a', verdict: 'FAIL' },
      { id: 'b', verdict: 'FAIL' },
    ],
  });
  const removed = gate.compareRuns(baseline, {
    cases: [{ id: 'a', verdict: 'PASS' }],
  });
  const improved = gate.compareRuns(baseline, {
    cases: [
      { id: 'a', verdict: 'PASS' },
      { id: 'b', verdict: 'PASS' },
      { id: 'c', verdict: 'PASS' },
    ],
  });
  const steady = gate.compareRuns(baseline, {
    cases: [
      { id: 'a', verdict: 'PASS' },
      { id: 'b', verdict: 'FAIL' },
    ],
  });
  assert.equal(flipped.decision, 'keep_original');
  assert.equal(flipped.code, 'regression');
  assert.equal(removed.decision, 'keep_original');
  assert.equal(removed.regressions[0].id, 'b');
  assert.equal(improved.decision, 'accept');
  assert.equal(steady.decision, 'accept');
});

test('junit escapes markup and counts every non-pass', () => {
  const xml = gate.toJUnit([
    { id: 'ok & next', verdict: 'PASS' },
    { id: 'bad < "quote"', verdict: 'FAIL', message: 'a < b & "c"' },
    null,
  ]);
  assert.match(xml, /name="ok &amp; next"/);
  assert.match(xml, /name="bad &lt; &quot;quote&quot;"/);
  assert.match(xml, /message="a &lt; b &amp; &quot;c&quot;"/);
  assert.match(xml, /tests="3" failures="2"/);
});

test('the idea map names the post and refuses the upstream runtime', () => {
  const map = gate.ideaMap();
  assert.equal(map.sourcePost, gate.SOURCE_POST);
  assert.equal(map.notOurMeasurement, true);
  assert.ok(map.refused.includes('docker'));
  assert.ok(map.refused.includes('opensandbox'));
  assert.ok(map.refused.includes('replying on X'));
});

test('cli map, admit, judge, and compare exit codes match the decision', () => {
  const map = runCli(['--map-only']);
  assert.equal(map.status, 0);
  assert.equal(JSON.parse(map.stdout).sourceRepo, gate.SOURCE_REPO);

  const bad = runCli(['admit'], { input: '{not json' });
  assert.equal(bad.status, 2);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-observation-cli-'));
  const refusedPath = path.join(dir, 'refused.json');
  const refused = runCli(['admit', '--out', 'refused.json'], {
    cwd: dir,
    input: JSON.stringify(approvedObservation({ approved: 'true' })),
  });
  assert.equal(refused.status, 1);
  assert.equal(fs.existsSync(refusedPath), false);

  const admittedPath = path.join(dir, 'nested', 'case.json');
  const admitted = runCli(['admit', '--out', 'nested/case.json'], {
    cwd: dir,
    input: JSON.stringify(approvedObservation()),
  });
  assert.equal(admitted.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(admittedPath, 'utf8')).id, 'names-approval');

  fs.writeFileSync(path.join(dir, 'SKILL.md'), 'approved\n');
  const caseFile = path.join(dir, 'judge-case.json');
  fs.writeFileSync(caseFile, JSON.stringify(approvedObservation().case));
  const judged = runCli(['judge', '--case', caseFile, '--workspace', dir], { cwd: dir });
  assert.equal(judged.status, 0);
  assert.equal(JSON.parse(judged.stdout).verdict, 'PASS');

  const usage = runCli(['judge']);
  assert.equal(usage.status, 2);

  const baseline = path.join(dir, 'base.json');
  const candidate = path.join(dir, 'next.json');
  fs.writeFileSync(baseline, JSON.stringify({ cases: [{ id: 'a', verdict: 'PASS' }] }));
  fs.writeFileSync(candidate, JSON.stringify({ cases: [{ id: 'a', verdict: 'FAIL' }] }));
  const kept = runCli(['compare', baseline, candidate]);
  assert.equal(kept.status, 1);
  assert.equal(JSON.parse(kept.stdout).decision, 'keep_original');

  fs.writeFileSync(candidate, JSON.stringify({ cases: [{ id: 'a', verdict: 'PASS' }] }));
  const accepted = runCli(['compare', baseline, candidate]);
  assert.equal(accepted.status, 0);
  assert.equal(runCli(['compare']).status, 2);
});

function runWithOpenStdin(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: cwd || path.dirname(SCRIPT),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 2000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

test('map-only, judge, and compare finish while stdin is still open', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-observation-open-'));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), 'approved\n');
  const caseFile = path.join(dir, 'case.json');
  fs.writeFileSync(caseFile, JSON.stringify(approvedObservation().case));
  const baseline = path.join(dir, 'base.json');
  const candidate = path.join(dir, 'next.json');
  fs.writeFileSync(baseline, JSON.stringify({ cases: [{ id: 'a', verdict: 'PASS' }] }));
  fs.writeFileSync(candidate, JSON.stringify({ cases: [{ id: 'a', verdict: 'PASS' }] }));

  const mapped = await runWithOpenStdin(['--map-only'], dir);
  assert.equal(mapped.status, 0);
  assert.equal(JSON.parse(mapped.stdout).notOurMeasurement, true);

  const help = await runWithOpenStdin(['--help'], dir);
  assert.equal(help.status, 0);
  assert.match(help.stderr, /Usage:/);

  const judged = await runWithOpenStdin(['judge', '--case', caseFile, '--workspace', dir], dir);
  assert.equal(judged.status, 0);
  assert.equal(JSON.parse(judged.stdout).verdict, 'PASS');

  const compared = await runWithOpenStdin(['compare', baseline, candidate], dir);
  assert.equal(compared.status, 0);
  assert.equal(JSON.parse(compared.stdout).decision, 'accept');

  const unknown = await runWithOpenStdin(['nope'], dir);
  assert.equal(unknown.status, 2);
});

test('judge does not pass a missing workspace or a missing skill file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-observation-missing-'));
  const caseFile = path.join(dir, 'case.json');
  fs.writeFileSync(caseFile, JSON.stringify({
    id: 'absence',
    judge: { failure: [], success: [{ skill_not_contains: 'unsafe' }] },
  }));

  const omitted = runCli(['judge', '--case', caseFile], { cwd: dir });
  assert.equal(omitted.status, 1);
  assert.equal(JSON.parse(omitted.stdout).verdict, 'FAIL');
  assert.equal(JSON.parse(omitted.stdout).code, 'workspace_required');

  const missingDir = runCli(['judge', '--case', caseFile, '--workspace', path.join(dir, 'gone')], { cwd: dir });
  assert.equal(missingDir.status, 1);
  assert.equal(JSON.parse(missingDir.stdout).verdict, 'FAIL');
  assert.equal(JSON.parse(missingDir.stdout).code, 'workspace_missing');

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-observation-empty-'));
  const noSkill = runCli(['judge', '--case', caseFile, '--workspace', empty], { cwd: dir });
  assert.equal(noSkill.status, 1);
  assert.equal(JSON.parse(noSkill.stdout).verdict, 'FAIL');
  assert.equal(JSON.parse(noSkill.stdout).code, 'skill_missing');

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-observation-skill-out-'));
  fs.writeFileSync(path.join(outside, 'SKILL.md'), 'local gate only\n');
  const linkedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-observation-skill-link-'));
  fs.symlinkSync(path.join(outside, 'SKILL.md'), path.join(linkedRoot, 'SKILL.md'));
  const leaked = runCli(['judge', '--case', caseFile, '--workspace', linkedRoot], { cwd: dir });
  assert.equal(leaked.status, 1);
  assert.equal(JSON.parse(leaked.stdout).verdict, 'FAIL');
  assert.equal(JSON.parse(leaked.stdout).code, 'skill_refused');
});

test('admit refuses an output path that resolves outside the working directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-observation-out-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-observation-escaped-'));
  fs.symlinkSync(outside, path.join(dir, 'linked'));
  const escaped = runCli(['admit', '--out', 'linked/case.json'], {
    cwd: dir,
    input: JSON.stringify(approvedObservation()),
  });
  assert.equal(escaped.status, 2);
  assert.equal(JSON.parse(escaped.stdout).code, 'out_refused');
  assert.equal(fs.existsSync(path.join(outside, 'case.json')), false);

  const outsideFile = path.join(outside, 'kept.json');
  fs.writeFileSync(outsideFile, 'keep\n');
  fs.symlinkSync(outsideFile, path.join(dir, 'escaped.json'));
  const throughFile = runCli(['admit', '--out', 'escaped.json'], {
    cwd: dir,
    input: JSON.stringify(approvedObservation()),
  });
  assert.equal(throughFile.status, 2);
  assert.equal(JSON.parse(throughFile.stdout).code, 'out_refused');
  assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'keep\n');

  const realDir = path.join(dir, 'real');
  fs.mkdirSync(realDir);
  fs.symlinkSync(realDir, path.join(dir, 'alias'));
  const inside = runCli(['admit', '--out', 'alias/case.json'], {
    cwd: dir,
    input: JSON.stringify(approvedObservation()),
  });
  assert.equal(inside.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(realDir, 'case.json'), 'utf8')).id, 'names-approval');
});
