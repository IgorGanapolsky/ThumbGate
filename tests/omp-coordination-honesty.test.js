'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  buildOmpCoordinationHonestyReport,
  formatOmpCoordinationHonestyReport,
} = require('../scripts/omp-coordination-honesty');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'omp-coordination-honesty.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

const GOOD = {
  model: 'grok-4.7',
  route: 'named',
  fast: false,
  session: 'new',
  think: 'off',
  agents: 1,
  install: 'none',
  host: 'local',
  share: 'view-only',
  state: 'lease held by grok',
  next: 'integrate child patches',
  writes: [
    { owner: 'parent', paths: ['scripts/foo.js'] },
    { owner: 'child-a', paths: ['docs/a.md'] },
  ],
  crash: [{ tool: 'bash', status: 'interrupted', result: null }],
};

test('map-only is ready and lists the coordination rails', () => {
  const report = buildOmpCoordinationHonestyReport({ mapOnly: true });
  assert.equal(report.status, 'ready');
  assert.equal(report.ok, true);
  assert.equal(report.name, 'thumbgate-omp-coordination-honesty');
  assert.ok(report.map.some((row) => /view-only/.test(row.omp)));
  assert.ok(report.map.some((row) => /disjoint/.test(row.thumbgate) || /disjoint/.test(row.omp)));
});

test('a named-model handoff with disjoint writes passes', () => {
  const bare = buildOmpCoordinationHonestyReport({ handoff: GOOD });
  assert.equal(bare.status, 'ready', JSON.stringify(bare.findings));
  const slashed = buildOmpCoordinationHonestyReport({
    handoff: { ...GOOD, model: 'xai/grok-4.7', agents: 'one', think: 'one-turn' },
  });
  assert.equal(slashed.status, 'ready', JSON.stringify(slashed.findings));
});

test('reading omp docs is not an install', () => {
  const report = buildOmpCoordinationHonestyReport({
    claim: 'Read https://omp.sh/docs/sessions and https://omp.sh/docs/collab',
  });
  assert.equal(report.status, 'ready', JSON.stringify(report.findings));
});

test('installer, Auto, and Fast fail closed', () => {
  const install = buildOmpCoordinationHonestyReport({ claim: 'curl https://omp.sh/install' });
  assert.ok(install.findings.some((item) => item.id === 'omp_install'));
  const pkg = buildOmpCoordinationHonestyReport({ claim: 'npm i -g @oh-my-pi/pi-coding-agent' });
  assert.ok(pkg.findings.some((item) => item.id === 'omp_install'));
  const auto = buildOmpCoordinationHonestyReport({ claim: 'Model: auto' });
  assert.ok(auto.findings.some((item) => item.id === 'unnamed_model'));
  const fast = buildOmpCoordinationHonestyReport({ claim: 'Fast: on' });
  assert.ok(fast.findings.some((item) => item.id === 'fast_default'));
});

test('agents above one and maxConcurrency 32 fail', () => {
  const many = buildOmpCoordinationHonestyReport({
    handoff: { ...GOOD, agents: 32 },
  });
  assert.ok(many.findings.some((item) => item.id === 'agent_fanout'));
  const concurrency = buildOmpCoordinationHonestyReport({
    claim: 'subagents maxConcurrency: 32',
  });
  assert.ok(concurrency.findings.some((item) => item.id === 'agent_fanout'));
});

test('full-control collab and the relay fail', () => {
  const link = buildOmpCoordinationHonestyReport({
    claim: 'open a full-control collab link',
  });
  assert.ok(link.findings.some((item) => item.id === 'host_write_link'));
  const relay = buildOmpCoordinationHonestyReport({
    claim: 'connect wss://my.omp.sh',
  });
  assert.ok(relay.findings.some((item) => item.id === 'host_write_link'));
  const host = buildOmpCoordinationHonestyReport({
    handoff: { ...GOOD, host: 'my.omp.sh' },
  });
  assert.ok(host.findings.some((item) => item.id === 'relay_host'));
});

