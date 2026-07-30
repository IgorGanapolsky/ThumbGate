'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

test('server.json declares npx thumbgate serve for stdio MCP registries', () => {
  const server = readJson('server.json');
  const pkg = server.packages && server.packages[0];
  assert.ok(pkg, 'server.json must declare at least one package');
  assert.equal(pkg.registryType, 'npm');
  assert.equal(pkg.identifier, 'thumbgate');
  assert.equal(pkg.transport && pkg.transport.type, 'stdio');
  assert.equal(pkg.runtimeHint, 'npx');

  const runtimeArgs = (pkg.runtimeArguments || []).map((a) => a.value);
  assert.ok(runtimeArgs.includes('-y'), 'runtimeArguments should include -y for npx');

  const packageArgs = (pkg.packageArguments || []).map((a) => a.value);
  assert.deepEqual(packageArgs, ['serve'], 'packageArguments must be ["serve"] so registries do not guess npm start');

  assert.doesNotMatch(
    String(server.description || ''),
    /mcp-memory-gateway|MCP Memory Gateway|rlhf-loop/i,
    'server.json description must not use retired product names',
  );
});

test('glama.json lists maintainers (schema-required) and stays schema-minimal', () => {
  const glama = readJson('glama.json');
  assert.ok(Array.isArray(glama.maintainers) && glama.maintainers.includes('IgorGanapolsky'));
  // Official Glama schema only allows maintainers — do not invent non-schema keys
  // that would break their validator. Start command lives in server.json + smithery.yaml.
  const keys = Object.keys(glama).filter((k) => k !== '$schema');
  assert.deepEqual(keys, ['maintainers']);
});

test('smithery.yaml starts stdio via npx thumbgate serve', () => {
  const yaml = fs.readFileSync(path.join(ROOT, 'smithery.yaml'), 'utf8');
  assert.match(yaml, /type:\s*"stdio"/);
  assert.match(yaml, /command:\s*"npx"/);
  assert.match(yaml, /thumbgate/);
  assert.match(yaml, /serve/);
  assert.doesNotMatch(yaml, /mcp-memory-gateway/i);
});

test('npm package ships MCP registry manifests', () => {
  const pkg = readJson('package.json');
  for (const f of ['server.json', 'glama.json', 'smithery.yaml']) {
    assert.ok((pkg.files || []).includes(f), `${f} must be in package.json files`);
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} must exist on disk`);
  }
  assert.doesNotMatch(
    String(pkg.description || ''),
    /mcp-memory-gateway|MCP Memory Gateway/i,
  );
});

test('README documents Glama/MCP stdio start and forbids npm start for MCP', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /npx -y thumbgate serve/);
  assert.match(readme, /Do \*\*not\*\* use `npm start` for MCP/);
  assert.match(readme, /ThumbGate/);
  assert.doesNotMatch(
    readme.slice(0, 4000),
    /The MCP Memory Gateway/,
    'README hero must not open with legacy product name',
  );
});
