'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  parseCatalog,
  parseComposeStream,
  repairComposeStream,
  buildOpenuiCatalogComposeHonestyReport,
  formatOpenuiCatalogComposeHonestyReport,
} = require('../scripts/openui-catalog-compose-honesty');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');
const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'openui-catalog-compose-honesty.js');

function makeFixture({ catalog, stream }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openui-honesty-'));
  if (catalog != null) {
    fs.writeFileSync(
      path.join(root, 'catalog.json'),
      typeof catalog === 'string' ? catalog : `${JSON.stringify(catalog, null, 2)}\n`
    );
  }
  if (stream != null) {
    fs.writeFileSync(path.join(root, 'compose.txt'), String(stream));
  }
  return root;
}

test('parseCatalog accepts string ids and object entries', () => {
  const a = parseCatalog(JSON.stringify({ components: ['Stack', 'Card'] }));
  assert.equal(a.ok, true);
  assert.ok(a.ids.has('Stack'));
  const b = parseCatalog({ components: [{ id: 'Table', props: ['rows'] }] });
  assert.equal(b.ok, true);
  assert.ok(b.ids.has('Table'));
});

test('parseCatalog fails closed on empty or bad JSON', () => {
  assert.equal(parseCatalog('').ok, false);
  assert.equal(parseCatalog('{nope').ok, false);
  assert.equal(parseCatalog(JSON.stringify({ components: [] })).ok, false);
});

test('parseComposeStream marks root, nodes, and dangerous lines', () => {
  const parsed = parseComposeStream(`
# comment
root = Stack([header])
header = Card()
evil = eval("x")
`);
  assert.ok(parsed.some((p) => p.kind === 'root' && p.component === 'Stack'));
  assert.ok(parsed.some((p) => p.kind === 'node' && p.binding === 'header'));
  assert.ok(parsed.some((p) => p.kind === 'dangerous' && p.danger === 'arbitrary_code'));
});

test('repairComposeStream drops unknown components and keeps catalog hits', () => {
  const catalog = parseCatalog({ components: ['Stack', 'Card'] });
  const parsed = parseComposeStream('root = Stack([x])\nx = Ghost()\ny = Card()\n');
  const repair = repairComposeStream(parsed, catalog.ids);
  assert.equal(repair.dropped.some((d) => d.component === 'Ghost'), true);
  assert.equal(repair.kept.some((k) => k.component === 'Card'), true);
  assert.equal(repair.kept.some((k) => k.component === 'Stack'), true);
});

test('doctor fails on unknown component and missing root', () => {
  const report = buildOpenuiCatalogComposeHonestyReport({
    catalogText: JSON.stringify({ components: ['Stack'] }),
    streamText: 'header = Card()\n',
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'unknown_component'));
  assert.ok(report.findings.some((f) => f.id === 'missing_root'));
});

test('doctor fails on arbitrary code and OpenUI SKU clone signals', () => {
  const report = buildOpenuiCatalogComposeHonestyReport({
    catalogText: JSON.stringify({ components: ['Stack'] }),
    streamText: 'root = Stack([])\nbad = eval(1)\nnote = install @openuidev/cli\n',
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'arbitrary_code_in_compose'));
  assert.ok(report.findings.some((f) => f.id === 'openui_sku_clone'));
});

test('claim-ready fails without clean repair; passes after clean catalog stream', () => {
  const dirty = buildOpenuiCatalogComposeHonestyReport({
    catalogText: JSON.stringify({ components: ['Stack'] }),
    streamText: 'root = Stack([x])\nx = Ghost()\n',
    claimReady: true,
    repair: true,
  });
  assert.equal(dirty.status, 'fail');
  assert.ok(dirty.findings.some((f) => f.id === 'claim_without_repair' || f.id === 'unknown_component'));

  const clean = buildOpenuiCatalogComposeHonestyReport({
    catalogText: JSON.stringify({ components: ['Stack', 'Card'] }),
    streamText: 'root = Stack([header])\nheader = Card()\n',
    claimReady: true,
    repair: true,
  });
  assert.equal(clean.status, 'ready');
  assert.equal(clean.metrics.repairClean, true);
});

test('root-not-first is a warn when root exists later', () => {
  const report = buildOpenuiCatalogComposeHonestyReport({
    catalogText: JSON.stringify({ components: ['Stack', 'Card'] }),
    streamText: 'header = Card()\nroot = Stack([header])\n',
  });
  assert.ok(['actionable', 'ready'].includes(report.status));
  assert.ok(report.findings.some((f) => f.id === 'root_not_first'));
});

test('format report includes status and disclaimer', () => {
  const report = buildOpenuiCatalogComposeHonestyReport({
    catalogText: JSON.stringify({ components: ['Stack'] }),
    streamText: 'root = Stack([])\n',
  });
  const text = formatOpenuiCatalogComposeHonestyReport(report);
  assert.match(text, /Catalog-Compose Honesty Doctor/);
  assert.match(text, /not affiliated with OpenUI\/Thesys/i);
});

test('CLI script --json exits 0 on clean stream', () => {
  const root = makeFixture({
    catalog: { components: ['Stack', 'Card'] },
    stream: 'root = Stack([header])\nheader = Card()\n',
  });
  const result = spawnSync(process.execPath, [
    SCRIPT,
    `--root=${root}`,
    '--catalog=catalog.json',
    '--stream=compose.txt',
    '--repair',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'ready');
  assert.equal(report.metrics.repairClean, true);
});

test('bin/cli.js openui-catalog-compose-honesty is wired', () => {
  const root = makeFixture({
    catalog: { components: ['Stack'] },
    stream: 'root = Stack([])\n',
  });
  const result = spawnSync(process.execPath, [
    CLI,
    'openui-catalog-compose-honesty',
    `--root=${root}`,
    '--catalog=catalog.json',
    '--stream=compose.txt',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.name, 'thumbgate-openui-catalog-compose-honesty');
});

test('gate templates include catalog-compose honesty pair', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'config', 'gate-templates.json'), 'utf8')
  );
  const ids = config.templates.map((t) => t.id);
  assert.ok(ids.includes('require-catalog-compose-only'));
  assert.ok(ids.includes('require-repair-before-compose-claim'));
  const catalogGate = config.templates.find((t) => t.id === 'require-catalog-compose-only');
  assert.equal(catalogGate.category, 'Agent Honesty');
  assert.match(catalogGate.rollout, /openui-catalog-compose-honesty/);
});