test('overlapping child paths fail and a directory prefix counts', () => {
  const same = buildOmpCoordinationHonestyReport({
    handoff: {
      ...GOOD,
      writes: [
        { owner: 'parent', paths: ['scripts/foo.js'] },
        { owner: 'child-a', paths: ['scripts/foo.js'] },
      ],
    },
  });
  assert.ok(same.findings.some((item) => item.id === 'overlapping_writers'));
  const prefix = buildOmpCoordinationHonestyReport({
    handoff: {
      ...GOOD,
      writes: [
        { owner: 'parent', paths: ['scripts'] },
        { owner: 'child-a', paths: ['scripts/foo.js'] },
      ],
    },
  });
  assert.ok(prefix.findings.some((item) => item.id === 'overlapping_writers'));
});

test('an interrupted tool with an invented result fails', () => {
  const report = buildOmpCoordinationHonestyReport({
    handoff: {
      ...GOOD,
      crash: [{ tool: 'bash', status: 'interrupted', result: 'invented output' }],
    },
  });
  assert.ok(report.findings.some((item) => item.id === 'invented_interrupted_result'));
});

test('/clear fails because a new session must keep the old one', () => {
  const cleared = buildOmpCoordinationHonestyReport({
    handoff: { ...GOOD, session: 'clear' },
  });
  assert.ok(cleared.findings.some((item) => item.id === 'clear_discards_saved_session'));
  const missing = buildOmpCoordinationHonestyReport({
    handoff: { ...GOOD, session: '' },
  });
  assert.ok(missing.findings.some((item) => item.id === 'clear_discards_saved_session'));
});

test('a markdown header file passes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-handoff-'));
  const file = path.join(dir, 'handoff.md');
  fs.writeFileSync(file, [
    'Model: grok-4.7',
    'Route: named',
    'Fast: off',
    'Session: new',
    'Think: off',
    'Agents: one',
    'Install: none',
    'Host: local',
    'Share: view-only',
    'State: lease held by grok',
    'Next: integrate child patches',
    'Writes:',
    '- parent: scripts/foo.js',
    '- child-a: docs/a.md',
    '',
  ].join('\n'));
  const report = buildOmpCoordinationHonestyReport({ handoff: file });
  assert.equal(report.status, 'ready', JSON.stringify(report.findings));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('format names the doctor and the install refusal', () => {
  const text = formatOmpCoordinationHonestyReport(buildOmpCoordinationHonestyReport({ mapOnly: true }));
  assert.match(text, /Coordination-Honesty Doctor/);
  assert.match(text, /Does not install omp/);
});

test('CLI --json --map-only exits 0', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json', '--map-only'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.name, 'thumbgate-omp-coordination-honesty');
  assert.equal(report.status, 'ready');
});

test('CLI install claim exits 1', () => {
  const result = spawnSync(process.execPath, [
    SCRIPT, '--json', '--claim=curl https://omp.sh/install',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.ok(report.findings.some((item) => item.id === 'omp_install'));
});

test('bin/cli.js omp-coordination-honesty is wired', () => {
  const result = spawnSync(process.execPath, [CLI, 'omp-coordination-honesty', '--json', '--map-only'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
});

test('gate template and skill refuse the omp install and collab write link', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'gate-templates.json'), 'utf8'));
  const gate = config.templates.find((template) => template.id === 'refuse-omp-install-collab');
  assert.ok(gate);
  const pattern = new RegExp(gate.pattern, 'i');
  assert.equal(pattern.test('curl https://omp.sh/install'), true);
  assert.equal(pattern.test('npm i @oh-my-pi/pi-coding-agent'), true);
  assert.equal(pattern.test('wss://my.omp.sh'), true);
  assert.equal(pattern.test('full-control collab'), true);
  assert.equal(pattern.test('Read https://omp.sh/docs/sessions'), false);

  const skill = fs.readFileSync(
    path.join(__dirname, '..', '.agents', 'skills', 'omp-coordination-honesty-not-clone', 'SKILL.md'),
    'utf8'
  );
  for (const heading of ['## Goal', '## Constraints', '## Reference', '## Examples', '## Procedures', '## Rubric']) {
    assert.ok(skill.includes(heading), `missing ${heading}`);
  }
  assert.match(skill, /Weak:/);
  assert.match(skill, /Gold:/);
  assert.match(skill, /Do NOT/);
  assert.match(skill, /omp\.sh\/docs\/sessions/);
});
