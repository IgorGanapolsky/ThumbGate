'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  buildDeeppatternDisciplineHonestyReport,
  formatDeeppatternDisciplineHonestyReport,
  REQUIRED_CLOSEOUT_ITEMS,
  THUMBGATE_LAYER,
} = require('../scripts/deeppattern-discipline-honesty');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'deeppattern-discipline-honesty.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

const VALID_CLOSEOUT = `# PR

## Evidence Block

| item | evidence |
|---|---|
| scope completed | deeppattern doctor + skill + tests |
| verification run | \`npm run test:deeppattern-discipline-honesty\` exit 0 |
| audit adjudicated | no external audit; local FORMAT steal review |
| durable state updated | changeset + docs/agents note |
| production boundary | no production deploy or secrets touched |
| remaining blockers | none |
`;

test('map-only is ready and pins ThumbGate at L7', () => {
  const report = buildDeeppatternDisciplineHonestyReport({ mapOnly: true });
  assert.equal(report.status, 'ready');
  assert.equal(report.ok, true);
  assert.equal(THUMBGATE_LAYER, 'L7');
  assert.equal(REQUIRED_CLOSEOUT_ITEMS.length, 6);
  assert.ok(report.map.length >= 3);
});

test('treating LiteLLM as ThumbGate substitute fails layer-check', () => {
  const report = buildDeeppatternDisciplineHonestyReport({
    claim: 'LiteLLM replaces ThumbGate PreToolUse because both route models',
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'cross_layer_substitute'));
  assert.ok(report.findings.some((f) => f.gateId === 'require-same-layer-comparison'));
});

test('OpenRouter commoditizes claim fails', () => {
  const report = buildDeeppatternDisciplineHonestyReport({
    claim: 'token aggregators commoditize ThumbGate evaluate-block-evidence',
  });
  assert.ok(report.findings.some((f) => f.id === 'cross_layer_substitute'));
});

test('honest dependency language does not fail', () => {
  const report = buildDeeppatternDisciplineHonestyReport({
    claim: 'ThumbGate PreToolUse consumes LiteLLM as an optional input dependency under the gate',
  });
  assert.equal(report.status, 'ready');
  assert.ok(!report.findings.some((f) => f.id === 'cross_layer_substitute'));
});

test('Decision Engine as substitute is refused', () => {
  const report = buildDeeppatternDisciplineHonestyReport({
    claim: 'Decision Engine cross-vendor panel replaces ThumbGate',
  });
  assert.ok(report.findings.some((f) => f.id === 'cross_layer_substitute' || f.id === 'deeppattern_sku_clone'));
});

test('clone flags fail closed', () => {
  assert.ok(
    buildDeeppatternDisciplineHonestyReport({ cloneDeeppattern: true })
      .findings.some((f) => f.id === 'deeppattern_sku_clone')
  );
  assert.ok(
    buildDeeppatternDisciplineHonestyReport({ claim: 'run dp-install.sh for ThumbGate' })
      .findings.some((f) => f.id === 'deeppattern_sku_clone')
  );
});

test('valid closeout passes', () => {
  const report = buildDeeppatternDisciplineHonestyReport({ closeoutText: VALID_CLOSEOUT });
  assert.equal(report.status, 'ready');
  assert.equal(report.closeout.missing.length, 0);
  assert.equal(report.closeout.placeholders.length, 0);
});

test('missing closeout item fails', () => {
  const missing = VALID_CLOSEOUT.replace('| remaining blockers | none |\n', '');
  const report = buildDeeppatternDisciplineHonestyReport({ closeoutText: missing });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'missing_closeout_item'));
});

test('placeholder closeout item fails', () => {
  const placeholder = VALID_CLOSEOUT.replace('deeppattern doctor + skill + tests', 'TODO');
  const report = buildDeeppatternDisciplineHonestyReport({ closeoutText: placeholder });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'placeholder_closeout_item'));
});

test('closeout file path works', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-closeout-'));
  const file = path.join(dir, 'closeout.md');
  fs.writeFileSync(file, VALID_CLOSEOUT);
  const report = buildDeeppatternDisciplineHonestyReport({ closeoutPath: file });
  assert.equal(report.status, 'ready');
});

test('format includes disclaimer', () => {
  const text = formatDeeppatternDisciplineHonestyReport(
    buildDeeppatternDisciplineHonestyReport({ mapOnly: true })
  );
  assert.match(text, /DeepPattern Discipline Honesty Doctor/);
  assert.match(text, /not affiliated/i);
});

test('CLI --json --map-only exits 0', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json', '--map-only'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.name, 'thumbgate-deeppattern-discipline-honesty');
});

test('CLI cross-layer claim exits 1', () => {
  const result = spawnSync(process.execPath, [
    SCRIPT, '--json', '--claim=OpenRouter replaces ThumbGate PreToolUse',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
});

test('bin/cli.js deeppattern-discipline-honesty is wired', () => {
  const result = spawnSync(process.execPath, [CLI, 'deeppattern-discipline-honesty', '--json', '--map-only'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('gate templates and skill refuse DeepPattern SKU clones', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'gate-templates.json'), 'utf8'));
  const ids = config.templates.map((t) => t.id);
  assert.ok(ids.includes('require-same-layer-comparison'));
  assert.ok(ids.includes('require-evidence-closeout-items'));
  assert.ok(ids.includes('refuse-deeppattern-sku-clone'));

  const skill = fs.readFileSync(
    path.join(__dirname, '..', '.agents', 'skills', 'deeppattern-discipline-honesty-not-clone', 'SKILL.md'),
    'utf8'
  );
  assert.match(skill, /not a\s+ThumbGate clone/i);
  assert.match(skill, /layer-check/i);
  assert.match(skill, /evidence-closeout/i);
});
